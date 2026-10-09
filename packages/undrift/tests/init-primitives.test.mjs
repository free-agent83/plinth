// `undrift init` suggests the primitives the token graph infers, marks them as a suggestion and prints them
// as one, and writes the default rules only. The gate's own words about it are held here too: the not-run
// fix says init suggests the list, and the schema says init writes the field that marks it.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit, suggestPrimitives, suggestionLines, OPT_IN_NOTES, PRIMITIVES_SOURCE } from "../src/init.mjs";
import { OPT_IN_RULES } from "../src/rules.mjs";
import { loadContract } from "../src/contract.mjs";
import { layersOf } from "../src/layers.mjs";
import { gateSource } from "../src/gate.mjs";
import { rulesNotRun } from "../src/unchecked.mjs";
import { app, cli, DASH, FLAT_TOKENS, LAYERED_TOKENS, ACCENT_ROLE_TOKENS } from "./support/init-repos.mjs";

const config = (root) => JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8"));
const SCHEMA = JSON.parse(readFileSync(new URL("../schema.json", import.meta.url), "utf8"));
const suggest = (css) => suggestPrimitives(app({ "t.css": css }), ["t.css"]);

describe("a layered token set", () => {
  test("gets its primitives suggested, as globs where the whole family is primitive, and marked", () => {
    const root = app(LAYERED_TOKENS);
    const result = runInit(root, "@acme/react");
    expect(config(root).primitives).toEqual(["--color-primitive-*", "--dimension-*"]);
    expect(config(root).primitivesSource).toBe(PRIMITIVES_SOURCE);
    expect(PRIMITIVES_SOURCE).toMatch(/suggested by undrift init.*confirm/);
    expect(result.primitives).toEqual(["--color-primitive-*", "--dimension-*"]);
  });

  test("the suggestion is a declaration the gate reads: the glob covers a palette entry no role uses yet", () => {
    const root = app(LAYERED_TOKENS);
    runInit(root, "@acme/react");
    const contract = loadContract(root);
    expect(layersOf(contract).declared).toBe(true);
    const run = (source) => gateSource(source, { fileName: "a.tsx", contract, rules: ["no-primitive-tokens"] }).map((v) => v.found);
    expect(run('const a = <i style={{ color: "var(--color-primitive-indigo-100)" }} />;')).toEqual(["--color-primitive-indigo-100"]);
    expect(run('const a = <i className="bg-primary" />;')).toEqual([]);
  });

  test("no opt-in rule is written beside it", () => {
    const root = app(LAYERED_TOKENS);
    runInit(root, "@acme/react");
    expect(config(root).primitives).toBeDefined();
    for (const rule of OPT_IN_RULES) expect(config(root).profiles.app.rules).not.toContain(rule);
  });
});

describe("a flat token set", () => {
  test("gets no primitives and no mark, and the output says so", () => {
    const root = app(FLAT_TOKENS);
    const result = runInit(root, "@acme/react");
    expect("primitives" in config(root)).toBe(false);
    expect("primitivesSource" in config(root)).toBe(false);
    expect(result.primitives).toEqual([]);
    expect(suggestionLines(result).join("\n")).toMatch(/No primitives suggested: the token graph shows no layer of primitives/);
  });
});

describe("a role that reads like a palette step", () => {
  test("is never in the suggestion: it has no step, so it is a role or a bare name, and the output says none were suggested", () => {
    const root = app(ACCENT_ROLE_TOKENS);
    const result = runInit(root, "@acme/react");
    expect("primitives" in config(root)).toBe(false);
    expect(result.primitives).toEqual([]);
    expect(suggestionLines(result).join("\n")).toContain("No primitives suggested");
  });

  test("a step beside it is suggested, and warned about as a suggestion to check", () => {
    const css = ACCENT_ROLE_TOKENS["src/index.css"] + ":root { --blue-500: #3b82f6; --brand: var(--blue-500); }\n";
    const root = app({ ...ACCENT_ROLE_TOKENS, "src/index.css": css });
    const result = runInit(root, "@acme/react");
    expect(config(root).primitives).toEqual(["--blue-500"]);
    expect(suggestionLines(result).join("\n")).toContain("Suggested primitives (check them; a role here would be flagged): --blue-500");
  });
});

