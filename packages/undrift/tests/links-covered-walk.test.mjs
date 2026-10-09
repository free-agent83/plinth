// What a covered link is measured against: every UI file behind it, found by a walk of its own
// (uiFilesBehind). The worlds of links-covered.test.mjs always keep a bad ui/x.tsx at the top of the
// link's target, and that file alone leaves any partial include uncovered, so nothing there depended
// on the walk going below the top. Seven mutations of the walk survived the whole suite, one of them
// (no descent) reopening the case it was written for: `include: ["ui/buttons/**/*.tsx"]` over a
// link that also holds forms/y.tsx with a raw colour passed strict as on-system. These worlds have
// no top-level UI file, and each of the walk's guards has a test of its own.
import { describe, expect, test } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uiFilesBehind } from "../src/unchecked.mjs";
import { asRoot, BAD, cli, context, GOOD, hook, json, posix, world } from "./support/world.mjs";

const at = (include, outsideFiles) => world({ links: { ui: "@clean" }, include, outsideFiles });
const linksItem = (j) => j.notChecked.find((i) => i.kind === "links");

describe.skipIf(!posix)("a link with no UI file at its top, covered in part", () => {
  const FILES = { "clean/buttons/a.tsx": GOOD, "clean/forms/y.tsx": BAD };

  test("is reported, strict fails, and the hook says of the file it missed that it did not check it", () => {
    const w = at(["app/**/*.tsx", "ui/buttons/**/*.tsx"], FILES);
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/on-system/);
    const j = json(w.root, ["--strict"]);
    expect(j.coverage.links).toMatchObject({ found: 1, covered: 0, notChecked: 1 });
    expect(linksItem(j).files).toEqual(["ui"]);
    expect(context(hook(w.root, join(w.root, "ui/forms/y.tsx")))).toContain("Undrift did not check ui/forms/y.tsx");
  });

  test("and is covered once the include takes in the folder that was missed", () => {
    const w = at(["app/**/*.tsx", "ui/**/*.tsx"], FILES);
    const j = json(w.root, ["--strict"]);
    expect(j.coverage.links).toMatchObject({ found: 1, covered: 1, notChecked: 0 });
    expect(cli(w.root, ["gate", "--strict"]).out).toContain("[no-raw-colors]");
  });
});

describe.skipIf(!posix)("a link with a link of its own behind it", () => {
  test("is not covered by an include that matches every file the walk can see", () => {
    const w = at(["app/**/*.tsx", "ui/**/*.tsx"], { "clean/a.tsx": GOOD });
    symlinkSync(join(w.base, "repo/app"), join(w.outside, "clean/further"));
    const j = json(w.root, ["--strict"]);
    expect(j.coverage.links).toMatchObject({ found: 1, covered: 0, notChecked: 1 });
    expect(linksItem(j).files).toEqual(["ui"]);
    expect(cli(w.root, ["gate", "--strict"]).code).toBe(1);
  });
});

describe("uiFilesBehind", () => {
  const tree = (files) => {
    const dir = mkdtempSync(join(tmpdir(), "u-walk-"));
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    return dir;
  };

  test("descends into subfolders, and names each file by its path from the folder", () => {
    const dir = tree({ "a/b/c.tsx": GOOD, "d.tsx": GOOD, "e/f.tsx": GOOD });
    const look = uiFilesBehind(dir);
    expect(look.files.sort()).toEqual(["a/b/c.tsx", "d.tsx", "e/f.tsx"]);
    expect(look.complete).toBe(true);
  });

  test("counts .jsx files as UI files", () => {
    const dir = tree({ "one.jsx": GOOD, "deep/two.JSX": GOOD, "three.tsx": GOOD });
    expect(uiFilesBehind(dir).files.sort()).toEqual(["deep/two.JSX", "one.jsx", "three.tsx"]);
  });

  test("does not count scripts, stylesheets that are not UI, or what is never source", () => {
    const dir = tree({ "lib.ts": "", "s.css": "", "node_modules/p/x.tsx": GOOD, ".hidden/y.tsx": GOOD, "ok.tsx": GOOD });
    expect(uiFilesBehind(dir).files).toEqual(["ok.tsx"]);
  });

  test.skipIf(!posix)("is not complete when it meets a link below the folder, which it does not follow", () => {
    const dir = tree({ "a.tsx": GOOD, "sub/b.tsx": GOOD });
    const elsewhere = tree({ "hidden.tsx": GOOD });
    symlinkSync(elsewhere, join(dir, "sub/further"));
    const look = uiFilesBehind(dir);
    expect(look.complete).toBe(false);
    expect(look.files.sort()).toEqual(["a.tsx", "sub/b.tsx"]);
  });

  test.skipIf(!posix || asRoot)("is not complete when a folder cannot be read", () => {
    const dir = tree({ "a.tsx": GOOD, "locked/b.tsx": GOOD });
    chmodSync(join(dir, "locked"), 0o000);
    try {
      const look = uiFilesBehind(dir);
      expect(look.complete).toBe(false);
      expect(look.files).toEqual(["a.tsx"]);
    } finally {
      chmodSync(join(dir, "locked"), 0o755);
    }
  });

  test("is not complete when the budget of entries runs out", () => {
    const dir = tree({ "a.tsx": GOOD, "b.tsx": GOOD, "c.tsx": GOOD, "d.tsx": GOOD, "e.tsx": GOOD });
    const look = uiFilesBehind(dir, { maxEntries: 3 });
    expect(look.complete).toBe(false);
    expect(look.files.length).toBeLessThan(5);
  });

  test("is complete when the budget is exactly enough", () => {
    const dir = tree({ "a.tsx": GOOD, "b.tsx": GOOD });
    expect(uiFilesBehind(dir, { maxEntries: 2 })).toMatchObject({ complete: true, files: expect.any(Array) });
  });

  test("collects the stylesheets, at any depth", () => {
    const dir = tree({ "s.css": "", "a/t.scss": "", "a/b/u.less": "", "x.tsx": GOOD });
    expect(uiFilesBehind(dir).stylesheets.sort()).toEqual(["a/b/u.less", "a/t.scss", "s.css"]);
  });
});
