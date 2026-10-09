// Loads the "contract": the design system's own artifacts (tokens, catalog,
// rule config) normalized into the object every undrift command consumes.
// The contract is derived from the system, never hand-authored twice.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename, relative } from "node:path";
import { readCssTokenDeclarationsWithContext, readCssTokenResets, stripCssComments } from "./readers/css-tokens.mjs";
import { tokenLayers } from "./layers.mjs";
import { readComponentSource } from "./readers/component-names.mjs";
import { tailwindTheme, tailwindThemeFor, tailwindThemeFromProject, tailwindInstallBelow, installedTailwindVersion, installedTailwindBelow4, namesTailwind4 } from "./readers/tailwind-theme.mjs";
import { findSourceFiles } from "./unchecked.mjs";
import { coveredByListed } from "./readers/package-folder.mjs";
import { ALL_RULES } from "./gate.mjs";

const DEFAULT_CONFIG_NAME = "undrift.config.json";

/** Walk up from `start` until a undrift.config.json is found. */
export function findConfig(start) {
  let dir = resolve(start);
  for (;;) {
    const candidate = resolve(dir, DEFAULT_CONFIG_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Parse CATALOG.md's tables into [{ name, status, for, notFor, tier }].
 * The catalog is the agent's index; undrift reuses it verbatim so the
 * gate's suggestions always match what the docs say.
 */
export function parseCatalog(markdown) {
  const rows = [];
  let tier = null;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^##\s+(.+)/);
    if (heading) tier = heading[1].trim().toLowerCase();
    const cells = line.match(/^\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|$/);
    if (!cells) continue;
    const name = cells[1].trim();
    if (name === "Component" || /^-+$/.test(name)) continue;
    rows.push({
      name,
      status: cells[2].trim(),
      for: cells[3].trim(),
      notFor: cells[4].trim(),
      tier,
    });
  }
  return rows;
}

// A relative glob written with a leading "./" (Tailwind's convention, and many
// editors') comes back from fast-glob as "./app/a.tsx", which never equals the
// "app/a.tsx" every other list of files uses. Every covered file then read as
// covered by no profile, and the hook told the agent it had not checked a file it
// should have blocked. Dropped here, from every include and every ignore glob, so
// nothing downstream has to know. It goes after a leading "!" too, and nowhere else. Every
// slash after the dot goes with it: ".//app/**" is the same path as "./app/**", and dropping
// "./" once left "/app/**", a pattern for the root of the filesystem that matches nothing.
const dropDotSlash = (glob) => glob.replace(/^(!?)(?:\.\/+)+/, "$1");

/**
 * `ignore`: { glob: reason }. Files the gate is told not to account for as "not
 * covered": each glob comes with the reason it is not checked. A blank reason is
 * a config error, the same stance as a <Missing> gap with no reason and a
 * `token-exempt:` comment with none. An acknowledgement that does not say why is
 * the cheapest way to make a blind spot look like a decision.
 */
function readIgnore(config, configPath) {
  if (config.ignore === undefined) return {};
  const where = basename(configPath);
  const raw = config.ignore;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `${where}: "ignore" must be an object mapping a glob to the reason those files are not checked, ` +
      `for example { "src/legacy/**": "replaced next quarter" }.`
    );
  }
  const ignore = {};
  for (const [glob, reason] of Object.entries(raw)) {
    if (glob.trim() === "" || dropDotSlash(glob).trim() === "") {
      throw new Error(`${where}: "ignore" has an empty glob. Give the files it should cover, with a reason.`);
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new Error(
        `${where}: "ignore" entry "${glob}" needs a reason. ` +
        `Say why these files are not checked, as a <Missing> gap and a token-exempt comment must.`
      );
    }
    ignore[dropDotSlash(glob)] = reason.trim();
  }
  return ignore;
}

// Edit distance, for "did you mean". A misspelt rule name is the likeliest mistake
// in a config, and the British spelling of a colour rule is the likeliest misspelling.
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}
const closestRule = (name) => {
  if (typeof name !== "string") return null;
  const best = ALL_RULES.map((rule) => [rule, distance(name, rule)]).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] <= 3 ? best[0] : null;
};

