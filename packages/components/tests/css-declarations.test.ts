import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { atRules, covers, declarations, literalsOf, normalize, ownValues, unescapeCss, unnamed } from "./support/css-declarations";

// Two stylesheets are exempt from the gate because Undrift does not read CSS yet, and each
// exemption says what the file sets of its own. Those checks read a fixed list of units, so a
// colour, a `z-index` or `100vh` added to either file stayed green. These tests hold the reader
// to what it has to see, and then hold the two real files to it with the reviewer's own probes
// appended: neither may pass with a value the exemption does not account for.
const repo = resolve(process.cwd(), "../..");
const tailwind = readFileSync(resolve(process.cwd(), "tailwind.css"), "utf8");
const globals = readFileSync(resolve(repo, "apps/web/app/globals.css"), "utf8");
const config = JSON.parse(readFileSync(resolve(repo, "undrift.config.json"), "utf8"));
const tailwindReason: string = config.ignore["packages/components/tailwind.css"];
const globalsReason: string = config.ignore["apps/web/app/globals.css"];

describe("declarations", () => {
  test("reads a property and a value at any depth, and leaves at-rules alone", () => {
    const css = `@import "x.css";\n@source "../src";\n@utility a { color: red; }\n@layer base { body { margin: 0; } }`;
    expect(declarations(css).map((d) => `${d.property}: ${d.value}`)).toEqual(["color: red", "margin: 0"]);
  });

  test("a comment is not a declaration, and a colon in a selector is not one either", () => {
    const css = `/* color: #ff0000; */ a:hover { color: blue; } @custom-variant dark (&:where(.dark, .dark *));`;
    expect(declarations(css).map((d) => d.property)).toEqual(["color"]);
  });

  test("braces and a declaration in a comment do not move the blocks or add one", () => {
    const css = `a { /* } { color: #ff0000; */ margin: 0; }\n/* @theme { */ b { padding: 1px; }`;
    const found = declarations(css);
    expect(found.map((d) => `${d.property}: ${d.value}`)).toEqual(["margin: 0", "padding: 1px"]);
    expect(found.every((d) => !d.inTheme)).toBe(true);
  });

  test("the last declaration of a block needs no semicolon", () => {
    expect(declarations(`a { color: red }`).map((d) => d.value)).toEqual(["red"]);
  });

  test("a custom property is a declaration too, and a value can span lines", () => {
    const [d] = declarations(`:root {\n  --gap:\n    calc(1rem +\n 2px);\n}`);
    expect(d.property).toBe("--gap");
    expect(d.value).toBe("calc(1rem + 2px)");
  });

  test("a declaration in an @theme block is marked, and so is one nested in it", () => {
    const found = declarations(`@theme inline { --a: var(--b); } @layer base { a { color: red; } }`);
    expect(found.map((d) => d.inTheme)).toEqual([true, false]);
  });
});

