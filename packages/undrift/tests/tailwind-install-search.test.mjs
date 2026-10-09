// Where Tailwind 4 is installed below the root (a workspace, pnpm's store) and no stylesheet that imports it is found,
// the install is looked for, and its own names are the ones set aside. These pin the search itself: which install wins
// when there are several, which folders a workspace declares, where the store is, and what a theme that holds no
// names counts as. Each test names the change that must fail it.
import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadContract } from "../src/contract.mjs";
import { gateSource } from "../src/gate.mjs";
import { mayBeTailwind4 } from "../src/readers/tailwind-theme.mjs";

const THEME = `@theme default {
  --spacing: 0.25rem;
  --radius-md: 0.375rem;
  --font-sans: ui-sans-serif, system-ui, sans-serif;
}`;
// An older theme: it has not got --radius-md, so which install was read shows in what is reported.
const OLD_THEME = `@theme default {\n  --spacing: 0.25rem;\n}`;
const OWN = ":root { --primary: oklch(0.2 0 0); }";
const SIGN = JSON.stringify({ devDependencies: { tailwindcss: "^4.0.0" } });
const NO_SHEET = { "lib/dist/styles.css": OWN };

/**
 * A repository for a design system whose own stylesheet does not reach Tailwind. `files` is path to text, `installs` is
 * folder to `{ version, theme }` of a tailwindcss installed in that folder's node_modules (the folder may be a path
 * under `node_modules/.pnpm` for a store), `links` is link path to target, and the config is at `configAt`.
 */
function repo({ files = {}, installs = {}, links = {}, configAt = "", tokensCss = "lib/dist/styles.css" }) {
  const root = mkdtempSync(join(tmpdir(), "u-twsearch-"));
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(files)) put(path, text);
  for (const [dir, { version, theme = THEME }] of Object.entries(installs)) {
    put(join(dir, "node_modules", "tailwindcss", "package.json"), JSON.stringify({ name: "tailwindcss", version }));
    if (theme !== null) put(join(dir, "node_modules", "tailwindcss", "theme.css"), theme);
  }
  for (const [link, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, link)), { recursive: true });
    symlinkSync(join(root, target), join(root, link));
  }
  put(join(configAt, "undrift.config.json"), JSON.stringify({ system: "@/components/ui", tokensCss }));
  return loadContract(join(root, configAt, "undrift.config.json"));
}
const reported = (contract, name) =>
  gateSource(`const p = <div style={{ gap: "var(${name})" }} />;`, { rules: ["no-unknown-tokens"], contract, fileName: "t.tsx" }).map((v) => v.found);
const asideNames = (contract, name) =>
  gateSource(`const p = <div style={{ gap: "var(${name})" }} />;`, { rules: ["no-unknown-tokens"], contract, fileName: "t.tsx" }).notChecked.map((n) => n.found);
const workspace = (workspaces) => ({ ...NO_SHEET, "package.json": JSON.stringify({ devDependencies: { tailwindcss: "catalog:" }, workspaces }) });

test("a Tailwind 3 found first does not stop the search: the 4 beside it is the one read", () => {
  const c = repo({
    files: workspace(["apps/*"]),
    installs: { "apps/a-legacy": { version: "3.4.17" }, "apps/web": { version: "4.3.2" } },
  });
  expect(c.frameworkUnread.version).toBe("4.3.2");
  expect(c.frameworkUnread.names).toContain("--spacing");
  expect(reported(c, "--spacing")).toEqual([]);
});

test("of several Tailwind 4 in a workspace, the highest version is read, wherever it is found", () => {
  const files = workspace(["apps/*"]);
  const c = repo({ files, installs: { "apps/a": { version: "4.0.0", theme: OLD_THEME }, "apps/web": { version: "4.3.2" } } });
  expect(c.frameworkUnread.version).toBe("4.3.2");
  // The older theme has no --radius-md: reading it would report a name that the install in use writes.
  expect(reported(c, "--radius-md")).toEqual([]);
  // The order of the folders does not decide it.
  const reversed = repo({ files, installs: { "apps/a": { version: "4.3.2" }, "apps/web": { version: "4.0.0", theme: OLD_THEME } } });
  expect(reversed.frameworkUnread.version).toBe("4.3.2");
  // Numerically: 4.10.0 is above 4.9.0.
  const numeric = repo({ files, installs: { "apps/a": { version: "4.9.0", theme: OLD_THEME }, "apps/web": { version: "4.10.0" } } });
  expect(numeric.frameworkUnread.version).toBe("4.10.0");
  // A workspace install and one in pnpm's store compete on version alone.
  const mixed = repo({
    files, installs: { "apps/a": { version: "4.3.2" }, "node_modules/.pnpm/tailwindcss@4.9.0": { version: "4.9.0" } },
  });
  expect(mixed.frameworkUnread.version).toBe("4.9.0");
});

