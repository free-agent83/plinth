import { ImageResponse } from "next/og";

// The tab icon, drawn from a letter: a square plate with the letter on it, the same mark as the wordmark beside the
// name (a primary plate, the primary-foreground letter). It is generated so that no letter is written twice: the
// product's icon is drawn from PRODUCT (app/icon.tsx) and Plinth's from its own name (app/docs/icon.tsx), and a
// hand-drawn file would have to be edited with them. An image is rendered outside the page, where CSS variables
// and oklch() do not reach it, so the two colours are written out here as hex, once: the default light theme's
// primary and primary-foreground. A test (example-product-is-not-plinth.test.ts) converts the tokens and fails
// if either value drifts from them. The shape takes the rounded and text utilities, as the wordmark does.
export const MARK_SIZE = { width: 32, height: 32 };

const PLATE = { background: "#4f46e5", color: "#ffffff" }; // token-exempt: drawn outside the page, so no variable reaches it; held to the primary tokens by a test

export function renderMark(letter: string) {
  return new ImageResponse(
    (
      <div tw="flex h-full w-full items-center justify-center rounded-md text-2xl font-bold" style={PLATE}>
        {letter}
      </div>
    ),
    MARK_SIZE,
  );
}
