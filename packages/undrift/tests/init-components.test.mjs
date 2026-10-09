// `undrift init --components <folder>`: a design system that lives in a folder of the app, as
// shadcn's components/ui does. The folder is read for its exports by a reader written for this
// (no assessment code), the import alias that leads to it is taken from the app's tsconfig, and
// the folder is the design system's own profile, never the app's.
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit, aliasesFor } from "../src/init.mjs";
import { loadContract } from "../src/contract.mjs";
import { gateSource } from "../src/gate.mjs";
import { rulesNotRun } from "../src/unchecked.mjs";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { app, cli, IN_APP_FOLDER, FOLDER_STAR, FOLDER_PACKAGE } from "./support/init-repos.mjs";
import { realpathSync } from "node:fs";

const config = (root) => JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8"));
const unknown = (root, source) =>
  gateSource(source, { fileName: "a.tsx", contract: loadContract(root), rules: ["no-unknown-components"] }).map((v) => v.found);

describe("the config it writes", () => {
  test("the folder's components, the alias to it, the app's tokens", () => {
    const root = app(IN_APP_FOLDER);
    runInit(root, null, { components: "components/ui" });
    const c = config(root);
    expect(c.system).toBe("@/components/ui");
    expect(c.systemImports).toEqual(["@/components/ui"]);
    expect(c.componentsFrom).toBe("components/ui");
    expect(c.tokensCss).toBe("app/globals.css");
    expect(c.intrinsics).toMatchObject({ button: "Button", input: "Input" });
    expect(loadContract(root).catalog.map((e) => e.name)).toEqual(["Button", "Card", "CardHeader", "Input"]);
  });

  test("the folder is the design system's own profile, and the app's profile leaves it out", () => {
    const root = app(IN_APP_FOLDER);
    runInit(root, null, { components: "components/ui" });
    const { profiles } = config(root);
    expect(profiles.app.include).toContain("!components/ui/**");
    expect(profiles["design-system"]).toEqual({
      include: ["components/ui/**/*.{ts,tsx,jsx}", "!**/undrift-missing.*", "!**/*.{test,spec,stories}.*", "!**/node_modules/**"],
      rules: ["no-raw-colors", "no-arbitrary-values", "no-foreign-ui-imports"],
    });
  });

  test("the app's correct imports pass, and a component the folder does not have is flagged", () => {
    const root = app(IN_APP_FOLDER);
    runInit(root, null, { components: "components/ui" });
    expect(unknown(root, readFileSync(join(root, "app/page.tsx"), "utf8"))).toEqual([]);
    expect(unknown(root, 'import { Rating } from "@/components/ui/rating";\n')).toEqual(["Rating"]);
  });

  test("a folder read in part is refused, named, and forced it is incomplete, so nothing is flagged", () => {
    const root = app(FOLDER_STAR);
    symlinkSync(join(root, "elsewhere"), join(root, "components/ui/linked"));
    const result = runInit(root, null, { components: "components/ui" });
    expect(result.refused).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.problems[0].what).toBe(
      'components/ui\'s component list is not complete: it re-exports "@radix-ui/react-slot" (in components/ui/index.ts), "../shared/toast" (in components/ui/index.ts), which could not be followed and it holds a symlinked folder "linked", which was not read.'
    );
    // A relative path that leaves the folder cannot be listed, so the advice is to move it in, not to list it.
    expect(result.problems[0].fix).toMatch(/^Move what "\.\.\/shared\/toast" holds into components\/ui: a relative path that leaves the folder cannot be listed\./);
    expect(result.problems[0].fix).not.toMatch(/Add the folder/);
    expect(existsSync(join(root, "undrift.config.json"))).toBe(false);
    runInit(root, null, { components: "components/ui", force: true });
    const contract = loadContract(root);
    expect(contract.catalogComplete).toBe(false);
    expect(rulesNotRun(contract, ["no-unknown-components"])[0].reason).toMatch(/^The component list is incomplete/);
    expect(unknown(root, 'import { Button, Slot, Toast } from "@/components/ui";\nimport { Card } from "@/components/ui/linked/card";\n')).toEqual([]);
  });

  test("a whole-repository gate covers every UI file, the folder by its own profile", () => {
    const root = app(IN_APP_FOLDER);
    runInit(root, null, { components: "components/ui" });
    const gate = JSON.parse(cli(root, ["gate", "--format", "json"]).out);
    expect(gate.notChecked.filter((item) => item.kind === "files")).toEqual([]);
    expect(gate.runs.map((r) => r.name).sort()).toEqual(["app", "design-system"]);
  });
});