describe("literalsOf", () => {
  test("a reference to a variable is not a literal", () => {
    expect(literalsOf("var(--font-sans)")).toEqual([]);
    expect(literalsOf("var( --color-primary )")).toEqual([]);
    expect(literalsOf("--theme(--color-gap-border)")).toEqual([]);
    expect(literalsOf("--theme(--color-gap-border) 10%")).toEqual(["10%"]);
  });

  test("a fallback is a literal, and the reference around it is not", () => {
    expect(literalsOf("var(--x, red)")).toEqual(["red"]);
    expect(literalsOf("var(--x, 13px)")).toEqual(["13px"]);
    expect(literalsOf("var(--x, var(--y))")).toEqual([]);
  });

  test("colours: hex, functions, named", () => {
    expect(literalsOf("#ff0000")).toEqual(["#ff0000"]);
    expect(literalsOf("#fff")).toEqual(["#fff"]);
    expect(literalsOf("rgb(255 0 0)")).toEqual(["255", "0", "rgb"]);
    expect(literalsOf("oklch(0.7 0.1 250)")).toContain("oklch");
    expect(literalsOf("red")).toEqual(["red"]);
    expect(literalsOf("transparent")).toEqual(["transparent"]);
  });

  test("numbers, with any unit or none", () => {
    expect(literalsOf("13px")).toEqual(["13px"]);
    expect(literalsOf("100vh")).toEqual(["100vh"]);
    expect(literalsOf("50")).toEqual(["50"]);
    expect(literalsOf("1.5rem")).toEqual(["1.5rem"]);
    expect(literalsOf(".5em")).toEqual([".5em"]);
    expect(literalsOf("45deg")).toEqual(["45deg"]);
    expect(literalsOf("10%")).toEqual(["10%"]);
    expect(literalsOf("300ms")).toEqual(["300ms"]);
    expect(literalsOf("1fr")).toEqual(["1fr"]);
  });

  test("words, including the name of each function called", () => {
    expect(literalsOf("repeat(auto-fit, minmax(var(--min), 1fr))")).toEqual(["1fr", "repeat", "auto-fit", "minmax"]);
    expect(literalsOf("tabular-nums")).toEqual(["tabular-nums"]);
  });

  test("a number in the name of a variable is not a number", () => {
    expect(literalsOf("var(--color-chart-1)")).toEqual([]);
    expect(literalsOf("var(--spacing-2)")).toEqual([]);
  });
});

describe("normalize and covers", () => {
  test("whitespace and the spelling of a variable's name do not matter, and case does not", () => {
    expect(normalize("minmax( var(--layout-grid-min-xs) ,  1fr )")).toBe(normalize("minmax(var(--layout-grid-min-*),1fr)"));
    expect(normalize("--theme(--color-gap-border) 10%")).toBe(normalize("--Theme( --color-other ) 10%"));
    expect(normalize("&:where(.dark, .dark *)")).toBe(normalize("&:where( .dark,.dark * )"));
  });

  test("a declaration is covered as a whole: a number has to be a whole token, and so does a property", () => {
    expect(covers(normalize("z-index: 50"), "z-index: 50")).toBe(true);
    expect(covers(normalize("z-index: 150"), "z-index: 50")).toBe(false);
    expect(covers(normalize("z-index: 500"), "z-index: 50")).toBe(false);
    expect(covers(normalize("background-color: red"), "color: red")).toBe(false);
    expect(covers(normalize("the gap-border: red"), "border: red")).toBe(false);
    expect(covers(normalize("a 0 7px and 7px 14px stripe"), "7px 14px")).toBe(true);
  });

  test("a sentence that ends on the declaration does not stop it counting, but a decimal does", () => {
    expect(covers(normalize("it sets font-variant-numeric: tabular-nums. The rest is wiring."), "font-variant-numeric: tabular-nums")).toBe(true);
    expect(covers(normalize("it sets z-index: 7.5."), "z-index: 7")).toBe(false);
    expect(covers(normalize("it sets z-index: 7."), "z-index: 7")).toBe(true);
  });

  test("the property and the value have to be together: each being named somewhere is not enough", () => {
    const reason = "the gap marker has stripes in 0 7px and 7px 14px";
    expect(covers(normalize(reason), "gap: 14px")).toBe(false);
    expect(covers(normalize("gap: 14px"), "gap: 14px")).toBe(true);
  });
});

