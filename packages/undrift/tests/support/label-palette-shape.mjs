// A product palette in a common shape, for the tests of what `no-default-palette` says about a Tailwind colour.
// What matters about the shape:
//   - three layers: palette entries (`--extended-color-*`, `--neutral-*`, `--amber-*`), per-mode roles
//     (`--txt-*`, `--bg-*`, `--label-*`) and Tailwind wiring on top (`--text-color-*`, `--background-color-*`,
//     `--color-label-*`), and the wiring uses Tailwind's two-word namespaces;
//   - issue labels with colours of their own (`--label-indigo-bg`, `--label-yellow-text`);
//   - the neutral and amber steps are redeclared in the dark theme;
//   - Tailwind's built-in palette is switched off: `--color-*: initial`, then white and black redeclared;
//   - its yellow is not Tailwind's yellow: `--extended-color-yellow-500` is oklch(0.79 0.1466 82.04),
//     where Tailwind's yellow-500 is oklch(79.5% 0.184 86.047).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContract } from "../../src/contract.mjs";

export const LABEL_PALETTE_CSS = `
:root, [data-theme*="light"] {
  --extended-color-indigo-50: oklch(0.9415 0.022 263.19);
  --extended-color-indigo-700: oklch(0.458 0.1753 262.2);
  --extended-color-yellow-50: oklch(0.9631 0.0268 85.66);
  --extended-color-yellow-500: oklch(0.79 0.1466 82.04);
  --extended-color-yellow-600: oklch(0.7399 0.1487 79.36);
  --extended-color-yellow-700: oklch(0.683 0.1365 79.84);
  --neutral-200: oklch(0.9696 0.0007 230.67);
  --neutral-400: oklch(0.9389 0.0014 230.68);
  --neutral-900: oklch(0.6161 0.009153 230.867);
  --neutral-1000: oklch(0.5288 0.0083 230.88);
  --neutral-1200: oklch(0.2378 0.0029 230.83);
  --amber-100: oklch(0.9869 0.0214 95.28);
  --amber-600: oklch(0.7724 0.172798 65.367);
  --amber-700: oklch(0.6671 0.1685 53.38);
  --amber-900: oklch(0.4747 0.135757 44.9806);
  --brand-default: oklch(0.4799 0.1158 242.91);
  --red-700: oklch(0.583 0.238666 28.4765);
  --priority-urgent: oklch(0.5798 0.1766 26.99);
  --bg-layer-1: var(--neutral-200);
  --bg-warning-primary: var(--amber-600);
  --bg-warning-subtle: var(--amber-100);
  --bg-accent-primary: var(--brand-default);
  --txt-primary: var(--neutral-1200);
  --txt-tertiary: var(--neutral-1000);
  --txt-placeholder: var(--neutral-900);
  --txt-warning-primary: var(--amber-900);
  --txt-warning-secondary: var(--amber-700);
  --bg-layer-disabled: var(--neutral-400);
  --border-accent-strong: var(--brand-default);
  --txt-danger-secondary: var(--red-700);
  --label-indigo-bg: var(--extended-color-indigo-50);
  --label-indigo-bg-strong: var(--extended-color-indigo-700);
  --label-indigo-hover: var(--extended-color-indigo-50);
  --label-yellow-bg: var(--extended-color-yellow-50);
  --label-yellow-bg-strong: var(--extended-color-yellow-600);
  --label-yellow-text: var(--extended-color-yellow-700);
}
[data-theme*="dark"] {
  --neutral-200: oklch(0.2158 0.0025 230.82);
  --neutral-400: oklch(0.2593 0.0033 230.84);
  --neutral-900: oklch(0.6835 0.0074 230.81);
  --neutral-1000: oklch(0.7655 0.0054 230.76);
  --neutral-1200: oklch(0.9235 0.001733 230.6853);
  --amber-100: oklch(0.3042 0.0853 45.16);
  --amber-600: oklch(0.7724 0.172798 65.367);
  --amber-700: oklch(0.829 0.1712 81.04);
  --amber-900: oklch(0.9244 0.1203 95.85);
  --brand-default: oklch(0.6311 0.126281 238.01);
  --red-700: oklch(0.7022 0.1892 22.23);
  --label-yellow-bg: var(--extended-color-yellow-500);
  --label-yellow-text: var(--extended-color-yellow-500);
}
@theme {
  --color-*: initial;
  --color-white: oklch(1 0 0);
  --color-black: oklch(0.1482 0.0034 196.79);
  --background-color-layer-1: var(--bg-layer-1);
  --background-color-warning-primary: var(--bg-warning-primary);
  --background-color-warning-subtle: var(--bg-warning-subtle);
  --background-color-accent-primary: var(--bg-accent-primary);
  --text-color-primary: var(--txt-primary);
  --text-color-tertiary: var(--txt-tertiary);
  --text-color-placeholder: var(--txt-placeholder);
  --text-color-warning-primary: var(--txt-warning-primary);
  /* The text roles are passed on to fill and stroke, so these are not leaves: --fill-* and --stroke-* are. */
  --text-color-warning-secondary: var(--txt-warning-secondary);
  --fill-warning-secondary: var(--text-color-warning-secondary);
  --stroke-warning-secondary: var(--text-color-warning-secondary);
  --background-color-layer-disabled: var(--bg-layer-disabled);
  --border-color-accent-strong: var(--border-accent-strong);
  --text-color-danger-secondary: var(--txt-danger-secondary);
  --text-color-priority-urgent: var(--priority-urgent);
  --color-label-indigo-bg: var(--label-indigo-bg);
  --color-label-indigo-bg-strong: var(--label-indigo-bg-strong);
  --color-label-indigo-hover: var(--label-indigo-hover);
  --color-label-yellow-bg: var(--label-yellow-bg);
  --color-label-yellow-bg-strong: var(--label-yellow-bg-strong);
  --color-label-yellow-text: var(--label-yellow-text);
}
`;

/** The shape as a loaded contract, so the tests read it as the gate does, resets and all. */
export function labelPaletteShape(css = LABEL_PALETTE_CSS, system = "@acme/ui") {
  const dir = mkdtempSync(join(tmpdir(), "undrift-label-palette-"));
  writeFileSync(join(dir, "variables.css"), css);
  writeFileSync(join(dir, "undrift.config.json"), JSON.stringify({ system, tokensCss: "variables.css" }));
  return loadContract(dir);
}
