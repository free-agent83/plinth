// The hook checks one file per write, and it used to say nothing when it could
// not: an unreadable config, a UI file no profile covers, a rule with no input.
// A hook that exits 0 with plain output is invisible to the agent, so a notice
// travels as JSON on stdout (hookSpecificOutput.additionalContext), which reaches
// the agent without blocking. Each distinct notice is sent once per version of the
// config, so the agent is told, not nagged. A file with violations still exits 2
// with stderr, and pending notices ride along. A checked clean file with nothing
// pending stays completely silent.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/undrift-hook.mjs", import.meta.url));
const DASH = /[\u2014\u2013]/;
const TSX = `export const X = () => <div className="bg-primary" />;\n`;
const BAD = `export const B = () => <div style={{ color: "#ff0000" }} />;\n`;

const BASE = {
  system: "@acme/ds",
  tokensCss: "ds.css",
  ignore: {
    "ds.css": "the token source",
    "legacy/**": "old screens, replaced next quarter",
  },
  profiles: {
    app: { include: ["app/**/*.tsx", "!**/*.test.tsx"], rules: ["no-raw-colors"] },
  },
};

function repo(config = BASE, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "u-hook-nc-"));
  write(root, "ds.css", ":root{--color-primary:#3b5bdb}");
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  write(root, "undrift.config.json", typeof config === "string" ? config : JSON.stringify(config));
  return root;
}
function write(root, rel, body) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
}
const configWith = (over) => ({ ...BASE, ...over });

