// A glob can walk into places it cannot see, and it used to say nothing about them.
//
// The whole-repository scan reports a directory it cannot read, and a link it does not follow, in
// the places it walks. The gate's own globs (a profile's include, and the globs given on the command
// line) walk on their own, with read errors suppressed so that one locked folder does not end the
// run, and so `gate --strict 'app/**/*.tsx'` over `app/locked/x.tsx`, a folder at mode 000 that held
// a raw colour, exited 0 and said "on-system". Nor did a link met on the way (`app/ui -> ../elsewhere/ui`)
// count for anything, and nor did a profile that names a place the scan skips (`.storybook/**/*.tsx`)
// over an unreadable subfolder.
//
// Each glob walk now records the directories it could not read and the links it met, and the run
// reports them the way the scan does: not checked, with why, unless `ignore` accounts for them, or a
// profile (or, on the command line, another argument) covers what is behind a link.
import { afterEach, describe, expect, test } from "vitest";
import fg from "fast-glob";
import { chmodSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { loadContract } from "../src/contract.mjs";
import { gateFiles, gateProfile } from "../src/gate.mjs";
import { GLOB_OPTIONS, recordWalk } from "../src/unchecked.mjs";
import { asRoot, BAD, cli, DASH, GOOD, json, posix, shown, world, write } from "./support/world.mjs";

const locked = [];
afterEach(() => {
  while (locked.length > 0) {
    try { chmodSync(locked.pop(), 0o755); } catch { /* gone */ }
  }
});
/** A folder with a raw colour in it, that the process cannot read. */
const lock = (root, dir) => {
  write(root, `${dir}/x.tsx`, BAD);
  chmodSync(join(root, dir), 0o000);
  locked.push(join(root, dir));
};
const items = (root, argv) => json(root, argv).notChecked;
const kinds = (root, argv) => items(root, argv).map((i) => i.kind);

describe.skipIf(!posix || asRoot)("an explicit glob over a folder that cannot be read", () => {
  test("strict does not pass over it, and the run does not say on-system", () => {
    const w = world();
    lock(w.root, "app/locked");
    const r = cli(w.root, ["gate", "--strict", "app/**/*.tsx"]);
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/on-system/);
    expect(r.out).toContain("1 directory could not be read (permission denied), so any UI file or stylesheet inside it was not checked.");
    expect(r.out).toContain("app/locked");
    expect(r.out).toMatch(/--strict: a run that checked less than it was configured to does not pass\./);
  });

  test("normal mode passes and says it checked less", () => {
    const w = world();
    lock(w.root, "app/locked");
    const r = cli(w.root, ["gate", "app/**/*.tsx"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/⚠ 1 not checked/);
  });

  test("the JSON has the item, once, with the directory and why", () => {
    const w = world();
    lock(w.root, "app/locked");
    const item = items(w.root, ["app/**/*.tsx"]).find((i) => i.kind === "directories");
    expect(item).toMatchObject({ kind: "directories", count: 1, files: ["app/locked"] });
    expect(item.fix).toContain('propose an "ignore" entry, with the reason, to the user; do not add one yourself.');
  });

  test("the run's own record stays out of the JSON", () => {
    const w = world();
    lock(w.root, "app/locked");
    expect(json(w.root, ["app/**/*.tsx"]).runs[0]).not.toHaveProperty("walked");
    expect(json(w.root).runs[0]).not.toHaveProperty("walked");
  });

  test("a directory the glob does not walk is not the run's business", () => {
    const w = world({ files: { "app/ok/b.tsx": GOOD } });
    lock(w.root, "app/locked");
    const r = cli(w.root, ["gate", "--strict", "app/ok/*.tsx"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✓ on-system/);
  });

  test("nor is one when the argument names a file", () => {
    const w = world();
    lock(w.root, "app/locked");
    expect(cli(w.root, ["gate", "--strict", "app/a.tsx"]).code).toBe(0);
  });

  test("a glob that names the folder itself reads it, and says it could not", () => {
    const w = world();
    lock(w.root, "app/locked");
    expect(kinds(w.root, ["app/locked/**/*.tsx"])).toContain("directories");
  });

  test.each([
    ["its own path", { "app/locked": "a mounted volume nobody reads" }],
    ["the path with /** after it", { "app/locked/**": "a mounted volume nobody reads" }],
    ["a glob that reaches it", { "app/**": "vendored" }],
  ])("ignore accounts for it by %s", (_label, ignore) => {
    const w = world({ over: { ignore: { "ds.css": "the token source", ...ignore } } });
    lock(w.root, "app/locked");
    const r = cli(w.root, ["gate", "--strict", "app/**/*.tsx"]);
    expect(r.out).not.toContain("could not be read");
  });

  test("a profile run over the same folder reports it once, whoever saw it first", () => {
    const w = world();
    lock(w.root, "app/locked");
    const directories = items(w.root, []).filter((i) => i.kind === "directories");
    expect(directories).toHaveLength(1);
    expect(directories[0]).toMatchObject({ count: 1, files: ["app/locked"] });
    expect(json(w.root).coverage.unreadable).toEqual({ found: 1, ignored: 0, notChecked: 1 });
  });

  test("no message carries a dash", () => {
    const w = world();
    lock(w.root, "app/locked");
    expect(cli(w.root, ["gate", "--strict", "app/**/*.tsx"]).out).not.toMatch(DASH);
  });
});

describe.skipIf(!posix || asRoot)("a profile that names a place the scan skips", () => {
  test("an unreadable subfolder of .storybook is reported, where the scan never looks", () => {
    const w = world({ files: { ".storybook/ok.tsx": GOOD }, include: ["app/**/*.tsx", ".storybook/**/*.tsx"] });
    lock(w.root, ".storybook/sub");
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("1 directory could not be read (permission denied)");
    expect(r.out).toContain(".storybook/sub");
    expect(json(w.root).coverage.unreadable).toEqual({ found: 1, ignored: 0, notChecked: 1 });
  });

  test("a hidden folder that no pattern names is not: the glob walked it, and could not have matched in it", () => {
    const w = world({ include: ["**/*.tsx"] });
    lock(w.root, ".cache/locked");
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.out).not.toContain("could not be read");
  });

  test("a pattern that takes a hidden folder away does not name one: another hidden folder is still not the run's business", () => {
    const w = world({ include: ["**/*.tsx", "!**/.cache/**"] });
    lock(w.root, ".other/locked");
    expect(cli(w.root, ["gate", "--strict"]).out).not.toContain("could not be read");
  });

  test("nor is anything inside node_modules, or a package's own build output", () => {
    const w = world({ include: ["**/*.tsx"], files: { "package.json": "{}" } });
    lock(w.root, "node_modules/pkg/locked");
    lock(w.root, "dist/locked");
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.out).not.toContain("could not be read");
  });
});

