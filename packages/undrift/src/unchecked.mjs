// What the gate was configured to check and could not.
//
// A clean result has to mean "checked and clean". It did not: an empty token set
// skipped no-unknown-tokens, a hand-written catalog skipped no-unknown-components,
// a mistyped path dropped a whole source, and a profile that matched nothing
// printed "0 file(s) clean". Every one of those was silent.
//
// This module is the one place that knows what "could not check" means, so that
// what the gate SKIPS and what it REPORTS cannot drift apart. gate.mjs skips on
// exactly the predicates exported here, and every report is built from the same
// functions. It is the never-insults rule in reverse: "I cannot detect this"
// never renders as "you fail this", and "I did not check this" never renders as
// "on-system".
//
// Every message names the thing, the reason and the fix. No dashes in any of
// them: a test reads this file for the character.

import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { sep, relative, join, resolve, isAbsolute, basename } from "node:path";
import fg from "fast-glob";
import { DEFAULT_RULES } from "./rules.mjs";
import { layersOf, hasColourPrimitive } from "./layers.mjs";

// ---------------------------------------------------------------- predicates

/**
 * The token set holds at least one custom property. Empty means "unknown" cannot be
 * told from "absent". Only a key starting with "--" is a token var(--name) can be
 * checked against: a token file with a version and a name in it parsed, held keys,
 * and made every var() look unknown.
 */
export const canCheckTokens = (contract) =>
  Object.keys(contract.tokens ?? {}).some((key) => key.startsWith("--"));

/**
 * The component list is known to be complete, and is not empty, and something
 * counts as the design system's imports. A list resolved from the package's own
 * type declarations is complete. A hand-written CATALOG.md may leave out compound
 * parts, so existence is never asserted against it. The rule only looks at names
 * imported from the system, so with no import specifier counted as the system it
 * can never fire, however complete the list is.
 */
export const canCheckComponents = (contract) =>
  contract.catalogComplete === true &&
  (contract.catalog ?? []).length > 0 &&
  (contract.systemImports ?? []).length > 0;

/**
 * The design system declares its primitives, and at least one of them is a token it has. The graph cannot
 * tell a role from a palette step (a literal role such as `--accent`, passed on by another token, has the
 * shape of a palette step such as `--blue-9`), so the rule flags only what the system itself says is a
 * primitive, and does not run where it says nothing.
 */
export const canCheckPrimitives = (contract) => {
  if (!canCheckTokens(contract)) return false;
  const layers = layersOf(contract);
  return layers.declared && layers.layered;
};

/**
 * The rules that run but skip part of what they are for, as entries like rulesNotRun's. They are
 * reported in "Not checked" and never as a rule that did not run: the rule ran, on less.
 */
export function rulesPartlyRun(contract, rules) {
  const on = new Set(rules ?? DEFAULT_RULES);
  const out = [];
  // A rule that did not run (rulesNotRun) is reported once, as that, and never also as one that ran in part.
  if (on.has("no-primitive-tokens") && canCheckPrimitives(contract) && !hasColourPrimitive(layersOf(contract))) {
    out.push({
      rule: "no-primitive-tokens",
      // What was not looked for, and why, in the few words `undrift later` prints beside its answer.
      what: "colour utilities",
      why: "none of the declared primitives is a raw colour, so a utility cannot be told from a role's",
      reason:
        "None of the declared primitives is a raw colour, so a Tailwind colour utility cannot be told from a role's. " +
        "Colour utilities were not checked by no-primitive-tokens. Its var() check ran.",
      fix:
        "If the system has a colour palette, add its entries to \"primitives\" in undrift.config.json. " +
        "If its colours have one layer, this part of the rule has nothing to check.",
    });
  }
  // There is a sign of Tailwind 4 and no stylesheet that imports it was found, so its variables (`--spacing`) were not read.
  if (on.has("no-unknown-tokens") && canCheckTokens(contract) && contract.frameworkUnread) {
    const { version, names } = contract.frameworkUnread;
    const sign = version ? `Tailwind ${version} is installed` : "package.json names Tailwind";
    out.push({
      rule: "no-unknown-tokens",
      what: "Tailwind's own variables",
      why: "no stylesheet that imports Tailwind was found",
      reason:
        `${sign}, but no stylesheet that imports it was found, so its own variables ` +
        "(--spacing, --radius-md and the rest) were not read. A var() to a name Tailwind could be writing is not reported as an unknown token. It is set aside, and undrift gate lists where. " +
        (names ? "Every other name was checked." : "Every name outside Tailwind's theme namespaces was checked."),
      fix:
        'List the stylesheet that has @import "tailwindcss" in "tokensCss" in undrift.config.json, or run undrift init again. ' +
        "If the app does not use Tailwind's theme, this part has nothing to check.",
    });
  }
  return out;
}

/** The system declares Tailwind colours of its own, so a built-in one can be told apart. */
export const canCheckDefaultPalette = (contract) =>
  Object.keys(contract.tokens ?? {}).some((name) => name.startsWith("--color-"));

/** At least one raw element is mapped, so there is something to flag. */
export const canCheckIntrinsics = (contract) =>
  Object.keys(contract.intrinsics ?? {}).length > 0;

/** At least one competing UI library is listed, so there is something to flag. */
export const canCheckForeignUi = (contract) =>
  (contract.foreignUi ?? []).length > 0;

// ------------------------------------------------------------ rules not run

const TOKEN_KEYS = ["tokens", "tokensCss"];
const COMPONENT_KEYS = ["catalog", "componentsFrom"];

const ofKeys = (sources, keys) => (sources ?? []).filter((s) => keys.includes(s.key));
const named = (sources) => sources.map((s) => `${s.key} "${s.path}"`).join(", ");
const doesNot = (sources) => (sources.length === 1 ? "does not exist" : "do not exist");

/**
 * The sources that could not be used, in one phrase: those that are not on disk,
 * together, and each one that is on disk and could not be read, with its reason.
 */
const cannotBeUsed = (missing, unreadable) =>
  [
    ...(missing.length > 0 ? [`${named(missing)} ${doesNot(missing)}`] : []),
    ...unreadable.map((s) => `${s.key} "${s.path}" could not be read (${s.reason})`),
  ].join(" and ");

function tokensUnavailable(contract, consequence = "an unknown var(--name) cannot be told from a token that is simply absent") {
  const missing = ofKeys(contract.missingSources, TOKEN_KEYS);
  const unreadable = ofKeys(contract.unreadableSources, TOKEN_KEYS);
  const configured = ofKeys(contract.configuredSources, TOKEN_KEYS);
  if (missing.length > 0 || unreadable.length > 0) {
    return {
      reason: `No token was loaded, because ${cannotBeUsed(missing, unreadable)}, so ${consequence}.`,
      fix:
        missing.length > 0
          ? "Build the token source, or correct its path in undrift.config.json."
          : "Repair the token source, or correct its path in undrift.config.json.",
    };
  }
  if (configured.length === 0) {
    return {
      reason: `No token source is configured, so ${consequence}.`,
      fix: 'Set "tokens" or "tokensCss" in undrift.config.json.',
    };
  }
  return {
    reason: `The configured token sources declare no custom properties (${named(configured)}), so ${consequence}.`,
    fix: 'Point "tokensCss" at the stylesheet that declares the custom properties.',
  };
}

function componentsUnavailable(contract) {
  const configured = ofKeys(contract.configuredSources, COMPONENT_KEYS);
  const missing = ofKeys(contract.missingSources, COMPONENT_KEYS);
  const unreadable = ofKeys(contract.unreadableSources, COMPONENT_KEYS);

  // The list is fine, so what is missing is anything that counts as the system. Say which
  // it is: an explicit systemImports replaces system, so with system set the fault is the
  // list, and "system is not set" would not be true.
  if (contract.catalogComplete === true && (contract.catalog ?? []).length > 0) {
    const system = contract.system;
    const blank = (contract.systemImportsBlank ?? 0) > 0;
    if (contract.systemImportsGiven && system) {
      return {
        reason:
          `No import is treated as the design system: "systemImports" ${blank ? "holds only blank entries" : "is empty"}, ` +
          `and ${blank ? "it" : 'an explicit "systemImports"'} replaces "system" (${JSON.stringify(system)}), so an imported component name cannot be checked.`,
        fix: 'List the import specifiers in "systemImports", or remove "systemImports" so that "system" counts, in undrift.config.json.',
      };
    }
    return {
      reason: blank
        ? 'No import is treated as the design system: "systemImports" holds only blank entries and "system" is not set, so an imported component name cannot be checked.'
        : 'No import is treated as the design system ("system" is not set and "systemImports" is empty), so an imported component name cannot be checked.',
      fix: 'Set "system" to the design system\'s package name, or list its import specifiers in "systemImports", in undrift.config.json.',
    };
  }

  // A list was read from componentsFrom, but not from every entry: a name missing from it may
  // be in an entry that is not built or could not be read.
  const fromEntries = (contract.catalog ?? []).length > 0 && contract.catalog.every((c) => c.source === "package");
  const entriesMissing = missing.filter((s) => s.key === "componentsFrom");
  const entriesUnreadable = unreadable.filter((s) => s.key === "componentsFrom");
  if (fromEntries && (entriesMissing.length > 0 || entriesUnreadable.length > 0)) {
    return {
      reason:
        `The component list is incomplete, because ${cannotBeUsed(entriesMissing, entriesUnreadable)}, ` +
        "so a name missing from it is not proof that the component does not exist.",
      fix:
        entriesMissing.length > 0
          ? "Build the package so all its type declarations exist, or correct the path in undrift.config.json."
          : entriesUnreadable.every((s) => s.partlyRead)
            ? "Add what it re-exports to componentsFrom as well, or build the package so those declarations exist, in undrift.config.json."
            : "Repair the component source, or correct its path in undrift.config.json.",
    };
  }

  // A list exists but is not known to be complete: it came from the catalog file.
  if ((contract.catalog ?? []).length > 0) {
    const file = configured.find((s) => s.key === "catalog")?.path;
    const from = file ? `the catalog (${file})` : "the catalog";
    const packageListSet = configured.some((s) => s.key === "componentsFrom");
    return {
      reason:
        `The component list comes from ${from}, which may leave out compound parts such as a table's rows, ` +
        "so a name missing from it is not proof that the component does not exist.",
      fix: packageListSet
        ? '"componentsFrom" is set, but the catalog is read in preference to it. Remove "catalog" from undrift.config.json to check against the package\'s own list.'
        : 'Set "componentsFrom" to the package\'s type declarations (the .d.ts entry that exports its components) in undrift.config.json. That list is complete.',
    };
  }

  // No list at all.
  if (missing.length > 0 || unreadable.length > 0) {
    return {
      reason: `No component list was loaded, because ${cannotBeUsed(missing, unreadable)}, so a component name cannot be checked.`,
      fix:
        missing.length > 0
          ? "Build the package so its type declarations exist, or correct the path in undrift.config.json."
          : "Repair the component source, or correct its path in undrift.config.json.",
    };
  }
  if (configured.length === 0) {
    return {
      reason: "No component source is configured, so a component name cannot be checked.",
      fix: 'Set "componentsFrom" to the package\'s type declarations in undrift.config.json.',
    };
  }
  return {
    reason: `The configured component source names no components (${named(configured)}), so a component name cannot be checked.`,
    fix: 'Point "componentsFrom" at the .d.ts entry that exports the components, or at the folder that holds them. Re-exports (export * from) are followed.',
  };
}

