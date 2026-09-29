import { createHash, randomUUID } from "node:crypto";
import {
  ChallengeError,
  MAX_COMMAND_ID_LENGTH,
  placeChallengePoint,
  readChallengeSnapshot,
  type ChallengeCommand,
  type ChallengeSnapshot,
} from "../shared/challenge";
import {
  generateChallenge,
  readCertifiedChallenge,
  type CertifiedChallenge,
} from "./challenge-generator";
import { parseJson } from "./stored-json";
import { isCount, isRecord } from "../shared/guards";
import { redisCas, type RedisCasClient } from "./redis-cas";
import { reserveWindowBudget } from "./request-limits";

export const CHALLENGE_RETENTION_MS = 2 * 60 * 60 * 1000;
export const challengeSessionKey = (userId: string) =>
  `euclid:challenge-lab:v1:${userId}`;
interface StoredChallenge {
  snapshot: ChallengeSnapshot;
  certification: CertifiedChallenge;
  lastCommand: string;
  fingerprint: string;
}

/** A saved playground session; unreadable sessions count as none. */
export function readStoredChallenge(
  raw: string | null | undefined,
): StoredChallenge | null {
  const value = parseJson(raw);
  return isRecord(value) &&
    readChallengeSnapshot(value.snapshot) !== null &&
    readCertifiedChallenge(value.certification) !== null &&
    typeof value.lastCommand === "string" &&
    typeof value.fingerprint === "string"
    ? (value as unknown as StoredChallenge)
    : null;
}

/** A non-empty identifier within the command length limit. */
const isCommandId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_COMMAND_ID_LENGTH;

function command(value: unknown): ChallengeCommand & Record<string, unknown> {
  if (!isRecord(value))
    throw new ChallengeError("invalid", "A command is required.");
  if (!isCommandId(value.commandId) || !isCount(value.expectedRevision))
    throw new ChallengeError("invalid", "Invalid command or revision.");
  for (const id of [value.puzzleId, value.attemptId])
    if (id !== null && !isCommandId(id))
      throw new ChallengeError(
        "invalid",
        "Invalid puzzle or attempt identifier.",
      );
  return value as ChallengeCommand & Record<string, unknown>;
}

function matches(current: StoredChallenge | null, c: ChallengeCommand) {
  if (!current) {
    if (c.expectedRevision !== 0 || c.puzzleId !== null || c.attemptId !== null)
      throw new ChallengeError(
        "expired",
        "This playground session ended. Generate a new puzzle.",
      );
  } else if (
    current.snapshot.revision !== c.expectedRevision ||
    current.snapshot.puzzleId !== c.puzzleId ||
    current.snapshot.attemptId !== c.attemptId
  ) {
    throw new ChallengeError(
      "stale",
      "This puzzle changed in another request or tab. Its current state has been refreshed.",
    );
  }
}

export class ChallengeStore {
  constructor(
    private readonly redis: RedisCasClient,
    private readonly now = Date.now,
    private readonly newId: () => string = randomUUID,
  ) {}

  async state(userId: string): Promise<ChallengeSnapshot | null> {
    const stored = readStoredChallenge(
      await this.redis.get(challengeSessionKey(userId)),
    );
    return stored ? this.withElapsed(stored.snapshot) : null;
  }

  private withElapsed(snapshot: ChallengeSnapshot): ChallengeSnapshot {
    return {
      ...snapshot,
      elapsedMs: Math.max(
        0,
        (snapshot.finishedAt ?? this.now()) - snapshot.startedAt,
      ),
    };
  }

  async mutate(
    userId: string,
    action: "generate" | "move" | "restart" | "abandon",
    input: unknown,
  ): Promise<ChallengeSnapshot | null> {
    const c = command(input);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([action, c]))
      .digest("hex");
    const key = challengeSessionKey(userId);
    const previous = readStoredChallenge(await this.redis.get(key));
    const duplicate = (current: StoredChallenge | null) => {
      if (current?.lastCommand !== c.commandId) return false;
      if (current.fingerprint !== fingerprint)
        throw new ChallengeError(
          "stale",
          "This command was already used for a different request.",
        );
      return true;
    };
    if (duplicate(previous)) return this.withElapsed(previous!.snapshot);
    if (action === "abandon" && !previous) return null;
    matches(previous, c);
    if (!previous && action !== "generate")
      throw new ChallengeError("expired", "Generate a puzzle first.");
    await reserveWindowBudget(
      this.redis,
      `${key}:budget:${action === "generate" ? "generation" : "play"}`,
      action === "generate" ? 20 : 120,
      60_000,
      this.now(),
    );
    // Expensive certification is performed once, outside any retried transaction.
    const certification =
      action === "generate" ? generateChallenge(c.options, this.newId()) : null;
    const puzzleId = this.newId(),
      attemptId = this.newId();
    const result = await redisCas(this.redis, key, (stored) => {
      const current = readStoredChallenge(stored);
      if (duplicate(current))
        return { action: "no-change", result: current!.snapshot };
      if (action === "abandon" && !current)
        return { action: "no-change", result: null };
      matches(current, c);
      if (action === "abandon") return { action: "delete", result: null };
      let snapshot: ChallengeSnapshot;
      if (certification) {
        snapshot = {
          puzzleId,
          attemptId,
          revision: (current?.snapshot.revision ?? 0) + 1,
          puzzle: certification.puzzle,
          placements: [],
          completedSquares: [],
          complete: false,
          bestMoves: null,
          bestElapsedMs: null,
          startedAt: this.now(),
          finishedAt: null,
          elapsedMs: 0,
        };
      } else if (action === "restart" && current) {
        snapshot = {
          ...current.snapshot,
          attemptId,
          revision: current.snapshot.revision + 1,
          placements: [],
          completedSquares: [],
          complete: false,
          startedAt: this.now(),
          finishedAt: null,
          elapsedMs: 0,
        };
      } else if (current && action === "move") {
        snapshot = placeChallengePoint(
          current.snapshot,
          c.point as number,
          this.now(),
        );
      } else throw new ChallengeError("expired", "Generate a puzzle first.");
      const state: StoredChallenge = {
        snapshot,
        certification: certification ?? current!.certification,
        lastCommand: c.commandId,
        fingerprint,
      };
      return {
        action: "set",
        value: JSON.stringify(state),
        expiration: new Date(this.now() + CHALLENGE_RETENTION_MS),
        result: snapshot,
      };
    });
    return result ? this.withElapsed(result) : null;
  }
}
