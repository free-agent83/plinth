// The hook keeps two small files: which notices it has told, and how many times a file has
// been blocked. Both live in .undrift/ beside the config. With that directory read-only (a
// read-only checkout, a sandbox), or with a file where it should be, every write failed in
// silence: each notice was told again at every edit, and the attempt count stayed at 1 of 3,
// so the hook never got to the message that asks the agent for a decision, which is the whole
// of its promise not to trap anyone in a loop.
//
// When the repository cannot hold the state, the state goes to a directory in the temporary
// directory that belongs to that repository (keyed on the real path of the config, private
// to the user). Only when neither can be written is it not kept.
import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { execFileSync, exited } from "./support/exec.mjs";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/undrift-hook.mjs", import.meta.url));
const FAKE_UID = fileURLToPath(new URL("./support/fake-getuid.cjs", import.meta.url));
const TSX = `export const X = () => <div className="bg-primary" />;\n`;
const BAD = `export const B = () => <div style={{ color: "#ff0000" }} />;\n`;
const asRoot = process.getuid?.() === 0; // root can write anywhere, whatever the mode
const posix = process.platform !== "win32";

const CONFIG = {
  system: "@acme/ds",
  tokensCss: "ds.css",
  ignore: { "ds.css": "the token source" },
  profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } },
};

function repo(files = {}, config = CONFIG) {
  const root = mkdtempSync(join(tmpdir(), "u-fallback-"));
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("ds.css", ":root{--color-primary:#3b5bdb}");
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  write("undrift.config.json", JSON.stringify(config));
  return root;
}
/** A temporary directory of its own for the hook to use, so its fallback can be found and counted. */
const scratchTmp = () => mkdtempSync(join(tmpdir(), "u-fallback-tmp-"));

