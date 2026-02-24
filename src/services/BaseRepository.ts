import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    type QueryConstraint,
    type DocumentData
} from 'firebase/firestore';
import { db } from '../firebase';
import { errorHandler, ErrorSeverity } from './errorHandler';

export abstract class BaseRepository<T extends DocumentData> {
    protected collectionName: string;

    constructor(collectionName: string) {
        this.collectionName = collectionName;
    }

    /**
     * Fetches a single document by ID
     */
    async getById(id: string): Promise<T | null> {
        try {
            const docRef = doc(db, this.collectionName, id);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                return { id: docSnap.id, ...docSnap.data() } as unknown as T;
            }
            return null;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { collection: this.collectionName, id, operation: 'getById' }
            });
            return null;
        }
    }

    /**
     * Fetches multiple documents based on queries
     */
    async find(constraints: QueryConstraint[] = []): Promise<T[]> {
        try {
            const q = query(collection(db, this.collectionName), ...constraints);
            const querySnapshot = await getDocs(q);
            return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as T));
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                context: { collection: this.collectionName, operation: 'find' }
            });
            return [];
        }
    }

    /**
     * Creates or overwrites a document
     */
    async save(id: string, data: Partial<T>): Promise<boolean> {
        try {
            await setDoc(doc(db, this.collectionName, id), data, { merge: true });
            return true;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { collection: this.collectionName, id, operation: 'save' }
            });
            return false;
        }
    }

    /**
     * Updates specific fields of a document
     */
    async update(id: string, data: Partial<T>): Promise<boolean> {
        try {
            const docRef = doc(db, this.collectionName, id);
            await updateDoc(docRef, data as any); // Firebase updateDoc has complex types for generic records
            return true;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { collection: this.collectionName, id, operation: 'update' }
            });
            return false;
        }
    }

    /**
     * Deletes a document
     */
    async delete(id: string): Promise<boolean> {
        try {
            await deleteDoc(doc(db, this.collectionName, id));
            return true;
        } catch (error) {
            await errorHandler.handleError(error, {
                severity: ErrorSeverity.HIGH,
                context: { collection: this.collectionName, id, operation: 'delete' }
            });
            return false;
        }
    }
}
