// The contrast gate.
//
// Accessibility is usually audited: someone runs a checker, finds problems, and
// files them. This makes it a property of the token layer instead. A binding
// that puts unreadable text on a surface does not get found later, it fails the
// build, in the same way an off-spec variant fails to compile.
//
// That is the same argument the rest of the system makes, applied to contrast:
// the point is not to catch mistakes but to make this particular mistake
// unavailable. It is also the only accessibility property that CAN be settled
// here, because it depends on nothing but the two colours. Focus order, names
// and roles need a rendered tree, and are gated in the components package.
//
// This test found three real failures on its first run, all in the default
// light theme: primary/primary-foreground at 4.47, muted/muted-foreground at
// 4.39, and destructive/destructive-foreground at 3.76. Each passed for large
// text and failed for body text, which is what a button label is.
import { test, expect, describe } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { wcagContrast } from "culori";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "../src/theme");
const PRIMITIVES = JSON.parse(readFileSync(join(HERE, "../dist/json/tokens.json"), "utf8"));

// WCAG 2.2 minimums for text against its own background.
//   AA  (4.5:1) is the legal floor almost everywhere, and the floor for body text.
//   AAA (7:1) is what a theme offered AS a high-contrast option has to clear,
//               otherwise it is a different palette rather than an accessible one.
const AA = 4.5;
const AAA = 7;

const REQUIRED = { default: AA, contrast: AAA };

/** `{color.primitive.slate.800}` to the resolved value in the built output. */
const resolveRef = (ref) => PRIMITIVES[`--${String(ref).replace(/[{}]/g, "").replace(/\./g, "-")}`];

const semanticsOf = (file) => {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return Object.fromEntries(
    Object.entries(raw.color?.semantic ?? {}).map(([k, v]) => [k, resolveRef(v.$value)])
  );
};

/** Every `X` that has a matching `X-foreground` is a surface with text on it,
 *  plus the page itself. Derived from the token names rather than listed here,
 *  so a new status role is covered the day it is added and cannot be forgotten. */
const textPairs = (tokens) => {
  const pairs = Object.keys(tokens)
    .filter((k) => k.endsWith("-foreground"))
    .map((fg) => [fg.replace(/-foreground$/, ""), fg])
    .filter(([bg]) => tokens[bg]);
  return [["background", "foreground"], ...pairs];
};

const authoredThemes = readdirSync(SRC, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => {
    const light = join(SRC, name, "light.tokens.json");
    return existsSync(light) && Object.keys(semanticsOf(light)).length > 0;
  });

test("there are authored themes to check", () => {
  // Without this, a glob that stopped matching would report a serene pass over
  // an empty list.
  expect(authoredThemes.length).toBeGreaterThan(0);
  expect(authoredThemes).toContain("default");
});

describe.each(authoredThemes)("theme: %s", (theme) => {
  const minimum = REQUIRED[theme] ?? AA;

  describe.each(["light", "dark"])("%s", (mode) => {
    const file = join(SRC, theme, `${mode}.tokens.json`);
    const tokens = existsSync(file) ? semanticsOf(file) : {};
    const pairs = textPairs(tokens);

    test("has semantic tokens", () => {
      expect(Object.keys(tokens).length).toBeGreaterThan(0);
    });

    test.each(pairs)(`%s / %s clears ${minimum}:1`, (bg, fg) => {
      const ratio = wcagContrast(tokens[bg], tokens[fg]);
      expect(
        Number(ratio.toFixed(2)),
        `${theme}/${mode}: ${bg} (${tokens[bg]}) against ${fg} (${tokens[fg]}) ` +
          `is ${ratio.toFixed(2)}:1, below the ${minimum}:1 this theme promises. ` +
          `Rebind one of them to a primitive further along its ramp.`
      ).toBeGreaterThanOrEqual(minimum);
    });
  });
});
