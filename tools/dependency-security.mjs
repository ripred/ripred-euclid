import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
  statSync,
  realpathSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";

// Resolve the actual transitive dependencies used by this project's tools.
const require = createRequire(resolve("package.json"));
const cliRequire = createRequire(require.resolve("@devvit/cli/package.json"));
const inquirerPath = cliRequire.resolve("inquirer");
const inquirerRequire = createRequire(inquirerPath);
const { default: inquirer } = await import(pathToFileURL(inquirerPath));
const { ExternalEditor, editAsync } = inquirerRequire(
  "@inquirer/external-editor",
);
const { interceptorPlugin } = await import(
  pathToFileURL(require.resolve("@vitest/mocker/node"))
);
const { resolveConfig } = await import(pathToFileURL(require.resolve("vite")));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "euclid-dependencies-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = join(root, "base");
  const outside = join(root, "outside");
  mkdirSync(base);
  mkdirSync(outside);
  return { root, base, outside };
}

test("the installed CLI dependency tree contains no tmp or legacy external-editor", () => {
  const lock = require("./package-lock.json");
  for (const name of Object.keys(lock.packages)) {
    assert.ok(
      !/(?:^|\/)node_modules\/(?:tmp|external-editor)$/.test(name),
      name,
    );
  }
  assert.throws(() => inquirerRequire.resolve("external-editor"), {
    code: "MODULE_NOT_FOUND",
  });
});

for (const [label, options] of [
  ["prefix traversal", { prefix: "../escaped" }],
  ["postfix traversal", { postfix: "/../../escaped" }],
  ["prefix symlink traversal", { prefix: "link/" }],
]) {
  test(`editor contains ${label} within the selected directory`, (t) => {
    const { base, outside } = fixture(t);
    symlinkSync(outside, join(base, "link"), "dir");
    const editor = new ExternalEditor("fixture content", {
      dir: base,
      ...options,
    });
    try {
      assert.equal(dirname(realpathSync(editor.tempFile)), realpathSync(base));
      assert.equal(readFileSync(editor.tempFile, "utf8"), "fixture content");
      assert.deepEqual(readdirSync(outside), []);
    } finally {
      editor.cleanup();
    }
  });
}

for (const options of [
  { prefix: ["../escaped"] },
  { postfix: Buffer.from("/../../escaped") },
]) {
  test(`editor rejects non-string ${Object.keys(options)[0]}`, (t) => {
    const { base } = fixture(t);
    assert.throws(
      () => new ExternalEditor("fixture content", { dir: base, ...options }),
    );
    assert.deepEqual(readdirSync(base), []);
  });
}

for (const [type, question, keys, expected] of [
  ["input", {}, "ripred\n", "ripred"],
  ["confirm", { default: false }, "y\n", true],
  [
    "list",
    {
      choices: [
        { name: "First", value: "first" },
        { name: "Second", value: "second" },
      ],
    },
    "\u001b[B\n",
    "second",
  ],
]) {
  test(
    `Devvit's ${type} prompt accepts terminal input`,
    { timeout: 5000 },
    async (t) => {
      const input = new PassThrough();
      const output = new PassThrough();
      output.resume();
      const prompt = inquirer.createPromptModule({ input, output });
      const answer = prompt([
        { type, name: "answer", message: "Dependency check", ...question },
      ]);
      const timer = setTimeout(() => input.write(keys), 50);
      t.after(() => {
        clearTimeout(timer);
        if (!answer.ui.rl.closed) answer.ui.close();
        input.destroy();
        output.destroy();
      });
      assert.deepEqual(await answer, { answer: expected });
    },
  );
}

test("external-editor preserves text, safe options, and cleanup", (t) => {
  const { base } = fixture(t);
  for (const opts of [
    {},
    { dir: base, prefix: "euclid", postfix: ".txt", mode: 0o600 },
  ]) {
    const editor = new ExternalEditor("Euclid: π and squares\n", opts);
    try {
      assert.equal(
        readFileSync(editor.tempFile, "utf8"),
        "Euclid: π and squares\n",
      );
      if (opts.postfix) {
        assert.ok(editor.tempFile.endsWith(opts.postfix));
        assert.equal(statSync(editor.tempFile).mode & 0o777, 0o600);
      }
    } finally {
      editor.cleanup();
    }
    assert.equal(existsSync(editor.tempFile), false);
  }
});

