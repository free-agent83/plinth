// `componentsFrom` as the gate reads it: one path or a list, each a declaration entry or a
// folder of component source, the names joined. Modelled on what real systems ship: components
// declared inline (`export declare const Button`), a package with only subpath entries, a
// capitalised constant a product imports from the system, and an entry not built yet.
import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadContract } from "../src/contract.mjs";
import { gateSource } from "../src/gate.mjs";
import { rulesNotRun, canCheckComponents } from "../src/unchecked.mjs";

function repo(config, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "u-cfrom-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  writeFileSync(
    join(root, "undrift.config.json"),
    JSON.stringify({ system: "@acme/ds", profiles: { app: { include: ["src/**/*.tsx"] } }, ...config })
  );
  return root;
}
const names = (c) => c.catalog.map((entry) => entry.name);
const unknown = (contract, source) =>
  gateSource(source, { fileName: "a.tsx", contract, rules: ["no-unknown-components"] }).map((v) => v.found);

const INLINE = {
  "node_modules/@acme/ds/dist/index.d.ts": 'export * from "./button";\nexport * from "./card";\n',
  "node_modules/@acme/ds/dist/button.d.ts": "export declare const Button: (p: {}) => JSX.Element;\n",
  "node_modules/@acme/ds/dist/card.d.ts": "export declare function Card(p: {}): JSX.Element;\n",
};

test("components declared inline are read, so correct imports of them pass", () => {
  const c = loadContract(repo({ componentsFrom: "node_modules/@acme/ds/dist/index.d.ts" }, INLINE));
  expect(names(c)).toEqual(["Button", "Card"]);
  expect(c.catalogComplete).toBe(true);
  expect(unknown(c, 'import { Button, Card } from "@acme/ds";\n')).toEqual([]);
  expect(unknown(c, 'import { Rating } from "@acme/ds";\n')).toEqual(["Rating"]);
});

test("a list of subpath entries: the names of every entry are joined", () => {
  const c = loadContract(
    repo(
      { componentsFrom: ["node_modules/@acme/ds/dist/button/index.d.ts", "node_modules/@acme/ds/dist/toast/index.d.ts"] },
      {
        "node_modules/@acme/ds/dist/button/index.d.ts": "export declare const Button: any;\n",
        "node_modules/@acme/ds/dist/toast/index.d.ts": 'export declare enum TOAST_TYPE { SUCCESS = "success" }\nexport declare const Toast: any;\n',
      }
    )
  );
  expect(names(c)).toEqual(["Button", "TOAST_TYPE", "Toast"]);
  expect(unknown(c, 'import { Toast, TOAST_TYPE } from "@acme/ds/toast";\nimport { Button } from "@acme/ds/button";\n')).toEqual([]);
});

test("a folder of component source is read as a component source", () => {
  const c = loadContract(
    repo(
      { system: "@/components/ui", componentsFrom: "components/ui" },
      {
        "components/ui/button.tsx": "const Button = () => null\nexport { Button }\n",
        "components/ui/card.tsx": "export const Card = () => null\n",
      }
    )
  );
  expect(names(c)).toEqual(["Button", "Card"]);
  expect(c.catalogComplete).toBe(true);
});

test("an entry that is not built leaves the list incomplete: recorded, and the rule says why it did not run", () => {
  const c = loadContract(
    repo(
      { componentsFrom: ["node_modules/@acme/ds/dist/index.d.ts", "node_modules/@acme/ds/dist/utils.d.ts"] },
      INLINE
    )
  );
  expect(c.missingSources).toEqual([{ key: "componentsFrom", path: "node_modules/@acme/ds/dist/utils.d.ts" }]);
  expect(names(c)).toEqual(["Button", "Card"]);
  expect(c.catalogComplete).toBe(false);
  expect(canCheckComponents(c)).toBe(false);
  const [r] = rulesNotRun(c, ["no-unknown-components"]);
  expect(r.reason).toMatch(/^The component list is incomplete, because componentsFrom "node_modules\/@acme\/ds\/dist\/utils\.d\.ts" does not exist/);
  expect(r.fix).toMatch(/Build the package/);
  // and the gate, skipping on the same predicate, flags nothing it cannot be sure of
  expect(unknown(c, 'import { IconSet } from "@acme/ds/utils";\n')).toEqual([]);
});

test("a config init wrote before this change, with componentsFrom null, still loads, with no list", () => {
  const c = loadContract(repo({ componentsFrom: null }));
  expect(c.catalog).toEqual([]);
  expect(c.configuredSources).toEqual([]);
});

test.each([
  ["a blank string", " "],
  ["a list with a blank entry", ["node_modules/@acme/ds/dist/index.d.ts", " "]],
  ["a list with an empty entry", ["node_modules/@acme/ds/dist/index.d.ts", ""]],
  ["a number", 3],
])("componentsFrom that is %s is a config error", (_label, value) => {
  expect(() => loadContract(repo({ componentsFrom: value }))).toThrow(/"componentsFrom" must be a path, or a list of paths/);
});

