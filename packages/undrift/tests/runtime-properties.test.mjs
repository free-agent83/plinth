// A custom property the product's own code sets is not an unknown token. Shapes found on real systems: an arbitrary
// property in a class name, a style object's key (in the same file, or in an object another file builds), and the
// keys of a chart config, which the chart container writes as --color-<key> at runtime. A name the code finishes at
// runtime cannot be checked, and is reported as not checked.
import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { gateSourceWithGaps, gatePaths } from "../src/gate.mjs";
import { loadContract } from "../src/contract.mjs";
import { collectNotChecked } from "../src/unchecked.mjs";
import { propertiesSetIn } from "../src/runtime-properties.mjs";
import { cli, hook } from "./support/world.mjs";
import { commitAll } from "./support/git.mjs";

const contract = {
  system: "@acme/ds", tokens: { "--background": "oklch(1 0 0)", "--chart-teal": "oklch(0.7 0.1 190)" },
  intrinsics: {}, foreignUi: [], exemptMarker: "token-exempt", catalog: [],
};
const gate = (src, c = contract) => gateSourceWithGaps(src, { rules: ["no-unknown-tokens"], contract: c, fileName: "t.tsx" });
const unknown = (src, c) => gate(src, c).violations.map((v) => v.found);

test("a layout shape: an arbitrary property in a class name sets the name", () => {
  const src = `export const L = () => <div className="[--page-gutter:20px] sidebar:[--page-gutter:40px]" style={{ padding: "var(--page-gutter)" }} />;`;
  expect(unknown(src)).toEqual([]);
});

test("a style object's key sets the name, the same element or another", () => {
  const src = `export const D = () => <span className="bg-[var(--color-bg)]" style={{ "--color-bg": "var(--background)" } as any} />;`;
  expect(unknown(src)).toEqual([]);
});

test("setProperty sets the name", () => {
  expect(unknown(`el.style.setProperty("--drag-x", "4px"); const s = { left: "var(--drag-x)" };`)).toEqual([]);
});

test("a chart-config shape: each key of a config checked or typed as a ChartConfig sets --color-<key>", () => {
  const satisfies = `const config = { desktop: { label: "Desktop", color: "var(--chart-teal)" }, "mobile": { label: "Mobile" } } satisfies ChartConfig;
export const C = () => <stop stopColor="var(--color-desktop)" />;
export const M = () => <path stroke="var(--color-mobile)" />;`;
  expect(unknown(satisfies)).toEqual([]);
  const typed = `const config: ChartConfig = { new: { label: "New" } };\nexport const N = () => <stop stopColor={"var(--color-new)"} />;`;
  expect(unknown(typed)).toEqual([]);
});

test("a name no code sets is still unknown: a key the config does not have, a config of another type", () => {
  expect(unknown(`const config = { desktop: {} } satisfies ChartConfig;\nconst s = "var(--color-tablet)";`)).toEqual(["--color-tablet"]);
  const otherType = `import { type ChartConfig, type LegendConfig } from "@/components/ui/chart";
const config = { desktop: {} } satisfies LegendConfig;\nconst s = "var(--color-desktop)";`;
  expect(unknown(otherType)).toEqual(["--color-desktop"]);
  expect(unknown(`const s = "[--page-gutter] var(--page-gutter)";`)).toEqual(["--page-gutter"]);
});

test("a name finished at runtime is not checked, and is said to be", () => {
  const { violations, notChecked } = gate("const colorVar = `var(--chart-${color})`;");
  expect(violations).toEqual([]);
  expect(notChecked.map((n) => `${n.rule} ${n.found} ${n.why} ${n.value}`)).toEqual(["no-unknown-tokens --chart- runtimeName true"]);
});

test("a name finished at runtime on an exempt line is the person's exemption, not listed as not checked", () => {
  const { violations, notChecked, exemptions } = gate("const c = `var(--chart-${color})`; // token-exempt: built from the series key");
  expect(violations).toEqual([]);
  expect(notChecked).toEqual([]);
  expect(exemptions.length).toBe(1);
});

test("a name finished at runtime in the middle of a template is not checked either", () => {
  const { violations, notChecked } = gate("const c = `${a} var(--chart-${b}) ${d}`;");
  expect(violations).toEqual([]);
  expect(notChecked.map((n) => n.found)).toEqual(["--chart-"]);
});

test("a name written out in full in a template is checked", () => {
  expect(unknown("const s = `var(--chart-nope) ${x}`;")).toEqual(["--chart-nope"]);
  expect(unknown("const s = `${x} var(--chart-nope)`;")).toEqual(["--chart-nope"]);
});

test("propertiesSetIn reads the four shapes and nothing else", () => {
  const src = `const a = "[--a:1px] [--b]"; const s = { '--c': 1 }; el.style.setProperty('--d', v);
const cfg = { e: {} } satisfies ChartConfig; const css = "--f: 2px";`;
  expect([...propertiesSetIn(src)].sort()).toEqual(["--a", "--c", "--color-e", "--d"]);
});

// A product: a table layout built in one file and read in another, and a fixture outside every profile.
function product() {
  const root = mkdtempSync(join(tmpdir(), "u-runtime-"));
  const put = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  put(".gitignore", ".undrift/\n");
  put("ds.css", ":root{--background:#fff}");
  put("undrift.config.json", JSON.stringify({
    system: "@acme/ds", tokensCss: "ds.css", ignore: { "ds.css": "the token source", "fixtures/**": "test fixtures" },
    profiles: { app: { include: ["src/**/*.{ts,tsx}", "!**/*.stories.*"], rules: ["no-unknown-tokens"] } },
  }));
  put("src/members/table-layout.ts", "export const tableStyle = { '--table-width': '80%' } as const;\n");
  put("src/members/list.tsx", 'export const L = () => <table className="lg:w-[var(--table-width)] lg:min-w-[var(--table-min)]" />;\n');
  // A story file under the include's negated pattern: not covered, so what it sets is not set by the product.
  put("src/members/list.stories.tsx", 'export const S = () => <div className="[--colr-primary:red]" />;\n');
  put("fixtures/sets.tsx", 'export const F = () => <div className="[--table-min:10px]" />;\n');
  commitAll(root);
  return root;
}

