// Small, synthetic apps with a design system installed, in the shapes real systems ship them,
// for the tests of `undrift init`. Each one is the smallest copy of a shape that made init fail
// when it was first tried on real React and Tailwind systems; none is a real system.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, exited } from "./exec.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const bin = resolve(here, "../../bin/undrift.mjs");
export const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
export const DASH = /[\u2014\u2013]/;

export function app(files) {
  const root = mkdtempSync(join(tmpdir(), "u-init-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), typeof text === "string" ? text : JSON.stringify(text, null, 2));
  }
  return root;
}

export const cli = (root, argv) => {
  try {
    const out = strip(execFileSync(process.execPath, [bin, ...argv], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30000 }));
    return { code: 0, out };
  } catch (e) {
    return { code: exited(e), out: strip((e.stdout ?? "") + (e.stderr ?? "")) };
  }
};

const TAILWIND = {
  "node_modules/tailwindcss/package.json": { name: "tailwindcss", exports: { ".": { style: "./index.css" } } },
  "node_modules/tailwindcss/index.css": "@theme { --color-red-500: oklch(0.637 0.237 25.331); }\n",
};

/**
 * Per-file declarations with every primary component declared inline, and the token layer in a
 * separate styles package behind a `style` export. The component package carries a small entry
 * stylesheet of its own, which only imports the styles package.
 */
export const INLINE_SYSTEM = {
  "package.json": { name: "product", dependencies: { "@acme/react": "1.0.0", "@acme/styles": "1.0.0" } },
  "src/index.css": '@import "tailwindcss";\n@import "@acme/styles";\n',
  "src/main.tsx": 'import "./index.css";\nexport const main = 1;\n',
  "src/settings/account.tsx":
    'import { Button, Card, Input } from "@acme/react";\nexport const Account = () => <Card><Input /><Button>Save</Button></Card>;\n',
  "node_modules/@acme/react/package.json": {
    name: "@acme/react",
    types: "./dist/index.d.ts",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./styles.css": "./dist/styles.css" },
  },
  "node_modules/@acme/react/dist/index.d.ts":
    'export * from "./components/button";\nexport * from "./components/card";\nexport * from "./components/input";\n',
  "node_modules/@acme/react/dist/components/button/index.d.ts":
    'import { ButtonRoot } from "./button";\nexport declare const Button: typeof ButtonRoot;\nexport { ButtonRoot } from "./button";\nexport type { ButtonProps } from "./button";\n',
  "node_modules/@acme/react/dist/components/card/index.d.ts": "export declare function Card(p: {}): JSX.Element;\n",
  "node_modules/@acme/react/dist/components/input/index.d.ts": "export declare const Input: (p: {}) => JSX.Element;\n",
  "node_modules/@acme/react/dist/styles.css": '/* the stylesheet */\n@import "@acme/styles";\n',
  "node_modules/@acme/styles/package.json": { name: "@acme/styles", exports: { ".": { style: "./dist/index.css" } } },
  "node_modules/@acme/styles/dist/index.css":
    '@import "./themes/shared/theme.css" layer(theme);\n@import "./themes/default/variables.css" layer(theme);\n',
  "node_modules/@acme/styles/dist/themes/shared/theme.css": "@theme { --radius-md: 0.5rem; --color-accent: var(--accent); }\n",
  "node_modules/@acme/styles/dist/themes/default/variables.css": ":root { --accent: oklch(0.62 0.19 259); --surface: #fff; }\n",
  ...TAILWIND,
};

/**
 * Subpath entries only, no root: each component has its own entry, and one of them exports a
 * capitalised constant products import. The token layer is in a config package the app's
 * stylesheet imports; the component package has a small stylesheet that imports it too, and a
 * larger third-party one. UI lives in core/ as well as app/.
 */
export const SUBPATH_SYSTEM = {
  "package.json": { name: "product" },
  "styles/globals.css": '@import "@acme/tw-config/index.css";\n',
  "app/page.tsx": 'import { Button } from "@acme/parts/button";\nexport default function Page() { return <Button /> }\n',
  "core/components/toast-host.tsx":
    'import { Toast, TOAST_TYPE } from "@acme/parts/toast";\nexport const Host = () => <Toast type={TOAST_TYPE.SUCCESS} />;\n',
  "core/lib/format.ts": "export const format = (s: string) => s;\n",
  "tests/render.tsx": 'import { Button } from "@acme/parts/button";\nexport const r = <Button />;\n',
  "node_modules/@acme/parts/package.json": {
    name: "@acme/parts",
    exports: {
      "./button": { types: "./dist/button/index.d.ts", import: "./dist/button/index.js" },
      "./toast": { types: "./dist/toast/index.d.ts", import: "./dist/toast/index.js" },
      "./styles/*": "./dist/styles/*.css",
    },
  },
  "node_modules/@acme/parts/dist/button/index.d.ts": "export declare const Button: (p: {}) => JSX.Element;\n",
  "node_modules/@acme/parts/dist/toast/index.d.ts":
    'export declare enum TOAST_TYPE { SUCCESS = "success" }\nexport declare const Toast: (p: {}) => JSX.Element;\n',
  "node_modules/@acme/parts/styles/globals.css": '@import "@acme/tw-config/index.css";\n',
  "node_modules/@acme/parts/dist/styles/date-picker.css": `.rdp { --rdp-accent-color: blue; ${"padding: 0; ".repeat(400)} }\n`,
  "node_modules/@acme/tw-config/package.json": { name: "@acme/tw-config" },
  "node_modules/@acme/tw-config/index.css":
    '@import "tailwindcss";\n@import "./variables.css";\n@theme { --color-*: initial; }\n',
  "node_modules/@acme/tw-config/variables.css": ":root { --bg-surface: #fff; --txt-primary: #111; }\n",
  ...TAILWIND,
};

