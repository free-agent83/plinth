// The gate engine. Parses source with the TypeScript compiler API (AST, not
// regex: regex validators get evaded; the longhand-border and monospace
// escapes that motivated this design are in the conformance tests) and checks
// it against the contract. Every violation message is written for an agent:
// it names the rule, the offending value, and the substitution that fixes it.
import ts from "typescript";
import { readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import fg from "fast-glob";
import { measurable } from "./nearest.mjs";
import { findGaps } from "./gaps.mjs";
import { layersOf, listRoles, hasColourPrimitive, colourIndexOf } from "./layers.mjs";
import { colourUtilities, isTailwindPaletteColour, switchedOffPalette, namespaceOfPrefix, TAILWIND_PALETTES } from "./tailwind-colours.mjs";
import { ownRoles, nearestRoles, nearestRolesTo, isFixedOverlay, changesWithTheme, colourFix, FIXED_ADVICE } from "./palette-advice.mjs";
import { DEFAULT_RULES, ALL_RULES, profileRules } from "./rules.mjs";
import { callAt, builtFromTokens, colourSlots, derivedShadeOrigin, spaced, wrappedUnreadColour, wrappedWholeColour } from "./colour-functions.mjs";
import { propertiesSetIn, propertiesSetInProduct } from "./runtime-properties.mjs";
import { couldBeTailwindName, isFrameworkName } from "./readers/tailwind-theme.mjs";
import { canBeComponentName } from "./readers/component-names.mjs";
import {
  canCheckTokens, canCheckComponents, canCheckIntrinsics, canCheckForeignUi, canCheckPrimitives, canCheckDefaultPalette, rulesNotRun, rulesPartlyRun,
  hasStylesheetExtension, hasScriptExtension, isNegativeGlob, GLOB_OPTIONS, recordWalk,
} from "./unchecked.mjs";

export { DEFAULT_RULES, ALL_RULES };

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
// `color-mix` is here because a mix with a raw colour in it is a raw colour. A mix of tokens alone is not, and
// neither is a colour function whose channels come from a token: colour-functions.mjs tells them apart.
// CSS function names are not case sensitive: `RGB(255 0 0)` is a raw colour.
const COLOR_FN_RE = /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color|color-mix)\(/gi;
// Non-global twins for one-off `.test()` calls: a /g regex carries lastIndex
// between calls, and matchAll() inherits it, so testing with the global ones
// would silently skip matches later in the same file.
const HEX_TEST = new RegExp(HEX_RE.source);
const COLOR_FN_TEST = new RegExp(COLOR_FN_RE.source, "i");
const ARBITRARY_PX_RE = /-\[\d*\.?\d+px\]/g;
const ARBITRARY_COLOR_RE = /\[(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|oklch)\()[^\]]*\]/gi;
const PX_STRING_RE = /^\d*\.?\d+(px|rem|em)$/;
// A name is read whole, escapes included (`var(--space-1\.5)`), as the token readers read it.
const LIGHT_DARK_RE = /(?<![\w-])light-dark\s*\(/gi;
const VAR_REF_RE = /var\(\s*(--(?:[A-Za-z0-9_-]|\\.)+)/gi;

// Strictly colour-valued style properties. Anything set here that isn't a token
// is a colour the system never chose, including a bare keyword like `crimson`,
// which is the obvious next move once hex literals are blocked. The shorthands
// (`background`, `border`, `boxShadow`) are deliberately absent: they carry
// non-colour values too, and a rule that misfires gets switched off.
const COLOR_VALUED_PROPS = new Set([
  "color", "backgroundColor", "borderColor", "borderTopColor", "borderRightColor",
  "borderBottomColor", "borderLeftColor", "borderBlockColor", "borderInlineColor",
  "outlineColor", "caretColor", "accentColor", "textDecorationColor", "textEmphasisColor",
  "columnRuleColor", "fill", "stroke", "floodColor", "stopColor", "lightingColor",
]);
// Values that choose no colour of their own. Inheriting or opting out is fine.
const COLOR_KEYWORDS = new Set([
  "", "inherit", "currentcolor", "transparent", "none", "unset", "initial",
  "revert", "revert-layer", "auto",
]);
// JSX attributes whose value is an identifier, not a style. `href="#fade"` and
// `fill="url(#fade)"` are id references. Reading them as hex colours would
// block correct SVG on every edit.
const ID_REF_ATTRS = new Set([
  "href", "xlinkHref", "to", "id", "htmlFor", "form", "headers", "list",
  "aria-controls", "aria-labelledby", "aria-describedby", "aria-owns",
]);

// A value an attribute selector matches (`[stroke='#ccc']` in `[&_line[stroke='#ccc']]:stroke-border`, or
// `path[fill="#000"]` in CSS text) picks out elements. It applies no colour, so a colour inside one is not a raw
// colour. Only the selector's own brackets are skipped: `[&[data-x='a']]:bg-[#000]` still has its #000 read.
const ATTRIBUTE_SELECTOR_RE = /\[\s*[A-Za-z_][\w-]*\s*[~|^$*]?=\s*(?:'[^']*'|"[^"]*"|[^\]\s'"]+)\s*(?:[iIsS]\s*)?\]/g;
const selectorRanges = (text) => [...text.matchAll(ATTRIBUTE_SELECTOR_RE)].map((m) => [m.index, m.index + m[0].length]);
const inRanges = (ranges, index) => ranges.some(([from, to]) => index >= from && index < to);

// Text that is never a style. A placeholder is shown as text in an empty field (`placeholder="#1a1a1a"` on a
// colour input is an example of what to type), on any element: a string given to a prop of that name is hint text.
// Only a string literal is set aside; a JSX value, a spread or an object key is read as before, as is the element's
// own `style` and `className`. A value compared with another (`hex === "#ffffff"`, `case "#fff":`) is read, never
// applied.
const PLACEHOLDER_ATTR = "placeholder";
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);
const isCompared = (node) => {
  const p = node.parent;
  return (ts.isBinaryExpression(p) && EQUALITY.has(p.operatorToken.kind)) || (ts.isCaseClause(p) && p.expression === node);
};

// Values no token can reach. A style for a renderer that does not read CSS: @react-pdf/renderer lays out a PDF from
// style objects, so a colour or a size there cannot be a var(). And a <meta> tag's content, which the browser reads
// outside every stylesheet (`<meta name="theme-color" content="#fff">`). "Use a token" would be untrue there, and so
// would "clean": the value is set aside and reported as not checked, never flagged and never passed in silence.
const NOT_CSS_MODULES = new Set(["@react-pdf/renderer"]);
const VALUE_RULES = new Set(["no-raw-colors", "no-arbitrary-values", "no-inline-style-values"]);

// The renderer's elements that are laid out into the PDF, so their `style` is not CSS. The rest of what it exports is
// not one: PDFViewer renders an <iframe> and PDFDownloadLink an <a> into the page's DOM, where `style` is browser CSS
// and a token can reach it, and BlobProvider, Font, StyleSheet and the hooks take no style. Those stay checked.
const RENDERER_PRIMITIVES = new Set([
  "Document", "Page", "View", "Text", "Link", "Image", "Note", "Canvas",
  "Svg", "Line", "Polyline", "Polygon", "Path", "Rect", "Circle", "Ellipse", "Tspan", "G", "Stop", "Defs",
  "ClipPath", "LinearGradient", "RadialGradient", "Marker",
  "ImageBackground", "FieldSet", "TextInput", "Checkbox", "Select", "List",
]);
// The one type of the renderer's that is a style map for the PDF (the 4.9.0 types: `interface Styles`). The props
// types of PDFViewer, PDFDownloadLink and BlobProvider are browser props, so an object typed with them stays checked.
const RENDERER_STYLE_TYPES = new Set(["Styles"]);

const bindingNames = (name, into) => {
  if (ts.isIdentifier(name)) into.add(name.text);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, into);
};

// Whether `name`, used at `node`, is a local declared inside the file (a variable, a parameter, a function, a class, a
// catch clause) and not the import: the nearest enclosing scope that declares it wins. The top level is the import's
// own scope, so it never counts. A `var` in a nested block is not seen: it is read as the import (a known limit).
function shadowed(node, name, { types = false } = {}) {
  const statementNames = (statements, into) => {
    for (const st of statements) {
      if (types && (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st))) into.add(st.name.text);
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) bindingNames(d.name, into);
      else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) into.add(st.name.text);
    }
  };
  for (let scope = node.parent; scope && !ts.isSourceFile(scope); scope = scope.parent) {
    const names = new Set();
    if (ts.isBlock(scope) || ts.isModuleBlock(scope)) statementNames(scope.statements, names);
    if (ts.isCaseBlock(scope)) for (const clause of scope.clauses) statementNames(clause.statements, names);
    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) bindingNames(parameter.name, names);
      if (types) for (const tp of scope.typeParameters ?? []) names.add(tp.name.text);
      if ((ts.isFunctionExpression(scope) || ts.isClassExpression(scope)) && scope.name) names.add(scope.name.text);
    }
    if ((ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) &&
        scope.initializer && ts.isVariableDeclarationList(scope.initializer)) {
      for (const d of scope.initializer.declarations) bindingNames(d.name, names);
    }
    if (ts.isCatchClause(scope) && scope.variableDeclaration) bindingNames(scope.variableDeclaration.name, names);
    if (names.has(name)) return true;
  }
  return false;
}

