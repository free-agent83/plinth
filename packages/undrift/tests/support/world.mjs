// A repository, and a folder beside it that holds what its links lead to, for the tests of what the
// gate does with a link: `<base>/repo` with a config, a clean app/a.tsx and whatever a test adds,
// and `<base>/elsewhere` with source and other files behind the links a test makes.
import { execFileSync, exited } from "./exec.mjs";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const bin = resolve(here, "../../bin/undrift.mjs");
export const HOOK = resolve(here, "../../hooks/undrift-hook.mjs");
export const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
export const DASH = /[\u2014\u2013]/;
export const BAD = `export const B = () => <div style={{ color: "#ff0000" }} />;\n`;
export const GOOD = `export const G = () => <div className="bg-primary p-4" />;\n`;
export const SCRIPT_BAD = `export const brand = "#ff0000";\n`;
export const posix = process.platform !== "win32";
export const asRoot = process.getuid?.() === 0; // a process that runs as root can read a directory whatever its mode
export const SILENT = { code: 0, stdout: "", stderr: "" };

export const cli = (root, argv) => {
  try {
    const stdout = strip(execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 }));
    return { code: 0, stdout, out: stdout };
  } catch (e) {
    const stdout = strip(e.stdout ?? "");
    return { code: exited(e), stdout, out: stdout + strip(e.stderr ?? "") };
  }
};
export const json = (root, argv = []) => JSON.parse(cli(root, ["gate", "--format", "json", ...argv]).stdout);
export const hook = (root, file, env = {}) => {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_input: { file_path: file } }), cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000, env: { ...process.env, ...env } }), stderr: "" };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};
export const context = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;

export const write = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};

/**
 * `include` may be a function of `{ root, outside, base }`, for a pattern that names a place by its
 * absolute path. `links` maps a path in the repository to what it links to: "@x" is `elsewhere/x`,
 * anything else is the target as written. `outsideFiles` adds to what `elsewhere` holds (ui/x.tsx with a raw colour,
 * ui/y.css, ui/deep/z.tsx, ui/lib.ts, lib.ts and notes.md are always there).
 */
export function world({ links = {}, files = {}, over = {}, include = ["app/**/*.tsx"], outsideFiles = {} } = {}) {
  const base = mkdtempSync(join(tmpdir(), "u-links-"));
  const root = join(base, "repo");
  const outside = join(base, "elsewhere");
  write(root, "ds.css", ":root{--color-primary:#3b5bdb}");
  write(root, "app/a.tsx", GOOD);
  write(outside, "ui/x.tsx", BAD);
  write(outside, "ui/y.css", ".a{color:#f00}\n");
  write(outside, "ui/deep/z.tsx", BAD);
  write(outside, "ui/lib.ts", SCRIPT_BAD);
  write(outside, "lib.ts", SCRIPT_BAD);
  write(outside, "notes.md", "# notes\n");
  for (const [rel, body] of Object.entries(outsideFiles)) write(outside, rel, body);
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  for (const [rel, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    symlinkSync(target.startsWith("@") ? join(outside, target.slice(1)) : target, join(root, rel));
  }
  write(
    root,
    "undrift.config.json",
    JSON.stringify({
      system: "@acme/ds",
      tokensCss: "ds.css",
      ignore: { "ds.css": "the token source" },
      profiles: { app: { include: typeof include === "function" ? include({ root, outside, base }) : include, rules: ["no-raw-colors"] } },
      ...over,
    })
  );
  return { root, outside, base };
}

/** The target as a report shows it: relative to the repository. */
export const shown = (w, sub) => relative(join(w.base, "repo"), join(w.outside, sub)).split("\\").join("/");
