/**
 * Token emission helpers.
 * Flattens a DTCG token tree to CSS custom property maps.
 */

import { dtcgToCss } from "./color.mjs";

const REF_RE = /^\{([^}]+)\}$/;

/**
 * Walk a token tree, calling `cb(path[], node)` for every leaf node that has $value.
 * Skips keys starting with "$".
 */
function walk(node, path, cb) {
  if (node == null || typeof node !== "object") return;
  if ("$value" in node) {
    cb(path, node);
    return;
  }
  for (const key of Object.keys(node)) {
    if (key.startsWith("$")) continue;
    walk(node[key], [...path, key], cb);
  }
}

/**
 * Convert a path array to a CSS custom property name.
 * e.g. ["color","primitive","neutral","900"] → "--color-primitive-neutral-900"
 */
function toVarName(path) {
  return "--" + path.join("-");
}

/**
 * A font family stack as CSS, with the FIRST family behind an overridable slot:
 * `--type-fontFamily-sans: var(--type-fontFace-sans, Inter), ui-sans-serif, ...`.
 * A product that loads its own face (next/font, a self-hosted file) sets the slot,
 * `--type-fontFace-sans: var(--font-inter)`, and never restates the stack, so the
 * fallbacks after the first family live once, in the token source. Without the
 * slot the product had to re-declare the whole token and copy them.
 *
 * Only a font family token gets a slot: the slot is named by swapping `fontFamily`
 * for `fontFace` in the token's own path, so it can never be the token itself.
 * Any other array value is joined plainly.
 */
export function fontStack(path, families) {
  const at = path.indexOf("fontFamily");
  if (at === -1 || families.length === 0) return families.join(", ");
  const slot = toVarName(path.map((part, i) => (i === at ? "fontFace" : part)));
  const [first, ...fallbacks] = families;
  return [`var(${slot}, ${first})`, ...fallbacks].join(", ");
}

/**
 * Flatten a PRIMITIVES token tree to { "--var-name": "literal-value" }.
 * Colours (object $value) → dtcgToCss(); dimensions/type/numbers → raw string.
 */
export function flattenPrimitives(tree) {
  const result = {};
  walk(tree, [], (path, node) => {
    const v = node.$value;
    if (typeof v === "object" && v !== null && !Array.isArray(v) && v.colorSpace) {
      // OKLCH colour object
      result[toVarName(path)] = dtcgToCss(v);
    } else if (Array.isArray(v)) {
      // Font family array: a comma-separated stack, first family behind a slot
      result[toVarName(path)] = fontStack(path, v);
    } else {
      // Dimension string or number
      result[toVarName(path)] = String(v);
    }
  });
  return result;
}

/**
 * Flatten a SEMANTICS token tree to { "--var-name": "var(--ref-var-name)" }.
 * The $value MUST be a {ref} string. Validates the ref path exists in primitiveTree.
 * Throws with a clear message if a ref points to a non-existent primitive.
 *
 * @param {object} semanticTree  - the semantic token tree
 * @param {object} primitiveTree - the combined primitive tree (for validation)
 * @param {string} sourceFile    - label for error messages
 */
export function flattenSemantics(semanticTree, primitiveTree, sourceFile) {
  const result = {};
  walk(semanticTree, [], (path, node) => {
    const v = node.$value;
    if (typeof v !== "string") {
      throw new Error(`[${sourceFile}] token "${path.join(".")}" has non-reference $value: ${JSON.stringify(v)}`);
    }
    const match = v.match(REF_RE);
    if (!match) {
      throw new Error(`[${sourceFile}] token "${path.join(".")}" $value is not a {ref}: ${v}`);
    }
    const refPath = match[1]; // e.g. "color.primitive.white"
    // Validate the ref exists in the primitive tree
    const parts = refPath.split(".");
    let node2 = primitiveTree;
    for (const part of parts) {
      if (node2 == null || typeof node2 !== "object") {
        throw new Error(`[${sourceFile}] missing reference: ${refPath} (in token "${path.join(".")}")`);
      }
      node2 = node2[part];
    }
    if (node2 == null || !("$value" in node2)) {
      throw new Error(`[${sourceFile}] missing reference: ${refPath} (in token "${path.join(".")}")`);
    }
    // Emit as var() pointing to the primitive's CSS var
    const refVarName = "--" + refPath.replace(/\./g, "-");
    result[toVarName(path)] = `var(${refVarName})`;
  });
  return result;
}

/**
 * Render a flat { "--name": "value" } map into CSS block body lines.
 * Returns a string like "  --name: value;\n  --name2: value2;\n"
 */
export function renderBlock(map) {
  return Object.entries(map)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n") + "\n";
}
