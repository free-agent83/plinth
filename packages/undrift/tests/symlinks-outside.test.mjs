// A link is not followed, so what is behind it is only ever looked at if it also lives
// somewhere the scan reaches: a link to another folder of the repository is fine, the
// files are there under their own names. A link to a place outside the repository, or
// into a place the scan skips, is a door nothing opens. `app/ui -> /elsewhere/ui` with an
// include of app/**/*.tsx used to be gated through the link and was checked; once no glob
// followed links it was not, and nothing said so: strict exited 0 and printed on-system
// over a raw colour in the linked folder, and the hook was silent.
//
// The scan now records every link it meets, and one that leads somewhere unread is not
// checked, in the text, the JSON and the hook: not followed, so include its real path, or
// propose an ignore entry to the user.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";
import { classifyCoverage, findSourceFiles } from "../src/unchecked.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "../bin/undrift.mjs");
const HOOK = resolve(here, "../hooks/undrift-hook.mjs");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const DASH = /[\u2014\u2013]/;
const BAD = `export const B = () => <div style={{ color: "#ff0000" }} />;\n`;
const GOOD = `export const G = () => <div className="bg-primary p-4" />;\n`;
const SCRIPT_BAD = `export const brand = "#ff0000";\n`;
const posix = process.platform !== "win32";

const cli = (root, argv) => {
  try {
    return { code: 0, out: strip(execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 })) };
  } catch (e) {
    return { code: exited(e), out: strip((e.stdout ?? "") + (e.stderr ?? "")) };
  }
};
const hook = (root, file) => {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_input: { file_path: file } }), cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 }), stderr: "" };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};
const context = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;

const write = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};

/**
 * A repository with a clean app/a.tsx, and a folder outside it (`elsewhere/ui`, with a raw
 * colour in a component and a stylesheet). `links` is what to link into the repository.
 */
