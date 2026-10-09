// packages/undrift/tests/report.test.mjs
import { describe, expect, test } from "vitest";
import { statusLine, gapNotice, profileVerdict, formatNotChecked, accountedForLine } from "../src/report.mjs";

test("status line is one line and states compliance", () => {
  const s = statusLine({ declarations: 47, violations: 0, gaps: 2, system: "@basalt/ds" });
  expect(s.split("\n")).toHaveLength(1);
  expect(s).toMatch(/47/);
  expect(s).toMatch(/2 gaps?/);
});

test("status line reports violations when present", () => {
  expect(statusLine({ declarations: 10, violations: 3, gaps: 0 })).toMatch(/3 violations?/);
});

// An exemption is an invisible violation: "0 violations, 14 exemptions" is not
// a clean run. Until now the count existed only in --format json.
test("status line surfaces exemptions when there are any", () => {
  const s = statusLine({ declarations: 20, violations: 0, exemptions: 14 });
  expect(s).toMatch(/14 exemptions/);
});

test("status line stays quiet about exemptions when there are none", () => {
  expect(statusLine({ declarations: 20, violations: 0, exemptions: 0 })).not.toMatch(/exemption/);
});

test("status line uses the singular for one exemption", () => {
  expect(statusLine({ declarations: 20, violations: 1, exemptions: 1 })).toMatch(/1 exemption\b/);
});

// Under --strict every valid gap is ALSO an `unresolved-gap` violation, so
// counting both reports one item twice ("✗ 1 violation · 1 gap").
test("strict names the gap instead of double-counting it", () => {
  const s = statusLine({ declarations: 47, violations: 1, gaps: 1, strict: true });
  expect(s).toMatch(/✗ 1 unresolved gap/);
  expect(s).not.toMatch(/violation/);
  expect(s).not.toMatch(/·\s*1 gap\b/);
});

test("strict separates real violations from unresolved gaps", () => {
  const s = statusLine({ declarations: 47, violations: 3, gaps: 1, strict: true });
  expect(s).toMatch(/✗ 2 violations/);
  expect(s).toMatch(/1 unresolved gap/);
});

test("non-strict still reports gaps as the success state they are", () => {
  const s = statusLine({ declarations: 47, violations: 0, gaps: 2 });
  expect(s).toMatch(/✓ on-system/);
  expect(s).toMatch(/2 gaps/);
});

test("gap notice has summary, system reason, and need", () => {
  const n = gapNotice({
    what: "DateRangePicker",
    reason: "Basalt has single-date Calendar only: no range variant exists.",
    need: "The booking form filters by check-in and check-out.",
  });
  expect(n).toMatch(/Gap: DateRangePicker/);
  expect(n).toMatch(/no range variant/);
  expect(n).toMatch(/check-in and check-out/);
});

// ---- what was not checked ---------------------------------------------------
// "I did not check this" never renders as "on-system". The status line is the
// last thing read, and the one most likely to be all that is read.

test("status line never says on-system while anything is not checked", () => {
  const s = statusLine({ declarations: 10, violations: 0, notChecked: 2 });
  expect(s).toMatch(/^⚠ 2 not checked/);
  expect(s).not.toMatch(/on-system/);
});

// The count is the head when it is all there is, and a part when something else
// heads the line. Never both: "⚠ 2 not checked · 2 not checked" counts one thing twice.
test("not checked is reported once: as the head, or as a part, never both", () => {
  const head = statusLine({ declarations: 10, violations: 0, notChecked: 2 });
  expect(head.match(/not checked/g)).toHaveLength(1);
  const part = statusLine({ declarations: 10, violations: 3, notChecked: 2 });
  expect(part.match(/not checked/g)).toHaveLength(1);
});

test("with violations, not checked is added as a part and the head stays a failure", () => {
  const s = statusLine({ declarations: 10, violations: 3, notChecked: 2 });
  expect(s).toMatch(/^✗ 3 violations/);
  expect(s).toMatch(/· 2 not checked/);
  expect(s).not.toMatch(/on-system/);
});

test("under strict, unresolved gaps head the line and not checked is added as a part", () => {
  const s = statusLine({ declarations: 10, violations: 1, gaps: 1, strict: true, notChecked: 3 });
  expect(s).toMatch(/^✗ 1 unresolved gap/);
  expect(s).toMatch(/· 3 not checked/);
  expect(s).not.toMatch(/on-system/);
});