/**
 * A profile's `rules`. Absent means the default rules. Anything else has to be a list of
 * names that exist, and not an empty one: a misspelt name or `[]` runs no rule, and
 * the run used to read as clean. A config that cannot mean what it says is a config
 * error, the same stance as a blank `ignore` reason.
 */
function readRules(rules, name, where) {
  if (!Array.isArray(rules)) {
    throw new Error(
      `${where}: profile "${name}" has "rules" that is not a list. ` +
      `Give a list of rule names, or omit "rules" to apply the default rules.`
    );
  }
  if (rules.length === 0) {
    throw new Error(
      `${where}: profile "${name}" has an empty "rules" list, which would turn every rule off. ` +
      `Omit "rules" to apply the default rules.`
    );
  }
  const unknown = rules.filter((rule) => !ALL_RULES.includes(rule));
  if (unknown.length > 0) {
    const hints = unknown
      .map((rule) => [rule, closestRule(rule)])
      .filter(([, near]) => near)
      .map(([rule, near]) => `Did you mean "${near}" for "${rule}"? `)
      .join("");
    throw new Error(
      `${where}: profile "${name}" lists ${unknown.length === 1 ? "a rule that does not exist" : "rules that do not exist"}: ` +
      `${unknown.map((rule) => JSON.stringify(rule)).join(", ")}. ${hints}` +
      `The rules are ${ALL_RULES.join(", ")}.`
    );
  }
  return rules;
}

/**
 * A profile's `include`: one glob, or a list of them. A single string was always
 * accepted (fast-glob takes either), so it stays one glob. Anything else cannot be
 * globbed and is a config error that names the profile, never a TypeError from
 * whichever later step first treats it as a list.
 */
function readInclude(include, name, where) {
  if (include === undefined) {
    throw new Error(`${where}: profile "${name}" has no "include". Give the globs it covers, for example ["src/**/*.tsx"].`);
  }
  const list = typeof include === "string" ? [include] : include;
  if (!Array.isArray(list)) {
    throw new Error(
      `${where}: profile "${name}" has an "include" that is not a glob or a list of globs. ` +
      `Give a list, for example ["src/**/*.tsx"].`
    );
  }
  // What is read, and what was written: a report that names an include names the one the
  // person wrote, not the one it was turned into.
  const cleaned = list.map((glob, i) => {
    const dropped = typeof glob === "string" ? dropDotSlash(glob) : glob;
    if (typeof dropped !== "string" || dropped.replace(/^!/, "").trim() === "") {
      throw new Error(
        `${where}: profile "${name}" has an "include" entry that is not a glob (entry ${i + 1}: ${JSON.stringify(glob)}). ` +
        `Each entry is a non-empty string such as "src/**/*.tsx".`
      );
    }
    return dropped;
  });
  return { include: cleaned, written: [...list] };
}

/**
 * What counts as the design system's imports. Absent, it is `system` itself. Present, it
 * replaces `system`, whatever it holds: a list, or one string (which was read as a list and
 * died with a TypeError). A blank entry is no import at all, and matches nothing, so it is
 * dropped and counted: a list of nothing but blanks is reported as that, not as running.
 * Anything that is not a list of strings is a config error.
 */
function readSystemImports(config, where) {
  if (config.systemImports === undefined) {
    return { list: config.system ? [config.system] : [], given: false, blank: 0 };
  }
  const raw = typeof config.systemImports === "string" ? [config.systemImports] : config.systemImports;
  if (!Array.isArray(raw)) {
    throw new Error(`${where}: "systemImports" must be a list of import specifiers, for example ["@acme/ds"].`);
  }
  const list = [];
  let blank = 0;
  raw.forEach((entry, i) => {
    if (typeof entry !== "string") {
      throw new Error(
        `${where}: "systemImports" entry ${i + 1} is not an import specifier (${JSON.stringify(entry)}). ` +
        'Each entry is a package name such as "@acme/ds".'
      );
    }
    if (entry.trim() === "") blank += 1;
    else list.push(entry.trim());
  });
  return { list, given: true, blank };
}

/**
 * `primitives`: the design system's own list of its primitives, as token names or globs where `*` stands for any
 * run of characters (`--color-primitive-*`). Absent is `null`: nothing is declared, and no-primitive-tokens does
 * not run. Anything else has to be a non-empty list of names starting with `--`: a list that cannot name a token
 * would declare nothing and read as a declaration, the stance `rules` and `ignore` take.
 */
