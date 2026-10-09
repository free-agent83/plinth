export { loadContract, findConfig, parseCatalog } from "./contract.mjs";
export {
  gateSource, gateSourceWithGaps, gateFiles, gatePaths, gateProfile,
  countDeclarations, compliance, ALL_RULES, DEFAULT_RULES,
} from "./gate.mjs";
export { runAudit } from "./audit.mjs";
export { tokenColorIndex, nearestToken } from "./nearest.mjs";
export { findGaps, verifyGap } from "./gaps.mjs";
export { statusLine, gapNotice } from "./report.mjs";
// The triage loop: enumerate with buildTriage, resolve in chat, then persist the
// ruling with recordDecision. All three have to be reachable from the package
// entry point or the documented workflow isn't actually callable.
export { buildTriage, formatTriage, RESOLUTIONS } from "./triage.mjs";
export { loadState, recordDecision, STATE_FILE } from "./state.mjs";
