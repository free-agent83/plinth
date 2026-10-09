// The schema is documentation that can go stale silently: the $schema key
// pointed at a non-existent file for most of this package's life. These tests
// fail the moment the schema falls behind the code, which is the only failure
// mode that matters here. No JSON Schema validator is a dependency, and adding
// one for this alone isn't worth it.
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ALL_RULES } from "../src/gate.mjs";
import { buildConfig } from "../src/init.mjs";

const read = (rel) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

const schema = read("../schema.json");
const ruleEnum =
  schema.properties.profiles.additionalProperties.properties.rules.items.enum;

test("the schema's rule enum matches ALL_RULES exactly", () => {
  expect([...ruleEnum].sort()).toEqual([...ALL_RULES].sort());
});

test("the schema documents every key the sample config uses", () => {
  const cfg = read("../../../undrift.config.json");
  const allowed = Object.keys(schema.properties);
  expect(Object.keys(cfg).filter((k) => !allowed.includes(k))).toEqual([]);
});

test("the schema documents every key `undrift init` generates", () => {
  const generated = buildConfig({
    system: "@acme/ds",
    tokensCss: "node_modules/@acme/ds/ds.css",
    componentsFrom: "node_modules/@acme/ds/index.d.ts",
    intrinsics: { button: "Button" },
  });
  const allowed = Object.keys(schema.properties);
  expect(Object.keys(generated).filter((k) => !allowed.includes(k))).toEqual([]);
});

test("init points $schema at the installed package, not a monorepo path", () => {
  const generated = buildConfig({
    system: "@acme/ds",
    tokensCss: "x.css",
    componentsFrom: "x.d.ts",
    intrinsics: {},
  });
  expect(generated.$schema).toBe("./node_modules/undrift/schema.json");
});

test("schema.json ships to npm", () => {
  const pkg = read("../package.json");
  expect(pkg.files).toContain("schema.json");
});

// `ignore` is the way out of a not-checked report, so its schema says what the
// loader enforces: an object of glob to reason, and no reason is blank.
test("the schema documents ignore as glob to non-blank reason", () => {
  const ignore = schema.properties.ignore;
  expect(ignore.type).toBe("object");
  expect(ignore.additionalProperties.type).toBe("string");
  const nonBlank = new RegExp(ignore.additionalProperties.pattern);
  expect(nonBlank.test("fixtures with violations on purpose")).toBe(true);
  expect(nonBlank.test("")).toBe(false);
  expect(nonBlank.test("   ")).toBe(false);
});

// `rules: []` is a config error at load (it would turn every rule off), so the
// schema says so too, and the enum stays the list of rules that exist.
test("the schema requires a profile's rules to be a non-empty list of known rules", () => {
  const rules = schema.properties.profiles.additionalProperties.properties.rules;
  expect(rules.minItems).toBe(1);
  expect(rules.items.enum.length).toBeGreaterThan(0);
});

// The loader takes an include, and a systemImports, as one string as well as a list (fast-glob
// takes either, and a string include always worked). The schema said array only, so an editor
// underlined a config the tool reads. There is no validator here, so this is a small one, for
// the few keywords the schema uses, and the schema and the loader are held to each other:
// whatever the schema accepts, the loader loads.
function accepts(node, value) {
  if (node.anyOf) return node.anyOf.some((branch) => accepts(branch, value));
  const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (node.type && node.type !== kind) return false;
  if (kind === "string") {
    if (node.minLength !== undefined && value.length < node.minLength) return false;
    if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) return false;
  }
  if (kind === "array") {
    if (node.minItems !== undefined && value.length < node.minItems) return false;
    if (node.items && !value.every((entry) => accepts(node.items, entry))) return false;
  }
  return true;
}

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContract } from "../src/contract.mjs";

const loads = (config) => {
  const root = mkdtempSync(join(tmpdir(), "u-schema-"));
  mkdirSync(join(root, "app"), { recursive: true });
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify(config));
  try {
    loadContract(root);
    return true;
  } catch {
    return false;
  }
};
const profile = (include) => ({ system: "@acme/ds", profiles: { app: { include } } });
const includeSchema = schema.properties.profiles.additionalProperties.properties.include;

test.each([
  ["a string", "app/**/*.tsx", true],
  ["a list", ["app/**/*.tsx", "!**/*.test.tsx"], true],
  ["a list of one", ["app/**/*.tsx"], true],
  ["a number", 3, false],
  ["an object", {}, false],
  ["null", null, false],
  ["an empty string", "", false],
  ["a list with a number in it", ["app/**", 3], false],
  ["an empty list", [], false],
])("the schema says an include that is %s is %s", (_label, value, valid) => {
  expect(accepts(includeSchema, value)).toBe(valid);
});

test("whatever include the schema accepts, the loader loads", () => {
  for (const value of ["app/**/*.tsx", ["app/**/*.tsx"], ["app/**/*.tsx", "!**/*.test.tsx"]]) {
    expect(accepts(includeSchema, value), JSON.stringify(value)).toBe(true);
    expect(loads(profile(value)), JSON.stringify(value)).toBe(true);
  }
});

test("and the loader refuses the shapes the schema refuses, where it can tell", () => {
  for (const value of [3, {}, null, ["app/**", 3], [""]]) {
    expect(accepts(includeSchema, value), JSON.stringify(value)).toBe(false);
    expect(loads(profile(value)), JSON.stringify(value)).toBe(false);
  }
});