describe("the advice for a folder read in part says what to do for what it found", () => {
  const fixFor = (files, prepare) => {
    const root = app(files);
    prepare?.(root);
    return runInit(root, null, { components: "components/ui" }).problems[0].fix;
  };

  test("a package that is not installed: install or build it", () => {
    const fix = fixFor({ ...IN_APP_FOLDER, "components/ui/index.ts": 'export * from "@acme/gone";\n' });
    expect(fix).toBe('Install or build "@acme/gone", so that its declarations can be found. Then run undrift init again.');
  });

  test("a symlinked folder: point at the real folder", () => {
    const fix = fixFor({ ...IN_APP_FOLDER, "elsewhere/card.tsx": "export const Card = () => null;\n" }, (root) => symlinkSync(join(root, "elsewhere"), join(root, "components/ui/linked")));
    expect(fix).toBe('Replace the symlinked folder "linked" with the folder itself. Then run undrift init again.');
  });

  test("an export form that cannot be listed: write it as an ES export", () => {
    const fix = fixFor({ ...IN_APP_FOLDER, "components/ui/legacy.js": "module.exports = { Rating: 1 };\n" });
    expect(fix).toBe("Write what it exports as ES exports (export const, export { }) so that the names can be listed. Then run undrift init again.");
  });

  test.skipIf(process.getuid?.() === 0)("a file that cannot be opened: make it readable", () => {
    const root = app(IN_APP_FOLDER);
    const file = join(root, "components/ui/secret.tsx");
    writeFileSync(file, "export const Secret = () => null;\n");
    chmodSync(file, 0o000);
    try {
      expect(runInit(root, null, { components: "components/ui" }).problems[0].fix).toBe('Make "secret.tsx" readable. Then run undrift init again.');
    } finally {
      chmodSync(file, 0o644);
    }
  });

  test("more than three of one kind are cut, with the count of the rest", () => {
    const stars = ["a", "b", "c", "d"].map((n) => `export * from "@acme/${n}";`).join("\n");
    const fix = fixFor({ ...IN_APP_FOLDER, "components/ui/index.ts": `${stars}\n` });
    expect(fix).toBe('Install or build "@acme/a", "@acme/b", "@acme/c" and 1 more, so that its declarations can be found. Then run undrift init again.');
  });

  test("several at once are said together, a relative path first", () => {
    const fix = fixFor({ ...IN_APP_FOLDER, "components/ui/index.ts": 'export * from "@acme/gone";\nexport * from "../x";\n' });
    expect(fix).toBe(
      'Move what "../x" holds into components/ui: a relative path that leaves the folder cannot be listed. Install or build "@acme/gone", so that its declarations can be found. Then run undrift init again.'
    );
  });
});

