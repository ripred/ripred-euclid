import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("isolates board artwork from the shell's centered text alignment", () => {
  const css = readFileSync(new URL("./inline-preview.css", import.meta.url), "utf8");
  const artworkRule = css.match(/\.inline-preview__artwork\s*\{([^}]*)\}/)?.[1];

  // Auto-inset absolute SVGs otherwise start halfway across centered boards.
  expect(artworkRule).toMatch(/\btext-align:\s*left\s*;/);
});
