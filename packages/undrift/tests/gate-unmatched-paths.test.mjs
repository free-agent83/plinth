// An argument to `undrift gate <paths>` that finds no file is a typo or a stale
// glob. It used to be dropped in silence as long as one other argument matched:
// `gate --strict app/a.tsx app/bb.tsx` printed "1 file(s) clean" and exited 0 over a
// file nobody had named correctly. Each argument that matched nothing is reported
// for itself, and the profile line does not call the run clean.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";
import { gateProfile } from "../src/gate.mjs";

const bin = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/undrift.mjs");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const cli = (root, argv) => {
  try {
    return { code: 0, out: strip(execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })) };
  } catch (e) {
    return { code: exited(e), out: strip((e.stdout ?? "") + (e.stderr ?? "")) };
  }
};
const json = (root, argv) => JSON.parse(cli(root, ["gate", "--format", "json", ...argv]).out);

const GOOD = `export const G = () => <div className="bg-primary p-4" />;\n`;
const BAD = `export const B = () => <div style={{ color: "#ff0000" }} />;\n`;

function repo(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "u-unmatched-"));
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("ds.css", ":root{--color-primary:#3b5bdb}");
  write("app/a.tsx", GOOD);
  write("app/b.tsx", BAD);
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  write(
    "undrift.config.json",
    JSON.stringify({
      system: "@acme/ds",
      tokensCss: "ds.css",
      ignore: { "ds.css": "the token source" },
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } },
    })
  );
  return root;
}

describe("a typo among explicit paths", () => {
  test("is reported for itself, and strict fails on it, though another argument matched", () => {
    const root = repo();
    const r = cli(root, ["gate", "--strict", "app/a.tsx", "app/bb.tsx"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/The path given \(app\/bb\.tsx\) matched no files, so no rule ran for it\./);
    expect(r.out).toMatch(/Fix: Check the path, and quote a glob so the shell does not expand it first\./);
    expect(r.out).not.toMatch(/on-system|✓ clean/);
  });

  test("the profile line does not call the run clean", () => {
    const root = repo();
    const r = cli(root, ["gate", "app/a.tsx", "app/bb.tsx"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}⚠ no violations, 1 path matched no files/);
    expect(r.out).toMatch(/⚠ 1 not checked/);
  });

  test("the JSON has one item for it, located by the argument", () => {
    const root = repo();
    const j = json(root, ["--strict", "app/a.tsx", "app/bb.tsx"]);
    expect(j.pass).toBe(false);
    expect(j.notChecked).toHaveLength(1);
    expect(j.notChecked[0]).toMatchObject({ kind: "profile", profile: "app", paths: ["app/bb.tsx"] });
    expect(j.runs[0].files).toBe(1);
    expect(j.runs[0].unmatched).toEqual(["app/bb.tsx"]);
  });

  test("two typos are two items, in the order given", () => {
    const root = repo();
    const j = json(root, ["app/aa.tsx", "app/a.tsx", "app/cc.tsx"]);
    expect(j.notChecked.map((i) => i.paths[0])).toEqual(["app/aa.tsx", "app/cc.tsx"]);
  });

  test("the same typo twice is one item", () => {
    const root = repo();
    const j = json(root, ["app/a.tsx", "app/bb.tsx", "app/bb.tsx"]);
    expect(j.notChecked).toHaveLength(1);
  });

  test("a glob that matches nothing is a typo too", () => {
    const root = repo();
    const j = json(root, ["app/a.tsx", "nothing/**/*.tsx"]);
    expect(j.notChecked).toHaveLength(1);
    expect(j.notChecked[0].paths).toEqual(["nothing/**/*.tsx"]);
  });

  test("a directory is not a file, so naming one is reported", () => {
    const root = repo();
    expect(json(root, ["app/a.tsx", "app"]).notChecked[0].paths).toEqual(["app"]);
  });
});

describe("what is not reported", () => {
  test("arguments that all match: no item, and the run is clean", () => {
    const root = repo();
    const r = cli(root, ["gate", "--strict", "app/a.tsx"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}✓ clean/);
    expect(json(root, ["--strict", "app/a.tsx"]).notChecked).toEqual([]);
  });

  test("a glob that matches, and a literal file it also matches, are both fine", () => {
    const root = repo();
    const j = json(root, ["app/a.tsx", "app/*.tsx"]);
    expect(j.notChecked).toEqual([]);
    expect(j.runs[0].files).toBe(2);
  });

  test("a negation that removes files is not a path that matched nothing", () => {
    const root = repo();
    const j = json(root, ["app/**/*.tsx", "!app/b.tsx"]);
    expect(j.notChecked).toEqual([]);
    expect(j.runs[0].files).toBe(1);
    expect(j.runs[0].unmatched).toEqual([]);
  });

  test("a whole-repository run has no explicit arguments to be wrong", () => {
    const root = repo();
    expect(json(root, []).runs[0].unmatched).toBeUndefined();
  });
});

describe("only negations", () => {
  test("arguments that are all negations gate nothing, and say so", () => {
    const root = repo();
    const r = cli(root, ["gate", "--strict", "!app/b.tsx"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/matched no files/);
    expect(r.out).toMatch(/profile app {2}0 file\(s\) {2}⚠ no files matched/);
    expect(r.out).not.toMatch(/on-system|✓ clean/);
  });
});

describe("the programmatic route", () => {
  test("gateProfile returns the arguments that matched nothing", () => {
    const root = repo();
    const r = gateProfile("app", { contract: loadContract(root), extraPatterns: ["app/a.tsx", "app/bb.tsx", "zzz/**"] });
    expect(r.files).toBe(1);
    expect(r.unmatched).toEqual(["app/bb.tsx", "zzz/**"]);
  });

  test("a run over the profile's own include has no unmatched list", () => {
    const r = gateProfile("app", { contract: loadContract(repo()) });
    expect(r.unmatched).toBeUndefined();
  });
});

describe("no new string carries a dash", () => {
  test("text and JSON", () => {
    const root = repo();
    expect(cli(root, ["gate", "--strict", "app/a.tsx", "app/bb.tsx"]).out).not.toMatch(/[\u2014\u2013]/);
    expect(cli(root, ["gate", "--format", "json", "app/a.tsx", "app/bb.tsx"]).out).not.toMatch(/[\u2014\u2013]/);
  });
});
