import { isRecord } from "../shared/guards";

const REJECTED_COMMENT_CODES = new Set<unknown>([
  "permission_denied",
  "invalid_argument",
  "not_found",
  "unauthenticated",
  3,
  5,
  7,
  16,
]);

/** Only errors proving rejection can release a reservation for another write. */
export function isDefinitiveRedditRejection(
  error: unknown,
  operation: "comment" | "post",
): boolean {
  if (operation === "post") {
    // Post.submit fetches the new post after creation. A subsequent 403/404
    // therefore does not prove the submission failed. The SDK's no-ID error
    // with actual Reddit errors is the one safe rejection signal here.
    const prefix = "post submission failed: ";
    return (
      error instanceof Error &&
      error.message.startsWith(prefix) &&
      error.message.slice(prefix.length).trim().length > 0
    );
  }
  // Comment.submit returns directly from the write response; it does not fetch
  // the created comment. The SDK uses this exact text for response.json.errors.
  if (error instanceof Error && error.message === "failed to reply to comment")
    return true;
  const code = isRecord(error) ? error.code : undefined;
  return REJECTED_COMMENT_CODES.has(
    typeof code === "string" ? code.toLowerCase() : code,
  );
}
