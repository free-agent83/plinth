// Tailwind 4's own theme variables: `--spacing`, `--radius-md`, `--font-sans` and the rest of the installed
// tailwindcss's theme.css. They exist in every Tailwind 4 app, so a var() to one is not unknown, and they are
// Tailwind's, not the design system's: init leaves Tailwind's stylesheets out of the token set on purpose, so that
// Tailwind's palette is never read as the system's colours. Read from the app's own install, never from a list kept
// here, so the names are the ones that app has.
//
// Only an app that uses Tailwind has them: a system stylesheet, or one it imports, has to import Tailwind's theme
// (`@import "tailwindcss"`), and the package is the one the importing stylesheet resolves, from its own folder, as Node
// would.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readCssTokenDeclarations, stripCssComments } from "./css-tokens.mjs";
import { cssImportRules, resolveCssImport } from "./css-imports.mjs";

/** The installed tailwindcss's package.json above `dir`, as Node would find it, or null. */
function installedTailwind(dir) {
  dir = resolve(dir);
  for (;;) {
    const manifest = join(dir, "node_modules", "tailwindcss", "package.json");
    if (existsSync(manifest)) return manifest;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The version of the Tailwind 4 (or later) installed above `dir`, or null where there is none. */
export function installedTailwindVersion(dir) {
  const manifest = installedTailwind(dir);
  if (!manifest) return null;
  try {
    const { version } = JSON.parse(readFileSync(manifest, "utf8"));
    return Number.parseInt(String(version), 10) >= 4 ? String(version) : null;
  } catch {
    return null;
  }
}

// Packages of the @tailwindcss scope that exist only for Tailwind 4. The plugins that predate it (`forms`, `typography`,
// `aspect-ratio`, `container-queries`, `line-clamp`) are not a sign of it: Tailwind 3 apps use them.
const FOUR_ONLY = new Set(["vite", "postcss", "cli", "node", "browser", "oxide", "webpack"]);

/** [major, minor, patch] of a version or a partial one (`3`, `3.x`), a wildcard or an absent part as null; null where it is not one. */
function versionParts(text) {
  const m = /^[v=]*(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+].*)?$/.exec(text);
  return m ? [1, 2, 3].map((i) => (m[i] === undefined || /^[xX*]$/.test(m[i]) ? null : Number.parseInt(m[i], 10))) : null;
}

/** Can no version of 4 or later satisfy this one comparator of a range? Anything that is not read as one can. */
function excludesFour(token) {
  const bound = /^(<=?)(.+)$/.exec(token);
  if (bound) {
    const [major, minor, patch] = versionParts(bound[2]) ?? [null];
    if (major === null) return false;
    return bound[1] === "<=" ? major <= 3 : major < 4 || (major === 4 && !minor && !patch);
  }
  if (/^>/.test(token)) return false;
  const [major] = versionParts(token.replace(/^[\^~]/, "")) ?? [null];
  return major !== null && major <= 3;
}

/**
 * Can the version range of a dependency on tailwindcss match Tailwind 4 or later? A range that only matches 3 or
 * earlier (`^3.4.1`, `~3.x`, `3.4.1`, `<4`, `>=3 <4`) cannot. A tag, `catalog:`, `workspace:`, `*` and anything that is
 * not read as a range can, since the version is not known.
 */
export function mayBeTailwind4(range) {
  if (typeof range !== "string") return true;
  return range.split("||").some((alternative) => {
    const tokens = alternative.trim().replace(/(<=|>=|<|>|=|\^|~)\s+/g, "$1").split(/\s+/).filter(Boolean);
    // `3.4.1 - 3.9.0`: the upper end is the bound.
    if (tokens.length === 3 && tokens[1] === "-") return !excludesFour(`<=${tokens[2]}`);
    return !tokens.some(excludesFour);
  });
}

/**
 * Does the package.json in `dir` name a dependency that is a sign of Tailwind 4: tailwindcss at a version range that can
 * match 4 or later, or a package that exists only for 4 (`@tailwindcss/vite`, `@tailwindcss/postcss` and the rest)?
 */
export function namesTailwind4(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some((kind) =>
      Object.entries(pkg?.[kind] ?? {}).some(([name, range]) =>
        name === "tailwindcss" ? mayBeTailwind4(range) : name.startsWith("@tailwindcss/") && FOUR_ONLY.has(name.slice(13))
      )
    );
  } catch {
    return false;
  }
}

