// What is behind a link decides whether the link is reported.
//
// A link to a directory that leads outside the repository is not followed, so what is behind it
// is not checked, and that is worth saying when source is there. It used to be said of every
// directory, whatever was in it: `public/uploads -> ../elsewhere/assets`, holding only images,
// failed --strict as "a link to source", with a fix that asked for `.../assets/**/*.tsx`. The
// scan now looks behind a link to a directory, a bounded look that follows no further link, and
// reports it only when source is there, or when it cannot tell (and then says so, in the words
// "a directory Undrift does not follow", not "source").
//
// A link to a folder that holds the repository is a different sort of door: `../**/*.tsx` is not
// advice anyone can follow, so no pattern is offered for it, and the hook offers the folder of the
// file it was asked about.
import { afterEach, describe, expect, test } from "vitest";
import { chmodSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { loadContract } from "../src/contract.mjs";
import { classifyCoverage, collectNotChecked, findSourceFiles, peekDirectory } from "../src/unchecked.mjs";
import { asRoot, BAD, cli, context, DASH, GOOD, hook, json, posix, SCRIPT_BAD, SILENT, shown, world, write } from "./support/world.mjs";

const locked = [];
afterEach(() => {
  while (locked.length > 0) {
    try { chmodSync(locked.pop(), 0o755); } catch { /* gone */ }
  }
});

const UPLOADS = { "public/uploads": "@assets" };

describe.skipIf(!posix)("a link to a directory with no source behind it", () => {
  test.each([
    ["only images", { "assets/logo.png": "png", "assets/hero.jpg": "jpg" }],
    ["data, documents and fonts", { "assets/a.json": "{}", "assets/b.md": "# b\n", "assets/c.svg": "<svg/>", "assets/d.woff2": "font" }],
    ["only what is never source", { "assets/node_modules/p/x.tsx": BAD, "assets/.hidden/h.tsx": BAD, "assets/storybook-static/s.tsx": BAD }],
    ["build output beside a package.json", { "assets/package.json": "{}", "assets/dist/x.tsx": BAD, "assets/build/y.tsx": BAD }],
    ["nothing at all", { "assets/.keep": "" }],
  ])("%s: it is not reported, and strict passes", (_label, outsideFiles) => {
    const w = world({ links: UPLOADS, outsideFiles });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✓ on-system/);
    expect(r.out).not.toMatch(/symbolic link/);
    expect(json(w.root).coverage.links).toEqual({ found: 0, covered: 0, ignored: 0, notChecked: 0 });
    // the scan still meets every link, and says nothing of this one
    expect(findSourceFiles(loadContract(w.root)).links).toEqual(["public/uploads"]);
    expect(classifyCoverage(loadContract(w.root)).links).toEqual([]);
  });

  test("the same link to a folder that is not empty of source is reported, as before", () => {
    const w = world({ links: UPLOADS, outsideFiles: { "assets/logo.png": "png", "assets/deep/er/util.ts": SCRIPT_BAD } });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("1 symbolic link points to source Undrift does not follow, so no rule ran on what is behind it.");
    expect(r.out).toContain(`public/uploads -> ${shown(w, "assets")}`);
  });

  test.each([
    ["a UI file", { "assets/x.jsx": GOOD }],
    ["a script", { "assets/a/b/c/util.mjs": "export const u = 1;\n" }],
    ["a stylesheet among the images", { "assets/logo.png": "png", "assets/site.css": ".a{color:red}\n", "assets/x.tsx": GOOD }],
  ])("%s behind it is enough", (_label, outsideFiles) => {
    const w = world({ links: UPLOADS, outsideFiles });
    expect(json(w.root).coverage.links).toMatchObject({ found: 1, notChecked: 1 });
  });

  test("a folder of stylesheets and nothing else is reported, and no profile is offered for it", () => {
    const w = world({ links: UPLOADS, outsideFiles: { "assets/theme.css": ".a{color:#f00}\n", "assets/logo.png": "png" } });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("1 symbolic link points to source Undrift does not follow");
    expect(r.out).toContain("No profile covers a stylesheet");
    expect(r.out).not.toContain("for example");
    expect(r.out).toContain('propose an "ignore" entry');
    expect(json(w.root).notChecked.find((i) => i.kind === "links").links[0]).toEqual({
      path: "public/uploads",
      target: shown(w, "assets"),
      kind: "directory",
      stylesheetsOnly: true,
    });
  });

  test("a profile that includes the stylesheets in it does not cover it: no profile can cover a stylesheet", () => {
    const probe = world({ links: UPLOADS });
    const w = world({ links: UPLOADS, include: ["app/**/*.tsx", `${shown(probe, "assets")}/**/*.css`], outsideFiles: { "assets/theme.css": ".a{color:#f00}\n" } });
    expect(json(w.root).coverage.links).toMatchObject({ found: 1, covered: 0, notChecked: 1 });
  });

  test("ignore still accounts for one that has source", () => {
    const w = world({ links: UPLOADS, outsideFiles: { "assets/x.tsx": GOOD }, over: { ignore: { "ds.css": "the token source", "public/uploads": "a folder the design team owns" } } });
    expect(cli(w.root, ["gate", "--strict"]).code).toBe(0);
  });
});

