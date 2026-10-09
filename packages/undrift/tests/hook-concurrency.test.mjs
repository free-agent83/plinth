// Claude Code can run several hooks at once (parallel tool calls, several agents, an
// editor saving many files). Each one used to read .undrift/notices.json when it
// started, decide from that copy which notices were still to be told, and write the
// whole file back. Sixteen at once read the same empty state, every one of them told
// its notice, and the last to write kept only its own: the notices were sent twice, and
// the record of what had been sent lost updates, so they were sent again next time.
// The state is written whole to a temporary file and renamed into place, and the
// decision and the write happen under a lock, so a notice is claimed by exactly one hook.
//
// Every hook here is a real node process, and each one loads the TypeScript parser, so a
// burst of sixteen is most of a machine for a second. Sixteen is what the race needs to
// show every time, so the two scenarios that depend on it use sixteen and everything else
// is as small as it can be while still being a race. A round is checked for everything at
// once, not run again for each property.
import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { execFileSync, exited } from "./support/exec.mjs";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/undrift-hook.mjs", import.meta.url));
const TRACE_FS = fileURLToPath(new URL("./support/trace-fs.mjs", import.meta.url));
const TSX = `export const X = () => <div className="bg-primary" />;\n`;
const BAD = `export const B = () => <div style={{ color: "#ff0000" }} />;\n`;
const N = 16; // enough for the race to show every time
const FEW = 6; // enough for it to be a race

function repo(config, files) {
  const root = mkdtempSync(join(tmpdir(), "u-hook-par-"));
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("ds.css", ":root{--color-primary:#3b5bdb}");
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  write("undrift.config.json", JSON.stringify(config));
  return root;
}

/** Every file's hook started at once, in separate processes. */
const together = (root, files) =>
  Promise.all(
    files.map(
      (rel) =>
        new Promise((done) => {
          const child = spawn(process.execPath, [HOOK], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (c) => (stdout += c));
          child.stderr.on("data", (c) => (stderr += c));
          child.on("close", (code) => done({ rel, code, stdout, stderr }));
          child.stdin.end(JSON.stringify({ tool_input: { file_path: join(root, rel) } }));
        })
    )
  );

const told = (results) => results.filter((r) => r.stdout !== "");
const noticeText = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
const stateOf = (root) => JSON.parse(readFileSync(join(root, ".undrift/notices.json"), "utf8"));
const names = (count, dir, prefix) => Array.from({ length: count }, (_, i) => `${dir}/${prefix}${String(i).padStart(2, "0")}.tsx`);
const filesOf = (list, body) => Object.fromEntries(list.map((rel) => [rel, body]));

// Every file is a UI file no profile covers, so every hook has its own notice to tell.
const OWN = { system: "@acme/ds", tokensCss: "ds.css", ignore: { "ds.css": "the token source" }, profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } } };
// One notice they all share: the source is missing, so the combined notice for the
// profile reads the same whichever file it is sent for.
const SHARED = { ...OWN, tokensCss: ["ds.css", "gone.css"] };

