/**
 * Copied into your repo by `undrift init`. You own this file. Edit it freely.
 *
 * Renders where the design system genuinely cannot serve. Deliberately ugly:
 * functional enough to keep the layout honest, unmistakable enough that it can
 * never be shipped by accident. `undrift gate` counts these via the
 * data-undrift-missing attribute; `undrift gate --strict` fails on them.
 */
export function Missing({
  what,
  reason,
  height = 34,
}: {
  what: string;
  reason: string;
  height?: number | string;
}) {
  return (
    <div
      data-undrift-missing={what}
      data-undrift-reason={reason}
      title={reason}
      role="note"
      aria-label={`Missing from design system: ${what}. ${reason}`}
      style={{
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "2px dashed #D4537E",
        color: "#993556",
        font: "500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace",
        letterSpacing: "0.04em",
        background:
          "repeating-linear-gradient(45deg, rgba(212,83,126,0.10) 0 7px, transparent 7px 14px)",
      }}
    >
      MISSING: {what}
    </div>
  );
}
