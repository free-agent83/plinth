// sample/packages/undrift/tests/hook-older.test.mjs
// The hook in a git repository: it blocks only on the agent's lines, and tells the agent about older
// problems once per file per session, for the person to decide.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOOK } from "./support/world.mjs";
import { commitAll } from "./support/git.mjs";

const OLD = [
  "export const P = () => (",
  "  <div>",
  '    <p style={{ color: "#333333" }}>Old</p>',
  "  </div>",
  ");",
  "",
].join("\n");
const withLine = (line) => OLD.replace("  </div>", `${line}\n  </div>`);
const CLEAN = '    <p className="bg-primary">New</p>';
const BAD = '    <p style={{ color: "#ff0000" }}>New</p>';

function world() {
  const root = mkdtempSync(join(tmpdir(), "u-older-"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "ds.css"), ":root{--color-muted:#333333;--color-primary:#3b5bdb}");
  writeFileSync(join(root, ".gitignore"), ".undrift/\n");
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
    system: "@acme/ds", tokensCss: "ds.css",
    profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } },
  }));
  writeFileSync(join(root, "app/page.tsx"), OLD);
  writeFileSync(join(root, "app/other.tsx"), OLD);
  commitAll(root);
  return { root, page: join(root, "app/page.tsx"), other: join(root, "app/other.tsx") };
}

const hook = (root, file, session = "s1") => {
  try {
    const stdout = execFileSync(process.execPath, [HOOK], {
      input: JSON.stringify({ session_id: session, tool_input: { file_path: file } }),
      cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};
const context = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : "");

describe("the hook judges only the agent's lines", () => {
  test("a clean edit to an old file passes, and the older problem goes to the person", () => {
    const { root, page } = world();
    writeFileSync(page, withLine(CLEAN));
    const r = hook(root, page);
    expect(r.code).toBe(0);
    const said = context(r);
    expect(said).toMatch(/1 older problem in app\/page\.tsx/);
    expect(said).toMatch(/line 3 \[no-raw-colors\] #333333/);
    expect(said).toMatch(/Fix it: use var\(--color-muted\)/);
    expect(said).toContain("'app/page.tsx' --line 3 --rule no-raw-colors --value '#333333'");
  });

  test("once per file per session: told again only in a new session", () => {
    const { root, page } = world();
    writeFileSync(page, withLine(CLEAN));
    expect(context(hook(root, page, "s1"))).toMatch(/older problem/);
    expect(context(hook(root, page, "s1"))).not.toMatch(/older problem/);
    expect(context(hook(root, page, "s2"))).toMatch(/older problem/);
  });

  test("the agent's own violation blocks, counts alone, and the older problem rides along", () => {
    const { root, page } = world();
    writeFileSync(page, withLine(BAD));
    const r = hook(root, page);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/1 violation\(s\) in app\/page\.tsx/);
    expect(r.stderr).toMatch(/line 4: Raw colour #ff0000/);
    expect(r.stderr).toMatch(/1 older problem in app\/page\.tsx/);
    // the count is the agent's one violation, not that and the older problem
    expect(JSON.parse(readFileSync(join(root, ".undrift/attempts.json"), "utf8"))["app/page.tsx"]).toBe(1);
  });

  test("a problem on the later list is not raised", () => {
    const { root, page } = world();
    writeFileSync(join(root, "undrift.later.json"), JSON.stringify({
      version: 1, entries: [{ file: "app/page.tsx", rule: "no-raw-colors", value: "#333333", count: 1, date: "2026-09-30" }],
    }));
    writeFileSync(page, withLine(CLEAN));
    const r = hook(root, page);
    expect(r.code).toBe(0);
    expect(context(r)).not.toMatch(/older problem/);
  });

  test("a later list that cannot be read is said, and defers nothing", () => {
    const { root, page } = world();
    writeFileSync(join(root, "undrift.later.json"), "{");
    writeFileSync(page, withLine(CLEAN));
    const said = context(hook(root, page));
    expect(said).toMatch(/could not read undrift\.later\.json/);
    expect(said).toMatch(/older problem/);
  });

  test("the note's later command runs Undrift by its absolute path, with the config", () => {
    const { root, page } = world();
    writeFileSync(page, withLine(CLEAN));
    const said = context(hook(root, page));
    expect(said).toMatch(/node '\/[^']*\/bin\/undrift\.mjs' later --config '\/[^']*undrift\.config\.json' 'app\/page\.tsx' --line 3 --rule no-raw-colors --value '#333333'/);
    expect(said).not.toMatch(/npx/);
  });

  // A violation is reported where its node starts. Here that is the backtick line, which the agent did
  // not touch; the colour it added is on the line below, inside the same literal.
  test("the agent's colour inside an old multi-line literal is the agent's, and blocks", () => {
    const root = mkdtempSync(join(tmpdir(), "u-older-"));
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "ds.css"), ":root{--color-muted:#333333}");
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
      system: "@acme/ds", tokensCss: "ds.css",
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } },
    }));
    const page = join(root, "app/page.tsx");
    writeFileSync(page, "export const P = () => <div className={`\n  p-4\n`} />;\n");
    commitAll(root);
    writeFileSync(page, "export const P = () => <div className={`\n  p-4 bg-[#ff0000]\n`} />;\n");
    const r = hook(root, page);
    expect(r.code).toBe(2);
    expect(r.stderr).not.toMatch(/older problem/);
  });

  // A guard, not a red-first test: the hook blocked here before this change too, and must still.
  test("a file git does not track is all the agent's: an old-looking colour blocks", () => {
    const { root } = world();
    const fresh = join(root, "app/fresh.tsx");
    writeFileSync(fresh, OLD);
    expect(hook(root, fresh).code).toBe(2);
  });

  test("the attempt count follows the agent's violations only", () => {
    const { root, page } = world();
    writeFileSync(page, withLine(CLEAN));
    hook(root, page);
    let attempts = {};
    try { attempts = JSON.parse(readFileSync(join(root, ".undrift/attempts.json"), "utf8")); } catch { /* none written */ }
    expect(attempts["app/page.tsx"]).toBeUndefined();
  });
});

