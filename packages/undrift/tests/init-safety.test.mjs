// What `undrift init` will not do: crash on a package.json it cannot use, write through a link, write outside
// the repository, overwrite a config without --force, or widen the include to a folder of tests.
import { describe, expect, test } from "vitest";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/init.mjs";
import { app, INLINE_SYSTEM, SIBLING_PACKAGES } from "./support/init-repos.mjs";

const config = (root) => JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8"));

describe("a package.json that cannot be used is a problem that names the file, not a crash", () => {
  test.each([
    ["null", "null", /it is not a JSON object/],
    ["an array", "[]", /it is not a JSON object/],
    ["not JSON", "{ nope", /it is not valid JSON/],
  ])("the system's own is %s", (_label, text, reason) => {
    const root = app({ ...INLINE_SYSTEM, "node_modules/@acme/react/package.json": text });
    const result = runInit(root, "@acme/react");
    expect(result.refused).toBe(true);
    expect(result.problems[0].what).toMatch(/^node_modules\/@acme\/react\/package\.json could not be read: /);
    expect(result.problems[0].what).toMatch(reason);
    expect(existsSync(join(root, "undrift.config.json"))).toBe(false);
  });

  test("a sibling's own is the same, named with its path", () => {
    const root = app({ ...SIBLING_PACKAGES, "node_modules/@acme/card/package.json": "null" });
    const result = runInit(root, "@acme/all");
    expect(result.refused).toBe(true);
    expect(result.problems.map((p) => p.what).join("\n")).toContain("node_modules/@acme/card/package.json could not be read");
  });

  test("forced, it writes what it found from the files that are there", () => {
    const root = app({ ...INLINE_SYSTEM, "node_modules/@acme/react/package.json": "{ nope" });
    runInit(root, "@acme/react", { force: true });
    expect(config(root).componentsFrom).toBe("node_modules/@acme/react/dist/index.d.ts");
  });
});

describe("it does not write through a link, or outside the repository", () => {
  const outside = () => mkdtempSync(join(tmpdir(), "u-outside-"));

  test("a link that points nowhere at the config is refused, forced or not, and nothing is created at its target", () => {
    const root = app(INLINE_SYSTEM);
    const target = join(outside(), "created.json");
    symlinkSync(target, join(root, "undrift.config.json"));
    for (const force of [false, true]) {
      const result = runInit(root, "@acme/react", { force });
      expect(result.refused).toBe(true);
      expect(result.wroteConfig).toBe(false);
      expect(result.problems.at(-1).what).toBe("undrift.config.json is a symbolic link, and init does not write through a link.");
    }
    expect(existsSync(target)).toBe(false);
    expect(lstatSync(join(root, "undrift.config.json")).isSymbolicLink()).toBe(true);
  });

  test("a link at the placeholder is refused the same way, and the config is not written either", () => {
    const root = app(INLINE_SYSTEM);
    const target = join(outside(), "created.tsx");
    mkdirSync(join(root, "components"));
    symlinkSync(target, join(root, "components/undrift-missing.tsx"));
    const result = runInit(root, "@acme/react", { force: true });
    expect(result.refused).toBe(true);
    expect(result.problems.at(-1).what).toMatch(/^components\/undrift-missing\.tsx is a symbolic link/);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(root, "undrift.config.json"))).toBe(false);
  });

  test("a components folder that links out of the repository is refused, and nothing is written there", () => {
    const root = app(INLINE_SYSTEM);
    const elsewhere = outside();
    symlinkSync(elsewhere, join(root, "components"));
    const result = runInit(root, "@acme/react", { force: true });
    expect(result.refused).toBe(true);
    expect(result.problems.at(-1).what).toMatch(/^components\/undrift-missing\.tsx would be written to .*, which is outside /);
    expect(existsSync(join(elsewhere, "undrift-missing.tsx"))).toBe(false);
  });

  test("a folder whose path only starts like the repository's is outside it", () => {
    const root = app(INLINE_SYSTEM);
    const neighbour = `${realpathSync(root)}-neighbour`;
    mkdirSync(neighbour);
    symlinkSync(neighbour, join(root, "components"));
    const result = runInit(root, "@acme/react", { force: true });
    expect(result.refused).toBe(true);
    expect(existsSync(join(neighbour, "undrift-missing.tsx"))).toBe(false);
  });

  test("a components folder that links to another folder of the repository is fine", () => {
    const root = app({ ...INLINE_SYSTEM, "ui/keep.txt": "" });
    symlinkSync(join(root, "ui"), join(root, "components"));
    expect(runInit(root, "@acme/react").refused).toBe(false);
    expect(existsSync(join(root, "ui/undrift-missing.tsx"))).toBe(true);
  });

  test("a link that points nowhere in place of the folder is refused", () => {
    const root = app(INLINE_SYSTEM);
    symlinkSync(join(outside(), "gone"), join(root, "components"));
    const result = runInit(root, "@acme/react", { force: true });
    expect(result.refused).toBe(true);
    expect(result.problems.at(-1).what).toMatch(/is a link that points nowhere/);
  });

  test("a file where the folder should be is refused", () => {
    const root = app({ ...INLINE_SYSTEM, components: "not a folder" });
    const result = runInit(root, "@acme/react", { force: true });
    expect(result.refused).toBe(true);
    expect(result.problems.at(-1).what).toBe("components is not a folder, so components/undrift-missing.tsx cannot be written under it.");
  });
});

describe("an existing config is kept without --force", () => {
  test("not overwritten, said so, and overwritten with --force", () => {
    const root = app(INLINE_SYSTEM);
    const mine = '{ "system": "mine" }\n';
    writeFileSync(join(root, "undrift.config.json"), mine);
    const kept = runInit(root, "@acme/react");
    expect(kept.wroteConfig).toBe(false);
    expect(readFileSync(join(root, "undrift.config.json"), "utf8")).toBe(mine);
    expect(runInit(root, "@acme/react", { force: true }).wroteConfig).toBe(true);
    expect(config(root).system).toBe("@acme/react");
  });
});

describe("a test or a story never widens the include", () => {
  test("a folder outside the defaults whose only importing files are tests, specs and stories is not added", () => {
    const imports = 'import { Button } from "@acme/react";\nexport const t = Button;\n';
    const root = app({
      ...INLINE_SYSTEM,
      "lib/widget.test.tsx": imports,
      "lib/widget.spec.tsx": imports,
      "lib/widget.stories.tsx": imports,
      "lib/plain.ts": "export const plain = 1;\n",
    });
    expect(runInit(root, "@acme/react").includeAdded).toEqual([]);
  });

  test("and a product file in the same folder does add it", () => {
    const root = app({ ...INLINE_SYSTEM, "lib/widget.tsx": 'import { Button } from "@acme/react";\nexport const w = Button;\n' });
    expect(runInit(root, "@acme/react").includeAdded).toEqual(["lib"]);
  });
});
