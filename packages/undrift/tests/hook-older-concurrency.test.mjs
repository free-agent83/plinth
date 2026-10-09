// Sixteen hooks at once in one session, each for a different old file with an older problem. The record
// of what the session has been told (.undrift/older.json) is read, changed and written whole, so without
// the lock round it each hook read the same state and the last write kept only its own file. Every hook
// here is a real node process, as in hook-concurrency.test.mjs.
import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOOK } from "./support/world.mjs";
import { commitAll } from "./support/git.mjs";

const N = 16;
const ROUNDS = 5;
const OLD = ["export const P = () => (", "  <div>", '    <p style={{ color: "#333333" }}>Old</p>', "  </div>", ");", ""].join("\n");
const EDITED = OLD.replace("  </div>", '    <p className="bg-primary">New</p>\n  </div>');
const names = Array.from({ length: N }, (_, i) => `app/f${String(i).padStart(2, "0")}.tsx`);

const together = (root, files, session) =>
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
          child.stdin.end(JSON.stringify({ session_id: session, tool_input: { file_path: join(root, rel) } }));
        })
    )
  );

describe("older problems, many hooks at once", () => {
  test(`${N} files in one session: each is told once and recorded, and a second burst tells none again`, async () => {
    const root = mkdtempSync(join(tmpdir(), "u-older-par-"));
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "ds.css"), ":root{--color-muted:#333333;--color-primary:#3b5bdb}");
    writeFileSync(join(root, ".gitignore"), ".undrift/\n");
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
      system: "@acme/ds", tokensCss: "ds.css",
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } },
    }));
    for (const rel of names) writeFileSync(join(root, rel), OLD);
    commitAll(root);
    for (const rel of names) writeFileSync(join(root, rel), EDITED);

    // One burst shows the race about three times in four, so there are several, each a session of its own:
    // a lost update in any of them fails the test. (Measured with the lock removed: one burst failed 3 of
    // 4 runs.)
    for (let round = 0; round < ROUNDS; round++) {
      const session = `burst-${round}`;
      const first = await together(root, names, session);
      expect(first.every((r) => r.code === 0 && r.stderr === "")).toBe(true);
      // every hook told its own file's note
      expect(first.filter((r) => r.stdout !== "")).toHaveLength(N);
      for (const r of first) expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain(`older problem in ${r.rel}`);
      // no update was lost: all of them are recorded, as whole JSON, and nothing is left behind
      expect(JSON.parse(readFileSync(join(root, ".undrift/older.json"), "utf8"))[session].files.sort()).toEqual(names);
      expect(readdirSync(join(root, ".undrift")).sort()).toEqual(["older.json"]);
    }
    // what was recorded is what the next burst reads
    const again = await together(root, names, "burst-0");
    expect(again.filter((r) => r.stdout !== "")).toEqual([]);
  }, 120000);
});