describe("how the suggestion is written", () => {
  test("a family with a role in it is listed by name, never as a glob that would flag the role", () => {
    expect(suggest(":root { --p-1: #111; --p-2: #222; --p-role: var(--p-1); --use: var(--p-2); }\n")).toEqual(["--p-1", "--p-2"]);
  });

  test("a rename into Tailwind's colour namespace comes with its primitive, and is not listed", () => {
    expect(suggest(":root { --blue-9: #0090ff; --accent-9: var(--blue-9); --color-blue-9: var(--blue-9); --color-accent: var(--accent-9); }\n")).toEqual(["--blue-9"]);
  });

  test("a rename in another namespace is a role until the system names it, so it is not listed", () => {
    const css =
      ":root { --priority-5: #f00; --ring: var(--priority-5); --text-color-priority-5: var(--priority-5); --border-color-priority-5: var(--priority-5); }\n";
    expect(suggest(css)).toEqual(["--priority-5"]);
  });

  test("a stylesheet's comments and resets declare nothing", () => {
    const css =
      "/* --old-a: #111; --old-use: var(--old-a); */\n" +
      "@theme { --color-red-500: initial; }\n" +
      ":root { --x: #fff; --use: var(--color-red-500); }\n";
    expect(suggest(css)).toEqual([]);
  });

  test("a colour rename inside a family does not stop it being written as a glob", () => {
    const css =
      ":root { --color-red-5: #f00; --color-blue-5: #00f; --brand-5: #f00; --role-a: var(--color-red-5); --role-b: var(--color-blue-5); --role-c: var(--brand-5); --color-brand-5: var(--brand-5); }\n";
    expect(suggest(css)).toEqual(["--color-*", "--brand-5"]);
  });

  test("a rename in another namespace inside a family stops the glob: it would flag what the system calls a role", () => {
    const css =
      ":root { --text-1: 12px; --text-2: 14px; --priority-5: #f00; --role-a: var(--text-1); --role-b: var(--text-2); --role-c: var(--priority-5); --text-color-priority-5: var(--priority-5); }\n";
    expect(suggest(css)).toEqual(["--text-1", "--text-2", "--priority-5"]);
  });
});

