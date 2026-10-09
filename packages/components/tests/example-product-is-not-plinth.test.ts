// The example product built on Plinth has a name of its own, so that "Plinth" only ever means the design system
// (product plan step 4). Its name is written once, in apps/web/app/lib/product.ts, so it changes in one place.
// The docs at /docs are Plinth's and carry Plinth's name. Demo data uses example.com, which is reserved for
// examples, and the theme cookie is named for what it holds. The tab icons are generated from the names, not drawn:
// the product's from PRODUCT and the docs' from Plinth's own, so a letter is never written a second time.
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// The components package's tests run from its own folder, as example-screens-keep-the-contract.test.ts relies on.
const web = resolve(process.cwd(), "../../apps/web");
const read = (rel: string) => readFileSync(join(web, rel), "utf8");
const SKIP = new Set(["node_modules", ".next", ".source"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|mdx?|json|css|mjs|svg)$/.test(name) ? [path] : [];
  });
}

const product = read("app/lib/product.ts");
const NAME = product.match(/name:\s*"([^"]+)"/)?.[1] ?? "";

describe("the example product's name is written once", () => {
  test("product.ts holds it", () => {
    expect(NAME).not.toBe("");
    expect(NAME).not.toMatch(/plinth/i);
  });

  test("no other file under apps/web writes it", () => {
    const elsewhere = files(web)
      .filter((f) => !f.endsWith(join("app", "lib", "product.ts")))
      .filter((f) => readFileSync(f, "utf8").toLowerCase().includes(NAME.toLowerCase()))
      .map((f) => relative(web, f));
    expect(elsewhere).toEqual([]);
  });

  test("the app's wordmark and title read it", () => {
    expect(read("app/components/wordmark.tsx")).toMatch(/PRODUCT\.name/);
    expect(read("app/layout.tsx")).toMatch(/PRODUCT\.name/);
  });
});

