// A token that holds bare channels (`--ch: 220 14% 96%`) is only valid inside a colour function that takes channels
// (`hsl(var(--ch))`). Where a whole colour is expected, an arm of `color-mix()`, an arm of `light-dark()` or the origin
// of a relative colour (`rgb(from var(--ch) r g b / 50%)`), the value is not a colour and the browser drops the
// declaration. The mirror image of `hsl(var(--chart-1))` around a whole colour.
//
// Known in every theme to hold channels: a violation under no-raw-colors, naming the token and the wrapping function.
// Its value cannot be followed: listed as not checked, never a violation. A whole colour, or channels in some themes
// and a whole colour in others, makes no claim. A name no stylesheet declares is no-unknown-tokens' to say.
import { expect, test } from "vitest";
import { gateSourceWithGaps } from "../src/gate.mjs";
import { tokenLayers } from "../src/layers.mjs";

const rows = [
  ["--ch", "220 14% 96%"], ["--ch-chain", "var(--ch)"], ["--whole", "oklch(0.5 0.1 200)"], ["--other-ch", "0.5 0.1 200"],
  ["--unread", "var(--missing)"], ["--through", "var(--unread)"],
  ["--mixed", "220 14% 96%"], ["--mixed", "oklch(0.5 0.1 200)"],
  ["--half", "220 14% 96%"], ["--half", "var(--missing)"],
  ["--whole-half", "oklch(0.5 0.1 200)"], ["--whole-half", "var(--missing)"],
  ["--fb", "var(--undeclared, red)"],
  // the shapes bare channels may take: none, an alpha, commas, an angle in each unit, percentages
  ["--n-none", "220 none 96%"], ["--n-alpha", "220 14% 96% / 0.5"], ["--n-comma", "220, 14%, 96%"], ["--n-comma-alpha", "220, 14%, 96%, 0.5"],
  ["--n-deg", "220deg 14% 96%"], ["--n-grad", "244grad 14% 96%"], ["--n-rad", "3.8rad 14% 96%"], ["--n-turn", "0.6turn 14% 96%"],
  ["--n-percent", "50% 14% 96%"],
  // one token in two themes: the first value is the one shown and the one the wrapping function is chosen from
  ["--themed-hsl-first", "220 14% 96%"], ["--themed-hsl-first", "0.5 0.1 200"],
  ["--themed-other-first", "0.5 0.1 200"], ["--themed-other-first", "220 14% 96%"],
  ["--other-ch-2", "0.7 0.2 30"],
];
const contract = {
  system: "@acme/ds", tokens: Object.fromEntries(rows), layers: tokenLayers(rows),
  intrinsics: {}, foreignUi: [], exemptMarker: "token-exempt", catalog: [],
};
const RULES = ["no-raw-colors", "no-unknown-tokens"];
const gate = (src, c = contract, rules = RULES) => gateSourceWithGaps(src, { contract: c, fileName: "t.tsx", rules });
const messages = (src, c, rules) => gate(src, c, rules).violations.map((v) => v.message);
const whys = (src, c, rules) => gate(src, c, rules).notChecked.map((n) => n.why);

const CASES = [
  ["a mix with transparent", "color-mix(in oklch, var(--ch), transparent)"],
  ["a mix with a percentage and another token", "color-mix(in oklch, var(--whole) 50%, var(--ch))"],
  ["a mix in the srgb space, the percentage first", "color-mix(in srgb, 30% var(--ch), currentColor)"],
  ["a relative colour", "rgb(from var(--ch) r g b / 50%)"],
  ["a relative colour in the hsl form", "hsl(from var(--ch) h s l)"],
  ["a relative colour through color()", "color(from var(--ch) srgb r g b)"],
  ["a light-dark", "light-dark(var(--ch), var(--whole))"],
  ["a light-dark, the second arm", "light-dark(var(--whole), var(--ch))"],
  ["a token that points at the channels", "color-mix(in oklch, var(--ch-chain), transparent)"],
  ["the functions in capitals", "COLOR-MIX(IN OKLCH, VAR(--ch), TRANSPARENT)"],
  ["a Tailwind arbitrary value", "bg-[color-mix(in_oklch,var(--ch),transparent)]"],
];

test.each(CASES)("channels where a whole colour is expected: %s", (_title, value) => {
  const r = gate(`const c = "${value}";`);
  expect(r.violations.map((v) => v.rule)).toEqual(["no-raw-colors"]);
  expect(r.notChecked).toEqual([]);
});

