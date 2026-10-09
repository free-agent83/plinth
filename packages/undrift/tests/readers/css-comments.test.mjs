// One way of stripping comments, shared by the contract and the stylesheet reader, so that a file
// is a token source for the reader exactly when the contract finds tokens in it. Two readers that
// strip differently would name a file as a token source and then find nothing in it, or the other
// way round.
import { describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCssTokenDeclarations, stripCssComments } from "../../src/readers/css-tokens.mjs";
import { tokenStylesheets } from "../../src/readers/css-imports.mjs";
import { loadContract } from "../../src/contract.mjs";

describe("stripCssComments", () => {
  test("removes every closed comment and leaves what is around it", () => {
    expect(stripCssComments("a /* x */ b /* y\nz */ c")).toBe("a  b  c");
  });

  test("an unclosed comment is left as it is", () => {
    expect(stripCssComments(":root{--a:1} /* never closed")).toBe(":root{--a:1} /* never closed");
  });

  test("a comment marker inside a string, or after a backslash, is not a comment", () => {
    expect(stripCssComments('a { content: "/* x */"; } /* y */ b { content: \'/*\'; }')).toBe('a { content: "/* x */"; }  b { content: \'/*\'; }');
    expect(stripCssComments('a { content: "\\"/* x */"; } /* y */')).toBe('a { content: "\\"/* x */"; } ');
    expect(stripCssComments("a\\/* not a comment */ b")).toBe("a\\/* not a comment */ b");
  });

  test("a string that is never closed ends at its line, so a comment on the next line is one", () => {
    expect(stripCssComments('a { content: "oops;\n} /* c */ b')).toBe('a { content: "oops;\n}  b');
  });

  test("the shared reader reads declarations only, so a comment the caller did not strip hides what follows it", () => {
    expect(readCssTokenDeclarations("/* --a: 1; */")).toEqual([]);
  });
});

const agree = (css) => {
  const dir = mkdtempSync(join(tmpdir(), "u-agree-"));
  writeFileSync(join(dir, "t.css"), css);
  writeFileSync(join(dir, "undrift.config.json"), JSON.stringify({ system: "@acme/ds", tokensCss: "t.css" }));
  const contractNames = Object.keys(loadContract(dir).tokens).sort();
  const isSource = tokenStylesheets(dir, [join(dir, "t.css")]).withTokens.length > 0;
  return { contractNames, isSource };
};

describe("the stylesheet reader and the contract agree on what a comment hides", () => {
  test("a declaration only inside a comment is not a token for either", () => {
    expect(agree("/* --a: 1; */ .x { color: red; }")).toEqual({ contractNames: [], isSource: false });
  });

  test("an unclosed comment hides what follows it from both, as it does in CSS", () => {
    expect(agree(":root { --a: 1; } /* never closed --b: 2;")).toEqual({ contractNames: ["--a"], isSource: true });
  });

  test("a /* inside a string is not a comment for either: what follows it is still read", () => {
    expect(agree('.x::before { content: "/*"; } :root { --only: 1; } /* c */ .y { color: red; }')).toEqual({
      contractNames: ["--only"],
      isSource: true,
    });
  });
});