function world({ links = {}, files = {}, over = {}, include = ["app/**/*.tsx"] } = {}) {
  const base = mkdtempSync(join(tmpdir(), "u-out-"));
  const root = join(base, "repo");
  const outside = join(base, "elsewhere");
  write(root, "ds.css", ":root{--color-primary:#3b5bdb}");
  write(root, "app/a.tsx", GOOD);
  write(outside, "ui/x.tsx", BAD);
  write(outside, "ui/y.css", ".a{color:#f00}\n");
  write(outside, "ui/deep/z.tsx", BAD);
  write(outside, "notes.md", "# notes\n");
  // scripts, and files that are not source, for the links that lead to them
  write(outside, "ui/lib.ts", SCRIPT_BAD);
  write(outside, "ui/util.mjs", "export const util = 1;\n");
  write(outside, "ui/deep/inner.cts", "export const inner = 1;\n");
  write(outside, "ui/data.json", '{"a":1}\n');
  write(outside, "ui/logo.svg", "<svg/>\n");
  write(outside, "lib.ts", SCRIPT_BAD);
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  for (const [rel, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    symlinkSync(target.startsWith("@") ? join(outside, target.slice(1)) : target, join(root, rel));
  }
  write(
    root,
    "undrift.config.json",
    JSON.stringify({
      system: "@acme/ds",
      tokensCss: "ds.css",
      ignore: { "ds.css": "the token source" },
      profiles: { app: { include, rules: ["no-raw-colors"] } },
      ...over,
    })
  );
  return { root, outside, base };
}
const DIR = { "app/ui": "@ui" };
// the target as the report shows it: relative to the repository
const shown = (w, sub) => relative(join(w.base, "repo"), join(w.outside, sub)).split("\\").join("/");

describe.skipIf(!posix)("a link to a directory outside the repository", () => {
  test("strict does not pass over it, and the run does not say on-system", () => {
    const w = world({ links: DIR });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/on-system/);
    expect(r.out).toContain("1 symbolic link points to source Undrift does not follow, so no rule ran on what is behind it.");
    expect(r.out).toContain(`app/ui -> ${shown(w, "ui")}`);
    expect(r.out).toMatch(/--strict: a run that checked less than it was configured to does not pass\./);
  });

  test("normal mode passes and says it checked less", () => {
    const r = cli(world({ links: DIR }).root, ["gate"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/⚠ 1 not checked/);
    expect(r.out).toContain("This one exits 0");
  });

  test("the fix says how: include the real path, or propose an ignore entry to the user", () => {
    const w = world({ links: DIR });
    const r = cli(w.root, ["gate"]);
    expect(r.out).toContain(
      `Fix: Include the real path in a profile so the rules run on it, for example ${JSON.stringify(`${shown(w, "ui")}/**/*.tsx`)}. ` +
        'If it should not be checked, propose an "ignore" entry, with the reason, to the user; do not add one yourself.'
    );
  });

  test("the JSON has an item of its own, and the counts", () => {
    const w = world({ links: DIR });
    const j = JSON.parse(cli(w.root, ["gate", "--format", "json"]).out);
    const item = j.notChecked.find((i) => i.kind === "links");
    expect(item).toMatchObject({ kind: "links", count: 1, files: ["app/ui"] });
    expect(item.links).toEqual([{ path: "app/ui", target: shown(w, "ui"), kind: "directory" }]);
    expect(j.coverage.links).toEqual({ found: 1, covered: 0, ignored: 0, notChecked: 1 });
    expect(j.pass).toBe(true);
  });

  test("following the advice covers it: the violation behind the link is found, and the link is no longer reported", () => {
    const w = world({ links: DIR });
    const first = cli(w.root, ["gate"]).out;
    const pattern = JSON.parse(/for example ("[^"]*")\./.exec(first)[1]);
    const after = world({ links: DIR, include: ["app/**/*.tsx", pattern] });
    // a second world has its own outside folder: the pattern is relative to it in the same way
    const r = cli(after.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[no-raw-colors]");
    expect(r.out).toContain("x.tsx");
    expect(r.out).not.toMatch(/symbolic link/);
  });

  test.each([
    ["its own path", { "app/ui": "a folder that belongs to another team" }],
    ["the path with /** after it", { "app/ui/**": "a folder that belongs to another team" }],
    ["a glob that reaches it", { "app/**": "vendored" }],
    ["a glob that names it anywhere", { "**/ui": "always somebody else's" }],
  ])("ignore accounts for it by %s", (_label, ignore) => {
    const w = world({ links: DIR, over: { ignore: { "ds.css": "the token source", ...ignore } } });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/symbolic link/);
    expect(r.out).toMatch(/✓ on-system/);
    const j = JSON.parse(cli(w.root, ["gate", "--format", "json"]).out);
    expect(j.coverage.links).toMatchObject({ found: 1, ignored: 1, notChecked: 0 });
  });

  test("no message carries a dash", () => {
    const w = world({ links: DIR });
    expect(cli(w.root, ["gate", "--strict"]).out).not.toMatch(DASH);
    expect(context(hook(w.root, join(w.root, "app/ui/x.tsx")))).not.toMatch(DASH);
  });
});

describe.skipIf(!posix)("links of the other kinds", () => {
  test("a link to a UI file outside the repository is not checked, and the example is that file", () => {
    const w = world({ links: { "app/linked.tsx": "@ui/x.tsx" } });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`app/linked.tsx -> ${shown(w, "ui/x.tsx")}`);
    expect(r.out).toContain(`for example ${JSON.stringify(shown(w, "ui/x.tsx"))}.`);
    expect(JSON.parse(cli(w.root, ["gate", "--format", "json"]).out).notChecked.find((i) => i.kind === "links").links[0].kind).toBe("UI file");
  });

  test("a link to a stylesheet outside the repository is not checked, and no profile can cover it", () => {
    const w = world({ links: { "app/linked.css": "@ui/y.css" } });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`app/linked.css -> ${shown(w, "ui/y.css")}`);
    expect(r.out).toContain("No profile covers a stylesheet");
    expect(r.out).not.toContain("for example");
    expect(r.out).toContain('propose an "ignore" entry');
  });

  test("several links are one item, with each of them listed", () => {
    const w = world({ links: { "app/ui": "@ui", "app/linked.tsx": "@ui/x.tsx", "app/more": "@ui/deep" } });
    const r = cli(w.root, ["gate"]);
    expect(r.out).toContain("3 symbolic links point to source Undrift does not follow, so no rule ran on what is behind them.");
    for (const path of ["app/linked.tsx", "app/more", "app/ui"]) expect(r.out).toContain(path);
    expect(r.out).toContain("propose an \"ignore\" entry, with the reason, to the user");
  });

  test("a link into a place the scan skips is not checked either", () => {
    const w = world({
      files: { "package.json": "{}", "dist/gen/g.tsx": BAD },
      links: { "app/gen": "../dist/gen" },
    });
    const c = loadContract(w.root);
    expect(findSourceFiles(c).ui).toEqual(["app/a.tsx"]);
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("app/gen -> dist/gen");
  });

  test("a link to another folder of the repository is not reported: its files are scanned where they are", () => {
    const w = world({ files: { "lib/shared/x.tsx": GOOD }, links: { "app/shared": "../lib/shared", "app/one.tsx": "../lib/shared/x.tsx" } });
    const r = cli(w.root, ["gate"]);
    expect(r.out).not.toMatch(/symbolic link/);
    const cov = classifyCoverage(loadContract(w.root));
    expect(cov.links).toEqual([]);
    expect(cov.counts.links).toEqual({ found: 0, covered: 0, ignored: 0, notChecked: 0 });
  });

  test("a link to nothing has nothing behind it, and a link to a file Undrift never reads is nothing to say", () => {
    const w = world({ links: { "app/broken": join("/", "nowhere", "at", "all"), "app/notes": "@notes.md" } });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/symbolic link/);
  });

  // A node_modules that is a link is ordinary: a workspace root shared by packages
  // (`node_modules -> ../../node_modules`), a mounted volume, a pnpm layout. It is never
  // anyone's source, whether it is a directory or a link to one, and the same goes for the
  // other places that are never source and for a package's own build output. Caught by the
  // check of a copy of the public export, whose node_modules is a link to the real one.
  test.each([
    ["node_modules", {}],
    [".next", {}],
    ["storybook-static", {}],
    ["packages/ui/node_modules", { "packages/ui/package.json": "{}" }],
    ["packages/ui/dist", { "packages/ui/package.json": "{}" }],
    ["packages/ui/build", { "packages/ui/package.json": "{}" }],
    ["coverage", { "package.json": "{}" }],
  ])("a link called %s is a place that is never source, so it is not reported", (name, files) => {
    const w = world({ files, links: { [name]: "@ui" } });
    expect(findSourceFiles(loadContract(w.root)).links).toEqual([]);
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/symbolic link/);
    expect(r.out).toMatch(/✓ on-system/);
  });

  test("but a link called dist where no package.json sits beside it is source, and is reported", () => {
    const w = world({ links: { "app/dist": "@ui" } });
    expect(findSourceFiles(loadContract(w.root)).links).toEqual(["app/dist"]);
    expect(cli(w.root, ["gate", "--strict"]).out).toContain("app/dist -> ");
  });

  test("a link inside node_modules or a hidden directory is never looked at", () => {
    const w = world({ links: { "node_modules/pkg": "@ui", ".cache/ui": "@ui" } });
    const found = findSourceFiles(loadContract(w.root));
    expect(found.links).toEqual([]);
    expect(cli(w.root, ["gate", "--strict"]).code).toBe(0);
  });

  test("the scan lists every link it meets, sorted, whatever it leads to", () => {
    const w = world({ links: { "app/z": "@ui", "app/b": "@notes.md", "app/a": join("/", "nowhere") } });
    expect(findSourceFiles(loadContract(w.root)).links).toEqual(["app/a", "app/b", "app/z"]);
  });
});