/** Is Tailwind installed above `dir` at a version below 4 (it has no theme variables there)? False where none is found. */
export function installedTailwindBelow4(dir) {
  const manifest = installedTailwind(dir);
  if (!manifest) return false;
  try {
    return Number.parseInt(String(JSON.parse(readFileSync(manifest, "utf8")).version), 10) < 4;
  } catch {
    return false;
  }
}

// Where Tailwind 4 is there but its theme could not be read (no stylesheet that imports it was found, and the install is
// below the root, as a pnpm workspace has it), a var() to a name in one of Tailwind's theme namespaces may be a variable
// Tailwind writes. These are those namespaces, from the theme.css of Tailwind 4.3.2 (`sample/node_modules/tailwindcss/
// theme.css`): every name in it that is not a colour, and is not in its `reference` blocks (names Tailwind never writes
// out), is the singleton or starts with one of the prefixes.
// tests/framework-tokens.test.mjs compares this list with the installed theme.css, so a namespace Tailwind adds fails
// there. Colours (`--color-*`) are left out, as isFrameworkName leaves them out: Tailwind's palette is not the system's.
const THEME_SINGLETONS = new Set(["--spacing"]);
const THEME_PREFIXES = [
  "--spacing-", "--font-", "--text-", "--tracking-", "--leading-", "--breakpoint-", "--container-", "--radius-", "--shadow-",
  "--inset-shadow-", "--drop-shadow-", "--text-shadow-", "--blur-", "--perspective-", "--aspect-", "--ease-", "--animate-",
  "--default-",
];

/**
 * Could `name` be a variable Tailwind 4 writes, in an app whose theme was not read? `unread` is the contract's
 * `frameworkUnread`: its `names` are the installed theme's own names where an install could be read (so none is
 * invented), or null, and then the namespaces above stand in. A colour is never one.
 */
export function couldBeTailwindName(unread, name) {
  if (!unread || name.startsWith("--color-")) return false;
  if (Array.isArray(unread.names)) return unread.names.includes(name);
  return THEME_SINGLETONS.has(name) || THEME_PREFIXES.some((prefix) => name.startsWith(prefix));
}