describe("a folder that re-exports packages", () => {
  test("an installed package, and a subpath of one, are found as Node finds them and listed beside the folder", () => {
    const root = app(FOLDER_PACKAGE);
    const result = runInit(root, null, { components: "components/ui" });
    expect(result.refused).toBe(false);
    expect(result.partial).toBe(false);
    expect(config(root).componentsFrom).toEqual([
      "components/ui",
      "node_modules/@acme/slot/dist/index.d.ts",
      "node_modules/@acme/menu/item.d.ts",
    ]);
    expect(loadContract(root).catalogComplete).toBe(true);
    expect(unknown(root, 'import { Button, Slot, MenuItem } from "@/components/ui";\n')).toEqual([]);
    expect(unknown(root, 'import { Rating } from "@/components/ui";\n')).toEqual(["Rating"]);
  });

  test("a package that is not installed is named, as the gate would name it", () => {
    const files = { ...FOLDER_PACKAGE };
    delete files["node_modules/@acme/slot/package.json"];
    delete files["node_modules/@acme/slot/dist/index.d.ts"];
    const root = app(files);
    const result = runInit(root, null, { components: "components/ui" });
    expect(result.refused).toBe(true);
    expect(result.problems[0].what).toContain('it re-exports "@acme/slot" (in components/ui/index.ts)');
  });

  test("a symlinked folder is never covered by a package that is named like it", () => {
    const root = app({
      ...IN_APP_FOLDER,
      "elsewhere/card.tsx": "export const Card = () => null;\n",
      "node_modules/linked/package.json": { name: "linked", types: "./index.d.ts" },
      "node_modules/linked/index.d.ts": "export declare const Other: any;\n",
      "undrift.config.json": { system: "@/components/ui", componentsFrom: ["components/ui", "node_modules/linked/index.d.ts"], profiles: { app: { include: "app/**/*.tsx" } } },
    });
    symlinkSync(join(root, "elsewhere"), join(root, "components/ui/linked"));
    const contract = loadContract(root);
    expect(contract.catalogComplete).toBe(false);
    expect(contract.unreadableSources[0].reason).toContain('it holds a symlinked folder "linked", which was not read');
  });
});

