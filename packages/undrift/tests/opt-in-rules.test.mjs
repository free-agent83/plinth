import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_RULES, OPT_IN_RULES, ALL_RULES } from "../src/rules.mjs";
import { gateSource } from "../src/gate.mjs";
import { rulesNotRun } from "../src/unchecked.mjs";
import { DEFAULT_RULES as INIT_DEFAULTS } from "../src/init.mjs";

const SCHEMA = JSON.parse(readFileSync(new URL("../schema.json", import.meta.url), "utf8"));

test("the opt-in rules are known but not default", () => {
  expect(OPT_IN_RULES).toEqual(["no-primitive-tokens", "no-default-palette"]);
  for (const rule of OPT_IN_RULES) {
    expect(ALL_RULES).toContain(rule);
    expect(DEFAULT_RULES).not.toContain(rule);
  }
  expect(ALL_RULES).toEqual([...DEFAULT_RULES, ...OPT_IN_RULES]);
});

test("init writes the default rules, from the one list", () => {
  expect(INIT_DEFAULTS).toBe(DEFAULT_RULES);
});

test("the schema accepts every known rule", () => {
  const json = JSON.stringify(SCHEMA);
  for (const rule of ALL_RULES) expect(json).toContain(`"${rule}"`);
});

test("gateSource with no rules runs no opt-in rule", () => {
  const contract = {
    system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [],
    tokens: { "--p": "#00f", "--color-brand": "var(--p)" }, primitives: ["--p"],
  };
  const v = gateSource(`const a = <div style={{ color: "var(--p)" }} className="bg-indigo-700" />;`, { contract, fileName: "a.tsx" });
  expect(v.filter((x) => OPT_IN_RULES.includes(x.rule))).toEqual([]);
});

test("a profile with no rules list is not told an opt-in rule did not run", () => {
  const notRun = rulesNotRun({ tokens: {} }, undefined).map((r) => r.rule);
  for (const rule of OPT_IN_RULES) expect(notRun).not.toContain(rule);
});

// The hook and `undrift later` judge a file through olderProblems, as the gate does: a profile with
// no rules list runs the default rules there too, never an opt-in one.
test("olderProblems, for a profile with no rules list, runs no opt-in rule", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { olderProblems } = await import("../src/older.mjs");
  const root = mkdtempSync(join(tmpdir(), "undrift-opt-in-"));
  const source = `export const A = () => <div style={{ color: "var(--p)" }} className="bg-indigo-700" />;\n`;
  writeFileSync(join(root, "a.tsx"), source);
  const contract = {
    root, system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [],
    tokens: { "--p": "#00f", "--color-brand": "var(--p)" }, primitives: ["--p"], profiles: { app: { include: ["a.tsx"] } },
  };
  const judged = olderProblems({ contract, rel: "a.tsx", file: join(root, "a.tsx"), realFile: join(root, "a.tsx"), source });
  for (const rule of OPT_IN_RULES) expect(judged.rules).not.toContain(rule);
  expect(judged.agents.filter((v) => OPT_IN_RULES.includes(v.rule))).toEqual([]);
});

// Every entry point that takes a list of rules defaults it to the default rules, never to every known
// rule: a call without one must not run an opt-in rule. One test per entry point, so each default is held.
async function optInWorld() {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "undrift-opt-in-entry-"));
  const source = `export const A = () => <div style={{ color: "var(--p)" }} className="bg-indigo-700" />;\n`;
  writeFileSync(join(root, "a.tsx"), source);
  const contract = {
    root, system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [],
    tokens: { "--p": "#00f", "--color-brand": "var(--p)" }, primitives: ["--p"], profiles: { app: { include: ["a.tsx"] } },
  };
  return { root, file: join(root, "a.tsx"), contract };
}
const optIn = (violations) => violations.filter((v) => OPT_IN_RULES.includes(v.rule));

test("the opt-in rules do fire when a call names them (the entry-point tests below are not vacuous)", async () => {
  const { contract, file } = await optInWorld();
  const { gatePaths } = await import("../src/gate.mjs");
  expect(optIn(gatePaths([file], { contract, rules: ALL_RULES }).violations).map((v) => v.rule)).toContain("no-primitive-tokens");
});

test("gatePaths with no rules runs no opt-in rule", async () => {
  const { contract, file } = await optInWorld();
  const { gatePaths } = await import("../src/gate.mjs");
  expect(optIn(gatePaths([file], { contract }).violations)).toEqual([]);
});

test("gateFiles with no rules runs no opt-in rule", async () => {
  const { contract } = await optInWorld();
  const { gateFiles } = await import("../src/gate.mjs");
  expect(optIn(gateFiles(["a.tsx"], { contract }).violations)).toEqual([]);
});

test("gateProfile, for a profile with no rules list, runs no opt-in rule", async () => {
  const { contract } = await optInWorld();
  const { gateProfile } = await import("../src/gate.mjs");
  expect(optIn(gateProfile("app", { contract }).violations)).toEqual([]);
});
