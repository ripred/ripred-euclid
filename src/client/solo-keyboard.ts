/**
 * Browsers do not expose a keyboard-queue flush. Ignore events created before
 * the displayed human turn began, and require a fresh press instead of repeat.
 * Both timestamps use the document's performance time origin.
 */
export function isFreshSoloGameplayKey(
  event: Pick<KeyboardEvent, "repeat" | "timeStamp">,
  turnStartedAt: number,
): boolean {
  return (
    !event.repeat &&
    Number.isFinite(event.timeStamp) &&
    event.timeStamp > turnStartedAt
  );
}
