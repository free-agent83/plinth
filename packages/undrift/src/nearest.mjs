// Nearest-token lookup: when the gate finds a raw colour, it names the
// closest token in the contract so the fix is one substitution away.
//
// The suggestion is only worth making if it is RIGHT. A wrong "nearest token"
// is worse than none: it tells the agent to fix a colour with, say, a
// font-weight token, and the whole point of undrift is that its messages can
// be trusted. So this module is deliberately conservative in two places:
// what may enter the index, and how far a match may be before we stay quiet.
import { parse, differenceCiede2000, colorsNamed, converter } from "culori";

const diff = differenceCiede2000();
const toOklch = converter("oklch");

// #rgb, #rgba, #rrggbb, #rrggbbaa. A LEADING # is required.
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// The CSS colour functions. `color-mix` and `color` are included: they are
// unambiguously colours even when culori can't resolve them to a value.
const COLOR_FN_RE = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/i;

// `light-dark(A, B)` wraps the whole value; capture everything between the
// outer parens and split it ourselves.
const LIGHT_DARK_RE = /^light-dark\s*\(([\s\S]*)\)\s*$/i;

// Guard against pathological nesting; two levels is already unheard of.
const MAX_LIGHT_DARK_DEPTH = 8;

/**
 * Split a CSS argument list on its TOP-LEVEL commas. Splitting on the first
 * comma would cut `light-dark(rgba(5, 54, 89, .1), …)` in half and lose the
 * colour, so track paren depth instead.
 */
function splitTopLevel(args) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return parts;
}

/**
 * Reduce a token value to the single colour we should measure against.
 *
 * Today that means unwrapping `light-dark(A, B)` to A: it is valid modern CSS
 * that culori cannot resolve, and some design systems declare every single
 * colour that way, leaving their whole palette invisible to the matcher. A is
 * the light-mode value, the sensible default for a single index.
 *
 * Anything else is returned trimmed and unchanged; an unresolvable inner value
 * (`light-dark(var(--x), …)`) simply fails the colour checks downstream and
 * the token is skipped, exactly as before.
 */
export function resolveColorValue(value) {
  if (typeof value !== "string") return "";
  let v = value.trim();
  for (let depth = 0; depth < MAX_LIGHT_DARK_DEPTH; depth++) {
    const m = LIGHT_DARK_RE.exec(v);
    if (!m) break;
    v = splitTopLevel(m[1])[0].trim();
  }
  return v;
}

/**
 * Is this token value unambiguously a colour?
 *
 * Never infer this from culori's parser: culori is permissive by design and
 * reads the bare string "700" as the 3-digit hex #700, so `--font-weight-bold:
 * 700` looked like dark red. Decide from the SYNTAX first, parse second.
 *
 * Keywords with no chromatic position (`transparent`, `currentColor`) are
 * excluded on purpose. They are colour-valued, but "nearest to transparent"
 * is not a suggestion any agent can act on.
 */
export function isColorValue(value) {
  if (typeof value !== "string") return false;
  const v = resolveColorValue(value);
  if (!v) return false;
  if (HEX_RE.test(v)) return true;
  if (COLOR_FN_RE.test(v)) return true;
  return Object.prototype.hasOwnProperty.call(colorsNamed, v.toLowerCase());
}

/**
 * Above this CIEDE2000 distance, the "nearest" token is not a neighbour, it's
 * just the least-bad row in the table. Suggesting it would be noise. CIEDE2000 is
 * calibrated so ~1 is a just-noticeable difference and ~10 is plainly a
 * different colour; 30 is a different hue family altogether (pure green to
 * mid-slate measures ~34). Set here rather than lower so that legitimately
 * sparse palettes still get a usable pointer, while a system whose colours
 * undrift cannot resolve gets silence instead of a wrong answer.
 */
export const MAX_SUGGESTION_DISTANCE = 30;

/** Below this CIEDE2000 difference two colours look the same: about one just-noticeable difference. */
export const SAME_COLOUR = 1;

/**
 * The CIEDE2000 distance between two colour values, or null when either cannot be placed (not a colour by
 * its syntax, or not one culori can read). Null is "could not measure", never a distance.
 */
export function colourDistance(a, b) {
  if (!isColorValue(a) || !isColorValue(b)) return null;
  try {
    const pa = parse(resolveColorValue(a));
    const pb = parse(resolveColorValue(b));
    return pa && pb ? diff(pa, pb) : null;
  } catch {
    return null;
  }
}

