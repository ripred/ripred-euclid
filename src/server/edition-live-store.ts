import type { SetOptions, ZRangeOptions } from "@devvit/redis";
import type {
  EditionDefinition,
  EditionState,
  LiveEditionGame,
} from "../shared/edition-contract";
import {
  editionLiveSummary,
  editionWatchSnapshot,
  isEditionGameId,
  LIVE_IDLE_MS,
  LIVE_LIST_LIMIT,
  WATCH_RETENTION_MS,
} from "../shared/edition-live";
import {
  reconcileEditionSession,
  type EditionSession,
} from "../shared/edition-session";

interface LiveRedis {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string, options?: SetOptions): Promise<unknown>;
  zAdd(
    key: string,
    ...members: { member: string; score: number }[]
  ): Promise<unknown>;
  zRange(
    key: string,
    start: number,
    stop: number,
    options: ZRangeOptions,
  ): Promise<{ member: string; score: number }[]>;
  zRemRangeByScore(key: string, min: number, max: number): Promise<unknown>;
  zRem(key: string, members: string[]): Promise<unknown>;
}

/** Existing owner keys remain unchanged so previously saved games still resume. */
export const editionOwnerKey = (editionId: string, userId: string) =>
  `euclid:edition:${editionId}:v1:${userId}`;

export function createEditionLiveStore<T extends EditionState>(
  definition: EditionDefinition<T>,
  redis: LiveRedis,
) {
  const prefix = `euclid:edition:${definition.id}:spectators:v1`;
  const indexKey = `${prefix}:live`;
  const ownerKey = (id: string) => `${prefix}:owner:${id}`;

  async function watch(id: string, now: number) {
    if (!isEditionGameId(id)) return null;
    const owner = await redis.get(ownerKey(id));
    if (!owner) return null;
    const raw = await redis.get(editionOwnerKey(definition.id, owner));
    const current = raw ? (JSON.parse(raw) as EditionSession<T>) : null;
    // Index entries are hints, never permission grants. Always check the owner.
    const session = reconcileEditionSession(definition, current);
    return editionWatchSnapshot(definition, session, id, now);
  }

  return {
    watch,
    async list(now: number): Promise<LiveEditionGame[]> {
      const games = new Map<string, LiveEditionGame>();
      // Page past stale restart/index entries instead of letting them hide an
      // older live game. Each read is bounded; stop after 50 valid recent games.
      const pageSize = 200;
      for (let offset = 0; games.size < LIVE_LIST_LIMIT; offset += pageSize) {
        const candidates = await redis.zRange(
          indexKey,
          offset,
          offset + pageSize - 1,
          {
            by: "rank",
            reverse: true,
          },
        );
        const recent = candidates.filter(
          ({ score }) => score > now - LIVE_IDLE_MS,
        );
        const page = await Promise.all(
          recent.map(async ({ member }) =>
            editionLiveSummary(await watch(member, now), now),
          ),
        );
        for (const game of page) if (game) games.set(game.id, game);
        if (candidates.length < pageSize || recent.length < candidates.length)
          break;
      }
      return [...games.values()]
        .sort(
          (left, right) =>
            right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
        )
        .slice(0, LIVE_LIST_LIMIT);
    },
    async publish(
      owner: string,
      session: EditionSession<T>,
      now: number,
    ): Promise<void> {
      await redis.zRemRangeByScore(indexKey, 0, now - LIVE_IDLE_MS);
      const snapshot = editionWatchSnapshot(
        definition,
        session,
        session.id,
        now,
      );
      if (!snapshot) {
        await redis.zRem(indexKey, [session.id]);
        return;
      }
      const updatedAt = snapshot.updatedAt;
      await redis.set(ownerKey(session.id), owner, {
        expiration: new Date(updatedAt + WATCH_RETENTION_MS),
      });
      if (editionLiveSummary(snapshot, now))
        await redis.zAdd(indexKey, { member: session.id, score: updatedAt });
      else await redis.zRem(indexKey, [session.id]);
    },
  };
}