describe("a folder that cannot be read in full is never called complete", () => {
  test("a symlinked file is read, and what it exports is known", () => {
    const root = app({ ...IN_APP_FOLDER, "shared/rating.tsx": "export const Rating = () => null;\n" });
    symlinkSync(join(root, "shared/rating.tsx"), join(root, "components/ui/rating.tsx"));
    const result = runInit(root, null, { components: "components/ui" });
    expect(result.refused).toBe(false);
    expect(result.components).toContain("Rating");
    expect(loadContract(root).catalogComplete).toBe(true);
    expect(unknown(root, 'import { Rating } from "@/components/ui/rating";\n')).toEqual([]);
  });

  test("a symlinked file that points outside the repository is read too", () => {
    const outside = mkdtempSync(join(tmpdir(), "u-outside-"));
    writeFileSync(join(outside, "rating.tsx"), "export const Rating = () => null;\n");
    const root = app(IN_APP_FOLDER);
    symlinkSync(join(outside, "rating.tsx"), join(root, "components/ui/rating.tsx"));
    expect(runInit(root, null, { components: "components/ui" }).components).toContain("Rating");
  });

  test("a link to nothing is not a component file, and does not stop init", () => {
    const root = app(IN_APP_FOLDER);
    symlinkSync(join(root, "gone.tsx"), join(root, "components/ui/gone.tsx"));
    const result = runInit(root, null, { components: "components/ui" });
    expect(result.refused).toBe(false);
    expect(loadContract(root).catalogComplete).toBe(true);
  });

  test("module.exports names nothing the reader can list: said, refused, and the gate agrees", () => {
    const root = app({ ...IN_APP_FOLDER, "components/ui/legacy.js": "module.exports = { Rating: () => null };\n", "components/ui/other.js": "exports.Badge = () => null;\n" });
    const result = runInit(root, null, { components: "components/ui" });
    expect(result.refused).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.problems[0].what).toContain("its `module.exports` (in components/ui/legacy.js) does not name the components it holds");
    expect(result.problems[0].what).toContain("its `exports.Badge` (in components/ui/other.js)");
    runInit(root, null, { components: "components/ui", force: true });
    expect(loadContract(root).catalogComplete).toBe(false);
    expect(unknown(root, 'import { Rating } from "@/components/ui/legacy";\n')).toEqual([]);
  });

  test("esbuild's __export and Object.defineProperty(exports, ...) are unlisted too, with the same sentence", () => {
    const root = app({
      ...IN_APP_FOLDER,
      "components/ui/built.js": 'var __defProp = Object.defineProperty;\nvar built_exports = {};\n__export(built_exports, { Rating: () => Rating });\nmodule.exports = built_exports;\n',
      "components/ui/define.js": 'Object.defineProperty(exports, "Badge", { enumerable: true, get: () => Badge });\n',
    });
    const result = runInit(root, null, { components: "components/ui" });
    expect(result.refused).toBe(true);
    const what = result.problems[0].what;
    expect(what).toContain("its `__export(...)` (in components/ui/built.js) does not name the components it holds");
    expect(what).toContain("its `Object.defineProperty(exports, ...)` (in components/ui/define.js) does not name the components it holds");
    expect(result.problems[0].fix).toContain("Write what it exports as ES exports");
    runInit(root, null, { components: "components/ui", force: true });
    expect(loadContract(root).catalogComplete).toBe(false);
  });

  const asRoot = process.getuid?.() === 0;
  test.skipIf(asRoot)("a file that cannot be opened is said in a sentence, with its name, and the list is not complete", () => {
    const root = app(IN_APP_FOLDER);
    const file = join(root, "components/ui/secret.tsx");
    writeFileSync(file, "export const Secret = () => null;\n");
    chmodSync(file, 0o000);
    try {
      const result = runInit(root, null, { components: "components/ui" });
      expect(result.refused).toBe(true);
      expect(result.partial).toBe(true);
      expect(result.problems[0].what).toBe('components/ui\'s component list is not complete: it could not open "secret.tsx" (permission denied).');
      runInit(root, null, { components: "components/ui", force: true });
      expect(loadContract(root).catalogComplete).toBe(false);
      expect(loadContract(root).unreadableSources[0].reason).toContain('could not open "secret.tsx" (permission denied)');
    } finally {
      chmodSync(file, 0o644);
    }
  });
});

describe("the app profile's include", () => {
  test("a folder outside the defaults whose file imports the component folder by a relative path is covered", () => {
    const root = app({ ...IN_APP_FOLDER, "lib/panel.tsx": 'import { Button } from "../components/ui/button";\nexport const P = Button;\n', "lib/plain.ts": "export const x = 1;\n" });
    const result = runInit(root, null, { components: "components/ui" });
    expect(result.includeAdded).toEqual(["lib"]);
    expect(config(root).profiles.app.include).toContain("lib/**/*.{ts,tsx,jsx}");
  });

  test("the component folder's own top-level folder is not added to the app profile because of its own files", () => {
    const root = app({
      "package.json": { name: "product" },
      "tsconfig.json": '{ "compilerOptions": { "paths": { "@ui/*": ["./ui/*"] } } }\n',
      "app/globals.css": ":root { --a: 1px; }\n",
      "ui/button.tsx": 'import { Card } from "./card";\nexport const Button = () => <Card />;\n',
      "ui/card.tsx": "export const Card = () => null;\n",
    });
    const result = runInit(root, null, { components: "ui" });
    expect(result.includeAdded).toEqual([]);
    expect(config(root).profiles.app.include).toContain("!ui/**");
  });
});

