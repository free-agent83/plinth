// "Checked and clean" has to be the only thing a clean result means. Four rules
// need an input to run at all (a token set, a complete component list, a map of
// raw elements, a list of foreign libraries). When the input is missing the rule
// used to skip in silence and the run still read as clean. These tests pin the
// other half: the run says which rule did not run, why, and how to fix it, and
// the gate skips on exactly the predicates that report it.
import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canCheckTokens,
  canCheckComponents,
  canCheckIntrinsics,
  canCheckForeignUi,
  rulesNotRun,
} from "../src/unchecked.mjs";
import { gateSource, gateFiles, DEFAULT_RULES } from "../src/gate.mjs";
import { loadContract } from "../src/contract.mjs";

// A contract that has every input, as loadContract would build it.
const full = (over = {}) => ({
  system: "@acme/ds",
  tokens: { "--color-primary": "#3b5bdb" },
  catalog: [{ name: "Button" }, { name: "Badge" }],
  catalogComplete: true,
  intrinsics: { button: "Button" },
  foreignUi: ["@mui/"],
  systemImports: ["@acme/ds"],
  exemptMarker: "token-exempt",
  configuredSources: [
    { key: "tokensCss", path: "ds/theme.css" },
    { key: "componentsFrom", path: "ds/index.d.ts" },
  ],
  missingSources: [],
  ...over,
});

const INPUT_FREE = ["no-raw-colors", "no-arbitrary-values", "no-inline-style-values"];
const INPUT_DEPENDENT = [
  "no-unknown-tokens",
  "no-unknown-components",
  "no-raw-elements",
  "no-foreign-ui-imports",
];

describe("the predicates", () => {
  test("canCheckTokens: a token set is needed, and any token will do", () => {
    expect(canCheckTokens(full())).toBe(true);
    expect(canCheckTokens(full({ tokens: {} }))).toBe(false);
    expect(canCheckTokens({})).toBe(false);
  });

  // A token file that parses is not a token file that holds tokens. Only a custom
  // property, a key starting with "--", is something var(--name) can be checked
  // against: a JSON with a version and a name, or a nested DTCG tree with no
  // flattened names, counted as tokens and made every var() look unknown.
  test("canCheckTokens: only custom properties count, whatever else the file holds", () => {
    expect(canCheckTokens(full({ tokens: { version: 1, name: "x" } }))).toBe(false);
    expect(canCheckTokens(full({ tokens: { color: { primary: { $value: "#111" } } } }))).toBe(false);
    expect(canCheckTokens(full({ tokens: { "-color": "#111", "-": 1 } }))).toBe(false);
    expect(canCheckTokens(full({ tokens: { version: 1, "--color-a": "#111" } }))).toBe(true);
    expect(canCheckTokens(full({ tokens: { "--": "x" } }))).toBe(true);
  });

  test("a token set with no custom property is reported as declaring none, not as absent", () => {
    const [entry] = rulesNotRun(full({ tokens: { version: 1 } }), ["no-unknown-tokens"]);
    expect(entry.rule).toBe("no-unknown-tokens");
    expect(entry.reason).toMatch(/^The configured token sources declare no custom properties \(tokensCss "ds\/theme\.css"\)/);
  });

  test("canCheckComponents: needs a list that is known to be complete, and not empty", () => {
    expect(canCheckComponents(full())).toBe(true);
    expect(canCheckComponents(full({ catalogComplete: false }))).toBe(false);
    expect(canCheckComponents(full({ catalogComplete: undefined }))).toBe(false);
    expect(canCheckComponents(full({ catalog: [] }))).toBe(false);
    expect(canCheckComponents({})).toBe(false);
  });

  // The rule only looks at names imported FROM the design system. With no import
  // specifier that counts as the system, no import can ever be checked, so the
  // rule cannot fire however complete the list is.
  test("canCheckComponents: needs something to count as the design system's imports", () => {
    expect(canCheckComponents(full({ systemImports: [] }))).toBe(false);
    expect(canCheckComponents(full({ systemImports: undefined }))).toBe(false);
    expect(canCheckComponents(full({ systemImports: ["@acme/ds", "@acme/ds-extra"] }))).toBe(true);
  });

  test("canCheckIntrinsics: needs at least one raw element mapped", () => {
    expect(canCheckIntrinsics(full())).toBe(true);
    expect(canCheckIntrinsics(full({ intrinsics: { textarea: null } }))).toBe(true);
    expect(canCheckIntrinsics(full({ intrinsics: {} }))).toBe(false);
    expect(canCheckIntrinsics({})).toBe(false);
  });

  test("canCheckForeignUi: needs at least one foreign library listed", () => {
    expect(canCheckForeignUi(full())).toBe(true);
    expect(canCheckForeignUi(full({ foreignUi: [] }))).toBe(false);
    expect(canCheckForeignUi({})).toBe(false);
  });
});

