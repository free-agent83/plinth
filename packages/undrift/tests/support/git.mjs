// sample/packages/undrift/tests/support/git.mjs
// A git repository for tests. The -c options keep a developer's own git config (signing, hooks, the
// default branch) out of the test: a commit that asks for a signing key would hang or fail.
import { execFileSync } from "node:child_process";

// GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE from an outer git process (a test run from a git hook)
// would point these commands at the outer repository. They are left out.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));

const QUIET = [
  "-c", "user.email=undrift@example.test", "-c", "user.name=undrift",
  "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "init.defaultBranch=main",
];

export const git = (root, ...args) =>
  execFileSync("git", [...QUIET, ...args], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Make `root` a repository and commit everything in it. */
export function commitAll(root) {
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "start");
}
