import { defineConfig } from "vitest/config";

// Six of this package's test files start a real `node` process (the CLI, the
// hook, triage), some several in a row. Locally each takes well under the 5s
// default; on a shared CI runner they do not, and they timed out one file at a
// time (hook.test.mjs, then gate-strict.test.mjs, 2026-09-18). The allowance is
// set once, for the package, so the next such test does not repeat it.
export default defineConfig({
  test: {
    // One temp folder for the whole run, removed at the end: see the file.
    globalSetup: ["./tests/support/own-temp-folder.mjs"],
    testTimeout: 30_000,
    // See the file: it keeps a worker that is blocked by child processes from starving
    // the runner's own messages, which ends a slow run with an unhandled error.
    setupFiles: ["./tests/support/yield-between-tests.mjs"],
  },
});
