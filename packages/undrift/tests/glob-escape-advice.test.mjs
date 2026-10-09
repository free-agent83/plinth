// A Next.js route group is a folder called (marketing), and a dynamic route is a folder
// called [id]. To a glob they are syntax: "app/(marketing)/**" matches nothing at all,
// so a config written the natural way matches no files. The report then said "add it
// to the include", and a person who did exactly that, writing the same path, got the
// same nothing. Each fix that asks for a pattern now says that such a name has to be
// escaped, with the pattern to write.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectNotChecked, escapeGlob, pathEscapeAdvice, patternEscapeAdvice } from "../src/unchecked.mjs";
import { loadContract } from "../src/contract.mjs";
import { classifyCoverage } from "../src/unchecked.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "../bin/undrift.mjs");
const HOOK = resolve(here, "../hooks/undrift-hook.mjs");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const DASH = /[\u2014\u2013]/;
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

function repo(files, include, over = {}) {
  const root = mkdtempSync(join(tmpdir(), "u-escape-"));
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("ds.css", ":root{--color-primary:#3b5bdb}");
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  write(
    "undrift.config.json",
    JSON.stringify({
      system: "@acme/ds",
      tokensCss: "ds.css",
      ignore: { "ds.css": "the token source" },
      profiles: { app: { include, rules: ["no-raw-colors"] } },
      ...over,
    })
  );
  return root;
}

// What is written in undrift.config.json is JSON, so a backslash is doubled there.
// The advice quotes the pattern in that form, so it can be pasted as it is.
const inJson = (pattern) => JSON.stringify(pattern);

describe("escapeGlob", () => {
  test.each([
    ["app/(marketing)/page.tsx", "app/\\(marketing\\)/page.tsx"],
    ["app/[id]/page.tsx", "app/\\[id\\]/page.tsx"],
    ["app/{a,b}/x.tsx", "app/\\{a,b\\}/x.tsx"],
    ["app/plain/page.tsx", "app/plain/page.tsx"],
  ])("%s", (path, escaped) => {
    expect(escapeGlob(path)).toBe(escaped);
  });
});

describe("the advice for paths", () => {
  test("nothing for paths that hold no syntax", () => {
    expect(pathEscapeAdvice(["app/a.tsx", "app/b/c.tsx"])).toBe("");
    expect(pathEscapeAdvice([])).toBe("");
  });

  test("names the folder, and the pattern to write for it", () => {
    const advice = pathEscapeAdvice(["app/(marketing)/about/page.tsx"]);
    expect(advice).toBe(
      ' A name with parentheses or brackets, as in app/(marketing), is read as glob syntax unless each one is escaped with a backslash: write "app/\\\\(marketing\\\\)/**".'
    );
  });

  test("the tail is the caller's: a pattern for UI files ends in the extension", () => {
    expect(pathEscapeAdvice(["app/(marketing)/page.tsx"], "/**/*.tsx")).toContain(inJson("app/\\(marketing\\)/**/*.tsx"));
  });

  test("the outermost such folder, since the pattern beneath it covers the rest", () => {
    const advice = pathEscapeAdvice(["apps/web/app/(dashboard)/[id]/page.tsx"]);
    expect(advice).toContain(inJson("apps/web/app/\\(dashboard\\)/**"));
    expect(advice).toContain("as in apps/web/app/(dashboard),");
    expect(advice).not.toContain("[id]");
  });

  test("takes the first path that needs it, not the first path", () => {
    const advice = pathEscapeAdvice(["app/plain/a.tsx", "app/[slug]/b.tsx", "app/(g)/c.tsx"]);
    expect(advice).toContain(inJson("app/\\[slug\\]/**"));
    expect(advice).not.toContain("(g)");
  });

  test("syntax in the file name itself is the file, written out", () => {
    const advice = pathEscapeAdvice(["app/[id].tsx"], "/**/*.tsx");
    expect(advice).toContain(inJson("app/\\[id\\].tsx"));
    expect(advice).toContain("as in app/[id].tsx,");
  });

  test("carries no dash", () => {
    expect(pathEscapeAdvice(["app/(marketing)/page.tsx"])).not.toMatch(DASH);
  });
});

