// sample/packages/undrift/src/older.mjs
// Older problems: what Undrift finds on lines the agent did not write. They are not the agent's to fix
// and not Undrift's to wave through. The person decides, through the agent (spec, section 4): fix it
// now, or later, which puts it on the later list. Only the gate's rules make an older problem, an opt-in
// rule wherever a covering profile turns it on; a gap on an older line is left to the gate in CI, where it
// is judged as ever.
import { gateSourceWithGaps } from "./gate.mjs";
import { ALL_RULES, profileRules } from "./rules.mjs";
import { measurable, SAME_COLOUR } from "./nearest.mjs";
import { layersOf, listRoles, colourIndexOf } from "./layers.mjs";
import { colourFix, FIXED_ADVICE } from "./palette-advice.mjs";
import { profilesFor, rulesNotRun, rulesPartlyRun } from "./unchecked.mjs";
import { agentLines } from "./agent-lines.mjs";

export { SAME_COLOUR };

/** Did the agent change any line this violation spans? */
const touched = (v, lines) => {
  for (let line = v.startLine ?? v.line; line <= (v.endLine ?? v.line); line++) if (lines.has(line)) return true;
  return false;
};

/** Split violations by who wrote their lines. `mine` is what agentLines returned. */
export function splitByAuthor(violations, mine) {
  if (mine.all) return { agents: violations, older: [] };
  return {
    agents: violations.filter((v) => touched(v, mine.lines)),
    older: violations.filter((v) => !touched(v, mine.lines) && ALL_RULES.includes(v.rule)),
  };
}

/**
 * Judge one file as the gate would, with the rules of every profile that covers it, and split what it
 * finds by who wrote the lines. The hook and `undrift later` both use this, so they judge a file alike,
 * and neither can say "nothing there" about a rule it did not look for.
 * @param {object} args
 * @param {object} args.contract
 * @param {string} args.rel the file's path from the config's folder
 * @param {string[]} [args.alsoAs] other names a profile's include may give the file
 * @param {string} args.file the path the source is parsed under
 * @param {string} args.realFile the file's real path, for git
 * @param {string} args.source
 * @returns {null | {profiles: object[], rules: string[], rulesNotRun: object[], rulesPartlyRun: object[], mine: object, agents: object[], older: object[]}}
 *   null when no profile covers the file; `rules` is every rule a covering profile turns on,
 *   `rulesNotRun` the ones among them that could not run, and `rulesPartlyRun` the ones that ran on less
 *   than they are for
 */
export function olderProblems({ contract, rel, alsoAs = [], file, realFile, source }) {
  const profiles = profilesFor(contract, rel, alsoAs);
  if (profiles.length === 0) return null;
  // A profile that omits `rules` applies the default rules, exactly as it does for `undrift gate`.
  const rules = [...new Set(profiles.flatMap((p) => profileRules(p.profile)))];
  const { violations } = gateSourceWithGaps(source, { fileName: file, rules, contract });
  const mine = agentLines(realFile);
  return { profiles, rules, rulesNotRun: rulesNotRun(contract, rules), rulesPartlyRun: rulesPartlyRun(contract, rules), mine, ...splitByAuthor(violations, mine) };
}

/** A rule's reason for not running, to sit in parentheses in a sentence: no full stop, no capital. */
export const reasonInSentence = (reason) => reason.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase());

/**
 * Why a rule was not looked for in a file `olderProblems` judged, or null when it was. No full stop.
 * `value` is the problem's value, when it is named: a colour utility is not looked for by a
 * no-primitive-tokens that ran only in part.
 */
export function whyNotLooked(judged, rule, value) {
  if (!judged.rules.includes(rule)) return "no profile that covers it turns the rule on";
  const notRun = judged.rulesNotRun.find((n) => n.rule === rule);
  if (notRun) return reasonInSentence(notRun.reason);
  if (rule === "no-primitive-tokens" && typeof value === "string" && !value.startsWith("--") && judged.rulesPartlyRun.some((p) => p.rule === rule)) {
    return "its colour utilities are not checked in this profile";
  }
  return null;
}

/** A word for a POSIX shell, in single quotes, so `$`, backticks and spaces in a file name stay as they are. */
export const shellQuote = (word) => `'${String(word).replace(/'/g, "'\\''")}'`;

