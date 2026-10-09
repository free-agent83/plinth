// execFileSync for tests that run the CLI or the hook and read the exit code of a run that failed.
//
// A child that never got to exit has `status === null`. The helpers used to read that as a wrong
// exit code, and a test failed with `expected null to be 0` that says nothing of the cause. Now:
//
// - A child that could not start (EAGAIN, ENOMEM: the machine was short of processes or memory while
//   the whole suite ran), or that a signal from outside stopped, is run once more.
// - A child that timed out (ETIMEDOUT) is never run again. A second run could let a hang that only
//   sometimes happens pass, and would double whatever the first run did.
// - What is left is thrown by `exited` or `ranToExit` as an Error that names the command and why.
import { execFileSync as run, spawnSync as runSync } from "node:child_process";

const NOT_STARTED = new Set(["EAGAIN", "ENOMEM"]);
// `code` is what a spawn error or a timeout carries; `signal` is how the child died, if it did.
const worthRunningAgain = ({ code, signal }) => code !== "ETIMEDOUT" && (NOT_STARTED.has(code) || Boolean(signal));

export function execFileSync(file, args, options) {
  try {
    return run(file, args, options);
  } catch (e) {
    if (typeof e?.status === "number" || !worthRunningAgain(e ?? {})) throw e;
    return run(file, args, options); // once more; a second failure is thrown as it came
  }
}

const named = (cause, argv) => new Error(`the command did not run to an exit (${cause ?? "no code or signal"}): ${argv}`);

/** The exit code of a run that failed, or an Error that says why there is none. */
export function exited(e) {
  if (typeof e?.status === "number") return e.status;
  const argv = [e?.path, ...(e?.spawnargs ?? []).slice(1)].filter(Boolean).join(" ");
  throw named(e?.code ?? e?.signal, argv || String(e?.message ?? e));
}

/** A spawnSync result that has an exit code, or an Error that says why it has none. */
export function ranToExit(r, file, args) {
  if (typeof r.status !== "number") throw named(r.error?.code ?? r.signal, [file, ...args].join(" "));
  return r;
}

/** spawnSync, run once more on the same terms as execFileSync, and checked with ranToExit. */
export function spawnSync(file, args, options) {
  let r = runSync(file, args, options);
  if (typeof r.status !== "number" && worthRunningAgain({ code: r.error?.code, signal: r.signal })) r = runSync(file, args, options);
  return ranToExit(r, file, args);
}
