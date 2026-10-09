import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tokenLayers, layersOf, hasColourPrimitive } from "../src/layers.mjs";

// Plinth's shape: primitives, roles per theme, Tailwind wiring on top.
const PLINTH = [
  ["--color-primitive-indigo-700", "oklch(0.39 0.17 277)"],
  ["--color-primitive-indigo-300", "oklch(0.78 0.10 277)"],
  ["--color-primitive-slate-50", "oklch(0.98 0 0)"],
  ["--color-semantic-primary", "var(--color-primitive-indigo-700)"],
  ["--color-semantic-ring", "var(--color-primitive-indigo-700)"],
  ["--color-semantic-primary", "var(--color-primitive-indigo-300)"],
  ["--color-primary", "var(--color-semantic-primary)"],
  ["--color-ring", "var(--color-semantic-ring)"],
];

test("Plinth's shape: palette entries are primitives, roles and wiring are not", () => {
  const l = tokenLayers(PLINTH);
  expect(l.layered).toBe(true);
  expect([...l.primitives].sort()).toEqual(["--color-primitive-indigo-300", "--color-primitive-indigo-700"]);
  expect(l.primitives.has("--color-primitive-slate-50")).toBe(false); // referred to by nothing
  expect(l.primitives.has("--color-semantic-primary")).toBe(false);
  expect(l.primitives.has("--color-primary")).toBe(false);
});

test("the roles built on a primitive are the role leaves above it, sorted", () => {
  const l = tokenLayers(PLINTH);
  expect(l.rolesFor("--color-primitive-indigo-700")).toEqual(["--color-primary", "--color-ring"]);
  expect(l.rolesFor("--color-primitive-indigo-300")).toEqual(["--color-primary"]);
  expect(l.rolesFor("--color-primary")).toEqual([]); // not a primitive
});

test("an unused palette entry is neither a primitive nor a role", () => {
  const l = tokenLayers(PLINTH);
  expect(l.primitives.has("--color-primitive-slate-50")).toBe(false);
  expect(l.roles.has("--color-primitive-slate-50")).toBe(false);
  expect(l.roleLeaves.has("--color-primitive-slate-50")).toBe(false);
  expect([...l.roleLeaves].sort()).toEqual(["--color-primary", "--color-ring"]);
});

test("shadcn with dark mode: literal roles rebound per theme are roles, not primitives", () => {
  const l = tokenLayers([
    ["--primary", "oklch(0.2 0 0)"],
    ["--primary", "oklch(0.9 0 0)"],
    ["--color-primary", "var(--primary)"],
  ]);
  expect(l.layered).toBe(false);
});

test("shadcn single theme: wiring alone does not make a primitive", () => {
  const l = tokenLayers([["--primary", "oklch(0.2 0 0)"], ["--color-primary", "var(--primary)"]]);
  expect(l.layered).toBe(false);
});

test("a flat palette has no layer", () => {
  expect(tokenLayers([["--color-primary", "#3b5bdb"], ["--color-error", "#e24b4a"]]).layered).toBe(false);
});

test("a token declared twice with the same value is still one value", () => {
  const l = tokenLayers([
    ["--color-primitive-white", "oklch(1 0 0)"],
    ["--color-primitive-white", " oklch(1 0 0) "],
    ["--color-semantic-card", "var(--color-primitive-white)"],
  ]);
  expect(l.primitives.has("--color-primitive-white")).toBe(true);
});

test("a cycle never hangs and makes no primitive", () => {
  const l = tokenLayers([["--a", "var(--b)"], ["--b", "var(--a)"]]);
  expect(l.layered).toBe(false);
  expect(l.rolesFor("--a")).toEqual([]);
});

