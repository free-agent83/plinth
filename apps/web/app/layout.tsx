import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { PRODUCT } from "@/app/lib/product";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: PRODUCT.name,
  description: `${PRODUCT.name}, an example product built on Plinth.`,
};

// Theme is read server-side from a cookie and applied as `.dark` on <html>, so
// the token cascade is correct on first paint with no flash and no client-side
// theme script. The toggle sets the cookie + class; the next render matches.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const dark = (await cookies()).get("theme")?.value === "dark";
  return (
    <html
      lang="en"
      data-theme="default"
      className={`${inter.variable} ${jetbrains.variable}${dark ? " dark" : ""}`}
    >
      <body className="bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  );
}
