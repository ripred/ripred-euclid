export type ColorScheme = "red-blue" | "amber-amethyst";

export function parseColorScheme(value: string | undefined): ColorScheme {
  if (value === undefined || value === "red-blue") return "red-blue";
  if (value === "amber-amethyst") return value;
  throw new Error("VITE_COLOR_SCHEME must be red-blue or amber-amethyst");
}
