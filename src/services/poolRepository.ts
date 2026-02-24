import { BaseRepository } from './BaseRepository';
import { type Pool } from '../types';
import { query, collection, where, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { errorHandler, ErrorSeverity } from './errorHandler';

class PoolRepository extends BaseRepository<Pool> {
    constructor() {
        super('pools');
    }

    async getBySlug(slug: string): Promise<Pool | null> {
        try {
            const q = query(collection(db, this.collectionName), where("urlSlug", "==", slug), limit(1));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                return { ...doc.data(), id: doc.id } as Pool;
            }
            return null;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { collection: this.collectionName, slug, operation: 'getBySlug' }
            });
            return null;
        }
    }
}

export const poolRepository = new PoolRepository();