const THEME_HEAD = /@theme\b[^{};]*\{/g;

/**
 * The css without its `@theme ... reference` blocks. A `reference` theme is names for utilities to use (`shadow`,
 * `blur`) and Tailwind never writes them out as variables, so `var(--shadow)` does not resolve.
 */
function withoutReferenceThemes(css) {
  let out = "";
  let kept = 0;
  for (const head of css.matchAll(THEME_HEAD)) {
    if (head.index < kept || !/\breference\b/i.test(head[0])) continue;
    let depth = 1;
    let i = head.index + head[0].length;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    out += css.slice(kept, head.index);
    kept = i;
  }
  return out + css.slice(kept);
}

/**
 * @returns {{ path: string, version: string, tokens: Record<string, string> } | null} Tailwind's theme variables as
 *   the tailwindcss installed above `dir` declares them (its `reference` themes left out), or null where no
 *   Tailwind 4 is installed (Tailwind 3 has no theme.css and no `--spacing`).
 */
export function tailwindTheme(dir) {
  const manifest = installedTailwind(dir);
  return manifest ? themeAt(manifest) : null;
}

/** The theme of the tailwindcss whose package.json is `manifest`: see tailwindTheme. */
function themeAt(manifest) {
  let version;
  try {
    version = JSON.parse(readFileSync(manifest, "utf8")).version;
  } catch {
    return null;
  }
  if (!(Number.parseInt(String(version), 10) >= 4)) return null;
  const path = join(dirname(manifest), "theme.css");
  if (!existsSync(path)) return null;
  try {
    const css = withoutReferenceThemes(stripCssComments(readFileSync(path, "utf8")));
    const tokens = Object.fromEntries(readCssTokenDeclarations(css));
    // A theme that declares nothing (an empty file, text that is not CSS) is a theme that was not read, as a missing
    // theme.css is. Taken as a theme it said Tailwind writes no names, and every real name was reported as unknown.
    return Object.keys(tokens).length === 0 ? null : { path, version, tokens };
  } catch {
    return null;
  }
}

/** The folders a workspace declares (`workspaces` in package.json, `packages` in pnpm-workspace.yaml) that exist under `root`. */
function workspaceFolders(root) {
  const patterns = [];
  try {
    const { workspaces } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    for (const entry of Array.isArray(workspaces) ? workspaces : workspaces?.packages ?? []) if (typeof entry === "string") patterns.push(entry);
  } catch {
    // no package.json, or not json: no workspaces from it
  }
  try {
    const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
    const block = /^packages:[ \t]*\r?\n((?:[ \t]+-[^\n]*\r?\n?)+)/m.exec(yaml)?.[1] ?? "";
    for (const m of block.matchAll(/^[ \t]+-[ \t]*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/gm)) patterns.push(m[1] ?? m[2] ?? m[3]);
  } catch {
    // no pnpm-workspace.yaml
  }
  const subfolders = (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && e.name !== "node_modules" && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  };
  // `*` is any one folder and `**` any depth (to three levels, as a workspace has them). A pattern that excludes a folder
  // (`!apps/api`) is skipped: a folder that has an install is one to read from either way.
  // Each pattern is capped on its own (a hundred folders under `packages/*/*` must not hide the ones `apps/*` names).
  const expand = (out, dir, segments, depth) => {
    if (out.size >= 500) return;
    if (segments.length === 0) {
      out.add(dir);
      return;
    }
    const [head, ...rest] = segments;
    if (head === "**") {
      expand(out, dir, rest, depth);
      if (depth < 3) for (const name of subfolders(dir)) expand(out, join(dir, name), segments, depth + 1);
    } else if (head === "*") {
      for (const name of subfolders(dir)) expand(out, join(dir, name), rest, depth);
    } else if (head !== "." && head !== "") {
      expand(out, join(dir, head), rest, depth);
    } else {
      expand(out, dir, rest, depth);
    }
  };
  const all = new Set();
  for (const pattern of patterns) {
    if (pattern.startsWith("!") || pattern.includes("..")) continue;
    const out = new Set();
    expand(out, root, pattern.replace(/^\.\//, "").split("/").map((part) => (/[*?{[]/.test(part) && part !== "*" && part !== "**" ? "*" : part)), 0);
    for (const dir of out) all.add(dir);
  }
  return [...all].filter((dir) => existsSync(dir));
}

/** Every `tailwindcss@<version>` folder in the pnpm stores at or above `root`, the highest version first. */
function pnpmStoreInstalls(root) {
  const found = [];
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const store = join(dir, "node_modules", ".pnpm");
    try {
      for (const name of readdirSync(store)) {
        if (name.startsWith("tailwindcss@")) found.push(join(store, name, "node_modules", "tailwindcss", "package.json"));
      }
    } catch {
      // no store here
    }
    if (dirname(dir) === dir) break;
  }
  const version = (manifest) => /tailwindcss@(\d+(?:\.\d+)*)/.exec(manifest)?.[1] ?? "0";
  return found.sort((a, b) => version(b).localeCompare(version(a), undefined, { numeric: true }));
}

/** Which of two versions is higher, as a sign: the numbers of the core first, and a pre-release below its release. */
function compareVersions(a, b) {
  const core = (v) => [1, 2, 3].map((i) => Number.parseInt(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v)?.[i] ?? "0", 10));
  const [x, y] = [core(a), core(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return Number(!String(a).includes("-")) - Number(!String(b).includes("-"));
}

/**
 * Where the root resolves no tailwindcss, one below it: resolved from the real folder of each stylesheet in
 * `stylesheets` (a link into a workspace package, as pnpm makes), then from each workspace package's folder, then in
 * pnpm's store. Of the Tailwind 4 or later found, the highest version wins (the first found, where two are the same)
 * and only its theme is read; where only a Tailwind below 4 is found, that is returned without a theme, as the version
 * says there is no Tailwind 4 theme to read.
 * @returns {{ version: string, tokens: Record<string, string> | null } | null} null where none is found anywhere.
 */
export function tailwindInstallBelow(root, stylesheets) {
  let below = null;
  let best = null;
  const consider = (manifest) => {
    let version;
    try {
      version = String(JSON.parse(readFileSync(manifest, "utf8")).version);
    } catch {
      return;
    }
    if (Number.parseInt(version, 10) >= 4) {
      if (!best || compareVersions(version, best.version) > 0) best = { version, manifest };
    } else {
      below ??= { version, tokens: null };
    }
  };
  const folders = function* () {
    for (const file of stylesheets) {
      try {
        yield dirname(realpathSync(file));
      } catch {
        yield dirname(file);
      }
    }
    yield* workspaceFolders(root);
  };
  const seen = new Set();
  for (const dir of folders()) {
    const manifest = installedTailwind(dir);
    if (!manifest || seen.has(manifest)) continue;
    seen.add(manifest);
    consider(manifest);
  }
  for (const manifest of pnpmStoreInstalls(root)) consider(manifest);
  return best ? { version: best.version, tokens: themeAt(best.manifest)?.tokens ?? null } : below;
}

// What a stylesheet imports to get Tailwind's theme: the whole of it, or its theme alone.
const THEME_SPECIFIERS = new Set(["tailwindcss", "tailwindcss/index.css", "tailwindcss/theme", "tailwindcss/theme.css"]);

/**
 * How an import of Tailwind's theme is written: `prefix(tw)` renames every variable (`--tw-spacing`, and no plain
 * name), and `theme(reference)` (or a bare `reference`) brings the names for utilities to use and writes no variable.
 */
function themeOptions(options) {
  const prefix = /\bprefix\(\s*([A-Za-z0-9_-]+)\s*\)/i.exec(options)?.[1] ?? null;
  const theme = /\btheme\(([^)]*)\)/i.exec(options)?.[1] ?? "";
  return { prefix, reference: /\breference\b/i.test(theme) || /(?:^|\s)reference(?:\s|$)/i.test(options) };
}

/** Tailwind's theme from the install `file`'s folder resolves, then the one its real folder does (a linked package). */
function themeFrom(file) {
  const real = (() => {
    try {
      return dirname(realpathSync(file));
    } catch {
      return dirname(file);
    }
  })();
  return tailwindTheme(dirname(file)) ?? (real === dirname(file) ? null : tailwindTheme(real));
}

/** Tailwind's variables as written with the prefix on the import: `--spacing` is `--tw-spacing` under `prefix(tw)`. */
const withPrefix = (tokens, prefix) =>
  prefix ? Object.fromEntries(Object.entries(tokens).map(([name, value]) => [`--${prefix}-${name.slice(2)}`, value])) : tokens;

/**
 * Tailwind's theme for an app whose system stylesheets are `stylesheets` (absolute paths): the first import of it
 * found in them or in any stylesheet they import, in the order the browser reads them, and the install that stylesheet
 * resolves, from its own folder. The imports are followed with the reader `init` uses, so a package's stylesheet
 * (`@import "@acme/config/index.css"`) is reached as it is there. `prefix` is the prefix on that import, or null. Null
 * when none imports Tailwind's theme: an install that no stylesheet reaches is not an app that uses Tailwind, a
 * reference import writes no variable, and a file that cannot be read says nothing.
 * `start` is the stylesheet of `stylesheets` the import was reached from (the one to list, when it is not listed).
 * @returns {{ path: string, version: string, tokens: Record<string, string>, prefix: string | null, start: string } | null}
 */
export function tailwindThemeFor(stylesheets) {
  const seen = new Set();
  const visit = (file) => {
    let key = file;
    try {
      key = realpathSync(file);
    } catch {
      // not there: read below says so
    }
    if (seen.has(key)) return null;
    seen.add(key);
    let css;
    try {
      css = readFileSync(file, "utf8");
    } catch {
      return null;
    }
    for (const rule of cssImportRules(stripCssComments(css))) {
      if (THEME_SPECIFIERS.has(rule.spec)) {
        const { prefix, reference } = themeOptions(rule.options);
        if (reference) continue;
        const theme = themeFrom(file);
        if (theme) return { ...theme, tokens: withPrefix(theme.tokens, prefix), prefix };
        continue;
      }
      const target = resolveCssImport(file, rule.spec);
      if (typeof target !== "string") continue;
      const found = visit(target);
      if (found) return found;
    }
    return null;
  };
  for (const file of stylesheets) {
    const found = visit(file);
    if (found) return { ...found, start: file };
  }
  return null;
}

/**
 * Tailwind's theme for an app whose config lists no stylesheet that reaches it: the project's own stylesheets that
 * import it. `stylesheets` are paths relative to `root` (the scan the gate and `init` already make, which leaves out
 * node_modules, build output and hidden folders), and only a file that has an `@import` is followed. They are
 * tried shallowest first, then by name, so the answer does not depend on the order a directory happens to list.
 * Imports (through packages too), `prefix()` and `reference` are read as tailwindThemeFor reads them.
 * @returns {ReturnType<typeof tailwindThemeFor>}
 */
export function tailwindThemeFromProject(root, stylesheets) {
  const depth = (rel) => rel.split("/").length;
  const candidates = [];
  for (const rel of [...stylesheets].sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0))) {
    if (!/\.css$/i.test(rel)) continue;
    const abs = resolve(root, rel);
    let css;
    try {
      css = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    // Any stylesheet that imports another is a place to start: a system reaches Tailwind through a package's stylesheet
    // (`@import "@acme/ds/index.css"`), so the one that names tailwindcss is often not the one the app writes.
    if (/@import/i.test(css)) candidates.push(abs);
  }
  return tailwindThemeFor(candidates);
}

// What a namespace reset leaves alone, as Tailwind's own `clearNamespace` has it (the installed tailwindcss's
// theme store): `--font-*: initial` keeps `--font-weight-*` and `--font-size-*`, `--text-*` keeps `--text-shadow-*`
// and the rest. tests/framework-tokens.test.mjs compares this with the installed Tailwind's compiler.
export const KEPT_BY_RESET = {
  "--font": ["--font-weight", "--font-size"],
  "--inset": ["--inset-shadow", "--inset-ring"],
  "--text": [
    "--text-color", "--text-decoration-color", "--text-decoration-thickness", "--text-indent", "--text-shadow",
    "--text-underline-offset",
  ],
  "--grid-column": ["--grid-column-start", "--grid-column-end"],
  "--grid-row": ["--grid-row-start", "--grid-row-end"],
};

/**
 * Does a reset in an `@theme` block (`--spacing: initial`, `--radius-*: initial`, `--*: initial`) remove `name`?
 * Tailwind's rule: `--ns-*` removes every name that starts with `--ns` (so `--spacing-*` takes `--spacing` too),
 * except the names its table keeps; `--*` removes all; a plain name removes that name.
 */
export function resetCovers(resets, name) {
  return (resets ?? []).some((reset) => {
    if (reset === "--*") return true;
    if (!reset.endsWith("-*")) return reset === name;
    const prefix = reset.slice(0, -2);
    return name.startsWith(prefix) && !(KEPT_BY_RESET[prefix] ?? []).some((kept) => name.startsWith(kept));
  });
}

/**
 * Is `name` one of Tailwind's own theme variables in this app? It is in the contract's `frameworkTokens` (with the
 * prefix the import gave it, if any), it is not in the colour namespace (Tailwind's palette is not the system's, so a
 * var() to one stays reported), and the system's own `@theme` has not reset it. Resets are written without a prefix.
 */
export function isFrameworkName(contract, name) {
  if (!(name in (contract.frameworkTokens ?? {}))) return false;
  const prefix = contract.frameworkPrefix;
  const plain = prefix ? `--${name.slice(prefix.length + 3)}` : name;
  return !plain.startsWith("--color-") && !resetCovers(contract.paletteResets, plain);
}