const holdsJsx = (node) =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node) || ts.forEachChild(node, holdsJsx) === true;

/**
 * The parts of a file whose values no token can reach, as [from, to, why]: what @react-pdf/renderer styles (the
 * object given to its StyleSheet.create, an object typed with one of its types, the style of one of its PDF
 * primitives), and the content of a <meta> tag.
 */
function unreachableRanges(sf) {
  const named = new Map(); // a local name -> the name the module exports it as
  const namespaces = new Set(); // a local name for the module itself
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!NOT_CSS_MODULES.has(statement.moduleSpecifier.text)) continue;
    const clause = statement.importClause;
    if (clause?.name) namespaces.add(clause.name.text);
    const bound = clause?.namedBindings;
    if (bound && ts.isNamedImports(bound)) for (const el of bound.elements) named.set(el.name.text, (el.propertyName ?? el.name).text);
    if (bound && ts.isNamespaceImport(bound)) namespaces.add(bound.name.text);
  }
  const ranges = [];
  const range = (node, why) => ranges.push([node.getStart(sf), node.getEnd(), why]);
  // What the module exports, if this name or `Namespace.Name` is that: an alias is followed, a local of the same name is not.
  const exportedAs = (expr) => {
    if (ts.isIdentifier(expr)) return named.has(expr.text) && !shadowed(expr, expr.text) ? named.get(expr.text) : null;
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && namespaces.has(expr.expression.text) &&
        !shadowed(expr, expr.expression.text)) return expr.name.text;
    return null;
  };
  // Whether a type annotation is the renderer's style map (`Styles`, aliased or through a namespace). A local type of
  // the same name is not.
  const typedByModule = (type) => {
    if (!type || !ts.isTypeReferenceNode(type)) return false;
    const n = type.typeName;
    if (ts.isIdentifier(n)) return named.has(n.text) && RENDERER_STYLE_TYPES.has(named.get(n.text)) && !shadowed(type, n.text, { types: true });
    return ts.isIdentifier(n.left) && namespaces.has(n.left.text) && RENDERER_STYLE_TYPES.has(n.right.text) &&
      !shadowed(type, n.left.text, { types: true });
  };
  const visit = (node) => {
    if (named.size + namespaces.size > 0) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "create" && exportedAs(node.expression.expression) === "StyleSheet") {
        for (const arg of node.arguments) range(arg, "renderer");
      }
      if (ts.isVariableDeclaration(node) && node.initializer && typedByModule(node.type)) range(node.initializer, "renderer");
      if (ts.isSatisfiesExpression(node) && typedByModule(node.type)) range(node.expression, "renderer");
    }
    if (ts.isJsxAttribute(node) && node.initializer) {
      const element = node.parent.parent;
      const attr = node.name.getText(sf);
      if (attr === "style" && element.tagName && RENDERER_PRIMITIVES.has(exportedAs(element.tagName))) range(node.initializer, "renderer");
      // A string or a plain expression is the tag's data; a JSX value is a component, with CSS of its own to check.
      if (attr === "content" && element.tagName?.getText(sf) === "meta" && !holdsJsx(node.initializer)) range(node.initializer, "meta");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return ranges;
}

// An <input> by its type. A text-like input (no type, or one of these) is what the `input` mapping replaces. A hidden
// input renders nothing, so nothing replaces it. Any other type (checkbox, radio, file, a date, a button type) is a
// different control: it is checked against `input[type=<type>]` when that is mapped, and otherwise it is not checked,
// and said to be. So is a type read only at runtime (`type={kind}`, or a DOM element whose type is set later).
const TEXT_INPUT_TYPES = new Set(["text", "email", "password", "search", "tel", "url", "number"]);

// style-object properties where a bare number is unitless and legitimate
const UNITLESS_STYLE_PROPS = new Set([
  "opacity", "zIndex", "flex", "flexGrow", "flexShrink", "order",
  "fontWeight", "lineHeight", "zoom", "tabSize", "columns", "aspectRatio",
]);

// What to write instead of `hsl(var(--x))` where --x is a whole colour. Without an alpha, the token on its own. With
// one, that would lose it: the utility's opacity modifier (`/50`) or a mix with transparent keeps it.
function wholeColourFix({ token, alpha }) {
  if (alpha === null) return `Use var(${token}) on its own, or its utility.`;
  const number = /^[+-]?(?:\d*\.)?\d+$/.test(alpha) ? Number(alpha) * 100 : /^\d*\.?\d+%$/.test(alpha) ? parseFloat(alpha) : null;
  const percent = number === null ? null : `${Math.round(number * 100) / 100}%`;
  return (
    `To keep the alpha (${alpha}), use the utility's opacity modifier` +
    (percent === null ? "" : ` (/${percent.slice(0, -1)})`) +
    `, or color-mix(in oklch, var(${token}) ${percent ?? "<alpha>"}, transparent).`
  );
}