function readPrimitives(config, where) {
  if (config.primitives === undefined) return null;
  const raw = config.primitives;
  if (!Array.isArray(raw)) {
    throw new Error(
      `${where}: "primitives" must be a list of token names or globs, for example ["--color-primitive-*"]. ` +
      `Omit it where the system declares no primitives.`
    );
  }
  if (raw.length === 0) {
    throw new Error(
      `${where}: empty "primitives" list. Name the tokens that are the system's primitives, ` +
      `or omit "primitives" where it declares none.`
    );
  }
  return raw.map((entry, i) => {
    if (typeof entry !== "string" || !entry.trim().startsWith("--")) {
      throw new Error(
        `${where}: "primitives" entry ${i + 1} is not a token name (${JSON.stringify(entry)}). ` +
        'Each entry is a custom property name or a glob, which must start with --, such as "--color-primitive-*".'
      );
    }
    return entry.trim();
  });
}

/**
 * `componentsFrom`: one path, or a list. Each is a type declaration entry (.d.ts, .d.mts,
 * .d.cts) or a folder of component source in the app. A blank entry is a config error.
 */
function readComponentsFrom(config, where) {
  // An empty string has always meant "not set" (the old reader tested it for truth), so
  // configs that carry one keep loading. A blank entry in a list is a mistake.
  const given = config.componentsFrom;
  if (given === undefined || given === null || given === "") return [];
  const list = typeof config.componentsFrom === "string" ? [config.componentsFrom] : config.componentsFrom;
  if (!Array.isArray(list) || list.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new Error(
      `${where}: "componentsFrom" must be a path, or a list of paths, to the package's type declarations ` +
        'or to the folder that holds the components, for example "node_modules/@acme/ds/dist/index.d.ts".'
    );
  }
  return list;
}

/** The named profiles, checked. Each profile keeps whatever else it carries. */
function readProfiles(config, configPath) {
  const where = basename(configPath);
  const raw = config.profiles === undefined ? {} : config.profiles;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${where}: "profiles" must be an object mapping a profile name to its include and rules.`);
  }
  const profiles = {};
  for (const [name, profile] of Object.entries(raw)) {
    if (profile === null || typeof profile !== "object" || Array.isArray(profile)) {
      throw new Error(`${where}: profile "${name}" must be an object with "include" and, optionally, "rules".`);
    }
    const read = readInclude(profile.include, name, where);
    const next = { ...profile, include: read.include, includeWritten: read.written };
    if (profile.rules !== undefined) next.rules = readRules(profile.rules, name, where);
    profiles[name] = next;
  }
  return profiles;
}

const firstLine = (text) => String(text ?? "").split("\n")[0];

/** A source problem whose message is already the reason, as it is to be shown. */
class SourceProblem extends Error {}

/**
 * Why a source that is on disk could not be used, in words a person can act on. The
 * raw messages of Node's fs errors name a system call, not the file's fault.
 */
function whyUnreadable(err) {
  if (err instanceof SourceProblem) return err.message;
  if (err?.code === "EISDIR") return "it is a directory, not a file";
  if (err?.code === "EACCES" || err?.code === "EPERM") return "permission denied";
  if (err instanceof SyntaxError) return `it is not valid JSON: ${firstLine(err.message)}`;
  return firstLine(err?.message ?? err);
}

/**
 * What a component source's reader could not follow or list, in a phrase that follows
 * "could not be read (": the re-exports it could not follow and the export forms it could
 * not list. Null when it read everything.
 */
function whatWasNotRead({ unfollowed, unlisted }, entry, root) {
  const where = (from) => (from === entry ? "" : ` (in ${relative(root, from)})`);
  const joined = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0]);
  const specs = unfollowed.filter((u) => !u.kind).map(({ spec, from }) => `"${spec}"${where(from)}`);
  const links = unfollowed.filter((u) => u.kind === "symlink").map(({ spec }) => `"${spec}"`);
  const parts = [];
  for (const { spec, reason } of unfollowed.filter((u) => u.kind === "unreadable")) parts.push(`it could not open "${spec}" (${reason})`);
  if (specs.length > 0) parts.push(`it re-exports ${joined(specs)}, which could not be followed`);
  if (links.length > 0) parts.push(`it holds a symlinked ${links.length > 1 ? "folders" : "folder"} ${joined(links)}, which ${links.length > 1 ? "were" : "was"} not read`);
  for (const { what, from } of unlisted) parts.push(`its \`${what}\`${where(from)} does not name the components it holds`);
  return parts.length > 0 ? parts.join(" and ") : null;
}

