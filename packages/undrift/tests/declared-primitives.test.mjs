// The design system declares its primitives. The token graph cannot tell a
// role from a palette step: a literal `--accent` that another token passes on and a palette step `--blue-9` have the same shape. So the
// config says which tokens are primitives, and the graph only suggests (and only to the advice).
import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateSource } from "../src/gate.mjs";
import { loadContract } from "../src/contract.mjs";
import { layersOf, tokenLayers } from "../src/layers.mjs";
import { rulesNotRun, rulesPartlyRun, collectNotChecked } from "../src/unchecked.mjs";
import { cli } from "./support/world.mjs";
import { commitAll } from "./support/git.mjs";
import { plinthGraph } from "./support/plinth-graph.mjs";

const SCHEMA = JSON.parse(readFileSync(new URL("../schema.json", import.meta.url), "utf8"));
const SAMPLE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// An accent shape: three palette entries, and `--accent`, a role with the graph shape of a primitive.
const ACCENT = [
  ["--white", "#ffffff"], ["--snow", "#f5f5f7"], ["--eclipse", "#0d0d0f"],
  ["--accent", "oklch(0.6204 0.195 253.83)"],
  ["--focus", "var(--accent)"],
  ["--color-accent", "var(--accent)"],
  ["--surface", "var(--snow)"], ["--color-surface", "var(--surface)"],
];
// A palette-step shape: a palette step, a role built on it, and the step's Tailwind alias.
const PALETTE_STEPS = [
  ["--blue-9", "#0090ff"],
  ["--accent-9", "var(--blue-9)"],
  ["--color-blue-9", "var(--blue-9)"],
  ["--color-accent", "var(--accent-9)"],
];

const contractOf = (decls, declared) => ({
  system: "@acme/ds", exemptMarker: "token-exempt", intrinsics: {}, foreignUi: [], catalog: [],
  tokens: Object.fromEntries(decls), layers: tokenLayers(decls, declared), ...(declared ? { primitives: declared } : {}),
});
const run = (src, c) => gateSource(src, { rules: ["no-primitive-tokens"], contract: c, fileName: "t.tsx" });

test("accent shape: the declared palette is the primitive set, and its role --accent is not one", () => {
  const l = tokenLayers(ACCENT, ["--white", "--snow", "--eclipse"]);
  expect([...l.primitives].sort()).toEqual(["--eclipse", "--snow", "--white"]);
  expect(l.primitives.has("--accent")).toBe(false);
  expect(l.primitives.has("--color-accent")).toBe(false);
  const c = contractOf(ACCENT, ["--white", "--snow", "--eclipse"]);
  expect(run(`const a = <div className="bg-accent hover:bg-accent/80" style={{ color: "var(--accent)" }} />;`, c)).toEqual([]);
  const [v] = run(`const a = <div style={{ color: "var(--snow)" }} />;`, c);
  expect(v.found).toBe("--snow");
  expect(v.message).toContain("var(--color-surface)");
});

test("a palette-step shape: --blue-* declared, so bg-blue-9 (the step's alias) and var(--blue-9) are flagged, with the role named", () => {
  const c = contractOf(PALETTE_STEPS, ["--blue-*"]);
  expect(c.layers.primitives.has("--blue-9")).toBe(true);
  const v = run(`const a = <div className="bg-blue-9" style={{ color: "var(--blue-9)" }} />;`, c);
  expect(v.map((x) => x.found).sort()).toEqual(["--blue-9", "bg-blue-9"]);
  expect(v.find((x) => x.found === "--blue-9").message).toContain("var(--color-accent)");
  expect(run(`const a = <div className="bg-accent" />;`, c)).toEqual([]);
});