test("nothing not checked leaves the line as it was", () => {
  expect(statusLine({ declarations: 47, violations: 0, gaps: 2, notChecked: 0 })).toBe(
    statusLine({ declarations: 47, violations: 0, gaps: 2 })
  );
  expect(statusLine({ declarations: 47, violations: 0 })).toMatch(/^✓ on-system/);
  expect(statusLine({ declarations: 47, violations: 0, notChecked: 0 })).not.toMatch(/not checked/);
});

// The property the whole change exists for, over every combination that matters:
// on-system appears exactly when nothing is wrong and nothing went unchecked.
test("on-system is printed exactly when there are no violations, no unresolved gaps and nothing not checked", () => {
  let seen = 0;
  for (const violations of [0, 1, 3]) {
    for (const gaps of [0, 2]) {
      for (const strict of [false, true]) {
        for (const notChecked of [0, 1, 4]) {
          for (const exemptions of [0, 2]) {
            const s = statusLine({ declarations: 5, violations, gaps, strict, notChecked, exemptions });
            const gapViolations = strict ? Math.min(gaps, violations) : 0;
            const nothingWrong = violations - gapViolations === 0 && gapViolations === 0 && notChecked === 0;
            expect(/on-system/.test(s), JSON.stringify({ violations, gaps, strict, notChecked, exemptions, s })).toBe(nothingWrong);
            seen += 1;
          }
        }
      }
    }
  }
  expect(seen).toBe(72);
});

test("the new parts of the status line carry no dash", () => {
  for (const args of [{ notChecked: 1 }, { violations: 2, notChecked: 3 }, { violations: 1, gaps: 1, strict: true, notChecked: 2 }]) {
    expect(statusLine({ declarations: 4, ...args })).not.toMatch(/[\u2014\u2013]/);
  }
});

describe("profileVerdict", () => {
  test("clean only when files matched, nothing violated and every rule ran", () => {
    expect(profileVerdict({ files: 4, violations: [], rulesNotRun: [] })).toEqual({ tone: "ok", text: "✓ clean" });
  });

  test("a profile that matched no files is never clean", () => {
    const v = profileVerdict({ files: 0, violations: [], rulesNotRun: [] });
    expect(v.tone).toBe("warn");
    expect(v.text).toBe("⚠ no files matched");
    expect(v.text).not.toMatch(/clean/);
  });

  test("a profile with a rule that could not run is not clean, and says how many", () => {
    const one = profileVerdict({ files: 4, violations: [], rulesNotRun: [{ rule: "a" }] });
    expect(one).toEqual({ tone: "warn", text: "⚠ no violations, 1 rule not run" });
    const two = profileVerdict({ files: 4, violations: [], rulesNotRun: [{ rule: "a" }, { rule: "b" }] });
    expect(two.text).toBe("⚠ no violations, 2 rules not run");
    expect(two.text).not.toMatch(/clean/);
  });

  test("violations win over everything else", () => {
    const v = profileVerdict({ files: 0, violations: [{}, {}], rulesNotRun: [{ rule: "a" }] });
    expect(v).toEqual({ tone: "bad", text: "✗ 2 violation(s)" });
  });
});

