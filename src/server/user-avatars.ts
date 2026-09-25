import { avatarUsername } from "../shared/user-avatar";

interface AvatarCache {
  get(key: string): Promise<string | null | undefined>;
  set(
    key: string,
    value: string,
    options?: { expiration: Date },
  ): Promise<unknown>;
}
interface CachedAvatar {
  avatar: string | null;
  freshUntil: number;
}
const FRESH_MS = 6 * 60 * 60 * 1000;
const MISSING_MS = 15 * 60 * 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Shared by current-player profiles and public winner lookups. */
export class UserAvatars {
  private readonly pending = new Map<string, Promise<string | null>>();

  constructor(
    private readonly cache: AvatarCache,
    private readonly lookup: (username: string) => Promise<string | undefined>,
    private readonly now = Date.now,
  ) {}

  async get(input: string): Promise<string | null> {
    const username = avatarUsername(input);
    if (!username) throw new Error("Invalid Reddit username.");
    const key = `euclid:profile-avatar:v1:${username}`;
    const raw = await this.cache.get(key);
    const cached = raw ? (JSON.parse(raw) as CachedAvatar) : null;
    if (cached && cached.freshUntil > this.now()) return cached.avatar;
    const pending = this.pending.get(username);
    if (pending) return pending;
    const request = this.refresh(username, key, cached);
    this.pending.set(username, request);
    try {
      return await request;
    } finally {
      this.pending.delete(username);
    }
  }

  private async refresh(
    username: string,
    key: string,
    cached: CachedAvatar | null,
  ) {
    let avatar: string | null;
    let duration: number;
    try {
      const result = await this.lookup(username);
      // The SDK supplies a Reddit-hosted image URL, not an image to proxy or upload.
      const url = result ? new URL(result.replace(/&amp;/g, "&")) : null;
      avatar = url?.protocol === "https:" ? url.href : null;
      duration = avatar ? FRESH_MS : MISSING_MS;
    } catch (error) {
      if (!cached) throw error;
      avatar = cached.avatar;
      duration = 60_000;
    }
    await this.cache.set(
      key,
      JSON.stringify({ avatar, freshUntil: this.now() + duration }),
      { expiration: new Date(this.now() + RETENTION_MS) },
    );
    return avatar;
  }
}
