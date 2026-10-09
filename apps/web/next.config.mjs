import { createMDX } from "fumadocs-mdx/next";

/** @type {import('next').NextConfig} */
const config = {
  // @plinth/components ships TypeScript source (no build step), so Next transpiles
  // it. Relative internal imports mean no alias config is needed.
  transpilePackages: ["@plinth/components", "@plinth/tokens"],
};

const withMDX = createMDX();

export default withMDX(config);
