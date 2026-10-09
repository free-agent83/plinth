// The whole-repository scan does not follow symlinks (a linked directory would be counted
// twice, and a link back up the tree would loop). The profile globs did follow them, so
// the two disagreed about which files exist: a file reached through a link was gated under
// a second name, its real path was reported as covered by no profile although it had been
// checked, and a link that pointed up the tree made every whole-repository run walk until
// the path grew too long. Neither follows now. A file is its real path: it is gated where
// it lives, once, and a profile covers it by including that path.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";
import { accountFor, classifyCoverage, findSourceFiles, profileFor } from "../src/unchecked.mjs";
import { gateFiles, gateProfile } from "../src/gate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "../bin/undrift.mjs");
const HOOK = resolve(here, "../hooks/undrift-hook.mjs");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const BAD = `export const B = () => <div style={{ color: "#ff0000" }} />;\n`;
const GOOD = `export const G = () => <div className="bg-primary p-4" />;\n`;
const posix = process.platform !== "win32";

const cli = (root, argv, timeout = 15000) => {
  try {
    return { code: 0, signal: null, out: strip(execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout })) };
  } catch (e) {
    return { code: exited(e), signal: e.signal ?? null, out: strip((e.stdout ?? "") + (e.stderr ?? "")) };
  }
};
const hook = (root, file) => {
  try {
    return { code: 0, signal: null, stdout: execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_input: { file_path: file } }), cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 15000 }), stderr: "" };
  } catch (e) {
    return { code: exited(e), signal: e.signal ?? null, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

/** app/a.tsx, the real shared/x.tsx, and both kinds of link to it from inside app/. */
function repo(include = ["app/**/*.tsx"], { cycle = false, ignore = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "u-links-"));
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("ds.css", ":root{--color-primary:#3b5bdb}");
  write("app/a.tsx", GOOD);
  write("shared/x.tsx", BAD);
  symlinkSync("../shared", join(root, "app/shared"));
  symlinkSync("../shared/x.tsx", join(root, "app/alias.tsx"));
  // Two links back up the tree: every level of a walk that follows them is twice the one
  // above, until the operating system refuses to resolve a path that deep. A tiny
  // fixture that follows one takes no time at all, and two do not finish.
  if (cycle) {
    symlinkSync("..", join(root, "app/up"));
    symlinkSync("..", join(root, "app/up2"));
  }
  write(
    "undrift.config.json",
    JSON.stringify({
      system: "@acme/ds",
      tokensCss: "ds.css",
      ignore: { "ds.css": "the token source", ...ignore },
      profiles: { app: { include, rules: ["no-raw-colors"] } },
    })
  );
  return root;
}

describe.skipIf(!posix)("the profile does not follow a link", () => {
  test("a file reached through a linked directory or a linked file is not gated under a second name", () => {
    const root = repo();
    const r = gateFiles(["app/**/*.tsx"], { rules: ["no-raw-colors"], contract: loadContract(root) });
    expect(r.files).toBe(1);
    expect(r.violations).toEqual([]);
  });

  test("the real file is not covered by a profile that reaches it only through a link, and is said to be not covered", () => {
    const root = repo();
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}✓ clean/);
    expect(r.out).toMatch(/1 UI file is covered by no profile/);
    expect(r.out).toContain("shared/x.tsx");
    expect(r.out).not.toContain("app/shared/x.tsx");
    expect(r.out).not.toContain("app/alias.tsx");
  });

  test("including the real path covers it, and its violation is reported once, under that path", () => {
    const root = repo(["app/**/*.tsx", "shared/**/*.tsx"]);
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out.match(/\[no-raw-colors\]/g)).toHaveLength(1);
    expect(r.out).toContain("shared/x.tsx");
    expect(r.out).not.toContain("app/shared/x.tsx");
    expect(r.out).not.toMatch(/covered by no profile/);
  });

  test("the counts add up: every real file is covered or reported, and links are neither", () => {
    const root = repo(["app/**/*.tsx", "shared/**/*.tsx"]);
    const c = loadContract(root);
    const { counts } = classifyCoverage(c);
    expect(counts.uiFiles).toBe(2);
    expect(counts.covered).toBe(2);
    expect(counts.notCovered).toBe(0);
  });

  test("a link that points up the tree does not hang the run", () => {
    const root = repo(["app/**/*.tsx", "shared/**/*.tsx"], { cycle: true });
    const r = cli(root, ["gate"], 15000);
    expect(r.signal, "the run was killed for taking too long").toBeNull();
    expect(r.code).toBe(1);
    expect(r.out).toContain("shared/x.tsx");
  });

  // Each glob over the repository is its own walk, and any one of them following the link
  // would loop. The include is walked by the gate, the profile lookup and the coverage
  // scan; an ignore glob and an explicit path are walked on their own.
  test("an ignore glob that walks the whole tree does not follow a link up it", () => {
    const root = repo(["app/**/*.tsx", "shared/**/*.tsx"], { cycle: true, ignore: { "**/*.md": "docs are not source" } });
    const r = cli(root, ["gate"], 15000);
    expect(r.signal, "the run was killed for taking too long").toBeNull();
    expect(r.code).toBe(1);
  });

  test("an explicit glob does not follow a link either, and does not walk one up the tree", () => {
    const root = repo(["app/**/*.tsx"], { cycle: true });
    const r = cli(root, ["gate", "app/**/*.tsx"], 15000);
    expect(r.signal, "the run was killed for taking too long").toBeNull();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}✓ clean/);
  });

  test("an explicit path that names a link is a file the person asked for, and is gated", () => {
    const root = repo(["app/**/*.tsx"]);
    const r = cli(root, ["gate", "app/alias.tsx"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/profile app {2}1 file\(s\)/);
    expect(r.out).toContain("[no-raw-colors]");
  });

  test("a link that points up the tree does not hang the hook", () => {
    const root = repo(["app/**/*.tsx", "shared/**/*.tsx"], { cycle: true });
    const r = hook(root, join(root, "shared/x.tsx"));
    expect(r.signal, "the hook was killed for taking too long").toBeNull();
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("shared/x.tsx");
  });
});

