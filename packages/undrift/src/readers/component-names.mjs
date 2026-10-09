// packages/undrift/src/readers/component-names.mjs
// The names a design system's components can be imported by, read from what it
// ships: the type declarations of an installed package, or the source of a folder
// of components inside the app (shadcn's components/ui). Written for init and the
// gate. The older reader, package-components.mjs, is kept exactly as it is.
//
// One file is parsed with TypeScript's parser, never type-checked, so it is fast
// and needs nothing installed beside it. A name counts when it is exported as a
// value (const, let, var, function, class, enum, namespace, or a re-export of
// one) and begins with a capital, which is exactly what the gate checks an
// import against. Types and interfaces are not components, so they are returned apart (`types`):
// an import of one is correct code, and the gate must not say it does not exist. A default
// export is left out, whose import name is the importer's choice.
import ts from "typescript";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, join, relative } from "node:path";
import fg from "fast-glob";

/**
 * The names the gate checks against the component list, and so the only names
 * the list needs to hold. One predicate for both, so they cannot disagree:
 * a capitalised constant such as TOAST_TYPE is checked by the gate, so it has
 * to be readable here.
 */
export const canBeComponentName = (name) => /^[A-Z]/.test(name);

/** A declaration file: .d.ts, .d.mts or .d.cts. */
export const DECLARATION_FILE = /\.d\.[mc]?ts$/;

const scriptKindOf = (fileName) =>
  /\.tsx$/i.test(fileName) ? ts.ScriptKind.TSX
    : /\.jsx$/i.test(fileName) ? ts.ScriptKind.JSX
    : /\.[mc]?js$/i.test(fileName) ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;

const modifiersOf = (node) => (ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []);
const has = (node, kind) => modifiersOf(node).some((m) => m.kind === kind);
const exportedHere = (node) => has(node, ts.SyntaxKind.ExportKeyword) && !has(node, ts.SyntaxKind.DefaultKeyword);

// Every identifier a binding pattern declares: `{ A, B: C, ...rest }` and `[A, [B]]`.
function bindingNames(pattern, into = []) {
  if (ts.isIdentifier(pattern)) {
    into.push(pattern.text);
  } else {
    for (const el of pattern.elements) if (ts.isBindingElement(el)) bindingNames(el.name, into);
  }
  return into;
}

// The value members an `export =` namespace holds. In a declaration file every member of an
// ambient namespace is exported, with or without the keyword.
function namespaceMembers(body) {
  const out = [];
  if (!body || !ts.isModuleBlock(body)) return out;
  for (const st of body.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) out.push(...bindingNames(d.name));
    } else if (
      (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) ||
        (ts.isModuleDeclaration(st) && ts.isIdentifier(st.name))) &&
      st.name
    ) {
      out.push(st.name.text);
    } else if (ts.isImportEqualsDeclaration(st) && has(st, ts.SyntaxKind.ExportKeyword) && !st.isTypeOnly) {
      out.push(st.name.text);   // `export import Q = X.Y`
    }
  }
  return out;
}

/**
 * Every value name one file exports, and the modules it re-exports wholesale.
 * `unlisted` holds the export forms whose names this reader cannot list (an `export =` of
 * something other than a namespace declared in the file), so a caller can say a list is
 * not complete instead of trusting it.
 * @returns {{ names: string[], types: string[], stars: string[], typeStars: string[], unlisted: string[] }}
 *   names and types sorted; stars (and the type-only ones, `export type * from`) in source order. `types` are the types and interfaces it exports.
 */
