import type {
  CompetitionRedisClient,
  CompetitionRedisTransaction,
  CompetitionWrite,
} from "../competition-redis";

/** Redis test double with real string/set type separation, CAS conflicts, and TTLs. */
export class CompetitionMemoryRedis implements CompetitionRedisClient {
  readonly values = new Map<string, string>();
  readonly sorted = new Map<string, Map<string, number>>();
  readonly reads: string[] = [];
  readonly commits: CompetitionWrite[][] = [];
  readonly watches: string[][] = [];
  readonly expires = new Map<string, number>();
  private readonly versions = new Map<string, number>();
  beforeExec:
    | ((writes: readonly CompetitionWrite[]) => void | Promise<void>)
    | undefined;
  constructor(private readonly now: () => number = Date.now) {}

  seed(key: string, value: string): void {
    this.sorted.delete(key);
    this.values.set(key, value);
    this.expires.delete(key);
    this.bump(key);
  }
  externalSet(key: string, value: string): void {
    this.seed(key, value);
  }
  externalDelete(key: string): void {
    this.values.delete(key);
    this.sorted.delete(key);
    this.expires.delete(key);
    this.bump(key);
  }
  value(key: string): string | undefined {
    this.expireKey(key);
    return this.values.get(key);
  }
  json<T>(key: string): T | undefined {
    const value = this.value(key);
    return value ? (JSON.parse(value) as T) : undefined;
  }
  keys(): string[] {
    return [...this.values.keys(), ...this.sorted.keys()];
  }
  version(key: string): number {
    this.expireKey(key);
    return this.versions.get(key) ?? 0;
  }
  private bump(key: string): void {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
  }
  private expireKey(key: string): void {
    if ((this.expires.get(key) ?? Infinity) <= this.now())
      this.externalDelete(key);
  }
  async get(key: string): Promise<string | undefined> {
    this.reads.push(key);
    this.expireKey(key);
    if (this.sorted.has(key)) throw new Error("WRONGTYPE GET on sorted set");
    return this.values.get(key);
  }
  async set(
    key: string,
    value: string,
    options?: { expiration: Date },
  ): Promise<string> {
    this.commit([{ action: "set", key, value, ...options }]);
    return "OK";
  }
  async zRange(
    key: string,
    start: number,
    stop: number,
  ): Promise<{ member: string; score: number }[]> {
    this.expireKey(key);
    if (this.values.has(key)) throw new Error("WRONGTYPE ZRANGE on string");
    const all = [...(this.sorted.get(key) ?? [])]
      .map(([member, score]) => ({ member, score }))
      .sort(
        (a, b) =>
          a.score - b.score ||
          (a.member < b.member ? -1 : a.member > b.member ? 1 : 0),
      );
    return all.slice(
      start < 0 ? all.length + start : start,
      stop < 0 ? all.length + stop + 1 : stop + 1,
    );
  }
  async zRank(key: string, member: string): Promise<number | undefined> {
    const rank = (await this.zRange(key, 0, -1)).findIndex(
      (entry) => entry.member === member,
    );
    return rank < 0 ? undefined : rank;
  }
  async watch(...keys: string[]): Promise<CompetitionRedisTransaction> {
    this.watches.push(keys);
    const watched = new Map(keys.map((key) => [key, this.version(key)]));
    const writes: CompetitionWrite[] = [];
    let multi = false,
      closed = false;
    const queue = (write: CompetitionWrite) => {
      if (!multi || closed) throw new Error("Transaction is not queueing.");
      writes.push(write);
    };
    return {
      multi: async () => {
        if (closed) throw new Error("Closed transaction");
        multi = true;
      },
      set: async (key, value, options) => {
        queue({ action: "set", key, value, ...options });
      },
      del: async (...targets) => {
        targets.forEach((key) => queue({ action: "delete", key }));
      },
      zAdd: async (key, ...members) => {
        members.forEach((entry) => queue({ action: "z-add", key, ...entry }));
      },
      zRem: async (key, members) => {
        members.forEach((member) => queue({ action: "z-remove", key, member }));
      },
      expire: async (key, seconds) => {
        queue({ action: "expire", key, seconds });
      },
      exec: async () => {
        if (!multi || closed) throw new Error("Transaction is not queueing.");
        await this.beforeExec?.(writes);
        closed = true;
        if (
          [...watched].some(([key, version]) => this.version(key) !== version)
        )
          return null;
        this.commit(writes);
        return writes.map(() => "OK");
      },
      discard: async () => {
        closed = true;
      },
      unwatch: async () => {
        closed = true;
      },
    };
  }
  private commit(writes: readonly CompetitionWrite[]): void {
    for (const write of writes) {
      switch (write.action) {
        case "set":
          this.values.set(write.key, write.value);
          this.sorted.delete(write.key);
          this.expires.delete(write.key);
          if (write.expiration)
            this.expires.set(write.key, write.expiration.getTime());
          break;
        case "delete":
          this.values.delete(write.key);
          this.sorted.delete(write.key);
          this.expires.delete(write.key);
          break;
        case "z-add": {
          if (this.values.has(write.key))
            throw new Error("WRONGTYPE ZADD on string");
          const entries =
            this.sorted.get(write.key) ?? new Map<string, number>();
          entries.set(write.member, write.score);
          this.sorted.set(write.key, entries);
          break;
        }
        case "z-remove":
          this.sorted.get(write.key)?.delete(write.member);
          break;
        case "expire":
          this.expires.set(write.key, this.now() + write.seconds * 1000);
          break;
      }
      this.bump(write.key);
    }
    this.commits.push(writes.map((write) => ({ ...write })));
  }
}
