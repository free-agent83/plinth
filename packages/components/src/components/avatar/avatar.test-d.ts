import * as React from "react";
import { AvatarImage } from "./avatar";

// Compositional, no variant union. The soundness property is the native <img>
// contract carried by AvatarImage: `src` is a string, so a numeric src must not
// compile. Both blocks are evaluated by `tsc --noEmit` (no vitest runtime).
type AvatarImageProps = React.ComponentProps<typeof AvatarImage>;

// 1) @ts-expect-error: src is a string, not a number.
// @ts-expect-error
const bad: AvatarImageProps = { src: 123 };
void bad;

// 2) a valid image prop set compiles.
const ok: AvatarImageProps = { src: "/u/1.png", alt: "Ada Lovelace" };
void ok;
