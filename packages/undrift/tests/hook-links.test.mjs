// Two lines in the hook look redundant and are not. `root = realpathSync(contract.root)` is what lets a file written
// through a link to the whole repository be placed inside it (the config is found beside the link, so contract.root is
// the link's own spelling), and `realFile` in the list of names is what lets an include written as an absolute real
// path reach a file the agent wrote through a link. Each is held here by a real process on fresh repositories, so a
// later tidy that removes either fails a test instead of silently letting these files through unchecked.
import { expect, test } from "vitest";
import { execFileSync, exited } from "./support/exec.mjs";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/undrift-hook.mjs", import.meta.url));
const BAD = `export const G = () => <div style={{ color: "#ff0000" }} />;\n`;

const run = (cwd, file) => {
  try {
    const stdout = execFileSync("node", [HOOK], {
      input: JSON.stringify({ tool_input: { file_path: file } }),
      cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: exited(e), stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
};
const told = (r) => (r.stdout === "" ? "" : JSON.parse(r.stdout).hookSpecificOutput.additionalContext);

/** A fresh repository (resolved, so its real path is what the process sees) and a folder of links beside it. */
function world(include = ["app/**/*.tsx"]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "u-hook-lk-")));
  mkdirSync(join(root, "app"), { recursive: true });
  mkdirSync(join(root, "other"), { recursive: true });
  writeFileSync(join(root, "ds.css"), ":root{--color-primary:#3b5bdb}");
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
    system: "@acme/ds", tokensCss: "ds.css",
    profiles: { app: { include, rules: ["no-raw-colors"] } },
  }));
  const links = realpathSync(mkdtempSync(join(tmpdir(), "u-hook-lk-links-")));
  mkdirSync(join(links, "links"));
  return { root, links: join(links, "links") };
}

// A notice is told once per version of the config, so each starting folder gets a repository of its own.
test.skipIf(process.platform === "win32")(
  "a stylesheet and an uncovered file written through a link to the whole repository are told of, from either folder",
  () => {
    for (const startIn of ["the real root", "the link"]) {
      const { root, links } = world(["app/**/*.tsx", "app/**/*.css"]);
      const link = join(links, "r");
      symlinkSync(root, link);
      writeFileSync(join(root, "app/x.css"), ".a{color:red}");
      writeFileSync(join(root, "other/u.tsx"), `export const U = () => <div className="bg-primary" />;\n`);
      const cwd = startIn === "the link" ? link : root;
      const css = run(cwd, join(link, "app/x.css"));
      expect(css.code, startIn).toBe(0);
      expect(told(css), startIn).toMatch(/does not check stylesheets yet/);
      const uncovered = run(cwd, join(link, "other/u.tsx"));
      expect(uncovered.code, startIn).toBe(0);
      expect(told(uncovered), startIn).toMatch(/did not check/);
    }
  },
);

test.skipIf(process.platform === "win32")(
  "an include written as an absolute real path gates a file the agent wrote through a link to the repository",
  () => {
    const { root, links } = world();
    // The include names the repository by its absolute real path, so only the file's real path can match it.
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
      system: "@acme/ds", tokensCss: "ds.css",
      profiles: { app: { include: [`${root}/app/**/*.tsx`], rules: ["no-raw-colors"] } },
    }));
    const link = join(links, "r");
    symlinkSync(root, link);
    writeFileSync(join(root, "app/g.tsx"), BAD);
    expect(run(root, join(link, "app/g.tsx")).code).toBe(2);
    expect(run(link, join(link, "app/g.tsx")).code).toBe(2);
  },
);

test.skipIf(process.platform === "win32")(
  "an include of an absolute folder outside the repository gates a file written through a link to that folder",
  () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "u-hook-lk-out-")));
    const { root, links } = world([`${outside}/**/*.tsx`]);
    const link = join(links, "o");
    symlinkSync(outside, link);
    writeFileSync(join(outside, "h.tsx"), BAD);
    const r = run(root, join(link, "h.tsx"));
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/#ff0000/);
  },
);
