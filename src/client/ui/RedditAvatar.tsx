import { useEffect, useState } from "react";
import {
  avatarUsername,
  type UserAvatarResponse,
} from "../../shared/user-avatar";
import { PlayerAvatar } from "./PlayerAvatar";

/** Only surfaces lacking profile data perform a lookup; standings already carry URLs. */
export function RedditAvatar({
  username,
  avatar,
  size = 72,
}: {
  username: string;
  avatar?: string | undefined;
  size?: number;
}) {
  const handle = avatarUsername(username);
  const [resolved, setResolved] = useState<UserAvatarResponse | null>(null);
  useEffect(() => {
    if (avatar || !handle) return;
    const controller = new AbortController();
    void fetch(`/api/users/${encodeURIComponent(handle)}/avatar`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as UserAvatarResponse;
        if (
          !controller.signal.aborted &&
          data.username === handle &&
          (data.avatar === null || typeof data.avatar === "string")
        )
          setResolved(data);
      })
      .catch(() => {
        /* Profile failures leave the initial visible. */
      });
    return () => controller.abort();
  }, [avatar, handle]);
  return (
    <PlayerAvatar
      name={username}
      size={size}
      avatar={
        avatar ||
        (resolved?.username === handle
          ? (resolved?.avatar ?? undefined)
          : undefined)
      }
    />
  );
}
