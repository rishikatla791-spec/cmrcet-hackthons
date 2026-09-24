import { fetchJson, stripHtml, clean, uniqueStrings, sleep } from '../lib/util.mjs';

const LIST_URL = 'https://devpost.com/api/hackathons';
const MAX_PAGES = 60;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const pad = (n) => String(n).padStart(2, '0');

/**
 * Parses Devpost's "submission_period_dates":
 *   "Jul 31 - Oct 01, 2026" | "Sep 20 - 22, 2026" | "Dec 15, 2025 - Jan 10, 2026" | "Oct 05, 2026"
 */
export function parsePeriod(text) {
  const match = String(text || '').trim().match(
    /^([A-Za-z]{3})\w* (\d{1,2})(?:, (\d{4}))?(?: - (?:([A-Za-z]{3})\w* )?(\d{1,2}), (\d{4}))?$/
  );
  if (!match) return { startDate: '', endDate: '' };
  const [, m1, d1, y1, m2, d2, y2] = match;
  const startMonth = MONTHS[m1.toLowerCase()];
  if (!d2) {
    const date = `${y1}-${pad(startMonth)}-${pad(d1)}`;
    return { startDate: date, endDate: date };
  }
  const endMonth = m2 ? MONTHS[m2.toLowerCase()] : startMonth;
  const endYear = Number(y2);
  const startYear = y1 ? Number(y1) : (startMonth > endMonth ? endYear - 1 : endYear);
  return {
    startDate: `${startYear}-${pad(startMonth)}-${pad(d1)}`,
    endDate: `${endYear}-${pad(endMonth)}-${pad(d2)}`,
  };
}

function parseLocation(location) {
  if (!location || /online/i.test(location)) return { mode: 'online', city: '', state: '', country: '' };
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
  return {
    mode: 'offline',
    city: parts[0] || '',
    state: parts.length > 2 ? parts[parts.length - 2] : '',
    country: parts.length > 1 ? parts[parts.length - 1] : '',
  };
}

export default {
  key: 'devpost',
  label: 'Devpost',

  async fetch() {
    const items = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await fetchJson(`${LIST_URL}?status[]=upcoming&status[]=open&page=${page}`);
      const batch = response?.hackathons || [];
      items.push(...batch);
      if (!batch.length || items.length >= (response?.meta?.total_count || 0)) break;
      await sleep(400);
    }

    return items.map((h) => {
      const { startDate, endDate } = parsePeriod(h.submission_period_dates);
      const place = parseLocation(h.displayed_location?.location);
      return {
        sourceId: String(h.id),
        name: clean(h.title, 150),
        organizer: clean(h.organization_name, 120),
        ...place,
        venue: place.mode === 'online' ? '' : clean(h.displayed_location?.location, 200),
        registrationDeadline: endDate,
        startDate,
        endDate,
        registrationUrl: h.url || '',
        domains: uniqueStrings((h.themes || []).map((t) => t?.name)),
        teamSizeMin: null,
        teamSizeMax: null,
        prize: clean(stripHtml(h.prize_amount), 60),
        description: '',
      };
    });
  },
};
