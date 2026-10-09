// The component names init and the gate read from what a design system ships. Modelled on
// what real systems publish: per-file declarations that tsc writes as `export declare const`
// (a system lost every primary component to that), namespace re-exports (`export * as X`),
// ESM-style specifiers that name the .js file, and a capitalised constant the gate checks.
import { describe, expect, test } from "vitest";
import { chmodSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  exportedNames,
  declarationComponents,
  folderComponents,
  readComponentSource,
  canBeComponentName,
} from "../../src/readers/component-names.mjs";
import { gateSource } from "../../src/gate.mjs";

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), "u-names-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};

describe("exportedNames: one file", () => {
  test("reads inline declarations, the form tsc writes for each file", () => {
    const { names } = exportedNames(
      [
        "export declare const Button: ButtonComponent;",
        "export declare function Card(props: CardProps): JSX.Element;",
        "export declare class ToastQueue {}",
        "export declare enum TOAST_TYPE { SUCCESS = 0 }",
        "export declare namespace Menu { const Item: any; }",
      ].join("\n"),
      "index.d.ts"
    );
    expect(names).toEqual(["Button", "Card", "Menu", "TOAST_TYPE", "ToastQueue"]);
  });

  test("reads a namespace re-export as one name", () => {
    expect(exportedNames('export * as IconSet from "icon-lib";', "utils.d.ts").names).toEqual(["IconSet"]);
  });

  test("reads export lists, renamed and default-as entries included", () => {
    const { names } = exportedNames(
      'export { Root as Dialog, Title as DialogTitle } from "./dialog";\nexport { default as Logo } from "./logo";',
      "index.d.ts"
    );
    expect(names).toEqual(["Dialog", "DialogTitle", "Logo"]);
  });

  test("leaves out types: type-only exports, type-only entries, and a local interface listed by name", () => {
    const { names } = exportedNames(
      [
        "interface ButtonProps { size?: string }",
        "type Size = 'sm' | 'md';",
        "declare const Button: (p: ButtonProps) => JSX.Element;",
        "export type { CardProps } from './card';",
        "export { type BadgeProps, Badge } from './badge';",
        "export { Button, ButtonProps, Size };",
        "export interface Exported {}",
        "export type Alias = string;",
      ].join("\n"),
      "index.d.ts"
    );
    expect(names).toEqual(["Badge", "Button"]);
  });

  test("leaves out a default export: its import name is the importer's choice", () => {
    expect(exportedNames("export default function Page() { return null }", "page.tsx").names).toEqual([]);
  });

  test("reads component source as well as declarations", () => {
    const source = [
      'import * as React from "react"',
      "const Button = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => <button ref={ref} {...props} />)",
      "function Badge() { return <span /> }",
      "export interface ButtonProps {}",
      "export { Button, buttonVariants, Badge }",
    ].join("\n");
    expect(exportedNames(source, "button.tsx").names).toEqual(["Badge", "Button", "buttonVariants"]);
  });

  test("returns the wholesale re-exports for the caller to follow", () => {
    expect(exportedNames('export * from "./a";\nexport * from "./b.js";', "index.d.ts").stars).toEqual(["./a", "./b.js"]);
  });
});

describe("exportedNames: the export forms that are easy to miss", () => {
  test("export = of a namespace: its members are the names", () => {
    const read = exportedNames(
      "declare namespace Lib { const Button: any; function Card(): void; class Toast {} interface Props {} type Size = string }\nexport = Lib;",
      "index.d.ts"
    );
    expect(read.names).toEqual(["Button", "Card", "Toast"]);
    expect(read.unlisted).toEqual([]);
  });

  test("export = of anything else cannot be listed, and is said so rather than read as nothing", () => {
    const read = exportedNames("declare const lib: { Button: any };\nexport = lib;", "index.d.ts");
    expect(read.names).toEqual([]);
    expect(read.unlisted).toEqual(["export = lib"]);
  });

  test("export import A = B.C is a name", () => {
    expect(exportedNames("import Lib = require('lib');\nexport import Dialog = Lib.Dialog;\nimport Quiet = Lib.Quiet;", "index.d.ts").names).toEqual(["Dialog"]);
  });

  test("a destructured export names each binding, renamed and nested ones included", () => {
    expect(exportedNames("export const { A, B: C, inner: { D }, ...Rest } = obj;\nexport const [E, [F]] = list;", "index.ts").names).toEqual(["A", "C", "D", "E", "F", "Rest"]);
  });

  test("an imported type listed in an export is not a value, however it was imported", () => {
    const { names } = exportedNames(
      [
        'import type { Props } from "./p";',
        'import { type Other, Real } from "./o";',
        'import type Def from "./d";',
        'import type * as Everything from "./e";',
        "export { Props as PropsAlias, Other as OtherAlias, Real as RealAlias, Def as DefAlias, Everything as EverythingAlias };",
      ].join("\n"),
      "index.d.ts"
    );
    expect(names).toEqual(["RealAlias"]);
  });
});

