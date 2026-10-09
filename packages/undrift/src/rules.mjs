// The rule names. DEFAULT_RULES run wherever no list is given: a profile with no
// "rules", or a call without one. OPT_IN_RULES run only when a list names them.
// A new rule starts opt-in and becomes default only after it has been run over
// real systems without misfiring, because a rule that misfires gets switched off.
export const DEFAULT_RULES = [
  "no-raw-colors",
  "no-arbitrary-values",
  "no-raw-elements",
  "no-foreign-ui-imports",
  "no-inline-style-values",
  "no-unknown-tokens",
  "no-unknown-components",
];

export const OPT_IN_RULES = ["no-primitive-tokens", "no-default-palette"];

export const ALL_RULES = [...DEFAULT_RULES, ...OPT_IN_RULES];

/** The rules a profile runs: its own list, or the default rules when it gives none. */
export const profileRules = (profile) => profile?.rules ?? DEFAULT_RULES;
