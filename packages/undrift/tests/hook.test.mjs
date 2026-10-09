// The hook is the mechanism the whole tool exists for: documentation does not
// produce adherence, enforcement does. These tests pin the three properties
// that make it usable: it blocks, it never traps, and it stays silent.
import { expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/undrift-hook.mjs", import.meta.url));

function repo() {
  const root = mkdtempSync(join(tmpdir(), "u-hook-"));
  mkdirSync(join(root, "app"), { recursive: true });
  writeFileSync(join(root, "ds.css"), ":root{--color-primary:#3b5bdb}");
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
    system: "@acme/ds", tokensCss: "ds.css",
    profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors"] } },
  }));
  return root;
}

const run = (root, file) => {
  try {
    const stdout = execFileSync("node", [HOOK], {
      input: JSON.stringify({ tool_input: { file_path: file } }),
      cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

test("exits 0 and says nothing for clean source", () => {
  const root = repo();
  const f = join(root, "app/a.tsx");
  writeFileSync(f, `export const A = () => <div className="bg-primary" />;`);
  const r = run(root, f);
  expect(r.code).toBe(0);
  expect(r.stderr).toBe("");
});

test("exits 2 with the fix on stderr for a violation", () => {
  const root = repo();
  const f = join(root, "app/b.tsx");
  writeFileSync(f, `export const B = () => <div style={{ color: "#ff0000" }} />;`);
  const r = run(root, f);
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/#ff0000/);
  expect(r.stderr).toMatch(/token/i);
});

test("ignores files outside the configured profile", () => {
  const root = repo();
  const f = join(root, "README.md");
  writeFileSync(f, "#ff0000");
  expect(run(root, f).code).toBe(0);
});

test("demands a decision rather than a fix after 3 attempts", () => {
  const root = repo();
  const f = join(root, "app/c.tsx");
  writeFileSync(f, `export const C = () => <div style={{ color: "#ff0000" }} />;`);
  const first = run(root, f);
  run(root, f);
  const third = run(root, f);
  expect(first.stderr).toMatch(/attempt 1\/3/);
  expect(third.code).toBe(2);
  expect(third.stderr).toMatch(/Stop retrying/);
  expect(third.stderr).toMatch(/Missing what/);
});

test("clears the attempt counter once the file is clean", () => {
  const root = repo();
  const f = join(root, "app/d.tsx");
  writeFileSync(f, `export const D = () => <div style={{ color: "#ff0000" }} />;`);
  run(root, f);
  writeFileSync(f, `export const D = () => <div className="bg-primary" />;`);
  expect(run(root, f).code).toBe(0);
  // a fresh violation starts from attempt 1, not 2
  writeFileSync(f, `export const D = () => <div style={{ color: "#00ff00" }} />;`);
  expect(run(root, f).stderr).toMatch(/attempt 1\/3/);
});

// P3: gaps are a success state. If declaring a gap were penalised the agent
// would improvise instead. That is the exact drift the hook exists to prevent.
test("a declared gap does not block the dev loop", () => {
  const root = repo();
  const f = join(root, "app/e.tsx");
  writeFileSync(f, `export const E = () => <Missing what="Rating" reason="no rating component exists" />;`);
  expect(run(root, f).code).toBe(0);
});

test("a dishonest gap does block", () => {
  const root = repo();
  const f = join(root, "app/f.tsx");
  writeFileSync(f, `export const F = () => <Missing what="Rating" reason="" />;`);
  const r = run(root, f);
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/reason/i);
});

// The symlink trap (on macOS, a temp root is /var and the working directory resolves to /private/var). Without
// realpathSync on BOTH sides nothing ever matches a profile and the hook exits 0 for everything, enforcing nothing
// while looking healthy. The links are made here, so the test holds on any system and whatever the temp folder is: the
// process runs in the resolved folder, and the payload names the file through a link, as a real payload can.
test.skipIf(process.platform === "win32")("matches profiles through symlinked roots", () => {
  const root = realpathSync(repo());
  const links = mkdtempSync(join(tmpdir(), "u-hook-link-"));
  writeFileSync(join(root, "app/g.tsx"), `export const G = () => <div style={{ color: "#ff0000" }} />;`);
  // The whole repository through a link: the config is found beside the link, and the process may start in either.
  const rootLink = join(links, "root");
  symlinkSync(root, rootLink);
  const viaRoot = join(rootLink, "app/g.tsx");
  expect(realpathSync(viaRoot)).not.toBe(viaRoot);
  expect(run(root, viaRoot).code).toBe(2);
  expect(run(rootLink, viaRoot).code).toBe(2);
  // A folder of it through a link: the config is not beside the link, so only the file's real path says where it is.
  const appLink = join(links, "app");
  symlinkSync(join(root, "app"), appLink);
  expect(run(root, join(appLink, "g.tsx")).code).toBe(2);
});

test("exits 0 when the repo has no undrift config at all", () => {
  const root = mkdtempSync(join(tmpdir(), "u-hook-bare-"));
  const f = join(root, "a.tsx");
  writeFileSync(f, `export const A = () => <div style={{ color: "#ff0000" }} />;`);
  expect(run(root, f).code).toBe(0);
});

// The hook must never throw. One that does exits 1 with a stack trace, which Claude Code shows
// to the person and never to the agent. A payload of JSON `null` parsed fine and then died on
// `payload.tool_input`, and so would any payload that is not an object with a path in it.
const runRaw = (root, input) => {
  try {
    const stdout = execFileSync("node", [HOOK], { input, cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};

test.each([
  ["null", "null"],
  ["a number", "5"],
  ["a string", '"app/a.tsx"'],
  ["true", "true"],
  ["an array", "[]"],
  ["an array holding a payload", '[{"tool_input":{"file_path":"x"}}]'],
  ["an empty object", "{}"],
  ["no input at all", ""],
  ["input that is not JSON", "{ not json"],
  ["tool_input null", '{"tool_input":null}'],
  ["tool_input a string", '{"tool_input":"app/a.tsx"}'],
  ["file_path null", '{"tool_input":{"file_path":null}}'],
  ["file_path a number", '{"tool_input":{"file_path":5}}'],
  ["file_path an object", '{"tool_input":{"file_path":{"a":1}}}'],
  ["file_path empty", '{"tool_input":{"file_path":""}}'],
  ["file_path a directory", null],
  ["file_path that does not exist", '{"tool_input":{"file_path":"/nowhere/at/all.tsx"}}'],
])("a payload that is %s exits 0 and says nothing, without a stack trace", (_label, input) => {
  const root = repo();
  const r = runRaw(root, input ?? JSON.stringify({ tool_input: { file_path: join(root, "app") } }));
  expect(r).toEqual({ code: 0, stdout: "", stderr: "" });
});

test("a real payload still works after those", () => {
  const root = repo();
  const f = join(root, "app/b.tsx");
  writeFileSync(f, `export const B = () => <div style={{ color: "#ff0000" }} />;`);
  expect(run(root, f).code).toBe(2);
});