test("the message names the token, what it holds and the fix", () => {
  const [m] = messages('const c = "color-mix(in oklch, var(--ch), transparent)";');
  expect(m).toContain("uses --ch where a whole colour is expected, but --ch holds bare channels (220 14% 96%)");
  expect(m).toContain("so the value is not a colour and the property computes as unset (inherited, or its initial value).");
  expect(m).toContain("Wrap it: hsl(var(--ch)). The channels of --ch are hue, saturation and lightness, so hsl takes them.");
  expect(m).not.toMatch(/Raw colour|browser drops/);
  expect(m).not.toContain(")) (");
});

test("the wrapping function is hsl when the channels say so, and hsl said to be assumed when they do not", () => {
  const [other] = messages('const c = "rgb(from var(--other-ch) r g b / 50%)";');
  expect(other).toContain("Wrap it: hsl(var(--other-ch)). Hsl is assumed for --other-ch, because the channels do not read as hue, saturation and lightness. Use the colour function that matches them.");
  expect(other).not.toContain("are hue, saturation and lightness, so hsl takes them");
});

test("two tokens in one call are named in one violation", () => {
  const rowsTwo = [...rows, ["--ch2", "10 20% 30%"]];
  const c = { ...contract, tokens: Object.fromEntries(rowsTwo), layers: tokenLayers(rowsTwo) };
  const r = gate('const c = "color-mix(in oklch, var(--ch), var(--ch2))";', c);
  expect(r.violations).toHaveLength(1);
  expect(r.violations[0].message).toContain("uses --ch and --ch2 where a whole colour is expected");
  expect(r.violations[0].message).toContain("Wrap each: hsl(var(--ch)), hsl(var(--ch2)). The channels of --ch and --ch2 are hue, saturation and lightness, so hsl takes them.");
});

test("a whole colour, or channels in some themes and a whole colour in others, makes no claim", () => {
  for (const value of [
    "color-mix(in oklch, var(--whole), transparent)", "color-mix(in oklch, var(--mixed), transparent)",
    "rgb(from var(--whole) r g b / 50%)", "rgb(from var(--mixed) r g b / 50%)",
    "light-dark(var(--whole), var(--mixed))", "color-mix(in oklch, var(--whole-half), transparent)",
  ]) {
    expect(gate(`const c = "${value}";`), value).toMatchObject({ violations: [], notChecked: [] });
  }
});

test("channels where channels are taken are fine, and so is a colour that is not a token", () => {
  for (const value of ["hsl(var(--ch))", "hsl(var(--ch) / 0.5)", "hsl(var(--ch-chain) / 50%)", "color-mix(in oklch, currentColor, transparent)"]) {
    expect(gate(`const c = "${value}";`), value).toMatchObject({ violations: [], notChecked: [] });
  }
});

test("a fallback behind a token that is declared with channels does not make the use valid", () => {
  const r = gate('const c = "color-mix(in oklch, var(--ch, var(--whole)), transparent)";');
  expect(r.violations.map((v) => v.message)).toEqual([expect.stringContaining("--ch holds bare channels")]);
});

test("a token whose value cannot be followed is listed in each position, and is no violation", () => {
  for (const value of [
    "color-mix(in oklch, var(--unread), transparent)", "color-mix(in oklch, var(--through) 40%, var(--whole))",
    "rgb(from var(--unread) r g b / 50%)", "light-dark(var(--unread), var(--whole))", "light-dark(var(--whole), var(--through))",
    "color-mix(in oklch, var(--half), transparent)",
  ]) {
    const r = gate(`const c = "${value}";`);
    expect(r.violations, value).toEqual([]);
    expect(r.notChecked.map((n) => n.why), value).toEqual(["unreadToken"]);
  }
});

test("the stops of a listed value say where each walk ended", () => {
  const [n] = gate('const c = "color-mix(in oklch, var(--through), transparent)";').notChecked;
  expect(n.stops).toEqual([{ path: ["--through", "--unread", "--missing"] }]);
  expect(n.found).toBe("color-mix(in oklch, var(--through), transparent)");
});

