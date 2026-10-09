// Triage is on-request only (spec P5). This module turns raw gaps into a ranked,
// decidable list; the agent performs the chosen resolution in chat and calls
// recordDecision() from state.mjs. Frequency ranking is the point.
// It is demand data you cannot get any other way.

export const RESOLUTIONS = {
  component: ["replace-with", "add-to-system", "keep-gap"],
  token: ["map-to-existing", "add-to-palette", "allow-raw-with-reason"],
};

export function buildTriage({ gaps = [], decisions = [] }) {
  const decided = new Set(decisions.map((d) => d.what));
  const byWhat = new Map();

  for (const g of gaps) {
    if (decided.has(g.what)) continue;
    const existing = byWhat.get(g.what);
    if (existing) {
      existing.count++;
      existing.sites.push(`${g.file}:${g.line}`);
    } else {
      byWhat.set(g.what, {
        what: g.what,
        reason: g.reason,
        count: 1,
        sites: [`${g.file}:${g.line}`],
        resolutions: g.what.startsWith("--") ? RESOLUTIONS.token : RESOLUTIONS.component,
      });
    }
  }

  return [...byWhat.values()].sort((a, b) => b.count - a.count || a.what.localeCompare(b.what));
}

export function formatTriage(items) {
  if (items.length === 0) return "Nothing to triage. There are no unresolved gaps.";
  return items
    .map((it, i) =>
      [
        `${i + 1}. ${it.what}  (needed ${it.count}×)`,
        `   ${it.reason}`,
        `   ${it.sites.slice(0, 3).join(", ")}${it.sites.length > 3 ? ` +${it.sites.length - 3} more` : ""}`,
        `   options: ${it.resolutions.join(" · ")}`,
      ].join("\n")
    )
    .join("\n\n");
}
