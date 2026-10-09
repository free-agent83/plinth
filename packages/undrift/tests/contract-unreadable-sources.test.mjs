// A source that is there but cannot be read (a directory where a file was meant, a
// token file with a trailing comma) used to throw out of loadContract, and every
// caller blamed the config: the CLI printed a bare parser message, and the hook told
// the agent "Undrift could not read undrift.config.json" and checked nothing at all.
// It is a source problem, like a missing one. It is recorded as { key, path, reason },
// the run goes on with what could be read, and the report names the file and why.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";
import { collectNotChecked, rulesNotRun } from "../src/unchecked.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "../bin/undrift.mjs");
const HOOK = resolve(here, "../hooks/undrift-hook.mjs");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const DASH = /[\u2014\u2013]/;
const BAD = `export const B = () => <div style={{ color: "#ff0000" }} />;\n`;
const GOOD = `export const G = () => <div className="bg-primary p-4" />;\n`;
const RULES = ["no-raw-colors", "no-unknown-tokens"];

function fixture(config, files = {}, dirs = []) {
  const dir = mkdtempSync(join(tmpdir(), "undrift-unreadable-"));
  mkdirSync(join(dir, "ds"), { recursive: true });
  mkdirSync(join(dir, "app"), { recursive: true });
  for (const rel of dirs) mkdirSync(join(dir, rel), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  writeFileSync(
    join(dir, "undrift.config.json"),
    JSON.stringify({ system: "@acme/ds", profiles: { app: { include: ["app/**/*.tsx"], rules: RULES } }, ...config })
  );
  return dir;
}

const cli = (root, argv) => {
  try {
    return { code: 0, out: strip(execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })) };
  } catch (e) {
    return { code: exited(e), out: strip((e.stdout ?? "") + (e.stderr ?? "")) };
  }
};
const hook = (root, file) => {
  try {
    const stdout = execFileSync(process.execPath, [HOOK], {
      input: JSON.stringify({ tool_input: { file_path: file } }),
      cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

const GOOD_TOKENS = { "--color-a": "#111111" };

describe("loadContract records a source it cannot read, and does not throw", () => {
  test("token JSON with a trailing comma", () => {
    const c = loadContract(fixture({ tokens: "ds/tokens.json" }, { "ds/tokens.json": '{ "--color-a": "#111111", }' }));
    expect(c.unreadableSources).toHaveLength(1);
    expect(c.unreadableSources[0]).toMatchObject({ key: "tokens", path: "ds/tokens.json" });
    expect(c.unreadableSources[0].reason).toMatch(/^it is not valid JSON: /);
    expect(c.missingSources).toEqual([]);
    expect(c.tokens).toEqual({});
  });

  test.each([["an array", "[]"], ["a string", '"x"'], ["null", "null"], ["a number", "3"]])(
    "token JSON that is %s is not a token file",
    (_label, body) => {
      const c = loadContract(fixture({ tokens: "ds/tokens.json" }, { "ds/tokens.json": body }));
      expect(c.unreadableSources).toEqual([{ key: "tokens", path: "ds/tokens.json", reason: "it is not a JSON object of tokens" }]);
    }
  );

  test("a directory where a token file was meant", () => {
    const c = loadContract(fixture({ tokens: "ds/tokens.json" }, {}, ["ds/tokens.json"]));
    expect(c.unreadableSources).toEqual([{ key: "tokens", path: "ds/tokens.json", reason: "it is a directory, not a file" }]);
  });

  test.each([
    ["tokensCss", { tokensCss: "ds/theme.css" }, "ds/theme.css"],
    ["catalog", { catalog: "ds/CATALOG.md" }, "ds/CATALOG.md"],
    ["componentsFrom", { componentsFrom: "ds/index.d.ts" }, "ds/index.d.ts"],
  ])("a directory where the %s source was meant", (key, config, path) => {
    const c = loadContract(fixture(config, {}, [path]));
    expect(c.unreadableSources).toEqual([{ key, path, reason: "it is a directory, not a file" }]);
    expect(c.missingSources).toEqual([]);
  });

  test.skipIf(process.getuid?.() === 0)("a file the process may not open", () => {
    const root = fixture({ tokensCss: "ds/theme.css" }, { "ds/theme.css": ":root{--color-a:#111}" });
    chmodSync(join(root, "ds/theme.css"), 0o000);
    try {
      const c = loadContract(root);
      expect(c.unreadableSources).toEqual([{ key: "tokensCss", path: "ds/theme.css", reason: "permission denied" }]);
    } finally {
      chmodSync(join(root, "ds/theme.css"), 0o644);
    }
  });

  test("the sources that can be read are still read, in the list they are in", () => {
    const c = loadContract(
      fixture(
        { tokensCss: ["ds/dir.css", "ds/theme.css"] },
        { "ds/theme.css": ":root{--color-b:#222222}" },
        ["ds/dir.css"]
      )
    );
    expect(c.unreadableSources).toEqual([{ key: "tokensCss", path: "ds/dir.css", reason: "it is a directory, not a file" }]);
    expect(c.tokens["--color-b"]).toBeDefined();
  });

  test("a catalog that cannot be read falls back to the package's own list", () => {
    const c = loadContract(
      fixture(
        { catalog: "ds/CATALOG.md", componentsFrom: "ds/index.d.ts" },
        // Button.d.ts is there, so the barrel is followed in full: a star that points at nothing
        // would leave the list incomplete.
        { "ds/index.d.ts": "export * from './Button';\n", "ds/Button.d.ts": "export declare const Button: any;\n" },
        ["ds/CATALOG.md"]
      )
    );
    expect(c.unreadableSources.map((s) => s.key)).toEqual(["catalog"]);
    expect(c.catalog.map((x) => x.name)).toEqual(["Button"]);
    expect(c.catalogComplete).toBe(true);
  });

  test("they are still configured sources", () => {
    const c = loadContract(fixture({ tokens: "ds/tokens.json" }, {}, ["ds/tokens.json"]));
    expect(c.configuredSources).toEqual([{ key: "tokens", path: "ds/tokens.json" }]);
  });

  test("a source that reads fine is not recorded, and a missing one is recorded as missing, not unreadable", () => {
    const c = loadContract(
      fixture({ tokens: "ds/tokens.json", tokensCss: ["ds/nope.css"] }, { "ds/tokens.json": JSON.stringify(GOOD_TOKENS) })
    );
    expect(c.unreadableSources).toEqual([]);
    expect(c.missingSources).toEqual([{ key: "tokensCss", path: "ds/nope.css" }]);
    expect(c.tokens).toEqual(GOOD_TOKENS);
  });

  test("the config file itself with a trailing comma is still the config's problem", () => {
    const root = fixture({});
    writeFileSync(join(root, "undrift.config.json"), '{ "system": "@acme/ds", }');
    expect(() => loadContract(root)).toThrow(/^undrift\.config\.json is not valid JSON: /);
  });
});

test.each([["null", "null"], ["an array", "[]"], ["a string", '"x"']])(
  "a config file that is %s is a config error, not a TypeError",
  (_label, body) => {
    const root = fixture({});
    writeFileSync(join(root, "undrift.config.json"), body);
    expect(() => loadContract(root)).toThrow(/^undrift\.config\.json must be a JSON object\.$/);
  }
);

test("a config file that cannot be opened names the file and the reason", () => {
  const root = fixture({});
  rmSync(join(root, "undrift.config.json"));
  mkdirSync(join(root, "undrift.config.json"));
  expect(() => loadContract(join(root, "undrift.config.json"))).toThrow(/^undrift\.config\.json could not be read: it is a directory, not a file$/);
});

describe("what the report says", () => {
  const broken = () => loadContract(fixture({ tokens: "ds/tokens.json" }, { "ds/tokens.json": '{ "--color-a": "#111111", }' }));

  test("an item of its own, naming the file, the reason and what it cost", () => {
    const items = collectNotChecked({ contract: broken(), runs: [{ name: "app", files: 1, rulesNotRun: [] }] });
    const source = items.find((i) => i.kind === "source");
    expect(source).toMatchObject({ kind: "source", key: "tokens", path: "ds/tokens.json" });
    expect(source.reason).toMatch(/^tokens "ds\/tokens\.json" could not be read \(it is not valid JSON: .+\), so it contributed no tokens\.$/);
    expect(source.fix).toBe("Repair it, or correct the path in undrift.config.json.");
    expect(source.reason).not.toMatch(/does not exist/);
  });

  test("a missing source and an unreadable one are two items, missing first", () => {
    const c = loadContract(
      fixture({ tokensCss: ["ds/gone.css", "ds/dir.css"] }, {}, ["ds/dir.css"])
    );
    const sources = collectNotChecked({ contract: c, runs: [{ name: "app", files: 1, rulesNotRun: [] }] }).filter((i) => i.kind === "source");
    expect(sources.map((i) => i.path)).toEqual(["ds/gone.css", "ds/dir.css"]);
    expect(sources[0].reason).toMatch(/does not exist/);
    expect(sources[1].reason).toMatch(/could not be read \(it is a directory, not a file\)/);
  });

  test("the rule that needed the tokens says why it could not run, naming the unreadable file", () => {
    const [entry] = rulesNotRun(broken(), ["no-unknown-tokens"]);
    expect(entry.rule).toBe("no-unknown-tokens");
    expect(entry.reason).toMatch(/^No token was loaded, because tokens "ds\/tokens\.json" could not be read \(it is not valid JSON: .+\), so an unknown var\(--name\)/);
    expect(entry.fix).toBe("Repair the token source, or correct its path in undrift.config.json.");
  });

  test("with one source missing and another unreadable, both are named", () => {
    const c = loadContract(fixture({ tokensCss: ["ds/gone.css", "ds/dir.css"] }, {}, ["ds/dir.css"]));
    const [entry] = rulesNotRun(c, ["no-unknown-tokens"]);
    expect(entry.reason).toContain('tokensCss "ds/gone.css" does not exist');
    expect(entry.reason).toContain('tokensCss "ds/dir.css" could not be read (it is a directory, not a file)');
    expect(entry.fix).toBe("Build the token source, or correct its path in undrift.config.json.");
  });

  test("the component rule names an unreadable componentsFrom", () => {
    const c = loadContract(fixture({ componentsFrom: "ds/index.d.ts" }, {}, ["ds/index.d.ts"]));
    const [entry] = rulesNotRun(c, ["no-unknown-components"]);
    expect(entry.reason).toMatch(/^No component list was loaded, because componentsFrom "ds\/index\.d\.ts" could not be read \(it is a directory, not a file\), so a component name cannot be checked\.$/);
    expect(entry.fix).toBe("Repair the component source, or correct its path in undrift.config.json.");
  });

  test("no message carries a dash", () => {
    const c = loadContract(
      fixture({ tokens: "ds/tokens.json", tokensCss: ["ds/dir.css"], catalog: "ds/CATALOG.md", componentsFrom: "ds/index.d.ts" }, { "ds/tokens.json": "{,}" }, ["ds/dir.css", "ds/CATALOG.md", "ds/index.d.ts"])
    );
    const items = collectNotChecked({ contract: c, runs: [{ name: "app", files: 1, rulesNotRun: rulesNotRun(c, RULES.concat("no-unknown-components")) }] });
    expect(JSON.stringify(items)).not.toMatch(DASH);
  });
});

describe("end to end", () => {
  const TOKENS_BROKEN = { tokens: "ds/tokens.json", tokensCss: "ds/theme.css" };
  const files = { "ds/tokens.json": '{ "--color-a": "#111111", }', "ds/theme.css": ":root{--color-primary:#3b5bdb}", "app/a.tsx": GOOD };

  test("the gate names the file, and runs on what it could read", () => {
    const root = fixture({ ...TOKENS_BROKEN, ignore: { "ds/**": "the token sources" } }, files);
    const r = cli(root, ["gate"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('tokens "ds/tokens.json" could not be read (it is not valid JSON');
    expect(r.out).not.toMatch(/^undrift: /m);
    expect(r.out).not.toMatch(/on-system|clean\b.*not checked/);
    expect(r.out).toMatch(/profile app {2}1 file\(s\)/);
  });

  test("a violation is still found while a source is unreadable", () => {
    const root = fixture({ ...TOKENS_BROKEN, ignore: { "ds/**": "the token sources" } }, { ...files, "app/bad.tsx": BAD });
    const r = cli(root, ["gate"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[no-raw-colors]");
  });

  test("--strict does not pass", () => {
    const root = fixture({ ...TOKENS_BROKEN, ignore: { "ds/**": "the token sources" } }, files);
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("could not be read");
  });

  test("the JSON carries the item", () => {
    const root = fixture({ ...TOKENS_BROKEN, ignore: { "ds/**": "the token sources" } }, files);
    const j = JSON.parse(cli(root, ["gate", "--format", "json"]).out);
    expect(j.notChecked.find((i) => i.kind === "source")).toMatchObject({ key: "tokens", path: "ds/tokens.json" });
    expect(j.pass).toBe(true);
  });

  test("the hook tells the agent which file, and does not blame the config", () => {
    const root = fixture({ ...TOKENS_BROKEN, ignore: { "ds/**": "the token sources" } }, files);
    const r = hook(root, join(root, "app/a.tsx"));
    expect(r.code).toBe(0);
    const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(text).toContain('tokens "ds/tokens.json" could not be read');
    expect(text).not.toContain("Undrift could not read undrift.config.json");
    expect(text).not.toMatch(DASH);
    // told once
    expect(hook(root, join(root, "app/a.tsx"))).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("the hook still blocks a violation while a source is unreadable", () => {
    const root = fixture({ ...TOKENS_BROKEN, ignore: { "ds/**": "the token sources" } }, { ...files, "app/bad.tsx": BAD });
    const r = hook(root, join(root, "app/bad.tsx"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("#ff0000");
    expect(r.stderr).toContain('tokens "ds/tokens.json" could not be read');
  });

  test("a directory named as a source is reported the same way", () => {
    const root = fixture({ tokens: "ds/tokens.json", ignore: { "ds/**": "x" } }, { "app/a.tsx": GOOD }, ["ds/tokens.json"]);
    const r = cli(root, ["gate"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('tokens "ds/tokens.json" could not be read (it is a directory, not a file)');
  });
});
