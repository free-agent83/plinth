// Custom properties the product's own code sets. A var() to one is not an unknown token: the stylesheet does not
// declare it, the code does, and CSS reads it the same way. Four shapes, each found on real systems:
//   an arbitrary property in a class name      className="[--page-gutter:20px]"
//   a style object's key                       style={{ "--sidebar-width": "16rem" }}, or an object built for one
//   setProperty                                el.style.setProperty("--x", value)
//   a chart config                             const config = { desktop: { ... } } satisfies ChartConfig
// The chart container of the component generators writes `--color-<key>` for each key of the config it is given, at
// runtime, so each key of an object typed or checked as a ChartConfig sets `--color-<key>`.
//
// A name set anywhere in the code the profiles cover counts, as a declaration in any stylesheet the contract reads
// does: the gate does not follow the cascade for either. Reading too much here can only miss an unknown token.
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasScriptExtension, includedPaths } from "./unchecked.mjs";

const NAME = String.raw`--(?:[A-Za-z0-9_-]|\\.)+`;
const ARBITRARY_PROPERTY_RE = new RegExp(String.raw`\[(${NAME}):`, "g");
const STYLE_KEY_RE = new RegExp(String.raw`(["'\x60])(${NAME})\1\s*:`, "g");
const SET_PROPERTY_RE = new RegExp(String.raw`setProperty\(\s*(["'\x60])(${NAME})\1`, "g");

const isChartConfigType = (type) =>
  type && ts.isTypeReferenceNode(type) &&
  (ts.isIdentifier(type.typeName) ? type.typeName.text : type.typeName.right.text) === "ChartConfig";

/** `--color-<key>` for each key of each object literal in the file typed or checked as a ChartConfig. */
function chartConfigProperties(source, fileName) {
  const out = [];
  if (!source.includes("ChartConfig")) return out;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const keysOf = (node) => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
    if (!node || !ts.isObjectLiteralExpression(node)) return;
    for (const prop of node.properties) {
      const name = prop.name;
      if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))) out.push(`--color-${name.text}`);
    }
  };
  const visit = (node) => {
    if (ts.isSatisfiesExpression(node) && isChartConfigType(node.type)) keysOf(node.expression);
    if (ts.isVariableDeclaration(node) && isChartConfigType(node.type)) keysOf(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Every custom property the source sets, in the four shapes above. */
export function propertiesSetIn(source, fileName = "input.tsx") {
  const out = new Set();
  for (const re of [ARBITRARY_PROPERTY_RE, STYLE_KEY_RE, SET_PROPERTY_RE]) {
    for (const m of source.matchAll(re)) out.add(m[m.length - 1]);
  }
  for (const name of chartConfigProperties(source, fileName)) out.add(name);
  return out;
}

const memo = new WeakMap();

/**
 * Every custom property set by the code the contract's profiles cover, read once per contract. Empty for a contract
 * with no root or no profiles (one built by hand): the file being gated is still read for itself.
 */
export function propertiesSetInProduct(contract) {
  if (memo.has(contract)) return memo.get(contract);
  const out = new Set();
  if (contract?.root && Object.keys(contract.profiles ?? {}).length > 0) {
    for (const rel of includedPaths(contract)) {
      if (!hasScriptExtension(rel)) continue;
      const file = resolve(contract.root, rel);
      let source;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const name of propertiesSetIn(source, file)) out.add(name);
    }
  }
  memo.set(contract, out);
  return out;
}
