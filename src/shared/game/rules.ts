import { totalSquareScore } from "../scoring";
import { isRecord } from "../guards";

export type PlayerIndex = 0 | 1;
export type PlayerColor = 1 | 2;

export const GAME_STATES = {
  RUNNING: 0,
  PLAYER_1_WIN: 1,
  PLAYER_2_WIN: 2,
  TIE: 3,
} as const;

export type GameState = (typeof GAME_STATES)[keyof typeof GAME_STATES];
export type GameOutcome =
  | { state: typeof GAME_STATES.RUNNING; status: "running"; winner: null }
  | {
      state: typeof GAME_STATES.PLAYER_1_WIN;
      status: "player1_win";
      winner: 1;
    }
  | {
      state: typeof GAME_STATES.PLAYER_2_WIN;
      status: "player2_win";
      winner: 2;
    }
  | { state: typeof GAME_STATES.TIE; status: "tie"; winner: null };

export const PLAY_STYLES = {
  BRUTAL: 0,
  OFFENSIVE: 1,
  DEFENSIVE: 2,
  CASUAL: 3,
  BEGINNER: 4,
  TENDERFOOT: 5,
  DOOFUS: 6,
  GOLDFISH: 7,
  COFFEE: 8,
} as const;

export type PlayStyle = (typeof PLAY_STYLES)[keyof typeof PLAY_STYLES];

export const AI_DIFFICULTIES = [
  "doofus",
  "goldfish",
  "beginner",
  "coffee",
  "tenderfoot",
  "casual",
  "offensive",
  "defensive",
  "brutal",
] as const;

export type AiDifficulty = (typeof AI_DIFFICULTIES)[number];

export const AI_DIFFICULTY_TO_PLAY_STYLE: Readonly<
  Record<AiDifficulty, PlayStyle>
> = {
  doofus: PLAY_STYLES.DOOFUS,
  goldfish: PLAY_STYLES.GOLDFISH,
  beginner: PLAY_STYLES.BEGINNER,
  coffee: PLAY_STYLES.COFFEE,
  tenderfoot: PLAY_STYLES.TENDERFOOT,
  casual: PLAY_STYLES.CASUAL,
  offensive: PLAY_STYLES.OFFENSIVE,
  defensive: PLAY_STYLES.DEFENSIVE,
  brutal: PLAY_STYLES.BRUTAL,
};

export const AI_DIFFICULTY_LABELS: Readonly<Record<AiDifficulty, string>> = {
  doofus: "doofus",
  goldfish: "Goldfish",
  beginner: "Beginner",
  coffee: "Coffee-Deprived",
  tenderfoot: "Tenderfoot",
  casual: "Casual",
  offensive: "Offensive",
  defensive: "Defensive",
  brutal: "Brutal",
};

export function isAiDifficulty(value: unknown): value is AiDifficulty {
  return (
    typeof value === "string" &&
    (AI_DIFFICULTIES as readonly string[]).includes(value)
  );
}

export function playStyleForDifficulty(difficulty: AiDifficulty): PlayStyle {
  return AI_DIFFICULTY_TO_PLAY_STYLE[difficulty];
}

export function playerColorForIndex(index: PlayerIndex): PlayerColor {
  return index === 0 ? 1 : 2;
}

export function playerIndexForColor(color: PlayerColor): PlayerIndex {
  return color === 1 ? 0 : 1;
}

/** Every game is played on this board: Ranked, Practice and Redditor matches. */
export const STANDARD_BOARD = Object.freeze({ W: 8, H: 8 } as const);
export const STANDARD_WIN_SCORE = 150 as const;
/** The most one player can score on the standard board. */
export const STANDARD_MAX_SCORE = totalSquareScore(
  STANDARD_BOARD.W,
  STANDARD_BOARD.H,
);

export const SOLO_RULES_VERSION = 1 as const;
export type SoloRulesVersion = typeof SOLO_RULES_VERSION;
export type SoloMode = "ranked" | "practice";

export interface SoloRules {
  readonly rulesVersion: SoloRulesVersion;
  readonly mode: SoloMode;
  readonly W: typeof STANDARD_BOARD.W;
  readonly H: typeof STANDARD_BOARD.H;
  readonly winScore: number;
  readonly humanPlayer: PlayerIndex;
  readonly firstPlayer: PlayerIndex;
  readonly difficulty: AiDifficulty;
}

export type RankedSoloRules = SoloRules & {
  readonly mode: "ranked";
  readonly winScore: typeof STANDARD_WIN_SCORE;
  readonly humanPlayer: 0;
  readonly firstPlayer: 0;
  readonly difficulty: "tenderfoot";
};

export type PracticeRules = SoloRules & { readonly mode: "practice" };

export type PracticeRulesInput = Pick<PracticeRules, "difficulty"> &
  Partial<Pick<PracticeRules, "humanPlayer" | "firstPlayer">>;

export const RANKED_SOLO_RULES: Readonly<RankedSoloRules> = Object.freeze({
  rulesVersion: SOLO_RULES_VERSION,
  mode: "ranked",
  ...STANDARD_BOARD,
  winScore: STANDARD_WIN_SCORE,
  humanPlayer: 0,
  firstPlayer: 0,
  difficulty: "tenderfoot",
});

export const DEFAULT_PRACTICE_RULES: Readonly<PracticeRules> = Object.freeze({
  ...RANKED_SOLO_RULES,
  mode: "practice",
  difficulty: "beginner",
});

const PRACTICE_RULE_FIELDS = new Set<keyof PracticeRulesInput>([
  "difficulty",
  "humanPlayer",
  "firstPlayer",
]);

function assertPlayerIndex(value: unknown, field: string): PlayerIndex {
  if (value !== 0 && value !== 1) {
    throw new RangeError(`${field} must be player index 0 or 1.`);
  }
  return value;
}

/**
 * Validates untrusted Practice configuration and returns the canonical rules
 * stored by the server. Practice always uses the standard board and target;
 * Ranked configuration never passes through this path.
 */
export function validatePracticeRules(candidate: unknown): PracticeRules {
  if (!isRecord(candidate)) {
    throw new TypeError("Practice rules must be an object.");
  }
  const unknownField = Object.keys(candidate).find(
    (field) => !PRACTICE_RULE_FIELDS.has(field as keyof PracticeRulesInput),
  );
  if (unknownField !== undefined) {
    throw new TypeError(
      `Practice rules contain unknown field "${unknownField}".`,
    );
  }

  const difficulty = candidate.difficulty;
  if (!isAiDifficulty(difficulty)) {
    throw new TypeError("difficulty is not supported.");
  }

  const humanPlayer = assertPlayerIndex(
    candidate.humanPlayer ?? DEFAULT_PRACTICE_RULES.humanPlayer,
    "humanPlayer",
  );
  const firstPlayer = assertPlayerIndex(
    candidate.firstPlayer ?? DEFAULT_PRACTICE_RULES.firstPlayer,
    "firstPlayer",
  );

  return {
    rulesVersion: SOLO_RULES_VERSION,
    mode: "practice",
    ...STANDARD_BOARD,
    winScore: STANDARD_WIN_SCORE,
    humanPlayer,
    firstPlayer,
    difficulty,
  };
}