describe("atRules", () => {
  test("reads the name and the header of each at-rule, at any depth, with or without a block", () => {
    const css = `@import "x.css";\n@custom-variant dark (&:where(.dark, .dark *));\n@layer base { @media (min-width: 640px) { a { color: red; } } }\n@utility a-b { margin: 0; }`;
    expect(atRules(css).map((r) => r.text)).toEqual([
      '@import "x.css"',
      "@custom-variant dark (&:where(.dark, .dark *))",
      "@layer base",
      "@media (min-width: 640px)",
      "@utility a-b",
    ]);
  });

  test("a semicolon or a brace inside a string or a bracket does not end the header", () => {
    const css = `@import url("data:text/css;base64,AAAA");\n@import url(data:text/css;base64,BBBB);\n@media (min-width: 1px) { a { content: "}"; margin: 0; } }`;
    expect(atRules(css).map((r) => r.text)).toEqual([
      '@import url("data:text/css;base64,AAAA")',
      "@import url(data:text/css;base64,BBBB)",
      "@media (min-width: 1px)",
    ]);
    expect(declarations(css).map((d) => `${d.property}: ${d.value}`)).toEqual(['content: "}"', "margin: 0"]);
  });

  test("a comment is not an at-rule", () => {
    expect(atRules("/* @media (min-width: 1px) { } */ a { color: red; }")).toEqual([]);
  });

  test("a declaration is not an at-rule, and an at-rule inside a block is one", () => {
    expect(atRules("a { color: red; @apply font-bold; }").map((r) => r.text)).toEqual(["@apply font-bold"]);
  });
});