test("a name set in another file the profiles cover counts; one set only outside them does not", () => {
  const root = product();
  const c = loadContract(join(root, "undrift.config.json"));
  const src = 'export const L = () => <table className="lg:w-[var(--table-width)] lg:min-w-[var(--table-min)]" />;';
  expect(unknown(src, c)).toEqual(["--table-min"]);
});

test("a name set only in a file the include's negated pattern leaves out does not count", () => {
  const root = product();
  const c = loadContract(join(root, "undrift.config.json"));
  expect(unknown('const s = "var(--colr-primary)";', c)).toEqual(["--colr-primary"]);
});

test("a setter name written with a CSS escape is read whole, and matches the reference written the same way", () => {
  const src = String.raw`export const L = () => <div className="[--gap\.5:4px] p-[var(--gap\.5)]" />;`;
  expect([...propertiesSetIn(src)]).toEqual([String.raw`--gap\.5`]);
  expect(unknown(src)).toEqual([]);
  const keys = String.raw`const s = { "--gap\.5": 1 }; el.style.setProperty('--row\:1', v);`;
  expect([...propertiesSetIn(keys)].sort()).toEqual([String.raw`--gap\.5`, String.raw`--row\:1`]);
});

test("a name that is only `var(--` and a substitution is not checked either, and is said to be", () => {
  const { violations, notChecked } = gate("const c = `var(--${name})`;");
  expect(violations).toEqual([]);
  expect(notChecked.map((n) => `${n.rule} ${n.found} ${n.why}`)).toEqual(["no-unknown-tokens -- runtimeName"]);
  const mid = gate("const c = `${a} var( --${name}) ${d}`;");
  expect(mid.violations).toEqual([]);
  expect(mid.notChecked.map((n) => n.found)).toEqual(["--"]);
  const exempt = gate("const c = `var(--${name})`; // token-exempt: any series is a token\nconst d = `var(--${other})`;");
  expect(exempt.notChecked.map((n) => n.line)).toEqual([2]);
});

test("a name finished at runtime reaches the run's values not checked and the not-checked list, never a rule part", () => {
  const root = product();
  writeFileSync(join(root, "src/members/series.tsx"), "export const S = (c: string) => `var(--series-${c})`;\n");
  const c = loadContract(join(root, "undrift.config.json"));
  const run = gatePaths([join(root, "src/members/series.tsx")], { contract: c, rules: ["no-unknown-tokens"] });
  expect(run.violations).toEqual([]);
  expect(run.valuesNotChecked.map((v) => `${v.found} ${v.why}`)).toEqual(["--series- runtimeName"]);
  expect(run.rulesPartlyRun.every((p) => !p.places)).toBe(true);
  const items = collectNotChecked({ contract: c, runs: [{ name: "app", ...run }] });
  const item = items.find((i) => i.kind === "values");
  expect(item.why).toBe("runtimeName");
  expect(item.files).toEqual(["src/members/series.tsx:1 --series-"]);
});

test("the gate and the hook agree", () => {
  const root = product();
  const out = JSON.parse(cli(root, ["gate", "--format", "json"]).stdout);
  expect(out.runs[0].violations.map((v) => v.found)).toEqual(["--table-min"]);
  // The agent writes the list: a new file, so every line in it is the agent's.
  writeFileSync(join(root, "src/members/list2.tsx"), 'export const M = () => <table className="w-[var(--table-width)] min-w-[var(--table-min)]" />;\n');
  const r = hook(root, join(root, "src/members/list2.tsx"));
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("--table-min");
  expect(r.stderr).not.toContain("--table-width");
});

test("the hook is silent on a name finished at runtime: nothing in it is the agent's to fix", () => {
  const root = product();
  writeFileSync(join(root, "src/members/series2.tsx"), "export const S = (c: string) => `var(--series-${c})`;\n");
  const r = hook(root, join(root, "src/members/series2.tsx"));
  expect(r.code).toBe(0);
  expect(r.stderr).toBe("");
});

test("a name joined at runtime with + is not checked, and is said to be, whole or in part", () => {
  const head = gate('const c = "var(--chart-" + color + ")";');
  expect(head.violations).toEqual([]);
  expect(head.notChecked.map((n) => `${n.rule} ${n.found} ${n.why}`)).toEqual(["no-unknown-tokens --chart- runtimeName"]);
  const whole = gate('const c = "var(--" + name + ")";');
  expect(whole.violations).toEqual([]);
  expect(whole.notChecked.map((n) => `${n.found} ${n.why}`)).toEqual(["-- runtimeName"]);
  const later = gate('const c = prefix + "var(--series-" + key + ")";');
  expect(later.notChecked.map((n) => n.found)).toEqual(["--series-"]);
  const exempt = gate('const c = "var(--" + name + ")"; // token-exempt: any series is a token');
  expect(exempt.notChecked).toEqual([]);
});

test("a name written out in full beside a + is still checked", () => {
  expect(unknown('const c = "var(--nope)" + suffix;')).toEqual(["--nope"]);
  expect(unknown('const c = "x" + "var(--nope)";')).toEqual(["--nope"]);
  expect(gate('const c = "var(--background) " + extra;').notChecked).toEqual([]);
});
