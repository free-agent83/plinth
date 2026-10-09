// Evasions, preserved. Every block below is either something a model actually
// has done to get past a regex validator, or the nearest
// equivalent aimed at undrift's rules. The lesson each one taught:
//
//   • Split a banned shorthand into longhand props and the pattern stops
//     matching. So the gate must read values, not lines.
//   • Drop the quotes (`borderWidth: 1`) and a value-shaped regex misses it.
//   • Reach for a *named* colour once hex literals are blocked.
//   • Blend two legal tokens into a third colour that is in neither.
//   • Invent a token that looks exactly like a real one: CSS never errors.
//   • Invent a component name that sounds like it should exist.
//   • Route around JSX entirely once <button> is blocked.
//   • Take the carve-out: an escape hatch with no reason attached is the
//     cheapest path to "done", so a carve-out must carry its reason or go.
//
// This file must never gate clean. DO NOT "fix" it.
import * as React from "react";
// [seed: no-unknown-components] Rating sounds real. It isn't.
import { Rating } from "@acme/ds";

// [seed: no-arbitrary-values] arbitrary utility smuggled through a helper call
const cn = (...parts: string[]) => parts.join(" ");
const shell = cn("p-4", "rounded-[7px]");

export function Evasions() {
  return (
    <div className={shell}>
      {/* [seed: no-raw-colors + no-inline-style-values] the border, split into
          longhand so a shorthand pattern never sees it */}
      <div style={{ borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: "#e5e7eb" }}>
        {/* [seed: no-inline-style-values] quoted longhand dimension */}
        <span style={{ paddingLeft: "13px" }}>Split border</span>
      </div>

      {/* [seed: no-raw-colors] a named colour, once hex was blocked */}
      <p style={{ color: "crimson" }}>Danger</p>

      {/* [seed: no-raw-colors] two legal tokens blended into an illegal third */}
      <p style={{ color: "color-mix(in oklch, var(--color-primary) 70%, black)" }}>Nearly on-system</p>

      {/* [seed: no-unknown-tokens] a token that looks real and silently is not */}
      <p style={{ color: "var(--color-brand-500)" }}>Invisible failure</p>

      {/* [seed: no-raw-colors] the carve-out: a marker with no reason attached */}
      <p style={{ color: "#ff0000" }}>Quiet</p>{/* token-exempt */}

      <Rating value={3} />
    </div>
  );
}

// [seed: no-raw-elements] JSX is blocked, so route around JSX
export const SaveButton = () =>
  React.createElement("button", { onClick: () => {} }, "Save");
