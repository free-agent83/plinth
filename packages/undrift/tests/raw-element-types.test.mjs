// An <input> is judged by its type. Found on a real product: hidden inputs that carry a form value, file inputs hidden
// behind a button, a DOM input built to post a form, and a radio told to use Input. A hidden input renders nothing; a
// checkbox or radio is checked against its own component when one is mapped; any other type, or one read only at
// runtime, is not checked and is said to be. And only a system that has a CATALOG.md is told to look in it.
import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateSourceWithGaps } from "../src/gate.mjs";
import { runInit } from "../src/init.mjs";
import { loadContract } from "../src/contract.mjs";
import { collectNotChecked } from "../src/unchecked.mjs";
import { cli as gateCli } from "./support/world.mjs";
import { commitAll } from "./support/git.mjs";
import { app, cli as initCli, IN_APP_FOLDER } from "./support/init-repos.mjs";

const base = {
  system: "@acme/ds", tokens: {}, foreignUi: [], exemptMarker: "token-exempt",
  catalog: [{ name: "Input", source: "package" }], catalogComplete: true, systemImports: ["@acme/ds"],
};
const gate = (src, intrinsics = { input: "Input", button: "Button" }, extra = {}) =>
  gateSourceWithGaps(src, { rules: ["no-raw-elements"], contract: { ...base, intrinsics, ...extra }, fileName: "t.tsx" });
const flagged = (...a) => gate(...a).violations.map((v) => v.message.match(/^(?:Raw|createElement)[^.]*/)[0]);
const setAside = (...a) => gate(...a).notChecked.map((n) => n.found);

test("a sign-in form shape: a hidden input renders nothing, so nothing replaces it", () => {
  expect(gate('export const F = () => <form><input type="hidden" name="next_path" value={p} /></form>;').violations).toEqual([]);
  expect(setAside('export const F = () => <input type="hidden" />;')).toEqual([]);
});

test("a text-like input is still told to use Input", () => {
  expect(flagged('export const F = () => <><input /><input type="email" /><input type={"text"} /></>;')).toEqual([
    "Raw <input> is banned here", "Raw <input> is banned here", "Raw <input> is banned here",
  ]);
});

test("a checkbox or radio is checked against its own component when one is mapped", () => {
  const intrinsics = { input: "Input", "input[type=checkbox]": "Checkbox", "input[type=radio]": "RadioGroup" };
  expect(flagged('export const F = () => <><input type="checkbox" /><input type="radio" /></>;', intrinsics)).toEqual([
    'Raw <input type="checkbox"> is banned here', 'Raw <input type="radio"> is banned here',
  ]);
  expect(gate('export const F = () => <input type="radio" />;', intrinsics).violations[0].message).toMatch(/Use <RadioGroup> from @acme\/ds/);
});

test("an upload button shape: a file input with no component mapped is not checked, and is said to be", () => {
  const { violations, notChecked } = gate('export const U = () => <input ref={r} type="file" className="hidden" />;');
  expect(violations).toEqual([]);
  expect(notChecked.map((n) => `${n.rule} ${n.found} ${n.why}`)).toEqual(['no-raw-elements <input type="file"> inputType']);
});

test("a type read at runtime, or a DOM input built to post a form, is not checked", () => {
  expect(setAside("export const F = () => <input type={kind} />;")).toEqual(["<input type=?>"]);
  expect(setAside('const form = document.createElement("form"); const field = document.createElement("input");')).toEqual(["<input type=?>"]);
  expect(flagged('const b = document.createElement("button");')).toEqual(['createElement("button") renders the same raw <button> that JSX would']);
});

test("React's createElement reads its props", () => {
  expect(gate('React.createElement("input", { type: "hidden" });').violations).toEqual([]);
  expect(flagged('React.createElement("input", null);')).toEqual(['createElement("input") renders the same raw <input> that JSX would']);
  expect(flagged('React.createElement("input", { type: "email" });')).toHaveLength(1);
});

test("with no input mapped, nothing is said about inputs", () => {
  expect(gate('export const F = () => <input type="file" />;', { button: "Button" }).notChecked).toEqual([]);
});

test("the person's exemption on an input not checked is theirs, not listed", () => {
  const { violations, notChecked } = gate('export const U = () => <input type="file" />; // token-exempt: hidden behind a button');
  expect(violations).toEqual([]);
  expect(notChecked).toEqual([]);
});

