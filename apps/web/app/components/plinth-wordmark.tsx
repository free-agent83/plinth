// Plinth's wordmark, the design system's own mark for its docs: a square monogram plate (the primary role) beside
// the name. The example product has a mark of its own (wordmark.tsx). Token-only; no raster asset.
export function PlinthWordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid h-7 w-7 place-items-center rounded-md bg-primary font-mono text-sm font-semibold text-primary-foreground"
      >
        P
      </span>
      <span className="text-sm font-semibold tracking-tight">Plinth</span>
    </span>
  );
}
