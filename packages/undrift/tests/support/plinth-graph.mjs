// Plinth's token layers as the graph alone reads them: the sample's own config with `primitives` taken out,
// so nothing is declared and the graph's reading stands. The sample declares its primitives, and a
// test that is about what the graph reads, or that compares the two, needs the undeclared reading.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract } from "../../src/contract.mjs";

export const SAMPLE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export function plinthGraph() {
  const config = JSON.parse(readFileSync(join(SAMPLE_ROOT, "undrift.config.json"), "utf8"));
  delete config.primitives;
  const abs = (rel) => join(SAMPLE_ROOT, rel);
  const dir = mkdtempSync(join(tmpdir(), "undrift-plinth-graph-"));
  writeFileSync(join(dir, "undrift.config.json"), JSON.stringify({
    system: config.system, tokens: abs(config.tokens), tokensCss: config.tokensCss.map(abs), profiles: config.profiles,
  }));
  return loadContract(dir).layers;
}
