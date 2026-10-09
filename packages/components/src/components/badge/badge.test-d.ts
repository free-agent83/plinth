import { type BadgeProps } from "./badge";

// Both lines are evaluated by `tsc --noEmit` (no vitest runtime needed):
// 1) exhaustiveness: if the status variant union changes, `true` stops being
//    assignable and tsc errors.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _variantIsExhaustive: Equal<
  NonNullable<BadgeProps["variant"]>,
  "neutral" | "success" | "warning" | "danger" | "info"
> = true;
void _variantIsExhaustive;

// 2) @ts-expect-error: an off-spec variant is not a legal value.
// @ts-expect-error
const illegal: BadgeProps = { variant: "critical" };
void illegal;
