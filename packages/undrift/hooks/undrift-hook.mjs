#!/usr/bin/env node
// Claude Code PostToolUse hook, the mechanism that makes the rules unskippable
// rather than advisory. Exit 2 + stderr is fed back to the agent as an error it
// must act on, the instant it writes a file. Excellent documentation does not
// produce adherence; this closed loop does.
//
// Register in .claude/settings.json:
//   { "hooks": { "PostToolUse": [ { "matcher": "Edit|Write",
//       "hooks": [ { "type": "command",
//                    "command": "node node_modules/undrift/hooks/undrift-hook.mjs" } ] } ] } }
//
// Add `.undrift/` to the repo's .gitignore: attempt counters and notice state are
// scratch. Decisions live in undrift.decisions.json, which IS committed. Deferred problems live in
// undrift.later.json, which is committed too.
//
// Silence means "checked, and clean". When the hook could not check, it says so:
// a config it cannot load, a UI file or stylesheet no profile covers, a rule with
// no input, a source that is missing. Plain output from a hook that exits 0 never
// reaches the agent, so a notice is JSON on stdout (hookSpecificOutput.
// additionalContext), which does, without blocking. Each distinct notice is sent
// once per version of the config, so the agent is told, not nagged; what has been
// sent is kept in .undrift/notices.json, keyed on a hash of the config file.
//
// Only the agent's lines are judged: the lines `git diff HEAD` shows as added or changed. A problem on
// any other line is an older problem. It never blocks: the agent is told once per file per session, to
// ask the person whether to fix it now or later, and "later" puts it on undrift.later.json, which is
// committed. When git cannot say whose a line is, every line is the agent's.
import {
  readFileSync, writeFileSync, writeSync, existsSync, realpathSync, mkdirSync, renameSync, rmSync, rmdirSync, statSync, lstatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { relative, resolve, dirname, join, extname, isAbsolute, sep } from "node:path";
import { findConfig, loadContract } from "../src/contract.mjs";
import {
  rulesNotRun, rulesPartlyRun, collectNotChecked, profileFor, accountFor, pathEscapeAdvice, unfollowedLink, escapeGlob,
  hasScriptExtension, hasStylesheetExtension, isIgnored,
} from "../src/unchecked.mjs";
import { formatNotChecked } from "../src/report.mjs";
import { fileURLToPath } from "node:url";
import { loadLater, applyLater, LaterListError, LATER_FILE } from "../src/later.mjs";
import { olderProblems, olderNotice, shellQuote } from "../src/older.mjs";

const read = (fd) => { try { return readFileSync(fd, "utf8"); } catch { return ""; } };

// The hook never throws: whatever arrives on stdin, a payload that is not an object with a
// path in it is nothing to check. JSON `null` parses fine and has no properties, so it is
// `{}`; a number or a string has none either, and existsSync is false for anything that is
// not a path that exists.
let payload = {};
try { payload = JSON.parse(read(0) || "{}") ?? {}; } catch { process.exit(0); }

const file = payload.tool_input?.file_path;
if (!file || !existsSync(file)) process.exit(0);

// Older problems are raised once per file per agent session. Claude Code sends the session's id; without
// one they are raised once a day, when the record of what was told is pruned.
const sessionId = typeof payload.session_id === "string" && payload.session_id !== "" ? payload.session_id : "none";

// The config over the file is the one that governs it. The directory the hook runs
// from is wherever the agent's shell is, which is not always the repository (an
// agent that has cd'd elsewhere, a package with a config of its own), so it is only
// the fallback, for a path that reaches the repository through a link.
//
// No config at all stays silent: the hook cannot tell a repository that does not
// use undrift from a broken install, and a hook that speaks up in repos it does
// not understand gets uninstalled (P2).
const configPath = findConfig(dirname(resolve(file))) ?? findConfig(process.cwd());
if (!configPath) process.exit(0);

// How the agent runs Undrift's `later` for this repository: this package's own bin by its absolute path,
// with this config. `npx undrift` from wherever the agent's shell is could find no local install and fetch
// a package of that name from the registry, and a shell above the config could not load it.
const LATER = `node ${shellQuote(fileURLToPath(new URL("../bin/undrift.mjs", import.meta.url)))} later --config ${shellQuote(configPath)}`;

// ---- notices: told once per version of the config, never nagged ----
let configHash = "unreadable";
try { configHash = createHash("sha256").update(readFileSync(configPath)).digest("hex").slice(0, 16); } catch { /* keep "unreadable" */ }

// ---- where the state lives ----
// Two small files: which notices have been told, and how many times a file has been blocked.
// They live in .undrift/ beside the config. When the repository cannot hold them (a read-only
// checkout or sandbox, or a file where the directory should be), every write used to fail in
// silence: each notice was told again at every edit, and the attempt count stayed at 1 of 3,
// so the hook never reached the message that asks for a decision. Then they live in a
// directory of the temporary directory that is this repository's own: named for the user and
// for a hash of the config's real path, made private (0700), and used only if it is ours and
// nobody else can write to it, and that is a directory and not a link to one. If that cannot be
// had either, the state is not kept, and the hook still works: a notice is told again, and the
// count does not move.
const configDir = dirname(configPath);
const PRIMARY = resolve(configDir, ".undrift");
const fallbackDir = () => {
  let where = configDir;
  try { where = realpathSync(configDir); } catch { /* the path as it was */ }
  const key = createHash("sha256").update(where).digest("hex").slice(0, 16);
  return join(tmpdir(), `undrift-${process.getuid?.() ?? "user"}-${key}`);
};
/** Can a file really be written there? A mode can say yes on a read-only mount. */
const canWriteIn = (dir) => {
  try {
    mkdirSync(dir, { recursive: true });
    if (!statSync(dir).isDirectory()) return false;
    const probe = join(dir, `.probe-${process.pid}`);
    writeFileSync(probe, "");
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
};
/**
 * The directory in the temporary directory that is this repository's own, or nothing. That directory
 * is shared with everyone, so a name in it can be taken beforehand: by a directory that is not ours,
 * or by a link to one that is (a link to a private directory of the user's own passed a check that
 * follows links, and the state went into whatever it pointed at). So it is made without `recursive`,
 * which accepts what is already there, and what is there is looked at with lstat, which does not follow
 * a link: it has to be a directory, ours, that no one else can write to. A write that then fails
 * is the last resort already (the state is not kept), so none is tried.
 */
const privateDir = (dir) => {
  try {
    try {
      mkdirSync(dir, { mode: 0o700 });
    } catch (err) {
      if (err?.code !== "EEXIST") return false;
    }
    const stat = lstatSync(dir);
    if (!stat.isDirectory()) return false; // a link is not one, to lstat
    if (process.getuid !== undefined && stat.uid !== process.getuid()) return false;
    return (stat.mode & 0o022) === 0;
  } catch {
    return false;
  }
};
let chosen; // undefined until the state is first needed; null when it can be kept nowhere
/** The directory the state is kept in, decided once: the repository's, else this repository's own in the temporary directory. */
const stateDir = () => {
  if (chosen !== undefined) return chosen;
  if (canWriteIn(PRIMARY)) return (chosen = PRIMARY);
  const fallback = fallbackDir();
  return (chosen = privateDir(fallback) ? fallback : null);
};
// Is there state anywhere? A run with nothing to record and nothing recorded (most of them)
// must not make a directory or write a file to find out.
const hasState = (name) => existsSync(join(PRIMARY, name)) || existsSync(join(fallbackDir(), name));
/** Where a state file is, or null when the state cannot be kept. */
const statePath = (name) => {
  const dir = stateDir();
  return dir === null ? null : join(dir, name);
};

// What has been told is shared by every hook running in the repository, and several
// run at once (parallel tool calls, several agents, an editor saving many files). So it
// is never read once at the start and written back at the end: that made sixteen hooks
// read the same empty state, tell the same notice, and keep only the last write. Each
// decision is made under a lock, from a fresh read, and the file is written whole to a
// temporary name and renamed into place, so nobody ever reads half of it.
const HELD_FOR = 1500; // how long a hook waits for one that holds the lock
const STALE_AFTER = 10_000; // a lock older than this belongs to a hook that was killed
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Run `fn` holding the lock. When the lock cannot be had (an unwritable directory, or a
 * holder that outlasts HELD_FOR) it runs anyway: this is scratch state, and a duplicate
 * notice costs less than a hook that hangs or fails the edit.
 */
const locked = (fn) => {
  let held = false;
  const lockPath = statePath("notices.lock");
  try {
    if (lockPath === null) throw new Error("no state directory");
    const until = Date.now() + HELD_FOR;
    while (!held) {
      try {
        mkdirSync(lockPath); // atomic: exactly one process creates it
        held = true;
      } catch (err) {
        if (err?.code !== "EEXIST") break;
        let stale = false;
        try { stale = Date.now() - statSync(lockPath).mtimeMs > STALE_AFTER; } catch { continue; /* released: try again */ }
        if (stale) {
          try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* another hook cleared it */ }
        } else if (Date.now() >= until) {
          break;
        } else {
          pause(5 + Math.floor(Math.random() * 10));
        }
      }
    }
  } catch { /* no lock: carry on without */ }
  try {
    return fn();
  } finally {
    if (held) {
      try { rmdirSync(lockPath); } catch { /* already gone */ }
    }
  }
};

/** What is on disk, and what it means for THIS config: a different config starts with nothing sent. */
const readState = () => {
  let stored = null;
  const path = hasState("notices.json") ? statePath("notices.json") : null;
  if (path) {
    try { stored = JSON.parse(readFileSync(path, "utf8")); } catch { /* none yet */ }
  }
  const current = stored && stored.config === configHash && Array.isArray(stored.sent);
  return { stored, state: current ? stored : { config: configHash, sent: [] } };
};
const writeState = (state) => {
  const path = statePath("notices.json");
  if (path === null) return;
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, path);
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* scratch state: never fail the edit over it */ }
  }
};

