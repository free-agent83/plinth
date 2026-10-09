// packages/undrift/src/readers/css-tokens.mjs
// Extracts CSS custom properties from any stylesheet. Format-generic:
// works on formatted or minified CSS, from any design system. This is why
// undrift needs no per-system adapters.

/**
 * The stylesheet with every closed comment removed. A declaration inside a comment is not a
 * declaration, and a comment marker inside a string (`content: "/*"`) or after a backslash is not a
 * comment. Not applied by the readers below, so what they return does not move (assess uses them): the
 * contract and the stylesheet-import reader apply it before they read, so that the two agree on what a
 * comment hides. An unclosed comment is left as it is. A string ends at its closing quote or at the end
 * of its line, as CSS ends a string that was never closed.
 */
export function stripCssComments(css) {
  let out = "";
  let kept = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "\\") {
      i++;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < css.length && css[i] !== c && css[i] !== "\n") i += css[i] === "\\" ? 2 : 1;
    } else if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) break;
      out += css.slice(kept, i);
      i = end + 1;
      kept = end + 2;
    }
  }
  return out + css.slice(kept);
}

// --name : value   (the value runs to the next ; or })
// The assessment's reading, kept as it was: `--name:` anywhere, a selector included. readCssTokens uses it, and
// the instrument's published results move only with an index re-run.
const ASSESS_DECL_RE = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g;

// A declaration starts a block or follows another one: after `{`, `;` or `}` (a nested rule), or at the start of
// the text, with only white space between. `.button--outline:first-child` is a selector: `--outline` follows a
// letter, so it is not a property. The name is read whole, escapes included (`--space-1\.5`), as layers.mjs reads
// it in a reference. The callers remove comments first (stripCssComments), so nothing else can come before one.
const DECL_RE = /(?<=^|[{};])\s*(--(?:[A-Za-z0-9_-]|\\.)+)\s*:\s*([^;}]+)/g;

/** @returns {[string, string][]} every declaration, in source order, repeats included */
export function readCssTokenDeclarations(css) {
  return [...css.matchAll(DECL_RE)].map((m) => [m[1], m[2].trim()]);
}

// A block that applies to every page whatever its theme: the root, the page, a shadow host, Tailwind's own `@theme`. A
// layer wraps what is in it and adds no condition. A theme class, an attribute, a media or feature query and a nested
// rule (`:root { .dark & { ... } }`) apply only some of the time.
const ALWAYS_SELECTOR = /^(?::root|html|:host)$/i;
const alwaysApplies = (prelude) => {
  const text = prelude.trim();
  if (/^@theme\b/i.test(text) || /^@layer\b/i.test(text)) return true;
  if (text.startsWith("@")) return false;
  return text.split(",").some((part) => ALWAYS_SELECTOR.test(part.trim()));
};

/**
 * @returns {[string, string, boolean][]} every declaration, as readCssTokenDeclarations reads them, with whether the
 *   block it is in always applies (see above): every block it is inside is the root, the page, a shadow host, an
 *   `@theme` or a layer. A declaration outside any block (a bare list of them) always applies.
 */
export function readCssTokenDeclarationsWithContext(css) {
  const matches = [...css.matchAll(DECL_RE)];
  const out = [];
  const stack = [];
  let preludeStart = 0;
  let next = 0;
  for (let i = 0; i <= css.length && next < matches.length; i++) {
    // The text before a declaration ends in `{`, `;` or `}`, so the blocks it is inside are known when it starts.
    while (next < matches.length && matches[next].index <= i) {
      out.push([matches[next][1], matches[next][2].trim(), stack.every(alwaysApplies)]);
      next++;
    }
    const c = css[i];
    if (c === '"' || c === "'") {
      for (i++; i < css.length && css[i] !== c && css[i] !== "\n"; i += css[i] === "\\" ? 2 : 1);
    } else if (c === "{") {
      stack.push(css.slice(preludeStart, i));
      preludeStart = i + 1;
    } else if (c === "}") {
      stack.pop();
      preludeStart = i + 1;
    } else if (c === ";") {
      preludeStart = i + 1;
    }
  }
  return out;
}

/**
 * @returns {Record<string,string>} token name → declared value (last wins). The assessment's reader: it reads
 * `--name:` wherever it appears, as it always has, so what the instrument measures does not move.
 */
export function readCssTokens(css) {
  return Object.fromEntries([...css.matchAll(ASSESS_DECL_RE)].map((m) => [m[1], m[2].trim()]));
}

// --name-*: initial, --name: initial  (Tailwind's way to remove a theme value, or every value of a namespace).
// Not a declaration of a token, so readCssTokenDeclarations never finds the `*` ones; this does.
const RESET_RE = /(--[A-Za-z0-9_*-]+)\s*:\s*initial\s*(?=[;}]|$)/gi;
const THEME_RE = /@theme\b[^{};]*\{/g;

/**
 * The resets to `initial` in `@theme` blocks, as written (`--color-*`, `--color-indigo-*`, `--color-white`),
 * in source order. Tailwind reads a reset there and nowhere else: `.legacy { --color-red-500: initial }` is a
 * plain declaration, and the colour still builds. A block inside the `@theme` block is not read.
 * @returns {string[]}
 */
export function readCssTokenResets(css) {
  const out = [];
  for (const open of css.matchAll(THEME_RE)) {
    let depth = 1;
    let own = "";
    for (let i = open.index + open[0].length; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      else if (depth === 1) own += css[i];
    }
    for (const m of own.matchAll(RESET_RE)) out.push(m[1]);
  }
  return out;
}
