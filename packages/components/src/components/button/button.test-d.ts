import { type ButtonProps } from "./button";

// Both lines are evaluated by `tsc --noEmit` (no vitest runtime needed):
// 1) exhaustiveness: if the variant union changes, `true` stops being assignable and tsc errors.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _variantIsExhaustive: Equal<NonNullable<ButtonProps["variant"]>, "primary" | "outline" | "ghost"> = true;
void _variantIsExhaustive;

// 2) @ts-expect-error: an off-brand variant is not a legal value (compile error, not a QA catch).
// @ts-expect-error
const illegal: ButtonProps = { variant: "off-brand" };
void illegal;