describe.skipIf(!posix)("the hook says the same", () => {
  test("a file written through the link is not silently passed", () => {
    const w = world({ links: DIR });
    const r = hook(w.root, join(w.root, "app/ui/x.tsx"));
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(context(r)).toBe(
      `Undrift did not check app/ui/x.tsx: it is reached through a symbolic link (app/ui points to ${shown(w, "ui")}), which Undrift does not follow, so no rule ran on it. ` +
        `Fix: include its real path in a profile so the rules run on it, for example ${JSON.stringify(`${shown(w, "ui")}/**/*.tsx`)}. ` +
        'If it should not be checked, propose an "ignore" entry, with the reason, to the user; do not add one yourself.'
    );
  });

  test("a file in a folder below the link is told the same way", () => {
    const w = world({ links: DIR });
    expect(context(hook(w.root, join(w.root, "app/ui/deep/z.tsx")))).toContain("Undrift did not check app/ui/deep/z.tsx: it is reached through a symbolic link (app/ui points to");
  });

  test("it is said once per link file per version of the config", () => {
    const w = world({ links: DIR });
    context(hook(w.root, join(w.root, "app/ui/x.tsx")));
    expect(hook(w.root, join(w.root, "app/ui/x.tsx"))).toEqual({ code: 0, stdout: "", stderr: "" });
    // another file behind the same link is another notice
    context(hook(w.root, join(w.root, "app/ui/deep/z.tsx")));
  });

  test("a stylesheet behind the link is told, and no profile is offered for it", () => {
    const w = world({ links: DIR });
    const text = context(hook(w.root, join(w.root, "app/ui/y.css")));
    expect(text).toContain("Undrift did not check app/ui/y.css: it is reached through a symbolic link");
    expect(text).not.toContain("for example");
    expect(text).toContain('propose an "ignore" entry');
  });

  test.each([
    ["its own path", { "app/ui": "not ours" }],
    ["the path with /** after it", { "app/ui/**": "not ours" }],
  ])("silent when ignore accounts for the link by %s", (_label, ignore) => {
    const w = world({ links: DIR, over: { ignore: { "ds.css": "the token source", ...ignore } } });
    expect(hook(w.root, join(w.root, "app/ui/x.tsx"))).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("blocks a violation once the real path is included, and names the file it gated", () => {
    const probe = world({ links: DIR });
    const pattern = `${shown(probe, "ui")}/**/*.tsx`;
    const w = world({ links: DIR, include: ["app/**/*.tsx", pattern] });
    const r = hook(w.root, join(w.root, "app/ui/x.tsx"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("#ff0000");
  });

  test("a file that is not source behind the link is nothing to say", () => {
    const w = world({ links: { "app/notes": "@notes.md" } });
    expect(hook(w.root, join(w.root, "app/notes"))).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("a file reached through a link to another folder of the repository is judged where it lives, as before", () => {
    const w = world({ files: { "lib/shared/x.tsx": GOOD }, links: { "app/shared": "../lib/shared" } });
    const text = context(hook(w.root, join(w.root, "app/shared/x.tsx")));
    expect(text).toContain("Undrift did not check lib/shared/x.tsx: no profile in undrift.config.json covers it");
    expect(text).not.toContain("symbolic link");
  });

  test("a plain file with no link on the way is judged as it always was", () => {
    const w = world({ links: DIR });
    expect(hook(w.root, join(w.root, "app/a.tsx"))).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});

// A profile can include a script (.ts, .js, .mjs), and a script is gated only where it lives, so
// one behind a link that leads somewhere unread is not checked either. Behind a link to a
// directory the whole-repository run already reports the link, and the hook says the same of
// the file just written. A link that is itself one script is another matter: Undrift lists no
// script of its own, only what a profile includes, so such a link is reported when a profile's
// include matches the link itself, and is nothing to say otherwise (a linked config script no
// profile includes).
const SCRIPT_PROFILE = ["app/**/*.ts", "app/**/*.mjs", "app/**/*.cts"];
const SILENT = { code: 0, stdout: "", stderr: "" };

describe.skipIf(!posix)("a script behind a link to a directory", () => {
  test.each([
    ["lib.ts", ".ts"],
    ["util.mjs", ".mjs"],
    ["deep/inner.cts", ".cts"],
  ])("the hook tells of %s, with the pattern for that kind of file", (name, ext) => {
    const w = world({ links: DIR, include: SCRIPT_PROFILE });
    const r = hook(w.root, join(w.root, "app/ui", name));
    expect(r.code).toBe(0);
    expect(context(r)).toBe(
      `Undrift did not check app/ui/${name}: it is reached through a symbolic link (app/ui points to ${shown(w, "ui")}), which Undrift does not follow, so no rule ran on it. ` +
        `Fix: include its real path in a profile so the rules run on it, for example ${JSON.stringify(`${shown(w, "ui")}/**/*${ext}`)}. ` +
        'If it should not be checked, propose an "ignore" entry, with the reason, to the user; do not add one yourself.'
    );
  });

  test.each(["data.json", "logo.svg"])("%s is not source, and the hook has nothing to say of it", (name) => {
    const w = world({ links: DIR, include: SCRIPT_PROFILE });
    expect(hook(w.root, join(w.root, "app/ui", name))).toEqual(SILENT);
  });

  test("once the real path is included, the hook gates the script, and a violation blocks", () => {
    const probe = world({ links: DIR });
    const w = world({ links: DIR, include: [...SCRIPT_PROFILE, `${shown(probe, "ui")}/**/*.ts`] });
    const r = hook(w.root, join(w.root, "app/ui/lib.ts"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("#ff0000");
    expect(r.stderr).not.toContain("symbolic link");
  });

  test.each([
    ["its own path", { "app/ui": "not ours" }],
    ["the path with /** after it", { "app/ui/**": "not ours" }],
  ])("silent when ignore accounts for the link by %s", (_label, ignore) => {
    const w = world({ links: DIR, include: SCRIPT_PROFILE, over: { ignore: { "ds.css": "the token source", ...ignore } } });
    expect(hook(w.root, join(w.root, "app/ui/lib.ts"))).toEqual(SILENT);
  });

  test("through a link to another folder of the repository a script is judged where it lives", () => {
    const w = world({ files: { "lib/shared/x.ts": SCRIPT_BAD }, links: { "app/shared": "../lib/shared" }, include: ["lib/**/*.ts"] });
    const r = hook(w.root, join(w.root, "app/shared/x.ts"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("lib/shared/x.ts");
    expect(r.stderr).not.toContain("symbolic link");
  });

  // The places the scan never opens are nobody's source, so nothing under one is claimed, a
  // link to somewhere else or not: the hook agrees with the scan, which does not report them.
  test.each([
    ["node_modules", {}],
    [".hidden", {}],
    ["packages/ui/dist", { "packages/ui/package.json": "{}" }],
  ])("under a linked %s the hook claims nothing, of a script or a UI file", (name, files) => {
    const w = world({ files, links: { [name]: "@ui" }, include: ["**/*.ts", "**/*.tsx"] });
    expect(hook(w.root, join(w.root, name, "lib.ts"))).toEqual(SILENT);
    expect(hook(w.root, join(w.root, name, "x.tsx"))).toEqual(SILENT);
  });

  test("but a link called dist where no package.json sits beside it is claimed, as the scan reports it", () => {
    const w = world({ links: { "app/dist": "@ui" }, include: SCRIPT_PROFILE });
    expect(context(hook(w.root, join(w.root, "app/dist/lib.ts")))).toContain("Undrift did not check app/dist/lib.ts: it is reached through a symbolic link");
  });
});

describe.skipIf(!posix)("a link that is itself one script", () => {
  const LINK = { "app/x.ts": "@lib.ts" };
  const INCLUDES_LINK = ["app/**/*.ts", "app/**/*.tsx"];

  test("under a profile that includes the link's own path it is not checked: strict fails, and the fix names the file", () => {
    const w = world({ links: LINK, include: INCLUDES_LINK });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/on-system/);
    expect(r.out).toContain(`app/x.ts -> ${shown(w, "lib.ts")}`);
    expect(r.out).toContain(`for example ${JSON.stringify(shown(w, "lib.ts"))}.`);
    const item = JSON.parse(cli(w.root, ["gate", "--format", "json"]).out).notChecked.find((i) => i.kind === "links");
    expect(item.links).toEqual([{ path: "app/x.ts", target: shown(w, "lib.ts"), kind: "script" }]);
  });

  test("under one that does not include it, it is nothing to say: Undrift lists no script of its own", () => {
    const w = world({ links: LINK });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/symbolic link/);
    expect(r.out).toMatch(/✓ on-system/);
    // the scan still meets it, as it meets every link
    expect(findSourceFiles(loadContract(w.root)).links).toEqual(["app/x.ts"]);
  });

  test("the hook says the same of the file just written, and only under a profile that includes the link", () => {
    const included = world({ links: LINK, include: INCLUDES_LINK });
    expect(context(hook(included.root, join(included.root, "app/x.ts")))).toContain(
      `Undrift did not check app/x.ts: it is reached through a symbolic link (app/x.ts points to ${shown(included, "lib.ts")})`
    );
    const other = world({ links: LINK });
    expect(hook(other.root, join(other.root, "app/x.ts"))).toEqual(SILENT);
  });

  test("the real path in a profile gates it, in the run and in the hook", () => {
    const probe = world({ links: LINK });
    const w = world({ links: LINK, include: [...INCLUDES_LINK, shown(probe, "lib.ts")] });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.out).toContain("[no-raw-colors]");
    expect(r.out).not.toMatch(/symbolic link/);
    expect(hook(w.root, join(w.root, "app/x.ts")).code).toBe(2);
  });

  test("ignore accounts for it by its own path", () => {
    const w = world({ links: LINK, include: INCLUDES_LINK, over: { ignore: { "ds.css": "the token source", "app/x.ts": "a script another team owns" } } });
    const r = cli(w.root, ["gate", "--strict"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/symbolic link/);
    expect(hook(w.root, join(w.root, "app/x.ts"))).toEqual(SILENT);
  });
});
