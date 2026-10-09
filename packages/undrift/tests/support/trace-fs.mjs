// Preloaded into a hook run (node --import): records every file write and rename to the
// file named in UNDRIFT_TRACE_FS, so a test can see HOW a file was written, and not only
// what ended up in it. A write in place and a write to a temporary name followed by a
// rename leave the same file behind.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const trace = process.env.UNDRIFT_TRACE_FS;
if (trace) {
  // appendFileSync writes through writeFileSync, which is traced below: the guard keeps
  // the trace's own write out of the trace.
  let noting = false;
  const note = (line) => {
    if (noting) return;
    noting = true;
    try {
      fs.appendFileSync(trace, `${line}\n`);
    } finally {
      noting = false;
    }
  };
  const write = fs.writeFileSync;
  const rename = fs.renameSync;
  fs.writeFileSync = function traced(path, ...rest) {
    if (typeof path === "string") note(`write ${path}`);
    return write.call(this, path, ...rest);
  };
  fs.renameSync = function traced(from, to) {
    note(`rename ${from} ${to}`);
    return rename.call(this, from, to);
  };
  // The hook imports these by name, so its bindings are refreshed to the traced ones.
  syncBuiltinESMExports();
}
