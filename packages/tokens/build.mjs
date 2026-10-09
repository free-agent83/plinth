/**
 * Token build script.
 * Reads DTCG source files, validates, and emits CSS / JS / JSON outputs.
 *
 * Usage: node build.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRefs } from "./lib/resolve.mjs";
import { flattenPrimitives, flattenSemantics, renderBlock, fontStack } from "./lib/emit.mjs";
import { dtcgToCss } from "./lib/color.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, "src");
const distDir = join(__dirname, "dist");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e) {
    throw new Error(`Failed to read/parse ${filePath}: ${e.message}`);
  }
}

function isNonEmpty(obj) {
  return obj != null && typeof obj === "object" && Object.keys(obj).length > 0;
}

/** Absolute paths of every semantic layer file (src/semantic/*.tokens.json), sorted.
 *  A semantic layer is theme-INDEPENDENT (layout, say): it aliases primitives
 *  the way a theme does, but it does not vary by theme, so it is emitted once
 *  into :root as var() references rather than under a [data-theme] scope. */
function semanticFiles() {
  const dir = join(srcDir, "semantic");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".tokens.json"))
    .sort()
    .map(f => join(dir, f));
}

/** Absolute paths of every primitive layer file (src/primitive/*.tokens.json), sorted. */
function primitiveFiles() {
  const dir = join(srcDir, "primitive");
  return readdirSync(dir)
    .filter(f => f.endsWith(".tokens.json"))
    .sort()
    .map(f => join(dir, f));
}

