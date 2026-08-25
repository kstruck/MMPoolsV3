// @vitest-environment jsdom
//
// The Operations-tab control for `migratePoolPasswords`
// (PLAN-AUDIT-AUTH-HARDENING-SWEEPS.md §S1).
//
// WHY jsdom RATHER THAN `renderToStaticMarkup`. Two of the three properties
// under test are STATE, not markup: the kill-switch refusal only appears after
// a call resolves, and the cursor is only carried after a report arrives.
// `billingGate.test.tsx` documents why the default here is the node environment
// and why a suite buys jsdom only when it must; this is one of those. The
// docblock above is per-file, so nothing else changes.
//
// What is actually guarded:
//  1. The dry-run box starts CHECKED and the first call therefore sends
//     `dryRun: true` — a UI that shipped with it unticked would put a live
//     deletion one click away.
//  2. The kill-switch `skipped` string renders VERBATIM on screen. Step 1 of
//     the arming procedure is a deliberately disarmed call whose whole purpose
//     is to watch the gate refuse; swallowing that into a generic error toast
//     would destroy the evidence the step exists to produce.
//  3. `plannedWrites` reaches the DOM in full. The sweep doc says "if a pool
//     you did not expect appears, stop" — a summarised count cannot be read
//     that way.
//  4. The cursor is carried into the next call, and a null one is reported as
//     the end of the pass rather than silently looking the same.
//  5. A LIVE run is gated behind the typed `RUN` token.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const migratePoolPasswords = vi.fn();
const logAdminAction = vi.fn().mockResolvedValue(undefined);

vi.mock('../firebase', () => ({ auth: {}, db: {}, functions: {} }));
vi.mock('../services/dbService', () => ({
  dbService: {
    migratePoolPasswords: (...args: unknown[]) => migratePoolPasswords(...args),
    logAdminAction: (...args: unknown[]) => logAdminAction(...args),
  },
}));
vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { OperationsPanel } from '../components/admin/OperationsPanel';

/** The card's own run button, whichever mode it is in. */
const runButton = () => screen.getByRole('button', { name: /Run sweep \((dry run|LIVE)\)/i }) as HTMLButtonElement;
const dryRunBox = () => screen.getByLabelText(/Dry run \(writes nothing\)/i) as HTMLInputElement;

/** Click Run, then confirm in the guardrail modal. */
const runAndConfirm = async (confirmName = 'Run sweep') => {
  fireEvent.click(runButton());
  // A plain STRING name is exact-matched by ByRole (a regex is not). The card's own trigger reads "Run sweep (dry run)", which a
  // substring match would also hit — and clicking the trigger instead of the
  // modal's confirm would make every one of these tests pass without the
  // guardrail ever being exercised.
  const confirm = await screen.findByRole('button', { name: confirmName });
  fireEvent.click(confirm);
};

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

beforeEach(() => {
  migratePoolPasswords.mockReset();
  logAdminAction.mockClear();
});

afterEach(() => cleanup());

