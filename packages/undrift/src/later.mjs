// sample/packages/undrift/src/later.mjs
// The later list: problems a person chose to fix later rather than now (spec, section 4). It is
// committed, so the team sees it. The gate lists what it defers and never fails on it, and never calls
// it clean either. Only a person defers: the agent writes an entry only after the person says "Later".
// An entry names the file, the rule and the value, never the line, so moving code keeps it; `count`
// says how many occurrences it covers, so a new one is still a problem.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { ALL_RULES } from "./gate.mjs";

export const LATER_FILE = "undrift.later.json";

const outside = (rel) => rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

/**
 * A path as the later list names it: relative to the config's folder, with forward slashes. A path that
 * names the folder by its real name, when the folder is reached through a link (a temporary folder on a
 * Mac, a checkout behind a link), looks outside it, so one that is outside by name is tried by real names.
 */
export function relFor(contract, abs) {
  const plain = relative(contract.root, abs);
  let rel = plain;
  if (outside(plain)) {
    try {
      const real = relative(realpathSync(contract.root), realpathSync(abs));
      if (!outside(real)) rel = real;
    } catch { /* a path that is not there is outside it by name */ }
  }
  return rel.split(sep).join("/");
}

const key = (file, rule, value) => JSON.stringify([file, rule, value]);

/**
 * One problem as one thing to read: its file as the list names it, its place, its rule and its value.
 * Two profiles that cover a file each find the same problem, and they have the same id.
 */
export const problemId = (v, relOf) => JSON.stringify([relOf(v), v.line, v.column, v.rule, v.found]);

/** A real calendar day written YYYY-MM-DD. */
const isDay = (d) => {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const at = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === d;
};

/** Is this a whole entry? The one check, for the entries read from the file and the ones about to be written. */
const isEntry = (e) =>
  typeof e?.file === "string" && ALL_RULES.includes(e.rule) && typeof e.value === "string" &&
  Number.isInteger(e.count) && e.count >= 1 && isDay(e.date) &&
  (e.reason === undefined || typeof e.reason === "string");

const NEEDS = `needs a file, one of today's rules (${ALL_RULES.join(", ")}), a value, a whole count of 1 or more, and a date as YYYY-MM-DD`;

/**
 * The later list cannot be used. The reason and the fix are kept apart from the file's name, so a caller
 * can build its own sentence round them (the hook does), and `message` puts them together for one that
 * prints it as it is (the gate does). Neither part ends in a full stop.
 */
export class LaterListError extends Error {
  constructor(reason, fix) {
    super(`${LATER_FILE}: ${reason}. ${fix}`);
    this.name = "LaterListError";
    this.reason = reason;
    this.fix = fix;
  }
}

const REPAIR = "Repair it, or delete it to bring back every problem it defers.";

/** Order by UTF-16 code unit, which is the order of plain `<`: the same list on every machine, whatever its locale. */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The entries in `root`'s later list, or none. A list that cannot be read is an error, never "nothing deferred". */
export function loadLater(root) {
  const path = join(root, LATER_FILE);
  if (!existsSync(path)) return [];
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new LaterListError(`it could not be read (${err.message})`, REPAIR);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new LaterListError(`it is not valid JSON (${err.message})`, REPAIR);
  }
  if (!data || data.version !== 1 || !Array.isArray(data.entries)) {
    throw new LaterListError('it must be { "version": 1, "entries": [ … ] }', REPAIR);
  }
  const seen = new Map();
  data.entries.forEach((e, i) => {
    if (!isEntry(e)) throw new LaterListError(`entry ${i + 1} ${NEEDS}`, REPAIR);
    const k = key(e.file, e.rule, e.value);
    if (seen.has(k)) {
      throw new LaterListError(
        `entries ${seen.get(k) + 1} and ${i + 1} are both for ${e.rule} ${JSON.stringify(e.value)} in ${e.file}`,
        "Merge them into one entry, adding their counts.",
      );
    }
    seen.set(k, i);
  });
  return data.entries;
}

