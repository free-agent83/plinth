// The whole-repository scan reads directories, and a directory the process cannot read
// is not ENOENT: fast-glob throws, and the whole run died with "EACCES: permission
// denied, scandir". Two kinds of directory were behind it.
//
// A package's own build output (dist, build, out, coverage beside a package.json) is
// skipped, but only after the walk had found what was in it, and the walk went in to
// find out. The scan now knows a directory is a package's before it goes into its
// children, so owned output is never opened.
//
// Every other directory it cannot read is not a crash and not silence: it is a place
// whose UI files and stylesheets were not checked, and the run says so and names it.
import { afterEach, describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";
import { classifyCoverage, collectNotChecked, findSourceFiles, accountFor } from "../src/unchecked.mjs";
import { gateFiles } from "../src/gate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "../bin/undrift.mjs");
const HOOK = resolve(here, "../hooks/undrift-hook.mjs");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const asRoot = process.getuid?.() === 0; // a process that runs as root can read a directory whatever its mode
const GOOD = `export const G = () => <div className="bg-primary p-4" />;\n`;

const locked = [];
afterEach(() => {
  while (locked.length > 0) {
    try { chmodSync(locked.pop(), 0o755); } catch { /* already gone */ }
  }
});

function repo(files, over = {}, lockedDirs = []) {
  const root = mkdtempSync(join(tmpdir(), "u-walk-"));
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("ds.css", ":root{--color-primary:#3b5bdb}");
  write("app/a.tsx", GOOD);
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  write(
    "undrift.config.json",
    JSON.stringify({
      system: "@acme/ds",
      tokensCss: "ds.css",
      ignore: { "ds.css": "the token source" },
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } },
      ...over,
    })
  );
  for (const dir of lockedDirs) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "x.tsx"), GOOD);
    chmodSync(join(root, dir), 0o000);
    locked.push(join(root, dir));
  }
  return root;
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
    return { code: 0, stdout: execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_input: { file_path: file } }), cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }), stderr: "" };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

describe.skipIf(asRoot)("a package's own build output is never opened", () => {
  const PACKAGES = { "package.json": "{}", "packages/ui/package.json": "{}" };

  test.each([
    ["a package's dist", "packages/ui/dist/locked"],
    ["the root package's build", "build/locked"],
    ["the root package's coverage", "coverage/locked"],
    ["the root package's out", "out/locked"],
    ["the root package's dist, deeper", "dist/deep/er/locked"],
  ])("an unreadable directory in %s does not stop the run, and is not reported", (_label, dir) => {
    const root = repo(PACKAGES, {}, [dir]);
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✓ on-system/);
    expect(r.out).not.toMatch(/EACCES|could not be read/);
  });

  test("the scan finds nothing to report there, and the coverage counts are whole", () => {
    const root = repo(PACKAGES, {}, ["packages/ui/dist/locked"]);
    const c = loadContract(root);
    expect(findSourceFiles(c).unreadable).toEqual([]);
    expect(classifyCoverage(c).counts).toMatchObject({ uiFiles: 1, covered: 1, notCovered: 0 });
  });

  test("where no package.json sits beside it, dist is source, and an unreadable directory in it is reported", () => {
    const root = repo({}, {}, ["dist/locked"]);
    const found = findSourceFiles(loadContract(root));
    expect(found.unreadable).toEqual([{ path: "dist/locked", reason: "permission denied" }]);
  });
});

