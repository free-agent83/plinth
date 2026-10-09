// `undrift gate <paths>` used to send every argument through fast-glob, where
// `(group)` and `[param]` are syntax. In a Next.js or Remix app those are ordinary
// folder names (`app/(dashboard)/[id]/page.tsx`), so a real file named on the
// command line matched nothing and the run read as clean. An argument that names
// an existing file is now a literal path. Only an argument that is not an
// existing file is a glob, and a pattern that matches nothing is still reported.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gateProfile } from "../src/gate.mjs";
import { loadContract } from "../src/contract.mjs";

const bin = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/undrift.mjs");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const cli = (root, argv) => {
  try {
    const stdout = execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, out: strip(stdout) };
  } catch (e) {
    return { code: exited(e), out: strip((e.stdout ?? "") + (e.stderr ?? "")) };
  }
};

const BAD = `export default function Page() { return <div style={{ color: "#ff0000" }} />; }\n`;
const GOOD = `export default function Page() { return <div className="bg-primary" />; }\n`;

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "u-literal-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  writeFileSync(join(root, "ds.css"), ":root{--color-primary:#3b5bdb}");
  writeFileSync(
    join(root, "undrift.config.json"),
    JSON.stringify({
      system: "@acme/ds",
      tokensCss: "ds.css",
      ignore: { "ds.css": "the token source" },
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } },
    })
  );
  return root;
}

// Every folder name here is real, and to fast-glob every one is syntax that matches
// something else. Each was seen to gate nothing before the fix. Names that
// fast-glob happens to match by accident (a lone `[slug]`, `@modal`) are left out:
// a test that cannot fail against the old code does not show the bug.
const REAL_NAMES = [
  ["a route group", "app/(dashboard)/page.tsx"],
  ["a route group and a dynamic segment", "app/(dashboard)/[id]/page.tsx"],
  ["a catch-all segment", "app/[...rest]/page.tsx"],
  ["an optional catch-all segment", "app/[[...rest]]/page.tsx"],
  ["a brace in a folder name", "app/{x,y}/page.tsx"],
];

describe.each(REAL_NAMES)("a real file inside %s", (_label, rel) => {
  test("is gated when named on the command line, and the violation is caught", () => {
    const root = repo({ [rel]: BAD });
    const r = cli(root, ["gate", rel]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}✗ 1 violation/);
    expect(r.out).toContain("[no-raw-colors]");
    expect(r.out).toContain("#ff0000");
    expect(r.out).not.toMatch(/on-system|✓ clean|matched no files/);
  });

  test("a clean one is gated too, and reported as one file checked, not as nothing matched", () => {
    const root = repo({ [rel]: GOOD });
    const r = cli(root, ["gate", rel]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}✓ clean/);
    expect(r.out).not.toMatch(/matched no files/);
  });
});