// The rules that need an input. Each entry answers "can this rule run?" with
// the predicate gate.mjs itself skips on, and says why not when it cannot.
const NEEDS_AN_INPUT = {
  "no-unknown-tokens": (contract) =>
    canCheckTokens(contract) ? null : tokensUnavailable(contract),
  "no-primitive-tokens": (contract) => {
    if (canCheckPrimitives(contract)) return null;
    if (!canCheckTokens(contract)) {
      return tokensUnavailable(contract, "a primitive cannot be told from a role");
    }
    const layers = layersOf(contract);
    if (!layers.declared) {
      return {
        reason: "No primitives are declared, so a primitive cannot be told from a role.",
        fix:
          'Add "primitives" to undrift.config.json (`undrift init` suggests them): token names or globs for the system\'s raw palette and scales, ' +
          'for example "--color-primitive-*". The list is the system\'s own declaration, so propose it to the user and do not add it yourself. ' +
          "If the system has no layer of primitives, propose taking this rule out of the profile's rules list.",
      };
    }
    const named = (contract.primitives ?? []).map((p) => JSON.stringify(p)).join(", ");
    return {
      reason: `None of the declared primitives (${named}) matches a token in the configured sources, so there is nothing to check a reference against.`,
      fix:
        'Correct the names in "primitives" in undrift.config.json to the token names the system declares, ' +
        'or add the file that declares them to "tokensCss". ' +
        "The list is the system's own declaration, so propose the change to the user and do not make it yourself.",
    };
  },
  "no-default-palette": (contract) =>
    canCheckDefaultPalette(contract)
      ? null
      : {
          reason:
            "The design system declares no --color-* token, so a Tailwind colour class " +
            "cannot be told apart from one of its own.",
          fix: 'Add the stylesheet that maps the system\'s colours into Tailwind (its @theme block) to "tokensCss".',
        },
  "no-unknown-components": (contract) =>
    canCheckComponents(contract) ? null : componentsUnavailable(contract),
  "no-raw-elements": (contract) =>
    canCheckIntrinsics(contract)
      ? null
      : {
          reason: '"intrinsics" is empty, so no raw element (a bare <button> or <input>, say) is checked against a system component.',
          fix: 'Map each raw element the system replaces to its component in "intrinsics" in undrift.config.json. A tag mapped to null stays banned with no replacement named.',
        },
  "no-foreign-ui-imports": (contract) =>
    canCheckForeignUi(contract)
      ? null
      : {
          reason: '"foreignUi" is empty, so no import from a competing UI library is flagged.',
          fix: 'List the import prefixes of the UI libraries the system replaces in "foreignUi" in undrift.config.json.',
        },
};

/**
 * The rules a profile turns on that cannot run, each with the reason and the fix.
 * `rules` is the profile's list; omit it for a profile that runs the default rules.
 * `no-raw-colors`, `no-arbitrary-values` and `no-inline-style-values` need no
 * input and are never reported.
 * @returns {{rule: string, reason: string, fix: string}[]}
 */
export function rulesNotRun(contract, rules) {
  const on = [...new Set(rules ?? Object.keys(NEEDS_AN_INPUT).filter((r) => DEFAULT_RULES.includes(r)))];
  const out = [];
  for (const rule of on) {
    const unavailable = NEEDS_AN_INPUT[rule]?.(contract);
    if (unavailable) out.push({ rule, ...unavailable });
  }
  return out;
}

// ------------------------------------------------------------------ coverage
//
// A profile only checks the files it includes. Every other UI file, and every
// stylesheet, is something no rule looked at. Each file is accounted for one way:
//   covered      some profile's include matches it, that profile's own ! patterns applied
//   excluded     a profile's positive patterns match it and only that profile's own
//                ! patterns drop it: somebody wrote "skip these" on purpose
//   ignored      it matches `ignore`, which carries the reason
//   not checked  none of the above
// Excluded and ignored files are counted, never hidden. An exemption is an
// invisible violation, and so is a blind spot.
//
// A stylesheet is never covered or excluded. No rule reads CSS, so no profile can
// cover one, and the only way to clear it is `ignore` with a reason.

/**
 * Directories nothing inside is ever counted from, wherever they are. Every
 * dot-directory is skipped as well.
 */
export const ALWAYS_SKIPPED_DIRECTORIES = ["node_modules", ".next", "storybook-static"];

/**
 * Directories that are a package's build output, and are skipped as such only where
 * a package.json sits beside them. A route folder called `coverage` or `build` (an
 * analytics page, a CI dashboard) is source: skipping it by name hid every file in
 * it from the gate, and a violation there passed strict.
 */
export const OUTPUT_DIRECTORIES = ["coverage", "build", "out", "dist"];

// In any case: a file called DRIFT.CSS or Page.TSX is what it says it is, and a check that read
// only the lower-case names counted a stylesheet in capitals as a file it had checked.
const UI_FILE = /\.(tsx|jsx)$/i;
const STYLESHEET = /\.(css|scss|sass|less)$/i;
const SCRIPT_FILE = /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/i;

const toPosix = (path) => path.split(sep).join("/");

/**
 * The options every glob over the repository is given, for gating and for coverage
 * alike, so the two cannot disagree about which files exist. A link is not followed: a
 * file is its real path, gated where it lives and counted once, and a link that points
 * back up the tree cannot make a walk loop until the path is too long. A profile covers
 * a file by including the path it really has. A directory the process cannot read is not
 * a crash: fast-glob only suppresses ENOENT unless told to, and one unreadable directory
 * made the whole run, and the hook, die. The whole-repository scan finds them itself and
 * reports each one.
 */
export const GLOB_OPTIONS = { dot: false, followSymbolicLinks: false, suppressErrors: true };

// ------------------------------------------------------- what a glob walked past
//
// A glob walks on its own, with read errors suppressed so that one locked folder does not end a
// run. It used to say nothing of what it could not see: `gate --strict 'app/**/*.tsx'` over a folder
// at mode 000 that held a raw colour exited 0 and said on-system, and so did a link met on the way
// (`app/ui -> ../elsewhere/ui`), and so did a profile that names a place the scan skips
// (`.storybook/**/*.tsx`) over an unreadable subfolder. Each walk records the directories it could
// not read and the links it met, by reading directories through this file system, and the run
// reports them as the whole-repository scan does.

const mentionsHidden = (pattern) => !pattern.startsWith("!") && /(^|\/)\.[^./]/.test(pattern);
const byPath = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A file system for fast-glob (`fs: record.fs`) that reads as the real one does and records what the
 * walk could not see. `record.walked()` is `{unreadable: {path, reason}[], links: string[]}`, paths
 * relative to the contract root. Only places a walk for `patterns` could have matched in count: never
 * anything inside node_modules or a package's own build output, and not a hidden folder unless a
 * pattern names one (a glob walks hidden folders too, and matches nothing in them).
 */
export function recordWalk(contract, patterns) {
  const root = contract.root;
  const isPackageDir = packageDirTest(root);
  const allowHidden = patterns.some(mentionsHidden);
  const unreadable = new Map();
  const links = new Set();
  const counts = (rel) => {
    const parts = rel.split("/");
    if (parts.some((part) => ALWAYS_SKIPPED_DIRECTORIES.includes(part))) return false;
    if (!allowHidden && parts.some((part) => part.startsWith(".") && part !== "." && part !== "..")) return false;
    return !parts.some((part, i) => OUTPUT_DIRECTORIES.includes(part) && isPackageDir(parts.slice(0, i)));
  };
  const relOf = (abs) => toPosix(relative(root, abs));
  const fs = {
    readdirSync(path, options) {
      let entries;
      try {
        entries = readdirSync(path, options);
      } catch (err) {
        const reason = whyDirectoryUnreadable(err);
        const rel = relOf(path);
        if (reason && counts(rel)) unreadable.set(rel, { path: rel === "" ? "." : rel, reason });
        throw err;
      }
      if (options?.withFileTypes) {
        for (const entry of entries) {
          if (!entry.isSymbolicLink()) continue;
          const rel = relOf(join(path, entry.name));
          if (counts(rel)) links.add(rel);
        }
      }
      return entries;
    },
  };
  return {
    fs,
    walked: () => ({ unreadable: [...unreadable.values()].sort((a, b) => byPath(a.path, b.path)), links: [...links].sort() }),
  };
}

