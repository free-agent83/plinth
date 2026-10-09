// packages/undrift/src/readers/package-folder.mjs
// Where a bare specifier in a declaration file points, as Node finds it: from the real directory of the
// file that names it, through the `node_modules` of each directory above, nearest first. The same answer
// is used by `init`, which writes the entries of a package a list re-exports, and by the contract, which
// decides whether a list that re-exports a package has that package's entries in it, so the two cannot
// disagree about where a package is. A package that a package manager links in (pnpm) is found through its
// link, and a second copy of a package nested under another (a version conflict) is the one the file sees.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { declarationForSubpath } from "./types-entries.mjs";

const realOr = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** `@acme/card/toast` is `{ name: "@acme/card", sub: "toast" }`. Null for a relative or absolute path. */
export function splitSpecifier(spec) {
  if (spec.startsWith(".") || spec.startsWith("/")) return null;
  const parts = spec.split("/");
  const size = spec.startsWith("@") ? 2 : 1;
  if (parts.length < size || parts.slice(0, size).some((part) => part === "")) return null;
  return { name: parts.slice(0, size).join("/"), sub: parts.slice(size).join("/") };
}

/**
 * The folder of the package a bare specifier names, seen from `fromFile`.
 * @returns {{ name: string, sub: string, dir: string, real: string } | null}
 *   `dir` is where it was found, which may be a link, and `real` is that folder with links resolved.
 */
export function packageFolder(fromFile, spec) {
  const parsed = splitSpecifier(spec);
  if (!parsed) return null;
  let at = dirname(realOr(fromFile));
  for (;;) {
    const dir = join(at, "node_modules", parsed.name);
    if (isDirectory(dir)) return { ...parsed, dir, real: realOr(dir) };
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

// Inside a folder, and not inside a package of its own that is nested in it.
const inside = (dir, file) => {
  const rel = relative(dir, file);
  return !rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes("node_modules");
};

/** A package's manifest, or an empty one when it is not there or does not parse. */
function manifestOf(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Is a bare specifier that a component source re-exports (`export * from "@acme/card"`) covered by the
 * entries listed in componentsFrom? A package is covered by any other listed entry inside its folder, compared
 * after links are resolved and never by an entry of a package nested in it, and never by a name that merely
 * starts the same. A subpath (`@acme/card/dist/extra`) is covered only when the declaration file it resolves
 * to is itself listed, and is not covered when it does not resolve to one. A source never covers its own
 * re-export.
 * @param {string} spec
 * @param {string} from the file that re-exports it
 * @param {string[]} listed absolute paths of every listed entry
 * @param {string} reading the listed entry whose reading found it
 */
export function coveredByListed(spec, from, listed, reading) {
  const found = packageFolder(from, spec);
  if (!found) return false;
  const own = realOr(reading);
  const others = listed.map(realOr).filter((entry) => entry !== own);
  if (found.sub === "") return others.some((entry) => inside(found.real, entry));
  if (!existsSync(found.dir)) return false;
  const file = declarationForSubpath(found.dir, manifestOf(found.dir), found.sub);
  return file !== null && others.includes(realOr(file));
}