test("a glob matches a family; an exact name matches itself; a name is not a prefix", () => {
  const decls = [["--blue-9", "#00f"], ["--blue-10", "#00e"], ["--bluebell", "#00a"], ["--x", "var(--blue-9)"]];
  expect([...tokenLayers(decls, ["--blue-*"]).primitives].sort()).toEqual(["--blue-10", "--blue-9"]);
  expect([...tokenLayers(decls, ["--blue-9"]).primitives]).toEqual(["--blue-9"]);
  expect([...tokenLayers(decls, ["--blue"]).primitives]).toEqual([]);
});

test("a declared token is a primitive whatever its shape: the declaration is the word, not the graph", () => {
  const decls = [["--p", "var(--q)"], ["--q", "#00f"], ["--role", "var(--p)"], ["--color-role", "var(--role)"]];
  const l = tokenLayers(decls, ["--p", "--q"]);
  expect([...l.primitives].sort()).toEqual(["--p", "--q"]);
  // a primitive is never offered as the role built on another primitive
  expect(l.rolesFor("--q")).toEqual(["--color-role"]);
});

// A declared primitive that refers to another token and that nothing passes on has the shape of a role leaf.
test("a declared primitive is never offered as the role built on another primitive", () => {
  const decls = [["--q", "#00f"], ["--p", "var(--q)"], ["--role", "var(--q)"]];
  const l = tokenLayers(decls, ["--q", "--p"]);
  expect(l.rolesFor("--q")).toEqual(["--role"]);
  expect(l.roles.has("--p")).toBe(false);
  expect(l.roleLeaves.has("--p")).toBe(false);
});

test("only * is special in a name: a dot or a bracket is read as written", () => {
  const decls = [["--space-1.5", "6px"], ["--space-1x5", "7px"], ["--a[b]", "1"], ["--ab", "2"], ["--r", "var(--space-1.5)"]];
  expect([...tokenLayers(decls, ["--space-1.5"]).primitives]).toEqual(["--space-1.5"]);
  expect([...tokenLayers(decls, ["--a[b]"]).primitives]).toEqual(["--a[b]"]);
});

test("declared, the layers say so, and name each declared entry that matches no token", () => {
  const l = tokenLayers(ACCENT, ["--white", "--nowhere", "--missing-*"]);
  expect(l.declared).toBe(true);
  expect(l.unmatched).toEqual(["--nowhere", "--missing-*"]);
  expect(tokenLayers(ACCENT, ["--white"]).unmatched).toEqual([]);
});

test("not declared, the layers say that too, and keep the graph's guess for the advice", () => {
  const l = tokenLayers(ACCENT);
  expect(l.declared).toBe(false);
  expect(l.unmatched).toEqual([]);
  expect(l.primitives.has("--accent")).toBe(true);
});

test("layersOf reads the contract's declared primitives when it was built by hand", () => {
  const l = layersOf({ tokens: Object.fromEntries(ACCENT), primitives: ["--eclipse"] });
  expect(l.declared).toBe(true);
  expect([...l.primitives]).toEqual(["--eclipse"]);
});

// A declared token brings the renames that give its utility, in Tailwind's colour namespace. A rename in a
// two-word namespace (`--text-color-`, `--border-color-`) is not that: a system can call it a semantic colour.
const PRIORITY = [
  ["--priority-urgent", "#e5484d"], ["--priority-high", "#f76b15"],
  ["--text-color-priority-urgent", "var(--priority-urgent)"],
  ["--border-color-priority-high", "var(--priority-high)"],
  ["--color-priority-urgent", "var(--priority-urgent)"],
];

test("a declared token's rename in a two-word namespace is not a primitive; its --color- rename is", () => {
  const l = tokenLayers(PRIORITY, ["--priority-*"]);
  expect([...l.primitives].sort()).toEqual(["--color-priority-urgent", "--priority-high", "--priority-urgent"]);
  expect(l.primitives.has("--text-color-priority-urgent")).toBe(false);
  expect(l.primitives.has("--border-color-priority-high")).toBe(false);
  const c = contractOf(PRIORITY, ["--priority-*"]);
  expect(run(`const a = <div style={{ color: "var(--text-color-priority-urgent)", borderColor: "var(--border-color-priority-high)" }} />;`, c)).toEqual([]);
  expect(run(`const a = <div className="text-priority-urgent" />;`, c).map((v) => v.found)).toEqual(["text-priority-urgent"]);
});

