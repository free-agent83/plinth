// process.exit() ends the process with whatever it has not yet handed to stdout. Into a
// pipe (`undrift gate --format json | jq`, or a CI step capturing the output) the
// operating system takes 64 KiB and the rest waits inside the process, so a longer
// report was cut off mid-sentence, and JSON cut off is not JSON: whatever parses it
// reads nothing at all. The commands set the exit code and let the process end by
// itself, which is after everything has been written. The exit code is unchanged.
//
// The oracle is the same command with stdout going to a file, which is written
// synchronously and so is always whole. The pipe has to deliver exactly that. The
// reader is slow to start, as a pipeline's is when the next stage is still loading:
// the pipe fills while nothing reads it. (A JSON report is written in one go and
// abandoned, so even the fastest reader lost the end of it. A report written a line
// at a time loses its end only when the reader lags, hence the delay.)
import { describe, expect, test } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { ranToExit } from "./support/exec.mjs";
import { closeSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bin = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/undrift.mjs");
const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), "../hooks/undrift-hook.mjs");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const PIPE = 64 * 1024;

/** stdout read from a pipe by a reader that starts late: what a `| jq` or a CI capture receives. */
const piped = (root, argv) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [bin, ...argv], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.resume();
    child.stdout.pause();
    setTimeout(() => child.stdout.resume(), 300);
    child.on("close", (code) => done({ code, out: Buffer.concat(chunks).toString("utf8") }));
  });

/** stdout written to a file: whole by construction. */
const whole = (root, argv) => {
  const dir = mkdtempSync(join(tmpdir(), "u-size-out-"));
  const path = join(dir, "stdout.txt");
  const fd = openSync(path, "w");
  try {
    // Node's own spawnSync, once: the file is opened once, so a second run would append to the first's output.
    const r = ranToExit(spawnSync(process.execPath, [bin, ...argv], { cwd: root, stdio: ["ignore", fd, "pipe"] }), process.execPath, [bin, ...argv]);
    return { code: r.status, out: readFileSync(path, "utf8") };
  } finally {
    closeSync(fd);
  }
};

function repo(files, config) {
  const root = mkdtempSync(join(tmpdir(), "u-size-"));
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write("ds.css", ":root{--color-primary:#3b5bdb}\n");
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  write(
    "undrift.config.json",
    JSON.stringify({
      system: "@acme/ds",
      tokensCss: "ds.css",
      profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors", "no-arbitrary-values"] } },
      ...config,
    })
  );
  return root;
}

const BAD = `export const B = () => <div style={{ color: "#ff0000", background: "#00ff00" }} className="bg-[#123456] p-[13px]" />;\n`;
const gap = (i) =>
  `export const G${i} = () => <Missing what="Widget${i}" reason="nothing in the system does this yet, so it is declared" />;\n`;
const named = (count, dir, body) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`${dir}/f${i}.tsx`, body(i)]));

/**
 * The report through a pipe is the report to a file, and the fixture was long enough
 * to matter. A report written in one go is lost from the first 64 KiB on. One written
 * a line at a time is lost only once the reader's own buffer and the pipe are both
 * full, which takes about twice that, so it is given `min` to be well past it.
 */
async function expectWhole(root, argv, code, min = PIPE + 16 * 1024) {
  const truth = whole(root, argv);
  expect(truth.out.length, "the fixture must be clearly longer than a pipe, or this proves nothing").toBeGreaterThan(min);
  const got = await piped(root, argv);
  expect(got.out.length).toBe(truth.out.length);
  expect(got.out).toBe(truth.out);
  expect(got.code).toBe(code);
  expect(truth.code).toBe(code);
  return got.out;
}

/** The hook's stderr, read from a pipe by a reader that starts late. */
const hookPiped = (root, file) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [HOOK], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.resume();
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.stderr.pause();
    setTimeout(() => child.stderr.resume(), 300);
    child.on("close", (code) => done({ code, err: Buffer.concat(chunks).toString("utf8") }));
    child.stdin.end(JSON.stringify({ tool_input: { file_path: file } }));
  });

