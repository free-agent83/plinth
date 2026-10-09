import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import fg from "fast-glob";
import { expect, test } from "vitest";

// Grouping was declared in two places and reconciled in none: the section
// headings of CATALOG.md (which the docs generator turns into nav order) and
// the `title:` prefix of every Storybook story. A production system, audited 2026-09-08,
// had 19 of 63 components in a different group depending on which surface a
// reader opened. This makes a disagreement a build failure.
const root = process.cwd();

function catalogueGroups(): Map<string, string> {
  const md = readFileSync(resolve(root, "CATALOG.md"), "utf8");
  const groups = new Map<string, string>();
  let section: string | null = null;
  for (const line of md.split("\n")) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) { section = h[1].trim(); continue; }
    const cells = line.match(/^\|(.+)\|$/);
    if (!cells || !section) continue;
    const name = cells[1].split("|")[0].trim();
    if (name === "Component" || /^-+$/.test(name)) continue;
    groups.set(name, section);
  }
  return groups;
}

test("every story's group is its component's catalogue section", () => {
  const groups = catalogueGroups();
  const stories = fg.sync("src/components/**/*.stories.tsx", { cwd: root, absolute: true });
  expect(stories.length).toBeGreaterThan(0);
  const disagreements: string[] = [];
  for (const file of stories) {
    const doc = readFileSync(resolve(dirname(file), "COMPONENT.md"), "utf8");
    const name = doc.match(/^name:\s*(.+)$/m)?.[1].trim();
    const title = readFileSync(file, "utf8").match(/title:\s*"([^"]+)"/)?.[1];
    if (!name || !title) { disagreements.push(`${file}: no name or no title`); continue; }
    const section = groups.get(name);
    if (!section) { disagreements.push(`${name}: not in CATALOG.md`); continue; }
    const prefix = title.split("/")[0];
    if (prefix !== section) disagreements.push(`${name}: story is under "${prefix}", CATALOG.md says "${section}"`);
  }
  expect(disagreements, disagreements.join("\n")).toEqual([]);
});
