// Every airfield in the world you could plausibly land at, from OurAirports.
//
// Public domain (Unlicense), so unlike X-Plane's GPL apt.dat it can simply be
// shipped. 28,338 fields with at least one runway — including the thousands
// whose ends OurAirports never surveyed, laid out from the runway number and
// length — and only fetched when somebody goes looking for somewhere to fly.
import { asset } from '../base.js';

const METERS_PER_DEGREE = 111320;
const FT = 0.3048;

/**
 * Runway ends measured off the orthophoto, for the fields where no rule can
 * reach them.
 *
 * The four corrections in `runwayLine` below all work by playing the record's
 * own numbers off against each other: a length that contradicts the ends, a
 * pair of ends that are not ends. Rozas, by Lugo, contradicts nothing. Its two
 * ends are internally perfect — 1193 m against a declared 1200, bearing 36 for
 * a runway called 04 — and both of them are in the heath, 550 m
 * west-north-west of the asphalt. The whole line is simply translated.
 *
 * Nothing in the data gives it away, and this was tested rather than assumed:
 *
 * - The airport position is 501 m to one side of the line, which is the
 *   signature of a displaced line. It is also the signature of a terminal
 *   building. At Burgos — single runway, 2100 m, 444 m to one side, the same
 *   numbers to within a tenth — the line is right and the airport point is the
 *   apron. 327 single-runway fields sit in that band and the two cases are
 *   indistinguishable from the record.
 * - A runway is flat, so a line that crosses a slope is not on one. Sampled
 *   at twenty-five stations on the Terrarium DEM, Rozas' wrong line spreads
 *   11.9 m and the real one 9.7 m, while Burgos' correct line spreads 12.2 m.
 *   Rolling Galician heath at 30 m postings is as flat as a runway. The test
 *   does work on the gross cases — El Castaño's line spreads 73.9 m against
 *   its real 16 m — but it cannot see this one.
 *
 * So the photograph settles it. All 137 Spanish fields in the index were put
 * to it: score the line the record gives, search the neighbourhood for the
 * best runway-shaped line — a band of one material flanked on both sides by
 * another, which is colour-free, because Spanish asphalt runs from Rozas'
 * pale grey through El Castaño's blue to Beas de Segura's warm sand — and
 * draw both on the photograph. The search cannot be trusted on its own: it
 * prefers a parallel taxiway to the runway beside it, because a taxiway is
 * unmarked, unworn and therefore more uniform than a runway. At Ciudad Real,
 * Bilbao, Albacete and Alicante that is exactly what it chose. So the search
 * only draws, and every one of the 137 was looked at.
 *
 * Twelve were wrong. They are all small: the big airports have been surveyed
 * by many eyes and every one of them is right, down to Getafe and Zaragoza,
 * where the photograph is blurred for being military and the line still lands
 * on the strip under the blur.
 *
 * Each line below was read off the orthophoto at zoom 18, about 1.3 m to the
 * pixel, from threshold to threshold, and checked by drawing it back over the
 * photograph with the start point marked. Lengths come out within 4% of the
 * declared length at ten of the twelve. Headings mostly agree with the runway
 * number; where they do not — Beas de Segura measures 101 for a runway called
 * 09, Benagéber 102 for one called 12 — the photograph wins, because a
 * painted number is rounded to ten degrees and sometimes to the magnetic
 * north of decades ago.
 *
 * Keyed by the runway's low-end identifier, so a field with two strips only
 * has the measured one replaced.
 */
