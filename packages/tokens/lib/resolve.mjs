/**
 * DTCG reference resolver.
 * Resolves {dotted.path} references in a token tree, with circular and missing
 * reference detection.
 */

const REF_RE = /^\{([^}]+)\}$/;

/**
 * Walk `path` (dot-separated) through `tree` and return the node, or undefined.
 * @param {object} tree
 * @param {string} path  e.g. "color.p.white"
 */
function getNode(tree, path) {
  const parts = path.split(".");
  let node = tree;
  for (const key of parts) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[key];
  }
  return node;
}

/**
 * Resolve the $value for the token at `path`, updating `resolved` in place.
 * `visiting` tracks the current resolution stack (cycle detection).
 *
 * @param {object} tree      - original (or in-place) token tree
 * @param {string} path      - dot-separated path of the token being resolved
 * @param {Set<string>} visiting
 */
function resolveToken(tree, path, visiting) {
  const node = getNode(tree, path);

  // Already resolved (plain value, object, or previously resolved ref)
  const raw = node?.$value;

  // Not a ref-style string: nothing to resolve
  if (typeof raw !== "string") return;

  const match = raw.match(REF_RE);
  if (!match) return; // literal string, not a {ref}

  const refPath = match[1];

  // Cycle check
  if (visiting.has(path)) {
    throw new Error(`circular reference: ${path}`);
  }

  visiting.add(path);

  // Resolve the target first (handles transitive refs)
  const targetNode = getNode(tree, refPath);
  if (targetNode == null || !("$value" in targetNode)) {
    throw new Error(`missing reference: ${refPath}`);
  }

  // Recursively resolve target if it is itself a ref
  if (typeof targetNode.$value === "string" && REF_RE.test(targetNode.$value)) {
    resolveToken(tree, refPath, visiting);
  }

  // Now target.$value is resolved, so copy it
  node.$value = targetNode.$value;

  visiting.delete(path);
}

/**
 * Collect every token path (nodes with $value) in the tree.
 * @param {object} node
 * @param {string[]} prefix
 * @param {string[]} paths
 */
function collectPaths(node, prefix, paths) {
  if (node == null || typeof node !== "object") return;
  if ("$value" in node) {
    paths.push(prefix.join("."));
    return;
  }
  for (const key of Object.keys(node)) {
    collectPaths(node[key], [...prefix, key], paths);
  }
}

/**
 * Resolve all {ref} references in a DTCG token tree.
 * Returns a deep clone with all references resolved.
 * Throws on missing or circular references.
 *
 * @param {object} tree
 * @returns {object}
 */
export function resolveRefs(tree) {
  // Deep clone so we don't mutate the input
  const resolved = JSON.parse(JSON.stringify(tree));

  const paths = [];
  collectPaths(resolved, [], paths);

  const visiting = new Set();
  for (const path of paths) {
    resolveToken(resolved, path, visiting);
  }

  return resolved;
}