describe.skipIf(asRoot)("a directory that cannot be read anywhere else is a place that was not checked", () => {
  test("the scan lists it, with why, and the run does not die", () => {
    const root = repo({}, {}, ["lib/locked"]);
    const found = findSourceFiles(loadContract(root));
    expect(found.unreadable).toEqual([{ path: "lib/locked", reason: "permission denied" }]);
    expect(found.ui).toEqual(["app/a.tsx"]);
  });

  test("the gate names it under Not checked and passes in normal mode", () => {
    const root = repo({}, {}, ["lib/locked"]);
    const r = cli(root, ["gate"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("1 directory could not be read (permission denied), so any UI file or stylesheet inside it was not checked.");
    expect(r.out).toContain("lib/locked");
    expect(r.out).not.toMatch(/on-system/);
    expect(r.out).not.toMatch(/EACCES|scandir/);
  });

  test("--strict does not pass it", () => {
    const root = repo({}, {}, ["lib/locked"]);
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/--strict: a run that checked less than it was configured to does not pass\./);
  });

  test("the JSON carries an item of its own, with every directory", () => {
    const root = repo({}, {}, ["lib/locked", "src/deep/locked"]);
    const j = JSON.parse(cli(root, ["gate", "--format", "json"]).out);
    const item = j.notChecked.find((i) => i.kind === "directories");
    expect(item).toMatchObject({ kind: "directories", count: 2, files: ["lib/locked", "src/deep/locked"] });
    expect(item.reason).toMatch(/^2 directories could not be read \(permission denied\), so any UI file or stylesheet inside them was not checked\.$/);
    expect(j.coverage.unreadable).toEqual({ found: 2, ignored: 0, notChecked: 2 });
    expect(j.pass).toBe(true);
  });

  test("the fix proposes an ignore entry to the user and does not add one", () => {
    const root = repo({}, {}, ["lib/locked"]);
    const r = cli(root, ["gate"]);
    expect(r.out).toContain('Make it readable, or propose an "ignore" entry, with the reason, to the user; do not add one yourself.');
  });

  test.each([
    ["its own path", { "lib/locked": "a checkout the build user cannot read" }],
    ["the path with /** after it", { "lib/locked/**": "a checkout the build user cannot read" }],
    ["a glob that reaches it", { "lib/**": "vendored" }],
    ["a glob that names it anywhere", { "**/locked": "always a locked directory" }],
  ])("ignore accounts for it by %s", (_label, ignore) => {
    const root = repo({}, { ignore: { "ds.css": "the token source", ...ignore } }, ["lib/locked"]);
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/could not be read/);
    expect(r.out).toMatch(/✓ on-system/);
  });

  test("a directory inside node_modules is never opened, so never reported", () => {
    const root = repo({}, {}, ["node_modules/pkg/locked"]);
    expect(findSourceFiles(loadContract(root)).unreadable).toEqual([]);
  });

  test("a hidden directory is never opened either", () => {
    const root = repo({}, {}, [".cache/locked"]);
    expect(findSourceFiles(loadContract(root)).unreadable).toEqual([]);
  });

  test("a directory that is not readable does not stop the profile's own run", () => {
    const root = repo({}, { profiles: { app: { include: ["**/*.tsx"], rules: ["no-raw-colors"] } } }, ["lib/locked"]);
    const r = gateFiles(["**/*.tsx"], { rules: ["no-raw-colors"], contract: loadContract(root) });
    expect(r.files).toBe(1);
  });

  test("the hook does not stop on it: a profile that would walk the whole tree still answers", () => {
    const root = repo({ "lib/x.tsx": GOOD }, { profiles: { app: { include: ["**/*.tsx"], rules: ["no-raw-colors"] } } }, ["lib/locked"]);
    expect(hook(root, join(root, "app/a.tsx"))).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("the hook's account of a file still works beside an unreadable directory", () => {
    const root = repo({ "lib/x.tsx": GOOD }, {}, ["lib/locked"]);
    expect(accountFor(loadContract(root), "lib/x.tsx")).toEqual({ kind: "ui", status: "notChecked" });
    const r = hook(root, join(root, "lib/x.tsx"));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain("Undrift did not check lib/x.tsx");
  });
});

describe("collectNotChecked with directories", () => {
  test("puts the directories item after the files it could not see, and names each reason", () => {
    const root = repo({});
    const c = loadContract(root);
    const coverage = classifyCoverage(c);
    coverage.unreadable = [
      { path: "lib/a", reason: "permission denied" },
      { path: "lib/b", reason: "permission denied" },
      { path: "lib/c", reason: "not a directory" },
    ];
    const items = collectNotChecked({ contract: c, runs: [{ name: "app", files: 1, rulesNotRun: [] }], coverage });
    const item = items.find((i) => i.kind === "directories");
    expect(item.count).toBe(3);
    expect(item.reason).toBe("3 directories could not be read (permission denied for 2, not a directory for 1), so any UI file or stylesheet inside them was not checked.");
    expect(item.fix).not.toMatch(/[\u2014\u2013]/);
  });
});
