// A stylesheet import that could not be followed may be where part of the token layer lives. init says so every
// time, as a warning (it does not refuse and does not change the exit code), and not only when it found no
// tokens at all: "clean means checked" needs a line wherever the reading was less than the whole.
import { describe, expect, test } from "vitest";
import { runInit } from "../src/init.mjs";
import { app, cli, INLINE_SYSTEM, IN_APP_FOLDER } from "./support/init-repos.mjs";

const tokens = (extra) => ({ ...INLINE_SYSTEM, "src/index.css": `${extra}\n:root { --x: 1px; }\n` });
const warned = (result) => result.warnings.filter((w) => w.startsWith("not followed:"));

describe("an import in a stylesheet that could not be followed", () => {
  test("is said with where it was written, though tokens were found elsewhere, and init still writes", () => {
    const root = app(tokens('@import "@acme/missing/styles.css";'));
    const result = runInit(root, "@acme/react");
    expect(warned(result)).toEqual(["not followed: @acme/missing/styles.css (from src/index.css), so any tokens in it are not in the list."]);
    expect(result.refused).toBe(false);
    expect(result.wroteConfig).toBe(true);
  });

  test("an import from a script is said as well, with the script", () => {
    const root = app({ ...tokens(""), "src/main.tsx": 'import "@acme/theme/dist/style.css";\nexport const m = 1;\n' });
    expect(warned(runInit(root, "@acme/react"))).toEqual(["not followed: @acme/theme/dist/style.css (from src/main.tsx), so any tokens in it are not in the list."]);
  });

  test("several are said together, three named and the rest counted, and in the plural", () => {
    const imports = ["a", "b", "c", "d", "e"].map((n) => `@import "@acme/${n}/styles.css";`).join("\n");
    const root = app(tokens(imports));
    expect(warned(runInit(root, "@acme/react"))).toEqual([
      "not followed: @acme/a/styles.css (from src/index.css), @acme/b/styles.css (from src/index.css), @acme/c/styles.css (from src/index.css) and 2 more, so any tokens in them are not in the list.",
    ]);
  });

  test("two are said without a count, and in the plural", () => {
    const root = app(tokens('@import "@acme/a/styles.css";\n@import "@acme/b/styles.css";'));
    expect(warned(runInit(root, "@acme/react"))).toEqual([
      "not followed: @acme/a/styles.css (from src/index.css) and @acme/b/styles.css (from src/index.css), so any tokens in them are not in the list.",
    ]);
  });

  test("an import that leads to a file of the app through its alias is followed, and says nothing", () => {
    const root = app({
      ...tokens(""),
      "tsconfig.json": { compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } },
      "src/main.tsx": 'import "@/styles/globals.css";\nexport const m = 1;\n',
      "styles/globals.css": ":root { --y: 2px; }\n",
    });
    const result = runInit(root, "@acme/react");
    expect(warned(result)).toEqual([]);
    expect(result.tokensCss).toContain("styles/globals.css");
  });

  test("an alias that leads nowhere is said", () => {
    const root = app({
      ...tokens(""),
      "tsconfig.json": { compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } },
      "src/main.tsx": 'import "@/styles/gone.css";\nexport const m = 1;\n',
    });
    expect(warned(runInit(root, "@acme/react"))).toEqual(["not followed: @/styles/gone.css (from src/main.tsx), so any tokens in it are not in the list."]);
  });

  test("the same import written twice in one file is said once", () => {
    const root = app({ ...tokens(""), "src/main.tsx": 'import "@acme/theme/style.css";\nimport "@acme/theme/style.css";\nexport const m = 1;\n' });
    expect(warned(runInit(root, "@acme/react"))).toEqual(["not followed: @acme/theme/style.css (from src/main.tsx), so any tokens in it are not in the list."]);
  });

  describe("an alias in every form tsconfig can write it", () => {
    const withAlias = (paths, compilerOptions, extra) =>
      app({
        ...tokens(""),
        "tsconfig.json": { compilerOptions: { baseUrl: ".", ...compilerOptions, paths } },
        ...extra,
      });

    test("an exact alias for a file", () => {
      const root = withAlias({ "@theme.css": ["./styles/theme.css"] }, {}, { "src/main.tsx": 'import "@theme.css";\n', "styles/theme.css": ":root { --t: 1px; }\n" });
      const result = runInit(root, "@acme/react");
      expect(warned(result)).toEqual([]);
      expect(result.tokensCss).toContain("styles/theme.css");
    });

    test("a star with something after it", () => {
      const root = withAlias({ "@/*.css": ["./styles/*.css"] }, {}, { "src/main.tsx": 'import "@/theme.css";\n', "styles/theme.css": ":root { --t: 1px; }\n" });
      expect(warned(runInit(root, "@acme/react"))).toEqual([]);
    });

    test("a pattern whose end is not the import's end does not match it", () => {
      // Reading the star with the suffix cut off anyway would fill it with "them" and find styles/them.css.
      const root = withAlias({ "@/*.scss": ["./styles/*.css"] }, {}, { "src/main.tsx": 'import "@/theme.css";\n', "styles/them.css": ":root { --t: 1px; }\n" });
      expect(warned(runInit(root, "@acme/react"))).toEqual(["not followed: @/theme.css (from src/main.tsx), so any tokens in it are not in the list."]);
    });

    test("a baseUrl other than the root, and a jsconfig.json", () => {
      const root = app({
        ...tokens(""),
        "jsconfig.json": { compilerOptions: { baseUrl: "src", paths: { "@/*": ["./*"] } } },
        "src/main.tsx": 'import "@/styles/theme.css";\n',
        "src/styles/theme.css": ":root { --t: 1px; }\n",
      });
      expect(warned(runInit(root, "@acme/react"))).toEqual([]);
    });

    test("a target that is a folder, or is not there, is not a file", () => {
      const root = withAlias({ "@/*": ["./nope/*", "./styles/*"] }, {}, { "src/main.tsx": 'import "@/dir.css";\n', "styles/dir.css/x": "" });
      expect(warned(runInit(root, "@acme/react"))).toEqual(["not followed: @/dir.css (from src/main.tsx), so any tokens in it are not in the list."]);
    });
  });

  test("a remote import, and Tailwind's own, are not warned about", () => {
    const root = app(tokens('@import url("https://fonts.example/css?family=X");\n@import "tailwindcss";'));
    expect(warned(runInit(root, "@acme/react"))).toEqual([]);
  });

  test("nothing is said when every import was followed", () => {
    expect(warned(runInit(app(INLINE_SYSTEM), "@acme/react"))).toEqual([]);
  });
});

