// "Undrift" is a proper noun (Chris, 2026-09-29): a capital U wherever it is a name, lowercase where it is an
// identifier. This holds it where Undrift's printed words are written: every string, template and JSX text in
// src/, bin/, hooks/ and templates/ (src/assess aside: the instrument is not Undrift's to word). Lowercase passes
// as the command (`undrift gate`), as a path, file or package (`undrift.config.json`, `node_modules/undrift`,
// `npx undrift`), and as the command's own name at the start of an error, before a colon (`undrift: ...`,
// `undrift later: ...`), as `git:` and `npm ERR!` name themselves. "The start" is the start of the whole message
// as printed: position 0 of the first string of an expression, with nothing before it, not a later line, not a
// string joined on after other words, not the text after an interpolation. A full stop after the word is the end
// of a sentence ("Blocked by undrift."); it makes a file name only when a letter follows ("undrift.config.json").
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["assess", "node_modules"]);
const COMMANDS = "init|gate|later|triage|audit|assess|index|help";

function filesIn(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesIn(path));
    else if (/\.(mjs|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

/**
 * Whether a lowercase `undrift` at `at` in `text` is an identifier. `startsMessage` says whether `text` is the
 * first piece of what a person reads, which is the only place the command's own name may stand before a colon.
 * `interpolated` says an interpolation follows `text`, so a word may follow a trailing "." or "-" (`undrift-${key}`).
 */
export function isIdentifier(text, at, startsMessage = false, interpolated = false) {
  const before = text.slice(0, at);
  const after = text.slice(at + "undrift".length);
  if (/[./@_-]$/.test(before) || /^([/_]|[.-][\p{L}\p{N}_])/u.test(after)) return true;
  if (interpolated && /^[.-]$/.test(after)) return true;
  if (/(npx|-w|install)\s+$/.test(before)) return true;
  if (new RegExp(`^ (${COMMANDS})\\b`).test(after)) return true;
  if (startsMessage && at === 0 && new RegExp(`^( (${COMMANDS}))?:`).test(after)) return true;
  return false;
}

/**
 * Whether a literal opens the message it belongs to: it is the first string of its expression, so nothing is
 * printed before it. Not the text after an interpolation, not the right side of a `+`, not a later item of a
 * list or a later argument of a call, and not JSX text.
 */
function startsMessage(node) {
  if (ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) return false;
  let at = node;
  for (;;) {
    const parent = at.parent;
    if (!parent) return true;
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      if (parent.right === at) return false;
    } else if (ts.isArrayLiteralExpression(parent)) {
      if (parent.elements[0] !== at) return false;
    } else if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      if (parent.arguments?.includes(at) && parent.arguments[0] !== at) return false;
      return true;
    } else if (
      !ts.isParenthesizedExpression(parent) && !ts.isTemplateExpression(parent) && !ts.isConditionalExpression(parent) &&
      !ts.isBinaryExpression(parent) && !ts.isPropertyAccessExpression(parent)
    ) {
      return true;
    }
    at = parent;
  }
}

