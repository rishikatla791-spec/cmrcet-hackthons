import { fetchJson, mapLimit, parseMaybeJson, toDateString, stripHtml, clean, uniqueStrings, sleep } from '../lib/util.mjs';

const LIST_URL = 'https://unstop.com/api/public/opportunity/search-result';
const DETAIL_URL = 'https://unstop.com/api/public/competition';
const PAGE_SIZE = 50;

function formatPrize(prizes) {
  const total = (prizes || []).reduce((sum, p) => sum + (Number(p.cash) || 0), 0);
  if (!total) return '';
  const rupees = (prizes || []).every((p) => !p.cash || String(p.currency || '').includes('rupee'));
  return `${rupees ? '₹' : ''}${total.toLocaleString('en-IN')}`;
}

/** The last round's start is the actual event (finale) date; earlier rounds are usually online screening. */
async function fetchEventStart(id, timeZone) {
  try {
    const data = await fetchJson(`${DETAIL_URL}/${id}`, { retries: 1 });
    const rounds = (data?.data?.competition?.rounds || [])
      .slice()
      .sort((a, b) => (a.round_order ?? 0) - (b.round_order ?? 0));
    const last = rounds.at(-1)?.details?.[0];
    return toDateString(last?.start_date, timeZone);
  } catch {
    return '';
  }
}

export default {
  key: 'unstop',
  label: 'Unstop',

  async fetch({ timeZone, log }) {
    const items = [];
    for (let page = 1; ; page += 1) {
      const url = `${LIST_URL}?opportunity=hackathons&oppstatus=open&per_page=${PAGE_SIZE}&page=${page}`;
      const response = await fetchJson(url);
      const batch = response?.data?.data || [];
      items.push(...batch);
      if (!batch.length || page >= (response?.data?.last_page || 1)) break;
      await sleep(400);
    }
    log(`  listed ${items.length}, fetching event dates…`);

    return mapLimit(items, 4, async (item) => {
      const address = parseMaybeJson(item.address_with_country_logo, {}) || {};
      const organisation = parseMaybeJson(item.organisation, {}) || {};
      const requirements = parseMaybeJson(item.regnRequirements, {}) || {};
      const endDate = toDateString(item.end_date, timeZone);
      const startDate = (await fetchEventStart(item.id, timeZone)) || endDate;

      return {
        sourceId: String(item.id),
        name: clean(item.title, 150),
        organizer: clean(organisation.name, 120),
        mode: item.region === 'online' ? 'online' : 'offline',
        city: clean(address.city, 60),
        state: clean(address.state, 60),
        country: clean(address.country?.name, 60),
        venue: clean(address.address, 200),
        registrationDeadline: toDateString(requirements.end_regn_dt, timeZone),
        startDate: startDate > endDate && endDate ? endDate : startDate,
        endDate,
        registrationUrl: item.seo_url || `https://unstop.com/${item.public_url}`,
        domains: uniqueStrings((parseMaybeJson(item.workfunction, []) || []).map((w) => w.name)),
        teamSizeMin: Number(requirements.min_team_size) || null,
        teamSizeMax: Number(requirements.max_team_size) || null,
        prize: formatPrize(parseMaybeJson(item.prizes, [])),
        description: clean(stripHtml(item.details), 400),
      };
    });
  },
};
