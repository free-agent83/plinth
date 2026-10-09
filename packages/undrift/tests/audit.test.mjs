// The audit self-test: the sample system must hold all five value metrics.
// This is the "self-proving" loop: the report a prospect reproduces.
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { describe, expect, test } from "vitest";
import { loadContract } from "../src/contract.mjs";
import { runAudit } from "../src/audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sampleRoot = resolve(here, "../../..");

describe("undrift audit against the sample system", () => {
  const result = runAudit(loadContract(sampleRoot));
  const metric = (id) => result.metrics.find((m) => m.id === id);

  test("reports exactly the five value metrics", () => {
    expect(result.metrics.map((m) => m.id)).toEqual([
      "illegal-states",
      "hardcoded-values",
      "single-source",
      "docs-coverage",
      "zero-drift",
    ]);
  });

  test("1: every component carries type-level tests", () => {
    expect(metric("illegal-states").pass).toBe(true);
  });

  test("2: zero hardcoded values across all profiles", () => {
    const m = metric("hardcoded-values");
    expect(m.pass).toBe(true);
    expect(m.summary).toContain("0 hardcoded");
  });

  test("3: token pipeline present with generated themes", () => {
    expect(metric("single-source").pass).toBe(true);
  });

  test("4: 100% COMPONENT.md coverage", () => {
    expect(metric("docs-coverage").pass).toBe(true);
  });

  test("5: catalog and components in lockstep", () => {
    const m = metric("zero-drift");
    expect(m.pass, m.detail.join("\n")).toBe(true);
  });

  test("overall verdict: the system is agent-enforceable", () => {
    expect(result.pass).toBe(true);
  });
});