/** Every literal that uses a lowercase `undrift` as a name, as `line: text`. */
export function lowercaseNamesIn(source, fileName = "x.mjs") {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const visit = (node) => {
    const literal =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node);
    if (literal) {
      const text = node.text ?? "";
      for (const m of text.matchAll(/(?<![\p{L}\p{N}])undrift(?![\p{L}\p{N}])/gu)) {
        if (isIdentifier(text, m.index, startsMessage(node), ts.isTemplateHead(node) || ts.isTemplateMiddle(node))) continue;
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        found.push(`${line + 1}: ${text.trim().slice(0, 80)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("the rule, case by case", () => {
  test("a name fails", () => {
    expect(lowercaseNamesIn('const a = "Run undrift from a configured repo.";')).toHaveLength(1);
    expect(lowercaseNamesIn("const a = `${n} problems: undrift blocked this edit`;")).toHaveLength(1);
    expect(lowercaseNamesIn("const a = <p>Checked by undrift</p>;", "x.tsx")).toHaveLength(1);
  });

  test("a name at the end of a sentence fails: a full stop is not a file name", () => {
    expect(lowercaseNamesIn('const a = "Blocked by undrift.";')).toHaveLength(1);
    expect(lowercaseNamesIn('const a = "Blocked by undrift. Fix it, then run it again.";')).toHaveLength(1);
    expect(lowercaseNamesIn('const a = "Blocked by undrift - fix it.";')).toHaveLength(1);
    expect(lowercaseNamesIn("const a = `Blocked by undrift ${n}.`;")).toHaveLength(1);
  });

  test("an identifier passes", () => {
    for (const s of [
      '"undrift gate --strict"', '"Run undrift later --all"', '"undrift.config.json"', '"node_modules/undrift/hooks"',
      '".undrift/notices.json"', '"npx undrift init"', '"npm -w undrift run test"', '"undrift-hook.mjs"',
      '"undrift: --strict cannot be combined with --profile."', '"undrift later: --line needs a line number."',
    ]) expect(lowercaseNamesIn(`const a = ${s};`), s).toEqual([]);
  });

  test("a file name or a path is still an identifier when a letter follows the dot", () => {
    for (const s of ['"undrift.config.json"', '"see undrift.config.json."', "`undrift-${key}`", "`${tmp}/undrift-${key}.json`", '"undrift.mjs"', '"undrift-hook.mjs"', '"undrift_state"']) {
      expect(lowercaseNamesIn(`const a = ${s};`), s).toEqual([]);
    }
  });

  test("the program's name passes before a colon only at the start of a message", () => {
    expect(lowercaseNamesIn('const a = "Fix it, then tell undrift: done.";')).toHaveLength(1);
  });

  // Decision 6 allows "undrift: ..." as the start of what a person reads, the way `git:` and `npm ERR!` do. So it
  // passes at position 0 of the first string of a message, and nowhere else.
  test("the allowance is the start of the whole message as printed, and nothing wider", () => {
    for (const s of [
      '"Done.\\nundrift: blocked"',                         // after a newline inside the string
      '"  undrift: blocked"',                                // after spaces
      '"\\nundrift: blocked"',                               // after a leading newline
      '"Problems found. " + "undrift: it blocked this"',     // a string joined on mid-message
      '"Problems found. " + ("undrift: it blocked this")',   // the same, in brackets
      "`${n} undrift: blocked`",                             // after an interpolation and a space
      "`${n}undrift: blocked`",                              // straight after an interpolation
      '["Problems found.", "undrift: it blocked this"].join(" ")', // a later part of a joined list
      'say(1, "undrift: it blocked this")',                  // a later argument of a call
    ]) expect(lowercaseNamesIn(`const a = ${s};`), s).toHaveLength(1);
  });

  test("the real prefixes pass: the first string of a message, in a call, a sum, a template or a branch", () => {
    for (const s of [
      '"undrift: --strict cannot be combined with --profile."',
      '"undrift: --strict cannot be combined with --profile. " + "Run it again without --profile."',
      '("undrift: it blocked this" + tail)',
      'red("undrift init: --components needs a folder.")',
      'usageError("undrift later: --line needs a line number.")',
      "usageError(`undrift later: --all takes no ${what}.`)",
      'cond ? "undrift: one thing" : "undrift: another"',
      '["undrift: one thing", "and another"].join(" ")',
    ]) expect(lowercaseNamesIn(`const a = ${s};`), s).toEqual([]);
  });

  test("a comment is not a literal", () => {
    expect(lowercaseNamesIn("// undrift checks this\nconst a = 1;")).toEqual([]);
  });
});

describe("no lowercase undrift used as a name in a string of Undrift's own", () => {
  const files = ["src", "bin", "hooks", "templates"].flatMap((d) => filesIn(join(root, d)));

  test("the scan reads files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    test(relative(root, file), () => {
      expect(lowercaseNamesIn(readFileSync(file, "utf8"), file)).toEqual([]);
    });
  }
});