test("an undeclared name is no-unknown-tokens' to say, and is not listed a second time", () => {
  const r = gate('const c = "color-mix(in oklch, var(--not-declared), transparent)";');
  expect(r.violations.map((v) => `${v.rule} ${v.found}`)).toEqual(["no-unknown-tokens --not-declared"]);
  expect(r.notChecked).toEqual([]);
  expect(whys('const c = "color-mix(in oklch, var(--not-declared), transparent)";', contract, ["no-raw-colors"])).toEqual(["unreadToken"]);
  expect(whys('const c = "light-dark(var(--not-declared), var(--whole))";', contract, ["no-raw-colors"])).toEqual(["unreadToken"]);
});

test("a name the code sets is listed, with the advice that fits it", () => {
  const r = gate('const box = { "--brand": "red" }; const c = "color-mix(in oklch, var(--brand), transparent)";');
  expect(r.violations).toEqual([]);
  expect(r.notChecked.map((n) => [n.why, n.stops])).toEqual([["unreadToken", [{ path: ["--brand"], code: true }]]]);
});

test("the person's exemption comes first, for a violation and for a listing", () => {
  const bad = gate('const c = "color-mix(in oklch, var(--ch), transparent)"; // token-exempt: channels on purpose');
  expect(bad).toMatchObject({ violations: [], notChecked: [] });
  expect(bad.exemptions).toHaveLength(1);
  const unread = gate('const c = "light-dark(var(--unread), var(--whole))"; // token-exempt: the theme file sets it');
  expect(unread).toMatchObject({ violations: [], notChecked: [] });
});

test("a light-dark is read where a colour function is not: in a style object and bare", () => {
  const r = gate('const s = { color: "light-dark(var(--ch), var(--whole))" };\nconst t = <div style={{ background: "light-dark(var(--whole), var(--ch))" }} />;');
  expect(r.violations.map((v) => v.line)).toEqual([1, 2]);
});

test("a light-dark inside a mix is read once, not twice", () => {
  const r = gate('const c = "color-mix(in oklch, light-dark(var(--ch), var(--whole)), transparent)";');
  expect(r.violations).toHaveLength(1);
});

test("a raw colour around it is reported as raw, and the channels inside it as channels", () => {
  const r = gate('const c = "color-mix(in oklch, color-mix(in oklch, var(--ch), transparent), black)";');
  expect(r.violations.map((v) => v.message.includes("holds bare channels"))).toEqual([false, true]);
});

test("a derived shade from a token that holds channels is told that the origin is no colour, not that a shade is new", () => {
  const r = gate('const c = "oklch(from var(--ch) calc(l * 0.9) c h)";');
  expect(r.violations.map((v) => v.message)).toEqual([expect.stringContaining("--ch holds bare channels (220 14% 96%)")]);
  expect(gate('const c = "oklch(from var(--whole) calc(l * 0.9) c h)";').violations.map((v) => v.message)).toEqual([expect.stringContaining("makes a new shade of var(--whole)")]);
});

// The shapes bare channels may take are all read as channels: a mutation that narrows the shape loses one of these.
test.each([
  ["none", "--n-none"], ["an alpha", "--n-alpha"], ["commas", "--n-comma"], ["commas and an alpha", "--n-comma-alpha"],
  ["an angle in degrees", "--n-deg"], ["an angle in gradians", "--n-grad"], ["an angle in radians", "--n-rad"],
  ["an angle in turns", "--n-turn"], ["percentages", "--n-percent"],
])("channels written with %s are channels", (_title, token) => {
  const r = gate(`const c = "color-mix(in oklch, var(${token}), transparent)";`);
  expect(r.violations.map((v) => v.message)).toEqual([expect.stringContaining(`${token} holds bare channels`)]);
  expect(r.notChecked).toEqual([]);
});

test("the relative colour keyword and the mix are read in capitals", () => {
  expect(messages('const c = "RGB(FROM var(--ch) R G B / 50%)";')).toEqual([expect.stringContaining("--ch holds bare channels")]);
  expect(messages('const c = "bg-[COLOR-MIX(IN_OKLCH,VAR(--ch),TRANSPARENT)]";')).toEqual([expect.stringContaining("--ch holds bare channels")]);
});

test("a token named twice in one call is named once", () => {
  const [m] = messages('const c = "color-mix(in oklch, var(--ch), var(--ch))";');
  expect(m).toContain("uses --ch where a whole colour is expected, but --ch holds bare channels (220 14% 96%), so");
  expect(m).toContain("Wrap it: hsl(var(--ch)).");
  expect(m).not.toContain("--ch and --ch");
});