test("external-editor async editing round trip still works", async (t) => {
  const { root } = fixture(t);
  const script = join(root, "editor.cjs");
  writeFileSync(
    script,
    'require("node:fs").appendFileSync(process.argv[2], " edited");',
  );
  const previous = process.env.VISUAL;
  process.env.VISUAL = `${process.execPath} ${script}`;
  t.after(() => {
    if (previous === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = previous;
  });
  const text = await new Promise((resolve, reject) => {
    editAsync("original", (error, result) =>
      error ? reject(error) : resolve(result),
    );
  });
  assert.equal(text, "original edited");
});

for (const [label, redirect, allowed] of [
  ["allowed project source", "file:///allowed.js", true],
  ["opaque URL traversal outside root", "mock:../outside/private.js", false],
  ["denied in-root environment file", "file:///.env", false],
]) {
  test(`mocker redirect respects Vite file policy: ${label}`, async (t) => {
    const { base, outside } = fixture(t);
    writeFileSync(join(base, "allowed.js"), "export const allowed = true;");
    writeFileSync(join(base, ".env"), "SYNTHETIC_SECRET=private");
    writeFileSync(join(outside, "private.js"), "SYNTHETIC_OUTSIDE_SECRET");
    const config = await resolveConfig(
      {
        configFile: false,
        root: base,
        server: { fs: { strict: true, allow: [base], deny: ["**/.env"] } },
      },
      "serve",
    );
    // Exercise the real registration and load hooks without opening a listener.
    const handlers = new Map();
    const plugin = interceptorPlugin();
    plugin.configureServer({
      config,
      ws: {
        on: (name, handler) => handlers.set(name, handler),
        send() {},
      },
    });
    const id = join(base, "mocked.js");
    handlers.get("vitest:interceptor:register")({
      type: "redirect",
      raw: "./mocked.js",
      id,
      url: id,
      redirect,
    });
    const result = await plugin.load.handler(id);
    assert.equal(result, allowed ? "export const allowed = true;" : undefined);
  });
}

const { readYamlToJson, dumpJsonToYaml } = await import(
  pathToFileURL(
    join(
      dirname(require.resolve("@devvit/cli/package.json")),
      "dist/util/files.js",
    ),
  )
);

function loadDevvitYaml(t, source) {
  const { base } = fixture(t);
  const filename = join(base, "devvit.yaml");
  writeFileSync(filename, source);
  return readYamlToJson(filename);
}

for (const [label, sequenceLength, targets] of [
  ["one oversized sequence of empty mappings", 101, 1],
  ["empty mappings repeated across allowed-size sequences", 100, 101],
]) {
  test(`Devvit YAML loader rejects ${label}`, async (t) => {
    // Bounded fixtures reproduce both limits without a CPU timing assertion.
    const source = `empty: &empty [${Array(sequenceLength).fill("{}").join(",")}]\ntargets:\n${"  - <<: *empty\n".repeat(targets)}`;
    await assert.rejects(loadDevvitYaml(t, source), (error) => {
      assert.equal(error.name, "YAMLException");
      assert.match(error.reason, /merge/i);
      return true;
    });
  });
}

test("Devvit YAML loader preserves aliases, merge precedence, and Unicode", async (t) => {
  const source =
    "defaults: &defaults {enabled: true, retries: 3}\napp:\n  <<: *defaults\n  retries: 2\n  name: 'Euclid π'\n  empty: {}\n";
  const expected = {
    defaults: { enabled: true, retries: 3 },
    app: { enabled: true, retries: 2, name: "Euclid π", empty: {} },
  };
  assert.deepEqual(await loadDevvitYaml(t, source), expected);
  assert.deepEqual(await loadDevvitYaml(t, dumpJsonToYaml(expected)), expected);
});

test("Devvit YAML loader retains empty-document and invalid-syntax behavior", async (t) => {
  assert.equal(await loadDevvitYaml(t, ""), null);
  await assert.rejects(loadDevvitYaml(t, "app: [unterminated"), {
    name: "YAMLException",
  });
});
