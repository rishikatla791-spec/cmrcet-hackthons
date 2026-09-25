import { fetchJson, toDateString, clean } from '../lib/util.mjs';

const LIST_URL = 'https://vision.hack2skill.com/api/v1/innovator/public/event/public-list';
const EVENT_URL = 'https://hack2skill.com/event';
const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const MODES = { IN_PERSON: 'offline', HYBRID: 'hybrid', VIRTUAL: 'online' };
const HEADERS = {
  Origin: 'https://vision.hack2skill.com',
  Referer: 'https://vision.hack2skill.com/hackathons-listing',
};

/**
 * Hack2Skill's public listing has dates and mode but no venue or organizer.
 * In-person / hybrid events are therefore flagged for review so staff can set
 * the city before students see them (otherwise they would land in the wrong region).
 */
export default {
  key: 'hack2skill',
  label: 'Hack2Skill',

  async fetch({ timeZone }) {
    const start = new Date().toISOString();
    const end = new Date(Date.now() + 2 * 365 * 24 * 3600 * 1000).toISOString();
    const items = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const params = new URLSearchParams({ page, records: PAGE_SIZE, search: '', start, end });
      const response = await fetchJson(`${LIST_URL}?${params}`, { headers: HEADERS });
      const batch = Array.isArray(response?.data) ? response.data : (response?.data?.docs || []);
      items.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }

    return items.map((h) => {
      const mode = MODES[h.mode] || 'offline';
      const registrationDeadline = toDateString(h.registrationEnd, timeZone);
      const hasEventDates = Boolean(h.submissionStart || h.submissionEnd);
      const startDate = toDateString(h.submissionStart || h.submissionEnd, timeZone) || registrationDeadline;
      const endDate = toDateString(h.submissionEnd || h.submissionStart, timeZone) || startDate;
      const notes = [
        mode !== 'online' && 'Hack2Skill does not publish the venue: set the city and state.',
        !hasEventDates && 'Event dates were not published: dates show the registration deadline.',
      ].filter(Boolean);

      return {
        sourceId: h._id || h.id || h.eventUrl,
        name: clean(h.title, 150),
        organizer: '',
        mode,
        city: '',
        state: '',
        country: '',
        venue: '',
        registrationDeadline,
        startDate,
        endDate,
        registrationUrl: h.eventUrl ? `${EVENT_URL}/${encodeURIComponent(h.eventUrl)}` : '',
        domains: [],
        teamSizeMin: null,
        teamSizeMax: null,
        prize: '',
        description: '',
        imageUrl: clean(h.thumbnail || '', 500),
        needsReview: notes.length > 0,
        reviewNote: notes.join(' '),
      };
    });
  },
};
