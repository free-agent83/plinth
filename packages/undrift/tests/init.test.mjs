// packages/undrift/tests/init.test.mjs
// `undrift init <package>` on the shapes real systems ship. Each fixture in support/init-repos.mjs
// is the smallest copy of a shape that made init fail on a real system on 2026-09-29.
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectSystem, runInit, DEFAULT_INCLUDE } from "../src/init.mjs";
import { DEFAULT_RULES, OPT_IN_RULES } from "../src/rules.mjs";
import { loadContract } from "../src/contract.mjs";
import { gateSource } from "../src/gate.mjs";
import { app, INLINE_SYSTEM, SUBPATH_SYSTEM, UTILITY_SUBPATHS, NESTED_UNBUILT, EXPORT_EQUALS, SIBLING_PACKAGES } from "./support/init-repos.mjs";
import { rulesNotRun } from "../src/unchecked.mjs";

const config = (root) => JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8"));
const unknownComponents = (root, source) =>
  gateSource(source, { fileName: "a.tsx", contract: loadContract(root), rules: ["no-unknown-components"] }).map((v) => v.found);

describe("components", () => {
  test("components declared inline are found, and the intrinsics name them", () => {
    const found = detectSystem(app(INLINE_SYSTEM), "@acme/react");
    expect(found.components).toEqual(expect.arrayContaining(["Button", "ButtonRoot", "Card", "Input"]));
    expect(found.componentsFrom).toEqual(["node_modules/@acme/react/dist/index.d.ts"]);
    expect(found.intrinsics).toMatchObject({ button: "Button", input: "Input" });
  });

  test("a package with only subpath entries: every entry is read, a capitalised constant included", () => {
    const root = app(SUBPATH_SYSTEM);
    runInit(root, "@acme/parts");
    expect(config(root).componentsFrom).toEqual([
      "node_modules/@acme/parts/dist/button/index.d.ts",
      "node_modules/@acme/parts/dist/toast/index.d.ts",
    ]);
    expect(unknownComponents(root, 'import { Toast, TOAST_TYPE } from "@acme/parts/toast";\n')).toEqual([]);
    expect(unknownComponents(root, 'import { Rating } from "@acme/parts/rating";\n')).toEqual(["Rating"]);
  });

  test("subpaths the root does not re-export are read too, and an entry the root reaches is not listed twice", () => {
    const root = app(UTILITY_SUBPATHS);
    runInit(root, "@acme/kit");
    expect(config(root).componentsFrom).toEqual([
      "node_modules/@acme/kit/types/index.d.ts",
      "node_modules/@acme/kit/types/utils.d.ts",
      "node_modules/@acme/kit/types/app.d.ts",
    ]);
    expect(unknownComponents(root, readFileSync(join(root, "src/app.tsx"), "utf8"))).toEqual([]);
  });
});

describe("tokens", () => {
  test("the token layer behind the app's own stylesheet, never the component package's small entry stylesheet", () => {
    const found = detectSystem(app(INLINE_SYSTEM), "@acme/react");
    expect(found.tokensCss).toEqual([
      "node_modules/@acme/styles/dist/themes/shared/theme.css",
      "node_modules/@acme/styles/dist/themes/default/variables.css",
    ]);
    expect(found.stylesheets.skipped).toEqual(["tailwindcss"]);
  });

  test("a token layer in a config package, never the component package's larger third-party stylesheet", () => {
    const found = detectSystem(app(SUBPATH_SYSTEM), "@acme/parts");
    expect(found.tokensCss).toEqual([
      "node_modules/@acme/tw-config/variables.css",
      "node_modules/@acme/tw-config/index.css",
    ]);
  });

  test("a package stylesheet the app's script imports", () => {
    const root = app({
      ...UTILITY_SUBPATHS,
      "src/index.css": "body { margin: 0; }\n",
      "src/main.tsx": 'import "@acme/kit/styles.css";\nexport const m = 1;\n',
    });
    expect(detectSystem(root, "@acme/kit").tokensCss).toEqual(["node_modules/@acme/kit/tokens.css"]);
  });
});

