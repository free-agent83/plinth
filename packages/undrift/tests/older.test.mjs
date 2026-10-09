// sample/packages/undrift/tests/older.test.mjs
import { describe, expect, test } from "vitest";
import { splitByAuthor, fixFor, olderNotice, shellQuote } from "../src/older.mjs";
import { tokenColorIndex } from "../src/nearest.mjs";
import { gateSource } from "../src/gate.mjs";
import { DASH } from "./support/world.mjs";

const v = (line, found, rule = "no-raw-colors") => ({ rule, line, column: 1, found, message: `Raw colour ${found} bypasses the token system.` });
const contract = { tokens: { "--color-muted": "#333333" } };
const index = tokenColorIndex(contract.tokens);

describe("splitByAuthor", () => {
  test("every line the agent's: nothing is older", () => {
    const all = [v(1, "#333"), v(2, "#444")];
    expect(splitByAuthor(all, { all: true, why: "untracked" })).toEqual({ agents: all, older: [] });
  });

  test("the agent's lines are the agent's; the rest are older", () => {
    const { agents, older } = splitByAuthor([v(1, "#333"), v(2, "#444")], { all: false, lines: new Set([2]) });
    expect(agents.map((x) => x.line)).toEqual([2]);
    expect(older.map((x) => x.line)).toEqual([1]);
  });

  test("a violation is the agent's when any line it spans changed, older only when none did", () => {
    const span = { ...v(2, "#333"), endLine: 4 };
    expect(splitByAuthor([span], { all: false, lines: new Set([3]) }).agents).toEqual([span]);
    expect(splitByAuthor([span], { all: false, lines: new Set([5]) }).older).toEqual([span]);
  });

  test("a gap rule on an older line is neither: the hook says nothing of it, and CI still judges it", () => {
    const { agents, older } = splitByAuthor([v(1, "Rating", "invalid-gap")], { all: false, lines: new Set() });
    expect(agents).toEqual([]);
    expect(older).toEqual([]);
  });
});

// The colours were picked so each lands in its band against --color-muted (#333333). If a band
// check fails, measure with nearestToken and pick another colour; do not move SAME_COLOUR.
describe("fixFor", () => {
  test("a token of the same colour is named as the fix", () => {
    expect(fixFor(v(1, "#333333"), index)).toMatchObject({ kind: "same", token: "--color-muted" });
  });
  test("an arbitrary Tailwind colour is read inside its brackets", () => {
    expect(fixFor(v(1, "[#333333]", "no-arbitrary-values"), index)).toMatchObject({ kind: "same" });
  });
  test("a near token is offered as a pick, not as the same colour", () => {
    expect(fixFor(v(1, "#3d3d3d"), index)).toMatchObject({ kind: "near", token: "--color-muted" });
  });
  // Measured against #333333: #363636 is 0.97 (under one just-noticeable difference), #383838 is 1.61.
  test("the same-colour line sits at one just-noticeable difference", () => {
    expect(fixFor(v(1, "#363636"), index)).toMatchObject({ kind: "same", token: "--color-muted" });
    expect(fixFor(v(1, "#383838"), index)).toMatchObject({ kind: "near", token: "--color-muted" });
  });
  // "No token is close" is a measurement. Where nothing could be measured, the note must not say it.
  test("a colour that cannot be measured points at the message, not at a new token", () => {
    expect(fixFor(v(1, "hsl(var(--primary))"), index)).toMatchObject({ kind: "message" });
  });
  test("a contract with no colour tokens cannot measure either", () => {
    expect(fixFor(v(1, "#ff0000"), tokenColorIndex({ "--space-4": "16px" }))).toMatchObject({ kind: "message" });
    expect(fixFor(v(1, "#ff0000"), [])).toMatchObject({ kind: "message" });
  });
  test("no token close enough: propose one", () => {
    expect(fixFor(v(1, "#ff0000"), index)).toMatchObject({ kind: "none" });
  });
  test("a rule that is not about colour points at its own message", () => {
    expect(fixFor(v(1, "-[8px]", "no-arbitrary-values"), index)).toMatchObject({ kind: "message" });
  });
});

