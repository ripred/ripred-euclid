export interface ProjectedPoint {
  x: number;
  y: number;
}

/** Resolve overlapping hit targets by visible distance, never DOM stacking order. */
export function nearestProjectedPoint(
  points: readonly ProjectedPoint[],
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
): number {
  let nearest = -1;
  let minimum = Infinity;
  points.forEach((point, index) => {
    const dx = bounds.left + (point.x / 100) * bounds.width - clientX;
    const dy = bounds.top + (point.y / 100) * bounds.height - clientY;
    const distance = dx * dx + dy * dy;
    if (distance < minimum) {
      nearest = index;
      minimum = distance;
    }
  });
  return nearest;
}
