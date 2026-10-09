// Most of this package's tests start a real `node` process and wait for it with
// execFileSync, which blocks the worker's whole event loop. A test file of a hundred
// of them can go for a minute without the loop turning once, and in that time the
// runner's own messages to the main process are not answered: vitest gives each such
// call sixty seconds, and a slow enough file ends the run with an "unhandled error"
// ("Timeout calling onTaskUpdate") although every test passed. The loop is given a turn
// before each test, so nothing waits for more than one test's worth of blocking.
import { beforeEach } from "vitest";

beforeEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
});