describe("literal paths and patterns together", () => {
  const FILES = {
    "app/(dashboard)/[id]/page.tsx": BAD,
    "app/plain/page.tsx": BAD,
    "app/plain/other.tsx": GOOD,
  };

  test("a literal path and a glob in one call are both gated", () => {
    const root = repo(FILES);
    const r = cli(root, ["gate", "app/(dashboard)/[id]/page.tsx", "app/plain/*.tsx"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/profile app {2}3 file\(s\)/);
    expect(r.out).toMatch(/2 violations/);
    expect(r.out).toContain("(dashboard)/[id]/page.tsx");
    expect(r.out).toContain("plain/page.tsx");
  });

  test("a file named both literally and by a glob is gated once, not twice", () => {
    const root = repo(FILES);
    const r = cli(root, ["gate", "app/plain/page.tsx", "app/plain/*.tsx"]);
    expect(r.out).toMatch(/profile app {2}2 file\(s\)/);
    expect(r.out).toMatch(/1 violation\b/);
  });

  test("a glob that is not a file is still a glob", () => {
    const root = repo(FILES);
    const r = cli(root, ["gate", "app/**/*.tsx"]);
    expect(r.out).toMatch(/profile app {2}3 file\(s\)/);
    expect(r.out).toMatch(/2 violations/);
  });

  test("an absolute path to a real file is literal too", () => {
    const root = repo(FILES);
    const r = cli(root, ["gate", join(root, "app/(dashboard)/[id]/page.tsx")]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/profile app {2}1 file\(s\)/);
  });

  // If --strict were a flag that takes a value, `--strict <path>` would swallow the path
  // and the run would fall back to the whole repository, which passes when the repository
  // is clean and so proves nothing. A bad file elsewhere makes the fallback fail, so a run
  // that gated the named file passes and a run that gated everything does not.
  test("--strict before or after a literal path behaves the same, and gates only that path", () => {
    const root = repo({ "app/(dashboard)/[id]/page.tsx": GOOD, "app/plain/bad.tsx": BAD });
    const before = cli(root, ["gate", "--strict", "app/(dashboard)/[id]/page.tsx"]);
    const after = cli(root, ["gate", "app/(dashboard)/[id]/page.tsx", "--strict"]);
    expect(before.code).toBe(0);
    expect(after.code).toBe(0);
    expect(before.out).toMatch(/profile app {2}1 file\(s\) {2}✓ clean/);
    expect(after.out).toMatch(/profile app {2}1 file\(s\) {2}✓ clean/);
    expect(before.out).not.toContain("[no-raw-colors]");
    // the control: the same repository, gated whole, does fail
    expect(cli(root, ["gate", "--strict"]).code).toBe(1);
  });

  test.each(["--force", "--explain"])("%s is a flag with no value too, and does not take the path after it", (flag) => {
    const root = repo({ "app/plain/page.tsx": GOOD, "app/plain/bad.tsx": BAD });
    const r = cli(root, ["gate", flag, "app/plain/page.tsx"]);
    expect(r.out).toMatch(/profile app {2}1 file\(s\)/);
    expect(r.code).toBe(0);
  });
});

// The reporting from the rest of this task still fires for what matches nothing.
describe("what matches nothing is still reported", () => {
  test("a pattern that matches nothing", () => {
    const root = repo({ "app/plain/page.tsx": GOOD });
    const r = cli(root, ["gate", "nothing/**/*.tsx"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/The path given \(nothing\/\*\*\/\*\.tsx\) matched no files/);
    expect(r.out).toMatch(/profile app {2}0 file\(s\) {2}⚠ no files matched/);
    expect(cli(root, ["gate", "--strict", "nothing/**/*.tsx"]).code).toBe(1);
  });

  test("a literal-looking path that is not a real file", () => {
    const root = repo({ "app/plain/page.tsx": GOOD });
    const r = cli(root, ["gate", "app/(dashboard)/[id]/page.tsx"]);
    expect(r.out).toMatch(/matched no files/);
    expect(r.out).not.toMatch(/on-system|✓ clean/);
    expect(cli(root, ["gate", "--strict", "app/(dashboard)/[id]/page.tsx"]).code).toBe(1);
  });

  test("a directory is not a file, so it stays a pattern and matches nothing", () => {
    const root = repo({ "app/plain/page.tsx": GOOD });
    const r = cli(root, ["gate", "app/plain"]);
    expect(r.out).toMatch(/matched no files/);
  });

  // The file is gated. The pattern that matched nothing is reported for itself: an
  // argument that finds nothing is a typo or a stale glob, and a run that drops it in
  // silence reads as clean over a file nobody named correctly.
  test("a real file plus a pattern that matches nothing: the file is gated, and the pattern is reported", () => {
    const root = repo({ "app/(dashboard)/[id]/page.tsx": GOOD });
    const r = cli(root, ["gate", "app/(dashboard)/[id]/page.tsx", "nothing/**/*.tsx"]);
    expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}⚠ no violations, 1 path matched no files/);
    expect(r.out).toMatch(/The path given \(nothing\/\*\*\/\*\.tsx\) matched no files/);
    expect(r.out).not.toMatch(/on-system|✓ clean/);
  });
});

describe("gateProfile with extraPatterns (the programmatic route)", () => {
  test("gates a real file whose name is glob syntax", () => {
    const root = repo({ "app/(dashboard)/[id]/page.tsx": BAD });
    const contract = loadContract(root);
    const r = gateProfile("app", { contract, extraPatterns: ["app/(dashboard)/[id]/page.tsx"] });
    expect(r.files).toBe(1);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].file).toMatch(/\(dashboard\)\/\[id\]\/page\.tsx$/);
  });

  test("with no extra patterns it still runs the profile's include", () => {
    const root = repo({ "app/(dashboard)/[id]/page.tsx": BAD, "app/plain/page.tsx": GOOD });
    const r = gateProfile("app", { contract: loadContract(root) });
    expect(r.files).toBe(2);
  });
});
