// The audit: the five value metrics from the assessment spec, computed from
// the repo rather than asserted. Each metric returns { id, title, pass,
// summary, detail } so the report reads as findings, not opinions.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import fg from "fast-glob";
import { gateProfile } from "./gate.mjs";

/**
 * Component dirs = any directory under componentsRoot holding a COMPONENT.md or a
 * component source file. The walk is depth-agnostic on purpose: a repo may keep
 * components flat, or nest them under groupings of its own choosing, and neither
 * shape is a property this audit has any business requiring.
 */
function componentDirs(contract) {
  if (!contract.componentsRoot || !existsSync(contract.componentsRoot)) return [];
  const dirs = [];
  const walk = (dirPath, relName) => {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    const isComponent =
      entries.some((e) => e.isFile() && e.name === "COMPONENT.md") ||
      fg.sync("!(*.stories|*.test|*.test-d).tsx", { cwd: dirPath }).length > 0;
    if (isComponent) {
      dirs.push({ name: relName ?? basename(dirPath), path: dirPath });
      return; // a component's own subdirectories are its business, not ours
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(dirPath, entry.name), entry.name);
    }
  };
  walk(contract.componentsRoot, null);
  return dirs;
}

function frontmatterName(componentMdPath) {
  const text = readFileSync(componentMdPath, "utf8");
  const m = text.match(/^---\n[\s\S]*?\bname:\s*(\S+)[\s\S]*?\n---/);
  return m ? m[1] : null;
}

export function runAudit(contract) {
  const dirs = componentDirs(contract);
  const metrics = [];

  // 1. Illegal states unrepresentable (type-level tests per component)
  {
    const withTypeTests = dirs.filter((d) => fg.sync("*.test-d.ts", { cwd: d.path }).length > 0);
    const pass = dirs.length > 0 && withTypeTests.length === dirs.length;
    metrics.push({
      id: "illegal-states",
      title: "Illegal states are unrepresentable (type-level tests)",
      pass,
      summary: `${withTypeTests.length}/${dirs.length} components carry *.test-d.ts type-level tests`,
      detail: dirs.filter((d) => !withTypeTests.includes(d)).map((d) => `${d.name}: no *.test-d.ts`),
    });
  }

  // 2. Hardcoded-value delta (the gate, run over every configured profile)
  {
    let total = 0;
    const detail = [];
    for (const name of Object.keys(contract.profiles)) {
      const { files, violations } = gateProfile(name, { contract });
      total += violations.length;
      detail.push(`profile "${name}": ${violations.length} violation(s) across ${files} file(s)`);
      for (const v of violations.slice(0, 20)) detail.push(`  ${v.file}:${v.line} [${v.rule}] ${v.found}`);
    }
    metrics.push({
      id: "hardcoded-values",
      title: "Hardcoded-value delta (raw colours / magic numbers)",
      pass: total === 0,
      summary: `${total} hardcoded value(s) across all profiles`,
      detail,
    });
  }

  // 3. Single source of truth (token pipeline present, themes generated)
  {
    const tokenCount = Object.keys(contract.tokens).length;
    let themes = 0;
    if (contract.tokensCssPath && existsSync(contract.tokensCssPath)) {
      const css = readFileSync(contract.tokensCssPath, "utf8");
      themes = new Set([...css.matchAll(/\[data-theme="([^"]+)"\]/g)].map((m) => m[1])).size;
    }
    const pass = tokenCount > 0 && themes > 0;
    metrics.push({
      id: "single-source",
      title: "Single source of truth (token pipeline)",
      pass,
      summary: pass
        ? `${tokenCount} tokens generated from source; ${themes} theme(s) emitted (light+dark from the same primitives)`
        : `No generated token set found`,
      detail: [],
    });
  }

  // 4. Docs coverage (every component fully documented, agent-readably)
  {
    const missing = dirs.filter((d) => !existsSync(join(d.path, "COMPONENT.md")));
    const pass = dirs.length > 0 && missing.length === 0;
    metrics.push({
      id: "docs-coverage",
      title: "Agent-readable docs coverage (COMPONENT.md per component)",
      pass,
      summary: `${dirs.length - missing.length}/${dirs.length} components carry a colocated COMPONENT.md`,
      detail: missing.map((d) => `${d.name}: missing COMPONENT.md`),
    });
  }

  // 5. Zero drift (catalog ↔ component dirs stay in lockstep)
  {
    const catalogNames = new Set(contract.catalog.map((c) => c.name));
    const dirNames = new Map(
      dirs
        .filter((d) => existsSync(join(d.path, "COMPONENT.md")))
        .map((d) => [frontmatterName(join(d.path, "COMPONENT.md")) ?? d.name, d])
    );
    const notInCatalog = [...dirNames.keys()].filter((n) => !catalogNames.has(n));
    const notOnDisk = [...catalogNames].filter((n) => !dirNames.has(n));
    const pass = notInCatalog.length === 0 && notOnDisk.length === 0;
    metrics.push({
      id: "zero-drift",
      title: "Zero drift (CATALOG.md ↔ components in lockstep)",
      pass,
      summary: pass
        ? `${catalogNames.size} catalog entries, ${dirNames.size} documented components, and they are fully in sync`
        : `${notInCatalog.length + notOnDisk.length} drift(s) between catalog and disk`,
      detail: [
        ...notInCatalog.map((n) => `on disk but not in CATALOG.md: ${n}`),
        ...notOnDisk.map((n) => `in CATALOG.md but not on disk: ${n}`),
      ],
    });
  }

  return {
    system: contract.system,
    root: contract.root,
    metrics,
    pass: metrics.every((m) => m.pass),
  };
}