describe('S1 — pool password migration control', () => {
  it('starts with the dry-run box CHECKED', () => {
    render(<OperationsPanel />);
    expect(dryRunBox().checked).toBe(true);
    expect(runButton().textContent).toMatch(/dry run/i);
  });

  it('sends dryRun:true on the first call and starts at the beginning', async () => {
    migratePoolPasswords.mockResolvedValue({ dryRun: true, poolsScanned: 3, poolsChanged: 0, plannedWrites: [], nextCursor: null });
    render(<OperationsPanel />);
    await runAndConfirm();
    await waitFor(() => expect(migratePoolPasswords).toHaveBeenCalledTimes(1));
    // `startAfter: null` (not a stale cursor) and the schema-legal default page
    // size. The wrapper drops a null cursor before it reaches the wire.
    expect(migratePoolPasswords).toHaveBeenCalledWith({ dryRun: true, limit: 100, startAfter: null });
  });

  it('renders the kill-switch refusal verbatim instead of an error', async () => {
    const skipped = 'kill-switch off (system/config.poolPasswordMigration.enabled !== true)';
    migratePoolPasswords.mockResolvedValue({ skipped, dryRun: true, poolsScanned: 0, poolsChanged: 0 });
    render(<OperationsPanel />);
    await runAndConfirm();

    const panel = await screen.findByTestId('migration-skipped');
    expect(panel.textContent).toContain(skipped);
    expect(panel.textContent).toMatch(/Refused by the kill-switch/i);
    // A refusal is not a report: it must not present itself as a completed page
    // with a cursor status, which is what the next click would resume from.
    expect(screen.queryByTestId('migration-cursor-status')).toBeNull();
  });

  it('shows the whole report, plannedWrites included', async () => {
    migratePoolPasswords.mockResolvedValue({
      dryRun: true,
      poolsScanned: 2,
      poolsChanged: 2,
      hashedPlaintext: 1,
      movedHash: 1,
      dottedFieldsRemoved: 1,
      plannedWrites: [
        { poolId: 'pool-alpha', action: 'hash-plaintext' },
        { poolId: 'pool-beta', action: 'move-hash' },
      ],
      failures: [],
      nextCursor: null,
    });
    render(<OperationsPanel />);
    await runAndConfirm();

    // Every pool id is on screen — this is the "if a pool you did not expect
    // appears, stop" check, and it cannot survive a summarised count.
    await waitFor(() => expect(screen.getByTestId('pool-password-migration').textContent).toContain('pool-alpha'));
    const text = screen.getByTestId('pool-password-migration').textContent!;
    expect(text).toContain('pool-beta');
    expect(text).toContain('hash-plaintext');
    expect(text).toContain('dottedFieldsRemoved');
  });

  it('reports a null cursor as the end of the pass and disables Continue', async () => {
    migratePoolPasswords.mockResolvedValue({ dryRun: true, poolsScanned: 1, poolsChanged: 0, plannedWrites: [], nextCursor: null });
    render(<OperationsPanel />);
    await runAndConfirm();

    const status = await screen.findByTestId('migration-cursor-status');
    expect(status.textContent).toMatch(/nextCursor.*is null/i);
    expect((screen.getByRole('button', { name: /Continue from cursor/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('carries nextCursor into the next call via Continue from cursor', async () => {
    migratePoolPasswords
      .mockResolvedValueOnce({ dryRun: true, poolsScanned: 100, poolsChanged: 4, plannedWrites: [], nextCursor: 'pool-zzz' })
      .mockResolvedValueOnce({ dryRun: true, poolsScanned: 7, poolsChanged: 0, plannedWrites: [], nextCursor: null });
    render(<OperationsPanel />);
    await runAndConfirm();

    const cont = await screen.findByRole('button', { name: /Continue from cursor/i });
    await waitFor(() => expect((cont as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(cont);
    fireEvent.click(await screen.findByRole('button', { name: 'Run next page' }));

    await waitFor(() => expect(migratePoolPasswords).toHaveBeenCalledTimes(2));
    // Kevin never hand-copies the opaque id: the second call resumes from it.
    expect(migratePoolPasswords).toHaveBeenLastCalledWith({ dryRun: true, limit: 100, startAfter: 'pool-zzz' });
  });

  it('refuses to resume a DRY cursor as a LIVE run (codex r1 P1)', async () => {
    migratePoolPasswords.mockResolvedValue({ dryRun: true, poolsScanned: 100, poolsChanged: 4, plannedWrites: [], nextCursor: 'pool-zzz' });
    render(<OperationsPanel />);
    await runAndConfirm();

    const cont = () => screen.getByRole('button', { name: /Continue from cursor/i }) as HTMLButtonElement;
    await waitFor(() => expect(cont().disabled).toBe(false));

    // Unticking mid-pass: resuming here would skip pools 1..100 in the live
    // sweep and leave their plaintext on the public document.
    fireEvent.click(dryRunBox());
    expect(cont().disabled).toBe(true);
    expect(screen.getByTestId('migration-cursor-stale').textContent).toMatch(/can no longer be resumed/i);
    // The cursor itself is still shown — it is the resume that is withheld.
    expect(screen.getByTestId('migration-cursor-status').textContent).toContain('pool-zzz');

    // Re-ticking restores it: the pass and the request agree again.
    fireEvent.click(dryRunBox());
    expect(cont().disabled).toBe(false);
  });

  it('refuses to resume when the server forced the pass dry (codex r1 P1)', async () => {
    // Operator asked for LIVE; `system/config.poolPasswordMigration.dryRun` is
    // still true, so the server ran dry and wrote nothing. Continuing after the
    // config is fixed would resume past pools nothing has touched.
    migratePoolPasswords.mockResolvedValue({ dryRun: true, poolsScanned: 100, poolsChanged: 4, plannedWrites: [], nextCursor: 'pool-zzz' });
    render(<OperationsPanel />);
    fireEvent.click(dryRunBox());
    await runAndConfirm();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'RUN' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Run sweep' }));

    await waitFor(() => expect(screen.queryByTestId('migration-cursor-stale')).not.toBeNull());
    expect(screen.getByTestId('migration-cursor-stale').textContent).toMatch(/forced this pass dry/i);
    expect((screen.getByRole('button', { name: /Continue from cursor/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('caps the page size at the callable plannedWrites limit (codex r1 P2)', async () => {
    render(<OperationsPanel />);
    const limit = screen.getByRole('spinbutton') as HTMLInputElement;
    // 200 is the callable's own plannedWrites cap; a bigger page could change
    // pools the card never lists while telling the operator to read it in full.
    expect(limit.max).toBe('200');
    fireEvent.change(limit, { target: { value: '500' } });
    expect(runButton().disabled).toBe(true);
    fireEvent.change(limit, { target: { value: '200' } });
    expect(runButton().disabled).toBe(false);
  });

  it('gates a LIVE run behind the typed RUN token', async () => {
    migratePoolPasswords.mockResolvedValue({ dryRun: false, poolsScanned: 1, poolsChanged: 1, plannedWrites: [], nextCursor: null });
    render(<OperationsPanel />);
    fireEvent.click(dryRunBox());
    expect(dryRunBox().checked).toBe(false);
    fireEvent.click(runButton());

    const confirm = await screen.findByRole('button', { name: 'Run sweep' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'RUN' } });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(confirm);
    await waitFor(() => expect(migratePoolPasswords).toHaveBeenCalledWith({ dryRun: false, limit: 100, startAfter: null }));
  });

  it('audits every run through logAdminAction', async () => {
    migratePoolPasswords.mockResolvedValue({ dryRun: true, poolsScanned: 1, poolsChanged: 0, plannedWrites: [], nextCursor: null });
    render(<OperationsPanel />);
    await runAndConfirm();
    await waitFor(() => expect(logAdminAction).toHaveBeenCalled());
    expect(logAdminAction.mock.calls[0][0]).toMatchObject({ action: 'OP_MIGRATEPOOLPASSWORDS', status: 'success' });
  });
});
