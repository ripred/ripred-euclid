import { RESULT_HUB_TITLES } from "../shared/result-sharing";

export interface ResultShareStatusResponse {
  status?: "pending" | "posted";
  message?: string;
}

/** A successful request is not a confirmed publication until its status is posted. */
export function getResultSharePresentation(
  response: ResultShareStatusResponse,
  kind: keyof typeof RESULT_HUB_TITLES,
): { completed: boolean; notice: string } {
  const message = response.message?.trim();
  const hub = RESULT_HUB_TITLES[kind];
  if (response.status === "posted") {
    return {
      completed: true,
      notice: message || `Shared as a comment in ${hub}.`,
    };
  }
  if (response.status === "pending") {
    return {
      completed: false,
      notice: message
        ? `${message} Posting has not been confirmed yet.`
        : `Your result comment in ${hub} is prepared, but posting has not been confirmed yet.`,
    };
  }
  return {
    completed: false,
    notice: "Reddit did not return a confirmed share status. Please try again.",
  };
}
