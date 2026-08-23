import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * PLAN-WIZARD-BUYFLOW-FIXES T9 — the AI Commissioner is real, visible and
 * manageable.
 *
 * Kevin's report: "I still do not see the AI features working. I see draft only
 * — not saved… users do not know what to do on that card… commissioners must be
 * able to delete any message… where are these messages shown to members?"
 *
 * The behaviour is unit-tested in `functions/src/__tests__/banter.test.ts`,
 * `src/components/NFLPoolDashboard/BanterFeed.test.ts` and the emulator suite
 * `functions/scripts/banterMessages.rules.test.mjs`. What cannot be reached
 * from any of those is the wiring — and the entire defect WAS wiring: a card
 * that talked to nothing.
 */

const repoRoot = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

const card = read('src/components/NFLPoolDashboard/NFLManagerBentoDashboard.tsx');
const dash = read('src/components/NFLPoolDashboard/NFLPoolDashboard.tsx');
const dbService = read('src/services/dbService.ts');
const ai = read('functions/src/aiCommissioner.ts');
const rules = read('firestore.rules');

describe('1. the feed is persisted, not component state', () => {
    it('the card subscribes instead of holding an array of strings', () => {
        expect(card).not.toContain('useState<string[]>([])');
        expect(card).toContain('dbService.subscribeToPoolFeed(');
    });

    it('the honest "not saved" label is gone because it is no longer true', () => {
        expect(card).not.toContain('Draft only');
        expect(card).not.toContain('local to this browser tab');
    });

    it('a commissioner post is a real write with the author bound to their uid', () => {
        // firestore.rules binds authorUid to request.auth.uid; a client that
        // sent anything else would simply be denied.
        expect(card).toContain('dbService.sendBanterMessage(pool.id, {');
        expect(card).toContain('authorUid: _user.id,');
        expect(card).toContain("kind: 'COMMISSIONER',");
    });
});

describe('2. the mood buttons and prompt reach the REAL pipeline', () => {
    it('the card asks through ai_requests, the same door every other category uses', () => {
        expect(card).toContain('dbService.requestAIBanter(pool.id, _user.id, prompt, aiMood)');
        expect(dbService).toContain("category: 'BANTER',");
        expect(dbService).toContain('collection(db, `pools/${poolId}/ai_requests`)');
    });

    it('there is no SECOND route to the paid provider', () => {
        // PLAN-COST-CONTROLS 0.5 closed the extra doors. BANTER is handled
        // inside onAIRequest, AFTER its entitlement gate, not in a new trigger.
        expect(ai).toContain("if (requestData.category === 'BANTER') {");
        expect(ai).toContain('await generateBanter({');
        const entitlement = ai.indexOf("if (!poolRaw.billing?.featuresUnlocked?.aiCommissioner) {");
        const banterBranch = ai.indexOf("if (requestData.category === 'BANTER') {");
        expect(entitlement).toBeGreaterThan(-1);
        expect(banterBranch).toBeGreaterThan(entitlement);
    });

    it('a redelivered event neither double-spends nor double-posts (codex r2 [P2])', () => {
        // onDocumentCreated can deliver twice, and the event PAYLOAD is the
        // original document — so `requestData.status` is still PENDING on every
        // redelivery. The fresh read runs BEFORE the provider call; the
        // deterministic id means a race overwrites rather than appends.
        // A plain re-read is not enough: two overlapping deliveries both read
        // PENDING and both call Gemini. The request is CLAIMED in a transaction
        // before the provider is touched (codex r3 [P2]).
        expect(ai).toContain('const claim = await db.runTransaction(async (txn) => {');
        expect(ai).toContain("txn.update(requestRef, { status: 'GENERATING', updatedAt: Date.now() });");
        expect(ai).toContain("if (claim !== 'CLAIMED') {");
        // ...and the claim happens BEFORE the provider call, not after.
        expect(ai.indexOf('const claim = await db.runTransaction'))
            .toBeLessThan(ai.indexOf('await generateAIResponse(BANTER_SYSTEM_PROMPT'));
        expect(ai).toContain('doc(`banter-${requestRef.id}`)');
    });

    it('generated banter lands in the member-readable feed', () => {
        expect(ai).toContain("poolRef.collection('messages').doc(");
        expect(ai).toContain("kind: 'AI',");
    });

    it('the standings facts are mapped, not invented (codex r3 [P1])', () => {
        // The projection's field names are type-specific and none is the
        // obvious one. Mapping invented keys sent Gemini all-nulls, and with
        // the no-hallucination rule that leaves it nothing to say.
        expect(ai).toContain('banterStandingsRow(r, poolType)');
        expect(ai).not.toContain('r.displayName ?? r.name');
        const banter = read('functions/src/lib/banter.ts');
        expect(banter).toContain("typeof row?.totalScore === 'number'");
        expect(banter).toContain("typeof row?.seasonTotal === 'number'");
        expect(banter).toContain("typeof row?.userName === 'string'");
    });

    it('the AI gets its own prompt, not the dispute-resolution one', () => {
        // COMMISSIONER_SYSTEM_PROMPT's whole job is neutrality and "show the
        // math"; asking it for trash talk produces a referee reading a scoreboard.
        expect(ai).toContain('BANTER_SYSTEM_PROMPT');
        const gemini = read('functions/src/gemini.ts');
        expect(gemini).toContain('export const BANTER_SYSTEM_PROMPT');
        expect(gemini).toContain('**PLAY, NOT PEOPLE.**');
        expect(gemini).toContain('**NO HALLUCINATIONS.**');
    });
});