describe("tailwind.css, and the reason its exemption gives", () => {
  test("the reason accounts for everything the file sets: every property outside @theme and every literal", () => {
    expect(tailwindReason, "packages/components/tailwind.css must be in ignore, with a reason").toBeTruthy();
    expect(declarations(tailwind).length).toBeGreaterThan(40);
    expect(unnamed(tailwind, tailwindReason)).toEqual([]);
  });

  test("it names the body base rule, which sets a font family and no literal", () => {
    expect(tailwindReason).toMatch(/body/);
    expect(tailwindReason).toContain("font-family");
  });

  // What the reviewer appended, and what a person might: each is a value the reason does not name.
  test.each([
    ["a utility with a colour, a z-index and a viewport height", "@utility drift-probe { color: #ff0000; z-index: 50; height: 100vh; }", ["color: #ff0000", "z-index: 50", "height: 100vh"]],
    ["a base rule with a named colour", "@layer base { a { color: red; } }", ["color: red"]],
    ["a plain rule with a colour function", ".x { background: rgb(255 0 0); }", ["background: rgb(255 0 0)"]],
    ["a length in rem", ".y { padding: 2rem; }", ["padding: 2rem"]],
    ["a fallback that is a colour", ".z { color: var(--c, #123456); }", ["color: var(--c, #123456)"]],
  ])("appending %s is caught", (_label, probe, expected) => {
    const missing = unnamed(`${tailwind}\n${probe}`, tailwindReason);
    for (const item of expected) expect(missing, item).toContain(item);
  });

  // Still passing after the last round, because a property and a number were each named somewhere in
  // the reason: `gap` in "the gap marker", `border` in "gap-border", 14px and 7px in the stripes.
  // Each declaration is matched as a whole now, and so is each at-rule header, so none of these passes.
  test.each([
    ["a property named only inside a phrase, with a number named for the stripes", ".drift-grid { gap: 14px; }", ["gap: 14px"]],
    ["a property that is part of another name, with a number named for the stripes", ".drift-edge { border: 7px; }", ["border: 7px"]],
    ["a known property with a value it was not given", ".font-mono { font-variant-numeric: oldstyle-nums; }", ["font-variant-numeric: oldstyle-nums"]],
    ["a breakpoint in a media query, round a declaration the reason does name", "@media (min-width: 640px) { .font-mono { font-variant-numeric: tabular-nums; } }", ["@media (min-width: 640px)"]],
    ["a raw height in a custom variant", "@custom-variant tall (@media (min-height: 900px));", ["@custom-variant tall (@media (min-height: 900px))"]],
    ["a plugin, which loads code", '@plugin "somewhere";', ['@plugin "somewhere"']],
  ])("appending %s is caught", (_label, probe, expected) => {
    expect(unnamed(`${tailwind}\n${probe}`, tailwindReason)).toEqual(expected);
  });

  test("a media query is caught with what is inside it too: the block is read, not skipped", () => {
    expect(unnamed(`${tailwind}\n@media (min-width: 640px) { a { color: var(--color-primary); } }`, tailwindReason)).toEqual([
      "color: var(--color-primary)",
      "@media (min-width: 640px)",
    ]);
  });

  // The wiring at-rules set no value, unless the header carries one: an @import can have a media
  // condition, and a breakpoint there is a breakpoint.
  test("a breakpoint in the media condition of an @import is caught, though @import is wiring", () => {
    expect(unnamed(`${tailwind}\n@import url("x.css") (min-width: 640px);`, tailwindReason)).toEqual(['@import url("x.css") (min-width: 640px)']);
  });

  test("a wiring at-rule with no value in its header is not: a string, a url and a name with a digit in it are not values", () => {
    expect(
      unnamed(
        `${tailwind}\n@import "a-1.css" layer(base);\n@source "../src-2/a1";\n@layer layer-2, base;\n@import url(b2.css);\n@import "10px.css";\n@import url(100.css);`,
        tailwindReason
      )
    ).toEqual([]);
  });

  test("a colour in an @import's condition is caught", () => {
    expect(unnamed(`${tailwind}\n@import "x.css" supports(color: #fff);`, tailwindReason)).toEqual(['@import "x.css" supports(color: #fff)']);
  });

  test("a mapping in @theme still needs no naming, and the custom variant the file has is named whole", () => {
    expect(unnamed(tailwind, tailwindReason)).toEqual([]);
    expect(tailwindReason).toContain("@custom-variant dark (&:where(.dark, .dark *))");
  });

  test("a different variable in a property the reason names is a reference, not a value of its own", () => {
    expect(unnamed(`${tailwind}\nbody { font-family: var(--font-other); }`, tailwindReason)).toEqual([]);
  });

  test("a property the reason does not name is caught even when its value is a token", () => {
    expect(unnamed(`${tailwind}\n.w { margin: var(--layout-page-inset); }`, tailwindReason)).toEqual(["margin: var(--layout-page-inset)"]);
  });

  test("a value mapped inside @theme needs no naming when it is a reference, and does when it is not", () => {
    expect(unnamed(`${tailwind}\n@theme inline { --color-more: var(--color-semantic-more); }`, tailwindReason)).toEqual([]);
    expect(unnamed(`${tailwind}\n@theme inline { --color-raw: #ff0000; }`, tailwindReason)).toContain("--color-raw: #ff0000");
  });

  test("a word in the reason cannot stand in for a number: 50 is not named by '150'", () => {
    expect(unnamed(".a { z-index: 50; }", "z-index: 150")).toEqual(["z-index: 50"]);
    expect(unnamed(".a { z-index: 50; }", "z-index and 150")).toEqual(["z-index: 50"]);
  });

  test("a reason that writes the declaration out names it, in any spacing", () => {
    expect(unnamed(".a { z-index: 50; }", "the modal layer, z-index:50, is set here")).toEqual([]);
  });
});

