import type {
  RedisCasClient,
  RedisCasTransaction,
  RedisCasWrite,
} from "../redis-cas";
export class MemoryRedis implements RedisCasClient {
  readonly commits: RedisCasWrite[][] = [];
  readonly reads: string[] = [];
  readonly watches: string[][] = [];
  beforeExec:
    | ((writes: readonly RedisCasWrite[]) => void | Promise<void>)
    | undefined;

  private readonly values = new Map<string, string>();
  private readonly versions = new Map<string, number>();
  private readonly expirations = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  seed(key: string, value: string): void {
    this.expirations.delete(key);
    this.values.set(key, value);
    this.bump(key);
  }

  externalSet(key: string, value: string): void {
    this.seed(key, value);
  }

  externalDelete(key: string): void {
    this.values.delete(key);
    this.bump(key);
  }

  value(key: string): string | undefined {
    this.expire(key);
    return this.values.get(key);
  }

  json<T>(key: string): T | undefined {
    const raw = this.value(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  keys(): string[] {
    return [...this.values.keys()];
  }

  clearAccessLog(): void {
    this.reads.length = 0;
    this.watches.length = 0;
  }

  version(key: string): number {
    this.expire(key);
    return this.versions.get(key) ?? 0;
  }

  private expire(key: string): void {
    const expiration = this.expirations.get(key);
    if (expiration !== undefined && expiration <= this.now()) {
      this.expirations.delete(key);
      this.values.delete(key);
      this.bump(key);
    }
  }

  async get(key: string): Promise<string | undefined> {
    this.reads.push(key);
    return this.value(key);
  }

  async set(
    key: string,
    value: string,
    options?: { expiration: Date },
  ): Promise<string> {
    this.commit([{ action: "set", key, value, ...options }]);
    return "OK";
  }

  async watch(...keys: string[]): Promise<RedisCasTransaction> {
    this.watches.push([...keys]);
    return new MemoryTransaction(this, keys);
  }

  hasConflict(watched: ReadonlyMap<string, number>): boolean {
    return [...watched].some(([key, version]) => this.version(key) !== version);
  }

  commit(writes: readonly RedisCasWrite[]): void {
    for (const write of writes) {
      this.expirations.delete(write.key);
      if (write.action === "set") this.values.set(write.key, write.value);
      else this.values.delete(write.key);
      if (write.action === "set" && write.expiration) {
        this.expirations.set(write.key, write.expiration.getTime());
      }
    }
    for (const write of writes) this.bump(write.key);
    this.commits.push(writes.map((write) => ({ ...write })));
  }

  private bump(key: string): void {
    this.versions.set(key, this.version(key) + 1);
  }
}

class MemoryTransaction implements RedisCasTransaction {
  private readonly watched: ReadonlyMap<string, number>;
  private readonly writes: RedisCasWrite[] = [];
  private inMulti = false;
  private closed = false;

  constructor(
    private readonly redis: MemoryRedis,
    keys: readonly string[],
  ) {
    this.watched = new Map(keys.map((key) => [key, redis.version(key)]));
  }

  async multi(): Promise<void> {
    this.assertOpen();
    this.inMulti = true;
  }

  async set(
    key: string,
    value: string,
    options?: { expiration: Date },
  ): Promise<unknown> {
    this.assertQueueing();
    this.writes.push({ action: "set", key, value, ...options });
    return this;
  }

  async del(...keys: string[]): Promise<unknown> {
    this.assertQueueing();
    this.writes.push(
      ...keys.map((key) => ({ action: "delete" as const, key })),
    );
    return this;
  }

  async exec(): Promise<readonly unknown[] | null> {
    this.assertQueueing();
    await this.redis.beforeExec?.(this.writes);
    if (this.redis.hasConflict(this.watched)) {
      this.closed = true;
      return null;
    }
    this.redis.commit(this.writes);
    this.closed = true;
    return this.writes.map(() => "OK");
  }

  async discard(): Promise<void> {
    this.closed = true;
  }

  async unwatch(): Promise<unknown> {
    this.closed = true;
    return this;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Transaction is closed.");
  }

  private assertQueueing(): void {
    this.assertOpen();
    if (!this.inMulti) throw new Error("MULTI has not started.");
  }
}
