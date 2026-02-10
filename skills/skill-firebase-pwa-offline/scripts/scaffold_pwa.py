#!/usr/bin/env python3
import os
import sys
import argparse
from pathlib import Path

# --- Templates ---

FIREBASE_JS_TEMPLATE = """
import { initializeApp } from "firebase/app";
import { 
    getFirestore, 
    enableIndexedDbPersistence, 
    collection, 
    addDoc 
} from "firebase/firestore";

const firebaseConfig = {
  // TODO: Paste your keys from Firebase Console -> Project Settings
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// CRITICAL: Enable Offline Persistence
enableIndexedDbPersistence(db)
  .catch((err) => {
      if (err.code == 'failed-precondition') {
          console.error("Persistence failed: Multiple tabs open.");
      } else if (err.code == 'unimplemented') {
          console.error("Persistence failed: Browser not supported.");
      }
  });

export { db };

/**
 * Saves a capture item. Works offline immediately.
 * Syncs to cloud automatically when online.
 */
export async function saveCapture(text, type = "note") {
    try {
        const docRef = await addDoc(collection(db, "captures"), {
            text: text,
            type: type,
            createdAt: new Date(),
            synced: false // Metadata for UI
        });
        console.log("Written to local DB with ID: ", docRef.id);
        return docRef.id;
    } catch (e) {
        console.error("Error adding document: ", e);
        throw e;
    }
}
"""

SW_TEMPLATE = """
// service-worker.js
const CACHE_NAME = "capture-app-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/styles.css",
  "/app.js"
];

// Install: Cache core assets (App Shell)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Caching app shell");
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Fetch: Serve from Cache first, then Network
self.addEventListener("fetch", (event) => {
  // Ignore Firestore requests (let the SDK handle those)
  if (event.request.url.includes("firestore.googleapis.com")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
"""

MANIFEST_TEMPLATE = """
{
  "name": "Quick Capture AI",
  "short_name": "Capture",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#000000",
  "icons": [
    {
      "src": "icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
"""

def generate_files(target_dir):
    base = Path(target_dir)
    os.makedirs(base, exist_ok=True)
    
    # Write Firebase Config
    with open(base / "firebase_config.js", "w") as f:
        f.write(FIREBASE_JS_TEMPLATE.strip())
    print(f"✅ Created {base / 'firebase_config.js'}")
    
    # Write Service Worker
    with open(base / "service-worker.js", "w") as f:
        f.write(SW_TEMPLATE.strip())
    print(f"✅ Created {base / 'service-worker.js'}")
    
    # Write Manifest
    with open(base / "manifest.json", "w") as f:
        f.write(MANIFEST_TEMPLATE.strip())
    print(f"✅ Created {base / 'manifest.json'}")
    
    print("\n👉 Next Steps:")
    print("1. Register the service worker in your main index.js.")
    print("2. Add <link rel='manifest' href='manifest.json'> to your index.html.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("output_dir", help="Directory to output the JS files (e.g., ./src)")
    args = parser.parse_args()
    
    generate_files(args.output_dir)
