import { describe, it, expect } from 'vitest';
import { __resetAdminRegistry, baseRegistry, loadAdminRegistry } from '../src/help/admin';
import { helpRegistry } from '../src/help/registry';

/**
 * The lazy admin help chunk — PLAN-HELP-SYSTEM.md §3 D3, ticket T2.
 *
 * T2 ships the MECHANISM and T14 ships the copy, so the three admin lists are
 * empty today. What is testable now is the contract the panel depends on: the
 * chunk is fetched once, the registry it produces is a complete one rather than
 * a patch applied to the live index, and a cleared cache really does load again
 * — which is what makes the retry-on-open added for codex R8 reachable at all.
 */
describe('loadAdminRegistry', () => {
  it('is memoised — the panel opens many times per session and the chunk is fetched once', async () => {
    __resetAdminRegistry();
    const first = loadAdminRegistry();
    const second = loadAdminRegistry();
    expect(first).toBe(second);
    expect(await first).toBe(await second);
  });

  it('loads again after the cache is cleared, which is what a failed load does', async () => {
    __resetAdminRegistry();
    const first = await loadAdminRegistry();
    __resetAdminRegistry();
    const afterReset = loadAdminRegistry();
    // A NEW promise, not the memoised one — otherwise `loadAdminRegistry`'s own
    // catch block, which clears the cache so a flaky connection can be retried,
    // would be dead code and an admin who lost the chunk once would never get it.
    expect(afterReset).not.toBe(first);
    expect(await afterReset).not.toBe(first);
  });

  it('is a whole registry, validated the same way the base one is', async () => {
    __resetAdminRegistry();
    const admin = await loadAdminRegistry();
    // Every base topic is present: the admin chunk ADDS to the content, it does
    // not replace it, and a reader who is an admin is still a member.
    expect(admin.topics.length).toBeGreaterThanOrEqual(helpRegistry.topics.length);
    for (const topic of helpRegistry.topics) {
      expect(admin.getTopic(topic.id)).toBeDefined();
    }
    expect(admin.glossary.length).toBe(helpRegistry.glossary.length);
  });

  it('is NOT the base registry, so a non-admin cannot be handed admin content by accident', async () => {
    __resetAdminRegistry();
    expect(baseRegistry).toBe(helpRegistry);
    expect(await loadAdminRegistry()).not.toBe(baseRegistry);
  });
});
