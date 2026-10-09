// Generate the component docs pages from the design system's own sources:
//   - packages/components/CATALOG.md      → tier order + one-line description
//   - packages/components/**/COMPONENT.md → frontmatter + full body
// Output: content/docs/components/<slug>.mdx (+ meta.json nav). These are
// derived artifacts (gitignored): CATALOG.md + COMPONENT.md stay the single
// source of truth. Run in predev/prebuild.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const compRoot = join(appRoot, "../../packages/components");
const outDir = join(appRoot, "content/docs/components");

// --- Parse CATALOG.md: ordered [{ tier, name, description }] ---------------
function parseCatalog() {
  const md = readFileSync(join(compRoot, "CATALOG.md"), "utf8");
  const rows = [];
  let tier = null;
  for (const line of md.split("\n")) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      tier = h[1].trim();
      continue;
    }
    const cells = line.match(/^\|(.+)\|$/);
    if (!cells || !tier) continue;
    const parts = cells[1].split("|").map((c) => c.trim());
    // skip header + separator rows
    if (parts[0] === "Component" || /^-+$/.test(parts[0])) continue;
    rows.push({ tier, name: parts[0], description: parts[2] ?? "" });
  }
  return rows;
}

// --- Read all COMPONENT.md, index by frontmatter name ----------------------
function readComponentDocs() {
  const byName = {};
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === "COMPONENT.md") {
        const raw = readFileSync(p, "utf8");
        const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!m) continue;
        const fm = Object.fromEntries(
          m[1]
            .split("\n")
            .map((l) => l.match(/^(\w+):\s*(.*)$/))
            .filter(Boolean)
            .map((x) => [x[1], x[2].trim()])
        );
        byName[fm.name] = { slug: fm.slug, status: fm.status, body: m[2].trim() };
      }
    }
  }
  walk(join(compRoot, "src/components"));
  return byName;
}

const catalog = parseCatalog();
const docs = readComponentDocs();

// Fresh output dir
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const yamlEscape = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
const pages = [];

for (const { name, description } of catalog) {
  const doc = docs[name];
  if (!doc) {
    console.warn(`[gen-docs] no COMPONENT.md for CATALOG entry "${name}"`);
    continue;
  }
  // Emit as .md (CommonMark) so the COMPONENT.md prose (which contains bare
  // HTML tags like <img>/<kbd> and code fences) is rendered as-is without the
  // strict MDX/JSX parser. The live <ComponentPreview> is injected by the docs
  // page template (keyed off the slug), not embedded in the content.
  const md = `---
title: ${name}
description: ${yamlEscape(description)}
---

${doc.body}
`;
  writeFileSync(join(outDir, `${doc.slug}.md`), md);
  pages.push(doc.slug);
}

// Folder nav (order = CATALOG order)
writeFileSync(
  join(outDir, "meta.json"),
  JSON.stringify({ title: "Components", pages }, null, 2) + "\n"
);

// Root nav: intro then the Components folder
writeFileSync(
  join(appRoot, "content/docs/meta.json"),
  JSON.stringify({ title: "Docs", pages: ["index", "components"] }, null, 2) + "\n"
);

console.log(`[gen-docs] wrote ${pages.length} component pages`);
