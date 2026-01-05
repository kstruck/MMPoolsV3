# Fix Instructions for fixPoolScores Function

## Problem
The `fixPoolScores` function updates scores but does NOT generate score event winners for "Every Score Pays" pools.

## Solution
Replace the complex backfill logic with a simple call to `processGameUpdate` (the same function `syncGameStatus` uses).

---

## Step-by-Step Instructions

### 1. Open the file
Open `functions/src/scoreUpdates.ts` in your editor

### 2. Find line 999
Search for `const state = espnScores.gameStatus;` (line 999)

### 3. Delete lines 999-1202

**DELETE everything from line 999 to line 1202** (inclusive). This removes all the complex backfill logic.

The last line you delete should be:
```typescript
            });
```

### 4. Insert the new code

At line 999 (where you just deleted), **INSERT** this code:

```typescript
            // Use processGameUpdate - the SAME function syncGameStatus uses
            // This ensures score events and winners are properly generated
            await db.runTransaction(async (transaction) => {
                const freshDoc = await transaction.get(doc.ref);
                if (!freshDoc.exists) return;
                
                await processGameUpdate(
                    transaction,
                    freshDoc,
                    espnScores,
                    { uid: 'system', role: 'ADMIN', label: 'Manual Fix' }
                );
            });

            results.push({
                id: doc.id,
                name: `${pool.homeTeam} vs ${pool.awayTeam}`,
                status: 'fixed',
                message: 'Score events and winners processed'
            });
```

### 5. Verify the result

After the replacement, your code should look like this:

```typescript
    for (const doc of poolsSnap.docs) {
        try {
            const pool = doc.data() as GameState;
            if (!pool.gameId) continue;

            const espnScores = await fetchESPNScores(pool.gameId, (pool as any).league || 'nfl');
            if (!espnScores) {
                results.push({ id: doc.id, status: 'error', reason: 'ESPN fetch failed' });
                continue;
            }

            // Use processGameUpdate - the SAME function syncGameStatus uses
            // This ensures score events and winners are properly generated
            await db.runTransaction(async (transaction) => {
                const freshDoc = await transaction.get(doc.ref);
                if (!freshDoc.exists) return;
                
                await processGameUpdate(
                    transaction,
                    freshDoc,
                    espnScores,
                    { uid: 'system', role: 'ADMIN', label: 'Manual Fix' }
                );
            });

            results.push({
                id: doc.id,
                name: `${pool.homeTeam} vs ${pool.awayTeam}`,
                status: 'fixed',
                message: 'Score events and winners processed'
            });

        } catch (error: any) {
            console.error(`Error processing pool ${doc.id}:`, error);
            results.push({ id: doc.id, status: 'error', reason: error.message });
        }
    }

    return { success: true, pools: results };
```

### 6. Save the file

### 7. Deploy the function
```bash
npm run deploy:backend -- --only functions:fixPoolScores
```

### 8. Test the fix
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"data":{"poolId":"4BLlJSC7CGTAiK3SM6xO"}}' \
  https://us-central1-gridiron-gamble-uzuqo.cloudfunctions.net/fixPoolScores
```

### 9. Verify in UI
- Go to: https://www.marchmeleepools.com/#pool/4BLlJSC7CGTAiK3SM6xO
- Click "Audit Log & Disputes"
- Check **WINNERS** tab - should show 5+ winners (one for each score change)

---

## What This Fix Does

1. **Removes** the complex backfill logic that didn't work properly
2. **Uses** `processGameUpdate` - the proven, working function from `syncGameStatus`
3. **Ensures** score events are decomposed correctly (0-3, 3-3, 3-6, 6-6, 6-7, 6-10)
4. **Generates** winners for each score event automatically

## Why It Works

`processGameUpdate` handles:
- Score event decomposition (breaks down score changes into individual events)
- Winner computation (finds the square owner for each event)
- Audit logging (logs both SCORE_FINALIZED and WINNER_COMPUTED events)
- Deduplication (prevents duplicate entries)

The old code tried to do all this manually and failed.
