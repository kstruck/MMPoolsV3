# Test Generation Checklist

## Pre-Generation
- [ ] Run `python skills/skill-frontend-tester/scripts/test_planner.py {component}`
- [ ] Identify mocks needed (APIs, Navigation)
- [ ] DO NOT mock base components (Button, Loading, etc.)

## Testing Strategy
- [ ] **Incremental:** One file at a time.
- [ ] **Props:** Test required, optional, and defaults.
- [ ] **Edge Cases:** Null, undefined, empty arrays.
- [ ] **Async:** Use `findBy` or `waitFor`, never bare assertions.

## Code Quality
- [ ] Use `mockedApi.fetchData.mockResolvedValue` in `beforeEach`.
- [ ] Reset mocks with `vi.clearAllMocks()`.
- [ ] Coverage goal: 100% function, >95% branch.
