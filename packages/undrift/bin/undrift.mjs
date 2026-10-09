#!/usr/bin/env node
// undrift: the enforcement layer for agent-ready design systems.
//   undrift init  <package> | --components <folder>  [--config <dir>] [--force]
//   undrift gate  [paths…] [--profile app|system] [--format json]
//   undrift audit          [--format json]
// Exit codes: 0 = clean, 1 = violations/failed metrics, 2 = usage error.
// `gate --strict` also exits 1 when the run checked less than it was configured to.
import { loadContract } from "../src/contract.mjs";
import { gateProfile, gateFiles, compliance, ALL_RULES } from "../src/gate.mjs";
import { profileRules } from "../src/rules.mjs";
import { runAudit } from "../src/audit.mjs";
import { runInit, suggestionLines, intrinsicLines, InitUsageError } from "../src/init.mjs";
import { statusLine, profileVerdict, formatNotChecked, accountedForLine } from "../src/report.mjs";
import { classifyCoverage, collectNotChecked, accountRunStylesheets, accountRunOthers, profileMatchesFiles, mergeWalked, accountWalked, profileFor, hasScriptExtension } from "../src/unchecked.mjs";
import { loadLater, applyLater, notYetDeferred, relFor, entriesFor, updateLater, problemId } from "../src/later.mjs";
import { olderProblems, whyNotLooked, reasonInSentence } from "../src/older.mjs";
import { loadState } from "../src/state.mjs";
import { buildTriage, formatTriage } from "../src/triage.mjs";
import { relative, resolve } from "node:path";
import { existsSync, statSync, writeFileSync, readFileSync, realpathSync } from "node:fs";

const args = process.argv.slice(2);
const command = args[0];

const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
// Boolean flags take no value, so the argument after them is a real path.
// Without this exclusion `undrift gate --strict src/x.tsx` silently swallows
// the path and gates nothing. It is a green run that proves nothing.
const BOOLEAN_FLAGS = new Set(["--strict", "--force", "--explain", "--all"]);
const paths = args.slice(1).filter((a, i, all) => {
  if (a.startsWith("--")) return false;
  const prev = all[i - 1];
  return !(prev && prev.startsWith("--") && !BOOLEAN_FLAGS.has(prev));
});

const format = flag("format", "text");
const configPath = flag("config", process.cwd());

// A report ends by setting the exit code and letting the process finish. process.exit()
// abandons whatever stdout has not yet been handed to a pipe, and a pipe takes 64 KiB
// before it waits for its reader: a longer report was cut off mid-sentence, and JSON
// cut off no longer parses. A usage error prints a line and stops, so it still exits
// at once.
const finish = (code) => {
  process.exitCode = code;
};

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function usage() {
  console.log(`Undrift is the enforcement layer for agent-ready design systems

Usage:
  undrift init <package> | --components <folder>  [--config <dir>] [--force]
  undrift gate [paths…]  [--profile <name>] [--config <path>] [--format json] [--strict]
  undrift later <file> [--rule <rule> --value <value>] [--line <n>] [--reason <text>] | --all [--reason <text>]  [--config <path>]
  undrift triage         [--config <path>]
  undrift audit          [--config <path>] [--format json]

init   Read an installed design system (or, with --components, a folder of
       components inside the app) and the app's own stylesheets, and scaffold
       undrift.config.json plus the <Missing> placeholder. When a reading
       finds nothing it says what is missing and writes nothing, unless
       --force. Existing files are kept unless --force.
gate   Check source against the design system's contract. With no paths,
       runs every configured profile. With paths, runs them under --profile
       (default: app). Declared gaps pass the dev loop; --strict (release/CI)
       fails on them. --strict checks every profile, so it cannot be combined
       with --profile when there are no paths and more than one profile.
       Anything the gate was configured to check and could not
       (a missing or unreadable source, a rule with no input, a profile that
       matched no files, UI files no profile covers, files only a profile
       that --profile did not run covers, stylesheets, files that are not
       scripts, directories it cannot read, links it does not follow) is
       listed under "Not checked". The dev loop still passes; --strict
       fails on it too.
later  Put problems on undrift.later.json, for a person who chose to fix them
       later. With a file, only its older problems (on lines git shows were
       not just changed). To defer one problem, name it with --rule and
       --value (every older occurrence in the file), and add --line to name
       the line too: a line that no longer holds it is refused, and the
       command says where it is now. --line alone, for typing by hand, defers
       what is on that line. With --all, every problem there is now, for
       adopting Undrift on an existing app. The gate lists deferred problems
       and does not fail on them, and lists entries that cover more than it
       finds, or nothing.
triage List outstanding gaps, ranked by how often each was needed, with the
       legitimate resolutions for each. A listing. It never fails.
audit  Compute the five value metrics for the configured system.
`);
}