/**
 * Run the gate over one source string.
 * Returns [{ rule, line, column, found, message }] (line/column 1-based).
 */
export function gateSource(source, { fileName = "input.tsx", rules = DEFAULT_RULES, contract }) {
  const active = new Set(rules);
  const violations = [];
  const lines = source.split("\n");

  // An escape hatch that demands an explanation stays honest; one that doesn't
  // becomes the cheapest path to "done". Require `marker: <reason>`.
  const exemptRe = new RegExp(`${contract.exemptMarker}\\s*:\\s*(\\S.*)$`);
  const exemptions = [];
  // What was set aside rather than judged: not a violation, and said not to have been checked.
  const notChecked = [];
  const exempt = (lineIdx) => {
    const m = lines[lineIdx]?.match(exemptRe);
    if (!m) return false;
    exemptions.push({ line: lineIdx + 1, reason: m[1].trim(), file: fileName });
    return true;
  };
  const colorIndex = colourIndexOf(contract);
  // Every value a token is declared with (one per theme), the system's own first, then Tailwind's theme.
  const tokenValues = (name) => {
    const own = layers.valuesOf(name);
    if (own.length > 0) return own;
    return name in (contract.frameworkTokens ?? {}) ? [contract.frameworkTokens[name]] : [];
  };
  // Whether a token has a value wherever the code runs, so that a fallback behind it is never used: declared in a block
  // that always applies (`:root`), not only in a theme class. Tailwind's own variables are written for every page.
  tokenValues.always = (name) => (layers.valuesOf(name).length > 0 ? layers.appliesAlways(name) : name in (contract.frameworkTokens ?? {}));

  // The rules that need an input run only when it exists, and each skips on
  // the SAME predicate unchecked.mjs uses to report it as not run (rulesNotRun).
  // Skipping here on anything else would let "did not run" and "was not reported"
  // drift apart, and a run would read as clean for a rule that never ran.
  const tokensCheckable = canCheckTokens(contract);
  // A name Tailwind 4's own theme declares exists in the app (`calc(var(--spacing) * 72)`), unless the system resets
  // it. Tailwind's colours are left out: its palette is not the system's (no-default-palette's business), and a
  // var() to one stays reported as before.
  const frameworkName = (name) => isFrameworkName(contract, name);
  const componentsCheckable = canCheckComponents(contract);
  const intrinsicsCheckable = canCheckIntrinsics(contract);
  const foreignUiCheckable = canCheckForeignUi(contract);
  const layers = layersOf(contract);
  const primitivesCheckable = canCheckPrimitives(contract);
  const coloursCheckable = hasColourPrimitive(layers);
  const paletteCheckable = canCheckDefaultPalette(contract);

  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const unreachable = unreachableRanges(sf);
  const unreachableWhy = (node) => {
    const at = node.getStart(sf);
    return unreachable.find(([from, to]) => at >= from && at < to)?.[2] ?? null;
  };
  // Custom properties the code sets (runtime-properties.mjs): this file's, and, only when a name is not a token, the
  // rest of the product's, read once.
  let setHere = null;
  const setByCode = (name) => (setHere ??= propertiesSetIn(source, fileName)).has(name) || propertiesSetInProduct(contract).has(name);
  // A value no token can reach is listed beside what the rules set aside, marked `value` so it is told apart.
  const setAside = (rule, node, found, why, more = {}) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    notChecked.push({ rule, line: line + 1, column: character + 1, found, why, value: true, ...more });
  };

  // `span` is the code the problem is about, when that is more than `node`: an import name is reported
  // on the name, but a change to any line of its import is a change to it.
  const report = (rule, node, found, message, span = node) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    // The person's own stated reason is shown first, so an exempt line is never also listed as not checked.
    if (exempt(line)) return;
    const why = VALUE_RULES.has(rule) ? unreachableWhy(node) : null;
    if (why) return setAside(rule, node, found, why);
    // The lines the span covers: a change anywhere inside a multi-line literal or import is a change to it.
    const startLine = sf.getLineAndCharacterOfPosition(span.getStart(sf)).line + 1;
    const endLine = sf.getLineAndCharacterOfPosition(span.getEnd()).line + 1;
    violations.push({ rule, line: line + 1, startLine: Math.min(startLine, line + 1), endLine, column: character + 1, found, message });
  };

  // No example. The fallback used to name the first three colour tokens in declaration order, then (before
  // that) this sample's own names. A real name with nothing to do with the colour (a background offered for
  // a red text) is as bad as an invented one, so the advice names none, as the arbitrary-colour advice does.
  const noMatchAdvice = ` Use a colour role from ${contract.system || "the token set"}, or its utility, instead of a raw value; if no role fits, propose one.`;

  // A Tailwind v4 shorthand: bg-(--x) means bg-[var(--x)].
  const SHORTHAND_VAR_RE = /-\((--[A-Za-z0-9_-]+)\)/g;
  const systemName = contract.system ?? "the design system";


  // What is said of roles that are near a colour and not built on it: the same words for a Tailwind colour
  // (no-default-palette) and for a primitive of the system's own that no role is built on.
  const nearRolesSentence = (near, prefix, propose = "Or propose a role if none fits.") => {
    const list = listRoles(near.roles, prefix);
    if (near.same) return `Roles of the same colour in every theme, pick the one whose meaning fits: ${list}. ${propose}`;
    return near.partly
      ? `The roles nearest its colour, the same colour in some themes only, pick the one whose meaning fits and say it is not an exact match: ${list}. ${propose}`
      : `The roles nearest its colour, none the same colour, pick the one whose meaning fits and say it is not an exact match: ${list}. ${propose}`;
  };

  const primitiveMessage = (token, prefix, fixed = false) => {
    const all = layers.rolesFor(token);
    const roles = fixed ? all.filter((r) => !changesWithTheme(layers, r)) : all;
    const kind = layers.colourPrimitives.has(token) ? "palette" : "token set";
    const where = `${token} is a primitive: a raw value in ${systemName}'s ${kind}`;
    const name = "Name the role instead, so the meaning survives a theme change or a rebrand.";
    if (roles.length > 0) return `${where} that its roles are built on. ${name} Roles built on it, pick the one whose meaning fits: ${listRoles(roles, prefix)}.`;
    // Roles are built on it, but every one changes with the theme and this colour is fixed.
    if (all.length > 0) return `${where} that its roles are built on. ${name} ${FIXED_ADVICE}`;
    // No role to name, so no "name the role instead": the advice is the nearest roles, or to propose one.
    const head = `${where}, and no role is built on it.`;
    // No role is built on this step, but one may be built on its neighbour (a hover colour on gray-100 for a
    // gray-50): the roles nearest its colour, guarded as no-default-palette's are, and said to be near.
    const colour = layers.coloursOf(token)[0];
    const near = colour === undefined ? { roles: [] } : nearestRolesTo(contract, colour, prefix, { fixed });
    if (near.roles.length > 0) return `${head} ${nearRolesSentence(near, prefix)}`;
    return `${head} If the design needs this value, propose a role rather than naming the primitive.`;
  };

  const paletteMessage = (cls) => {
    // Where the system has switched the palette off, the class builds nothing: the element loses its colour.
    const off = switchedOffPalette(cls.colour, contract.paletteResets);
    const what = off === "palette" ? "palette" : TAILWIND_PALETTES.includes(off) ? `${off} palette` : off;
    const head = off
      ? `${cls.raw} builds nothing here: Tailwind's built-in ${what} is switched off in ${systemName}.`
      : `${cls.raw} is Tailwind's built-in palette, not a colour of ${systemName}, so it skips the design system and its themes.`;
    // When the system has a primitive of the same colour as Tailwind's, the roles built on it are the
    // useful answer. By value, never by name (palette-advice.mjs).
    const fixed = isFixedOverlay(cls.colour, cls.opacity);
    const roles = ownRoles(contract, cls.colour, { fixed });
    if (roles.length > 0) {
      return `${head} Roles built on the system's own ${cls.colour}, pick the one whose meaning fits: ${listRoles(roles, cls.prefix)}.`;
    }
    // Otherwise the roles nearest its colour: Tailwind's value, measured against what each role resolves to.
    // Never the first few roles in the order they were declared, and never an example when none is near.
    const near = nearestRoles(contract, cls.colour, cls.prefix, { fixed });
    if (near.roles.length === 0) return `${head} ${fixed ? FIXED_ADVICE : "Use one of the system's colour roles instead."}`;
    return `${head} ${nearRolesSentence(near, cls.prefix)}`;
  };

  const noRoleAdvice = (name) =>
    ` The nearest colour is ${name}, and no role uses it. If the design needs it, propose a role rather than naming the palette entry.`;

  const suggestColor = (raw) => {
    // The answer is worked out in palette-advice.mjs, and the older-problems note reads the same one.
    const fix = colourFix(layers, colorIndex, raw);
    if (fix.kind === "none") return noMatchAdvice;
    if (fix.kind === "fixed") return ` ${FIXED_ADVICE}`;
    if (fix.kind === "unused") return noRoleAdvice(fix.token);
    if (fix.roles) {
      return ` The nearest colour is ${fix.token}${fix.palette ? ", a primitive" : ""}. Roles built on it, pick the one whose meaning fits: ${listRoles(fix.roles)}. Use the role or its utility, not ${fix.palette ? "the primitive" : fix.token}.`;
    }
    // unchanged: today's advice for a literal role, or a set with no layer
    return ` Nearest token: ${fix.token}. Use its semantic utility or var(${fix.token}).`;
  };

  // Whether no-unknown-tokens says something of a reference to this name (a violation, or a note that Tailwind's theme was
  // not read), by the same conditions as its own check below: the colour check then leaves the name to it.
  const unknownTokenSpeaks = (name) =>
    active.has("no-unknown-tokens") && tokensCheckable && !(name in contract.tokens || frameworkName(name) || setByCode(name));

  // A colour made of a token whose value cannot be followed: it is not known whether the token holds channels or a whole
  // colour, so the value is listed as not checked, with where each search ended (and whether the name there is one the
  // code sets). A name no stylesheet declares is left to no-unknown-tokens where that rule speaks of it, so it is not
  // listed a second time. The person's exemption comes first.
  const listUnread = (node, whole, entries, slot = false) => {
    const stops = entries
      .flatMap((entry) => entry.stops)
      .filter((stop) => stop.depth || stop.path.length > 1 || !unknownTokenSpeaks(stop.path[0]));
    if (stops.length === 0) return;
    if (exempt(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line)) return;
    const named = stops.map((stop) => (stop.depth || !setByCode(stop.path[stop.path.length - 1]) ? stop : { ...stop, code: true }));
    setAside("no-raw-colors", node, spaced(whole), unreachableWhy(node) ?? "unreadToken", { stops: named, ...(slot ? { slot: true } : {}) });
  };

  // What the browser does with a value that is not a colour where a colour is expected, and what a message says of it. The
  // declaration is valid when it is read; the value is invalid when the page is rendered, and the property then computes
  // as unset: its inherited value, or its initial one.
  const NOT_A_COLOUR = "the property computes as unset (inherited, or its initial value)";

  // A token that holds bare channels, taken where a whole colour is expected (an arm of a mix or of a light-dark, the
  // origin of a relative colour): the value is not a colour. Reported with the function that wraps it. A token the code
  // sets is listed, not reported: what it holds there is the code's. Returns "violation" when it reported, and otherwise
  // the tokens whose value could not be read (listed as not checked, unless `note` is false: a caller that reports the call itself).
  const checkSlots = (node, whole, call, span, { note = true } = {}) => {
    const slots = colourSlots(whole, tokenValues, setByCode);
    if (note) listUnread(node, whole, slots.unread, true);
    if (slots.channels.length === 0) return slots.unread;
    const list = (words) => (words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);
    const one = slots.channels.length === 1;
    const holds = slots.channels.map((c) => `${c.token} holds bare channels (${c.value})`);
    const wraps = slots.channels.map((c) => `${c.wrap}(var(${c.token}))`);
    // Said of each token: hsl takes channels that are hue, saturation and lightness, and is only assumed for the rest.
    const hsl = slots.channels.filter((c) => !c.assumed).map((c) => c.token);
    const assumed = slots.channels.filter((c) => c.assumed).map((c) => c.token);
    const why = [
      hsl.length > 0 ? `The channels of ${list(hsl)} are hue, saturation and lightness, so hsl takes them.` : "",
      assumed.length > 0 ? `Hsl is assumed for ${list(assumed)}, because the channels do not read as hue, saturation and lightness. Use the colour function that matches them.` : "",
    ].filter(Boolean).join(" ");
    report(
      "no-raw-colors", node, call,
      `${spaced(whole)} uses ${list(slots.channels.map((c) => c.token))} where a whole colour is expected, but ${list(holds)}, ` +
      `so the value is not a colour and ${NOT_A_COLOUR}. Wrap ${one ? "it" : "each"}: ${wraps.join(", ")}. ${why}`, span
    );
    return "violation";
  };

  // `#fade` after `url(` is a fragment identifier, not a colour.
  const isIdRef = (text, index) =>
    text.slice(Math.max(0, index - 4), index).toLowerCase().endsWith("url(");

  const checkText = (node, text, { idRefContext = false, span = node } = {}) => {
    if (active.has("no-raw-colors")) {
      const selectors = selectorRanges(text);
      for (const m of text.matchAll(HEX_RE)) {
        if (idRefContext || isIdRef(text, m.index) || inRanges(selectors, m.index)) continue;
        report(
          "no-raw-colors", node, m[0],
          `Raw colour ${m[0]} bypasses the token system.${suggestColor(m[0])}`, span
        );
      }
      for (const m of text.matchAll(COLOR_FN_RE)) {
        if (inRanges(selectors, m.index)) continue;
        // report the whole call if we can slice it, else the function name. What is reported stays as it was (to the
        // first closing parenthesis), so a problem deferred in undrift.later.json keeps matching.
        const call = text.slice(m.index, text.indexOf(")", m.index) + 1) || m[0];
        const whole = callAt(text, m.index);
        if (whole && builtFromTokens(whole, tokenValues)) {
          // Built from tokens: not a raw colour. Unless it wraps a token that is already a whole colour, which is no
          // colour at all.
          const wrapped = wrappedWholeColour(whole, tokenValues, setByCode);
          if (wrapped) {
            report(
              "no-raw-colors", node, call,
              `${spaced(whole)} wraps ${wrapped.token}, which already holds a whole colour (${wrapped.value}), so it is not a colour and ${NOT_A_COLOUR}. ` +
              wholeColourFix(wrapped), span
            );
          } else {
            // Its value cannot be followed, so it is not known whether it holds channels or a whole colour.
            const unread = wrappedUnreadColour(whole, tokenValues, setByCode);
            if (unread) listUnread(node, whole, [unread]);
          }
          // And the tokens it takes where a whole colour is expected.
          checkSlots(node, whole, call, span);
          continue;
        }
        const origin = whole && derivedShadeOrigin(whole, tokenValues);
        if (origin) {
          // A shade worked out from a token: not a raw colour, but the system does not define it. Unless its origin is
          // channels, which is no colour to take a shade from. Whatever an origin that cannot be read holds, a whole
          // colour (a shade the system does not define) or not a colour (nothing to take a shade from), the call is
          // wrong, so it is reported, once, and not also listed as not checked. The message says what it took the
          // origin to be.
          const slotted = checkSlots(node, whole, call, span, { note: false });
          if (slotted === "violation") continue;
          const unread = slotted.find((entry) => entry.stops.some((stop) => stop.depth || stop.path.length > 1 || setByCode(stop.path[0])));
          report(
            "no-raw-colors", node, call,
            `${spaced(whole)} makes a new shade of ${origin} that the system does not define. Add a token for it (a hover token, for example) and use that.` +
            (unread ? ` The value of ${unread.token} could not be read, so this takes it to hold a whole colour.` : ""), span
          );
          continue;
        }
        report(
          "no-raw-colors", node, call,
          `Raw colour ${call} bypasses the token system.${suggestColor(call)}`, span
        );
      }
      // A `light-dark()` is not a raw colour of its own (the list above has no light-dark), but its arms are where a
      // whole colour is expected. One inside a mix or a relative colour is read here, as it is when written alone.
      for (const m of text.matchAll(LIGHT_DARK_RE)) {
        if (inRanges(selectors, m.index)) continue;
        const whole = callAt(text, m.index);
        if (whole) checkSlots(node, whole, text.slice(m.index, text.indexOf(")", m.index) + 1) || m[0], span);
      }
    }
    if (active.has("no-arbitrary-values")) {
      for (const m of text.matchAll(ARBITRARY_PX_RE)) {
        report(
          "no-arbitrary-values", node, m[0],
          `Tailwind arbitrary value ${m[0]} bypasses the spacing/size scale. Use a scale utility (e.g. rounded-md, h-10) or propose a token. Never inline a magic number.`, span
        );
      }
      for (const m of text.matchAll(ARBITRARY_COLOR_RE)) {
        // No example. The first few roles in declaration order, always as `bg-`, were the same three for every
        // colour and every utility and could point the wrong way (a red text offered bg-background). A role
        // is only worth naming when it is measured against the colour, as no-default-palette does.
        // The colour in the brackets gets the answer a raw colour gets (one function, palette-advice.mjs), so a
        // role is named only because it is measured against that colour. One that cannot be placed
        // (`rgb(0_0_0/0.5)`) names none.
        const inner = m[0].slice(1, -1);
        const advice = measurable(inner) ? suggestColor(inner) : " Use the utility for one of the system's colour roles.";
        report(
          "no-arbitrary-values", node, m[0],
          `Tailwind arbitrary colour ${m[0]} bypasses the token system.${advice}`,
          span
        );
      }
    }
    // A var() pointing at a token that doesn't exist renders wrong SILENTLY.
    // CSS treats the declaration as invalid rather than erroring. Skipped when
    // the token set is empty (we can't distinguish unknown from missing), and
    // then reported as not run, never as clean.
    if (active.has("no-unknown-tokens") && tokensCheckable) {
      for (const m of text.matchAll(VAR_REF_RE)) {
        if (m[1] in contract.tokens || frameworkName(m[1]) || setByCode(m[1])) continue;
        // A name the code finishes at runtime (`var(--chart-${color})`): what is read is only its head, so it cannot be
        // checked against the tokens. Set aside and listed as a value not checked. The person's exemption comes first.
        if (finishedAtRuntime(node) && m.index + m[0].length === text.length) {
          if (!exempt(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line)) setAside("no-unknown-tokens", node, m[1], "runtimeName");
          continue;
        }
        // Tailwind 4 is there and its theme was not read: this may be a variable Tailwind writes. Said, not flagged.
        if (couldBeTailwindName(contract.frameworkUnread, m[1])) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
          if (!exempt(line)) notChecked.push({ rule: "no-unknown-tokens", line: line + 1, found: m[1], why: "Tailwind's theme was not read" });
          continue;
        }
        report(
          "no-unknown-tokens", node, m[1],
          `Token ${m[1]} does not exist in ${contract.system ?? "the design system"}. ` +
          `CSS fails silently here. The declaration is dropped and the element inherits instead. ` +
          `Use a real token, or declare a gap if the system genuinely lacks this role.`, span
        );
      }
      // `var(--${name})`: nothing of the name is written, so VAR_REF_RE reads none, and it would pass unsaid.
      // The whole name is made at runtime, so it is listed as not checked like any other that is finished there.
      if (finishedAtRuntime(node) && /var\(\s*--$/.test(text)) {
        if (!exempt(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line)) setAside("no-unknown-tokens", node, "--", "runtimeName");
      }
    }
    if (active.has("no-default-palette") && paletteCheckable) {
      for (const cls of colourUtilities(text)) {
        if (!isTailwindPaletteColour(cls.colour)) continue;
        // The system's own: in the colour namespace, or in the namespace of this utility's own prefix
        // (`--background-color-gray-100` gives `bg-gray-100`).
        const own = contract.tokens ?? {};
        const ns = namespaceOfPrefix(cls.prefix);
        if (`--color-${cls.colour}` in own || (ns !== null && `--${ns}-${cls.colour}` in own)) continue;
        report("no-default-palette", node, cls.raw, paletteMessage(cls), span);
      }
    }
    if (active.has("no-primitive-tokens") && primitivesCheckable) {
      for (const re of [VAR_REF_RE, SHORTHAND_VAR_RE]) {
        for (const m of text.matchAll(re)) {
          if (!layers.primitives.has(m[1])) continue;
          report("no-primitive-tokens", node, m[1], primitiveMessage(m[1]), span);
        }
      }
      if (coloursCheckable) {
        for (const cls of colourUtilities(text)) {
          const token = `--color-${cls.colour}`;
          if (!layers.primitives.has(token)) continue;
          report("no-primitive-tokens", node, cls.raw, primitiveMessage(token, cls.prefix, isFixedOverlay(cls.colour, cls.opacity)), span);
        }
      }
    }
  };

  const checkStyleObject = (objLiteral) => {
    for (const prop of objLiteral.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = prop.name.getText(sf).replace(/['"]/g, "");
      const init = prop.initializer;

      // A literal colour in a colour-valued property. Hex and colour functions
      // are already reported from the string itself, so this catches what's
      // left: named colours (`crimson`), and anything else that isn't a token.
      if (active.has("no-raw-colors") && COLOR_VALUED_PROPS.has(name) && ts.isStringLiteralLike(init)) {
        const value = init.text.trim();
        const lower = value.toLowerCase();
        const alreadyReported = HEX_TEST.test(value) || COLOR_FN_TEST.test(value);
        if (
          !alreadyReported &&
          !lower.includes("var(--") &&
          !lower.startsWith("url(") &&
          !COLOR_KEYWORDS.has(lower)
        ) {
          report(
            "no-raw-colors", init, value,
            `Literal colour "${value}" in ${name} bypasses the token system.${suggestColor(value)}`, prop
          );
        }
      }

      if (!active.has("no-inline-style-values")) continue;
      if (ts.isNumericLiteral(init) && !UNITLESS_STYLE_PROPS.has(name)) {
        report(
          "no-inline-style-values", init, `${name}: ${init.text}`,
          `Inline style ${name}: ${init.text} is a raw dimension. Use a token-backed utility class (p-4, rounded-md, text-sm, …) or var(--…). The scale exists so agents and humans land on the same values.`, prop
        );
      }
      if (ts.isStringLiteralLike(init) && PX_STRING_RE.test(init.text)) {
        report(
          "no-inline-style-values", init, `${name}: "${init.text}"`,
          `Inline style ${name}: "${init.text}" is a raw dimension. Use a token-backed utility class or var(--…).`, prop
        );
      }
    }
  };

  // The catalog's own words on when a component applies are in CATALOG.md, and only a system that has one is told
  // to look there.
  const catalogNote = (contract.catalog ?? []).some((c) => c.source === "catalog") ? " See CATALOG.md for when it applies." : "";

  // An <input>'s type as written: "text" when there is no type attribute (HTML's default), the literal when it is
  // one, and null when it is read only at runtime.
  const literalOf = (expr) => (expr && ts.isStringLiteralLike(expr) ? expr.text.toLowerCase() : null);
  const jsxInputType = (node) => {
    const attr = node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "type");
    if (!attr) return "text";
    if (!attr.initializer) return null;
    return ts.isJsxExpression(attr.initializer) ? literalOf(attr.initializer.expression) : literalOf(attr.initializer);
  };
  // The names `react` is imported as: a default or namespace import (`import React`, `import * as R`), and `React`
  // itself, which is global in code that does not import it. A `createElement` reached through any other name
  // (`document`, `el.ownerDocument`, `doc`) is the DOM's.
  const reactNames = new Set(["React"]);
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== "react") continue;
    const clause = st.importClause;
    if (clause?.name) reactNames.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) reactNames.add(clause.namedBindings.name.text);
  }
  // The name a property key spells, or null when it is computed from something that is not a string literal.
  const keyName = (name) =>
    ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text
      : ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression) ? name.expression.text
      : null;
  // createElement("input", { type: "hidden" }) reads its props, a key written as `type`, `"type"` or `["type"]`. A
  // key that is a shorthand, or computed from something that is not a literal, may be the type, so it is read only
  // at runtime. A DOM element (any receiver but React) has its type set afterwards, so it is read only at runtime
  // too; React's with no props is a text input.
  const callInputType = (node) => {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee) && !reactNames.has(callee.expression.getText(sf))) return null;
    const props = node.arguments[1];
    if (props && ts.isObjectLiteralExpression(props)) {
      let type = "text";
      for (const p of props.properties) {
        if (ts.isShorthandPropertyAssignment(p)) { if (p.name.text === "type") return null; continue; }
        if (!ts.isPropertyAssignment(p)) continue;
        const key = keyName(p.name);
        if (key === null) return null;
        if (key === "type") type = literalOf(p.initializer);
      }
      return type;
    }
    return props && props.kind !== ts.SyntaxKind.NullKeyword ? null : "text";
  };
  // The intrinsics key a raw element is checked against, or null when it is not checked. An <input> whose type no
  // component is mapped for, or whose type is read at runtime, is set aside and listed as not checked, unless the
  // person has exempted the line.
  const elementKey = (node, tag, type) => {
    if (tag !== "input") return tag in contract.intrinsics ? tag : null;
    const typed = type && `input[type=${type}]`;
    if (typed && typed in contract.intrinsics) return typed;
    if (type === "hidden") return null;
    if (type !== null && TEXT_INPUT_TYPES.has(type)) return "input" in contract.intrinsics ? "input" : null;
    if ("input" in contract.intrinsics && !exempt(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line)) {
      setAside("no-raw-elements", node, type === null ? "<input type=?>" : `<input type="${type}">`, "inputType");
    }
    return null;
  };

  // Only names imported *from the design system* are checkable. Locally-defined
  // and third-party components are out of scope. The rule is gated on
  // catalogComplete: firing against a partial catalog would flag correct code.
  // (componentsCheckable, above, is that gate: catalogComplete and a non-empty list.)
  const catalogNames = new Set((contract.catalog ?? []).map((c) => c.name));
  // A type the system exports is imported without `type` in correct code, and is not a component.
  const typeNames = new Set(contract.typeNames ?? []);
  const fromSystem = (spec) =>
    (contract.systemImports ?? []).some((s) => spec === s || spec.startsWith(s + "/"));

  // Text whose end the code finishes at runtime: the head or a middle of a template, or a string joined to what
  // follows with `+` (`"var(--chart-" + color`, also when it is a later piece of the sum).
  const finishedAtRuntime = (node) => {
    if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) return true;
    let n = node;
    while (n.parent && ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      if (n.parent.left === n) return true;
      n = n.parent;
    }
    return false;
  };

  const visit = (node) => {
    // strings & templates (skip import/export specifiers, which are module paths)
    if (ts.isStringLiteralLike(node)) {
      const p = node.parent;
      const isModulePath =
        (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node;
      // <a href="#fade"> and <use href="#fade"> are references, not colours.
      const attr = ts.isJsxAttribute(p) ? p.name.getText(sf)
        : ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent) ? p.parent.name.getText(sf)
        : null;
      // A change to the attribute's name is a change to its value, even a line away.
      const attrNode = ts.isJsxAttribute(p) ? p : ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent) ? p.parent : node;
      if (!isModulePath && !(attr === PLACEHOLDER_ATTR) && !isCompared(node)) {
        checkText(node, node.text, { idRefContext: ID_REF_ATTRS.has(attr), span: attrNode });
      }
    } else if (ts.isTemplateExpression(node)) {
      checkText(node.head, node.head.text);
      for (const span of node.templateSpans) checkText(span.literal, span.literal.text);
    }

    // raw intrinsic elements the catalog replaces
    if (
      active.has("no-raw-elements") &&
      intrinsicsCheckable &&
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      /^[a-z]/.test(node.tagName.text)
    ) {
      const tag = node.tagName.text;
      const key = elementKey(node, tag, tag === "input" ? jsxInputType(node) : null);
      if (key) {
        const replacement = contract.intrinsics[key];
        const shown = key === tag ? `<${tag}>` : `<input type="${key.slice("input[type=".length, -1)}">`;
        report(
          "no-raw-elements", node, `<${tag}>`,
          replacement
            ? `Raw ${shown} is banned here. Use <${replacement}> from ${contract.system}.${catalogNote}`
            : `Raw ${shown} has no system equivalent yet. Don't hand-roll one. Propose a component (agents propose, humans ratify).`
        );
      }
    }

    // …and the same element reached without JSX. Once <button> is blocked,
    // React.createElement("button") is the next thing an agent reaches for; it
    // renders exactly the same raw element.
    if (
      active.has("no-raw-elements") &&
      intrinsicsCheckable &&
      ts.isCallExpression(node) &&
      /(^|\.)createElement$/.test(node.expression.getText(sf)) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const tag = node.arguments[0].text;
      const key = elementKey(node, tag, tag === "input" ? callInputType(node) : null);
      if (key) {
        const replacement = contract.intrinsics[key];
        report(
          "no-raw-elements", node, `createElement("${tag}")`,
          replacement
            ? `createElement("${tag}") renders the same raw <${tag}> that JSX would. Use <${replacement}> from ${contract.system}.${catalogNote}`
            : `createElement("${tag}") renders a raw <${tag}> with no system equivalent. Don't hand-roll one. Propose a component (agents propose, humans ratify).`
        );
      }
    }

    // foreign UI imports
    if (
      active.has("no-foreign-ui-imports") &&
      foreignUiCheckable &&
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const spec = node.moduleSpecifier.text;
      if (contract.foreignUi.some((f) => spec === f || spec.startsWith(f))) {
        report(
          "no-foreign-ui-imports", node.moduleSpecifier, spec,
          `UI import "${spec}" is outside the design system. All UI comes from ${contract.system}; if it's missing a component, propose one.`,
          node
        );
      }
    }

    // component names imported from the system that the catalog doesn't have
    if (
      active.has("no-unknown-components") &&
      componentsCheckable &&
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      fromSystem(node.moduleSpecifier.text) &&
      node.importClause &&
      !node.importClause.isTypeOnly &&                 // `import type { … }`
      node.importClause.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const el of node.importClause.namedBindings.elements) {
        if (el.isTypeOnly) continue;                   // `import { type X }`
        const imported = (el.propertyName ?? el.name).getText(sf);
        // Only capitalised names can BE components, so only they can be checked.
        // The catalog comes from readComponentSource, which collects capitalised
        // names only, so a hook or lowercase utility (`useToast`, `proportional`,
        // `pixel`, `cn`) can never be in it, however real an export it is.
        // Checking them isn't a stricter rule, it's a guaranteed false positive.
        // This rule BLOCKS the edit while telling the agent the export doesn't
        // exist, pushing it to abandon correct code and declare a bogus gap.
        // A false positive here is worse than a miss. canBeComponentName is the
        // one predicate for both sides, so the reader can list every name checked.
        if (!canBeComponentName(imported)) continue;
        if (!catalogNames.has(imported) && !typeNames.has(imported)) {
          report(
            "no-unknown-components", el, imported,
            `${imported} does not exist in ${contract.system}. ` +
            `Check the catalog for the right component, or declare a gap if nothing fits.`,
            node
          );
        }
      }
    }

    // inline style objects: visited when either rule that reads them is on;
    // each check inside is guarded by its own rule.
    if (
      (active.has("no-inline-style-values") || active.has("no-raw-colors")) &&
      ts.isJsxAttribute(node) &&
      node.name.getText(sf) === "style" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isObjectLiteralExpression(node.initializer.expression)
    ) {
      checkStyleObject(node.initializer.expression);
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  // gateSource stays array-returning (every caller and test treats it as one);
  // the exemptions ride along as a non-enumerable property so deep-equality
  // against a plain array still holds. Use gateSourceWithGaps for the object form.
  Object.defineProperty(violations, "exemptions", {
    value: exemptions, enumerable: false, writable: true, configurable: true,
  });
  Object.defineProperty(violations, "notChecked", {
    value: notChecked, enumerable: false, writable: true, configurable: true,
  });
  return violations;
}