/**
 * A root entry, and utility and app-shell subpaths the root does not re-export: a namespace
 * re-export of an icon library, and a component declared inline.
 */
export const UTILITY_SUBPATHS = {
  "package.json": { name: "product" },
  "src/index.css": '@import "@acme/kit/styles.css";\n',
  "src/app.tsx":
    'import { Button } from "@acme/kit";\nimport { IconSet } from "@acme/kit/utils";\nimport { AppRoot } from "@acme/kit/app";\nexport const App = () => <AppRoot><Button><IconSet.Plus /></Button></AppRoot>;\n',
  "node_modules/@acme/kit/package.json": {
    name: "@acme/kit",
    types: "types/index.d.ts",
    exports: {
      ".": { types: "./types/index.d.ts", import: "./es/index.js" },
      "./utils": { types: "./types/utils.d.ts", import: "./es/utils.js" },
      "./app": { types: "./types/app.d.ts", import: "./es/app.js" },
      "./components": { types: "./types/components.d.ts", import: "./es/components.js" },
      "./styles.css": "./styles.css",
    },
  },
  "node_modules/@acme/kit/types/index.d.ts": 'export * from "./components";\n',
  "node_modules/@acme/kit/types/components.d.ts": "export { Button } from './button';\nexport declare const Dropzone: any;\n",
  "node_modules/@acme/kit/types/utils.d.ts": "export * as IconSet from 'icon-lib';\nexport declare function cn(...a: string[]): string;\n",
  "node_modules/@acme/kit/types/app.d.ts": "export declare const AppRoot: (p: {}) => JSX.Element;\n",
  "node_modules/@acme/kit/styles.css": '@import "./tokens.css";\n',
  "node_modules/@acme/kit/tokens.css": ":root { --primary: #3b5bdb; --background: #fff; }\n",
};

const WITH_TOKENS = { "package.json": { name: "product" }, "src/index.css": ":root { --x: 1px; }\n" };

/** A package whose root re-exports a nested declaration that is not built (`dist/components` is absent). */
export const NESTED_UNBUILT = {
  ...WITH_TOKENS,
  "src/app.tsx": 'import { Button } from "@acme/nested";\nexport const A = () => <Button />;\n',
  "node_modules/@acme/nested/package.json": { name: "@acme/nested", types: "./dist/index.d.ts" },
  "node_modules/@acme/nested/dist/index.d.ts": 'export * from "./components";\nexport declare const Own: any;\n',
};

/** A package whose declarations end in `export =` of something whose members cannot be listed. */
export const EXPORT_EQUALS = {
  ...WITH_TOKENS,
  "node_modules/@acme/cjs/package.json": { name: "@acme/cjs", types: "./index.d.ts" },
  "node_modules/@acme/cjs/index.d.ts": "declare const lib: any;\nexport = lib;\nexport declare const Own: any;\n",
};

/** A package that re-exports sibling packages, one of which re-exports a sibling in turn. */
export const SIBLING_PACKAGES = {
  ...WITH_TOKENS,
  "src/app.tsx": 'import { Button, Card, Own } from "@acme/all";\nexport const A = () => <Card><Button /><Own /></Card>;\n',
  "node_modules/@acme/all/package.json": { name: "@acme/all", types: "./index.d.ts" },
  "node_modules/@acme/all/index.d.ts": 'export * from "@acme/card";\nexport declare const Own: any;\n',
  "node_modules/@acme/card/package.json": { name: "@acme/card", types: "./index.d.ts" },
  "node_modules/@acme/card/index.d.ts": 'export * from "@acme/button";\nexport declare const Card: any;\n',
  "node_modules/@acme/button/package.json": { name: "@acme/button", types: "./index.d.ts" },
  "node_modules/@acme/button/index.d.ts": "export declare const Button: any;\n",
};

