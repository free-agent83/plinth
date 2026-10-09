// `undrift init` finds a package a list re-exports as Node does, from the file that names it, and reads a
// subpath of a package as the file it resolves to. Whatever it calls complete, the gate reads as complete:
// both go through the same resolution and the same coverage predicate.
import { describe, expect, test, vi } from "vitest";
import fg from "fast-glob";
import { chmodSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../src/init.mjs";
import { loadContract } from "../src/contract.mjs";
import { gateSource } from "../src/gate.mjs";
import { app, cli, EXPORT_EQUALS, FOLDER_PACKAGE, FOLDER_STAR, IN_APP_FOLDER, INLINE_SYSTEM, NESTED_UNBUILT, SIBLING_PACKAGES, SUBPATH_SYSTEM, UTILITY_SUBPATHS } from "./support/init-repos.mjs";

const TOK = { "package.json": { name: "product" }, "src/index.css": ":root { --x: 1px; }\n" };
const pkg = (name, dts, extra = {}) => ({
  [`node_modules/${name}/package.json`]: { name, types: "./index.d.ts", ...extra },
  [`node_modules/${name}/index.d.ts`]: dts,
});
const ALL_STAR = 'export * from "@acme/card";\nexport declare const Own: any;\n';
const config = (root) => JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8"));
const flagged = (root, source) =>
  gateSource(source, { fileName: "a.tsx", contract: loadContract(root), rules: ["no-unknown-components"] }).map((v) => v.found);

describe("a re-exported package is the one the re-exporting file sees", () => {
  const HOISTED_AND_NESTED = {
    ...TOK,
    ...pkg("@acme/all", ALL_STAR),
    ...pkg("@acme/card", "export declare const Card: any;\n", { version: "1.0.0" }),
    "node_modules/@acme/all/node_modules/@acme/card/package.json": { name: "@acme/card", version: "2.0.0", types: "./index.d.ts" },
    "node_modules/@acme/all/node_modules/@acme/card/index.d.ts": "export declare const Card: any;\nexport declare const Rating: any;\n",
  };

  test("a nested copy beside a hoisted one: the nested copy is listed, and what only it exports is known", () => {
    const root = app(HOISTED_AND_NESTED);
    const result = runInit(root, "@acme/all");
    expect(result.refused).toBe(false);
    expect(config(root).componentsFrom).toEqual([
      "node_modules/@acme/all/index.d.ts",
      "node_modules/@acme/all/node_modules/@acme/card/index.d.ts",
    ]);
    expect(loadContract(root).catalogComplete).toBe(true);
    expect(flagged(root, 'import { Card, Rating } from "@acme/all";\n')).toEqual([]);
  });

  test("a package that only a nested node_modules holds is listed, and the gate agrees", () => {
    const root = app({
      ...TOK,
      ...pkg("@acme/all", ALL_STAR),
      "node_modules/@acme/all/node_modules/@acme/card/package.json": { name: "@acme/card", types: "./index.d.ts" },
      "node_modules/@acme/all/node_modules/@acme/card/index.d.ts": "export declare const Card: any;\n",
    });
    expect(runInit(root, "@acme/all").refused).toBe(false);
    expect(loadContract(root).catalogComplete).toBe(true);
  });

  const STORE = "node_modules/.pnpm";
  const pnpm = (direct) => {
    const root = app({
      ...TOK,
      [`${STORE}/@acme+all@1.0.0/node_modules/@acme/all/package.json`]: { name: "@acme/all", types: "./index.d.ts" },
      [`${STORE}/@acme+all@1.0.0/node_modules/@acme/all/index.d.ts`]: ALL_STAR,
      [`${STORE}/@acme+card@1.0.0/node_modules/@acme/card/package.json`]: { name: "@acme/card", types: "./index.d.ts" },
      [`${STORE}/@acme+card@1.0.0/node_modules/@acme/card/index.d.ts`]: "export declare const Card: any;\n",
    });
    mkdirSync(join(root, "node_modules/@acme"), { recursive: true });
    symlinkSync("../.pnpm/@acme+all@1.0.0/node_modules/@acme/all", join(root, "node_modules/@acme/all"));
    symlinkSync("../../../@acme+card@1.0.0/node_modules/@acme/card", join(root, `${STORE}/@acme+all@1.0.0/node_modules/@acme/card`));
    if (direct) symlinkSync("../.pnpm/@acme+card@1.0.0/node_modules/@acme/card", join(root, "node_modules/@acme/card"));
    return root;
  };

  test("pnpm: a sibling that is only in the store, a transitive dependency, is found and listed", () => {
    const root = pnpm(false);
    const result = runInit(root, "@acme/all");
    expect(result.refused).toBe(false);
    expect(config(root).componentsFrom).toHaveLength(2);
    expect(loadContract(root).catalogComplete).toBe(true);
    expect(loadContract(root).catalog.map((c) => c.name).sort()).toEqual(["Card", "Own"]);
  });

  test("pnpm: a sibling that is also a direct dependency", () => {
    const root = pnpm(true);
    expect(runInit(root, "@acme/all").refused).toBe(false);
    expect(loadContract(root).catalogComplete).toBe(true);
  });
});

describe("a package with no exports map: a subpath is a file", () => {
  test("a sibling re-exported by a deep path: the file it resolves to is listed", () => {
    const root = app({
      ...TOK,
      ...pkg("@acme/all", 'export * from "@acme/card/dist/extra";\nexport declare const Own: any;\n'),
      ...pkg("@acme/card", "export declare const Card: any;\n"),
      "node_modules/@acme/card/dist/extra.d.ts": "export declare const Extra: any;\n",
    });
    expect(runInit(root, "@acme/all").refused).toBe(false);
    expect(config(root).componentsFrom).toEqual(["node_modules/@acme/all/index.d.ts", "node_modules/@acme/card/dist/extra.d.ts"]);
    expect(loadContract(root).catalogComplete).toBe(true);
    expect(flagged(root, 'import { Extra } from "@acme/all";\n')).toEqual([]);
  });

  test("a file beside the types file that the app imports by its path is listed", () => {
    const root = app({
      ...TOK,
      "src/a.tsx": 'import { Extra } from "@acme/ds/extra";\nimport "@acme/ds/styles.css";\nexport const A = () => <Extra />;\n',
      ...pkg("@acme/ds", "export declare const Button: any;\n"),
      "node_modules/@acme/ds/extra.d.ts": "export declare const Extra: any;\n",
    });
    const result = runInit(root, "@acme/ds");
    expect(result.refused).toBe(false);
    expect(config(root).componentsFrom).toEqual(["node_modules/@acme/ds/index.d.ts", "node_modules/@acme/ds/extra.d.ts"]);
    expect(flagged(root, 'import { Extra } from "@acme/ds/extra";\n')).toEqual([]);
  });

  test("a subpath the package's own entry already reaches is not listed again", () => {
    const root = app({
      ...TOK,
      "src/a.tsx": 'import { Extra } from "@acme/ds/extra";\nexport const A = () => <Extra />;\n',
      ...pkg("@acme/ds", 'export * from "./extra";\n'),
      "node_modules/@acme/ds/extra.d.ts": "export declare const Extra: any;\n",
    });
    expect(runInit(root, "@acme/ds").refused).toBe(false);
    expect(config(root).componentsFrom).toBe("node_modules/@acme/ds/index.d.ts");
  });

  test("typesVersions maps the path the app imports to the file that is listed", () => {
    const root = app({
      ...TOK,
      "src/a.tsx": 'import { Rating } from "@acme/ds/rating";\nexport const A = () => <Rating />;\n',
      ...pkg("@acme/ds", "export declare const Button: any;\n", { typesVersions: { "*": { rating: ["ts/rating.d.ts"] } } }),
      "node_modules/@acme/ds/ts/rating.d.ts": "export declare const Rating: any;\n",
    });
    expect(runInit(root, "@acme/ds").refused).toBe(false);
    expect(config(root).componentsFrom).toContain("node_modules/@acme/ds/ts/rating.d.ts");
    expect(flagged(root, 'import { Rating } from "@acme/ds/rating";\n')).toEqual([]);
  });

  test("a subpath the app imports that resolves to no declaration is a problem, named with its file", () => {
    const root = app({
      ...TOK,
      "src/a.tsx": 'import { Gone } from "@acme/ds/gone";\nexport const A = () => <Gone />;\n',
      ...pkg("@acme/ds", "export declare const Button: any;\n"),
    });
    const result = runInit(root, "@acme/ds");
    expect(result.refused).toBe(true);
    expect(result.problems[0].what).toBe(
      'The app imports "@acme/ds/gone" (in src/a.tsx), which does not resolve to a type declaration file, so the components in it are not in the list.'
    );
    expect(result.problems[0].fix).toMatch(/add the declaration file that holds them to componentsFrom/);
  });
});

describe("a declaration that cannot be opened", () => {
  test.skipIf(process.getuid?.() === 0)("is a sentence, with the file, and the list is not complete", () => {
    const root = app({
      ...INLINE_SYSTEM,
    });
    const file = join(root, "node_modules/@acme/react/dist/components/card/index.d.ts");
    chmodSync(file, 0o000);
    try {
      const result = runInit(root, "@acme/react");
      expect(result.refused).toBe(true);
      expect(result.partial).toBe(true);
      expect(result.problems[0].what).toContain("could not open");
      expect(result.problems[0].what).toContain("(permission denied)");
      runInit(root, "@acme/react", { force: true });
      expect(loadContract(root).catalogComplete).toBe(false);
    } finally {
      chmodSync(file, 0o644);
    }
  });
});

// shadcn's monorepo template keeps its components in a package that ships source and no declarations. The apps
// import it by its package name, from another folder of the repository.
describe("a package that ships its source", () => {
  const SOURCE_PACKAGE = {
    ...TOK,
    "node_modules/@acme/ui/package.json": { name: "@acme/ui", exports: { "./*": "./src/components/*.tsx" } },
    "node_modules/@acme/ui/src/components/button.tsx": "export const Button = () => null;\n",
  };

  test("is said to ship source, and the advice is --components from the repository root and the package in systemImports", () => {
    const root = app(SOURCE_PACKAGE);
    const result = runInit(root, "@acme/ui");
    expect(result.refused).toBe(true);
    expect(result.problems[0].what).toBe("@acme/ui ships its source and no type declarations, so no component could be read.");
    // No repository root is marked above the app here, so the path is the absolute one.
    expect(result.problems[0].fix).toBe(
      `Run undrift init from the repository root with --components pointing at its components, for example: undrift init --components ${realpathSync(root)}/node_modules/@acme/ui/src/components. ` +
        'Then add "@acme/ui" to "systemImports" in undrift.config.json, so that the imports of it in your apps are checked.'
    );
  });

  // The advice is run where it says: from the repository root, with a path that is relative to it.
  test.each([
    ["a pnpm-workspace.yaml", { "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n" }],
    ["workspaces in package.json", { "package.json": { name: "mono", workspaces: ["apps/*", "packages/*"] } }],
    ["a .git folder", { ".git/HEAD": "ref: refs/heads/main\n" }],
  ])("the monorepo: run from an app, the example runs from the root and works (%s)", (_label, marker) => {
    const root = app({
      ...marker,
      "styles/globals.css": ":root { --x: 1px; }\n",
      "apps/web/package.json": { name: "web" },
      "apps/web/src/index.css": ":root { --x: 1px; }\n",
      "packages/ui/package.json": { name: "@workspace/ui", exports: { "./*": "./src/components/*.tsx" } },
      "packages/ui/src/components/button.tsx": "export const Button = () => null;\n",
    });
    mkdirSync(join(root, "apps/web/node_modules/@workspace"), { recursive: true });
    symlinkSync("../../../../packages/ui", join(root, "apps/web/node_modules/@workspace/ui"));
    const first = cli(root, ["init", "@workspace/ui", "--config", join(root, "apps/web")]);
    expect(first.code).toBe(1);
    const command = first.out.match(/for example: undrift init (--components \S+)\./);
    expect(command?.[1]).toBe("--components packages/ui/src/components");
    const second = cli(root, ["init", ...command[1].split(" ")]);
    expect(second.code).toBe(0);
  });

  test("the nearest marked ancestor is the root, not a farther one", () => {
    const root = app({
      ".git/HEAD": "ref: refs/heads/main\n",
      "inner/pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "inner/apps/web/package.json": { name: "web" },
      "inner/apps/web/src/index.css": ":root { --x: 1px; }\n",
      "inner/packages/ui/package.json": { name: "@workspace/ui", exports: { "./*": "./src/components/*.tsx" } },
      "inner/packages/ui/src/components/button.tsx": "export const Button = () => null;\n",
    });
    mkdirSync(join(root, "inner/apps/web/node_modules/@workspace"), { recursive: true });
    symlinkSync("../../../../packages/ui", join(root, "inner/apps/web/node_modules/@workspace/ui"));
    const result = runInit(join(root, "inner/apps/web"), "@workspace/ui");
    expect(result.problems[0].fix).toContain("undrift init --components packages/ui/src/components.");
  });

  test("an import of the app that does not resolve gets the source advice, not a call to build", () => {
    const root = app({ ...SOURCE_PACKAGE, "src/a.tsx": 'import { Gone } from "@acme/ui/gone";\nexport const A = () => <Gone />;\n' });
    const result = runInit(root, "@acme/ui");
    const imports = result.problems.find((p) => p.what.startsWith("The app imports"));
    expect(imports.fix).toMatch(/^Run undrift init from the repository root with --components pointing at its components/);
    expect(imports.fix).not.toMatch(/Build @acme\/ui/);
  });

  test("a package that ships declarations keeps the build advice for an import that does not resolve", () => {
    const files = { ...SOURCE_PACKAGE, "node_modules/@acme/ui/package.json": { name: "@acme/ui", types: "./dist/index.d.ts" }, "node_modules/@acme/ui/dist/index.d.ts": "export declare const Button: any;\n", "src/a.tsx": 'import { Gone } from "@acme/ui/gone";\nexport const A = () => <Gone />;\n' };
    const imports = runInit(app(files), "@acme/ui").problems.find((p) => p.what.startsWith("The app imports"));
    expect(imports.fix).toBe("Build @acme/ui, or add the declaration file that holds them to componentsFrom, then run undrift init again.");
  });

  test("the source of a package is looked for once, and not at all when it has declarations", () => {
    const globs = () => vi.spyOn(fg, "sync");
    const sourceGlobs = (spy) => spy.mock.calls.filter(([pattern]) => pattern === "**/*.{ts,tsx,jsx}").length;
    const spy = globs();
    try {
      runInit(app(SOURCE_PACKAGE), "@acme/ui");
      expect(sourceGlobs(spy)).toBe(1);
      spy.mockClear();
      runInit(app(INLINE_SYSTEM), "@acme/react");
      expect(sourceGlobs(spy)).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  test("a package that ships neither source nor declarations keeps the plain message", () => {
    const result = runInit(app({ ...TOK, "node_modules/@acme/empty/package.json": { name: "@acme/empty" } }), "@acme/empty");
    expect(result.problems[0].what).toBe("@acme/empty publishes no type declarations, so no component could be read.");
    expect(result.problems[0].fix).toMatch(/^Undrift reads a package's \.d\.ts files\./);
  });

  test("a package whose declarations export no component is not said to ship only source", () => {
    const files = {
      ...SOURCE_PACKAGE,
      "node_modules/@acme/ui/package.json": { name: "@acme/ui", types: "./dist/index.d.ts" },
      "node_modules/@acme/ui/dist/index.d.ts": "export declare const cn: any;\n",
    };
    expect(runInit(app(files), "@acme/ui").problems[0].what).toBe("@acme/ui's type declarations export no component name.");
  });

  test("a package that ships declarations beside its source is read as before", () => {
    const result = runInit(app({ ...SOURCE_PACKAGE, "node_modules/@acme/ui/package.json": { name: "@acme/ui", types: "./dist/index.d.ts" }, "node_modules/@acme/ui/dist/index.d.ts": "export declare const Button: any;\n" }), "@acme/ui");
    expect(result.refused).toBe(false);
  });
});

describe("a type-only star the package cannot follow", () => {
  test("does not make the list partial, for init or for the gate, and the types behind it are not components", () => {
    const root = app({
      ...TOK,
      "node_modules/@acme/t/package.json": { name: "@acme/t", types: "./index.d.ts" },
      "node_modules/@acme/t/index.d.ts": 'export type * from "@acme/not-installed";\nexport declare const Real: any;\n',
    });
    const result = runInit(root, "@acme/t");
    expect(result.refused).toBe(false);
    expect(result.listComplete).toBe(true);
    expect(loadContract(root).catalogComplete).toBe(true);
  });
});

describe("an entry that cannot be opened", () => {
  test.skipIf(process.getuid?.() === 0)("the entry itself: init does not throw, and the list is not complete for init or the gate", () => {
    const root = app(INLINE_SYSTEM);
    const file = join(root, "node_modules/@acme/react/dist/index.d.ts");
    chmodSync(file, 0o000);
    try {
      const result = runInit(root, "@acme/react");
      expect(result.refused).toBe(true);
      expect(result.listComplete).toBe(false);
      expect(result.problems.map((p) => p.what).join("\n")).toContain('could not open "node_modules/@acme/react/dist/index.d.ts" (permission denied)');
      runInit(root, "@acme/react", { force: true });
      expect(loadContract(root).catalogComplete).toBe(false);
    } finally {
      chmodSync(file, 0o644);
    }
  });
});

describe("a sibling that is not built is named, and not the system", () => {
  test("the problem names the sibling and the file that is missing", () => {
    const root = app({
      ...TOK,
      ...pkg("@acme/all", ALL_STAR),
      "node_modules/@acme/card/package.json": { name: "@acme/card", types: "./dist/index.d.ts" },
    });
    const result = runInit(root, "@acme/all");
    expect(result.refused).toBe(true);
    expect(result.problems[0].what).toBe(
      "@acme/card's type declarations are not on disk: node_modules/@acme/card/dist/index.d.ts. A package's declarations come from its build."
    );
  });
});

// Whatever init calls complete, the gate reads as complete, whichever shape the package has: both use the same
// resolution and the same coverage predicate on the list that is written.
describe("init and the gate agree about whether the list is complete", () => {
  const nestedSelf = { ...TOK, ...pkg("@acme/all", 'export * from "@acme/all";\nexport declare const Own: any;\n') };
  const relativeReach = {
    ...TOK,
    ...pkg("@acme/all", 'export * from "@acme/card";\nexport * from "../card/index";\nexport declare const Own: any;\n'),
    ...pkg("@acme/card", "export declare const Card: any;\n"),
  };
  const siblingUnbuilt = { ...TOK, ...pkg("@acme/all", ALL_STAR), "node_modules/@acme/card/package.json": { name: "@acme/card", types: "./dist/index.d.ts" } };
  const siblingEmpty = { ...TOK, ...pkg("@acme/all", ALL_STAR), "node_modules/@acme/card/package.json": { name: "@acme/card" } };
  const unbuiltSubpath = {
    ...TOK,
    ...pkg("@acme/ds", "export declare const Button: any;\n", {
      exports: { ".": { types: "./index.d.ts" }, "./card": { types: "./dist/card.d.ts", import: "./dist/card.js" } },
    }),
  };
  const siblingNotInstalled = { ...TOK, ...pkg("@acme/all", ALL_STAR) };
  const folderOnly = { ...IN_APP_FOLDER, "components/ui/index.ts": 'export * from "./button";\n' };
  const folderUnbuilt = {
    ...FOLDER_PACKAGE,
    "node_modules/@acme/slot/package.json": { name: "@acme/slot", types: "./dist/gone.d.ts" },
  };
  delete folderUnbuilt["node_modules/@acme/slot/dist/index.d.ts"];
  const folderNotInstalled = { ...FOLDER_PACKAGE };
  delete folderNotInstalled["node_modules/@acme/slot/package.json"];
  delete folderNotInstalled["node_modules/@acme/slot/dist/index.d.ts"];
  const folderLeaves = { ...folderOnly, "components/ui/index.ts": 'export * from "./button";\nexport * from "../shared/toast";\n', "components/shared/toast.tsx": "export const Toast = () => null;\n" };
  const linked = (root) => symlinkSync(join(root, "elsewhere"), join(root, "components/ui/linked"));
  test.each([
    ["inline", INLINE_SYSTEM, "@acme/react", true],
    ["subpath entries", SUBPATH_SYSTEM, "@acme/parts", true],
    ["utility subpaths", UTILITY_SUBPATHS, "@acme/kit", true],
    ["a nested export * that is not built", NESTED_UNBUILT, "@acme/nested", false],
    ["an export = that cannot be listed", EXPORT_EQUALS, "@acme/cjs", false],
    ["sibling packages", SIBLING_PACKAGES, "@acme/all", true],
    ["a package that re-exports itself by name", nestedSelf, "@acme/all", false],
    ["a sibling reached by a relative path as well", relativeReach, "@acme/all", true],
    ["a sibling that is not built", siblingUnbuilt, "@acme/all", false],
    ["a sibling that ships no declarations", siblingEmpty, "@acme/all", false],
    ["a sibling that is not installed", siblingNotInstalled, "@acme/all", false],
    ["a subpath entry that is not built, beside a root that is", unbuiltSubpath, "@acme/ds", false],
  ])("%s", (_label, files, name, complete) => {
    const root = app(files);
    const result = runInit(root, name, { force: true });
    expect(result.listComplete).toBe(complete);
    expect(loadContract(root).catalogComplete).toBe(complete);
  });

  test.each([
    ["a folder of components", IN_APP_FOLDER, true],
    ["a folder whose barrel re-exports a package and a subpath of another", FOLDER_PACKAGE, true],
    ["a folder that re-exports a package that is not installed", folderNotInstalled, false],
    ["a folder that re-exports a package that is not built", folderUnbuilt, false],
    ["a folder that re-exports a folder outside it", folderLeaves, false],
    ["a folder that holds a symlinked folder", { ...folderOnly, "elsewhere/card.tsx": "export const Card = () => null;\n" }, false, linked],
    ["a folder whose barrel re-exports its own file only", folderOnly, true],
  ])("%s", (_label, files, complete, prepare) => {
    const root = app(files);
    prepare?.(root);
    const result = runInit(root, null, { components: "components/ui", force: true });
    expect(result.listComplete).toBe(complete);
    expect(loadContract(root).catalogComplete).toBe(complete);
  });
});
