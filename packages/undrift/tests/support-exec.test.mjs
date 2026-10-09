// The helper the CLI and hook tests run through. A child that could not start, or that was
// stopped from outside, is run once more; a child that ran and timed out or exited is never run
// again, because a second run can hide a hang that only sometimes happens and doubles whatever the
// first run did. What is left says which command and why, instead of `expected null to be 0`.
import { expect, test } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, exited, ranToExit, spawnSync } from "./support/exec.mjs";

const node = process.execPath;
const marker = () => join(mkdtempSync(join(tmpdir(), "u-exec-")), "runs");
const lines = (file) => readFileSync(file, "utf8").trim().split("\n");
// Appends a line to the marker file, so a test can count how many times a command ran.
const APPEND = `require("fs").appendFileSync(process.argv[1], "run\\n");`;
// Dies from a signal the first time it runs, as a child stopped from outside does, then exits 5.
const KILLED_ONCE = `
  const fs = require("fs"), m = process.argv[1] + ".killed";
  if (!fs.existsSync(m)) { fs.writeFileSync(m, "x"); process.kill(process.pid, "SIGKILL"); setTimeout(() => {}, 5000); }
  else { console.log("second"); process.exit(5); }
`;

test("a run that exits with a code is thrown as it is, its code read, and it ran exactly once", () => {
  const file = marker();
  try {
    execFileSync(node, ["-e", `${APPEND} process.exit(3)`, file], { encoding: "utf8", stdio: "pipe" });
    expect.unreachable("it should have thrown");
  } catch (e) {
    expect(exited(e)).toBe(3);
  }
  expect(lines(file)).toEqual(["run"]);
});

test("a child stopped by a signal from outside is run once more, and the second run's result stands", () => {
  const file = marker();
  let out = "";
  try {
    execFileSync(node, ["-e", KILLED_ONCE, file], { encoding: "utf8", stdio: "pipe" });
    expect.unreachable("the second run exits 5");
  } catch (e) {
    expect(exited(e)).toBe(5);
    out = e.stdout;
  }
  expect(out).toBe("second\n");
});

test("a child that timed out is not run again, and the Error names the command and the cause", () => {
  const file = marker();
  try {
    execFileSync(node, ["-e", `${APPEND} setTimeout(() => {}, 60000)`, file, "the-argument"], { encoding: "utf8", stdio: "pipe", timeout: 400 });
    expect.unreachable("it should have thrown");
  } catch (e) {
    expect(() => exited(e)).toThrow(/did not run to an exit \(ETIMEDOUT\): .*the-argument/);
  }
  expect(lines(file)).toEqual(["run"]);
});

test("spawnSync: an exit code is returned as it is, and the child ran once", () => {
  const file = marker();
  expect(spawnSync(node, ["-e", `${APPEND} process.exit(4)`, file], { stdio: "pipe" }).status).toBe(4);
  expect(lines(file)).toEqual(["run"]);
});

test("spawnSync: a child stopped from outside is run once more, and the second run's result is the one returned", () => {
  const file = marker();
  const r = spawnSync(node, ["-e", KILLED_ONCE, file], { encoding: "utf8", stdio: "pipe" });
  expect(r.status).toBe(5);
  expect(r.stdout).toBe("second\n");
});

test("spawnSync: a child that timed out is not run again, and the Error names it", () => {
  const file = marker();
  expect(() => spawnSync(node, ["-e", `${APPEND} setTimeout(() => {}, 60000)`, file, "the-argument"], { stdio: "pipe", timeout: 400 })).toThrow(
    /did not run to an exit \(ETIMEDOUT\): .*the-argument/
  );
  expect(lines(file)).toEqual(["run"]);
});

test("ranToExit passes a result that has an exit code, and names one that has none", () => {
  const r = { status: 0, error: undefined, signal: null };
  expect(ranToExit(r, node, ["a"])).toBe(r);
  expect(() => ranToExit({ status: null, signal: "SIGKILL" }, node, ["a", "b"])).toThrow(/did not run to an exit \(SIGKILL\): .* a b/);
});
