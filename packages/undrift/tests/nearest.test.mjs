import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { tokenColorIndex, nearestToken, isColorValue } from "../src/nearest.mjs";
import { readCssTokens } from "../src/readers/css-tokens.mjs";
import { gateSource } from "../src/gate.mjs";

const names = (index) => index.map((t) => t.name);

describe("tokenColorIndex: only unambiguous colours", () => {
  // The regression. culori parses the bare string "700" as the 3-digit hex
  // #700 (dark red), so a font-weight token used to enter the colour index.
  // In a system whose colours are all light-dark()/var(), it won.
  test("a font-weight token is not indexed as a colour", () => {
    const index = tokenColorIndex({
      "--font-weight-normal": "400",
      "--font-weight-medium": "500",
      "--font-weight-semibold": "600",
      "--font-weight-bold": "700",
    });
    expect(index).toEqual([]);
  });

  test("bare numbers and dimensions are excluded", () => {
    const index = tokenColorIndex({
      "--font-weight-bold": "700",
      "--z-index-modal": "400",
      "--spacing-4": "16px",
      "--font-size-lg": "1.5rem",
      "--line-height-tight": "1.2",
      "--opacity-disabled": "0.5",
      "--radius-full": "9999px",
      "--duration-fast": "175ms",
    });
    expect(index).toEqual([]);
  });

  test("hex, colour functions and named colours are indexed", () => {
    const index = tokenColorIndex({
      "--a": "#3b5bdb",
      "--b": "rgb(255,0,0)",
      "--c": "oklch(0.5 0.2 277)",
      "--d": "red",
      "--e": "hsl(20, 76%, 50%)",
    });
    expect(names(index)).toEqual(["--a", "--b", "--c", "--d", "--e"]);
  });

  test("isColorValue recognises the colour syntaxes and rejects the rest", () => {
    for (const v of [
      "#fff", "#3b5bdb", "#3b5bdbcc", "rgb(255,0,0)", "rgba(255,0,0,.5)",
      "hsl(20 76% 50%)", "hwb(20 30% 40%)", "lab(50 40 59)", "lch(50 40 59)",
      "oklab(0.5 0.1 0.1)", "oklch(0.5 0.2 277)", "color(display-p3 1 0 0)",
      "color-mix(in oklch, #fff 50%, #000)", "red", "REBECCAPURPLE",
    ]) {
      expect(isColorValue(v), v).toBe(true);
    }
    for (const v of [
      "700", "400", "16px", "1.5rem", "1.2", "0.5", "9999px", "175ms",
      "", "   ", "var(--color-accent)", "inherit", "transparent", "currentColor",
      "1px solid #fff", "bold", "#", "#12", "#12345",
    ]) {
      expect(isColorValue(v), v).toBe(false);
    }
  });

  test("unresolvable values (var, color-mix) are skipped, not crashed on", () => {
    const index = tokenColorIndex({
      "--color-alias": "var(--color-accent)",
      // recognised as a colour, but culori can't resolve it to a comparable
      // value. It can't be a distance candidate either.
      "--color-mixed": "color-mix(in oklch, #fff 50%, #000)",
      "--color-real": "#0064E0",
    });
    expect(names(index)).toEqual(["--color-real"]);
  });

  test("non-string values are ignored", () => {
    expect(tokenColorIndex({ "--a": 700, "--b": null, "--c": { value: "#fff" } })).toEqual([]);
  });
});

// `light-dark(A, B)` is valid modern CSS that culori cannot resolve, and whole
// design systems (Basalt) declare every colour that way. Index the light-mode
// argument, which is the sensible default, so those tokens become suggestable.
describe("light-dark() resolves to its first (light-mode) argument", () => {
  test("a light-dark value is a colour and indexes as its light argument", () => {
    expect(isColorValue("light-dark(#0064E0, #2694FE)")).toBe(true);
    const index = tokenColorIndex({ "--color-accent": "light-dark(#0064E0, #2694FE)" });
    expect(names(index)).toEqual(["--color-accent"]);
    // Indexed as #0064E0 (light), not #2694FE (dark): an exact match on the
    // light value, and a measurable distance from the dark one.
    expect(nearestToken(index, "#0064E0").distance).toBeLessThan(1);
    expect(nearestToken(index, "#2694FE").distance).toBeGreaterThan(5);
  });

  test("whitespace around the arguments does not matter", () => {
    const index = tokenColorIndex({ "--a": "light-dark( #ffffff , #000000 )" });
    expect(names(index)).toEqual(["--a"]);
    expect(nearestToken(index, "#ffffff").distance).toBeLessThan(1);
  });

  test("splits on the TOP-LEVEL comma, not the first one", () => {
    // The first argument is itself a function containing commas.
    const index = tokenColorIndex({
      "--a": "light-dark(oklch(0.5 0.2 277), #000)",
      "--b": "light-dark(rgba(5, 54, 89, 0.9), rgba(223, 226, 229, 0.2))",
    });
    expect(names(index)).toEqual(["--a", "--b"]);
    expect(nearestToken(index, "oklch(0.5 0.2 277)").name).toBe("--a");
    expect(nearestToken(index, "rgb(5, 54, 89)").name).toBe("--b");
  });

  test("uppercase and nested light-dark are handled", () => {
    const index = tokenColorIndex({
      "--a": "LIGHT-DARK(#ff0000, #00ff00)",
      "--b": "light-dark(light-dark(#0000ff, #ff0000), #00ff00)",
    });
    expect(names(index)).toEqual(["--a", "--b"]);
    expect(nearestToken(index, "#ff0000").name).toBe("--a");
    expect(nearestToken(index, "#0000ff").name).toBe("--b");
  });

  test("an unparseable first argument is skipped, as before", () => {
    expect(
      tokenColorIndex({
        "--a": "light-dark(var(--x), #000)",
        "--b": "light-dark(, #000)",
        "--c": "light-dark(#000)",
        "--d": "light-dark()",
      })
    ).toEqual([{ name: "--c", parsed: expect.anything() }]);
  });

  test("named colours inside light-dark resolve too", () => {
    const index = tokenColorIndex({ "--a": "light-dark(red, blue)" });
    expect(nearestToken(index, "#ff0000").name).toBe("--a");
  });
});

