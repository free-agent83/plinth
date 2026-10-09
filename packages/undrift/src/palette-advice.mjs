// What `no-default-palette` can say about a Tailwind colour, read from the system's own tokens. Advice only:
// no rule decides anything from this, and nothing here names a primitive.
import { layersOf, hasColourPalette } from "./layers.mjs";
import { tailwindColourValue, namespaceOfPrefix } from "./tailwind-colours.mjs";
import { parse, converter } from "culori";
import { colourDistance, SAME_COLOUR, MAX_SUGGESTION_DISTANCE, sameChromaSide, isColorValue, resolveColorValue, nearestToken } from "./nearest.mjs";

const toOklch = converter("oklch");

/**
 * A role whose colour differs this much (CIEDE2000) between its themes changes with the theme. Black in the
 * light theme and white in the dark is about 100 apart; one that stays near one colour is a few.
 */
const THEME_SPREAD = 30;

/**
 * Is a Tailwind class a fixed colour: black or white with an opacity modifier (`bg-black/80`)? A modal's scrim
 * stays dark in the dark theme, so it is not for a role that inverts. A solid black or white is a colour the
 * theme may well choose, so it is not fixed.
 */
export const isFixedOverlay = (colour, opacity) => (colour === "black" || colour === "white") && opacity != null;

/**
 * Does a token come to colours 30 or more apart across its themes? A fixed colour must not be offered one.
 * A token whose colour cannot be placed, or that has only one, does not change.
 */
export function changesWithTheme(layers, name) {
  const colours = layers.coloursOf(name);
  for (let i = 0; i < colours.length; i++) {
    for (let j = i + 1; j < colours.length; j++) {
      const d = colourDistance(colours[i], colours[j]);
      if (d !== null && d >= THEME_SPREAD) return true;
    }
  }
  return false;
}

/**
 * Is a raw colour value a translucent black or white (`rgba(0, 0, 0, 0.5)`)? The same fixed colour, by value.
 */
export function isFixedOverlayValue(value) {
  if (!isColorValue(value)) return false;
  let p;
  try {
    p = parse(resolveColorValue(value));
  } catch {
    return false;
  }
  if (!p || (p.alpha ?? 1) >= 1) return false;
  const { l, c } = toOklch(p);
  return (c ?? 0) < 0.001 && (l < 0.001 || l > 0.999);
}

/**
 * The roles built on the system's own version of a Tailwind colour, or [] when it has none.
 *
 * A system token is "the system's own version" of `indigo-700` when it is the same colour to the eye: its
 * value is within SAME_COLOUR (one just-noticeable difference, CIEDE2000) of Tailwind's. A name match is not
 * enough: systems name their palettes as they like, and a product's `--extended-color-yellow-500`, the yellow of
 * its issue labels, is not Tailwind's yellow-500.
 * @param {object} contract
 * @param {string} colour a Tailwind colour as written in a class, `indigo-700` or `white`
 * @param {{ fixed?: boolean }} [options] fixed: the class is a fixed colour, and a role that changes with the theme is left out
 * @returns {string[]} role names, sorted
 */
export function ownRoles(contract, colour, { fixed = false } = {}) {
  const layers = layersOf(contract);
  const wanted = tailwindColourValue(colour);
  if (wanted === null) return [];
  const roles = new Set();
  for (const primitive of layers.paletteColours) {
    const same = layers.valuesOf(primitive).some((value) => {
      const d = colourDistance(value, wanted);
      return d !== null && d < SAME_COLOUR;
    });
    if (!same) continue;
    for (const role of layers.rolesOn(primitive)) if (!fixed || !changesWithTheme(layers, role)) roles.add(role);
  }
  return [...roles].sort();
}

/** The most roles named for a colour that has no version of its own. */
const MAX_NEAREST_ROLES = 5;
/**
 * How much farther than the nearest role a role may be and still be named beside it. Nearest.mjs puts a
 * plainly different colour at about 10 CIEDE2000, so a role more than that behind the nearest is not a
 * neighbour of the colour, only less far than the rest.
 */
const NEIGHBOUR_BAND = 10;

/**
 * The roles whose colour is nearest a Tailwind colour, for a class that names the colour and has no version
 * of its own in the system. Each role is measured by the colours it resolves to in every theme, with the
 * CIEDE2000 distance the gate's other advice uses, and must be within MAX_SUGGESTION_DISTANCE of it. A role
 * for the same kind of utility (`--text-color-*` for `text-`) comes before one for any (`--color-*`), when
 * the names show it. A primitive is never a candidate. Nothing near gives [].
 * @param {object} contract
 * @param {string} colour a Tailwind colour as written in a class, `gray-400`
 * @param {string} prefix the utility's prefix, `text`
 * @param {{ fixed?: boolean }} [options] fixed: the class is a fixed colour, and a role that changes with the theme is left out
 * @returns {{ roles: string[], same: boolean, partly: boolean }} the role names nearest first; `same` when they are the same colour in every theme, `partly` when one is in some themes only
 */
