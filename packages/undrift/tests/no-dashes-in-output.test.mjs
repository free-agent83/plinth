// An em dash or an en dash in Undrift's own words reads as machine-written, and its messages are public. This
// holds the rule where the words are written: no string, template or regular expression literal in src/, bin/ or
// hooks/ holds U+2014 or U+2013. Comments are left alone, and so is src/assess, which has its own test
// (tests/assess/no-dashes.test.mjs). A sentence that wants a dash is split in two, never given a comma or a hyphen.
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DASH = /[\u2014\u2013]/;
const SKIP = new Set(["assess", "node_modules"]);

function filesIn(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesIn(path));
    else if (/\.mjs$/.test(name)) out.push(path);
  }
  return out;
}

/** Every literal in a file that holds a dash, as `line: text`. */
export function dashesIn(source, fileName = "x.mjs") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = [];
  const visit = (node) => {
    const literal =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isRegularExpressionLiteral(node) || ts.isJsxText(node);
    if (literal && DASH.test(node.text ?? node.getText(sf))) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      found.push(`${line + 1}: ${(node.text ?? node.getText(sf)).trim().slice(0, 80)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("the scan finds a dash in a literal, and only there", () => {
  test("a string, a template, a template with a substitution and a regular expression", () => {
    expect(dashesIn('const a = "x \u2014 y";')).toHaveLength(1);
    expect(dashesIn("const a = `x \u2013 y`;")).toHaveLength(1);
    expect(dashesIn("const a = `${b} \u2014 ${c}`;")).toHaveLength(1);
    expect(dashesIn("const a = `x ${b} y \u2014`;")).toHaveLength(1);
    expect(dashesIn("const a = /[\u2014]/;")).toHaveLength(1);
  });

  test("a comment, and a literal with a hyphen, are not", () => {
    expect(dashesIn("// x \u2014 y\n/* x \u2013 y */\nconst a = 'x - y';")).toEqual([]);
  });
});

describe("no em dash or en dash in a string of Undrift's own", () => {
  const files = [...filesIn(join(root, "src")), ...filesIn(join(root, "bin")), ...filesIn(join(root, "hooks"))];

  test("there are files to read", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  test.each(files.map((file) => [relative(root, file), file]))("%s", (_name, file) => {
    expect(dashesIn(readFileSync(file, "utf8"), file)).toEqual([]);
  });
});