const MEASURED = {
  // Rozas, by Lugo: 1202 m of pavement against a declared 1200, 45-48 m wide
  // against a declared 45, bearing 35.1, midpoint 2 m from the published
  // airport position.
  LERO: { '04': [43.11158, -7.46785, 43.1204, -7.45936] },
  // El Castaño: the record's line shares the south-east threshold and then
  // runs off into the hills on a bearing 106 degrees out.
  LECT: { '14': [39.0183, -4.39363, 39.0089, -4.38065] },
  LEBE: { '09': [38.27304, -2.96105, 38.27058, -2.9453] },
  LETI: { '05': [40.24441, -4.79332, 40.25094, -4.78563] },
  LEMR: { '10': [43.43082, -5.83332, 43.43048, -5.82028] },
  LEOC: { '11': [39.93803, -3.50751, 39.93658, -3.4935] },
  LERE: { '12': [39.47606, -1.03987, 39.47327, -1.02976] },
  LECD: { '07': [42.38488, 1.85663, 42.3889, 1.86936] },
  LECF: { '13': [41.74647, 1.55392, 41.7428, 1.56184] },
  // Garray parks you on the apron among the parked aeroplanes; the strip is
  // 135 m north of it.
  LEGY: { '09': [41.82124, -2.47831, 41.82119, -2.47449] },
  'ES-0219': { '06': [40.02471, -4.0714, 40.02666, -4.06702] },
  'ES-0088': { '12': [39.73586, -1.14414, 39.73416, -1.13335] },
  // Air Marugán's strip is marked and unmistakable, and it runs 112, not the
  // 170 its number claims; the record's line crosses it at 58 degrees. Its
  // declared 668 m is also half as long again as the 470 m of pavement, so
  // the start lands short of the threshold on the grass, lined up with it.
  'ES-0069': { '17': [40.91079, -4.372, 40.90924, -4.3668] },
  // Portugal, measured on DGT's 25 cm aerial mosaic the same way.
  LPAV: { '17': [40.66326, -8.7436, 40.65339, -8.74036] },
  LPCO: { '16': [40.16292, -8.47358, 40.15553, -8.46865] },
  // Espinho's line lies in the grass east of the strip; the threshold bars
  // and the 35 are on the pavement the measured line runs down.
  LPIN: { '17': [40.97717, -8.64576, 40.97317, -8.64493] },
  // Ponte de Sor is the one field measured on the 2023 satellite layer
  // instead: in the 2018 aerial photography the runway is still a building
  // site, and a strip of bare earth has no centreline to measure to.
  LPSO: { '03': [39.20592, -8.0612, 39.22021, -8.0526] },
  LPVL: { '16': [41.28599, -8.5217, 41.2716, -8.51236] },
  LPVR: { '02': [41.27031, -7.72277, 41.27721, -7.71968] },
  LP77: { '15': [39.40494, -8.29323, 39.39747, -8.28453] },
  // France, off IGN's BD ORTHO. Carpentras' line is 254 m southwest of its
  // asphalt, in the vineyards, and 295 m of it lies on anything paved at all
  // against the 1051 m the runway actually runs. The ends here are the
  // centreline fitted through the two painted edge stripes at 58 stations —
  // median width 18.7 m against a declared 20 — so the line sits within two
  // metres of the middle over the whole kilometre.
  LFNH: { '13': [44.03096, 5.07944, 44.02464, 5.08921] },
  // Ajaccio's line is a good line in the wrong lane: fitted to the edge
  // stripes it sits 47 m to one side, which on a 45 m runway is the shoulder.
  // Measured over 54 of 61 stations, median width 43.8 m against a declared
  // 45, both ends on the threshold bars beside the painted 02 and 20.
  LFKJ: { '02': [41.91219, 8.79515, 41.9294, 8.80586] },
};

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
            ([leLat, leLon, heLat, heLon, lengthFt, widthFt, surface, leId, heId, leDisp, heDisp]) => {
              // The index is a faithful copy of OurAirports; the handful of
              // rows measured off an orthophoto are corrected here, on the way
              // in, so that every reader of it sees the same runway.
              const measured = MEASURED[ident]?.[leId];
              const [a, b, c, d] = measured ?? [leLat, leLon, heLat, heLon];
              return {
                leLat: a, leLon: b, heLat: c, heLon: d,
                measured: Boolean(measured),
                lengthFt, widthFt, surface, leId, heId,
                leDisplacedFt: leDisp ?? 0,
                heDisplacedFt: heDisp ?? 0,
              };
            },
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
  if (!runway.measured && (!(span > 1) || off > Math.max(150, length * 0.35))) {
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
  // A measured line is not corrected towards anything. The two rules below
  // exist to rescue a line whose own numbers betray it; these ends were read
  // off the photograph, and at Garray and Air Marugán the airport position
  // they would slide towards is the apron.
  const suspect = !runway.measured && off > 40;
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
 * The plain geometry of one runway — midpoint, heading, length — with none of
 * the corrections `runwayLine` applies.
 *
 * Those corrections exist to put the *aeroplane* somewhere sensible, and two
 * of the three only make sense for the runway a field is named after. Sliding
 * a centreline towards the published airport reference point is right when
 * the field is one strip and the reference point is on it; at a two-runway
 * field the reference point sits between them, on neither. Laying a runway
 * out around that point on the heading in its number is right when the
 * alternative is a start position on another continent; as a line on a map it
 * would draw a second runway straight through the terminal.
 *
 * So a secondary runway is drawn where the data says or it is not drawn.
 */
function plainLine(airport, runway) {
  const scale = Math.cos((airport.lat * Math.PI) / 180);
  const north = (runway.heLat - runway.leLat) * METERS_PER_DEGREE;
  const east = (runway.heLon - runway.leLon) * METERS_PER_DEGREE * scale;
  const span = Math.hypot(north, east);
  const length = runway.lengthFt * FT;
  if (!(span > 1) || Math.abs(span - length) > Math.max(150, length * 0.35)) return null;
  return {
    lat: (runway.leLat + runway.heLat) / 2,
    lon: (runway.leLon + runway.heLon) / 2,
    heading: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360,
    length,
  };
}

/**
 * Where a field lies, for drawing it. The map wants the same line the start
 * is put on, so it asks for it rather than working it out twice.
 *
 * `strips` is every runway the field has, the start's first. A large field is
 * a layout rather than a line — Marseille has two parallel strips, Schiphol
 * has four at three angles — and a map that draws one of them is telling you
 * something false about where you could put down. The index has carried all
 * of them all along; only this function was throwing them away.
 */
export function runwayMark(airport) {
  const line = runwayLine(airport);
  if (!line) return null;
  const { icao, name, lat, lon, heading, length } = line;
  const strips = [{ lat, lon, heading, length }];
  for (const runway of airport.runways.slice(1)) {
    const extra = plainLine(airport, runway);
    if (extra) strips.push(extra);
  }
  return { icao, name, lat, lon, heading, length, strips };
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
