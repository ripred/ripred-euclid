/** A small stroke icon set drawn on a 24-unit grid. */
const PATHS = {
  back: "M15 18l-6-6 6-6",
  close: "M6 6l12 12M18 6L6 18",
  arrow: "M5 12h14M13 6l6 6-6 6",
  // A tilted square: the game's own shape, for puzzle challenges.
  challenge: "M9 5l10 4-4 10-10-4z",
  soundOn: "M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 010 7M19.2 5.8a9 9 0 010 12.4",
  soundOff: "M4 9v6h4l5 4V5L8 9H4zM17 9.5l5 5M22 9.5l-5 5",
  chat: "M4 5.5h16v10.5H10l-6 4.5z",
  help: "M12 21a9 9 0 100-18 9 9 0 000 18zM9.6 9.3a2.5 2.5 0 014.9.7c0 1.7-2.5 2.2-2.5 3.8M12 17.2v.1",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 100-6 3 3 0 000 6z",
  eyeOff:
    "M4 4l16 16M10.6 6A10 10 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-2.9 3.7M6.6 7.6A16.8 16.8 0 002.5 12S6 18.5 12 18.5a9.6 9.6 0 004.3-1M9.9 9.9a3 3 0 004.2 4.2",
  assist:
    "M9 18h6M10 21h4M12 3a6 6 0 00-3.9 10.6c.7.6.9 1.4.9 2.4h6c0-1 .2-1.8.9-2.4A6 6 0 0012 3z",
  share: "M4 13v6a1 1 0 001 1h14a1 1 0 001-1v-6M16 7l-4-4-4 4M12 3v12",
  refresh: "M20 12a8 8 0 11-2.4-5.7M20 4v5h-5",
  trophy:
    "M8 21h8M12 16v5M7 4h10v5a5 5 0 01-10 0zM17 6h3v1a3 3 0 01-3 3M7 6H4v1a3 3 0 003 3",
  watch: "M3 7h18v12H3zM8 3l4 4 4-4",
  sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  users:
    "M16 20v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 18.5V20M10 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM20 20v-1.5a3.5 3.5 0 00-2.5-3.35M15.5 4.2a3.5 3.5 0 010 6.6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