/**
 * Load a contract from a config path (or a directory containing one).
 * Missing artifacts degrade gracefully. A foreign repo without tokens
 * still gets the raw-value rules; it just loses nearest-token suggestions.
 */
// A typed input key is written as people write a CSS attribute selector: `input[type=checkbox]`, with the value in
// either kind of quotes, spaced, in any case. It is read as `input[type=<lower case type>]`, which is what the gate
// looks up.
const TYPED_KEY = /^input\[\s*type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s"']*))\s*\]$/i;
function typedKeys(intrinsics) {
  const out = {};
  for (const [key, value] of Object.entries(intrinsics)) {
    const m = TYPED_KEY.exec(key.trim());
    out[m ? `input[type=${(m[1] ?? m[2] ?? m[3]).trim().toLowerCase()}]` : key] = value;
  }
  return out;
}

export function loadContract(configPath) {
  const path = configPath.endsWith(".json") ? configPath : findConfig(configPath);
  if (!path || !existsSync(path)) {
    throw new Error(
      `No ${DEFAULT_CONFIG_NAME} found at or above "${configPath}". Run Undrift from a configured repository, or pass --config.`
    );
  }
  const root = dirname(path);
  // The one JSON.parse that is the config's own. A source that will not parse is a
  // source problem and never reaches here.
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const cannot = err instanceof SyntaxError ? "is not valid JSON" : "could not be read";
    throw new Error(`${basename(path)} ${cannot}: ${err instanceof SyntaxError ? firstLine(err.message) : whyUnreadable(err)}`);
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${basename(path)} must be a JSON object.`);
  }

  // Every source the config names, and which of those are not on disk. A missing
  // one is still skipped (the gate runs on what exists), but it is RECORDED, as
  // configured, so a run can say what it did not read instead of looking clean
  // without it. `locate` returns the resolved path, or null when it is not there.
  const configuredSources = [];
  const missingSources = [];
  // A source that is on disk and cannot be used: a directory, a file the process may
  // not open, JSON that does not parse. Skipped and RECORDED, as a missing one is, and
  // never thrown: it is the source's fault and not the config's.
  const unreadableSources = [];
  const readSource = (key, rel, read) => {
    try {
      return read();
    } catch (err) {
      unreadableSources.push({ key, path: rel, reason: whyUnreadable(err) });
      return null;
    }
  };
  const locate = (key, rel) => {
    if (!rel) return null;
    configuredSources.push({ key, path: rel });
    const abs = resolve(root, rel);
    if (existsSync(abs)) return abs;
    missingSources.push({ key, path: rel });
    return null;
  };

  const tokensJsonPath = locate("tokens", config.tokens);
  const tokensCssList = config.tokensCss
    ? (Array.isArray(config.tokensCss) ? config.tokensCss : [config.tokensCss])
    : [];
  const tokensCssSources = tokensCssList
    .map((rel) => ({ rel, abs: locate("tokensCss", rel) }))
    .filter((source) => source.abs);
  const tokensCssPaths = tokensCssSources.map((source) => source.abs);
  const catalogPathOnDisk = locate("catalog", config.catalog);
  const componentSources = readComponentsFrom(config, basename(path))
    .map((rel) => ({ rel, abs: locate("componentsFrom", rel) }))
    .filter((source) => source.abs);

  const tokensJson = tokensJsonPath
    ? readSource("tokens", config.tokens, () => {
        const parsed = JSON.parse(readFileSync(tokensJsonPath, "utf8"));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new SourceProblem("it is not a JSON object of tokens");
        }
        return parsed;
      })
    : null;
  const catalogMd = catalogPathOnDisk
    ? readSource("catalog", config.catalog, () => readFileSync(catalogPathOnDisk, "utf8"))
    : null;

  // Token sources are ADDITIVE, never either/or. A design system legitimately
  // declares tokens in several places at once. The sample ships a DTCG JSON
  // build *and* a Tailwind v4 `@theme inline` alias layer, and code uses both.
  // Letting one shadow the other makes real, working tokens look non-existent
  // to no-unknown-tokens. Any Tailwind v4 repo has this shape.
  //
  // Merge order (LATER SOURCES WIN on key collision):
  //   1. DTCG JSON (`tokens`)
  //   2. each `tokensCss` entry, in the order configured
  // So the alias/theme layer listed last overrides the generated build, which
  // is what you want: the last thing the browser sees is the value that applies.
  //
  // Missing files degrade gracefully. They are skipped, never thrown on, so a
  // partially-built repo still gates on whatever token sources do exist. Each one
  // skipped is listed in `missingSources` above; the gate reports it.

  const declarations = [];
  const tokens = tokensJson ?? {};
  for (const [name, value] of Object.entries(tokens)) {
    if (typeof value === "string") declarations.push([name, value]);
  }
  // `--x: initial` is a reset (Tailwind's way to remove a theme value), not a token.
  const isReset = (value) => value.trim().toLowerCase() === "initial";
  // The resets are kept too: a built-in palette the system switches off is one whose classes build nothing.
  const paletteResets = [];
  for (const { rel, abs } of tokensCssSources) {
    const read = readSource("tokensCss", rel, () => {
      const css = stripCssComments(readFileSync(abs, "utf8"));
      return { declared: readCssTokenDeclarationsWithContext(css), resets: readCssTokenResets(css) };
    });
    if (!read) continue;
    paletteResets.push(...read.resets);
    for (const [name, value, always] of read.declared) {
      if (isReset(value)) continue;
      // Whether the block it is in always applies is kept for the gate: a fallback is used where a token has no value.
      declarations.push([name, value, always]);
      tokens[name] = value;
    }
  }

  // Catalog: CATALOG.md (rich, carrying for/not-for) if present, else the
  // package's own exports resolved TRANSITIVELY (a flat parse hides compound
  // parts like TableRow and makes correct code look wrong).
  // Every componentsFrom entry is read and the names joined: a package whose components
  // sit behind subpath entries has no one file that lists them all.
  let fromPackage = null;
  // The types the component sources export. An import of one is correct code and is not a component.
  const typeNames = new Set();
  if (!catalogMd) {
    const reads = [];
    for (const { rel, abs } of componentSources) {
      const read = readSource("componentsFrom", rel, () => readComponentSource(abs));
      if (!read) continue;
      reads.push({ rel, abs, read });
      fromPackage = [...new Set([...(fromPackage ?? []), ...read.names])].sort();
      for (const name of read.types ?? []) typeNames.add(name);
    }
    const listed = componentSources.map((source) => source.abs);
    for (const { rel, abs, read } of reads) {
      // A re-export of a package is followed when an entry of that package is listed too, as init writes
      // them: that entry is read in its own right. Any other is not covered.
      const unfollowed = read.unfollowed.filter(({ spec, from, kind }) => kind || !coveredByListed(spec, from, listed, abs));
      // What the reader could not follow or list is a problem with the source, as a file that
      // cannot be read is: the names it did find are kept, and the list is not complete.
      const cannot = whatWasNotRead({ ...read, unfollowed }, abs, root);
      if (cannot) unreadableSources.push({ key: "componentsFrom", path: rel, reason: cannot, partlyRead: true });
    }
  }
  const catalog = catalogMd
    ? parseCatalog(catalogMd).map((r) => ({ ...r, source: "catalog" }))
    : (fromPackage ?? []).map((name) => ({
        name, status: "unknown", for: null, notFor: null, tier: null, source: "package",
      }));

  // Only assert component existence when the list is known-complete. A catalog
  // resolved from a package is authoritative; a hand-written CATALOG.md may
  // legitimately omit compound parts, so the rule must not fire against it.
  // A list read from only some of its entries is not complete either: a name missing from it
  // may be in an entry that is not built, or could not be read.
  const componentsPartial = [...missingSources, ...unreadableSources].some((s) => s.key === "componentsFrom");
  const catalogComplete = !catalogMd && catalog.length > 0 && !componentsPartial;

  // Tailwind 4's own theme variables, kept apart from the system's tokens: no-unknown-tokens accepts them (outside the
  // colour namespace), and nothing else reads them as the system's. Read only where a system stylesheet imports
  // Tailwind, from the install that stylesheet resolves.
  // Where the listed stylesheets do not reach Tailwind, the project's own stylesheet that imports it is looked for: a
  // setup that lists only a component library's built files has the app's stylesheet outside them. Where Tailwind 4 is
  // installed and no stylesheet that imports it can be found, the theme is not read, and the run says so.
  let framework = tailwindThemeFor(tokensCssPaths);
  // The search walks the project, and the hook pays for it on every call, so it runs only where there is a sign of
  // Tailwind 4: an install the root resolves, or a root package.json that names a dependency that can be Tailwind 4 (a
  // range that can only match 3 is not one).
  const tailwindVersion = installedTailwindVersion(root);
  const named = namesTailwind4(root);
  if (!framework && (tailwindVersion || named)) {
    framework = tailwindThemeFromProject(root, findSourceFiles({ root }).stylesheets);
  }
  // The same signs say the theme was not read. A Tailwind below 4 that the root resolves is not one: it has no theme
  // variables. Where the root resolves none and package.json is the only sign, an install below the root is looked for:
  // its version decides (a Tailwind 3 there is no Tailwind 4) and its own names are the ones set aside. With none
  // found, the namespaces of Tailwind 4's theme stand in (`names` null).
  let unread = null;
  if (!framework) {
    if (tailwindVersion !== null) {
      const rootTheme = tailwindTheme(root);
      unread = { version: tailwindVersion, names: rootTheme ? Object.keys(rootTheme.tokens).filter((name) => !name.startsWith("--color-")) : null };
    } else if (named && !installedTailwindBelow4(root)) {
      const below = tailwindInstallBelow(root, tokensCssPaths);
      if (!below) unread = { version: null, names: null };
      else if (Number.parseInt(below.version, 10) >= 4) {
        unread = { version: below.version, names: below.tokens ? Object.keys(below.tokens).filter((name) => !name.startsWith("--color-")) : null };
      }
    }
  }
  const listed = framework && tokensCssPaths.includes(framework.start);
  const frameworkStylesheet = framework && !listed ? relative(root, framework.start).split("\\").join("/") : null;

  const imports = readSystemImports(config, basename(path));
  const primitives = readPrimitives(config, basename(path));
  return {
    root,
    configPath: path,
    system: config.system ?? null,
    configuredSources,
    missingSources,
    unreadableSources,
    ignore: readIgnore(config, path),
    tokens,
    primitives,
    layers: tokenLayers(declarations, primitives ?? undefined),
    paletteResets,
    frameworkTokens: framework?.tokens ?? {},
    frameworkSource: framework ? { path: framework.path, version: framework.version } : null,
    frameworkPrefix: framework?.prefix ?? null,
    // The stylesheet the theme was found in when the config does not list it, or null.
    frameworkStylesheet,
    // There is a sign of Tailwind 4 (an install the root resolves, or a root package.json that names it) and no
    // stylesheet that imports its theme was found: its variables were not read. `names` are the install's own names
    // where it can be read, or null (Tailwind only below the root).
    frameworkUnread: unread,
    tokensCssPaths,
    // Kept for the single-stylesheet consumers (audit.mjs, demo/server.mjs):
    // the first resolved source, or null if none exist on disk.
    tokensCssPath: tokensCssPaths[0] ?? null,
    catalog,
    typeNames: [...typeNames].sort(),
    catalogComplete,
    componentsFromPaths: componentSources.map((source) => source.abs),
    systemImports: imports.list,
    // Whether the config gave a list at all, and how many of its entries were blank: what the
    // report needs to say why nothing counts as the system, truthfully.
    systemImportsGiven: imports.given,
    systemImportsBlank: imports.blank,
    catalogPath: config.catalog ? resolve(root, config.catalog) : null,
    componentsRoot: config.componentsRoot ? resolve(root, config.componentsRoot) : null,
    exemptMarker: config.exemptMarker ?? "token-exempt",
    intrinsics: typedKeys(config.intrinsics ?? {}),
    foreignUi: config.foreignUi ?? [],
    profiles: readProfiles(config, path),
  };
}
