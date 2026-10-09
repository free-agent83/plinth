// The suite's own temp folder (tests/support/own-temp-folder.mjs) is removed when a run ends. A run that is
// interrupted (Ctrl-C, a timeout) never gets to do that, so the next run clears what it left, and only what it left:
// another run may be going at the same time, and the sweep must never reach anything that is not the suite's own
// (a mutation of it once swept a real system temp folder). Some fixtures are made unreadable on purpose, and those
// must not stop the removal.
//
// Every test works in its own `base`, standing in for the system's temp folder, with the runs folder inside it.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  MARKER_FILE,
  MAX_AGE_MS,
  PID_FILE,
  RUNS_FOLDER,
  removeFolder,
  runsParent,
  sweepStale,
} from "./support/own-temp-folder.mjs";
import setup from "./support/own-temp-folder.mjs";

let base;
let parent;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "u-own-temp-"));
  parent = runsParent(base);
  mkdirSync(parent);
});
afterEach(() => {
  try { removeFolder(base); } catch { /* the test under test failed to remove it: nothing more to do */ }
});

/** A pid that belonged to a process that has since exited. */
const deadPid = () => spawnSync(process.execPath, ["-e", "0"]).pid;

const hoursAgo = (hours) => new Date(Date.now() - hours * 3600 * 1000);

/**
 * A run folder `name` in `where`, owned by `pid` (or by nobody), holding a file and a subfolder at mode 000. It
 * carries the marker unless `marker` is false, and the folder was last touched `age` hours ago.
 */
function runFolder(name, { pid, marker = true, age = 0, where = parent } = {}) {
  const dir = join(where, name);
  mkdirSync(join(dir, "locked", "inner"), { recursive: true });
  writeFileSync(join(dir, "locked", "inner", "f.txt"), "x");
  if (pid !== undefined) writeFileSync(join(dir, PID_FILE), String(pid));
  if (marker) {
    writeFileSync(join(dir, MARKER_FILE), "x");
  }
  if (age) utimesSync(dir, hoursAgo(age), hoursAgo(age));
  chmodSync(join(dir, "locked"), 0o000);
  return dir;
}

test("a folder whose subfolders are unreadable is removed", () => {
  const dir = runFolder("undrift-run-aaaaaa", { pid: process.pid });
  removeFolder(dir);
  expect(existsSync(dir)).toBe(false);
});

test("removing a folder that is not there does not throw", () => {
  expect(() => removeFolder(join(parent, "undrift-run-missing"))).not.toThrow();
});

test("a stale run folder, whose process has gone, is removed", () => {
  const stale = runFolder("undrift-run-bbbbbb", { pid: deadPid() });
  sweepStale(parent);
  expect(existsSync(stale)).toBe(false);
});

test("a run folder whose process is alive is kept", () => {
  const live = runFolder("undrift-run-cccccc", { pid: process.pid });
  sweepStale(parent);
  expect(existsSync(live)).toBe(true);
  chmodSync(join(live, "locked"), 0o700);
});

test("a run folder owned by a process of another user (init, pid 1) is kept: it exists", () => {
  const live = runFolder("undrift-run-gggggg", { pid: 1 });
  sweepStale(parent);
  expect(existsSync(live)).toBe(true);
  chmodSync(join(live, "locked"), 0o700);
});

test("a run folder with no pid file is kept while it is young and removed when it is old", () => {
  const young = runFolder("undrift-run-dddddd");
  const old = runFolder("undrift-run-eeeeee", { age: 48 });
  sweepStale(parent);
  expect(existsSync(young)).toBe(true);
  expect(existsSync(old)).toBe(false);
  chmodSync(join(young, "locked"), 0o700);
});

test("only folders of the suite's own are swept", () => {
  const other = join(parent, "u-something-else");
  mkdirSync(other);
  writeFileSync(join(other, PID_FILE), String(deadPid()));
  writeFileSync(join(other, MARKER_FILE), "x");
  const notAFolder = join(parent, "undrift-run-file");
  writeFileSync(notAFolder, "x");
  sweepStale(parent);
  expect(existsSync(other)).toBe(true);
  expect(existsSync(notAFolder)).toBe(true);
});

test("an unreadable pid file is not a dead process", () => {
  const dir = join(parent, "undrift-run-ffffff");
  mkdirSync(dir);
  writeFileSync(join(dir, PID_FILE), "not a number");
  writeFileSync(join(dir, MARKER_FILE), "x");
  sweepStale(parent);
  expect(existsSync(dir)).toBe(true);
});

test("sweeping a folder that is not there does not throw", () => {
  expect(() => sweepStale(join(base, "nothing-here"))).not.toThrow();
});

test("the sweep never removes anything outside the runs folder, however stale it looks", () => {
  // A folder beside the runs folder, named and marked like a run folder, with a dead pid and an old date: the
  // sweep that is handed the runs folder must not look one level up.
  const decoy = runFolder("undrift-run-decoy1", { pid: deadPid(), age: 72, where: base });
  const stale = runFolder("undrift-run-inside", { pid: deadPid() });
  sweepStale(parent);
  expect(existsSync(stale)).toBe(false);
  expect(existsSync(decoy)).toBe(true);
  chmodSync(join(decoy, "locked"), 0o700);
});