// A colour on one side of this OKLCH chroma is a gray, on the other it has a hue. A distance cannot tell the
// two apart: a pure gray is only 29.3 CIEDE2000 from Tailwind's green-500, and a gate that names it a
// neighbour is pointing the wrong way.
const CHROMA_LINE = 0.05;
// A pale tint of the class's own hue (amber-200 and a pale yellow role) is on the gray side of the line and
// still the class's colour lightened, so it stays: at least this chroma, and within this many degrees of hue.
const TINT_MIN_CHROMA = 0.012;
const TINT_HUE_GAP = 20;

const oklchOf = (value) => {
  if (!isColorValue(value)) return null;
  try {
    const p = parse(resolveColorValue(value));
    return p ? toOklch(p) : null;
  } catch {
    return null;
  }
};

/**
 * Is a role's colour on the same side of OKLCH chroma 0.05 as the class's colour, or a pale tint of its own
 * hue? Applied before nearness wherever a colour is matched to a token or a role, so that advice never points a
 * saturated colour at a gray or a gray at a saturated colour. false when either cannot be placed.
 */
export function sameChromaSide(roleColour, classColour) {
  const a = oklchOf(roleColour);
  const b = oklchOf(classColour);
  return a !== null && b !== null && chromaSideOk(a, b);
}

const chromaSideOk = (role, cls) => {
  const rc = role.c ?? 0;
  const cc = cls.c ?? 0;
  if (rc >= CHROMA_LINE === cc >= CHROMA_LINE) return true;
  if (cc < CHROMA_LINE || rc < TINT_MIN_CHROMA) return false;
  const gap = Math.abs((role.h ?? 0) - (cls.h ?? 0)) % 360;
  return (gap > 180 ? 360 - gap : gap) <= TINT_HUE_GAP;
};

/**
 * Build a matcher over the contract's colour tokens (name → parsed colour).
 * `light-dark()` values are resolved to their light-mode argument first (see
 * `resolveColorValue`). Values that remain unresolvable (`var()`,
 * `color-mix()`) are skipped: there is nothing to measure a distance against.
 * An empty index is a normal outcome, not a failure.
 *
 * `tokens` keeps one value per token, the last declared, which in a themed system is the dark theme's.
 * Given `layers` (which remember every declaration), a token is indexed once for each colour it was
 * declared with, so a colour near its light value finds it as readily as one near its dark value.
 */
export function tokenColorIndex(tokens, layers) {
  const index = [];
  for (const [name, last] of Object.entries(tokens)) {
    for (const value of new Set([last, ...(layers?.valuesOf?.(name) ?? [])])) {
      if (!isColorValue(value)) continue;
      const parsed = parse(resolveColorValue(value));
      if (parsed) index.push({ name, parsed });
    }
  }
  return index;
}

/**
 * Can this colour be measured against the index at all? A colour built from a variable
 * (`hsl(var(--primary))`) is a colour that cannot be placed, and so no distance to a token exists.
 * Callers use it to tell "nothing is close" (a measurement) from "could not measure" (not one).
 */
export function measurable(rawColor) {
  if (!isColorValue(rawColor)) return false;
  try {
    return Boolean(parse(resolveColorValue(rawColor)));
  } catch {
    return false;
  }
}

/**
 * Return { name, distance } of the nearest token colour, or null when there is
 * no trustworthy answer: an empty index, an unparseable input, or a nearest
 * match beyond MAX_SUGGESTION_DISTANCE. Callers must handle null by falling
 * back to generic advice (see `suggestColor` in gate.mjs).
 */
export function nearestToken(index, rawColor) {
  if (!isColorValue(rawColor)) return null;
  // culori.parse THROWS on some malformed modern-syntax colours (e.g. certain
  // oklch() forms) rather than returning null. The docstring promises null for
  // "an unparseable input", and a colour suggestion must never crash a scan of
  // a stranger's repo. OKLCH is exactly what the best modern systems use.
  // Surfaced 2026-07-23 by a real OKLCH codebase.
  let parsed;
  try {
    parsed = parse(resolveColorValue(rawColor));
  } catch {
    return null;
  }
  if (!parsed || index.length === 0) return null;
  const cls = toOklch(parsed);
  let best = null;
  for (const t of index) {
    if (!chromaSideOk(toOklch(t.parsed), cls)) continue;
    const d = diff(parsed, t.parsed);
    if (best === null || d < best.distance) best = { name: t.name, distance: d };
  }
  return best && best.distance <= MAX_SUGGESTION_DISTANCE ? best : null;
}