// A different config re-arms every notice. Record that even when nothing is sent this
// time: returning to a version seen before must not find its notices spent.
{
  const { stored, state } = readState();
  if (stored && state !== stored) {
    locked(() => {
      const again = readState();
      if (again.stored && again.state !== again.stored) writeState(again.state);
    });
  }
}

/** The candidates not yet sent for this version of the config, now recorded as sent, by this hook alone. */
const claim = (candidates) => {
  if (candidates.length === 0) return [];
  return locked(() => {
    const { state } = readState();
    const pending = candidates.filter((n) => !state.sent.includes(n.key));
    if (pending.length > 0) {
      state.sent.push(...pending.map((n) => n.key));
      writeState(state);
    }
    return pending;
  });
};

// Which files' older problems each session has been told of: .undrift/older.json, sessions pruned after
// a day. Kept under the same lock as the notices, from a fresh read, written whole and renamed into place.
const DAY = 24 * 60 * 60 * 1000;
// The file is read as data that may be anything: it is scratch state a person, a merge or a crash can
// leave in any shape. Only sessions of the shape the hook writes are kept, in an object with no
// prototype, so a session called "__proto__" or "toString" is an ordinary one. Whatever is not that
// shape is dropped, and the hook goes on: it must never fail the edit, or stop checking, over it.
// A time later than now is not one the hook wrote: it would never age out, so it is dropped as well.
const isSession = (s, now) => s !== null && typeof s === "object" && Number.isFinite(s.at) && s.at <= now && Array.isArray(s.files);
const firstTimeThisSession = (name) =>
  locked(() => {
    const now = Date.now();
    const data = Object.create(null);
    const path = hasState("older.json") ? statePath("older.json") : null;
    if (path) {
      let parsed = null;
      try { parsed = JSON.parse(readFileSync(path, "utf8")); } catch { /* none yet */ }
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [id, session] of Object.entries(parsed)) {
          if (isSession(session, now) && now - session.at <= DAY) data[id] = session;
        }
      }
    }
    const session = Object.hasOwn(data, sessionId) ? data[sessionId] : { at: now, files: [] };
    if (session.files.includes(name)) return false;
    session.files.push(name);
    session.at = now;
    data[sessionId] = session;
    const target = statePath("older.json");
    if (target !== null) {
      const tmp = `${target}.${process.pid}.tmp`;
      try {
        writeFileSync(tmp, JSON.stringify(data));
        renameSync(tmp, target);
      } catch {
        try { rmSync(tmp, { force: true }); } catch { /* scratch state: never fail the edit over it */ }
      }
    }
    return true;
  });