test("a folder without the marker is never removed, even with a dead pid and an old date", () => {
  const unmarked = runFolder("undrift-run-nomark", { pid: deadPid(), marker: false });
  const old = join(unmarked, "..", "undrift-run-nomark2");
  mkdirSync(old);
  writeFileSync(join(old, PID_FILE), String(deadPid()));
  utimesSync(old, hoursAgo(72), hoursAgo(72));
  sweepStale(parent);
  expect(existsSync(unmarked)).toBe(true);
  expect(existsSync(old)).toBe(true);
  chmodSync(join(unmarked, "locked"), 0o700);
});

test("a marker that is a folder or a link is not the suite's marker", () => {
  const asFolder = join(parent, "undrift-run-markdir");
  mkdirSync(join(asFolder, MARKER_FILE), { recursive: true });
  writeFileSync(join(asFolder, PID_FILE), String(deadPid()));
  const asLink = join(parent, "undrift-run-marklink");
  mkdirSync(asLink);
  writeFileSync(join(base, "target"), "x");
  symlinkSync(join(base, "target"), join(asLink, MARKER_FILE));
  writeFileSync(join(asLink, PID_FILE), String(deadPid()));
  sweepStale(parent);
  expect(existsSync(asFolder)).toBe(true);
  expect(existsSync(asLink)).toBe(true);
});

test("a run older than a day is removed even when its pid is alive (a reused pid)", () => {
  const reused = runFolder("undrift-run-reused", { pid: process.pid, age: MAX_AGE_MS / 3600000 + 1 });
  const recent = runFolder("undrift-run-recent", { pid: process.pid, age: MAX_AGE_MS / 3600000 - 1 });
  sweepStale(parent);
  expect(existsSync(reused)).toBe(false);
  expect(existsSync(recent)).toBe(true);
  chmodSync(join(recent, "locked"), 0o700);
});

test("a run folder is made in the runs folder, marked, and removed again when the run ends", () => {
  const before = process.env.TMPDIR;
  process.env.TMPDIR = base;
  let teardown;
  try {
    teardown = setup();
    const own = process.env.TMPDIR;
    expect(own.startsWith(join(base, RUNS_FOLDER) + "/undrift-run-")).toBe(true);
    expect(existsSync(join(own, MARKER_FILE))).toBe(true);
    expect(readdirSync(parent)).toHaveLength(1);
    teardown();
    expect(process.env.TMPDIR).toBe(base);
    expect(readdirSync(parent)).toHaveLength(0);
  } finally {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
  }
});

test("the setup of a run sweeps the runs folder and nothing beside it", () => {
  const stale = runFolder("undrift-run-lefta1", { pid: deadPid() });
  const decoy = runFolder("undrift-run-decoy2", { pid: deadPid(), age: 72, where: base });
  const before = process.env.TMPDIR;
  process.env.TMPDIR = base;
  try {
    const teardown = setup();
    teardown();
  } finally {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
  }
  expect(existsSync(stale)).toBe(false);
  expect(existsSync(decoy)).toBe(true);
  chmodSync(join(decoy, "locked"), 0o700);
});

// The runs folder is read as a folder and never through a link: a link there could lead anywhere, and the sweep removes
// what it finds.
test("a runs folder that is a link is not swept, whatever it leads to", () => {
  const elsewhere = join(base, "elsewhere");
  mkdirSync(elsewhere);
  const stale = runFolder("undrift-run-linked", { pid: deadPid(), where: elsewhere });
  const linked = join(base, "linked-runs");
  symlinkSync(elsewhere, linked);
  sweepStale(linked);
  expect(existsSync(stale)).toBe(true);
  // The same folder, reached as itself, is swept: it was the link that kept it.
  sweepStale(elsewhere);
  expect(existsSync(stale)).toBe(false);
});

test("a runs folder that is a file stops the setup with a message that names it", () => {
  rmSync(parent, { recursive: true });
  writeFileSync(parent, "not a folder");
  const before = process.env.TMPDIR;
  process.env.TMPDIR = base;
  try {
    expect(() => setup()).toThrow(parent);
    expect(() => setup()).toThrow(/not a folder/);
    expect(() => setup()).not.toThrow(/EEXIST/);
  } finally {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
  }
});

// Only a file where the runs folder goes gets the message about a file. Any other reason it cannot be made (here, a file
// where the folder above it goes: ENOTDIR) is not that, and is thrown as it is, with its own code, so that the message
// never names a cause that is not the cause.
test("a runs folder that cannot be made for another reason is thrown as it is", () => {
  const file = join(base, "a-file");
  writeFileSync(file, "not a folder");
  const before = process.env.TMPDIR;
  process.env.TMPDIR = file;
  try {
    let thrown;
    try { setup(); } catch (error) { thrown = error; }
    expect(thrown, "the setup threw nothing").toBeDefined();
    expect(thrown.code).toBe("ENOTDIR");
    expect(thrown.message).not.toMatch(/not a folder/);
  } finally {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
  }
});