/** Deep-merge objects (right wins) */
function merge(...objects) {
  const result = {};
  for (const obj of objects) {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object" && !Array.isArray(v) && !("$value" in v)) {
        result[k] = merge(result[k] ?? {}, v);
      } else {
        result[k] = v;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validate: check every $value is well-formed; check refs resolve
// ---------------------------------------------------------------------------

function validateTree(tree, filePath) {
  function walk(node, path) {
    if (node == null || typeof node !== "object") return;
    if ("$value" in node) {
      if (node.$value === undefined || node.$value === null) {
        throw new Error(`[${filePath}] token "${path}" has missing/null $value`);
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith("$")) continue;
      walk(v, path ? `${path}.${k}` : k);
    }
  }
  walk(tree, "");
}

function validate(primitiveTree, themeDir) {
  // Validate each primitive file
  const primFiles = primitiveFiles();
  for (const f of primFiles) {
    const tree = readJson(f);
    validateTree(tree, f);
  }

  // Validate primitive refs can be resolved internally (no cross-refs expected but catches cycles)
  try {
    resolveRefs(primitiveTree);
  } catch (e) {
    throw new Error(`[src/primitive/*.tokens.json] ${e.message}`);
  }

  // Validate each theme file
  const themes = readdirSync(themeDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const theme of themes) {
    const lightPath = join(themeDir, theme, "light.tokens.json");
    const darkPath = join(themeDir, theme, "dark.tokens.json");
    const light = existsSync(lightPath) ? readJson(lightPath) : {};
    const dark = existsSync(darkPath) ? readJson(darkPath) : {};

    if (!isNonEmpty(light)) continue; // skip empty themes

    validateTree(light, lightPath);
    validateTree(dark, darkPath);

    // Validate every semantic ref points at an existing primitive.
    // flattenSemantics throws a file-attributed message naming the bad ref.
    flattenSemantics(light, primitiveTree, lightPath);
    if (isNonEmpty(dark)) {
      flattenSemantics(dark, primitiveTree, darkPath);
    }

    // Also run resolveRefs to catch circular refs, attributed to the theme file.
    try {
      resolveRefs(merge(primitiveTree, light));
      if (isNonEmpty(dark)) resolveRefs(merge(primitiveTree, dark));
    } catch (e) {
      throw new Error(`[src/theme/${theme}/*.tokens.json] ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main build
// ---------------------------------------------------------------------------

function build() {
  // 1. Load primitives: every *.tokens.json in src/primitive/ is a primitive
  //    layer (color, dimension, type, shadow, …); the set is discovered, not
  //    hardcoded, so adding a primitive file needs no build edit.
  const primitiveTree = merge(...primitiveFiles().map(readJson));

  const themeDir = join(srcDir, "theme");

  // 2. Validate
  validate(primitiveTree, themeDir);

  // 3. Flatten primitives → :root block, then the theme-independent semantic
  //    layers (layout) as var() references in the same block.
  const primVars = flattenPrimitives(primitiveTree);
  const semanticTree = merge(...semanticFiles().map(readJson));
  const semanticVars = semanticFiles().length
    ? flattenSemantics(semanticTree, primitiveTree, "src/semantic/*.tokens.json")
    : {};
  let css = `:root {\n${renderBlock(primVars)}${renderBlock(semanticVars)}}\n`;

  // 4. Collect all resolved tokens for JS/JSON output
  const allResolved = resolveRefs(merge(primitiveTree, semanticTree));

  // 5. For each theme, emit [data-theme] scopes
  const themes = readdirSync(themeDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  for (const theme of themes) {
    const lightPath = join(themeDir, theme, "light.tokens.json");
    const darkPath = join(themeDir, theme, "dark.tokens.json");
    const light = existsSync(lightPath) ? readJson(lightPath) : {};
    const dark = existsSync(darkPath) ? readJson(darkPath) : {};

    if (!isNonEmpty(light)) continue; // skip empty themes (no phantom scopes)

    // Emit light scope
    const lightVars = flattenSemantics(light, primitiveTree, lightPath);
    css += `\n[data-theme="${theme}"] {\n${renderBlock(lightVars)}}\n`;

    // Emit dark scope (if non-empty)
    if (isNonEmpty(dark)) {
      const darkVars = flattenSemantics(dark, primitiveTree, darkPath);
      css += `\n[data-theme="${theme}"].dark {\n${renderBlock(darkVars)}}\n`;
    }
  }

  // 6. Flatten everything resolved for JS/JSON
  function flattenResolved(tree) {
    const out = {};
    function walk(node, path) {
      if (node == null || typeof node !== "object") return;
      if ("$value" in node) {
        const key = "--" + path.join("-");
        const v = node.$value;
        if (v && typeof v === "object" && !Array.isArray(v) && v.colorSpace) {
          // Colour object → CSS string (matches the CSS output)
          out[key] = dtcgToCss(v);
        } else if (Array.isArray(v)) {
          out[key] = fontStack(path, v);
        } else {
          out[key] = String(v);
        }
        return;
      }
      for (const [k, v] of Object.entries(node)) {
        if (k.startsWith("$")) continue;
        walk(v, [...path, k]);
      }
    }
    walk(tree, []);
    return out;
  }

  const flatTokens = flattenResolved(allResolved);

  // 7. Write outputs
  writeFoundations(allResolved, semanticTree);
  mkdirSync(join(distDir, "web"), { recursive: true });
  mkdirSync(join(distDir, "js"), { recursive: true });
  mkdirSync(join(distDir, "json"), { recursive: true });

  writeFileSync(join(distDir, "web", "tokens.css"), css, "utf8");

  // JS: default export object
  const jsContent = `// Auto-generated by build.mjs. Do not edit.\nexport default ${JSON.stringify(flatTokens, null, 2)};\n`;
  writeFileSync(join(distDir, "js", "tokens.js"), jsContent, "utf8");

  // TS declaration
  const tsContent = `// Auto-generated by build.mjs. Do not edit.\ndeclare const tokens: Record<string, string>;\nexport default tokens;\n`;
  writeFileSync(join(distDir, "js", "tokens.d.ts"), tsContent, "utf8");

  // JSON
  writeFileSync(join(distDir, "json", "tokens.json"), JSON.stringify(flatTokens, null, 2) + "\n", "utf8");

  console.log("Token build complete");
}

// ---------------------------------------------------------------------------
// FOUNDATIONS.md: the token layer at a glance, derived rather than typed.
// Generated on every build and committed, so a reader (an agent, first) sees
// the roles, the pairs and the layout layer without opening the JSON, and so
// the document cannot drift from the source it is rendered from. A hand edit
// fails tests/build.test.mjs.
// ---------------------------------------------------------------------------

function writeFoundations(allResolved, semanticTree) {
  const lines = [];
  const push = (s = "") => lines.push(s);
  const leaf = (node) => node && typeof node === "object" && "$value" in node;
  const val = (node) => {
    const v = node.$value;
    if (v && typeof v === "object" && !Array.isArray(v) && v.colorSpace) return dtcgToCss(v);
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
  };

  push("<!-- Generated by packages/tokens/build.mjs from src/**/*.tokens.json. Do not edit: a hand edit fails the build test. -->");
  push("# Foundations");
  push();
  push("The token layer at a glance, rendered from the source on every build. Every value here is the resolved value of a token in `src/`; the names are the CSS custom properties the components use. Read `COMPOSITION.md` for how the layout tokens sit together on a screen and `CATALOG.md` for which component to reach for.");
  push();

  // Layout
  const layout = semanticTree.layout;
  if (layout) {
    push("## Layout");
    push();
    push("Each token names a structural decision, not a size. A page inset is not a control gap even when the numbers coincide; an agent picks the name for the job, never a rung off the primitive scale.");
    push();
    push("| Token | Value | Names |");
    push("|---|---|---|");
    const walkLayout = (node, path) => {
      if (leaf(node)) {
        const key = "--" + path.join("-");
        const resolved = allResolved;
        let n = resolved; for (const k of path) n = n?.[k];
        push(`| \`${path.join(".")}\` | ${n && leaf(n) ? val(n) : ""} | ${(node.$description ?? "").replace(/\|/g, "/")} |`);
        return;
      }
      for (const [k, v] of Object.entries(node)) if (!k.startsWith("$")) walkLayout(v, [...path, k]);
    };
    walkLayout(layout, ["layout"]);
    push();
  }

  // Colour roles as pairs, per theme
  const themeDir = join(srcDir, "theme");
  const themes = readdirSync(themeDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
  push("## Colour roles");
  push();
  push("Every foreground pairs with a surface, and light and dark are symmetric: the same role names exist in both, rebound to different primitives, so a component never branches on mode. The `-subtle` variants are the tinted surfaces for status messages.");
  push();
  for (const theme of themes) {
    const lightPath = join(themeDir, theme, "light.tokens.json");
    const darkPath = join(themeDir, theme, "dark.tokens.json");
    const light = existsSync(lightPath) ? readJson(lightPath) : {};
    const dark = existsSync(darkPath) ? readJson(darkPath) : {};
    if (!isNonEmpty(light)) continue;
    const roles = light.color?.semantic ?? {};
    const darkRoles = dark.color?.semantic ?? {};
    push(`### ${theme}`);
    push();
    push("| Role | Light | Dark | Pairs with |");
    push("|---|---|---|---|");
    for (const [name, node] of Object.entries(roles)) {
      if (!leaf(node)) continue;
      const pair = name.endsWith("-foreground") ? name.replace(/-foreground$/, "") : (roles[`${name}-foreground`] ? `${name}-foreground` : "");
      const ref = (n) => (n && typeof n.$value === "string") ? n.$value.replace(/^\{color\.primitive\.|\}$/g, "") : "";
      push(`| \`${name}\` | ${ref(node)} | ${ref(darkRoles[name])} | ${pair ? "`" + pair + "`" : ""} |`);
    }
    push();
  }

  // Elevation, radius, type, spacing from primitives
  const sections = [
    ["Elevation", "shadow"],
    ["Radius", ["dimension", "radius"]],
    ["Spacing scale", ["dimension", "spacing"]],
    ["Measures", ["dimension", "measure"]],
    ["Type", "type"],
  ];
  for (const [title, pathSpec] of sections) {
    const path = Array.isArray(pathSpec) ? pathSpec : [pathSpec];
    let node = allResolved; for (const k of path) node = node?.[k];
    if (!node) continue;
    push(`## ${title}`);
    push();
    if (title === "Type") {
      push("Each font family token puts its first family behind an overridable slot, `--type-fontFace-<name>`, and the source value below is what fills it by default. A product that loads its own face points the slot at it (`--type-fontFace-sans: var(--font-inter)`) and never restates the stack, so the fallbacks live once, in `src/primitive/type.tokens.json`.");
      push();
    }
    push("| Token | Value |");
    push("|---|---|");
    const walkAny = (n, p) => {
      if (leaf(n)) { push(`| \`${p.join(".")}\` | ${val(n)} |`); return; }
      for (const [k, v] of Object.entries(n)) if (!k.startsWith("$")) walkAny(v, [...p, k]);
    };
    walkAny(node, path);
    push();
  }

  writeFileSync(join(__dirname, "FOUNDATIONS.md"), lines.join("\n") + "\n", "utf8");
}

build();
