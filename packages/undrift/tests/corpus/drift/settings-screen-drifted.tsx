// The same screen as an agent drifts it: every classic failure mode an agent
// produces against a design system, seeded deliberately.
// This file is the gate's negative control: the conformance test asserts every
// seeded violation below is caught, by rule. DO NOT "fix" this file.
import * as React from "react";
// [seed 1: no-foreign-ui-imports]
import { Button as MuiButton } from "@mui/material";

// [seed 2: no-raw-colors (hex constant)]
const BRAND = "#4f46e5";
// [seed 3: no-raw-colors (hsl constant)]
const ACCENT = "hsl(20, 76%, 50%)";

export function SettingsScreenDrifted() {
  return (
    // [seed 4: no-arbitrary-values + no-raw-colors (arbitrary hex utility)]
    <main className="mx-auto max-w-3xl bg-[#f8fafc] p-6">
      <header>
        {/* [seed 5: no-inline-style-values (raw fontSize string)] */}
        <h1 style={{ fontSize: "22px" }}>Settings</h1>
        {/* [seed 6: no-raw-colors (hex in template literal)] */}
        <p className={`text-sm ${true ? "opacity-100" : "opacity-50"} text-[#94a3b8]`}>
          Workspace preferences and notifications.
        </p>
      </header>

      {/* [seed 7: no-inline-style-values (longhand border-ish numerics, the longhand evasion)] */}
      <div style={{ borderRadius: 8, padding: 14 }}>
        {/* [seed 8: no-raw-elements (raw input)] */}
        <input placeholder="Workspace name" />
        {/* [seed 9: no-raw-elements (raw select)] */}
        <select>
          <option>Daily</option>
        </select>
      </div>

      {/* [seed 10: no-arbitrary-values (arbitrary px radius)] */}
      <div className="rounded-[8px] border">
        {/* [seed 11: no-raw-colors (inline style hex)] */}
        <span style={{ color: "#e0481e" }}>Danger zone</span>
      </div>

      {/* [seed 12: no-raw-elements (raw button)] */}
      <button onClick={() => {}}>Save changes</button>
      <MuiButton>Cancel</MuiButton>

      {/* [seed 13: no-raw-elements (raw table)] */}
      <table>
        <tbody>
          <tr>
            <td>row</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}
