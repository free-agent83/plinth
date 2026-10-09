// Undrift is read by people who have this package and nothing around it. A comment or a test title that points
// at a task, a phase or a plan points at a document they cannot open, so what it means is lost. This holds the
// source and the tests to describing the behaviour itself. The scan skips what the export withholds, and the
// lines between the CLI's strip markers, which the export removes.
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "tests/no-private-pointers.test.mjs";
// What the export does not ship, by folder name or file name (see WITHHELD in scripts/build-client-sample.mjs).
const SKIP = new Set(["node_modules", "assess", "subjects", "demo", "scripts", "HANDOFF.md", "README.md"]);
const SHIPPED = /\.(mjs|cjs|js|ts|tsx|json|md|css|html)$/;
// The patterns are written so that this file does not match them.
const POINTERS = [
  [/\bTask \d+[a-z]?\b/, "a task"],
  [/\bPhase \d+\b/, "a phase"],
  [/\bplan\b/, "a plan"],
  [/superpowers/, "the planning folder"],
];

/** Every pointer in a text, as `line: what`, leaving out the lines the export strips. */
export function pointersIn(text) {
  const found = [];
  let stripped = 0;
  text.split("\n").forEach((line, i) => {
    if (line.includes("<client-export:strip>")) { stripped += 1; return; }
    if (line.includes("</client-export:strip>")) { stripped -= 1; return; }
    if (stripped > 0) return;
    for (const [pattern, what] of POINTERS) if (pattern.test(line)) found.push(`${i + 1}: ${what}`);
  });
  return found;
}

function shipped(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return shipped(path);
    return SHIPPED.test(name) && relative(root, path) !== SELF ? [path] : [];
  });
}

describe("the rule, case by case", () => {
  test("a pointer to a task, a phase or a plan is found", () => {
    expect(pointersIn("// the primitives (Task 8b) are declared")).toEqual(["1: a task"]);
    expect(pointersIn("// Phase 1 attributes a problem")).toEqual(["1: a phase"]);
    expect(pointersIn("// as the plan says")).toEqual(["1: a plan"]);
    expect(pointersIn("// see docs/superpowers/plans/x.md")).toEqual(["1: the planning folder"]);
    expect(pointersIn("ok\n// token-layer plan, Task 5c")).toEqual(["2: a task", "2: a plan"]);
  });

  test("words that only look alike pass", () => {
    expect(pointersIn("// a task queue, explained, planes, a phase of the build, step 3")).toEqual([]);
  });

  test("lines the export strips are not read", () => {
    expect(pointersIn("a\n// <client-export:strip>\n// Task 12\n// </client-export:strip>\n// Task 3")).toEqual(["5: a task"]);
  });
});

describe("no file Undrift ships points at a task, a phase or a plan", () => {
  const files = shipped(root);

  test("the scan reads the source, the tests and the CLI", () => {
    const rels = files.map((f) => relative(root, f));
    expect(files.length).toBeGreaterThan(100);
    expect(rels).toContain("bin/undrift.mjs");
    expect(rels.some((r) => r.startsWith("src/"))).toBe(true);
    expect(rels.some((r) => r.startsWith("tests/"))).toBe(true);
    expect(rels.some((r) => r.includes("assess"))).toBe(false);
  });

  test("none does", () => {
    const found = files.flatMap((file) => pointersIn(readFileSync(file, "utf8")).map((hit) => `${relative(root, file)}:${hit}`));
    expect(found).toEqual([]);
  });
});
