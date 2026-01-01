/**
 * Common Testing Utilities
 * Shared functions for all pool simulators
 */

import { dbService } from '../../../services/dbService';

// ===== TEST USER GENERATION =====

export interface TestUser {
    id: string;
    name: string;
    email: string;
    isTestUser: true;
}

let testUserCounter = 0;

export function generateTestUsers(count: number): TestUser[] {
    const users: TestUser[] = [];
    const timestamp = Date.now();

    for (let i = 0; i < count; i++) {
        testUserCounter++;
        users.push({
            id: `test_user_${timestamp}_${testUserCounter}`,
            name: `Test User ${testUserCounter}`,
            email: `test_user_${testUserCounter}@marchmelee.test`,
            isTestUser: true
        });
    }

    return users;
}

// ===== RESOURCE TRACKING =====

export interface CreatedResource {
    type: 'pool' | 'user' | 'entry' | 'other';
    id: string;
    poolType?: string;
    metadata?: Record<string, any>;
    createdAt: number;
}

const createdResources: CreatedResource[] = [];

export function trackResource(type: CreatedResource['type'], id: string, metadata?: Record<string, any>): void {
    createdResources.push({
        type,
        id,
        metadata,
        createdAt: Date.now()
    });
}

export function getTrackedResources(): CreatedResource[] {
    return [...createdResources];
}

export function clearTrackedResources(): void {
    createdResources.length = 0;
}

// ===== ASSERTION HELPERS =====

export class AssertionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AssertionError';
    }
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
    if (actual !== expected) {
        throw new AssertionError(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
    }
}

export function assertWithin(actual: number, expected: number, tolerance: number, message: string): void {
    const diff = Math.abs(actual - expected);
    if (diff > tolerance) {
        throw new AssertionError(`${message}\nExpected: ${expected} ± ${tolerance}\nActual: ${actual} (diff: ${diff})`);
    }
}

export function assertTrue(condition: boolean, message: string): void {
    if (!condition) {
        throw new AssertionError(message);
    }
}

export function assertFalse(condition: boolean, message: string): void {
    if (condition) {
        throw new AssertionError(message);
    }
}

export function assertExists<T>(value: T | null | undefined, message: string): asserts value is T {
    if (value === null || value === undefined) {
        throw new AssertionError(`${message} - Value is ${value}`);
    }
}

// ===== CLEANUP HELPERS =====

export async function deleteTestPool(poolId: string): Promise<void> {
    try {
        await dbService.deletePool(poolId);
        console.log(`✅ Deleted test pool: ${poolId}`);
    } catch (error) {
        console.error(`❌ Failed to delete pool ${poolId}:`, error);
        throw error;
    }
}

export async function deleteTestUsers(userIds: string[]): Promise<void> {
    const promises = userIds.map(async (userId) => {
        try {
            await dbService.deleteUser(userId);
            console.log(`✅ Deleted test user: ${userId}`);
        } catch (error) {
            console.error(`❌ Failed to delete user ${userId}:`, error);
        }
    });

    await Promise.all(promises);
}

export async function cleanupTestResources(resources: CreatedResource[]): Promise<void> {
    console.log(`🧹 Cleaning up ${resources.length} test resources...`);

    // Group by type
    const poolIds = resources.filter(r => r.type === 'pool').map(r => r.id);
    const userIds = resources.filter(r => r.type === 'user').map(r => r.id);

    // Delete pools first (will cascade delete entries)
    for (const poolId of poolIds) {
        await deleteTestPool(poolId);
    }

    // Then delete users
    if (userIds.length > 0) {
        await deleteTestUsers(userIds);
    }

    console.log('✅ Cleanup complete!');
}

// ===== LOGGING HELPERS =====

export interface TestLog {
    timestamp: number;
    level: 'info' | 'success' | 'warning' | 'error';
    message: string;
    data?: any;
}

const testLogs: TestLog[] = [];

export function log(level: TestLog['level'], message: string, data?: any): void {
    const entry: TestLog = {
        timestamp: Date.now(),
        level,
        message,
        data
    };
    testLogs.push(entry);

    const emoji = {
        info: 'ℹ️',
        success: '✅',
        warning: '⚠️',
        error: '❌'
    }[level];

    console.log(`${emoji} [Test] ${message}`, data || '');
}

export function getLogs(): TestLog[] {
    return [...testLogs];
}

export function clearLogs(): void {
    testLogs.length = 0;
}

// ===== RANDOM HELPERS =====

export function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function shuffle<T>(arr: T[]): T[] {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// ===== DELAY HELPER =====

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
