// `ignore` says "these files are not checked, and here is why". It is the way out
// of a not-checked report, so it must stay honest: an entry with no reason is a
// config error, the same stance as a <Missing> gap with no reason and a
// `token-exempt:` comment with none. Without that, a blind spot becomes one
// glob and one shrug.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";

const bin = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/undrift.mjs");

function repo(config) {
  const root = mkdtempSync(join(tmpdir(), "u-ignore-"));
  writeFileSync(
    join(root, "undrift.config.json"),
    JSON.stringify({ system: "@acme/ds", profiles: { app: { include: ["app/**/*.tsx"] } }, ...config })
  );
  return root;
}

describe("the ignore key", () => {
  test("is optional, and absent means nothing is ignored", () => {
    expect(loadContract(repo({})).ignore).toEqual({});
  });

  test("carries each glob with its reason", () => {
    const c = loadContract(
      repo({ ignore: { "tests/**": "fixtures with violations on purpose", "legacy/**": "replaced next quarter" } })
    );
    expect(c.ignore).toEqual({
      "tests/**": "fixtures with violations on purpose",
      "legacy/**": "replaced next quarter",
    });
  });

  test("a reason is trimmed", () => {
    expect(loadContract(repo({ ignore: { "a/**": "  because  " } })).ignore).toEqual({ "a/**": "because" });
  });

  test.each([
    ["an empty string", ""],
    ["only spaces", "   "],
    ["only a newline and a tab", "\n\t"],
    ["null", null],
    ["a boolean", true],
    ["a number", 3],
    ["an object", { because: "no" }],
  ])("a reason that is %s is a config error naming the glob", (_label, reason) => {
    const root = repo({ ignore: { "packages/x/**": reason } });
    expect(() => loadContract(root)).toThrow(/"ignore" entry "packages\/x\/\*\*" needs a reason/);
  });

  test("one blank reason among good ones still fails", () => {
    const root = repo({ ignore: { "a/**": "fine", "b/**": " ", "c/**": "also fine" } });
    expect(() => loadContract(root)).toThrow(/"b\/\*\*"/);
  });

  test.each([
    ["an array", ["a/**"]],
    ["a string", "a/**"],
    ["null", null],
    ["a number", 4],
  ])("ignore given as %s is a config error", (_label, ignore) => {
    expect(() => loadContract(repo({ ignore }))).toThrow(/"ignore" must be an object/);
  });

  test("an empty glob is a config error", () => {
    expect(() => loadContract(repo({ ignore: { "": "why" } }))).toThrow(/empty glob/);
  });

  test("the error messages carry no dash", () => {
    const messages = [
      () => loadContract(repo({ ignore: { "x/**": "" } })),
      () => loadContract(repo({ ignore: ["x"] })),
      () => loadContract(repo({ ignore: { "": "why" } })),
    ].map((f) => {
      try { f(); } catch (e) { return e.message; }
      return "";
    });
    for (const m of messages) {
      expect(m).not.toBe("");
      expect(m).not.toMatch(/[\u2014\u2013]/);
    }
  });
});

describe("the CLI", () => {
  const cli = (root, argv) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) };
    } catch (e) {
      return { code: exited(e), out: (e.stdout ?? "") + (e.stderr ?? "") };
    }
  };

  test("a blank ignore reason stops the gate with a usage-style error, not a pass", () => {
    const r = cli(repo({ ignore: { "packages/x/**": " " } }), ["gate"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/"ignore" entry "packages\/x\/\*\*" needs a reason/);
  });
});
