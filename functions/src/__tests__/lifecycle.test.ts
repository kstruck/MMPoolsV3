import { describe, it, expect } from "vitest";
import { isAdminCloseTransition, isTerminalStatus, ADMIN_CLOSE, adminCloseUpdate, isAutoCloseEligible } from "../lib/lifecycle";

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

describe("adminCloseUpdate — the shared close write", () => {
  it("dual-writes canonical status + legacy fields + closedVia", () => {
    const u = adminCloseUpdate(1234);
    expect(u.status).toBe("COMPLETED");
    expect(u.isLocked).toBe(true);
    expect(u.isFinal).toBe(true);
    expect(u["scores.gameStatus"]).toBe("post");
    expect(u.closedVia).toBe(ADMIN_CLOSE);
    expect(u.closedAt).toBe(1234);
  });
});

describe("isAutoCloseEligible — conservative sweep predicate", () => {
  it("eligible when event over and not terminal/closed", () => {
    expect(isAutoCloseEligible({ scores: { gameStatus: "post" } })).toBe(true);
    expect(isAutoCloseEligible({ isFinal: true })).toBe(true);
    expect(isAutoCloseEligible({ isFinal: true, status: "OPEN" })).toBe(true);
  });
  it("NOT eligible when active, terminal, or already admin-closed", () => {
    expect(isAutoCloseEligible({ scores: { gameStatus: "in" } })).toBe(false);
    expect(isAutoCloseEligible({ isFinal: false })).toBe(false);
    expect(isAutoCloseEligible({ isFinal: true, status: "CANCELED" })).toBe(false);
    expect(isAutoCloseEligible({ isFinal: true, status: "COMPLETED" })).toBe(false);
    expect(isAutoCloseEligible({ isFinal: true, closedVia: ADMIN_CLOSE })).toBe(false);
    expect(isAutoCloseEligible(null)).toBe(false);
    expect(isAutoCloseEligible({})).toBe(false);
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