describe("globals.css, which is wiring only", () => {
  test("it sets no value of its own: every declaration is a reference to a variable", () => {
    expect(declarations(globals).length).toBeGreaterThan(10);
    expect(ownValues(globals)).toEqual([]);
  });

  test("its ignore reason says so", () => {
    expect(globalsReason).toMatch(/no font stack, no colour and no length of its own/);
  });

  test.each([
    ["a colour and a length", ".drift-probe { color: #ff0000; padding: 13px; }", ["color: #ff0000", "padding: 13px"]],
    ["a named colour", "body { background: white; }", ["background: white"]],
    ["a font stack", ":root { --type-fontFamily-sans: Inter, sans-serif; }", ["--type-fontFamily-sans: Inter, sans-serif"]],
    ["a variable with a literal fallback", ".a { color: var(--c, red); }", ["color: var(--c, red)"]],
    ["a unitless number", ".a { z-index: 50; }", ["z-index: 50"]],
  ])("appending %s is caught", (_label, probe, expected) => {
    const own = ownValues(`${globals}\n${probe}`);
    for (const item of expected) expect(own, item).toContain(item);
  });

  test.each([
    ["a breakpoint in a media query", "@media (min-width: 640px) { a { color: var(--c); } }", ["@media (min-width: 640px)"]],
    ["a raw height in a custom variant", "@custom-variant tall (@media (min-height: 900px));", ["@custom-variant tall (@media (min-height: 900px))"]],
    ["a plugin", '@plugin "somewhere";', ['@plugin "somewhere"']],
  ])("appending %s is caught: an at-rule that is not wiring is a value of its own", (_label, probe, expected) => {
    expect(ownValues(`${globals}\n${probe}`)).toEqual(expected);
  });

  test("the at-rules it has are wiring: @import and @source", () => {
    expect(atRules(globals).map((r) => r.name)).toEqual(["import", "import", "import", "source", "source", "source"]);
  });

  test("a breakpoint in the media condition of an @import is caught here too", () => {
    expect(ownValues(`${globals}\n@import url("x.css") (min-width: 640px);`)).toEqual(['@import url("x.css") (min-width: 640px)']);
  });

  test("a mapping onto a variable is not a value of its own", () => {
    expect(ownValues(`${globals}\n:root { --color-fd-more: var(--color-more); }`)).toEqual([]);
  });
});