describe(`hooks at once, each with a notice to tell`, () => {
  test(`${N} hooks: each one's own notice is told once, every one is recorded whole, and nothing is left behind`, async () => {
    const own = names(N, "lib", "f");
    const root = repo(OWN, filesOf(own, TSX));
    const results = await together(root, own);
    expect(results.every((r) => r.code === 0 && r.stderr === "")).toBe(true);
    expect(told(results)).toHaveLength(N);
    // no update was lost: the record holds all of them, as whole JSON
    expect(stateOf(root).sent.sort()).toEqual(own.map((rel) => `uncovered:${rel}`).sort());
    // and neither a temporary file nor the lock is left in the directory
    expect(readdirSync(join(root, ".undrift")).sort()).toEqual(["notices.json"]);
    // what was recorded is what the next round reads: nothing is told again
    expect(told(await together(root, own.slice(0, FEW)))).toEqual([]);
  });

  test(`${FEW} hooks: a notice they all share is told by exactly one of them`, async () => {
    const covered = names(FEW, "app", "a");
    const root = repo(SHARED, filesOf(covered, TSX));
    const results = await together(root, covered);
    expect(results.every((r) => r.code === 0)).toBe(true);
    const spoke = told(results);
    expect(spoke).toHaveLength(1);
    expect(noticeText(spoke[0])).toContain('tokensCss "gone.css" does not exist');
    expect(stateOf(root).sent).toHaveLength(1);
  });

  test(`${FEW} hooks: the same notice for the same file is told once`, async () => {
    const root = repo(OWN, { "lib/one.tsx": TSX });
    const results = await together(root, Array.from({ length: FEW }, () => "lib/one.tsx"));
    expect(told(results)).toHaveLength(1);
    expect(stateOf(root).sent).toEqual(["uncovered:lib/one.tsx"]);
  });

  test("a hook that is violating still blocks while the others tell", async () => {
    const own = names(4, "lib", "f");
    const root = repo(OWN, { ...filesOf(own, TSX), "app/bad.tsx": BAD });
    const results = await together(root, [...own, "app/bad.tsx"]);
    const bad = results.find((r) => r.rel === "app/bad.tsx");
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("#ff0000");
    expect(told(results.filter((r) => r.rel !== "app/bad.tsx"))).toHaveLength(own.length);
  });
});

// The counter that turns a fix into a decision after three attempts has the same shape:
// read the whole file, change one file's count, write the whole file back. Sixteen files
// failing at once lost one another's counts.
describe("hooks at once, each blocking its own file", () => {
  const attemptsOf = (root) => JSON.parse(readFileSync(join(root, ".undrift/attempts.json"), "utf8"));

  test(`${N} hooks: every file's attempt is counted, and a second round counts a second`, async () => {
    const bads = names(N, "app", "bad");
    const root = repo(OWN, filesOf(bads, BAD));
    const first = await together(root, bads);
    expect(first.every((r) => r.code === 2)).toBe(true);
    expect(attemptsOf(root)).toEqual(Object.fromEntries(bads.map((rel) => [rel, 1])));
    // some of them again: theirs are counted twice, and nobody else's count moves
    const again = bads.slice(0, FEW);
    const second = await together(root, again);
    expect(second.every((r) => r.code === 2 && r.stderr.includes("attempt 2/3"))).toBe(true);
    expect(attemptsOf(root)).toEqual(Object.fromEntries(bads.map((rel) => [rel, again.includes(rel) ? 2 : 1])));
  });

  test("the same file, at once, is counted once each and reaches the decision on the third", async () => {
    const root = repo(OWN, { "app/bad.tsx": BAD });
    const three = await together(root, ["app/bad.tsx", "app/bad.tsx", "app/bad.tsx"]);
    expect(three.map((r) => /attempt (\d)\/3/.exec(r.stderr)?.[1] ?? "decision").sort()).toEqual(["1", "2", "decision"]);
    expect(attemptsOf(root)["app/bad.tsx"]).toBe(3);
  });

  test("a file that has become clean is cleared from the counts without losing the others", async () => {
    const bads = names(FEW, "app", "bad");
    const root = repo(OWN, { ...filesOf(bads, BAD), "app/fixed.tsx": BAD });
    await together(root, [...bads, "app/fixed.tsx"]);
    writeFileSync(join(root, "app/fixed.tsx"), TSX);
    const [fixed] = await together(root, ["app/fixed.tsx"]);
    expect(fixed.code).toBe(0);
    expect(attemptsOf(root)).toEqual(Object.fromEntries(bads.map((rel) => [rel, 1])));
  });
});