export function exportedNames(source, fileName = "index.d.ts") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, scriptKindOf(fileName));
  const names = new Set();
  const stars = [];
  const typeStars = [];
  const values = new Set();
  const typesOnly = new Set();
  const exportedTypes = new Set();
  const listed = [];
  const unlisted = [];
  const namespaces = new Map();
  const exportEquals = [];

  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        for (const name of bindingNames(d.name)) {
          values.add(name);
          if (exportedHere(st)) names.add(name);
        }
      }
    } else if (
      (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) ||
        (ts.isModuleDeclaration(st) && ts.isIdentifier(st.name))) &&
      st.name
    ) {
      values.add(st.name.text);
      if (exportedHere(st)) names.add(st.name.text);
      if (ts.isModuleDeclaration(st)) namespaces.set(st.name.text, [...(namespaces.get(st.name.text) ?? []), ...namespaceMembers(st.body)]);
    } else if (ts.isImportDeclaration(st)) {
      // `import type { X }` brings in a type: listing it in `export { X }` is not a value.
      const clause = st.importClause;
      if (clause) {
        if (clause.isTypeOnly && clause.name) typesOnly.add(clause.name.text);
        const bound = clause.namedBindings;
        if (bound && ts.isNamespaceImport(bound) && clause.isTypeOnly) typesOnly.add(bound.name.text);
        if (bound && ts.isNamedImports(bound)) {
          for (const el of bound.elements) if (clause.isTypeOnly || el.isTypeOnly) typesOnly.add(el.name.text);
        }
      }
    } else if (ts.isImportEqualsDeclaration(st)) {
      // `export import A = B.C`
      if (has(st, ts.SyntaxKind.ExportKeyword) && !st.isTypeOnly) names.add(st.name.text);
    } else if (ts.isExpressionStatement(st) && ts.isBinaryExpression(st.expression) && st.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      // CommonJS: `module.exports = { A }`, `exports.A = A`. What it exports is not listed by this reader.
      const target = st.expression.left.getText(sf);
      if (/^(?:module\.)?exports(?:[.[]|$)/.test(target) && !unlisted.includes(target)) unlisted.push(target);
    } else if (ts.isExpressionStatement(st) && ts.isCallExpression(st.expression)) {
      // The other CommonJS forms a bundler writes: esbuild's `__export(target, { A: () => A })` and
      // `Object.defineProperty(exports, "A", ...)`. They export names this reader does not list.
      const callee = st.expression.expression.getText(sf);
      const first = st.expression.arguments[0]?.getText(sf);
      const what = callee === "__export" ? "__export(...)"
        : callee === "Object.defineProperty" && (first === "exports" || first === "module.exports") ? `Object.defineProperty(${first}, ...)`
        : null;
      if (what && !unlisted.includes(what)) unlisted.push(what);
    } else if (ts.isExportAssignment(st)) {
      if (st.isExportEquals) exportEquals.push(st.expression);   // `export = Foo`; `export default` is left out
    } else if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) {
      typesOnly.add(st.name.text);
      if (exportedHere(st)) exportedTypes.add(st.name.text);
    } else if (ts.isExportDeclaration(st)) {
      const from = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
      if (!st.exportClause) {
        if (from) (st.isTypeOnly ? typeStars : stars).push(from); // export * from "./x"; export type * from "./x" brings types only
      } else if (ts.isNamespaceExport(st.exportClause)) {
        if (st.isTypeOnly) exportedTypes.add(st.exportClause.name.text);
        else names.add(st.exportClause.name.text);        // export * as X from "./x"
      } else {
        for (const el of st.exportClause.elements) {
          if (st.isTypeOnly || el.isTypeOnly) {           // export type { X }, export { type X }
            exportedTypes.add(el.name.text);
            continue;
          }
          listed.push({ name: el.name.text, local: (el.propertyName ?? el.name).text, here: !from });
        }
      }
    }
  }
  // `export { ButtonProps }` of an interface declared in this file is a type, not a value.
  for (const { name, local, here } of listed) {
    if (here && typesOnly.has(local) && !values.has(local)) {
      exportedTypes.add(name);
      continue;
    }
    names.add(name);
  }
  for (const expression of exportEquals) {
    if (ts.isIdentifier(expression) && namespaces.has(expression.text)) {
      for (const name of namespaces.get(expression.text)) names.add(name);
    } else {
      unlisted.push(`export = ${expression.getText(sf)}`);
    }
  }
  return { names: [...names].sort(), types: [...exportedTypes].sort(), stars, typeStars, unlisted };
}

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * The declaration file a relative re-export points at. A declaration written for
 * Node's ESM resolution names the JavaScript file (`./button.js`), so the
 * extension is swapped for its declaration twin as TypeScript does.
 */
export function resolveDeclarationSpecifier(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  const stem = base.replace(/\.(?:[mc]?[jt]s|[jt]sx)$/, "");
  const twin = { ".js": ".d.ts", ".mjs": ".d.mts", ".cjs": ".d.cts" }[base.slice(stem.length)];
  const candidates = [
    ...(DECLARATION_FILE.test(base) ? [base] : []),
    ...(twin ? [`${stem}${twin}`] : []),
    `${base}.d.ts`, `${base}.d.mts`, `${base}.d.cts`,
    join(base, "index.d.ts"), join(base, "index.d.mts"), join(base, "index.d.cts"),
  ];
  return candidates.find(isFile) ?? null;
}

