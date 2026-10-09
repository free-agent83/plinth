// Seventy-odd test files build their fixtures with mkdtempSync(join(tmpdir(), "u-...")) and most never remove them:
// a full run left about two thousand folders in the system's temp folder, and the pile (199,000 folders, 24 GB)
// filled the disk until the suite itself failed with ENOSPC (2026-10-06). Rather than a cleanup in every file, the
// whole run gets one folder of its own. os.tmpdir() reads TMPDIR each time it is called, so setting it here, before
// any worker starts, points every fixture (in a worker, and in every `node` process a test spawns) inside it. It is
// removed when the run ends, and the previous TMPDIR is put back.
//
// A run that is interrupted (Ctrl-C, a timeout) never reaches that teardown and leaves its folder behind. One run
// can leave tens of thousands of files (the fixtures of every test file that had started, some of them subfolders made
// unreadable on purpose, which a plain recursive rmSync cannot remove). So the next run's setup sweeps.
//
// The sweep is built to be unable to touch anything that is not the suite's own. It has three limits, and each holds
// without the others (a deletion once swept a system temp folder, in a review mutation, and removed other programs'
// data):
//   1. Every run folder lives in one dedicated parent, `<os.tmpdir()>/undrift-runs/`. The sweep reads only that
//      parent. It never lists os.tmpdir() itself.
//   2. A folder is removed only if it carries the marker file (MARKER_FILE) the suite writes into it, even inside the
//      parent. A folder that is not marked is not ours.
//   3. A folder whose run is gone is removed, and one whose run may still be going is left, because two runs can
//      overlap legitimately. But a process id is reused, so a run older than MAX_AGE_MS is removed whether or not
//      its pid is alive: no run lasts that long.
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PID_FILE = ".owner-pid";
export const MARKER_FILE = ".undrift-run";
export const RUNS_FOLDER = "undrift-runs";
const PREFIX = "undrift-run-";
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The one folder every run folder is made in, under `base` (the system's temp folder unless a test says otherwise). */
export function runsParent(base = tmpdir()) {
  return join(base, RUNS_FOLDER);
}

/** Remove `path` and everything under it, making unreadable and unwritable folders usable first. Never throws. */
export function removeFolder(path) {
  try {
    const walk = (p) => {
      const stat = lstatSync(p);
      if (!stat.isDirectory()) return;
      chmodSync(p, 0o700);
      for (const name of readdirSync(p)) walk(join(p, name));
    };
    walk(path);
  } catch { /* gone already, or not ours to change: the removal below says what is left */ }
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3 });
  } catch { /* what is left is the next run's to sweep */ }
}

/** Is the process `pid` running? A process of another user exists, and is not dead. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

/** Is `dir` marked as a run folder of the suite's own? The marker must be a plain file, not a link. */
function marked(dir) {
  try {
    return lstatSync(join(dir, MARKER_FILE)).isFile();
  } catch {
    return false;
  }
}

/**
 * Remove the run folders in `parent` (the runs folder, never the system temp folder) whose run has ended or is
 * older than MAX_AGE_MS. A folder with no marker is never removed. A run that may still be going is left.
 */
export function sweepStale(parent) {
  let names;
  try {
    if (!lstatSync(parent).isDirectory()) return;
    names = readdirSync(parent);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue;
    const dir = join(parent, name);
    try {
      if (!lstatSync(dir).isDirectory()) continue;
      if (!marked(dir)) continue;
      const tooOld = Date.now() - lstatSync(dir).mtimeMs > MAX_AGE_MS;
      let pid = NaN;
      try {
        pid = Number.parseInt(readFileSync(join(dir, PID_FILE), "utf8"), 10);
      } catch { /* no pid file: only its age can say it is stale */ }
      const gone = Number.isInteger(pid) && pid > 0 && !alive(pid);
      if (gone || tooOld) removeFolder(dir);
    } catch { /* it went while we looked: nothing to do */ }
  }
}

export default function setup() {
  const before = process.env.TMPDIR;
  const parent = runsParent();
  try {
    mkdirSync(parent, { recursive: true });
  } catch (error) {
    // Something that is not a folder is where the runs folder goes (a file left by another program): say where.
    if (error.code !== "EEXIST") throw error;
    throw new Error(
      `The test run cannot make its temp folder: ${parent} exists and is not a folder. ` +
      "Move it or remove it. The suite makes that folder itself and keeps only its own run folders in it."
    );
  }
  sweepStale(parent);
  const own = mkdtempSync(join(parent, PREFIX));
  writeFileSync(join(own, MARKER_FILE), "undrift test run folder\n");
  writeFileSync(join(own, PID_FILE), String(process.pid));
  process.env.TMPDIR = own;
  return () => {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    removeFolder(own);
  };
}
