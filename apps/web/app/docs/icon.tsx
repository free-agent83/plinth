import { MARK_SIZE, renderMark } from "@/app/lib/mark";

// Plinth's tab icon for the docs at /docs: the monogram the docs wordmark carries (plinth-wordmark.tsx), not the
// example product's. A segment's icon replaces the one above it, so /docs does not show the product's mark.
export const size = MARK_SIZE;
export const contentType = "image/png";

export default function Icon() {
  return renderMark("P");
}