describe("the config", () => {
  test("is the default rules, with no opt-in rule", () => {
    const root = app(INLINE_SYSTEM);
    runInit(root, "@acme/react");
    expect(config(root).profiles.app.rules).toEqual(DEFAULT_RULES);
    for (const rule of OPT_IN_RULES) expect(config(root).profiles.app.rules).not.toContain(rule);
  });

  test("never holds null where a path belongs", () => {
    for (const [files, pkg] of [[INLINE_SYSTEM, "@acme/react"], [SUBPATH_SYSTEM, "@acme/parts"], [UTILITY_SUBPATHS, "@acme/kit"]]) {
      const root = app(files);
      runInit(root, pkg);
      const c = config(root);
      for (const key of ["system", "tokensCss", "componentsFrom", "systemImports", "foreignUi", "profiles", "intrinsics"]) {
        expect(c[key], `${pkg} ${key}`).not.toBe(null);
      }
    }
  });

  test("covers the default folders, and excludes tests, stories and the placeholder", () => {
    for (const dir of ["src", "app", "components", "pages", "templates"]) {
      expect(DEFAULT_INCLUDE).toContain(`${dir}/**/*.{ts,tsx,jsx}`);
    }
    expect(DEFAULT_INCLUDE).toEqual(expect.arrayContaining(["!**/undrift-missing.*", "!**/*.{test,spec,stories}.*"]));
  });

  test("covers a top-level folder where the app imports the system, and never a folder of tests", () => {
    const root = app(SUBPATH_SYSTEM);
    const result = runInit(root, "@acme/parts");
    expect(result.includeAdded).toEqual(["core"]);
    expect(config(root).profiles.app.include).toContain("core/**/*.{ts,tsx,jsx}");
    expect(JSON.stringify(config(root).profiles.app.include)).not.toMatch(/tests\//);
    expect(result.coverage).toMatchObject({ covered: 2, notCovered: 1, notCoveredFiles: ["tests/render.tsx"] });
  });

  test("ignores the app's stylesheets that only wire or only declare tokens, each with its reason, and no other", () => {
    const root = app({
      ...SUBPATH_SYSTEM,
      "app/(marketing)/tokens.css": ":root { --hero: #222; }\n.dark { --hero: #eee; color-scheme: dark; }\n@theme inline { --color-hero: var(--hero); }\n",
      "styles/extra.css": ".danger { border-color: #e5484d; }\n",
    });
    runInit(root, "@acme/parts");
    expect(config(root).ignore).toEqual({
      "app/\\(marketing\\)/tokens.css": "a token source in tokensCss: every rule in it declares custom properties in :root, @theme or a theme selector, which the gate reads as tokens, and it has no other rule.",
      "styles/globals.css": expect.stringMatching(/^wiring only/),
    });
  });

  test("a token source with rules of its own is read for tokens and is not ignored", () => {
    // Modelled on a picker's stylesheet that an app imports: custom properties of a third-party widget,
    // beside class rules and @apply. The reader takes its properties (a superset of the real layer is the
    // safe direction); init does not vouch for the rest of the file.
    const root = app({
      ...SUBPATH_SYSTEM,
      "styles/picker.css": ":root { --picker-size: 2rem; }\n.picker-main { @apply border-0; --picker-radius: 4px; }\n",
      "styles/base.css": ":root { --hero: #222; }\n@layer base { * { @apply border-border; } }\n",
      "styles/declares.css": ":root { --hero: #222; color: red; }\n",
    });
    runInit(root, "@acme/parts");
    const c = config(root);
    expect(c.tokensCss).toEqual(expect.arrayContaining(["styles/picker.css", "styles/base.css", "styles/declares.css"]));
    for (const file of ["styles/picker.css", "styles/base.css", "styles/declares.css"]) {
      expect(Object.keys(c.ignore ?? {})).not.toContain(file);
    }
  });
});

describe("refusing an empty result", () => {
  const UNBUILT = {
    "package.json": { name: "product" },
    "src/index.css": ":root { --x: 1px; }\n",
    "node_modules/@acme/unbuilt/package.json": {
      name: "@acme/unbuilt",
      types: "./dist/index.d.ts",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    },
  };

  test("an unbuilt package: nothing written, and the problem names the missing declarations", () => {
    const root = app(UNBUILT);
    const result = runInit(root, "@acme/unbuilt");
    expect(result.refused).toBe(true);
    expect(existsSync(join(root, "undrift.config.json"))).toBe(false);
    expect(existsSync(join(root, "components/undrift-missing.tsx"))).toBe(false);
    expect(result.problems[0].what).toBe("@acme/unbuilt's type declarations are not on disk: dist/index.d.ts. A package's declarations come from its build.");
    expect(result.problems[0].fix).toBe("Build the package first, then run undrift init again.");
  });

  test("forced, it writes what was found: the missing entry is configured, and no intrinsic is claimed", () => {
    const root = app(UNBUILT);
    runInit(root, "@acme/unbuilt", { force: true });
    const c = config(root);
    expect(c.componentsFrom).toBe("node_modules/@acme/unbuilt/dist/index.d.ts");
    expect(c.intrinsics).toEqual({});
    expect(loadContract(root).missingSources).toEqual([{ key: "componentsFrom", path: "node_modules/@acme/unbuilt/dist/index.d.ts" }]);
  });

  test("no stylesheet declares a token: nothing written; forced, tokensCss is left out", () => {
    const files = { ...INLINE_SYSTEM, "src/index.css": "body { margin: 0; }\n" };
    const root = app(files);
    const result = runInit(root, "@acme/react");
    expect(result.refused).toBe(true);
    expect(result.problems.map((p) => p.what).join(" ")).toMatch(/No stylesheet in this app, or any stylesheet it imports, declares a custom property/);
    runInit(root, "@acme/react", { force: true });
    expect("tokensCss" in config(root)).toBe(false);
  });

  test("a package that exports no component name is refused", () => {
    const root = app({
      ...INLINE_SYSTEM,
      "node_modules/cva-like/package.json": { name: "cva-like", types: "index.d.ts" },
      "node_modules/cva-like/index.d.ts": "export declare const cva: any;\nexport declare function cx(): string;\n",
    });
    const result = runInit(root, "cva-like");
    expect(result.refused).toBe(true);
    expect(result.problems[0].fix).toMatch(/--components/);
  });
});

describe("a list that was not read in full is never taken for the whole", () => {
  const rel = "node_modules/@acme/nested/dist/index.d.ts";

  test("an export * that cannot be followed: refused, named with its file, and the fix says what to add", () => {
    const root = app(NESTED_UNBUILT);
    const result = runInit(root, "@acme/nested");
    expect(result.refused).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.problems).toEqual([
      {
        what: `@acme/nested's component list is not complete: it re-exports "./components" (in ${rel}), which could not be followed.`,
        fix: "Add those packages' declaration entries to componentsFrom, or build the package, then run undrift init again.",
      },
    ]);
    expect(existsSync(join(root, "undrift.config.json"))).toBe(false);
  });

  test("forced, it writes the config and the gate reports no-unknown-components as not run", () => {
    const root = app(NESTED_UNBUILT);
    runInit(root, "@acme/nested", { force: true });
    expect(config(root).componentsFrom).toBe(rel);
    const contract = loadContract(root);
    expect(contract.catalogComplete).toBe(false);
    expect(rulesNotRun(contract, ["no-unknown-components"])[0].reason).toMatch(/^The component list is incomplete, because componentsFrom "node_modules\/@acme\/nested\/dist\/index\.d\.ts" could not be read \(it re-exports "\.\/components"/);
    expect(unknownComponents(root, 'import { Rating } from "@acme/nested";\n')).toEqual([]);
  });

  test("an export = whose members cannot be listed: the same", () => {
    const root = app(EXPORT_EQUALS);
    const result = runInit(root, "@acme/cjs");
    expect(result.refused).toBe(true);
    expect(result.problems[0].what).toBe(
      "@acme/cjs's component list is not complete: its `export = lib` (in node_modules/@acme/cjs/index.d.ts) does not name the components it holds."
    );
    runInit(root, "@acme/cjs", { force: true });
    const contract = loadContract(root);
    expect(contract.catalogComplete).toBe(false);
    expect(rulesNotRun(contract, ["no-unknown-components"])).toHaveLength(1);
  });

  test("a package that re-exports sibling packages is read through them, and their entries are written", () => {
    const root = app(SIBLING_PACKAGES);
    const result = runInit(root, "@acme/all");
    expect(result.refused).toBe(false);
    expect(result.partial).toBe(false);
    expect(config(root).componentsFrom).toEqual([
      "node_modules/@acme/all/index.d.ts",
      "node_modules/@acme/card/index.d.ts",
      "node_modules/@acme/button/index.d.ts",
    ]);
  });

  test("a package that re-exports sibling packages: the gate reads the written list as complete", () => {
    const root = app(SIBLING_PACKAGES);
    runInit(root, "@acme/all");
    expect(loadContract(root).catalogComplete).toBe(true);
    expect(unknownComponents(root, 'import { Button, Card, Own } from "@acme/all";\n')).toEqual([]);
    expect(unknownComponents(root, 'import { Rating } from "@acme/all";\n')).toEqual(["Rating"]);
  });

  test("a sibling package that is not installed stays in the problem", () => {
    const root = app({ ...SIBLING_PACKAGES, "node_modules/@acme/card/index.d.ts": 'export * from "@acme/missing";\nexport declare const Card: any;\n' });
    const result = runInit(root, "@acme/all");
    expect(result.refused).toBe(true);
    expect(result.problems[0].what).toContain('it re-exports "@acme/missing" (in node_modules/@acme/card/index.d.ts)');
  });
});

test("the later list is never touched, forced or not", () => {
  const root = app(INLINE_SYSTEM);
  const later = '{\n  "entries": []\n}\n';
  writeFileSync(join(root, "undrift.later.json"), later);
  runInit(root, "@acme/react");
  runInit(root, "@acme/react", { force: true });
  expect(readFileSync(join(root, "undrift.later.json"), "utf8")).toBe(later);
});
