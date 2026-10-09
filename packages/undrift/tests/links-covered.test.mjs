// A profile covers a file by the name its include gives it, and the name is not always the real path.
//
// `include: ["ui/**/*.tsx"]`, where `ui` is a link to a folder outside the repository, is the one
// place a glob still walks through a link: it opens a pattern's fixed start directly. The gate
// found and checked `ui/x.tsx`, and the scan then said of the same link that "no rule ran on what
// is behind it", which was false. The hook, writing `ui/x.tsx`, looked the profile up by the real
// path (`../elsewhere/ui/x.tsx`), found none, and exited 0 with "did not check", so a raw colour
// passed at write time and failed in CI. A link now counts as covered when what a profile matches
// includes paths under it, and the hook looks the profile up by the path as written as well.
//
// An absolute real path in an include is the other name a profile may use, and the CLI honoured it
// while the hook did not: it says "did not check" of a file the CLI checks, and does not block.
import { describe, expect, test } from "vitest";
import { realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { BAD, cli, context, GOOD, hook, json, posix, SCRIPT_BAD, SILENT, shown, world } from "./support/world.mjs";

const UI = { ui: "@ui" }; // at the root of the repository

describe.skipIf(!posix)("an include that starts at a link", () => {
  const at = (include, over = {}) => world({ links: UI, include, ...over });

  test("the scan does not say the link was not checked: the gate went through it and found the violation", () => {
    const w = at(["ui/**/*.tsx"]);
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[no-raw-colors]");
    expect(r.out).toContain("x.tsx");
    expect(r.out).not.toMatch(/symbolic link/);
    expect(r.out).not.toContain("no rule ran on what is behind");
    const j = json(w.root);
    expect(j.coverage.links).toEqual({ found: 1, covered: 1, ignored: 0, notChecked: 0 });
    expect(j.notChecked.find((i) => i.kind === "links")).toBeUndefined();
  });

  test("the hook blocks a violation in a file written through it, and names the file as it was written", () => {
    const w = at(["ui/**/*.tsx"]);
    const r = hook(w.root, join(w.root, "ui/x.tsx"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("#ff0000");
    expect(r.stderr).toContain("ui/x.tsx");
    expect(r.stderr).not.toContain("symbolic link");
    expect(r.stderr).not.toContain("elsewhere");
  });

  test("so does a file in a folder below it", () => {
    const w = at(["ui/**/*.tsx"]);
    expect(hook(w.root, join(w.root, "ui/deep/z.tsx")).code).toBe(2);
  });

  test("a clean file is silent, as any covered file is", () => {
    const w = at(["ui/**/*.tsx"], { outsideFiles: { "ui/clean.tsx": GOOD } });
    expect(hook(w.root, join(w.root, "ui/clean.tsx"))).toEqual(SILENT);
  });

  test("a script is gated the same way", () => {
    const w = at(["ui/**/*.ts"]);
    const r = hook(w.root, join(w.root, "ui/lib.ts"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("#ff0000");
  });

  test("the count of attempts is kept for the file as it was written", () => {
    const w = at(["ui/**/*.tsx"]);
    const attempt = () => hook(w.root, join(w.root, "ui/x.tsx"));
    expect(attempt().stderr).toContain("attempt 1/3");
    expect(attempt().stderr).toContain("attempt 2/3");
    expect(attempt().stderr).toContain("still present in ui/x.tsx after 3 attempts");
  });

  test("a stylesheet behind it is still told, as no profile can cover one", () => {
    const w = at(["ui/**/*.tsx"]);
    const r = hook(w.root, join(w.root, "ui/y.css"));
    expect(r.code).toBe(0);
    expect(context(r)).toContain("Undrift does not check stylesheets yet, so values set in ui/y.css");
    expect(context(r)).not.toContain("symbolic link"); // the link is followed, as far as a profile goes
    expect(context(r)).toContain('propose an "ignore" entry');
  });

  // A link is covered when every UI file behind it is matched, under some name. Matching a few of
  // them was once enough, and `include: ["ui/buttons/**/*.tsx"]` over a `ui` that also held
  // forms/y.tsx with a raw colour passed strict, while the hook said of that file that it did not
  // check it. The run and the hook now agree, and what nothing looked at is never reported as clean.
  test("a profile that matches only some of the files under the link does not cover it", () => {
    const w = at(["ui/deep/*.tsx"]);
    const j = json(w.root);
    expect(j.coverage.links).toMatchObject({ found: 1, covered: 0, notChecked: 1 });
    expect(j.notChecked.find((i) => i.kind === "links").files).toEqual(["ui"]);
  });

  test("so strict fails on the reviewer's case, and the hook says the same of the file it missed", () => {
    const w = world({
      links: UI,
      include: ["app/**/*.tsx", "ui/buttons/**/*.tsx"],
      outsideFiles: { "ui/buttons/a.tsx": GOOD, "ui/forms/y.tsx": BAD },
    });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/on-system/);
    expect(json(w.root, ["--strict"]).notChecked.find((i) => i.kind === "links").files).toEqual(["ui"]);
    expect(context(hook(w.root, join(w.root, "ui/forms/y.tsx")))).toContain("Undrift did not check ui/forms/y.tsx");
  });

  test("every file matched, by two patterns, is covered", () => {
    const w = at(["ui/*.tsx", "ui/deep/*.tsx"]);
    expect(json(w.root).coverage.links).toMatchObject({ found: 1, covered: 1, notChecked: 0 });
  });

  test("a file behind it that is not UI source, a script, does not have to be matched", () => {
    const w = at(["ui/**/*.tsx"]); // ui/lib.ts is there, and no profile includes scripts
    expect(json(w.root).coverage.links).toMatchObject({ found: 1, covered: 1 });
  });

  test("an include that matches nothing under it does not: the link is reported, and the hook says so", () => {
    const w = at(["ui/**/*.jsx"]);
    const j = json(w.root);
    expect(j.coverage.links).toMatchObject({ found: 1, covered: 0, notChecked: 1 });
    expect(j.notChecked.find((i) => i.kind === "links").files).toEqual(["ui"]);
    expect(context(hook(w.root, join(w.root, "ui/x.tsx")))).toContain("Undrift did not check ui/x.tsx: it is reached through a symbolic link");
  });

  test("a link further down the pattern is still not followed, so it is still reported", () => {
    const w = world({ links: { "app/ui": "@ui" }, include: ["app/**/*.tsx"] });
    expect(json(w.root).coverage.links).toMatchObject({ found: 1, covered: 0, notChecked: 1 });
    expect(context(hook(w.root, join(w.root, "app/ui/x.tsx")))).toContain("Undrift did not check app/ui/x.tsx");
  });
});

// A stylesheet behind a covered link is unexamined all the same: no profile covers a stylesheet, and
// a link a profile covers said nothing of the ones behind it. `.x { color: #ff0000 }` in ui/s.css passed
// strict as on-system, while the same file at app/s.css was reported and the hook said of ui/s.css
// that it did not check it. It is reported now like the one in the repository, and `ignore` clears it.
describe.skipIf(!posix)("a stylesheet behind a link that a profile covers", () => {
  const CLEAN = { links: { ui: "@clean" }, include: ["app/**/*.tsx", "ui/**/*.tsx"], outsideFiles: { "clean/a.tsx": GOOD, "clean/s.css": ".x { color: #ff0000; }\n" } };
  const sheetsItem = (j) => j.notChecked.find((i) => i.kind === "stylesheets");

  test("is not on-system: it is reported as a stylesheet, and strict fails", () => {
    const w = world(CLEAN);
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/on-system/);
    const j = json(w.root, ["--strict"]);
    expect(j.coverage.links).toEqual({ found: 1, covered: 1, ignored: 0, notChecked: 0 });
    expect(sheetsItem(j).files).toEqual(["ui/s.css"]);
    expect(j.coverage.stylesheets).toMatchObject({ found: 2, ignored: 1, notChecked: 1 });
  });

  test("the hook says the same of it, so the two agree", () => {
    const w = world(CLEAN);
    const told = context(hook(w.root, join(w.root, "ui/s.css")));
    expect(told).toContain("Undrift does not check stylesheets yet, so values set in ui/s.css");
    expect(told).not.toContain("symbolic link");
    expect(told).not.toContain("does not follow");
    expect(told).toContain('propose an "ignore" entry, with a reason, to the user; do not add one yourself.');
    // the words an in-repository stylesheet is told in, with its own name in them
    const inRepo = world({ ...CLEAN, files: { "app/s.css": ".x { color: #ff0000; }\n" } });
    expect(told.replace("ui/s.css", "app/s.css")).toBe(context(hook(inRepo.root, join(inRepo.root, "app/s.css"))));
  });

  test("an ignore entry for it clears it, as the hook's advice says, and strict passes", () => {
    const w = world({ ...CLEAN, over: { ignore: { "ds.css": "the token source", "ui/s.css": "generated" } } });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    const j = json(w.root, ["--strict"]);
    expect(sheetsItem(j)).toBeUndefined();
    expect(j.coverage.stylesheets).toMatchObject({ found: 2, ignored: 2, notChecked: 0 });
  });

  test("one that is ignored does not hide another beside it, in the run or in the hook", () => {
    const w = world({ ...CLEAN, outsideFiles: { ...CLEAN.outsideFiles, "clean/deep/t.css": ".y{color:#f00}\n" }, over: { ignore: { "ds.css": "the token source", "ui/s.css": "generated" } } });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(sheetsItem(json(w.root, ["--strict"])).files).toEqual(["ui/deep/t.css"]);
    expect(context(hook(w.root, join(w.root, "ui/deep/t.css")))).toContain("values set in ui/deep/t.css");
    expect(hook(w.root, join(w.root, "ui/s.css"))).toEqual(SILENT);
  });
});

// `ignore` accounts for a link only when it accounts for everything behind it. A key that names the link
// does (`ui`, `ui/**`), and so do keys that between them match every UI file, stylesheet and script
// that a bounded walk finds. A key that reaches one file under it accounts for that file: it used to
// account for the whole link, and `ignore: {"ui/y.css": ...}` over a link that also held `x.tsx`
// with a raw colour passed strict as on-system.
describe.skipIf(!posix)("an ignore entry that reaches only some of what is behind a link that no profile covers", () => {
  const ROOT = { ds: "the token source" };
  const withIgnore = (ignore, extra = {}) => world({ links: UI, include: ["app/**/*.tsx"], over: { ignore: { "ds.css": ROOT.ds, ...ignore } }, ...extra });
  const linksOf = (w) => json(w.root, ["--strict"]);

  test("does not account for the link: it is reported, and strict fails", () => {
    const w = withIgnore({ "ui/y.css": "generated" });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/on-system/);
    const j = linksOf(w);
    expect(j.coverage.links).toMatchObject({ found: 1, ignored: 0, notChecked: 1 });
    expect(j.notChecked.find((i) => i.kind === "links").files).toEqual(["ui"]);
  });

  test("the hook says of a file the entry does not name that it did not check it, and is silent on the one it names", () => {
    const w = withIgnore({ "ui/y.css": "generated" });
    expect(context(hook(w.root, join(w.root, "ui/x.tsx")))).toContain("Undrift did not check ui/x.tsx: it is reached through a symbolic link");
    expect(hook(w.root, join(w.root, "ui/y.css"))).toEqual(SILENT);
  });

  test("a key that names the link accounts for all of it, in the run and in the hook", () => {
    for (const key of ["ui", "ui/**"]) {
      const w = withIgnore({ [key]: "vendored" });
      expect(linksOf(w).coverage.links).toMatchObject({ found: 1, ignored: 1, notChecked: 0 });
      expect(hook(w.root, join(w.root, "ui/x.tsx"))).toEqual(SILENT);
    }
  });

  test("keys that between them match everything behind it account for it, in the run and in the hook", () => {
    const w = withIgnore({ "ui/**/*.tsx": "vendored", "ui/**/*.css": "vendored", "ui/**/*.ts": "vendored" });
    expect(linksOf(w).coverage.links).toMatchObject({ found: 1, ignored: 1, notChecked: 0 });
    expect(hook(w.root, join(w.root, "ui/x.tsx"))).toEqual(SILENT);
    expect(hook(w.root, join(w.root, "ui/lib.ts"))).toEqual(SILENT);
  });

  test("one script or one stylesheet left out is enough to leave it reported", () => {
    for (const ignore of [{ "ui/**/*.tsx": "v", "ui/**/*.css": "v" }, { "ui/**/*.tsx": "v", "ui/**/*.ts": "v" }, { "ui/**/*.css": "v", "ui/**/*.ts": "v" }]) {
      const w = withIgnore(ignore);
      expect(linksOf(w).coverage.links).toMatchObject({ ignored: 0, notChecked: 1 });
    }
  });

  test("a look that could not be finished is not believed: a link met on the way leaves it reported", () => {
    const w = withIgnore({ "ui/**/*.tsx": "v", "ui/**/*.css": "v", "ui/**/*.ts": "v" });
    symlinkSync(join(w.base, "repo/app"), join(w.outside, "ui/further"));
    expect(linksOf(w).coverage.links).toMatchObject({ ignored: 0, notChecked: 1 });
  });
});

// A key may name what is behind a link by its real path, relative to the repository
// (`../elsewhere/ui/x.tsx`). For a link no profile covers, keys of that form that between them name
// every file behind it account for the link, and the run and the hook agree. For a link a profile
// covers, they do not clear the stylesheet behind it: only a key that names the link's own path does,
// as the hook's advice says, and the run and the hook agree on that too.
describe.skipIf(!posix)("an ignore entry that names what is behind a link by its real path", () => {
  const REAL = (...names) => Object.fromEntries(names.map((n) => [`../elsewhere/${n}`, "vendored"]));

  test("accounts for a link no profile covers when it names every file behind it: strict passes and the hook is silent", () => {
    const w = world({
      links: UI,
      include: ["app/**/*.tsx"],
      over: { ignore: { "ds.css": "the token source", ...REAL("ui/x.tsx", "ui/y.css", "ui/deep/z.tsx", "ui/lib.ts") } },
    });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/on-system/);
    expect(json(w.root, ["--strict"]).coverage.links).toMatchObject({ found: 1, ignored: 1, notChecked: 0 });
    expect(hook(w.root, join(w.root, "ui/x.tsx"))).toEqual(SILENT);
    expect(hook(w.root, join(w.root, "ui/y.css"))).toEqual(SILENT);
  });

  test("one file left out of them leaves the link reported, and the hook says of that file that it did not check it", () => {
    const w = world({
      links: UI,
      include: ["app/**/*.tsx"],
      over: { ignore: { "ds.css": "the token source", ...REAL("ui/x.tsx", "ui/y.css", "ui/deep/z.tsx") } },
    });
    expect(cli(w.root, ["gate", "--strict"]).code).toBe(1);
    expect(context(hook(w.root, join(w.root, "ui/lib.ts")))).toContain("Undrift did not check ui/lib.ts");
  });

  // The stylesheet behind a covered link is reported by its name under the link, and no profile can
  // cover it, so a real-path key does not stand for it: the run reports it and the hook tells it.
  test("does not clear a stylesheet behind a link that a profile covers: the run reports it and the hook tells it", () => {
    const w = world({
      links: { ui: "@clean" },
      include: ["app/**/*.tsx", "ui/**/*.tsx"],
      outsideFiles: { "clean/a.tsx": GOOD, "clean/y.css": ".x { color: #ff0000; }\n" },
      over: { ignore: { "ds.css": "the token source", ...REAL("clean/a.tsx", "clean/y.css") } },
    });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(json(w.root, ["--strict"]).notChecked.find((i) => i.kind === "stylesheets").files).toEqual(["ui/y.css"]);
    expect(context(hook(w.root, join(w.root, "ui/y.css")))).toContain("Undrift does not check stylesheets yet, so values set in ui/y.css");
  });
});

// A script behind a covered link is treated as a script in the repository is: no profile includes
// scripts here, so nothing claims to check it, in the run or in the hook. The hook said of ui/tok.ts
// that it sits behind a link "which Undrift does not follow", which is untrue of a covered link, while
// it said nothing of app/tok.ts.
describe.skipIf(!posix)("a script behind a link that a profile covers", () => {
  const CLEAN = { links: { ui: "@clean" }, include: ["app/**/*.tsx", "ui/**/*.tsx"], outsideFiles: { "clean/a.tsx": GOOD, "clean/tok.ts": SCRIPT_BAD } };

  test("the hook is silent, as it is for a script in the repository", () => {
    const w = world({ ...CLEAN, files: { "app/tok.ts": SCRIPT_BAD } });
    expect(hook(w.root, join(w.root, "app/tok.ts"))).toEqual(SILENT);
    expect(hook(w.root, join(w.root, "ui/tok.ts"))).toEqual(SILENT);
  });

  test("and so is the run: it is on-system, with nothing left unchecked", () => {
    const w = world(CLEAN);
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(json(w.root, ["--strict"]).notChecked).toEqual([]);
  });

  test("a link no profile covers still says so of a script behind it, as before", () => {
    const w = world({ ...CLEAN, include: ["app/**/*.tsx"] });
    expect(context(hook(w.root, join(w.root, "ui/tok.ts")))).toContain("Undrift did not check ui/tok.ts: it is reached through a symbolic link");
  });
});

describe.skipIf(!posix)("the real path relative to the repository, in an include", () => {
  test("the hook blocks a violation and names the file as it was written, not by a path outside the repository", () => {
    const probe = world({ links: { "app/ui": "@ui" } });
    const w = world({ links: { "app/ui": "@ui" }, include: ["app/**/*.tsx", `${shown(probe, "ui")}/**/*.tsx`] });
    const r = hook(w.root, join(w.root, "app/ui/x.tsx"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("violation(s) in app/ui/x.tsx");
    expect(r.stderr).not.toContain("elsewhere");
  });

  test("a file reached through a link to a folder of the repository is still named where it lives", () => {
    const w = world({ files: { "lib/shared/x.tsx": BAD }, links: { "app/shared": "../lib/shared" }, include: ["app/**/*.tsx", "lib/**/*.tsx"] });
    const r = hook(w.root, join(w.root, "app/shared/x.tsx"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("violation(s) in lib/shared/x.tsx");
  });
});

describe.skipIf(!posix)("an absolute real path in an include", () => {
  const withAbsolute = (pattern = "ui/**/*.tsx") =>
    world({ links: { "app/ui": "@ui" }, include: ({ outside }) => ["app/**/*.tsx", `${realpathSync(outside)}/${pattern}`] });

  test("the CLI covers and gates the file, and the link is not reported", () => {
    const w = withAbsolute();
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.out).toContain("[no-raw-colors]");
    expect(r.out).not.toMatch(/symbolic link/);
  });

  test("the hook does the same: it blocks a violation in the file, named as it was written", () => {
    const w = withAbsolute();
    const r = hook(w.root, join(w.root, "app/ui/x.tsx"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("#ff0000");
    expect(r.stderr).toContain("app/ui/x.tsx");
    expect(r.stderr).not.toContain("symbolic link");
    // an agent reads this, and a path from the home directory is not for it
    expect(r.stderr).not.toContain(realpathSync(w.outside));
  });

  test("the real file written directly is covered by it too", () => {
    const w = withAbsolute();
    const r = hook(w.root, join(realpathSync(w.outside), "ui/x.tsx"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`${shown(w, "ui")}/x.tsx`);
    expect(r.stderr).not.toContain(realpathSync(w.outside));
  });

  test("without that include the same writes are told, or silent, as they always were", () => {
    const w = world({ links: { "app/ui": "@ui" } });
    expect(context(hook(w.root, join(w.root, "app/ui/x.tsx")))).toContain("Undrift did not check app/ui/x.tsx");
    expect(hook(w.root, join(realpathSync(w.outside), "ui/x.tsx"))).toEqual(SILENT);
  });

  test("so is the absolute path of the link itself, as the include's start: the run and the hook agree on it", () => {
    // spelled with the repository's real path, as a process started in it sees it
    const w = world({ links: UI, include: ({ root }) => [`${realpathSync(root)}/ui/**/*.tsx`] });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.out).toContain("[no-raw-colors]");
    expect(r.out).not.toMatch(/symbolic link/);
    const h = hook(w.root, join(realpathSync(w.root), "ui/x.tsx"));
    expect(h.code).toBe(2);
    expect(h.stderr).toContain("ui/x.tsx");
    expect(h.stderr).not.toContain(realpathSync(w.root));
  });

  test("a script behind the link, by the same include", () => {
    const w = withAbsolute("ui/**/*.ts");
    const r = hook(w.root, join(w.root, "app/ui/lib.ts"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("#ff0000");
  });
});