test("CATALOG.md is named only where the system has one", () => {
  expect(gate("export const F = () => <input />;").violations[0].message).not.toMatch(/CATALOG\.md/);
  const fromCatalog = { catalog: [{ name: "Input", source: "catalog" }], catalogComplete: false };
  expect(gate("export const F = () => <input />;", undefined, fromCatalog).violations[0].message).toMatch(/See CATALOG\.md for when it applies\./);
});

test("init maps a checkbox to the system's Checkbox when it has one, and lists nothing new when it has not", () => {
  const root = app({ ...IN_APP_FOLDER, "components/ui/checkbox.tsx": "export const Checkbox = () => <input type=\"checkbox\" />;\n" });
  const result = runInit(root, null, { components: "components/ui" });
  expect(JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8")).intrinsics).toEqual({
    button: "Button", input: "Input", "input[type=checkbox]": "Checkbox",
  });
  expect(result.unmappedIntrinsics).toEqual(["select", "textarea"]);
});

// ---- Closing round: shapes of the type, the receiver, the key and the wording ----

test("a type given by a shorthand or a computed key is read, or is listed as read at runtime", () => {
  expect(setAside('const type = kind; React.createElement("input", { type });')).toEqual(["<input type=?>"]);
  expect(setAside('React.createElement("input", { ["type"]: kind });')).toEqual(["<input type=?>"]);
  expect(setAside('React.createElement("input", { [key]: "hidden" });')).toEqual(["<input type=?>"]);
  expect(gate('React.createElement("input", { ["type"]: "hidden" });').violations).toEqual([]);
  expect(flagged('React.createElement("input", { ["type"]: "email" });')).toHaveLength(1);
  expect(setAside('React.createElement("input", { type: kind });')).toEqual(["<input type=?>"]);
  expect(setAside('React.createElement("input", { "type": kind });')).toEqual(["<input type=?>"]);
});

test("an object with no type is a text input; createElement with props that are not an object is runtime", () => {
  expect(flagged('React.createElement("input", { name: "q" });')).toHaveLength(1);
  expect(setAside('React.createElement("input", props);')).toEqual(["<input type=?>"]);
  expect(gate('React.createElement("input", { "type": "hidden" });').violations).toEqual([]);
});

test("a createElement whose receiver is not React is the DOM's, so its type is read at runtime", () => {
  for (const receiver of ["el.ownerDocument", "doc", "document", "this.document"]) {
    const { violations, notChecked } = gate(`const f = ${receiver}.createElement("input"); f.type = "hidden";`);
    expect(violations).toEqual([]);
    expect(notChecked.map((n) => n.found)).toEqual(["<input type=?>"]);
  }
  expect(flagged('React.createElement("input");')).toHaveLength(1);
  expect(flagged('import * as R from "react"; R.createElement("input");')).toHaveLength(1);
  expect(flagged('import React from "react"; React.createElement("input");')).toHaveLength(1);
  expect(flagged('import { createElement } from "react"; createElement("input");')).toHaveLength(1);
  expect(flagged("el.ownerDocument.createElement(\"button\");")).toHaveLength(1);
});

test("text-like types are all text inputs, in any case", () => {
  for (const type of ["password", "number", "tel", "url", "search", "text", "email", "EMAIL", "Search"]) {
    const { violations, notChecked } = gate(`export const F = () => <input type="${type}" />;`);
    expect(violations).toHaveLength(1);
    expect(notChecked).toEqual([]);
  }
  expect(gate('export const F = () => <input type="HIDDEN" />;').violations).toEqual([]);
  const intrinsics = { input: "Input", "input[type=checkbox]": "Checkbox" };
  expect(flagged('export const F = () => <input type="CheckBox" />;', intrinsics)).toEqual(['Raw <input type="checkbox"> is banned here']);
});

test("with no input key, an input is not 'no system equivalent' and is not listed", () => {
  const only = { button: "Button" };
  for (const src of ['<input type="email" />', "<input />", '<input type="checkbox" />', "<input type={k} />"]) {
    const { violations, notChecked } = gate(`export const F = () => ${src};`, only);
    expect(violations).toEqual([]);
    expect(notChecked).toEqual([]);
  }
  // Only a typed key, no input key: the typed one is checked, and a text input is neither flagged nor listed.
  const typedOnly = { "input[type=checkbox]": "Checkbox" };
  expect(flagged('export const F = () => <input type="checkbox" />;', typedOnly)).toEqual(['Raw <input type="checkbox"> is banned here']);
  expect(gate('export const F = () => <input type="email" />;', typedOnly).violations).toEqual([]);
});