test("the two-word renames are the roles built on the declared primitive, and are named", () => {
  const c = contractOf(PRIORITY, ["--priority-*"]);
  expect(c.layers.rolesFor("--priority-high")).toEqual(["--border-color-priority-high"]);
  const [v] = run(`const a = <div style={{ color: "var(--priority-high)" }} />;`, c);
  expect(v.message).toContain("var(--border-color-priority-high)");
});

// ---------------------------------------------------------------- not run, and why

test("no primitives declared: the rule does not run, and the reason says what to add", () => {
  const c = contractOf(ACCENT);
  expect(run(`const a = <div className="bg-accent" style={{ color: "var(--accent)" }} />;`, c)).toEqual([]);
  const [r] = rulesNotRun(c, ["no-primitive-tokens"]);
  expect(r.rule).toBe("no-primitive-tokens");
  expect(r.reason).toMatch(/No primitives are declared/);
  expect(r.fix).toMatch(/Add "primitives" to undrift\.config\.json/);
  // `undrift init` suggests the list, so the fix says so.
  expect(r.fix).toMatch(/\(`undrift init` suggests them\)/);
  // The list is the system's own declaration: an agent proposes it, as it proposes an ignore entry.
  expect(r.fix).toMatch(/propose it to the user and do not add it yourself/);
  expect(r.fix).toMatch(/propose taking this rule out/);
  expect(r.fix).not.toMatch(/take this rule out/);
  expect(`${r.reason}${r.fix}`).not.toMatch(/[\u2014\u2013]/);
});

test("a layered graph is not enough: the rule is still not run without a declaration", () => {
  const PLINTH_SHAPE = [
    ["--color-primitive-indigo-700", "oklch(0.39 0.17 277)"],
    ["--color-semantic-primary", "var(--color-primitive-indigo-700)"],
    ["--color-primary", "var(--color-semantic-primary)"],
  ];
  const c = contractOf(PLINTH_SHAPE);
  expect(c.layers.layered).toBe(true);
  expect(run(`const a = <div style={{ color: "var(--color-primitive-indigo-700)" }} />;`, c)).toEqual([]);
  expect(rulesNotRun(c, ["no-primitive-tokens"])).toHaveLength(1);
});

test("declared, the rule runs and is not reported as not run", () => {
  const c = contractOf(ACCENT, ["--white", "--snow", "--eclipse"]);
  expect(rulesNotRun(c, ["no-primitive-tokens"])).toEqual([]);
});

test("declared, but no declared name matches a token: not run, and the reason names the declaration", () => {
  const c = contractOf(ACCENT, ["--palette-*"]);
  expect(run(`const a = <div style={{ color: "var(--snow)" }} />;`, c)).toEqual([]);
  const [r] = rulesNotRun(c, ["no-primitive-tokens"]);
  expect(r.reason).toMatch(/None of the declared primitives \("--palette-\*"\) matches a token/);
});

test("no token source at all keeps its own reason", () => {
  const none = { ...contractOf([]), configuredSources: [] };
  const [r] = rulesNotRun(none, ["no-primitive-tokens"]);
  expect(r.reason).toMatch(/No token source is configured/);
});

// ------------------------------------------- not run beats part run: one report, never two

// shadcn: --radius is the only primitive, a role has no colour primitive under it.
const SHADCN = [
  ["--radius", "0.5rem"], ["--radius-md", "var(--radius)"], ["--radius-sm", "calc(var(--radius) - 4px)"],
  ["--primary", "oklch(0.2 0 0)"], ["--color-primary", "var(--primary)"],
];