describe("the advice for patterns", () => {
  test("nothing for a pattern that is only glob syntax", () => {
    for (const glob of ["app/**/*.tsx", "app/**/*.{ts,tsx}", "src/+(a|b)/**", "!**/*.test.tsx", "app/\\(marketing\\)/**"]) {
      expect(patternEscapeAdvice([glob]), glob).toBe("");
    }
  });

  test("a route group written as it is on disk gets the escaped pattern", () => {
    expect(patternEscapeAdvice(["app/(marketing)/**/*.tsx"])).toBe(
      ' If a folder name has parentheses or brackets, as in app/(marketing), escape each one with a backslash in the pattern: write "app/\\\\(marketing\\\\)/**/*.tsx".'
    );
  });

  test("so does a dynamic route, and a negation keeps its !", () => {
    expect(patternEscapeAdvice(["app/[id]/**/*.tsx"])).toContain(inJson("app/\\[id\\]/**/*.tsx"));
    expect(patternEscapeAdvice(["!app/(legacy)/**"])).toContain(inJson("!app/\\(legacy\\)/**"));
  });

  test("only the whole-segment forms are escaped, so a real class or group in the same pattern is left alone", () => {
    const advice = patternEscapeAdvice(["app/(marketing)/[a-c]*.{ts,tsx}"]);
    expect(advice).toContain(inJson("app/\\(marketing\\)/[a-c]*.{ts,tsx}"));
  });

  test("carries no dash", () => {
    expect(patternEscapeAdvice(["app/(marketing)/**"])).not.toMatch(DASH);
  });
});

describe("in the items", () => {
  const load = (files, include = ["lib/**/*.tsx"], over = {}) => loadContract(repo(files, include, over));

  test("UI files covered by no profile: the fix says how to write the pattern", () => {
    const c = load({ "app/(marketing)/page.tsx": GOOD, "lib/a.tsx": GOOD });
    const [item] = collectNotChecked({ contract: c, runs: [{ name: "app", files: 1, rulesNotRun: [] }], coverage: classifyCoverage(c) });
    expect(item.kind).toBe("files");
    expect(item.fix).toMatch(/^Add it to a profile's include in undrift\.config\.json so the rules run on it\./);
    expect(item.fix).toContain(inJson("app/\\(marketing\\)/**/*.tsx"));
  });

  test("with plain paths the fix is exactly what it was", () => {
    const c = load({ "app/plain/page.tsx": GOOD, "lib/a.tsx": GOOD });
    const [item] = collectNotChecked({ contract: c, runs: [{ name: "app", files: 1, rulesNotRun: [] }], coverage: classifyCoverage(c) });
    expect(item.fix).toBe(
      "Add it to a profile's include in undrift.config.json so the rules run on it. " +
        'If it should not be checked, propose an "ignore" entry, with the reason, to the user; do not add one yourself.'
    );
  });

  test("the advice looks at every uncovered file, not only the ten that are listed", () => {
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`app/p${String(i).padStart(2, "0")}/page.tsx`, GOOD]));
    files["app/zz/[id]/page.tsx"] = GOOD;
    const c = load({ ...files, "lib/a.tsx": GOOD });
    const [item] = collectNotChecked({ contract: c, runs: [{ name: "app", files: 1, rulesNotRun: [] }], coverage: classifyCoverage(c) });
    expect(item.fix).toContain(inJson("app/zz/\\[id\\]/**/*.tsx"));
  });

  test("stylesheets: the ignore key has to be escaped too", () => {
    const c = load({ "app/(marketing)/site.css": "a{}", "lib/a.tsx": GOOD });
    const items = collectNotChecked({ contract: c, runs: [{ name: "app", files: 1, rulesNotRun: [] }], coverage: classifyCoverage(c) });
    const sheets = items.find((i) => i.kind === "stylesheets");
    expect(sheets.fix).toContain(inJson("app/\\(marketing\\)/**"));
  });

  test("a profile that matched nothing: the fix names the escaped include", () => {
    const c = load({ "app/(marketing)/page.tsx": GOOD }, ["app/(marketing)/**/*.tsx"]);
    const items = collectNotChecked({ contract: c, runs: [{ name: "app", files: 0, rulesNotRun: [] }] });
    const item = items.find((i) => i.kind === "profile");
    expect(item.fix).toMatch(/^Correct the include patterns in undrift\.config\.json so they match the files this profile is for\./);
    expect(item.fix).toContain(inJson("app/\\(marketing\\)/**/*.tsx"));
  });

  test("a profile that matched nothing for another reason keeps its fix exactly", () => {
    const c = load({ "lib/a.tsx": GOOD }, ["nothing/**/*.tsx"]);
    const item = collectNotChecked({ contract: c, runs: [{ name: "app", files: 0, rulesNotRun: [] }] }).find((i) => i.kind === "profile");
    expect(item.fix).toBe("Correct the include patterns in undrift.config.json so they match the files this profile is for.");
  });

  test("an explicit pattern that matched nothing: the fix names the escaped pattern", () => {
    const c = load({ "app/(marketing)/page.tsx": GOOD });
    const items = collectNotChecked({
      contract: c, runs: [{ name: "app", files: 0, rulesNotRun: [], unmatched: ["app/(marketing)/**/*.tsx"] }], paths: ["app/(marketing)/**/*.tsx"],
    });
    const item = items.find((i) => i.kind === "profile");
    expect(item.fix).toMatch(/^Check the path, and quote a glob so the shell does not expand it first\./);
    expect(item.fix).toContain(inJson("app/\\(marketing\\)/**/*.tsx"));
  });
});

