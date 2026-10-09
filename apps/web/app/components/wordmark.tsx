// The example product's wordmark: a square monogram plate (the primary role) beside the name, both from
// PRODUCT. Token-only; no raster asset.
import { PRODUCT } from "@/app/lib/product";

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid h-7 w-7 place-items-center rounded-md bg-primary font-mono text-sm font-semibold text-primary-foreground"
      >
        {PRODUCT.initial}
      </span>
      <span className="text-sm font-semibold tracking-tight group-data-[state=collapsed]:sr-only">{PRODUCT.name}</span>
    </span>
  );
}