/** What several runs' walks recorded, once each: the directories and links, and every file they matched. */
export function mergeWalked(runs) {
  const unreadable = new Map();
  const links = new Set();
  const matched = [];
  for (const run of runs) {
    for (const dir of run.walked?.unreadable ?? []) unreadable.set(dir.path, dir);
    for (const link of run.walked?.links ?? []) links.add(link);
    matched.push(...(run.walked?.matched ?? []));
  }
  return { unreadable: [...unreadable.values()].sort((a, b) => byPath(a.path, b.path)), links: [...links].sort(), matched };
}

/**
 * What a run over explicit paths could not see, less what `ignore` accounts for and what the run's own
 * matches cover (a link is covered when another argument matched paths behind it). The whole-repository
 * scan does the same for what it finds, and merges what the walks recorded into its own lists.
 */
export function accountWalked(contract, walked) {
  const none = { unreadable: [], links: [] };
  if (!walked || (walked.unreadable.length === 0 && walked.links.length === 0)) return none;
  const ignored = ignoredFiles(contract);
  const covering = new Set();
  // Matched paths are kept by their path relative to the root only. An absolute form used to be kept
  // as well, and a link to a folder that holds the repository (`app/up -> ../..`) counted as covered
  // by every path inside the repository, since each one starts with that folder's own path.
  for (const abs of walked.matched ?? []) covering.add(toPosix(relative(contract.root, abs)));
  return {
    unreadable: walked.unreadable.filter((dir) => !ignoreCovers(contract, ignored, dir.path)),
    links: classifyLinks(contract, walked.links, { ignored }, covering).notFollowed,
  };
}

// ------------------------------------------------------------- glob escaping
//
// A Next.js route group is a folder called (marketing) and a dynamic route is a folder
// called [id]. To a glob they are syntax, so "app/(marketing)/**" matches nothing at
// all, and a config written the way the folder is named covers no file. Every fix that
// asks for a pattern says how to write these names. The pattern is quoted as JSON,
// since that is where it is pasted.

const GLOB_SYNTAX = /[()[\]{}]/;
// A segment that is wholly a group or a bracket: (marketing), [id], [...slug].
const WHOLE_SEGMENT = /^(\([^/]*\)|\[[^/]*\])$/;

/** A path written so a glob matches it literally: a backslash before each bracket, `*`, `?` and `!`. */
export const escapeGlob = (path) => path.replace(/[()[\]{}*?!]/g, "\\$&");

/**
 * What to tell a person whose path holds a name a glob reads as syntax. The example is
 * built from the first such path, at its outermost such folder, since the pattern
 * beneath it covers everything inside. `tail` is what follows the folder: "/**" for an
 * ignore key, "/**\/*.tsx" for an include. Empty when no path needs it.
 * @param {string[]} paths
 * @param {string} [tail]
 */
export function pathEscapeAdvice(paths, tail = "/**") {
  for (const path of paths) {
    const parts = toPosix(path).split("/");
    const at = parts.findIndex((part) => GLOB_SYNTAX.test(part));
    if (at === -1) continue;
    const shown = parts.slice(0, at + 1).join("/");
    const pattern = at === parts.length - 1 ? escapeGlob(shown) : `${escapeGlob(shown)}${tail}`;
    return (
      ` A name with parentheses or brackets, as in ${shown}, is read as glob syntax ` +
      `unless each one is escaped with a backslash: write ${JSON.stringify(pattern)}.`
    );
  }
  return "";
}

/**
 * The same for patterns already written: a whole segment that is (name) or [name] is a
 * folder that was meant literally, and matches nothing as it stands. Only whole
 * segments are taken, so a class or a group inside a larger pattern is left alone.
 * @param {string[]} patterns
 */
export function patternEscapeAdvice(patterns) {
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const parts = pattern.slice(negated ? 1 : 0).split("/");
    const at = parts.findIndex((part) => WHOLE_SEGMENT.test(part));
    if (at === -1) continue;
    const shown = parts.slice(0, at + 1).join("/");
    const fixed = parts.map((part) => (WHOLE_SEGMENT.test(part) ? escapeGlob(part) : part)).join("/");
    return (
      ` If a folder name has parentheses or brackets, as in ${shown}, ` +
      `escape each one with a backslash in the pattern: write ${JSON.stringify(`${negated ? "!" : ""}${fixed}`)}.`
    );
  }
  return "";
}

// Is `segments` (the directories from the root down to one, [] for the root itself)
// a package? It is when a package.json sits in it. With no root to look in the
// answer is the cautious one, yes: an output directory is skipped.
const packageDirTest = (root) =>
  root === undefined
    ? () => true
    : (segments) => existsSync(join(root, ...segments, "package.json"));

// Under a build output directory: a directory named like one, whose parent is a package.
function underOutputDirectory(posix, isPackageDir) {
  const parts = posix.split("/");
  return parts.some(
    (part, i) => i < parts.length - 1 && OUTPUT_DIRECTORIES.includes(part) && isPackageDir(parts.slice(0, i))
  );
}

// Skipped when any segment, the file name included, is hidden (`..` starts with a
// dot, which also keeps a path outside the root from ever being counted), when a
// directory is one that is never source, or when it is a package's build output.
function inSkippedPlace(posix, isPackageDir) {
  const parts = posix.split("/");
  const hiddenOrNeverSource = parts.some(
    (part, i) => part.startsWith(".") || (i < parts.length - 1 && ALWAYS_SKIPPED_DIRECTORIES.includes(part))
  );
  return hiddenOrNeverSource || underOutputDirectory(posix, isPackageDir);
}

/**
 * A .tsx or .jsx file, outside the skipped places. `rel` is relative to the
 * contract root, and `root` is where to look for the package.json that makes a
 * directory named `dist` or `coverage` a package's output.
 */
export function isUiFile(rel, root) {
  const posix = toPosix(rel);
  return UI_FILE.test(posix) && !inSkippedPlace(posix, packageDirTest(root));
}

/**
 * True for any path that ends like a stylesheet, wherever it is. No rule reads
 * CSS, so the gate sets these aside instead of parsing them as TSX, which used to
 * count a drifting stylesheet as a file checked and clean.
 */
export const hasStylesheetExtension = (path) => STYLESHEET.test(path);

/**
 * True for a file the gate can read: TypeScript or JavaScript, in any case. It is the only
 * kind of file that is gated. Anything else (Markdown, MDX, JSON, SVG) handed to it was
 * parsed as TSX, found to contain nothing, and counted as checked and clean, or flagged
 * for a colour in a data file. A stylesheet is set aside as well, and reported as one.
 */
export const hasScriptExtension = (path) => SCRIPT_FILE.test(path);

/** Whether `ignore` accounts for a root-relative path. */
export const isIgnored = (contract, rel) => ignoredFiles(contract).has(toPosix(rel));

/** A .css, .scss, .sass or .less file, outside the skipped places. */
export function isStylesheet(rel, root) {
  const posix = toPosix(rel);
  return STYLESHEET.test(posix) && !inSkippedPlace(posix, packageDirTest(root));
}

/** Why a directory could not be read, in words a person can act on. Null for one that is simply gone. */
function whyDirectoryUnreadable(err) {
  if (err?.code === "ENOENT") return null;
  if (err?.code === "EACCES" || err?.code === "EPERM") return "permission denied";
  if (err?.code === "ENOTDIR") return "not a directory";
  if (err?.code === "ELOOP") return "too many levels of symbolic links";
  return String(err?.message ?? err).split("\n")[0];
}

/**
 * Every UI file and stylesheet under the contract root, sorted, and what the walk could
 * not classify by looking at a name: the symbolic links it met, and the directories it
 * could not read. The hook asks the predicates about one path and this scans the tree,
 * so the two must agree on every path (a test holds them to it).
 *
 * The walk is its own, not a glob, because it has to know two things a glob cannot say:
 * that a directory is a package before it goes into the directory's children (a
 * package's build output is skipped without being opened, so an output directory the
 * process cannot read costs nothing), and which directories it could not open (each
 * is reported, where a glob would drop it, or die). It never follows a link: a link is
 * recorded, and what is behind it is not walked.
 * @returns {{ui: string[], stylesheets: string[], links: string[], unreadable: {path: string, reason: string}[]}}
 */
