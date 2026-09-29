import { createHash, randomUUID } from "node:crypto";
import {
  ChallengeError,
  MAX_COMMAND_ID_LENGTH,
  readChallengeSnapshot,
  placeChallengePoint,
  type ChallengeSnapshot,
} from "../shared/challenge";
import {
  byPeriod,
  CHALLENGE_SETTING,
  type ChallengePeriod,
} from "../shared/challenge-spotlights";
import type {
  CompetitionAvailability,
  CompetitionAvailabilityResponse,
  CompetitionCommand,
  CompetitionResult,
  CompetitionStanding,
  CompetitionStandingsResponse,
  CompetitionStateResponse,
  CompetitionSummary,
} from "../shared/competitions";
import { compareCompetitionResults } from "../shared/competitions";
import { isCanonicalIdentifier, isCount, isRecord } from "../shared/guards";
import { type SubredditSettings } from "../shared/subreddit-settings";
import {
  COMPETITION_DETAILS_TTL,
  COMPETITION_STATE_KEY,
  competitionInstanceKey,
  competitionSummaryKey,
  competitionWindow,
  readCompetitionInstance,
  readStoredCompetitionResult,
  readCompetitionState,
  type CompetitionConfig,
  type CompetitionInstance,
  type StoredCompetitionResult,
} from "./competition-model";
import {
  competitionRedisCas,
  type CompetitionRedisClient,
  type CompetitionWrite,
} from "./competition-redis";
import { reserveWindowBudget } from "./request-limits";
import { parseJson } from "./stored-json";
import {
  SUBREDDIT_SETTINGS_KEY,
  parseSubredditSettings,
} from "./subreddit-settings";
import {
  competitionAttemptKey,
  competitionAttemptHistoryKey,
  competitionBestKey,
  competitionLeaderboardKey,
  competitionRankMember,
  readCompetitionRankMember,
  withCompetitionRankMember,
} from "./competition-ranking-model";
import { ensureCompetitionRanking } from "./competition-ranking";
import { recoverChallengeWinnerSquares } from "./challenge-results";

export {
  competitionAttemptKey,
  competitionAttemptHistoryKey,
  competitionBestKey,
  competitionLeaderboardKey,
  competitionRankMember,
} from "./competition-ranking-model";

export interface CompetitionIdentity {
  userId: string;
  username: string;
}
export const competitionReceiptKey = (
  id: string,
  userId: string,
  commandId: string,
) =>
  `euclid:competition:receipt:${id}:${encodeURIComponent(userId)}:${encodeURIComponent(commandId)}`;

interface GameplayReceipt {
  fingerprint: string;
  snapshot: ChallengeSnapshot | null;
}
interface GameplayInput extends CompetitionCommand {
  point?: number;
}
type GameplayAction = "start" | "move" | "retry" | "abandon";
export interface CompetitionJourneyAttempt {
  instance: Pick<CompetitionInstance, "id" | "period" | "opensAt" | "endsAt">;
  snapshot: ChallengeSnapshot | null;
  status: "active" | "completed" | "abandoned" | "expired" | "replaced";
}
const gameplayFingerprint = (action: GameplayAction, c: GameplayInput) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        action,
        c.instanceId,
        c.attemptId,
        c.expectedRevision,
        c.point,
      ]),
    )
    .digest("hex");
const readAttempt = (raw: string | null | undefined) =>
  readChallengeSnapshot(parseJson(raw));
const readRankedResult = (raw: string | null | undefined) => {
  const result = readStoredCompetitionResult(raw);
  return result && withCompetitionRankMember(result);
};
const publicResult = (
  best: StoredCompetitionResult | null,
): CompetitionResult | null =>
  best && {
    username: best.username,
    moves: best.moves,
    squares: best.squares ?? null,
    elapsedMs: best.elapsedMs,
    achievedAt: best.achievedAt,
  };

function command(input: unknown): GameplayInput {
  const identifier = (value: unknown) =>
    isCanonicalIdentifier(value) && value.length <= MAX_COMMAND_ID_LENGTH;
  if (
    !isRecord(input) ||
    !identifier(input.commandId) ||
    !identifier(input.instanceId) ||
    (input.attemptId !== null && !identifier(input.attemptId)) ||
    !isCount(input.expectedRevision)
  )
    throw new ChallengeError(
      "invalid",
      "Send the current challenge, attempt, revision, and a command identifier.",
    );
  return input as unknown as GameplayInput;
}

