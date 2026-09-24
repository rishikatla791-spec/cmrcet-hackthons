/**
 * One-time setup: writes portal settings and the starting roles into Firestore.
 * Events are not seeded — they come from the importer (npm run import) and from staff.
 *
 *   npm run seed               -> creates missing documents, never overwrites
 *   npm run seed:overwrite     -> replaces existing documents with the data files
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FieldValue } from 'firebase-admin/firestore';
import { initFirestore } from './lib/firebase.mjs';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const overwrite = process.argv.includes('--overwrite');

const readJson = async (file) => JSON.parse(await readFile(path.join(dataDir, file), 'utf8'));

async function writeDoc(ref, data, label) {
  const snapshot = await ref.get();
  if (snapshot.exists && !overwrite) {
    console.log(`  skip    ${label} (already exists)`);
    return;
  }
  const stamps = snapshot.exists
    ? { updatedAt: FieldValue.serverTimestamp() }
    : { createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
  await ref.set({ ...data, ...stamps });
  console.log(`  ${snapshot.exists ? 'replace' : 'create '} ${label}`);
}

async function main() {
  const { db, projectId } = await initFirestore();
  console.log(`Project: ${projectId}${overwrite ? '  (overwrite mode)' : ''}\n`);

  console.log('Settings');
  await writeDoc(db.doc('settings/public'), await readJson('settings.json'), 'settings/public');

  console.log('\nRoles');
  for (const { email, role } of await readJson('roles.json')) {
    const id = email.trim().toLowerCase();
    await writeDoc(db.doc(`roles/${id}`), { email: id, role }, `roles/${id} -> ${role}`);
  }

  console.log('\nDone. Next: npm run import');
}

main().catch((error) => {
  console.error(`\nSeed failed: ${error.message}`);
  process.exit(1);
});