export function findSourceFiles(contract) {
  const ui = [];
  const stylesheets = [];
  const links = [];
  const unreadable = [];
  const visit = (dirAbs, dirRel) => {
    let entries;
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch (err) {
      const reason = whyDirectoryUnreadable(err);
      if (reason) unreadable.push({ path: dirRel === "" ? "." : dirRel, reason });
      return;
    }
    // A package.json here makes this directory a package, so its build output is not source.
    const isPackage = entries.some(
      (entry) => entry.name === "package.json" && (entry.isFile() || (entry.isSymbolicLink() && existsSync(join(dirAbs, entry.name))))
    );
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(".")) continue;
      const rel = dirRel === "" ? name : `${dirRel}/${name}`;
      // A place that is never source is skipped whether it is a directory or a link to one: a
      // node_modules that is a link (a workspace root shared by packages, a mounted volume) is
      // ordinary, and reporting it would put a false item in every such repository.
      const neverSource = ALWAYS_SKIPPED_DIRECTORIES.includes(name) || (isPackage && OUTPUT_DIRECTORIES.includes(name));
      if (entry.isSymbolicLink()) {
        if (!neverSource) links.push(rel);
      } else if (entry.isDirectory()) {
        if (neverSource) continue;
        visit(join(dirAbs, name), rel);
      } else if (entry.isFile()) {
        if (UI_FILE.test(name)) ui.push(rel);
        else if (STYLESHEET.test(name)) stylesheets.push(rel);
      }
    }
  };
  visit(contract.root, "");
  return {
    ui: ui.sort(byPath),
    stylesheets: stylesheets.sort(byPath),
    links: links.sort(byPath),
    unreadable: unreadable.sort((a, b) => byPath(a.path, b.path)),
  };
}

// fast-glob's own reading of a negation: a leading `!`, but not the extglob `!(`.
export const isNegativeGlob = (pattern) => pattern.startsWith("!") && pattern[1] !== "(";
const isNegative = isNegativeGlob;

// The globs that keep a walk out of the places that are never source.
const NEVER_SOURCE_GLOBS = ALWAYS_SKIPPED_DIRECTORIES.map((dir) => `**/${dir}/**`);

// What `ignore` accounts for, as root-relative paths: files, and the places (a link, a
// directory that cannot be read) a key names or reaches.
function ignoredFiles(contract) {
  const globs = Object.keys(contract.ignore ?? {});
  return new Set(
    globs.length
      ? fg.sync(globs, { cwd: contract.root, ...GLOB_OPTIONS, onlyFiles: false, ignore: NEVER_SOURCE_GLOBS })
      : []
  );
}

/**
 * Does `ignore` account for a place: a directory, a link? It does when a key matches the
 * place itself, or a glob reaches something under it, or a key names it with /** after it
 * (nothing readable is under a directory that cannot be read, so nothing would match).
 */
function ignoreCovers(contract, ignored, rel) {
  if (ignoreNames(contract, ignored, rel)) return true;
  const under = `${rel}/`;
  for (const path of ignored) if (path.startsWith(under)) return true;
  return false;
}

// Does `ignore` account for everything behind a link to a directory, though no key names the link:
// every UI file, stylesheet and script that a bounded walk finds behind it is one an ignore glob
// matched (by the link's own name or by its real path). A glob that reaches one file, or some of them,
// accounts for those and for nothing else, and a look that could not be finished is not believed.
function ignoreAccountsForLink(contract, ignored, rel, info) {
  if (ignoreNames(contract, ignored, rel)) return true;
  if (info.kind !== "directory") return false;
  const look = uiFilesBehind(info.target);
  if (!look.complete) return false;
  const all = [...look.files, ...look.stylesheets, ...look.scripts];
  return all.length > 0 && all.every((file) => [rel, info.targetRel, info.target].some((form) => ignored.has(`${form}/${file}`)));
}

// Does a key of `ignore` name the place itself (the place, or the place with /** after it)? One that
// only reaches a file under it does not: it accounts for that file and nothing else.
function ignoreNames(contract, ignored, rel) {
  if (ignored.has(rel)) return true;
  return Object.keys(contract.ignore ?? {}).some((glob) => glob.replace(/\/\*\*(\/\*)?$/, "") === rel);
}

// Everything a file can be accounted for by, expanded once. The globs are the
// gate's own: the same options gateFiles uses, so "covered" here is exactly the
// set of files a profile runs on. `ran` names the profiles this run ran, when it ran
// only some: what a profile that did not run includes is `keptElsewhere`, with the
// names of the profiles that include it, because nothing in this run looked at it.
function expansions(contract, ran = null) {
  const cwd = contract.root;
  const kept = new Set();
  const keptElsewhere = new Map();
  const dropped = new Set();
  for (const [name, profile] of Object.entries(contract.profiles ?? {})) {
    const include = profile.include ?? [];
    // Neither walk needs the places that are never source: a file in one is never
    // classified. The positive-only walk has lost the profile's own negations, which
    // is what used to keep it out of node_modules, so it is told explicitly.
    const walk = { cwd, ...GLOB_OPTIONS, ignore: NEVER_SOURCE_GLOBS };
    const matched = new Set(fg.sync(include, walk));
    if (ran && !ran.includes(name)) {
      for (const file of matched) keptElsewhere.set(file, [...(keptElsewhere.get(file) ?? []), name]);
    } else {
      for (const file of matched) kept.add(file);
    }
    for (const file of fg.sync(include.filter((p) => !isNegative(p)), walk)) {
      if (!matched.has(file)) dropped.add(file);
    }
  }
  return { kept, keptElsewhere, dropped, ignored: ignoredFiles(contract) };
}

// The one place a file is classified, for the whole-repository run and for the
// hook alike, so the two cannot account for a file differently.
function statusOf(sets, rel, kind) {
  if (kind === "ui") {
    if (sets.kept.has(rel)) return "covered";
    if (sets.keptElsewhere.has(rel)) return "notRun";
    if (sets.dropped.has(rel)) return "excluded";
  }
  return sets.ignored.has(rel) ? "ignored" : "notChecked";
}

/**
 * How every UI file and stylesheet in the repository is accounted for.
 * `counts` is what goes in the JSON. `notCovered` and `stylesheets` are the full
 * sorted lists of what was not checked, for the items that name them.
 *
 * `ran` names the profiles the run ran, when it ran only some (`--profile`). A file
 * only the others include is not covered by this run: it is counted as `notRun`, and
 * listed in `notRun` with the profiles that include it. Without `ran`, every profile
 * ran, and neither appears.
 * @param {object} contract
 * @param {{ran?: string[]|null}} [options]
 */
export function classifyCoverage(contract, { ran = null, walked = null } = {}) {
  const found = findSourceFiles(contract);
  const { ui, stylesheets } = found;
  // What the profiles' own globs met that the scan does not look at (a place it skips) joins what it found.
  const unreadableAll = [...new Map([...found.unreadable, ...(walked?.unreadable ?? [])].map((dir) => [dir.path, dir])).values()].sort((a, b) => byPath(a.path, b.path));
  const links = [...new Set([...found.links, ...(walked?.links ?? [])])].sort();
  const sets = expansions(contract, ran);
  const counts = { uiFiles: ui.length, covered: 0, excluded: 0, ignored: 0, notCovered: 0 };
  if (ran) counts.notRun = 0;
  const notCovered = [];
  const notRun = [];
  for (const file of ui) {
    const status = statusOf(sets, file, "ui");
    if (status === "notChecked") {
      counts.notCovered += 1;
      notCovered.push(file);
    } else if (status === "notRun") {
      counts.notRun += 1;
      notRun.push({ file, profiles: sets.keptElsewhere.get(file) });
    } else {
      counts[status] += 1;
    }
  }
  const unchecked = [];
  let ignoredSheets = 0;
  for (const file of stylesheets) {
    if (statusOf(sets, file, "stylesheet") === "ignored") ignoredSheets += 1;
    else unchecked.push(file);
  }
  counts.stylesheets = {
    found: stylesheets.length,
    ignored: ignoredSheets,
    notChecked: unchecked.length,
  };
  const unreadable = unreadableAll.filter((dir) => !ignoreCovers(contract, sets.ignored, dir.path));
  counts.unreadable = {
    found: unreadableAll.length,
    ignored: unreadableAll.length - unreadable.length,
    notChecked: unreadable.length,
  };
  const followed = classifyLinks(contract, links, sets);
  counts.links = followed.counts;
  // The stylesheets behind a link a profile covers: found under the link's name, reported unless ignored.
  for (const sheet of followed.sheets) {
    counts.stylesheets.found += 1;
    if (sets.ignored.has(sheet)) counts.stylesheets.ignored += 1;
    else {
      counts.stylesheets.notChecked += 1;
      unchecked.push(sheet);
    }
  }
  unchecked.sort(byPath);
  return { counts, notCovered, notRun, ran, stylesheets: unchecked, unreadable, links: followed.notFollowed };
}

// ------------------------------------------------------------------- links
//
// A link is never followed, so what is behind one is looked at only if it also lives
// somewhere the scan reaches: a link to another folder of the repository is nothing to
// report, the files are there under their own names. A link that leads outside the
// repository, or into a place the scan skips, is a door nothing opens, and it was
// silent: a raw colour behind one passed strict. The scan records every link it meets
// and each one that leads somewhere unread is not checked, unless a profile includes
// the real path (which the fix says to do) or `ignore` accounts for it.

/** The most entries a look behind a link reads. A link to a folder with more than that is not guessed at. */
export const PEEK_ENTRIES = 50_000;

/**
 * Is there source behind a directory: a UI file, a stylesheet or a script? A bounded look in the
 * scan's own terms. It opens no place that is never source (node_modules, a hidden folder, a
 * package's own build output) and follows no link. `includable` is a UI file or a script, which a
 * profile can cover; a stylesheet alone is `source` and not `includable`, since no profile can cover
 * one. `complete` is false when the look could not be finished (the budget ran out, a folder could
 * not be read, a link was met), and "no source" is only to be believed when it is true.
 * @returns {{source: boolean, includable: boolean, complete: boolean}}
 */
