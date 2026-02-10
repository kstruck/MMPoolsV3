---
name: skill-firebase-pwa-offline
description: Scaffolds an offline-first PWA architecture using Firebase Firestore Persistence and Service Workers. Ensures <10s capture speed even without network.
---

# Firebase PWA Offline Core

## Capability Overview
To meet the "Phone-first capture" requirement (REQ #1), the app must work instantly, even in Airplane Mode. This skill generates the necessary frontend code to:
1.  **Persist Data:** Store captures in the local device database (IndexedDB) immediately.
2.  **Background Sync:** Automatically upload data when the connection returns.
3.  **App Shell:** Load the UI instantly using a Service Worker cache.

## Tools (Scripts)
* **PWA Generator:** `python skills/skill-firebase-pwa-offline/scripts/scaffold_pwa.py [output_dir]`
    * *Generates:* `firebase_config.js` (with persistence), `service-worker.js`, and `manifest.json`.

## Workflow

### 1. Initialize Offline Core
When building the frontend, run:
```bash
python skills/skill-firebase-pwa-offline/scripts/scaffold_pwa.py ./src/
```

### 2. Verify Persistence
The generated `firebase_config.js` contains the critical line:
```javascript
enableIndexedDbPersistence(db).catch((err) => { ... });
```
* **Agent Note:** If users report "app doesn't work offline," check if this line is executing correctly in the browser console.

## Architecture Notes
- **Writes:** All "Save" actions must await the *local* write, not the *server* write.
- **Reads:** Subscribe to `onSnapshot` (realtime listeners) rather than `getDocs` to leverage the local cache automatically.
