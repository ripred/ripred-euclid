import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRelay,
  moveRelay,
  PUZZLES,
  relayPuzzle,
  solveRelay,
  type RelayState,
} from "../../shared/edition-game";
import { coordinate } from "../../shared/edition-geometry";
import { Relay } from "./Relay";
import { useEdition } from "./use-edition";

vi.mock("./use-edition", () => ({ useEdition: vi.fn() }));

function renderGame(
  game: RelayState | null,
  busy = false,
  watching = false,
): string {
  vi.mocked(useEdition<RelayState>).mockReturnValue({
    game,
    gameId: game ? "relay-test-session" : null,
    watching,
    watchedId: watching ? "relay-test-session" : null,
    hostName: watching ? "HostPlayer" : null,
    ownerGameId: "personal-test",
    spectatorsEnabled: false,
    watch: vi.fn(async () => undefined),
    stopWatching: vi.fn(),
    setSpectatorsEnabled: vi.fn(async () => true),
    mode: "puzzle",
    loading: false,
    busy,
    error: null,
    start: vi.fn(async () => true),
    move: vi.fn(async () => true),
    reload: vi.fn(async () => undefined),
  });
  return renderToStaticMarkup(<Relay />);
}

function primaryButton(markup: string): string {
  const controls = markup.slice(markup.indexOf('class="puzzle-actions"'));
  const button = controls.match(
    /<button\b[^>]*class="primary"[^>]*>[^<]*<\/button>/,
  );
  expect(button).not.toBeNull();
  return button![0];
}

function footer(markup: string): string {
  return markup.slice(markup.indexOf('<footer class="relay-footer"'));
}

function guidanceIndex(markup: string): number {
  return markup.search(/class="[^"]*\bhint-guidance\b[^"]*"/);
}

