import { isRecord } from "../shared/guards";
import type { StoredSharedPostPayload } from "../shared/types/api";
import { parseJson } from "./stored-json";

const SHARED_TEXT = ["subredditName", "sharedAt", "title", "subtitle"] as const;
const RESULT_TEXT = [
  "headline",
  "details",
  "footer",
  "p1Name",
  "p2Name",
] as const;

const hasText = (
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean => fields.every((field) => typeof value[field] === "string");

/**
 * The snapshot behind a standalone post made by an older version: its kind,
 * identity, and displayed text must be present, and its board or ranking rows
 * must have their basic shape. Anything else reads as unavailable.
 */
export function readStoredSharePayload(
  raw: string | null | undefined,
  shareId: string,
): StoredSharedPostPayload | null {
  const value = parseJson(raw);
  if (
    !isRecord(value) ||
    value.shareId !== shareId ||
    !hasText(value, SHARED_TEXT)
  )
    return null;
  const readable =
    value.kind === "result"
      ? hasText(value, RESULT_TEXT) &&
        (value.winnerSide === 1 || value.winnerSide === 2) &&
        isRecord(value.board) &&
        Array.isArray(value.board.m_board) &&
        Array.isArray(value.board.m_players) &&
        value.board.m_players.length === 2
      : value.kind === "rankings" && Array.isArray(value.rows);
  return readable ? (value as unknown as StoredSharedPostPayload) : null;
}