describe.skipIf(!posix)("an explicit glob over a link", () => {
  const LINK = { "app/ui": "@ui" };

  test("strict does not pass over a link to somewhere unread: what is behind it was not checked", () => {
    const w = world({ links: LINK });
    const r = cli(w.root, ["gate", "--strict", "app/**/*.tsx"]);
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/on-system/);
    expect(r.out).toContain("1 symbolic link points to source Undrift does not follow, so no rule ran on what is behind it.");
    expect(r.out).toContain(`app/ui -> ${shown(w, "ui")}`);
    expect(r.out).toContain('propose an "ignore" entry, with the reason, to the user; do not add one yourself.');
  });

  test("the JSON has the item of its own", () => {
    const w = world({ links: LINK });
    const item = items(w.root, ["app/**/*.tsx"]).find((i) => i.kind === "links");
    expect(item.links).toEqual([{ path: "app/ui", target: shown(w, "ui"), kind: "directory" }]);
  });

  test("a glob that starts at the link goes through it, and is not a link it did not follow", () => {
    const w = world({ links: LINK });
    const r = cli(w.root, ["gate", "--strict", "app/ui/**/*.tsx"]);
    expect(r.out).toContain("[no-raw-colors]");
    expect(r.out).not.toMatch(/symbolic link/);
  });

  test("another argument that covers what is behind it covers the link", () => {
    const w = world({ links: LINK });
    const r = cli(w.root, ["gate", "--strict", "app/**/*.tsx", `${shown(w, "ui")}/**/*.tsx`]);
    expect(r.out).toContain("[no-raw-colors]");
    expect(r.out).not.toMatch(/symbolic link/);
  });

  test("so does the absolute real path, given as an argument", () => {
    const w = world({ links: LINK });
    const r = cli(w.root, ["gate", "--strict", "app/**/*.tsx", `${realpathSync(join(w.outside, "ui"))}/**/*.tsx`]);
    expect(r.out).not.toMatch(/symbolic link/);
  });

  test("a link to a folder of the repository is not reported: its files are where they are", () => {
    const w = world({ links: { "app/shared": "../lib/shared" }, files: { "lib/shared/x.tsx": GOOD } });
    expect(cli(w.root, ["gate", "--strict", "app/**/*.tsx"]).out).not.toMatch(/symbolic link/);
  });

  test("a link to a folder with no source behind it is not reported either", () => {
    const w = world({ links: { "app/img": "@images" }, outsideFiles: { "images/logo.png": "png" } });
    expect(cli(w.root, ["gate", "--strict", "app/**/*.tsx"]).code).toBe(0);
  });

  test("ignore accounts for it by the link's path", () => {
    const w = world({ links: LINK, over: { ignore: { "ds.css": "the token source", "app/ui": "another team's folder" } } });
    expect(cli(w.root, ["gate", "--strict", "app/**/*.tsx"]).out).not.toMatch(/symbolic link/);
  });

  test("a literal path through the link is a file asked for, and is gated as before", () => {
    const w = world({ links: LINK });
    const r = cli(w.root, ["gate", "--strict", "app/ui/x.tsx"]);
    expect(r.out).toContain("[no-raw-colors]");
    expect(r.out).not.toMatch(/symbolic link/);
  });

  test("no message carries a dash", () => {
    const w = world({ links: LINK });
    expect(cli(w.root, ["gate", "--strict", "app/**/*.tsx"]).out).not.toMatch(DASH);
  });
});