/** The hook's stderr written to a file: whole by construction. */
const hookWhole = (root, file) => {
  const dir = mkdtempSync(join(tmpdir(), "u-size-out-"));
  const path = join(dir, "stderr.txt");
  const fd = openSync(path, "w");
  try {
    const r = ranToExit(
      spawnSync(process.execPath, [HOOK], {
        cwd: root, input: JSON.stringify({ tool_input: { file_path: file } }), stdio: ["pipe", "pipe", fd],
      }),
      process.execPath,
      [HOOK]
    );
    return { code: r.status, err: readFileSync(path, "utf8") };
  } finally {
    closeSync(fd);
  }
};

describe("a report longer than a pipe holds arrives whole", () => {
  test("gate --format json is valid JSON with every violation in it", async () => {
    const root = repo(named(80, "app", () => BAD));
    const out = await expectWhole(root, ["gate", "--format", "json"], 1);
    // what one file contributes, so the total is not a number written into the test
    const one = JSON.parse(whole(root, ["gate", "--format", "json", "app/f0.tsx"]).out).runs[0].violations.length;
    expect(one).toBeGreaterThan(0);
    expect(JSON.parse(out).runs[0].violations).toHaveLength(80 * one);
  });

  test("the same under --strict, and the exit code still says the run failed", async () => {
    const root = repo(named(80, "app", () => BAD));
    const out = await expectWhole(root, ["gate", "--format", "json", "--strict"], 1);
    expect(JSON.parse(out).pass).toBe(false);
  });

  test("the text report carries every violation, and the lines that close it", async () => {
    const files = 250;
    const root = repo(named(files, "app", () => BAD));
    const text = strip(await expectWhole(root, ["gate"], 1, 3 * PIPE));
    const lines = (t) => t.split("\n").filter((l) => /\[no-[a-z-]+\]/.test(l)).length;
    const one = lines(strip(whole(root, ["gate", "app/f0.tsx"]).out));
    expect(one).toBeGreaterThan(0);
    expect(lines(text)).toBe(files * one);
    // the status line and the advice that follows it are the end of the report
    expect(text).toMatch(/violation/);
    expect(text.trimEnd().split("\n").at(-1)).toMatch(/\.$/);
  });

  test("a run that passes still exits 0", async () => {
    const root = repo(named(400, "app", gap));
    const out = await expectWhole(root, ["gate", "--format", "json"], 0);
    expect(JSON.parse(out).gaps).toBe(400);
  });

  test("triage lists every outstanding gap and exits 0", async () => {
    const root = repo(named(700, "app", gap));
    const text = strip(await expectWhole(root, ["triage"], 0));
    expect(text).toMatch(/Undrift triage: 700 outstanding/);
    for (const i of [0, 350, 699]) expect(text).toContain(`Widget${i}`);
  });

  test("audit --format json is whole when its details are long", async () => {
    // every component directory is listed twice: no type-level test, no COMPONENT.md
    const components = Object.fromEntries(
      Array.from({ length: 1500 }, (_, i) => [`components/c${i}/c${i}.tsx`, `export const C${i} = () => null;\n`])
    );
    const root = repo(components, { componentsRoot: "components" });
    const out = await expectWhole(root, ["audit", "--format", "json"], 1);
    expect(JSON.parse(out).metrics.find((m) => m.id === "docs-coverage").detail).toHaveLength(1500);
  });

  // The hook is what blocks the agent, so the message it blocks with has to arrive with
  // its last line, which is the instruction. Attempts are counted per file, so the state
  // is cleared between the two runs to keep the message the same.
  test("the hook's message for a file with hundreds of violations arrives whole and still blocks", async () => {
    const many = Array.from({ length: 800 }, (_, i) => `  <div key={${i}} style={{ color: "#ff0000" }} />`).join("\n");
    const root = repo({ "app/huge.tsx": `export const H = () => (\n<>\n${many}\n</>\n);\n` });
    const file = join(root, "app/huge.tsx");
    const truth = hookWhole(root, file);
    expect(truth.err.length, "the message must be clearly longer than a pipe, or this proves nothing").toBeGreaterThan(PIPE + 16 * 1024);
    rmSync(join(root, ".undrift"), { recursive: true, force: true });
    const got = await hookPiped(root, file);
    expect(got.err.length).toBe(truth.err.length);
    expect(got.err).toBe(truth.err);
    expect(got.err.trimEnd().split("\n").at(-1)).toMatch(/instead of improvising\.$/);
    expect(got.code).toBe(2);
    expect(truth.code).toBe(2);
  });
});