test("a light-dark is read in capitals, and a name that only ends in light-dark is not one", () => {
  expect(messages('const c = "LIGHT-DARK(VAR(--ch), VAR(--whole))";')).toEqual([expect.stringContaining("--ch holds bare channels")]);
  for (const name of ["x-light-dark", "xlight-dark", "light-dark-x_light-dark"]) {
    expect(gate(`const c = "${name}(var(--ch), var(--whole))";`), name).toMatchObject({ violations: [], notChecked: [] });
  }
});

test("a light-dark inside an attribute selector is a selector, not a colour", () => {
  expect(gate('const s = \'[data-theme="light-dark(var(--ch), var(--whole))"]\';')).toMatchObject({ violations: [], notChecked: [] });
  // the same text outside a selector is read
  expect(gate('const s = "light-dark(var(--ch), var(--whole))";').violations).toHaveLength(1);
});

test("the wrapping function is said for each token: hsl for the channels that are hsl, assumed for the others", () => {
  const [m] = messages('const c = "light-dark(var(--ch), var(--other-ch))";');
  expect(m).toContain("Wrap each: hsl(var(--ch)), hsl(var(--other-ch)).");
  expect(m).toContain("The channels of --ch are hue, saturation and lightness, so hsl takes them.");
  expect(m).toContain("Hsl is assumed for --other-ch, because the channels do not read as hue, saturation and lightness. Use the colour function that matches them.");
  expect(m).not.toContain("--ch and --other-ch are hue");
  expect(m).not.toContain("assumed for --ch");
  // the other way about, and with the hsl one second
  const [n] = messages('const c = "light-dark(var(--other-ch), var(--other-ch-2))";');
  expect(n).toContain("Hsl is assumed for --other-ch and --other-ch-2, because");
  expect(n).not.toContain("are hue, saturation and lightness, so hsl takes them");
});

test("a token in two themes shows its first value, and the wrapping function is chosen from it", () => {
  const [a] = messages('const c = "color-mix(in oklch, var(--themed-hsl-first), transparent)";');
  expect(a).toContain("holds bare channels (220 14% 96%)");
  expect(a).toContain("The channels of --themed-hsl-first are hue, saturation and lightness");
  const [b] = messages('const c = "color-mix(in oklch, var(--themed-other-first), transparent)";');
  expect(b).toContain("holds bare channels (0.5 0.1 200)");
  expect(b).toContain("Hsl is assumed for --themed-other-first");
});

test("a mix may leave out its colour space, and the channels in it are channels all the same", () => {
  for (const value of ["color-mix(var(--ch), var(--whole))", "color-mix(var(--whole) 30%, var(--ch))", "bg-[color-mix(var(--ch),transparent)]"]) {
    const r = gate(`const c = "${value}";`);
    expect(r.violations.map((v) => v.message), value).toEqual([expect.stringContaining("--ch holds bare channels")]);
  }
  for (const value of ["color-mix(var(--whole), transparent)", "color-mix(var(--whole) 30%, var(--whole))", "color-mix(currentColor, var(--whole))"]) {
    expect(gate(`const c = "${value}";`), value).toMatchObject({ violations: [], notChecked: [] });
  }
  // a mix of a colour of its own is still a raw colour, with or without the space
  for (const value of ["color-mix(red, var(--whole))", "color-mix(in oklch, red, var(--whole))"]) {
    expect(messages(`const c = "${value}";`), value).toEqual([expect.stringMatching(/^Raw colour/)]);
  }
  // a mix with no colours is not built from tokens, with or without the space
  for (const value of ["color-mix(in oklch)", "color-mix()"]) {
    expect(messages(`const c = "${value}";`), value).toEqual([expect.stringMatching(/^Raw colour/)]);
  }
  // a relative colour from a mix with no space: the mix is not transparent, because one of its colours is not
  expect(gate('const c = "rgb(from color-mix(var(--whole), transparent) r g b / 1)";')).toMatchObject({ violations: [], notChecked: [] });
});