/**
 * Split violations into those the list defers and the rest. `relOf(v)` names a violation's file as the
 * list does. Each entry defers up to `count` occurrences, the earliest lines first. Only the gate's
 * rules can be deferred, the opt-in ones included; a gap cannot. A file two profiles cover is judged by each, and each run meets, and defers, its
 * own copy of a problem, so every run starts from nothing.
 * @returns {{deferred: object[], remaining: object[], usedCounts: Map<number, number>}}
 *   each deferred violation carries its entry as `later`; `usedCounts` is how many occurrences each entry
 *   (by index) deferred
 */
export function applyLater(entries, violations, relOf) {
  const slots = new Map(entries.map((e, i) => [key(e.file, e.rule, e.value), { i, left: e.count }]));
  const used = new Map();
  const deferredSet = new Set();
  const deferred = [];
  const earliestFirst = [...violations].sort((a, b) => a.line - b.line || a.column - b.column);
  for (const v of earliestFirst) {
    if (!ALL_RULES.includes(v.rule)) continue;
    const slot = slots.get(key(relOf(v), v.rule, v.found));
    if (!slot || slot.left <= 0) continue;
    slot.left -= 1;
    used.set(slot.i, (used.get(slot.i) ?? 0) + 1);
    deferredSet.add(v);
    deferred.push({ ...v, later: entries[slot.i] });
  }
  return { deferred, remaining: violations.filter((v) => !deferredSet.has(v)), usedCounts: used };
}

/**
 * Which of `candidates` still need an entry. An entry is a file, a rule, a value and a count, so which line
 * is "the deferred one" does not matter, only how many. For each key among the candidates, `pool` is every
 * older occurrence of it (in a file, the file's older problems; for the whole repository, the candidates
 * themselves). The entry's count is taken off the pool, and what is left is how many are not yet deferred:
 * that many of the candidates are returned, and no more, so a value that is in a file twice can be deferred
 * a line at a time, in either order, until the count covers both.
 */
export function notYetDeferred(entries, candidates, pool, relOf) {
  const covered = new Map(entries.map((e) => [key(e.file, e.rule, e.value), e.count]));
  const keyOf = (v) => key(relOf(v), v.rule, v.found);
  const inPool = new Map();
  for (const v of pool) inPool.set(keyOf(v), (inPool.get(keyOf(v)) ?? 0) + 1);
  // The candidates are occurrences too: whatever the pool says, there are at least as many as are asked for.
  const asked = new Map();
  for (const v of candidates) asked.set(keyOf(v), (asked.get(keyOf(v)) ?? 0) + 1);
  for (const [k, n] of asked) inPool.set(k, Math.max(inPool.get(k) ?? 0, n));
  const taken = new Map();
  const out = [];
  for (const v of candidates) {
    const k = keyOf(v);
    const left = Math.max(0, (inPool.get(k) ?? 0) - (covered.get(k) ?? 0));
    if ((taken.get(k) ?? 0) >= left) continue;
    taken.set(k, (taken.get(k) ?? 0) + 1);
    out.push(v);
  }
  return out;
}

/** Entries for these violations: one per file, rule and value, counted. */
export function entriesFor(violations, relOf, { reason, date }) {
  const byKey = new Map();
  for (const v of violations) {
    const file = relOf(v);
    const k = key(file, v.rule, v.found);
    const e = byKey.get(k) ?? { file, rule: v.rule, value: v.found, count: 0, ...(reason ? { reason } : {}), date };
    e.count += 1;
    byKey.set(k, e);
  }
  return [...byKey.values()];
}

const WAIT_MS = 8000; // how long a write waits for another that holds the lock
const STALE_MS = 5000; // a lock older than this belongs to a process that was killed: a write takes milliseconds
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Run `fn` holding a lock on `root`'s list: a folder beside it, made with mkdirSync, which is atomic, so
 * exactly one process holds it. Several `later` commands at once (an agent running them in parallel) each
 * read the list, add to it and rename it into place, and without this the last to finish kept only its own.
 * A lock that cannot be had in time is an error, never a write that goes ahead without it: a deferral that
 * was not written must not be reported.
 */
