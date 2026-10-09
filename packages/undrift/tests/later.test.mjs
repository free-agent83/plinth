// sample/packages/undrift/tests/later.test.mjs
import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, symlinkSync, realpathSync, utimesSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLater, applyLater, notYetDeferred, entriesFor, updateLater, relFor, problemId, LATER_FILE } from "../src/later.mjs";

// What the tests write through, as the command does: the additions are known before the list is read.
const addLater = (root, additions, options) => updateLater(root, () => additions, options).written;

const tmp = () => mkdtempSync(join(tmpdir(), "u-later-"));
const v = (line, found, rule = "no-raw-colors") => ({ rule, line, column: 1, found, message: "m", file: "/r/app/p.tsx" });
const rel = () => "app/p.tsx";
const entry = (over = {}) => ({ file: "app/p.tsx", rule: "no-raw-colors", value: "#333", count: 1, date: "2026-09-30", ...over });

describe("loadLater", () => {
  test("no file is an empty list", () => {
    expect(loadLater(tmp())).toEqual([]);
  });

  test("a file that is not JSON is an error that names the file", () => {
    const root = tmp();
    writeFileSync(join(root, LATER_FILE), "{");
    expect(() => loadLater(root)).toThrow(/undrift\.later\.json/);
  });

  // The hook builds its own sentence around the reason, so the reason must not carry the file's name
  // or the fix: they are kept apart, and the message that the gate prints puts them back together.
  test("an error carries its reason and its fix apart from the file's name", () => {
    const root = tmp();
    writeFileSync(join(root, LATER_FILE), "{");
    let error;
    try { loadLater(root); } catch (e) { error = e; }
    expect(error.reason).toMatch(/^it is not valid JSON \(.+\)$/);
    expect(error.fix).toBe("Repair it, or delete it to bring back every problem it defers.");
    expect(error.message).toBe(`${LATER_FILE}: ${error.reason}. ${error.fix}`);
  });

  test("a list that cannot be read is not called invalid JSON", () => {
    const root = tmp();
    mkdirSync(join(root, LATER_FILE)); // a folder where the file should be
    let error;
    try { loadLater(root); } catch (e) { error = e; }
    expect(error.reason).toMatch(/^it could not be read \(/);
  });

  test("every refusal carries a reason that does not start with the file's name", () => {
    for (const data of [{ version: 2, entries: [] }, { version: 1, entries: [entry({ count: 0 })] }, { version: 1, entries: [entry(), entry()] }]) {
      const root = tmp();
      writeFileSync(join(root, LATER_FILE), JSON.stringify(data));
      let error;
      try { loadLater(root); } catch (e) { error = e; }
      expect(error.reason).not.toContain(LATER_FILE);
      expect(error.fix).toMatch(/\.$/);
      expect(error.message).toBe(`${LATER_FILE}: ${error.reason}. ${error.fix}`);
    }
  });

  test("an entry without a whole count, or for a rule that does not exist, is an error", () => {
    const root = tmp();
    writeFileSync(join(root, LATER_FILE), JSON.stringify({ version: 1, entries: [entry({ count: 0 })] }));
    expect(() => loadLater(root)).toThrow(/entry 1/);
    writeFileSync(join(root, LATER_FILE), JSON.stringify({ version: 1, entries: [entry({ rule: "invalid-gap" })] }));
    expect(() => loadLater(root)).toThrow(/entry 1/);
  });
});

describe("loadLater checks every part of an entry", () => {
  const load = (data) => {
    const root = tmp();
    writeFileSync(join(root, LATER_FILE), JSON.stringify(data));
    return () => loadLater(root);
  };
  const without = (field) => {
    const e = entry();
    delete e[field];
    return e;
  };

  test("a count that is not a whole number is refused", () => {
    expect(load({ version: 1, entries: [entry({ count: 1.5 })] })).toThrow(/entry 1/);
  });

  test.each(["file", "value", "date", "rule", "count"])("an entry without its %s is refused", (field) => {
    expect(load({ version: 1, entries: [without(field)] })).toThrow(/entry 1/);
  });

  test.each(["", "d", "2026-9-30", "2026-13-45", "2026-02-30", "2026-09-30T10:00:00Z", 20260930])("a date that is not a real YYYY-MM-DD, %j, is refused", (date) => {
    expect(load({ version: 1, entries: [entry({ date })] })).toThrow(/entry 1 .*a date as YYYY-MM-DD/);
  });

  test("a reason that is not text is refused, and a missing reason is fine", () => {
    expect(load({ version: 1, entries: [entry({ reason: 5 })] })).toThrow(/entry 1/);
    expect(load({ version: 1, entries: [entry()] })()).toEqual([entry()]);
  });

  test("the wrong version, or no entries array, is refused", () => {
    expect(load({ version: 2, entries: [] })).toThrow(/"version": 1/);
    expect(load({ entries: [] })).toThrow(/"version": 1/);
    expect(load({ version: 1 })).toThrow(/"version": 1/);
  });

  test("two entries for the same file, rule and value are refused, naming both", () => {
    expect(load({ version: 1, entries: [entry(), entry({ file: "b.tsx" }), entry({ count: 2 })] })).toThrow(/entries 1 and 3/);
  });
});

describe("problemId", () => {
  const relOf = (x) => x.file.replace("/r/", "");
  test("the same problem found twice, once by each profile that covers its file, has one id; any difference makes another", () => {
    const a = { ...v(3, "#333"), file: "/r/app/p.tsx" };
    expect(problemId({ ...a }, relOf)).toBe(problemId({ ...a, message: "from the other profile" }, relOf));
    for (const other of [{ line: 4 }, { column: 2 }, { rule: "no-arbitrary-values" }, { found: "#444" }, { file: "/r/app/q.tsx" }]) {
      expect(problemId({ ...a, ...other }, relOf)).not.toBe(problemId(a, relOf));
    }
  });
});

describe("applyLater", () => {
  test("an entry defers up to its count, the earliest lines first, and no more", () => {
    const later = [entry({ count: 1 })];
    const { deferred, remaining, usedCounts } = applyLater(later, [v(9, "#333"), v(3, "#333")], rel);
    expect(deferred.map((d) => d.line)).toEqual([3]);
    expect(deferred[0].later).toEqual(later[0]);
    expect(remaining.map((r) => r.line)).toEqual([9]);
    expect([...usedCounts]).toEqual([[0, 1]]);
  });

  test("a different value, rule or file is not deferred", () => {
    const later = [entry()];
    const { deferred } = applyLater(later, [v(1, "#444"), v(2, "#333", "no-arbitrary-values")], rel);
    expect(deferred).toEqual([]);
    expect(applyLater(later, [v(1, "#333")], () => "app/other.tsx").deferred).toEqual([]);
  });

  test("remaining keeps the order it was given", () => {
    const { remaining } = applyLater([], [v(9, "#a"), v(3, "#b")], rel);
    expect(remaining.map((r) => r.line)).toEqual([9, 3]);
  });

  test("a gap rule is never deferred, whatever the list says", () => {
    const { deferred } = applyLater([entry({ rule: "invalid-gap", value: "X" })], [v(1, "X", "invalid-gap")], rel);
    expect(deferred).toEqual([]);
  });
});

describe("entriesFor and addLater", () => {
  test("addLater sorts by code point, not by the locale's order", () => {
    const root = tmp();
    addLater(root, [entry({ file: "a.tsx" }), entry({ file: "B.tsx" }), entry({ file: "é.tsx" }), entry({ file: "z.tsx" })]);
    expect(JSON.parse(readFileSync(join(root, LATER_FILE), "utf8")).entries.map((e) => e.file)).toEqual(["B.tsx", "a.tsx", "z.tsx", "é.tsx"]);
  });

  test("addLater orders entries within one file by rule, then by value", () => {
    const root = tmp();
    addLater(root, [
      entry({ rule: "no-raw-colors", value: "#444" }),
      entry({ rule: "no-raw-colors", value: "#333" }),
      entry({ rule: "no-arbitrary-values", value: "[#999]" }),
    ]);
    expect(JSON.parse(readFileSync(join(root, LATER_FILE), "utf8")).entries.map((e) => [e.rule, e.value])).toEqual([
      ["no-arbitrary-values", "[#999]"],
      ["no-raw-colors", "#333"],
      ["no-raw-colors", "#444"],
    ]);
  });

  test("addLater refuses an addition loadLater would refuse, and writes nothing", () => {
    const root = tmp();
    expect(() => addLater(root, [entry(), entry({ rule: "invalid-gap" })])).toThrow(/addition 2/);
    expect(() => addLater(root, [entry({ date: undefined })])).toThrow(/addition 1/);
    expect(() => addLater(root, [entry({ count: 0 })])).toThrow(/addition 1/);
    expect(() => addLater(root, [entry({ date: "" })])).toThrow(/addition 1/);
    expect(existsSync(join(root, LATER_FILE))).toBe(false);
  });

  test("entriesFor counts each file, rule and value once", () => {
    expect(entriesFor([v(1, "#333"), v(4, "#333"), v(5, "#444")], rel, { reason: "Rebrand", date: "2026-09-30" })).toEqual([
      entry({ count: 2, reason: "Rebrand" }),
      entry({ value: "#444", reason: "Rebrand" }),
    ]);
  });

  test("addLater merges counts into an entry that exists, sorts, and writes a stable file", () => {
    const root = tmp();
    addLater(root, [entry({ file: "b.tsx" }), entry()]);
    addLater(root, [entry({ count: 2, reason: "Later", date: "2026-10-01" })]);
    const text = readFileSync(join(root, LATER_FILE), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({
      version: 1,
      entries: [entry({ count: 3, reason: "Later", date: "2026-10-01" }), entry({ file: "b.tsx" })],
    });
  });
});

describe("applyLater counts what each entry covered", () => {
  test("usedCounts says how many occurrences each entry deferred", () => {
    const later = [entry({ count: 3 }), entry({ value: "#444", count: 1 })];
    const { usedCounts } = applyLater(later, [v(1, "#333"), v(2, "#333"), v(3, "#444"), v(4, "#444")], rel);
    expect([...usedCounts]).toEqual([[0, 2], [1, 1]]);
  });

  // Each run has its own copy of a problem in a file two profiles cover, and each run defers its copy.
  test("each call starts from nothing: the same problem in a second run is deferred as well", () => {
    const later = [entry({ count: 1 })];
    expect(applyLater(later, [v(3, "#333")], rel).deferred).toHaveLength(1);
    expect(applyLater(later, [v(3, "#333")], rel).deferred).toHaveLength(1);
  });
});

describe("notYetDeferred", () => {
  const pool = [v(3, "#333"), v(4, "#333"), v(6, "#444")];

  test("one problem of a value that occurs twice is taken, whichever line it is on, and the other is still to come", () => {
    expect(notYetDeferred([], [pool[1]], pool, rel)).toEqual([pool[1]]);
    expect(notYetDeferred([entry({ count: 1 })], [pool[0]], pool, rel)).toEqual([pool[0]]);
    expect(notYetDeferred([entry({ count: 1 })], [pool[1]], pool, rel)).toEqual([pool[1]]);
  });

  test("nothing is taken once the entry covers every older occurrence, whichever line is named", () => {
    expect(notYetDeferred([entry({ count: 2 })], [pool[0]], pool, rel)).toEqual([]);
    expect(notYetDeferred([entry({ count: 2 })], [pool[1]], pool, rel)).toEqual([]);
    expect(notYetDeferred([entry({ count: 5 })], [pool[1]], pool, rel)).toEqual([]);
  });

  test("never more than were asked for, and never more than are left", () => {
    expect(notYetDeferred([], [pool[0]], pool, rel)).toEqual([pool[0]]);
    expect(notYetDeferred([], pool.slice(0, 2), pool, rel)).toEqual(pool.slice(0, 2));
    expect(notYetDeferred([entry({ count: 1 })], pool.slice(0, 2), pool, rel)).toEqual([pool[0]]);
  });

  test("each file, rule and value is counted on its own", () => {
    const other = { ...v(2, "#333"), file: "/r/app/q.tsx" };
    const relOf = (x) => (x.file.endsWith("q.tsx") ? "app/q.tsx" : "app/p.tsx");
    expect(notYetDeferred([entry({ count: 2 })], [other, pool[2]], [...pool, other], relOf)).toEqual([other, pool[2]]);
    expect(notYetDeferred([], [v(1, "#333", "no-arbitrary-values")], pool, rel)).toEqual([v(1, "#333", "no-arbitrary-values")]);
  });
});

describe("relFor", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "u-relfor-")));
  mkdirSync(join(base, "real/app"), { recursive: true });
  writeFileSync(join(base, "real/app/p.tsx"), "");
  symlinkSync(join(base, "real"), join(base, "link"));

  test("a path under the folder is relative to it, with forward slashes", () => {
    expect(relFor({ root: join(base, "real") }, join(base, "real/app/p.tsx"))).toBe("app/p.tsx");
  });

  test("a path given by the folder's real name, when the folder is reached through a link, is rebased", () => {
    expect(relFor({ root: join(base, "link") }, join(base, "real/app/p.tsx"))).toBe("app/p.tsx");
  });

  test("and the other way: the folder by its real name, the path through the link", () => {
    expect(relFor({ root: join(base, "real") }, join(base, "link/app/p.tsx"))).toBe("app/p.tsx");
  });

  test("a path that is outside the folder for real stays outside, and one that does not exist is not an error", () => {
    expect(relFor({ root: join(base, "real") }, join(base, "elsewhere/x.tsx"))).toBe("../elsewhere/x.tsx");
    expect(relFor({ root: join(base, "link") }, join(base, "elsewhere/x.tsx"))).toBe("../elsewhere/x.tsx");
  });
});

