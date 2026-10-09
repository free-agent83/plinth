// init maps a native element to a component only where the system has one. A tag it has no component for is left
// out, never written as null: null says "banned, and nothing replaces it", which is a decision for the system,
// and init writing it would flag correct code (a native <textarea> in a system with no Textarea). What is
// left out is said, so that "not checked" is never read as "clean".
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit, intrinsicLines } from "../src/init.mjs";
import { loadContract } from "../src/contract.mjs";
import { gateSource } from "../src/gate.mjs";
import { rulesNotRun } from "../src/unchecked.mjs";
import { app, cli, IN_APP_FOLDER, INLINE_SYSTEM } from "./support/init-repos.mjs";

const config = (root) => JSON.parse(readFileSync(join(root, "undrift.config.json"), "utf8"));
const rawElements = (root, source) =>
  gateSource(source, { fileName: "a.tsx", contract: loadContract(root), rules: ["no-raw-elements"] }).map((v) => v.found);
const NATIVE = "const A = () => <div><button /><input /><select /><textarea /></div>;\n";

describe("a folder with a Button and an Input and no Select or Textarea", () => {
  test("the two it has are mapped, and the two it lacks are not in the config at all", () => {
    const root = app(IN_APP_FOLDER);
    const result = runInit(root, null, { components: "components/ui" });
    expect(config(root).intrinsics).toEqual({ button: "Button", input: "Input" });
    expect(JSON.stringify(config(root))).not.toMatch(/"(?:select|textarea)":/);
    expect(result.unmappedIntrinsics).toEqual(["select", "textarea"]);
  });

  test("a native select and textarea are not flagged, and a native button and input are", () => {
    const root = app(IN_APP_FOLDER);
    runInit(root, null, { components: "components/ui" });
    expect(rawElements(root, NATIVE).sort()).toEqual(["<button>", "<input>"]);
  });

  test("the command says which tags are not checked, and by what", () => {
    const r = cli(app(IN_APP_FOLDER), ["init", "--components", "components/ui"]);
    expect(r.out).toContain("not checked by no-raw-elements: <select>, <textarea> (components/ui has no Select or Textarea)");
  });
});

describe("a package", () => {
  test("is the same, and names the package", () => {
    const root = app(INLINE_SYSTEM);
    const result = runInit(root, "@acme/react");
    expect(config(root).intrinsics).toEqual({ button: "Button", input: "Input" });
    expect(intrinsicLines(result)).toEqual(["  not checked by no-raw-elements: <select>, <textarea> (@acme/react has no Select or Textarea)"]);
  });
});

describe("a system with a component for none of them", () => {
  const CARD_ONLY = { ...IN_APP_FOLDER };
  delete CARD_ONLY["components/ui/button.tsx"];
  delete CARD_ONLY["components/ui/input.tsx"];
  CARD_ONLY["app/page.tsx"] = 'import { Card } from "@/components/ui/card";\nexport default function Page() { return <Card /> }\n';

  test("no intrinsic is written, the line says all four, and the gate reports the rule as not run", () => {
    const root = app(CARD_ONLY);
    const result = runInit(root, null, { components: "components/ui" });
    expect(config(root).intrinsics).toEqual({});
    expect(intrinsicLines(result)[0]).toBe("  not checked by no-raw-elements: <button>, <input>, <select>, <textarea> (components/ui has no Button, Input, Select or Textarea)");
    const [notRun] = rulesNotRun(loadContract(root), ["no-raw-elements"]);
    expect(notRun.rule).toBe("no-raw-elements");
    expect(rawElements(root, NATIVE)).toEqual([]);
  });

  test("a system with nothing read says nothing about tags", () => {
    expect(intrinsicLines({ unmappedIntrinsics: ["button", "input"], components: [], label: "x" })).toEqual([]);
  });
});

describe("a null a person wrote is still a decision the gate keeps", () => {
  test("a hand-written null flags the native element, and init never wrote it", () => {
    const root = app(IN_APP_FOLDER);
    runInit(root, null, { components: "components/ui" });
    const contract = { ...loadContract(root), intrinsics: { ...loadContract(root).intrinsics, textarea: null } };
    const found = gateSource(NATIVE, { fileName: "a.tsx", contract, rules: ["no-raw-elements"] });
    expect(found.map((v) => v.found).sort()).toEqual(["<button>", "<input>", "<textarea>"]);
  });
});
