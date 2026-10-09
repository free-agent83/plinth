import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";

// jsdom never fires an <img> load, so Radix keeps showing the fallback, which
// makes this the natural state to assert here. The image-loaded path is visual.
test("shows the fallback when the image has not loaded", () => {
  render(
    <Avatar>
      <AvatarImage src="/nope.png" alt="Ada Lovelace" />
      <AvatarFallback>AL</AvatarFallback>
    </Avatar>
  );
  const fb = screen.getByText("AL");
  expect(fb).toHaveAttribute("data-slot", "avatar-fallback");
  expect(fb.closest('[data-slot="avatar"]')).not.toBeNull();
});

test("forwards className on the root", () => {
  render(
    <Avatar className="h-16 w-16" data-testid="a">
      <AvatarFallback>AL</AvatarFallback>
    </Avatar>
  );
  const root = screen.getByTestId("a");
  expect(root).toHaveClass("h-16", "w-16");
  expect(root).toHaveAttribute("data-slot", "avatar");
});