describe.skipIf(!posix)("when it cannot tell what is behind a directory", () => {
  const NESTED = { "public/uploads": "@assets" };
  const nested = (w) => symlinkSync(join(w.outside, "ui"), join(w.outside, "assets/more"));

  test("a link inside it is not followed, so the look is not finished: it says so, in words that claim nothing", () => {
    const w = world({ links: NESTED, outsideFiles: { "assets/logo.png": "png" } });
    nested(w);
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      "1 symbolic link leads to a directory Undrift does not follow, and it could not tell whether there is source behind it, so no rule ran on what is there."
    );
    expect(r.out).not.toContain("points to source");
    expect(r.out).toContain(`public/uploads -> ${shown(w, "assets")}`);
    expect(r.out).toContain('propose an "ignore" entry, with the reason, to the user; do not add one yourself.');
    expect(json(w.root).notChecked.find((i) => i.kind === "links").links).toEqual([
      { path: "public/uploads", target: shown(w, "assets"), kind: "directory", uncertain: true },
    ]);
  });

  test.skipIf(asRoot)("a directory inside it that cannot be read leaves the look unfinished too", () => {
    const w = world({ links: NESTED, outsideFiles: { "assets/logo.png": "png", "assets/private/secret.png": "png" } });
    chmodSync(join(w.outside, "assets/private"), 0o000);
    locked.push(join(w.outside, "assets/private"));
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("leads to a directory Undrift does not follow, and it could not tell");
  });

  test("with source found beside a link, the source is what is said", () => {
    const w = world({ links: NESTED, outsideFiles: { "assets/x.tsx": GOOD } });
    nested(w);
    expect(cli(w.root, ["gate"]).out).toContain("1 symbolic link points to source Undrift does not follow");
  });

  test("one link that has source and one that may not: the words claim neither", () => {
    const w = world({ links: { "public/uploads": "@assets", "app/ui": "@ui" }, outsideFiles: { "assets/logo.png": "png" } });
    nested(w);
    const r = cli(w.root, ["gate"]);
    expect(r.out).toContain("2 symbolic links lead to places Undrift does not follow, so no rule ran on what is behind them.");
    expect(json(w.root).notChecked.find((i) => i.kind === "links").links.map((l) => [l.path, l.uncertain ?? false])).toEqual([
      ["app/ui", false],
      ["public/uploads", true],
    ]);
  });

  test("several that cannot be told are one item, in the plural", () => {
    const w = world({ links: { "public/a": "@assets", "public/b": "@assets" }, outsideFiles: { "assets/logo.png": "png" } });
    nested(w);
    expect(cli(w.root, ["gate"]).out).toContain("2 symbolic links lead to directories Undrift does not follow, and it could not tell whether there is source behind them");
  });

  test("no message carries a dash", () => {
    const w = world({ links: NESTED, outsideFiles: { "assets/logo.png": "png" } });
    nested(w);
    expect(cli(w.root, ["gate", "--strict"]).out).not.toMatch(DASH);
  });

  test("collectNotChecked words an uncertain link the same way, from the scan's own list", () => {
    const w = world({ links: NESTED, outsideFiles: { "assets/logo.png": "png" } });
    nested(w);
    const c = loadContract(w.root);
    const coverage = classifyCoverage(c);
    const item = collectNotChecked({ contract: c, runs: [{ name: "app", files: 1, rulesNotRun: [] }], coverage }).find((i) => i.kind === "links");
    expect(item.reason).toMatch(/^1 symbolic link leads to a directory Undrift does not follow, and it could not tell/);
  });
});