test("a profile still has to have an include", () => {
  expect(schema.properties.profiles.additionalProperties.required).toContain("include");
});

test("the include's description says a route group has to be escaped", () => {
  expect(includeSchema.description).toMatch(/route group/i);
  expect(includeSchema.description).toMatch(/backslash/);
});

const importsSchema = schema.properties.systemImports;
test.each([
  ["a string", "@acme/ds", true],
  ["a list", ["@acme/ds", "@acme/ds-extra"], true],
  ["an empty list, which is a way to say none", [], true],
  ["a number", 3, false],
  ["null", null, false],
  ["a list with a number in it", ["@acme/ds", 3], false],
])("the schema says a systemImports that is %s is %s", (_label, value, valid) => {
  expect(accepts(importsSchema, value)).toBe(valid);
});

test("whatever systemImports the schema accepts, the loader loads", () => {
  for (const value of ["@acme/ds", ["@acme/ds"], []]) {
    expect(accepts(importsSchema, value), JSON.stringify(value)).toBe(true);
    expect(loads({ system: "@acme/ds", systemImports: value, profiles: { app: { include: ["app/**"] } } }), JSON.stringify(value)).toBe(true);
  }
});

test("and the loader refuses the shapes the schema refuses", () => {
  for (const value of [3, null, ["@acme/ds", 3]]) {
    expect(accepts(importsSchema, value), JSON.stringify(value)).toBe(false);
    expect(loads({ system: "@acme/ds", systemImports: value, profiles: { app: { include: ["app/**"] } } }), JSON.stringify(value)).toBe(false);
  }
});

test("the systemImports description says an explicit one replaces system", () => {
  expect(importsSchema.description).toMatch(/replaces/);
  expect(importsSchema.description).toMatch(/system/);
});

// componentsFrom is one path or a list of them, never blank: what the loader reads.
const componentsFromSchema = schema.properties.componentsFrom;
test.each([
  ["a path", "node_modules/@acme/ds/dist/index.d.ts", true],
  ["a list of paths", ["a.d.ts", "b.d.ts"], true],
  ["null", null, false],
  ["an empty string", "", false],
  ["a blank string", " ", false],
  ["an empty list", [], false],
  ["a list with a blank entry", ["a.d.ts", "  "], false],
])("the schema says a componentsFrom that is %s is %s", (_label, value, valid) => {
  expect(accepts(componentsFromSchema, value)).toBe(valid);
});

test("no token source is required: the loader loads a config without one, so the schema accepts it", () => {
  expect(schema.anyOf).toBeUndefined();
  expect(schema.required).toEqual(["system", "profiles"]);
  expect(loads({ system: "@acme/ds", profiles: { app: { include: ["app/**"] } } })).toBe(true);
});

test("every componentsFrom the schema accepts, the loader loads; and a blank one is refused by both", () => {
  const config = (componentsFrom) => ({ system: "@acme/ds", componentsFrom, profiles: { app: { include: ["app/**"] } } });
  for (const value of ["a.d.ts", ["a.d.ts", "b.d.ts"]]) {
    expect(accepts(componentsFromSchema, value), JSON.stringify(value)).toBe(true);
    expect(loads(config(value)), JSON.stringify(value)).toBe(true);
  }
  for (const value of [" ", ["a.d.ts", " "]]) {
    expect(accepts(componentsFromSchema, value), JSON.stringify(value)).toBe(false);
    expect(loads(config(value)), JSON.stringify(value)).toBe(false);
  }
  // "" has always meant not set: the loader keeps loading it, though the schema asks for a path.
  expect(loads(config(""))).toBe(true);
});

// What init writes, the schema accepts, key by key: a config that fails its own schema is
// underlined in every editor and was what init wrote for an unbuilt package (null in a
// string field). This holds the generated shape to the schema for each kind of system.
import { runInit } from "../src/init.mjs";
import { app, INLINE_SYSTEM, SUBPATH_SYSTEM, LAYERED_TOKENS, IN_APP_FOLDER } from "./support/init-repos.mjs";

test.each([
  ["inline declarations", INLINE_SYSTEM, "@acme/react", {}],
  ["subpath entries", SUBPATH_SYSTEM, "@acme/parts", {}],
  ["a folder in the app", IN_APP_FOLDER, null, { components: "components/ui" }],
  ["a layered token set, with suggested primitives", LAYERED_TOKENS, "@acme/react", {}],
  ["an unbuilt package, forced", { ...INLINE_SYSTEM, "node_modules/@acme/react/dist/index.d.ts": undefined }, "@acme/react", { force: true }],
])("every key init writes for %s is valid against the schema", (_label, files, pkg, options) => {
  const kept = Object.fromEntries(Object.entries(files).filter(([, text]) => text !== undefined));
  const { config } = runInit(app(kept), pkg, options);
  for (const key of schema.required) expect(config, key).toHaveProperty(key);
  for (const [key, value] of Object.entries(config)) {
    expect(Object.keys(schema.properties), key).toContain(key);
    const node = schema.properties[key];
    if (node.type || node.anyOf) expect(accepts(node, value), `${key}: ${JSON.stringify(value)}`).toBe(true);
  }
  for (const profile of Object.values(config.profiles)) {
    expect(accepts(includeSchema, profile.include)).toBe(true);
    for (const rule of profile.rules) expect(ruleEnum).toContain(rule);
  }
});