// `cwd` is where the agent's shell happens to be, which is not always the repository.
const run = (root, file, cwd = root) => {
  try {
    const stdout = execFileSync("node", [HOOK], {
      input: JSON.stringify({ tool_input: { file_path: file } }),
      cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};
const at = (root, rel) => join(root, rel);

// The one shape that reaches the agent from a hook that exits 0.
const context = (r) => {
  const out = JSON.parse(r.stdout);
  expect(Object.keys(out)).toEqual(["hookSpecificOutput"]);
  expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
  return out.hookSpecificOutput.additionalContext;
};
const silent = (r) => {
  expect(r.code).toBe(0);
  expect(r.stdout).toBe("");
  expect(r.stderr).toBe("");
};

describe("silence", () => {
  test("a covered clean file says nothing at all", () => {
    const root = repo(BASE, { "app/a.tsx": TSX });
    silent(run(root, at(root, "app/a.tsx")));
  });

  test("no config at all stays silent: the hook cannot tell a repo without undrift from a broken install", () => {
    const root = mkdtempSync(join(tmpdir(), "u-hook-nc-bare-"));
    write(root, "lib/x.tsx", TSX);
    silent(run(root, at(root, "lib/x.tsx")));
  });

  test("a file excluded on purpose by the profile's own ! pattern is silent", () => {
    const root = repo(BASE, { "app/a.test.tsx": TSX });
    silent(run(root, at(root, "app/a.test.tsx")));
  });

  test("a UI file that matches ignore is silent", () => {
    const root = repo(BASE, { "legacy/old.tsx": TSX });
    silent(run(root, at(root, "legacy/old.tsx")));
  });

  test("a stylesheet that matches ignore is silent", () => {
    const root = repo(BASE, { "legacy/old.css": "a{}" });
    silent(run(root, at(root, "legacy/old.css")));
    silent(run(root, at(root, "ds.css")));
  });

  test.each(["lib/x.ts", "README.md", "lib/data.json"])("a file that is neither UI nor a stylesheet (%s) is silent", (rel) => {
    const root = repo(BASE, { [rel]: "x" });
    silent(run(root, at(root, rel)));
  });

  // A broad include such as **/*.tsx matches a dot-directory only when dot matching is on,
  // and the gate leaves them out. The hook has to as well, or a file the whole-repository
  // run never gates is blocked when an agent writes it.
  test.each([".storybook/x.tsx", ".claude/skills/demo/x.tsx", "app/.hidden/x.tsx", ".config/x.tsx"])(
    "a file in a dot-directory (%s) is silent even when the include is **/*.tsx and the file is bad",
    (rel) => {
      const root = repo(configWith({ profiles: { all: { include: ["**/*.tsx"], rules: ["no-raw-colors"] } } }), { [rel]: BAD });
      silent(run(root, at(root, rel)));
    }
  );

  test("the same include does gate a bad file that is not in a dot-directory", () => {
    const root = repo(configWith({ profiles: { all: { include: ["**/*.tsx"], rules: ["no-raw-colors"] } } }), { "lib/bad.tsx": BAD });
    expect(run(root, at(root, "lib/bad.tsx")).code).toBe(2);
  });

  test.each(["node_modules/pkg/x.tsx", ".next/x.tsx", ".storybook/x.tsx", "node_modules/pkg/x.css", "storybook-static/x.tsx", "app/node_modules/x.tsx"])(
    "a file in a place that is never source (%s) is silent",
    (rel) => {
      const root = repo(BASE, { [rel]: TSX });
      silent(run(root, at(root, rel)));
    }
  );

  // dist, build, out and coverage are a package's output where a package.json sits
  // beside them, and only there.
  test.each(["dist/x.tsx", "build/x.tsx", "out/x.tsx", "coverage/x.tsx", "dist/x.css", "build/x.scss"])(
    "a file in a package's build output (%s) is silent",
    (rel) => {
      const root = repo(BASE, { [rel]: TSX, "package.json": "{}" });
      silent(run(root, at(root, rel)));
    }
  );

  test.each(["lib/coverage/page.tsx", "lib/build/[id]/page.tsx", "lib/out/page.tsx", "lib/dist/x.tsx"])(
    "a route folder named like build output (%s) is not skipped: nothing covers it, so the agent is told",
    (rel) => {
      const root = repo(BASE, { [rel]: TSX, "package.json": "{}" });
      expect(context(run(root, at(root, rel)))).toContain(`Undrift did not check ${rel}`);
    }
  );

  test.each(["lib/coverage/report.css", "lib/build/theme.scss", "lib/dist/x.css"])(
    "a stylesheet in a route folder named like build output (%s) is reported, not skipped",
    (rel) => {
      const root = repo(BASE, { [rel]: "a{}", "package.json": "{}" });
      expect(context(run(root, at(root, rel)))).toContain(`Undrift does not check stylesheets yet, so values set in ${rel}`);
    }
  );

  test("a covered route folder named like build output is gated, and its violation blocks", () => {
    const root = repo(BASE, { "app/coverage/page.tsx": BAD, "package.json": "{}" });
    const r = run(root, at(root, "app/coverage/page.tsx"));
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/#ff0000/);
  });

  test("a file outside the repository is silent", () => {
    const root = repo(BASE);
    const elsewhere = mkdtempSync(join(tmpdir(), "u-hook-elsewhere-"));
    write(elsewhere, "x.tsx", TSX);
    write(elsewhere, "x.css", "a{}");
    silent(run(root, at(elsewhere, "x.tsx")));
    silent(run(root, at(elsewhere, "x.css")));
  });
});

// Working out that a file was excluded on purpose globs the profile's positive
// patterns alone, which used to walk node_modules: slow, and a directory in it the
// process cannot read made the hook crash with a stack trace instead of answering.
describe("the hook does not walk node_modules", () => {
  test.skipIf(process.getuid?.() === 0)("an unreadable directory in it does not make the hook fail", () => {
    const root = repo(
      configWith({ profiles: { app: { include: ["**/*.tsx", "!**/node_modules/**", "!lib/**"], rules: ["no-raw-colors"] } } }),
      { "lib/x.tsx": TSX, "app/a.tsx": TSX }
    );
    const locked = join(root, "node_modules/locked");
    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o000);
    try {
      silent(run(root, at(root, "lib/x.tsx"))); // dropped by the profile's own ! pattern: excluded on purpose
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});

describe("a config that exists but cannot be loaded", () => {
  const BROKEN = `{ "system": "@acme/ds", "profiles": { `;

  test("exits 0 with a notice that nothing was checked, and why", () => {
    const root = repo(BROKEN, { "app/a.tsx": TSX });
    const r = run(root, at(root, "app/a.tsx"));
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const text = context(r);
    expect(text).toContain("Undrift could not read undrift.config.json");
    expect(text).toContain("so it did not check app/a.tsx or any other file");
    expect(text).toMatch(/JSON/); // the parser's own reason
    expect(text).toMatch(/Fix: repair undrift\.config\.json\./);
  });

  test("a config that parses but is invalid (a blank ignore reason) is the same: told, with the reason", () => {
    const root = repo(configWith({ ignore: { "legacy/**": "   " } }), { "app/a.tsx": TSX });
    const text = context(run(root, at(root, "app/a.tsx")));
    expect(text).toContain("Undrift could not read undrift.config.json");
    expect(text).toContain('"ignore" entry "legacy/**" needs a reason');
  });

  test("is sent once per version of the config, then silent", () => {
    const root = repo(BROKEN, { "app/a.tsx": TSX, "app/b.tsx": TSX });
    expect(context(run(root, at(root, "app/a.tsx")))).toContain("could not read");
    silent(run(root, at(root, "app/a.tsx")));
    silent(run(root, at(root, "app/b.tsx"))); // another file: the same notice, already sent
  });

  test("a changed config re-arms it", () => {
    const root = repo(BROKEN, { "app/a.tsx": TSX });
    expect(context(run(root, at(root, "app/a.tsx")))).toContain("could not read");
    silent(run(root, at(root, "app/a.tsx")));
    write(root, "undrift.config.json", BROKEN + "  ");
    expect(context(run(root, at(root, "app/a.tsx")))).toContain("could not read");
  });

  test("returning to a config version seen before still re-arms, if a different one came between", () => {
    const root = repo(BROKEN, { "app/a.tsx": TSX });
    expect(context(run(root, at(root, "app/a.tsx")))).toContain("could not read");
    write(root, "undrift.config.json", JSON.stringify(BASE)); // repaired
    silent(run(root, at(root, "app/a.tsx")));
    write(root, "undrift.config.json", BROKEN); // broken again, byte for byte as before
    expect(context(run(root, at(root, "app/a.tsx")))).toContain("could not read");
  });

  test("a file outside the repository is not this config's business, so it stays silent", () => {
    const root = repo(BROKEN);
    const elsewhere = mkdtempSync(join(tmpdir(), "u-hook-elsewhere-"));
    write(elsewhere, "x.tsx", TSX);
    silent(run(root, at(elsewhere, "x.tsx")));
  });

  test("a repaired config goes back to normal: the violation blocks again", () => {
    const root = repo(BROKEN, { "app/bad.tsx": BAD });
    context(run(root, at(root, "app/bad.tsx")));
    write(root, "undrift.config.json", JSON.stringify(BASE));
    expect(run(root, at(root, "app/bad.tsx")).code).toBe(2);
  });
});

describe("a UI file no profile covers", () => {
  test("gets a notice naming the file and the fix", () => {
    const root = repo(BASE, { "lib/x.tsx": TSX });
    const r = run(root, at(root, "lib/x.tsx"));
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const text = context(r);
    expect(text).toContain("Undrift did not check lib/x.tsx");
    expect(text).toContain("no profile in undrift.config.json covers it, so no rule ran on it");
    expect(text).toMatch(/Fix: add it to a profile's include/);
  });

  test("is sent once, and a second write of the same file is silent", () => {
    const root = repo(BASE, { "lib/x.tsx": TSX });
    expect(context(run(root, at(root, "lib/x.tsx")))).toContain("lib/x.tsx");
    silent(run(root, at(root, "lib/x.tsx")));
    silent(run(root, at(root, "lib/x.tsx")));
  });

  test("is per file: another uncovered file gets its own notice", () => {
    const root = repo(BASE, { "lib/x.tsx": TSX, "lib/y.jsx": TSX });
    expect(context(run(root, at(root, "lib/x.tsx")))).toContain("lib/x.tsx");
    expect(context(run(root, at(root, "lib/y.jsx")))).toContain("lib/y.jsx");
    silent(run(root, at(root, "lib/x.tsx")));
    silent(run(root, at(root, "lib/y.jsx")));
  });

  test("a changed config re-arms it", () => {
    const root = repo(BASE, { "lib/x.tsx": TSX });
    expect(context(run(root, at(root, "lib/x.tsx")))).toContain("lib/x.tsx");
    silent(run(root, at(root, "lib/x.tsx")));
    write(root, "undrift.config.json", JSON.stringify(configWith({ exemptMarker: "token-exempt" })));
    expect(context(run(root, at(root, "lib/x.tsx")))).toContain("lib/x.tsx");
  });

  test("an unchanged config does not re-arm it", () => {
    const root = repo(BASE, { "lib/x.tsx": TSX });
    context(run(root, at(root, "lib/x.tsx")));
    write(root, "undrift.config.json", JSON.stringify(BASE)); // rewritten, identical bytes
    silent(run(root, at(root, "lib/x.tsx")));
  });

  test("fixing it (adding it to a profile) means the file is checked, and clean is silent", () => {
    const root = repo(BASE, { "lib/x.tsx": TSX });
    context(run(root, at(root, "lib/x.tsx")));
    write(root, "undrift.config.json", JSON.stringify(configWith({ profiles: { app: { include: ["app/**/*.tsx", "lib/**/*.tsx"], rules: ["no-raw-colors"] } } })));
    silent(run(root, at(root, "lib/x.tsx")));
  });

  test("with no profile at all, every UI file is uncovered", () => {
    const root = repo(configWith({ profiles: {} }), { "app/a.tsx": TSX });
    expect(context(run(root, at(root, "app/a.tsx")))).toContain("no profile in undrift.config.json covers it");
  });

  test("the notice state is recorded in .undrift/notices.json, keyed on the config", () => {
    const root = repo(BASE, { "lib/x.tsx": TSX });
    context(run(root, at(root, "lib/x.tsx")));
    const first = JSON.parse(readFileSync(join(root, ".undrift/notices.json"), "utf8"));
    expect(typeof first.config).toBe("string");
    expect(first.config.length).toBeGreaterThan(8);
    expect(first.sent).toHaveLength(1);
    write(root, "undrift.config.json", JSON.stringify(configWith({ exemptMarker: "token-exempt" })));
    context(run(root, at(root, "lib/x.tsx")));
    const second = JSON.parse(readFileSync(join(root, ".undrift/notices.json"), "utf8"));
    expect(second.config).not.toBe(first.config);
    expect(second.sent).toHaveLength(1);
  });

  test("the state is kept beside the config, wherever in the repository the hook runs from", () => {
    const root = repo(BASE, { "lib/x.tsx": TSX, "app/deep/a.tsx": TSX });
    mkdirSync(join(root, "app/deep"), { recursive: true });
    context(run(root, at(root, "lib/x.tsx"), join(root, "app/deep")));
    expect(existsSync(join(root, ".undrift/notices.json"))).toBe(true);
    expect(existsSync(join(root, "app/deep/.undrift"))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, ".undrift/notices.json"), "utf8")).sent).toEqual(["uncovered:lib/x.tsx"]);
    // and it is the one the next run reads, from anywhere in the repository
    silent(run(root, at(root, "lib/x.tsx"), join(root, "lib")));
  });

  test("a clean covered file writes no notice state at all", () => {
    const root = repo(BASE, { "app/a.tsx": TSX });
    silent(run(root, at(root, "app/a.tsx")));
    expect(existsSync(join(root, ".undrift/notices.json"))).toBe(false);
  });
});

describe("a stylesheet", () => {
  test.each(["styles/global.css", "styles/theme.scss", "styles/legacy.sass", "styles/old.less"])(
    "%s gets a notice: undrift does not check stylesheets yet",
    (rel) => {
      const root = repo(BASE, { [rel]: "a { color: #ff0000 }\n" });
      const r = run(root, at(root, rel));
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
      const text = context(r);
      expect(text).toContain(`Undrift does not check stylesheets yet, so values set in ${rel} are not checked against the design system's tokens.`);
      expect(text).toMatch(/Fix: reference tokens with var\(--name\)/);
    }
  );

  test("is sent once per file per config version", () => {
    const root = repo(BASE, { "styles/a.css": "a{}", "styles/b.css": "b{}" });
    expect(context(run(root, at(root, "styles/a.css")))).toContain("styles/a.css");
    silent(run(root, at(root, "styles/a.css")));
    expect(context(run(root, at(root, "styles/b.css")))).toContain("styles/b.css");
    write(root, "undrift.config.json", JSON.stringify(configWith({ exemptMarker: "token-exempt" })));
    expect(context(run(root, at(root, "styles/a.css")))).toContain("styles/a.css");
  });

  // No rule reads CSS, so a profile that includes one does not check it, and the
  // hook must not pretend it did.
  test("a profile that includes a stylesheet does not make it checked", () => {
    const root = repo(
      configWith({ profiles: { app: { include: ["app/**/*.tsx", "styles/**"], rules: ["no-raw-colors"] } } }),
      { "styles/a.css": "a { color: #ff0000 }\n" }
    );
    const r = run(root, at(root, "styles/a.css"));
    expect(r.code).toBe(0);
    expect(context(r)).toContain("does not check stylesheets yet");
  });
});

// A notice is read by the agent that wrote the file. "List it under ignore" told an
// agent to exempt its own drift, and one did exactly that and then passed strict.
// Agents propose, humans ratify: the notice sends the proposal to the user.
// The hook is run from wherever the agent's shell is. An agent that has cd'd into
// another directory, or a monorepo whose packages carry their own config, used to
// get the config found from that directory, or none: silence, read as clean.
describe("the config is the one nearest the file, then the one at the working directory", () => {
  const NESTED = {
    ...BASE,
    profiles: { pkg: { include: ["src/**/*.tsx"], rules: ["no-raw-colors"] } },
  };
  const scratch = (label) => mkdtempSync(join(tmpdir(), `u-hook-nc-${label}-`));

  test("a file is gated by the config above it, whatever directory the hook runs from", () => {
    const root = repo(BASE, { "app/bad.tsx": BAD });
    const elsewhere = scratch("cwd");
    const r = run(root, at(root, "app/bad.tsx"), elsewhere);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("violation(s) in app/bad.tsx");
  });

  test("the same when the hook runs from inside another repository that has its own config", () => {
    const root = repo(BASE, { "app/bad.tsx": BAD });
    const other = repo(BASE, { "app/fine.tsx": TSX });
    const r = run(root, at(root, "app/bad.tsx"), other);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("violation(s) in app/bad.tsx");
    // nothing was written into the repository the hook merely ran from
    expect(existsSync(join(other, ".undrift"))).toBe(false);
  });

  test("a package's own config governs its files, not the config at the working directory", () => {
    const root = repo(BASE, {
      "pkg/ds.css": ":root{--color-primary:#3b5bdb}",
      "pkg/src/bad.tsx": BAD,
    });
    write(root, "pkg/undrift.config.json", JSON.stringify(NESTED));
    const r = run(root, at(root, "pkg/src/bad.tsx"), root);
    expect(r.code).toBe(2);
    // the path is relative to the config that gated it
    expect(r.stderr).toContain("violation(s) in src/bad.tsx");
  });

  test("state for a file is kept beside the config that gated it", () => {
    const root = repo(BASE, {
      "pkg/ds.css": ":root{--color-primary:#3b5bdb}",
      "pkg/src/bad.tsx": BAD,
      "pkg/lib/x.tsx": TSX,
    });
    write(root, "pkg/undrift.config.json", JSON.stringify(NESTED));
    run(root, at(root, "pkg/src/bad.tsx"), root);
    run(root, at(root, "pkg/lib/x.tsx"), root);
    expect(existsSync(join(root, "pkg/.undrift/attempts.json"))).toBe(true);
    expect(existsSync(join(root, "pkg/.undrift/notices.json"))).toBe(true);
    expect(existsSync(join(root, ".undrift"))).toBe(false);
  });

  // A path that reaches the repository through a link the config is not above has no
  // config over it, so the working directory's is used.
  test("with no config above the file, the one at the working directory is used", () => {
    const root = repo(BASE, { "app/bad.tsx": BAD });
    const outside = scratch("link");
    symlinkSync(join(root, "app"), join(outside, "linked"));
    const r = run(root, join(outside, "linked", "bad.tsx"), root);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("violation(s) in app/bad.tsx");
  });

  test("with no config anywhere, the hook stays silent", () => {
    const bare = scratch("bare");
    write(bare, "lib/x.tsx", BAD);
    silent(run(bare, at(bare, "lib/x.tsx"), scratch("bare-cwd")));
  });

  test("a file is judged by the config of the repository it is in, not the one the hook started in", () => {
    const root = repo(BASE, { "app/a.tsx": TSX });
    const stranger = repo(BASE, { "elsewhere/x.tsx": BAD });
    // the stranger's own config has no profile for it: told, not blocked
    const r = run(stranger, at(stranger, "elsewhere/x.tsx"), root);
    expect(r.code).toBe(0);
    expect(context(r)).toContain("Undrift did not check elsewhere/x.tsx");
  });
});

// A hook that throws exits 1 with a stack trace. Claude Code shows that to the person
// and never to the agent, so the file the agent has just written reads as checked and
// clean when nothing was checked. Whatever goes wrong, the hook says so in a notice.
describe("the hook never throws", () => {
  const cannotRead = process.getuid?.() === 0;

  test.skipIf(cannotRead)("a file it cannot read is a notice naming the error, not a stack trace", () => {
    const root = repo(BASE, { "app/a.tsx": TSX });
    const file = at(root, "app/a.tsx");
    chmodSync(file, 0o000);
    try {
      const r = run(root, file);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
      const text = context(r);
      expect(text).toContain("Undrift stopped on an error while checking app/a.tsx (EACCES");
      expect(text).toContain("so it did not check the file");
      expect(text).toContain('Fix: run "undrift gate app/a.tsx" to see the error in full');
      expect(text).not.toMatch(DASH);
      expect(text).not.toMatch(/\n\s+at /);
    } finally {
      chmodSync(file, 0o644);
    }
  });

  test.skipIf(cannotRead)("the same error for the same file is told once per version of the config", () => {
    const root = repo(BASE, { "app/a.tsx": TSX });
    const file = at(root, "app/a.tsx");
    chmodSync(file, 0o000);
    try {
      context(run(root, file));
      silent(run(root, file));
    } finally {
      chmodSync(file, 0o644);
    }
  });

  test.skipIf(cannotRead)("a different file with a different error is news", () => {
    const root = repo(BASE, { "app/a.tsx": TSX, "app/b.tsx": TSX });
    const [a, b] = [at(root, "app/a.tsx"), at(root, "app/b.tsx")];
    chmodSync(a, 0o000);
    chmodSync(b, 0o000);
    try {
      expect(context(run(root, a))).toContain("app/a.tsx");
      expect(context(run(root, b))).toContain("app/b.tsx");
    } finally {
      chmodSync(a, 0o644);
      chmodSync(b, 0o644);
    }
  });

  test.skipIf(cannotRead)("a file that has a violation and can be read is still blocked", () => {
    const root = repo(BASE, { "app/bad.tsx": BAD, "app/locked.tsx": TSX });
    chmodSync(at(root, "app/locked.tsx"), 0o000);
    try {
      expect(run(root, at(root, "app/bad.tsx")).code).toBe(2);
    } finally {
      chmodSync(at(root, "app/locked.tsx"), 0o644);
    }
  });
});

describe("a notice never tells the agent to exempt its own file", () => {
  const sentences = (text) => text.split(/(?<=\.)\s+/);

  test("the uncovered-file notice proposes the ignore entry to the user, and says not to add it", () => {
    const root = repo(BASE, { "lib/x.tsx": TSX });
    const text = context(run(root, at(root, "lib/x.tsx")));
    expect(text).toMatch(/Fix: add it to a profile's include in undrift\.config\.json so the rules run on it\./);
    expect(text).toContain('propose an "ignore" entry, with the reason, to the user');
    expect(text).toContain("do not add one yourself");
    expect(text).not.toMatch(/list it under "ignore"/);
  });

  test("the stylesheet notice proposes the ignore entry to the user, and says not to add it", () => {
    const root = repo(BASE, { "styles/g.css": "a{}" });
    const text = context(run(root, at(root, "styles/g.css")));
    expect(text).toContain("Undrift cannot check the file, so only the user can accept it as unchecked");
    expect(text).toContain('propose an "ignore" entry, with a reason, to the user');
    expect(text).toContain("do not add one yourself");
    expect(text).not.toMatch(/list it under "ignore"|record it as accepted/);
  });

  test("in every notice, a sentence that mentions ignore is one that proposes it or forbids adding it", () => {
    const NEEDS_MAP = configWith({
      intrinsics: {}, tokensCss: ["ds.css", "nope.css"],
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors", "no-raw-elements"] } },
    });
    const combined = repo(NEEDS_MAP, { "app/a.tsx": TSX, "lib/x.tsx": TSX, "styles/g.css": "a{}" });
    const broken = repo(`{ "system": `, { "app/a.tsx": TSX });
    const texts = [
      context(run(combined, at(combined, "app/a.tsx"))),
      context(run(combined, at(combined, "lib/x.tsx"))),
      context(run(combined, at(combined, "styles/g.css"))),
      context(run(broken, at(broken, "app/a.tsx"))),
    ];
    let mentions = 0;
    for (const text of texts) {
      for (const sentence of sentences(text).filter((x) => /"ignore"/.test(x))) {
        mentions += 1;
        expect(sentence, sentence).toMatch(/propose|do not add/);
      }
    }
    expect(mentions).toBeGreaterThanOrEqual(2);
  });

  test("the notice on a violation, which the agent must act on, does not offer it either", () => {
    const root = repo(configWith({ intrinsics: {}, profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors", "no-raw-elements"] } } }), { "app/bad.tsx": BAD });
    const r = run(root, at(root, "app/bad.tsx"));
    expect(r.stderr).not.toMatch(/list it under "ignore"|add it to "ignore"/);
  });
});

// A rule that ran on less than it is for (shadcn's --radius is a primitive, its colours are not) is a note:
// the notice says a part was not checked, and counts it apart from what could not run at all.
describe("a part of a rule that was not checked", () => {
  const SHADCN_CSS = ":root{--radius:0.5rem;--radius-md:var(--radius);--color-primary:#3b5bdb}";
  // The design system declares --radius as its primitive: without a declaration the rule does not run at all.
  const PART = configWith({
    primitives: ["--radius"],
    profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-primitive-tokens"] } },
  });

  test("alone, it says part of one rule was not checked, and not that something could not run", () => {
    const root = repo(PART, { "ds.css": SHADCN_CSS, "app/a.tsx": TSX });
    const r = run(root, at(root, "app/a.tsx"));
    expect(r.code).toBe(0);
    const text = context(r);
    expect(text).toContain("Undrift checked app/a.tsx, but part of 1 rule was not checked:");
    expect(text).not.toContain("could not run");
    expect(text).toContain("no-primitive-tokens ran only in part in profile app");
    expect(text).toContain("Colour utilities were not checked by no-primitive-tokens");
    expect(text).not.toMatch(DASH);
  });

  test("beside a rule that could not run, each is counted on its own", () => {
    const config = configWith({
      intrinsics: {},
      primitives: ["--radius"],
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-primitive-tokens", "no-raw-elements"] } },
    });
    const root = repo(config, { "ds.css": SHADCN_CSS, "app/a.tsx": TSX });
    const text = context(run(root, at(root, "app/a.tsx")));
    expect(text).toContain(
      "Undrift checked app/a.tsx, but 1 thing it is configured to check could not run, and part of 1 rule was not checked:"
    );
    expect(text).toContain("no-raw-elements did not run in profile app");
    expect(text).toContain("no-primitive-tokens ran only in part in profile app");
  });

  test("two parts in two profiles read as plural, and two things as plural", () => {
    const config = configWith({
      intrinsics: {},
      primitives: ["--radius"],
      profiles: {
        app: { include: ["app/**/*.tsx"], rules: ["no-primitive-tokens", "no-raw-elements"] },
        system: { include: ["app/**/*.tsx"], rules: ["no-primitive-tokens", "no-foreign-ui-imports"] },
      },
      foreignUi: [],
    });
    const root = repo(config, { "ds.css": SHADCN_CSS, "app/a.tsx": TSX });
    const text = context(run(root, at(root, "app/a.tsx")));
    expect(text).toContain("but 2 things it is configured to check could not run, and part of 2 rules were not checked:");
  });

  test("with no primitives declared the rule could not run, and the notice says what to declare", () => {
    const root = repo({ ...PART, primitives: undefined }, { "ds.css": SHADCN_CSS, "app/a.tsx": TSX });
    const r = run(root, at(root, "app/a.tsx"));
    expect(r.code).toBe(0);
    const text = context(r);
    expect(text).toContain("1 thing it is configured to check could not run");
    expect(text).toContain("no-primitive-tokens did not run in profile app. No primitives are declared");
    expect(text).not.toContain("ran only in part");
    expect(text).not.toMatch(DASH);
  });

  test("is sent once, then silent", () => {
    const root = repo(PART, { "ds.css": SHADCN_CSS, "app/a.tsx": TSX, "app/b.tsx": TSX });
    context(run(root, at(root, "app/a.tsx")));
    silent(run(root, at(root, "app/a.tsx")));
    silent(run(root, at(root, "app/b.tsx")));
  });

  test("a layered set with a colour primitive has nothing to say", () => {
    const root = repo({ ...PART, primitives: ["--p"] }, { "ds.css": ":root{--p:#00f;--color-brand:var(--p)}", "app/a.tsx": TSX });
    silent(run(root, at(root, "app/a.tsx")));
  });
});

describe("rules that cannot run, and sources that are missing: one combined notice", () => {
  const NEEDS_MAP = configWith({
    intrinsics: {},
    foreignUi: ["@mui/"],
    profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors", "no-raw-elements"] } },
  });

  test("a covered clean file gets it, exit 0", () => {
    const root = repo(NEEDS_MAP, { "app/a.tsx": TSX });
    const r = run(root, at(root, "app/a.tsx"));
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const text = context(r);
    expect(text).toContain("Undrift checked app/a.tsx, but 1 thing it is configured to check could not run");
    expect(text).toContain("no-raw-elements did not run in profile app");
    expect(text).toMatch(/Fix: Map each raw element/);
  });

  test("is sent once, then silent", () => {
    const root = repo(NEEDS_MAP, { "app/a.tsx": TSX, "app/b.tsx": TSX });
    context(run(root, at(root, "app/a.tsx")));
    silent(run(root, at(root, "app/a.tsx")));
    silent(run(root, at(root, "app/b.tsx"))); // same profile, same notice
  });

  test("a missing source is part of the same notice", () => {
    const root = repo(configWith({ ...NEEDS_MAP, tokensCss: ["ds.css", "nope.css"] }), { "app/a.tsx": TSX });
    const text = context(run(root, at(root, "app/a.tsx")));
    expect(text).toContain("but 2 things it is configured to check could not run");
    expect(text).toContain('tokensCss "nope.css" does not exist');
    expect(text).toContain("no-raw-elements did not run in profile app");
    expect(text.match(/Undrift checked/g)).toHaveLength(1);
  });

  // The four kinds of source are told alike. A notice that named only the token files
  // would leave a missing component list silent, and the run would read as checked.
  test.each([
    ["tokens", { tokens: "gone/tokens.json" }, 'tokens "gone/tokens.json" does not exist, so it contributed no tokens.'],
    ["catalog", { catalog: "gone/CATALOG.md" }, 'catalog "gone/CATALOG.md" does not exist, so no components were read from it.'],
    ["componentsFrom", { componentsFrom: "gone/index.d.ts" }, 'componentsFrom "gone/index.d.ts" does not exist, so no components were read from it.'],
  ])("a missing %s source is named in the combined notice, with its reason and its fix", (_key, over, reason) => {
    const root = repo(configWith(over), { "app/a.tsx": TSX });
    const text = context(run(root, at(root, "app/a.tsx")));
    expect(text).toContain("but 1 thing it is configured to check could not run");
    expect(text).toContain(reason);
    expect(text).toContain("undrift.config.json");
  });

  test("with every kind of source missing, all four are named, and the component rule says why it did not run", () => {
    const root = repo(
      configWith({
        tokens: "gone/tokens.json",
        catalog: "gone/CATALOG.md",
        componentsFrom: "gone/index.d.ts",
        profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors", "no-unknown-components"] } },
      }),
      { "app/a.tsx": TSX }
    );
    const text = context(run(root, at(root, "app/a.tsx")));
    for (const source of ['tokens "gone/tokens.json"', 'catalog "gone/CATALOG.md"', 'componentsFrom "gone/index.d.ts"']) {
      expect(text, source).toContain(source);
    }
    expect(text).toContain("no-unknown-components did not run in profile app.");
    expect(text).toContain("No component list was loaded, because");
  });

  test("a missing source alone is enough, even when every rule can run", () => {
    const root = repo(configWith({ tokensCss: ["ds.css", "nope.css"] }), { "app/a.tsx": TSX });
    const text = context(run(root, at(root, "app/a.tsx")));
    expect(text).toContain("but 1 thing it is configured to check could not run");
    expect(text).toContain('tokensCss "nope.css" does not exist');
  });

  test("each profile gets its own notice, once", () => {
    const config = configWith({
      intrinsics: {},
      profiles: {
        app: { include: ["app/**/*.tsx"], rules: ["no-raw-elements"] },
        system: { include: ["packages/ui/**/*.tsx"], rules: ["no-raw-elements"] },
      },
    });
    const root = repo(config, { "app/a.tsx": TSX, "packages/ui/b.tsx": TSX });
    expect(context(run(root, at(root, "app/a.tsx")))).toContain("in profile app");
    expect(context(run(root, at(root, "packages/ui/b.tsx")))).toContain("in profile system");
    silent(run(root, at(root, "app/a.tsx")));
    silent(run(root, at(root, "packages/ui/b.tsx")));
  });

  test("a changed config re-arms it", () => {
    const root = repo(NEEDS_MAP, { "app/a.tsx": TSX });
    context(run(root, at(root, "app/a.tsx")));
    silent(run(root, at(root, "app/a.tsx")));
    write(root, "undrift.config.json", JSON.stringify({ ...NEEDS_MAP, exemptMarker: "token-exempt" }));
    expect(context(run(root, at(root, "app/a.tsx")))).toContain("no-raw-elements did not run");
  });

  // The notice is keyed on WHAT it says, not only on which profile it is for. A source
  // can go missing, or a rule lose its input, while the config file is untouched (a
  // build directory is cleaned, a package is deleted), and the new set of things
  // unchecked is news the agent has not been told.
  describe("keyed on what it says", () => {
    const CONFIG = configWith({
      tokensCss: ["ds.css", "later.css"],
      componentsFrom: "ds/index.d.ts",
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors", "no-unknown-components"] } },
    });
    const FILES = { "app/a.tsx": TSX, "app/b.tsx": TSX, "ds/index.d.ts": "export { Button } from './button';\n" };

    test("a different set of unchecked items, with the config file untouched, is sent again", () => {
      const root = repo(CONFIG, FILES);
      const first = context(run(root, at(root, "app/a.tsx")));
      expect(first).toContain('tokensCss "later.css" does not exist');
      expect(first).toContain("but 1 thing");
      silent(run(root, at(root, "app/b.tsx")));
      rmSync(join(root, "ds/index.d.ts")); // the config is the same bytes; the world is not
      const second = context(run(root, at(root, "app/b.tsx")));
      expect(second).toContain('componentsFrom "ds/index.d.ts" does not exist');
      expect(second).toContain("no-unknown-components did not run in profile app");
      expect(second).toContain("but 3 things"); // later.css is still missing, and now the list and the rule too
    });

    test("the notice that was sent stays sent: the same set again is silent", () => {
      const root = repo(CONFIG, FILES);
      context(run(root, at(root, "app/a.tsx")));
      silent(run(root, at(root, "app/a.tsx")));
      silent(run(root, at(root, "app/b.tsx")));
    });

    test("fixing it and breaking it the same way again is not news: the same words were already sent", () => {
      const root = repo(CONFIG, FILES);
      context(run(root, at(root, "app/a.tsx")));
      write(root, "later.css", ":root{--x:1px}"); // fixed: nothing unchecked, nothing said
      silent(run(root, at(root, "app/a.tsx")));
      rmSync(join(root, "later.css")); // broken the same way
      silent(run(root, at(root, "app/a.tsx")));
    });

    test("two profiles with the same missing source read the same, so it is sent once, not once each", () => {
      const config = configWith({
        tokensCss: ["ds.css", "later.css"],
        profiles: {
          app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] },
          lib: { include: ["lib/**/*.tsx"], rules: ["no-raw-colors"] },
        },
      });
      const root = repo(config, { "app/a.tsx": TSX, "lib/x.tsx": TSX });
      expect(context(run(root, at(root, "app/a.tsx")))).toContain('tokensCss "later.css" does not exist');
      silent(run(root, at(root, "lib/x.tsx")));
    });

    test("the file the notice was for does not change what it says: another file gets no second copy", () => {
      const root = repo(CONFIG, FILES);
      context(run(root, at(root, "app/a.tsx")));
      silent(run(root, at(root, "app/b.tsx")));
    });
  });

  test("a profile whose rules all run, over sources that all exist, stays silent", () => {
    const root = repo(BASE, { "app/a.tsx": TSX });
    silent(run(root, at(root, "app/a.tsx")));
  });
});

// A profile that omits `rules` applies all of them (the schema says so, and so
// does `undrift gate`). The hook used to read a missing `rules` as "no rules for
// this file" and exit 0, so such a profile was enforced by the CLI and by nothing
// at write time, and every file it covered read as clean.
describe("a profile that omits rules", () => {
  const NO_RULES = configWith({ profiles: { app: { include: ["app/**/*.tsx"] } } });

  test("is enforced by the hook, with every rule", () => {
    const root = repo(NO_RULES, { "app/bad.tsx": BAD });
    const r = run(root, at(root, "app/bad.tsx"));
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/#ff0000/);
  });

  test("and the rules that could not run say so, since all seven were asked for", () => {
    const root = repo(NO_RULES, { "app/a.tsx": TSX });
    const text = context(run(root, at(root, "app/a.tsx")));
    expect(text).toContain("no-unknown-components did not run in profile app");
    expect(text).toContain("no-raw-elements did not run in profile app");
  });
});

describe("notices alongside violations", () => {
  const NEEDS_MAP = configWith({
    intrinsics: {},
    profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors", "no-raw-elements"] } },
  });

  test("a file with violations still exits 2 with stderr, and the notice is appended to that message", () => {
    const root = repo(NEEDS_MAP, { "app/bad.tsx": BAD });
    const r = run(root, at(root, "app/bad.tsx"));
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/#ff0000/);
    expect(r.stderr).toMatch(/attempt 1\/3/);
    expect(r.stderr).toContain("no-raw-elements did not run in profile app");
    expect(r.stderr).toContain("Undrift checked app/bad.tsx, but 1 thing it is configured to check could not run");
    // the violation comes first: it is what has to be fixed
    expect(r.stderr.indexOf("#ff0000")).toBeLessThan(r.stderr.indexOf("no-raw-elements did not run"));
  });

  test("the notice is not repeated on the next attempt", () => {
    const root = repo(NEEDS_MAP, { "app/bad.tsx": BAD });
    run(root, at(root, "app/bad.tsx"));
    const second = run(root, at(root, "app/bad.tsx"));
    expect(second.code).toBe(2);
    expect(second.stderr).toMatch(/attempt 2\/3/);
    expect(second.stderr).not.toContain("did not run");
  });

  test("the notice is not repeated once the file is clean either", () => {
    const root = repo(NEEDS_MAP, { "app/bad.tsx": BAD });
    run(root, at(root, "app/bad.tsx"));
    write(root, "app/bad.tsx", TSX);
    silent(run(root, at(root, "app/bad.tsx")));
  });

  test("the third attempt still demands a decision rather than a fix, notice or no notice", () => {
    const root = repo(NEEDS_MAP, { "app/bad.tsx": BAD });
    run(root, at(root, "app/bad.tsx")); // the notice is sent here
    run(root, at(root, "app/bad.tsx"));
    const third = run(root, at(root, "app/bad.tsx"));
    expect(third.code).toBe(2);
    expect(third.stderr).toMatch(/Stop retrying/);
  });

  test("a config change between attempts re-sends the notice with the next attempt's message", () => {
    const root = repo(NEEDS_MAP, { "app/bad.tsx": BAD });
    run(root, at(root, "app/bad.tsx"));
    write(root, "undrift.config.json", JSON.stringify({ ...NEEDS_MAP, exemptMarker: "token-exempt" }));
    const second = run(root, at(root, "app/bad.tsx"));
    expect(second.code).toBe(2);
    expect(second.stderr).toMatch(/attempt 2\/3/);
    expect(second.stderr).toContain("no-raw-elements did not run in profile app");
  });

  test("with no violations and nothing pending, exit 0 stays silent", () => {
    const root = repo(NEEDS_MAP, { "app/a.tsx": TSX });
    context(run(root, at(root, "app/a.tsx"))); // sent once
    silent(run(root, at(root, "app/a.tsx")));
  });
});

describe("notices are independent of each other", () => {
  test("an uncovered-file notice does not use up the combined notice, or the other way round", () => {
    const config = configWith({
      intrinsics: {},
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-elements"] } },
    });
    const root = repo(config, { "app/a.tsx": TSX, "lib/x.tsx": TSX, "styles/g.css": "a{}" });
    expect(context(run(root, at(root, "lib/x.tsx")))).toContain("lib/x.tsx");
    expect(context(run(root, at(root, "app/a.tsx")))).toContain("no-raw-elements did not run");
    expect(context(run(root, at(root, "styles/g.css")))).toContain("styles/g.css");
  });
});

describe("no notice carries a dash", () => {
  test("every kind of notice, in every channel", () => {
    const NEEDS_MAP = configWith({
      intrinsics: {},
      tokensCss: ["ds.css", "nope.css"],
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors", "no-raw-elements"] } },
    });
    const broken = repo(`{ "system": `, { "app/a.tsx": TSX });
    const blank = repo(configWith({ ignore: { "x/**": "" } }), { "app/a.tsx": TSX });
    const combined = repo(NEEDS_MAP, { "app/a.tsx": TSX, "lib/x.tsx": TSX, "styles/g.css": "a{}" });
    const withViolation = repo(NEEDS_MAP, { "app/bad.tsx": BAD });
    const texts = [
      context(run(broken, at(broken, "app/a.tsx"))),
      context(run(blank, at(blank, "app/a.tsx"))),
      context(run(combined, at(combined, "app/a.tsx"))),
      context(run(combined, at(combined, "lib/x.tsx"))),
      context(run(combined, at(combined, "styles/g.css"))),
    ];
    // the part of the exit-2 message that is a notice, not the older violation text
    const stderr = run(withViolation, at(withViolation, "app/bad.tsx")).stderr;
    texts.push(stderr.slice(stderr.indexOf("Undrift checked")));
    for (const t of texts) {
      expect(t.length).toBeGreaterThan(40);
      expect(t).not.toMatch(DASH);
    }
  });
});