describe("the command", () => {
  test("prints it as a warning and exits 0", () => {
    const r = cli(app(tokens('@import "@acme/missing/styles.css";')), ["init", "@acme/react"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("⚠ not followed: @acme/missing/styles.css (from src/index.css), so any tokens in it are not in the list.");
  });

  test("when no tokens were found at all, the problem and the warning each say it, and neither repeats the other", () => {
    const root = app({ ...INLINE_SYSTEM, "src/index.css": '@import "@acme/missing/styles.css";\nbody { margin: 0; }\n' });
    const r = cli(root, ["init", "@acme/react"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("not followed: @acme/missing/styles.css (from src/index.css)");
    expect(r.out.match(/@acme\/missing\/styles\.css/g)).toHaveLength(1);
    expect(r.out).toContain("No stylesheet in this app, or any stylesheet it imports, declares a custom property.");
  });
});

describe("a folder of components", () => {
  test("says it too", () => {
    const root = app({ ...IN_APP_FOLDER, "app/globals.css": '@import "@acme/missing/styles.css";\n:root { --x: 1px; }\n' });
    expect(warned(runInit(root, null, { components: "components/ui" }))).toEqual([
      "not followed: @acme/missing/styles.css (from app/globals.css), so any tokens in it are not in the list.",
    ]);
  });
});
