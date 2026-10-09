// A colour function in code is a raw colour only when it names a colour of its own. Two shapes build a colour from
// tokens and name none: a mix whose every colour is a token, transparent or currentColor
// (`color-mix(in oklch, var(--secondary), var(--foreground) 5%)`, or a token at an alpha, which is what Tailwind's
// `/78` opacity modifier compiles to), and a colour function whose channels come from a token
// (`hsl(var(--primary) / 0.5)`, where the token holds channels such as `220 70% 50%`). Reading either as a raw colour
// told the agent to replace the tokens it had used with a token.
//
// Only a colour that comes from a token passes. A single function passes when its channel part is one var() (whose
// fallback, if any, is a token colour too), with any alpha, or when it is a relative colour (`rgb(from var(--a) r g b
// / 50%)`) whose origin is a token and whose channels are channel keywords. A raw number in a colour channel
// (`rgb(255 0 var(--zero))`, `hsl(var(--hue) 100% 50%)`, `rgb(from var(--a) 255 0 0)`) is a raw colour, whatever else
// in the call is a token. `light-dark()` passes inside a mix only when both of its arms do.
//
// A colour function that wraps a token which already holds a whole colour (`hsl(var(--chart-1))` with
// `--chart-1: oklch(...)`) is not a raw colour either, and it is not correct: it is not a colour at all, so the
// declaration is invalid when the page is rendered and the property computes as unset (inherited, or its initial
// value). wrappedWholeColour says so, so the message names that fix.
//
// The mirror image: a token that holds bare channels (`--ch: 220 14% 96%`) taken where a whole colour is expected, an arm
// of a mix, an arm of a light-dark or the origin of a relative colour, is not a colour either. colourSlots finds those,
// and the tokens in those places whose value cannot be followed, which are listed as not checked.
//
// A token the product's own code sets (`[--ch:var(--w)]` in a class name, a style object's key) can hold anything
// there, whatever the stylesheet declares for it. Where a token on the chain is one, nothing is claimed of it: it is
// listed as not checked, naming that token, and the caller says which tokens those are (`setByCode`).
import { isColorValue } from "./nearest.mjs";

const SINGLE = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)$/i;
const NO_COLOUR = /^(?:transparent|currentcolor)$/i;
const PERCENT = /^-?(?:\d*\.)?\d+%$/;
const NUMBER = /^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?$/i;
// What a relative colour's channels may be called, by colour space: one letter each, in any
// order is a derived colour, not a raw number (`rgb(from var(--a) b g r)`); a letter of another space is not.
const FUNCTION_CHANNELS = {
  rgb: "rgb", rgba: "rgb", hsl: "hsl", hsla: "hsl", hwb: "hwb", lab: "lab", oklab: "lab", lch: "lch", oklch: "lch",
};
// The spaces `color(from <origin> <space> ...)` names, and their channels.
const COLOR_SPACES = {
  srgb: "rgb", "srgb-linear": "rgb", "display-p3": "rgb", "a98-rgb": "rgb", "prophoto-rgb": "rgb", rec2020: "rgb",
  xyz: "xyz", "xyz-d50": "xyz", "xyz-d65": "xyz",
};
// `alpha` is not one of them: it names the alpha channel, which is written after the `/`. In a colour channel it is a
// number from 0 to 1, so the colour is near black or constant.
const keywordsOf = (letters) => new Set(letters);
const NAME = String.raw`--(?:[A-Za-z0-9_-]|\\.)+`;
const VAR_NAME = new RegExp(String.raw`^var\(\s*(${NAME})\s*(?:,|\)$)`, "i");

