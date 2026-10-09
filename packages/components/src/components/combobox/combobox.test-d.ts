import { type ComboboxProps } from "./combobox";

// The soundness property: Combobox requires `options`. A props object without it
// must not compile. Both blocks are evaluated by `tsc --noEmit` (no runtime).

// 1) @ts-expect-error: `options` is required.
// @ts-expect-error
const missing: ComboboxProps = { placeholder: "Pick one" };
void missing;

// 2) a valid props set compiles.
const ok: ComboboxProps = {
  options: [{ value: "a", label: "Apple" }],
  value: "a",
};
void ok;
