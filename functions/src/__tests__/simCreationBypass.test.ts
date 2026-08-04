import { describe, it, expect } from 'vitest';
import { simCreationBypassAllowed } from '../lib/systemGuards';

const SIM_PAYLOAD = { season: 'sim-run-abc123-xy', simRunId: 'run-abc123-xy' };
const REAL_PAYLOAD = { season: '2026' };

describe('simCreationBypassAllowed', () => {
    it('SUPER_ADMIN + sim payload = bypass (the E2E path)', () => {
        expect(simCreationBypassAllowed('SUPER_ADMIN', SIM_PAYLOAD)).toBe(true);
        expect(simCreationBypassAllowed('SUPER_ADMIN', { season: 'sim-x' })).toBe(true);
        expect(simCreationBypassAllowed('SUPER_ADMIN', { simRunId: 'run-1' })).toBe(true);
    });

    it('non-admin with a FORGED sim payload gets NO bypass — the role leg is server-verified', () => {
        expect(simCreationBypassAllowed('USER', SIM_PAYLOAD)).toBe(false);
        expect(simCreationBypassAllowed('MANAGER', SIM_PAYLOAD)).toBe(false);
        expect(simCreationBypassAllowed('BANNED', SIM_PAYLOAD)).toBe(false);
        expect(simCreationBypassAllowed(undefined, SIM_PAYLOAD)).toBe(false);
    });

    it('SUPER_ADMIN creating a REAL pool gets NO bypass — the kill-switch still binds the operator', () => {
        expect(simCreationBypassAllowed('SUPER_ADMIN', REAL_PAYLOAD)).toBe(false);
        expect(simCreationBypassAllowed('SUPER_ADMIN', {})).toBe(false);
        expect(simCreationBypassAllowed('SUPER_ADMIN', null)).toBe(false);
    });

    it('the array-forged season from the nflFinalize incident does not pass isSimPool', () => {
        expect(simCreationBypassAllowed('SUPER_ADMIN', { season: ['sim-x'] as unknown as string })).toBe(false);
    });
});
