// A profile's `rules` and `include` are the whole point of a profile, and a
// misspelling in either used to turn checking off without a word: a typo such as
// "no-raw-colours" ran no rule, `rules: []` ran none at all, and both printed
// "on-system" under --strict while the hook stayed silent. A config that cannot
// mean what it says is a config error, the same stance as a blank `ignore` reason.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../src/contract.mjs";
import { ALL_RULES } from "../src/gate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "../bin/undrift.mjs");
const HOOK = resolve(here, "../hooks/undrift-hook.mjs");
const BAD = `export const B = () => <div style={{ color: "#ff0000" }} />;\n`;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

function repo(profiles, files = {}, over = {}) {
  const root = mkdtempSync(join(tmpdir(), "u-profiles-"));
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("ds.css", ":root{--color-primary:#3b5bdb}");
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  write(
    "undrift.config.json",
    JSON.stringify({ system: "@acme/ds", tokensCss: "ds.css", ignore: { "ds.css": "the token source" }, profiles, ...over })
  );
  return root;
}
const cli = (root, argv) => {
  try {
    return { code: 0, out: strip(execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })) };
  } catch (e) {
    return { code: exited(e), out: strip((e.stdout ?? "") + (e.stderr ?? "")) };
  }
};
const hook = (root, file) => {
  try {
    const stdout = execFileSync(process.execPath, [HOOK], {
      input: JSON.stringify({ tool_input: { file_path: file } }),
      cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

describe("a profile's rules must be real rules", () => {
  const load = (rules) => () => loadContract(repo({ app: { include: ["app/**/*.tsx"], rules } }));
  // The message a config error carries, for asserting what it does NOT say.
  const messageOf = (fn) => {
    try { fn(); } catch (e) { return e.message; }
    throw new Error("expected a config error");
  };

  test("an unknown rule name is a config error naming the profile and the rule", () => {
    expect(load(["no-raw-colours"])).toThrow(/profile "app" lists a rule that does not exist: "no-raw-colours"/);
  });

  test("it says which rules do exist", () => {
    expect(load(["nope"])).toThrow(/The rules are no-raw-colors, no-arbitrary-values, no-raw-elements/);
    for (const rule of ALL_RULES) expect(load(["nope"])).toThrow(new RegExp(rule));
  });

  test("a near miss gets a suggestion, and a far one does not", () => {
    expect(load(["no-raw-colours"])).toThrow(/Did you mean "no-raw-colors" for "no-raw-colours"\?/);
    expect(load(["no-arbitrary-value"])).toThrow(/Did you mean "no-arbitrary-values"/);
    expect(messageOf(load(["completely-different"]))).not.toMatch(/Did you mean/);
  });

  test("every unknown name is listed, and the good ones are not blamed", () => {
    expect(load(["no-raw-colors", "no-raw-colours", "no-such-rule"])).toThrow(/rules that do not exist: "no-raw-colours", "no-such-rule"\./);
    expect(messageOf(load(["no-raw-colors", "no-raw-colours"]))).not.toMatch(/exist: "no-raw-colors"/);
  });

  test("the names that are not rules are not accepted: invalid-gap and unresolved-gap always run", () => {
    expect(load(["invalid-gap"])).toThrow(/does not exist: "invalid-gap"/);
    expect(load(["unresolved-gap"])).toThrow(/does not exist: "unresolved-gap"/);
  });

  test("a rule name that is not a string is an unknown rule", () => {
    expect(load([5])).toThrow(/does not exist: 5\./);
    expect(load([null])).toThrow(/does not exist: null\./);
  });

  test("an empty list is a config error: it would turn every rule off", () => {
    expect(load([])).toThrow(/profile "app" has an empty "rules" list, which would turn every rule off\. Omit "rules" to apply the default rules\./);
  });

  test.each([["a string", "no-raw-colors"], ["an object", {}], ["null", null], ["a number", 3]])(
    "rules given as %s is a config error",
    (_label, rules) => {
      expect(load(rules)).toThrow(/profile "app" has "rules" that is not a list/);
    }
  );

  test("every real rule loads, alone and together", () => {
    for (const rule of ALL_RULES) expect(load([rule])).not.toThrow();
    expect(load([...ALL_RULES])).not.toThrow();
  });

  test("omitting rules is allowed and means the default rules", () => {
    const c = loadContract(repo({ app: { include: ["app/**/*.tsx"] } }));
    expect(c.profiles.app.rules).toBeUndefined();
  });

  test("the error is named for the profile that has it, not the first profile", () => {
    const root = repo({
      good: { include: ["a/**/*.tsx"], rules: ["no-raw-colors"] },
      bad: { include: ["b/**/*.tsx"], rules: ["no-raw-colours"] },
    });
    expect(() => loadContract(root)).toThrow(/profile "bad" lists a rule/);
  });

  test("no error message carries a dash", () => {
    for (const rules of [["no-raw-colours"], [], "x", ["a", "b"]]) {
      try {
        loadContract(repo({ app: { include: ["app/**/*.tsx"], rules } }));
      } catch (e) {
        expect(e.message).not.toMatch(/[\u2014\u2013]/);
        continue;
      }
      throw new Error("expected a config error");
    }
  });
});

describe("what a misspelt rule used to do", () => {
  const TYPO = { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colours"] } };
  const EMPTY = { app: { include: ["app/**/*.tsx"], rules: [] } };

  test.each([["a typo", TYPO], ["an empty list", EMPTY]])(
    "gate --strict on %s stops with a config error, exit 2, never on-system",
    (_label, profiles) => {
      const root = repo(profiles, { "app/bad.tsx": BAD });
      const r = cli(root, ["gate", "--strict"]);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/^undrift: undrift\.config\.json: profile "app"/m);
      expect(r.out).not.toMatch(/on-system|✓ clean/);
    }
  );

  test("gate in normal mode stops too: the dev loop is not a licence to run nothing", () => {
    const root = repo(TYPO, { "app/bad.tsx": BAD });
    expect(cli(root, ["gate"]).code).toBe(2);
  });

  test.each([["a typo", TYPO], ["an empty list", EMPTY]])(
    "the hook does not go quiet on %s: it tells the agent, and says why",
    (_label, profiles) => {
      const root = repo(profiles, { "app/bad.tsx": BAD });
      const r = hook(root, join(root, "app/bad.tsx"));
      expect(r.code).toBe(0);
      const text = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
      expect(text).toContain("Undrift could not read undrift.config.json");
      expect(text).toContain('profile "app"');
    }
  );
});

// Tailwind and many editors write a relative glob with a leading "./". fast-glob
// hands back "./app/a.tsx" for the pattern "./app/**/*.tsx", which never equals the
// "app/a.tsx" every other list of files uses. Every covered file then read as
// "covered by no profile", and the hook told the agent it had not checked a file it
// should have blocked. The leading "./" is dropped from every include and every
// ignore glob when the config is loaded.
describe("a leading ./ on an include or an ignore glob", () => {
  const load = (config) => loadContract(repo(config.profiles, config.files ?? {}, config.over ?? {}));

  test("is dropped from each include entry", () => {
    const c = load({ profiles: { app: { include: ["./app/**/*.tsx", "src/**/*.ts", "././lib/**"] } } });
    expect(c.profiles.app.include).toEqual(["app/**/*.tsx", "src/**/*.ts", "lib/**"]);
  });

  test("is dropped after the ! of a negation, and only there", () => {
    const c = load({ profiles: { app: { include: ["./app/**/*.tsx", "!./app/skip/**", "!**/*.test.*", "!(draft)/x.tsx"] } } });
    expect(c.profiles.app.include).toEqual(["app/**/*.tsx", "!app/skip/**", "!**/*.test.*", "!(draft)/x.tsx"]);
  });

  test("is dropped from each ignore glob, and the reasons stay with their globs", () => {
    const c = load({
      profiles: { app: { include: ["app/**/*.tsx"] } },
      over: { ignore: { "./legacy/**": "old screens", "./ds.css": "the token source", "src/**": "already plain" } },
    });
    expect(c.ignore).toEqual({ "legacy/**": "old screens", "ds.css": "the token source", "src/**": "already plain" });
  });

  test("a dot in a name is not a dot-slash", () => {
    const c = load({ profiles: { app: { include: [".storybook/**/*.tsx", "..sibling/x.tsx", "app/./x.tsx"] } } });
    expect(c.profiles.app.include).toEqual([".storybook/**/*.tsx", "..sibling/x.tsx", "app/./x.tsx"]);
  });

  // `.//app/**` is a path with a doubled slash, and the same path. Dropping "./" once left
  // "/app/**", which is a pattern for the root of the filesystem and matches nothing, so the
  // profile covered no file. Every slash that follows the dot goes with it.
  describe("with more than one slash after the dot", () => {
    test.each([
      [".//app/**/*.tsx", "app/**/*.tsx"],
      [".///app/**", "app/**"],
      ["./././app/**", "app/**"],
      ["././/app/**", "app/**"],
      ["!.//app/skip/**", "!app/skip/**"],
      [".//.storybook/**", ".storybook/**"],
    ])("%s becomes %s", (written, cleaned) => {
      expect(load({ profiles: { app: { include: [written] } } }).profiles.app.include).toEqual([cleaned]);
      // an ignore key is never a negation, so the same goes for the ones that are not
      if (!written.startsWith("!")) {
        const ignore = load({ profiles: { app: { include: ["app/**"] } }, over: { ignore: { [written]: "vendored", "ds.css": "the token source" } } }).ignore;
        expect(ignore).toHaveProperty(cleaned, "vendored");
      }
    });

    test("a path that only looks like it is left alone", () => {
      const c = load({ profiles: { app: { include: ["..//x/**", "app//y/**", ".x//z"] } } });
      expect(c.profiles.app.include).toEqual(["..//x/**", "app//y/**", ".x//z"]);
    });

    test("an ignore key that is nothing but the dot and its slashes is an empty glob, and a config error", () => {
      for (const key of ["./", ".//", "././"]) {
        expect(() => load({ profiles: { app: { include: ["app/**"] } }, over: { ignore: { [key]: "vendored" } } })).toThrow(/"ignore" has an empty glob/);
      }
    });
  });

  // The include as it was written is what a report shows. A person who wrote ".//nothing/**"
  // and is told a profile matched nothing has to be told which pattern that was.
  describe("a message shows the pattern as it was written", () => {
    test("the contract keeps what was written beside what it reads", () => {
      const c = load({ profiles: { app: { include: [".//app/**/*.tsx", "!./app/skip/**", "src/**"] } } });
      expect(c.profiles.app.include).toEqual(["app/**/*.tsx", "!app/skip/**", "src/**"]);
      expect(c.profiles.app.includeWritten).toEqual([".//app/**/*.tsx", "!./app/skip/**", "src/**"]);
    });

    test("a string include is kept as written too", () => {
      expect(load({ profiles: { app: { include: "./app/**" } } }).profiles.app.includeWritten).toEqual(["./app/**"]);
    });

    test("a profile that matched nothing names the include the way it was written", () => {
      const root = repo({ app: { include: [".//nothing/**/*.tsx", "./none/**"], rules: ["no-raw-colors"] } }, {});
      const r = cli(root, ["gate"]);
      expect(r.out).toContain("Profile app matched no files (include: .//nothing/**/*.tsx, ./none/**)");
      expect(r.out).not.toMatch(/include: nothing|include: \/nothing/);
    });

    test("and so does the JSON item", () => {
      const root = repo({ app: { include: [".//nothing/**/*.tsx"], rules: ["no-raw-colors"] } }, {});
      const item = JSON.parse(cli(root, ["gate", "--format", "json"]).out).notChecked.find((i) => i.kind === "profile");
      expect(item.include).toEqual([".//nothing/**/*.tsx"]);
    });

    test("a config error about an entry shows the entry as written", () => {
      expect(() => load({ profiles: { app: { include: [".//app/**", "./"] } } })).toThrow('entry 2: "./"');
    });

    test("the route-group advice quotes what was written, and the pattern to write keeps the person's own start", () => {
      const root = repo({ app: { include: [".//app/(marketing)/**/*.tsx"], rules: ["no-raw-colors"] } }, { "app/(marketing)/page.tsx": BAD });
      const r = cli(root, ["gate"]);
      expect(r.out).toContain("as in .//app/(marketing)");
      expect(r.out).toContain(JSON.stringify(".//app/\\(marketing\\)/**/*.tsx"));
    });
  });

  describe("end to end, with a doubled slash", () => {
    const CLEAN = `export const G = () => <div className="bg-primary p-4" />;\n`;
    test("the include covers its files, and the hook blocks a violation in them", () => {
      const root = repo({ app: { include: [".//app/**/*.tsx"], rules: ["no-raw-colors"] } }, { "app/a.tsx": CLEAN, "app/bad.tsx": BAD });
      const r = cli(root, ["gate", "--strict"]);
      expect(r.code).toBe(1);
      expect(r.out).toContain("[no-raw-colors]");
      expect(r.out).not.toMatch(/covered by no profile|matched no files/);
      expect(hook(root, join(root, "app/bad.tsx")).code).toBe(2);
    });
  });

  describe("end to end", () => {
    const CLEAN = `export const G = () => <div className="bg-primary p-4" />;\n`;
    const dotted = (files, over = {}) =>
      repo({ app: { include: ["./app/**/*.tsx", "!./app/skip/**"], rules: ["no-raw-colors"] } }, files, over);

    test("the whole-repository run finds the file covered, not 'covered by no profile'", () => {
      const root = dotted({ "app/a.tsx": CLEAN, "app/b.tsx": CLEAN });
      const r = cli(root, ["gate", "--strict"]);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/profile app {2}2 file\(s\) {2}✓ clean/);
      expect(r.out).not.toMatch(/covered by no profile/);
      expect(r.out).toMatch(/✓ on-system/);
    });

    test("a violation in a covered file is caught", () => {
      const root = dotted({ "app/a.tsx": CLEAN, "app/bad.tsx": BAD });
      const r = cli(root, ["gate", "--strict"]);
      expect(r.code).toBe(1);
      expect(r.out).toContain("[no-raw-colors]");
      expect(r.out).not.toMatch(/covered by no profile/);
    });

    test("the hook blocks the violation instead of saying it did not check the file", () => {
      const root = dotted({ "app/bad.tsx": BAD });
      const r = hook(root, join(root, "app/bad.tsx"));
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/#ff0000/);
      expect(r.stdout).toBe("");
    });

    test("a ./ negation excludes on purpose, and the file is counted, not called uncovered", () => {
      const root = dotted({ "app/a.tsx": CLEAN, "app/skip/x.tsx": BAD });
      const r = cli(root, ["gate", "--strict"]);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/1 UI file excluded by a profile's own ! patterns/);
      expect(r.out).not.toMatch(/covered by no profile/);
    });

    test("an ignore key written with ./ accounts for its files", () => {
      const root = dotted(
        { "app/a.tsx": CLEAN, "legacy/old.tsx": BAD, "styles/g.css": "a{}" },
        { ignore: { "./ds.css": "the token source", "./legacy/**": "old screens", "./styles/**": "vendored" } }
      );
      const r = cli(root, ["gate", "--strict"]);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/1 UI file ignored via "ignore", 2 stylesheets ignored via "ignore"/);
      expect(r.out).not.toMatch(/Not checked/);
    });

    test("explicit paths written with ./ are gated too", () => {
      const root = dotted({ "app/bad.tsx": BAD });
      expect(cli(root, ["gate", "./app/bad.tsx"]).code).toBe(1);
      expect(cli(root, ["gate", "./app/**/*.tsx"]).code).toBe(1);
    });
  });
});

// `include` given as one string used to work, because fast-glob takes either. The
// profile normalisation put in for the leading "./" then called .filter on it, and
// the gate died with "include.filter is not a function" (exit 2, a stack, no report)
// while the hook threw the same error and went silent. A string is one glob. Every
// other shape is a config error that names the profile, never a TypeError.
describe("a profile's include: one glob or a list of globs", () => {
  const CLEAN = `export const G = () => <div className="bg-primary p-4" />;\n`;
  const load = (include, name = "app") => () => loadContract(repo({ [name]: { include, rules: ["no-raw-colors"] } }));
  const messageOf = (fn) => {
    try { fn(); } catch (e) { return e.message; }
    throw new Error("expected a config error");
  };

  test("a string is one glob", () => {
    expect(loadContract(repo({ app: { include: "app/**/*.tsx", rules: ["no-raw-colors"] } })).profiles.app.include).toEqual(["app/**/*.tsx"]);
  });

  test("a string gets the leading ./ dropped too", () => {
    expect(loadContract(repo({ app: { include: "./app/**/*.tsx" } })).profiles.app.include).toEqual(["app/**/*.tsx"]);
  });

  test("a list is what it always was", () => {
    expect(loadContract(repo({ app: { include: ["app/**/*.tsx", "!**/*.test.tsx"] } })).profiles.app.include).toEqual(["app/**/*.tsx", "!**/*.test.tsx"]);
  });

  test.each([["a number", 3], ["an object", {}], ["null", null], ["true", true]])(
    "%s is a config error naming the profile, not a TypeError",
    (_label, include) => {
      expect(load(include)).toThrow(/^undrift\.config\.json: profile "app" has an "include" that is not a glob or a list of globs/);
    }
  );

  test.each([["a number", ["app/**", 3]], ["null", [null]], ["an empty string", ["app/**", ""]], ["blanks", ["  "]], ["a bare ./", ["./"]]])(
    "an entry that is %s is a config error naming its position",
    (_label, include) => {
      expect(load(include)).toThrow(/profile "app" has an "include" entry that is not a glob \(entry \d/);
    }
  );

  test("a profile with no include is a config error: the schema requires it, and the gate cannot run without it", () => {
    const missing = () => loadContract(repo({ app: { rules: ["no-raw-colors"] } }));
    expect(missing).toThrow(/profile "app" has no "include"/);
  });

  test("the error names the profile that has it, not the first", () => {
    const c = () => loadContract(repo({ good: { include: ["a/**"] }, bad: { include: 7 } }));
    expect(messageOf(c)).toMatch(/profile "bad"/);
    expect(messageOf(c)).not.toMatch(/profile "good"/);
  });

  test.each([["a string", "app"], ["null", null], ["a list", []], ["a number", 3]])(
    "a profile that is %s is a config error",
    (_label, profile) => {
      expect(() => loadContract(repo({ app: profile }))).toThrow(/profile "app" must be an object with "include"/);
    }
  );

  test.each([["a list", []], ["a string", "app"], ["null", null]])(
    "profiles that is %s is a config error",
    (_label, profiles) => {
      expect(() => loadContract(repo(profiles))).toThrow(/"profiles" must be an object mapping a profile name/);
    }
  );

  test("no error message carries a dash", () => {
    for (const include of [3, {}, null, [""], undefined]) {
      expect(messageOf(load(include))).not.toMatch(/[\u2014\u2013]/);
    }
  });

  describe("end to end, with the string form", () => {
    const strung = (files) => repo({ app: { include: "app/**/*.tsx", rules: ["no-raw-colors"] } }, files);

    test("the gate checks the profile's files instead of dying", () => {
      const root = strung({ "app/a.tsx": CLEAN, "app/bad.tsx": BAD });
      const r = cli(root, ["gate"]);
      expect(r.code).toBe(1);
      expect(r.out).toContain("[no-raw-colors]");
      expect(r.out).not.toMatch(/is not a function|TypeError/);
    });

    test("--strict runs to the end with the profile counted", () => {
      const root = strung({ "app/a.tsx": CLEAN });
      const r = cli(root, ["gate", "--strict"]);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/profile app {2}1 file\(s\) {2}✓ clean/);
      expect(r.out).toMatch(/✓ on-system/);
    });

    test("--format json runs too, and lists the profile's include as a list", () => {
      const root = strung({ "app/a.tsx": CLEAN });
      expect(JSON.parse(cli(root, ["gate", "--format", "json"]).out).pass).toBe(true);
    });

    test("a profile that matches nothing says what its include was, without crashing", () => {
      const root = repo({ app: { include: "nothing/**/*.tsx", rules: ["no-raw-colors"] } }, { "lib/x.tsx": CLEAN });
      const r = cli(root, ["gate"]);
      expect(r.out).toMatch(/Profile app matched no files \(include: nothing\/\*\*\/\*\.tsx\)/);
    });

    test("the hook blocks a violation in a covered file", () => {
      const root = strung({ "app/bad.tsx": BAD });
      const r = hook(root, join(root, "app/bad.tsx"));
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/#ff0000/);
      expect(r.stderr).not.toMatch(/is not a function|TypeError|\n\s+at /);
    });

    test("the hook is silent on a covered clean file", () => {
      const root = strung({ "app/a.tsx": CLEAN });
      const r = hook(root, join(root, "app/a.tsx"));
      expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
    });
  });

  describe("end to end, with a shape that is wrong", () => {
    const wrong = (files) => repo({ app: { include: 3, rules: ["no-raw-colors"] } }, files);

    test("the gate stops with a config error and exit 2", () => {
      const r = cli(wrong({ "app/a.tsx": CLEAN }), ["gate"]);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/^undrift: undrift\.config\.json: profile "app" has an "include" that is not a glob/m);
      expect(r.out).not.toMatch(/is not a function|TypeError/);
    });

    test("the hook tells the agent, and says why", () => {
      const root = wrong({ "app/bad.tsx": BAD });
      const r = hook(root, join(root, "app/bad.tsx"));
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
      expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain('profile "app" has an "include" that is not a glob');
    });
  });
});