// The gate's messages are written with dashes; the note is not. A value from the code can carry a
// newline, which would break the list, so every run of white space becomes one space.
const plain = (text) => String(text).replace(/\s*[\u2014\u2013]\s*/g, ": ").replace(/\s+/g, " ").trim();
// A file name keeps its spaces: it is the name the agent will recognise. Only a line break, which would
// break the note, becomes a space.
const plainName = (text) => String(text).replace(/\s*[\u2014\u2013]\s*/g, ": ").replace(/[\r\n\u2028\u2029]+/g, " ");

/** The most problems a note lists: a file with hundreds would fill the agent's context with them. */
const MAX_LISTED = 20;

const colourOf = (v) =>
  v.rule === "no-raw-colors" ? v.found
    : v.rule === "no-arbitrary-values" && v.found.startsWith("[") ? v.found.slice(1, -1)
      : null;

/**
 * What the first choice, "Fix it", can say for one problem. In a token set with a primitive layer the
 * nearest colour is a palette entry, never a role, so the choice names the roles built on it (`roles`),
 * or, when no role uses it, asks for one: the same advice the gate's message gives.
 */
export function fixFor(v, index, layers = layersOf({})) {
  const colour = colourOf(v);
  if (colour === null) return { kind: "message" };
  // "No token is close" is a measurement. With nothing to measure against, or a colour that cannot be
  // placed, there is no measurement, and the message's own advice is all that can be said.
  if (index.length === 0 || !measurable(colour)) return { kind: "message" };
  // The same answer the gate's message gives, from the same function (palette-advice.mjs).
  return colourFix(layers, index, colour);
}

const firstChoice = (fix) =>
  fix.kind === "same" && fix.roles ? `Fix it: use the role whose meaning fits, of those built on the same colour: ${listRoles(fix.roles)}, or its utility.`
    : fix.kind === "near" && fix.roles ? `Fix it: name your closest pick of the roles built on the nearest colour, which is not the same colour (${listRoles(fix.roles)}), and say it is not an exact match.`
      : fix.kind === "unused" ? `Propose a role: the nearest colour, ${fix.token}, is a palette entry no role uses, so say which role the design system would need.`
        : fix.kind === "same" ? `Fix it: use var(${fix.token}), or the utility that maps to it. It is the same colour.`
          : fix.kind === "near" ? `Fix it: name your closest pick (the nearest token is ${fix.token}, which is not the same colour) and say it is not an exact match.`
            : fix.kind === "none" ? "Propose a new token: no token is close, so say which token the design system would need."
              : fix.kind === "fixed" ? FIXED_ADVICE
                : "Fix it: the fix the message names.";

/**
 * The note the hook sends about a file's older problems. `later` is the command that runs Undrift's
 * `later` for this repository, written by the hook with absolute paths, so it works from wherever the
 * agent's shell is and can never fetch a package of the same name from a registry.
 */
export function olderNotice({ rel, older, contract, later }) {
  const index = colourIndexOf(contract);
  const layers = layersOf(contract);
  const n = older.length;
  const file = shellQuote(rel);
  const items = older.slice(0, MAX_LISTED).map((v) =>
    `  - line ${v.line} [${v.rule}] ${plain(v.found)}: ${plain(v.message)}\n` +
    `    First choice: ${firstChoice(fixFor(v, index, layers))}\n` +
    `    Later: ${later} ${file} --line ${v.line} --rule ${v.rule} --value ${shellQuote(v.found)} --reason <their reason, if they gave one, single-quoted for the shell>`);
  return (
    `Undrift found ${n} older ${n === 1 ? "problem" : "problems"} in ${plainName(rel)}, on lines you did not write, so ${n === 1 ? "it is" : "they are"} not yours to fix:\n` +
    `${items.join("\n")}\n` +
    (n > MAX_LISTED ? `  and ${n - MAX_LISTED} more (run the gate on this file to see them all)\n` : "") +
    `When your task is done, ask the person whether to fix ${n === 1 ? "it" : "them"} now or later. Do not fix or defer anything without their answer. ` +
    'If you can offer clickable choices, offer three for each problem, with the details above filled in: its first choice, "Later", and "Later, for everything old in this file". ' +
    "If you cannot, ask in words with the same three. " +
    `For "Later, for everything old in this file", run: ${later} ${file} --reason <their reason, if they gave one, single-quoted for the shell>. ` +
    "A line can move while you work, so each command names its problem as well as its line: if one says the problem has moved, run it again with the line it names. " +
    "Deleting an entry from undrift.later.json brings the problem back."
  );
}
