// packages/undrift/src/report.mjs
// Output written for an agent's turn, not a CI log. Silence is the default
// (spec P5): violations self-correct without commentary, gaps get one notice,
// triage only on request.

import { LISTED } from "./unchecked.mjs";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * One line. The whole turn's report when nothing needs a human.
 *
 * Three things this line refuses to lie about:
 *
 * 1. **Exemptions.** An exemption is an invisible violation ("0 violations,
 *    14 exemptions" is not a clean run), so the count is always surfaced.
 * 2. **Gaps under --strict.** Strict promotes every valid gap to an
 *    `unresolved-gap` violation, so `violations` already contains them.
 *    Printing both counts would report one item twice ("✗ 1 violation ·
 *    1 gap"). Strict therefore names what actually blocks the release, which is
 *    the unresolved gaps, and counts the remaining violations separately.
 * 3. **What was not checked.** A run that checked less than it was configured to
 *    is not on-system. With no violations the head is "⚠ n not checked"; with
 *    violations the count rides along as a part. "On-system" is printed only when
 *    nothing is wrong and nothing went unchecked.
 * 4. **Deferred problems.** A problem the person chose to fix later passes, and is never called clean:
 *    with nothing else wrong the head is "⚠ n deferred".
 * 5. **A part of a rule not checked.** A rule that ran on less than it is for (`notes`: a "rulePart" item,
 *    which nobody can always fix, so it never fails --strict) is a warning and never green: with nothing
 *    else wrong the head is "⚠ n rule part(s) not checked".
 * 6. **Values not checked.** A value no token can reach (`values`: the values of "values" items, a PDF style or a
 *    <meta> tag's content) is neither a violation nor clean. It never fails --strict, and it is never green: with
 *    nothing else wrong the head is "⚠ n value(s) not checked".
 */
export function statusLine({
  declarations = 0, violations = 0, gaps = 0, exemptions = 0, strict = false, system,
  notChecked = 0, notes = 0, values = 0, deferred = 0,
} = {}) {
  // Under strict, `gaps` of the violations are gap promotions; don't re-count them.
  const gapViolations = strict ? Math.min(gaps, violations) : 0;
  const other = violations - gapViolations;

  const head =
    other > 0 ? `✗ ${plural(other, "violation")}`
    : gapViolations > 0 ? `✗ ${plural(gapViolations, "unresolved gap")}`
    : notChecked > 0 ? `⚠ ${notChecked} not checked`
    : notes > 0 ? `⚠ ${plural(notes, "rule part")} not checked`
    : values > 0 ? `⚠ ${plural(values, "value")} not checked`
    : deferred > 0 ? `⚠ ${deferred} deferred`
    : "✓ on-system";

  const parts = [head];
  if (other > 0 && gapViolations > 0) parts.push(plural(gapViolations, "unresolved gap"));
  if (notChecked > 0 && (other > 0 || gapViolations > 0)) parts.push(`${notChecked} not checked`);
  if (notes > 0 && (other > 0 || gapViolations > 0 || notChecked > 0)) parts.push(`${plural(notes, "rule part")} not checked`);
  if (values > 0 && (other > 0 || gapViolations > 0 || notChecked > 0 || notes > 0)) parts.push(`${plural(values, "value")} not checked`);
  if (deferred > 0 && (other > 0 || gapViolations > 0 || notChecked > 0 || notes > 0 || values > 0)) parts.push(`${deferred} deferred`);
  parts.push(plural(declarations, "declaration"));
  if (!strict && gaps > 0) parts.push(plural(gaps, "gap"));
  if (exemptions > 0) parts.push(plural(exemptions, "exemption"));
  if (system) parts.push(system);
  return parts.join(" · ");
}

/**
 * A gap notice. Three parts, always:
 *   1. what is missing
 *   2. why the system cannot serve it
 *   3. why it was needed  ← only the agent knows this
 */
export function gapNotice({ what, reason, need, placed = true }) {
  const lines = [`⚠ Gap: ${what}`, `  ${reason}`];
  if (need) lines.push(`  ${need}`);
  if (placed) lines.push(`  Placed a gap marker; the rest of this screen is on-system.`);
  return lines.join("\n");
}

/**
 * One profile's verdict, for its own line. "Clean" is claimed only when the profile
 * matched files, found no violation, and every rule it turns on could run, and set
 * no stylesheet and no other file set aside unchecked. Otherwise it says what it did not
 * do. `tone` is for the caller to colour. `stylesheets` counts the stylesheets set aside
 * and unchecked and `others` the files that are not scripts, set aside and unchecked;
 * `setAside` counts every one of both, the ones `ignore` accounts for included. `walked` counts what the
 * profile's own glob walked past and could not see, and nothing accounts for: a directory it could not
 * read, a link it did not follow.
 */
export function profileVerdict({
  files = 0, violations = [], rulesNotRun = [], stylesheets = 0, others = 0, setAside = 0, unmatched = 0, walked = 0, deferred = 0, rulesPartlyRun = 0, valuesNotChecked = 0,
} = {}) {
  if (violations.length > 0) return { tone: "bad", text: `✗ ${violations.length} violation(s)` };
  if (files === 0 && walked > 0) return { tone: "warn", text: `⚠ no files checked, ${walked} folder(s) or link(s) not checked` };
  if (files === 0) {
    if (setAside === 0) return { tone: "warn", text: "⚠ no files matched" };
    // Everything the profile reached was set aside, and `ignore` accounts for all of it:
    // nothing is left unchecked, so a warning here would disagree with the status under it.
    if (stylesheets === 0 && others === 0) return { tone: "ok", text: `✓ nothing to check, ${plural(setAside, "file")} ignored` };
    if (stylesheets > 0 && others > 0) {
      return { tone: "warn", text: "⚠ only stylesheets and files Undrift cannot check, none checked" };
    }
    return others > 0
      ? { tone: "warn", text: "⚠ only files Undrift cannot check, none checked" }
      : { tone: "warn", text: "⚠ only stylesheets, none checked" };
  }
  const not = [];
  if (rulesNotRun.length > 0) not.push(`${plural(rulesNotRun.length, "rule")} not run`);
  if (stylesheets > 0) not.push(`${plural(stylesheets, "stylesheet")} not checked`);
  if (others > 0) not.push(`${plural(others, "file")} Undrift cannot check`);
  if (unmatched > 0) not.push(`${plural(unmatched, "path")} matched no files`);
  if (walked > 0) not.push(`${walked} folder(s) or link(s) not checked`);
  if (rulesPartlyRun > 0) not.push(`${plural(rulesPartlyRun, "rule part")} not checked`);
  if (valuesNotChecked > 0) not.push(`${plural(valuesNotChecked, "value")} not checked`);
  if (deferred > 0) not.push(`${deferred} deferred`);
  if (not.length > 0) return { tone: "warn", text: `⚠ no violations, ${not.join(", ")}` };
  return { tone: "ok", text: "✓ clean" };
}

/**
 * The "Not checked" block: a header, then one entry per item that names the
 * thing, the reason and the fix on a single line. The paths of a files or
 * stylesheets item go beneath it as `details`, so the entry itself stays one line.
 * Null when there is nothing to say.
 */
export function formatNotChecked(items) {
  if (items.length === 0) return null;
  return {
    header: `Not checked (${items.length}):`,
    entries: items.map((item) => {
      // The item carries every path, for the JSON. A person reads the first LISTED. A link
      // is shown with what it leads to, since that is what is not checked.
      const lines = item.links ? item.links.map((link) => `${link.path} -> ${link.target}`) : item.files ?? [];
      const details = lines.slice(0, LISTED);
      const more = (item.count ?? 0) - details.length;
      if (details.length > 0 && more > 0) details.push(`and ${more} more`);
      return { text: `${item.reason} Fix: ${item.fix}`, details };
    }),
  };
}

/**
 * The one quiet line for files that are accounted for and not checked: excluded
 * on purpose by a profile's own ! patterns, and ignored with a reason. Counted,
 * never hidden. Null when there are none.
 */
export function accountedForLine(counts) {
  if (!counts) return null;
  const parts = [];
  if (counts.excluded > 0) {
    parts.push(`${plural(counts.excluded, "UI file")} excluded by a profile's own ! patterns`);
  }
  if (counts.ignored > 0) parts.push(`${plural(counts.ignored, "UI file")} ignored via "ignore"`);
  const sheets = counts.stylesheets?.ignored ?? 0;
  if (sheets > 0) parts.push(`${plural(sheets, "stylesheet")} ignored via "ignore"`);
  const others = counts.others?.ignored ?? 0;
  if (others > 0) parts.push(`${plural(others, "other file")} ignored via "ignore"`);
  if (parts.length === 0) return null;
  const reasons = counts.ignored > 0 || sheets > 0 || others > 0 ? " The reasons are in undrift.config.json." : "";
  return `Accounted for, not hidden: ${parts.join(", ")}.${reasons}`;
}
