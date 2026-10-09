import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

// Tooltips open on hover/focus with a delay, and jsdom can't drive that reliably,
// so the real hover→show is in the Storybook `play`. Here we assert the closed
// state (trigger present, content absent) and the forced-open state.
test("closed by default: trigger renders, content is absent", () => {
  render(
    <Tooltip>
      <TooltipTrigger>Help</TooltipTrigger>
      <TooltipContent>Saves your changes</TooltipContent>
    </Tooltip>
  );
  expect(screen.getByRole("button", { name: "Help" })).toHaveAttribute(
    "data-slot",
    "tooltip-trigger"
  );
  expect(screen.queryByText("Saves your changes")).toBeNull();
});

test("defaultOpen renders the portalled tooltip content", () => {
  render(
    <Tooltip defaultOpen>
      <TooltipTrigger>Help</TooltipTrigger>
      <TooltipContent>Saves your changes</TooltipContent>
    </Tooltip>
  );
  // Radix injects a visually-hidden a11y copy of the label too, so scope to our
  // own data-slot element rather than matching the (duplicated) text globally.
  const tip = document.querySelector('[data-slot="tooltip-content"]');
  expect(tip).not.toBeNull();
  expect(tip).toHaveTextContent("Saves your changes");
});
