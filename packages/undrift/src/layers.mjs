// Which tokens are primitives and which are roles, read from how the tokens
// refer to each other. No naming convention is assumed: "primitive" in a name
// means nothing here, so this works on any design system's tokens.
//
// Precision over recall. A rule built on this that misfires gets switched off,
// so a token is a primitive only when the graph leaves no doubt.

import { isColorValue, tokenColorIndex } from "./nearest.mjs";
import { roleUtility } from "./tailwind-colours.mjs";

// A name is letters, digits, "-", "_" and escapes (`--space-1\.5`), read whole. The `[,)]` after it keeps
// a fallback readable and stops a name that is cut short by an escape from being taken for another token.
const NAME = String.raw`--(?:[A-Za-z0-9_-]|\\.)+`;
const REF_RE = new RegExp(String.raw`var\(\s*(${NAME})\s*[,)]`, "g");
// A value that only passes a token on: var(--x), or light-dark(var(--x), var(--y)). A derivation (color-mix,
// calc) builds on a token without being a layer above it, so it is not one of these.
const PURE_RE = new RegExp(String.raw`^(?:var\(\s*(${NAME})\s*\)|light-dark\(\s*var\(\s*(${NAME})\s*\)\s*,\s*var\(\s*(${NAME})\s*\)\s*\))$`);
const passesOn = (value) => PURE_RE.exec(value)?.slice(1).filter(Boolean) ?? [];
const NAMESPACE_RE = /^--[A-Za-z0-9]+-/;

// Tailwind's namespaces that are two words: `--text-color-x`, `--background-color-x`, `--border-color-x`
// (a product may wire its `--priority-*` colours in through them), and `--ring-color-`, `--outline-color-`,
// `--accent-color-` and `--placeholder-color-`, each checked to build a utility in Tailwind 4.3.2. A one-word
// namespace is cut first, so these are tried before it: `--text-color-x` would otherwise lose only `--text-`.
const TWO_WORD_NAMESPACE_RE = /^--(?:text-color|background-color|border-color|ring-color|outline-color|accent-color|placeholder-color)-/;

// `--color-primary: var(--primary)` renames a token into Tailwind's colour
// namespace. It adds no layer, so it never makes `--primary` a primitive.
const isWiring = (from, to) =>
  [TWO_WORD_NAMESPACE_RE, NAMESPACE_RE].some((re) => re.test(from) && from.replace(re, "--") === to);

