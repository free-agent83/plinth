// Values no token can reach are set aside and reported as not checked: never flagged (the fix "use a token" is
// untrue there) and never passed in silence (clean means checked). Two shapes found on real systems: the styles of a
// PDF document built with @react-pdf/renderer, and a <meta name="theme-color"> tag's content.
import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateSourceWithGaps } from "../src/gate.mjs";
import { statusLine, profileVerdict } from "../src/report.mjs";
import { cli } from "./support/world.mjs";
import { commitAll } from "./support/git.mjs";

const contract = {
  system: "@acme/ds", tokens: { "--color-primary": "#3b5bdb" },
  intrinsics: {}, foreignUi: [], exemptMarker: "token-exempt", catalog: [],
};
const gate = (src) => gateSourceWithGaps(src, { contract, fileName: "t.tsx" });

// A PDF document shape: a typed style map, a stylesheet made by the renderer, and the style of its page.
const PDF = `import type { Styles } from "@react-pdf/renderer";
import { Document, Page, StyleSheet } from "@react-pdf/renderer";
const LIST: Styles = { "li.checked": { backgroundColor: "#3f76ff", borderColor: "#3f76ff" } };
const SHEET = StyleSheet.create({ cell: { border: "1px solid #e5e5e5", padding: 10 } });
export const Doc = () => (
  <Document>
    <Page size="A4" style={{ backgroundColor: "#ffffff", padding: 64 }} />
  </Document>
);
`;

test("a PDF document's styles are set aside, not flagged", () => {
  const { violations, notChecked } = gate(PDF);
  expect(violations).toEqual([]);
  expect(notChecked.map((n) => `${n.line} ${n.rule} ${n.found} ${n.why}`)).toEqual([
    "3 no-raw-colors #3f76ff renderer",
    "3 no-raw-colors #3f76ff renderer",
    "4 no-raw-colors #e5e5e5 renderer",
    "7 no-inline-style-values padding: 64 renderer",
    "7 no-raw-colors #ffffff renderer",
  ]);
});

test("the same values outside the renderer are flagged: a file that does not import it", () => {
  const src = PDF.replaceAll("@react-pdf/renderer", "@acme/sheets");
  expect(gate(src).violations.map((v) => v.found)).toEqual(["#3f76ff", "#3f76ff", "#e5e5e5", "padding: 64", "#ffffff"]);
  expect(gate(src).notChecked).toEqual([]);
});

test("an app element's style beside the document is still flagged", () => {
  const src = `${PDF}\nexport const Preview = () => <div style={{ color: "#ffffff" }} />;\n`;
  expect(gate(src).violations.map((v) => `${v.line} ${v.found}`)).toEqual(["11 #ffffff"]);
});

test("a namespace import and a satisfies clause are the renderer's too", () => {
  const src = `import * as PDF from "@react-pdf/renderer";
import type { Styles } from "@react-pdf/renderer";
const A = PDF.StyleSheet.create({ cell: { color: "#111111" } });
const B = { row: { color: "#222222" } } satisfies Styles;
export const Doc = () => <PDF.Page style={{ color: "#333333" }} />;
`;
  const { violations, notChecked } = gate(src);
  expect(violations).toEqual([]);
  expect(notChecked.map((n) => n.found)).toEqual(["#111111", "#222222", "#333333"]);
});

test('a <meta name="theme-color"> tag\'s content is set aside; a colour beside it is not', () => {
  const src = 'export const H = () => (<head><meta name="theme-color" content="#fff" /><style>{"body{color:#000}"}</style></head>);';
  const { violations, notChecked } = gate(src);
  expect(notChecked.map((n) => `${n.found} ${n.why}`)).toEqual(["#fff meta"]);
  expect(violations.map((v) => v.found)).toEqual(["#000"]);
});

test("the status line and the profile verdict say values were not checked, never on-system or clean", () => {
  expect(statusLine({ declarations: 3, values: 5 })).toBe("⚠ 5 values not checked · 3 declarations");
  expect(statusLine({ declarations: 3, violations: 1, values: 1 })).toBe("✗ 1 violation · 1 value not checked · 3 declarations");
  expect(profileVerdict({ files: 1, valuesNotChecked: 2 })).toEqual({ tone: "warn", text: "⚠ no violations, 2 values not checked" });
});

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "u-values-"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, ".gitignore"), ".undrift/\n");
  writeFileSync(join(root, "ds.css"), ":root{--color-primary:#3b5bdb}");
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
    system: "@acme/ds", tokensCss: "ds.css", ignore: { "ds.css": "the token source" },
    profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-raw-colors", "no-arbitrary-values", "no-inline-style-values", "no-unknown-tokens"] } },
  }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "app", name), text);
  commitAll(root);
  return root;
}