/**
 * Structured form of `gateSource`, plus gap handling.
 *
 * Exemptions are invisible violations ("0 violations, 14 exemptions" is not a
 * clean run), so they are surfaced explicitly rather than silently swallowed.
 *
 * Gaps are a success state in the dev loop (spec P3): a declared absence is the
 * agent refusing to improvise, and penalising it would push the agent straight
 * back into drift. But a gap cannot ship, so `strict` (release/CI) promotes it
 * to a violation. Invalid gaps (the thing exists, or no reason was given)
 * always fail, in both modes: honesty is not optional.
 */
export function gateSourceWithGaps(source, { strict = false, ...opts } = {}) {
  const violations = gateSource(source, opts);
  const gaps = findGaps(source, { fileName: opts.fileName, contract: opts.contract });

  for (const g of gaps) {
    if (!g.valid) {
      violations.push({
        rule: "invalid-gap", line: g.line, endLine: g.endLine, column: 1, found: g.what, message: g.message,
      });
    } else if (strict) {
      violations.push({
        rule: "unresolved-gap", line: g.line, endLine: g.endLine, column: 1, found: g.what,
        message: `Unresolved gap "${g.what}" cannot ship. Resolve it in triage (add to the system, replace with an existing component, or grant an exemption).`,
      });
    }
  }

  return {
    violations,
    exemptions: violations.exemptions ?? [],
    notChecked: violations.notChecked ?? [],
    gaps: gaps.filter((g) => g.valid),
  };
}