const run = (root, rel, tmp) => {
  try {
    const stdout = execFileSync(process.execPath, [HOOK], {
      input: JSON.stringify({ tool_input: { file_path: join(root, rel) } }),
      cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TMPDIR: tmp },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};
const together = (root, files, tmp) =>
  Promise.all(
    files.map(
      (rel) =>
        new Promise((done) => {
          const child = spawn(process.execPath, [HOOK], { cwd: root, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, TMPDIR: tmp } });
          let stdout = "";
          child.stdout.on("data", (c) => (stdout += c));
          child.stderr.resume();
          child.on("close", (code) => done({ rel, code, stdout }));
          child.stdin.end(JSON.stringify({ tool_input: { file_path: join(root, rel) } }));
        })
    )
  );
const told = (r) => r.stdout !== "";
const fallbackDirs = (tmp) => readdirSync(tmp).filter((name) => /^undrift-.+-[0-9a-f]{16}$/.test(name));

/** The ways the repository cannot hold the state. */
const BROKEN = [
  ["a file where .undrift should be", (root) => writeFileSync(join(root, ".undrift"), "not a directory\n"), true],
  ["a read-only .undrift", (root) => { mkdirSync(join(root, ".undrift")); chmodSync(join(root, ".undrift"), 0o500); }, !asRoot],
];
describe.skipIf(!posix)("the repository cannot hold the state", () => {
  describe.each(BROKEN.map(([label, setup, applies]) => [label, setup, applies]))("with %s", (_label, setup, applies) => {
    const it = applies ? test : test.skip;

    it("a notice is told once, not at every edit", () => {
      const tmp = scratchTmp();
      const root = repo({ "lib/x.tsx": TSX });
      setup(root);
      expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
      expect(run(root, "lib/x.tsx", tmp)).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(run(root, "lib/x.tsx", tmp)).toEqual({ code: 0, stdout: "", stderr: "" });
    });

    it("the count of attempts reaches the message that asks for a decision", () => {
      const tmp = scratchTmp();
      const root = repo({ "app/bad.tsx": BAD });
      setup(root);
      const first = run(root, "app/bad.tsx", tmp);
      const second = run(root, "app/bad.tsx", tmp);
      const third = run(root, "app/bad.tsx", tmp);
      expect([first.code, second.code, third.code]).toEqual([2, 2, 2]);
      expect(first.stderr).toContain("attempt 1/3");
      expect(second.stderr).toContain("attempt 2/3");
      expect(third.stderr).toContain("Stop retrying");
      expect(third.stderr).toContain("after 3 attempts");
    });

    it("a file that becomes clean is cleared from the count", () => {
      const tmp = scratchTmp();
      const root = repo({ "app/bad.tsx": BAD });
      setup(root);
      run(root, "app/bad.tsx", tmp);
      run(root, "app/bad.tsx", tmp);
      writeFileSync(join(root, "app/bad.tsx"), TSX);
      expect(run(root, "app/bad.tsx", tmp)).toEqual({ code: 0, stdout: "", stderr: "" });
      writeFileSync(join(root, "app/bad.tsx"), BAD);
      expect(run(root, "app/bad.tsx", tmp).stderr).toContain("attempt 1/3");
    });

    it("the state is in a directory of the temporary directory that is this repository's own, and private", () => {
      const tmp = scratchTmp();
      const root = repo({ "lib/x.tsx": TSX, "app/bad.tsx": BAD });
      setup(root);
      run(root, "lib/x.tsx", tmp);
      run(root, "app/bad.tsx", tmp);
      const dirs = fallbackDirs(tmp);
      expect(dirs).toHaveLength(1);
      const dir = join(tmp, dirs[0]);
      expect(readdirSync(dir).sort()).toEqual(["attempts.json", "notices.json"]);
      expect(JSON.parse(readFileSync(join(dir, "attempts.json"), "utf8"))).toEqual({ "app/bad.tsx": 1 });
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(dirs[0]).toContain(`-${process.getuid()}-`);
    });

    it("the repository is left as it was", () => {
      const tmp = scratchTmp();
      const root = repo({ "lib/x.tsx": TSX });
      setup(root);
      const before = statSync(join(root, ".undrift")).isDirectory();
      run(root, "lib/x.tsx", tmp);
      expect(statSync(join(root, ".undrift")).isDirectory()).toBe(before);
      expect(existsSync(join(root, ".undrift/notices.json"))).toBe(false);
    });

    it("a different config version re-arms the notices, here as anywhere", () => {
      const tmp = scratchTmp();
      const root = repo({ "lib/x.tsx": TSX });
      setup(root);
      run(root, "lib/x.tsx", tmp);
      expect(told(run(root, "lib/x.tsx", tmp))).toBe(false);
      writeFileSync(join(root, "undrift.config.json"), JSON.stringify({ ...CONFIG, exemptMarker: "token-exempt" }));
      expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    });

    it("hooks at once still tell each notice once", async () => {
      const tmp = scratchTmp();
      const files = Array.from({ length: 6 }, (_, i) => `lib/f${i}.tsx`);
      const root = repo(Object.fromEntries(files.map((rel) => [rel, TSX])));
      setup(root);
      const first = await together(root, files, tmp);
      expect(first.filter(told)).toHaveLength(6);
      const dir = join(tmp, fallbackDirs(tmp)[0]);
      expect(JSON.parse(readFileSync(join(dir, "notices.json"), "utf8")).sent).toHaveLength(6);
      expect((await together(root, files, tmp)).filter(told)).toHaveLength(0);
    });
  });

  test("two repositories do not share a fallback", () => {
    const tmp = scratchTmp();
    const a = repo({ "lib/x.tsx": TSX });
    const b = repo({ "lib/x.tsx": TSX });
    for (const root of [a, b]) writeFileSync(join(root, ".undrift"), "not a directory\n");
    run(a, "lib/x.tsx", tmp);
    run(b, "lib/x.tsx", tmp);
    expect(fallbackDirs(tmp)).toHaveLength(2);
    // and each is told its own notice
    expect(told(run(a, "lib/x.tsx", tmp))).toBe(false);
  });

  test("the repository is used when it can hold the state, and the temporary directory is not touched", () => {
    const tmp = scratchTmp();
    const root = repo({ "lib/x.tsx": TSX });
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(existsSync(join(root, ".undrift/notices.json"))).toBe(true);
    expect(readdirSync(tmp)).toEqual([]);
  });

  test("a silent run writes nothing anywhere: neither the repository nor the fallback", () => {
    const tmp = scratchTmp();
    const root = repo({ "app/a.tsx": TSX });
    writeFileSync(join(root, ".undrift"), "not a directory\n");
    expect(run(root, "app/a.tsx", tmp)).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(readdirSync(tmp)).toEqual([]);
  });
});

// A directory in the temporary directory is shared with everyone on the machine. One that
// anybody else can write to could be made to say a notice was told when it was not, or to
// hold a lock for ever, so it is not used: the same as no fallback at all.
describe.skipIf(!posix)("a fallback directory that is not ours to trust", () => {
  const fallbackFor = (tmp, root) =>
    join(tmp, `undrift-${process.getuid()}-${createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16)}`);

  test("one that others can write to is not used, and nothing is put in it", () => {
    const tmp = scratchTmp();
    const root = repo({ "lib/x.tsx": TSX });
    writeFileSync(join(root, ".undrift"), "not a directory\n");
    const dir = fallbackFor(tmp, root);
    mkdirSync(dir, { mode: 0o777 });
    chmodSync(dir, 0o777);
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("one that only the group can write to is not used either", () => {
    const tmp = scratchTmp();
    const root = repo({ "lib/x.tsx": TSX });
    writeFileSync(join(root, ".undrift"), "not a directory\n");
    const dir = fallbackFor(tmp, root);
    mkdirSync(dir, { mode: 0o770 });
    chmodSync(dir, 0o770);
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
  });

  test("a file where the fallback directory should be is not used", () => {
    const tmp = scratchTmp();
    const root = repo({ "lib/x.tsx": TSX });
    writeFileSync(join(root, ".undrift"), "not a directory\n");
    writeFileSync(fallbackFor(tmp, root), "in the way\n");
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
  });

  // The temporary directory is shared, so a name in it can be taken beforehand, and a link to a
  // directory the user owns is as good a way as a directory that is not theirs. `statSync` follows a
  // link and saw a private directory of the user's own, so the hook wrote its state into whatever the
  // link pointed at.
  test("a link planted where the fallback would be is refused, and what it points to is left alone", () => {
    const tmp = scratchTmp();
    chmodSync(tmp, 0o1777); // like /tmp: anyone may make a name in it, and only its owner may remove one
    const victim = mkdtempSync(join(tmpdir(), "u-fallback-victim-"));
    writeFileSync(join(victim, "keep.txt"), "the user's own file\n");
    const root = repo({ "lib/x.tsx": TSX, "app/bad.tsx": BAD });
    writeFileSync(join(root, ".undrift"), "not a directory\n");
    symlinkSync(victim, fallbackFor(tmp, root));
    // no state is kept, so a notice is told again, and the count does not move
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(run(root, "app/bad.tsx", tmp).stderr).toContain("attempt 1/3");
    expect(run(root, "app/bad.tsx", tmp).stderr).toContain("attempt 1/3");
    expect(readdirSync(victim)).toEqual(["keep.txt"]);
    expect(readFileSync(join(victim, "keep.txt"), "utf8")).toBe("the user's own file\n");
  });

  test("a temporary directory that is not there is not made: the state is not kept, and nothing is created", () => {
    const parent = scratchTmp();
    const tmp = join(parent, "does", "not", "exist");
    const root = repo({ "lib/x.tsx": TSX });
    writeFileSync(join(root, ".undrift"), "not a directory\n");
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(readdirSync(parent)).toEqual([]);
  });

  test("a link to nothing is refused too, and is not made a directory through", () => {
    const tmp = scratchTmp();
    const root = repo({ "lib/x.tsx": TSX });
    writeFileSync(join(root, ".undrift"), "not a directory\n");
    const nowhere = join(tmp, "nowhere");
    symlinkSync(nowhere, fallbackFor(tmp, root));
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(existsSync(nowhere)).toBe(false);
  });

  // A process that is not root cannot become another user, so the hook is told it is one: it reads
  // its user id to name the directory and to check who owns it.
  const runAs = (uid, root, rel, tmp) => {
    try {
      const stdout = execFileSync(process.execPath, ["--require", FAKE_UID, HOOK], {
        input: JSON.stringify({ tool_input: { file_path: join(root, rel) } }),
        cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, TMPDIR: tmp, UNDRIFT_TEST_UID: String(uid) },
      });
      return { code: 0, stdout, stderr: "" };
    } catch (e) {
      return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  };
  const hashOf = (root) => createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16);

  test("one that another user owns is not used, and nothing is put in it", () => {
    const tmp = scratchTmp();
    const root = repo({ "lib/x.tsx": TSX });
    writeFileSync(join(root, ".undrift"), "not a directory\n");
    const other = process.getuid() + 1;
    const dir = join(tmp, `undrift-${other}-${hashOf(root)}`);
    mkdirSync(dir, { mode: 0o700 }); // private, and made by this test's user, not by the one the hook believes it is
    expect(told(runAs(other, root, "lib/x.tsx", tmp))).toBe(true);
    expect(told(runAs(other, root, "lib/x.tsx", tmp))).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("the same directory is used when its owner is the one asking", () => {
    const tmp = scratchTmp();
    const root = repo({ "lib/x.tsx": TSX });
    writeFileSync(join(root, ".undrift"), "not a directory\n");
    const me = process.getuid();
    mkdirSync(join(tmp, `undrift-${me}-${hashOf(root)}`), { mode: 0o700 });
    expect(told(runAs(me, root, "lib/x.tsx", tmp))).toBe(true);
    expect(told(runAs(me, root, "lib/x.tsx", tmp))).toBe(false);
  });

  test("one that is ours and private, made by an earlier run, is used again", () => {
    const tmp = scratchTmp();
    const root = repo({ "lib/x.tsx": TSX });
    writeFileSync(join(root, ".undrift"), "not a directory\n");
    mkdirSync(fallbackFor(tmp, root), { mode: 0o700 });
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(false);
  });
});

// The last resort: when the temporary directory cannot hold it either, the state is not kept.
// The hook still works, it does not fail the edit, and it says so in the only way it can:
// a notice is told again, and the count does not move. Nothing crashes.
describe.skipIf(!posix)("neither can hold the state", () => {
  function unusableTmp() {
    // a file where the temporary directory should be: nothing can be made inside it
    const dir = mkdtempSync(join(tmpdir(), "u-fallback-none-"));
    const file = join(dir, "not-a-directory");
    writeFileSync(file, "x");
    return file;
  }

  test("the hook does not crash, and the edit is not failed", () => {
    const tmp = unusableTmp();
    const root = repo({ "lib/x.tsx": TSX, "app/bad.tsx": BAD });
    writeFileSync(join(root, ".undrift"), "not a directory\n");
    const notice = run(root, "lib/x.tsx", tmp);
    expect(notice.code).toBe(0);
    expect(notice.stderr).toBe("");
    const blocked = run(root, "app/bad.tsx", tmp);
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toContain("attempt 1/3");
    expect(blocked.stderr).not.toMatch(/\n\s+at /);
  });

  test("and a notice is told again, and the count does not move: nothing is kept", () => {
    const tmp = unusableTmp();
    const root = repo({ "lib/x.tsx": TSX, "app/bad.tsx": BAD });
    writeFileSync(join(root, ".undrift"), "not a directory\n");
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(told(run(root, "lib/x.tsx", tmp))).toBe(true);
    expect(run(root, "app/bad.tsx", tmp).stderr).toContain("attempt 1/3");
    expect(run(root, "app/bad.tsx", tmp).stderr).toContain("attempt 1/3");
  });
});