export function peekDirectory(dir, { maxEntries = PEEK_ENTRIES } = {}) {
  let budget = maxEntries;
  let complete = true;
  let stylesheet = false;
  const stack = [dir];
  while (stack.length > 0) {
    const here = stack.pop();
    let entries;
    try {
      entries = readdirSync(here, { withFileTypes: true });
    } catch {
      complete = false;
      continue;
    }
    const isPackage = entries.some((entry) => entry.name === "package.json" && entry.isFile());
    for (const entry of entries) {
      if (--budget < 0) return { source: stylesheet, includable: false, complete: false };
      const name = entry.name;
      if (name.startsWith(".")) continue;
      if (entry.isSymbolicLink()) {
        complete = false; // not followed, so what it leads to is not known
        continue;
      }
      if (entry.isDirectory()) {
        if (ALWAYS_SKIPPED_DIRECTORIES.includes(name) || (isPackage && OUTPUT_DIRECTORIES.includes(name))) continue;
        stack.push(join(here, name));
      } else if (entry.isFile()) {
        if (UI_FILE.test(name) || SCRIPT_FILE.test(name)) return { source: true, includable: true, complete };
        if (STYLESHEET.test(name)) stylesheet = true;
      }
    }
  }
  return { source: stylesheet, includable: false, complete };
}

/**
 * Every UI file, every stylesheet and every script behind a directory, by its path from that directory, looked for
 * in the scan's own terms (no hidden folder, no node_modules, no package's build output, no link
 * followed). `complete` is false when the look could not be finished: the budget ran out, a folder
 * could not be read, or a link was met.
 * @returns {{files: string[], stylesheets: string[], scripts: string[], complete: boolean}}
 */
export function uiFilesBehind(dir, { maxEntries = PEEK_ENTRIES } = {}) {
  let budget = maxEntries;
  let complete = true;
  const files = [];
  const stylesheets = [];
  const scripts = [];
  const stack = [""];
  while (stack.length > 0) {
    const here = stack.pop();
    let entries;
    try {
      entries = readdirSync(join(dir, here), { withFileTypes: true });
    } catch {
      complete = false;
      continue;
    }
    const isPackage = entries.some((entry) => entry.name === "package.json" && entry.isFile());
    for (const entry of entries) {
      if (--budget < 0) return { files, stylesheets, scripts, complete: false };
      const name = entry.name;
      if (name.startsWith(".")) continue;
      const sub = here === "" ? name : `${here}/${name}`;
      if (entry.isSymbolicLink()) {
        complete = false;
        continue;
      }
      if (entry.isDirectory()) {
        if (ALWAYS_SKIPPED_DIRECTORIES.includes(name) || (isPackage && OUTPUT_DIRECTORIES.includes(name))) continue;
        stack.push(sub);
      } else if (entry.isFile()) {
        if (UI_FILE.test(name)) files.push(sub);
        else if (STYLESHEET.test(name)) stylesheets.push(sub);
        else if (SCRIPT_FILE.test(name)) scripts.push(sub);
      }
    }
  }
  return { files, stylesheets, scripts, complete };
}

/**
 * What a link leads to, or null when there is nothing behind it that Undrift would read. With
 * `peek`, a link to a directory that no scan reaches is looked into first: with no source behind
 * it, it is null too, and when the look could not be finished the link is `uncertain`. A link to a
 * folder that holds the repository is an `ancestor`, and one to stylesheets alone is `stylesheetsOnly`.
 */
function linkTarget(contract, realRoot, rel, { peek = false } = {}) {
  let target;
  let stat;
  try {
    target = realpathSync(join(contract.root, rel));
    stat = statSync(target);
  } catch {
    return null; // a link to nothing has nothing behind it
  }
  const name = basename(target);
  let kind = null;
  if (stat.isDirectory()) kind = "directory";
  else if (stat.isFile()) {
    kind = UI_FILE.test(name) ? "UI file" : STYLESHEET.test(name) ? "stylesheet" : SCRIPT_FILE.test(name) ? "script" : null;
  }
  if (kind === null) return null;
  const targetRel = toPosix(relative(realRoot, target));
  const outside = targetRel === ".." || targetRel.startsWith("../") || isAbsolute(targetRel);
  // Under its real path the scan reaches it, so nothing is lost by not following the link.
  const scanned = !outside && (targetRel === "" || !inSkippedPlace(targetRel, packageDirTest(contract.root)));
  const info = { kind, target, targetRel, outside, scanned };
  if (kind === "directory") {
    info.ancestor = /^\.\.(\/\.\.)*$/.test(targetRel);
    if (peek && !scanned) {
      const look = peekDirectory(target);
      if (!look.source && look.complete) return null; // nothing behind it that Undrift would read
      if (!look.source) info.uncertain = true;
      else if (!look.includable && look.complete) info.stylesheetsOnly = true;
    }
  }
  return info;
}

// Every path a profile includes, with no place left out: a real path in a place the scan
// skips is still included when a profile names it, and that is what the fix asks for.
export function includedPaths(contract) {
  const paths = new Set();
  for (const profile of Object.values(contract.profiles ?? {})) {
    for (const file of fg.sync(profile.include ?? [], { cwd: contract.root, ...GLOB_OPTIONS })) paths.add(file);
  }
  return paths;
}

// The links a profile's include matches, by the link's own path. An ordinary walk drops a link
// to a file (it is not a file it can read without following), and one that reports what matches
// returns it. A script matters to Undrift only where a profile includes it: the scan lists no
// script of its own, so a link that is itself one script is the profile's business, and is
// reported only when a profile's include matches the link.
function includedLinks(contract) {
  const paths = new Set();
  for (const profile of Object.values(contract.profiles ?? {})) {
    const matched = fg.sync(profile.include ?? [], { cwd: contract.root, ...GLOB_OPTIONS, onlyFiles: false });
    for (const path of matched) paths.add(path);
  }
  return paths;
}

// Does a profile include what the link leads to? By the real path, which the fix asks for, or, for
// a directory, by the link's own (relative, or absolute as an include may write it): a pattern that
// starts at a link (`ui/**/*.tsx`, `ui` a link) is opened directly by the glob, and what it matches
// has paths under the link. A stylesheet is never
// covered: no profile can cover one, whatever it includes.
// Returns null when the link is not covered, and otherwise the stylesheets behind it (by their path
// under the link's own name), which no profile covered and which are still not checked.
function includeCovers(included, info, rel, abs) {
  if (info.kind === "stylesheet" || info.stylesheetsOnly) return null;
  if (info.kind === "directory") {
    const forms = [info.targetRel, info.target, rel, abs];
    let reached = false;
    for (const form of forms) {
      for (const path of included) if (path.startsWith(`${form}/`)) reached = true;
    }
    if (!reached) return null;
    // A link is covered only when every UI file behind it is matched, under some name. A profile that
    // matches a few files behind a link has not been through the rest, and the hook says of those that
    // it did not check them, so the run must not say on-system. When the look behind the link could not
    // be finished, what is there is not known, and that is not covered either.
    const look = uiFilesBehind(info.target);
    if (!look.complete) return null;
    if (!look.files.every((file) => forms.some((form) => included.has(`${form}/${file}`)))) return null;
    return look.stylesheets.map((sheet) => `${rel}/${sheet}`);
  }
  return included.has(info.targetRel) || included.has(info.target) ? [] : null;
}

/** The pattern that includes what a link leads to, written for the config. */
const realPathPattern = ({ kind, target }) => (kind === "directory" ? `${escapeGlob(target)}/**/*.tsx` : escapeGlob(target));

/**
 * The links the scan met that lead somewhere unread, sorted by path, with the counts.
 * `found` is every such link, and the rest is what became of each.
 */
function classifyLinks(contract, links, sets, coveredBy = null) {
  const counts = { found: 0, covered: 0, ignored: 0, notChecked: 0 };
  const notFollowed = [];
  const sheets = [];
  if (links.length === 0) return { counts, notFollowed, sheets };
  let realRoot;
  try {
    realRoot = realpathSync(contract.root);
  } catch {
    return { counts, notFollowed, sheets };
  }
  let included = coveredBy;
  let includedLink = null;
  for (const rel of links) {
    const info = linkTarget(contract, realRoot, rel, { peek: true });
    if (info === null || info.scanned) continue;
    if (info.kind === "script") {
      includedLink ??= includedLinks(contract);
      if (!includedLink.has(rel)) continue;
    }
    counts.found += 1;
    if (ignoreNames(contract, sets.ignored, rel)) {
      counts.ignored += 1;
      continue;
    }
    included ??= includedPaths(contract);
    const behind = includeCovers(included, info, rel, toPosix(join(contract.root, rel)));
    // A link a profile covers is judged for what is behind it, file by file. An ignore entry that reaches
    // one file under a link accounts for that file, and does not account for the rest of what is there:
    // the link is accounted for only when every file behind it is.
    if (behind === null && ignoreAccountsForLink(contract, sets.ignored, rel, info)) {
      counts.ignored += 1;
      continue;
    }
    if (behind !== null) {
      counts.covered += 1;
      // A covered link is not a covered stylesheet: no profile covers one, so each one behind it is
      // reported like a stylesheet in the repository, unless `ignore` accounts for it.
      for (const sheet of behind) sheets.push(sheet);
      continue;
    }
    counts.notChecked += 1;
    notFollowed.push({
      path: rel,
      target: info.outside && isAbsolute(info.targetRel) ? info.target : info.targetRel,
      kind: info.kind,
      ...(info.uncertain ? { uncertain: true } : {}),
      ...(info.stylesheetsOnly ? { stylesheetsOnly: true } : {}),
      ...(info.ancestor ? { ancestor: true } : {}),
    });
  }
  return { counts, notFollowed, sheets };
}