describe("nearestToken", () => {
  const index = tokenColorIndex({
    "--color-primitive-indigo-600": "oklch(0.4568 0.2146 277.0229)",
    "--color-primitive-red-500": "oklch(0.6368 0.2078 25.3313)",
    "--color-primitive-slate-100": "oklch(0.967 0.0029 264.5419)",
  });

  test("a genuinely close colour returns the right token", () => {
    expect(nearestToken(index, "#3b5bdb").name).toBe("--color-primitive-indigo-600");
    expect(nearestToken(index, "rgb(255,0,0)").name).toBe("--color-primitive-red-500");
  });

  test("an empty index returns null rather than throwing", () => {
    expect(nearestToken([], "#ff0000")).toBeNull();
  });

  test("a token set of only non-colours yields an empty index and a null nearest", () => {
    const weightsOnly = tokenColorIndex({ "--font-weight-bold": "700", "--spacing-2": "8px" });
    expect(weightsOnly).toEqual([]);
    expect(nearestToken(weightsOnly, "#ff0000")).toBeNull();
  });

  test("a value that is not a colour is never matched", () => {
    expect(nearestToken(index, "700")).toBeNull();
    expect(nearestToken(index, "16px")).toBeNull();
  });

  test("nothing close enough returns null instead of a noise suggestion", () => {
    const greenOnly = tokenColorIndex({ "--color-green": "#00ff00" });
    expect(nearestToken(greenOnly, "#ff00ff")).toBeNull();
  });
});

// The system that exposed this: every Basalt colour is light-dark(), so culori
// resolves none of them. Four font weights parsed as hex and became the
// entire colour index.
describe("Basalt-shaped systems (colours behind light-dark)", () => {
  const basaltShaped = `
    :root{--color-accent:light-dark(#0064E0, #2694FE);--color-error:light-dark(#E3193B, #F5394F);--color-text-primary:light-dark(#0A1317, #DFE2E5);}
    :root{--font-weight-normal:400;--font-weight-medium:500;--font-weight-semibold:600;--font-weight-bold:700;}
    :root{--spacing-2:8px;--radius-element:8px;--duration-fast:175ms;}
  `;

  const contractFor = (tokens) => ({
    system: "@basalt/ds",
    exemptMarker: "token-exempt",
    tokens,
    intrinsics: {},
    foreignUi: [],
    profiles: {},
  });

  const redHexMessage = (tokens) => {
    const v = gateSource(`const c = "#ff0000";`, { contract: contractFor(tokens) });
    const hit = v.find((x) => x.rule === "no-raw-colors");
    expect(hit).toBeDefined();
    return hit.message;
  };

  test("a raw red hex is pointed at a red token, never at a font weight", () => {
    const message = redHexMessage(readCssTokens(basaltShaped));
    expect(message).not.toContain("font-weight");
    expect(message).toContain("Nearest token: --color-error");
  });

  // Opt-in via environment, with no path written into the file at all. This
  // repository is published, so any hardcoded path here would publish a
  // private directory layout along with it. Point the variable at a real
  // Basalt stylesheet to run this check; without it the test skips.
  //   UNDRIFT_BASALT_CSS=/path/to/@basalt/ds/dist/basalt.css
  const BASALT_CSS = process.env.UNDRIFT_BASALT_CSS ?? "";

  test.skipIf(!existsSync(BASALT_CSS))(
    "the real Basalt stylesheet indexes its colours, and no font weights",
    () => {
      const tokens = readCssTokens(readFileSync(BASALT_CSS, "utf8"));
      expect(Object.keys(tokens).length).toBeGreaterThan(200);

      const index = tokenColorIndex(tokens);
      expect(index.filter((t) => t.name.includes("font-weight"))).toEqual([]);
      // Was 0 before light-dark() was resolved: every Basalt colour hides
      // behind it, so the whole palette was invisible to the matcher.
      expect(index.length).toBeGreaterThan(50);

      const message = redHexMessage(tokens);
      expect(message).not.toContain("font-weight");
      // A plausible RED-ish Basalt token (--color-error is #E3193B in light
      // mode), not a font weight and not merely the least-bad row.
      expect(message).toMatch(/Nearest token: --color-[a-z-]*(red|error)\b/);
      // …and "nearest" means nearest: the suggested token really is the
      // closest thing Basalt has to pure red.
      const suggested = /Nearest token: (--[\w-]+)/.exec(message)[1];
      const best = nearestToken(index, "#ff0000");
      expect(suggested).toBe(best.name);
      expect(best.distance).toBeLessThan(15);
    }
  );
});

test("nearestToken never throws on a colour culori cannot parse (OKLCH regression)", () => {
  // Surfaced 2026-07-23: culori.parse THROWS on some malformed modern-syntax
  // colours rather than returning null, and a production OKLCH source crashed
  // a whole scan. A colour suggestion must degrade to null, never throw.
  const index = tokenColorIndex({ "--color-error": "#e3193b" });
  for (const bad of [
    "oklch()", "oklch(   )", "oklch(bad)", "oklch(0.5 0.2)", "oklch(/ 1)",
    "hsl(", "rgb(1", "color(srgb)", "lab(", "not-a-colour", "#gggggg",
  ]) {
    expect(() => nearestToken(index, bad)).not.toThrow();
  }
});
