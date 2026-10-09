// init ignores a stylesheet only when it can vouch for it. A name a glob reads as syntax is escaped, so the
// entry matches that file and no other.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../src/init.mjs";
import { app, cli, DASH, INLINE_SYSTEM } from "./support/init-repos.mjs";

const config = (root) => JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8"));

describe("a file name a glob reads as syntax", () => {
  test("a wiring-only file named styles/*.css is ignored by its own name, and styles/b.css is not ignored with it", () => {
    const root = app({ ...INLINE_SYSTEM, "styles/*.css": '@import "tailwindcss";\n', "styles/b.css": ".danger { border-color: #e5484d; }\n" });
    const result = runInit(root, "@acme/react");
    expect(Object.keys(config(root).ignore)).toContain("styles/\\*.css");
    expect(result.coverage.stylesheets).toMatchObject({ found: 3, ignored: 2, notChecked: 1 });
    expect(result.coverage.stylesheetsNotChecked).toEqual(["styles/b.css"]);
  });

  test("a file named !x.css is ignored by its own name and not read as a negation", () => {
    const root = app({ ...INLINE_SYSTEM, "!x.css": '@import "tailwindcss";\n', "y.css": ".danger { border-color: #e5484d; }\n" });
    const result = runInit(root, "@acme/react");
    expect(Object.keys(config(root).ignore)).toContain("\\!x.css");
    expect(result.coverage.stylesheetsNotChecked).toEqual(["y.css"]);
  });
});

describe("a stylesheet init cannot vouch for stays reported", () => {
  const reported = (css) => {
    const root = app({ ...INLINE_SYSTEM, "styles/x.css": css });
    return runInit(root, "@acme/react", { force: true }).coverage.stylesheetsNotChecked;
  };

  test.each([
    ["braces in strings around a rule", ':root { --a: "{" } .danger { color: #e5484d } :root { --b: "}" }'],
    ["comment markers in two strings around a rule", '.a::before { content: "/*"; } .danger { color: #e5484d } .b::before { content: "*/"; }'],
    ["a layer statement before a rule", "@layer base;\n.danger { --x: 1 }"],
    ["@source inline", '@source inline("bg-[#e5484d]");'],
    ["a class holding a custom property", ".card { --x: 1px; }"],
    ["braces that do not balance", ":root { --a: 1;"],
  ])("%s", (_label, css) => {
    expect(reported(css)).toEqual(["styles/x.css"]);
  });

  test("and one that is only wiring or only tokens is ignored", () => {
    expect(reported('@import "tailwindcss";')).toEqual([]);
    expect(reported(":root { --x: 1px; }\n.dark { --x: 2px; color-scheme: dark }")).toEqual([]);
  });

  test("a stylesheet nested twenty thousand deep does not stop init", () => {
    const depth = 20000;
    const css = "@media (min-width: 1px) {".repeat(depth) + ":root { --x: 1px }" + "}".repeat(depth);
    expect(() => reported(css)).not.toThrow();
  });
});

// A component library's built stylesheets hold the tokens, and the app's own stylesheet imports Tailwind and declares
// none. The gate reads Tailwind's own variables from the stylesheet that imports it, so init lists that one as well.
describe("the stylesheet that imports Tailwind is listed when the tokens are elsewhere", () => {
  const TAILWIND_4 = {
    "node_modules/tailwindcss/package.json": { name: "tailwindcss", version: "4.3.3" },
    "node_modules/tailwindcss/theme.css": "@theme default { --spacing: 0.25rem; }\n",
  };
  const written = (files) => {
    const root = app({ ...INLINE_SYSTEM, ...files });
    const result = runInit(root, "@acme/react");
    return { result, config: config(root) };
  };

  test("src/index.css is in tokensCss when Tailwind 4 is installed and the listed files do not reach it", () => {
    const { result, config: written_ } = written(TAILWIND_4);
    expect(result.tokensCss).toContain("src/index.css");
    expect([written_.tokensCss].flat()).toContain("src/index.css");
    // The library's own token files are still listed.
    expect(result.tokensCss.some((file) => file.includes("@acme/styles"))).toBe(true);
  });

  test("init says it was added because it loads Tailwind's theme, and does not call it a source of tokens", () => {
    const root = app({ ...INLINE_SYSTEM, ...TAILWIND_4 });
    const r = cli(root, ["init", "@acme/react"]);
    expect(r.code).toBe(0);
    const tokensLine = r.out.split("\n").find((line) => line.includes("tokens from"));
    expect(tokensLine).not.toContain("src/index.css");
    expect(tokensLine).toContain("@acme/styles");
    const added = r.out.split("\n").find((line) => line.includes("src/index.css") && !line.includes("tokens from"));
    expect(added).toMatch(/loads Tailwind's theme/);
    expect(added).toMatch(/declares no tokens/);
    expect(r.out).not.toMatch(DASH);
    // The result says which one it is, and the ignore entry keeps the stylesheet from being reported as not checked,
    // with a reason that says why it is also listed in tokensCss.
    const result = runInit(app({ ...INLINE_SYSTEM, ...TAILWIND_4 }), "@acme/react");
    expect(result.tailwindStylesheet).toBe("src/index.css");
    expect(result.ignore["src/index.css"]).toMatch(/^wiring only/);
    expect(result.ignore["src/index.css"]).toMatch(/loads Tailwind's theme/);
  });

  test("a stylesheet that declares tokens is a source of tokens, and is not said to be added for Tailwind", () => {
    const root = app({ ...INLINE_SYSTEM, ...TAILWIND_4, "src/index.css": '@import "tailwindcss";\n@import "@acme/styles";\n:root { --brand: #fff; }\n' });
    expect(runInit(root, "@acme/react").tailwindStylesheet).toBeNull();
    const r = cli(app({ ...INLINE_SYSTEM, ...TAILWIND_4, "src/index.css": '@import "tailwindcss";\n:root { --brand: #fff; }\n' }), ["init", "@acme/react"]);
    expect(r.out).not.toMatch(/loads Tailwind's theme/);
  });

  test("it is not listed twice, nor when a listed stylesheet already reaches Tailwind", () => {
    const { result } = written({ ...TAILWIND_4, "src/index.css": '@import "tailwindcss";\n@import "@acme/styles";\n:root { --brand: #fff; }\n' });
    expect(result.tokensCss.filter((file) => file === "src/index.css")).toEqual(["src/index.css"]);
    const reached = written({
      ...TAILWIND_4,
      "node_modules/@acme/styles/dist/themes/shared/theme.css": '@import "tailwindcss";\n@theme { --radius-md: 0.5rem; }\n',
    });
    expect(reached.result.tokensCss).not.toContain("src/index.css");
  });

  test("it is not listed when Tailwind cannot be read from it (not installed, or not version 4)", () => {
    expect(written({}).result.tokensCss).not.toContain("src/index.css");
    const three = { "node_modules/tailwindcss/package.json": { name: "tailwindcss", version: "3.4.17" } };
    expect(written(three).result.tokensCss).not.toContain("src/index.css");
  });
});
