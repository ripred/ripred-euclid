import { randomUUID } from "node:crypto";
import {
  ChallengeError,
  readChallengeOptions,
  type ChallengeOptions,
} from "../shared/challenge";
import {
  byPeriod,
  CHALLENGE_PERIODS,
  CHALLENGE_SETTING,
  readChallengeSpotlights,
  type ChallengePeriod,
  type ChallengeWinner,
} from "../shared/challenge-spotlights";
import type {
  CompetitionApplyRequest,
  CompetitionSummary,
  CompetitionTemplatesResponse,
} from "../shared/competitions";
import { type SubredditSettings } from "../shared/subreddit-settings";
import {
  generateChallenge,
  type CertifiedChallenge,
} from "./challenge-generator";
import { CHALLENGE_RESULTS_KEY } from "./challenge-results";
import {
  COMPETITION_DETAILS_TTL,
  COMPETITION_LEASE_MS,
  COMPETITION_STATE_KEY,
  competitionInstanceKey,
  competitionSummaryKey,
  competitionWindow,
  competitionWinsKey,
  readCompetitionInstance,
  readCompetitionState,
  type CompetitionInstance,
} from "./competition-model";
import { redisCas, redisMultiCas, type RedisCasWrite } from "./redis-cas";
import type { CompetitionRedisClient } from "./competition-redis";
import { ensureCompetitionRanking } from "./competition-ranking";
import { parseJson } from "./stored-json";
import {
  parseSubredditSettings,
  readSubredditSettings,
  SUBREDDIT_SETTINGS_KEY,
} from "./subreddit-settings";
import { isCount, isRecord } from "../shared/guards";

export interface CompetitionServiceOptions {
  now?: () => number;
  newId?: () => string;
  generate?: (options: ChallengeOptions, seed: string) => CertifiedChallenge;
}
export class CompetitionApplyPendingError extends Error {
  override readonly name = "CompetitionApplyPendingError";
}
interface ApplyReceipt {
  fingerprint: string;
  status: "running" | "complete" | "failed";
  token: string;
  leaseUntil: number;
  attempts: number;
  window?: { opensAt: number; endsAt: number };
}
const jsonWrite = (
  key: string,
  value: unknown,
  expiration?: Date,
): RedisCasWrite => ({
  action: "set",
  key,
  value: JSON.stringify(value),
  ...(expiration ? { expiration } : {}),
});

/** A winner's challenge win totals; missing or unreadable counts start at 0. */
function readWinCounts(
  raw: string | undefined,
): Record<ChallengePeriod, number> {
  const stored = parseJson(raw);
  return byPeriod((period) =>
    isRecord(stored) && isCount(stored[period]) ? stored[period] : 0,
  );
}

/** Lifecycle and templates share one parameterized daily/weekly implementation. */
export class CompetitionService {
  readonly now: () => number;
  readonly newId: () => string;
  private readonly generate: (
    options: ChallengeOptions,
    seed: string,
  ) => CertifiedChallenge;
  constructor(
    readonly redis: CompetitionRedisClient,
    options: CompetitionServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? randomUUID;
    this.generate = options.generate ?? generateChallenge;
  }

  async templates(): Promise<CompetitionTemplatesResponse> {
    const [raw, settings] = await Promise.all([
      this.redis.get(COMPETITION_STATE_KEY),
      readSubredditSettings(this.redis),
    ]);
    const state = readCompetitionState(raw);
    return {
      settings,
      templates: byPeriod((period) => {
        const config = state.periods[period];
        return {
          active: config.active,
          pending: config.pending,
          revision: config.revision,
          generationError: config.generationError,
          activationAt: config.activationAt,
        };
      }),
      serverNow: this.now(),
    };
  }

