// A package that re-exports sibling packages (`export * from "@acme/card"`) is read as complete when an entry
// of each sibling is listed in componentsFrom, which is what `undrift init` writes. A re-export of a package
// none of whose entries is listed stays "not followed": the list is not the whole list.
import { describe, expect, test } from "vitest";
import { mkdirSync, symlinkSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, SIBLING_PACKAGES } from "./support/init-repos.mjs";
import { loadContract } from "../src/contract.mjs";
import { rulesNotRun } from "../src/unchecked.mjs";

const ALL = ["node_modules/@acme/all/index.d.ts", "node_modules/@acme/card/index.d.ts", "node_modules/@acme/button/index.d.ts"];
const withConfig = (files, componentsFrom) =>
  app({
    ...files,
    "undrift.config.json": {
      system: "@acme/all",
      componentsFrom,
      profiles: { app: { include: "src/**/*.tsx" } },
    },
  });
const reasonOf = (root) => rulesNotRun(loadContract(root), ["no-unknown-components"])[0]?.reason;

describe("a re-export of a package is covered by a listed entry of that package", () => {
  test("every sibling's entry listed: the list is complete and the names are all there", () => {
    const contract = loadContract(withConfig(SIBLING_PACKAGES, ALL));
    expect(contract.catalogComplete).toBe(true);
    expect(contract.catalog.map((c) => c.name).sort()).toEqual(["Button", "Card", "Own"]);
    expect(contract.unreadableSources).toEqual([]);
  });

  test("only the root listed: still not complete, naming the package it could not follow", () => {
    const root = withConfig(SIBLING_PACKAGES, ALL.slice(0, 1));
    expect(loadContract(root).catalogComplete).toBe(false);
    expect(reasonOf(root)).toContain('"@acme/card"');
  });

  test("a sibling that is listed but not installed under node_modules stays not followed", () => {
    const files = { ...SIBLING_PACKAGES };
    delete files["node_modules/@acme/card/package.json"];
    delete files["node_modules/@acme/card/index.d.ts"];
    const root = withConfig({ ...files, "vendor/card/index.d.ts": "export * from '@acme/button';\nexport declare const Card: any;\n" }, [ALL[0], "vendor/card/index.d.ts", ALL[2]]);
    expect(loadContract(root).catalogComplete).toBe(false);
    expect(reasonOf(root)).toContain('"@acme/card"');
  });

  test("a sibling that is listed but not on disk stays incomplete", () => {
    const files = { ...SIBLING_PACKAGES };
    delete files["node_modules/@acme/card/index.d.ts"];
    const root = withConfig(files, ALL);
    expect(loadContract(root).catalogComplete).toBe(false);
  });

  test("an entry of a different package does not cover it", () => {
    const root = withConfig(SIBLING_PACKAGES, [ALL[0], ALL[2]]);
    expect(loadContract(root).catalogComplete).toBe(false);
    expect(reasonOf(root)).toContain('"@acme/card"');
  });

  test("a package whose name starts the same does not cover it", () => {
    const root = withConfig(
      {
        ...SIBLING_PACKAGES,
        "node_modules/@acme/card-extra/package.json": { name: "@acme/card-extra", types: "./index.d.ts" },
        "node_modules/@acme/card-extra/index.d.ts": "export declare const CardExtra: any;\n",
      },
      [ALL[0], "node_modules/@acme/card-extra/index.d.ts", ALL[2]]
    );
    expect(loadContract(root).catalogComplete).toBe(false);
    expect(reasonOf(root)).toContain('"@acme/card"');
  });

  test("a subpath re-export is covered only when the declaration file it resolves to is listed", () => {
    const files = {
      ...SIBLING_PACKAGES,
      "node_modules/@acme/all/index.d.ts": 'export * from "@acme/card/toast";\nexport declare const Own: any;\n',
      "node_modules/@acme/card/toast.d.ts": "export declare const Toast: any;\n",
    };
    expect(loadContract(withConfig(files, [ALL[0], "node_modules/@acme/card/toast.d.ts"])).catalogComplete).toBe(true);
    // the package's own root entry does not stand for one of its files
    expect(loadContract(withConfig(files, [ALL[0], ALL[1]])).catalogComplete).toBe(false);
    const other = withConfig(
      { ...files, "node_modules/@acme/card-extra/package.json": { name: "@acme/card-extra" }, "node_modules/@acme/card-extra/index.d.ts": "export declare const X: any;\n" },
      [ALL[0], "node_modules/@acme/card-extra/index.d.ts"]
    );
    expect(loadContract(other).catalogComplete).toBe(false);
    expect(reasonOf(other)).toContain('"@acme/card/toast"');
  });

  test("a subpath that does not resolve to a declaration file is not covered", () => {
    const files = { ...SIBLING_PACKAGES, "node_modules/@acme/all/index.d.ts": 'export * from "@acme/card/gone";\nexport declare const Own: any;\n' };
    expect(loadContract(withConfig(files, ALL)).catalogComplete).toBe(false);
    expect(reasonOf(withConfig(files, ALL))).toContain('"@acme/card/gone"');
  });

  // pnpm keeps a package under node_modules/.pnpm and links it from node_modules/<name>.
  test("a pnpm-style link is covered, whichever side of the link the entry is listed from", () => {
    const build = () => {
      const files = { ...SIBLING_PACKAGES };
      const root = withConfig(files, ALL);
      const real = join(root, "node_modules/.pnpm/@acme+card@1.0.0/node_modules/@acme/card");
      mkdirSync(dirname(real), { recursive: true });
      renameSync(join(root, "node_modules/@acme/card"), real);
      symlinkSync(real, join(root, "node_modules/@acme/card"));
      return root;
    };
    const viaLink = build();
    expect(loadContract(viaLink).catalogComplete).toBe(true);
    const viaStore = build();
    writeFileSync(
      join(viaStore, "undrift.config.json"),
      JSON.stringify({
        system: "@acme/all",
        componentsFrom: [ALL[0], "node_modules/.pnpm/@acme+card@1.0.0/node_modules/@acme/card/index.d.ts", ALL[2]],
        profiles: { app: { include: "src/**/*.tsx" } },
      })
    );
    expect(loadContract(viaStore).catalogComplete).toBe(true);
  });

  test("an entry does not cover its own re-export of a file of its package that is not listed", () => {
    const root = withConfig({ ...SIBLING_PACKAGES, "node_modules/@acme/all/index.d.ts": 'export * from "@acme/all/other";\nexport declare const Own: any;\n' }, ALL.slice(0, 1));
    expect(loadContract(root).catalogComplete).toBe(false);
    expect(reasonOf(root)).toContain('"@acme/all/other"');
  });

  test("a relative re-export that cannot be followed is never covered by this", () => {
    const root = withConfig({ ...SIBLING_PACKAGES, "node_modules/@acme/all/index.d.ts": 'export * from "./card";\nexport declare const Own: any;\n' }, ALL);
    expect(loadContract(root).catalogComplete).toBe(false);
  });
});

