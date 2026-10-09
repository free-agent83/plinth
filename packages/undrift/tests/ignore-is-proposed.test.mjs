// The hook's notices tell an agent to propose an ignore entry to the user, and not to add one:
// an exemption is the owner's call, and an agent that writes its own passes strict. But agents
// in this repository are told to run `npm run gate`, and the CLI's own fixes said "list it
// under ignore with a reason", the same instruction by another road. Every fix an agent can
// read now says the same thing, in the hook and on the command line, and the skill an agent
// reads before it runs the gate says that adding one is not a resolution.
import { describe, expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "../bin/undrift.mjs");
const HOOK = resolve(here, "../hooks/undrift-hook.mjs");
const SKILL = resolve(here, "../../../.agents/skills/check-adherence/SKILL.md");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const GOOD = `export const G = () => <div className="bg-primary p-4" />;\n`;

const cli = (root, argv) => {
  try {
    return { code: 0, out: strip(execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })) };
  } catch (e) {
    return { code: exited(e), out: strip((e.stdout ?? "") + (e.stderr ?? "")) };
  }
};
const hook = (root, file) => {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_input: { file_path: file } }), cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "" };
  }
};

/** A repository with every kind of thing that is not checked, and an outside folder to link to. */
function everything() {
  const base = mkdtempSync(join(tmpdir(), "u-propose-"));
  const root = join(base, "repo");
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("ds.css", ":root{--color-primary:#3b5bdb}");
  write("app/a.tsx", GOOD);
  write("lib/uncovered.tsx", GOOD);
  write("styles/site.css", "a{}\n");
  write("docs/readme.md", "# hi\n");
  write("packages/ui/b.tsx", GOOD);
  mkdirSync(join(base, "elsewhere/ui"), { recursive: true });
  writeFileSync(join(base, "elsewhere/ui/x.tsx"), GOOD);
  symlinkSync(join(base, "elsewhere/ui"), join(root, "app/ui"));
  mkdirSync(join(root, "lib/locked"), { recursive: true });
  chmodSync(join(root, "lib/locked"), 0o000);
  write(
    "undrift.config.json",
    JSON.stringify({
      system: "@acme/ds",
      tokensCss: "ds.css",
      ignore: { "ds.css": "the token source" },
      profiles: {
        app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] },
        docs: { include: ["docs/**/*"], rules: ["no-raw-colors"] },
        system: { include: ["packages/ui/**/*.tsx"], rules: ["no-raw-colors"] },
      },
    })
  );
  return root;
}

const sentences = (text) => text.split(/(?<=\.)\s+(?=[A-Z])/);
// A sentence that names ignore proposes an entry or forbids adding one: it never tells the
// reader to add it.
const proposesOnly = (sentence) => /propose|do not add/.test(sentence);
const asRoot = process.getuid?.() === 0;

describe("no fix an agent can read tells it to add an ignore entry", () => {
  test.skipIf(asRoot)("every not-checked item the CLI produces, over every kind of thing that is not checked", () => {
    const root = everything();
    try {
      const j = JSON.parse(cli(root, ["gate", "--format", "json"]).out);
      const kinds = new Set(j.notChecked.map((i) => i.kind));
      // the sweep must reach the kinds that speak of ignore, or it proves nothing
      for (const kind of ["files", "stylesheets", "unsupported", "directories", "links"]) expect(kinds.has(kind), kind).toBe(true);
      let mentions = 0;
      for (const item of j.notChecked) {
        for (const sentence of sentences(item.fix).filter((x) => /ignore/i.test(x))) {
          mentions += 1;
          expect(sentence, `${item.kind}: ${sentence}`).toMatch(/propose|do not add/);
        }
      }
      expect(mentions).toBeGreaterThanOrEqual(5);
      // and the same text, as it is printed
      const text = cli(root, ["gate"]).out;
      expect(text).not.toMatch(/list (it|them) under "ignore"|to "ignore" with a reason/);
    } finally {
      chmodSync(join(root, "lib/locked"), 0o755);
    }
  });

  test("the profile that ran alone, under --profile, and an explicit path, say the same", () => {
    const root = everything();
    try {
      for (const argv of [["gate", "--profile", "app"], ["gate", "docs/readme.md"], ["gate", "styles/site.css"]]) {
        const text = cli(root, argv).out;
        expect(text, argv.join(" ")).not.toMatch(/list (it|them) under "ignore"|to "ignore" with a reason/);
      }
    } finally {
      chmodSync(join(root, "lib/locked"), 0o755);
    }
  });

  test("the hook's notices, for the same things, say the same", () => {
    const root = everything();
    try {
      let mentions = 0;
      for (const rel of ["lib/uncovered.tsx", "styles/site.css", "docs/readme.md", "app/ui/x.tsx"]) {
        const r = hook(root, join(root, rel));
        if (!r.stdout) continue;
        for (const sentence of sentences(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).filter((x) => /ignore/i.test(x))) {
          mentions += 1;
          expect(sentence, `${rel}: ${sentence}`).toMatch(/propose|do not add/);
        }
      }
      expect(mentions).toBeGreaterThanOrEqual(3);
    } finally {
      chmodSync(join(root, "lib/locked"), 0o755);
    }
  });

  test("a sentence that proposes is worded the way the hook's is, so a person and an agent read one instruction", () => {
    const root = everything();
    try {
      const j = JSON.parse(cli(root, ["gate", "--format", "json"]).out);
      const uncovered = j.notChecked.find((i) => i.kind === "files");
      expect(uncovered.fix).toContain('propose an "ignore" entry, with the reason, to the user; do not add one yourself.');
      const hooked = JSON.parse(hook(root, join(root, "lib/uncovered.tsx")).stdout).hookSpecificOutput.additionalContext;
      expect(hooked).toContain('propose an "ignore" entry, with the reason, to the user; do not add one yourself.');
    } finally {
      chmodSync(join(root, "lib/locked"), 0o755);
    }
  });
});

describe("the skill an agent reads before it runs the gate", () => {
  const skill = readFileSync(SKILL, "utf8");
  const notAResolution = skill.slice(skill.indexOf("## What is not a resolution"));

  test("says that an ignore entry written for a file you wrote is not a resolution", () => {
    expect(notAResolution).toMatch(/`ignore`/);
    expect(notAResolution).toMatch(/for a file you wrote/i);
    expect(notAResolution).toMatch(/propose/);
    expect(notAResolution).toMatch(/to the user/);
  });

  test("still says what it said about a token-exempt comment", () => {
    expect(notAResolution).toMatch(/`\/\/ token-exempt`/);
  });

  test("names the config the entry would go in, which is a file that exists", () => {
    expect(notAResolution).toMatch(/`undrift\.config\.json`/);
  });

  test("carries no dash", () => {
    expect(notAResolution).not.toMatch(/[\u2014\u2013]/);
  });
});
