import { describe, expect, test } from "vitest";
import { gateSource } from "../src/gate.mjs";

// When there is no trustworthy nearest token, the gate falls back to generic
// advice. That advice used to name `bg-primary` / `text-foreground`,
// which are THIS sample's tokens. Point undrift at another system and it was
// instructing the agent to use utilities that do not exist there: the exact
// "confidently wrong" failure undrift exists to prevent. The examples were then
// taken from the loaded contract, the first three colour tokens in declaration
// order. Those are real names with nothing to do with the colour (the first role
// might be a background for a red text), so an unrelated real name is as bad as
// an invented one. The advice now names none, as the arbitrary-colour advice
// does. Changed 2026-10-04.

const contractFor = (tokens) => ({
  system: "test-system",
  exemptMarker: "token-exempt",
  tokens,
  intrinsics: {},
  foreignUi: [],
  profiles: {},
});

// A colour nothing in these contracts is near, so the nearest-token branch
// stays quiet and we always exercise the fallback.
const FAR_COLOR = "#00ff00";

const fallbackFor = (tokens, raw = FAR_COLOR) => {
  const hit = gateSource(`const c = "${raw}";`, { contract: contractFor(tokens) }).find(
    (v) => v.rule === "no-raw-colors"
  );
  expect(hit).toBeDefined();
  expect(hit.message, "expected the fallback, not a nearest-token match").not.toContain(
    "Nearest token"
  );
  return hit.message;
};

const namesIn = (message) => [...message.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);

describe("the no-nearest-match fallback names no token", () => {
  const basaltShaped = {
    "--color-accent": "light-dark(#0064E0, #2694FE)",
    "--color-text-primary": "light-dark(#0A1317, #DFE2E5)",
    "--color-background-surface": "light-dark(#FFFFFF, #1F1F22)",
    "--font-weight-bold": "700",
    "--spacing-2": "8px",
  };

  const sampleShaped = {
    "--color-primitive-white": "#ffffff",
    "--color-primitive-slate-900": "oklch(0.2077 0.0398 265.7549)",
    "--color-semantic-primary": "oklch(0.5417 0.179 288.0332)",
    "--color-semantic-foreground": "oklch(0.2077 0.0398 265.7549)",
    "--color-semantic-background": "#ffffff",
    "--spacing-4": "16px",
  };

  const shapes = {
    "a Basalt-shaped contract": basaltShaped,
    "the sample-shaped contract": sampleShaped,
    "a colour-valued token with no 'color' in its name": { "--brand-ink": "#0A1317", "--brand-paper": "#ffffff" },
    "an empty token set": {},
    "a token set with no colours at all": { "--spacing-2": "8px", "--font-weight-bold": "700" },
  };

  test("no shape of contract gets an example: not a token, not a utility, not this sample's", () => {
    for (const [name, tokens] of Object.entries(shapes)) {
      const message = fallbackFor(tokens);
      expect(namesIn(message), name).toEqual([]);
      expect(message, name).not.toMatch(/var\(|e\.g\.|bg-|text-|--/);
      for (const token of Object.keys(tokens)) expect(message, name).not.toContain(token);
    }
  });

  test("it says to use a colour role, from the system when it has a name, and to propose one if none fits", () => {
    const message = fallbackFor(basaltShaped);
    expect(message).toContain("Use a colour role from test-system, or its utility, instead of a raw value; if no role fits, propose one.");
    const nameless = gateSource(`const c = "${FAR_COLOR}";`, { contract: { ...contractFor(basaltShaped), system: null } }).find((v) => v.rule === "no-raw-colors");
    expect(nameless.message).toContain("Use a colour role from the token set, or its utility, instead of a raw value; if no role fits, propose one.");
  });

  test("it is still advice, not an empty sentence, and has no em dash", () => {
    for (const tokens of Object.values(shapes)) {
      const message = fallbackFor(tokens);
      expect(message.trim().length).toBeGreaterThan(20);
      expect(message).toContain("token");
      expect(message).not.toContain("\u2014");
    }
  });

  test("a colour that has a nearest token still names it", () => {
    const [hit] = gateSource(`const c = "#0A1317";`, { contract: contractFor({ "--brand-ink": "#0A1317" }) });
    expect(hit.message).toContain("Nearest token: --brand-ink");
  });
});