describe("canBeComponentName agrees with the gate", () => {
  test("a capitalised constant is a name the gate checks, so the list can hold it", () => {
    expect(canBeComponentName("TOAST_TYPE")).toBe(true);
    expect(canBeComponentName("Button")).toBe(true);
    expect(canBeComponentName("useToast")).toBe(false);
  });

  // Every name the gate checks against the list is one the list can hold, and no other:
  // a name the reader could never collect would be flagged on correct code forever.
  test.each(["TOAST_TYPE", "Button", "X", "useToast", "cn", "buttonVariants"])("%s: the gate checks it exactly when the reader can list it", (name) => {
    const contract = {
      system: "@acme/ds",
      systemImports: ["@acme/ds"],
      catalog: [{ name: "Other" }],
      catalogComplete: true,
      tokens: {},
      intrinsics: {},
      foreignUi: [],
      exemptMarker: "token-exempt",
    };
    const flagged = gateSource(`import { ${name} } from "@acme/ds";\n`, {
      fileName: "a.tsx",
      contract,
      rules: ["no-unknown-components"],
    }).length > 0;
    expect(flagged).toBe(canBeComponentName(name));
  });
});

describe("declarationComponents: a package's entries", () => {
  test("follows export * through per-file declarations and collects inline components", () => {
    const root = tree({
      "dist/index.d.ts": 'export * from "./components/button";\nexport * from "./components/card";\n',
      "dist/components/button/index.d.ts":
        'export declare const Button: typeof ButtonRoot;\nexport { ButtonRoot } from "./button";\nexport type { ButtonProps } from "./button";\n',
      "dist/components/card/index.d.ts": "export declare function Card(): JSX.Element;\n",
    });
    expect(declarationComponents([join(root, "dist/index.d.ts")]).names).toEqual(["Button", "ButtonRoot", "Card"]);
  });

  test("follows ESM specifiers that name the JavaScript file, and .d.mts declarations", () => {
    const root = tree({
      "dist/index.d.ts": 'export * from "./button.js";\n',
      "dist/button.d.ts": "export declare const Button: any;\n",
      "esm/index.d.mts": 'export * from "./card.mjs";\n',
      "esm/card.d.mts": "export declare const Card: any;\n",
    });
    expect(declarationComponents([join(root, "dist/index.d.ts"), join(root, "esm/index.d.mts")]).names).toEqual(["Button", "Card"]);
  });

  test("joins several entries, and names only those that add a file as roots", () => {
    const root = tree({
      "dist/index.d.ts": 'export * from "./button";\n',
      "dist/button.d.ts": "export declare const Button: any;\n",
      "dist/utils.d.ts": 'export * as IconSet from "icon-lib";\n',
    });
    const read = declarationComponents([
      join(root, "dist/index.d.ts"),
      join(root, "dist/button.d.ts"),
      join(root, "dist/utils.d.ts"),
    ]);
    expect(read.names).toEqual(["Button", "IconSet"]);
    expect(read.roots).toEqual([join(root, "dist/index.d.ts"), join(root, "dist/utils.d.ts")]);
  });

  test("does not loop on a cycle", () => {
    const root = tree({
      "a.d.ts": 'export * from "./b";\nexport declare const A: any;\n',
      "b.d.ts": 'export * from "./a";\nexport declare const B: any;\n',
    });
    expect(declarationComponents([join(root, "a.d.ts")]).names).toEqual(["A", "B"]);
  });
});