// A package is the one the re-exporting file sees: Node looks in the node_modules above the file's real folder,
// nearest first. A second copy nested under a package (a version conflict) is not the hoisted one, and a
// package that only another package's own store holds (a pnpm transitive dependency) is found there.
describe("a package is found as Node finds it, from the file that re-exports it", () => {
  const pkg = (name, dts, extra = {}) => ({
    [`node_modules/${name}/package.json`]: { name, types: "./index.d.ts", ...extra },
    [`node_modules/${name}/index.d.ts`]: dts,
  });
  const ALL_STAR = 'export * from "@acme/card";\nexport declare const Own: any;\n';

  test("a nested copy is the one the re-export reaches: listing the hoisted copy does not cover it", () => {
    const files = {
      ...pkg("@acme/all", ALL_STAR),
      ...pkg("@acme/card", "export declare const Card: any;\n"),
      "node_modules/@acme/all/node_modules/@acme/card/package.json": { name: "@acme/card", types: "./index.d.ts" },
      "node_modules/@acme/all/node_modules/@acme/card/index.d.ts": "export declare const Card: any;\nexport declare const Rating: any;\n",
    };
    const hoisted = withConfig(files, ["node_modules/@acme/all/index.d.ts", "node_modules/@acme/card/index.d.ts"]);
    expect(loadContract(hoisted).catalogComplete).toBe(false);
    expect(reasonOf(hoisted)).toContain('"@acme/card"');
    const nested = withConfig(files, ["node_modules/@acme/all/index.d.ts", "node_modules/@acme/all/node_modules/@acme/card/index.d.ts"]);
    expect(loadContract(nested).catalogComplete).toBe(true);
    expect(loadContract(nested).catalog.map((c) => c.name)).toContain("Rating");
  });

  test("a package nested inside the one it names does not stand for it", () => {
    const files = {
      ...pkg("@acme/all", ALL_STAR),
      ...pkg("@acme/card", "export declare const Card: any;\n"),
      "node_modules/@acme/card/node_modules/@acme/button/package.json": { name: "@acme/button", types: "./index.d.ts" },
      "node_modules/@acme/card/node_modules/@acme/button/index.d.ts": "export declare const Button: any;\n",
    };
    expect(loadContract(withConfig(files, ["node_modules/@acme/all/index.d.ts", "node_modules/@acme/card/node_modules/@acme/button/index.d.ts"])).catalogComplete).toBe(false);
  });

  test("a package only another package's own store holds is found from where the re-export is", () => {
    const store = "node_modules/.pnpm";
    const root = withConfig(
      {
        [`${store}/@acme+all@1.0.0/node_modules/@acme/all/package.json`]: { name: "@acme/all", types: "./index.d.ts" },
        [`${store}/@acme+all@1.0.0/node_modules/@acme/all/index.d.ts`]: ALL_STAR,
        [`${store}/@acme+card@1.0.0/node_modules/@acme/card/package.json`]: { name: "@acme/card", types: "./index.d.ts" },
        [`${store}/@acme+card@1.0.0/node_modules/@acme/card/index.d.ts`]: "export declare const Card: any;\n",
      },
      ["node_modules/@acme/all/index.d.ts", `${store}/@acme+card@1.0.0/node_modules/@acme/card/index.d.ts`]
    );
    mkdirSync(join(root, "node_modules/@acme"), { recursive: true });
    symlinkSync("../.pnpm/@acme+all@1.0.0/node_modules/@acme/all", join(root, "node_modules/@acme/all"));
    symlinkSync("../../../@acme+card@1.0.0/node_modules/@acme/card", join(root, `${store}/@acme+all@1.0.0/node_modules/@acme/card`));
    expect(loadContract(root).catalogComplete).toBe(true);
    expect(loadContract(root).catalog.map((c) => c.name).sort()).toEqual(["Card", "Own"]);
  });
});

