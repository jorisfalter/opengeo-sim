// Overpass client shared by the ride and airport builders.
//
// The public instances answer 429 or 504 whenever they are busy, and
// overpass.osm.ch only carries Switzerland, so an empty result counts as a
// failure too. Responses are cached on disk: the corridors do not change from
// one build to the next, and it keeps the load off someone else's server.
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
];
const ATTEMPTS = 6;
const RETRY_WAIT = 15000;
const USER_AGENT = 'trainconnections-builder/0.1';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * `allowEmpty` matters for per-country queries: a country with no railway at
 * all is a valid answer, not a failed request. Without it Burundi and Rwanda
 * look like server errors forever.
 */
export async function fetchOverpass(query, { allowEmpty = false } = {}) {
  let lastError;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    for (const endpoint of MIRRORS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
          },
          body: new URLSearchParams({ data: query }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = JSON.parse(text);
        if (!json.elements?.length && !allowEmpty) throw new Error('empty result');
        return json;
      } catch (error) {
        lastError = new Error(`${endpoint} -> ${error.message}`);
        console.warn(`    overpass ${endpoint}: ${error.message}`);
      }
    }
    if (attempt < ATTEMPTS - 1) {
      console.warn(`    all mirrors failed, retrying in ${RETRY_WAIT / 1000}s`);
      await sleep(RETRY_WAIT);
    }
  }
  throw lastError;
}

export async function cachedOverpass(query, cachePath, refresh = false, options = {}) {
  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8'));
      console.log(`    cache ${cachePath} (${cached.elements.length} elements)`);
      return cached;
    } catch {
      // no usable cache, fetch below
    }
  }
  const data = await fetchOverpass(query, options);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(data));
  console.log(`    fetched and cached in ${cachePath}`);
  return data;
}
