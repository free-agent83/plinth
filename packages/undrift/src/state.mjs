// packages/undrift/src/state.mjs
// Triage decisions persist here. Git-tracked on purpose: a decision to add a
// component to the design system, or to accept a raw value, is a design
// decision and belongs in review alongside the code it justifies.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const STATE_FILE = "undrift.decisions.json";
const EMPTY = { version: 1, decisions: [] };

export function loadState(root) {
  const path = resolve(root, STATE_FILE);
  if (!existsSync(path)) return { ...EMPTY, decisions: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return { version: parsed.version ?? 1, decisions: parsed.decisions ?? [] };
  } catch {
    return { ...EMPTY, decisions: [] };
  }
}

/** Upsert by `what`. There is one standing decision per subject. */
export function recordDecision(root, decision) {
  const state = loadState(root);
  state.decisions = state.decisions.filter((d) => d.what !== decision.what);
  state.decisions.push({ ...decision, at: decision.at ?? null });
  writeFileSync(resolve(root, STATE_FILE), JSON.stringify(state, null, 2) + "\n");
  return state;
}