/**
 * Gate a list of LITERAL file paths. `gateFiles` globs its patterns, which
 * silently drops any path containing fast-glob syntax: `(marketing)`,
 * `[slug]`, `{a,b}`. Those are ordinary directory names in Next.js and Remix
 * apps, so globbing already-resolved paths quietly under-reports real drift.
 */
export function gatePaths(files, { rules = DEFAULT_RULES, contract, strict = false }) {
  // Only a script is gated. No rule reads CSS, and no rule reads Markdown, MDX, JSON or
  // SVG either. Such a file handed to the gate, named on the command line or matched by a
  // broad profile glob, used to be parsed as TSX, found to contain nothing, and counted
  // as a file checked and clean (or a colour in a data file was flagged). It is set aside
  // and returned, for the caller to report as not checked: stylesheets as stylesheets,
  // and the rest as files Undrift cannot check.
  const stylesheets = files.filter(hasStylesheetExtension);
  const others = files.filter((file) => !hasScriptExtension(file) && !hasStylesheetExtension(file));
  files = files.filter(hasScriptExtension);
  const results = [];
  const exemptions = [];
  const setAside = [];
  const valuesNotChecked = [];
  const allGaps = [];
  const declarations = { total: 0, resolved: 0 };
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const { violations, exemptions: fileExemptions, notChecked: fileSetAside, gaps } = gateSourceWithGaps(source, {
      fileName: file, rules, contract, strict,
    });
    for (const v of violations) results.push({ ...v, file });
    for (const e of fileExemptions) exemptions.push({ ...e, file });
    for (const n of fileSetAside) (n.value ? valuesNotChecked : setAside).push({ ...n, file });
    for (const g of gaps) allGaps.push({ ...g, file });
    const d = countDeclarations(source, { fileName: file, contract });
    declarations.total += d.total;
    declarations.resolved += d.resolved;
  }
  // A clean result means "checked and clean": the rules this run turned on but
  // could not run ride along, so every output can say so.
  return {
    files: files.length,
    stylesheets,
    others,
    violations: results,
    exemptions,
    gaps: allGaps,
    declarations,
    rulesNotRun: rulesNotRun(contract, rules),
    rulesPartlyRun: rulesPartlyRun(contract, rules).map((part) => withPlaces(part, setAside, contract)),
    valuesNotChecked,
  };
}