test("declared with no colour primitive: the rule runs, and is reported as partly run, never as not run", () => {
  const c = contractOf(SHADCN, ["--radius"]);
  expect(rulesNotRun(c, ["no-primitive-tokens"])).toEqual([]);
  expect(rulesPartlyRun(c, ["no-primitive-tokens"]).map((p) => p.rule)).toEqual(["no-primitive-tokens"]);
  const [v] = run(`const a = <div style={{ borderRadius: "var(--radius)" }} />;`, c);
  expect(v.found).toBe("--radius");
});

test("not declared: reported as not run and not also as partly run", () => {
  const c = contractOf(SHADCN);
  expect(rulesNotRun(c, ["no-primitive-tokens"])).toHaveLength(1);
  expect(rulesPartlyRun(c, ["no-primitive-tokens"])).toEqual([]);
  const items = collectNotChecked({
    contract: c,
    runs: [{ name: "app", files: 1, rulesNotRun: rulesNotRun(c, ["no-primitive-tokens"]), rulesPartlyRun: rulesPartlyRun(c, ["no-primitive-tokens"]) }],
  });
  expect(items.map((i) => i.kind)).toEqual(["rule"]);
});

test("declared but nothing matches: not run, and not also partly run", () => {
  const c = contractOf(SHADCN, ["--nothing-*"]);
  expect(rulesNotRun(c, ["no-primitive-tokens"])).toHaveLength(1);
  expect(rulesPartlyRun(c, ["no-primitive-tokens"])).toEqual([]);
});

test("the partly-run reason points at the declaration now, not at the token sources", () => {
  const [p] = rulesPartlyRun(contractOf(SHADCN, ["--radius"]), ["no-primitive-tokens"]);
  expect(p.reason).toMatch(/None of the declared primitives is a raw colour/);
  expect(p.reason).toMatch(/Colour utilities were not checked by no-primitive-tokens/);
  expect(p.fix).toMatch(/"primitives"/);
});

// ------------------------------------------------- a declared name with no token: Not checked

test("a declared name that matches no token is a Not checked item, one for each", () => {
  const c = contractOf(ACCENT, ["--white", "--nowhere", "--missing-*"]);
  const items = collectNotChecked({ contract: c, runs: [] });
  expect(items.map((i) => [i.kind, i.pattern])).toEqual([["primitives", "--nowhere"], ["primitives", "--missing-*"]]);
  expect(items[0].reason).toMatch(/primitives "--nowhere" matches no token/);
  expect(items[0].fix).toMatch(/Correct/);
  expect(items[0].fix).toMatch(/propose the change to the user and do not make it yourself/);
  expect(`${items[0].reason}${items[0].fix}`).not.toMatch(/[\u2014\u2013]/);
});

test("a stale declaration is counted once: where the rule did not run for it, the rule's item says so and the entries add nothing", () => {
  const c = contractOf(ACCENT, ["--palette-*"]);
  const runs = [{ name: "app", files: 1, rulesNotRun: rulesNotRun(c, ["no-primitive-tokens"]), rulesPartlyRun: [] }];
  expect(collectNotChecked({ contract: c, runs }).map((i) => i.kind)).toEqual(["rule"]);
  // with no profile listing the rule, the entries are all there is to say
  expect(collectNotChecked({ contract: c, runs: [] }).map((i) => i.kind)).toEqual(["primitives"]);
  // a declaration that is only partly stale keeps its entry, and the rule runs
  const some = contractOf(ACCENT, ["--white", "--palette-*"]);
  const runs2 = [{ name: "app", files: 1, rulesNotRun: rulesNotRun(some, ["no-primitive-tokens"]), rulesPartlyRun: [] }];
  expect(collectNotChecked({ contract: some, runs: runs2 }).map((i) => i.kind)).toEqual(["primitives"]);
});

test("the not-run fix for names that match nothing says to propose the change", () => {
  const [r] = rulesNotRun(contractOf(ACCENT, ["--palette-*"]), ["no-primitive-tokens"]);
  expect(r.fix).toMatch(/propose the change to the user and do not make it yourself/);
});