/** Exit 0. With something to say, say it where the agent will see it: JSON on stdout. */
const tell = (pending) => {
  if (pending.length > 0) {
    const additionalContext = pending.map((n) => n.text).join("\n\n");
    try {
      writeSync(1, JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }));
    } catch { /* nothing more can be done */ }
  }
  process.exit(0);
};

// The hook never throws. One that does exits 1 with a stack trace, which Claude Code
// shows to the person and never to the agent, so the file just written would read as
// checked and clean when nothing was checked. Whatever goes wrong from here on is
// said in a notice, once per version of the config for each distinct error.
try {
  // A config that exists but cannot be loaded means nothing at all was checked.
  // Saying nothing would read as "clean".
  let contract;
  try {
    contract = loadContract(configPath);
  } catch (err) {
    let where = file;
    try {
      where = relative(realpathSync(dirname(configPath)), realpathSync(file));
    } catch { /* keep the path as it was given */ }
    // A file outside the repository is not this config's business.
    if (where.startsWith("..")) process.exit(0);
    const why = String(err?.message ?? err).split("\n")[0];
    tell(claim([{
      key: "config",
      text: `Undrift could not read undrift.config.json (${why}), so it did not check ${where} or any other file. Fix: repair undrift.config.json.`,
    }]));
  }

  // realpathSync on BOTH sides: on macOS the hook's cwd resolves to /private/var
  // while the path in the payload may be the /var symlink (or vice versa).
  // Without this `rel` becomes ../../../.. and NOTHING ever matches a profile.
  // The hook then exits 0 for every file and silently enforces nothing, while
  // every one of its tests still looks green.
  let root;
  let rel;
  let realFile;
  try {
    root = realpathSync(contract.root);
    realFile = realpathSync(file);
    rel = relative(root, realFile);
  } catch { process.exit(0); }

  const candidates = [];

  // A file has more than one name, and a profile's include gives it one of them: the real path, the
  // path as it was written (an include that starts at a link, `ui/**/*.tsx` with `ui` a link, is
  // opened by the glob through the link and matches that way and no other), or the absolute real
  // path an include may name it by. The profile is looked up by each, so the hook covers what the
  // gate covers.
  let written = null;
  try {
    const viaRoot = relative(contract.root, resolve(file));
    if (viaRoot !== "" && !viaRoot.startsWith("..") && !isAbsolute(viaRoot)) written = viaRoot.split(sep).join("/");
  } catch { /* named as it really is */ }
  const names = [written, realFile, resolve(file)];
  const realRel = rel;
  const covering = profileFor(contract, rel, names);

  // A file reached through a link to somewhere the scan does not read (outside the
  // repository, or a place it skips) is not checked, and the real path is not this
  // repository's: without this it was judged as "outside", in silence. A profile that
  // includes the real path gates it, and that is the way out the notice offers.
  const linked = unfollowedLink(contract, file);
  // A stylesheet behind a link a profile covers is behind a link that is followed, as far as a profile
  // goes: it is told of as any stylesheet is, below, under the name it is written by.
  if (linked && !linked.covered && (linked.kind === "stylesheet" || !covering)) {
    const includable = linked.kind !== "stylesheet";
    // Behind a link to a directory the pattern is for the kind of file just written, in the
    // folder it really lives in when the link leads to a folder that holds the repository (a
    // pattern for that whole folder is not advice); a link that is itself the file is named as it is.
    const folder = linked.ancestor ? dirname(linked.real) : linked.target;
    // A file directly in the folder that holds the repository has that folder, itself an ancestor,
    // as its own: a pattern for it ("../**/*.tsx") takes in everything above the repository, so the
    // file's own path is offered instead.
    const folderIsAncestor = /^\.\.(\/\.\.)*$/.test(folder);
    const pattern =
      linked.linkKind !== "directory"
        ? escapeGlob(linked.target)
        : folderIsAncestor
          ? escapeGlob(linked.real)
          : `${escapeGlob(folder)}/**/*${extname(linked.file)}`;
    candidates.push({
      key: `link:${linked.file}`,
      text:
        `Undrift did not check ${linked.file}: it is reached through a symbolic link (${linked.link} points to ${linked.target}), ` +
        "which Undrift does not follow, so no rule ran on it. " +
        (includable
          ? `Fix: include its real path in a profile so the rules run on it, for example ${JSON.stringify(pattern)}. ` +
            'If it should not be checked, propose an "ignore" entry, with the reason, to the user; do not add one yourself.'
          : 'Fix: no profile covers a stylesheet, so propose an "ignore" entry, with a reason, to the user; do not add one yourself.'),
    });
    tell(claim(candidates));
  }

  // A stylesheet is never gated: no rule reads CSS, so no profile can cover one. By its
  // extension, wherever it is: one in a place the scan skips (.storybook, a package's dist)
  // that a profile's glob reaches used to fall through to the gate and be parsed as TSX,
  // and blocked on the text of a content property. Unless it is ignored with a reason, the
  // agent is told it went unchecked.
  const stylesheetNotice = (name) => ({
    key: `stylesheet:${name}`,
    text:
      `Undrift does not check stylesheets yet, so values set in ${name} are not checked against the design system's tokens. ` +
      "Fix: reference tokens with var(--name) rather than raw colours and lengths. " +
      // The agent that wrote the file is the one reading this. Exempting its own file
      // is the user's call, so it is proposed and never made here.
      "Undrift cannot check the file, so only the user can accept it as unchecked: " +
      'propose an "ignore" entry, with a reason, to the user; do not add one yourself.' +
      pathEscapeAdvice([name]),
  });
  if (linked?.covered && linked.kind === "stylesheet") {
    candidates.push(stylesheetNotice(linked.file));
    tell(claim(candidates));
  }
  if (hasStylesheetExtension(rel)) {
    const account = accountFor(contract, rel);
    const reachedByAProfile = account === null && profileFor(contract, rel) !== null && !isIgnored(contract, rel);
    if (account?.status === "notChecked" || reachedByAProfile) {
      candidates.push(stylesheetNotice(rel));
    }
    tell(claim(candidates));
  }

  // The first profile that includes the file. A profile that omits `rules` applies
  // the default rules, exactly as it does for `undrift gate`.
  if (!covering) {
    // A UI file no profile covers, and not excluded on purpose or ignored, went
    // unchecked. Anything else is not something undrift claims to check.
    const account = accountFor(contract, rel);
    if (account?.kind === "ui" && account.status === "notChecked") {
      candidates.push({
        key: `uncovered:${rel}`,
        text:
          `Undrift did not check ${rel}: no profile in undrift.config.json covers it, so no rule ran on it. ` +
          `Fix: add it to a profile's include in undrift.config.json so the rules run on it.${pathEscapeAdvice([rel], "/**/*.tsx")} ` +
          // Exempting a file is the user's call: the agent proposes, and does not write it.
          `If it should not be checked, propose an "ignore" entry, with the reason, to the user; do not add one yourself.`,
      });
    }
    tell(claim(candidates));
  }

  // Covered. When a profile reached the file by another name than its real path, or the real path
  // is outside the repository, it is called by the one it was written under from here on (the agent
  // knows that one, and neither an absolute path from the home directory nor a path that starts
  // with ../ is for the agent that reads these messages).
  if (written !== null && (covering.as !== rel || rel.startsWith(".."))) rel = written;

  // Only a script is gated. A profile that includes a file Undrift cannot read (Markdown,
  // MDX, JSON, SVG under a broad include) used to have it parsed as TSX and blocked on the
  // colours in a data file. It is not checked, and the agent is told once.
  if (!hasScriptExtension(rel)) {
    if (!isIgnored(contract, rel)) {
      candidates.push({
        key: `other:${rel}`,
        text:
          `Undrift did not check ${rel}: it is not a file Undrift can check (it reads .ts, .tsx, .js, .jsx, .mts, .cts, .mjs and .cjs), so no rule ran on it. ` +
          "Fix: narrow the profile's include so it names only the files Undrift can check. " +
          'If it should stay in the profile, propose an "ignore" entry, with the reason, to the user; do not add one yourself.',
      });
    }
    tell(claim(candidates));
  }

  // The file is judged with the rules of every profile that covers it, as the gate judges it: a rule
  // only the second of two profiles turns on is still a rule the file answers to. (The first profile
  // alone decided this before, so an agent's own problem under such a rule passed here and failed the
  // gate.) Only the agent's lines are the agent's to fix (spec, section 4). A problem on another line
  // is an older problem: raised with the person, through the agent, once per file per session, and
  // never blocking. When git cannot say whose a line is, every line is the agent's, as it was before.
  const judged = olderProblems({ contract, rel: realRel, alsoAs: names, file, realFile, source: readFileSync(file, "utf8") });
  // Never an empty pass: a file that was not judged is not "checked and clean". The catch below tells the agent.
  if (!judged) throw new Error("no profile covers it, so no rule ran on it");
  const { agents: violations, older, profiles: coveringProfiles } = judged;
  let laterEntries = [];
  try {
    laterEntries = loadLater(contract.root);
  } catch (err) {
    // The error carries its reason and its fix apart from the file's name, which this sentence supplies.
    const reason = err instanceof LaterListError ? err.reason : `it failed (${String(err?.message ?? err).split("\n")[0]})`;
    const fix = err instanceof LaterListError ? ` ${err.fix}` : "";
    // Told once per session, not once per config: a new session's agent is raising problems that were
    // deferred, and has to be told why they are back.
    candidates.push({
      key: `later:${sessionId}:${reason}`,
      text: `Undrift could not read ${LATER_FILE}: ${reason}, so nothing on it counts as deferred. Fix: tell the user.${fix}`,
    });
  }
  // The later list names files with forward slashes, on every platform.
  const relPosix = rel.split(sep).join("/");
  const olderToRaise = applyLater(laterEntries, older, () => relPosix).remaining;

  // What this profile was configured to check and could not: rules with no input
  // and sources that are missing, as one combined notice.
  const unchecked = collectNotChecked({
    contract,
    runs: coveringProfiles.map((p) => ({
      name: p.name, files: 1, rulesNotRun: rulesNotRun(contract, p.profile.rules), rulesPartlyRun: rulesPartlyRun(contract, p.profile.rules),
    })),
  });
  if (unchecked.length > 0) {
    // A rule that ran on less than it is for (a "rulePart") is counted on its own: what could not run
    // at all is one thing, a part not checked is another.
    const n = unchecked.filter((i) => i.kind !== "rulePart").length;
    const p = unchecked.length - n;
    const things = `${n} ${n === 1 ? "thing" : "things"} it is configured to check could not run`;
    const parts = `part of ${p} ${p === 1 ? "rule was" : "rules were"} not checked`;
    const entries = formatNotChecked(unchecked).entries.map((entry) => entry.text);
    // Keyed on what the notice SAYS, not on the file it happens to be sent for, nor on
    // the profile: a rule's item names its profile in its own words, and a source
    // that is missing reads the same whichever profile the file is in. A source can
    // go missing while the config file is untouched, and that is news; the same words
    // again are not.
    const said = createHash("sha256").update(entries.join("\n")).digest("hex").slice(0, 12);
    candidates.push({
      key: `unchecked:${said}`,
      text:
        `Undrift checked ${rel}, but ${n > 0 && p > 0 ? `${things}, and ${parts}` : n > 0 ? things : parts}:\n` +
        entries.map((text) => `  - ${text}`).join("\n"),
    });
  }
  const pending = claim(candidates);
  if (olderToRaise.length > 0 && firstTimeThisSession(relPosix)) {
    pending.push({ key: `older:${relPosix}`, text: olderNotice({ rel: relPosix, older: olderToRaise, contract, later: LATER }) });
  }

  // Bounded correction (spec R1). Enforcement must never trap the agent in a
  // loop: after MAX_ATTEMPTS the message stops demanding a fix and starts
  // demanding a DECISION: a declared gap or an explained exemption. This is what
  // keeps R1 from violating P2 ("never block progress").
  const MAX_ATTEMPTS = 3;
  const loadAttempts = () => {
    // Only a plain object's own, whole counts are kept: this is scratch state in any shape, and a count
    // that is not a number is no count. No prototype, so a file called "__proto__" is an ordinary one.
    const counts = Object.create(null);
    const path = hasState("attempts.json") ? statePath("attempts.json") : null;
    if (path === null) return counts;
    let parsed = null;
    try { parsed = JSON.parse(readFileSync(path, "utf8")); } catch { return counts; }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return counts;
    for (const [name, count] of Object.entries(parsed)) {
      if (Number.isInteger(count) && count > 0) counts[name] = count;
    }
    return counts;
  };
  const saveAttempts = (a) => {
    const path = statePath("attempts.json");
    if (path === null) return;
    const tmp = `${path}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(a));
      renameSync(tmp, path);
    } catch {
      try { rmSync(tmp, { force: true }); } catch { /* scratch state, never fail the edit over it */ }
    }
  };

  // The counts are one file shared by every hook, so a change is made under the same lock
  // as the notices, from a fresh read: several files failing at once lost one another's counts.
  // Silence by default (P5): a clean file produces no output at all.
  if (violations.length === 0) {
    if (loadAttempts()[rel]) {
      locked(() => {
        const attempts = loadAttempts();
        if (attempts[rel]) { delete attempts[rel]; saveAttempts(attempts); }
      });
    }
    tell(pending);
  }

  const n = locked(() => {
    const attempts = loadAttempts();
    attempts[rel] = (attempts[rel] ?? 0) + 1;
    saveAttempts(attempts);
    return attempts[rel];
  });

  const detail = violations.map((v) => `  line ${v.line}: ${v.message}`).join("\n");

  const message = n >= MAX_ATTEMPTS
    ? `Undrift: ${violations.length} violation(s) still present in ${rel} after ${n} attempts:\n` +
        detail +
        `\n\nStop retrying. Choose one:\n` +
        `  • If the design system genuinely cannot serve this, render ` +
        `<Missing what="…" reason="…" />. A declared gap is correct behaviour.\n` +
        `  • If this value is genuinely unavoidable, add \`// ${contract.exemptMarker}: <reason>\` ` +
        `on the line and explain why.\n` +
        `Do not improvise a styled substitute.`
    : `Undrift blocked this edit: ${violations.length} violation(s) in ${rel} (attempt ${n}/${MAX_ATTEMPTS}):\n` +
        detail +
        `\nFix these and rewrite the file. If the design system genuinely cannot serve this, ` +
        `use <Missing what="…" reason="…" /> instead of improvising.`;

  // The violation is what has to be fixed, so it comes first. A notice that has not
  // been sent yet rides along in the same message. The exit code is set and the process
  // ends by itself: process.exit() abandons what a pipe has not yet taken, which is
  // everything past 64 KiB of a long list, and the instruction is at the end of it.
  console.error(pending.length > 0 ? `${message}\n\n${pending.map((notice) => notice.text).join("\n\n")}` : message);
  process.exitCode = 2;
} catch (err) {
  try {
    const why = String(err?.message ?? err).split("\n")[0];
    let where = file;
    try {
      where = relative(realpathSync(dirname(configPath)), realpathSync(file));
    } catch { /* keep the path as it was given */ }
    tell(claim([{
      key: `error:${why}`,
      text:
        `Undrift stopped on an error while checking ${where} (${why}), so it did not check the file. ` +
        `Fix: run "undrift gate ${where}" to see the error in full, and tell the user if undrift.config.json looks right.`,
    }]));
  } catch { /* nothing more can be done */ }
  process.exit(0);
}
