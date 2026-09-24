import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Loads the service account from, in order:
 *   1. FIREBASE_SERVICE_ACCOUNT  – the key's JSON content (used by GitHub Actions)
 *   2. GOOGLE_APPLICATION_CREDENTIALS – path to the key file
 *   3. scripts/service-account.json (git-ignored, for local runs)
 */
async function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(scriptsDir, 'service-account.json');
  try {
    await access(file);
  } catch {
    throw new Error(
      `Service account key not found at "${file}".\n` +
      'Download it from Firebase Console > Project settings > Service accounts > Generate new private key,\n' +
      'then save it as scripts/service-account.json (or set FIREBASE_SERVICE_ACCOUNT / GOOGLE_APPLICATION_CREDENTIALS).'
    );
  }
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function initFirestore() {
  const serviceAccount = await loadServiceAccount();
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
  return { db: getFirestore(), projectId: serviceAccount.project_id };
}