/** A rule part's note, with the places the rule set aside (repository-relative, `file:line name`), when it did. */
function withPlaces(part, setAside, contract) {
  const places = setAside
    .filter((n) => n.rule === part.rule)
    .map((n) => `${relative(contract.root, n.file).split("\\").join("/")}:${n.line} ${n.found}`);
  return places.length > 0 ? { ...part, places: [...new Set(places)] } : part;
}

/**
 * Run the gate over files (paths or globs, resolved against contract.root). `walked` is what the
 * glob could not see: the directories it could not read and the links it met, and the files it
 * matched, for the caller to report.
 */
export function gateFiles(patterns, { rules = DEFAULT_RULES, contract, strict = false }) {
  const record = recordWalk(contract, patterns);
  const files = fg.sync(patterns, { cwd: contract.root, absolute: true, ...GLOB_OPTIONS, fs: record.fs });
  return { ...gatePaths(files, { rules, contract, strict }), walked: { ...record.walked(), matched: files } };
}

// The published metric (spec §8). A "style declaration" is any place a visual
// value is set: an inline style property, or a utility class carrying a value.
// "Resolved" means it came from the token system rather than a literal.
// Layout-only utilities (flex, items-center) carry no value and are not counted.
// Counting them would inflate the denominator and flatter the score.