describe.skipIf(!posix)("a profile over a link in a place the scan skips", () => {
  test("a link inside .storybook, that a profile names, is reported", () => {
    const w = world({ links: { ".storybook/ui": "@ui" }, include: ["app/**/*.tsx", ".storybook/**/*.tsx"] });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`.storybook/ui -> ${shown(w, "ui")}`);
  });

  test("a hidden link that no pattern names is not", () => {
    const w = world({ links: { ".hidden/ui": "@ui" }, include: ["**/*.tsx"] });
    expect(cli(w.root, ["gate", "--strict"]).out).not.toMatch(/symbolic link/);
  });
});

describe("recordWalk", () => {
  const walk = (w, patterns) => {
    const contract = loadContract(w.root);
    const rec = recordWalk(contract, patterns);
    const files = fg.sync(patterns, { cwd: w.root, absolute: true, ...GLOB_OPTIONS, fs: rec.fs });
    return { files, walked: rec.walked() };
  };

  test.skipIf(!posix || asRoot)("records the directories a walk could not read, and the links it met, and changes nothing about what it finds", () => {
    const w = world({ links: { "app/ui": "@ui" }, files: { "app/ok/b.tsx": GOOD } });
    lock(w.root, "app/locked");
    const recorded = walk(w, ["app/**/*.tsx"]);
    const plain = fg.sync(["app/**/*.tsx"], { cwd: w.root, absolute: true, ...GLOB_OPTIONS });
    expect(recorded.files.sort()).toEqual(plain.sort());
    expect(recorded.walked.unreadable).toEqual([{ path: "app/locked", reason: "permission denied" }]);
    expect(recorded.walked.links).toEqual(["app/ui"]);
  });

  test("a walk that meets nothing records nothing", () => {
    const w = world();
    expect(walk(w, ["app/**/*.tsx"]).walked).toMatchObject({ unreadable: [], links: [] });
  });

  test("a folder that is gone is not one that could not be read", () => {
    const w = world();
    expect(walk(w, ["nowhere/**/*.tsx"]).walked).toMatchObject({ unreadable: [], links: [] });
  });

  test("the run's matches ride along, as absolute paths", () => {
    const w = world();
    const contract = loadContract(w.root);
    const run = gateFiles(["app/**/*.tsx"], { contract });
    expect(run.walked.matched).toHaveLength(1);
    expect(run.walked.matched[0]).toMatch(/\/app\/a\.tsx$/);
  });

  test("gateProfile returns the record for a profile's own run and for explicit paths", () => {
    const w = world({ links: { "app/ui": "@ui" } });
    const contract = loadContract(w.root);
    expect(gateProfile("app", { contract }).walked.links).toEqual(["app/ui"]);
    expect(gateProfile("app", { contract, extraPatterns: ["app/**/*.tsx"] }).walked.links).toEqual(["app/ui"]);
    expect(gateProfile("app", { contract, extraPatterns: ["app/a.tsx"] }).walked.links).toEqual([]);
  });
});