  async saveSettings(settings: SubredditSettings): Promise<void> {
    let saved = false;
    for (let attempt = 0; attempt < 4 && !saved; attempt++) {
      const observed = readCompetitionState(
        await this.redis.get(COMPETITION_STATE_KEY),
      );
      const currentIds = byPeriod(
        (period) => observed.periods[period].currentId,
      );
      saved = await redisMultiCas(
        this.redis,
        [
          COMPETITION_STATE_KEY,
          SUBREDDIT_SETTINGS_KEY,
          ...CHALLENGE_PERIODS.flatMap((period) =>
            currentIds[period]
              ? [competitionInstanceKey(currentIds[period]!)]
              : [],
          ),
        ],
        (values) => {
          const state = readCompetitionState(values.get(COMPETITION_STATE_KEY));
          // A replacement can change the set of instance keys to watch. Reload it before saving.
          if (
            CHALLENGE_PERIODS.some(
              (period) =>
                state.periods[period].currentId !== currentIds[period],
            )
          )
            return { action: "no-change", result: false };
          const old = parseSubredditSettings(
            values.get(SUBREDDIT_SETTINGS_KEY),
          );
          const now = this.now();
          for (const period of CHALLENGE_PERIODS) {
            const config = state.periods[period];
            if (
              settings[CHALLENGE_SETTING[period]] &&
              (!old[CHALLENGE_SETTING[period]] || config.activationAt === null)
            ) {
              const current = config.currentId
                ? readCompetitionInstance(
                    values.get(competitionInstanceKey(config.currentId)),
                  )
                : null;
              const resumable =
                current &&
                !current.superseded &&
                !current.settled &&
                current.opensAt <= now &&
                now < current.endsAt;
              config.activationAt = resumable
                ? current.opensAt
                : settings.challengeApplyTiming === "immediately"
                  ? now
                  : competitionWindow(period, now).endsAt;
            }
          }
          return {
            action: "commit",
            writes: [
              jsonWrite(COMPETITION_STATE_KEY, state),
              jsonWrite(SUBREDDIT_SETTINGS_KEY, settings),
            ],
            result: true,
          };
        },
      );
    }
    if (!saved)
      throw new ChallengeError(
        "stale",
        "The challenge changed concurrently. Refresh before saving settings.",
      );
    // The settings remain durable if generation cannot find a certified board.
    try {
      await this.reconcile();
    } catch (error) {
      console.error(
        "Competition maintenance will retry after saving settings",
        error,
      );
    }
  }

