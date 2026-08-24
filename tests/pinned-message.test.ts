import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  classifyUpdateKey,
  isGroupEditable,
  normalizePhase,
  type LifecyclePhase,
} from '../shared/editability';
import { isPinnableMessageId } from '../shared/pinnedMessage';

/**
 * Kevin, 2026-08-23: "I also want the Pool manager to be able to PIN a message
 * to the top of the Pool home page, right below the score ticker." — plus the
 * move of the Pool Feed card up beside Pool Standings ("The bottom of the page
 * is useless").
 *
 * The storage decision is the interesting part and is what most of this file
 * guards. The pin is `pool.pinnedMessageId`, NOT a `pinned` flag on the message:
 *
 *  - `pools/{id}/messages` keeps `allow update: if false`, which is deliberate —
 *    a post can be removed but never silently rewritten under its author's name.
 *    A `pinned` key would have needed a rules exception carved into exactly that
 *    invariant.
 *  - "Exactly one pinned at a time" becomes a property of the data. One field
 *    holds one id, so pinning a second necessarily unpins the first and there is
 *    no second writer to race.
 *  - The write goes through `updatePoolSettings`, because the pool document's
 *    CLIENT update rule carries `poolIsEditable()` (DRAFT/OPEN only) — a direct
 *    `updateDoc` would fail in the middle of a locked season, which is precisely
 *    when a commissioner wants to pin something.
 */
const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const card = read('src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx');
const bento = read('src/components/NFLPoolDashboard/NFLUserBentoDashboard.tsx');
const dash = read('src/components/NFLPoolDashboard/NFLPoolDashboard.tsx');
const feed = read('src/components/NFLPoolDashboard/BanterFeed.tsx');
const band = read('src/components/NFLPoolDashboard/PinnedMessageBand.tsx');
const dbService = read('src/services/dbService.ts');
const rules = read('firestore.rules');

describe('the pin is editable in every phase, because pinning is an in-season act', () => {
  const PHASES: LifecyclePhase[] = ['draft', 'open', 'locked', 'archived'];

  it('classifies pinnedMessageId as its own group', () => {
    expect(classifyUpdateKey('pinnedMessageId')).toBe('announcement');
  });

  it('is editable in draft, open, locked AND archived', () => {
    for (const phase of PHASES) {
      expect(isGroupEditable(phase, 'announcement')).toBe(true);
    }
  });

  it('a locked pool is where this matters — money groups stay frozen there', () => {
    // Discriminating: the new group is not a blanket unlock of the locked phase.
    expect(isGroupEditable('locked', 'announcement')).toBe(true);
    expect(isGroupEditable('locked', 'entryFee')).toBe(false);
    expect(isGroupEditable('locked', 'payouts')).toBe(false);
    expect(isGroupEditable('locked', 'settings')).toBe(false);
  });

  it('a mid-season NFL pool normalizes to a phase the pin is allowed in', () => {
    expect(isGroupEditable(normalizePhase({ isLocked: true }), 'announcement')).toBe(true);
    expect(isGroupEditable(normalizePhase({ status: 'OPEN' }), 'announcement')).toBe(true);
  });
});

describe('the id is a PATH SEGMENT, so it is validated at both ends (codex r1 [P2])', () => {
  it('accepts a Firestore auto-id and the empty unpin value', () => {
    expect(isPinnableMessageId('aBcD1234EfGh5678IjKl')).toBe(true);
    expect(isPinnableMessageId('')).toBe(true);
    expect(isPinnableMessageId('msg_123-abc')).toBe(true);
  });

  it('refuses anything that would make doc() throw', () => {
    // A slash is the dangerous one: `doc(db, 'pools', id, 'messages', 'a/b')`
    // throws SYNCHRONOUSLY, inside the effect every member of the pool runs.
    expect(isPinnableMessageId('a/b')).toBe(false);
    expect(isPinnableMessageId('..')).toBe(false);
    expect(isPinnableMessageId({ id: 'x' })).toBe(false);
    expect(isPinnableMessageId(null)).toBe(false);
    expect(isPinnableMessageId(undefined)).toBe(false);
    expect(isPinnableMessageId(123)).toBe(false);
    expect(isPinnableMessageId('x'.repeat(201))).toBe(false);
  });

  it('the pool page runs a stored value through the same check before subscribing', () => {
    expect(dash).toContain('isPinnableMessageId(rawPinnedId) ? rawPinnedId :');
  });
});

