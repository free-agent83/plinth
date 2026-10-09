import { MARK_SIZE, renderMark } from "@/app/lib/mark";
import { PRODUCT } from "@/app/lib/product";

// The example product's tab icon, drawn from PRODUCT so that its letter is written once (product.ts).
export const size = MARK_SIZE;
export const contentType = "image/png";

export default function Icon() {
  return renderMark(PRODUCT.initial);
}
