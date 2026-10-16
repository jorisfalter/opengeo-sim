#!/usr/bin/env node
// The rest of the world's airfields, from OurAirports.
//
//   npm run build:airports
//
// OurAirports is released into the public domain under the Unlicense: no
// attribution required, no share-alike, nothing to carry. That is why it is
// here and X-Plane's apt.dat is not — apt.dat is GPL and shipping it would
// pull the GPL over this whole distribution.
//
// What comes out is a compact index: every airfield with at least one runway
// whose ends are known, as arrays rather than objects because 17,000 of them
// with field names would be three times the size.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const BASE = 'https://davidmegginson.github.io/ourairports-data';
const KINDS = new Set(['small_airport', 'medium_airport', 'large_airport']);
const MIN_LENGTH_FT = 500;

/** CSV with quoted fields and commas inside them. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((name, i) => [name, r[i]])));
}

const num = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
};
const round = (value, places) => (value === null ? null : Number(value.toFixed(places)));

// Surfaces, collapsed to what a pilot cares about and a renderer can colour.
const SURFACE = (raw) => {
  const s = (raw ?? '').toLowerCase();
  if (/asp|conc|bit|pem|tar|paved/.test(s)) return 'hard';
  if (/grass|turf|gvl|grav|dirt|soil|sand|earth/.test(s)) return 'soft';
  if (/snow|ice/.test(s)) return 'snow';
  if (/water/.test(s)) return 'water';
  return 'other';
};

/**
 * Build the two ends of a runway that OurAirports knows only by name, by
 * putting it across the airport position on the heading its number gives.
 * Returns null when the name is not a heading ("H1", "ALL", "N/S"), because
 * then there is nothing to point it at.
 */
function layOut(strip, lat, lon) {
  const digits = /^\s*(\d{1,2})/.exec(strip[7] ?? '');
  const number = digits ? Number(digits[1]) : NaN;
  if (!number || number < 1 || number > 36) return null;
  const bearing = (number * 10 * Math.PI) / 180;
  const half = (strip[4] * 0.3048) / 2;
  const dLat = (half * Math.cos(bearing)) / 111320;
  const dLon = (half * Math.sin(bearing)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    round(lat - dLat, 5), round(lon - dLon, 5),
    round(lat + dLat, 5), round(lon + dLon, 5),
    ...strip.slice(4),
  ];
}

async function main() {
  const out = resolve(process.argv[2] ?? 'public/airports/index.json');
  console.log('1/3 OurAirports ophalen');
  const [airportsCsv, runwaysCsv] = await Promise.all(
    ['airports.csv', 'runways.csv'].map(async (name) => {
      const res = await fetch(`${BASE}/${name}`);
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      return res.text();
    }),
  );

  console.log('2/3 Samenvoegen');
  const airports = parseCsv(airportsCsv);
  const runways = parseCsv(runwaysCsv);

  const byIdent = new Map();
  for (const r of runways) {
    if (r.closed === '1') continue;
    const le = [num(r.le_latitude_deg), num(r.le_longitude_deg)];
    const he = [num(r.he_latitude_deg), num(r.he_longitude_deg)];
    const length = num(r.length_ft);
    if (!length || length < MIN_LENGTH_FT) continue;
    // Plenty of small fields are surveyed only as "09/27, 1967 ft, grass" —
    // Hasselt-Kiewit is one. Dropping those loses the airfield entirely, so
    // the ends are left null here and laid out around the airport position
    // below. The number is a magnetic heading and we draw it as a true one,
    // which is a degree or two off in our region: invisible on a 600 m strip.
    const placed = le[0] !== null && he[0] !== null;
    const list = byIdent.get(r.airport_ident) ?? [];
    list.push([
      placed ? round(le[0], 5) : null, placed ? round(le[1], 5) : null,
      placed ? round(he[0], 5) : null, placed ? round(he[1], 5) : null,
      Math.round(length), Math.round(num(r.width_ft) ?? 0), SURFACE(r.surface),
      r.le_ident || '', r.he_ident || '',
    ]);
    byIdent.set(r.airport_ident, list);
  }

  const index = [];
  for (const a of airports) {
    if (!KINDS.has(a.type)) continue;
    const strips = byIdent.get(a.ident);
    if (!strips?.length) continue;
    const lat = num(a.latitude_deg);
    const lon = num(a.longitude_deg);
    if (lat === null || lon === null) continue;
    const laid = strips.map((s) => (s[0] === null ? layOut(s, lat, lon) : s)).filter(Boolean);
    if (!laid.length) continue;
    // Longest first: that is the one you want to be put on.
    laid.sort((x, y) => y[4] - x[4]);
    index.push([
      a.ident, a.name, round(lat, 5), round(lon, 5),
      Math.round(num(a.elevation_ft) ?? 0), a.iso_country, laid.slice(0, 4),
    ]);
  }
  index.sort((a, b) => a[0].localeCompare(b[0]));

  console.log('3/3 Schrijven');
  const payload = {
    source: 'OurAirports (ourairports.com) — publiek domein, Unlicense',
    fields: ['ident', 'name', 'lat', 'lon', 'elevationFt', 'country', 'runways'],
    runwayFields: ['leLat', 'leLon', 'heLat', 'heLon', 'lengthFt', 'widthFt', 'surface', 'leId', 'heId'],
    airports: index,
  };
  await mkdir(dirname(out), { recursive: true });
  const json = JSON.stringify(payload);
  await writeFile(out, json);
  console.log(`    ${out} — ${Math.round(json.length / 1024)} kB, ${index.length} vliegvelden`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
