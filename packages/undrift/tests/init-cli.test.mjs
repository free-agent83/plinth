// `undrift init` on the command line: what a stranger sees. Something that is not a package name
// is a usage error (exit 2) that points a folder at --components. A reading that found nothing is
// said, with its fix, and nothing is written (exit 1). Success says what it covered.
import { describe, expect, test } from "vitest";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { app, cli, DASH, INLINE_SYSTEM, SUBPATH_SYSTEM, NESTED_UNBUILT } from "./support/init-repos.mjs";

describe("usage errors exit 2 and write nothing", () => {
  test.each([
    ["../components/ui", /is a path or an import alias, not a package name.*undrift init --components <folder>/],
    ["@/components/ui", /is a path or an import alias, not a package name/],
    ["./components/ui", /is a path or an import alias/],
    ["@acme/react/button", /is a path inside a package\. Give the package itself: undrift init @acme\/react/],
    ["Not A Name", /is not a package name/],
  ])("%s", (arg, message) => {
    const root = app(INLINE_SYSTEM);
    const r = cli(root, ["init", arg]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(message);
    expect(existsSync(join(root, "undrift.config.json"))).toBe(false);
  });

  test("a package that is not installed points at --components too", () => {
    const r = cli(app(INLINE_SYSTEM), ["init", "@acme/absent"]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/is not installed/);
    expect(r.out).toMatch(/--components <folder>/);
  });
});

describe("what init writes", () => {
  test("the gate runs on it with every input-dependent rule able to run", () => {
    const root = app(SUBPATH_SYSTEM);
    cli(root, ["init", "@acme/parts"]);
    const gate = JSON.parse(cli(root, ["gate", "--format", "json"]).out);
    expect(gate.notChecked.filter((item) => item.kind === "rule")).toEqual([]);
  });
});

describe("a reading that found nothing", () => {
  test("is said, with its fix, exits 1, and writes nothing", () => {
    const root = app({ ...INLINE_SYSTEM, "src/index.css": "body { margin: 0; }\n" });
    const r = cli(root, ["init", "@acme/react"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ No stylesheet in this app, or any stylesheet it imports, declares a custom property");
    expect(r.out).toContain("Import the design system's stylesheet from the app's own CSS");
    expect(r.out).toMatch(/Nothing was written/);
    expect(existsSync(join(root, "undrift.config.json"))).toBe(false);
  });

  test("a refused run says neither that it wrote nor that it kept anything", () => {
    const root = app({ ...INLINE_SYSTEM, "src/index.css": "body { margin: 0; }\n" });
    const r = cli(root, ["init", "@acme/react"]);
    expect(r.out).not.toMatch(/\bwrote\b|kept existing/);
    expect(r.out).not.toMatch(/Rules written/);
  });

  test("--force writes the config with what was found, and exits 0", () => {
    const root = app({ ...INLINE_SYSTEM, "src/index.css": "body { margin: 0; }\n" });
    const r = cli(root, ["init", "@acme/react", "--force"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("✗ No stylesheet");
    expect(existsSync(join(root, "undrift.config.json"))).toBe(true);
  });

  test("every problem is printed with its fix, not only the first", () => {
    const root = app({ ...NESTED_UNBUILT, "src/index.css": "body { margin: 0; }\n" });
    const r = cli(root, ["init", "@acme/nested"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ @acme/nested's component list is not complete");
    expect(r.out).toContain("✗ No stylesheet in this app");
    expect(r.out.match(/Add those packages' declaration entries|Import the design system's stylesheet/g)).toHaveLength(2);
  });

  test("a place init will not write is refused with exit 1, forced or not", () => {
    const root = app(INLINE_SYSTEM);
    symlinkSync(join(root, "gone.json"), join(root, "undrift.config.json"));
    for (const argv of [["init", "@acme/react"], ["init", "@acme/react", "--force"]]) {
      const r = cli(root, argv);
      expect(r.code).toBe(1);
      expect(r.out).toContain("✗ undrift.config.json is a symbolic link, and init does not write through a link.");
      expect(r.out).not.toMatch(/\bwrote\b|kept existing/);
    }
  });
});

describe("a list that was not read in full", () => {
  test("is not counted as if it were: at least N, the problem named, exit 1, nothing written", () => {
    const root = app(NESTED_UNBUILT);
    const r = cli(root, ["init", "@acme/nested"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ @acme/nested's component list is not complete");
    expect(r.out).toMatch(/at least \d+ component\(s\) from node_modules\/@acme\/nested\/dist\/index\.d\.ts/);
    expect(r.out).toContain("Add those packages' declaration entries to componentsFrom");
    expect(existsSync(join(root, "undrift.config.json"))).toBe(false);
  });

  test("a list read in full says how many, without at least", () => {
    expect(cli(app(INLINE_SYSTEM), ["init", "@acme/react"]).out).not.toMatch(/at least/);
  });
});

describe("success", () => {
  test("says where the components and tokens came from, what it covered, and how to adopt", () => {
    const root = app(SUBPATH_SYSTEM);
    const r = cli(root, ["init", "@acme/parts"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("3 component(s) from node_modules/@acme/parts/dist/button/index.d.ts, node_modules/@acme/parts/dist/toast/index.d.ts");
    expect(r.out).toContain("tokens from node_modules/@acme/tw-config/variables.css, node_modules/@acme/tw-config/index.css");
    expect(r.out).toContain("not read as tokens: tailwindcss");
    expect(r.out).toContain("also covers core/, where the app imports the system");
    expect(r.out).toMatch(/UI files: 4, covered 2, excluded on purpose 1, not covered 1/);
    expect(r.out).toContain("not covered: tests/render.tsx");
    expect(r.out).toContain("undrift later --all");
    expect(r.out).toMatch(/wrote .*undrift\.config\.json/);
  });

  test("a config that is already there is kept, and said to be", () => {
    const root = app(SUBPATH_SYSTEM);
    cli(root, ["init", "@acme/parts"]);
    const r = cli(root, ["init", "@acme/parts"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/kept existing .*undrift\.config\.json \(--force to overwrite\)/);
  });

  test("a file the stylesheet reader could not read is a warning, with its file and reason", () => {
    const root = app({
      ...INLINE_SYSTEM,
      "src/index.css": '@import "@acme/broken";\n:root { --x: 1px; }\n',
      "node_modules/@acme/broken/package.json": "{ nope",
    });
    const r = cli(root, ["init", "@acme/react"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/⚠ node_modules\/@acme\/broken\/package\.json could not be read \(.+\), so any tokens in it are not in the list\./);
  });

  test("the families left out of the suggestion are printed on a run that wrote", () => {
    const css = ":root { --n-1: #111; --n-2: #222; --n-3: #333; } .dark { --n-1: #eee; --n-2: #ddd; --n-3: #ccc; }\n";
    const r = cli(app({ ...INLINE_SYSTEM, "src/index.css": css }), ["init", "@acme/react"]);
    expect(r.out).toContain("Not suggested, because each theme re-declares them: --n-*.");
  });

  test("no line of init's output has an em dash or an en dash", () => {
    for (const r of [
      cli(app(SUBPATH_SYSTEM), ["init", "@acme/parts"]),
      cli(app({ ...INLINE_SYSTEM, "src/index.css": "body{}\n" }), ["init", "@acme/react"]),
      cli(app(INLINE_SYSTEM), ["init", "../x"]),
      cli(app(NESTED_UNBUILT), ["init", "@acme/nested"]),
    ]) {
      expect(r.out).not.toMatch(DASH);
    }
  });
});

describe("a refusal that --force cannot lift does not offer it", () => {
  test("a link at the config: the closing line does not say to add --force", () => {
    const root = app(INLINE_SYSTEM);
    symlinkSync(join(root, "gone.json"), join(root, "undrift.config.json"));
    for (const argv of [["init", "@acme/react"], ["init", "@acme/react", "--force"]]) {
      const r = cli(root, argv);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/Nothing was written\. Fix the above and run undrift init again\./);
      expect(r.out).not.toMatch(/--force/);
    }
  });

  test("a reading that found nothing still offers it", () => {
    const r = cli(app({ ...INLINE_SYSTEM, "src/index.css": "body { margin: 0; }\n" }), ["init", "@acme/react"]);
    expect(r.out).toMatch(/or add --force to write the config with what was found/);
  });

  test("a reading that found nothing, run again with --force over a link: the link refusal is the one said", () => {
    const root = app({ ...INLINE_SYSTEM, "src/index.css": "body { margin: 0; }\n" });
    symlinkSync(join(root, "gone.json"), join(root, "undrift.config.json"));
    const r = cli(root, ["init", "@acme/react", "--force"]);
    expect(r.out).toContain("symbolic link");
    expect(r.out).not.toMatch(/or add --force/);
  });
});

describe("advice that two problems carry is printed once", () => {
  test("a package that ships source, with an app import that does not resolve", () => {
    const root = app({
      "package.json": { name: "product" },
      "src/index.css": ":root { --x: 1px; }\n",
      "src/a.tsx": 'import { Gone } from "@acme/ui/gone";\nexport const A = () => <Gone />;\n',
      "node_modules/@acme/ui/package.json": { name: "@acme/ui", exports: { "./*": "./src/components/*.tsx" } },
      "node_modules/@acme/ui/src/components/button.tsx": "export const Button = () => null;\n",
    });
    const r = cli(root, ["init", "@acme/ui"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("\u2717 @acme/ui ships its source and no type declarations");
    expect(r.out).toContain("\u2717 The app imports \"@acme/ui/gone\"");
    expect(r.out.match(/Run undrift init from the repository root/g)).toHaveLength(1);
  });

  test("two problems with different advice each keep theirs", () => {
    const root = app({ ...NESTED_UNBUILT, "src/index.css": "body { margin: 0; }\n" });
    const r = cli(root, ["init", "@acme/nested"]);
    expect(r.out.match(/Add those packages' declaration entries|Import the design system's stylesheet/g)).toHaveLength(2);
  });
});