/**
 * The component names reachable from declaration entries, following every
 * relative `export * from`. Entries already reached from an earlier entry are
 * not walked again, and are left out of `roots`, so a caller can write only the
 * entries that add something.
 *
 * What it could not read is returned too, so a list is never trusted past what was
 * read: `unfollowed` is each `export *` whose target is not a declaration file it can
 * open (a file that is not built, a package, a TypeScript source), and `unlisted` is
 * each export form whose names cannot be listed. `files` is every file that was read. Their names are kept, and the
 * `export * from './Button'` guess still adds Button.
 *
 * There is no depth cap. The seen set ends a cycle, and a file is read once however
 * it is reached, so the result cannot depend on the order the walk meets files in.
 * The walk is a loop and not a recursion, so a long chain cannot overflow the stack.
 * @param {string[]} entries absolute paths
 * @param {{ tolerant?: boolean }} [options] `tolerant`: an entry that cannot be opened is reported in `unfollowed`, not thrown
 * @returns {{ names: string[], types: string[], roots: string[], files: string[],
 *             unfollowed: { spec: string, from: string }[], unlisted: { what: string, from: string }[] }}
 */
export function declarationComponents(entries, { tolerant = false } = {}) {
  const names = new Set();
  const types = new Set();
  // A file is read once as values and once as types: what a type-only star reaches is read for its types alone,
  // and the same file reached by a value star later is still read as values.
  const seen = new Set();
  const seenAsTypes = new Set();
  const roots = [];
  const unfollowed = [];
  const unlisted = [];
  const walk = (start) => {
    const pending = [{ file: start, typeOnly: false }];
    seen.add(start);
    while (pending.length > 0) {
      const { file, typeOnly } = pending.pop();
      let read;
      try {
        read = exportedNames(readFileSync(file, "utf8"), file);
      } catch (err) {
        if (typeOnly) continue; // nothing in a type-only file is a component, so it cannot leave the list incomplete
        // An entry that cannot be opened is the caller's to report (it throws), unless the caller says it will
        // read what it can. A declaration the entry reaches that cannot be opened leaves the list incomplete,
        // and does not stop the others.
        if (file === start && !tolerant) throw err;
        unfollowed.push({ spec: file, from: file, kind: "unreadable", reason: whyFile(err) });
        continue;
      }
      if (typeOnly) {
        for (const name of [...read.names, ...read.types]) types.add(name);
      } else {
        for (const name of read.names) if (canBeComponentName(name)) names.add(name);
        for (const name of read.types) types.add(name);
        for (const what of read.unlisted) unlisted.push({ what, from: file });
      }
      const follow = (spec, asTypes) => {
        const next = resolveDeclarationSpecifier(file, spec);
        const mark = asTypes ? seenAsTypes : seen;
        if (next && !mark.has(next)) {
          mark.add(next);
          pending.push({ file: next, typeOnly: asTypes });
        }
        return next;
      };
      for (const spec of read.stars) {
        if (typeOnly) {
          follow(spec, true);
          continue;
        }
        // As the older reader does: `export * from './Button'` names a Button module, and its
        // name is a component's even when the file is not there to read.
        const leaf = spec.split("/").pop().replace(/\.(?:[mc]?js|d\.[mc]?ts)$/, "");
        if (/^[A-Z][A-Za-z0-9]*$/.test(leaf)) names.add(leaf);
        if (!follow(spec, false)) unfollowed.push({ spec, from: file });
      }
      // `export type * from`: only types are behind it, so it is followed for them and never makes the list partial.
      for (const spec of read.typeStars) follow(spec, true);
    }
  };
  for (const entry of entries) {
    if (seen.has(entry)) continue;
    roots.push(entry);
    walk(entry);
  }
  return { names: [...names].sort(), types: [...types].sort(), roots, files: [...new Set([...seen, ...seenAsTypes])], unfollowed, unlisted };
}

const SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"];

// The file in `read` a relative re-export points at, as a bundler would find it: the path as
// written, with an extension added, with a `.js` written for ESM swapped for the source file's
// own, or a folder's index. Null when it is none of the files that were read.
function resolveSourceSpecifier(fromFile, spec, read) {
  const base = resolve(dirname(fromFile), spec);
  const stem = base.replace(/\.[mc]?jsx?$/, "");
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => `${base}.${ext}`),
    ...(stem !== base ? SOURCE_EXTENSIONS.map((ext) => `${stem}.${ext}`) : []),
    ...SOURCE_EXTENSIONS.map((ext) => join(base, `index.${ext}`)),
  ];
  return candidates.find((candidate) => read.has(candidate)) ?? null;
}

const SCRIPT_FILE = /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;
const NOT_SOURCE = /(?:\.(?:test|spec|stories|story)\.[^/]+$|\.d\.[mc]?ts$|(?:^|\/)__(?:tests|mocks|stories)__\/)/;

