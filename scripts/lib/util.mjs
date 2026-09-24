const USER_AGENT = 'Mozilla/5.0 (compatible; CollegeHackathonPortal/1.0)';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** fetch() that parses JSON, times out, and retries transient failures. */
export async function fetchJson(url, { method = 'GET', body, headers = {}, retries = 2, timeoutMs = 20000 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.json();
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(1000 * (attempt + 1));
    }
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Parses a value that may already be an object or a JSON string. */
export function parseMaybeJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/** ISO timestamp -> "YYYY-MM-DD" in the given time zone. */
export function toDateString(value, timeZone) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const norm = (text) => String(text || '').trim().toLowerCase();

export const clean = (text, max = 200) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);

export const uniqueStrings = (items) => [...new Set(items.map((s) => clean(s, 60)).filter(Boolean))];