describe("the state file and its lock", () => {
  /** One hook run under the fs trace: the lines it wrote, and the renames it made. */
  const traced = (root, rel) => {
    const trace = join(mkdtempSync(join(tmpdir(), "u-trace-")), "fs.log");
    try {
      execFileSync(process.execPath, ["--import", TRACE_FS, HOOK], {
        cwd: root,
        input: JSON.stringify({ tool_input: { file_path: join(root, rel) } }),
        env: { ...process.env, UNDRIFT_TRACE_FS: trace },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      // a blocked edit exits 2, and the trace is complete either way
      expect(exited(e)).toBe(2);
    }
    const lines = readFileSync(trace, "utf8").trim().split("\n");
    return {
      writes: lines.filter((l) => l.startsWith("write ")).map((l) => l.slice(6)),
      renames: lines.filter((l) => l.startsWith("rename ")).map((l) => l.slice(7).split(" ")),
    };
  };

  // The same file is left behind by a write in place and by a write to a temporary name
  // followed by a rename. Only the second is never seen half written, so the way it is
  // written is what is checked: the temporary is written, then renamed onto the state.
  test("the notice state is written to a temporary name and renamed onto the file, never written in place", () => {
    const root = repo(OWN, { "lib/one.tsx": TSX });
    const { writes, renames } = traced(root, "lib/one.tsx");
    const state = join(root, ".undrift/notices.json");
    expect(writes).not.toContain(state);
    expect(writes.filter((p) => p.startsWith(`${state}.`) && p.endsWith(".tmp"))).toHaveLength(1);
    expect(renames).toHaveLength(1);
    expect(renames[0][1]).toBe(state);
    expect(renames[0][0]).toBe(writes.find((p) => p.endsWith(".tmp")));
  });

  test("the attempt counts are written the same way", () => {
    const root = repo(OWN, { "app/bad.tsx": BAD });
    const { writes, renames } = traced(root, "app/bad.tsx");
    // the counts are kept beside the config, under the path the hook found it by
    const counts = join(root, ".undrift/attempts.json");
    expect(writes).not.toContain(counts);
    expect(writes.filter((p) => p.startsWith(`${counts}.`) && p.endsWith(".tmp"))).toHaveLength(1);
    expect(renames.filter(([, to]) => to === counts)).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(root, ".undrift/attempts.json"), "utf8"))).toEqual({ "app/bad.tsx": 1 });
  });

  // Whether the hook waited out a live holder or cleared a dead one is told by what is
  // left: a hook that carries on without the lock never owned it, and leaves it standing.
  test("a lock left by a hook that was killed is cleared, and the notice is still told", async () => {
    const root = repo(OWN, { "lib/one.tsx": TSX });
    const lock = join(root, ".undrift/notices.lock");
    mkdirSync(lock, { recursive: true });
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const [r] = await together(root, ["lib/one.tsx"]);
    expect(r.code).toBe(0);
    expect(told([r])).toHaveLength(1);
    expect(existsSync(lock)).toBe(false);
    expect(stateOf(root).sent).toEqual(["uncovered:lib/one.tsx"]);
  });

  test("a lock that is being held is waited for, and then the hook carries on rather than hanging", async () => {
    const root = repo(OWN, { "lib/one.tsx": TSX });
    const lock = join(root, ".undrift/notices.lock");
    mkdirSync(lock, { recursive: true });
    const started = Date.now();
    const [r] = await together(root, ["lib/one.tsx"]);
    expect(r.code).toBe(0);
    expect(told([r])).toHaveLength(1);
    // it did not wait for ever: a slow machine gets a wide margin over the wait itself
    expect(Date.now() - started).toBeLessThan(20_000);
    // it was never ours to release
    expect(existsSync(lock)).toBe(true);
  });

  test("a different config re-arms every notice, and that is recorded even when nothing is told", async () => {
    const root = repo(OWN, { "lib/one.tsx": TSX, "app/a.tsx": TSX });
    await together(root, ["lib/one.tsx"]);
    const before = stateOf(root);
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify({ ...OWN, exemptMarker: "token-exempt" }));
    // a covered clean file: nothing to tell, and the record must still be re-armed
    const [quiet] = await together(root, ["app/a.tsx"]);
    expect(quiet.stdout).toBe("");
    const after = stateOf(root);
    expect(after.config).not.toBe(before.config);
    expect(after.sent).toEqual([]);
  });
});