function standing(member: string, rank: number): CompetitionStanding {
  const result = readCompetitionRankMember(member);
  if (!result) throw new Error("Unreadable competition ranking entry.");
  return { rank, ...publicResult(result)! };
}
function availability(
  period: ChallengePeriod,
  config: CompetitionConfig,
  instance: CompetitionInstance | null,
  settings: SubredditSettings,
  now: number,
): CompetitionAvailability {
  const enabled = settings[CHALLENGE_SETTING[period]] === true;
  const window = competitionWindow(period, now);
  const usable =
    instance &&
    !instance.superseded &&
    !instance.settled &&
    now < instance.endsAt;
  const opensAt = usable
    ? instance.opensAt
    : Math.max(window.opensAt, config.activationAt ?? window.endsAt);
  const endsAt = usable
    ? instance.endsAt
    : competitionWindow(period, opensAt).endsAt;
  return {
    period,
    enabled,
    status: !enabled
      ? "disabled"
      : usable && now >= instance.opensAt
        ? "open"
        : now < opensAt
          ? "scheduled"
          : "unavailable",
    instanceId:
      enabled && usable && now >= instance.opensAt ? instance.id : null,
    opensAt,
    endsAt,
    showStandings: settings.showLiveChallengeStandings,
  };
}

/** Public competition play uses trusted request identity, with all rules checked inside CAS retries. */
export class CompetitionGameplay {
  private readonly now: () => number;
  private readonly newId: () => string;
  constructor(
    private readonly redis: CompetitionRedisClient,
    options: { now?: () => number; newId?: () => string } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? randomUUID;
  }

  /** Exact owner/attempt observation, including archives, with no gameplay writes. */
  async getJourneyAttempt(
    period: ChallengePeriod,
    userId: string,
    ref: {
      instanceId: string;
      attemptId: string;
      abandonCommandId?: string;
      abandonExpectedRevision?: number;
    },
  ): Promise<CompetitionJourneyAttempt | null> {
    if (
      !isCanonicalIdentifier(userId) ||
      ![ref.instanceId, ref.attemptId].every(
        (id) => isCanonicalIdentifier(id) && id.length <= MAX_COMMAND_ID_LENGTH,
      )
    )
      throw new ChallengeError(
        "invalid",
        "Invalid challenge activity identifiers.",
      );
    const abandonment =
      ref.abandonCommandId === undefined
        ? null
        : command({
            instanceId: ref.instanceId,
            attemptId: ref.attemptId,
            commandId: ref.abandonCommandId,
            expectedRevision: ref.abandonExpectedRevision,
          });
    const [instanceRaw, currentRaw, archivedRaw, lifecycleRaw, receiptRaw] =
      await Promise.all([
        this.redis.get(competitionInstanceKey(ref.instanceId)),
        this.redis.get(competitionAttemptKey(ref.instanceId, userId)),
        this.redis.get(
          competitionAttemptHistoryKey(ref.instanceId, userId, ref.attemptId),
        ),
        this.redis.get(COMPETITION_STATE_KEY),
        abandonment
          ? this.redis.get(
              competitionReceiptKey(
                ref.instanceId,
                userId,
                abandonment.commandId,
              ),
            )
          : undefined,
      ]);
    const instance = readCompetitionInstance(instanceRaw);
    if (
      !instance ||
      instance.id !== ref.instanceId ||
      instance.period !== period
    )
      return null;
    const current = readAttempt(currentRaw);
    const candidate =
      current?.attemptId === ref.attemptId ? current : readAttempt(archivedRaw);
    const snapshot =
      candidate?.attemptId === ref.attemptId &&
      candidate.puzzleId === ref.instanceId
        ? candidate
        : null;
    const receipt: unknown = parseJson(receiptRaw);
    const abandoned =
      abandonment &&
      isRecord(receipt) &&
      receipt.snapshot === null &&
      receipt.fingerprint === gameplayFingerprint("abandon", abandonment);
    if (!snapshot && !abandoned) return null;
    const status: CompetitionJourneyAttempt["status"] = snapshot?.complete
      ? "completed"
      : abandoned
        ? "abandoned"
        : instance.superseded ||
            readCompetitionState(lifecycleRaw).periods[period].currentId !==
              instance.id ||
            current?.attemptId !== ref.attemptId
          ? "replaced"
          : instance.settled || this.now() >= instance.endsAt
            ? "expired"
            : "active";
    return {
      instance: {
        id: instance.id,
        period: instance.period,
        opensAt: instance.opensAt,
        endsAt: instance.endsAt,
      },
      snapshot,
      status,
    };
  }