function introCollection(markup: string): string {
  const collection = markup.match(
    /<details\b[^>]*class="intro-collection"[^>]*>[\s\S]*?<\/details>/,
  );
  expect(collection).not.toBeNull();
  return collection?.[0] ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Relay spectator rendering", () => {
  it("keeps keyboard point inspection without exposing puzzle actions or personal progress", () => {
    const markup = renderGame(createRelay({ level: 2 }), false, true);
    expect(markup).toContain("Arrow keys inspect points. Read-only.");
    expect(markup.match(/aria-disabled="true"/g)).toHaveLength(36);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).toMatch(/<button disabled="">Restart puzzle<\/button>/);
    expect(markup).toContain("HostPlayer:");
    expect(markup).not.toMatch(
      /<button[^>]*>(?:Hint|Undo|Place point|Next puzzle|New puzzle)<\/button>/,
    );
    expect(markup).not.toContain('class="puzzle-navigation"');
    expect(markup).not.toContain('class="intro-collection"');
  });

  it("shows the host's solved puzzle without marking progress or offering the next puzzle", () => {
    let game = createRelay({ level: 2 });
    for (const point of [17, 15]) game = moveRelay(game, { point });
    const markup = renderGame(game, false, true);
    expect(markup).toContain(
      "HostPlayer: 2 squares completed in 2 moves. Puzzle solved.",
    );
    expect(markup).not.toContain("Next puzzle");
    expect(markup).not.toContain("your placed point");
    expect(markup).not.toContain('class="intro-collection"');
  });

  it("keeps private hint text and outlines out of a spectator rendering", () => {
    const game = moveRelay(createRelay({ level: 2 }), { type: "hint" });
    const markup = renderGame(game, false, true);
    expect(markup).not.toContain(game.hint!.message);
    expect(markup).not.toContain('class="hint-square"');
    expect(markup).not.toContain("suggested point");
    expect(markup).not.toContain("hint-guidance");
  });

  it("describes blocked and exhausted boards without telling the viewer to undo", () => {
    const blocked = moveRelay(createRelay({ level: 2 }), { point: 6 });
    const exhausted = moveRelay(blocked, { point: 7 });
    for (const game of [blocked, exhausted]) {
      const markup = renderGame(game, false, true);
      expect(markup).toContain("HostPlayer:");
      expect(markup).not.toMatch(/\b(?:Undo|your|Your)\b/);
    }
  });

  it("keeps a generated level's definition visible without offering generation", () => {
    const game = createRelay({
      generator: {
        moves: 2,
        goal: 1,
        difficulty: "beginner",
        seed: "spectator-generated",
      },
    });
    const markup = renderGame(game, false, true);
    expect(markup).toContain(relayPuzzle(game).name);
    expect(markup).toContain("Generated · beginner");
    expect(markup).not.toContain("New puzzle");
    expect(markup).not.toContain('class="puzzle-navigation"');
  });

  it("does not offer a personal start while the watched snapshot is absent", () => {
    const markup = renderGame(null, false, true);
    expect(markup).toContain("Waiting for the broadcast");
    expect(markup).not.toContain("Start puzzle");
    expect(markup).not.toContain('class="puzzle-board"');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Relay hint controls", () => {
  it("shows puzzle 3's setup instruction before the player makes a move", () => {
    const markup = renderGame(createRelay({ level: 2 }));

    expect(markup).toContain("Set the stage");
    expect(markup).toContain(PUZZLES[2]!.description);
    expect(primaryButton(markup)).toContain("disabled");
  });

  it("keeps a requested hint visible beside the controls and ready to confirm", () => {
    const game = moveRelay(createRelay({ level: 2 }), { type: "hint" });
    const markup = renderGame(game);
    const controlsStart = markup.indexOf('class="puzzle-actions"');
    const guidanceStart = guidanceIndex(markup);
    const collectionStart = markup.indexOf('class="level-chooser"');

    expect(guidanceStart).toBeGreaterThan(controlsStart);
    expect(guidanceStart).toBeLessThan(collectionStart);
    const guidance = markup.slice(guidanceStart, collectionStart);
    expect(guidance).toContain(game.hint!.message);
    expect(guidance).toContain(coordinate(game.hint!.point!));
    expect(primaryButton(markup)).toContain("Place point");
    expect(primaryButton(markup)).not.toContain("disabled");
    expect(footer(markup)).not.toContain(game.hint!.message);
    expect(footer(markup)).not.toContain("selected");
    expect(game.placements).toEqual([]);
  });

  it("outlines each server-planned square for both setup and finishing hints", () => {
    const setupHint = moveRelay(createRelay({ level: 2 }), { type: "hint" });
    const setup = moveRelay(setupHint, { point: setupHint.hint!.point });
    const finalHint = moveRelay(setup, { type: "hint" });

    for (const game of [setupHint, finalHint]) {
      const markup = renderGame(game);
      const outlines =
        markup.match(/<polygon\b[^>]*class="hint-square"/g) ?? [];

      expect(game.hint!.squares!.length).toBeGreaterThanOrEqual(
        PUZZLES[2]!.goal - game.completed.length,
      );
      expect(outlines).toHaveLength(game.hint!.squares!.length);
      expect(markup).toContain(
        `${coordinate(game.hint!.point!)}, empty, selected, suggested point`,
      );
    }
  });

  it("does not relabel Place point as board setup while a request is pending", () => {
    const game = moveRelay(createRelay({ level: 2 }), { type: "hint" });
    const markup = renderGame(game, true);

    expect(primaryButton(markup)).toContain("Place point");
    expect(primaryButton(markup)).toContain("disabled");
    expect(primaryButton(markup)).not.toContain("Setting the board");
  });

  it("renders older saved hints without square-plan details", () => {
    const game = moveRelay(createRelay({ level: 2 }), { type: "hint" });
    delete game.canFinish;
    delete game.hint!.squares;
    const markup = renderGame(game);

    expect(markup).toContain(game.hint!.message);
    expect(guidanceIndex(markup)).toBeGreaterThan(0);
    expect(markup).not.toContain('class="hint-square"');
    expect(primaryButton(markup)).not.toContain("disabled");
  });

  it("renders a legacy initial state and an absent game without false dead-end advice", () => {
    const game = createRelay({ level: 2 });
    delete game.canFinish;

    for (const state of [game, null]) {
      const markup = renderGame(state);
      expect(markup).not.toContain("No finish fits");
      expect(markup).not.toContain("Keep building");
      expect(primaryButton(markup)).not.toContain("Undo &amp; try again");
    }
  });
});

