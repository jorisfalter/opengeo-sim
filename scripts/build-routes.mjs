#!/usr/bin/env node
// Who flies where, so the sky has something in it.
//
//   npm run build:routes
//
// Real airlines on real city pairs, from the OpenFlights route database. That
// database is published under the Open Database License — the same licence as
// the OpenStreetMap data this project already carries — which asks for
// attribution and for derived databases to stay open. This file is such a
// derived database and says so in its own header.
//
// It is also not current: OpenFlights' network data was last curated around
// 2014. For ambient traffic that is the right trade. The airlines are real,
// the city pairs were really flown, and nobody is navigating by it.
//
// Airport positions come from OurAirports, which is where the simulator's own
// airfield index comes from, so a route's ends are fields you can land at.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data';
const OPENFLIGHTS = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data';
// Below this a "route" is usually a data artefact rather than a flight.
const MIN_KM = 40;

/** CSV with quoted fields and commas inside them. */
function parseCsv(text, hasHeader = true) {
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
  if (!hasHeader) return rows;
  const header = rows.shift();
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((name, i) => [name, r[i]])));
}

const num = (value) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
};
const round = (value, places) => Number(value.toFixed(places));
// OpenFlights writes an absent value as the two characters \N.
const text = (value) => (value && value !== '\\N' ? value.trim() : '');

const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
};

const km = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

async function main() {
  const out = resolve(process.argv[2] ?? 'public/airports/routes.json');
  console.log('1/4 Ophalen');
  const [airportsCsv, routesDat, airlinesDat] = await Promise.all([
    get(`${OURAIRPORTS}/airports.csv`),
    get(`${OPENFLIGHTS}/routes.dat`),
    get(`${OPENFLIGHTS}/airlines.dat`),
  ]);

  console.log('2/4 Vliegvelden op IATA');
  const byIata = new Map();
  for (const a of parseCsv(airportsCsv)) {
    const iata = a.iata_code?.trim();
    const lat = num(a.latitude_deg);
    const lon = num(a.longitude_deg);
    if (!iata || iata.length !== 3 || lat === null || lon === null) continue;
    // Heliports and seaplane bases are in the route data too; an airliner on
    // one of them is a sight nobody needs.
    if (!['small_airport', 'medium_airport', 'large_airport'].includes(a.type)) continue;
    byIata.set(iata, {
      ident: a.ident,
      lat: round(lat, 4),
      lon: round(lon, 4),
      elevationFt: Math.round(num(a.elevation_ft) ?? 0),
    });
  }

  console.log('3/4 Maatschappijen en routes');
  // id -> airline. The callsign is the word spoken on the radio, which is what
  // an air traffic controller will want later; the ICAO code is what goes in
  // front of the flight number.
  const airlineById = new Map();
  for (const row of parseCsv(airlinesDat, false)) {
    const [id, name, , iata, icao, callsign, country, active] = row;
    if (!id || active !== 'Y') continue;
    const code = text(icao);
    if (code.length !== 3) continue;
    airlineById.set(text(id), {
      iata: text(iata),
      icao: code,
      name: text(name),
      callsign: text(callsign) || text(name),
      country: text(country),
    });
  }

  const airlines = [];
  const airlineIndex = new Map();
  const airports = [];
  const airportIndex = new Map();
  const equipment = [];
  const equipmentIndex = new Map();
  const intern = (list, index, key, value) => {
    if (index.has(key)) return index.get(key);
    const at = list.length;
    list.push(value);
    index.set(key, at);
    return at;
  };

  const seen = new Set();
  const routes = [];
  for (const row of parseCsv(routesDat, false)) {
    const [, airlineId, srcIata, , dstIata, , codeshare, , equip] = row;
    if (codeshare === 'Y') continue;
    const airline = airlineById.get(airlineId);
    const from = byIata.get(srcIata);
    const to = byIata.get(dstIata);
    if (!airline || !from || !to || from.ident === to.ident) continue;
    const key = `${airline.icao}|${from.ident}|${to.ident}`;
    if (seen.has(key)) continue;
    const distance = km(from, to);
    if (distance < MIN_KM) continue;
    seen.add(key);
    // The equipment column is a space-separated list of IATA type codes, most
    // common first; one type per route is plenty for something you see from
    // three miles away.
    const type = (equip ?? '').trim().split(/\s+/)[0] || '';
    routes.push([
      intern(airlines, airlineIndex, airline.icao, [airline.icao, airline.iata, airline.callsign, airline.name]),
      intern(airports, airportIndex, from.ident, [from.ident, from.lat, from.lon, from.elevationFt]),
      intern(airports, airportIndex, to.ident, [to.ident, to.lat, to.lon, to.elevationFt]),
      intern(equipment, equipmentIndex, type, type),
      Math.round(distance),
    ]);
  }

  console.log('4/4 Schrijven');
  const payload = {
    source:
      'OpenFlights (openflights.org) route and airline data — Open Database License (ODbL), ' +
      'airport positions from OurAirports (public domain). Derived database, same licence.',
    airlineFields: ['icao', 'iata', 'callsign', 'name'],
    airportFields: ['ident', 'lat', 'lon', 'elevationFt'],
    routeFields: ['airline', 'from', 'to', 'equipment', 'km'],
    airlines,
    airports,
    equipment,
    routes,
  };
  await mkdir(dirname(out), { recursive: true });
  const json = JSON.stringify(payload);
  await writeFile(out, json);
  console.log(
    `    ${out} — ${Math.round(json.length / 1024)} kB, ${routes.length} routes, ` +
      `${airlines.length} maatschappijen, ${airports.length} vliegvelden`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