test("every declared name matching something reports nothing; no declaration reports nothing", () => {
  expect(collectNotChecked({ contract: contractOf(ACCENT, ["--white", "--snow*", "--eclipse"]), runs: [] })).toEqual([]);
  expect(collectNotChecked({ contract: contractOf(ACCENT), runs: [] })).toEqual([]);
});

// ------------------------------------------------------------------------------------ config

const fixture = (config, files = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "undrift-primitives-"));
  mkdirSync(join(dir, "app"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(dir, rel), content);
  writeFileSync(join(dir, "undrift.config.json"), JSON.stringify({ system: "@acme/ds", tokensCss: "ds.css", ...config }));
  return dir;
};
const ACCENT_CSS = ":root{--white:#fff;--snow:#f5f5f7;--accent:oklch(0.62 0.195 254);--focus:var(--accent);--surface:var(--snow)}@theme inline{--color-accent:var(--accent);--color-surface:var(--surface)}";

test("the contract carries the declared primitives and layers built from them", () => {
  const c = loadContract(fixture({ primitives: ["--white", "--snow"], profiles: { app: { include: ["app/**"] } } }, { "ds.css": ACCENT_CSS }));
  expect(c.primitives).toEqual(["--white", "--snow"]);
  expect([...c.layers.primitives].sort()).toEqual(["--snow", "--white"]);
  expect(c.layers.declared).toBe(true);
});

test("without the key the contract declares none", () => {
  const c = loadContract(fixture({ profiles: { app: { include: ["app/**"] } } }, { "ds.css": ACCENT_CSS }));
  expect(c.primitives).toBeNull();
  expect(c.layers.declared).toBe(false);
});

test("primitives that is not a list of names is a config error that says what to give", () => {
  const bad = (primitives) => () => loadContract(fixture({ primitives, profiles: { app: { include: ["app/**"] } } }, { "ds.css": ACCENT_CSS }));
  expect(bad("--white")).toThrow(/"primitives" must be a list of token names/);
  expect(bad([])).toThrow(/empty "primitives"/);
  expect(bad(["--white", ""])).toThrow(/"primitives" entry 2/);
  expect(bad(["--white", 7])).toThrow(/"primitives" entry 2/);
  expect(bad(["white"])).toThrow(/"primitives" entry 1.*start with --/);
});

test("the schema accepts the key: a non-empty list of non-blank strings", () => {
  const p = SCHEMA.properties.primitives;
  expect(p.type).toBe("array");
  expect(p.minItems).toBe(1);
  expect(p.items.type).toBe("string");
  expect(new RegExp(p.items.pattern).test("--color-primitive-*")).toBe(true);
  expect(new RegExp(p.items.pattern).test("color-primitive")).toBe(false);
  expect(p.description).toMatch(/globs/);
  expect(SCHEMA.properties.primitivesSource.type).toBe("string");
});

// ----------------------------------------------------------------------------------- the gate

const repo = (config, later) => {
  const root = fixture({
    ignore: { "ds.css": "the token source" },
    profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-primitive-tokens"] } },
    ...config,
  }, { "ds.css": ACCENT_CSS, "app/page.tsx": 'export const P = () => <div className="bg-accent" style={{ color: "var(--focus)" }} />;\n', ".gitignore": ".undrift/\n" });
  if (later) writeFileSync(join(root, "undrift.later.json"), JSON.stringify({ version: 1, entries: later }));
  commitAll(root);
  return root;
};

test("gate --strict: a profile that lists the rule with no primitives declared fails, naming the reason", () => {
  const r = cli(repo({}), ["gate", "--strict"]);
  expect(r.code).toBe(1);
  expect(r.stdout).toContain("No primitives are declared");
  expect(r.stdout).toContain("no-primitive-tokens did not run in profile app");
});

test("gate --strict: with the palette declared the rule runs and the role code passes", () => {
  const r = cli(repo({ primitives: ["--white", "--snow"] }), ["gate", "--strict"]);
  expect(r.stdout).not.toContain("did not run");
  expect(r.code).toBe(0);
});

