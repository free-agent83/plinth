import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Missing } from "./missing";
import { Missing as BarrelMissing } from "../../index";

test("renders a declared gap with the data attributes that mark it in the DOM", () => {
  render(<Missing what="DateRangePicker" reason="single-date Calendar only" />);
  const note = screen.getByRole("note");
  expect(note).toHaveAttribute("data-undrift-missing", "DateRangePicker");
  expect(note).toHaveAttribute("data-undrift-reason", "single-date Calendar only");
  expect(note).toHaveAttribute("data-slot", "missing");
  expect(note).toHaveTextContent("MISSING: DateRangePicker");
});

test("names the gap and its reason for assistive tech", () => {
  render(<Missing what="Rating" reason="no rating component exists" />);
  expect(screen.getByRole("note")).toHaveAccessibleName(
    "Missing from design system: Rating. no rating component exists"
  );
});

test("a caller's className cannot dim, hide, recolour, or strip the contract attributes", () => {
  render(
    <Missing
      what="Rating"
      reason="no rating component exists"
      className="hidden border-solid border-border bg-card text-foreground"
      data-testid="wrapper"
    />
  );
  const note = screen.getByRole("note");
  // The loud styling survives untouched.
  expect(note).toHaveClass("border-dashed", "border-gap-border", "bg-gap-subtle", "text-gap");
  expect(note).not.toHaveClass("hidden", "border-solid", "border-border", "bg-card", "text-foreground");
  // The contract attributes survive untouched too.
  expect(note).toHaveAttribute("data-slot", "missing");
  expect(note).toHaveAttribute("data-undrift-missing", "Rating");
  expect(note).toHaveAttribute("data-undrift-reason", "no rating component exists");
  expect(note).toHaveAccessibleName(/Missing from design system: Rating/);
  // The hostile classes landed on the wrapper, not on the note element.
  const wrapper = screen.getByTestId("wrapper");
  expect(wrapper).toHaveClass("hidden");
  expect(note).not.toBe(wrapper);
});

test("className and other div props land on an outer wrapper, not on the contract element", () => {
  render(<Missing what="Rating" reason="no rating component exists" className="col-span-2" data-testid="wrapper" />);
  const wrapper = screen.getByTestId("wrapper");
  expect(wrapper.className).toBe("col-span-2");
  const note = screen.getByRole("note");
  expect(note.parentElement).toBe(wrapper);
  expect(note.className).not.toContain("col-span-2");
});

test("is exported from the package barrel, so a product that installs only @plinth/components can render it", () => {
  expect(BarrelMissing).toBe(Missing);
});