describe("the alias", () => {
  test("from tsconfig.app.json, with comments, mapping @/* to src/*", () => {
    const root = app({
      "tsconfig.json": '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }\n',
      "tsconfig.app.json": '{\n  "compilerOptions": {\n    /* shadcn adds this */\n    "baseUrl": ".",\n    "paths": { "@/*": ["./src/*"] },\n  },\n}\n',
      "src/components/ui/button.tsx": "export const Button = () => null;\n",
    });
    expect(aliasesFor(root, "src/components/ui")).toEqual(["@/components/ui"]);
  });

  test("none: said as a warning, and the gate reports the component rule as not run", () => {
    const root = app({ ...IN_APP_FOLDER, "tsconfig.json": "{}\n" });
    const result = runInit(root, null, { components: "components/ui" });
    expect(result.warnings[0]).toMatch(/^No import alias leads to components\/ui/);
    expect(result.warnings[0]).toContain("if an app of a monorepo imports it by its package name, add that name");
    expect(config(root).systemImports).toEqual([]);
    const [r] = rulesNotRun(loadContract(root), ["no-unknown-components"]);
    expect(r.reason).toMatch(/No import is treated as the design system/);
  });
});

describe("the alias, in every form tsconfig can write it", () => {
  const withoutUndefined = (files) => Object.fromEntries(Object.entries(files).filter(([, v]) => v !== undefined));
  const aliases = (files, folder = "components/ui") => aliasesFor(app(withoutUndefined(files)), folder);
  const fixture = (paths, extra, name) => withoutUndefined({ ...IN_APP_FOLDER, "tsconfig.json": undefined, [name ?? "tsconfig.json"]: { compilerOptions: { baseUrl: ".", paths, ...extra } } });

  test("a pattern that maps straight onto the folder is the alias without its slash, beside one that does not", () => {
    const root = app(fixture({ "@/*": ["./*"], "@ui/*": ["./components/ui/*"] }));
    expect(aliasesFor(root, "components/ui")).toEqual(["@/components/ui", "@ui"]);
    runInit(root, null, { components: "components/ui" });
    expect(config(root).systemImports).toEqual(["@/components/ui", "@ui"]);
    expect(unknown(root, 'import { Button } from "@ui/button";\n')).toEqual([]);
    expect(unknown(root, 'import { Rating } from "@ui/rating";\n')).toEqual(["Rating"]);
  });

  test("a pattern with no prefix before the star cannot name the folder, and is skipped", () => {
    expect(aliases(fixture({ "*": ["./components/ui/*"] }))).toEqual([]);
  });

  test("a prefix that does not end in a slash is not a folder name", () => {
    expect(aliases(fixture({ "@ui-*": ["./components/ui/*"] }))).toEqual([]);
  });

  test("an exact alias for another file of the folder is not an alias for the folder", () => {
    expect(aliases(fixture({ "@btn": ["./components/ui/button.tsx"] }))).toEqual([]);
  });

  test("the same alias in two config files is one alias", () => {
    expect(aliases({ ...fixture({ ui: ["./components/ui"] }), "jsconfig.json": { compilerOptions: { paths: { ui: ["./components/ui"] } } } })).toEqual(["ui"]);
  });

  test("an exact alias for the folder is found", () => {
    expect(aliases(fixture({ ui: ["./components/ui"], other: ["./lib"] }))).toEqual(["ui"]);
  });

  test("an exact alias for the folder's index file is found too", () => {
    const root = app({ ...fixture({ "@ui": ["./components/ui/index.ts"] }), "components/ui/index.ts": 'export * from "./button";\n' });
    expect(aliasesFor(root, "components/ui")).toEqual(["@ui"]);
  });

  test("jsconfig.json is read, and tsconfig.app.json beside tsconfig.json", () => {
    expect(aliases(fixture({ "@/*": ["./*"] }, undefined, "jsconfig.json"))).toEqual(["@/components/ui"]);
    expect(aliases({ ...fixture({}, undefined), "tsconfig.app.json": { compilerOptions: { baseUrl: ".", paths: { "~/*": ["./*"] } } } })).toEqual(["~/components/ui"]);
  });

  test("baseUrl moves what a target is relative to", () => {
    const files = { ...fixture({ "@/*": ["./*"] }, { baseUrl: "src" }), "src/components/ui/button.tsx": "export const Button = () => null;\n" };
    delete files["components/ui/button.tsx"];
    expect(aliasesFor(app(files), "src/components/ui")).toEqual(["@/components/ui"]);
  });

  test("a pattern or a target with something after its star is not a folder alias", () => {
    expect(aliases(fixture({ "@/*.js": ["./*.js"], "@a/*": ["./*.ts"] }))).toEqual([]);
  });

  test("a target that is an array of several is each tried", () => {
    expect(aliases(fixture({ "@/*": ["./lib/*", "./*"] }))).toEqual(["@/components/ui"]);
  });
});

