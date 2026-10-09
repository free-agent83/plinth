// A route folder called `coverage`, `build`, `out` or `dist` is source: an
// analytics page, a CI dashboard, a Next.js segment. The gate used to skip those
// four names at any depth, so every file in such a folder was invisible to the
// whole-repository run and to the hook, and a violation there passed strict.
// They are skipped now only where they are a package's output, which is to say
// where a package.json sits beside them.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "../bin/undrift.mjs");
const HOOK = resolve(here, "../hooks/undrift-hook.mjs");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
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

const BAD = `export default function P() { return <div style={{ color: "#ff0000" }} />; }\n`;
const GOOD = `export default function P() { return <div className="bg-primary p-4" />; }\n`;

function repo(files, { withPackage = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "u-routes-"));
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("ds.css", ":root{--color-primary:#3b5bdb}");
  if (withPackage) write("package.json", "{}");
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  write(
    "undrift.config.json",
    JSON.stringify({
      system: "@acme/ds",
      tokensCss: "ds.css",
      ignore: { "ds.css": "the token source" },
      profiles: { app: { include: ["app/dashboard/**/*.tsx"], rules: ["no-raw-colors"] } },
    })
  );
  return root;
}
const ROUTES = {
  "app/dashboard/page.tsx": GOOD,
  "app/coverage/page.tsx": BAD,
  "app/build/[id]/page.tsx": BAD,
  "app/out/page.tsx": BAD,
  "app/dist/page.tsx": BAD,
};

describe("routes named like build output, covered by no profile", () => {
  test("fail strict, and are listed as the UI files nothing covers", () => {
    const r = cli(repo(ROUTES), ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/4 UI files are covered by no profile/);
    for (const route of ["app/build/[id]/page.tsx", "app/coverage/page.tsx", "app/dist/page.tsx", "app/out/page.tsx"]) {
      expect(r.out).toContain(route);
    }
    expect(r.out).not.toMatch(/on-system/);
  });

  test("the JSON lists all of them, and counts them among the UI files", () => {
    const j = JSON.parse(cli(repo(ROUTES), ["gate", "--format", "json"]).out);
    const item = j.notChecked.find((i) => i.kind === "files");
    expect(item.files).toEqual(["app/build/[id]/page.tsx", "app/coverage/page.tsx", "app/dist/page.tsx", "app/out/page.tsx"]);
    expect(j.coverage.uiFiles).toBe(5);
    expect(j.coverage.covered).toBe(1);
  });

  test("the hook tells the agent it did not check one, instead of saying nothing", () => {
    const root = repo(ROUTES);
    const r = hook(root, join(root, "app/coverage/page.tsx"));
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain("Undrift did not check app/coverage/page.tsx");
  });

  test("a stylesheet in one is counted too", () => {
    const j = JSON.parse(cli(repo({ ...ROUTES, "app/coverage/report.css": "a{}" }), ["gate", "--format", "json"]).out);
    expect(j.notChecked.find((i) => i.kind === "stylesheets").files).toEqual(["app/coverage/report.css"]);
  });

  test("so are they with no package.json at all: nothing owns them as output", () => {
    const j = JSON.parse(cli(repo(ROUTES, { withPackage: false }), ["gate", "--format", "json"]).out);
    expect(j.coverage.uiFiles).toBe(5);
  });
});

describe("a package's own build output is still skipped", () => {
  const FILES = {
    "app/dashboard/page.tsx": GOOD,
    "dist/bundle.tsx": BAD,
    "dist/theme.css": "a{}",
    "coverage/report.tsx": BAD,
    "packages/ui/package.json": "{}",
    "packages/ui/dist/index.tsx": BAD,
    "packages/ui/build/out.css": "a{}",
  };

  test("beside a package.json, in the root package and in a workspace package", () => {
    const j = JSON.parse(cli(repo(FILES), ["gate", "--format", "json"]).out);
    expect(j.coverage.uiFiles).toBe(1);
    expect(j.notChecked).toEqual([]);
  });

  test("the hook stays silent on it", () => {
    const root = repo(FILES);
    for (const rel of ["dist/bundle.tsx", "dist/theme.css", "packages/ui/dist/index.tsx"]) {
      const r = hook(root, join(root, rel));
      expect(r.code, rel).toBe(0);
      expect(r.stdout, rel).toBe("");
      expect(r.stderr, rel).toBe("");
    }
  });

  test("but a route folder inside the same package is not", () => {
    const root = repo({ ...FILES, "packages/ui/src/app/coverage/page.tsx": BAD });
    const j = JSON.parse(cli(root, ["gate", "--format", "json"]).out);
    expect(j.notChecked.find((i) => i.kind === "files").files).toEqual(["packages/ui/src/app/coverage/page.tsx"]);
  });
});
