import { db, functions } from '../firebase';
import { doc, setDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

export const referralService = {
  // Generate a unique referral link for a user
  async generateReferralLink(userId: string): Promise<string> {
    const baseUrl = window.location.origin;
    try {
      const generateToken = httpsCallable<{ userId: string }, { token: string }>(functions, 'generateReferralToken');
      const response = await generateToken({ userId });
      return `${baseUrl}/#/?ref=${response.data.token}`;
    } catch (e) {
      console.error("Failed to generate secure referral token, falling back to basic hash", e);
      // Fallback only if absolutely necessary, but we shouldn't leak UID.
      return `${baseUrl}/#/?ref=error`;
    }
  },

  // Parse referral token from URL back to userId
  async parseReferralToken(token: string): Promise<string | null> {
    try {
      const resolveToken = httpsCallable<{ token: string }, { uid: string }>(functions, 'resolveReferralToken');
      const response = await resolveToken({ token });
      return response.data.uid;
    } catch (e) {
      console.error("Failed to resolve referral token", e);
      return null;
    }
  },

  // Store a referral record when a new user signs up via referral link
  async createReferralRecord(referrerId: string, newUserId: string): Promise<void> {
    const recordRef = doc(collection(db, 'referrals'));
    await setDoc(recordRef, {
      referrerId,
      referredUserId: newUserId,
      status: 'pending',
      createdAt: Date.now(),
      creditAwarded: false
    });
  },

  // Get referral stats for a user (for display in profile)
  subscribeToReferralStats(userId: string, callback: (stats: {
    totalReferred: number;
    confirmedReferred: number;
    pendingReferred: number;
    creditsEarned: number;
  }) => void): () => void {
    const q = query(collection(db, 'referrals'), where('referrerId', '==', userId));
    return onSnapshot(q, (snap) => {
      const records = snap.docs.map(d => d.data());
      callback({
        totalReferred: records.length,
        confirmedReferred: records.filter(r => r.status === 'confirmed').length,
        pendingReferred: records.filter(r => r.status === 'pending').length,
        creditsEarned: records.filter(r => r.creditAwarded).length
      });
    });
  }
};
