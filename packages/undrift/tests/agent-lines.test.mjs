// sample/packages/undrift/tests/agent-lines.test.mjs
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedLines, agentLines } from "../src/agent-lines.mjs";
import { git, commitAll } from "./support/git.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "u-lines-"));

describe("changedLines reads a --unified=0 diff", () => {
  test("a block of added lines, a single line, and a deletion that adds nothing", () => {
    const diff = [
      "diff --git a/p.tsx b/p.tsx",
      "@@ -3,0 +4,2 @@",
      "+a",
      "+b",
      "@@ -9 +11 @@",
      "-old",
      "+new",
      "@@ -20,3 +21,0 @@",
      "-gone",
    ].join("\n");
    expect([...changedLines(diff)].sort((a, b) => a - b)).toEqual([4, 5, 11]);
  });

  test("no diff is no lines", () => {
    expect(changedLines("").size).toBe(0);
  });
});

describe("agentLines asks git", () => {
  test("a tracked file with one changed line: that line only", () => {
    const root = tmp();
    writeFileSync(join(root, "p.tsx"), "one\ntwo\nthree\n");
    commitAll(root);
    writeFileSync(join(root, "p.tsx"), "one\nTWO\nthree\n");
    const mine = agentLines(join(root, "p.tsx"));
    expect(mine.all).toBe(false);
    expect([...mine.lines]).toEqual([2]);
  });

  test("a tracked file with no change: no lines", () => {
    const root = tmp();
    writeFileSync(join(root, "p.tsx"), "one\n");
    commitAll(root);
    const mine = agentLines(join(root, "p.tsx"));
    expect(mine.all).toBe(false);
    expect(mine.lines.size).toBe(0);
  });

  test("an untracked file: every line", () => {
    const root = tmp();
    writeFileSync(join(root, "keep.tsx"), "x\n");
    commitAll(root);
    writeFileSync(join(root, "new.tsx"), "one\ntwo\n");
    expect(agentLines(join(root, "new.tsx")).all).toBe(true);
  });

  test("a folder that is not a repository: every line", () => {
    const root = tmp();
    writeFileSync(join(root, "p.tsx"), "one\n");
    expect(agentLines(join(root, "p.tsx")).all).toBe(true);
  });

  test("a repository with no commit yet: every line", () => {
    const root = tmp();
    writeFileSync(join(root, "p.tsx"), "one\n");
    git(root, "init", "-q");
    git(root, "add", "-A");
    expect(agentLines(join(root, "p.tsx")).all).toBe(true);
  });

  // "[id].tsx" is an ordinary Next.js file name and a glob to git: without literal pathspecs it also
  // matches "i.tsx", and that file's changed lines would be counted as this one's.
  test("a name git would read as a glob is taken literally", () => {
    const root = tmp();
    writeFileSync(join(root, "i.tsx"), "a\nb\n");
    writeFileSync(join(root, "[id].tsx"), "a\nb\nc\n");
    commitAll(root);
    writeFileSync(join(root, "i.tsx"), "A\nb\n");
    writeFileSync(join(root, "[id].tsx"), "a\nb\nC\n");
    expect([...agentLines(join(root, "[id].tsx")).lines]).toEqual([3]);
  });

  test("an edit that only deletes lines leaves no line the agent's", () => {
    const root = tmp();
    writeFileSync(join(root, "p.tsx"), "a\nb\n");
    commitAll(root);
    writeFileSync(join(root, "p.tsx"), "b\n");
    const mine = agentLines(join(root, "p.tsx"));
    expect(mine.all).toBe(false);
    expect(mine.lines.size).toBe(0);
  });

  // A change git's diff does not show must never read as "no lines are the agent's": then nothing in
  // the file would be judged. These four once hid a change from the first version of this reading.
  test("a file git's diff treats as binary still shows its changed line", () => {
    const root = tmp();
    writeFileSync(join(root, ".gitattributes"), "*.tsx -diff\n");
    writeFileSync(join(root, "p.tsx"), "one\ntwo\n");
    commitAll(root);
    writeFileSync(join(root, "p.tsx"), "one\nTWO\n");
    expect([...agentLines(join(root, "p.tsx")).lines]).toEqual([2]);
  });

  test("a change git is told to ignore makes every line the agent's", () => {
    const root = tmp();
    writeFileSync(join(root, "p.tsx"), "one\n");
    commitAll(root);
    git(root, "update-index", "--assume-unchanged", "p.tsx");
    writeFileSync(join(root, "p.tsx"), "ONE\n");
    expect(agentLines(join(root, "p.tsx")).all).toBe(true);
  });

  // TypeScript breaks lines at U+2028, U+2029 and a lone CR, and git does not, so their line numbers
  // would disagree. A plain CRLF file is fine.
  test("line breaks git does not count make every line the agent's", () => {
    const root = tmp();
    writeFileSync(join(root, "p.tsx"), "const a = '\u2028';\nconst b = 1;\n");
    commitAll(root);
    writeFileSync(join(root, "p.tsx"), "const a = '\u2028';\nconst b = 2;\n");
    expect(agentLines(join(root, "p.tsx")).all).toBe(true);
  });

  test("a lone carriage return makes every line the agent's", () => {
    const root = tmp();
    writeFileSync(join(root, "p.tsx"), "const a = 1;\rconst b = 1;\nconst c = 1;\n");
    commitAll(root);
    writeFileSync(join(root, "p.tsx"), "const a = 1;\rconst b = 1;\nconst c = 2;\n");
    expect(agentLines(join(root, "p.tsx")).all).toBe(true);
  });

  // A git that exits 0 and prints nothing (but for an attribute answer, so the test reaches the hash
  // comparison) must never read as "no change": "" equals "".
  test("a git that answers with nothing makes every line the agent's", () => {
    const root = tmp();
    writeFileSync(join(root, "p.tsx"), "one\n");
    const bin = tmp();
    writeFileSync(join(bin, "git"), "#!/bin/sh\ncase \"$*\" in *check-attr*) printf 'p.tsx\\000filter\\000unspecified\\000';; esac\nexit 0\n");
    chmodSync(join(bin, "git"), 0o755);
    const was = process.env.PATH;
    process.env.PATH = `${bin}:${was}`;
    try {
      expect(agentLines(join(root, "p.tsx")).all).toBe(true);
    } finally {
      process.env.PATH = was;
    }
  });

  // Only the attribute lookup fails here; every other git answer is real. A failed lookup must read as
  // "cannot say whose lines these are", never as "no line is the agent's".
  test("a git that fails only on its attribute lookup makes every line the agent's", () => {
    const root = tmp();
    writeFileSync(join(root, "p.tsx"), "one\ntwo\n");
    commitAll(root);
    writeFileSync(join(root, "p.tsx"), "one\nTWO\n");
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const bin = tmp();
    writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$*" in *check-attr*) exit 1;; esac\nexec '${realGit}' "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);
    const was = process.env.PATH;
    process.env.PATH = `${bin}:${was}`;
    try {
      expect(agentLines(join(root, "p.tsx")).all).toBe(true);
    } finally {
      process.env.PATH = was;
    }
  });

  // `-filter` unsets the attribute: no filter runs, so git's line numbers are the file's and the edit is exact.
  test("a file whose filter attribute is unset still gives exact lines", () => {
    const root = tmp();
    writeFileSync(join(root, ".gitattributes"), "*.tsx -filter\n");
    writeFileSync(join(root, "p.tsx"), "one\ntwo\nthree\n");
    commitAll(root);
    writeFileSync(join(root, "p.tsx"), "one\nTWO\nthree\n");
    const mine = agentLines(join(root, "p.tsx"));
    expect(mine.all).toBe(false);
    expect([...mine.lines]).toEqual([2]);
  });

  // A clean filter rewrites the file before git compares it, so git's line numbers are not the file's.
  test("a file with a clean filter makes every line the agent's", () => {
    const root = tmp();
    writeFileSync(join(root, ".gitattributes"), "*.tsx filter=strip\n");
    git(root, "init", "-q");
    git(root, "config", "filter.strip.clean", "grep -v SECRET || true");
    git(root, "config", "filter.strip.smudge", "cat");
    writeFileSync(join(root, "p.tsx"), "SECRET\n1\n2\n3\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "start");
    writeFileSync(join(root, "p.tsx"), "SECRET\n1\nTWO\n3\n");
    expect(agentLines(join(root, "p.tsx")).all).toBe(true);
  });

  // An outer git process (a test run from a hook) leaves GIT_DIR set, and it would point git at
  // another repository.
  test("GIT_DIR from an outer git process does not change the answer", () => {
    const root = tmp();
    writeFileSync(join(root, "p.tsx"), "one\ntwo\n");
    commitAll(root);
    writeFileSync(join(root, "p.tsx"), "one\nTWO\n");
    const other = tmp();
    writeFileSync(join(other, "x.tsx"), "x\n");
    commitAll(other);
    process.env.GIT_DIR = join(other, ".git");
    try {
      expect([...agentLines(join(root, "p.tsx")).lines]).toEqual([2]);
    } finally {
      delete process.env.GIT_DIR;
    }
  });
});
