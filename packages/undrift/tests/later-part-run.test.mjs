// `undrift later` says what it did not look for. A rule that ran on less than it is for (no-primitive-tokens with
// no colour primitive declared) is one: its colour utilities were not looked for, so "no older problem there"
// is never said without that, in the file form and in --all, as the --rule form, the gate and the hook do.
import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli } from "./support/world.mjs";
import { commitAll } from "./support/git.mjs";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "u-later-part-"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "ds.css"), ":root{--radius:0.5rem;--radius-md:var(--radius);--color-primary:#3b5bdb}");
  writeFileSync(join(root, ".gitignore"), ".undrift/\n");
  writeFileSync(join(root, "undrift.config.json"), JSON.stringify({
    system: "@acme/ds", tokensCss: "ds.css", ignore: { "ds.css": "the token source" }, primitives: ["--radius"],
    profiles: { app: { include: ["app/**/*.tsx"], rules: ["no-primitive-tokens"] } },
  }));
  writeFileSync(join(root, "app/page.tsx"), 'export const P = () => <div className="bg-primitive-indigo-700" />;\n');
  commitAll(root);
  return root;
}
const LINE = /Not looked for: no-primitive-tokens colour utilities \(none of the declared primitives is a raw colour/;

test("the file form says the colour utilities were not looked for", () => {
  const r = cli(repo(), ["later", "app/page.tsx"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Nothing to defer");
  expect(r.stdout).toMatch(LINE);
});

test("--all says it too", () => {
  const r = cli(repo(), ["later", "--all"]);
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(LINE);
});

test("a rule that ran in full is not listed as not looked for", () => {
  const root = repo();
  const r = cli(root, ["later", "app/page.tsx", "--rule", "no-primitive-tokens", "--value", "--radius"]);
  expect(r.out).not.toMatch(/Not looked for: no-primitive-tokens colour/);
});
