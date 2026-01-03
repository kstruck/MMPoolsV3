// Props Pool Test Simulator
// Creates a props pool, adds test users with prop cards, grades questions, and verifies results

import { getFirestore, doc, collection, addDoc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import type { PropsPool, PropQuestion, PropCard } from '../../../types';

export interface PropsTestResult {
    poolId: string;
    steps: Array<{
        step: string;
        status: 'success' | 'failed' | 'skipped';
        message: string;
        data?: any;
    }>;
}

export interface PropsScenarioSettings {
    name?: string;
    cost?: number;
    maxCards?: number;
    questions?: PropQuestion[];
    testEntries?: Array<{
        userName: string;
        answers: Record<string, number>; // questionId -> selected option index
        tiebreakerVal?: number;
    }>;
    grading?: Record<string, number>; // questionId -> correct option index
    _fullScenario?: any; // From scenario JSON
}

export async function runScenario(
    _scenario: string,
    _mode: 'dry-run' | 'actual' | 'mock',
    settings?: PropsScenarioSettings
): Promise<PropsTestResult> {
    const steps: PropsTestResult['steps'] = [];
    let poolId: string = '';

    const addStep = (step: string, status: 'success' | 'failed' | 'skipped', message: string, data?: any) => {
        steps.push({ step, status, message, data });
        console.log(`${status === 'success' ? '✅' : status === 'failed' ? '❌' : '⏭️'} [PropsTest] [${step}] ${message}`);
    };

    // Extract full scenario if passed
    const scenarioData = settings?._fullScenario || settings;

    try {
        const db = getFirestore();

        // === A. CREATE PROPS POOL ===
        const poolName = settings?.name || `Props Test - ${new Date().toISOString().slice(11, 23)}`;
        addStep('Create Pool', 'success', `Creating props pool: ${poolName}`);

        const questions: PropQuestion[] = scenarioData?.questions || [
            { id: 'q1', text: 'Default Question 1?', options: ['A', 'B', 'C', 'D'], points: 1 },
            { id: 'q2', text: 'Default Question 2?', options: ['Yes', 'No'], points: 1 }
        ];

        const poolData: Partial<PropsPool> = {
            type: 'PROPS',
            name: poolName,
            ownerId: 'test-admin',
            createdAt: Date.now(),
            theme: 'default',
            isLocked: false,
            isPublic: false,
            props: {
                enabled: true,
                cost: settings?.cost || 10,
                maxCards: settings?.maxCards || 3,
                questions: questions
            },
            entryCount: 0
        };

        const poolRef = await addDoc(collection(db, 'pools'), poolData);
        poolId = poolRef.id;
        addStep('Create Pool', 'success', `Pool created with ID: ${poolId}`);

        // === B. ADD TEST ENTRIES (Prop Cards) ===
        const testEntries = scenarioData?.testEntries || [];

        if (testEntries.length > 0) {
            addStep('Add Entries', 'success', `Adding ${testEntries.length} test prop cards...`);

            for (const entry of testEntries) {
                const cardData: PropCard = {
                    userId: `test-${entry.userName.toLowerCase().replace(/\s+/g, '-')}`,
                    userName: entry.userName,
                    cardName: `${entry.userName}'s Card`,
                    purchasedAt: Date.now(),
                    answers: entry.answers,
                    score: 0,
                    tiebreakerVal: entry.tiebreakerVal || 0
                };

                await addDoc(collection(db, 'pools', poolId, 'propCards'), cardData);
            }

            addStep('Add Entries', 'success', `Successfully added ${testEntries.length} prop cards`);
        }

        // === C. GRADE QUESTIONS ===
        const grading = scenarioData?.grading || {};

        if (Object.keys(grading).length > 0) {
            addStep('Grade Questions', 'success', 'Grading questions and calculating scores...');

            // Get current questions
            const poolSnap = await getDoc(doc(db, 'pools', poolId));
            const currentPool = poolSnap.data() as PropsPool;
            const currentQuestions = currentPool.props?.questions || [];

            // Update questions with correct answers
            const updatedQuestions = currentQuestions.map(q => ({
                ...q,
                correctOption: grading[q.id] !== undefined ? grading[q.id] : q.correctOption
            }));

            await updateDoc(doc(db, 'pools', poolId), {
                'props.questions': updatedQuestions
            });

            // Recalculate all card scores
            const cardsSnap = await getDocs(collection(db, 'pools', poolId, 'propCards'));

            for (const cardDoc of cardsSnap.docs) {
                const card = cardDoc.data() as PropCard;
                let score = 0;

                for (const q of updatedQuestions) {
                    if (q.correctOption !== undefined && card.answers[q.id] === q.correctOption) {
                        score += (q.points || 1);
                    }
                }

                await updateDoc(cardDoc.ref, { score });
            }

            addStep('Grade Questions', 'success', `Graded ${Object.keys(grading).length} questions, updated ${cardsSnap.size} cards`);
        }

        // === D. LOCK POOL ===
        await updateDoc(doc(db, 'pools', poolId), { isLocked: true });
        addStep('Lock Pool', 'success', 'Pool locked for final results');

        // === E. VERIFY RESULTS ===
        addStep('Verification', 'success', 'Fetching final pool state for validation...');

        const finalCardsSnap = await getDocs(collection(db, 'pools', poolId, 'propCards'));
        const cards = finalCardsSnap.docs.map(d => ({ id: d.id, ...d.data() } as PropCard & { id: string }));

        // Sort by score descending, then by tiebreaker
        cards.sort((a, b) => {
            const scoreDiff = (b.score || 0) - (a.score || 0);
            if (scoreDiff !== 0) return scoreDiff;
            // Lower tiebreaker wins (closest to actual)
            return (a.tiebreakerVal || 0) - (b.tiebreakerVal || 0);
        });

        const totalScore = cards.reduce((sum, c) => sum + (c.score || 0), 0);
        addStep('Verification', 'success', `Found ${cards.length} prop cards with total score: ${totalScore}`);

        const leaderboard = cards.map((c, i) => `${i + 1}. ${c.userName}: ${c.score} pts`).join(' | ');
        addStep('Verification', 'success', `Leaderboard: ${leaderboard}`);

    } catch (error: any) {
        addStep('Error', 'failed', error.message);
        throw error;
    }

    return { poolId, steps };
}
