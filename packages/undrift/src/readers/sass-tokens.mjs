// Sass variable declarations as token sources.
//
// `$brand-colour: #1d70b8 !default;` is a design token by any honest
// definition: one named place a visual value is written down. Systems built
// on Sass declare their whole palette and scale this way and emit custom
// properties only at build time, if at all. Reading the built CSS instead of
// these declarations scores the compiler's output rather than the authored
// source, and reports "0 authored token sources" for a system with hundreds.
//
// Scope, deliberately narrow: top-level `$name: value;` declarations only.
// Variables declared inside a mixin, function or rule block are local by
// Sass's own rules and are skipped by tracking brace depth. Maps
// (`$colours: (...)`) count as one token under the map's own name; their
// entries are not flattened, because a map key's meaning depends on the
// function that reads it and guessing would invent tokens the system never
// named. `!default` and `!global` flags are stripped from the value.
//
// Keys keep their leading `$` so they can never collide with a CSS custom
// property (`--name`) from another source and never be mistaken for one by
// the `var(--name)` reference scan in single-source.mjs.
//
// Only values that look like design values are kept. Sass variables also
// carry build configuration (`$enable-shadows: true`, `$prefix: "bs"`) and
// counting those as tokens inflated one system to 168 "authored token
// sources" on an early run, most of them one config flag in an example app.
// A design value is a colour, a length, a number, a font stack, a map or
// list, a function call, or a reference to another variable. Booleans, null,
// and bare quoted strings are config.

const LINE_COMMENT_RE = /\/\/[^\n]*/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const NAME_RE = /^[A-Za-z_][\w-]*/;

const CONFIG_VALUE_RE = /^(true|false|null|none)$/i;
const LONE_STRING_RE = /^["'][^"']*["']$/;
// A colour, a variable reference, a map or call, a number with or without a
// unit, a comma-separated list (font stacks), or a CSS keyword a design
// value can legitimately be.
const DESIGN_VALUE_RE = /#[0-9a-f]{3,8}\b|\$[\w-]+|\(|(^|[\s,(])-?(\d+\.?\d*|\.\d+)(rem|em|px|%|vh|vw|ms|s|deg|fr|ch|ex)?\b|,|\b(sans-serif|serif|monospace|inherit|transparent|currentcolor)\b/i;
function isDesignValue(value) {
  if (CONFIG_VALUE_RE.test(value)) return false;
  if (LONE_STRING_RE.test(value)) return false; // a prefix, a path, a class name
  return DESIGN_VALUE_RE.test(value);
}

export function readSassTokens(source) {
  const text = source.replace(BLOCK_COMMENT_RE, " ").replace(LINE_COMMENT_RE, "");
  const tokens = {};
  let braceDepth = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === "{") { braceDepth++; i++; continue; }
    if (ch === "}") { braceDepth = Math.max(0, braceDepth - 1); i++; continue; }
    if (ch === "$" && braceDepth === 0 && (i === 0 || /[\s;{}]/.test(text[i - 1]))) {
      const name = text.slice(i + 1).match(NAME_RE)?.[0];
      if (name) {
        let j = i + 1 + name.length;
        while (j < n && /\s/.test(text[j])) j++;
        if (text[j] === ":") {
          j++;
          // Value runs to the first `;` outside parentheses, so a map or a
          // function call spanning several lines is one declaration.
          let parenDepth = 0;
          let k = j;
          for (; k < n; k++) {
            const c = text[k];
            if (c === "(") parenDepth++;
            else if (c === ")") parenDepth = Math.max(0, parenDepth - 1);
            else if (c === ";" && parenDepth === 0) break;
            else if (c === "{" && parenDepth === 0) break; // a rule opened before any `;`: not a declaration
          }
          if (text[k] === ";") {
            const value = text.slice(j, k).replace(/\s*!(default|global)\b/g, "").replace(/\s+/g, " ").trim();
            if (value !== "" && isDesignValue(value)) tokens["$" + name] = value;
            i = k + 1;
            continue;
          }
          i = k;
          continue;
        }
      }
    }
    i++;
  }
  return tokens;
}
