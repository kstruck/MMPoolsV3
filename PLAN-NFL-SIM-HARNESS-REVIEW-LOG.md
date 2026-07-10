# Plan Review Log: NFL Pool Simulation Harness

Act 1 (grill-with-docs) complete — plan locked, CONTEXT.md updated (Sim Run, Test Pool,
Scenario, Golden Scenario, Scenario Oracle), ADR 0006 created (real-path fidelity via
extracted internals). Six decisions taken with Kevin: NFL-3-deep scope; fidelity split
(golden = real path, bulk = direct write); seeded generator + independent oracle;
full post-score arc + 3 sim-safety gap fixes; emulator CI matrix + prod smoke;
8f legacy migration included bounded. MAX_ROUNDS=5.