describe("Relay puzzle 3 move-order feedback", () => {
  it("immediately explains when an unhelpful point leaves no solution", () => {
    const game = moveRelay(createRelay({ level: 2 }), {
      point: 6,
    });
    const markup = renderGame(game);
    const controls = markup.slice(
      markup.indexOf('class="puzzle-actions"'),
      markup.indexOf('class="level-chooser"'),
    );

    expect(game.winner).toBeNull();
    expect(game.canFinish).toBe(false);
    const feedback = controls.match(
      /<div class="[^"]*\bmove-feedback\b[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    )?.[1];
    expect(game.lastSquares).toHaveLength(0);
    expect(feedback).toMatch(/\bUndo\b/);
    expect(controls).not.toContain("Keep building");
  });

  it("shows a no-solution hint and undo guidance without selecting another point", () => {
    const blocked = moveRelay(createRelay({ level: 2 }), {
      point: 6,
    });
    const game = moveRelay(blocked, { type: "hint" });
    const markup = renderGame(game);
    const guidanceStart = guidanceIndex(markup);
    const guidance = markup.slice(
      guidanceStart,
      markup.indexOf('class="level-chooser"'),
    );

    expect(game.hint!.point).toBeNull();
    expect(guidanceStart).toBeGreaterThan(0);
    expect(guidance).toContain(game.hint!.message);
    expect(guidance).toContain("Undo");
    expect(markup).not.toMatch(/aria-pressed="true"/);
    expect(markup).not.toContain('class="hint-square"');
    expect(footer(markup)).not.toContain(game.hint!.message);
  });

  it("restores solvable guidance after undo", () => {
    const blocked = moveRelay(createRelay({ level: 2 }), {
      point: 6,
    });
    const restored = moveRelay(blocked, { type: "undo" });
    const ready = moveRelay(restored, { type: "hint" });
    expect(primaryButton(renderGame(ready))).not.toContain("disabled");
  });

  it.each([
    { order: "F3 then D3", points: [17, 15] },
    { order: "D3 then F3", points: [15, 17] },
  ])("recognizes puzzle 3 completed in either order: $order", ({ points }) => {
    let game = createRelay({ level: 2 });
    for (const point of points) {
      game = moveRelay(game, { point });
    }
    const markup = renderGame(game);

    expect(game.winner).toBe(1);
    expect(game.completed).toHaveLength(2);
    expect(markup).toContain("2 squares");
    expect(primaryButton(markup)).toContain("Next puzzle");
    expect(markup).not.toContain("No finish fits");
  });

  it("keeps a helpful next hint after a first move completes one square", () => {
    const first = moveRelay(createRelay({ level: 2 }), { point: 15 });
    const game = moveRelay(first, { type: "hint" });
    const markup = renderGame(game);

    expect(game.completed).toHaveLength(1);
    expect(game.hint!.point).toBe(17);
    expect(markup).toMatch(/Squares left<\/span><strong>1<\/strong>/);
    expect(guidanceIndex(markup)).toBeGreaterThan(0);
    expect(markup).toContain("F3, empty, selected, suggested point");
    expect(primaryButton(markup)).not.toContain("disabled");
    expect(markup).not.toContain("No finish fits");
  });
});