describe('2b. only a COMMISSIONER can make the AI post pool-wide (codex r1 [P1])', () => {
    it('generateBanter refuses a non-commissioner before spending', () => {
        // ai_requests create is participant-scoped — correctly, a dispute is a
        // member's to ask. BANTER is different in kind: the result is published
        // to everyone under the AI Commissioner's identity.
        expect(ai).toContain('if (!isPoolCommissionerUid(poolRaw, requestData.userId, callerRole)) {');
        expect(ai).toContain("error: 'BANTER_NOT_COMMISSIONER'");
    });

    it('the four ai_requests create conditions are UNTOUCHED', () => {
        // Enforced in the function rather than by widening that rule: its
        // conditions are load-bearing and category-blind, and a per-category
        // branch in a security rule is what gets "simplified" later. It also
        // stops the SPEND, which a rule would not if a write landed another way.
        expect(rules).toContain('request.resource.data.userId == request.auth.uid');
        expect(rules).toContain(".get('aiCommissioner', false) == true");
        expect(rules).toMatch(/match \/ai_requests\/\{[\s\S]{0,1800}?allow update, delete: if false;/);
    });

    it('the predicate matches the rules delete set, co-managers included', () => {
        const banter = read('functions/src/lib/banter.ts');
        expect(banter).toContain('export function isPoolCommissionerUid');
        expect(banter).toContain("const NFL = ['NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'];");
    });
});

describe('3. members actually see it', () => {
    it('the feed renders on the pool homepage Overview, not only in the manager view', () => {
        expect(dash).toContain('<BanterFeed');
        expect(dash).toContain('dbService.subscribeToPoolFeed(');
    });

    it('one component renders both views, so they cannot drift', () => {
        expect(card).toContain("import { BanterFeed } from './BanterFeed';");
        expect(dash).toContain("import { BanterFeed } from './BanterFeed';");
    });

    it('the feed is gated on MEMBERSHIP, not merely being signed in (codex r1 [P2])', () => {
        // On a public pool a signed-in non-member would subscribe, be denied by
        // `isPoolParticipant()`, and be shown a permanent load error for a feed
        // they were never entitled to read.
        expect(dash).toContain('{isPoolMember && (');
        expect(dash).toContain('castPool.participantIds.includes(user.id)');
        // ...mirroring ALL FOUR of isPoolParticipant()'s branches (codex r4
        // [P2]): an owner or legacy manager absent from participantIds, and a
        // super admin, are authorized to read the feed, and a narrower client
        // gate would hide it from exactly the people the backend lets in.
        expect(dash).toContain('castPool.ownerId === user.id');
        expect(dash).toContain('castPool.managerUid === user.id');
        expect(dash).toContain('isSuperAdmin(user)');
        expect(dash).toContain('if (!pool?.id || !isPoolMember) return;');
    });

    it('the legacy bracket chat writer sends the field the rule binds on', () => {
        // PRE-EXISTING break found by codex reviewing T9: BanterBoard only ever
        // wrote userId/userName, and `authorUid == request.auth.uid` was already
        // required at origin/main — so every send from that board was denied.
        const board = read('src/components/BracketPoolDashboard/BanterBoard.tsx');
        expect(board).toContain('authorUid: user.id,');
        expect(board).toContain('userId: user.id,');
    });

    it('a failed read is not rendered as an empty feed', () => {
        // onSnapshot TERMINATES a listener on error, so "nothing posted yet"
        // for a permission failure is permanent and wrong.
        expect(dbService).toContain('if (onError) onError(error); else callback([]);');
        expect(card).toContain('() => setFeedError(true),');
        expect(dash).toContain('() => setPoolFeedError(true),');
    });
});

describe('4. the commissioner can delete any message', () => {
    it('the card offers it and the service performs it', () => {
        expect(card).toContain('onDelete={handleDeleteBanter}');
        expect(dbService).toContain('deletePoolMessage: async (poolId: string, messageId: string)');
    });

    it('the rule allows DELETE for commissioners and still forbids UPDATE', () => {
        // Removable, never silently rewritable under its author's name.
        expect(rules).toMatch(/match \/messages\/\{messageId\} \{[\s\S]{0,3000}?allow update: if false;/);
        expect(rules).toMatch(/match \/messages\/\{messageId\} \{[\s\S]{0,3200}?allow delete: if request\.auth != null/);
    });

    it('the create rule gained the participant check and refuses kind: AI', () => {
        expect(rules).toMatch(/match \/messages\/\{messageId\} \{[\s\S]{0,3000}?isPoolParticipant\(\)/);
        expect(rules).toContain("&& request.resource.data.kind != 'AI'");
        // codex r2 [P1]: the byline may not claim the AI identity either.
        expect(rules).toContain("request.resource.data.get('authorName', '') != 'AI Commissioner'");
    });

    it('the feed ordering key is bound to request time (codex r4 [P2])', () => {
        // The feed sorts on `timestamp` desc, so a client-controlled value is a
        // client-controlled POSITION.
        expect(rules).toContain('request.resource.data.timestamp <= request.time.toMillis() + 60000');
    });

    it('the legacy bracket input is capped to match the rule', () => {
        // Otherwise pasting over the cap fails with permission-denied and the
        // catch only logs — a send that silently does nothing.
        const board = read('src/components/BracketPoolDashboard/BanterBoard.tsx');
        expect(board).toContain('maxLength={2000}');
        expect(board).toContain('setSendError(');
    });

    it('ai_artifacts is NOT given a blanket write to make deletion work', () => {
        // The plan is explicit: a delete path on the feed, never a write door on
        // the artifact store.
        expect(rules).toMatch(/match \/ai_artifacts\/\{docId\} \{[\s\S]{0,120}?allow write: if false;/);
    });
});

describe('4b. BANTER does not leak into the member AI panel', () => {
    it('but the card SURFACES a failed request (codex r5 [P2])', () => {
        // Filtering BANTER out of the AI panel removed the only status
        // listener, so a failed generation left the commissioner with an
        // optimistic toast and nothing else. The card watches its own now.
        expect(dbService).toContain('subscribeToMyBanterRequests:');
        expect(card).toContain('dbService.subscribeToMyBanterRequests(pool.id, _user.id,');
        expect(card).toContain("lastBanterRequest?.status === 'ERROR'");
        expect(card).toContain("lastBanterRequest?.status === 'GENERATING'");
    });

    it('authority is revalidated inside the claim, against a FRESH pool read', () => {
        // Document triggers run asynchronously, so ownership or a
        // co-commissioner assignment can be revoked between the snapshot and
        // the write — and the thing authorized is a pool-wide message.
        expect(ai).toContain('const freshPool = await txn.get(poolRef);');
        expect(ai).toContain('if (!isPoolCommissionerUid(freshPool.data(), requestData.userId, callerRole)) {');
    });

    it('the AI tab filters its own request history', () => {
        // Those are the commissioner's trash-talk prompts, not questions this
        // panel asked; listing them would show a commissioner their own prompts
        // in their dispute history.
        expect(read('src/components/AICommissioner.tsx')).toContain("filter(r => r.category !== 'BANTER')");
    });
});

describe('5. the card explains itself', () => {
    it('says what the input does and who sees the result', () => {
        expect(card).toContain('Type your own message, or describe what the AI should write');
        expect(card).toContain('Everyone in your pool sees this');
        expect(card).toContain('AI tone');
    });

    it('offers the two actions separately instead of one ambiguous Send', () => {
        expect(card).toContain('Post as me');
        expect(card).toContain('Let AI write it');
    });

    it('says plainly when AI is not switched on, without blocking the human path', () => {
        expect(card).toContain('AI Commissioner is not switched on for this pool');
        // The POST button must not be gated on the entitlement — the
        // commissioner's own words cost nothing.
        expect(card).toContain('disabled={!banterText.trim() || banterBusy !== null}');
    });
});