describe("the rules", () => {
  test("the output says the two opt-in rules exist and are off, with a line each", () => {
    const result = runInit(app(LAYERED_TOKENS), "@acme/react");
    const said = suggestionLines(result).join("\n");
    expect(said).toMatch(/Rules written: the default rules\. no-primitive-tokens and no-default-palette are available and off/);
    for (const rule of OPT_IN_RULES) expect(said).toContain(`${rule}: ${OPT_IN_NOTES[rule]}`);
  });

  test("a line is held for every opt-in rule there is", () => {
    expect(Object.keys(OPT_IN_NOTES).sort()).toEqual([...OPT_IN_RULES].sort());
  });

  test("none of it has an em dash or an en dash", () => {
    const said = suggestionLines(runInit(app(LAYERED_TOKENS), "@acme/react")).join("\n") + suggestionLines(runInit(app(FLAT_TOKENS), "@acme/react")).join("\n");
    expect(said).not.toMatch(DASH);
    expect(PRIMITIVES_SOURCE).not.toMatch(DASH);
  });

  test("the command prints the suggestion and the rules, and writes the config the gate runs on", () => {
    const root = app(LAYERED_TOKENS);
    const r = cli(root, ["init", "@acme/react"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Suggested primitives (check them; a role here would be flagged): --color-primitive-*, --dimension-*");
    expect(r.out).toMatch(/no-primitive-tokens and no-default-palette are available and off/);
    expect(JSON.parse(cli(root, ["gate", "--format", "json"]).out).notChecked.filter((item) => item.kind === "primitives")).toEqual([]);
  });
});

describe("words the gate and the schema say about init", () => {
  test("the not-run fix for no-primitive-tokens says that init suggests the list", () => {
    const [r] = rulesNotRun(loadContract(app({ ...FLAT_TOKENS, "undrift.config.json": { system: "@acme/react", tokensCss: "src/index.css", profiles: { app: { include: "src/**/*.tsx", rules: ["no-primitive-tokens"] } } } })), ["no-primitive-tokens"]);
    expect(r.fix).toContain('Add "primitives" to undrift.config.json (`undrift init` suggests them):');
  });

  test("the schema says that init writes primitivesSource, and that a person removes it once the list is checked", () => {
    const text = SCHEMA.properties.primitivesSource.description;
    expect(text).toContain("set by `undrift init`");
    expect(text).toMatch(/suggestion from the token graph/);
    expect(text).toMatch(/removes this line/);
  });
});

// A palette that dark mode re-declares step by step reads, in the graph, as roles that rebind per theme, so it
// is never suggested. The person is told, so the list is not mistaken for the whole palette.
describe("palette families that each theme re-declares", () => {
  const REDECLARED =
    ":root {\n" +
    "  --neutral-100: #f5f5f5; --neutral-200: #e5e5e5; --neutral-300: #d4d4d4;\n" +
    "  --brand-500: #3355ff; --brand-600: #2244ee; --brand-700: #1133dd;\n" +
    "  --pair-a: #111111; --pair-b: #222222;\n" +
    "  --background: var(--neutral-100); --accent: var(--brand-500);\n" +
    "}\n" +
    ".dark {\n" +
    "  --neutral-100: #171717; --neutral-200: #262626; --neutral-300: #404040;\n" +
    "  --brand-500: #6680ff; --brand-600: #5570ee; --brand-700: #4460dd;\n" +
    "  --pair-a: #eeeeee; --pair-b: #dddddd;\n" +
    "}\n";

  test("are listed after the suggestion, as families, never as primitives", () => {
    const root = app({ ...LAYERED_TOKENS, "src/index.css": REDECLARED });
    const result = runInit(root, "@acme/react");
    expect(result.primitivesLeftOut).toEqual(["--neutral-*", "--brand-*"]);
    expect(result.primitives).toEqual([]);
    expect(suggestionLines(result).join("\n")).toContain(
      'Not suggested, because each theme re-declares them: --neutral-*, --brand-*. Check whether they are your palette, and add the ones that are to "primitives" if so.'
    );
    expect("primitives" in config(root)).toBe(false);
  });

  test("a family of two is not a palette, and a family declared once is suggested instead", () => {
    const once = ":root { --blue-1: #001; --blue-2: #002; --blue-3: #003; --use-1: var(--blue-1); --use-2: var(--blue-2); }\n";
    const pair = ":root { --pair-a: #111111; --pair-b: #222222; } .dark { --pair-a: #eeeeee; --pair-b: #dddddd; }\n";
    const root = app({ ...LAYERED_TOKENS, "src/index.css": pair + once });
    const result = runInit(root, "@acme/react");
    expect(result.primitivesLeftOut).toEqual([]);
    expect(result.primitives).toEqual(["--blue-*"]);
  });

  test("a re-declared family of values that are not colours is left alone", () => {
    const css = ":root { --size-1: 4px; --size-2: 8px; --size-3: 12px; } .compact { --size-1: 2px; --size-2: 4px; --size-3: 6px; }\n";
    expect(runInit(app({ ...LAYERED_TOKENS, "src/index.css": css }), "@acme/react", { force: true }).primitivesLeftOut).toEqual([]);
  });

  test("a family derived from another token is built on it, and is not a palette", () => {
    const mix = (pct) => `color-mix(in oklch, var(--base) ${pct}%, white)`;
    const css = `:root { --base: #335; --tint-1: ${mix(10)}; --tint-2: ${mix(20)}; --tint-3: ${mix(30)}; } .dark { --tint-1: ${mix(5)}; --tint-2: ${mix(15)}; --tint-3: ${mix(25)}; }\n`;
    expect(runInit(app({ ...LAYERED_TOKENS, "src/index.css": css }), "@acme/react", { force: true }).primitivesLeftOut).toEqual([]);
  });

  test("the command prints the line", () => {
    const r = cli(app({ ...LAYERED_TOKENS, "src/index.css": REDECLARED }), ["init", "@acme/react"]);
    expect(r.out).toContain("Not suggested, because each theme re-declares them: --neutral-*, --brand-*.");
  });

  test("a long list is cut at eight, with the count of the rest", () => {
    const names = "abcdefghij".split("");
    const light = names.map((n) => `--${n}-1: #111; --${n}-2: #222; --${n}-3: #333;`).join(" ");
    const dark = names.map((n) => `--${n}-1: #eee; --${n}-2: #ddd; --${n}-3: #ccc;`).join(" ");
    const result = runInit(app({ ...LAYERED_TOKENS, "src/index.css": `:root { ${light} } .dark { ${dark} }\n` }), "@acme/react", { force: true });
    expect(result.primitivesLeftOut).toHaveLength(10);
    expect(suggestionLines(result).join("\n")).toContain("--h-*, and 2 more.");
  });
});
