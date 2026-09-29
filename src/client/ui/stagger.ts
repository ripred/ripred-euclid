import type { CSSProperties } from "react";

/** An item's place in a staggered entrance; CSS steps its delay by --order. */
export const staggerStyle = (order: number): CSSProperties =>
  ({ "--order": order }) as CSSProperties;
