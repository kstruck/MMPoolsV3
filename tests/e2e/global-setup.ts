// Playwright's webServer readiness check only confirms the Firestore emulator
// port (8080) accepts connections — it says nothing about whether the
// Functions emulator has finished loading ~80 functions (heavy imports:
// stripe, @google/genai, etc.) and registered createPool specifically. Hitting
// createPool before that finishes produces a network-level failure (no
// response at all), which the client SDK surfaces as a generic "internal"
// error with zero useful detail. Poll a cheap existing callable
// (getServerTime) until it actually responds before any test runs.
async function waitForFunctionsEmulator(): Promise<void> {
  const url = 'http://127.0.0.1:5001/demo-mmp/us-central1/getServerTime';
  const deadline = Date.now() + 60_000;
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
