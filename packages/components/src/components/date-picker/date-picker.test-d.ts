import { type DatePickerProps } from "./date-picker";

// The soundness property: `value`/`onValueChange` are typed to Date, so a string
// value must not compile (the picker deals in Date objects, not strings).
// Both blocks are evaluated by `tsc --noEmit` (no vitest runtime needed).

// 1) @ts-expect-error: value is a Date, not a string.
// @ts-expect-error
const bad: DatePickerProps = { value: "2026-07-02" };
void bad;

// 2) a valid props set compiles.
const ok: DatePickerProps = {
  value: new Date(2026, 6, 2),
  onValueChange: (d: Date | undefined) => void d,
};
void ok;