/**
 * The link on the way to a file the hook was asked about, when the file is source that
 * lives somewhere the scan does not reach and nothing accounts for the link. Source is a UI
 * file, a stylesheet, or a script: behind a link to a directory, where the whole-repository
 * run reports the link whatever is in it, and when the link is itself the script and a
 * profile's include matches the link, as the run reports it. Null for a path with no link on
 * the way, for one under a place the scan never opens (node_modules, a hidden folder, a
 * package's own build output), for one that leads to a place the scan reads (it is then
 * judged where it really is), for what is not source, and for a link `ignore` accounts for.
 * A profile that includes the real path is the caller's to check: it gates the file.
 * @returns {{file: string, link: string, target: string, kind: string, real: string, linkKind: string, ancestor?: true, covered?: true} | null}
 */
export function unfollowedLink(contract, file) {
  const lexical = toPosix(relative(contract.root, resolve(file)));
  if (lexical === "" || lexical === ".." || lexical.startsWith("../") || isAbsolute(lexical)) return null;
  if (inSkippedPlace(lexical, packageDirTest(contract.root))) return null;
  const parts = lexical.split("/");
  let link = null;
  let at = contract.root;
  for (let i = 0; i < parts.length; i++) {
    at = join(at, parts[i]);
    try {
      if (lstatSync(at).isSymbolicLink()) {
        link = parts.slice(0, i + 1).join("/");
        break;
      }
    } catch {
      return null;
    }
  }
  if (link === null) return null;
  let realRoot;
  let real;
  try {
    realRoot = realpathSync(contract.root);
    real = realpathSync(file);
  } catch {
    return null;
  }
  const name = basename(real);
  const kind = UI_FILE.test(name) ? "UI file" : STYLESHEET.test(name) ? "stylesheet" : SCRIPT_FILE.test(name) ? "script" : null;
  if (kind === null) return null;
  const info = linkTarget(contract, realRoot, link);
  if (info === null || info.scanned) return null;
  // The link is the script itself: it matters only if a profile's include matches the link.
  if (info.kind === "script" && !includedLinks(contract).has(link)) return null;
  const ignored = ignoredFiles(contract);
  if (ignoreNames(contract, ignored, link)) return null;
  // Whether a profile covers the link, as the whole-repository run judges it. A covered link is
  // judged for what is behind it, file by file: a stylesheet is told unless it is the one ignored, and
  // a script is the profile's business exactly as it is in the repository (a script no profile
  // includes is not one Undrift claims to check, there or here), so no notice about the link is due.
  let covered = false;
  if (info.kind === "directory") {
    const peeked = linkTarget(contract, realRoot, link, { peek: true });
    covered = peeked !== null && includeCovers(includedPaths(contract), peeked, link, toPosix(join(contract.root, link))) !== null;
  }
  // A file that `ignore` names is accounted for, wherever it is. Beyond that the link is judged as the
  // run judges it: a covered link, for what is behind it (a stylesheet is told, a script is not); an
  // uncovered one is accounted for only when `ignore` accounts for everything behind it.
  if (ignored.has(lexical)) return null;
  if (!covered && ignoreAccountsForLink(contract, ignored, link, info)) return null;
  if (covered && kind !== "stylesheet") return null;
  const shown = info.outside && isAbsolute(info.targetRel) ? info.target : info.targetRel;
  return {
    file: lexical, link, target: shown, kind, real: toPosix(relative(realRoot, real)), linkKind: info.kind,
    ...(info.ancestor ? { ancestor: true } : {}),
    ...(covered ? { covered: true } : {}),
  };
}

/**
 * Does a profile's include match any file at all? Only a glob: nothing is read or parsed. A
 * profile that matches nothing leaves nothing unchecked when it does not run.
 */
export function profileMatchesFiles(contract, name) {
  const include = contract.profiles?.[name]?.include ?? [];
  return fg.sync(include, { cwd: contract.root, ...GLOB_OPTIONS }).length > 0;
}

/**
 * The first profile, in config order, whose include matches `rel`. Any file type:
 * a profile may include .ts as well as .tsx. Null when no profile covers it.
 *
 * A file has more than one name. `alsoAs` lists the others a profile's include may give it: the
 * path as written when it was reached through a link (an include that starts at a link matches
 * that way and no other), and its absolute real path (an include may name it so). `as` is the
 * name that matched.
 * @returns {{name: string, profile: object, as: string} | null}
 */
export function profileFor(contract, rel, alsoAs = []) {
  for (const covering of coveringProfiles(contract, rel, alsoAs)) return covering; // lazily: the first is all that is asked
  return null;
}

/** Every profile that covers the file, in the config's order: the gate judges a file with each of them. */
export function profilesFor(contract, rel, alsoAs = []) {
  return [...coveringProfiles(contract, rel, alsoAs)];
}

function* coveringProfiles(contract, rel, alsoAs) {
  const names = [rel, ...alsoAs].filter((name) => typeof name === "string" && name !== "").map(toPosix);
  for (const [name, profile] of Object.entries(contract.profiles ?? {})) {
    const matched = new Set(fg.sync(profile.include ?? [], { cwd: contract.root, ...GLOB_OPTIONS }));
    const as = names.find((candidate) => matched.has(candidate));
    if (as !== undefined) yield { name, profile, as };
  }
}

/**
 * How one file is accounted for. Null for a file undrift has no claim on: neither
 * a UI file nor a stylesheet, or outside the root, or in a skipped place.
 * @returns {{kind: "ui"|"stylesheet", status: "covered"|"excluded"|"ignored"|"notChecked"} | null}
 */
export function accountFor(contract, rel) {
  const posix = toPosix(rel);
  const ui = isUiFile(posix, contract.root);
  if (!ui && !isStylesheet(posix, contract.root)) return null;
  const kind = ui ? "ui" : "stylesheet";
  return { kind, status: statusOf(expansions(contract), posix, kind) };
}

/**
 * What each run set aside in `field` (its stylesheets, or its other files that are not
 * scripts), and which of them `ignore` accounts for. One entry per run: the root-relative
 * paths still unchecked, how many `ignore` accounts for, and how many the run set aside
 * in all.
 */
function accountRunAside(contract, runs, field) {
  const anySet = runs.some((run) => (run[field] ?? []).length > 0);
  const ignored = anySet ? ignoredFiles(contract) : new Set();
  return runs.map((run) => {
    const rels = [
      ...new Set((run[field] ?? []).map((abs) => toPosix(relative(contract.root, abs)))),
    ].sort();
    const unchecked = rels.filter((rel) => !ignored.has(rel));
    return { total: rels.length, unchecked, ignored: rels.length - unchecked.length };
  });
}

/** The stylesheets each run set aside, and which of them `ignore` accounts for. */
export const accountRunStylesheets = (contract, runs) => accountRunAside(contract, runs, "stylesheets");

/** The files each run set aside because they are not scripts or stylesheets, and which `ignore` accounts for. */
export const accountRunOthers = (contract, runs) => accountRunAside(contract, runs, "others");

// ------------------------------------------------------------------- items
//
// Everything the run was configured to check and did not, as one list. The text,
// the JSON and the hook all read it, so they cannot say different things. Each
// item carries `kind`, the fields that locate it, a `reason` that names the thing,
// and a `fix`. Sources come first, since everything else depends on an input.

/**
 * How many paths the text prints beneath a `files`, `stylesheets` or `skipped` item.
 * The item itself carries every path, and the JSON is that item; the text is what a
 * person reads, so it lists this many and says how many more there are.
 */
export const LISTED = 10;

// What every fix says about `ignore`. Whether a file is checked is the owner's call, and the
// reader of a fix may be the agent that wrote the file: it proposes the entry, with its
// reason, to the user, and does not write one. The hook says the same words.
const PROPOSE_IGNORE = 'propose an "ignore" entry, with the reason, to the user; do not add one yourself.';

const SOURCE_TEXT = {
  tokens: {
    effect: "so it contributed no tokens",
    fix: "Build it, or correct the path in undrift.config.json.",
  },
  tokensCss: {
    effect: "so it contributed no tokens",
    fix: "Build it, or correct the path in undrift.config.json.",
  },
  catalog: {
    effect: "so no components were read from it",
    fix: "Create it, or correct the path in undrift.config.json.",
  },
  componentsFrom: {
    effect: "so no components were read from it",
    fix: "Build the package so its type declarations exist, or correct the path in undrift.config.json.",
  },
};

function sourceItem({ key, path }) {
  const text = SOURCE_TEXT[key] ?? { effect: "so it was not read", fix: "Correct the path in undrift.config.json." };
  return {
    kind: "source",
    key,
    path,
    reason: `${key} "${path}" does not exist, ${text.effect}.`,
    fix: text.fix,
  };
}

// A source that is on disk and could not be read. The reason is the one loadContract
// recorded, and what it cost is the same as for a source that is not there.
function unreadableItem({ key, path, reason }) {
  const effect = SOURCE_TEXT[key]?.effect ?? "so it was skipped";
  return {
    kind: "source",
    key,
    path,
    reason: `${key} "${path}" could not be read (${reason}), ${effect}.`,
    fix: "Repair it, or correct the path in undrift.config.json.",
  };
}

// On a run over explicit paths the profile's include is replaced by them, so the
// reason is about the argument, and there is one item for each that found nothing.
function unmatchedItem(name, arg) {
  return {
    kind: "profile",
    profile: name,
    paths: [arg],
    reason: `The path given (${arg}) matched no files, so no rule ran for it.`,
    fix: `Check the path, and quote a glob so the shell does not expand it first.${patternEscapeAdvice([arg])}`,
  };
}

