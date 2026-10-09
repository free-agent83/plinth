// Several `undrift later` commands at once, each a real node process: an agent runs one per problem, and
// may run them in parallel. Each reads the list, adds to it and renames it into place, so without the lock
// round the write each kept only its own entry (measured before the lock: 2 of 4 entries survived).
import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bin } from "./support/world.mjs";
import { commitAll } from "./support/git.mjs";

const VALUES = ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777", "#888888"];
const PAGE = [
  "export const P = () => (",
  "  <div>",
  ...VALUES.map((v) => `    <p style={{ color: "${v}" }}>Old</p>`),
  "  </div>",
  ");",
  "",
].join("\n");
const lineOf = (value) => 3 + VALUES.indexOf(value);

function world() {
  const root = mkdtempSync(join(tmpdir(), "u-later-par-"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "ds.css"), ":root{--color-primary:#3b5bdb}");
  writeFileSync(join(root, ".gitignore"), ".undrift/\n");
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
    system: "@acme/ds", tokensCss: "ds.css",
    profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } },
    ignore: { "ds.css": "the token source" },
  }));
  writeFileSync(join(root, "app/page.tsx"), PAGE);
  commitAll(root);
  return root;
}

const together = (root, commands) =>
  Promise.all(
    commands.map(
      (argv) =>
        new Promise((done) => {
          const child = spawn(process.execPath, [bin, "later", ...argv], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
          let out = "";
          child.stdout.on("data", (c) => (out += c));
          child.stderr.on("data", (c) => (out += c));
          child.on("close", (code) => done({ argv, code, out }));
        }),
    ),
  );
const entries = (root) => JSON.parse(readFileSync(join(root, "undrift.later.json"), "utf8")).entries;

describe("undrift later, many at once", () => {
  test("a command per problem, all at once: every deferral is written, and each that says so was", async () => {
    const root = world();
    for (let round = 0; round < 3; round++) {
      const results = await together(root, VALUES.map((v) => ["app/page.tsx", "--line", String(lineOf(v))]));
      expect(results.every((r) => r.code === 0)).toBe(true);
      expect(results.every((r) => /Deferred 1 problem/.test(r.out))).toBe(true);
      expect(entries(root).map((e) => e.value)).toEqual(VALUES);
      // nothing is left behind: no lock, no half-written file
      expect(readdirSync(root).filter((n) => n.startsWith("undrift.later.json")).sort()).toEqual(["undrift.later.json"]);
      writeFileSync(join(root, "undrift.later.json"), JSON.stringify({ version: 1, entries: [] }));
    }
  }, 120000);

  test("the same command several times at once defers the problem once", async () => {
    const root = world();
    const results = await together(root, Array.from({ length: 6 }, () => ["app/page.tsx", "--line", String(lineOf("#333333"))]));
    expect(results.every((r) => r.code === 0)).toBe(true);
    expect(results.filter((r) => /Deferred 1 problem/.test(r.out))).toHaveLength(1);
    expect(entries(root)).toEqual([expect.objectContaining({ value: "#333333", count: 1 })]);
  }, 120000);
});