describe("the docs are Plinth's", () => {
  test("the docs nav carries Plinth's wordmark, not the product's", () => {
    const shared = read("lib/layout.shared.tsx");
    expect(shared).toMatch(/PlinthWordmark/);
    expect(shared).not.toMatch(/import \{ Wordmark \}/);
    // however it is imported or renamed: the product's wordmark module is not imported here at all
    expect(shared).not.toMatch(/app\/components\/wordmark["']/);
    expect(shared).toMatch(/import \{ PlinthWordmark \} from "@\/app\/components\/plinth-wordmark"/);
  });

  test("the docs nav title is Plinth's wordmark, and it links to the docs", () => {
    const shared = read("lib/layout.shared.tsx");
    expect(shared).toMatch(/title: <PlinthWordmark \/>/);
    expect(shared).toMatch(/url: "\/docs"/);
  });

  test("the docs link back to the product by its name, at /", () => {
    expect(read("lib/layout.shared.tsx")).toMatch(/\{ text: PRODUCT\.name, url: "\/" \}/);
  });

  test("Plinth's wordmark says Plinth and knows nothing of the product", () => {
    const wordmark = read("app/components/plinth-wordmark.tsx");
    expect(wordmark).toMatch(/>\s*Plinth\s*</);
    expect(wordmark).toMatch(/>\s*P\s*</);
    expect(wordmark).not.toMatch(/PRODUCT|app\/lib\/product/);
  });

  test("the docs index is titled Plinth", () => {
    expect(read("content/docs/index.mdx")).toMatch(/^---\ntitle: Plinth\n/);
  });
});

describe("demo data and the cookie", () => {
  test("every demo email is at example.com", () => {
    const emails = [...read("app/lib/users.ts").matchAll(/email: "([^"]+)"/g)].map((m) => m[1]);
    expect(emails.length).toBeGreaterThan(0);
    for (const e of emails) expect(e).toMatch(/@example\.com$/);
  });

  test("the cookie the toggle writes is the cookie the layout reads, and it is called theme", () => {
    expect(read("app/components/theme-toggle.tsx")).toMatch(/document\.cookie = `theme=/);
    expect(read("app/layout.tsx")).toMatch(/cookies\(\)\)\.get\("theme"\)/);
  });
});

describe("the tab icons are generated from the names, not drawn", () => {
  const app = join(web, "app");
  const initial = product.match(/initial:\s*"([^"]+)"/)?.[1] ?? "";

  test("the product has an initial, and it is written once", () => {
    expect(initial).toMatch(/^[A-Za-z]$/);
    const written = new RegExp(`>\\s*${initial}\\s*<|["'\`]${initial}["'\`]`);
    const elsewhere = files(web)
      .filter((f) => !f.endsWith(join("app", "lib", "product.ts")))
      .filter((f) => /\.(tsx?|svg)$/.test(f) && written.test(readFileSync(f, "utf8")))
      .map((f) => relative(web, f));
    expect(elsewhere).toEqual([]);
  });

  test("no icon is a file drawn by hand: no icon, favicon or apple-icon image in app/", () => {
    const drawn = readdirSync(app).filter((name) => /^(icon|favicon|apple-icon)\d*\.(svg|png|ico|jpe?g|gif)$/.test(name));
    expect(drawn).toEqual([]);
  });

  test("the product's icon is drawn from PRODUCT.initial", () => {
    const icon = read("app/icon.tsx");
    expect(icon).toMatch(/import \{ PRODUCT \} from "@\/app\/lib\/product"/);
    expect(icon).toMatch(/renderMark\(PRODUCT\.initial\)/);
  });

  test("the docs icon is Plinth's, a P like the docs wordmark, and not the product's", () => {
    const docs = read("app/docs/icon.tsx");
    expect(docs).toMatch(/renderMark\("P"\)/);
    expect(docs).not.toMatch(/PRODUCT|app\/lib\/product/);
  });

  test("both are drawn by the one mark, which takes a letter and holds no letter of its own", () => {
    const mark = read("app/lib/mark.tsx");
    expect(mark).toMatch(/export function renderMark\(letter: string\)/);
    expect(mark).toMatch(/\{letter\}/);
    expect(mark).not.toMatch(/from "@\/app\/lib\/product"/);
  });

  // An image is drawn outside the page, so its two colours are hex. They are the default light theme's primary
  // and primary-foreground, and this fails if either moves.
  test("the mark's colours are the primary and primary-foreground tokens of the default light theme", () => {
    const tokens = resolve(process.cwd(), "../tokens/src");
    const json = (rel: string) => JSON.parse(readFileSync(join(tokens, rel), "utf8"));
    const light = json("theme/default/light.tokens.json").color.semantic;
    const colour = json("primitive/color.tokens.json").color;
    const hexOf = (alias: string): string => {
      const [, ...path] = alias.replace(/[{}]/g, "").split(".");
      return path.reduce((node, key) => node[key], colour)["$value"].hex.toLowerCase();
    };
    const mark = read("app/lib/mark.tsx");
    expect(mark).toContain(`background: "${hexOf(light.primary["$value"])}"`);
    expect(mark).toContain(`color: "${hexOf(light["primary-foreground"]["$value"])}"`);
  });
});

describe("the map in sample/AGENTS.md names the example product plainly", () => {
  // A bullet of the map is "`path`: what it is." A sentence with a second colon in it ("`apps/web/`: the example
  // product: a three-screen ...") reads as a stutter, so a sentence has one.
  test("no sentence of a map bullet has two colons outside code", () => {
    const agents = readFileSync(resolve(process.cwd(), "../../AGENTS.md"), "utf8");
    const bullets = agents.split("\n").filter((line) => line.startsWith("- `"));
    expect(bullets.length).toBeGreaterThan(3);
    const stutters = bullets.flatMap((line) =>
      line
        .replace(/`[^`]*`/g, "``")
        .split(/\.\s/)
        .filter((sentence) => (sentence.match(/:\s/g) ?? []).length > 1)
        .map((sentence) => sentence.slice(0, 60)),
    );
    expect(stutters).toEqual([]);
  });

  test("the product is introduced as the example product", () => {
    const agents = readFileSync(resolve(process.cwd(), "../../AGENTS.md"), "utf8");
    expect(agents).toMatch(/- `apps\/web\/`: the example product, a three-screen Next\.js/);
  });
});