describe("declarationComponents: a re-export it cannot follow is reported, never dropped", () => {
  test("a nested declaration that is not there: its names are guessed where the file name says, and the star is listed", () => {
    const root = tree({
      "dist/index.d.ts": 'export * from "./components";\n',
      "dist/components/index.d.ts": 'export * from "./Button";\nexport * from "./card";\nexport declare const Own: any;\n',
    });
    const read = declarationComponents([join(root, "dist/index.d.ts")]);
    expect(read.names).toEqual(["Button", "Own"]);
    expect(read.unfollowed).toEqual([
      { spec: "./Button", from: join(root, "dist/components/index.d.ts") },
      { spec: "./card", from: join(root, "dist/components/index.d.ts") },
    ]);
  });

  test("a package specifier cannot be followed", () => {
    const root = tree({ "index.d.ts": 'export * from "@acme/button";\nexport declare const Here: any;\n' });
    const read = declarationComponents([join(root, "index.d.ts")]);
    expect(read.names).toEqual(["Here"]);
    expect(read.unfollowed).toEqual([{ spec: "@acme/button", from: join(root, "index.d.ts") }]);
  });

  test("a TypeScript source is not a declaration, so it cannot be followed", () => {
    const root = tree({
      "index.d.ts": 'export * from "./button";\n',
      "button.tsx": "export const Button = () => null\n",
    });
    const read = declarationComponents([join(root, "index.d.ts")]);
    expect(read.unfollowed).toEqual([{ spec: "./button", from: join(root, "index.d.ts") }]);
  });

  test("a barrel that is read in full reports nothing", () => {
    const root = tree({ "index.d.ts": 'export * from "./a";\n', "a.d.ts": "export declare const A: any;\n" });
    const read = declarationComponents([join(root, "index.d.ts")]);
    expect(read.unfollowed).toEqual([]);
    expect(read.unlisted).toEqual([]);
  });

  test("an export form that cannot be listed is reported with the file it is in", () => {
    const root = tree({ "index.d.ts": 'export * from "./lib";\n', "lib.d.ts": "declare const lib: any;\nexport = lib;\n" });
    expect(declarationComponents([join(root, "index.d.ts")]).unlisted).toEqual([{ what: "export = lib", from: join(root, "lib.d.ts") }]);
  });
});

describe("declarationComponents: how deep a barrel goes", () => {
  const chain = (length, last) => {
    const files = {};
    for (let i = 0; i < length; i++) {
      files[`l${i}.d.ts`] = i === length - 1 ? last : `export * from "./l${i + 1}";\n`;
    }
    return tree(files);
  };

  test("a name three barrels down is found", () => {
    const root = chain(4, "export declare const Deep: any;\n");
    expect(declarationComponents([join(root, "l0.d.ts")]).names).toEqual(["Deep"]);
  });

  test("a very long chain is read to its end", () => {
    const root = chain(40, "export declare const Far: any;\n");
    expect(declarationComponents([join(root, "l0.d.ts")]).names).toEqual(["Far"]);
  });

  test("what is found does not depend on the order the barrels are met in", () => {
    // `index` reaches the same long chain by two routes, the long one first. A depth cap met on the
    // long route would mark the file at the cap as read, and skip it on the short route.
    const files = { "index.d.ts": 'export * from "./l0";\nexport * from "./l11";\n' };
    for (let i = 0; i < 14; i++) files[`l${i}.d.ts`] = i === 13 ? "export declare const End: any;\n" : `export * from "./l${i + 1}";\n`;
    const root = tree(files);
    expect(declarationComponents([join(root, "index.d.ts")]).names).toEqual(["End"]);
    const reversed = tree({ ...files, "index.d.ts": 'export * from "./l11";\nexport * from "./l0";\n' });
    expect(declarationComponents([join(reversed, "index.d.ts")]).names).toEqual(["End"]);
  });
});

describe("readComponentSource", () => {
  test("refuses a file that is neither a declaration nor a folder: a TypeScript barrel lists nothing it re-exports", () => {
    const root = tree({ "ui/index.ts": 'export * from "./button";\n', "ui/button.tsx": "export const Button = () => null\n" });
    expect(() => readComponentSource(join(root, "ui/index.ts"))).toThrow(/neither a type declaration file \(\.d\.ts, \.d\.mts, \.d\.cts\) nor a folder/);
  });

  test("reads a folder, and a declaration with what it could not follow", () => {
    const root = tree({ "ui/a.tsx": "export const A = () => null\n", "dts/index.d.ts": 'export * from "./gone";\n' });
    expect(readComponentSource(join(root, "ui"))).toEqual({ names: ["A"], types: [], unfollowed: [], unlisted: [] });
    expect(readComponentSource(join(root, "dts/index.d.ts")).unfollowed).toEqual([{ spec: "./gone", from: join(root, "dts/index.d.ts") }]);
  });
});

