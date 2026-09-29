import { useState } from "react";
import "./avatar.css";

/** Image URLs come from profile data; missing or failed images retain a stable initial. */
export function PlayerAvatar({
  name,
  avatar,
  size = 32,
}: {
  name: string;
  avatar?: string | undefined;
  size?: number;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initial = name.trim().replace(/^u\//i, "").charAt(0).toUpperCase();
  return avatar && failedUrl !== avatar ? (
    <img
      className="avatar"
      src={avatar}
      alt=""
      loading="lazy"
      decoding="async"
      width={size}
      height={size}
      onError={() => setFailedUrl(avatar)}
    />
  ) : (
    <span
      className="avatar avatar--initial"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {initial || "?"}
    </span>
  );
}