function profileItem(name, contract) {
  // As the person wrote it: ".//nothing/**" is what they will look for in the config.
  const profile = contract.profiles?.[name];
  const include = profile?.includeWritten ?? profile?.include ?? [];
  return {
    kind: "profile",
    profile: name,
    include,
    reason: `Profile ${name} matched no files (include: ${include.join(", ")}), so no rule ran in it.`,
    fix: `Correct the include patterns in undrift.config.json so they match the files this profile is for.${patternEscapeAdvice(include)}`,
  };
}

// A declared primitive that names no token: the declaration checks less than it says, and a stale glob is how
// a renamed palette stops being defended without anyone noticing.
const primitivesItem = (pattern) => ({
  kind: "primitives",
  pattern,
  reason: `primitives ${JSON.stringify(pattern)} matches no token in the configured sources, so it declares no primitive.`,
  fix:
    'Correct it in "primitives" in undrift.config.json to the token names the system declares, or remove it. ' +
    "The list is the system's own declaration, so propose the change to the user and do not make it yourself.",
});

function ruleItem(profile, { rule, reason, fix }) {
  return { kind: "rule", profile, rule, reason: `${rule} did not run in profile ${profile}. ${reason}`, fix };
}

// `places` are the values the rule set aside in this run, as `file:line name`: listed beneath the note, as a files
// item's paths are, so what was not checked is named and not only counted.
const partlyItem = (profile, { rule, reason, fix, places }) => ({
  kind: "rulePart", profile, rule, reason: `${rule} ran only in part in profile ${profile}. ${reason}`, fix,
  ...(places?.length ? { files: places, count: places.length } : {}),
});

// Values the gate set aside, by why. Each is a value no rule could judge truthfully: neither "use a token" nor
// "clean" is true of it. A note, like a rule part: nobody can fix it, so it never fails --strict, and the
// status line says it rather than "on-system".
const VALUES_TEXT = {
  renderer: {
    what: (one) => `${one ? "it styles" : "they style"} a renderer that does not read CSS (@react-pdf/renderer), so no token can reach ${one ? "it" : "them"}`,
    fix: (one) => `Nothing to fix. ${one ? "It is" : "They are"} listed so that a clean run is not read as having checked ${one ? "it" : "them"}. To follow the design system there, take ${one ? "the value" : "each value"} from its token when the document is built.`,
  },
  meta: {
    what: (one) => `${one ? "it is" : "they are"} the content of a <meta> tag, which the browser reads outside every stylesheet, so no token can reach ${one ? "it" : "them"}`,
    fix: (one) => `Nothing to fix. ${one ? "It is" : "They are"} listed so that a clean run is not read as having checked ${one ? "it" : "them"}.`,
  },
  inputType: {
    what: (one) => `${one ? "it is" : "they are"} the type of an <input> that no component is mapped for in "intrinsics", or a type read only at runtime, so no-raw-elements cannot name what replaces the input`,
    fix: () => 'Map the type to the system\'s component in "intrinsics", for example "input[type=checkbox]": "Checkbox". If the system has none for it, nothing to fix.',
  },
  unreadToken: {
    what: (one, values) => unreadWhat(one, values),
    // Where each search ended, for the tokens that were declared but point at one that was not.
    detail: (values) => unreadDetail(values),
    fix: (one, values) => unreadFix(one, values),
  },
  runtimeName: {
    what: (one) => `${one ? "it is" : "they are"} the start of a custom property name the code finishes at runtime (var(--chart-\${...})), so ${one ? "the name" : "the names"} cannot be checked against the tokens`,
    fix: (one) => `Nothing to fix if every name ${one ? "it" : "they"} can make is a token. A name is checked when it is written out in full.`,
  },
};

// Where the search for a token's value ended, for each way it ended. A token that is itself undeclared needs no
// sentence of its own: the item already says its value could not be read.
const stopsOf = (values) => values.flatMap((value) => value.stops ?? []);
const lastOf = (stop) => stop.path[stop.path.length - 1];
const listOf = (words) => (words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

function unreadDetail(values) {
  const sentences = new Set();
  for (const stop of stopsOf(values)) {
    const { path } = stop;
    const where = path.length === 2 ? `${path[0]} is var(${path[1]})` : `${path[0]} leads, through ${listOf(path.slice(1, -1))}, to ${lastOf(stop)}`;
    if (stop.depth) sentences.add(`${path[0]} leads through more tokens than Undrift follows (nine).`);
    else if (stop.code) sentences.add(path.length === 1 ? `${path[0]} is set by the product's code, so Undrift cannot read its value.` : `${where}, which the product's code sets, so Undrift cannot read its value.`);
    else if (path.length > 1) sentences.add(`${where}, which no stylesheet that was read declares.`);
  }
  const all = [...sentences];
  const shown = all.slice(0, 5).join(" ");
  return all.length === 0 ? "" : ` ${shown}${all.length > 5 ? ` And ${all.length - 5} more.` : ""}`;
}

// Said of the position: a colour function around a token (`hsl(var(--x))`) takes channels, and a token taken in a mix, a
// light-dark or as the origin of a relative colour is a whole colour there. An item can be either, or both.
const SLOT_POSITIONS = "(an arm of color-mix() or light-dark(), or the origin of a relative colour)";
function unreadWhat(one, values) {
  const slot = values.some((value) => value.slot);
  const wrap = values.some((value) => !value.slot);
  const be = one ? "it is" : "they are";
  if (slot && wrap) {
    return `${one ? "it is" : "each is"} either a colour function around a token (hsl(var(--x))) or a token taken where a whole colour is expected ${SLOT_POSITIONS}, and the token's value could not be read, so Undrift cannot tell whether it holds channels or a whole colour`;
  }
  if (slot) {
    return `${be} ${one ? "a token" : "tokens"} taken where a whole colour is expected ${SLOT_POSITIONS}, and ${one ? "its value" : "their values"} could not be read, so Undrift cannot tell whether ${one ? "it holds" : "each holds"} a whole colour or channels`;
  }
  return `${be} a colour function around a token whose value could not be read, so Undrift cannot tell whether the token holds channels or a whole colour`;
}

function unreadFix(one, values) {
  const stops = stopsOf(values);
  // What is right for the colour function there: channels inside hsl() and the like, a whole colour inside a mix or a light-dark.
  const slot = values.some((value) => value.slot);
  const wrap = values.some((value) => !value.slot);
  const right = slot && wrap
    ? "what its colour function takes (channels in hsl() and the like, a whole colour in a mix or a light-dark)"
    : slot ? "a whole colour" : "channels";
  const sheets = stops.filter((stop) => !stop.depth && !stop.code);
  const names = [...new Set(sheets.map(lastOf))];
  const code = [...new Set(stops.filter((stop) => stop.code).map(lastOf))];
  const parts = [];
  if (names.length > 0) {
    const own = sheets.every((stop) => stop.path.length === 1);
    const many = !own && names.length > 1;
    const which = own ? (one ? "the token" : "each token") : listOf(names);
    parts.push(
      `Make the ${many ? "stylesheets" : "stylesheet"} that ${many ? "declare" : "declares"} ${which} readable, for example list ${many ? "them" : "it"} in "tokensCss" in undrift.config.json, ` +
      `so ${many ? "their values" : "its value"} can be followed. If ${many ? "each is" : "it is"} declared with ${right}, nothing to fix.`
    );
  }
  if (code.length > 0) {
    const many = code.length > 1;
    parts.push(
      `${listOf(code)} ${many ? "are" : "is"} set by the product's code, which no stylesheet declares. ` +
      (slot && wrap
        ? `Nothing to fix if the code sets what its colour function takes (channels in hsl() and the like, a whole colour in a mix or a light-dark). ` +
          `If it sets channels in a mix or a light-dark, wrap ${many ? "each" : "it"} in the colour function that takes them, for example hsl(var(${code[0]})). ` +
          `If it sets a whole colour inside hsl() and the like, use the variable on its own.`
        : slot
          ? `Nothing to fix if the code sets a whole colour. If it sets channels, wrap ${many ? "each" : "it"} in the colour function that takes them, for example hsl(var(${code[0]})).`
          : `Nothing to fix if the code sets channels (for example 220 14% 96%). If it sets a whole colour, use the variable on its own, without the colour function around it.`)
    );
  }
  if (stops.some((stop) => stop.depth)) parts.push("Undrift follows a token through at most nine others, so a shorter chain of tokens can be read.");
  return parts.length > 0 ? parts.join(" ") : `Make the stylesheet that declares ${one ? "the token" : "each token"} readable, for example list it in "tokensCss" in undrift.config.json, so its value can be followed. If it is declared with ${right}, nothing to fix.`;
}

// File then line then column, whatever order the rules found them in: a person reads the list top to bottom.
const byPlace = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.column ?? 0) - (b.column ?? 0));

function valuesItem(contract, profile, why, found) {
  const values = [...found].sort(byPlace);
  const one = values.length === 1;
  const text = VALUES_TEXT[why];
  return {
    kind: "values",
    profile,
    why,
    count: values.length,
    rules: [...new Set(values.map((v) => v.rule))].sort(),
    files: values.map((v) => `${toPosix(relative(contract.root ?? "", v.file))}:${v.line} ${v.found}`),
    reason: `${values.length} ${one ? "value was" : "values were"} not checked in profile ${profile}: ${text.what(one, values)}.${text.detail ? text.detail(values) : ""}`,
    fix: text.fix(one, values),
  };
}