// A token the code sets (a class name's arbitrary property, a style object's key) can hold anything there, whatever the
// stylesheet declares. A claim that it holds channels is a claim about a value that is not read.
test("a token the code sets to a whole colour is not claimed to hold channels, in a class name or in a style object", () => {
  for (const src of [
    '<div className="[--ch:var(--whole)] bg-[color-mix(in_oklch,var(--ch)_50%,transparent)]" />',
    '<div style={{ "--ch": "var(--whole)" }}><i style={{ background: "color-mix(in oklch, var(--ch), transparent)" }} /></div>',
    '<div style={{ "--ch": "var(--whole)" }}><i style={{ color: "light-dark(var(--ch), var(--whole))" }} /></div>',
    '<div style={{ "--ch": "var(--whole)" }}><i style={{ color: "rgb(from var(--ch) r g b / 50%)" }} /></div>',
  ]) {
    const r = gate(src);
    expect(r.violations, src).toEqual([]);
    expect(r.notChecked.map((n) => [n.why, n.slot, n.stops]), src).toEqual([["unreadToken", true, [{ path: ["--ch"], code: true }]]]);
  }
});

test("a token that points at a name the code sets is not claimed to hold channels either", () => {
  const r = gate('<div style={{ "--ch": "var(--whole)" }}><i style={{ background: "color-mix(in oklch, var(--ch-chain), transparent)" }} /></div>');
  expect(r.violations).toEqual([]);
  expect(r.notChecked.map((n) => n.stops)).toEqual([[{ path: ["--ch-chain", "--ch"], code: true }]]);
});

test("only the exact name the code sets is spared: another token with channels is still flagged", () => {
  const r = gate('<div className="[--other:var(--whole)] bg-[color-mix(in_oklch,var(--ch),transparent)]" />');
  expect(r.violations.map((v) => v.message)).toEqual([expect.stringContaining("--ch holds bare channels")]);
  expect(r.notChecked).toEqual([]);
});

// Whatever a token that cannot be read holds, a whole colour (a shade the system does not define) or something that is
// not a colour (nothing to take a shade from), the call is wrong. So it is reported once, as the violation, and not also
// listed as not checked; the message says what it took the token to be.
test("a derived shade from a token whose value cannot be read is reported once, as the shade, and not also listed", () => {
  const r = gate('const c = "oklch(from var(--unread) calc(l * 0.9) c h)";');
  expect(r.violations.map((v) => v.message)).toEqual([
    "oklch(from var(--unread) calc(l * 0.9) c h) makes a new shade of var(--unread) that the system does not define. Add a token for it (a hover token, for example) and use that. The value of --unread could not be read, so this takes it to hold a whole colour.",
  ]);
  expect(r.notChecked).toEqual([]);
  // a name the code sets is not read either
  const set = gate('const box = { "--brand": "red" }; const c = "oklch(from var(--brand) calc(l * 0.9) c h)";');
  expect(set.violations.map((v) => v.message)).toEqual([expect.stringContaining("The value of --brand could not be read")]);
  expect(set.notChecked).toEqual([]);
  // a name no stylesheet declares is no-unknown-tokens' to say, and the shade says nothing of it
  const unknown = gate('const c = "oklch(from var(--not-declared) calc(l * 0.9) c h)";');
  expect(unknown.violations.map((v) => v.rule).sort()).toEqual(["no-raw-colors", "no-unknown-tokens"]);
  expect(unknown.violations.find((v) => v.rule === "no-raw-colors").message).not.toContain("could not be read");
  expect(unknown.notChecked).toEqual([]);
  // the same shade from a token that is read as a whole colour is the system's to refuse, as before
  expect(messages('const c = "oklch(from var(--whole) calc(l * 0.9) c h)";')).toEqual([expect.stringContaining("makes a new shade of var(--whole) that the system does not define. Add a token for it (a hover token, for example) and use that.")]);
  expect(messages('const c = "oklch(from var(--whole) calc(l * 0.9) c h)";')[0]).not.toContain("could not be read");
});

// A token's own fallback (`--fb: var(--undeclared, red)`) is not followed: the fallback is used only where the
// referenced token has no value at all, and "no stylesheet that was read declares it" is not "it has no value".
test("a token whose value is a var() with a fallback is listed unread, as the var() alone is", () => {
  expect(gate('const c = "color-mix(in oklch, var(--fb), transparent)";').notChecked.map((n) => n.stops)).toEqual([[{ path: ["--fb", "--undeclared"] }]]);
  const shade = gate('const c = "oklch(from var(--fb) calc(l * 0.9) c h)";');
  expect(shade.violations.map((v) => v.message)).toEqual([expect.stringContaining("The value of --fb could not be read")]);
  expect(shade.notChecked).toEqual([]);
});