  async availability(): Promise<CompetitionAvailabilityResponse> {
    const [stateRaw, settingsRaw] = await Promise.all([
      this.redis.get(COMPETITION_STATE_KEY),
      this.redis.get(SUBREDDIT_SETTINGS_KEY),
    ]);
    const state = readCompetitionState(stateRaw),
      settings = parseSubredditSettings(settingsRaw);
    const instances = byPeriod(() => null as CompetitionInstance | null);
    await Promise.all(
      Object.entries(state.periods).map(async ([period, config]) => {
        if (config.currentId)
          instances[period as ChallengePeriod] = readCompetitionInstance(
            await this.redis.get(competitionInstanceKey(config.currentId)),
          );
      }),
    );
    const serverNow = this.now();
    return {
      competitions: byPeriod((period) =>
        availability(
          period,
          state.periods[period],
          instances[period],
          settings,
          serverNow,
        ),
      ),
      serverNow,
    };
  }

  async state(
    period: ChallengePeriod,
    identity: CompetitionIdentity | null,
  ): Promise<CompetitionStateResponse> {
    const config = readCompetitionState(
      await this.redis.get(COMPETITION_STATE_KEY),
    ).periods[period];
    const id = config.currentId;
    if (id) await ensureCompetitionRanking(this.redis, id, this.now());
    const [instanceRaw, attemptRaw, bestRaw] = id
      ? await Promise.all([
          this.redis.get(competitionInstanceKey(id)),
          identity
            ? this.redis.get(competitionAttemptKey(id, identity.userId))
            : undefined,
          identity
            ? this.redis.get(competitionBestKey(id, identity.userId))
            : undefined,
        ])
      : [undefined, undefined, undefined];
    const instance = readCompetitionInstance(instanceRaw),
      best = readRankedResult(bestRaw);
    return this.response(
      period,
      config,
      instance,
      readAttempt(attemptRaw),
      best,
      !!identity,
    );
  }

