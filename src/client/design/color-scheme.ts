export type ColorScheme = "red-blue" | "amber-amethyst";

export function parseColorScheme(value: string | undefined): ColorScheme {
  if (value === undefined || value === "amber-amethyst")
    return "amber-amethyst";
  if (value === "red-blue") return value;
  throw new Error("VITE_COLOR_SCHEME must be red-blue or amber-amethyst");
}