describe.skipIf(!posix)("the hook and the scan agree", () => {
  const ALL = ["app/a.tsx", "shared/x.tsx", "app/shared/x.tsx", "app/alias.tsx"];

  test("a file edited through a link is the real file: the hook names and gates the real path", () => {
    const root = repo(["app/**/*.tsx", "shared/**/*.tsx"]);
    const r = hook(root, join(root, "app/shared/x.tsx"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("violation(s) in shared/x.tsx");
  });

  test("and says it is not covered when no profile includes the real path", () => {
    const root = repo();
    const r = hook(root, join(root, "app/alias.tsx"));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain("Undrift did not check shared/x.tsx");
  });

  test("the profile lookup and the coverage scan give the same answer for every path that exists", () => {
    const root = repo(["app/**/*.tsx", "shared/**/*.tsx"]);
    const c = loadContract(root);
    const scanned = new Set(findSourceFiles(c).ui);
    expect([...scanned].sort()).toEqual(["app/a.tsx", "shared/x.tsx"]);
    for (const rel of ALL) {
      const link = rel === "app/shared/x.tsx" || rel === "app/alias.tsx";
      // a link is not a file of its own: no profile claims it and the scan does not list it
      expect(profileFor(c, rel) !== null, rel).toBe(!link);
      expect(scanned.has(rel), rel).toBe(!link);
      expect(accountFor(c, rel)?.status === "covered", rel).toBe(!link);
    }
  });

  test("gating a profile whole, and the profile's own files, are the same files", () => {
    const root = repo(["app/**/*.tsx", "shared/**/*.tsx"]);
    const c = loadContract(root);
    const run = gateProfile("app", { contract: c });
    expect(run.files).toBe(2);
    expect(run.violations.map((v) => v.file.split("/").slice(-2).join("/"))).toEqual(["shared/x.tsx"]);
  });
});
