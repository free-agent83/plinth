// The other places Undrift's own words ship from. `no-dashes-in-output.test.mjs` holds the strings of the
// code. These are the files that carry words without being code: the schema an editor shows as help text,
// the package description, and the templates `undrift init` copies into a person's repository, which are read
// whole, comments included, because a comment in a copied file is the person's to read.
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DASH = /[\u2014\u2013]/;

/** Every string in a parsed JSON value, with the path that leads to it. */
function strings(value, path = "$") {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, i) => strings(item, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, v]) => strings(v, `${path}.${key}`));
  return [];
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("the schema and the package description", () => {
  test.each(["schema.json", "package.json"])("%s holds no dash in any string value", (name) => {
    const found = strings(JSON.parse(readFileSync(join(root, name), "utf8"))).filter(([, text]) => DASH.test(text));
    expect(found.map(([path]) => path)).toEqual([]);
  });

  test("the scan reads nested values, arrays and the description", () => {
    expect(strings({ a: { b: ["x \u2014 y", { c: "z" }] }, description: "d" })).toEqual([["$.a.b[0]", "x \u2014 y"], ["$.a.b[1].c", "z"], ["$.description", "d"]]);
  });
});

describe("the templates init copies into a repository", () => {
  const templates = filesUnder(join(root, "templates"));

  test("there are templates to read", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  test.each(templates.map((file) => [relative(root, file), file]))("%s holds no dash, comments included", (_name, file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    expect(lines.map((line, i) => (DASH.test(line) ? `${i + 1}: ${line.trim()}` : null)).filter(Boolean)).toEqual([]);
  });
});

// The source and the README are read whole, comments included: the export ships them, and a stranger reads the
// comments first. A string or a pattern that has to match a dash character is written with an escape (\u2014 or
// \u2013) so the file itself stays free of the character. `src/assess` is the instrument and is not read here.
// The export of this package withholds the README for now, so there it is not read, rather than failed as missing.
const README = join(root, "README.md");
describe("the source and the README, read whole", () => {
  const sources = ["src", "bin", "hooks"].flatMap((dir) => filesUnder(join(root, dir)).filter((file) => !/[\\/]src[\\/]assess[\\/]/.test(file)));
  const shipped = [...sources, ...(existsSync(README) ? [README] : [])];

  test("there are source files to read", () => {
    expect(sources.filter((file) => file.endsWith(".mjs")).length).toBeGreaterThan(20);
    expect(sources.some((file) => file.includes("assess"))).toBe(false);
  });

  test.each(shipped.map((file) => [relative(root, file), file]))("%s holds no dash, comments included", (_name, file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    expect(lines.map((line, i) => (DASH.test(line) ? `${i + 1}: ${line.trim()}` : null)).filter(Boolean)).toEqual([]);
  });
});
