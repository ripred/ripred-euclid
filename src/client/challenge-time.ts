export function formatChallengeTime(milliseconds: number): string {
  const tenths = Math.floor(Math.max(0, milliseconds) / 100);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}
