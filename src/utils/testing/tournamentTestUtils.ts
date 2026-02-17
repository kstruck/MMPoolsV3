/**
 * Tournament Test Utilities
 * 
 * Reusable functions for loading and managing tournament test data.
 * Used by the Tournament Simulator and other test pages.
 */

import { getFirestore, doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { generateTournament2025, revealRound } from './data/tournament2025';
import type { Tournament } from '../../types';

/**
 * Load the 2025 NCAA tournament data to Firestore.
 * All games will be in SCHEDULED status (no results revealed).
 * 
 * @param tournamentId - Firestore document ID for the tournament (default: 'mens-2025')
 * @returns The loaded tournament object
 */
export async function loadTournament2025(tournamentId: string = 'mens-2025'): Promise<Tournament> {
    const db = getFirestore();
    const tournament = generateTournament2025();

    await setDoc(doc(db, 'tournaments', tournamentId), tournament);

    console.log(`[TournamentTestUtils] Loaded 2025 tournament to Firestore: ${tournamentId}`);
    return tournament;
}

/**
 * Load the tournament progressed to a specific round.
 * All games up to and including the specified round will have results revealed.
 * 
 * @param round - Round number (1-6) to reveal up to
 * @param tournamentId - Firestore document ID for the tournament (default: 'mens-2025')
 * @returns The tournament with specified rounds revealed
 */
export async function loadTournamentAtRound(round: number, tournamentId: string = 'mens-2025'): Promise<Tournament> {
    if (round < 1 || round > 6) {
        throw new Error('Round must be between 1 and 6');
    }

    const db = getFirestore();
    let tournament = generateTournament2025();

    // Reveal all rounds up to the specified round
    for (let r = 1; r <= round; r++) {
        tournament = revealRound(tournament, r);
    }

    await setDoc(doc(db, 'tournaments', tournamentId), tournament);

    console.log(`[TournamentTestUtils] Loaded tournament at Round ${round} to Firestore: ${tournamentId}`);
    return tournament;
}

/**
 * Clear tournament data from Firestore.
 * 
 * @param tournamentId - Firestore document ID to delete (default: 'mens-2025')
 */
export async function clearTournament(tournamentId: string = 'mens-2025'): Promise<void> {
    const db = getFirestore();
    await deleteDoc(doc(db, 'tournaments', tournamentId));

    console.log(`[TournamentTestUtils] Cleared tournament from Firestore: ${tournamentId}`);
}

/**
 * Get the current tournament from Firestore.
 * 
 * @param tournamentId - Firestore document ID to retrieve (default: 'mens-2025')
 * @returns The tournament object, or null if not found
 */
export async function getCurrentTournament(tournamentId: string = 'mens-2025'): Promise<Tournament | null> {
    const db = getFirestore();
    const docSnap = await getDoc(doc(db, 'tournaments', tournamentId));

    if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() } as Tournament;
    }

    console.log(`[TournamentTestUtils] Tournament not found: ${tournamentId}`);
    return null;
}

/**
 * Check if a tournament exists in Firestore.
 * 
 * @param tournamentId - Firestore document ID to check (default: 'mens-2025')
 * @returns True if tournament exists, false otherwise
 */
export async function tournamentExists(tournamentId: string = 'mens-2025'): Promise<boolean> {
    const db = getFirestore();
    const docSnap = await getDoc(doc(db, 'tournaments', tournamentId));
    return docSnap.exists();
}
