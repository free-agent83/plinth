// A suggested primitive is a palette step: a colour, a dimension or a shadow, whose name ends in a step or says
// it is a primitive. A theme role (`--accent`), a component variable (`--toast-enter-duration`) and a colour named
// for where it is used (`--color-sidebar-bg`) have the graph's shape of a primitive and are not one. Once accepted,
// a wrong entry makes the gate call a role "a primitive", which is the wrong advice, so a doubt is left out:
// a missing suggestion costs a person a line of config, and a wrong one costs them the gate's trust.
import { describe, expect, test } from "vitest";
import { suggestPrimitives, runInit } from "../src/init.mjs";
import { app, INLINE_SYSTEM } from "./support/init-repos.mjs";

const suggest = (css) => suggestPrimitives(app({ "t.css": css }), ["t.css"]);

// Every one of these is read by the token graph as a primitive: a literal that a role passes on.
describe("what the token graph reads as a primitive and is not one", () => {
  test("a theme colour a utility reaches through its Tailwind name (--accent, --success)", () => {
    const css =
      ":root { --accent: oklch(0.62 0.19 259); --success: oklch(0.7 0.15 150); --focus: var(--accent); --ok: var(--success);\n" +
      "  --color-accent: var(--accent); --color-success: var(--success); }\n";
    expect(suggest(css)).toEqual([]);
  });

  test("a duration or an easing a component reads (--toast-enter-duration, --ease-out-fluid)", () => {
    const css =
      ":root { --toast-enter-duration: 150ms; --toast-exit-duration: 0.2s; --ease-out-fluid: cubic-bezier(0.32, 0.72, 0, 1);\n" +
      "  --toast-in: var(--toast-enter-duration); --toast-out: var(--toast-exit-duration); --ease: var(--ease-out-fluid); }\n";
    expect(suggest(css)).toEqual([]);
  });

  test("a size a component reads (--scroll-shadow-size)", () => {
    expect(suggest(":root { --scroll-shadow-size: 2rem; --shadow-edge: var(--scroll-shadow-size); }\n")).toEqual([]);
  });

  test("a colour named for where it is used (--color-sidebar-bg)", () => {
    expect(suggest(":root { --color-sidebar-bg: #101014; --sidebar: var(--color-sidebar-bg); }\n")).toEqual([]);
  });

  test("a bare name for a colour with no step (--white, --snow)", () => {
    expect(suggest(":root { --white: #fff; --snow: #f5f5f7; --surface: var(--snow); --paper: var(--white); }\n")).toEqual([]);
  });

  test("a value that is not a colour, a dimension or a shadow (a weight, a number, a keyword, a calc)", () => {
    const css =
      ":root { --font-weight-1: 400; --opacity-1: 0.5; --display-1: block; --calc-1: calc(1px + 2px);\n" +
      "  --a: var(--font-weight-1); --b: var(--opacity-1); --c: var(--display-1); --d: var(--calc-1); }\n";
    expect(suggest(css)).toEqual([]);
  });

  test("a role word with no step is left out even in a palette's namespace, and with a step it is not", () => {
    const css =
      ":root { --color-primary: #335; --color-chart-1: #123; --color-chart-2: #234; --use: var(--color-primary); --c1: var(--color-chart-1); --c2: var(--color-chart-2); }\n";
    expect(suggest(css)).toEqual(["--color-chart-*"]);
  });
});

describe("the shape is the end of the name, and the word is a whole word", () => {
  test("a number in the middle of a name is not a step", () => {
    expect(suggest(":root { --tint-5-soft: #eeeeee; --grid-2-gap: 8px; --a: var(--tint-5-soft); --b: var(--grid-2-gap); }\n")).toEqual([]);
  });

  test("primitives, unprimitive and nonprimitive are not the word primitive", () => {
    expect(suggest(":root { --primitives-bg: #fff; --unprimitive-fg: #000; --a: var(--primitives-bg); --b: var(--unprimitive-fg); }\n")).toEqual([]);
  });

  test("the word primitive, on its own, in a name with no number, is the system saying so", () => {
    expect(suggest(":root { --primitive-ink: #111; --primitive-paper: #fafafa; --a: var(--primitive-ink); --b: var(--primitive-paper); }\n")).toEqual(["--primitive-*"]);
  });
});

