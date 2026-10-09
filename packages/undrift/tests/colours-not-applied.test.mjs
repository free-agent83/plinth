// A colour in code is not always a colour applied. Three shapes found on real systems, each read as a raw colour and
// each correct code: a value an attribute selector matches, a value compared in logic, and a field's placeholder.
// Each is narrow: the same colour applied beside it is still flagged.
import { expect, test } from "vitest";
import { gateSource } from "../src/gate.mjs";

const contract = {
  system: "@acme/ds",
  tokens: { "--color-primary": "#3b5bdb", "--border": "#e5e5e5" },
  intrinsics: { input: "Input", textarea: "Textarea", button: "Button" }, foreignUi: [], exemptMarker: "token-exempt", catalog: [],
};
const run = (src) => gateSource(src, { contract, fileName: "t.tsx", rules: ["no-raw-colors", "no-arbitrary-values"] });
const found = (src) => run(src).map((v) => `${v.rule} ${v.found}`);

test("a chart wrapper's class names: a colour an attribute selector matches is not a raw colour", () => {
  const src = `const c = <div className="[&_.grid_line[stroke='#ccc']]:stroke-border/50 [&_.dot[stroke='#fff']]:stroke-transparent" />;`;
  expect(run(src)).toEqual([]);
});

test("an attribute selector in CSS text, double quotes or none", () => {
  expect(run('const css = `svg path[fill="#000"] { fill: currentColor; }`;')).toEqual([]);
  expect(run("const c = <div className=\"[&_[data-tone=#fff]]:opacity-50\" />;")).toEqual([]);
});

test("a colour function in an attribute selector's value is not a raw colour either, and one beside it is", () => {
  expect(run("const css = `path[fill='rgb(0 0 0)'] { fill: currentColor; }`;")).toEqual([]);
  expect(found("const css = `path[fill='rgb(0 0 0)'] { fill: rgb(1 2 3); }`;")).toEqual(["no-raw-colors rgb(1 2 3)"]);
});

test("a selector's case flag is part of the selector", () => {
  expect(run("const css = `path[fill='#000' i] { fill: currentColor; }`;")).toEqual([]);
  expect(run('const css = `path[fill="#000" s] { fill: currentColor; }`;')).toEqual([]);
  expect(found("const css = `path[fill='#000' i] { fill: #111; }`;")).toEqual(["no-raw-colors #111"]);
});

test("a colour applied beside a selector is still flagged, by both rules", () => {
  expect(found(`const c = <div className="[&[data-x='a']]:bg-[#000]" />;`)).toEqual([
    "no-raw-colors #000", "no-arbitrary-values [#000]",
  ]);
  expect(found("const css = `path[fill='#000'] { fill: #111; }`;")).toEqual(["no-raw-colors #111"]);
});

test("a colour compared in logic is read, never applied", () => {
  expect(run('const light = (hex: string) => hex.toLowerCase() === "#ffffff";')).toEqual([]);
  expect(run('const dark = (hex: string) => hex !== "#000000";')).toEqual([]);
  expect(run('function f(v: string) { switch (v) { case "#fff": return 1; } return 0; }')).toEqual([]);
});

test("a compared colour does not hide one applied in the same expression", () => {
  expect(found('const c = (h: string) => (h === "#ffffff" ? "#000000" : "#111111");')).toEqual([
    "no-raw-colors #000000", "no-raw-colors #111111",
  ]);
});

test("only a comparison: a colour joined, assigned or defaulted is still read", () => {
  expect(found('const c = (s: string) => "#000000" + s;')).toEqual(["no-raw-colors #000000"]);
  expect(found('const c = (s?: string) => s ?? "#000000";')).toEqual(["no-raw-colors #000000"]);
});

test("a placeholder with a string value is hint text, on whatever component takes it", () => {
  expect(run('const f = <input placeholder="#1a1a1a" />;')).toEqual([]);
  expect(run('const f = <input placeholder={"#3f76ff"} />;')).toEqual([]);
  expect(run('const f = <textarea placeholder="#3f76ff" />;')).toEqual([]);
  expect(run('const f = <Input placeholder="#1a1a1a" />;')).toEqual([]);
  expect(run('const f = <ColourPicker placeholder="#1a1a1a" />;')).toEqual([]);
  expect(run('const f = <Swatch placeholder="#f00" />;')).toEqual([]);
  expect(run('const f = <Select placeholder={`#f00`} />;')).toEqual([]);
});

test("a placeholder that is not a string is read: a JSX value, a style, a spread, an object key", () => {
  expect(found('const f = <Select placeholder={<span style={{ color: "#f00" }}>Pick</span>} />;')).toEqual(["no-raw-colors #f00"]);
  expect(found('const f = <Select placeholder={<span className="text-[#f00]">Pick</span>} />;')).toEqual([
    "no-raw-colors #f00", "no-arbitrary-values [#f00]",
  ]);
  expect(found('const f = <input {...{ placeholder: "#f00" }} />;')).toEqual(["no-raw-colors #f00"]);
  expect(found('const o = { placeholder: "#f00" };')).toEqual(["no-raw-colors #f00"]);
  // Only a prop of that name: any other string is read, whichever component it is given to.
  expect(found('const f = <Icon color="#f00" />;')).toEqual(["no-raw-colors #f00"]);
  expect(found('const f = <Input placeholderColor="#f00" />;')).toEqual(["no-raw-colors #f00"]);
});

test("the field's own style beside the placeholder is still flagged", () => {
  expect(found('const f = <input placeholder="#1a1a1a" style={{ color: "#ffffff" }} />;')).toEqual([
    "no-raw-colors #ffffff",
  ]);
  expect(found('const f = <input placeholder="#1a1a1a" className="bg-[#fff]" />;')).toEqual([
    "no-raw-colors #fff", "no-arbitrary-values [#fff]",
  ]);
});
