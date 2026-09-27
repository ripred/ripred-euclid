/** A readable message from anything thrown, for logs and player notices. */
export function errorMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === "string" && error ? error : fallback;
}
