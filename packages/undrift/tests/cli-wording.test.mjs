// Words the command line says that other documents quote. They are held here so a rewording is a decision.
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, cli, INLINE_SYSTEM } from "./support/init-repos.mjs";

describe("the gate, after a violation", () => {
  test("says the messages name the exact fix, and asks for each to be applied", () => {
    const root = app(INLINE_SYSTEM);
    cli(root, ["init", "@acme/react"]);
    writeFileSync(join(root, "src/bad.tsx"), 'export const A = () => <div style={{ color: "#ff0000" }} />;\n');
    const r = cli(root, ["gate"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("The messages above name the exact fix. Apply each and re-run.");
  });
});

describe("the headings of triage and audit, and the usage line", () => {
  test("triage says it has nothing to triage in two sentences", () => {
    const root = app(INLINE_SYSTEM);
    cli(root, ["init", "@acme/react"]);
    expect(cli(root, ["triage"]).out).toContain("Nothing to triage. There are no unresolved gaps.");
  });

  test("the usage text opens with what Undrift is", () => {
    expect(cli(app(INLINE_SYSTEM), ["--help"]).out).toMatch(/^Undrift is the enforcement layer for agent-ready design systems/);
  });
});

// The sample's README shows what the hook says to an agent. It is public, so it is held to what the hook prints.
describe("the README's picture of the hook's message", () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const readme = read("../../../README.md");
  const hook = read("../hooks/undrift-hook.mjs");

  test("opens as the hook's message opens, with no dash", () => {
    const line = readme.split("\n").find((l) => l.includes("blocked this edit"));
    expect(line).toMatch(/^Undrift blocked this edit: 1 violation\(s\) in /);
    expect(hook).toContain("`Undrift blocked this edit: ${violations.length} violation(s) in ${rel}");
  });

  test("the sentence it ends on is the hook's", () => {
    expect(hook).toContain('use <Missing what="\u2026" reason="\u2026" /> instead of improvising.');
    expect(readme.replace(/\s+/g, " ")).toContain('use <Missing what="\u2026" reason="\u2026" /> instead of improvising.');
  });
});

// The package's README says what init reads and what it prints. It is the product's README, so it is held to the
// command line: the form of the command, the folder form, and the line about the tags init leaves out.
// The export of this package withholds that README for now, so there the block is skipped rather than failed.
const PACKAGE_README = new URL("../README.md", import.meta.url);
describe.skipIf(!existsSync(PACKAGE_README))("the package README's account of init", () => {
  const readme = existsSync(PACKAGE_README) ? readFileSync(PACKAGE_README, "utf8") : "";
  const bin = readFileSync(new URL("../bin/undrift.mjs", import.meta.url), "utf8");

  test("the Commands line is the usage line, and names --components", () => {
    const form = "undrift init <package> | --components <folder>  [--config <dir>] [--force]";
    expect(readme).toContain(form);
    expect(bin).toContain(form);
  });

  test("Quick start says what init reads, that it writes nothing when a reading finds nothing, and the folder form", () => {
    const quick = readme.slice(readme.indexOf("## Quick start"), readme.indexOf("Then register the hook")).replace(/\s+/g, " ");
    expect(quick).toContain("`init` reads what the system and the app already have");
    expect(quick).toContain("When a reading finds nothing it says what, and writes nothing unless `--force`.");
    expect(quick).toContain("npx undrift init --components components/ui");
    expect(quick).toContain("It ends by printing how many of the app's UI files the config covers.");
    expect(quick).toContain("undrift later --all");
  });

  test("Quick start says that a native element with no component is not checked, and not banned", () => {
    const quick = readme.slice(readme.indexOf("## Quick start"), readme.indexOf("Then register the hook")).replace(/\s+/g, " ");
    expect(quick).toContain("not checked by no-raw-elements");
    expect(quick).toContain("never bans an element it has no replacement for");
  });

  test("the words it quotes from init are words init prints", () => {
    const quick = readme.slice(readme.indexOf("## Quick start"), readme.indexOf("Then register the hook"));
    const initSource = readFileSync(new URL("../src/init.mjs", import.meta.url), "utf8");
    expect(initSource).toContain("not checked by no-raw-elements");
    expect(quick).not.toMatch(/[\u2014\u2013]/);
  });

  test("the README no longer says init sniffs a largest stylesheet", () => {
    expect(readme).not.toContain("its largest stylesheet");
    expect(readme).not.toContain("`init` sniffs");
  });
});
