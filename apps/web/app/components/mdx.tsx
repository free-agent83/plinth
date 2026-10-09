import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { ComponentPreview } from "./component-preview";

// MDX component map for docs pages. ComponentPreview renders a real, interactive
// @plinth/components example inline. The generated component pages open with one.
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ComponentPreview,
    ...components,
  };
}