export function nearestRoles(contract, colour, prefix, { fixed = false } = {}) {
  return nearestRolesTo(contract, tailwindColourValue(colour), prefix, { fixed });
}

/**
 * The same, for a colour given as a value (`oklch(0.98 0 0)`): the system's own primitive, which no role is
 * built on, is measured the way a Tailwind colour is. `null` is a colour that cannot be placed, and has none.
 */
export function nearestRolesTo(contract, wanted, prefix, { fixed = false } = {}) {
  const layers = layersOf(contract);
  if (wanted === null || wanted === undefined) return { roles: [], same: false, partly: false };
  const layered = hasColourPalette(layers);
  const ns = prefix ? namespaceOfPrefix(prefix) : null; // a var() reference has no utility, so no kind of utility to prefer
  const measured = [];
  for (const name of Object.keys(contract.tokens ?? {})) {
    // Never a primitive. The role tests below keep one out as well, so this states the rule more than it is the guard.
    if (layers.palette.has(name)) continue;
    // `--color-*` gives a utility for every prefix; in a layered set only a role leaf is a role to name.
    // The namespace of this kind of utility gives it for this prefix alone, and any role is one to name.
    const generic = name.startsWith("--color-") && (!layered || layers.roleLeaves.has(name));
    const family = ns !== null && name.startsWith(`--${ns}-`) && (!layered || layers.roles.has(name));
    if (!generic && !family) continue;
    if (fixed && changesWithTheme(layers, name)) continue;
    // A colour of the role on the other side of the chroma line is not measured: it is not near, whatever the distance.
    const all = layers.coloursOf(name);
    const distances = all.filter((c) => sameChromaSide(c, wanted)).map((c) => colourDistance(wanted, c)).filter((d) => d !== null);
    if (distances.length === 0) continue;
    // "The same colour" is said of a role only when every colour it comes to, in every theme, is.
    const everySame = all.every((c) => (colourDistance(wanted, c) ?? Infinity) < SAME_COLOUR);
    measured.push({ name, family, distance: Math.min(...distances), everySame });
  }
  if (measured.length === 0) return { roles: [], same: false, partly: false };
  const nearest = Math.min(...measured.map((m) => m.distance));
  // When a role is the same colour in every theme, only the roles that are are named: they are what "the same colour" says.
  const same = measured.some((m) => m.everySame);
  const reach = Math.min(MAX_SUGGESTION_DISTANCE, nearest + NEIGHBOUR_BAND);
  const roles = measured
    .filter((m) => (same ? m.everySame : m.distance <= reach))
    .sort((a, b) => Number(b.family) - Number(a.family) || a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, MAX_NEAREST_ROLES)
    .map((m) => m.name);
  // Some of the roles named are the same colour in a theme, though not in every one.
  const partly = !same && nearest < SAME_COLOUR;
  return { roles, same, partly };
}

/** What is said of a fixed colour (a translucent black or white) when every role near it changes with the theme. */
export const FIXED_ADVICE = "Every role near it changes with the theme, and this colour is fixed, so propose a role for it rather than naming one that would invert.";

/**
 * What to say of a raw colour: the one answer the gate's message and the older-problems note both give, so
 * the two cannot drift apart. It is the token nearest the colour in the index, and then what can be offered
 * for that token:
 *  - `none`: nothing is near.
 *  - `fixed`: the colour is a translucent black or white and every role near it changes with the theme.
 *  - `unused`: the nearest token is a palette entry, or a literal nobody builds on, and no role is built on it.
 *  - `same` or `near` with `roles`: roles are built on the nearest token (a primitive, or a token a role passes
 *    on through wiring), and `palette` says whether it is a palette entry.
 *  - `same` or `near` with only a `token`: the nearest token is itself a role, or the set has no palette.
 * A fixed colour is never offered a role that changes with the theme, whichever way the roles are reached.
 * @returns {{ kind: "none"|"fixed" } | { kind: "unused", token: string } | { kind: "same"|"near", token: string, roles?: string[], palette?: boolean }}
 */
export function colourFix(layers, index, colour) {
  const fixed = isFixedOverlayValue(colour);
  const pool = fixed ? index.filter((t) => !changesWithTheme(layers, t.name)) : index;
  const near = nearestToken(pool, colour);
  // "Every role near it changes with the theme" is said only where a token was near before they were left out.
  if (!near) return { kind: fixed && nearestToken(index, colour) ? "fixed" : "none" };
  const kind = near.distance < SAME_COLOUR ? "same" : "near";
  if (layers.roles.has(near.name)) return { kind, token: near.name };
  if (layers.palette.has(near.name) || hasColourPalette(layers)) {
    const all = layers.rolesOn(near.name);
    const roles = fixed ? all.filter((r) => !changesWithTheme(layers, r)) : all;
    if (roles.length > 0) return { kind, token: near.name, roles, palette: layers.primitives.has(near.name) };
    if (all.length > 0) return { kind: "fixed" };
    return { kind: "unused", token: near.name };
  }
  return { kind, token: near.name };
}