const writeState = (root, name, text) => {
  mkdirSync(join(root, ".undrift"), { recursive: true });
  writeFileSync(join(root, ".undrift", name), text);
};
const olderState = (root) => JSON.parse(readFileSync(join(root, ".undrift/older.json"), "utf8"));

describe("older problems are per file, per session, and pruned", () => {
  test("two files edited in one session each get their own note", () => {
    const { root, page, other } = world();
    writeFileSync(page, withLine(CLEAN));
    writeFileSync(other, withLine(CLEAN));
    expect(context(hook(root, page))).toMatch(/older problem in app\/page\.tsx/);
    expect(context(hook(root, other))).toMatch(/older problem in app\/other\.tsx/);
    expect(olderState(root).s1.files.sort()).toEqual(["app/other.tsx", "app/page.tsx"]);
  });

  test("a session not heard from for a day is forgotten, and a recent one is kept", () => {
    const { root, page } = world();
    const now = Date.now();
    writeState(root, "older.json", JSON.stringify({
      stale: { at: now - 25 * 60 * 60 * 1000, files: ["app/x.tsx"] },
      recent: { at: now - 60 * 60 * 1000, files: ["app/y.tsx"] },
    }));
    writeFileSync(page, withLine(CLEAN));
    hook(root, page);
    const kept = olderState(root);
    expect(Object.keys(kept).sort()).toEqual(["recent", "s1"]);
    expect(kept.recent.files).toEqual(["app/y.tsx"]);
  });

  // A time in the future can never be more than a day old, so it was kept for ever and the session's
  // files stayed "told" for good. A session that claims to be from the future is not a session the hook wrote.
  test("a session whose time is in the future is forgotten, so its file is told of again", () => {
    const { root, page } = world();
    writeState(root, "older.json", JSON.stringify({ s1: { at: 1e300, files: ["app/page.tsx"] } }));
    writeFileSync(page, withLine(CLEAN));
    expect(context(hook(root, page, "s1"))).toMatch(/older problem in app\/page\.tsx/);
    expect(olderState(root).s1.at).toBeLessThan(1e300);
  });

  // The config is in a folder below the repository, and the hook runs from the repository's root, as it
  // does when the agent's shell is not where the config is. The later list is the config's, not the shell's.
  test("the later list beside the config applies when the hook runs from elsewhere", () => {
    const root = mkdtempSync(join(tmpdir(), "u-older-"));
    mkdirSync(join(root, "pkg/app"), { recursive: true });
    writeFileSync(join(root, "pkg/ds.css"), ":root{--color-muted:#333333;--color-primary:#3b5bdb}");
    writeFileSync(join(root, "pkg/undrift.config.json"), JSON.stringify({
      system: "@acme/ds", tokensCss: "ds.css",
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } },
    }));
    const page = join(root, "pkg/app/page.tsx");
    writeFileSync(page, OLD);
    writeFileSync(join(root, ".gitignore"), ".undrift/\n");
    commitAll(root);
    writeFileSync(page, withLine(CLEAN));
    expect(context(hook(root, page, "s0"))).toMatch(/older problem/); // the premise: it is raised without the list
    writeFileSync(join(root, "pkg/undrift.later.json"), JSON.stringify({
      version: 1, entries: [{ file: "app/page.tsx", rule: "no-raw-colors", value: "#333333", count: 1, date: "2026-09-30" }],
    }));
    const r = hook(root, page, "s1");
    expect(r.code).toBe(0);
    expect(context(r)).not.toMatch(/older problem/);
  });
});

