// Gaps are declared absences: the agent could not serve a need from the system
// and said so instead of improvising. Gaps are a SUCCESS state. They never
// fail the dev loop (see spec P3). But they must be honest, so every one is
// verified against the contract: you cannot declare a gap for something that
// already exists.
import ts from "typescript";

/** Is this name present in the contract (as component or token)? */
function existsInSystem(what, contract) {
  if (what?.startsWith("--")) return what in (contract.tokens ?? {});
  return (contract.catalog ?? []).some((c) => c.name === what);
}

/**
 * Verify one gap against the contract.
 *
 * Order matters. The dishonesty check runs first: if the thing already exists,
 * "use Button" is the useful message, and it stays useful whether or not a
 * reason was given. Nagging about a missing reason for a gap that shouldn't
 * exist at all sends the agent off fixing the wrong thing.
 *
 * An *absent* `reason` key is not the same as a blank one. `findGaps` always
 * supplies a string, so anything parsed out of source must still explain
 * itself; a bare `verifyGap({ what })` is the narrower question "is this a
 * legitimate thing to declare a gap for?" and is answered on its own terms.
 */
export function verifyGap(gap, contract) {
  if (!gap.what) return { valid: false, message: "Gap declaration needs a `what`." };
  if (existsInSystem(gap.what, contract)) {
    const kind = gap.what.startsWith("--") ? "Token" : "Component";
    return {
      valid: false,
      message: `${kind} ${gap.what} exists in ${contract.system ?? "the design system"}. Use it rather than declaring a gap.`,
    };
  }
  if (gap.reason !== undefined && !String(gap.reason).trim()) {
    return { valid: false, message: `Gap "${gap.what}" needs a reason. An unexplained gap is indistinguishable from laziness.` };
  }
  return { valid: true };
}

/** Find <Missing what="…" reason="…" /> declarations and verify each. */
export function findGaps(source, { fileName = "input.tsx", contract }) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const gaps = [];

  const attrText = (el, name) => {
    const attr = el.attributes.properties.find(
      (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === name
    );
    if (!attr?.initializer) return null;
    if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
    if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression &&
        ts.isStringLiteralLike(attr.initializer.expression)) {
      return attr.initializer.expression.text;
    }
    return null;
  };

  const visit = (node) => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === "Missing"
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const gap = {
        what: attrText(node, "what"),
        reason: attrText(node, "reason") ?? "",
        file: fileName,
        line: line + 1,
        endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
      };
      gaps.push({ ...gap, ...verifyGap(gap, contract) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return gaps;
}
