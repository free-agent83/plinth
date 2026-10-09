// Two stylesheets in this repository are exempt from the gate, because Undrift does not read CSS
// yet: packages/components/tailwind.css (token wiring, plus a few values of its own) and
// apps/web/app/globals.css (wiring only). An exemption is only as good as the check that keeps
// it true.
//
// The first check read a fixed list of units, so a colour, a `z-index` or `100vh` added to either
// stayed green. The second read every declaration and every literal, but matched the reason
// against each apart: a property named anywhere in it ("gap" in "the gap marker", "border" in
// "gap-border") and a number named anywhere in it (7px and 14px, for the stripes) let
// `.drift-grid { gap: 14px }` and `.drift-edge { border: 7px }` through, and a breakpoint in
// `@media (min-width: 640px)` or `@custom-variant tall (@media (min-height: 900px))` was never
// read at all, because at-rule headers were skipped.
//
// This reads both: every declaration, and every at-rule header. The reason has to write out each
// declaration in full, property and value together, and each at-rule that is not wiring.

export interface Declaration {
  /** The property, as written: `font-family`, `--color-primary`. */
  property: string;
  /** The value, as written, without the trailing `;` and with comments removed. */
  value: string;
  /** Inside an `@theme` block: variables being mapped, not styles being set. */
  inTheme: boolean;
}

export interface AtRule {
  /** `media`, `custom-variant`, `import`: the name without the `@`. */
  name: string;
  /** What follows the name, up to the block or the semicolon, with whitespace collapsed. */
  header: string;
  /** `@name header`, as it would be written out. */
  text: string;
  /** Inside an `@theme` block. */
  inTheme: boolean;
}

/**
 * The at-rules that are wiring, and set no value of their own: what to import, where to look for
 * classes, the container for a theme's mappings, a layer's name, the name of a utility. What a
 * utility or a layer holds is read as declarations. Any other at-rule, a breakpoint (`@media`), a
 * variant (`@custom-variant`), a plugin, is a value the file sets, and has to be named, and so is
 * a wiring at-rule whose header carries a number or a colour (an @import's media condition).
 */
export const WIRING = new Set(["import", "source", "theme", "layer", "utility"]);

/**
 * Numbers (with a unit or without) and hex colours in an at-rule's header, with strings and urls
 * left out: `@import "a-1.css"` names a file, and `tab-4` is a name, but `(min-width: 640px)` is a
 * breakpoint, in an @import's media condition as anywhere.
 */
function valuesInHeader(header: string): string[] {
  const bare = header.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, " ").replace(/url\([^)]*\)/gi, " ");
  return [...bare.matchAll(/#[0-9a-fA-F]{3,8}\b|(?<![\w-])[-+]?(?:\d+\.?\d*|\.\d+)(?:[a-zA-Z]+|%)?/g)].map((m) => m[0]);
}

/** Does this at-rule set a value of its own: it is not wiring, or its header carries a number or a colour. */
const setsAValue = (rule: AtRule) => !WIRING.has(rule.name) || valuesInHeader(rule.header).length > 0;

interface Scanned {
  declarations: Declaration[];
  atRules: AtRule[];
}

// A CSS escape: a backslash and up to six hex digits (and one space that ends them), or the next
// character as it is. It is what a name can be spelled with instead of the character itself.
const ESCAPE = String.raw`\\(?:[0-9a-fA-F]{1,6}[ \t\n]?|[^\n0-9a-fA-F])`;
// A custom property's name is `--` and then any run of characters that are not whitespace, a colon, a
// semicolon or a brace: `--1drift`, `---drift`, `--0` and `--driñ` are names. An ordinary property starts
// with a letter, an underscore, a non-ASCII character or an escape, after at most one dash.
const NON_ASCII = String.raw`\u0080-\uFFFF`;
const PROPERTY = new RegExp(
  `^(--(?:[^\\s:;{}\\\\]|${ESCAPE})*|-?(?:[A-Za-z_${NON_ASCII}]|${ESCAPE})(?:[\\w${NON_ASCII}-]|${ESCAPE})*)\\s*:\\s*([\\s\\S]*?)\\s*$`
);

/** A name with its CSS escapes read: `colo\72` is `color`. */
export function unescapeCss(name: string): string {
  return name
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?/g, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      return code === 0 || code > 0x10ffff ? "\ufffd" : String.fromCodePoint(code);
    })
    .replace(/\\([^\n])/g, "$1");
}

