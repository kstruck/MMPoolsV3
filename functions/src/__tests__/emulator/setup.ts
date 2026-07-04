import * as admin from 'firebase-admin';

// Ensure a project id (emulator does not require a real one). emulators:exec
// sets FIRESTORE_EMULATOR_HOST, so admin points at the emulator automatically.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mmp';
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
}