describe("rulesNotRun", () => {
  test("reports nothing when every input exists", () => {
    // The opt-in rules have their own consistency tests (rule-primitive-tokens, rule-default-palette):
    // a flat token set, which full() is, rightly reports no-primitive-tokens as not run.
    expect(rulesNotRun(full(), DEFAULT_RULES)).toEqual([]);
  });

  test("never reports the three rules that need no input, whatever the contract lacks", () => {
    expect(rulesNotRun({}, INPUT_FREE)).toEqual([]);
    expect(rulesNotRun(full({ tokens: {}, catalog: [], intrinsics: {}, foreignUi: [] }), INPUT_FREE)).toEqual([]);
  });

  test("reports only rules that are actually on for the profile", () => {
    const bare = {};
    expect(rulesNotRun(bare, ["no-raw-colors"])).toEqual([]);
    expect(rulesNotRun(bare, ["no-unknown-tokens"]).map((r) => r.rule)).toEqual(["no-unknown-tokens"]);
    expect(rulesNotRun(bare, INPUT_DEPENDENT).map((r) => r.rule)).toEqual(INPUT_DEPENDENT);
  });

  test("a profile that omits `rules` runs the default rules, so all four can be reported", () => {
    expect(rulesNotRun({}).map((r) => r.rule)).toEqual(INPUT_DEPENDENT);
  });

  test("reports a rule once, even if the profile lists it twice", () => {
    expect(rulesNotRun({}, ["no-unknown-tokens", "no-unknown-tokens"])).toHaveLength(1);
  });

  test("ignores names that are not rules, such as invalid-gap", () => {
    expect(rulesNotRun({}, ["invalid-gap", "unresolved-gap"])).toEqual([]);
  });

  describe("no-unknown-tokens", () => {
    const only = (c) => rulesNotRun(c, ["no-unknown-tokens"]);

    test("not reported when the token set is not empty", () => {
      expect(only(full())).toEqual([]);
    });

    test("names the missing token source", () => {
      const [r] = only(
        full({
          tokens: {},
          configuredSources: [{ key: "tokensCss", path: "ds/nope.css" }],
          missingSources: [{ key: "tokensCss", path: "ds/nope.css" }],
        })
      );
      expect(r.rule).toBe("no-unknown-tokens");
      expect(r.reason).toContain('tokensCss "ds/nope.css"');
      expect(r.reason).toMatch(/does not exist/);
      expect(r.fix).toMatch(/correct its path|build/i);
    });

    test("names every missing token source", () => {
      const missing = [
        { key: "tokens", path: "ds/tokens.json" },
        { key: "tokensCss", path: "ds/theme.css" },
      ];
      const [r] = only(full({ tokens: {}, configuredSources: missing, missingSources: missing }));
      expect(r.reason).toContain('tokens "ds/tokens.json"');
      expect(r.reason).toContain('tokensCss "ds/theme.css"');
      expect(r.reason).toMatch(/do not exist/);
    });

    test("says none is configured when none is", () => {
      const [r] = only(full({ tokens: {}, configuredSources: [], missingSources: [] }));
      expect(r.reason).toMatch(/no token source is configured/i);
      expect(r.fix).toContain('"tokensCss"');
    });

    test("says so when the configured sources exist but declare nothing", () => {
      const [r] = only(
        full({ tokens: {}, configuredSources: [{ key: "tokensCss", path: "ds/empty.css" }], missingSources: [] })
      );
      expect(r.reason).toMatch(/declare no custom properties/);
      expect(r.reason).toContain('tokensCss "ds/empty.css"');
    });

    test("a missing component source is not blamed for missing tokens", () => {
      const [r] = only(
        full({
          tokens: {},
          configuredSources: [],
          missingSources: [{ key: "componentsFrom", path: "ds/index.d.ts" }],
        })
      );
      expect(r.reason).toMatch(/no token source is configured/i);
      expect(r.reason).not.toContain("componentsFrom");
    });
  });

  describe("no-unknown-components", () => {
    const only = (c) => rulesNotRun(c, ["no-unknown-components"]);

    test("not reported when the list is complete and non-empty", () => {
      expect(only(full())).toEqual([]);
    });

    test("no component list: names the missing source", () => {
      const [r] = only(
        full({
          catalog: [],
          catalogComplete: false,
          configuredSources: [{ key: "componentsFrom", path: "ds/index.d.ts" }],
          missingSources: [{ key: "componentsFrom", path: "ds/index.d.ts" }],
        })
      );
      expect(r.reason).toMatch(/no component list was loaded/i);
      expect(r.reason).toContain('componentsFrom "ds/index.d.ts"');
      expect(r.reason).toMatch(/does not exist/);
    });

    test("no component list: says none is configured", () => {
      const [r] = only(full({ catalog: [], catalogComplete: false, configuredSources: [], missingSources: [] }));
      expect(r.reason).toMatch(/no component source is configured/i);
      expect(r.fix).toContain('"componentsFrom"');
    });

    test("no component list: componentsFrom exists but names no components", () => {
      const [r] = only(
        full({
          catalog: [],
          catalogComplete: false,
          configuredSources: [{ key: "componentsFrom", path: "ds/index.d.ts" }],
          missingSources: [],
        })
      );
      expect(r.reason).toMatch(/names no components/);
      expect(r.reason).toContain('componentsFrom "ds/index.d.ts"');
    });

    // The other reason, stated differently: a list exists, but it comes from a
    // hand-written catalog that may leave out compound parts.
    test("a complete list but nothing counting as the system's imports: says so, and names systemImports", () => {
      const [r] = only(full({ systemImports: [] }));
      expect(r.rule).toBe("no-unknown-components");
      expect(r.reason).toMatch(/No import is treated as the design system/);
      expect(r.reason).toContain('"system" is not set and "systemImports" is empty');
      expect(r.fix).toContain('Set "system"');
      expect(r.fix).toContain('"systemImports"');
    });

    test("with both a list problem and no system imports, the list is what is reported first", () => {
      const [r] = only(full({ systemImports: [], catalogComplete: false, configuredSources: [{ key: "catalog", path: "CATALOG.md" }] }));
      expect(r.reason).toMatch(/may leave out compound parts/);
    });

    test("a CATALOG.md list: existence is not asserted, and the fix is componentsFrom", () => {
      const [r] = only(
        full({
          catalogComplete: false,
          configuredSources: [{ key: "catalog", path: "packages/ui/CATALOG.md" }],
          missingSources: [],
        })
      );
      expect(r.reason).toContain("packages/ui/CATALOG.md");
      expect(r.reason).toMatch(/may leave out compound parts/);
      expect(r.reason).not.toMatch(/no component list was loaded/i);
      expect(r.fix).toMatch(/type declarations/);
      expect(r.fix).toContain('"componentsFrom"');
    });

    test("a CATALOG.md list with componentsFrom already set: the fix says the catalog wins", () => {
      const [r] = only(
        full({
          catalogComplete: false,
          configuredSources: [
            { key: "catalog", path: "CATALOG.md" },
            { key: "componentsFrom", path: "ds/index.d.ts" },
          ],
          missingSources: [],
        })
      );
      expect(r.fix).toMatch(/in preference/);
      expect(r.fix).toContain('Remove "catalog"');
    });
  });

  describe("no-raw-elements", () => {
    test("reported for an empty intrinsics map, and not for a populated one", () => {
      const [r] = rulesNotRun(full({ intrinsics: {} }), ["no-raw-elements"]);
      expect(r.rule).toBe("no-raw-elements");
      expect(r.reason).toContain('"intrinsics" is empty');
      expect(r.fix).toContain('"intrinsics"');
      expect(rulesNotRun(full(), ["no-raw-elements"])).toEqual([]);
    });
  });

  describe("no-foreign-ui-imports", () => {
    test("reported for an empty foreignUi list, and not for a populated one", () => {
      const [r] = rulesNotRun(full({ foreignUi: [] }), ["no-foreign-ui-imports"]);
      expect(r.rule).toBe("no-foreign-ui-imports");
      expect(r.reason).toContain('"foreignUi" is empty');
      expect(r.fix).toContain('"foreignUi"');
      expect(rulesNotRun(full(), ["no-foreign-ui-imports"])).toEqual([]);
    });
  });

  test("every reason and every fix is a real sentence with no dash in it", () => {
    const worst = { tokens: {}, catalog: [], catalogComplete: false, intrinsics: {}, foreignUi: [] };
    const variants = [
      worst,
      { ...worst, configuredSources: [{ key: "tokensCss", path: "a.css" }], missingSources: [{ key: "tokensCss", path: "a.css" }] },
      { ...worst, configuredSources: [{ key: "tokensCss", path: "a.css" }] },
      { ...worst, configuredSources: [{ key: "componentsFrom", path: "a.d.ts" }], missingSources: [{ key: "componentsFrom", path: "a.d.ts" }] },
      { ...worst, configuredSources: [{ key: "componentsFrom", path: "a.d.ts" }] },
      { ...full(), catalogComplete: false, configuredSources: [{ key: "catalog", path: "CATALOG.md" }] },
      { ...full(), catalogComplete: false, configuredSources: [{ key: "catalog", path: "CATALOG.md" }, { key: "componentsFrom", path: "a.d.ts" }] },
    ];
    let seen = 0;
    for (const v of variants) {
      for (const r of rulesNotRun(v, INPUT_DEPENDENT)) {
        seen += 1;
        expect(r.reason).toMatch(/\S.*\.$/);
        expect(r.fix).toMatch(/\S.*\.$/);
        expect(`${r.reason} ${r.fix}`).not.toMatch(/[\u2014\u2013]/);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(15);
  });
});

// What is REPORTED as not run and what is SKIPPED must be the same set. The gate
// skips on the predicates unchecked.mjs exports, so it cannot drift. This test is
// the guard on that: whenever rulesNotRun names a rule, source that would break
// the rule produces no violation, and whenever it does not, the source does.
describe("consistency: reported as not run exactly when it produces no violation", () => {
  const SNIPPETS = {
    "no-unknown-tokens": `const a = <div style={{ color: "var(--not-a-token)" }} />;`,
    "no-unknown-components": `import { Rating } from "@acme/ds";\nconst a = <Rating />;`,
    "no-raw-elements": `const a = <button>go</button>;`,
    "no-foreign-ui-imports": `import { Thing } from "@mui/material";`,
  };
  const VARIANTS = {
    "no-unknown-tokens": [
      ["tokens present", {}],
      ["tokens empty", { tokens: {} }],
    ],
    "no-unknown-components": [
      ["complete list", {}],
      ["catalog not known complete", { catalogComplete: false }],
      ["catalogComplete flag missing", { catalogComplete: undefined }],
      ["complete but empty", { catalog: [] }],
      ["no import counts as the system", { systemImports: [] }],
      ["systemImports missing", { systemImports: undefined }],
    ],
    "no-raw-elements": [
      ["intrinsics mapped", {}],
      ["intrinsics empty", { intrinsics: {} }],
    ],
    "no-foreign-ui-imports": [
      ["foreignUi listed", {}],
      ["foreignUi empty", { foreignUi: [] }],
    ],
  };

  for (const rule of INPUT_DEPENDENT) {
    test(`${rule}`, () => {
      const outcomes = new Set();
      for (const [label, over] of VARIANTS[rule]) {
        const contract = full(over);
        const reported = rulesNotRun(contract, [rule]).some((r) => r.rule === rule);
        const violated = gateSource(SNIPPETS[rule], { rules: [rule], contract, fileName: "t.tsx" })
          .some((v) => v.rule === rule);
        expect(violated, `${rule} with ${label}: reported=${reported}, violated=${violated}`).toBe(!reported);
        outcomes.add(reported);
      }
      // not vacuous: the variants cover both a rule that ran and one that did not
      expect([...outcomes].sort()).toEqual([false, true]);
    });
  }

  test("the three input-free rules always run: never reported, always able to violate", () => {
    const empty = { system: "@acme/ds", tokens: {}, catalog: [], intrinsics: {}, foreignUi: [], exemptMarker: "token-exempt" };
    const snippets = {
      "no-raw-colors": `const a = <div style={{ color: "#ff0000" }} />;`,
      "no-arbitrary-values": `const a = <div className="rounded-[8px]" />;`,
      "no-inline-style-values": `const a = <div style={{ padding: 14 }} />;`,
    };
    for (const rule of INPUT_FREE) {
      expect(rulesNotRun(empty, [rule])).toEqual([]);
      const v = gateSource(snippets[rule], { rules: [rule], contract: empty, fileName: "t.tsx" });
      expect(v.some((x) => x.rule === rule), rule).toBe(true);
    }
  });
});

// The run carries the list, so every output can print it.
describe("a gate run carries rulesNotRun", () => {
  function repo(config, files = {}) {
    const root = mkdtempSync(join(tmpdir(), "u-unchecked-"));
    mkdirSync(join(root, "app"), { recursive: true });
    writeFileSync(join(root, "app/a.tsx"), `export const A = () => <div className="bg-primary" />;\n`);
    for (const [rel, body] of Object.entries(files)) writeFileSync(join(root, rel), body);
    writeFileSync(join(root, "undrift.config.json"), JSON.stringify({ system: "@acme/ds", ...config }));
    return root;
  }

  test("gateFiles lists the rules that could not run, with reason and fix", () => {
    const contract = loadContract(
      repo({
        tokensCss: "ds/nope.css",
        profiles: { app: { include: ["app/**/*.tsx"] } },
      })
    );
    const r = gateFiles(["app/**/*.tsx"], { rules: ["no-raw-colors", "no-unknown-tokens"], contract });
    expect(r.files).toBe(1);
    expect(r.rulesNotRun.map((x) => x.rule)).toEqual(["no-unknown-tokens"]);
    expect(r.rulesNotRun[0].reason).toContain('tokensCss "ds/nope.css"');
    expect(r.rulesNotRun[0].fix).toBeTruthy();
  });

  test("gateFiles lists nothing when everything the profile runs has its input", () => {
    const contract = loadContract(
      repo(
        { tokensCss: "ds.css", profiles: { app: { include: ["app/**/*.tsx"] } } },
        { "ds.css": ":root{--color-primary:#3b5bdb}" }
      )
    );
    const r = gateFiles(["app/**/*.tsx"], { rules: ["no-raw-colors", "no-unknown-tokens"], contract });
    expect(r.rulesNotRun).toEqual([]);
  });
});

// Every string this module can print is built here. The runtime tests read the
// ones they exercise; this reads all of them, so a dash cannot hide in a branch no
// test reaches. Chris reads an em dash or an en dash as an AI tell.
// A stylesheet is not read at all, so nothing can be said about what is in it. "Bypass"
// accuses a value of dodging the tokens. The wording is that it is not checked, which is
// all that is known (the never-insults rule: "I cannot detect this" is not "you fail this").
test("no message says that a value in a stylesheet bypasses the tokens", () => {
  for (const file of ["../src/unchecked.mjs", "../hooks/undrift-hook.mjs"]) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    expect(source, file).not.toMatch(/bypass/i);
  }
});

test("unchecked.mjs carries no em dash or en dash anywhere", () => {
  const source = readFileSync(fileURLToPath(new URL("../src/unchecked.mjs", import.meta.url)), "utf8");
  expect(source).not.toMatch(/[\u2014\u2013]/);
});
