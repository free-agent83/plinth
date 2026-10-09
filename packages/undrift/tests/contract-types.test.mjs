// An import of a type is correct without `import type`, and the gate must not say the component does not exist.
// A type is listed apart from the components: it is never a component, and the list that says which
// components there are is the list of values.
import { describe, expect, test } from "vitest";
import { app, IN_APP_FOLDER, INLINE_SYSTEM } from "./support/init-repos.mjs";
import { runInit } from "../src/init.mjs";
import { loadContract } from "../src/contract.mjs";
import { gateSource } from "../src/gate.mjs";

const flagged = (root, source) =>
  gateSource(source, { fileName: "a.tsx", contract: loadContract(root), rules: ["no-unknown-components"] }).map((v) => v.found);

// The chart shape of a stock shadcn app: a config type, imported beside the component, without `type`.
const CHART_FOLDER = {
  ...IN_APP_FOLDER,
  "components/ui/chart.tsx":
    'import * as React from "react";\nexport type ChartConfig = Record<string, { label?: string }>;\nconst ChartContainer = ({ config }: { config: ChartConfig }) => <div />;\nconst ChartTooltip = () => null;\nexport { ChartContainer, ChartTooltip };\n',
};

describe("a folder of components", () => {
  test("the chart shape: the config type is imported with its component and is not flagged", () => {
    const root = app(CHART_FOLDER);
    runInit(root, null, { components: "components/ui" });
    expect(flagged(root, 'import { ChartConfig, ChartContainer } from "@/components/ui/chart";\n')).toEqual([]);
  });

  test("a name that is neither a component nor a type is still flagged, beside one that is", () => {
    const root = app(CHART_FOLDER);
    runInit(root, null, { components: "components/ui" });
    expect(flagged(root, 'import { ChartConfig, ChartConfigs, Rating } from "@/components/ui/chart";\n')).toEqual(["ChartConfigs", "Rating"]);
  });

  test("the types are on the contract, apart from the components", () => {
    const root = app(CHART_FOLDER);
    runInit(root, null, { components: "components/ui" });
    const contract = loadContract(root);
    expect(contract.typeNames).toEqual(["ButtonProps", "ChartConfig"]);
    expect(contract.catalog.map((c) => c.name)).not.toContain("ChartConfig");
  });
});

describe("a package", () => {
  const PACKAGE = {
    ...INLINE_SYSTEM,
    "node_modules/@acme/react/dist/components/card/index.d.ts":
      "export interface CardProps {}\nexport type CardSize = 'sm' | 'lg';\nexport declare function Card(p: CardProps): JSX.Element;\n",
  };

  test("a type its declarations export is not flagged when it is imported without `type`", () => {
    const root = app(PACKAGE);
    runInit(root, "@acme/react");
    expect(flagged(root, 'import { Card, CardProps, CardSize } from "@acme/react";\n')).toEqual([]);
    expect(flagged(root, 'import { Card, CardPropz } from "@acme/react";\n')).toEqual(["CardPropz"]);
  });

  test("the types are not components: the catalog does not list them", () => {
    const root = app(PACKAGE);
    runInit(root, "@acme/react");
    expect(loadContract(root).catalog.map((c) => c.name)).not.toContain("CardProps");
    expect(loadContract(root).typeNames).toEqual(expect.arrayContaining(["CardProps", "CardSize"]));
  });
});