describe("a package with no exports map: a subpath is a file", () => {
  test("a deep import of a file is covered when that file is listed, and the root is not enough", () => {
    const files = {
      "node_modules/@acme/all/package.json": { name: "@acme/all", types: "./index.d.ts" },
      "node_modules/@acme/all/index.d.ts": 'export * from "@acme/card/dist/extra";\nexport declare const Own: any;\n',
      "node_modules/@acme/card/package.json": { name: "@acme/card", types: "./index.d.ts" },
      "node_modules/@acme/card/index.d.ts": "export declare const Card: any;\n",
      "node_modules/@acme/card/dist/extra.d.ts": "export declare const Extra: any;\n",
    };
    const rootOnly = withConfig(files, ["node_modules/@acme/all/index.d.ts", "node_modules/@acme/card/index.d.ts"]);
    expect(loadContract(rootOnly).catalogComplete).toBe(false);
    const listed = withConfig(files, ["node_modules/@acme/all/index.d.ts", "node_modules/@acme/card/dist/extra.d.ts"]);
    expect(loadContract(listed).catalogComplete).toBe(true);
  });

  test("typesVersions maps the subpath, and the file it maps to is the one that must be listed", () => {
    const files = {
      "node_modules/@acme/all/package.json": { name: "@acme/all", types: "./index.d.ts" },
      "node_modules/@acme/all/index.d.ts": 'export * from "@acme/card/extra";\nexport declare const Own: any;\n',
      "node_modules/@acme/card/package.json": { name: "@acme/card", types: "./index.d.ts", typesVersions: { "*": { extra: ["./ts/extra.d.ts"] } } },
      "node_modules/@acme/card/index.d.ts": "export declare const Card: any;\n",
      "node_modules/@acme/card/ts/extra.d.ts": "export declare const Extra: any;\n",
      "node_modules/@acme/card/extra.d.ts": "export declare const Wrong: any;\n",
    };
    expect(loadContract(withConfig(files, ["node_modules/@acme/all/index.d.ts", "node_modules/@acme/card/extra.d.ts"])).catalogComplete).toBe(false);
    expect(loadContract(withConfig(files, ["node_modules/@acme/all/index.d.ts", "node_modules/@acme/card/ts/extra.d.ts"])).catalogComplete).toBe(true);
  });
});