// Three ways the guard was got past, each found by a reviewer who appended a rule to a real file and
// watched the test stay green. The reader has to see every one.
describe("what the guard was dodged with", () => {
  // The comments were stripped by a pattern before strings were tracked, so a `/*` inside one glob's
  // quotes and a `*/` inside another's opened and closed a comment, and the rule between them was never
  // read. Tailwind keeps the rule in its output.
  const HIDDEN = `@source "../content/*.mdx";\n.drift { color: #ff0000; }\n@source "../docs/*/*.mdx";`;

  test("a comment that opens in one string and closes in another does not hide what is between them", () => {
    expect(declarations(HIDDEN).map((d) => `${d.property}: ${d.value}`)).toEqual(["color: #ff0000"]);
    expect(atRules(HIDDEN).map((r) => r.text)).toEqual(['@source "../content/*.mdx"', '@source "../docs/*/*.mdx"']);
  });

  test("so appended to either real file it is caught", () => {
    expect(unnamed(`${tailwind}\n${HIDDEN}`, tailwindReason)).toContain("color: #ff0000");
    expect(ownValues(`${globals}\n${HIDDEN}`)).toContain("color: #ff0000");
  });

  test("a real comment is still not read, wherever it is, and an unterminated one runs to the end", () => {
    expect(declarations(`a { color: /* red */ blue; /* margin: 0; */ }`).map((d) => `${d.property}: ${d.value}`)).toEqual(["color: blue"]);
    expect(declarations(`a { margin: 0; } /* b { color: red; }`).map((d) => d.property)).toEqual(["margin"]);
  });

  test("a comment marker inside an unquoted url() is a part of the url, not a comment", () => {
    expect(declarations(`a { background: url(x/*) } b { color: #ff0000; } /* */`).map((d) => `${d.property}: ${d.value}`)).toEqual([
      "background: url(x/*)",
      "color: #ff0000",
    ]);
  });

  test("an escaped quote is not the start of a string", () => {
    expect(declarations(`.a { x: \\"; } .b { color: #ff0000; } .c { y: \\"; }`).map((d) => `${d.property}: ${d.value}`)).toContain("color: #ff0000");
  });

  // A `url(data:...)` was removed from a value whole, like any url, and a colour in the SVG it carries
  // went with it: `--drift-hatch: url("data:image/svg+xml,...fill='%23ff0000'...")` set a value of its own
  // and the guard saw none, in globals.css and in an @theme declaration alike.
  const HATCH = `--drift-hatch: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect fill='%23ff0000'/%3E%3C/svg%3E")`;

  test("a data url is a literal, and any other url is a file's name and is not", () => {
    expect(literalsOf(`url("data:image/svg+xml,%3Csvg fill='%23ff0000'%3E")`)).toHaveLength(1);
    expect(literalsOf(`url(data:image/png;base64,AAAA)`)).toHaveLength(1);
    expect(literalsOf(`URL( "Data:image/png;base64,AAAA" )`)).toHaveLength(1);
    expect(literalsOf(`url("hatch.svg")`)).toEqual([]);
    expect(literalsOf(`url(hatch.svg)`)).toEqual([]);
    expect(literalsOf(`url("https://example.com/data:x.svg")`)).toEqual([]);
  });

  test("appended to globals.css, or as an @theme declaration in tailwind.css, it is caught", () => {
    expect(ownValues(`${globals}\n:root { ${HATCH}; }`)).toHaveLength(1);
    expect(unnamed(`${tailwind}\n@theme { ${HATCH}; }`, tailwindReason).join("\n")).toContain("--drift-hatch");
    expect(unnamed(`${tailwind}\n.d { background: url("data:image/svg+xml,%3Csvg%3E"); }`, tailwindReason)).toHaveLength(1);
  });

  // A property name can be spelled with a CSS escape: `colo\72` is `color` to a browser, and the
  // property pattern had no backslash in it, so the declaration was not read at all.
  test("an escape in a property name is read before it is classified", () => {
    expect(unescapeCss("colo\\72")).toBe("color");
    expect(unescapeCss("\\63 olor")).toBe("color");
    expect(unescapeCss("\\-\\-x")).toBe("--x");
    expect(declarations(`.drift { colo\\72: #ff0000; }`).map((d) => `${d.property}: ${d.value}`)).toEqual(["color: #ff0000"]);
    expect(declarations(`.drift { \\63 olor : red; }`).map((d) => d.property)).toEqual(["color"]);
  });

  test("appended to either real file it is caught, under the property it really is", () => {
    expect(unnamed(`${tailwind}\n.drift { colo\\72: #ff0000; }`, tailwindReason)).toEqual(["color: #ff0000"]);
    expect(ownValues(`${globals}\n.drift { colo\\72: #ff0000; }`)).toEqual(["color: #ff0000"]);
  });

  // An unquoted url( ) ends at its first `)` that is not escaped: `\)` is a part of the url. Ended at the
  // escaped one, the guard read the `'` after it as a string, which swallowed the rule that followed
  // up to a `'` in a comment, and `.drift { color: #ff0000 }` was read as nothing at all.
  test("an escaped parenthesis does not end an unquoted url", () => {
    const css = `@layer url(a\\)'b); .drift { color: #ff0000; } /* '; */`;
    expect(declarations(css).map((d) => `${d.property}: ${d.value}`)).toEqual(["color: #ff0000"]);
    expect(unnamed(`${tailwind}\n${css}`, tailwindReason)).toEqual(["color: #ff0000"]);
    expect(ownValues(`${globals}\n${css}`)).toEqual(["color: #ff0000"]);
  });

  test("a quoted url is a string, and a parenthesis inside its quotes does not end it", () => {
    const css = `.a { background: url("x)y"); } .drift { color: #ff0000; } .b { content: "z"; }`;
    expect(declarations(css).map((d) => `${d.property}: ${d.value}`)).toEqual([
      'background: url("x)y")',
      "color: #ff0000",
      'content: "z"',
    ]);
  });

  // The guard looked 40 characters past a "(" for the quote that makes a url a string. With more white
  // space than that before the quote, the url was read as unquoted, ended at the `)` inside the string,
  // and the `"` after it opened a string that swallowed `.drift` up to the next quote.
  test.each([
    ["spaces", " ".repeat(45), '"'],
    ["newlines", "\n".repeat(45), '"'],
    ["a single quote", " ".repeat(45), "'"],
    ["exactly 40", " ".repeat(40), '"'],
  ])("a quoted url with a long run of white space before the quote is still a string: %s", (_name, gap, q) => {
    const css = `.a { background: url(${gap}${q}a)b${q}); } .drift { color: #ff0000; } .b { content: ")"; }`;
    const found = declarations(css).map((d) => d.property);
    expect(found).toEqual(["background", "color", "content"]);
    expect(unnamed(`${tailwind}\n${css}`, tailwindReason)).toContain("color: #ff0000");
    expect(ownValues(`${globals}\n${css}`)).toContain("color: #ff0000");
  });

  // `url` spelled with an escape is still `url(`: `u\72 l(`, `u\rl(` and `\75 rl(` open an unquoted url,
  // so the `\)` in it is a part of it and the `'` after is not a string.
  test.each([["u\\72 l"], ["u\\rl"], ["\\75 rl"], ["\\75\\72\\6c "], ["U\\52 L"]])("a url spelled with an escape opens a url all the same: %s", (name) => {
    const css = `@layer ${name}(a\\)'b); .drift { color: #ff0000; } /* '; */`;
    expect(declarations(css).map((d) => `${d.property}: ${d.value}`)).toEqual(["color: #ff0000"]);
    // the at-rule itself may be reported as well: what matters is that the colour after it is
    expect(unnamed(`${tailwind}\n${css}`, tailwindReason)).toContain("color: #ff0000");
    expect(ownValues(`${globals}\n${css}`)).toContain("color: #ff0000");
  });

  test("an unquoted url that is never closed reads to the end, and no further", () => {
    expect(declarations(`.a { color: #ff0000; } .b { background: url(x`).map((d) => d.property)).toEqual(["color"]);
  });

  // A custom property's name is any run of characters after `--`: `--1drift`, `---drift`, `--0`, and
  // `--driñ` are all names, and the pattern wanted a letter after the dashes, so a value set under any
  // of them was read as nothing. An ordinary property may be spelled with a non-ASCII character too.
  test.each([
    [":root { --1drift: #ff0000; }", "--1drift"],
    [":root { ---drift: #ff0000; }", "---drift"],
    [".drift { --0: #ff0000 }", "--0"],
    [".drift { --driñ: #ff0000; }", "--driñ"],
    [".drift { --\\31 x: #ff0000; }", "--1x"],
    [".drift { --a\\:b: #ff0000; }", "--a:b"],
    [".drift { --: #ff0000; }", "--"],
    [".drift { -x-drift: #ff0000; }", "-x-drift"],
    [".drift { dríft: #ff0000; }", "dríft"],
  ])("a value under the name in %s is read", (css, property) => {
    expect(declarations(css).map((d) => `${d.property}: ${d.value}`)).toEqual([`${property}: #ff0000`]);
    expect(unnamed(`${tailwind}\n${css}`, tailwindReason)).toEqual([`${property}: #ff0000`]);
    expect(ownValues(`${globals}\n${css}`)).toEqual([`${property}: #ff0000`]);
  });

  test("in @theme, a name that starts with a digit or a dash is a mapping when it is a bare reference, and a value when it is not", () => {
    expect(declarations(`@theme { ---color-drift: #ff0000; --color-1drift: var(--x); }`).map((d) => [d.property, d.inTheme])).toEqual([
      ["---color-drift", true],
      ["--color-1drift", true],
    ]);
    expect(unnamed(`${tailwind}\n@theme { ---color-drift: #ff0000; }`, tailwindReason)).toEqual(["---color-drift: #ff0000"]);
  });

  test("a selector, a pseudo-class or a rule's header with a colon is not a property name", () => {
    expect(declarations(`a:hover { color: red; }`).map((d) => d.property)).toEqual(["color"]);
  });
});