describe("folderComponents: a design system in a folder of the app", () => {
  test("reads every module in the folder, without an index", () => {
    const root = tree({
      "components/ui/button.tsx": "const Button = () => null\nconst buttonVariants = {}\nexport { Button, buttonVariants }\n",
      "components/ui/card.tsx": "export const Card = () => null\nexport const CardHeader = () => null\n",
      "components/ui/form/field.tsx": "export function Field() { return null }\n",
    });
    expect(folderComponents(join(root, "components/ui")).names).toEqual(["Button", "Card", "CardHeader", "Field"]);
  });

  test("leaves out tests, stories and declaration files", () => {
    const root = tree({
      "ui/button.tsx": "export const Button = () => null\n",
      "ui/button.test.tsx": "export const ButtonTest = () => null\n",
      "ui/button.stories.tsx": "export const Primary = () => null\n",
      "ui/env.d.ts": "export declare const Ambient: any\n",
    });
    expect(folderComponents(join(root, "ui")).names).toEqual(["Button"]);
  });

  test("leaves out the helpers that sit beside tests and stories", () => {
    const root = tree({
      "ui/button.tsx": "export const Button = () => null\n",
      "ui/__tests__/helpers.tsx": "export const Wrapper = () => null\n",
      "ui/__mocks__/mock.tsx": "export const MockButton = () => null\n",
      "ui/__stories__/shell.tsx": "export const StoryShell = () => null\n",
      "ui/button.story.tsx": "export const Demo = () => null\n",
    });
    expect(folderComponents(join(root, "ui")).names).toEqual(["Button"]);
  });
});

describe("folderComponents: what it could not read is reported, never dropped", () => {
  const folder = (extra = {}) =>
    tree({
      "components/ui/button.tsx": "export const Button = () => null\n",
      "components/ui/form/index.ts": 'export * from "./field";\n',
      "components/ui/form/field.tsx": "export const Field = () => null\n",
      "components/shared/toast.tsx": "export const Toast = () => null\n",
      ...extra,
    });
  const read = (root) => folderComponents(join(root, "components/ui"));

  test("a relative star to a source file in the folder is covered: nothing is left unread", () => {
    const root = folder({
      "components/ui/index.ts": 'export * from "./button";\nexport * from "./form";\nexport * from "./form/field.js";\nexport * from "./button.tsx";\n',
    });
    const r = read(root);
    expect(r.names).toEqual(["Button", "Field"]);
    expect(r.unfollowed).toEqual([]);
    expect(r.unlisted).toEqual([]);
  });

  test("a bare specifier, a star that leaves the folder and one that does not resolve are not followed", () => {
    const root = folder({
      "components/ui/index.ts": 'export * from "./button";\nexport * from "@radix-ui/react-slot";\nexport * from "../shared/toast";\nexport * from "./gone";\nexport * from "button";\n',
    });
    const r = read(root);
    const from = join(root, "components/ui/index.ts");
    expect(r.names).toEqual(["Button", "Field"]);
    expect(r.unfollowed).toEqual([
      { spec: "@radix-ui/react-slot", from },
      { spec: "../shared/toast", from },
      { spec: "./gone", from },
      // a package that is called button is not the file button.tsx beside it
      { spec: "button", from },
    ]);
  });

  test("a star to a test or a story, which the folder does not read, is not covered either", () => {
    const root = folder({
      "components/ui/index.ts": 'export * from "./button.test";\n',
      "components/ui/button.test.tsx": "export const Helper = () => null\n",
    });
    expect(read(root).unfollowed).toEqual([{ spec: "./button.test", from: join(root, "components/ui/index.ts") }]);
  });

  test("a symlinked folder is not read, and is said so: a glob skips it without a word", () => {
    const root = folder({ "elsewhere/card.tsx": "export const Card = () => null\n" });
    symlinkSync(join(root, "elsewhere"), join(root, "components/ui/linked"));
    symlinkSync(join(root, "elsewhere"), join(root, "components/ui/form/deep-link"));
    const r = read(root);
    expect(r.names).toEqual(["Button", "Field"]);
    expect(r.unfollowed).toEqual([
      { spec: "form/deep-link", from: join(root, "components/ui"), kind: "symlink" },
      { spec: "linked", from: join(root, "components/ui"), kind: "symlink" },
    ]);
  });

  test("an export form that cannot be listed is gathered", () => {
    const root = folder({ "components/ui/lib.d.ts.tsx": "declare const lib: any;\nexport = lib;\n" });
    expect(read(root).unlisted).toEqual([{ what: "export = lib", from: join(root, "components/ui/lib.d.ts.tsx") }]);
  });

  test("a node_modules inside the folder is not walked for links", () => {
    const root = folder({ "elsewhere/x.tsx": "export const X = () => null\n" });
    mkdirSync(join(root, "components/ui/node_modules"), { recursive: true });
    symlinkSync(join(root, "elsewhere"), join(root, "components/ui/node_modules/pkg"));
    expect(read(root).unfollowed).toEqual([]);
  });

  test("readComponentSource passes all three through", () => {
    const root = folder({ "components/ui/index.ts": 'export * from "@radix-ui/react-slot";\n' });
    const r = readComponentSource(join(root, "components/ui"));
    expect(Object.keys(r).sort()).toEqual(["names", "types", "unfollowed", "unlisted"]);
    expect(r.unfollowed.map((x) => x.spec)).toEqual(["@radix-ui/react-slot"]);
  });
});