// A declared primitive is a token name, or a glob over names where `*` stands for any run of characters:
// `--color-primitive-*`. Nothing else is special, so a name with a `.` or a `(` is read as written.
const globToRegExp = (glob) =>
  new RegExp("^" + glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");

/**
 * @param {[string, string, boolean?][]} declarations every declaration from every token source, in order. A third item
 *   says whether the block it is in always applies (`:root`, not `.dark`); without one it does.
 * @param {string[]} [declared] the design system's own list of its primitives: token names or globs. When it is
 *   given, the primitive set is exactly the tokens it names (and the Tailwind aliases that only rename them), and the
 *   graph decides nothing about what is a primitive. Without it, the graph's reading is kept, to suggest: the advice
 *   uses it so that it never names a primitive as the fix, and nothing is flagged on it.
 * @returns {{ layered: boolean, declared: boolean, unmatched: string[], primitives: Set<string>, roles: Set<string>, roleLeaves: Set<string>, colourPrimitives: Set<string>, rolesFor: (name: string) => string[], valuesOf: (name: string) => string[], appliesAlways: (name: string) => boolean, coloursOf: (name: string) => string[] }}
 */
export function tokenLayers(declarations, declared) {
  const values = new Map();
  const refs = new Map();
  // The tokens declared in a block that always applies: one that only a theme class declares has no value elsewhere.
  const always = new Set();
  for (const [name, raw, applies] of declarations) {
    if (typeof name !== "string" || !name.startsWith("--") || typeof raw !== "string") continue;
    if (applies !== false) always.add(name);
    const value = raw.trim().replace(/\s+/g, " ");
    if (!values.has(name)) {
      values.set(name, new Set());
      refs.set(name, new Set());
    }
    values.get(name).add(value);
    for (const m of value.matchAll(REF_RE)) if (m[1] !== name) refs.get(name).add(m[1]);
  }

  const referredBy = new Map();
  for (const [from, targets] of refs) {
    for (const to of targets) {
      if (!values.has(to)) continue; // an unknown name is no-unknown-tokens' business
      if (!referredBy.has(to)) referredBy.set(to, []);
      referredBy.get(to).push(from);
    }
  }

  // Who passes a token on, as opposed to deriving from it.
  const passedOnBy = (to) =>
    (referredBy.get(to) ?? []).filter((from) => [...values.get(from)].some((v) => passesOn(v).includes(to)));

  // A palette-step shape: `--color-blue-9: var(--blue-9)` renames a token into Tailwind and passes it on unchanged.
  // The utility it gives (`bg-blue-9`) is the token's own, so the alias adds no layer.
  const renamesOf = (name) =>
    passedOnBy(name).filter(
      (from) => isWiring(from, name) && refs.get(from).size === 1 && [...values.get(from)].every((v) => passesOn(v).length === 1)
    );

  // What the graph alone reads as primitives, and the Tailwind aliases that only rename one.
  const infer = () => {
    const found = new Set();
    const aliases = new Map();
    for (const [name, set] of values) {
      if (refs.get(name).size > 0) continue; // it refers to another token
      if (set.size !== 1) continue; // it rebinds per theme: a role with literal values
      // A token that is only mixed or calculated from (`color-mix(in oklch, var(--x) 90%, black)`) is not
      // a layer under it: a literal role with a hover colour derived from it would read as a primitive.
      // A role built only on the entry's Tailwind alias does not count: single-theme shadcn has the same
      // graph (`--primary`, `--color-primary: var(--primary)`, `--color-ring: var(--color-primary)`), and
      // there `--primary` is a literal role. Precision first: neither is a primitive.
      if (!passedOnBy(name).some((from) => !isWiring(from, name))) continue;
      found.add(name);
      for (const alias of renamesOf(name)) aliases.set(alias, name);
    }
    for (const alias of aliases.keys()) found.add(alias);
    return { found, aliases };
  };
  const graph = infer();

  const primitives = new Set();
  const wired = new Map(); // a wiring alias of a primitive -> the primitive
  const isDeclared = Array.isArray(declared);
  // Each declared entry, and the tokens it names. One that names none is handed back, never dropped.
  const unmatched = [];
  if (isDeclared) {
    for (const entry of declared) {
      const re = globToRegExp(entry);
      const hits = [...values.keys()].filter((name) => re.test(name));
      if (hits.length === 0) unmatched.push(entry);
      for (const name of hits) primitives.add(name);
    }
    // The utility a Tailwind alias gives (`--color-blue-9: var(--blue-9)` makes `bg-blue-9`) is the
    // primitive's own, so the alias of a declared primitive is one too, as it is when the graph reads it.
    // Only in the colour namespace, where the colour utilities are read: a rename in a two-word namespace
    // (`--text-color-x`, `--border-color-x`) is a role as often as not, and a system that calls it one has no
    // way to say so. It is named by its own declaration or it is a role.
    for (const name of [...primitives]) {
      for (const alias of renamesOf(name)) {
        if (!alias.startsWith("--color-")) continue;
        wired.set(alias, name);
        primitives.add(alias);
      }
    }
  } else {
    for (const name of graph.found) primitives.add(name);
    for (const [alias, target] of graph.aliases) wired.set(alias, target);
  }

  // A primitive is a colour by its value, not by its name: the system names its tokens as it likes.
  const colourPrimitives = new Set(
    [...primitives].filter((n) => {
      const literal = wired.get(n) ?? n;
      return [...values.get(literal)].every((v) => isColorValue(v));
    })
  );

  // For advice only: the tokens a message must never name as the fix. The declared primitives, and what the
  // graph reads as a primitive as well, so a declaration that leaves the colour palette out (a list of the
  // dimensions only) does not leave the advice free to point at a palette entry. Nothing is flagged on these.
  // Under a declaration that names a colour, the declaration is the word and the graph adds nothing: a role the
  // declaration exists to protect (`--accent`, which reads as a palette step) must not be hidden by it. Only
  // where the declaration names no colour (a list of the dimensions) does the graph's reading stand in, so the
  // advice still never points at a palette entry.
  const borrowsGraph = !isDeclared || colourPrimitives.size === 0;
  const palette = new Set([...primitives, ...(borrowsGraph ? graph.found : [])]);
  // The graph's aliases of tokens the system did not declare. Those of a declared one are read by the declaration.
  const graphAliases = new Map(borrowsGraph ? [...graph.aliases].filter(([, target]) => !primitives.has(target)) : []);
  const aliasTarget = (n) => wired.get(n) ?? graphAliases.get(n) ?? n;
  const paletteColours = new Set([...palette].filter((n) => [...values.get(aliasTarget(n))].every((v) => isColorValue(v))));

  // A role refers to another token, or rebinds per theme. A single literal value
  // nobody builds on is neither: an unused palette entry or a literal role, and
  // the graph cannot say which, so nothing here suggests or flags it.
  // A declared primitive that refers to another token is still a primitive, never a role built on one.
  const roles = new Set([...values.keys()].filter((n) => !wired.has(n) && !primitives.has(n) && !graphAliases.has(n) && (refs.get(n).size > 0 || values.get(n).size > 1)));
  // A role is a leaf unless another token passes it on. One that only derives from it (a hover colour)
  // is built on the role, not above it, so it leaves the role named.
  const roleLeaves = new Set([...roles].filter((n) => passedOnBy(n).length === 0));

  // The first segment of a name, `color` for `--color-primary`: what kind of value a token is.
  const kindOf = (name) => name.slice(2).split("-")[0];
  // A token that renames a primitive into Tailwind, wherever it is rebound to: its name says it is that
  // primitive's utility, so it is never a role built on it.
  // Where the system declares its primitives, only a rename in the colour namespace is one (see above).
  // A token the graph reads as a primitive but the system did not declare counts for the advice too.
  const isRename = (from) =>
    [...refs.get(from)].some(
      (to) =>
        (primitives.has(to) && isWiring(from, to) && (!isDeclared || from.startsWith("--color-"))) ||
        (borrowsGraph && graph.found.has(to) && !primitives.has(to) && isWiring(from, to))
    );

  // The roles built on a token: the role leaves above it, through the roles that pass it on.
  const walkFrom = (given) => {
    const name = aliasTarget(given);
    // The walk starts at the token and at its aliases, and never collects an alias: a role built on
    // the Tailwind alias is built on the token.
    const start = [
      name,
      ...[...wired, ...graphAliases].filter(([, target]) => target === name).map(([alias]) => alias),
    ].filter((n, i, all) => all.indexOf(n) === i);
    const seen = new Set(start);
    const queue = [...start];
    const found = new Set();
    while (queue.length > 0) {
      const at = queue.shift();
      const passingOn = new Set(passedOnBy(at));
      for (const from of referredBy.get(at) ?? []) {
        if (seen.has(from) || isRename(from)) continue;
        // A role derived from a token (a hover colour) is offered when it is the same kind of value. A focus
        // shadow mixed from a colour is not a colour role, whether it is mixed from the role or the primitive.
        if (!passingOn.has(from) && kindOf(from) !== kindOf(at)) continue;
        seen.add(from);
        if (roleLeaves.has(from)) found.add(from);
        queue.push(from); // a leaf can have derived roles above it (a hover colour)
      }
    }
    return [...found].sort();
  };

  const rolesFor = (given) => (primitives.has(given) ? walkFrom(given) : []);
  // Any token, for the advice: a primitive, or a token no layer was declared for that a role passes on
  // (`--brand: #e11d48` beside `--color-brand: var(--brand)`). [] when nothing passes it on.
  const rolesOn = (given) => (values.has(given) ? walkFrom(given) : []);

  // Every value a token was declared with, light and dark, in the order they were read.
  const valuesOf = (name) => [...(values.get(name) ?? [])];

  // The literal colours a token comes to, in every theme: its own colour values, and those of the tokens it
  // passes on. A role built on a primitive resolves to the primitive's colour. What cannot be placed (a
  // colour-mix, a calc) is left out: there is nothing to measure a distance against.
  const coloursOf = (name) => {
    const found = [];
    const seen = new Set();
    const visit = (at) => {
      if (seen.has(at)) return;
      seen.add(at);
      for (const value of values.get(at) ?? []) {
        if (isColorValue(value)) found.push(value);
        else for (const to of passesOn(value)) visit(to);
      }
    };
    visit(name);
    return found;
  };

  return { layered: primitives.size > 0, declared: isDeclared, unmatched, primitives, colourPrimitives, palette, paletteColours, roles, roleLeaves, rolesFor, rolesOn, valuesOf, appliesAlways: (name) => always.has(name), coloursOf };
}

const NOT_LAYERED = tokenLayers([]);

/** The contract's layers, or the layers of its tokens (and its declared primitives) when it was built by hand. */
export function layersOf(contract) {
  if (contract?.layers) return contract.layers;
  const tokens = contract?.tokens;
  if (!tokens || typeof tokens !== "object") return NOT_LAYERED;
  return tokenLayers(Object.entries(tokens), contract.primitives ?? undefined);
}

/**
 * The colours the nearest-colour advice measures against: every literal colour a token was declared with,
 * in every theme. A token that is one colour in the light theme and another in the dark is near both, so
 * the dark theme's value, the last one declared, no longer hides the light one. The gate and the
 * older-problems note both read this, so they name the same token.
 */
export const colourIndexOf = (contract) => tokenColorIndex(contract?.tokens ?? {}, layersOf(contract));

/**
 * The token set has a primitive that is a colour, decided from the token's value and not from its name.
 * A set can be layered by something else (shadcn's `--radius` is a primitive: the radius scale is built on
 * it), and that says nothing about whether the colours have a layer.
 */
export const hasColourPrimitive = (layers) => (layers?.colourPrimitives?.size ?? 0) > 0;

/**
 * The same for the advice: a colour is a palette entry when the system declared it a primitive or the graph reads
 * it as one. The advice never names one as the fix, whatever the declaration left out.
 */
export const hasColourPalette = (layers) => (layers?.paletteColours?.size ?? 0) > 0;

// How a role is named to an agent: as the Tailwind utility with the prefix it wrote,
// when there is one and the role gives that utility, otherwise as var().
const roleHint = (role, prefix) => (prefix && roleUtility(role, prefix)) || `var(${role})`;

// All the roles, not a guessed top three: the agent picks by meaning.
const MAX_ROLES_NAMED = 8;

/** The roles, sorted as given, up to eight named and the rest counted. */
export function listRoles(roles, prefix) {
  const named = roles.slice(0, MAX_ROLES_NAMED).map((r) => roleHint(r, prefix)).join(", ");
  const rest = roles.length - MAX_ROLES_NAMED;
  return rest > 0 ? `${named} and ${rest} more` : named;
}