describe("Relay generated puzzle presentation", () => {
  it("renders generated single-square goals instead of introductory puzzle details", () => {
    const game = createRelay({
      generator: {
        moves: 2,
        goal: 1,
        difficulty: "beginner",
        seed: "generated-render-goal-one",
      },
    });
    const puzzle = relayPuzzle(game);
    const markup = renderGame(game);
    const story = markup.slice(
      markup.indexOf('class="puzzle-story"'),
      markup.indexOf('class="puzzle-metrics"'),
    );

    expect(game.generatedPuzzle).toBeDefined();
    expect(story).toContain(puzzle.name);
    expect(story).toContain(puzzle.description);
    expect(story).toContain("Generated · beginner");
    expect(story).toContain("Complete 1 square in 2 moves or fewer.");
    expect(story).toContain("generated-render-goal-one");
    expect(story).not.toContain(PUZZLES[0]!.name);
    expect(story).not.toContain("01 / 08");
    expect(markup).toMatch(/Moves left<\/span><strong>2<\/strong>/);
    expect(markup).toMatch(/Squares left<\/span><strong>1<\/strong>/);
    expect(markup).not.toContain('aria-current="step"');
    expect(markup).not.toContain('class="current-level"');
    expect(markup).toContain(">New puzzle</button>");
  });

  it("renders generated hint plans and selects the authoritative next point", () => {
    const initial = createRelay({
      generator: {
        moves: 2,
        goal: 2,
        difficulty: "standard",
        seed: "generated-render-hint",
      },
    });
    const game = moveRelay(initial, { type: "hint" });
    const markup = renderGame(game);
    const point = game.hint!.point!;
    const outlines = markup.match(/<polygon\b[^>]*class="hint-square"/g) ?? [];

    expect(game.hint!.squares!.length).toBeGreaterThanOrEqual(2);
    expect(outlines).toHaveLength(game.hint!.squares!.length);
    expect(guidanceIndex(markup)).toBeGreaterThan(0);
    expect(markup).toContain(game.hint!.message);
    expect(markup).toContain(
      `${coordinate(point)}, empty, selected, suggested point`,
    );
    expect(primaryButton(markup)).not.toContain("disabled");
    expect(game.placements).toEqual([]);
    expect(markup).not.toContain('aria-current="step"');
  });

  it("offers another generated puzzle after a correctly worded one-square win", () => {
    let game = createRelay({
      generator: {
        moves: 1,
        goal: 1,
        difficulty: "beginner",
        seed: "generated-render-win",
      },
    });
    const solution = solveRelay(game);
    expect(solution).toHaveLength(1);
    game = moveRelay(game, { point: solution![0] });
    const markup = renderGame(game);

    expect(game.winner).toBe(1);
    expect(markup).toContain("1 square completed in 1 move.");
    expect(markup).not.toContain("1 squares");
    expect(markup).toMatch(/Squares left<\/span><strong>0<\/strong>/);
    expect(primaryButton(markup)).toContain("Next generated puzzle");
    expect(primaryButton(markup)).not.toContain("disabled");
    expect(markup).not.toContain('aria-current="step"');
  });

  it("offers generated puzzles after the final introductory puzzle", () => {
    let game = createRelay({ level: PUZZLES.length - 1 });
    const solution = solveRelay(game);
    expect(solution).not.toBeNull();
    for (const point of solution!) game = moveRelay(game, { point });
    const markup = renderGame(game);

    expect(game.winner).toBe(1);
    expect(primaryButton(markup)).toContain("Next generated puzzle");
    expect(markup).toContain('aria-label="Puzzle 8: The long relay"');
    expect(markup).toContain('aria-current="step"');
  });

  it("disables generation while another request is pending", () => {
    const game = createRelay({
      generator: {
        moves: 1,
        goal: 1,
        difficulty: "beginner",
        seed: "generated-render-busy",
      },
    });
    const markup = renderGame(game, true);
    const newPuzzle = markup.match(
      /<button\b[^>]*class="new-puzzle"[^>]*>New puzzle<\/button>/,
    );

    expect(newPuzzle).not.toBeNull();
    expect(newPuzzle![0]).toContain("disabled");
  });
});

