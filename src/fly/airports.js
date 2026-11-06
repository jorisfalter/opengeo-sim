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
          runways: runways.map(
            ([leLat, leLon, heLat, heLon, lengthFt, widthFt, surface, leId, heId, leDisp, heDisp]) => ({
              leLat, leLon, heLat, heLon, lengthFt, widthFt, surface, leId, heId,
              leDisplacedFt: leDisp ?? 0,
              heDisplacedFt: heDisp ?? 0,
            }),
          ),
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
 * The longest runway, straightened out: where its middle is, which way it
 * points, and how long it is. Everything that needs to know where a field
 * lies — the map tick and the place you start from — takes it from here, so
 * that the two can never disagree.
 *
 * OurAirports is a crowd-sourced index, and its two end coordinates are the
 * weakest thing in it. Three corrections, in order of how sure they are:
 *
 * 1. **The length is the declared one.** `length_ft` is the published runway
 *    length; the distance between the two end coordinates is whatever the
 *    person who plotted them managed. They disagree by more than forty metres
 *    on one surveyed single-runway field in six. The published number wins,
 *    and the line is trimmed to it about its own middle.
 *
 * 2. **A line that cannot measure itself cannot place itself either.** When
 *    those two lengths disagree by more than forty metres the end coordinates
 *    are demonstrably wrong, and the only other evidence about where the
 *    field is sits in the airport record. If that point is between ten and a
 *    hundred and fifty metres to one side of the line, the line is slid
 *    sideways onto it. Outside that band it is left alone: at ten metres
 *    there is nothing to win, and past a hundred and fifty the airport point
 *    is the terminal building and not the runway at all.
 *
 *    This is Aix-les-Milles, where the pilot who reported standing in the
 *    grass was standing in the grass. Measured against the IGN orthophoto,
 *    OurAirports' line for LFMA runs fifty-seven metres east of the pavement
 *    and ninety-seven metres long; the airport point is sixty metres west of
 *    that line, which is to say on the centreline, within the accuracy of
 *    the measurement. Two independent errors do not agree like that.
 *
 * 3. **The displaced threshold is published data we were throwing away.**
 *    Nearly one runway in eleven has one, and at LFMA it is fifty metres.
 */
export function runwayLine(airport) {
  const runway = airport.runways[0];
  if (!runway) return null;
  const scale = Math.cos((airport.lat * Math.PI) / 180);
  const north = (runway.heLat - runway.leLat) * METERS_PER_DEGREE;
  const east = (runway.heLon - runway.leLon) * METERS_PER_DEGREE * scale;
  const span = Math.hypot(north, east);
  const length = runway.lengthFt * FT;
  const off = Math.abs(span - length);

  // 0. A hundred and fifty rows in the index have two ends that are not two
  //    ends of anything: the same point twice, or two points eight thousand
  //    kilometres apart. Those are not a runway that needs correcting, they
  //    are a runway that has to be put back by hand — around the airport
  //    position, on the heading its number gives, which is what the build
  //    step already does for the thousands of fields whose ends were never
  //    surveyed at all. Within a couple of degrees, because the number is
  //    magnetic and this is drawn true.
  const numbered = /^\s*(\d{1,2})/.exec(runway.leId ?? '');
  const bearing = numbered ? Number(numbered[1]) * 10 : NaN;
  if (!(span > 1) || off > Math.max(150, length * 0.35)) {
    if (!(bearing >= 10 && bearing <= 360)) return null;
    const radians = (bearing * Math.PI) / 180;
    return {
      icao: airport.ident,
      name: airport.name,
      lat: airport.lat,
      lon: airport.lon,
      heading: bearing % 360,
      length,
      alongN: Math.cos(radians),
      alongE: Math.sin(radians),
      runway,
      suspect: true,
      moved: 0,
      laidOut: true,
    };
  }

  // Along the runway, and across it.
  const alongN = north / span;
  const alongE = east / span;
  const acrossN = -alongE;
  const acrossE = alongN;

  let lat = (runway.leLat + runway.heLat) / 2;
  let lon = (runway.leLon + runway.heLon) / 2;
  const suspect = off > 40;
  let moved = 0;
  if (suspect) {
    const offset =
      (airport.lon - lon) * METERS_PER_DEGREE * scale * acrossE +
      (airport.lat - lat) * METERS_PER_DEGREE * acrossN;
    if (Math.abs(offset) > 10 && Math.abs(offset) < 150) {
      lat += (offset * acrossN) / METERS_PER_DEGREE;
      lon += (offset * acrossE) / (METERS_PER_DEGREE * scale);
      moved = offset;
    }
  }

  return {
    icao: airport.ident,
    name: airport.name,
    lat,
    lon,
    heading: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360,
    length,
    alongN,
    alongE,
    runway,
    suspect,
    moved,
    laidOut: false,
  };
}

/**
 * Where a field lies, for drawing it. The map wants the same line the start
 * is put on, so it asks for it rather than working it out twice.
 */
export function runwayMark(airport) {
  const line = runwayLine(airport);
  if (!line) return null;
  const { icao, name, lat, lon, heading, length } = line;
  return { icao, name, lat, lon, heading, length };
}

/**
 * A place to start, lined up on the longest runway. The altitude is left to
 * the caller to take from the terrain: OurAirports gives an elevation above
 * sea level and this viewer works above the ellipsoid, and the difference
 * between the two is a different number in every part of the world.
 *
 * Measured back from the middle of the strip rather than forward from an end
 * coordinate, because the middle is the part of the line worth trusting: an
 * error at either end moves it by half as much, and an error at both ends
 * that is the same size moves it not at all.
 */
export function startFrom(airport) {
  const line = runwayLine(airport);
  if (!line) return null;
  const { runway, length, alongN, alongE } = line;
  // Far enough in to be past the piano keys and on the strip, never so far
  // that a short field has no runway left in front of it.
  const inset = Math.min(90, Math.max(30, length * 0.05));
  const displaced = (runway.leDisplacedFt ?? 0) * FT;
  const back = Math.max(length * 0.1, length / 2 - displaced - inset);
  const scale = Math.cos((airport.lat * Math.PI) / 180);
  return {
    id: `oa-${airport.ident}`,
    name: `${airport.ident} · ${airport.name}`,
    note: `${Math.round(length)} m ${runway.surface} · runway ${runway.leId || '?'}`,
    lat: line.lat - (back * alongN) / METERS_PER_DEGREE,
    lon: line.lon - (back * alongE) / (METERS_PER_DEGREE * scale),
    heading: line.heading,
    elevationFt: airport.elevationFt,
    terrainStart: true,
    onGround: true,
    speed: 0,
    gear: true,
    flaps: 1,
  };
}