test("typed keys are read in any spelling: quoted, single quoted, any case", () => {
  const root = mkdtempSync(join(tmpdir(), "u-keys-"));
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
    system: "@acme/ds",
    intrinsics: { 'input[type="checkbox"]': "Checkbox", "input[type='radio']": "RadioGroup", "input[type=FILE]": "FilePicker", "input[ type = Range ]": "Slider" },
  }));
  const intrinsics = loadContract(join(root, "undrift.config.json")).intrinsics;
  expect(intrinsics).toEqual({
    "input[type=checkbox]": "Checkbox", "input[type=radio]": "RadioGroup", "input[type=file]": "FilePicker", "input[type=range]": "Slider",
  });
  const run = (src) => gateSourceWithGaps(src, {
    rules: ["no-raw-elements"], fileName: "t.tsx", contract: { ...base, intrinsics },
  }).violations.map((v) => v.message.match(/^Raw[^.]*/)[0]);
  expect(run('export const F = () => <><input type="checkbox" /><input type="radio" /><input type="FILE" /></>;')).toEqual([
    'Raw <input type="checkbox"> is banned here', 'Raw <input type="radio"> is banned here', 'Raw <input type="file"> is banned here',
  ]);
});

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "u-inputs-"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, ".gitignore"), ".undrift/\n");
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
    system: "@acme/ds", intrinsics: { input: "Input" },
    profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-elements"] } },
  }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "app", name), text);
  commitAll(root);
  return root;
}

test("an input not checked reaches the list and the gate's output, worded for what it is", () => {
  const root = repo({ "u.tsx": 'export const U = () => <><input type="file" /><input type={kind} /></>;\n' });
  const c = loadContract(join(root, "undrift.config.json"));
  const items = collectNotChecked({
    contract: c,
    runs: [{ name: "app", files: 1, rulesNotRun: [], valuesNotChecked: [{ rule: "no-raw-elements", file: join(root, "app/u.tsx"), line: 1, found: '<input type="file">', why: "inputType" }] }],
  });
  const item = items.find((i) => i.kind === "values");
  expect(item.why).toBe("inputType");
  expect(item.reason).toMatch(/^1 value was not checked in profile app: it is the type of an <input>/);
  expect(item.fix).toMatch(/intrinsics/);
  const r = gateCli(root, ["gate", "--strict"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("2 values were not checked in profile app: they are the type of an <input>");
  expect(r.stdout).toContain('app/u.tsx:1 <input type="file">');
  expect(r.stdout).toContain("app/u.tsx:1 <input type=?>");
  expect(r.stdout).not.toMatch(/they are an <input>/);
  expect(JSON.parse(gateCli(root, ["gate", "--format", "json"]).stdout).notChecked.map((i) => [i.kind, i.why, i.count])).toEqual([["values", "inputType", 2]]);
});

test("init prints a typed key as the element it matches, and chooses RadioGroup over Radio", () => {
  const files = { ...IN_APP_FOLDER, "components/ui/radio.tsx": "export const Radio = () => null;\n", "components/ui/radio-group.tsx": "export const RadioGroup = () => null;\n" };
  const root = app(files);
  const result = runInit(root, null, { components: "components/ui" });
  expect(JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8")).intrinsics["input[type=radio]"]).toBe("RadioGroup");
  expect(result.intrinsics["input[type=radio]"]).toBe("RadioGroup");
  const only = app({ ...IN_APP_FOLDER, "components/ui/radio.tsx": "export const Radio = () => null;\n" });
  expect(runInit(only, null, { components: "components/ui" }).intrinsics["input[type=radio]"]).toBe("Radio");
  const printed = initCli(app({ ...IN_APP_FOLDER, "components/ui/checkbox.tsx": "export const Checkbox = () => null;\n" }), ["init", "--components", "components/ui"]);
  expect(printed.out).toContain('<input type="checkbox"> to <Checkbox>');
  expect(printed.out).not.toContain("input[type=");
});
