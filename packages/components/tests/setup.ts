// Shared Vitest setup for component tests.
// Vitest runs with `globals: false` (see vitest.config.ts), so React Testing
// Library's auto-cleanup (which only registers when a global `afterEach`
// exists) does NOT fire. Without an explicit cleanup, multiple renders in one
// test file leak mounted nodes and `getByRole` throws "multiple elements".
// Registering cleanup once here keeps every component test isolated without
// each file repeating `afterEach(cleanup)`.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