describe("exportedNames: an export = namespace", () => {
  test("export import inside it is a member", () => {
    const read = exportedNames("declare namespace Lib { export import Q = Other.Y; const Button: any; import Quiet = Other.Z; }\nexport = Lib;", "index.d.ts");
    expect(read.names).toEqual(["Button", "Q"]);
  });
});

test("declarationComponents says which files it read, the ones reached by a relative re-export included", () => {
  const root = mkdtempSync(join(tmpdir(), "u-names-"));
  writeFileSync(join(root, "index.d.ts"), 'export * from "./a";\n');
  writeFileSync(join(root, "a.d.ts"), "export declare const A: any;\n");
  writeFileSync(join(root, "b.d.ts"), "export declare const B: any;\n");
  const read = declarationComponents([join(root, "index.d.ts")]);
  expect(read.files.sort()).toEqual([join(root, "a.d.ts"), join(root, "index.d.ts")]);
  expect(read.roots).toEqual([join(root, "index.d.ts")]);
});

// Types are exported by name and imported by name, and an import without `type` of a type is correct code.
// They are listed apart from the components, so that the gate can tell a type from a component that is not there.
describe("exported types", () => {
  test("every form that exports a type or an interface is listed apart from the values", () => {
    const read = exportedNames(
      [
        "export interface ButtonProps {}",
        "export type ChartConfig = Record<string, string>;",
        "export type { CardProps } from './card';",
        "export { type BadgeProps, Badge } from './badge';",
        "interface Local {}",
        "type LocalAlias = string;",
        "export { Local, LocalAlias };",
        "interface Hidden {}",
        "export const Chart = () => null;",
      ].join("\n"),
      "chart.tsx"
    );
    expect(read.names).toEqual(["Badge", "Chart"]);
    expect(read.types).toEqual(["BadgeProps", "ButtonProps", "CardProps", "ChartConfig", "Local", "LocalAlias"]);
  });

  test("a default export, and a type that is not exported, are not listed", () => {
    expect(exportedNames("export default interface Page {}\ninterface Quiet {}", "p.ts").types).toEqual([]);
  });

  test("export type * is a type-only star: not a value star, so what is behind it is never a component", () => {
    const read = exportedNames('export type * from "./types";\nexport * from "./values";', "index.d.ts");
    expect(read.stars).toEqual(["./values"]);
    expect(read.typeStars).toEqual(["./types"]);
  });

  test("a type-only star is followed into types only, however far it goes, and values behind it are not components", () => {
    const root = mkdtempSync(join(tmpdir(), "u-typestar-"));
    writeFileSync(join(root, "index.d.ts"), 'export type * from "./types";\nexport declare const Real: any;\n');
    writeFileSync(join(root, "types.d.ts"), 'export interface Props {}\nexport declare const Thing: any;\nexport * from "./more";\n');
    writeFileSync(join(root, "more.d.ts"), "export type Deep = string;\nexport declare const Further: any;\n");
    const read = declarationComponents([join(root, "index.d.ts")]);
    expect(read.names).toEqual(["Real"]);
    expect(read.types).toEqual(["Deep", "Further", "Props", "Thing"]);
    expect(read.unfollowed).toEqual([]);
  });

  test("a type-only star that cannot be followed does not make the list partial", () => {
    const root = mkdtempSync(join(tmpdir(), "u-typestar-"));
    writeFileSync(join(root, "index.d.ts"), 'export type * from "some-package";\nexport type * from "./gone";\nexport declare const Real: any;\n');
    const read = declarationComponents([join(root, "index.d.ts")]);
    expect(read.names).toEqual(["Real"]);
    expect(read.unfollowed).toEqual([]);
    expect(read.unlisted).toEqual([]);
  });

  test("a file reached as types and then as values is read as values too, whichever route is read first", () => {
    const root = mkdtempSync(join(tmpdir(), "u-typestar-"));
    writeFileSync(join(root, "index.d.ts"), 'export * from "./a";\nexport * from "./b";\n');
    writeFileSync(join(root, "a.d.ts"), 'export * from "./shared";\n');
    writeFileSync(join(root, "b.d.ts"), 'export type * from "./shared";\n');
    writeFileSync(join(root, "shared.d.ts"), "export declare const Both: any;\n");
    expect(declarationComponents([join(root, "index.d.ts")]).names).toEqual(["Both"]);
    writeFileSync(join(root, "index.d.ts"), 'export * from "./b";\nexport * from "./a";\n');
    expect(declarationComponents([join(root, "index.d.ts")]).names).toEqual(["Both"]);
  });

  test.skipIf(process.getuid?.() === 0)("a type-only file that cannot be opened does not make the list partial", () => {
    const root = mkdtempSync(join(tmpdir(), "u-typestar-"));
    writeFileSync(join(root, "index.d.ts"), 'export type * from "./types";\nexport declare const Real: any;\n');
    writeFileSync(join(root, "types.d.ts"), "export interface P {}\n");
    chmodSync(join(root, "types.d.ts"), 0o000);
    try {
      expect(declarationComponents([join(root, "index.d.ts")]).unfollowed).toEqual([]);
    } finally {
      chmodSync(join(root, "types.d.ts"), 0o644);
    }
  });

  test("a declaration entry and a folder both collect the types of every file they read", () => {
    const root = mkdtempSync(join(tmpdir(), "u-types-"));
    mkdirSync(join(root, "ui"), { recursive: true });
    writeFileSync(join(root, "ui/chart.tsx"), "export type ChartConfig = {};\nexport const ChartContainer = () => null;\n");
    writeFileSync(join(root, "ui/card.tsx"), "export interface CardProps {}\nexport const Card = () => null;\n");
    writeFileSync(join(root, "index.d.ts"), 'export * from "./more";\nexport interface Own {}\n');
    writeFileSync(join(root, "more.d.ts"), "export type Deep = string;\nexport declare const More: any;\n");
    expect(folderComponents(join(root, "ui")).types).toEqual(["CardProps", "ChartConfig"]);
    expect(declarationComponents([join(root, "index.d.ts")]).types).toEqual(["Deep", "Own"]);
    expect(readComponentSource(join(root, "ui")).types).toEqual(["CardProps", "ChartConfig"]);
    expect(readComponentSource(join(root, "index.d.ts")).types).toEqual(["Deep", "Own"]);
  });
});

