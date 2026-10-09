// sample/packages/undrift/src/agent-lines.mjs
// Which lines of a file are the agent's: the ones `git diff HEAD` shows as added or changed. The hook
// judges only those, so an agent that edits one line of an old file is not made to fix what someone
// else wrote there (spec, section 4). The user's own uncommitted edits cannot be told apart and count
// too. Whenever git cannot answer (no repository, no commit yet, an untracked file, git missing or
// slow), every line counts: judging too much is what the hook did before, and judging too little
// would be silence.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";

/** The 1-based line numbers a `--unified=0` diff adds or changes in the new file. */
export function changedLines(diff) {
  const lines = new Set();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i++) lines.add(start + i);
  }
  return lines;
}

// GIT_DIR and friends from an outer git process would point git at another repository.
const env = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));

// --literal-pathspecs: a file called "[id].tsx" is that file, never a glob that matches "i.tsx".
const git = (cwd, args) =>
  execFileSync("git", ["--literal-pathspecs", ...args], {
    cwd, env: env(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000, maxBuffer: 1 << 26,
  });

// TypeScript breaks lines at these and git does not, so the two would number lines differently.
const ODD_BREAKS = /\r(?!\n)|[\u2028\u2029]/;

const OBJECT_NAME = /^[0-9a-f]{40,64}$/;

const every = (why) => ({ all: true, why });

/**
 * @param {string} file an absolute path, links resolved
 * @returns {{all: true, why: string} | {all: false, lines: Set<number>}}
 */
export function agentLines(file) {
  const cwd = dirname(file);
  const name = basename(file);
  try {
    git(cwd, ["ls-files", "--error-unmatch", "--", name]);
  } catch {
    return every("git does not track it");
  }
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return every("it could not be read");
  }
  if (ODD_BREAKS.test(source)) return every("it has line breaks git does not count");
  // A clean filter rewrites the file before git compares it, so git's line numbers are not the file's.
  try {
    const attr = git(cwd, ["check-attr", "-z", "filter", "--", name]).split("\0").filter(Boolean).pop();
    if (attr !== "unspecified" && attr !== "unset") return every("a git filter rewrites it before git compares it");
  } catch {
    return every("git could not read its attributes");
  }
  let diff;
  try {
    // --text and --no-textconv: a file marked binary, or given a text conversion, still diffs line by line.
    diff = git(cwd, ["diff", "HEAD", "--no-color", "--no-ext-diff", "--text", "--no-textconv", "--unified=0", "--", name]);
  } catch {
    return every("git could not compare it with the last commit");
  }
  // Decided by hunks, not lines: an edit that only deletes lines has hunks and adds no line, and no line
  // of what is left is the agent's.
  if (/^@@ /m.test(diff)) return { all: false, lines: changedLines(diff) };
  // No hunk means no change, or a change git's diff does not show (a file marked assume-unchanged or
  // skip-worktree). The contents decide: unchanged since the last commit, or every line is the agent's.
  try {
    const now = git(cwd, ["hash-object", "--", name]).trim();
    const then = git(cwd, ["rev-parse", `HEAD:./${name}`]).trim();
    // Two object names or nothing: a git that printed nothing must not read as "unchanged".
    if (OBJECT_NAME.test(now) && OBJECT_NAME.test(then) && now === then) return { all: false, lines: new Set() };
  } catch { /* not in the last commit: fall through */ }
  return every("git's diff does not show how it changed");
}