test("the gate lists them under Not checked, and --strict still passes", () => {
  const root = repo({ "doc.tsx": PDF });
  const r = cli(root, ["gate", "--strict"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("5 values were not checked in profile app: they style a renderer that does not read CSS (@react-pdf/renderer)");
  expect(r.stdout).toContain("app/doc.tsx:7 padding: 64");
  expect(r.stdout).toMatch(/⚠ 5 values not checked · \d+ declarations?/);
  const out = JSON.parse(cli(root, ["gate", "--strict", "--format", "json"]).stdout);
  expect(out.pass).toBe(true);
  expect(out.notChecked.map((i) => [i.kind, i.why, i.count])).toEqual([["values", "renderer", 5]]);
});

test("a violation beside them still fails the run", () => {
  const root = repo({ "doc.tsx": PDF, "page.tsx": 'export const P = () => <div className="bg-[#000]" />;\n' });
  expect(cli(root, ["gate"]).code).toBe(1);
});

// ---- Fix round: what counts as the renderer's, and what stays checked ----

test("the renderer's DOM components are checked: only its PDF primitives are set aside", () => {
  const src = `import { PDFViewer, PDFDownloadLink, BlobProvider, Document, View as V } from "@react-pdf/renderer";
import * as R from "@react-pdf/renderer";
export const A = () => (
  <>
    <PDFViewer style={{ border: "1px solid #eeeeee", width: 640 }} />
    <PDFDownloadLink document={<Document />} style={{ color: "#efefef" }} />
    <R.PDFViewer style={{ color: "#dddddd" }} />
    <BlobProvider style={{ color: "#cccccc" }} />
    <V style={{ color: "#111111" }} />
    <R.Svg style={{ color: "#222222" }} />
  </>
);
`;
  const { violations, notChecked } = gate(src);
  expect(violations.map((v) => `${v.line} ${v.found}`)).toEqual([
    "5 width: 640", "5 #eeeeee", "6 #efefef", "7 #dddddd", "8 #cccccc",
  ]);
  expect(notChecked.map((n) => `${n.line} ${n.found}`)).toEqual(["9 #111111", "10 #222222"]);
});

test("content is the meta tag's alone: on another element it stays checked, and so does JSX inside a meta's content", () => {
  const src = `export const A = () => (
  <>
    <Tooltip content={<span style={{ color: "#ff0000" }} />} />
    <Tooltip content="#ee0000" />
    <meta name="x" content={<div style={{ color: "#fafafa" }} />} />
    <meta name="theme-color" content="#fff" />
  </>
);
`;
  const { violations, notChecked } = gate(src);
  expect(violations.map((v) => `${v.line} ${v.found}`)).toEqual(["3 #ff0000", "4 #ee0000", "5 #fafafa"]);
  expect(notChecked.map((n) => `${n.line} ${n.found} ${n.why}`)).toEqual(["6 #fff meta"]);
});

test("only the renderer's StyleSheet.create is set aside, not .create on any binding, aliased or by namespace", () => {
  const src = `import { Font, StyleSheet as SS } from "@react-pdf/renderer";
import * as R from "@react-pdf/renderer";
const A = Font.create?.({ color: "#030303" });
const B = R.Font.create({ color: "#040404" });
const C = SS.create({ a: { color: "#050505" } });
const D = R.StyleSheet.create({ a: { color: "#060606" } });
`;
  const { violations, notChecked } = gate(src);
  expect(violations.map((v) => v.found)).toEqual(["#030303", "#040404"]);
  expect(notChecked.map((n) => n.found)).toEqual(["#050505", "#060606"]);
});

test("a local that shadows a renderer name is the local's, so its style stays checked", () => {
  const src = `import { View } from "@react-pdf/renderer";
export const A = () => { const View = "div"; return <View style={{ color: "#050505" }} />; };
export const B = ({ View }) => <View style={{ color: "#060606" }} />;
export const C = () => <View style={{ color: "#070707" }} />;
`;
  const { violations, notChecked } = gate(src);
  expect(violations.map((v) => v.found)).toEqual(["#050505", "#060606"]);
  expect(notChecked.map((n) => n.found)).toEqual(["#070707"]);
});

test("a value on a line carrying a token-exempt marker shows as an exemption, not as not checked", () => {
  const src = `import { StyleSheet } from "@react-pdf/renderer";
const S = StyleSheet.create({ a: { color: "#080808" } }); // token-exempt: the printed brand colour
`;
  const { violations, notChecked, exemptions } = gate(src);
  expect(violations).toEqual([]);
  expect(notChecked).toEqual([]);
  expect(exemptions.map((e) => `${e.line} ${e.reason}`)).toEqual(["2 the printed brand colour"]);
});

test("one value reads as one, and many as many", () => {
  const one = cli(repo({ "doc.tsx": 'import { StyleSheet } from "@react-pdf/renderer";\nconst S = StyleSheet.create({ a: { color: "#080808" } });\n' }), ["gate", "--strict"]).stdout;
  expect(one).toContain("1 value was not checked in profile app: it styles a renderer that does not read CSS (@react-pdf/renderer), so no token can reach it.");
  expect(one).not.toMatch(/\bthey\b/i);
  const meta = cli(repo({ "head.tsx": 'export const H = () => <meta name="theme-color" content="#fff" />;\n' }), ["gate", "--strict"]).stdout;
  expect(meta).toContain("1 value was not checked in profile app: it is the content of a <meta> tag, which the browser reads outside every stylesheet, so no token can reach it.");
  const two = cli(repo({ "head.tsx": 'export const H = () => (<><meta name="theme-color" content="#fff" /><meta name="msapplication-TileColor" content="#000" /></>);\n' }), ["gate", "--strict"]).stdout;
  expect(two).toContain("2 values were not checked in profile app: they are the content of a <meta> tag, which the browser reads outside every stylesheet, so no token can reach them.");
});

test("the values are listed in file then line order, not in the order the rules found them", () => {
  const page = 'import { Page } from "@react-pdf/renderer";\nexport const A = () => (\n  <Page style={{\n    color: "#111111",\n    padding: 64,\n  }} />\n);\n';
  const root = repo({ "b.tsx": page, "a.tsx": page });
  const out = JSON.parse(cli(root, ["gate", "--format", "json"]).stdout);
  expect(out.notChecked[0].files).toEqual([
    "app/a.tsx:4 #111111", "app/a.tsx:5 padding: 64", "app/b.tsx:4 #111111", "app/b.tsx:5 padding: 64",
  ]);
});

// ---- Closing fix: typed path, local types, shadowing paths, the other PDF components ----

test("only the renderer's style map type sets an object aside: its browser props types stay checked", () => {
  const src = `import { PDFViewer, PDFViewerProps, PDFDownloadLinkProps, BlobProviderProps, Styles } from "@react-pdf/renderer";
import * as R from "@react-pdf/renderer";
const A: PDFViewerProps = { style: { border: "1px solid #a0000c" } };
const B = { style: { color: "#a0000d" } } satisfies R.PDFViewerProps;
const C: PDFDownloadLinkProps = { style: { color: "#a0000f" } };
const D: BlobProviderProps = { style: { color: "#a00010" } };
const E: Styles = { a: { color: "#a00011" } };
const F: R.Styles = { a: { color: "#a00012" } };
`;
  const { violations, notChecked } = gate(src);
  expect(violations.map((v) => `${v.line} ${v.found}`)).toEqual(["3 #a0000c", "4 #a0000d", "5 #a0000f", "6 #a00010"]);
  expect(notChecked.map((n) => `${n.line} ${n.found}`)).toEqual(["7 #a00011", "8 #a00012"]);
});

test("an aliased Styles is the renderer's too", () => {
  const src = `import type { Styles as S } from "@react-pdf/renderer";
const A: S = { a: { color: "#a00013" } };
`;
  expect(gate(src).notChecked.map((n) => n.found)).toEqual(["#a00013"]);
});

test("a local type that shadows Styles is the local's, so its object stays checked", () => {
  const src = `import type { Styles } from "@react-pdf/renderer";
export const A = () => { type Styles = Record<string, any>; const s: Styles = { a: { color: "#a0000e" } }; return <div style={s.a} />; };
export const B = () => { interface Styles { a: any } const s: Styles = { a: { color: "#a00014" } }; return s; };
export function C<Styles>() { const s: Styles = { a: { color: "#a00015" } } as any; return s; }
const D: Styles = { a: { color: "#a00016" } };
`;
  const { violations, notChecked } = gate(src);
  expect(violations.map((v) => v.found)).toEqual(["#a0000e", "#a00014", "#a00015"]);
  expect(notChecked.map((n) => n.found)).toEqual(["#a00016"]);
});

test("a catch variable, a for-of variable, an inner function, class and enum named like a primitive are the local's", () => {
  const src = `import { View } from "@react-pdf/renderer";
export const A = () => { try { f(); } catch (View) { return <View style={{ color: "#b00001" }} />; } };
export const B = (xs) => { for (const View of xs) { return <View style={{ color: "#b00002" }} />; } };
export const C = () => { function View() { return null; } return <View style={{ color: "#b00003" }} />; };
export const D = () => { class View {} return <View style={{ color: "#b00004" }} />; };
export const E = () => { enum View { a } return <View style={{ color: "#b00005" }} />; };
export const F = () => <View style={{ color: "#b00006" }} />;
`;
  const { violations, notChecked } = gate(src);
  expect(violations.map((v) => v.found)).toEqual(["#b00001", "#b00002", "#b00003", "#b00004", "#b00005"]);
  expect(notChecked.map((n) => n.found)).toEqual(["#b00006"]);
});

test("the renderer's form, background, list and marker components are PDF primitives too", () => {
  const src = `import { ImageBackground, FieldSet, TextInput, Checkbox, Select, List, Marker } from "@react-pdf/renderer";
export const A = () => (
  <>
    <ImageBackground style={{ color: "#c00001" }} />
    <FieldSet style={{ color: "#c00002" }} />
    <TextInput style={{ color: "#c00003" }} />
    <Checkbox style={{ color: "#c00004" }} />
    <Select style={{ color: "#c00005" }} />
    <List style={{ color: "#c00006" }} />
    <Marker style={{ color: "#c00007" }} />
  </>
);
`;
  const { violations, notChecked } = gate(src);
  expect(violations).toEqual([]);
  expect(notChecked.length).toBe(7);
});
