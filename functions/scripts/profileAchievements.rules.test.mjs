/**
 * Firestore rules test for publicProfiles + its achievements subcollection
 * (PLAN-PLAYER-PROFILES.md Phase 1; ADR 0005 decision 5).
 *
 * Requires Java (Firestore emulator) + @firebase/rules-unit-testing. Run:
 *
 *   npx firebase emulators:exec --only firestore \
 *     "node functions/scripts/profileAchievements.rules.test.mjs"
 *
 * Verifies:
 *   - anyone (unauthenticated) CAN read a publicProfiles doc
 *   - anyone (unauthenticated) CAN read an achievements doc under it
 *   - no client — not even the subject themself — can write either (Admin SDK only)
 */
import { readFileSync } from 'node:fs';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const PROJECT_ID = 'gridiron-gamble-uzuqo';

const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

const SUBJECT_UID = 'player1';
const OTHER_UID = 'viewer1';

// Seed a profile + an achievement, bypassing rules (as the Admin SDK would).
await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'publicProfiles', SUBJECT_UID), {
        uid: SUBJECT_UID,
        subjectKind: 'PLAYER',
        userName: 'Player One',
        overall: { accuracy: 60, correct: 6, total: 10, points: 6, poolsEntered: 1, seasonsPlayed: 1 },
    });
    await setDoc(doc(db, 'publicProfiles', SUBJECT_UID, 'achievements', 'PERFECT_WEEK_1'), {
        code: 'PERFECT_WEEK',
        title: 'Perfect Week',
        description: 'Went 16-0 in a scored week',
        iconKey: 'trophy',
        earnedAt: 1760000000000,
        schemaVersion: 1,
    });
});

const guest = env.unauthenticatedContext().firestore();
const subject = env.authenticatedContext(SUBJECT_UID).firestore();
const viewer = env.authenticatedContext(OTHER_UID).firestore();

// World-readable: profile + achievement, even unauthenticated.
await assertSucceeds(getDoc(doc(guest, 'publicProfiles', SUBJECT_UID)));
await assertSucceeds(getDoc(doc(guest, 'publicProfiles', SUBJECT_UID, 'achievements', 'PERFECT_WEEK_1')));
await assertSucceeds(getDoc(doc(viewer, 'publicProfiles', SUBJECT_UID)));
await assertSucceeds(getDoc(doc(viewer, 'publicProfiles', SUBJECT_UID, 'achievements', 'PERFECT_WEEK_1')));

// Server-write-only: no client write, not even the subject.
await assertFails(setDoc(doc(subject, 'publicProfiles', SUBJECT_UID), { userName: 'Hax' }, { merge: true }));
await assertFails(setDoc(doc(viewer, 'publicProfiles', SUBJECT_UID), { userName: 'Hax' }, { merge: true }));
await assertFails(setDoc(doc(subject, 'publicProfiles', SUBJECT_UID, 'achievements', 'FAKE'), {
    code: 'FAKE', title: 'Fake', description: 'x', iconKey: 'x', earnedAt: 1, schemaVersion: 1,
}));
await assertFails(setDoc(doc(viewer, 'publicProfiles', SUBJECT_UID, 'achievements', 'FAKE'), {
    code: 'FAKE', title: 'Fake', description: 'x', iconKey: 'x', earnedAt: 1, schemaVersion: 1,
}));

await env.cleanup();
console.log('profileAchievements.rules.test.mjs: ALL ASSERTIONS PASSED');
