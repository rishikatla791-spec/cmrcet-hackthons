import { fetchJson, toDateString, clean, uniqueStrings, sleep } from '../lib/util.mjs';

const SEARCH_URL = 'https://api.devfolio.co/api/search/hackathons';
const PAGE_SIZE = 50;

export default {
  key: 'devfolio',
  label: 'Devfolio',

  async fetch({ timeZone }) {
    const hits = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const response = await fetchJson(SEARCH_URL, {
        method: 'POST',
        body: { type: 'application_open', from, size: PAGE_SIZE },
      });
      const batch = response?.hits?.hits || [];
      hits.push(...batch.map((h) => h._source));
      if (!batch.length || hits.length >= (response?.hits?.total?.value || 0)) break;
      await sleep(400);
    }

    return hits.map((h) => ({
      sourceId: h.uuid,
      name: clean(h.name, 150),
      organizer: clean(h.hosted_by?.name, 120),
      mode: h.is_online ? 'online' : 'offline',
      city: clean(h.city, 60),
      state: clean(h.state, 60),
      country: clean(h.country, 60),
      venue: clean(h.location, 200),
      registrationDeadline: toDateString(h.hackathon_setting?.reg_ends_at, timeZone),
      startDate: toDateString(h.starts_at, timeZone),
      endDate: toDateString(h.ends_at, timeZone),
      registrationUrl: h.slug ? `https://${h.slug}.devfolio.co/` : '',
      domains: uniqueStrings((h.themes || []).map((t) => t?.name)),
      teamSizeMin: Number(h.team_min) || null,
      teamSizeMax: Number(h.team_size) || null,
      prize: '',
      description: clean(h.tagline, 400),
    }));
  },
};
