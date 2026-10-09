// Gaps are a success state in the dev loop and a blocker at release. This is
// the file that pins that asymmetry: normal mode lets a valid gap through,
// --strict promotes it to a violation, and a dishonest gap fails either way.
import { expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gateSourceWithGaps, gateFiles } from "../src/gate.mjs";
import { loadContract } from "../src/contract.mjs";

const contract = {
  system: "@acme/ds", tokens: {}, intrinsics: {}, foreignUi: [],
  exemptMarker: "token-exempt", catalog: [{ name: "Button" }], systemImports: [],
};

test("a valid gap produces no violation in normal mode", () => {
  const r = gateSourceWithGaps(`const a = <Missing what="Rating" reason="none exists" />;`, {
    rules: [], contract, fileName: "a.tsx",
  });
  expect(r.violations).toEqual([]);
  expect(r.gaps).toHaveLength(1);
});

test("a valid gap becomes a violation under strict", () => {
  const r = gateSourceWithGaps(`const a = <Missing what="Rating" reason="none exists" />;`, {
    rules: [], contract, fileName: "a.tsx", strict: true,
  });
  expect(r.violations).toHaveLength(1);
  expect(r.violations[0].rule).toBe("unresolved-gap");
});

test("an invalid gap is a violation even in normal mode", () => {
  const r = gateSourceWithGaps(`const a = <Missing what="Button" reason="x" />;`, {
    rules: [], contract, fileName: "a.tsx",
  });
  expect(r.violations).toHaveLength(1);
  expect(r.violations[0].message).toMatch(/Button exists/);
});

test("exemptions still ride along on the structured result", () => {
  const r = gateSourceWithGaps(
    `const a = <div style={{ color: "#ff0000" }} />; // token-exempt: legacy`,
    { rules: ["no-raw-colors"], contract, fileName: "a.tsx" }
  );
  expect(r.violations).toEqual([]);
  expect(r.exemptions).toHaveLength(1);
});

// gateFiles is the riskiest edit in this task: several callers destructure it.
function repo() {
  const root = mkdtempSync(join(tmpdir(), "u-strict-"));
  mkdirSync(join(root, "app"), { recursive: true });
  writeFileSync(join(root, "ds.css"), ":root{--color-primary:#3b5bdb}");
  writeFileSync(
    join(root, "app/a.tsx"),
    `export const A = () => (\n  <div className="bg-primary p-4">\n    <Missing what="Rating" reason="no rating component exists" />\n  </div>\n);\n`
  );
  writeFileSync(
    join(root, "undrift.config.json"),
    JSON.stringify({
      system: "@acme/ds",
      tokensCss: "ds.css",
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } },
    })
  );
  return root;
}

test("gateFiles returns gaps and declarations alongside violations", () => {
  const c = loadContract(repo());
  const r = gateFiles(["app/**/*.tsx"], { rules: ["no-raw-colors"], contract: c });
  expect(r.files).toBe(1);
  expect(r.violations).toEqual([]);
  expect(r.gaps).toHaveLength(1);
  expect(r.gaps[0]).toMatchObject({ what: "Rating", line: 3 });
  expect(r.gaps[0].file).toMatch(/a\.tsx$/);
  expect(r.declarations).toEqual({ total: 2, resolved: 2 });
});

test("gateFiles under strict turns that same gap into a violation", () => {
  const c = loadContract(repo());
  const r = gateFiles(["app/**/*.tsx"], { rules: ["no-raw-colors"], contract: c, strict: true });
  expect(r.violations).toHaveLength(1);
  expect(r.violations[0].rule).toBe("unresolved-gap");
  expect(r.violations[0].file).toMatch(/a\.tsx$/);
});

// --strict is a BOOLEAN flag. The CLI's paths filter drops the argument after a
// flag (it assumes flags take values), so `gate --strict <path>` would silently
// swallow the path and gate nothing: a green run that proves nothing.
const bin = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/undrift.mjs");
const cli = (root, argv) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8" }) };
  } catch (e) {
    return { code: exited(e), out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
};

test("CLI: gaps do not fail the dev loop", () => {
  const r = cli(repo(), ["gate"]);
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/1 gap/);
});

test("CLI: --strict fails on an unresolved gap", () => {
  const r = cli(repo(), ["gate", "--strict"]);
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/unresolved-gap/);
});

test("CLI: --strict before a path does not swallow the path", () => {
  const root = repo();
  const withPath = cli(root, ["gate", "--strict", "app/a.tsx"]);
  const afterPath = cli(root, ["gate", "app/a.tsx", "--strict"]);
  expect(withPath.code).toBe(1);
  expect(afterPath.code).toBe(1);
  expect(withPath.out).toMatch(/unresolved-gap/);
  expect(afterPath.out).toMatch(/unresolved-gap/);
});

test("CLI: --strict reports the gap once, not as a violation AND a gap", () => {
  const r = cli(repo(), ["gate", "--strict"]);
  expect(r.out).toMatch(/✗ 1 unresolved gap/);
  expect(r.out).not.toMatch(/✗ 1 violation ·/);
});

test("CLI: exemptions are visible in the status line, not only in json", () => {
  const root = repo();
  writeFileSync(
    join(root, "app/b.tsx"),
    `export const B = () => <div style={{ color: "#ff0000" }} />; // token-exempt: legacy embed\n`
  );
  const r = cli(root, ["gate"]);
  expect(r.code).toBe(0);
  expect(r.out).toMatch(/1 exemption\b/);
});

test("CLI: --format json carries declarations and compliance", () => {
  const r = cli(repo(), ["gate", "--format", "json"]);
  expect(r.code).toBe(0);
  const parsed = JSON.parse(r.out);
  expect(parsed.pass).toBe(true);
  expect(parsed.declarations).toEqual({ total: 2, resolved: 2 });
  expect(parsed.compliance).toBe(100);
  expect(parsed.gaps).toBe(1);
});