describe("CommonJS exports are not listed, and are said so", () => {
  test.each([
    ["module.exports = { A }", ["module.exports"]],
    ["module.exports.B = B", ["module.exports.B"]],
    ["exports.C = C", ["exports.C"]],
    ['exports["D"] = D', ['exports["D"]']],
    ["Object.defineProperty(exports, \"E\", { get: () => E });", ["Object.defineProperty(exports, ...)"]],
    ["Object.defineProperty(module.exports, \"F\", { value: F });", ["Object.defineProperty(module.exports, ...)"]],
    ["__export(button_exports, { Rating: () => Rating });", ["__export(...)"]],
    ["Object.defineProperty(other, \"G\", { value: 1 });\nObject.keys(exports);\nconsole.log(__export);", []],
    ["foo.exports = 1;\nobj.exports.x = 2;\nlet exportsList = 3;", []],
  ])("%s", (source, unlisted) => {
    expect(exportedNames(source, "legacy.js").unlisted).toEqual(unlisted);
  });

  test("the same one twice is said once", () => {
    expect(exportedNames("module.exports = a;\nmodule.exports = b;", "legacy.js").unlisted).toEqual(["module.exports"]);
    expect(exportedNames("__export(a, {});\n__export(b, {});", "legacy.js").unlisted).toEqual(["__export(...)"]);
  });
});

