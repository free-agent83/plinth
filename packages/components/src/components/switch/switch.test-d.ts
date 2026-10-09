import { type SwitchProps } from "./switch";

// Both lines are evaluated by `tsc --noEmit` (no vitest runtime needed):
// 1) exhaustiveness: if the size union changes, `true` stops being assignable and tsc errors.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _sizeIsExhaustive: Equal<NonNullable<SwitchProps["size"]>, "sm" | "md"> = true;
void _sizeIsExhaustive;

// 2) @ts-expect-error: an off-spec size is not a legal value (compile error, not a QA catch).
// @ts-expect-error
const illegal: SwitchProps = { size: "lg" };
void illegal;