test("an empty string still means not set, as it did before a list was allowed", () => {
  const c = loadContract(repo({ componentsFrom: "" }));
  expect(c.catalog).toEqual([]);
  expect(c.configuredSources).toEqual([]);
  expect(c.unreadableSources).toEqual([]);
});

// A part of a list is not the list. Every way an `export *` can fail to be followed leaves the list
// incomplete and the rule not run, with the names that were read kept, and says which re-export.
describe("a re-export that cannot be followed leaves the list incomplete", () => {
  const incomplete = (files, componentsFrom = "node_modules/@acme/ds/dist/index.d.ts") => {
    const c = loadContract(repo({ componentsFrom }, files));
    const [r] = rulesNotRun(c, ["no-unknown-components"]);
    return { c, r, flagged: unknown(c, 'import { Button, Rating } from "@acme/ds";\n') };
  };
  const dts = "node_modules/@acme/ds/dist/";

  test("a nested declaration that is not built", () => {
    const { c, r, flagged } = incomplete({
      [`${dts}index.d.ts`]: 'export * from "./components";\n',
      [`${dts}components/index.d.ts`]: 'export * from "./Button";\nexport * from "./card";\nexport declare const Own: any;\n',
    });
    expect(names(c)).toEqual(["Button", "Own"]);
    expect(c.catalogComplete).toBe(false);
    expect(c.unreadableSources).toEqual([
      {
        key: "componentsFrom",
        path: "node_modules/@acme/ds/dist/index.d.ts",
        reason: 'it re-exports "./Button" (in node_modules/@acme/ds/dist/components/index.d.ts) and "./card" (in node_modules/@acme/ds/dist/components/index.d.ts), which could not be followed',
        partlyRead: true,
      },
    ]);
    expect(r.reason).toMatch(/^The component list is incomplete, because componentsFrom "node_modules\/@acme\/ds\/dist\/index\.d\.ts" could not be read \(it re-exports "\.\/Button"/);
    expect(r.fix).toMatch(/^Add what it re-exports to componentsFrom as well/);
    expect(flagged).toEqual([]);
  });

  test("a package specifier", () => {
    const { c, r, flagged } = incomplete({ [`${dts}index.d.ts`]: 'export * from "@acme/button";\nexport declare const Button: any;\n' });
    expect(c.unreadableSources[0].reason).toBe('it re-exports "@acme/button", which could not be followed');
    expect(c.catalogComplete).toBe(false);
    expect(r.reason).toMatch(/^The component list is incomplete/);
    expect(flagged).toEqual([]);
  });

  test("a TypeScript source", () => {
    const { c, flagged } = incomplete({
      [`${dts}index.d.ts`]: 'export * from "./button";\nexport declare const Card: any;\n',
      [`${dts}button.tsx`]: "export const Button = () => null\n",
    });
    expect(c.catalogComplete).toBe(false);
    expect(flagged).toEqual([]);
  });

  test("an export = that cannot be listed", () => {
    const { c, r } = incomplete({ [`${dts}index.d.ts`]: "declare const lib: any;\nexport = lib;\nexport declare const Card: any;\n" });
    expect(names(c)).toEqual(["Card"]);
    expect(c.unreadableSources[0].reason).toBe("its `export = lib` does not name the components it holds");
    expect(r.reason).toMatch(/^The component list is incomplete/);
  });

  test("a barrel that is read in full is complete, and records no problem", () => {
    const c = loadContract(repo({ componentsFrom: `${dts}index.d.ts` }, INLINE));
    expect(c.unreadableSources).toEqual([]);
    expect(c.catalogComplete).toBe(true);
  });

  test("a .ts barrel as componentsFrom is refused, not read as the one name it declares itself", () => {
    const c = loadContract(
      repo(
        { system: "@/components/ui", componentsFrom: "components/ui/index.ts" },
        {
          "components/ui/index.ts": 'export * from "./button";\nexport * from "./card";\nexport { Toaster } from "./sonner";\n',
          "components/ui/button.tsx": "export const Button = () => null\n",
          "components/ui/card.tsx": "export const Card = () => null\n",
          "components/ui/sonner.tsx": "export const Toaster = () => null\n",
        }
      )
    );
    expect(c.catalog).toEqual([]);
    expect(c.catalogComplete).toBe(false);
    expect(c.unreadableSources).toEqual([
      {
        key: "componentsFrom",
        path: "components/ui/index.ts",
        reason: "it is neither a type declaration file (.d.ts, .d.mts, .d.cts) nor a folder of components",
      },
    ]);
    expect(unknown(c, 'import { Button, Card, Toaster } from "@/components/ui";\n')).toEqual([]);
    const [r] = rulesNotRun(c, ["no-unknown-components"]);
    expect(r.reason).toMatch(/^No component list was loaded, because componentsFrom "components\/ui\/index\.ts" could not be read/);
    expect(r.fix).toMatch(/^Repair the component source/);
  });
});

describe("one entry that cannot be read leaves the whole list incomplete", () => {
  test("a good entry beside a directory named like a declaration file", () => {
    const c = loadContract(
      repo(
        { componentsFrom: ["node_modules/@acme/ds/dist/button.d.ts", "node_modules/@acme/ds/dist/x.d.ts"] },
        { "node_modules/@acme/ds/dist/button.d.ts": "export declare const Button: any;\n", "node_modules/@acme/ds/dist/x.d.ts/keep": "" }
      )
    );
    expect(names(c)).toEqual(["Button"]);
    expect(c.unreadableSources).toEqual([
      { key: "componentsFrom", path: "node_modules/@acme/ds/dist/x.d.ts", reason: "it is a directory, not a file" },
    ]);
    expect(c.catalogComplete).toBe(false);
    expect(canCheckComponents(c)).toBe(false);
    const [r] = rulesNotRun(c, ["no-unknown-components"]);
    expect(r.reason).toMatch(/^The component list is incomplete, because componentsFrom "node_modules\/@acme\/ds\/dist\/x\.d\.ts" could not be read \(it is a directory, not a file\)/);
    expect(r.fix).toBe("Repair the component source, or correct its path in undrift.config.json.");
  });
});

describe("what the rule says when it cannot run", () => {
  test("a catalog file and a componentsFrom that is not built: the list comes from the catalog, and says so", () => {
    const c = loadContract(
      repo(
        { catalog: "CATALOG.md", componentsFrom: "node_modules/@acme/ds/dist/index.d.ts" },
        { "CATALOG.md": "| Component | Status | For | Not for |\n|---|---|---|---|\n| Button | stable | actions | links |\n" }
      )
    );
    expect(c.catalog.length).toBeGreaterThan(0);
    const [r] = rulesNotRun(c, ["no-unknown-components"]);
    expect(r.reason).toMatch(/^The component list comes from the catalog \(CATALOG\.md\)/);
  });

  test("a component source that names no components points at a folder as well as a declaration entry", () => {
    const c = loadContract(repo({ componentsFrom: "node_modules/@acme/ds/dist/index.d.ts" }, { "node_modules/@acme/ds/dist/index.d.ts": "export {};\n" }));
    const [r] = rulesNotRun(c, ["no-unknown-components"]);
    expect(r.reason).toMatch(/^The configured component source names no components/);
    expect(r.fix).toMatch(/or at the folder that holds them/);
  });
});

describe("a folder of components is not trusted past what was read", () => {
  // components/ui/index.ts re-exports a package and a folder outside it, and a folder inside is a
  // symlink to somewhere else: none of that is read, so a name missing from the list is not proof.
  const folderRepo = () => {
    const root = repo(
      { system: "@/components/ui", componentsFrom: "components/ui" },
      {
        "components/ui/index.ts": 'export * from "./button";\nexport * from "@radix-ui/react-slot";\nexport * from "../shared/toast";\n',
        "components/ui/button.tsx": "export const Button = () => null\n",
        "components/shared/toast.tsx": "export const Toast = () => null\n",
        "elsewhere/card.tsx": "export const Card = () => null\n",
      }
    );
    symlinkSync(join(root, "elsewhere"), join(root, "components/ui/linked"));
    return root;
  };

  test("the list is incomplete, says what was not read, and flags nothing", () => {
    const c = loadContract(folderRepo());
    expect(names(c)).toEqual(["Button"]);
    expect(c.catalogComplete).toBe(false);
    expect(canCheckComponents(c)).toBe(false);
    expect(c.unreadableSources).toHaveLength(1);
    expect(c.unreadableSources[0]).toMatchObject({ key: "componentsFrom", path: "components/ui", partlyRead: true });
    expect(c.unreadableSources[0].reason).toBe(
      'it re-exports "@radix-ui/react-slot" (in components/ui/index.ts) and "../shared/toast" (in components/ui/index.ts), which could not be followed and it holds a symlinked folder "linked", which was not read'
    );
    const [r] = rulesNotRun(c, ["no-unknown-components"]);
    expect(r.reason).toMatch(/^The component list is incomplete, because componentsFrom "components\/ui" could not be read \(it re-exports/);
    expect(unknown(c, 'import { Button, Slot, Toast } from "@/components/ui";\nimport { Card } from "@/components/ui/linked/card";\n')).toEqual([]);
  });

  test("a folder that is read in full stays complete", () => {
    const c = loadContract(
      repo(
        { system: "@/components/ui", componentsFrom: "components/ui" },
        { "components/ui/index.ts": 'export * from "./button";\n', "components/ui/button.tsx": "export const Button = () => null\n" }
      )
    );
    expect(c.catalogComplete).toBe(true);
    expect(c.unreadableSources).toEqual([]);
  });
});
