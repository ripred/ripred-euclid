/** Normalize a public Reddit handle without accepting paths or deleted-user labels. */
export function avatarUsername(value: string): string | null {
  const username = value.trim().replace(/^u\//i, "").toLowerCase();
  return /^[a-z0-9_-]{1,20}$/.test(username) && username !== "anonymous"
    ? username
    : null;
}

export interface UserAvatarResponse {
  username: string;
  avatar: string | null;
}
