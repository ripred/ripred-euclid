import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(resolve("package.json"));
const manifestPath = require.resolve("devvit/package.json");
const manifest = require(manifestPath);
const bin =
  typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.devvit;
assert.ok(
  bin,
  "Installed Devvit package must provide the devvit CLI executable",
);
const executable = join(dirname(manifestPath), bin);
for (const args of [
  ["--version"],
  ["playtest", "--help"],
  ["upload", "--help"],
]) {
  const output = execFileSync(process.execPath, [executable, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.ok(output.trim(), `Devvit ${args.join(" ")} must return output`);
  console.log(`Devvit ${args.join(" ")}: passed`);
}

const cliRequire = createRequire(manifestPath);
const cliRoot = dirname(cliRequire.resolve("@devvit/cli/package.json"));
const { Project } = await import(
  pathToFileURL(join(cliRoot, "dist/util/project.js"))
);
const { Bundler } = await import(
  pathToFileURL(join(cliRoot, "dist/util/Bundler.js"))
);
const project = await Project.new(process.cwd(), "devvit.json", "Static");
const bundler = new Bundler();
try {
  // Same local compilation path used by upload and playtest; no remote writes.
  const bundles = await bundler.bundle(project, {
    name: "main",
    owner: "ripred",
    version: "0.0.0",
  });
  assert.ok(bundles.length > 0, "Devvit must produce deployable bundles");
  console.log(
    `Devvit config and packaging: passed (${bundles.length} bundle(s))`,
  );
} finally {
  await bundler.dispose();
}