describe("olderNotice", () => {
  const LATER = "node '/abs/bin/undrift.mjs' later --config '/abs/undrift.config.json'";
  const text = olderNotice({ rel: "app/(x)/page.tsx", older: [v(3, "#333333"), v(7, "#ff0000")], contract, later: LATER });

  test("names each problem, its first choice, and the later commands", () => {
    expect(text).toMatch(/2 older problems in app\/\(x\)\/page\.tsx/);
    expect(text).toMatch(/line 3 \[no-raw-colors\] #333333/);
    expect(text).toMatch(/Fix it: use var\(--color-muted\)/);
    expect(text).toMatch(/line 7[\s\S]*Propose a new token/);
    // The line can move before the person answers, so the command names the problem as well.
    expect(text).toContain(`${LATER} 'app/(x)/page.tsx' --line 3 --rule no-raw-colors --value '#333333' --reason`);
    expect(text).toContain(`${LATER} 'app/(x)/page.tsx' --line 7 --rule no-raw-colors --value '#ff0000' --reason`);
    expect(text).toContain(`${LATER} 'app/(x)/page.tsx' --reason`);
  });

  test("a value with quotes, spaces and a dollar sign is quoted for the shell, whole", () => {
    const odd = `bg-[url('a b')]$x`;
    const note = olderNotice({ rel: "a.tsx", older: [{ ...v(3, odd, "no-arbitrary-values") }], contract, later: LATER });
    expect(note).toContain(`'a.tsx' --line 3 --rule no-arbitrary-values --value 'bg-[url('\\''a b'\\'')]$x' --reason`);
  });

  test("says what to do when the command reports that the line has moved", () => {
    expect(text).toMatch(/if one says the problem has moved, run it again with the line it names/);
  });

  test("asks the person, when the task is done, with choices where it can", () => {
    expect(text).toMatch(/When your task is done, ask the person/);
    expect(text).toMatch(/Do not fix or defer anything without their answer/);
    expect(text).toMatch(/clickable choices/);
    expect(text).toMatch(/Later, for everything old in this file/);
  });

  test("one problem reads in the singular", () => {
    expect(olderNotice({ rel: "a.tsx", older: [v(3, "#333333")], contract, later: LATER })).toMatch(/1 older problem in a\.tsx/);
  });

  // Some of the gate's own messages still carry dashes (the unknown-token one: "fails silently here, the
  // declaration…"); the note repeats messages, so it is tested with a real one.
  test("a real gate message has no dash, so the notice that repeats it has none", () => {
    const real = gateSource('export const A = () => <div style={{ color: "var(--not-a-token)" }} />;', {
      fileName: "a.tsx", rules: ["no-unknown-tokens"], contract: { ...contract, exemptMarker: "token-exempt" },
    });
    expect(real[0].message).not.toMatch(DASH);
    expect(olderNotice({ rel: "a.tsx", older: real, contract, later: LATER })).not.toMatch(DASH);
  });

  test("a dash in the file name, or in the value, is not repeated in the text around it", () => {
    const out = olderNotice({ rel: "a \u2014 b.tsx", older: [v(3, "x\u2013y", "no-arbitrary-values")], contract, later: LATER });
    // The command's own file argument must stay the real path, so only the readable text is checked.
    expect(out.split("\n").filter((l) => !l.includes(LATER) && !l.includes("run:"))).toSatisfy((ls) => ls.every((l) => !DASH.test(l)));
  });

  test("whitespace in a value or message, newlines included, becomes one space", () => {
    const out = olderNotice({ rel: "a.tsx", older: [{ ...v(3, "line one\n   line two\ttab"), message: "first\nsecond   third" }], contract, later: LATER });
    expect(out).toMatch(/line 3 \[no-raw-colors\] line one line two tab: first second third\n/);
  });

  test("a file name keeps its spaces in the note, and a line break in it does not break the note", () => {
    const spaced = olderNotice({ rel: "my  big file.tsx", older: [v(3, "#333333")], contract, later: LATER });
    expect(spaced).toMatch(/1 older problem in my {2}big file\.tsx, on lines/);
    const broken = olderNotice({ rel: "a\nb.tsx", older: [v(3, "#333333")], contract, later: LATER });
    expect(broken).toMatch(/1 older problem in a b\.tsx, on lines/);
  });

  test("at most 20 problems are listed, and the rest are counted", () => {
    const many = Array.from({ length: 23 }, (_, i) => v(i + 1, "#333333"));
    const out = olderNotice({ rel: "a.tsx", older: many, contract, later: LATER });
    expect(out).toMatch(/23 older problems in a\.tsx/);
    expect(out).toMatch(/line 20 \[/);
    expect(out).not.toMatch(/line 21 \[/);
    expect(out).toContain("and 3 more (run the gate on this file to see them all)");
    expect(olderNotice({ rel: "a.tsx", older: many.slice(0, 20), contract, later: LATER })).not.toMatch(/ more \(/);
  });

  test("the reason placeholder tells the agent to quote the reason for the shell", () => {
    expect(text).toMatch(/--reason <their reason, if they gave one, single-quoted for the shell>/);
    expect(text).not.toMatch(/--reason '<their reason/);
  });

  test("shellQuote keeps a name the shell would expand as it is", () => {
    expect(shellQuote("app/$x/`y`/it's.tsx")).toBe("'app/$x/`y`/it'\\''s.tsx'");
  });
});