// The name before a "(" read with its escapes: `u\\72 l(` and `u\\rl(` open a url as `url(` does.
const IDENT_TAIL = new RegExp(`(?:[\\w-]|${ESCAPE})+$`);
const isUrlName = (buffer: string) => unescapeCss(IDENT_TAIL.exec(buffer)?.[0] ?? "").toLowerCase() === "url";
// Is the first character after any whitespace a quote, however much whitespace there is?
function quotedNext(text: string, from: number): boolean {
  let j = from;
  while (j < text.length && /\s/.test(text[j])) j += 1;
  return text[j] === '"' || text[j] === "'";
}

/** One pass over a stylesheet: its declarations, and its at-rules, at any depth. */
function scan(text: string): Scanned {
  const found: Declaration[] = [];
  const rules: AtRule[] = [];
  const stack: boolean[] = []; // for each open block: is it (inside) an @theme block?
  let buffer = "";
  let depth = 0; // parentheses: a `;` or a brace inside them does not end anything
  let quote: string | null = null;
  const inTheme = () => stack.length > 0 && stack[stack.length - 1];
  const statement = (source: string) => {
    if (source.startsWith("@")) {
      const match = /^@([\w-]+)\s*([\s\S]*)$/.exec(source);
      if (!match) return;
      const header = match[2].replace(/\s+/g, " ").trim();
      rules.push({ name: match[1], header, text: header === "" ? `@${match[1]}` : `@${match[1]} ${header}`, inTheme: inTheme() });
      return;
    }
    const match = PROPERTY.exec(source);
    if (stack.length > 0 && match && match[2] !== "") {
      found.push({ property: unescapeCss(match[1]), value: match[2].replace(/\s+/g, " "), inTheme: inTheme() });
    }
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      buffer += ch;
      if (ch === "\\" && i + 1 < text.length) buffer += text[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    // A comment is read here, where it is known not to be inside a string: a `/*` in one glob's
    // quotes and a `*/` in another's is not a comment, and stripping comments first hid every rule
    // between two `@source` globs.
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      buffer += " ";
      continue;
    }
    // An escaped character is a character, not syntax: `\"` does not open a string.
    if (ch === "\\" && i + 1 < text.length) {
      buffer += ch + text[++i];
      continue;
    }
    // An unquoted url( ) holds a token, not CSS: what is inside it, a `/*` too, is read to its `)`.
    if (ch === "(" && isUrlName(buffer) && !quotedNext(text, i + 1)) {
      // ...and an escaped `)` is a part of the url: a backslash and the character after it are skipped.
      let end = i + 1;
      while (end < text.length && text[end] !== ")") end += text[end] === "\\" ? 2 : 1;
      const stop = end >= text.length ? text.length : end + 1;
      buffer += text.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
    } else if (ch === "(") {
      depth += 1;
      buffer += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      buffer += ch;
    } else if (depth > 0) {
      buffer += ch;
    } else if (ch === "{") {
      const source = buffer.trim();
      statement(source);
      stack.push(/^@theme\b/.test(source) || inTheme());
      buffer = "";
    } else if (ch === "}") {
      if (buffer.trim() !== "") statement(buffer.trim());
      stack.pop();
      buffer = "";
    } else if (ch === ";") {
      statement(buffer.trim());
      buffer = "";
    } else {
      buffer += ch;
    }
  }
  return { declarations: found, atRules: rules };
}

/** Every `property: value` in the file, at any depth. At-rules such as `@import "x";` are not declarations. */
export function declarations(css: string): Declaration[] {
  return scan(css).declarations;
}

/** Every at-rule in the file, at any depth, with or without a block. */
export function atRules(css: string): AtRule[] {
  return scan(css).atRules;
}