test("gate --strict: a declared name that matches no token fails and is listed under Not checked", () => {
  const r = cli(repo({ primitives: ["--white", "--snow", "--gone-*"] }), ["gate", "--strict"]);
  expect(r.code).toBe(1);
  expect(r.stdout).toContain('primitives "--gone-*" matches no token');
  const out = JSON.parse(cli(repo({ primitives: ["--white", "--gone-*"] }), ["gate", "--format", "json"]).stdout);
  expect(out.notChecked.map((i) => i.kind)).toEqual(["primitives"]);
});

test("gate: a declared primitive in code is a violation", () => {
  const root = repo({ primitives: ["--white", "--snow"] });
  writeFileSync(join(root, "app/page.tsx"), 'export const P = () => <div style={{ color: "var(--snow)" }} />;\n');
  commitAll(root);
  const r = cli(root, ["gate"]);
  expect(r.code).toBe(1);
  expect(r.stdout).toContain("no-primitive-tokens");
});

// The later list reads rulesNotRun: an entry for a rule that did not run is not looked for.
test("a deferred entry on a profile that has no primitives declared is not looked for, and never out of date", () => {
  const entry = { file: "app/page.tsx", rule: "no-primitive-tokens", value: "--snow", count: 1, date: "2026-10-04" };
  const out = JSON.parse(cli(repo({}, [entry]), ["gate", "--format", "json"]).stdout);
  expect(out.staleLater).toEqual([]);
  expect(out.goneLater).toEqual([]);
  expect(out.unlookedLater).toHaveLength(1);
  expect(out.unlookedLater[0].reason).toBe("no-primitive-tokens could not run in this run");
});

// ----------------------------------------------------------------------------------- Plinth

const PLINTH_DECLARED = ["--color-primitive-*", "--dimension-*", "--shadow-primitive-*"];

test("Plinth declares its primitives, and every token the graph finds is among them", () => {
  const plinth = loadContract(SAMPLE_ROOT);
  expect(plinth.primitives).toEqual(PLINTH_DECLARED);
  expect(plinth.layers.declared).toBe(true);
  expect(plinth.layers.unmatched).toEqual([]);
  const graph = plinthGraph();
  expect(graph.primitives.size).toBe(62);
  for (const name of graph.primitives) expect(plinth.layers.primitives.has(name), name).toBe(true);
});

// The declaration is not the graph's 62. It holds ten more: palette entries and scale steps that no role is
// built on yet, which the graph leaves unclassified because it cannot tell them from a literal role. The design
// system says they are primitives, and they are: a reference to one is flagged, with "no role is built on it".
test("Plinth: the ten declared primitives the graph does not find are palette entries and scale steps nothing uses", () => {
  const plinth = loadContract(SAMPLE_ROOT);
  const graph = plinthGraph();
  const extra = [...plinth.layers.primitives].filter((n) => !graph.primitives.has(n)).sort();
  expect(plinth.layers.primitives.size).toBe(72);
  expect(extra).toEqual([
    "--color-primitive-amber-600", "--color-primitive-amber-700", "--color-primitive-blue-600",
    "--color-primitive-emerald-600", "--color-primitive-slate-500",
    "--dimension-radius-none", "--dimension-spacing-0", "--dimension-spacing-1", "--dimension-spacing-16", "--dimension-spacing-3",
  ]);
  for (const name of extra) expect(plinth.layers.rolesFor(name), name).toEqual([]);
});

test("Plinth: the roles for every primitive the graph finds are the same under the declaration, indigo-700 included", () => {
  const plinth = loadContract(SAMPLE_ROOT).layers;
  const graph = plinthGraph();
  expect(plinth.rolesFor("--color-primitive-indigo-700")).toEqual(
    ["--color-chart-3", "--color-chart-4", "--color-chart-5", "--color-primary", "--color-ring"],
  );
  for (const name of graph.primitives) expect(plinth.rolesFor(name), name).toEqual(graph.rolesFor(name));
});
