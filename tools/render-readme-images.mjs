import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../docs/images/", import.meta.url);
const server = await createServer({
  root,
  configFile: false,
  cacheDir: `${root}node_modules/.vite-readme`,
  plugins: [react()],
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const { BoardDiagram } = await server.ssrLoadModule(
    "/src/client/ui/BoardDiagram.tsx",
  );
  const { buildWatchDemo } = await server.ssrLoadModule(
    "/src/client/watch-demo.ts",
  );
  const { generateChallenge } = await server.ssrLoadModule(
    "/src/server/challenge-generator.ts",
  );
  const { DEFAULT_CHALLENGE_OPTIONS } = await server.ssrLoadModule(
    "/src/shared/challenge.ts",
  );
  const tokens = await readFile(
    new URL("../src/client/design/tokens.css", import.meta.url),
    "utf8",
  );
  const boardCss = await readFile(
    new URL("../src/client/ui/board.css", import.meta.url),
    "utf8",
  );
  const values = new Map(
    [
      ...tokens
        .split(":root {")[1]
        .split("}")[0]
        .matchAll(/(--[\w-]+):\s*([^;]+);/g),
    ].map((match) => [match[1], match[2].trim()]),
  );
  // Literal colors also work in SVG viewers that don't support CSS variables.
  const resolveStyles = (source) => {
    let resolved = source;
    for (let pass = 0; pass < 4; pass++) {
      resolved = resolved.replace(
        /var\((--[\w-]+)\)/g,
        (match, name) => values.get(name) ?? match,
      );
    }
    return resolved.replace(
      /rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/g,
      "rgba($1, $2, $3, $4)",
    );
  };
  const board = (props) =>
    resolveStyles(renderToStaticMarkup(createElement(BoardDiagram, props)));
  const label = (y, text, size = 26, color = "#b6b6ba", weight = 400) =>
    `<text x="752" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${text}</text>`;
  const art = (title, description, markup, copy) =>
    `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720" role="img" aria-labelledby="title description">
  <title id="title">${title}</title>
  <desc id="description">${description}</desc>
  <style>${resolveStyles(boardCss)}
    text { font-family: Arial, Helvetica, sans-serif; }
    .board * { animation: none; transition: none; }
  </style>
  <rect width="1200" height="720" rx="24" fill="#18181b"/>
  <svg x="24" y="24" width="672" height="672">${markup}</svg>
  ${copy}
</svg>
`.trimStart();

  const demo = buildWatchDemo();
  const squares = demo.m_players.flatMap((player, index) =>
    player.m_squares.map((square, squareIndex) => ({
      key: `${index}-${squareIndex}`,
      owner: index + 1,
      corners: [square.p1, square.p2, square.p3, square.p4],
      tone: "history",
    })),
  );
  const gameImage = art(
    "Euclid: the teaching game",
    "An 8 by 8 board with red and blue pieces completing straight and tilted squares. The last red move completes several squares at once.",
    board({ width: demo.W, height: demo.H, cells: demo.m_board, squares }),
    label(120, "EUCLID", 20, "#b6b6ba", 700) +
      label(195, "Four corners.", 46, "#f5f5f4", 700) +
      label(252, "One square.", 46, "#f5f5f4", 700) +
      label(338, "Tilted ones count too.") +
      label(380, "And one well-placed dot") +
      label(422, "can finish several at once.") +
      label(542, `Red ${demo.m_players[0].m_score}`, 30, "#ff7d6c", 700) +
      label(590, `Blue ${demo.m_players[1].m_score}`, 30, "#93a1ff", 700) +
      label(650, "From the built-in teaching game", 21),
  );

  // This fixed documentation example is independent of every player's session.
  const { puzzle } = generateChallenge(
    { ...DEFAULT_CHALLENGE_OPTIONS, blockedCount: 6 },
    "readme-example-1",
  );
  const cells = Array(64).fill(0);
  for (const point of puzzle.initial) cells[point] = 1;
  const challengeImage = art(
    "Euclid: an example challenge",
    "An unsolved 8 by 8 puzzle with pre-placed red pieces and six blocked points marked with crosses. Three squares can be completed in two moves; their solutions are not shown.",
    board({ width: 8, height: 8, cells, blockedPoints: puzzle.blocked }),
    label(120, "CHALLENGE PLAYGROUND", 20, "#b6b6ba", 700) +
      label(195, `${puzzle.targetSquares} squares.`, 46, "#f5f5f4", 700) +
      label(252, `${puzzle.minimumMoves} moves.`, 46, "#f5f5f4", 700) +
      label(338, "The corners are there.") +
      label(380, "Can you spot what’s missing?") +
      label(482, "Red pieces are already placed.", 23) +
      label(522, "Crossed points are off limits.", 23) +
      label(562, "Extra moves are allowed.", 23) +
      label(650, "Example puzzle · moderator preview", 21),
  );
  await mkdir(output, { recursive: true });
  await writeFile(new URL("euclid-board.svg", output), gameImage);
  await writeFile(new URL("challenge-board.svg", output), challengeImage);
  console.log("Rendered both README boards from the shared game components.");
} finally {
  await server.close();
}
