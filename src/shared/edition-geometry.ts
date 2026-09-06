export interface SquarePattern { id: string; corners: number[]; points: number; area: number; }

/** Rotate each integer edge by a quarter-turn; deduplicate by its four corners. */
export function squareCatalog(size: number): SquarePattern[] {
  const patterns = new Map<string, SquarePattern>();
  for (let a = 0; a < size * size; a++) for (let b = 0; b < size * size; b++) {
    if (a === b) continue;
    const ax = a % size, ay = Math.floor(a / size), bx = b % size, by = Math.floor(b / size);
    const dx = bx - ax, dy = by - ay;
    const coordinates = [[ax, ay], [bx, by], [bx - dy, by + dx], [ax - dy, ay + dx]] as const;
    if (coordinates.some(([x, y]) => x < 0 || x >= size || y < 0 || y >= size)) continue;
    const corners = coordinates.map(([x, y]) => y * size + x);
    const id = [...corners].sort((x, y) => x - y).join("-");
    const extent = Math.abs(dx) + Math.abs(dy) + 1;
    patterns.set(id, { id, corners, points: extent * extent, area: dx * dx + dy * dy });
  }
  return [...patterns.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function coordinate(point: number, size = 6): string {
  return `${String.fromCharCode(65 + point % size)}${Math.floor(point / size) + 1}`;
}