  async apply(
    period: ChallengePeriod,
    moderatorId: string,
    request: CompetitionApplyRequest,
  ): Promise<CompetitionTemplatesResponse> {
    if (
      !request ||
      typeof request.commandId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,120}$/.test(request.commandId) ||
      !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision < 0
    )
      throw new ChallengeError(
        "invalid",
        "Send a command ID and the saved template revision.",
      );
    const parsed = readChallengeOptions(request.options);
    // A playground seed must never become a recurring competition seed.
    const { seed: _seed, ...options } = parsed;
    const receiptKey = `euclid:competition:apply:${encodeURIComponent(moderatorId)}:${request.commandId}`;
    const fingerprint = JSON.stringify({
      period,
      expectedRevision: request.expectedRevision,
      options,
    });
    const token = this.newId();
    const claim = await redisMultiCas<
      "complete" | { window: { opensAt: number; endsAt: number } }
    >(
      this.redis,
      [COMPETITION_STATE_KEY, SUBREDDIT_SETTINGS_KEY, receiptKey],
      (values) => {
        const prior = parseJson(values.get(receiptKey)) as ApplyReceipt | null;
        if (prior && prior.fingerprint !== fingerprint)
          throw new ChallengeError(
            "invalid",
            "That command ID was already used for another change.",
          );
        if (prior?.status === "complete")
          return { action: "no-change", result: "complete" as const };
        if (prior?.window && prior.window.endsAt <= this.now())
          throw new ChallengeError(
            "stale",
            "A new challenge period began. Review and apply again.",
          );
        if (prior?.status === "running" && prior.leaseUntil > this.now())
          throw new CompetitionApplyPendingError(
            "This change is still being prepared. Retry this same change shortly.",
          );
        if (prior && prior.attempts >= 3)
          throw new ChallengeError(
            "unavailable",
            "Generation failed. Apply again with a new command to retry.",
          );
        const state = readCompetitionState(values.get(COMPETITION_STATE_KEY));
        const settings = parseSubredditSettings(
          values.get(SUBREDDIT_SETTINGS_KEY),
        );
        const config = state.periods[period];
        if (config.revision !== request.expectedRevision)
          throw new ChallengeError(
            "stale",
            "Another moderator changed these settings. Review the refreshed settings.",
          );
        const now = this.now();
        const version = {
          revision: config.revision + 1,
          options,
          effectiveAt:
            settings.challengeApplyTiming === "immediately"
              ? now
              : competitionWindow(period, now).endsAt,
          savedAt: now,
        };
        if (settings.challengeApplyTiming === "next-start") {
          // A late request must preserve the template already due for this period.
          if (config.pending && config.pending.effectiveAt <= now)
            config.active = config.pending;
          config.pending = version;
          config.revision = version.revision;
          config.preparedId = null;
          config.generation = null;
          config.preparationGeneration = null;
          config.generationError = null;
          return {
            action: "commit",
            writes: [
              jsonWrite(COMPETITION_STATE_KEY, state),
              jsonWrite(receiptKey, {
                fingerprint,
                status: "complete",
                token,
                leaseUntil: 0,
                attempts: 0,
              }),
            ],
            result: "complete" as const,
          };
        }
        if (!request.confirmReset)
          throw new ChallengeError(
            "invalid",
            "Confirm that replacing the current challenge resets its entries without awarding a winner.",
          );
        const window = prior?.window ?? competitionWindow(period, now);
        return {
          action: "commit",
          writes: [
            jsonWrite(receiptKey, {
              fingerprint,
              status: "running",
              token,
              leaseUntil: now + COMPETITION_LEASE_MS,
              attempts: prior?.attempts ?? 0,
              window,
            }),
          ],
          result: { window },
        };
      },
    );
    if (claim === "complete") return this.templates();
    let certified: CertifiedChallenge | null = null;
    let failure: unknown;
    for (;;) {
      const canTry = await redisCas(this.redis, receiptKey, (raw) => {
        const receipt = parseJson(raw) as ApplyReceipt;
        if (receipt.token !== token || receipt.status !== "running")
          throw new ChallengeError(
            "stale",
            "The generation lease changed. Refresh before applying again.",
          );
        if (receipt.attempts >= 3)
          return { action: "no-change", result: false };
        receipt.attempts++;
        receipt.leaseUntil = this.now() + COMPETITION_LEASE_MS;
        return { action: "set", value: JSON.stringify(receipt), result: true };
      });
      if (!canTry) break;
      try {
        certified = this.generate(options, this.newId());
        break;
      } catch (error) {
        failure = error;
      }
    }
    if (!certified) {
      await redisMultiCas(
        this.redis,
        [COMPETITION_STATE_KEY, receiptKey],
        (values) => {
          const receipt = parseJson(values.get(receiptKey)) as ApplyReceipt;
          if (receipt.token !== token)
            return { action: "no-change", result: undefined };
          receipt.status = "failed";
          const state = readCompetitionState(values.get(COMPETITION_STATE_KEY));
          if (state.periods[period].revision === request.expectedRevision)
            state.periods[period].generationError = generationMessage(failure);
          return {
            action: "commit",
            writes: [
              jsonWrite(COMPETITION_STATE_KEY, state),
              jsonWrite(receiptKey, receipt),
            ],
            result: undefined,
          };
        },
      );
      throw new ChallengeError("unavailable", generationMessage(failure));
    }
    const id = this.newId();
    const initial = readCompetitionState(
      await this.redis.get(COMPETITION_STATE_KEY),
    );
    const previousId = initial.periods[period].currentId;
    const keys = [
      COMPETITION_STATE_KEY,
      SUBREDDIT_SETTINGS_KEY,
      receiptKey,
      competitionInstanceKey(id),
      ...(previousId
        ? [
            competitionInstanceKey(previousId),
            competitionSummaryKey(previousId),
          ]
        : []),
    ];
    await redisMultiCas(this.redis, keys, (values) => {
      const receipt = parseJson(values.get(receiptKey)) as ApplyReceipt;
      if (receipt.status === "complete")
        return { action: "no-change", result: undefined };
      const state = readCompetitionState(values.get(COMPETITION_STATE_KEY));
      const config = state.periods[period];
      const settings = parseSubredditSettings(
        values.get(SUBREDDIT_SETTINGS_KEY),
      );
      if (
        config.revision !== request.expectedRevision ||
        config.currentId !== previousId ||
        receipt.token !== token ||
        settings.challengeApplyTiming !== "immediately"
      )
        throw new ChallengeError(
          "stale",
          "The challenge or application timing changed during generation. Review and apply again.",
        );
      const now = this.now();
      if (now >= claim.window.endsAt || now < claim.window.opensAt)
        throw new ChallengeError(
          "stale",
          "A new challenge period began during generation. Review and apply again.",
        );
      const window = claim.window;
      const instance: CompetitionInstance = {
        id,
        period,
        opensAt: now,
        endsAt: window.endsAt,
        templateRevision: config.revision + 1,
        certified: certified!,
        superseded: false,
        settled: false,
        completionOrder: 0,
        leader: null,
        rankingVersion: 2,
      };
      const writes: RedisCasWrite[] = [];
      if (previousId) {
        const previous = readCompetitionInstance(
          values.get(competitionInstanceKey(previousId)),
        );
        if (previous && !previous.settled && previous.endsAt > now) {
          previous.superseded = true;
          previous.settled = true;
          writes.push(
            jsonWrite(
              competitionInstanceKey(previousId),
              previous,
              new Date(previous.endsAt + COMPETITION_DETAILS_TTL),
            ),
          );
          writes.push(
            jsonWrite(
              competitionSummaryKey(previousId),
              this.summary(previous, null),
            ),
          );
          state.settlementQueue = state.settlementQueue.filter(
            (entry) => entry.id !== previousId,
          );
        }
      }
      config.revision++;
      config.active = {
        revision: config.revision,
        options,
        effectiveAt: now,
        savedAt: now,
      };
      config.pending = null;
      config.currentId = id;
      config.preparedId = null;
      config.generation = null;
      config.preparationGeneration = null;
      config.generationError = null;
      config.activationAt = now;
      state.settlementQueue.push({ id, endsAt: instance.endsAt });
      receipt.status = "complete";
      writes.push(
        jsonWrite(COMPETITION_STATE_KEY, state),
        jsonWrite(receiptKey, receipt),
        jsonWrite(competitionInstanceKey(id), instance),
      );
      return { action: "commit", writes, result: undefined };
    });
    return this.templates();
  }

  async reconcile(): Promise<void> {
    // Settlement runs first so an expired current pointer never loses its award.
    const initial = readCompetitionState(
      await this.redis.get(COMPETITION_STATE_KEY),
    );
    for (const pending of initial.settlementQueue)
      if (pending.endsAt <= this.now()) await this.settle(pending.id);
    for (const period of CHALLENGE_PERIODS) {
      await this.promote(period);
      await this.ensureGenerated(period, false);
      const window = competitionWindow(period, this.now());
      if (window.endsAt - this.now() <= 5 * 60_000)
        await this.ensureGenerated(period, true);
    }
  }

  private async promote(period: ChallengePeriod): Promise<void> {
    const state = readCompetitionState(
      await this.redis.get(COMPETITION_STATE_KEY),
    );
    const preparedId = state.periods[period].preparedId;
    const currentId = state.periods[period].currentId;
    const keys = [
      COMPETITION_STATE_KEY,
      SUBREDDIT_SETTINGS_KEY,
      ...(preparedId ? [competitionInstanceKey(preparedId)] : []),
      ...(currentId ? [competitionInstanceKey(currentId)] : []),
    ];
    await redisMultiCas(this.redis, keys, (values) => {
      const current = readCompetitionState(values.get(COMPETITION_STATE_KEY));
      const config = current.periods[period];
      const settings = parseSubredditSettings(
        values.get(SUBREDDIT_SETTINGS_KEY),
      );
      const now = this.now();
      if (config.currentId !== currentId)
        return { action: "no-change", result: undefined };
      const running = currentId
        ? readCompetitionInstance(values.get(competitionInstanceKey(currentId)))
        : null;
      let changed = false;
      const writes: RedisCasWrite[] = [];
      if (config.pending && config.pending.effectiveAt <= now) {
        config.active = config.pending;
        config.pending = null;
        changed = true;
      }
      // Older saved enable flags have no activation record: obey the saved timing.
      if (settings[CHALLENGE_SETTING[period]] && config.activationAt === null) {
        config.activationAt =
          settings.challengeApplyTiming === "immediately"
            ? now
            : competitionWindow(period, now).endsAt;
        changed = true;
      }
      if (preparedId && config.preparedId === preparedId) {
        const prepared = readCompetitionInstance(
          values.get(competitionInstanceKey(preparedId)),
        );
        if (
          !prepared ||
          prepared.endsAt <= now ||
          (prepared.templateRevision !== config.active.revision &&
            prepared.opensAt <= now) ||
          (running && !running.superseded && running.endsAt === prepared.endsAt)
        ) {
          config.preparedId = null;
          changed = true;
        } else if (
          prepared.opensAt <= now &&
          settings[CHALLENGE_SETTING[period]] &&
          (config.activationAt ?? Infinity) <= now
        ) {
          config.currentId = prepared.id;
          // Published, unsettled instances retain the leader until settlement, even after long outages.
          writes.push(jsonWrite(competitionInstanceKey(prepared.id), prepared));
          config.preparedId = null;
          config.generation = null;
          config.preparationGeneration = null;
          config.generationError = null;
          if (
            !current.settlementQueue.some((entry) => entry.id === prepared.id)
          )
            current.settlementQueue.push({
              id: prepared.id,
              endsAt: prepared.endsAt,
            });
          changed = true;
        }
      }
      return changed
        ? {
            action: "commit",
            writes: [jsonWrite(COMPETITION_STATE_KEY, current), ...writes],
            result: undefined,
          }
        : { action: "no-change", result: undefined };
    });
  }

  private async ensureGenerated(
    period: ChallengePeriod,
    prepare: boolean,
  ): Promise<void> {
    const generationField = prepare ? "preparationGeneration" : "generation";
    for (let tries = 0; tries < 3; tries++) {
      const initial = readCompetitionState(
        await this.redis.get(COMPETITION_STATE_KEY),
      );
      const candidateId = prepare
        ? initial.periods[period].preparedId
        : initial.periods[period].currentId;
      const token = this.newId();
      const keys = [
        COMPETITION_STATE_KEY,
        SUBREDDIT_SETTINGS_KEY,
        ...(candidateId ? [competitionInstanceKey(candidateId)] : []),
      ];
      const claim = await redisMultiCas(this.redis, keys, (values) => {
        const state = readCompetitionState(values.get(COMPETITION_STATE_KEY));
        const config = state.periods[period];
        const settings = parseSubredditSettings(
          values.get(SUBREDDIT_SETTINGS_KEY),
        );
        const now = this.now();
        const window = competitionWindow(
          period,
          prepare ? competitionWindow(period, now).endsAt : now,
        );
        if (
          !settings[CHALLENGE_SETTING[period]] ||
          (config.activationAt ?? Infinity) > (prepare ? window.opensAt : now)
        )
          return { action: "no-change", result: null };
        if ((prepare ? config.preparedId : config.currentId) !== candidateId)
          return { action: "no-change", result: null };
        const template =
          config.pending && config.pending.effectiveAt <= window.opensAt
            ? config.pending
            : config.active;
        const candidate = candidateId
          ? readCompetitionInstance(
              values.get(competitionInstanceKey(candidateId)),
            )
          : null;
        if (
          candidate &&
          !candidate.superseded &&
          candidate.endsAt === window.endsAt &&
          (!prepare || candidate.templateRevision === template.revision)
        )
          return { action: "no-change", result: null };
        const target = `${window.opensAt}:${template.revision}`;
        const prior =
          config[generationField]?.target === target
            ? config[generationField]
            : null;
        if (
          prior &&
          prior.attempts >= 3 &&
          prior.leaseUntil <= now &&
          !config.generationError
        ) {
          config.generationError =
            "Generation did not finish after three attempts. Apply settings again to retry.";
          return {
            action: "commit",
            writes: [jsonWrite(COMPETITION_STATE_KEY, state)],
            result: null,
          };
        }
        if (prior && (prior.attempts >= 3 || prior.leaseUntil > now))
          return { action: "no-change", result: null };
        config[generationField] = {
          target,
          attempts: (prior?.attempts ?? 0) + 1,
          token,
          leaseUntil: now + COMPETITION_LEASE_MS,
          error: null,
        };
        return {
          action: "commit",
          writes: [jsonWrite(COMPETITION_STATE_KEY, state)],
          result: { window, template, target },
        };
      });
      if (!claim) return;
      let certified: CertifiedChallenge;
      try {
        certified = this.generate(claim.template.options, this.newId());
      } catch (error) {
        await redisCas(this.redis, COMPETITION_STATE_KEY, (raw) => {
          const state = readCompetitionState(raw);
          const config = state.periods[period];
          if (config[generationField]?.token !== token)
            return { action: "no-change", result: undefined };
          config[generationField]!.leaseUntil = 0;
          config[generationField]!.error = generationMessage(error);
          config.generationError = generationMessage(error);
          return {
            action: "set",
            value: JSON.stringify(state),
            result: undefined,
          };
        });
        continue;
      }
      const id = this.newId();
      const publishingState = readCompetitionState(
        await this.redis.get(COMPETITION_STATE_KEY),
      );
      const publishingCurrentId = publishingState.periods[period].currentId;
      await redisMultiCas(
        this.redis,
        [
          COMPETITION_STATE_KEY,
          SUBREDDIT_SETTINGS_KEY,
          competitionInstanceKey(id),
          ...(publishingCurrentId
            ? [competitionInstanceKey(publishingCurrentId)]
            : []),
        ],
        (values) => {
          const state = readCompetitionState(values.get(COMPETITION_STATE_KEY));
          const config = state.periods[period];
          const settings = parseSubredditSettings(
            values.get(SUBREDDIT_SETTINGS_KEY),
          );
          const now = this.now();
          const template =
            config.pending && config.pending.effectiveAt <= claim.window.opensAt
              ? config.pending
              : config.active;
          if (config.currentId !== publishingCurrentId)
            return { action: "no-change", result: undefined };
          const running = publishingCurrentId
            ? readCompetitionInstance(
                values.get(competitionInstanceKey(publishingCurrentId)),
              )
            : null;
          // Delayed preparation must never replace a board already opened by another worker.
          if (
            running &&
            !running.superseded &&
            running.endsAt === claim.window.endsAt
          )
            return { action: "no-change", result: undefined };
          if (
            config[generationField]?.token !== token ||
            template.revision !== claim.template.revision ||
            claim.window.endsAt <= now ||
            !settings[CHALLENGE_SETTING[period]]
          )
            return { action: "no-change", result: undefined };
          const instance: CompetitionInstance = {
            id,
            period,
            ...claim.window,
            templateRevision: template.revision,
            certified,
            superseded: false,
            settled: false,
            completionOrder: 0,
            leader: null,
            rankingVersion: 2,
          };
          if (prepare && claim.window.opensAt > now) config.preparedId = id;
          else {
            config.currentId = id;
            state.settlementQueue.push({ id, endsAt: instance.endsAt });
          }
          config[generationField] = null;
          config.generationError = null;
          return {
            action: "commit",
            writes: [
              jsonWrite(COMPETITION_STATE_KEY, state),
              jsonWrite(
                competitionInstanceKey(id),
                instance,
                prepare && claim.window.opensAt > now
                  ? new Date(instance.endsAt + COMPETITION_DETAILS_TTL)
                  : undefined,
              ),
            ],
            result: undefined,
          };
        },
      );
      return;
    }
  }

  private summary(
    instance: CompetitionInstance,
    winner: ChallengeWinner | null,
  ): CompetitionSummary {
    return {
      instanceId: instance.id,
      period: instance.period,
      opensAt: instance.opensAt,
      endsAt: instance.endsAt,
      superseded: instance.superseded,
      winner,
    };
  }

  private async settle(id: string): Promise<void> {
    await ensureCompetitionRanking(this.redis, id, this.now());
    const original = readCompetitionInstance(
      await this.redis.get(competitionInstanceKey(id)),
    );
    const winnerId = original?.leader?.userId;
    const before = readCompetitionState(
      await this.redis.get(COMPETITION_STATE_KEY),
    );
    const previousSummaryId = original
      ? before.periods[original.period].latestSummaryId
      : null;
    const keys = [
      COMPETITION_STATE_KEY,
      competitionInstanceKey(id),
      competitionSummaryKey(id),
      CHALLENGE_RESULTS_KEY,
      ...(previousSummaryId ? [competitionSummaryKey(previousSummaryId)] : []),
      ...(winnerId ? [competitionWinsKey(winnerId)] : []),
    ];
    await redisMultiCas(this.redis, keys, (values) => {
      const state = readCompetitionState(values.get(COMPETITION_STATE_KEY));
      const instance = readCompetitionInstance(
        values.get(competitionInstanceKey(id)),
      );
      if (instance && instance.endsAt > this.now())
        return { action: "no-change", result: undefined };
      if (instance?.leader?.userId !== winnerId)
        throw new ChallengeError(
          "stale",
          "The winner changed before settlement; retry maintenance.",
        );
      state.settlementQueue = state.settlementQueue.filter(
        (entry) => entry.id !== id,
      );
      const writes = [jsonWrite(COMPETITION_STATE_KEY, state)];
      if (
        !instance ||
        instance.settled ||
        values.get(competitionSummaryKey(id))
      )
        return { action: "commit", writes, result: undefined };
      instance.settled = true;
      const config = state.periods[instance.period];
      if (config.latestSummaryId !== previousSummaryId)
        throw new ChallengeError(
          "stale",
          "Settlement changed concurrently; retry maintenance.",
        );
      const previousSummary = previousSummaryId
        ? (parseJson(
            values.get(competitionSummaryKey(previousSummaryId)),
          ) as CompetitionSummary | null)
        : null;
      if (!previousSummary || previousSummary.endsAt < instance.endsAt)
        config.latestSummaryId = id;
      // Refresh the state write after updating the latest finalized result pointer.
      writes[0] = jsonWrite(COMPETITION_STATE_KEY, state);
      let winner: ChallengeWinner | null = null;
      if (!instance.superseded && instance.leader && winnerId) {
        const counts = readWinCounts(values.get(competitionWinsKey(winnerId)));
        counts[instance.period]++;
        winner = {
          username: instance.leader.username,
          ...(instance.preview ? { preview: true } : {}),
          moves: instance.leader.moves,
          squares: instance.leader.squares ?? null,
          elapsedMs: instance.leader.elapsedMs,
          dailyWins: counts.daily,
          weeklyWins: counts.weekly,
          opensAt: instance.opensAt,
          endsAt: instance.endsAt,
          instanceId: instance.id,
        };
        writes.push(jsonWrite(competitionWinsKey(winnerId), counts));
        const spotlights = readChallengeSpotlights(
          parseJson(values.get(CHALLENGE_RESULTS_KEY)),
        );
        const prior = spotlights[instance.period];
        if (!prior?.endsAt || prior.endsAt < instance.endsAt) {
          writes.push(
            jsonWrite(CHALLENGE_RESULTS_KEY, {
              ...spotlights,
              preview: false,
              [instance.period]: winner,
            }),
          );
        }
      }
      writes.push(
        jsonWrite(
          competitionInstanceKey(id),
          instance,
          new Date(instance.endsAt + COMPETITION_DETAILS_TTL),
        ),
        jsonWrite(competitionSummaryKey(id), this.summary(instance, winner)),
      );
      return { action: "commit", writes, result: undefined };
    });
  }
}
function generationMessage(error: unknown): string {
  return error instanceof ChallengeError
    ? error.message
    : "A certified puzzle could not be generated after three attempts. Try simpler settings and apply again.";
}
