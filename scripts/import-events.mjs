/**
 * Imports open hackathons from public platforms into Firestore `events`.
 *
 *   npm run import                 -> fetch and write to Firestore
 *   npm run import:preview         -> fetch only, print a summary (no Firebase needed)
 *   node import-events.mjs --source=unstop --dry-run --out=preview.json
 *
 * Behaviour is controlled by settings/public in Firestore:
 *   importSources        which platforms are enabled
 *   importCountry        offline events outside this country are skipped (online events are kept)
 *   autoPublishImports   true  -> new events are visible immediately
 *                        false -> new events wait in Admin > Approvals
 *   timeZone             used to convert platform timestamps into dates
 *
 * Events edited by staff (manualOverride) or hidden by staff are never overwritten or re-shown.
 * Events a source flags with needsReview (e.g. missing venue) always wait for approval.
 *
 * Health check: the run exits with code 1 (failing the GitHub Action, which emails the repo owner)
 * when an enabled source throws, returns nothing, or returns mostly unusable data. Healthy sources
 * are still written. The result is stored in status/import for the Admin page.
 */
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FieldValue } from 'firebase-admin/firestore';
import { initFirestore } from './lib/firebase.mjs';
import { norm, toDateString } from './lib/util.mjs';
import unstop from './sources/unstop.mjs';
import devfolio from './sources/devfolio.mjs';
import devpost from './sources/devpost.mjs';
import hack2skill from './sources/hack2skill.mjs';

const SOURCES = [unstop, devfolio, hack2skill, devpost];   // earlier sources win cross-platform duplicates
const IMPORTED_FIELDS = [
  'name', 'organizer', 'mode', 'city', 'state', 'venue', 'registrationDeadline', 'startDate', 'endDate',
  'registrationUrl', 'domains', 'teamSizeMin', 'teamSizeMax', 'prize', 'description',
];
const BATCH_LIMIT = 400;
const MIN_USABLE_RATIO = 0.5;   // below this, the platform's response format has probably changed

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlySource = args.find((a) => a.startsWith('--source='))?.split('=')[1];
const outFile = args.find((a) => a.startsWith('--out='))?.split('=')[1];

const log = (...parts) => console.log(...parts);

const docId = (sourceKey, sourceId) => `${sourceKey}-${String(sourceId).replace(/[^A-Za-z0-9_-]/g, '_')}`;
const dedupeKey = (event) => `${norm(event.name).replace(/[^a-z0-9]/g, '')}|${event.startDate}`;
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isUsable = (event) => Boolean(event.name && event.startDate && event.sourceId);

function isRelevant(event, settings, today) {
  if (!isUsable(event)) return false;
  if ((event.endDate || event.startDate) < today) return false;
  if (event.mode === 'online') return true;
  if (!settings.importCountry) return true;
  if (event.country) return norm(event.country) === norm(settings.importCountry);
  // No country: keep if the platform gave a state, or if staff will set the location during review.
  return Boolean(event.state) || Boolean(event.needsReview);
}

function regionOf(event, settings) {
  if (event.mode === 'online') return 'virtual';
  if ((settings.homeCities || []).map(norm).includes(norm(event.city))) return 'home';
  if (norm(event.state) === norm(settings.homeState)) return 'state';
  return 'other';
}

function checkHealth(fetched) {
  if (!fetched.length) return 'returned no events (the platform may have changed its API)';
  const usable = fetched.filter(isUsable).length;
  if (usable / fetched.length < MIN_USABLE_RATIO) {
    return `only ${usable} of ${fetched.length} events had a name and date (the response format may have changed)`;
  }
  return '';
}

async function collect(settings) {
  const today = toDateString(new Date(), settings.timeZone);
  const enabled = SOURCES.filter((s) => (onlySource ? s.key === onlySource : settings.importSources?.[s.key] !== false));
  const seen = new Set();
  const events = [];
  const health = [];

  for (const source of enabled) {
    log(`\n${source.label}`);
    const started = Date.now();
    const report = { key: source.key, label: source.label, ok: true, fetched: 0, kept: 0, error: '' };
    health.push(report);

    let fetched = [];
    try {
      fetched = await source.fetch({ timeZone: settings.timeZone, log });
    } catch (error) {
      report.ok = false;
      report.error = error.message;
      log(`  FAILED: ${error.message}`);
      continue;
    } finally {
      report.seconds = Math.round((Date.now() - started) / 1000);
    }

    report.fetched = fetched.length;
    const problem = checkHealth(fetched);
    if (problem) {
      report.ok = false;
      report.error = problem;
      log(`  UNHEALTHY: ${problem}`);
    }

    let duplicates = 0;
    for (const event of fetched) {
      if (!isRelevant(event, settings, today)) continue;
      const key = dedupeKey(event);
      if (seen.has(key)) { duplicates += 1; continue; }
      seen.add(key);
      events.push({ ...event, source: source.key, id: docId(source.key, event.sourceId) });
      report.kept += 1;
    }
    log(`  fetched ${fetched.length}, kept ${report.kept}${duplicates ? `, ${duplicates} duplicates of other platforms` : ''} (${report.seconds}s)`);
  }
  return { events, health };
}