/** The call that starts at `start` (its function name), to its matching parenthesis, or null when it is not closed. */
export function callAt(text, start) {
  const open = text.indexOf("(", start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** `text` split on `sep` where it is outside every parenthesis. */
function splitTop(text, sep) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (depth === 0 && (sep === " " ? /\s/.test(text[i]) : text[i] === sep)) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/**
 * The colour parts of a `color-mix()`'s inner text: the comma-separated parts, without the interpolation method
 * (`in oklch`), which CSS Color 5 lets a mix leave out (`color-mix(var(--a), var(--b))`). `method` says whether the
 * method was written. A mix without one is two colours at least, and one part is not a mix (`color-mix(var(--a))`).
 */
const mixColours = (inner) => {
  const parts = splitTop(inner, ",");
  return /^\s*in\s/i.test(parts[0]) ? { colours: parts.slice(1), method: true } : { colours: parts, method: false };
};

// Tailwind writes a space as `_` in an arbitrary value (`color-mix(in_oklch,var(--a),var(--b)_5%)`). A `_` inside a
// var() is part of the name and stays.
export const spaced = (text) => text.replace(/var\([^()]*\)|_/g, (m) => (m === "_" ? " " : m));

/** A colour that is a token, or no colour of its own: var(--x) (its fallback, if any, one of these too), transparent, currentColor, or a call built only from these. */
function tokenColour(value, valuesOf) {
  const v = value.trim();
  if (NO_COLOUR.test(v)) return true;
  if (callAt(v, 0) !== v) return false;
  if (/^var\(/i.test(v)) {
    const [name, ...fallback] = splitTop(v.slice(4, -1), ",");
    return new RegExp(`^\\s*${NAME}\\s*$`).test(name) && (fallback.length === 0 || tokenColour(fallback.join(","), valuesOf));
  }
  return builtFromTokens(v, valuesOf);
}

/** The channels of a single colour function: what comes before its alpha (`/ a`, or the last of four or of two commas). */
function channelsOf(inner) {
  const beforeSlash = splitTop(inner, "/")[0];
  const commas = splitTop(beforeSlash, ",");
  return (commas.length === 4 || commas.length === 2 ? commas.slice(0, -1) : commas).join(",");
}

/** The alpha of a single colour function, as written, or null: what follows `/`, or the last of four or of two commas. */
function alphaOf(inner) {
  const slash = splitTop(inner, "/");
  if (slash.length > 1) return slash.slice(1).join("/").trim() || null;
  const commas = splitTop(slash[0], ",");
  return commas.length === 4 || commas.length === 2 ? commas[commas.length - 1].trim() || null : null;
}

const isVarCall = (v) => /^var\(/i.test(v) && callAt(v, 0) === v;

/**
 * The arms of a `color-mix()` that carry any weight, as `{ colour, weight }`: the colour words of each arm, kept when
 * the arm's weight may be above 0%. A written percentage is read; `var()` and `calc()` weights are unknown, so the
 * arm stays. CSS normalises the rest: with one percentage written the other arm gets the remainder, and with none
 * written the arms share the mix equally.
 */
function weightedArms(colours) {
  const arms = colours.map((part) => {
    const words = splitTop(part.trim(), " ").filter((w) => w !== "");
    const percents = words.filter((w) => PERCENT.test(w));
    const colour = words.filter((w) => !PERCENT.test(w));
    // A second word that is not a percentage is a weight written some other way (a var() or a calc()): unknown.
    const unknown = percents.length === 0 && colour.length > 1;
    return { colour, weight: percents.length === 1 ? parseFloat(percents[0]) : unknown ? "unknown" : null };
  });
  const written = arms.filter((a) => typeof a.weight === "number").reduce((sum, a) => sum + a.weight, 0);
  const anyUnknown = arms.some((a) => a.weight === "unknown");
  const remainder = 100 - written;
  return arms.filter((a) => a.weight === "unknown" || (a.weight === null ? anyUnknown || remainder > 0 : a.weight > 0));
}

// One memo per `valuesOf` (so one per gate call: the gate makes a new one for each source it reads), so that a chain of
// tokens that each name the one before twice (`--x2: light-dark(var(--x1), var(--x1))`) costs one read for each token
// and not one for each path through it, which is 2^N (24 of them took 21 seconds).
const memos = new WeakMap();
const memoFor = (valuesOf) => {
  let memo = memos.get(valuesOf);
  if (!memo) memos.set(valuesOf, (memo = { held: new Map(), may: new Map(), working: new Map() }));
  return memo;
};
const heldBy = (valuesOf, token) => {
  const { held } = memoFor(valuesOf);
  if (!held.has(token)) held.set(token, valuesOf(token));
  return held.get(token);
};
// Does the token have a value wherever the code runs? `valuesOf.always` says so, where the caller can tell which blocks
// always apply; a plain `valuesOf` has only values, and a token that has one is read as always defined.
const alwaysDefined = (valuesOf, token) => (typeof valuesOf.always === "function" ? valuesOf.always(token) : heldBy(valuesOf, token).length > 0);
const VAR_IN = new RegExp(String.raw`var\(\s*(${NAME})`, "gi");

/**
 * May the token `start` hold a transparent colour, in any value it is declared with? Every token it can reach is read
 * once and settled together, as the smallest answer that agrees with every value: a ring of tokens adds nothing (a
 * token that only names itself is not transparent), and a token in a ring that has a way out to transparent is.
 */
function tokenMayBeTransparent(start, valuesOf) {
  const memo = memoFor(valuesOf);
  if (memo.may.has(start)) return memo.may.get(start);
  if (memo.working.has(start)) return memo.working.get(start);
  // The tokens reachable from `start` that are not settled yet, each after the tokens it names.
  const order = [];
  const seen = new Set();
  const stack = [[start, null]];
  while (stack.length > 0) {
    const [token, names] = stack[stack.length - 1];
    if (names === null) {
      if (seen.has(token) || memo.may.has(token)) {
        stack.pop();
        continue;
      }
      seen.add(token);
      stack[stack.length - 1][1] = [...new Set(heldBy(valuesOf, token).flatMap((held) => [...held.matchAll(VAR_IN)].map((m) => m[1])))];
      continue;
    }
    const next = names.pop();
    if (next === undefined) {
      order.push(token);
      stack.pop();
    } else if (!seen.has(next) && !memo.may.has(next)) stack.push([next, null]);
  }
  for (const token of order) memo.working.set(token, false);
  for (let changed = true; changed; ) {
    changed = false;
    for (const token of order) {
      if (memo.working.get(token) || !heldBy(valuesOf, token).some((held) => mayBeTransparent(held, valuesOf))) continue;
      memo.working.set(token, true);
      changed = true;
    }
  }
  for (const token of order) {
    memo.may.set(token, memo.working.get(token));
    memo.working.delete(token);
  }
  return memo.may.get(start);
}

/**
 * Could this colour be wholly transparent (`rgb(0 0 0 / 0)`)? `transparent`; a var() whose token may be (a fallback is
 * for a token that no block that always applies declares: where one does, the fallback is never used); a light-dark() with
 * such an arm; a mix whose every arm that carries any weight may be (an arm at 0% adds nothing, so
 * `var(--a) 100%, transparent` is `var(--a)`); or a relative colour whose origin may be and which keeps the origin's
 * alpha, by writing none or `alpha`. A colour derived from a colour that may be transparent, with any other alpha,
 * is black. A var() is as transparent as any value its token is declared with (`valuesOf`, one per theme; a chain of
 * tokens is followed once each, and a ring of them adds nothing).
 */
function mayBeTransparent(value, valuesOf = () => []) {
  const v = value.trim();
  if (/^transparent$/i.test(v)) return true;
  if (callAt(v, 0) !== v) return false;
  const name = v.slice(0, v.indexOf("(")).trim().toLowerCase();
  const inner = spaced(v.slice(v.indexOf("(") + 1, -1));
  if (name === "var") {
    const [token, ...fallback] = splitTop(inner, ",").map((part) => part.trim());
    if (!new RegExp(`^${NAME}$`).test(token)) return fallback.some((part) => mayBeTransparent(part, valuesOf));
    // A token declared where it always applies is used whatever the fallback says. A token that no block declares is the
    // fallback's, and one that only a theme class declares is the fallback's wherever that class does not apply.
    const fromToken = heldBy(valuesOf, token).length > 0 && tokenMayBeTransparent(token, valuesOf);
    return fromToken || (!alwaysDefined(valuesOf, token) && fallback.some((part) => mayBeTransparent(part, valuesOf)));
  }
  if (name === "light-dark") return splitTop(inner, ",").some((arm) => mayBeTransparent(arm, valuesOf));
  if (name === "color-mix") {
    const { colours } = mixColours(inner);
    const arms = colours.length > 0 ? weightedArms(colours) : [];
    return arms.length > 0 && arms.every((arm) => arm.colour.some((word) => mayBeTransparent(word, valuesOf)));
  }
  if (SINGLE.test(name)) {
    const slash = splitTop(inner, "/");
    const words = splitTop(slash[0].trim(), " ").filter((w) => w !== "");
    if (words.length < 2 || words[0].toLowerCase() !== "from") return false;
    const keepsAlpha = slash.length === 1 || (slash.length === 2 && /^alpha$/i.test(slash[1].trim()));
    return keepsAlpha && mayBeTransparent(words[1], valuesOf);
  }
  return false;
}

// What a computed channel may hold: the channel keywords, numbers, units, operators and nested calc(). Anything else
// (a var(), a colour word) is not a shade worked out from the origin, and at least one of the channel keywords is there.
const CALC_WORDS = new Set(["calc", "deg", "grad", "rad", "turn"]);
function isComputedChannel(word, allowed) {
  if (!/^calc\(/i.test(word) || callAt(word, 0) !== word) return false;
  const rest = word.replace(/[A-Za-z]+/g, (w) => (allowed.has(w.toLowerCase()) || CALC_WORDS.has(w.toLowerCase()) ? "" : "X"));
  if (!/^[\s\d.%+\-*/()eE]*$/.test(rest)) return false;
  // It is worked out from the origin only if it uses one of the origin's channels: `calc(255)` is a raw number written
  // as a calculation, and the colour it makes is the call's own.
  return [...word.matchAll(/[A-Za-z]+/g)].some((m) => allowed.has(m[0].toLowerCase()));
}

/**
 * A relative colour, `rgb(from <token colour> r g b / <alpha>)`: its origin is a token (a var(), a mix of tokens, or
 * no colour of its own such as currentColor) and every channel is a keyword of the function's colour space. An
 * origin that may be transparent has no colour to derive from: only with no alpha, or `alpha` itself, is the result
 * not black.
 */
function relativeFromToken(name, inner, valuesOf, computed = false) {
  const slash = splitTop(inner, "/");
  if (slash.length > 2) return false;
  const words = splitTop(slash[0].trim(), " ").filter((w) => w !== "");
  if (words.length < 2 || words[0].toLowerCase() !== "from") return false;
  const origin = words[1];
  if (!tokenColour(origin, valuesOf)) return false;
  // `color(from <origin> srgb r g b)` names a colour space before its channels.
  const channels = words.slice(2);
  const space = name === "color" ? COLOR_SPACES[channels.shift()?.toLowerCase()] : FUNCTION_CHANNELS[name];
  if (!space) return false;
  const allowed = keywordsOf(space);
  if (channels.length !== 3 || !channels.every((w) => allowed.has(w.toLowerCase()) || (computed && isComputedChannel(w, allowed)))) return false;
  if (slash.length === 1) return true;
  const alpha = slash[1].trim();
  if (mayBeTransparent(origin, valuesOf) && !/^alpha$/i.test(alpha)) return false;
  return NUMBER.test(alpha) || PERCENT.test(alpha) || isVarCall(alpha) || /^alpha$/i.test(alpha);
}

/** True when `call` (a whole colour function call) names no colour of its own: every colour in it comes from a token. */
export function builtFromTokens(call, valuesOf = () => []) {
  const open = call.indexOf("(");
  const name = call.slice(0, open).trim().toLowerCase();
  const inner = spaced(call.slice(open + 1, -1));
  if (name === "color-mix") {
    const { colours, method: hasMethod } = mixColours(inner);
    if (colours.length === 0 || (!hasMethod && colours.length < 2)) return false;
    return colours.every((part) => {
      const words = splitTop(part.trim(), " ").filter((w) => w !== "" && !PERCENT.test(w));
      return words.length === 1 && tokenColour(words[0], valuesOf);
    });
  }
  if (name === "light-dark") {
    const arms = splitTop(inner, ",");
    return arms.length === 2 && arms.every((arm) => tokenColour(arm, valuesOf));
  }
  if (!SINGLE.test(name)) return false;
  if (relativeFromToken(name, inner, valuesOf)) return true;
  const channels = channelsOf(inner).trim();
  if (isVarCall(channels)) return tokenColour(channels, valuesOf);
  // One token for each channel (`hsl(var(--h) var(--s) var(--l))`), with any alpha. A calc() channel is not one.
  const each = splitTop(channels, splitTop(channels, ",").length > 1 ? "," : " ").map((part) => part.trim()).filter((part) => part !== "");
  return each.length === 3 && each.every((part) => isVarCall(part) && tokenColour(part, valuesOf));
}

/**
 * The origin of a derived shade, or null: a relative colour from a token whose only problem is a computed channel
 * (`oklch(from var(--primary) calc(l * 0.9) c h)`). It is not built from tokens, because the shade is the call's own,
 * but it names no colour of its own either. Anything else wrong with the call (a raw number in a channel, a literal
 * origin, an origin that may be transparent, which has no colour to derive from) is null.
 */
export function derivedShadeOrigin(call, valuesOf = () => []) {
  const open = call.indexOf("(");
  const name = call.slice(0, open).trim().toLowerCase();
  if (!SINGLE.test(name) || builtFromTokens(call, valuesOf)) return null;
  const inner = spaced(call.slice(open + 1, -1));
  if (!relativeFromToken(name, inner, valuesOf, true)) return null;
  const origin = splitTop(splitTop(inner, "/")[0].trim(), " ").filter((w) => w !== "")[1];
  // A transparent origin has no colour to derive a shade from: its channels are the call's own.
  return mayBeTransparent(origin, valuesOf) ? null : origin;
}

/**
 * Every value a token can take, with the places the search could not go on. A value that is another token
 * (`var(--y)`) is followed, through at most nine others (the start and nine more, ten in all); a value that is not is a
 * leaf. A stop is `{ path }`, the tokens from `start` to the one that has no value that was read (or `{ path, depth: true }`
 * where the chain is longer than is followed). A ring of tokens ends its search and adds nothing. `reached` is the path
 * to every token the search visited, `start` first, so that a caller can ask whether any of them is one the code sets.
 */
const MOST_FOLLOWED = 10;
function followToken(start, valuesOf) {
  const leaves = [];
  const stops = [];
  const reached = [];
  const seen = new Set();
  const walk = (path) => {
    const name = path[path.length - 1];
    if (seen.has(name)) return;
    seen.add(name);
    reached.push(path);
    if (path.length > MOST_FOLLOWED) return void stops.push({ path, depth: true });
    const values = valuesOf(name);
    if (values.length === 0) return void stops.push({ path });
    for (const value of values) {
      const v = value.trim();
      const next = VAR_NAME.exec(v);
      if (next && callAt(v, 0) === v) walk([...path, next[1]]);
      else leaves.push(v);
    }
  };
  walk([start]);
  return { leaves, stops, reached };
}

/**
 * A token the product's code sets, anywhere on the chain: `{ path, code: true }` with the path to the first, or null.
 * The code sets it on an element, so the value in use there is the code's and not the stylesheet's, and the
 * stylesheet's value says nothing of it.
 */
function setByCodeOn(reached, setByCode) {
  const path = reached.find((p) => setByCode(p[p.length - 1]));
  return path ? { path, code: true } : null;
}

/**
 * The token a single colour function wraps whole when that token holds a whole colour in every value it can take,
 * with that value and its alpha as written (or null): `{ token, value, alpha }`, or null. `valuesOf(name)` gives every value a token is declared with (one per
 * theme), or none when it is not known; a value that is another token (`var(--y)`) is followed. Null whenever any
 * value is channels, or cannot be read: only a token known to be a whole colour is named. Null too where a token on
 * the chain is one the product's code sets (`setByCode`): the code's value is not read, and wrappedUnreadColour says so.
 */
export function wrappedWholeColour(call, valuesOf, setByCode = () => false) {
  const open = call.indexOf("(");
  if (!SINGLE.test(call.slice(0, open).trim())) return null;
  const channels = channelsOf(spaced(call.slice(open + 1, -1))).trim();
  const m = VAR_NAME.exec(channels);
  if (!m || callAt(channels, 0) !== channels) return null;
  const { leaves, stops, reached } = followToken(m[1], valuesOf);
  if (stops.length > 0 || leaves.length === 0 || !leaves.every((value) => isColorValue(value))) return null;
  if (setByCodeOn(reached, setByCode)) return null;
  return { token: m[1], value: leaves[0], alpha: alphaOf(spaced(call.slice(open + 1, -1))) };
}

/**
 * The token a single colour function wraps whole when that token's value cannot be followed, or null:
 * `{ token, stops }`, each stop naming where the search ended (`followToken`). Neither `wrappedWholeColour` nor "built
 * from tokens" can say whether such a call is right: if the token holds channels it is, and if it holds a whole
 * colour it is not a colour at all. Only a token with a value that was not read is named, and only when nothing it holds is
 * known to be channels (any value that is not a whole colour). A whole colour in one theme does not make it known: it
 * is the wrong shape here, and the theme that was not read may be channels or not. A token that is a whole colour in
 * every value is wrappedWholeColour's, and a ring of tokens says nothing. The exception is a token the product's code
 * sets (`setByCode`): its stylesheet value is a whole colour, which would be the wrong shape, but the code may set
 * channels on the element, so it is named as one whose value is the code's (`{ path, code: true }`). A stylesheet that
 * holds channels for it makes no claim, as before.
 */
export function wrappedUnreadColour(call, valuesOf, setByCode = () => false) {
  const open = call.indexOf("(");
  if (!SINGLE.test(call.slice(0, open).trim())) return null;
  const channels = channelsOf(spaced(call.slice(open + 1, -1))).trim();
  const m = VAR_NAME.exec(channels);
  if (!m || callAt(channels, 0) !== channels) return null;
  const { leaves, stops, reached } = followToken(m[1], valuesOf);
  if (stops.length > 0) return !leaves.some((value) => !isColorValue(value)) ? { token: m[1], stops } : null;
  const code = leaves.length > 0 && leaves.every((value) => isColorValue(value)) && setByCodeOn(reached, setByCode);
  return code ? { token: m[1], stops: [code] } : null;
}

// What a token that holds bare channels holds: three channels (numbers, percentages, angles or `none`), separated by
// spaces or by commas, with an alpha after a `/` or a fourth comma.
const CHANNEL = String.raw`(?:[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?(?:%|deg|grad|rad|turn)?|none)`;
const CHANNELS_RE = new RegExp(String.raw`^${CHANNEL}(?:\s*,\s*|\s+)${CHANNEL}(?:\s*,\s*|\s+)${CHANNEL}(?:\s*[/,]\s*${CHANNEL})?$`, "i");
const HSL_CHANNELS_RE = /^[+-]?(?:\d*\.)?\d+(?:deg|grad|rad|turn)?[\s,]+[+-]?(?:\d*\.)?\d+%[\s,]+[+-]?(?:\d*\.)?\d+%/i;

/** The tokens a single call takes where a whole colour is expected: the arms of a mix, the arms of a light-dark, the origin of a relative colour. */
function wholeColourSlots(call) {
  const open = call.indexOf("(");
  const name = call.slice(0, open).trim().toLowerCase();
  const inner = spaced(call.slice(open + 1, -1));
  let slots = [];
  if (name === "color-mix") {
    slots = mixColours(inner).colours.map((part) => splitTop(part.trim(), " ").filter((w) => w !== "" && !PERCENT.test(w))).filter((words) => words.length === 1).map((words) => words[0]);
  } else if (name === "light-dark") {
    slots = splitTop(inner, ",").map((arm) => arm.trim());
  } else if (SINGLE.test(name)) {
    const words = splitTop(splitTop(inner, "/")[0].trim(), " ").filter((w) => w !== "");
    if (words.length >= 2 && words[0].toLowerCase() === "from") slots = [words[1]];
  }
  const tokens = slots.filter(isVarCall).map((v) => VAR_NAME.exec(v)?.[1]).filter(Boolean);
  return [...new Set(tokens)];
}

/**
 * The tokens a colour function, a mix or a light-dark takes where a whole colour is expected (a mix arm, a light-dark
 * arm, the origin of a relative colour), sorted by what is known of each:
 * `channels`: `{ token, value, wrap, assumed }`, a token known in every value to hold bare channels, so the call is
 * not a colour, with the function to wrap it in (`hsl` when the channels are hue, saturation and lightness, and `hsl`
 * said to be assumed when they are not); `unread`: `{ token, stops }`, a token with a value that was not read and none
 * that is a whole colour, so whether the call is right is not known. A token that is a whole colour, or channels in
 * some themes and a whole colour in others, is neither. A token the product's code sets (`setByCode`) is never in
 * `channels`: its stylesheet value is not the value in use, so it is in `unread`, as `{ path, code: true }`.
 */
export function colourSlots(call, valuesOf, setByCode = () => false) {
  const out = { channels: [], unread: [] };
  for (const token of wholeColourSlots(call)) {
    const { leaves, stops, reached } = followToken(token, valuesOf);
    if (stops.length === 0 && leaves.length > 0 && leaves.every((value) => CHANNELS_RE.test(value))) {
      // Channels in the stylesheet, but a token the code sets holds what the code says there: not known to be channels.
      const code = setByCodeOn(reached, setByCode);
      if (code) out.unread.push({ token, stops: [code] });
      else out.channels.push({ token, value: leaves[0], wrap: "hsl", assumed: !HSL_CHANNELS_RE.test(leaves[0]) });
    } else if (stops.length > 0 && leaves.every((value) => CHANNELS_RE.test(value))) {
      out.unread.push({ token, stops });
    }
  }
  return out;
}