// The token layers of three shapes, each in the app's own stylesheet over the inline system. The first
// has a layer of primitives under its roles, the second has none, the third has a role that reads like
// a palette step.
const withTokens = (css) => ({ ...INLINE_SYSTEM, "src/index.css": css });

/** Primitives under roles: a colour palette (one entry no role is built on yet) and a spacing scale. */
export const LAYERED_TOKENS = withTokens(
  ":root {\n" +
    "  --color-primitive-indigo-700: oklch(0.39 0.17 277);\n" +
    "  --color-primitive-indigo-100: oklch(0.93 0.03 277);\n" +
    "  --color-primitive-white: #ffffff;\n" +
    "  --dimension-spacing-1: 4px;\n" +
    "  --dimension-spacing-2: 8px;\n" +
    "  --color-semantic-primary: var(--color-primitive-indigo-700);\n" +
    "  --color-semantic-surface: var(--color-primitive-white);\n" +
    "  --space-sm: var(--dimension-spacing-1);\n" +
    "  --space-md: var(--dimension-spacing-2);\n" +
    "}\n" +
    "@theme inline {\n" +
    "  --color-primary: var(--color-semantic-primary);\n" +
    "  --color-surface: var(--color-semantic-surface);\n" +
    "  --spacing-sm: var(--space-sm);\n" +
    "}\n"
);

/** Literal tokens that nothing refers to: no layer at all. */
export const FLAT_TOKENS = withTokens(":root { --bg: #ffffff; --fg: #111111; --accent: #3b5bdb; }\n");

/** A role (`--accent`) with the graph shape of a palette step, beside a palette entry. */
export const ACCENT_ROLE_TOKENS = withTokens(
  ":root {\n" +
    "  --white: #ffffff;\n" +
    "  --snow: #f5f5f7;\n" +
    "  --accent: oklch(0.6204 0.195 253.83);\n" +
    "  --focus: var(--accent);\n" +
    "  --surface: var(--snow);\n" +
    "}\n" +
    "@theme inline { --color-accent: var(--accent); --color-surface: var(--surface); }\n"
);

/** A component folder inside the app, as shadcn makes one, with a path alias to it. */
export const IN_APP_FOLDER = {
  "package.json": { name: "product" },
  "tsconfig.json": "{\n  // the alias every shadcn app has\n  \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"./*\"] } },\n}\n",
  "app/globals.css": '@import "tailwindcss";\n:root { --background: oklch(1 0 0); --primary: oklch(0.2 0 0); }\n.dark { --background: oklch(0.1 0 0); }\n',
  "app/page.tsx":
    'import { Button } from "@/components/ui/button";\nimport { Card, CardHeader } from "@/components/ui/card";\nexport default function Page() { return <Card><CardHeader /><Button /></Card> }\n',
  "components/ui/button.tsx":
    'import * as React from "react";\nconst buttonVariants = (o: {}) => "";\nconst Button = React.forwardRef<HTMLButtonElement, {}>((p, ref) => <button ref={ref} className="h-9 rounded-md" />);\nexport interface ButtonProps {}\nexport { Button, buttonVariants };\n',
  "components/ui/card.tsx": "function Card() { return <div /> }\nfunction CardHeader() { return <div /> }\nexport { Card, CardHeader }\n",
  "components/ui/input.tsx": "export const Input = () => <input className=\"h-9\" />;\n",
  ...TAILWIND,
};

/**
 * A component folder whose barrel re-exports a package and a folder outside it, and which holds a
 * folder that is a symlink (made by the test: `components/ui/linked` to `elsewhere`, which holds Card).
 */
export const FOLDER_STAR = {
  ...IN_APP_FOLDER,
  "components/ui/index.ts": 'export * from "./button";\nexport * from "@radix-ui/react-slot";\nexport * from "../shared/toast";\n',
  "components/shared/toast.tsx": "export const Toast = () => null;\n",
  "elsewhere/card.tsx": "export const Card = () => null;\n",
};

/** A component folder whose barrel re-exports a package that is installed, and a subpath of another. */
export const FOLDER_PACKAGE = {
  ...IN_APP_FOLDER,
  "components/ui/index.ts": 'export * from "./button";\nexport * from "@acme/slot";\nexport * from "@acme/menu/item";\n',
  "node_modules/@acme/slot/package.json": { name: "@acme/slot", types: "./dist/index.d.ts" },
  "node_modules/@acme/slot/dist/index.d.ts": "export declare const Slot: any;\n",
  "node_modules/@acme/menu/package.json": { name: "@acme/menu", types: "./dist/index.d.ts" },
  "node_modules/@acme/menu/dist/index.d.ts": "export declare const Menu: any;\n",
  "node_modules/@acme/menu/item.d.ts": "export declare const MenuItem: any;\n",
};
