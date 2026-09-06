/** Minimal contract shared by each edition's rules, transport, and interface. */
export type Player = 1 | 2;
/** Safe player-facing rule rejections, distinct from infrastructure failures. */
export class EditionRuleError extends Error {}
export interface EditionState {
  revision: number;
  turn: Player;
  /** null while playing; zero is a draw. */
  winner: Player | 0 | null;
}
export type PlayMode = "solo" | "duel" | "puzzle";
export interface EditionDefinition<T extends EditionState> {
  id: string;
  create(options: unknown): T;
  move(state: T, action: unknown): T;
  chooseMove(state: T): unknown;
}
export interface EditionSnapshot<T extends EditionState> {
  id: string;
  mode: PlayMode;
  state: T;
}