const URL_TOKEN = /url\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^)]*)\s*\)/gi;
const DATA_URL = /^url\(\s*["']?\s*data:/i;

/**
 * The literals in a value: what the file itself sets, once every reference to something else is
 * taken out. `var(--x)` and `--theme(--x)` name a variable; a fallback in `var(--x, red)` is a
 * literal and stays. What is left is read for hex colours, numbers with or without a unit, and
 * every word (`transparent`, `oklch`, `tabular-nums`, and the name of each function called).
 */
export function literalsOf(value: string): string[] {
  // A `url(data:...)` carries content of its own, a colour in an SVG for one, and is a literal, whole.
  // Any other url names a file, and is left out.
  const data: string[] = [];
  let v = value.replace(URL_TOKEN, (m) => {
    if (DATA_URL.test(m)) data.push(m.replace(/\s+/g, " ").trim());
    return " ";
  });
  // A fallback is a value of the file's own: keep it, drop the reference around it.
  for (let i = 0; i < 8; i += 1) {
    const next = v
      .replace(/var\(\s*--[\w-]+\s*,\s*([^()]*)\)/g, " $1 ")
      .replace(/var\(\s*--[\w-]+\s*\)/g, " ")
      .replace(/-{0,2}theme\(\s*--[\w-]+(?:\s+[\w./%-]+)?\s*\)/g, " ");
    if (next === v) break;
    v = next;
  }
  const found: string[] = [...data];
  const take = (pattern: RegExp) => {
    v = v.replace(pattern, (m) => {
      found.push(m.trim());
      return " ";
    });
  };
  take(/#[0-9a-fA-F]{3,8}\b/g);
  take(/(?<![\w-])[-+]?(?:\d+\.?\d*|\.\d+)(?:[a-zA-Z]+|%)?/g);
  take(/[A-Za-z_][\w-]*/g);
  return [...new Set(found)];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A text in the form declarations are compared in: lower case, the spelling of a variable's name
 * taken out (`var(--layout-grid-min-xs)` and `var(--layout-grid-min-*)` are the same reference, and
 * a reference is not a value of the file's own), and no whitespace around a bracket, comma, colon or
 * semicolon.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/(var|theme)\(\s*--[\w*-]+/g, "$1(--*")
    .replace(/\s*([,():;{}])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does an account (already normalized) contain this declaration or at-rule, as a whole? Property
 * and value together, and each a whole token: `color: red` is not in `background-color: red`, and
 * `z-index: 50` is not in `z-index: 500` or `z-index: 150`. A full stop after it ends a sentence,
 * but one followed by a digit is a decimal.
 */
export function covers(account: string, text: string): boolean {
  return new RegExp(`(?<![\\w-])${escapeRegExp(normalize(text))}(?![\\w%-]|\\.\\d)`).test(account);
}

/**
 * What a stylesheet sets that its ignore reason does not write out: every declaration outside an
 * `@theme` block, and every declaration in one whose value is not a bare reference, as `property:
 * value`; and every at-rule that is not wiring, as `@name header`. Empty means the reason is a whole
 * account of the file. A mapping in `@theme` onto a variable needs no naming, and a stray
 * `color: #ff0000`, a `gap: 14px` or a breakpoint anywhere does.
 */
export function unnamed(css: string, reason: string): string[] {
  const account = normalize(reason);
  const missing: string[] = [];
  const { declarations: found, atRules: rules } = scan(css);
  for (const { property, value, inTheme } of found) {
    if (inTheme && literalsOf(value).length === 0) continue;
    const whole = `${property}: ${value}`;
    if (!covers(account, whole)) missing.push(whole);
  }
  for (const rule of rules) {
    if (setsAValue(rule) && !covers(account, rule.text)) missing.push(rule.text);
  }
  return [...new Set(missing)];
}

/**
 * What a stylesheet that is wiring only sets of its own: every declaration whose value is not a bare
 * `var()` reference, and every at-rule that is not wiring.
 */
export function ownValues(css: string): string[] {
  const { declarations: found, atRules: rules } = scan(css);
  return [
    ...found.filter(({ value }) => literalsOf(value).length > 0).map(({ property, value }) => `${property}: ${value}`),
    ...rules.filter(setsAValue).map((rule) => rule.text),
  ];
}