describe('the message subcollection is untouched', () => {
  it('still refuses UPDATE, which is why the pin lives on the pool doc', () => {
    expect(rules).toMatch(/match \/messages\/\{messageId\} \{[\s\S]{0,3000}?allow update: if false;/);
  });

  it('no `pinned` field is written to a message anywhere', () => {
    for (const src of [card, bento, dash, feed, band, dbService]) {
      expect(src).not.toContain('pinned: true');
    }
  });
});

describe('the commissioner pins, and only the commissioner sees the control', () => {
  it('the control is on the commissioner card, next to the delete it already had', () => {
    expect(card).toContain('onTogglePin={handleTogglePin}');
    expect(card).toContain('canPin');
  });

  it('the member card asks for neither control', () => {
    expect(bento).not.toContain('canPin');
    expect(bento).not.toContain('canDelete');
  });

  it('BanterFeed renders the pin only when asked', () => {
    expect(feed).toContain('{canPin && m.id && (');
    expect(feed).toContain('canPin = false,');
  });

  it('the same button unpins — one control, both directions', () => {
    expect(feed).toContain("onTogglePin?.(isPinned ? '' : m.id!)");
  });

  it('writes through the callable, never a direct pool-doc update', () => {
    expect(card).toContain("dbService.updatePoolSettings(pool.id, { pinnedMessageId: messageId })");
    // The CALL, not the word: the handler's own comment names `updateDoc` to
    // explain why it is not used, and a bare substring check fails on the
    // explanation of its own fix.
    expect(card).not.toContain('updateDoc(');
  });
});

describe('the band renders below the ticker, for members, and never lies', () => {
  it('sits directly after the score ticker', () => {
    const ticker = bento.indexOf('<NFLGameTicker');
    const pinned = bento.indexOf('<PinnedMessageBand');
    // 2026-08-23 mobile redesign: the sidebar column died and the bento's
    // outer grid became the two-column card grid. Same invariant, new anchor.
    const grid = bento.indexOf('<div className="grid grid-cols-1 md:grid-cols-2');
    expect(ticker).toBeGreaterThan(-1);
    expect(pinned).toBeGreaterThan(ticker);
    expect(pinned).toBeLessThan(grid);
  });

  it('is gated on membership, exactly as the feed is', () => {
    expect(bento).toContain('{isPoolMember && <PinnedMessageBand');
  });

  it('renders nothing when nothing is pinned, and says so when the read FAILED', () => {
    expect(band).toContain('if (!message) return null;');
    expect(band).toContain('could not be loaded right now');
  });

  it('watches the pinned post as its own doc, so it survives falling off the 50-message feed', () => {
    expect(dbService).toContain('subscribeToPinnedMessage:');
    expect(dash).toContain('dbService.subscribeToPinnedMessage(');
  });

  it('a stale snapshot cannot render under a newly-changed pin', () => {
    // The id is carried WITH the message in state, and compared on render.
    expect(dash).toContain('const pinnedMessage = pinned.id === pinnedMessageId ? pinned.message : null;');
  });
});

describe('the feed card moved up beside Pool Standings', () => {
  it('is no longer rendered at the bottom of the dashboard tab', () => {
    expect(dash).not.toContain('<BanterFeed');
  });

  it('sits between Pool Standings and the radar card in the bento', () => {
    const standings = bento.indexOf('CARD D: POOL STANDINGS');
    const poolFeed = bento.indexOf('CARD D2: POOL FEED');
    const radar = bento.indexOf('CARD E: MY PERFORMANCE RADAR');
    expect(standings).toBeGreaterThan(-1);
    expect(poolFeed).toBeGreaterThan(standings);
    expect(poolFeed).toBeLessThan(radar);
  });

  it("spans both columns only where Pool Standings already has a neighbour", () => {
    // Pick'em renders card A full-width then D, leaving the column beside Pool
    // Standings empty — that gap is where Kevin asked the feed to go. Survivor
    // (B+D) and Margin (C+D) fill that row already, so an un-spanned feed would
    // just move the hole one row down.
    expect(bento).toContain("_pool.type === 'NFL_PICKEM' ? '' : 'md:col-span-2'");
  });
});
