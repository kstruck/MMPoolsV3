import { describe, it, expect } from "vitest";
import { isAdminCloseTransition, isTerminalStatus, ADMIN_CLOSE } from "../lib/lifecycle";

describe("isAdminCloseTransition — trigger guard predicate", () => {
  it("true only on the transition INTO admin-close", () => {
    expect(isAdminCloseTransition({}, { closedVia: ADMIN_CLOSE })).toBe(true);
    expect(isAdminCloseTransition({ closedVia: undefined }, { closedVia: ADMIN_CLOSE })).toBe(true);
  });
  it("false when already admin-closed (no re-fire on later updates)", () => {
    expect(isAdminCloseTransition({ closedVia: ADMIN_CLOSE }, { closedVia: ADMIN_CLOSE })).toBe(false);
  });
  it("false for normal locks / game completions (no closedVia)", () => {
    expect(isAdminCloseTransition({ isLocked: false } as never, { isLocked: true } as never)).toBe(false);
    expect(isAdminCloseTransition({}, {})).toBe(false);
    expect(isAdminCloseTransition(undefined, undefined)).toBe(false);
  });
});

describe("isTerminalStatus", () => {
  it("CANCELED and COMPLETED are terminal", () => {
    expect(isTerminalStatus("CANCELED")).toBe(true);
    expect(isTerminalStatus("COMPLETED")).toBe(true);
  });
  it("open/live states are not terminal", () => {
    for (const s of ["OPEN", "LOCKED", "LIVE", undefined, null, ""]) {
      expect(isTerminalStatus(s)).toBe(false);
    }
  });
});
