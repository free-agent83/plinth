// packages/undrift/src/readers/css-rules.mjs
// The shape of a stylesheet, enough to say what it holds and nothing else: whether it only wires (imports
// and plugin lines) or is a token source and nothing more. `init` writes an `ignore` entry for a file only
// when it can vouch for it, so a doubt is always the safe answer: a file it cannot read as one of these
// stays reported. The scan is a loop and not a recursion, so a stylesheet nested very deep is read like
// any other, and it skips strings and escapes, so a brace or a comment marker inside one is text.
import { stripCssComments } from "./css-tokens.mjs";

/**
 * The rules of a stylesheet as a tree of items: `{ text, body }`, where `body` is null for a statement or a
 * declaration (`@import "x"`, `--a: 1`) and a list of items for a block (`.x { ... }`, `@media { ... }`),
 * with `text` the prelude of a block. Null when the braces do not balance.
 * @returns {{ text: string, body: object[] | null }[] | null}
 */
export function parseRules(css) {
  const text = stripCssComments(css);
  const top = [];
  const stack = [];
  let items = top;
  let start = 0;
  const flush = (end) => {
    const part = text.slice(start, end).trim();
    if (part !== "") items.push({ text: part, body: null });
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
    } else if (c === ";") {
      flush(i);
      start = i + 1;
    } else if (c === "{") {
      const block = { text: text.slice(start, i).trim(), body: [] };
      items.push(block);
      stack.push(items);
      items = block.body;
      start = i + 1;
    } else if (c === "}") {
      if (stack.length === 0) return null;
      flush(i);
      items = stack.pop();
      start = i + 1;
    }
  }
  if (stack.length > 0) return null;
  flush(text.length);
  return top;
}

// A statement that wires and styles nothing. `@source inline(...)` is not one: it makes Tailwind build the
// classes it names, which is something to check.
const WIRING_STATEMENT = /^@(?:import|source|plugin|config|reference|custom-variant)(?![\w-])/i;
const SOURCE_INLINE = /^@source\b[^]*\binline\s*\(/i;
const isWiring = (item) => item.body === null && WIRING_STATEMENT.test(item.text) && !SOURCE_INLINE.test(item.text);

/** A stylesheet that imports and configures and declares nothing of its own. An empty one counts. */
export function isWiringOnly(css) {
  const rules = parseRules(css);
  return rules !== null && rules.every(isWiring);
}

// A selector list of `:root`, a theme class or a theme attribute: `.dark`, `html[data-theme="dark"]`, `:root.dark`.
const THEME_SELECTOR = /^(?:html|body)?(?:(?::root|\.dark|\.light|\.theme-[\w-]+|\[data-(?:theme|mode)[^\]]*\]))*$/;
const isThemeBlock = (prelude) =>
  /^@theme(?![\w-])/i.test(prelude) || prelude.split(",").every((selector) => selector.trim() !== "" && THEME_SELECTOR.test(selector.trim()));
const WRAPPER_AT_RULE = /^@(?:media|supports|layer)(?![\w-])/i;
const isOnlyTokens = (item) => item.body === null && /^(?:--[\w-]+|color-scheme)\s*:/.test(item.text);

/**
 * A stylesheet that is tokens and nothing else: every rule is `:root`, an `@theme` block or a theme selector
 * holding only custom properties and `color-scheme`, alone or inside @media, @supports or @layer, beside
 * wiring statements. Anything else (a class, an `@apply`, a declaration of a real property, a rule it cannot
 * read) makes it a stylesheet with its own rules, which init does not vouch for.
 */
export function isTokensOnly(css) {
  const rules = parseRules(css);
  if (rules === null) return false;
  let blocks = 0;
  const pending = [{ items: rules, top: true }];
  while (pending.length > 0) {
    const { items, top } = pending.pop();
    for (const item of items) {
      if (item.body === null) {
        if (top && isWiring(item)) continue;
        return false;
      }
      blocks++;
      if (WRAPPER_AT_RULE.test(item.text)) pending.push({ items: item.body, top: false });
      else if (isThemeBlock(item.text)) {
        if (!item.body.every(isOnlyTokens)) return false;
      } else return false;
    }
  }
  return blocks > 0;
}