describe("the folder argument", () => {
  test("a link to the folder is the folder: the real path decides the exclusion, the alias and the profile", () => {
    const root = app(IN_APP_FOLDER);
    symlinkSync(join(root, "components/ui"), join(root, "ui-link"));
    runInit(root, null, { components: "ui-link" });
    const c = config(root);
    expect(c.systemImports).toEqual(["@/components/ui"]);
    expect(c.componentsFrom).toBe("components/ui");
    expect(c.profiles.app.include).toContain("!components/ui/**");
    expect(c.profiles["design-system"].include[0]).toBe("components/ui/**/*.{ts,tsx,jsx}");
  });

  test("a link to a folder outside the repository is refused, with where it leads", () => {
    const outside = mkdtempSync(join(tmpdir(), "u-outside-"));
    writeFileSync(join(outside, "x.tsx"), "export const X = () => null;\n");
    const root = app(IN_APP_FOLDER);
    symlinkSync(outside, join(root, "ui-out"));
    expect(() => runInit(root, null, { components: "ui-out" })).toThrow(/needs a folder inside .*, such as components\/ui\. ui-out leads to /);
  });

  test("an absolute path by way of a link to the repository is the same folder", () => {
    const root = app(IN_APP_FOLDER);
    const viaLink = join(mkdtempSync(join(tmpdir(), "u-via-")), "repo");
    symlinkSync(realpathSync(root), viaLink);
    runInit(realpathSync(root), null, { components: join(viaLink, "components/ui") });
    expect(config(root).componentsFrom).toBe("components/ui");
  });

  test("a file is not a folder", () => {
    expect(() => runInit(app(IN_APP_FOLDER), null, { components: "components/ui/button.tsx" })).toThrow(/components\/ui\/button\.tsx is not a folder/);
  });
});

describe("a folder name that a glob reads as syntax", () => {
  test("the folder is the design system's profile, and the app's profile leaves it out", () => {
    const files = Object.fromEntries(Object.entries(IN_APP_FOLDER).map(([k, v]) => [k.replace("components/ui/", "components/(ui)/"), v]));
    files["app/page.tsx"] = files["app/page.tsx"].replaceAll("components/ui", "components/(ui)");
    files["tsconfig.json"] = JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } });
    files["components/(ui)/loose.tsx"] = 'export const Loose = () => <button style={{ color: "#ff0000" }}>x</button>;\n';
    const root = app(files);
    runInit(root, null, { components: "components/(ui)" });
    const c = config(root);
    expect(c.profiles.app.include).toContain("!components/\\(ui\\)/**");
    expect(c.profiles["design-system"].include[0]).toBe("components/\\(ui\\)/**/*.{ts,tsx,jsx}");
    const gate = JSON.parse(cli(root, ["gate", "--format", "json"]).out);
    const found = gate.runs.flatMap((r) => r.violations.map((v) => `${r.name}:${v.rule}`));
    expect(found).toContain("design-system:no-raw-colors");
    expect(found.filter((f) => f.startsWith("app:") && /loose|button/.test(f))).toEqual([]);
    expect(found).not.toContain("app:no-raw-elements");
  });
});

