// Every type declaration entry a manifest names. Modelled on three shapes real systems ship:
// subpath entries only, with no root (a system whose components were all missed); a root
// entry plus utility subpaths that the root does not re-export; and a package whose
// declarations come from its build and are not there yet.
import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { typesEntries } from "../../src/readers/types-entries.mjs";

const pkg = (manifest, files = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "u-entries-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
};
const read = (dir) => {
  const r = typesEntries(dir, JSON.parse(readFileSync(join(dir, "package.json"), "utf8")));
  return { entries: r.entries.map((abs) => abs.slice(dir.length + 1)), missing: r.missing };
};

test("a package with subpath entries and no root: every subpath's types", () => {
  const dir = pkg(
    {
      name: "@acme/subpaths",
      exports: {
        "./button": { types: "./dist/button/index.d.ts", import: "./dist/button/index.js" },
        "./toast": { import: { types: "./dist/toast/index.d.mts", default: "./dist/toast/index.mjs" } },
        "./styles/*": "./dist/styles/*.css",
        "./package.json": "./package.json",
      },
    },
    { "dist/button/index.d.ts": "", "dist/toast/index.d.mts": "" }
  );
  expect(read(dir)).toEqual({ entries: ["dist/button/index.d.ts", "dist/toast/index.d.mts"], missing: [] });
});

test("a root entry and the subpaths it does not re-export", () => {
  const dir = pkg(
    {
      name: "@acme/kit",
      types: "types/index.d.ts",
      exports: {
        ".": { types: "./types/index.d.ts", import: "./es/index.js" },
        "./utils": { types: "./types/utils.d.ts", import: "./es/utils.js" },
        "./app": { types: "./types/app.d.ts", import: "./es/app.js" },
      },
    },
    { "types/index.d.ts": "", "types/utils.d.ts": "", "types/app.d.ts": "" }
  );
  expect(read(dir).entries).toEqual(["types/index.d.ts", "types/utils.d.ts", "types/app.d.ts"]);
});

test("the declaration twin of a JavaScript target counts when it is there", () => {
  const dir = pkg(
    { name: "@acme/twin", exports: { ".": "./dist/index.js", "./card": { import: "./dist/card.mjs" } } },
    { "dist/index.d.ts": "", "dist/card.d.mts": "" }
  );
  expect(read(dir).entries).toEqual(["dist/index.d.ts", "dist/card.d.mts"]);
});

test("a pattern entry: the declarations its pattern matches", () => {
  const dir = pkg(
    { name: "@acme/star", exports: { "./*": { types: "./dist/*/index.d.ts" } } },
    { "dist/button/index.d.ts": "", "dist/card/index.d.ts": "", "dist/card/index.js": "" }
  );
  expect(read(dir).entries.sort()).toEqual(["dist/button/index.d.ts", "dist/card/index.d.ts"]);
});

test("declared types that are not on disk are reported as missing, each once however it is written", () => {
  const dir = pkg({
    name: "@acme/unbuilt",
    types: "types/index.d.ts",
    exports: { ".": { types: "./types/index.d.ts" }, "./button": { types: "./types/button.d.ts" } },
  });
  expect(read(dir)).toEqual({ entries: [], missing: ["types/index.d.ts", "types/button.d.ts"] });
});

test("subpath JavaScript targets that are not built: their declaration twins are missing", () => {
  const dir = pkg({ name: "@acme/js-unbuilt", exports: { "./accordion": "./dist/accordion/index.js", "./badge": "./dist/badge/index.mjs" } });
  expect(read(dir)).toEqual({ entries: [], missing: ["dist/accordion/index.d.ts", "dist/badge/index.d.mts"] });
});

test("a built JavaScript target with no twin is not missing: the package ships no types for it", () => {
  const dir = pkg({ name: "@acme/js-only", exports: { ".": "./index.js" } }, { "index.js": "" });
  expect(read(dir)).toEqual({ entries: [], missing: [] });
});

test("with nothing declared, the conventional places are tried", () => {
  const dir = pkg({ name: "@acme/plain" }, { "dist/index.d.ts": "" });
  expect(read(dir).entries).toEqual(["dist/index.d.ts"]);
});

test("a types condition that is itself a set of conditions is read", () => {
  const dir = pkg(
    {
      name: "@acme/nested",
      exports: {
        ".": { types: { import: "./dist/i.d.mts", require: "./dist/r.d.cts" }, default: "./dist/index.js" },
      },
    },
    { "dist/i.d.mts": "", "dist/r.d.cts": "" }
  );
  expect(read(dir)).toEqual({ entries: ["dist/i.d.mts", "dist/r.d.cts"], missing: [] });
});

test("an entry that lists fallbacks reads every one, not the first", () => {
  const dir = pkg(
    { name: "@acme/fallbacks", exports: { "./card": [{ types: "./a.d.ts" }, { types: "./b.d.ts" }] } },
    { "a.d.ts": "", "b.d.ts": "" }
  );
  expect(read(dir).entries).toEqual(["a.d.ts", "b.d.ts"]);
});

test("a declared types path whose JavaScript is not built is not also reported through its twin", () => {
  // types exists, import (./es/index.js) does not: the twin es/index.d.ts is not a missing declaration.
  const dir = pkg(
    { name: "@acme/types-first", exports: { ".": { types: "./types/index.d.ts", import: "./es/index.js" } } },
    { "types/index.d.ts": "" }
  );
  expect(read(dir)).toEqual({ entries: ["types/index.d.ts"], missing: [] });
});