describe("folderComponents: files a glob does not give", () => {
  const folderWith = (files) => {
    const root = mkdtempSync(join(tmpdir(), "u-links-"));
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    return root;
  };

  test("a link to a script file is read, in the folder or from outside it", () => {
    const root = folderWith({ "ui/a.tsx": "export const A = () => null;\n", "shared/b.tsx": "export const B = () => null;\n" });
    symlinkSync(join(root, "shared/b.tsx"), join(root, "ui/b.tsx"));
    expect(folderComponents(join(root, "ui"))).toEqual({ names: ["A", "B"], types: [], unfollowed: [], unlisted: [] });
  });

  test("a link to a test, a story, a declaration, a stylesheet or nothing is not a component file", () => {
    const root = folderWith({
      "ui/a.tsx": "export const A = () => null;\n",
      "other/x.test.tsx": "export const T = 1;\n",
      "other/x.stories.tsx": "export const S = 1;\n",
      "other/x.d.ts": "export declare const D: any;\n",
      "other/x.css": ".x {}",
    });
    for (const [name, target] of [["x.test.tsx", "other/x.test.tsx"], ["x.stories.tsx", "other/x.stories.tsx"], ["x.d.ts", "other/x.d.ts"], ["x.css", "other/x.css"], ["gone.tsx", "other/gone.tsx"]]) {
      symlinkSync(join(root, target), join(root, "ui", name));
    }
    expect(folderComponents(join(root, "ui")).names).toEqual(["A"]);
    expect(folderComponents(join(root, "ui")).unfollowed).toEqual([]);
  });

  test("a file that cannot be opened is reported with its path and why, and the others are still read", () => {
    const root = folderWith({ "ui/a.tsx": "export const A = () => null;\n", "ui/b.tsx": "export const B = () => null;\n" });
    chmodSync(join(root, "ui/b.tsx"), 0o000);
    try {
      if (process.getuid?.() === 0) return;
      const read = folderComponents(join(root, "ui"));
      expect(read.names).toEqual(["A"]);
      expect(read.unfollowed).toEqual([{ spec: "b.tsx", from: join(root, "ui"), kind: "unreadable", reason: "permission denied" }]);
    } finally {
      chmodSync(join(root, "ui/b.tsx"), 0o644);
    }
  });
});

describe("what cannot be opened is reported, and the rest is read", () => {
  const skip = process.getuid?.() === 0;
  const make = (files) => {
    const root = mkdtempSync(join(tmpdir(), "u-denied-"));
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    return root;
  };

  test.skipIf(skip)("a subfolder of a folder that cannot be opened", () => {
    const root = make({ "ui/a.tsx": "export const A = () => null;\n", "ui/private/b.tsx": "export const B = () => null;\n" });
    chmodSync(join(root, "ui/private"), 0o000);
    try {
      const read = folderComponents(join(root, "ui"));
      expect(read.names).toEqual(["A"]);
      expect(read.unfollowed).toEqual([{ spec: "private", from: join(root, "ui"), kind: "unreadable", reason: "permission denied" }]);
    } finally {
      chmodSync(join(root, "ui/private"), 0o755);
    }
  });

  test.skipIf(skip)("a declaration that cannot be opened, among others", () => {
    const root = make({ "a.d.ts": 'export * from "./b";\nexport declare const A: any;\n', "b.d.ts": "export declare const B: any;\n" });
    chmodSync(join(root, "b.d.ts"), 0o000);
    try {
      const read = declarationComponents([join(root, "a.d.ts")]);
      expect(read.names).toContain("A");
      expect(read.unfollowed).toEqual([{ spec: join(root, "b.d.ts"), from: join(root, "b.d.ts"), kind: "unreadable", reason: "permission denied" }]);
    } finally {
      chmodSync(join(root, "b.d.ts"), 0o644);
    }
  });
});