// Every symlink under `dir`, relative to it: to a folder (a glob does not follow them and says nothing, so the
// files behind one are not read, and are reported), and to a script file (also dropped by a glob, and read here).
// A link to nothing is neither.
function symlinks(dir, sub = "") {
  const found = { folders: [], files: [], unreadable: [] };
  let entries;
  try {
    entries = readdirSync(join(dir, sub), { withFileTypes: true });
  } catch (err) {
    found.unreadable.push({ rel: sub === "" ? "." : sub, reason: whyFile(err) });
    return found;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const rel = sub ? `${sub}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      try {
        const target = statSync(join(dir, rel));
        if (target.isDirectory()) found.folders.push(rel);
        else if (target.isFile() && SCRIPT_FILE.test(rel) && !NOT_SOURCE.test(rel)) found.files.push(rel);
      } catch {
        // a link to nothing is not a component file
      }
    } else if (entry.isDirectory()) {
      const inner = symlinks(dir, rel);
      found.folders.push(...inner.folders);
      found.files.push(...inner.files);
      found.unreadable.push(...inner.unreadable);
    }
  }
  return found;
}

// Why a file could not be opened, in words a person can act on.
export const whyFile = (err) =>
  err?.code === "EACCES" || err?.code === "EPERM" ? "permission denied" : String(err?.message ?? err).split("\n")[0];

/**
 * The component names a folder of source exports: every script file in it, at
 * any depth, tests, stories and declaration files aside. Each file is a module
 * an app imports by path (`@/components/ui/button`), so each one is read, with
 * or without an index.
 *
 * What was not read is returned as well, so the list is never trusted past it. A relative
 * `export *` that resolves to a file in the folder is covered, because that file is read in
 * its own right. Every other `export *` is in `unfollowed`: a package, a path that leaves the
 * folder, one that does not resolve, one that names a file the folder leaves out. So is every
 * symlinked folder inside it (`kind: "symlink"`). `unlisted` is each export form whose names
 * cannot be listed.
 * @param {string} dir absolute path
 * @returns {{ names: string[], unfollowed: { spec: string, from: string, kind?: "symlink" | "unreadable", reason?: string }[],
 *             unlisted: { what: string, from: string }[] }}
 */
export function folderComponents(dir) {
  if (!statSync(dir).isDirectory()) throw new Error("it is not a folder");
  const files = fg
    .sync("**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}", {
      cwd: dir,
      absolute: true,
      dot: false,
      followSymbolicLinks: false,
      suppressErrors: true, // a folder it cannot open is reported by the walk below, not thrown
      ignore: [
        "**/node_modules/**",
        "**/*.{test,spec,stories,story}.*",
        "**/__tests__/**",
        "**/__mocks__/**",
        "**/__stories__/**",
        "**/*.d.{ts,mts,cts}",
      ],
    })
    .sort();
  const links = symlinks(dir);
  files.push(...links.files.map((rel) => join(dir, rel)));
  files.sort();
  const read = new Set(files);
  const names = new Set();
  const types = new Set();
  const unfollowed = [];
  const unlisted = [];
  for (const file of files) {
    let exported;
    try {
      exported = exportedNames(readFileSync(file, "utf8"), file);
    } catch (err) {
      // One file that cannot be opened leaves the list incomplete. It does not hide the others.
      unfollowed.push({ spec: relative(dir, file), from: dir, kind: "unreadable", reason: whyFile(err) });
      continue;
    }
    for (const name of exported.names) if (canBeComponentName(name)) names.add(name);
    for (const name of exported.types) types.add(name);
    for (const what of exported.unlisted) unlisted.push({ what, from: file });
    for (const spec of exported.stars) {
      if (!spec.startsWith(".") || !resolveSourceSpecifier(file, spec, read)) unfollowed.push({ spec, from: file });
    }
  }
  for (const { rel, reason } of links.unreadable) unfollowed.push({ spec: rel, from: dir, kind: "unreadable", reason });
  for (const rel of links.folders.sort()) unfollowed.push({ spec: rel, from: dir, kind: "symlink" });
  return { names: [...names].sort(), types: [...types].sort(), unfollowed, unlisted };
}

/**
 * One configured component source, read: a folder of source, or a declaration entry and
 * what it re-exports. A directory whose name ends like a declaration file is not a folder
 * of components: reading it fails, as a file would. A file that is neither a declaration
 * file nor a folder (a `.ts` barrel, say) is refused: its exports cannot be listed without
 * following its imports into source, and a part of a list is not the list.
 * @returns {{ names: string[], types: string[], unfollowed: { spec: string, from: string, kind?: "symlink" | "unreadable", reason?: string }[],
 *             unlisted: { what: string, from: string }[] }}
 */
export function readComponentSource(abs) {
  if (!DECLARATION_FILE.test(abs)) {
    if (existsSync(abs) && statSync(abs).isDirectory()) return folderComponents(abs);
    throw new Error("it is neither a type declaration file (.d.ts, .d.mts, .d.cts) nor a folder of components");
  }
  const { names, types, unfollowed, unlisted } = declarationComponents([abs]);
  return { names, types, unfollowed, unlisted };
}
