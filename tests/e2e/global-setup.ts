// Playwright's webServer readiness check only confirms the Firestore emulator
// port (8080) accepts connections — it says nothing about whether the
// Functions emulator has finished loading ~80 functions (heavy imports:
// stripe, @google/genai, etc.) and registered createPool specifically. Hitting
// createPool before that finishes produces a network-level failure (no
// response at all), which the client SDK surfaces as a generic "internal"
// error with zero useful detail. Poll a cheap existing callable
// (getServerTime) until it actually responds before any test runs.
//
// The deadline is CI-aware. 60s is right on a warm developer machine — measured
// 2026-08-24 in a fresh worktree, the gap this poll must cover (firestore:8080
// accepting -> getServerTime answering 200) was 24.5s on a warm second boot. But
// the FIRST, cold boot in that same worktree blew past 60s and failed here with
// `getServerTime responded 404` — the functions emulator was listening while
// still registering its ~160 functions. A GitHub runner is cold by definition,
// so on CI the deadline is 180s: that turns a startup-speed flake (which would
// keep the non-blocking e2e job from ever earning its flip to required) back
// into what this poll was written to be — a wait, not a race.
async function waitForFunctionsEmulator(): Promise<void> {
  const url = 'http://127.0.0.1:5001/demo-mmp/us-central1/getServerTime';
  const deadline = Date.now() + (process.env.CI ? 180_000 : 60_000);
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {} }),
      });
      if (res.ok) return;
      lastError = new Error(`getServerTime responded ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Functions emulator never became ready: ${lastError}`);
}

export default async function globalSetup(): Promise<void> {
  await waitForFunctionsEmulator();
}