  async standings(
    period: ChallengePeriod,
    offset = 0,
  ): Promise<CompetitionStandingsResponse> {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000)
      throw new ChallengeError("invalid", "Choose a valid standings page.");
    const { competitions, serverNow } = await this.availability();
    const info = competitions[period];
    const visible = info.status === "open" && info.showStandings;
    if (!visible || !info.instanceId)
      return {
        instanceId: info.instanceId,
        visible: false,
        standings: [],
        offset,
        hasMore: false,
        serverNow,
      };
    await ensureCompetitionRanking(this.redis, info.instanceId, this.now());
    const entries = await this.redis.zRange(
      competitionLeaderboardKey(info.instanceId),
      offset,
      offset + 20,
    );
    // Honor a visibility change that raced the sorted-set read.
    const [settingsRaw, stateRaw] = await Promise.all([
      this.redis.get(SUBREDDIT_SETTINGS_KEY),
      this.redis.get(COMPETITION_STATE_KEY),
    ]);
    const current = parseSubredditSettings(settingsRaw);
    if (
      !current.showLiveChallengeStandings ||
      current[CHALLENGE_SETTING[period]] !== true ||
      readCompetitionState(stateRaw).periods[period].currentId !==
        info.instanceId ||
      this.now() >= info.endsAt
    )
      return {
        instanceId: info.instanceId,
        visible: false,
        standings: [],
        offset,
        hasMore: false,
        serverNow: this.now(),
      };
    return {
      instanceId: info.instanceId,
      visible: true,
      standings: entries
        .slice(0, 20)
        .map((entry, i) => standing(entry.member, offset + i + 1)),
      offset,
      hasMore: entries.length > 20,
      serverNow: this.now(),
    };
  }

  async mutate(
    period: ChallengePeriod,
    identity: CompetitionIdentity,
    action: GameplayAction,
    input: unknown,
  ): Promise<CompetitionStateResponse> {
    if (!identity.userId || !identity.username)
      throw new ChallengeError("forbidden", "Sign in to play challenges.");
    const c = command(input);
    const fingerprint = gameplayFingerprint(action, c);
    const instanceKey = competitionInstanceKey(c.instanceId),
      attemptKey = competitionAttemptKey(c.instanceId, identity.userId),
      bestKey = competitionBestKey(c.instanceId, identity.userId),
      receiptKey = competitionReceiptKey(
        c.instanceId,
        identity.userId,
        c.commandId,
      ),
      leaderboardKey = competitionLeaderboardKey(c.instanceId);
    await reserveWindowBudget(
      this.redis,
      `euclid:competition:budget:${encodeURIComponent(identity.userId)}`,
      120,
      60_000,
      this.now(),
    );
    await ensureCompetitionRanking(this.redis, c.instanceId, this.now());
    const attemptId = this.newId();
    const historyKey = c.attemptId
      ? competitionAttemptHistoryKey(c.instanceId, identity.userId, c.attemptId)
      : null;
    const accepted = await competitionRedisCas(
      this.redis,
      [
        COMPETITION_STATE_KEY,
        SUBREDDIT_SETTINGS_KEY,
        instanceKey,
        attemptKey,
        bestKey,
        receiptKey,
        ...(historyKey ? [historyKey] : []),
      ],
      [leaderboardKey],
      (values) => {
        const now = this.now(),
          config = readCompetitionState(values.get(COMPETITION_STATE_KEY))
            .periods[period],
          settings = parseSubredditSettings(values.get(SUBREDDIT_SETTINGS_KEY));
        const instance = readCompetitionInstance(values.get(instanceKey));
        if (
          action !== "abandon" &&
          settings[CHALLENGE_SETTING[period]] !== true
        )
          throw new ChallengeError("forbidden", "This challenge is disabled.");
        if (
          !instance ||
          instance.period !== period ||
          config.currentId !== c.instanceId ||
          instance.superseded
        )
          throw new ChallengeError(
            "stale",
            "This challenge has changed. Refresh to load its current board.",
          );
        if (
          action !== "abandon" &&
          (instance.settled || now >= instance.endsAt)
        )
          throw new ChallengeError("expired", "This challenge has closed.");
        if (action !== "abandon" && now < instance.opensAt)
          throw new ChallengeError(
            "unavailable",
            "This challenge has not opened yet.",
          );
        const best = readRankedResult(values.get(bestKey));
        const previous = readAttempt(values.get(attemptKey));
        const receipt = parseJson(values.get(receiptKey)) as
          | GameplayReceipt
          | undefined;
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            throw new ChallengeError(
              "stale",
              "This command identifier was already used for a different request.",
            );
          // Receipts may outlive an attempt; replay must not restore its board.
          if (
            (action === "abandon" && previous) ||
            (action !== "abandon" &&
              (!previous || previous.attemptId !== receipt.snapshot?.attemptId))
          )
            throw new ChallengeError(
              "stale",
              "Your attempt changed in another request or tab. Refresh to continue.",
            );
          return {
            action: "no-change",
            result: {
              snapshot: receipt.snapshot,
              best,
              instance,
              config,
              settings,
            },
          };
        }
        if (
          (previous &&
            (previous.attemptId !== c.attemptId ||
              previous.revision !== c.expectedRevision)) ||
          (!previous && (c.attemptId !== null || c.expectedRevision !== 0))
        )
          throw new ChallengeError(
            "stale",
            "Your attempt changed in another request or tab. Refresh to continue.",
          );
        if (!previous && action !== "start")
          throw new ChallengeError("invalid", "Start this challenge first.");
        const expiration = new Date(instance.endsAt + COMPETITION_DETAILS_TTL);
        if (action === "abandon") {
          const writes: CompetitionWrite[] = [
            { action: "delete", key: attemptKey },
            {
              action: "set",
              key: receiptKey,
              value: JSON.stringify({
                fingerprint,
                snapshot: null,
              } satisfies GameplayReceipt),
              expiration,
            },
          ];
          if (historyKey && !readAttempt(values.get(historyKey))?.complete)
            writes.push({ action: "delete", key: historyKey });
          return {
            action: "commit",
            writes,
            result: { snapshot: null, best, instance, config, settings },
          };
        }
        let snapshot: ChallengeSnapshot;
        if (action === "start" && previous) snapshot = previous;
        else if (action === "start" || action === "retry")
          snapshot = {
            puzzleId: instance.id,
            attemptId,
            revision: (previous?.revision ?? 0) + 1,
            puzzle: instance.certified.puzzle,
            placements: [],
            completedSquares: [],
            complete: false,
            bestMoves: best?.moves ?? null,
            bestElapsedMs: best?.elapsedMs ?? null,
            startedAt: now,
            finishedAt: null,
            elapsedMs: 0,
          };
        else snapshot = placeChallengePoint(previous!, c.point as number, now);
        const writes: CompetitionWrite[] = [];
        if (
          historyKey &&
          previous &&
          (action === "retry" || (action === "move" && snapshot.complete))
        ) {
          writes.push({
            action: "set",
            key: historyKey,
            value: JSON.stringify(action === "retry" ? previous : snapshot),
            expiration,
          });
        }
        let nextBest = best;
        if (action === "move" && snapshot.complete) {
          instance.completionOrder += 1;
          if (!Number.isSafeInteger(instance.completionOrder))
            throw new Error("Competition completion sequence exhausted.");
          const result = {
            userId: identity.userId,
            username: identity.username,
            attemptId: snapshot.attemptId,
            moves: snapshot.placements.length,
            squares: snapshot.completedSquares.length,
            elapsedMs: snapshot.elapsedMs,
            achievedAt: now,
            order: instance.completionOrder,
          };
          if (!best || compareCompetitionResults(result, best) < 0) {
            nextBest = { ...result, member: competitionRankMember(result) };
            if (best)
              writes.push({
                action: "z-remove",
                key: leaderboardKey,
                member: best.member,
              });
            writes.push(
              {
                action: "z-add",
                key: leaderboardKey,
                member: nextBest.member,
                score: 0,
              },
              {
                action: "expire",
                key: leaderboardKey,
                seconds: Math.max(
                  1,
                  Math.ceil((expiration.getTime() - now) / 1000),
                ),
              },
              {
                action: "set",
                key: bestKey,
                value: JSON.stringify(nextBest),
                expiration,
              },
            );
            if (!instance.leader || nextBest.member < instance.leader.member)
              instance.leader = nextBest;
          }
          writes.push({
            action: "set",
            key: instanceKey,
            value: JSON.stringify(instance),
          });
        }
        snapshot = {
          ...snapshot,
          bestMoves: nextBest?.moves ?? null,
          bestElapsedMs: nextBest?.elapsedMs ?? null,
        };
        writes.push(
          {
            action: "set",
            key: attemptKey,
            value: JSON.stringify(snapshot),
            expiration,
          },
          {
            action: "set",
            key: receiptKey,
            value: JSON.stringify({
              fingerprint,
              snapshot,
            } satisfies GameplayReceipt),
            expiration,
          },
        );
        return {
          action: "commit",
          writes,
          result: { snapshot, best: nextBest, instance, config, settings },
        };
      },
    );
    return this.response(
      period,
      accepted.config,
      accepted.instance,
      accepted.snapshot,
      accepted.best,
      true,
    );
  }

  private async response(
    period: ChallengePeriod,
    config: CompetitionConfig,
    instance: CompetitionInstance | null,
    snapshot: ChallengeSnapshot | null,
    best: StoredCompetitionResult | null,
    authenticated: boolean,
  ): Promise<CompetitionStateResponse> {
    const latestResult = config.latestSummaryId
      ? ((parseJson(
          await this.redis.get(competitionSummaryKey(config.latestSummaryId)),
        ) as CompetitionSummary | undefined) ?? null)
      : null;
    if (latestResult)
      latestResult.winner = await recoverChallengeWinnerSquares(
        this.redis,
        latestResult.winner,
      );
    let settings = parseSubredditSettings(
      await this.redis.get(SUBREDDIT_SETTINGS_KEY),
    );
    const info = availability(period, config, instance, settings, this.now());
    let rank: number | undefined;
    if (
      info.status === "open" &&
      settings.showLiveChallengeStandings &&
      best &&
      instance
    ) {
      rank = await this.redis.zRank(
        competitionLeaderboardKey(instance.id),
        best.member,
      );
      // A moderator may hide standings while the rank lookup is in flight.
      settings = parseSubredditSettings(
        await this.redis.get(SUBREDDIT_SETTINGS_KEY),
      );
    }
    const serverNow = this.now(),
      competition = availability(period, config, instance, settings, serverNow);
    return {
      competition,
      snapshot:
        competition.status === "open" ? this.withElapsed(snapshot, best) : null,
      authenticated,
      latestResult: competition.enabled ? latestResult : null,
      personalBest: publicResult(best),
      personalRank:
        competition.status === "open" &&
        settings.showLiveChallengeStandings &&
        rank !== undefined
          ? rank + 1
          : null,
      serverNow,
    };
  }

  private withElapsed(
    snapshot: ChallengeSnapshot | null,
    best: StoredCompetitionResult | null,
  ): ChallengeSnapshot | null {
    return (
      snapshot && {
        ...snapshot,
        bestMoves: best?.moves ?? null,
        bestElapsedMs: best?.elapsedMs ?? null,
        elapsedMs: Math.max(
          0,
          (snapshot.finishedAt ?? this.now()) - snapshot.startedAt,
        ),
      }
    );
  }
}
