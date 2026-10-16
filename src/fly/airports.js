// Every airfield in the world you could plausibly land at, from OurAirports.
//
// Public domain (Unlicense), so unlike X-Plane's GPL apt.dat it can simply be
// shipped. 28,338 fields with at least one runway — including the thousands
// whose ends OurAirports never surveyed, laid out from the runway number and
// length — and only fetched when somebody goes looking for somewhere to fly.
import { asset } from '../base.js';

const METERS_PER_DEGREE = 111320;
const FT = 0.3048;

let loading = null;
let index = null;

export function loadAirports() {
  if (index) return Promise.resolve(index);
  loading =
    loading ??
    fetch(asset('airports/index.json'))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        index = data.airports.map(([ident, name, lat, lon, elevationFt, country, runways]) => ({
          ident,
          name,
          lat,
          lon,
          elevationFt,
          country,
          runways: runways.map(([leLat, leLon, heLat, heLon, lengthFt, widthFt, surface, leId, heId]) => ({
            leLat, leLon, heLat, heLon, lengthFt, widthFt, surface, leId, heId,
          })),
        }));
        return index;
      });
  return loading;
}

export const airportsReady = () => index !== null;

/** Ident first, then name; short queries only match the ident. */
export function searchAirports(query, limit = 12) {
  if (!index) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const byIdent = [];
  const byName = [];
  for (const airport of index) {
    const ident = airport.ident.toLowerCase();
    if (ident === q) byIdent.unshift(airport);
    else if (ident.startsWith(q)) byIdent.push(airport);
    else if (q.length >= 3 && airport.name.toLowerCase().includes(q)) byName.push(airport);
    if (byIdent.length >= limit) break;
  }
  return [...byIdent, ...byName].slice(0, limit);
}

export function nearestAirports(lat, lon, count = 8, withinKm = 60) {
  if (!index) return [];
  const scale = Math.cos((lat * Math.PI) / 180);
  const limit = (withinKm * 1000) ** 2;
  const out = [];
  for (const airport of index) {
    const dLat = (airport.lat - lat) * METERS_PER_DEGREE;
    const dLon = (airport.lon - lon) * METERS_PER_DEGREE * scale;
    const d2 = dLat * dLat + dLon * dLon;
    if (d2 < limit) out.push({ airport, d2 });
  }
  out.sort((a, b) => a.d2 - b.d2);
  return out.slice(0, count).map((entry) => entry.airport);
}

/**
 * A place to start, lined up on the longest runway. The altitude is left to
 * the caller to take from the terrain: OurAirports gives an elevation above
 * sea level and this viewer works above the ellipsoid, and the difference
 * between the two is a different number in every part of the world.
 */
export function startFrom(airport) {
  const runway = airport.runways[0];
  if (!runway) return null;
  const scale = Math.cos((airport.lat * Math.PI) / 180);
  const dNorth = runway.heLat - runway.leLat;
  const dEast = (runway.heLon - runway.leLon) * scale;
  const heading = ((Math.atan2(dEast, dNorth) * 180) / Math.PI + 360) % 360;
  // A little way in from the threshold, so the wheels are on the strip.
  const f = Math.min(0.08, 60 / Math.max(60, runway.lengthFt * FT));
  return {
    id: `oa-${airport.ident}`,
    name: `${airport.ident} · ${airport.name}`,
    note: `${Math.round(runway.lengthFt * FT)} m ${runway.surface} · baan ${runway.leId || '?'}`,
    lat: runway.leLat + (runway.heLat - runway.leLat) * f,
    lon: runway.leLon + (runway.heLon - runway.leLon) * f,
    heading,
    terrainStart: true,
    onGround: true,
    speed: 0,
    gear: true,
    flaps: 1,
  };
}