describe("Relay introductory collection navigation", () => {
  it.each([0, PUZZLES.length - 1])(
    "opens introductory navigation while introduction %i is in progress",
    (level) => {
      const game = createRelay({ level });
      const collection = introCollection(renderGame(game));

      expect(game.winner).toBeNull();
      expect(collection).toMatch(/^<details\b[^>]*\bopen=""/);
      expect(collection).toContain("<summary>Introductory puzzles</summary>");
      expect(collection).toContain('aria-label="Introductory puzzles"');
      expect(collection).toContain('aria-current="step"');
    },
  );

  it("collapses the collection after the last introduction without claiming earlier puzzles were solved", () => {
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => "[7]") });
    let game = createRelay({ level: PUZZLES.length - 1 });
    const solution = solveRelay(game);
    expect(solution).not.toBeNull();
    for (const point of solution ?? []) game = moveRelay(game, { point });
    const markup = renderGame(game);
    const collection = introCollection(markup);

    expect(game.winner).toBe(1);
    expect(collection).not.toMatch(/^<details\b[^>]*\bopen/);
    expect(collection).toContain("1 of 8 introductory puzzles solved");
    expect(collection.match(/class="solved-mark"/g)).toHaveLength(1);
    expect(primaryButton(markup)).toContain("Next generated puzzle");
    expect(footer(markup)).not.toMatch(/introduct|of 8|solved-mark/i);
    expect(markup).not.toMatch(/all eight|all 8|introduction complete/i);
  });

  it.each([
    { phase: "active", winner: null },
    { phase: "won", winner: 1 },
    { phase: "lost", winner: 0 },
  ])(
    "keeps the introduction collapsed for a $phase generated puzzle",
    ({ winner }) => {
      const initial = createRelay({
        generator: {
          moves: 1,
          goal: 1,
          difficulty: "beginner",
          seed: "generated-navigation-states",
        },
      });
      let game = initial;
      if (winner !== null) {
        const point = initial.cells.findIndex(
          (occupied, candidate) =>
            occupied === 0 &&
            moveRelay(initial, { point: candidate }).winner === winner,
        );
        expect(point).toBeGreaterThanOrEqual(0);
        game = moveRelay(initial, { point });
      }
      const markup = renderGame(game);
      const collection = introCollection(markup);

      expect(game.winner).toBe(winner);
      expect(collection).not.toMatch(/^<details\b[^>]*\bopen/);
      expect(collection).toContain("<summary>Introductory puzzles</summary>");
      expect(collection).not.toContain('aria-current="step"');
      expect(footer(markup)).not.toMatch(/introduct|of 8|solved-mark/i);
    },
  );

  it("keeps all eight saved checkmarks inside optional introductory navigation", () => {
    const solved = Array.from({ length: PUZZLES.length }, (_, level) => level);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => JSON.stringify(solved)),
    });
    const game = createRelay({
      generator: {
        moves: 2,
        goal: 2,
        difficulty: "standard",
        seed: "generated-navigation-saved-intros",
      },
    });
    const markup = renderGame(game);
    const collection = introCollection(markup);

    expect(collection).not.toMatch(/^<details\b[^>]*\bopen/);
    expect(collection.match(/class="solved-mark"/g)).toHaveLength(
      PUZZLES.length,
    );
    expect(collection).toContain("8 of 8 introductory puzzles solved");
    expect(collection).toContain("<summary>Introductory puzzles</summary>");
    for (const level of solved) {
      expect(collection).toContain(
        `aria-label="Puzzle ${level + 1}: ${PUZZLES[level]!.name}, solved"`,
      );
    }
    expect(markup.replace(collection, "")).not.toMatch(
      /solved-mark|of 8 introductory/,
    );
    expect(footer(markup)).not.toContain("solved");
  });

  it.each([false, true])(
    "keeps New puzzle outside the closed introduction, respecting busy=%s",
    (busy) => {
      const game = createRelay({
        generator: {
          moves: 1,
          goal: 1,
          difficulty: "beginner",
          seed: "generated-navigation-new-puzzle",
        },
      });
      const markup = renderGame(game, busy);
      const collection = introCollection(markup);
      const button = markup.match(
        /<button\b[^>]*class="new-puzzle"[^>]*>New puzzle<\/button>/,
      )?.[0];

      expect(collection).not.toMatch(/^<details\b[^>]*\bopen/);
      expect(collection).not.toContain("New puzzle");
      expect(button).toBeDefined();
      expect(markup.indexOf(button ?? "")).toBeGreaterThan(
        markup.indexOf("</details>"),
      );
      expect(button?.includes("disabled")).toBe(busy);
    },
  );
});