describe("a folder that is too broad", () => {
  test("a file in it that imports a subfolder of it through the alias is said, with an example", () => {
    const root = app({
      ...IN_APP_FOLDER,
      "components/data-table.tsx": 'import { Button } from "@/components/ui/button";\nexport const DataTable = () => <Button />;\n',
    });
    const result = runInit(root, null, { components: "components" });
    expect(result.warnings.join("\n")).toContain(
      'components/data-table.tsx imports "@/components/ui/button", a subfolder of components. If the design system is that subfolder, run: undrift init --components components/ui'
    );
  });

  test("the folder that is right says nothing of the kind", () => {
    const root = app({ ...IN_APP_FOLDER, "components/ui/dialog.tsx": 'import { Button } from "@/components/ui/button";\nexport const Dialog = () => <Button />;\n' });
    expect(runInit(root, null, { components: "components/ui" }).warnings.join("\n")).not.toMatch(/subfolder/);
  });
});

describe("what a folder reports as a package does", () => {
  test("a stylesheet's package.json that cannot be read is a warning, with its file", () => {
    const root = app({
      ...IN_APP_FOLDER,
      "app/globals.css": '@import "@acme/broken";\n:root { --x: 1px; }\n',
      "node_modules/@acme/broken/package.json": "{ nope",
    });
    expect(runInit(root, null, { components: "components/ui" }).warnings.join("\n")).toMatch(/node_modules\/@acme\/broken\/package\.json could not be read/);
  });

  test("a package the folder re-exports that is not built is written into componentsFrom, and the gate agrees", () => {
    const root = app({
      ...FOLDER_PACKAGE,
      "node_modules/@acme/slot/package.json": { name: "@acme/slot", types: "./dist/gone.d.ts" },
    });
    rmSync(join(root, "node_modules/@acme/slot/dist/index.d.ts"));
    const result = runInit(root, null, { components: "components/ui", force: true });
    expect(result.problems.map((p) => p.what).join("\n")).toContain("@acme/slot's type declarations are not on disk");
    expect(config(root).componentsFrom).toContain("node_modules/@acme/slot/dist/gone.d.ts");
    expect(loadContract(root).missingSources).toEqual([{ key: "componentsFrom", path: "node_modules/@acme/slot/dist/gone.d.ts" }]);
  });
});

describe("usage", () => {
  test("a package and --components together", () => {
    const r = cli(app(IN_APP_FOLDER), ["init", "@acme/react", "--components", "components/ui"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/not both/);
  });

  test("a folder that does not exist", () => {
    const r = cli(app(IN_APP_FOLDER), ["init", "--components", "components/nope"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/components\/nope is not a folder/);
  });

  test("--components with no folder, or followed by another flag, is a usage error and not a folder named --force", () => {
    for (const argv of [["init", "--components"], ["init", "--components", "--force"]]) {
      const r = cli(app(IN_APP_FOLDER), argv);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/--components needs a folder, such as components\/ui/);
    }
  });

  test("a folder in another package of a monorepo, from an app's folder, is told to run init from the root", () => {
    const root = app({ ...IN_APP_FOLDER, "apps/web/package.json": { name: "web" }, "packages/ui/src/components/button.tsx": "export const Button = () => null;\n" });
    const r = cli(root, ["init", "--config", join(root, "apps/web"), "--components", "../../packages/ui/src/components"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/needs a folder inside .*apps\/web.*run undrift init from the repository root/);
  });

  test("a folder outside the app", () => {
    const r = cli(app(IN_APP_FOLDER), ["init", "--components", "../elsewhere"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/needs a folder inside/);
  });

  test("a folder that exports no component is refused, and nothing is written", () => {
    const root = app({ ...IN_APP_FOLDER, "lib/utils.ts": "export const cn = () => '';\n" });
    const r = cli(root, ["init", "--components", "lib"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/No file in lib exports a component name/);
    expect(existsSync(join(root, "undrift.config.json"))).toBe(false);
  });
});