function withLock(root, fn, { waitMs = WAIT_MS, staleMs = STALE_MS } = {}) {
  const lock = join(root, `${LATER_FILE}.lock`);
  const owner = join(lock, "owner");
  const token = randomBytes(16).toString("hex");
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (err) {
      if (err?.code !== "EEXIST") throw new Error(`${LATER_FILE}: could not take the write lock (${err.message}).`);
      let age;
      try { age = Date.now() - statSync(lock).mtimeMs; } catch { continue; /* released: try again */ }
      if (age > staleMs) {
        try { rmSync(lock, { recursive: true, force: true }); } catch { /* another process cleared it */ }
      } else if (Date.now() >= until) {
        throw new Error(`another undrift later is writing ${LATER_FILE}, and did not finish in ${Math.round(waitMs / 1000)}s. Nothing was written. Run it again; if it keeps happening, delete the folder ${lock}.`);
      } else {
        pause(5 + Math.floor(Math.random() * 10));
      }
    }
  }
  // The lock carries its holder's token. A holder paused for longer than the stale cutoff has its lock
  // cleared and taken by another, and must neither write over that process nor remove its lock.
  const holds = () => {
    try { return readFileSync(owner, "utf8") === token; } catch { return false; }
  };
  try {
    writeFileSync(owner, token);
    return fn(holds);
  } finally {
    if (holds()) {
      try { rmSync(lock, { recursive: true, force: true }); } catch { /* already gone */ }
    }
  }
}

/**
 * Read `root`'s list under the lock, ask `build(entries)` for the additions, merge their counts into
 * entries that exist, sort, and write. No additions writes nothing.
 * @returns {{additions: object[], written: object[]}} `written` is the whole list as it now stands
 */
export function updateLater(root, build, options) {
  return withLock(root, (holds) => {
    const current = loadLater(root);
    const additions = build(current.map((e) => ({ ...e })));
    additions.forEach((a, i) => {
      if (!isEntry(a)) throw new Error(`${LATER_FILE}: addition ${i + 1} ${NEEDS}.`);
    });
    if (additions.length === 0) return { additions, written: current };
    const lost = () => new Error(`lost the lock on ${LATER_FILE} to another process. Nothing was written. Run it again.`);
    const entries = current.map((e) => ({ ...e }));
    for (const a of additions) {
      const same = entries.find((e) => e.file === a.file && e.rule === a.rule && e.value === a.value);
      if (same) {
        same.count += a.count;
        same.date = a.date;
        if (a.reason) same.reason = a.reason;
      } else {
        entries.push({ ...a });
      }
    }
    entries.sort((x, y) => byCodeUnit(x.file, y.file) || byCodeUnit(x.rule, y.rule) || byCodeUnit(x.value, y.value));
    const written = entries.map(({ file, rule, value, count, reason, date }) =>
      reason ? { file, rule, value, count, reason, date } : { file, rule, value, count, date });
    const path = join(root, LATER_FILE);
    // The temporary file is written inside the lock folder, which is in the list's own folder and so on
    // its filesystem, and renamed out of it. A process killed between the two leaves it in the lock, which
    // the next write clears with the stale lock, and never in the repository where `git status` shows it.
    const tmp = join(root, `${LATER_FILE}.lock`, `${process.pid}.tmp`);
    try {
      writeFileSync(tmp, `${JSON.stringify({ version: 1, entries: written }, null, 2)}\n`);
    } catch (err) {
      // The lock folder is gone: it was judged stale and cleared by another process.
      if (err?.code === "ENOENT") throw lost();
      throw err;
    }
    if (!holds()) {
      rmSync(tmp, { force: true });
      throw lost();
    }
    renameSync(tmp, path);
    return { additions, written };
  }, options);
}