describe("what is still suggested", () => {
  test("a numbered colour scale, written by name, and a neutral scale", () => {
    const css = ":root { --blue-500: #3b82f6; --gray-100: #f3f4f6; --bg: var(--gray-100); --fg: var(--blue-500); }\n";
    expect(suggest(css)).toEqual(["--blue-500", "--gray-100"]);
  });

  test("a family of steps, as a glob", () => {
    const css = ":root { --blue-100: #dbeafe; --blue-500: #3b82f6; --blue-900: #1e3a8a; --a: var(--blue-100); --b: var(--blue-500); }\n";
    expect(suggest(css)).toEqual(["--blue-*"]);
  });

  test("Plinth's own naming: --color-primitive-*, a dimension scale and a shadow scale", () => {
    const css =
      ":root { --color-primitive-indigo-700: oklch(0.39 0.17 277); --color-primitive-white: #ffffff;\n" +
      "  --dimension-radius-none: 0px; --dimension-radius-sm: 4px; --dimension-spacing-1: 4px; --dimension-spacing-2: 8px;\n" +
      "  --shadow-primitive-sm: 0 1px 2px rgba(0, 0, 0, 0.05); --shadow-primitive-md: 0 4px 6px rgba(0, 0, 0, 0.1);\n" +
      "  --color-semantic-primary: var(--color-primitive-indigo-700); --color-semantic-surface: var(--color-primitive-white);\n" +
      "  --r: var(--dimension-radius-sm);\n" +
      "  --r0: var(--dimension-radius-none); --s1: var(--dimension-spacing-1); --s2: var(--dimension-spacing-2);\n" +
      "  --sh: var(--shadow-primitive-sm); --sh2: var(--shadow-primitive-md); }\n";
    // `--dimension-radius-none` and `-sm` carry neither a number nor the word primitive: left out, and the
    // spacing steps beside them are written as their own family, never as `--dimension-*`, which would reach them.
    expect(suggest(css)).toEqual(["--color-primitive-*", "--dimension-spacing-*", "--shadow-*"]);
  });

  test("a spacing step in the t-shirt sizes is left out, and a numbered one is not", () => {
    expect(suggest(":root { --space-sm: 8px; --space-md: 16px; --a: var(--space-sm); --b: var(--space-md); }\n")).toEqual([]);
    expect(suggest(":root { --space-1: 8px; --space-2: 16px; --a: var(--space-1); --b: var(--space-2); }\n")).toEqual(["--space-*"]);
  });
});

describe("a family is never written as a glob that would reach a name that was left out", () => {
  test("a role beside the steps of its own namespace stays out of the glob", () => {
    const css =
      ":root { --toast-1: 4px; --toast-2: 8px; --toast-enter-duration: 150ms; --a: var(--toast-1); --b: var(--toast-2); --c: var(--toast-enter-duration); }\n";
    expect(suggest(css)).toEqual(["--toast-1", "--toast-2"]);
  });
});

describe("on a whole app shaped like a theme of roles", () => {
  const THEME_OF_ROLES =
    ":root {\n" +
    "  --white: #fff; --snow: #f5f5f7; --eclipse: #0d0d0f;\n" +
    "  --accent: oklch(0.62 0.19 259); --success: oklch(0.7 0.15 150);\n" +
    "  --toast-enter-duration: 150ms; --scroll-shadow-size: 2rem; --ease-out-fluid: cubic-bezier(0.32, 0.72, 0, 1);\n" +
    "  --background: var(--snow); --focus: var(--accent); --ok: var(--success); --in: var(--toast-enter-duration);\n" +
    "  --edge: var(--scroll-shadow-size); --ease: var(--ease-out-fluid); --ink: var(--eclipse); --paper: var(--white);\n" +
    "}\n" +
    "@theme inline { --color-accent: var(--accent); --color-success: var(--success); --color-background: var(--background); }\n";

  test("init writes no primitives", () => {
    const root = app({ ...INLINE_SYSTEM, "src/index.css": THEME_OF_ROLES });
    const result = runInit(root, "@acme/react");
    expect(result.primitives).toEqual([]);
  });
});