describe("formatNotChecked", () => {
  const item = (over = {}) => ({ kind: "source", reason: "tokensCss \"a.css\" does not exist, so it contributed no tokens.", fix: "Build it.", ...over });

  test("nothing not checked: nothing to print", () => {
    expect(formatNotChecked([])).toBeNull();
  });

  test("a header with the count, then one entry per item with its reason and its fix", () => {
    const out = formatNotChecked([item(), item({ reason: "Profile app matched no files.", fix: "Fix the include." })]);
    expect(out.header).toBe("Not checked (2):");
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0].text).toBe('tokensCss "a.css" does not exist, so it contributed no tokens. Fix: Build it.');
    expect(out.entries[1].text).toBe("Profile app matched no files. Fix: Fix the include.");
    expect(out.entries[0].details).toEqual([]);
  });

  test("a files item lists its paths beneath it, and says how many more there are", () => {
    const paths = Array.from({ length: 10 }, (_, i) => `lib/f${i}.tsx`);
    const out = formatNotChecked([item({ kind: "files", count: 184, files: paths, reason: "184 UI files are covered by no profile.", fix: "Add them." })]);
    expect(out.entries[0].details).toEqual([...paths, "and 174 more"]);
  });

  // The item carries every path, for the JSON. The text is what a person reads, so it
  // keeps ten and says how many more there are.
  test("an item that carries every path is cut to ten in the text", () => {
    const all = Array.from({ length: 184 }, (_, i) => `lib/f${String(i).padStart(3, "0")}.tsx`);
    const out = formatNotChecked([item({ kind: "files", count: 184, files: all, reason: "184 UI files are covered by no profile.", fix: "Add them." })]);
    expect(out.entries[0].details).toEqual([...all.slice(0, 10), "and 174 more"]);
  });

  test("exactly ten is all of them, and eleven is ten and one more", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `f${i}.css`);
    expect(formatNotChecked([item({ kind: "stylesheets", count: 10, files: ten })]).entries[0].details).toEqual(ten);
    const eleven = [...ten, "f10.css"];
    expect(formatNotChecked([item({ kind: "stylesheets", count: 11, files: eleven })]).entries[0].details).toEqual([...ten, "and 1 more"]);
  });

  test("when every path is listed there is no 'and more' line", () => {
    const out = formatNotChecked([item({ kind: "stylesheets", count: 2, files: ["a.css", "b.css"] })]);
    expect(out.entries[0].details).toEqual(["a.css", "b.css"]);
  });

  test("no entry is more than one line of its own: the paths go in details", () => {
    const out = formatNotChecked([item({ kind: "files", count: 3, files: ["a.tsx", "b.tsx", "c.tsx"] })]);
    expect(out.entries[0].text).not.toMatch(/\n/);
  });
});

describe("accountedForLine", () => {
  const counts = (over = {}) => ({ uiFiles: 10, covered: 4, excluded: 0, ignored: 0, notCovered: 0, stylesheets: { found: 0, ignored: 0, notChecked: 0 }, ...over });

  test("nothing excluded or ignored: no line", () => {
    expect(accountedForLine(counts())).toBeNull();
    expect(accountedForLine(null)).toBeNull();
  });

  test("one quiet line counts the excluded and the ignored, and points at the reasons", () => {
    const line = accountedForLine(counts({ excluded: 26, ignored: 158, stylesheets: { found: 4, ignored: 3, notChecked: 1 } }));
    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain("26 UI files excluded by a profile's own ! patterns");
    expect(line).toContain('158 UI files ignored via "ignore"');
    expect(line).toContain('3 stylesheets ignored via "ignore"');
    expect(line).toContain("reasons are in undrift.config.json");
  });

  test("singular counts read singular", () => {
    expect(accountedForLine(counts({ excluded: 1 }))).toContain("1 UI file excluded");
    expect(accountedForLine(counts({ ignored: 1 }))).toContain('1 UI file ignored via "ignore"');
    expect(accountedForLine(counts({ stylesheets: { found: 1, ignored: 1, notChecked: 0 } }))).toContain('1 stylesheet ignored via "ignore"');
  });

  // The reasons live in the config, and a stylesheet is ignored with one as a UI file is.
  test("only stylesheets ignored: the pointer to the reasons is still there", () => {
    const line = accountedForLine(counts({ stylesheets: { found: 2, ignored: 2, notChecked: 0 } }));
    expect(line).toBe('Accounted for, not hidden: 2 stylesheets ignored via "ignore". The reasons are in undrift.config.json.');
  });

  test("only UI files ignored: the pointer to the reasons is there", () => {
    const line = accountedForLine(counts({ ignored: 2 }));
    expect(line).toBe('Accounted for, not hidden: 2 UI files ignored via "ignore". The reasons are in undrift.config.json.');
  });

  test("excluded and stylesheets ignored: the pointer follows the ignore, not the exclusion", () => {
    const line = accountedForLine(counts({ excluded: 4, stylesheets: { found: 1, ignored: 1, notChecked: 0 } }));
    expect(line).toContain("The reasons are in undrift.config.json.");
  });

  test("only excluded: no pointer to ignore reasons", () => {
    expect(accountedForLine(counts({ excluded: 3 }))).not.toMatch(/reasons/);
  });

  test("carries no dash", () => {
    expect(accountedForLine(counts({ excluded: 2, ignored: 2, stylesheets: { found: 2, ignored: 2, notChecked: 0 } }))).not.toMatch(/[\u2014\u2013]/);
  });
});