// UI files only a profile that did not run covers: `--profile` ran some profiles, and
// nothing in this run looked at these. A strict run that says on-system has to have
// looked at everything, so this is a not-checked item like any other.
function skippedItem(entries, ran) {
  const one = entries.length === 1;
  const names = [...new Set(entries.flatMap((entry) => entry.profiles))].sort();
  return {
    kind: "skipped",
    count: entries.length,
    files: entries.map((entry) => entry.file),
    profiles: names,
    ran,
    reason:
      `${entries.length} UI ${one ? "file is" : "files are"} covered only by ${names.length === 1 ? "profile" : "profiles"} ${names.join(", ")}, ` +
      `which this run did not run (--profile ${ran.join(", ")}), so no rule ran on ${one ? "it" : "them"} in this run.`,
    fix:
      "Run undrift gate with no --profile to check every profile at once, or run each of the others: " +
      `${names.map((name) => `undrift gate --profile ${name}`).join(", ")}.`,
  };
}

// Directories the scan could not open. Whatever UI file or stylesheet is inside was not
// looked at, and a scan that dropped them would read as clean.
function directoriesItem(all) {
  const one = all.length === 1;
  const byReason = new Map();
  for (const dir of all) byReason.set(dir.reason, (byReason.get(dir.reason) ?? 0) + 1);
  const why =
    byReason.size === 1
      ? [...byReason.keys()][0]
      : [...byReason].map(([reason, n]) => `${reason} for ${n}`).join(", ");
  return {
    kind: "directories",
    count: all.length,
    files: all.map((dir) => dir.path),
    reason: `${all.length} ${one ? "directory" : "directories"} could not be read (${why}), so any UI file or stylesheet inside ${one ? "it" : "them"} was not checked.`,
    fix: `Make ${one ? "it" : "them"} readable, or ${PROPOSE_IGNORE}`,
  };
}

// Links that lead somewhere Undrift does not read. The item carries each link with what it
// leads to, and the fix says how to have it read: include the real path. A link whose folder
// was not looked into to the end says so, and claims no source; one to a folder that holds the
// repository has no pattern that would do, and is not offered one.
function linksItem(all) {
  const one = all.length === 1;
  const sure = all.filter((link) => !link.uncertain).length;
  const canInclude = (link) => link.kind !== "stylesheet" && !link.stylesheetsOnly;
  const includable = all.find((link) => canInclude(link) && !link.ancestor) ?? all.find(canInclude);
  const propose = includable ? PROPOSE_IGNORE : PROPOSE_IGNORE.replace("with the reason", "with a reason");
  const reason =
    sure === all.length
      ? `${all.length} symbolic ${one ? "link points" : "links point"} to source Undrift does not follow, so no rule ran on what is behind ${one ? "it" : "them"}.`
      : sure === 0
        ? `${all.length} symbolic ${one ? "link leads" : "links lead"} to ${one ? "a directory" : "directories"} Undrift does not follow, and it could not tell whether there is source behind ${one ? "it" : "them"}, so no rule ran on what is there.`
        : `${all.length} symbolic links lead to places Undrift does not follow, so no rule ran on what is behind them.`;
  let fix;
  if (!includable) {
    fix = `No profile covers a stylesheet, so a link that leads only to stylesheets can only be accounted for by ignore: ${propose}`;
  } else if (includable.ancestor) {
    fix =
      `Include the folders behind ${one ? "it" : "them"} that you mean in a profile, so the rules run on them. ` +
      `If ${one ? "it" : "they"} should not be checked, ${propose}`;
  } else {
    fix =
      `Include the real path in a profile so the rules run on it, for example ${JSON.stringify(realPathPattern(includable))}. ` +
      `If ${one ? "it" : "they"} should not be checked, ${propose}`;
  }
  return { kind: "links", count: all.length, files: all.map((link) => link.path), links: all, reason, fix };
}

function uiFilesItem(all) {
  const one = all.length === 1;
  return {
    kind: "files",
    count: all.length,
    files: all,
    reason: `${all.length} UI ${one ? "file is" : "files are"} covered by no profile, so no rule ran on ${one ? "it" : "them"}.`,
    // The same words as the hook's notice: an agent that runs the gate reads this, and an
    // exemption is the owner's call, so it is proposed and never written by the author.
    fix:
      `Add ${one ? "it" : "them"} to a profile's include in undrift.config.json so the rules run on ${one ? "it" : "them"}.` +
      pathEscapeAdvice(all, "/**/*.tsx") +
      ` If ${one ? "it" : "they"} should not be checked, ${PROPOSE_IGNORE}`,
  };
}

// Files a profile or a path reached that Undrift cannot read: Markdown, MDX, JSON, SVG. They
// are set aside, never parsed as TSX, and reported the way a stylesheet is.
function unsupportedItem(all) {
  const one = all.length === 1;
  return {
    kind: "unsupported",
    count: all.length,
    files: all,
    reason:
      `${all.length} ${one ? "file is" : "files are"} not ${one ? "a file" : "files"} Undrift can check ` +
      `(it reads .ts, .tsx, .js, .jsx, .mts, .cts, .mjs and .cjs), so no rule ran on ${one ? "it" : "them"}.`,
    fix:
      "Narrow the profile's include, or the path given, to the files Undrift can check. " +
      `If ${one ? "it" : "they"} should stay, ${PROPOSE_IGNORE}`,
  };
}

function stylesheetsItem(all) {
  const one = all.length === 1;
  return {
    kind: "stylesheets",
    count: all.length,
    files: all,
    reason:
      "Undrift does not check stylesheets yet, so a value set in " +
      `${one ? "this stylesheet" : `these ${all.length} stylesheets`} is not checked against the design system's tokens.`,
    fix:
      `Read ${one ? "it" : "them"} by hand for raw colours and lengths. ` +
      `Undrift cannot check ${one ? "it" : "them"}, so only the user can accept ${one ? "it" : "them"} as unchecked: ` +
      'propose an "ignore" entry, with a reason, to the user; do not add one yourself. ' +
      "No profile can cover a stylesheet, because no rule reads CSS yet." +
      pathEscapeAdvice(all),
  };
}

/**
 * @param {object} args
 * @param {object} args.contract
 * @param {object[]} args.runs        the profile runs, each with `name`, `files`, `rulesNotRun` and, when it has any, `rulesPartlyRun`
 * @param {string[]|null} [args.paths] the explicit paths given, or null for a whole-repository run
 * @param {object|null} [args.coverage] classifyCoverage(contract), or null when paths were given
 * @param {string[]} [args.stylesheets] on a run over explicit paths, the stylesheets it set aside
 *   that `ignore` does not account for (a whole-repository run gets them from `coverage`)
 * @param {string[]} [args.others] the files the runs set aside because Undrift cannot read
 *   them (not scripts, not stylesheets), that `ignore` does not account for
 * @param {{unreadable: object[], links: object[]}|null} [args.walked] on a run over explicit paths,
 *   the directories the globs could not read and the links they met (accountWalked); a
 *   whole-repository run gets them from `coverage`, which has merged them
 */
export function collectNotChecked({ contract, runs, paths = null, coverage = null, stylesheets = [], others = [], walked = null }) {
  const items = [];
  for (const source of contract.missingSources ?? []) items.push(sourceItem(source));
  for (const source of contract.unreadableSources ?? []) items.push(unreadableItem(source));
  // A declaration none of whose names matches a token leaves the rule with nothing to check, and the profile that
  // lists the rule says so. That item names the declaration, so the entries are not counted a second time.
  const declared = layersOf(contract);
  const allStale = declared.unmatched.length > 0 && declared.unmatched.length === (contract.primitives ?? []).length;
  const saidByRule = runs.some((run) => (run.rulesNotRun ?? []).some((n) => n.rule === "no-primitive-tokens"));
  if (!(allStale && saidByRule)) for (const pattern of declared.unmatched) items.push(primitivesItem(pattern));
  for (const run of runs) {
    if (paths) {
      for (const arg of run.unmatched ?? []) items.push(unmatchedItem(run.name, arg));
    } else if (run.files === 0 && (run.stylesheets ?? []).length === 0 && (run.others ?? []).length === 0) {
      // A run that set a file aside (a stylesheet, or one that is not a script) did match
      // something: the file is reported for itself, and a profile "that matched no files"
      // would be untrue.
      items.push(profileItem(run.name, contract));
    }
  }
  for (const run of runs) {
    for (const notRun of run.rulesNotRun ?? []) items.push(ruleItem(run.name, notRun));
    for (const part of run.rulesPartlyRun ?? []) items.push(partlyItem(run.name, part));
    const byWhy = new Map();
    for (const v of run.valuesNotChecked ?? []) byWhy.set(v.why, [...(byWhy.get(v.why) ?? []), v]);
    for (const why of [...byWhy.keys()].sort()) items.push(valuesItem(contract, run.name, why, byWhy.get(why)));
  }
  if (coverage?.notCovered.length) items.push(uiFilesItem(coverage.notCovered));
  if (coverage?.notRun?.length) items.push(skippedItem(coverage.notRun, coverage.ran));
  const directories = coverage?.unreadable ?? walked?.unreadable ?? [];
  const links = coverage?.links ?? walked?.links ?? [];
  if (directories.length) items.push(directoriesItem(directories));
  if (links.length) items.push(linksItem(links));
  // A whole-repository run knows the stylesheets the scan found, and also the ones a profile's
  // glob reached in a place the scan skips (a package's dist, a dot-directory): the run set
  // those aside, and its own line said so, so the item has to as well. Each is listed once.
  const sheets = coverage ? [...new Set([...coverage.stylesheets, ...stylesheets])].sort() : stylesheets;
  if (sheets.length) items.push(stylesheetsItem(sheets));
  if (others.length) items.push(unsupportedItem(others));
  return items;
}