// The two above never reach the walk or the value check. This one does. A broken walk spins forever and
// vitest's timeout cannot stop a synchronous loop, so the walk runs in a child process with a hard limit.
test("a cycle above a primitive is walked once", () => {
  const layers = fileURLToPath(new URL("../src/layers.mjs", import.meta.url));
  const code = `import { tokenLayers } from ${JSON.stringify(layers)};
const l = tokenLayers([["--p", "#000"], ["--a", "light-dark(var(--p), var(--b))"], ["--b", "var(--a)"], ["--leaf", "var(--a)"]]);
process.stdout.write(JSON.stringify(l.rolesFor("--p")));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 5000 });
  expect(r.signal).toBeNull();
  expect(r.stdout).toBe('["--leaf"]');
});

test("a literal token rebound per theme is a role even when a non-wiring token uses it", () => {
  const l = tokenLayers([
    ["--primary", "oklch(0.2 0 0)"],
    ["--primary", "oklch(0.9 0 0)"],
    ["--button-bg", "var(--primary)"],
  ]);
  expect(l.layered).toBe(false);
});

test("a reference to a token that does not exist is ignored", () => {
  const l = tokenLayers([["--color-primary", "var(--nowhere)"]]);
  expect(l.layered).toBe(false);
});

test("non-token keys are ignored (a DTCG file with a version field)", () => {
  expect(tokenLayers([["version", "1"], ["$schema", "x"]]).layered).toBe(false);
});

test("layersOf prefers the contract's own layers and falls back to its tokens", () => {
  const own = tokenLayers(PLINTH);
  expect(layersOf({ layers: own })).toBe(own);
  expect(layersOf({ tokens: Object.fromEntries(PLINTH) }).primitives.has("--color-primitive-indigo-300")).toBe(true);
  expect(layersOf({}).layered).toBe(false);
});

test("the roles built on a primitive come back sorted whatever order they were declared in", () => {
  const l = tokenLayers([["--p", "#000"], ["--z", "var(--p)"], ["--a", "var(--p)"]]);
  expect(l.rolesFor("--p")).toEqual(["--a", "--z"]);
});

// A derivation (color-mix, calc) builds on a token without being a layer above it.
test("a single-theme literal role is not a primitive because a derived token mixes it", () => {
  const l = tokenLayers([
    ["--color-primary", "#3b5bdb"],
    ["--color-primary-hover", "color-mix(in oklch, var(--color-primary) 90%, black)"],
  ]);
  expect(l.primitives.has("--color-primary")).toBe(false);
  expect(l.layered).toBe(false);
});

test("a calc() over a token is a derivation too", () => {
  const l = tokenLayers([["--space-2", "8px"], ["--space-3", "calc(var(--space-2) * 1.5)"]]);
  expect(l.layered).toBe(false);
});

test("a plain reference or a light-dark() of two references does make a primitive", () => {
  const l = tokenLayers([
    ["--p-light", "#fff"], ["--p-dark", "#000"], ["--p-one", "#111"],
    ["--bg", "light-dark(var(--p-light), var(--p-dark))"], ["--fg", "var(--p-one)"],
  ]);
  expect([...l.primitives].sort()).toEqual(["--p-dark", "--p-light", "--p-one"]);
});

test("a role a derived token mixes stays a role leaf and is offered, with the derived role too", () => {
  const l = tokenLayers([
    ["--p", "#3b5bdb"],
    ["--color-primary", "var(--p)"],
    ["--color-primary-hover", "color-mix(in oklch, var(--color-primary) 90%, black)"],
  ]);
  expect(l.rolesFor("--p")).toEqual(["--color-primary", "--color-primary-hover"]);
});

// KNOWN LIMIT, pinned so a change to it is a decision. A plain alias puts a role under another role, so
// only the outer one is a leaf and the inner one is not offered. How often real systems do this is not measured.
test("known limit: a role another role plainly aliases is not offered", () => {
  const l = tokenLayers([["--p", "#3b5bdb"], ["--color-primary", "var(--p)"], ["--color-ring", "var(--color-primary)"]]);
  expect(l.rolesFor("--p")).toEqual(["--color-ring"]);
});

// KNOWN BLIND SPOT, pinned so a change to it is a decision. A literal role that a component token refers
// to has the shape of a primitive, and the graph alone cannot tell the two apart. How often real systems do this is not measured.
test("known blind spot: a literal role a component token builds on reads as a primitive", () => {
  const l = tokenLayers([["--color-primary", "#3b5bdb"], ["--button-bg", "var(--color-primary)"]]);
  expect(l.primitives.has("--color-primary")).toBe(true);
});

// A palette-step shape: `@theme inline { --color-blue-9: var(--blue-9) }` renames the palette entry into Tailwind.
test("a wiring alias of a primitive is a primitive, and never a role built on it", () => {
  const l = tokenLayers([
    ["--blue-9", "#0090ff"],
    ["--accent-9", "var(--blue-9)"],
    ["--color-blue-9", "var(--blue-9)"],
    ["--color-accent-9", "var(--accent-9)"],
  ]);
  expect([...l.primitives].sort()).toEqual(["--blue-9", "--color-blue-9"]);
  expect(l.roles.has("--color-blue-9")).toBe(false);
  expect(l.roleLeaves.has("--color-blue-9")).toBe(false);
  expect(l.rolesFor("--blue-9")).toEqual(["--color-accent-9"]);
  expect(l.rolesFor("--color-blue-9")).toEqual(["--color-accent-9"]);
});

// A rename that points at two tokens is not a plain rename of the primitive: it is rebound per theme, so it is
// not itself a primitive. It is still never offered as a role built on either token it points at, because its
// name says it is the utility of one of them.
test("a wiring alias that is rebound to another token is not a primitive, and not offered either", () => {
  const l = tokenLayers([
    ["--blue-9", "#0090ff"], ["--blue-10", "#3b9eff"],
    ["--accent-9", "var(--blue-9)"],
    ["--color-blue-9", "var(--blue-9)"], ["--color-blue-9", "var(--blue-10)"],
    ["--color-accent-9", "var(--accent-9)"],
  ]);
  expect(l.primitives.has("--color-blue-9")).toBe(false);
  expect(l.rolesFor("--blue-9")).toEqual(["--color-accent-9"]);
  expect(l.rolesFor("--blue-10")).toEqual([]);
});

test("an alias that is plain in one theme and literal in another is not a wiring alias", () => {
  const l = tokenLayers([
    ["--blue-9", "#0090ff"], ["--accent-9", "var(--blue-9)"],
    ["--color-blue-9", "var(--blue-9)"], ["--color-blue-9", "#ffffff"],
  ]);
  expect(l.primitives.has("--color-blue-9")).toBe(false);
});

// Once the entry is a primitive for another reason, a role built on its Tailwind alias is built on it too.
test("a role built on a wiring alias is offered for the primitive, when something else makes it one", () => {
  const l = tokenLayers([
    ["--blue-9", "#0090ff"], ["--accent-9", "var(--blue-9)"],
    ["--color-blue-9", "var(--blue-9)"], ["--color-primary", "var(--color-blue-9)"],
  ]);
  expect([...l.primitives].sort()).toEqual(["--blue-9", "--color-blue-9"]);
  expect(l.rolesFor("--blue-9")).toEqual(["--accent-9", "--color-primary"]);
  expect(l.rolesFor("--color-blue-9")).toEqual(["--accent-9", "--color-primary"]);
  expect(l.roles.has("--color-blue-9")).toBe(false);
});

// KNOWN RECALL LIMIT, pinned so a change to it is a decision. A role built only on the Tailwind alias of a
// palette entry (a palette-step shape, with nothing built on the entry itself) is the same shape as a single-theme shadcn
// set, where the same graph is a literal role and its wiring. Precision comes first: neither is layered.
test("known recall limit: a role built only on a wiring alias does not make the entry a primitive", () => {
  const l = tokenLayers([["--blue-9", "#0090ff"], ["--color-blue-9", "var(--blue-9)"], ["--color-primary", "var(--color-blue-9)"]]);
  expect(l.primitives.has("--blue-9")).toBe(false);
  expect(l.layered).toBe(false);
});

// Single-theme shadcn: --primary is a literal role, --color-primary wires it into Tailwind, and --color-ring is
// a role built on that. None of it is a primitive, so bg-primary is never flagged.
test("single-theme shadcn with a role on the wiring: --primary is not a primitive", () => {
  const l = tokenLayers([
    ["--primary", "oklch(0.2 0 0)"], ["--color-primary", "var(--primary)"], ["--color-ring", "var(--color-primary)"],
  ]);
  expect(l.primitives.has("--primary")).toBe(false);
  expect(l.primitives.has("--color-primary")).toBe(false);
  expect(l.layered).toBe(false);
  expect(hasColourPrimitive(l)).toBe(false);
});

// The walk goes on past a leaf for derived roles, but only to roles of the same kind: a focus shadow mixed
// from a colour role is not a colour role.
test("a derived token of another kind is not offered as a role of the primitive", () => {
  const l = tokenLayers([
    ["--p", "#33f"],
    ["--color-primary", "var(--p)"],
    ["--shadow-focus", "0 0 0 2px color-mix(in oklch, var(--color-primary) 40%, transparent)"],
  ]);
  expect(l.rolesFor("--p")).toEqual(["--color-primary"]);
});

// A token derived straight from the primitive is judged by kind like one derived from a leaf.
test("a derived token of another kind is not offered for the primitive it is mixed from", () => {
  const l = tokenLayers([
    ["--p", "#33f"], ["--color-primary", "var(--p)"],
    ["--shadow-focus", "0 0 0 2px color-mix(in oklch, var(--p) 40%, transparent)"],
    ["--color-primary-soft", "color-mix(in oklch, var(--color-primary) 20%, white)"],
  ]);
  expect(l.rolesFor("--p")).toEqual(["--color-primary", "--color-primary-soft"]);
});

test("rolesFor of a token that is not a primitive is empty, even with a role above it", () => {
  const l = tokenLayers([["--p", "#000"], ["--a", "var(--p)"], ["--b", "var(--a)"]]);
  expect(l.primitives.has("--a")).toBe(false);
  expect(l.rolesFor("--a")).toEqual([]);
});

test("a token that refers only to itself is not a role", () => {
  const l = tokenLayers([["--a", "var(--a)"]]);
  expect(l.roles.has("--a")).toBe(false);
});

test("a value repeated with different spacing is still one value", () => {
  const l = tokenLayers([["--p", "oklch(0.5  0.1 30)"], ["--p", "oklch(0.5 0.1 30)"], ["--bg", "var(--p)"]]);
  expect(l.primitives.has("--p")).toBe(true);
});

// Names are ASCII here, as the stylesheet reader reads them. A name outside that is not another token.
test("var(--färg) is not a reference to --f", () => {
  const l = tokenLayers([["--f", "#000"], ["--bg", "var(--färg)"]]);
  expect(l.primitives.has("--f")).toBe(false);
  expect(l.roles.has("--bg")).toBe(false); // it refers to no token this reader knows
});

test("a name with an escape is read whole", () => {
  const l = tokenLayers([["--space-1\\.5", "6px"], ["--gap", "var(--space-1\\.5)"]]);
  expect(l.primitives.has("--space-1\\.5")).toBe(true);
  expect(l.rolesFor("--space-1\\.5")).toEqual(["--gap"]);
});

test("a name that only starts like another is not it", () => {
  const l = tokenLayers([["--space-1", "4px"], ["--space-1-5", "6px"], ["--gap", "var(--space-1-5)"]]);
  expect([...l.primitives]).toEqual(["--space-1-5"]);
});

test("a reference with a fallback is read, but it is not a plain reference", () => {
  const l = tokenLayers([["--space-1", "4px"], ["--gap", "var(--space-1, 2px)"]]);
  expect(l.layered).toBe(false);
});

// A primitive is a colour primitive by its value, not by its name: no naming convention is assumed.
test("hasColourPrimitive: decided by the value, so any name will do", () => {
  const named = (decls) => hasColourPrimitive(tokenLayers(decls));
  expect(named([["--p", "#00f"], ["--bg", "var(--p)"]])).toBe(true);
  expect(named([["--indigo-7", "#4263eb"], ["--brand", "var(--indigo-7)"]])).toBe(true);
  expect(named([["--c", "oklch(0.39 0.17 277)"], ["--bg", "light-dark(var(--c), var(--c))"]])).toBe(true);
});

test("hasColourPrimitive: shadcn's --radius is a primitive and not a colour", () => {
  const l = tokenLayers([
    ["--radius", "0.5rem"], ["--radius-sm", "var(--radius)"], ["--primary", "oklch(0.2 0 0)"], ["--color-primary", "var(--primary)"],
  ]);
  expect(l.layered).toBe(true);
  expect(hasColourPrimitive(l)).toBe(false);
});

test("hasColourPrimitive: a wiring alias of a colour primitive is one, and a flat set has none", () => {
  const steps = tokenLayers([["--blue-9", "#0090ff"], ["--accent-9", "var(--blue-9)"], ["--color-blue-9", "var(--blue-9)"]]);
  expect(hasColourPrimitive(steps)).toBe(true);
  expect(steps.colourPrimitives.has("--color-blue-9")).toBe(true); // its utility is a colour primitive's
  expect(hasColourPrimitive(tokenLayers([["--color-primary", "#3b5bdb"]]))).toBe(false);
  expect(hasColourPrimitive(undefined)).toBe(false);
});

// A `--priority-*` role: a colour named for what it is for, wired into
// Tailwind under two-word namespaces. Only the one-word `--color-` was read as wiring, so the wiring read as
// a layer above it and the role read as a palette entry.
test("a token wired into Tailwind's text-color and border-color namespaces is not a primitive", () => {
  const wired = tokenLayers([
    ["--priority-urgent", "oklch(0.5798 0.1766 26.99)"],
    ["--text-color-priority-urgent", "var(--priority-urgent)"],
    ["--border-color-priority-urgent", "var(--priority-urgent)"],
  ]);
  expect(wired.primitives.size).toBe(0);
  expect(wired.layered).toBe(false);
});

test("a token wired into the background-color namespace is not a primitive either", () => {
  expect(tokenLayers([["--canvas", "oklch(0.5 0.1 250)"], ["--background-color-canvas", "var(--canvas)"]]).primitives.size).toBe(0);
});

test("a two-word namespace that does not rename it is a layer: the name must be the token's own", () => {
  // `--text-color-priority-urgent: var(--urgent)` is not a rename of `--priority-urgent`.
  const l = tokenLayers([["--priority-urgent", "oklch(0.5798 0.1766 26.99)"], ["--text-color-urgent", "var(--priority-urgent)"]]);
  expect(l.primitives.has("--priority-urgent")).toBe(true);
});

test("a role built on a primitive still reaches it through a two-word wiring name", () => {
  const l = tokenLayers([
    ["--color-primitive-red-500", "oklch(0.6 0.2 25)"],
    ["--priority-urgent", "var(--color-primitive-red-500)"],
    ["--text-color-priority-urgent", "var(--priority-urgent)"],
  ]);
  expect(l.primitives.has("--priority-urgent")).toBe(false);
  expect(l.rolesFor("--color-primitive-red-500")).toEqual(["--text-color-priority-urgent"]);
});

// Each of these builds a utility in Tailwind 4.3.2 (compiled with @tailwindcss/node), so each is wiring
// when it only renames a literal: `--ring-color-x: var(--x)` is `ring-x`.
for (const ns of ["ring-color", "outline-color", "accent-color", "placeholder-color"]) {
  test(`a token wired into the ${ns} namespace is not a primitive`, () => {
    expect(tokenLayers([["--halo", "oklch(0.5 0.1 250)"], [`--${ns}-halo`, "var(--halo)"]]).primitives.size).toBe(0);
  });
}