try {
  if (command === "init") {
    // `--components --force` is a flag where the folder should be, not a folder named --force.
    const folder = flag("components");
    if (args.includes("--components") && (!folder || folder.startsWith("--"))) {
      console.error(red("undrift init: --components needs a folder, such as components/ui."));
      process.exit(2);
    }
    let result;
    try {
      result = runInit(configPath, paths[0] ?? null, { force: args.includes("--force"), components: folder });
    } catch (err) {
      if (!(err instanceof InitUsageError)) throw err;
      console.error(red(`undrift init: ${err.message}`));
      process.exit(2);
    }

    console.log(bold(`Undrift init: ${result.system}`));
    const from = result.componentsFrom.length ? result.componentsFrom.join(", ") : "(no component source found)";
    // A list read in part is never counted as if it were whole.
    console.log(`  ${result.partial ? "at least " : ""}${result.components.length} component(s) from ${dim(from)}`);
    // The stylesheet listed only because it loads Tailwind's theme declares no tokens, so it is not "tokens from".
    const declaring = result.tokensCss.filter((file) => file !== result.tailwindStylesheet);
    console.log(`  tokens from ${dim(declaring.length ? declaring.join(", ") : "(no stylesheet declares a custom property)")}`);
    if (result.tailwindStylesheet) {
      console.log(`  also reads ${dim(result.tailwindStylesheet)}, which loads Tailwind's theme and declares no tokens, for Tailwind's own variables`);
    }
    if (result.stylesheets.skipped.length) {
      console.log(dim(`  not read as tokens: ${result.stylesheets.skipped.join(", ")} (its own theme is not the design system's)`));
    }
    // A typed key names the element it matches: <input type="checkbox">, not input[type=checkbox].
    const element = (key) => {
      const typed = /^input\[type=(.*)\]$/.exec(key);
      return typed ? `<input type="${typed[1]}">` : `<${key}>`;
    };
    const mapped = Object.entries(result.intrinsics).filter(([, v]) => v);
    if (mapped.length) {
      console.log(`  intrinsics ${dim(mapped.map(([key, name]) => `${element(key)} to <${name}>`).join(", "))}`);
    }
    for (const line of intrinsicLines(result)) console.log(line);
    if (result.includeAdded.length) {
      console.log(`  also covers ${dim(result.includeAdded.map((dir) => `${dir}/`).join(", "))}, where the app imports the system`);
    }
    for (const line of suggestionLines(result)) console.log(line);
    for (const warning of result.warnings) console.log(yellow(`  \u26A0 ${warning}`));
    // Advice that two problems carry is said once, under the first.
    const said = new Set();
    for (const problem of result.problems) {
      console.log(red(`  \u2717 ${problem.what}`));
      if (!said.has(problem.fix)) console.log(`    ${problem.fix}`);
      said.add(problem.fix);
    }
    if (result.refused) {
      console.error(
        red(
          result.forceable
            ? "\nNothing was written. Fix the above and run undrift init again, or add --force to write the config with what was found."
            : "\nNothing was written. Fix the above and run undrift init again."
        )
      );
      process.exit(1);
    }
    console.log(
      result.wroteConfig
        ? green(`  wrote ${result.configPath}`)
        : dim(`  kept existing ${result.configPath} (--force to overwrite)`)
    );
    console.log(
      result.wrotePlaceholder
        ? green(`  wrote ${result.placeholderPath}`)
        : dim(`  kept existing ${result.placeholderPath} (--force to overwrite)`)
    );
    if (result.coverage) {
      const c = result.coverage;
      console.log(`  UI files: ${c.uiFiles}, covered ${c.covered}, excluded on purpose ${c.excluded}, not covered ${c.notCovered}`);
      for (const file of c.notCoveredFiles.slice(0, 10)) console.log(dim(`    not covered: ${file}`));
      if (c.stylesheetsNotChecked.length) {
        console.log(`  stylesheets with styles of their own, not checked: ${c.stylesheetsNotChecked.length}`);
        for (const file of c.stylesheetsNotChecked.slice(0, 10)) console.log(dim(`    ${file}`));
      }
    }
    console.log(dim(`\nNext: undrift gate --config ${configPath}`));
    console.log(dim("On an app with existing problems, undrift later --all puts them on the later list, so the gate fails only on new ones."));
    process.exit(0);
  } else if (command === "gate") {
    const contract = loadContract(configPath);
    // Gaps never fail the dev loop; --strict (release/CI) promotes them.
    const strict = args.includes("--strict");
    // --strict is the release gate: a run that checked less than it was configured to does not
    // pass. A run of one profile checks less whenever another profile has files, so with more
    // than one profile the pair could never pass, however the code is fixed. That is a
    // contradiction, and it is said as one, with what to run instead: a run that fails for a
    // reason no edit removes is not a check. Only a profile that matches files leaves anything
    // unchecked, so one that matches nothing is not counted. A profile that does not exist is
    // its own error, and explicit paths are a question about those paths, so neither is caught here.
    const only = flag("profile");
    if (strict && only && paths.length === 0 && contract.profiles[only]) {
      const others = Object.keys(contract.profiles).filter((name) => name !== only && profileMatchesFiles(contract, name));
      if (others.length > 0) {
        console.error(
          red(
            "undrift: --strict cannot be combined with --profile. --strict is the release gate: a run that checked less than it was configured to does not pass, " +
              `and a run of "${only}" alone leaves the files of ${others.map((name) => `"${name}"`).join(", ")} unchecked, so it could never pass. ` +
              'Run "undrift gate --strict" with no --profile to check every profile.'
          )
        );
        process.exit(2);
      }
    }
    const runs = [];
    if (paths.length > 0) {
      const profile = flag("profile", "app");
      runs.push({ name: profile, ...gateProfile(profile, { contract, extraPatterns: paths, strict }) });
    } else {
      const names = only ? [only] : Object.keys(contract.profiles);
      for (const name of names) runs.push({ name, ...gateProfile(name, { contract, strict }) });
    }

    // The later list (spec, section 4): problems a person chose to fix later. They never fail the run,
    // --strict included, and they are never called clean: they are counted and listed with their dates.
    const laterEntries = loadLater(contract.root);
    // Each run defers its own copy of a problem: a file two profiles cover is judged by both, and both
    // meet it. What an entry covered is the most any one run found, not the sum.
    const usedLater = new Map();
    for (const r of runs) {
      const split = applyLater(laterEntries, r.violations, (v) => relFor(contract, v.file));
      r.violations = split.remaining;
      r.deferred = split.deferred;
      for (const [i, n] of split.usedCounts) usedLater.set(i, Math.max(usedLater.get(i) ?? 0, n));
    }
    const deferred = runs.flatMap((r) => r.deferred);
    // A file two profiles cover is judged by both, and each defers its own copy of a problem. The JSON
    // keeps one per run. What is read, the listing and the status line, names each problem once.
    const listed = new Map();
    for (const v of deferred) {
      const id = problemId(v, (x) => relFor(contract, x.file));
      if (!listed.has(id)) listed.set(id, v);
    }
    // An entry is out of date only if this run looked for it: a run of every profile over the whole
    // repository, in which some profile checked the entry's file with the entry's rule on and able to run.
    // Every other entry was not looked for, and is never called stale. Whether its file is still there is
    // something that can be told: only "it is not there" (ENOENT, ENOTDIR) means gone. A file in a folder
    // that cannot be read is not gone, and existsSync would say it was.
    const staleLater = [];
    const spareLater = [];
    const goneLater = [];
    const unlookedLater = [];
    if (paths.length === 0 && !only) {
      const looked = new Set();
      const covering = new Map(); // file -> [{ on, notRun, partly }] one per run that checked it
      for (const r of runs) {
        const rulesOn = profileRules(contract.profiles[r.name]);
        const notRun = new Set((r.rulesNotRun ?? []).map((n) => n.rule));
        const partly = new Set((r.rulesPartlyRun ?? []).map((n) => n.rule));
        for (const file of r.walked?.matched ?? []) {
          if (!hasScriptExtension(file)) continue;
          const rel = relFor(contract, file);
          if (!covering.has(rel)) covering.set(rel, []);
          covering.get(rel).push({ on: new Set(rulesOn), notRun, partly });
          for (const rule of rulesOn) if (!notRun.has(rule)) looked.add(JSON.stringify([rel, rule]));
        }
      }
      const missing = (rel) => {
        try { statSync(resolve(contract.root, rel)); return false; } catch (err) { return err?.code === "ENOENT" || err?.code === "ENOTDIR"; }
      };
      // A no-primitive-tokens entry whose value is not a token (`hover:bg-teal-500`) is a colour utility.
      // Recorded while the set had a colour primitive, it was not looked for in a run where every covering
      // profile ran the rule only in part, so it is never called gone or out of date by that run.
      // It needs a covering run, so the file was matched by this run's own glob: it is there, and the
      // "gone" test below cannot apply to it.
      const utility = (e) => e.rule === "no-primitive-tokens" && !e.value.startsWith("--");
      const unchecked = (e) => {
        if (!utility(e)) return false;
        const on = (covering.get(e.file) ?? []).filter((c) => c.on.has(e.rule));
        return on.length > 0 && on.every((c) => c.partly.has(e.rule));
      };
      laterEntries.forEach((e, i) => {
        if (unchecked(e)) {
          unlookedLater.push({ ...e, reason: `${e.rule} did not check colour utilities in this run` });
        } else if (looked.has(JSON.stringify([e.file, e.rule]))) {
          const found = usedLater.get(i) ?? 0;
          if (found === 0) staleLater.push(e);
          else if (found < e.count) spareLater.push({ ...e, found });
        } else if (missing(e.file)) {
          goneLater.push(e);
        } else {
          const runsOfFile = covering.get(e.file) ?? [];
          const reason = runsOfFile.length === 0 ? "no profile checked this file in this run"
            : runsOfFile.every((c) => !c.on.has(e.rule)) ? `the profile that covers this file does not turn ${e.rule} on`
              : `${e.rule} could not run in this run`;
          unlookedLater.push({ ...e, reason });
        }
      });
    }

    const all = runs.flatMap((r) => r.violations);
    // Totals live in `runs`, so reduce them back out. The A/B measurement
    // reads the headline compliance number straight out of the JSON payload.
    const totals = runs.reduce(
      (a, r) => ({
        gaps: a.gaps + (r.gaps?.length ?? 0),
        exemptions: a.exemptions + (r.exemptions?.length ?? 0),
        total: a.total + (r.declarations?.total ?? 0),
        resolved: a.resolved + (r.declarations?.resolved ?? 0),
      }),
      { gaps: 0, exemptions: 0, total: 0, resolved: 0 }
    );
    const declarations = { total: totals.total, resolved: totals.resolved };

    // What the run was configured to check and did not. A clean result has to mean
    // "checked and clean", so it is reported in every output. A run over explicit
    // paths is a question about those paths and does not account for the rest of
    // the repository; a whole-repository run accounts for every UI file and stylesheet.
    const wholeRepo = paths.length === 0;
    // A run of some profiles (`--profile`) did not look at the files only the others
    // cover, so they are not counted as covered by it.
    const ran = runs.map((r) => r.name);
    const someOnly = ran.length < Object.keys(contract.profiles).length;
    // What the runs' own globs could not see (a folder they could not read, a link they met): a
    // whole-repository run merges it into what the scan found, and a run over explicit paths, which
    // does not scan, reports it by itself.
    const walked = mergeWalked(runs);
    const coverage = wholeRepo ? classifyCoverage(contract, { ran: someOnly ? ran : null, walked }) : null;
    // Stylesheets a run set aside (named on the command line, or matched by a broad
    // profile glob): never gated, reported unless `ignore` accounts for them.
    const sheets = accountRunStylesheets(contract, runs);
    const explicitSheets = [...new Set(sheets.flatMap((s) => s.unchecked))].sort();
    // The same for what is not a script or a stylesheet (Markdown, MDX, JSON, SVG): never
    // gated, reported unless `ignore` accounts for it.
    const others = accountRunOthers(contract, runs);
    const otherFiles = [...new Set(others.flatMap((o) => o.unchecked))].sort();
    const notChecked = collectNotChecked({
      contract, runs, paths: wholeRepo ? null : paths, coverage, stylesheets: explicitSheets, others: otherFiles,
      walked: wholeRepo ? null : accountWalked(contract, walked),
    });
    // Normal mode fails only on violations: the dev loop never blocks on
    // configuration. --strict is the release gate, and a run that checked less
    // than it was configured to is not a pass.
    // A "rulePart" item is a note: nobody can always fix it, so it is listed and never fails --strict. So is a
    // "values" item: a value no token can reach, which is neither a violation nor clean.
    const failing = notChecked.filter((i) => i.kind !== "rulePart" && i.kind !== "values");
    const notes = notChecked.filter((i) => i.kind === "rulePart").length;
    const values = notChecked.filter((i) => i.kind === "values").reduce((n, i) => n + i.count, 0);
    const failed = all.length > 0 || (strict && failing.length > 0);

    if (format === "json") {
      console.log(JSON.stringify({
        pass: !failed,
        strict,
        system: contract.system,
        declarations,
        compliance: compliance(declarations),
        gaps: totals.gaps,
        exemptions: totals.exemptions,
        notChecked,
        deferred: deferred.map(({ later, ...v }) => ({ ...v, file: relFor(contract, v.file), date: later.date, reason: later.reason ?? null })),
        staleLater,
        spareLater,
        goneLater,
        unlookedLater,
        coverage: coverage?.counts ?? null,
        runs: runs.map(({ walked: _walked, deferred: _deferred, ...run }) => run),
      }, null, 2));
    } else {
      runs.forEach((r, i) => {
        const verdict = profileVerdict({
          ...r,
          deferred: r.deferred.length,
          rulesPartlyRun: (r.rulesPartlyRun ?? []).length,
          valuesNotChecked: (r.valuesNotChecked ?? []).length,
          stylesheets: sheets[i].unchecked.length,
          others: others[i].unchecked.length,
          setAside: sheets[i].total + others[i].total,
          unmatched: (r.unmatched ?? []).length,
          // what this profile's own glob could not see, less what `ignore` and the other runs' matches account for
          walked: (({ unreadable, links }) => unreadable.length + links.length)(
            accountWalked(contract, { ...(r.walked ?? { unreadable: [], links: [] }), matched: walked.matched })
          ),
        });
        const paint = { bad: red, warn: yellow, ok: green }[verdict.tone];
        console.log(`${bold(`profile ${r.name}`)}  ${dim(`${r.files} file(s)`)}  ${paint(verdict.text)}`);
        for (const v of r.violations) {
          console.log(`  ${red("✗")} ${v.file}:${v.line}:${v.column}  ${dim(`[${v.rule}]`)}`);
          console.log(`     ${v.message}`);
        }
      });
      const block = formatNotChecked(notChecked);
      if (block) {
        console.log("\n" + bold(block.header));
        for (const entry of block.entries) {
          console.log(`  ${yellow("⚠")} ${entry.text}`);
          for (const detail of entry.details) console.log(dim(`      ${detail}`));
        }
      }
      if (deferred.length > 0) {
        console.log("\n" + bold(`Deferred (${listed.size}), from undrift.later.json:`));
        for (const v of listed.values()) {
          const why = v.later.reason ? `: ${v.later.reason}` : "";
          console.log(`  ${yellow("⚠")} ${relFor(contract, v.file)}:${v.line}  ${dim(`[${v.rule}]`)} ${v.found}  ${dim(`deferred ${v.later.date}${why}`)}`);
        }
      }
      const outOfDate = staleLater.length + spareLater.length + goneLater.length;
      if (outOfDate > 0) {
        console.log("\n" + bold(`Out of date in undrift.later.json (${outOfDate}):`));
        for (const e of goneLater) console.log(dim(`  ${e.file}  [${e.rule}] ${e.value}: the file is gone. Remove it.`));
        for (const e of staleLater) console.log(dim(`  ${e.file}  [${e.rule}] ${e.value}: matches nothing now. Remove it.`));
        for (const e of spareLater) console.log(dim(`  ${e.file}  [${e.rule}] ${e.value}: covers ${e.count}, found ${e.found}. Lower its count to ${e.found}.`));
      }
      if (unlookedLater.length > 0) {
        console.log("\n" + bold(`Not looked for in undrift.later.json (${unlookedLater.length}):`));
        for (const e of unlookedLater) console.log(dim(`  ${e.file}  [${e.rule}] ${e.value}: ${e.reason}.`));
      }
      // Excluded and ignored files are counted, never hidden.
      const ignoredSheets = wholeRepo ? 0 : sheets.reduce((n, s) => n + s.ignored, 0);
      const ignoredOthers = others.reduce((n, o) => n + o.ignored, 0);
      const accounted = accountedForLine(
        wholeRepo
          ? { ...coverage.counts, others: { ignored: ignoredOthers } }
          : ignoredSheets > 0 || ignoredOthers > 0
            ? { excluded: 0, ignored: 0, stylesheets: { ignored: ignoredSheets }, others: { ignored: ignoredOthers } }
            : null
      );
      if (accounted) console.log((block ? "" : "\n") + dim(accounted));
      // `strict` is passed through so the line names unresolved gaps instead of
      // counting each one twice (once as a violation, once as a gap).
      const line = statusLine({
        declarations: declarations.total,
        violations: all.length,
        gaps: totals.gaps,
        exemptions: totals.exemptions,
        strict,
        system: contract.system,
        notChecked: failing.length,
        notes,
        values,
        deferred: listed.size,
      });
      // Green means checked and clean. Failing is red, and a pass that left
      // something unchecked is a warning, never green.
      const paintStatus = failed ? red : notChecked.length > 0 || listed.size > 0 ? yellow : green;
      console.log("\n" + paintStatus(line));
      if (all.length > 0) {
        console.log(dim("The messages above name the exact fix. Apply each and re-run."));
      } else if (totals.gaps > 0) {
        console.log(dim(`Gaps are a success state here; \`undrift triage\` lists them, \`--strict\` blocks them at release.`));
      }
      // An exemption is a violation someone talked their way out of. Silence
      // about them is how "0 violations" stops meaning anything.
      if (totals.exemptions > 0) {
        console.log(dim(`${totals.exemptions} exemption(s) suppressed a rule. A suppressed rule is still a rule that did not run. Re-read the reasons.`));
      }
      // What the note says about the exit code has to be true of this run: a run that
      // is already failing on violations does not exit 0.
      if (failing.length > 0) {
        console.log(
          strict
            ? red("--strict: a run that checked less than it was configured to does not pass.")
            : failed
              ? dim("A run that checked less than it was configured to is not a clean run. --strict, the release gate, also fails on what was not checked.")
              : dim("A run that checked less than it was configured to is not a clean run. This one exits 0; --strict, the release gate, exits 1.")
        );
      }
    }
    finish(failed ? 1 : 0);
  } else if (command === "later") {
    // A person's "later" (spec, section 4). The agent runs this only after the person chose it.
    const usageError = (message) => {
      console.error(red(message));
      process.exit(2);
    };
    // Everything on the command line is accounted for: one file, and only the options below. A typo like
    // --lines 3 used to be ignored, and the whole file was deferred.
    const TAKES = "It takes a file, --all, --line, --rule, --value, --reason and --config.";
    const given = (name) => args.includes(`--${name}`);
    const named = [];
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === "--value") i += 1; // a value may start with two dashes: a token is "--color-nope"
      else if (["--line", "--reason", "--rule", "--config"].includes(a)) { if (args[i + 1] !== undefined && !args[i + 1].startsWith("--")) i += 1; }
      else if (a === "--all") continue;
      else if (a.startsWith("-")) usageError(`undrift later does not know ${a}. ${TAKES}`);
      else named.push(a);
    }
    const all = given("all");
    let reason;
    if (given("reason")) {
      reason = flag("reason")?.trim();
      if (!reason || reason.startsWith("--")) usageError("undrift later: --reason needs the reason as text, e.g. --reason \"Rebrand in Q4\".");
    }
    let rule;
    let value;
    if (given("rule") !== given("value")) usageError("undrift later: --rule and --value go together: give both, or neither.");
    if (given("rule")) {
      rule = flag("rule");
      value = flag("value");
      if (!ALL_RULES.includes(rule)) usageError(`undrift later: --rule needs one of today's rules: ${ALL_RULES.join(", ")}.`);
      if (value === null) usageError("undrift later: --value needs the value of the problem, e.g. --value '#333333'.");
    }
    if (all && (named.length > 0 || given("line") || rule !== undefined)) {
      usageError("undrift later: --all takes no file, no --line, no --rule and no --value: it defers every problem there is now.");
    }
    if (!all && named.length > 1) usageError(`undrift later takes one file, got ${named.length}: ${named.join(", ")}.`);
    const contract = loadContract(configPath);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    // The person's own calendar day, not UTC's.
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    loadLater(contract.root); // a list that cannot be read stops the command, whatever else it finds
    const relOf = (v) => relFor(contract, v.file);
    let candidates = [];
    let pool = []; // every older occurrence the candidates are some of
    let answer = null; // set when there is nothing to defer, and why
    let notRun = []; // rules that could not run, said beside the answer so "nothing there" is never said without them
    let partlyRun = []; // rules that ran on less than they are for, said the same way
    if (all) {
      // Adoption: every problem there is now, in whole files, for a person to run once. A file two
      // profiles match is judged by both, so a problem is taken once.
      const seen = new Set();
      const notRunBy = new Map();
      const partlyBy = new Map();
      for (const name of Object.keys(contract.profiles)) {
        const run = gateProfile(name, { contract });
        for (const n of run.rulesNotRun ?? []) notRunBy.set(n.rule, n);
        for (const n of run.rulesPartlyRun ?? []) partlyBy.set(`${n.rule} ${n.what}`, n);
        for (const v of run.violations) {
          const id = problemId(v, relOf);
          if (!ALL_RULES.includes(v.rule) || seen.has(id)) continue;
          seen.add(id);
          candidates.push(v);
        }
      }
      notRun = [...notRunBy.values()];
      partlyRun = [...partlyBy.values()];
      pool = candidates;
    } else {
      const typed = named[0];
      if (!typed) usageError("undrift later needs a file, e.g. undrift later app/page.tsx --line 12, or --all to defer every problem there is now.");
      const abs = resolve(contract.root, typed);
      let isFile = false;
      try { isFile = statSync(abs).isFile(); } catch { /* not there */ }
      if (!isFile) usageError(`undrift later: ${typed} is not a file.`);
      const rel = relFor(contract, abs);
      // The file has more than one name: a profile may include it by its absolute path, or by its real one.
      const names = [abs, realpathSync(abs)];
      if (!profileFor(contract, rel, names)) usageError(`undrift later: no profile covers ${typed}, so Undrift does not check it and there is nothing to defer.`);
      const asked = given("line");
      const lineArg = flag("line");
      const line = asked ? Number(lineArg) : null;
      if (asked && !(lineArg !== null && /^[1-9]\d*$/.test(lineArg))) {
        usageError(`undrift later: --line needs a line number, got "${lineArg ?? ""}".`);
      }
      let source;
      try {
        source = readFileSync(abs, "utf8");
      } catch (err) {
        const why = { EACCES: "permission denied", EPERM: "permission denied", EISDIR: "it is a folder", ENOENT: "it is not there" }[err?.code] ?? err?.code?.toLowerCase() ?? "it failed";
        usageError(`undrift later: could not read ${typed} (${why}).`);
      }
      // The file is judged as the gate judges it, with the rules of every profile that covers it, and as the
      // hook does: both use olderProblems.
      const judged = olderProblems({ contract, rel, alsoAs: names, file: abs, realFile: names[1], source });
      const { mine } = judged;
      // The violations name no file; the later list needs one.
      const withFile = (vs) => vs.map((v) => ({ ...v, file: abs }));
      const agents = withFile(judged.agents);
      const older = withFile(judged.older);
      if (rule !== undefined) {
        // "Gone" and "no older problem" are said only of a rule that was looked for.
        const why = whyNotLooked(judged, rule, value);
        if (why) usageError(`Undrift did not look for ${rule} in ${rel} (${why}). Nothing was deferred.`);
      } else {
        notRun = judged.rulesNotRun;
        partlyRun = judged.rulesPartlyRun;
      }
      if (mine.all && (rule !== undefined || asked)) {
        // The same refusal as for the agent's own lines: a 0 would read as "deferred".
        usageError(`undrift later: git cannot tell older lines from new ones in ${rel}, so every problem in it is the agent's to fix. Nothing was deferred.`);
      } else if (mine.all) {
        answer = "Nothing to defer: git cannot tell older lines from new ones in this file, so every problem in it is the agent's to fix.";
      } else if (rule !== undefined) {
        // The problem is named, not only placed: the note was written when the task was done, and lines
        // move before the person answers. A line that does not hold it is refused, not guessed at.
        const same = (v) => v.rule === rule && v.found === value;
        const here = older.filter(same);
        const onLine = line === null ? here : here.filter((v) => v.line === line);
        if (onLine.length === 0) {
          const where = [...new Set(here.map((v) => v.line))].sort((x, y) => x - y);
          const list = (words, last) => (words.length < 2 ? words[0] : `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`);
          const problem = `[${rule}] ${value}`;
          if (where.length > 0) {
            usageError(
              `undrift later: line ${line} of ${rel} no longer holds ${problem}. Its older occurrences are now on ${where.length === 1 ? "line" : "lines"} ${list(where.map(String), "and")}. ` +
              `Run it again with ${list(where.map((n) => `--line ${n}`), "or")}.`
            );
          }
          if (agents.some(same)) {
            usageError(`undrift later: ${problem} is now only on lines the agent wrote in ${rel}, and the agent's own problems are fixed, never deferred. Nothing was deferred.`);
          }
          answer = `Nothing to defer: ${problem} is gone from ${rel}: no older problem with that rule and value is left.`;
        }
        // One "Later" is one problem: the same problem twice on a line is two, and the note offers each its own choice.
        candidates = line === null ? onLine : onLine.slice(0, 1);
      } else {
        // Refused with exit 2, as the same line named with --rule and --value is: a 0 would read as "deferred".
        if (line !== null && agents.some((v) => line >= (v.startLine ?? v.line) && line <= (v.endLine ?? v.line))) {
          usageError(`undrift later: line ${line} of ${rel} is the agent's own, and the agent's own problems are fixed, never deferred. Nothing was deferred.`);
        }
        candidates = older.filter((v) => line === null || v.line === line);
      }
      pool = older;
    }
    // What the list already defers is not added again, so running this twice adds nothing. That is worked
    // out under the lock, from the list as it is then: another `later` may have written since it was read.
    let fresh = [];
    let additions = [];
    if (answer === null) {
      updateLater(contract.root, (entries) => {
        fresh = notYetDeferred(entries, candidates, pool, relOf);
        additions = fresh.length === 0 ? [] : entriesFor(fresh, relOf, { reason, date });
        return additions;
      });
    }
    if (answer !== null) {
      console.log(answer);
    } else if (fresh.length === 0) {
      console.log(
        candidates.length === 0
          ? all ? "Nothing to defer: there is no problem to defer." : "Nothing to defer: there is no older problem there."
          : all ? "Nothing to defer: every problem there is now is already on the later list." : "Nothing to defer: what is there is already on the later list."
      );
    } else {
      console.log(bold(`Deferred ${fresh.length} problem(s) in undrift.later.json:`));
      for (const a of additions) console.log(`  ${a.file}  ${dim(`[${a.rule}]`)} ${a.value}  x${a.count}`);
      console.log(dim("The gate lists them and does not fail on them. Deleting an entry brings the problem back."));
    }
    for (const n of notRun) console.log(dim(`Not looked for: ${n.rule} (${reasonInSentence(n.reason)}).`));
    for (const n of partlyRun) console.log(dim(`Not looked for: ${n.rule} ${n.what} (${n.why}).`));
    finish(0);
  } else if (command === "triage") {
    // On-request only, and never a failure: triage enumerates decisions a human
    // has to make, and penalising the agent for surfacing them would push it
    // straight back to improvising.
    const contract = loadContract(configPath);
    const gaps = [];
    for (const name of Object.keys(contract.profiles)) {
      for (const g of gateProfile(name, { contract }).gaps) {
        gaps.push({ ...g, file: relative(contract.root, g.file) });
      }
    }
    const { decisions } = loadState(contract.root);
    const items = buildTriage({ gaps, decisions });
    if (items.length > 0) console.log(bold(`Undrift triage: ${items.length} outstanding`) + "\n");
    console.log(formatTriage(items));
    finish(0);
  } else if (command === "audit") {
    const contract = loadContract(configPath);
    const result = runAudit(contract);
    if (format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(bold(`Undrift audit: ${result.system}`));
      console.log(dim(result.root) + "\n");
      for (const m of result.metrics) {
        console.log(`${m.pass ? green("✓") : red("✗")} ${bold(m.title)}`);
        console.log(`   ${m.summary}`);
        for (const d of m.detail.slice(0, 25)) console.log(dim(`   ${d}`));
      }
      console.log(
        result.pass
          ? green(`\nAll five metrics hold. This system is agent-enforceable. This report is reproducible: re-run it yourself.`)
          : red(`\nSome metrics failed. Each line above is a concrete finding, not an opinion.`)
      );
    }
    finish(result.pass ? 0 : 1);
  } else {
    usage();
    process.exit(command ? 2 : 0);
  }
} catch (err) {
  console.error(red(`undrift: ${err.message}`));
  process.exit(2);
}