// The advice has to work when it is followed. Everything below is the loop that used to
// have no way out: a pattern written as the folder is named matches nothing, the report
// says to add the path to the include, and the same path matches nothing again.
describe("end to end: following the advice makes the file covered", () => {
  const FILES = { "app/(marketing)/page.tsx": BAD, "app/(marketing)/[slug]/page.tsx": BAD, "lib/a.tsx": GOOD };

  test("written as the folder is named, the pattern matches nothing, and the report says how to write it", () => {
    const root = repo(FILES, ["lib/**/*.tsx", "app/(marketing)/**/*.tsx"]);
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("app/(marketing)/page.tsx");
    expect(r.out).toContain(inJson("app/\\(marketing\\)/**/*.tsx"));
    expect(r.out).not.toContain("[no-raw-colors]");
  });

  test("written as the advice says, the files are covered and the violations are found", () => {
    const root = repo(FILES, ["lib/**/*.tsx", "app/\\(marketing\\)/**/*.tsx"]);
    const r = cli(root, ["gate", "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("app/(marketing)/page.tsx");
    expect(r.out).toMatch(/\[no-raw-colors\]/);
    expect(r.out).not.toMatch(/covered by no profile/);
  });

  test("the pattern the report prints is the one to paste: it covers the route group and what is inside it", () => {
    const first = cli(repo(FILES, ["lib/**/*.tsx"]), ["gate"]).out;
    const printed = /write ("[^"]*")\./.exec(first)?.[1];
    expect(printed).toBeDefined();
    const suggestion = JSON.parse(printed);
    expect(suggestion).toBe("app/\\(marketing\\)/**/*.tsx");
    const r = cli(repo(FILES, ["lib/**/*.tsx", suggestion]), ["gate"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("app/(marketing)/page.tsx");
    expect(r.out).toContain("app/(marketing)/[slug]/page.tsx");
    expect(r.out).not.toMatch(/covered by no profile/);
  });

  test("an explicit glob written as the folder is named reports the escaped form, and the form works", () => {
    const root = repo(FILES, ["lib/**/*.tsx"]);
    const r = cli(root, ["gate", "app/(marketing)/**/*.tsx"]);
    expect(r.out).toContain("matched no files");
    expect(r.out).toContain(inJson("app/\\(marketing\\)/**/*.tsx"));
    const fixed = cli(root, ["gate", "app/\\(marketing\\)/**/*.tsx"]);
    expect(fixed.code).toBe(1);
    expect(fixed.out).toContain("[no-raw-colors]");
    expect(fixed.out).not.toContain("matched no files");
  });

  test("the hook's notice for an uncovered route file says how to write the pattern", () => {
    const root = repo(FILES, ["lib/**/*.tsx"]);
    const r = hook(root, join(root, "app/(marketing)/page.tsx"));
    expect(r.code).toBe(0);
    const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(text).toContain(inJson("app/\\(marketing\\)/**/*.tsx"));
    expect(text).not.toMatch(DASH);
  });

  test("the hook blocks the same file once the include is written as the advice says", () => {
    const root = repo(FILES, ["lib/**/*.tsx", "app/\\(marketing\\)/**/*.tsx"]);
    const r = hook(root, join(root, "app/(marketing)/page.tsx"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("#ff0000");
  });

  test("the hook's stylesheet notice says how the ignore entry has to be written", () => {
    const root = repo({ ...FILES, "app/(marketing)/site.css": "a{}" }, ["lib/**/*.tsx"]);
    const r = hook(root, join(root, "app/(marketing)/site.css"));
    const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(text).toContain(inJson("app/\\(marketing\\)/**"));
  });

  test("a file with plain names gets no advice at all", () => {
    const root = repo({ "app/plain/page.tsx": BAD, "lib/a.tsx": GOOD }, ["lib/**/*.tsx"]);
    const r = hook(root, join(root, "app/plain/page.tsx"));
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).not.toMatch(/parentheses/);
    expect(cli(root, ["gate"]).out).not.toMatch(/parentheses/);
  });
});

// The claim the advice rests on, checked against the matcher itself: the folder as it
// is named matches nothing, and the escaped form matches the folder.
describe("the matcher", () => {
  test("reads an unescaped route group as syntax and an escaped one as the folder", () => {
    const root = repo({ "app/(marketing)/page.tsx": GOOD, "app/marketing/page.tsx": GOOD }, ["app/(marketing)/**/*.tsx"]);
    const unescaped = loadContract(root);
    expect(classifyCoverage(unescaped).counts.covered).toBe(0);
    const escaped = loadContract(repo({ "app/(marketing)/page.tsx": GOOD, "app/marketing/page.tsx": GOOD }, ["app/\\(marketing\\)/**/*.tsx"]));
    expect(classifyCoverage(escaped).counts.covered).toBe(1);
  });
});
