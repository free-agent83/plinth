import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { PlinthWordmark } from "@/app/components/plinth-wordmark";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { PRODUCT } from "@/app/lib/product";

// Shared chrome for the Fumadocs layouts. The docs carry Plinth's name and link back to the example product,
// and our own ThemeToggle drives the app-wide cookie theme (Fumadocs' toggle is disabled).
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <PlinthWordmark />,
      url: "/docs",
    },
    links: [
      { text: PRODUCT.name, url: "/" },
      {
        type: "custom",
        secondary: true,
        children: <ThemeToggle />,
      },
    ],
  };
}