describe("peekDirectory", () => {
  const dir = (files, links = {}) => {
    const w = world({ outsideFiles: files });
    for (const [name, target] of Object.entries(links)) symlinkSync(target, join(w.outside, "peek", name));
    return join(w.outside, "peek");
  };

  test("finds a UI file, a script or a stylesheet, and says which kind of thing it found", () => {
    expect(peekDirectory(dir({ "peek/a.png": "x", "peek/deep/b.tsx": GOOD }))).toEqual({ source: true, includable: true, complete: true });
    expect(peekDirectory(dir({ "peek/x/y/z.mjs": "export {};\n" }))).toEqual({ source: true, includable: true, complete: true });
    expect(peekDirectory(dir({ "peek/site.css": ".a{}\n", "peek/a.png": "x" }))).toEqual({ source: true, includable: false, complete: true });
  });

  test("a stylesheet does not end the look: a script further on makes the folder includable", () => {
    expect(peekDirectory(dir({ "peek/a.css": ".a{}\n", "peek/z/util.ts": "export {};\n" }))).toEqual({ source: true, includable: true, complete: true });
  });

  test("nothing but files that are not source: no source, and the look is complete", () => {
    expect(peekDirectory(dir({ "peek/a.png": "x", "peek/b.json": "{}", "peek/c.md": "#" }))).toEqual({ source: false, includable: false, complete: true });
  });

  test("it opens no place that is never source", () => {
    const d = dir({ "peek/node_modules/p/x.tsx": GOOD, "peek/.hidden/h.tsx": GOOD, "peek/package.json": "{}", "peek/dist/d.tsx": GOOD });
    expect(peekDirectory(d)).toEqual({ source: false, includable: false, complete: true });
  });

  test("a budget: with too many entries to look at, it does not guess", () => {
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`peek/img${i}.png`, "x"]));
    expect(peekDirectory(dir(files), { maxEntries: 5 })).toEqual({ source: false, includable: false, complete: false });
    expect(peekDirectory(dir(files), { maxEntries: 50 })).toEqual({ source: false, includable: false, complete: true });
  });

  test.skipIf(!posix)("a link met on the way is not followed, and leaves the look unfinished", () => {
    const d = dir({ "peek/a.png": "x" }, { more: "." });
    expect(peekDirectory(d)).toEqual({ source: false, includable: false, complete: false });
  });

  test("a directory that is not there is a look that could not be done", () => {
    expect(peekDirectory(join(world().base, "nowhere"))).toEqual({ source: false, includable: false, complete: false });
  });
});

describe.skipIf(!posix)("a link to a folder that holds the repository", () => {
  const UP = { "app/up": "../.." }; // from app/, the folder above the repository

  test("it is reported, and the fix offers no pattern that would take in the whole folder", () => {
    const w = world({ links: UP });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("app/up -> ..");
    expect(r.out).not.toContain('"../**/*.tsx"');
    expect(r.out).not.toContain("for example");
    expect(r.out).toContain(
      "Fix: Include the folders behind it that you mean in a profile, so the rules run on them. " +
        'If it should not be checked, propose an "ignore" entry, with the reason, to the user; do not add one yourself.'
    );
    expect(json(w.root).notChecked.find((i) => i.kind === "links").links[0]).toMatchObject({ path: "app/up", target: "..", kind: "directory", ancestor: true });
  });

  test("two levels up is the same", () => {
    const w = world({ links: { "app/up": "../../.." } });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.out).toContain("app/up -> ../..");
    expect(r.out).not.toContain("**/*.tsx");
  });

  test("beside a link to a folder that does have a pattern, the pattern is the one offered, whichever is listed first", () => {
    const w = world({ links: { "app/a-up": "../..", "app/z-ui": "@ui" } });
    const r = cli(w.root, ["gate"]);
    expect(r.out).toContain(`for example ${JSON.stringify(`${shown(w, "ui")}/**/*.tsx`)}`);
    expect(r.out).not.toContain('"../**/*.tsx"');
    expect(json(w.root).notChecked.find((i) => i.kind === "links").files).toEqual(["app/a-up", "app/z-ui"]);
  });

  test("a link to a folder beside the repository still gets its pattern", () => {
    const w = world({ links: { "app/ui": "@ui" } });
    expect(cli(w.root, ["gate"]).out).toContain(`for example ${JSON.stringify(`${shown(w, "ui")}/**/*.tsx`)}`);
  });

  test("the hook offers the folder the file really lives in", () => {
    const w = world({ links: UP });
    const text = context(hook(w.root, join(w.root, "app/up/elsewhere/ui/x.tsx")));
    expect(text).toContain("Undrift did not check app/up/elsewhere/ui/x.tsx: it is reached through a symbolic link (app/up points to ..)");
    expect(text).toContain(`for example ${JSON.stringify("../elsewhere/ui/**/*.tsx")}`);
    expect(text).not.toContain('"../**/*.tsx"');
  });

  test("a file directly in the folder that holds the repository is offered by its own path, not a pattern for the whole folder", () => {
    const w = world({ links: UP });
    write(w.base, "top.tsx", BAD);
    const text = context(hook(w.root, join(w.root, "app/up/top.tsx")));
    expect(text).toContain("Undrift did not check app/up/top.tsx: it is reached through a symbolic link (app/up points to ..)");
    expect(text).toContain(`for example ${JSON.stringify("../top.tsx")}`);
    expect(text).not.toContain("**");
  });

  test("a file that is really in the repository, reached round the loop, is judged where it lives", () => {
    const w = world({ links: UP, files: { "app/bad.tsx": BAD } });
    expect(hook(w.root, join(w.root, "app/up/repo/app/a.tsx"))).toEqual(SILENT);
    const r = hook(w.root, join(w.root, "app/up/repo/app/bad.tsx"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("app/bad.tsx");
    expect(r.stderr).not.toContain("symbolic link");
  });

  test("no message carries a dash", () => {
    const w = world({ links: UP });
    expect(cli(w.root, ["gate", "--strict"]).out).not.toMatch(DASH);
    expect(context(hook(w.root, join(w.root, "app/up/elsewhere/ui/x.tsx")))).not.toMatch(DASH);
  });
});