// A state file that is not what the hook wrote must never stop it checking. The hook used to throw, the
// error path exited 0, and the agent's own violation went through, then again in silence.
describe("state files that are not what the hook wrote", () => {
  const SHAPES = {
    "a number": "5",
    "a string": '"x"',
    "an array": "[]",
    "null": "null",
    "a session with no files": () => JSON.stringify({ s1: { at: Date.now() } }),
    "a session whose files are null": () => JSON.stringify({ s1: { at: Date.now(), files: null } }),
    "a session that is a number": () => JSON.stringify({ s1: 5 }),
    "a session with a text time": () => JSON.stringify({ s1: { at: "now", files: [] } }),
    "text that is not JSON": "{",
  };
  const body = (v) => (typeof v === "function" ? v() : v);

  test.each(Object.keys(SHAPES))("older.json holding %s: the agent's own violation still blocks, twice", (name) => {
    const { root, page } = world();
    writeState(root, "older.json", body(SHAPES[name]));
    writeFileSync(page, withLine(BAD));
    const first = hook(root, page);
    const second = hook(root, page);
    expect(first.code).toBe(2);
    expect(first.stderr).toMatch(/line 4: Raw colour #ff0000/);
    expect(second.code).toBe(2);
  });

  test.each(["__proto__", "constructor", "toString", "hasOwnProperty"])("the session id %s is an ordinary session", (id) => {
    const { root, page } = world();
    writeFileSync(page, withLine(CLEAN));
    expect(context(hook(root, page, id))).toMatch(/older problem/);
    expect(context(hook(root, page, id))).not.toMatch(/older problem/);
    writeFileSync(page, withLine(BAD));
    expect(hook(root, page, id).code).toBe(2);
    expect(hook(root, page, id).code).toBe(2);
  });

  test.each(["5", '"x"', "[]", "null", "{", '{"app/page.tsx":"x"}', '{"app/page.tsx":null}'])("attempts.json holding %s counts from nothing", (text) => {
    const { root, page } = world();
    writeState(root, "attempts.json", text);
    writeFileSync(page, withLine(BAD));
    const first = hook(root, page);
    const second = hook(root, page);
    expect(first.code).toBe(2);
    expect(first.stderr).toMatch(/attempt 1\/3/);
    expect(second.code).toBe(2);
    expect(second.stderr).toMatch(/attempt 2\/3/);
  });
});

describe("an older-problem note that cannot be told whole", () => {
  test("an unreadable later list is said once per session, and not by repeating its name", () => {
    const { root, page } = world();
    writeFileSync(join(root, "undrift.later.json"), "{");
    writeFileSync(page, withLine(CLEAN));
    const first = context(hook(root, page, "s1"));
    expect(first).toMatch(/could not read undrift\.later\.json/);
    const sentence = first.split("\n\n")[0];
    expect(sentence.split("undrift.later.json")).toHaveLength(2); // named once
    expect(sentence).toMatch(
      /^Undrift could not read undrift\.later\.json: it is not valid JSON \(.+\), so nothing on it counts as deferred\. Fix: tell the user\. Repair it, or delete it to bring back every problem it defers\./,
    );
    expect(context(hook(root, page, "s1"))).not.toMatch(/could not read/);
    expect(context(hook(root, page, "s2"))).toMatch(/could not read undrift\.later\.json/);
  });
});

// The later list defers older problems, never the agent's own. An entry that covers more than the older
// lines hold (a count of 2 for one older occurrence) must not let a second one the agent writes through.
describe("the later list never defers the agent's own lines", () => {
  test("an entry with room to spare does not defer the same value the agent just wrote", () => {
    const { root, page } = world();
    writeFileSync(join(root, "undrift.later.json"), JSON.stringify({
      version: 1, entries: [{ file: "app/page.tsx", rule: "no-raw-colors", value: "#333333", count: 2, date: "2026-09-30" }],
    }));
    commitAll(root);
    writeFileSync(page, withLine('    <p style={{ color: "#333333" }}>New</p>'));
    const r = hook(root, page);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/line 4: Raw colour #333333/);
  });
});

// A file two profiles cover is judged by the gate with both. The hook judged it with the first only, so
// an agent's own problem under a rule only the second turns on passed the hook and failed the gate.
describe("the hook judges a file with the rules of every profile that covers it", () => {
  const twoProfiles = () => {
    const w = world();
    writeFileSync(join(w.root, "undrift.config.json"), JSON.stringify({
      system: "@acme/ds", tokensCss: "ds.css",
      profiles: {
        first: { include: ["app/**/*.tsx"], rules: ["no-arbitrary-values"] },
        second: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] },
      },
    }));
    commitAll(w.root);
    return w;
  };

  test("the agent's own problem under a rule only the second profile turns on blocks", () => {
    const { root, page } = twoProfiles();
    writeFileSync(page, withLine(BAD));
    const r = hook(root, page);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/line 4: Raw colour #ff0000/);
  });

  test("an older problem under that rule is raised with the person", () => {
    const { root, page } = twoProfiles();
    writeFileSync(page, withLine(CLEAN));
    const r = hook(root, page);
    expect(r.code).toBe(0);
    expect(context(r)).toMatch(/1 older problem in app\/page\.tsx/);
  });

  test("an opt-in rule a profile turns on makes an older problem, like any other rule", () => {
    const root = mkdtempSync(join(tmpdir(), "u-older-optin-"));
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "ds.css"), ":root{--p:#00f;--color-brand:var(--p)}");
    writeFileSync(join(root, ".gitignore"), ".undrift/\n");
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
      system: "@acme/ds", tokensCss: "ds.css", primitives: ["--p"],
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-primitive-tokens"] } },
    }));
    const OLD_SRC = 'export const P = () => (\n  <div>\n    <p style={{ color: "var(--p)" }}>Old</p>\n  </div>\n);\n';
    writeFileSync(join(root, "app/page.tsx"), OLD_SRC);
    commitAll(root);
    writeFileSync(join(root, "app/page.tsx"), OLD_SRC.replace("  </div>", '    <p className="bg-brand">New</p>\n  </div>'));
    const r = hook(root, join(root, "app/page.tsx"));
    expect(r.code).toBe(0);
    expect(context(r)).toMatch(/1 older problem in app\/page\.tsx/);
    expect(context(r)).toMatch(/\[no-primitive-tokens\]/);
  });
});