describe("the later list is written under a lock", () => {
  const lockOf = (root) => join(root, `${LATER_FILE}.lock`);

  test("a lock held by someone else makes the write fail loudly, and nothing is written", () => {
    const root = tmp();
    mkdirSync(lockOf(root));
    expect(() => addLater(root, [entry()], { waitMs: 150 })).toThrow(/another undrift later is writing undrift\.later\.json/);
    expect(existsSync(join(root, LATER_FILE))).toBe(false);
    expect(existsSync(lockOf(root))).toBe(true); // not ours to remove
  });

  test("a lock left behind by a process that was killed is cleared once it is old", () => {
    const root = tmp();
    mkdirSync(lockOf(root));
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockOf(root), old, old);
    addLater(root, [entry()], { waitMs: 150 });
    expect(loadLater(root)).toEqual([entry()]);
    expect(existsSync(lockOf(root))).toBe(false);
  });

  test("the lock is released afterwards, and when the write is refused", () => {
    const root = tmp();
    addLater(root, [entry()]);
    expect(existsSync(lockOf(root))).toBe(false);
    expect(() => addLater(root, [entry({ count: 0 })])).toThrow();
    expect(existsSync(lockOf(root))).toBe(false);
    writeFileSync(join(root, LATER_FILE), "{");
    expect(() => addLater(root, [entry()])).toThrow(/not valid JSON/);
    expect(existsSync(lockOf(root))).toBe(false);
  });

  test("a holder that lost its lock to another process does not remove that process's lock, or write", () => {
    const root = tmp();
    writeFileSync(join(root, LATER_FILE), JSON.stringify({ version: 1, entries: [] }));
    let error;
    try {
      updateLater(root, () => {
        // while this one is paused, its lock is judged stale and another process takes its place
        writeFileSync(join(lockOf(root), "owner"), "someone else");
        return [entry()];
      });
    } catch (e) { error = e; }
    expect(error?.message).toMatch(/lost the lock on undrift\.later\.json to another process\. Nothing was written/);
    expect(loadLater(root)).toEqual([]);
    expect(readFileSync(join(lockOf(root), "owner"), "utf8")).toBe("someone else");
  });

  test("a holder that keeps its lock removes it, owner file and all", () => {
    const root = tmp();
    addLater(root, [entry()]);
    expect(existsSync(lockOf(root))).toBe(false);
  });

  test("updateLater builds its additions from the list as it is under the lock, and writes nothing for none", () => {
    const root = tmp();
    addLater(root, [entry()]);
    let seen;
    const r = updateLater(root, (entries) => { seen = entries; return []; });
    expect(seen).toEqual([entry()]);
    expect(r).toEqual({ additions: [], written: [entry()] });
    const before = readFileSync(join(root, LATER_FILE), "utf8");
    updateLater(root, () => []);
    expect(readFileSync(join(root, LATER_FILE), "utf8")).toBe(before);
  });
});