test("a types field that names a folder or a source file is not an entry, and not missing either", () => {
  const folder = pkg({ name: "@acme/folder", types: "dist" }, { "dist/index.d.ts": "" });
  expect(read(folder)).toEqual({ entries: ["dist/index.d.ts"], missing: [] });
  const source = pkg({ name: "@acme/source", types: "src/index.ts", exports: { ".": { types: "./src/index.ts" } } }, { "src/index.ts": "" });
  expect(read(source)).toEqual({ entries: [], missing: [] });
});

test("a pattern entry does not walk a nested node_modules, and a symlink loop does not run away", () => {
  const dir = pkg(
    { name: "@acme/walk", exports: { "./*": { types: "./dist/*/index.d.ts" } } },
    {
      "dist/button/index.d.ts": "",
      "dist/node_modules/other/button/index.d.ts": "",
    }
  );
  symlinkSync(".", join(dir, "dist/loop"));
  symlinkSync(join(dir, "dist"), join(dir, "dist/button/up"));
  expect(read(dir).entries).toEqual(["dist/button/index.d.ts"]);
});

test("a pattern entry matches folders whose names have glob characters in them", () => {
  const dir = pkg(
    { name: "@acme/brackets", exports: { "./*": { types: "./dist/[locale]/(group)/*/index.d.ts" } } },
    { "dist/[locale]/(group)/card/index.d.ts": "", "dist/l/group/card/index.d.ts": "" }
  );
  expect(read(dir).entries).toEqual(["dist/[locale]/(group)/card/index.d.ts"]);
});

test("a literal entry with brackets in its path is found", () => {
  const dir = pkg({ name: "@acme/lit", types: "dist/[id]/index.d.ts" }, { "dist/[id]/index.d.ts": "" });
  expect(read(dir)).toEqual({ entries: ["dist/[id]/index.d.ts"], missing: [] });
});

test("a pattern that begins or ends with the star is read (nothing to escape on that side)", () => {
  const dir = pkg(
    { name: "@acme/edge", exports: { "./*": { types: "./*.d.ts" }, "./all/*": { types: "./all/*" } } },
    { "button.d.ts": "", "all/card.d.ts": "", "all/card.js": "" }
  );
  expect(read(dir).entries.sort()).toEqual(["all/card.d.ts", "button.d.ts"]);
});

// ------------------------------------------------------------------ typesVersions, and a subpath's declaration

import { declarationForSubpath } from "../../src/readers/types-entries.mjs";

const subpath = (manifest, files, sub) => {
  const dir = pkg(manifest, files);
  const found = declarationForSubpath(dir, manifest, sub);
  return found === null ? null : found.slice(dir.length + 1);
};

test("typesVersions: each target it names is an entry, a pattern's matches included, and none is called missing", () => {
  const dir = pkg(
    {
      name: "@acme/versions",
      types: "index.d.ts",
      typesVersions: { "*": { extra: ["dist/extra.d.ts"], "legacy/*": ["ts3/*"], gone: ["dist/gone.d.ts"] } },
    },
    { "index.d.ts": "", "dist/extra.d.ts": "", "ts3/a.d.ts": "", "ts3/b.d.ts": "" }
  );
  const got = read(dir);
  expect(got.entries.sort()).toEqual(["dist/extra.d.ts", "index.d.ts", "ts3/a.d.ts", "ts3/b.d.ts"]);
  expect(got.missing).toEqual([]);
});

describe("the declaration file a subpath resolves to", () => {
  test("a package with no exports map: the path as a declaration file, or as a folder's index", () => {
    const files = { "index.d.ts": "", "dist/extra.d.ts": "", "dist/tools/index.d.ts": "", "dist/mod.d.mts": "" };
    const manifest = { name: "@acme/plain", types: "index.d.ts" };
    expect(subpath(manifest, files, "dist/extra")).toBe("dist/extra.d.ts");
    expect(subpath(manifest, files, "dist/extra.d.ts")).toBe("dist/extra.d.ts");
    expect(subpath(manifest, files, "dist/extra.js")).toBe("dist/extra.d.ts");
    expect(subpath(manifest, files, "dist/tools")).toBe("dist/tools/index.d.ts");
    expect(subpath(manifest, files, "dist/mod")).toBe("dist/mod.d.mts");
    expect(subpath(manifest, files, "dist/absent")).toBe(null);
  });

  test("typesVersions maps it, an exact path before a pattern, and a path it does not map is the file", () => {
    const manifest = { name: "@acme/versions", types: "index.d.ts", typesVersions: { ">=4.2": { "*": ["ts4/*"], special: ["other/special.d.ts"] } } };
    const files = { "ts4/extra.d.ts": "", "other/special.d.ts": "", "ts4/special.d.ts": "" };
    expect(subpath(manifest, files, "extra")).toBe("ts4/extra.d.ts");
    expect(subpath(manifest, files, "special")).toBe("other/special.d.ts");
  });

  test("with an exports map the map decides: an exact key, a pattern, and nothing for a path it does not name", () => {
    const manifest = {
      name: "@acme/mapped",
      exports: { ".": { types: "./index.d.ts" }, "./toast": { types: "./dist/toast.d.ts" }, "./parts/*": { types: "./dist/parts/*.d.ts" } },
    };
    const files = { "index.d.ts": "", "dist/toast.d.ts": "", "dist/parts/card.d.ts": "", "dist/hidden.d.ts": "" };
    expect(subpath(manifest, files, "toast")).toBe("dist/toast.d.ts");
    expect(subpath(manifest, files, "parts/card")).toBe("dist/parts/card.d.ts");
    expect(subpath(manifest, files, "dist/hidden")).toBe(null);
    expect(subpath(manifest, files, "parts/absent")).toBe(null);
  });

  test("a mapped target that is not built does not resolve", () => {
    expect(subpath({ name: "@acme/unbuilt", exports: { "./toast": { types: "./dist/toast.d.ts" } } }, {}, "toast")).toBe(null);
  });
});
