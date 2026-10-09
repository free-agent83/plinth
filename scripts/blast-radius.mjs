/**
 * blast-radius.mjs
 *
 * Demonstrates metric #3: one token edit propagates everywhere.
 *
 * Steps:
 *  1. Build tokens → snapshot BEFORE
 *  2. Edit primary semantic token (indigo.400 → slate.800)
 *  3. Rebuild → snapshot AFTER
 *  4. Diff and report propagation count
 *  5. Restore source from saved string (in finally)
 *  6. Rebuild to return dist/ to original state (in finally)
 *  7. Assert git clean
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// script lives at sample/scripts/blast-radius.mjs → sample root is one level up
const sampleRoot = fileURLToPath(new URL("..", import.meta.url));
const dsServiceRoot = path.resolve(sampleRoot, "..");

const lightTokensPath = path.join(
  sampleRoot,
  "packages/tokens/src/theme/default/light.tokens.json"
);
const tokensCssPath = path.join(
  sampleRoot,
  "packages/tokens/dist/web/tokens.css"
);
const distPaths = [
  tokensCssPath,
  path.join(sampleRoot, "packages/tokens/dist/js/tokens.js"),
  path.join(sampleRoot, "packages/tokens/dist/json/tokens.json"),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function build() {
  execSync("npm run build:tokens", { cwd: sampleRoot, stdio: "ignore" });
}

function readCss() {
  return readFileSync(tokensCssPath, "utf8");
}

/**
 * Count lines that differ between two multi-line strings.
 * Returns { changedLines, addedLines, removedLines }.
 */
function diffLines(before, after) {
  const aLines = before.split("\n");
  const bLines = after.split("\n");
  const maxLen = Math.max(aLines.length, bLines.length);
  let changed = 0;
  let added = 0;
  let removed = 0;
  for (let i = 0; i < maxLen; i++) {
    const a = aLines[i];
    const b = bLines[i];
    if (a === b) continue;
    if (a === undefined) { added++; changed++; }
    else if (b === undefined) { removed++; changed++; }
    else { changed++; }
  }
  return { changedLines: changed, addedLines: added, removedLines: removed };
}

/**
 * Snapshot all dist output files as string content.
 */
function snapshotDist() {
  return distPaths.map((p) => {
    try { return readFileSync(p, "utf8"); }
    catch { return null; }
  });
}

/**
 * Compare two dist snapshots; return count of files that changed.
 */
function countChangedFiles(snapA, snapB) {
  let count = 0;
  for (let i = 0; i < snapA.length; i++) {
    if (snapA[i] !== snapB[i]) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// 1. Build first so dist/ is fresh, then snapshot BEFORE
console.log("Building tokens (initial)…");
build();
const cssBefore = readCss();
const distBefore = snapshotDist();

// 2. Save original source: this is our restore source (NOT git)
const originalSource = readFileSync(lightTokensPath, "utf8");

// 3. Mutate → rebuild → diff
try {
  // Edit: change primary from {color.primitive.indigo.400} to {color.primitive.slate.800}
  const tokens = JSON.parse(originalSource);
  const originalValue = tokens.color.semantic.primary.$value;
  const newValue = "{color.primitive.slate.800}";

  if (originalValue === newValue) {
    console.error(
      "ERROR: primary token is already set to slate.800. The source may not have been restored from a previous run."
    );
    process.exit(1);
  }

  tokens.color.semantic.primary.$value = newValue;
  writeFileSync(lightTokensPath, JSON.stringify(tokens, null, 2) + "\n", "utf8");

  console.log(`Edit applied: primary ${originalValue} → ${newValue}`);
  console.log("Rebuilding tokens…");
  build();

  const cssAfter = readCss();
  const distAfter = snapshotDist();

  // Diff
  const { changedLines } = diffLines(cssBefore, cssAfter);
  const changedFiles = countChangedFiles(distBefore, distAfter);

  // Print changed lines for visibility
  const beforeLines = cssBefore.split("\n");
  const afterLines = cssAfter.split("\n");
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  const changedLinesList = [];
  for (let i = 0; i < maxLen; i++) {
    if (beforeLines[i] !== afterLines[i]) {
      if (beforeLines[i] !== undefined) changedLinesList.push(`  - ${beforeLines[i].trim()}`);
      if (afterLines[i] !== undefined)  changedLinesList.push(`  + ${afterLines[i].trim()}`);
    }
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("BLAST RADIUS REPORT");
  console.log("=".repeat(60));
  console.log(
    `1 source edit  (primary → slate.800)  changed ${changedLines} line(s) across the generated CSS.`
  );
  console.log(`Output files affected: ${changedFiles} / ${distPaths.length}`);
  if (changedLinesList.length > 0) {
    console.log("\nChanged lines in tokens.css:");
    changedLinesList.forEach((l) => console.log(l));
  }
  console.log("=".repeat(60));
  console.log("");

} finally {
  // 4. Restore source from saved string (guaranteed even if an error above)
  writeFileSync(lightTokensPath, originalSource, "utf8");
  console.log("Restoring tokens (source restored from saved string)…");
  build();
}

// 5. Assert git clean
try {
  execSync(
    `git -C "${dsServiceRoot}" diff --quiet -- sample/packages/tokens/src`,
    { stdio: "pipe" }
  );
  console.log("Source restored. Git is clean.");
} catch {
  console.error(
    "ERROR: git diff is not clean after restore! Check sample/packages/tokens/src."
  );
  process.exit(1);
}