// A link to a folder that holds the repository is a door on everything above it. Its matched files were
// once kept by their absolute paths as well, and every path inside the repository starts with the
// folder's own path, so an explicit glob (`app/**/*.tsx`, over `app/up -> ../..`) counted the link as
// covered by the repository's own files: `gate --strict` said on-system, with a raw colour in the folder
// above unread.
describe.skipIf(!posix)("an explicit glob over a link to a folder that holds the repository", () => {
  const above = () => {
    const w = world({ links: { "app/up": "../.." } });
    write(w.base, "top.tsx", BAD); // the folder above the repository
    return w;
  };

  test("strict reports the link, as one to a folder that holds the repository, and does not pass", () => {
    const w = above();
    const r = cli(w.root, ["gate", "--strict", "app/**/*.tsx"]);
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/on-system/);
    expect(r.out).toContain("app/up -> ..");
    const j = json(w.root, ["--strict", "app/**/*.tsx"]);
    expect(j.pass).toBe(false);
    expect(j.notChecked.find((i) => i.kind === "links").links).toEqual([
      expect.objectContaining({ path: "app/up", target: "..", kind: "directory", ancestor: true }),
    ]);
  });

  test("normal mode exits 0 and says it checked less", () => {
    const w = above();
    const r = cli(w.root, ["gate", "app/**/*.tsx"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/⚠ 1 not checked/);
  });
});

// The profile's own line said "✓ clean" over a folder it could not read, while the status line under
// it warned. It looked only at the files it did check.
describe.skipIf(!posix || asRoot)("the profile line over what its glob could not see", () => {
  test("a folder it could not read is not clean", () => {
    const w = world();
    lock(w.root, "app/locked");
    const r = cli(w.root, ["gate", "app/**/*.tsx"]);
    expect(r.out).toMatch(/profile app .*⚠ no violations, 1 folder\(s\) or link\(s\) not checked/);
    expect(r.out).not.toMatch(/profile app .*✓ clean/);
  });

  test("nor is a link it did not follow", () => {
    const w = world({ links: { "app/ui": "@ui" } });
    const r = cli(w.root, ["gate", "app/**/*.tsx"]);
    expect(r.out).toMatch(/profile app .*⚠ no violations, 1 folder\(s\) or link\(s\) not checked/);
    expect(r.out).not.toMatch(/profile app .*✓ clean/);
  });

  test("a clean walk is still clean", () => {
    const w = world();
    expect(cli(w.root, ["gate", "app/**/*.tsx"]).out).toMatch(/profile app .*✓ clean/);
  });
});