// A profile may name a file by its absolute real path. The gate covers it, and the hook found the
// profile by that name but judged the file without it, so it passed the agent's own problem in silence.
describe("a profile that names the file by its absolute path", () => {
  const absolute = () => {
    const w = world();
    writeFileSync(join(w.root, "undrift.config.json"), JSON.stringify({
      system: "@acme/ds", tokensCss: "ds.css",
      profiles: { app: { include: [`${realpathSync(w.root)}/app/page.tsx`], rules: ["no-raw-colors"] } },
    }));
    commitAll(w.root);
    return w;
  };

  test("the agent's own raw colour blocks", () => {
    const { root, page } = absolute();
    writeFileSync(page, withLine(BAD));
    const r = hook(root, page);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/line 4: Raw colour #ff0000/);
  });

  test("an older problem is raised, and the note's own command defers it", () => {
    const { root, page } = absolute();
    writeFileSync(page, withLine(CLEAN));
    const said = context(hook(root, page));
    expect(said).toMatch(/1 older problem in app\/page\.tsx/);
    const command = said.match(/Later: (node .*?) --reason </)[1];
    const out = execFileSync("/bin/sh", ["-c", `${command} --reason 'Rebrand'`], { cwd: tmpdir(), encoding: "utf8" });
    expect(out).toMatch(/Deferred 1 problem/);
    expect(JSON.parse(readFileSync(join(root, "undrift.later.json"), "utf8")).entries).toEqual([
      expect.objectContaining({ file: "app/page.tsx", rule: "no-raw-colors", value: "#333333", count: 1 }),
    ]);
  });
});

describe("the rules a covering profile turns on", () => {
  test("a profile with no `rules` key applies every rule: the agent's own raw colour blocks", () => {
    const { root, page } = world();
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
      system: "@acme/ds", tokensCss: "ds.css", profiles: { app: { include: ["app/**/*.tsx"] } },
    }));
    commitAll(root);
    writeFileSync(page, withLine(BAD));
    const r = hook(root, page);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/line 4: Raw colour #ff0000/);
  });

  test("a rule that cannot run, turned on only by the second of two profiles, is told to the agent", () => {
    const { root, page } = world();
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
      system: "@acme/ds", tokensCss: "ds.css",
      profiles: {
        first: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] },
        second: { include: ["app/**/*.tsx"], rules: ["no-unknown-tokens"] },
      },
    }));
    rmSync(join(root, "ds.css"));
    commitAll(root);
    writeFileSync(page, withLine(CLEAN));
    const said = context(hook(root, page));
    expect(said).toMatch(/could not run/);
    expect(said).toMatch(/no-unknown-tokens/);
  });
});