function printSummary(events, settings) {
  const byRegion = { home: 0, state: 0, other: 0, virtual: 0 };
  events.forEach((e) => { byRegion[regionOf(e, settings)] += 1; });
  log('\nBy priority region');
  log(`  ${settings.homeRegionLabel}: ${byRegion.home}`);
  log(`  Rest of ${settings.homeState}: ${byRegion.state}`);
  log(`  Other states: ${byRegion.other}`);
  log(`  Virtual: ${byRegion.virtual}`);
}

async function writeToFirestore(db, events, settings) {
  const snapshot = await db.collection('events').get();
  const existing = new Map(snapshot.docs.map((d) => [d.id, d.data()]));
  const existingKeys = new Set(snapshot.docs.map((d) => dedupeKey(d.data())));

  const writes = [];
  const counts = { created: 0, updated: 0, unchanged: 0, protected: 0, duplicate: 0, needsReview: 0 };

  for (const event of events) {
    const ref = db.collection('events').doc(event.id);
    const current = existing.get(event.id);
    const fields = Object.fromEntries(IMPORTED_FIELDS.map((k) => [k, event[k] ?? (k.startsWith('teamSize') ? null : '')]));

    if (!current) {
      if (existingKeys.has(dedupeKey(event))) { counts.duplicate += 1; continue; }
      const review = Boolean(event.needsReview);
      writes.push((batch) => batch.set(ref, {
        ...fields,
        source: event.source,
        sourceId: event.sourceId,
        visibility: review || !settings.autoPublishImports ? 'pending' : 'published',
        pinned: false,
        needsReview: review,
        reviewNote: event.reviewNote || '',
        manualOverride: false,
        offlineCounts: { teams: 0, students: 0 },
        createdBy: 'importer',
        updatedBy: 'importer',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }));
      counts.created += 1;
      if (review) counts.needsReview += 1;
      continue;
    }

    if (current.manualOverride) { counts.protected += 1; continue; }
    const changed = IMPORTED_FIELDS.filter((k) => !sameValue(current[k], fields[k]));
    if (!changed.length) { counts.unchanged += 1; continue; }
    writes.push((batch) => batch.update(ref, {
      ...Object.fromEntries(changed.map((k) => [k, fields[k]])),
      updatedBy: 'importer',
      updatedAt: FieldValue.serverTimestamp(),
    }));
    counts.updated += 1;
  }

  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    writes.slice(i, i + BATCH_LIMIT).forEach((write) => write(batch));
    await batch.commit();
  }

  log('\nFirestore');
  log(`  created ${counts.created} (${counts.needsReview} need review${settings.autoPublishImports ? '' : ', all waiting for approval'})`);
  log(`  updated ${counts.updated}, unchanged ${counts.unchanged}`);
  log(`  skipped ${counts.protected} edited by staff, ${counts.duplicate} already added manually`);
  return counts;
}

async function writeStatus(db, health, counts) {
  await db.doc('status/import').set({
    finishedAt: FieldValue.serverTimestamp(),
    healthy: health.every((h) => h.ok),
    sources: health,
    counts: counts ?? null,
    runUrl: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '',
  });
}

/** Markdown table on the GitHub Actions run page. */
async function writeJobSummary(health, events) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const rows = health.map((h) => `| ${h.ok ? '✅' : '❌'} ${h.label} | ${h.fetched} | ${h.kept} | ${h.error || ''} |`);
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    '## Hackathon import', '',
    '| Source | Fetched | Kept | Problem |', '|---|---|---|---|', ...rows, '',
    `**${events.length}** relevant events in total.`, '',
  ].join('\n'));
}

function printHealth(health) {
  log('\nHealth');
  health.forEach((h) => log(`  ${h.ok ? 'OK  ' : 'FAIL'} ${h.label.padEnd(11)} ${h.ok ? `${h.fetched} fetched` : h.error}`));
}

async function main() {
  let db = null;
  let settings;

  if (dryRun) {
    settings = JSON.parse(await readFile(path.resolve(here, '..', 'data', 'settings.json'), 'utf8'));
    log('Dry run: using data/settings.json, nothing is written.');
  } else {
    ({ db } = await initFirestore());
    const snap = await db.doc('settings/public').get();
    if (!snap.exists) throw new Error('settings/public does not exist. Run "npm run seed" first.');
    settings = snap.data();
  }
  settings.timeZone = settings.timeZone || 'UTC';

  const { events, health } = await collect(settings);
  log(`\nTotal relevant events: ${events.length}`);
  printSummary(events, settings);

  if (outFile) {
    await writeFile(path.resolve(outFile), JSON.stringify(events, null, 2));
    log(`\nWrote ${outFile}`);
  }

  let counts = null;
  if (!dryRun) {
    counts = await writeToFirestore(db, events, settings);
    await writeStatus(db, health, counts);
  }

  printHealth(health);
  await writeJobSummary(health, events);

  const failed = health.filter((h) => !h.ok);
  if (failed.length) {
    console.error(`\nImport finished with problems in: ${failed.map((h) => h.label).join(', ')}.`);
    console.error('Healthy sources were still imported. Fix the failing source file(s) in scripts/sources/.');
    process.exit(1);
  }
  log('\nDone. All sources healthy.');
}

main().catch(async (error) => {
  console.error(`\nImport failed: ${error.message}`);
  process.exit(1);
});
