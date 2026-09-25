import { totalSquareScore, type SquareScoringMode } from "./scoring";

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

export const SOLO_RULES_VERSION = 1 as const;
export type SoloRulesVersion = typeof SOLO_RULES_VERSION;
export type SoloMode = "ranked" | "practice";

export interface SoloRules {
  readonly rulesVersion: SoloRulesVersion;
  readonly mode: SoloMode;
  readonly W: number;
  readonly H: number;
  readonly scoring: SquareScoringMode;
  readonly winScore: number;
  readonly humanPlayer: PlayerIndex;
  readonly firstPlayer: PlayerIndex;
  readonly difficulty: AiDifficulty;
  /** Fading pieces: turns an unanchored stone lasts; 0 means permanent. */
  readonly fadeTurns: FadeTurns;
}

/**
 * Fading-piece lifetimes a player can choose; 0 turns the rule off. A square
 * needs four stones placed on four of its owner's turns, so a stone must last
 * at least four turns for any square to be completable.
 */
export const FADE_TURN_CHOICES = [0, 4, 5, 6, 7, 8] as const;
export type FadeTurns = (typeof FADE_TURN_CHOICES)[number];

export function isFadeTurns(value: unknown): value is FadeTurns {
  return (FADE_TURN_CHOICES as readonly unknown[]).includes(value);
}

export type RankedSoloRules = SoloRules & {
  readonly mode: "ranked";
  readonly W: 8;
  readonly H: 8;
  readonly scoring: "bbox";
  readonly winScore: 150;
  readonly humanPlayer: 0;
  readonly firstPlayer: 0;
  readonly difficulty: "tenderfoot";
  readonly fadeTurns: 0;
};

export type PracticeRules = SoloRules & { readonly mode: "practice" };

export type PracticeRulesInput = Pick<
  PracticeRules,
  "W" | "H" | "scoring" | "winScore" | "difficulty"
> &
  Partial<Pick<PracticeRules, "humanPlayer" | "firstPlayer" | "fadeTurns">>;

export const RANKED_SOLO_RULES: Readonly<RankedSoloRules> = Object.freeze({
  rulesVersion: SOLO_RULES_VERSION,
  mode: "ranked",
  W: 8,
  H: 8,
  scoring: "bbox",
  winScore: 150,
  humanPlayer: 0,
  firstPlayer: 0,
  difficulty: "tenderfoot",
  fadeTurns: 0,
});

export const DEFAULT_PRACTICE_RULES: Readonly<PracticeRules> = Object.freeze({
  ...RANKED_SOLO_RULES,
  mode: "practice",
  difficulty: "beginner",
});

const PRACTICE_RULE_FIELDS = new Set<keyof PracticeRulesInput>([
  "W",
  "H",
  "scoring",
  "winScore",
  "difficulty",
  "humanPlayer",
  "firstPlayer",
  "fadeTurns",
]);

function assertPlayerIndex(value: unknown, field: string): PlayerIndex {
  if (value !== 0 && value !== 1) {
    throw new RangeError(`${field} must be player index 0 or 1.`);
  }
  return value;
}

function assertBoardDimension(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 4 ||
    value > 16 ||
    value % 2 !== 0
  ) {
    throw new RangeError(`${field} must be an even integer from 4 through 16.`);
  }
  return value;
}

/**
 * Validates Practice configuration from settings or a saved game and returns
 * canonical rules. Ranked configuration never passes through this path.
 */
export function validatePracticeRules(input: unknown): PracticeRules {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Practice rules must be an object.");
  }

  const candidate = input as Record<string, unknown>;
  const unknownField = Object.keys(candidate).find(
    (field) => !PRACTICE_RULE_FIELDS.has(field as keyof PracticeRulesInput),
  );
  if (unknownField !== undefined) {
    throw new TypeError(
      `Practice rules contain unknown field "${unknownField}".`,
    );
  }

  const W = assertBoardDimension(candidate.W, "W");
  const H = assertBoardDimension(candidate.H, "H");
  const scoring = candidate.scoring;
  if (scoring !== "bbox" && scoring !== "true") {
    throw new TypeError('scoring must be "bbox" or "true".');
  }

  const difficulty = candidate.difficulty;
  if (!isAiDifficulty(difficulty)) {
    throw new TypeError("difficulty is not supported.");
  }

  const winScore = candidate.winScore;
  const maximumScore = totalSquareScore(W, H, scoring);
  if (
    typeof winScore !== "number" ||
    !Number.isInteger(winScore) ||
    winScore < 1 ||
    winScore > maximumScore
  ) {
    throw new RangeError(
      `winScore must be an integer from 1 through ${maximumScore}.`,
    );
  }

  const humanPlayer = assertPlayerIndex(
    candidate.humanPlayer ?? DEFAULT_PRACTICE_RULES.humanPlayer,
    "humanPlayer",
  );
  const firstPlayer = assertPlayerIndex(
    candidate.firstPlayer ?? DEFAULT_PRACTICE_RULES.firstPlayer,
    "firstPlayer",
  );
  const fadeTurns = candidate.fadeTurns ?? DEFAULT_PRACTICE_RULES.fadeTurns;
  if (!isFadeTurns(fadeTurns)) {
    throw new RangeError(
      `fadeTurns must be one of ${FADE_TURN_CHOICES.join(", ")}.`,
    );
  }

  return {
    rulesVersion: SOLO_RULES_VERSION,
    mode: "practice",
    W,
    H,
    scoring,
    winScore,
    humanPlayer,
    firstPlayer,
    difficulty,
    fadeTurns,
  };
}