test("a workspace of apps/** reaches an install in a folder below apps", () => {
  const c = repo({ files: workspace({ packages: ["apps/**"] }), installs: { "apps/web": { version: "4.3.2" } } });
  expect(c.frameworkUnread.version).toBe("4.3.2");
  expect(c.frameworkUnread.names).toContain("--radius-md");
});

test("pnpm's store is looked for above the root, and not only at it", () => {
  const c = repo({
    files: { "proj/package.json": SIGN, "proj/lib/dist/styles.css": OWN },
    installs: { "node_modules/.pnpm/tailwindcss@4.3.2": { version: "4.3.2" } },
    configAt: "proj", tokensCss: "lib/dist/styles.css",
  });
  expect(c.frameworkUnread.version).toBe("4.3.2");
  expect(c.frameworkUnread.names).toContain("--spacing");
});

test.skipIf(process.platform === "win32")("a workspace folder that is a link is matched by *, as pnpm makes them", () => {
  const c = repo({
    files: workspace(["apps/*"]),
    installs: { "real/web": { version: "4.3.2" } },
    links: { "apps/web": "real/web" },
  });
  expect(c.frameworkUnread.version).toBe("4.3.2");
  expect(c.frameworkUnread.names).toContain("--spacing");
});

// A pattern that climbs out of the repository names folders that are not its own, and a workspace's folders are the
// repository's. It is skipped, so an install outside is not read (and the namespaces stand in).
test("a workspace pattern that climbs out of the repository is skipped, and an install outside it is not read", () => {
  const c = repo({
    files: { "proj/package.json": JSON.stringify({ devDependencies: { tailwindcss: "catalog:" }, workspaces: ["../sibling/*"] }), "proj/lib/dist/styles.css": OWN },
    installs: { "sibling/web": { version: "4.3.2" } },
    configAt: "proj",
  });
  expect(c.frameworkUnread).toEqual({ version: null, names: null });
});

test("no whitespace is needed or forbidden after an operator in a version range", () => {
  expect(mayBeTailwind4("> 3")).toBe(true);
  expect(mayBeTailwind4(">3")).toBe(true);
  expect(mayBeTailwind4("< 4")).toBe(false);
  expect(mayBeTailwind4("<4")).toBe(false);
  expect(mayBeTailwind4(">=  3 <  4")).toBe(false);
});

// A theme.css that declares nothing (an empty file, one that is not CSS, one of only reference blocks) is not a theme
// that says Tailwind writes no names: it is a theme that was not read, and the namespaces stand in. Reading it as empty
// reported every real name as an unknown token.
test.each([["an empty file", ""], ["text that is not CSS", "this is not a stylesheet {{"], ["a theme of only comments", "/* nothing */"]])(
  "a theme.css that is %s counts as unread, at the root and below it",
  (_what, theme) => {
    const atRoot = repo({ files: { ...NO_SHEET, "package.json": SIGN }, installs: { "": { version: "4.3.2", theme } } });
    expect(atRoot.frameworkUnread).toEqual({ version: "4.3.2", names: null });
    expect(reported(atRoot, "--spacing")).toEqual([]);
    expect(asideNames(atRoot, "--spacing")).toEqual(["--spacing"]);
    expect(reported(atRoot, "--brand-foo")).toEqual(["--brand-foo"]);
    const below = repo({ files: workspace(["apps/*"]), installs: { "apps/web": { version: "4.3.2", theme } } });
    expect(below.frameworkUnread).toEqual({ version: "4.3.2", names: null });
    expect(reported(below, "--radius-md")).toEqual([]);
    expect(reported(below, "--brand-foo")).toEqual(["--brand-foo"]);
  },
);

test("an empty theme.css behind an import of Tailwind's theme is unread too, and not an empty set of names", () => {
  const c = repo({
    files: { "lib/dist/styles.css": `@import "tailwindcss";\n${OWN}` },
    installs: { "": { version: "4.3.2", theme: "" } },
  });
  expect(c.frameworkSource).toBeNull();
  expect(c.frameworkUnread).toEqual({ version: "4.3.2", names: null });
  expect(reported(c, "--spacing")).toEqual([]);
});

// The folders a workspace declares are capped, and the cap is on each pattern: one pattern that matches a great many
// folders must not hide the folders of the next.
test("a pattern that matches very many folders does not hide the folders of the next pattern", () => {
  const files = { ...workspace(["packages/*/*", "apps/*"]) };
  const installs = { "apps/web": { version: "4.3.2" } };
  const c = repo({ files, installs, links: {} });
  expect(c.frameworkUnread.version).toBe("4.3.2");
  // The same with nine hundred folders under the first pattern.
  const many = repo({ files: { ...files, ...Object.fromEntries(Array.from({ length: 900 }, (_, i) => [`packages/g${String(i % 30).padStart(2, "0")}/p${String(Math.floor(i / 30)).padStart(2, "0")}/package.json`, "{}"])) }, installs });
  expect(many.frameworkUnread).toEqual(expect.objectContaining({ version: "4.3.2" }));
  expect(many.frameworkUnread.names).toContain("--radius-md");
});