// Exported: single-source.mjs (dimension 2) needs the SAME "is this Tailwind
// class value-carrying, and is it the scale form or the arbitrary form"
// vocabulary this metric already uses. A byte-copy would drift the moment
// either list changes here without the other noticing.
export const VALUE_UTILITY_RE =
  /^(bg|text|border|ring|fill|stroke|shadow|from|via|to|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|w|h|min-w|min-h|max-w|max-h|rounded|leading|tracking)(-|$)/;
export const ARBITRARY_UTILITY_RE = /-\[[^\]]+\]/;

export function countDeclarations(source, { fileName = "input.tsx", contract }) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tokens = contract.tokens ?? {};
  let total = 0, resolved = 0;

  const countClassName = (text) => {
    for (const cls of text.split(/\s+/).filter(Boolean)) {
      if (!VALUE_UTILITY_RE.test(cls)) continue;   // layout-only → not a declaration
      total++;
      if (!ARBITRARY_UTILITY_RE.test(cls)) resolved++;  // scale utility → token-backed
    }
  };

  const countStyleObject = (obj) => {
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = prop.name.getText(sf).replace(/['"]/g, "");
      const init = prop.initializer;
      if (ts.isNumericLiteral(init) && UNITLESS_STYLE_PROPS.has(name)) continue;
      total++;
      if (ts.isStringLiteralLike(init)) {
        const m = init.text.match(/var\(\s*(--[A-Za-z0-9_-]+)/);
        if (m && m[1] in tokens) resolved++;
      }
    }
  };

  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.initializer) {
      const attr = node.name.getText(sf);
      if (attr === "className" || attr === "class") {
        if (ts.isStringLiteral(node.initializer)) countClassName(node.initializer.text);
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression &&
                 ts.isStringLiteralLike(node.initializer.expression)) {
          countClassName(node.initializer.expression.text);
        }
      }
      if (attr === "style" && ts.isJsxExpression(node.initializer) &&
          node.initializer.expression &&
          ts.isObjectLiteralExpression(node.initializer.expression)) {
        countStyleObject(node.initializer.expression);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { total, resolved };
}

/** Compliance as a percentage. Empty source is vacuously 100%. */
export function compliance({ total, resolved }) {
  return total === 0 ? 100 : Math.round((resolved / total) * 1000) / 10;
}

/**
 * Explicit path arguments, resolved to the files they name. An argument that names
 * an existing file is a LITERAL path, whatever its name looks like:
 * `app/(dashboard)/[id]/page.tsx` is an ordinary file in a Next.js or Remix app,
 * and to fast-glob it is syntax that matches something else, so the file gated
 * nothing and the run read as clean. Only an argument that is not an existing file
 * is a pattern. Resolved against the contract root, as the patterns always were.
 *
 * Every argument that names no file is returned in `unmatched`, in the order
 * given: a typo or a stale glob, which used to be dropped in silence as long as
 * another argument matched. A negation (`!glob`) applies to every pattern and is
 * never "unmatched" itself, unless nothing but negations was given.
 */
function resolveExplicitPaths(args, contract) {
  const root = contract.root;
  const files = new Set();
  const unmatched = [];
  const negations = args.filter(isNegativeGlob);
  const positives = args.filter((arg) => !isNegativeGlob(arg));
  const record = recordWalk(contract, positives);
  for (const arg of positives) {
    const abs = resolve(root, arg);
    let isFile = false;
    try { isFile = statSync(abs).isFile(); } catch { /* not there: a pattern */ }
    if (isFile) {
      files.add(abs);
      continue;
    }
    const found = fg.sync([arg, ...negations], { cwd: root, absolute: true, ...GLOB_OPTIONS, fs: record.fs });
    if (found.length === 0) {
      if (!unmatched.includes(arg)) unmatched.push(arg);
    } else {
      for (const file of found) files.add(file);
    }
  }
  // Only negations: nothing was named, so nothing matched.
  if (positives.length === 0) {
    for (const arg of args) if (!unmatched.includes(arg)) unmatched.push(arg);
  }
  return { files: [...files], unmatched, walked: { ...record.walked(), matched: [...files] } };
}

/** Resolve which profile applies and run it. */
export function gateProfile(profileName, { contract, extraPatterns = [], strict = false }) {
  const profile = contract.profiles[profileName];
  if (!profile) {
    throw new Error(
      `Unknown profile "${profileName}". Available: ${Object.keys(contract.profiles).join(", ") || "(none configured)"}`
    );
  }
  const rules = profileRules(profile);
  if (extraPatterns.length === 0) return gateFiles(profile.include, { rules, contract, strict });

  // Explicit paths: literal files go to gatePaths as they are, the rest are globbed.
  // A file named both ways is gated once, and an argument that found nothing rides
  // along in `unmatched` for the caller to report.
  const explicit = resolveExplicitPaths(extraPatterns, contract);
  return { ...gatePaths(explicit.files, { rules, contract, strict }), unmatched: explicit.unmatched, walked: explicit.walked };
}
