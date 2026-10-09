// Most tests here block the worker on a child process, so the worker's event loop can go
// for a very long time without turning, and the runner's own messages to the main process
// go unanswered until it does: a slow file then ends the run with an unhandled "Timeout
// calling onTaskUpdate" though every test passed (seen on a loaded machine, and it took
// the whole run to show). The setup file gives the loop a turn before each test. The
// first test hands the loop some work and returns without waiting for it. Nothing but
// that turn can have run it by the time the second test starts.
import { expect, test } from "vitest";

let turned = false;

test("the first test queues work for the event loop and does not wait for it", () => {
  setImmediate(() => {
    turned = true;
  });
});

test("the event loop has turned since the test before it", () => {
  expect(turned).toBe(true);
});