// A write goes to a temporary file and is renamed into place. A process killed between the two must
// leave nothing in the repository, where `git status` would show it: the temporary file lives in the lock folder.
describe("the temporary file of a write", () => {
  const LATER = fileURLToPath(new URL("../src/later.mjs", import.meta.url));
  // Runs updateLater in a process that is killed at the rename, as a crash would, and returns what is left.
  const crashAtRename = (root) => {
    const script = `
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      fs.renameSync = () => process.kill(process.pid, "SIGKILL");
      syncBuiltinESMExports();
      const { updateLater } = await import(${JSON.stringify(LATER)});
      updateLater(${JSON.stringify(root)}, () => [${JSON.stringify(entry())}]);`;
    try {
      execFileSync(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" });
    } catch { /* killed, as meant */ }
  };

  test("a process killed between writing it and renaming it leaves nothing in the repository's own folder", () => {
    const root = tmp();
    crashAtRename(root);
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(root).filter((n) => n !== `${LATER_FILE}.lock`)).toEqual([]);
    expect(existsSync(join(root, LATER_FILE))).toBe(false);
  });

  test("what the crash left is cleared with its stale lock by the next write, and the write goes through", () => {
    const root = tmp();
    crashAtRename(root);
    const lock = join(root, `${LATER_FILE}.lock`);
    expect(readdirSync(lock).some((n) => n.endsWith(".tmp"))).toBe(true);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    addLater(root, [entry()], { waitMs: 150 });
    expect(loadLater(root)).toEqual([entry()]);
    expect(readdirSync(root)).toEqual([LATER_FILE]);
  });

  test("a write that completes leaves the list alone in the folder: no lock, no temporary file", () => {
    const root = tmp();
    addLater(root, [entry()]);
    addLater(root, [entry({ value: "#444" })]);
    expect(readdirSync(root)).toEqual([LATER_FILE]);
  });

  test("a holder whose lock folder was cleared by another process says it lost the lock, and writes nothing", () => {
    const root = tmp();
    expect(() => updateLater(root, () => {
      rmSync(join(root, `${LATER_FILE}.lock`), { recursive: true, force: true });
      return [entry()];
    })).toThrow(/lost the lock on undrift\.later\.json to another process\. Nothing was written/);
    expect(existsSync(join(root, LATER_FILE))).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });

  test("a holder that lost its lock leaves no temporary file behind", () => {
    const root = tmp();
    try {
      updateLater(root, () => {
        writeFileSync(join(root, `${LATER_FILE}.lock`, "owner"), "someone else");
        return [entry()];
      });
    } catch { /* lost the lock, as meant */ }
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(join(root, `${LATER_FILE}.lock`)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});
