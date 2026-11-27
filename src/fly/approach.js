/**
 * The glide path: an approach built out of geometry, not out of radio.
 *
 * There is no ILS in this simulator and there cannot be one. The field index
 * comes from OurAirports, which is public domain and is why it is used; its
 * `navaids` table holds eleven thousand beacons and not one localizer or
 * glideslope. The installations themselves — frequency, course, the angle a
 * particular mountain field steepens its path to — live in databases we may
 * not ship: X-Plane's `earth_nav.dat` is GPL, openAIP needs a key and forbids
 * commercial use. `scripts/build-airport-index.mjs` already refuses apt.dat
 * for the same reason.
 *
 * What we do have is where the pavement is. Eleven French runways and nine
 * Portuguese ones were measured off the orthophoto this month to twenty
 * centimetres, and every other one has a published length, heading and
 * displaced threshold. From that, a standard final approach is arithmetic:
 * a 3° slope to a point fifty feet over the threshold. That is what a PAPI
 * shows you out of the window and what an RNAV approach flies, and neither
 * needs a transmitter on the ground.
 *
 * So the geometry is exact and the thing it describes is named honestly: this
 * is a 3° glide path to a surveyed threshold, not runway 27's ILS.
 *
 * Nothing here touches Cesium or the DOM — see papi.js for the lights and
 * panel.js for the glass.
 */
import { runwayLine, plainLine } from './airports.js';

const M = 111320;
const FT = 0.3048;
const DEG = Math.PI / 180;

/** The slope. Three degrees is the standard everywhere it is not impossible. */
export const GLIDE_DEG = 3;
/** Threshold crossing height: where the path ends, fifty feet over the bar. */
export const TCH_FT = 50;
/** Full-scale localizer deflection, the real ±2.5° of a course sector. */
export const LOC_FULL_DEG = 2.5;
/** Full-scale glideslope deflection, the real ±0.7°. */
export const GS_FULL_DEG = 0.7;
/**
 * The four PAPI units, from the one nearest the runway outwards. The nearest
 * carries the steepest setting, so on a correct 3° path the two nearest the
 * asphalt are red and the two outside them white — that is the picture, and
 * it is this way round because the angles are.
 */
export const PAPI_ANGLES = [3.5, 3.1667, 2.8333, 2.5];
/** How far out the needles come alive: 25 NM, and within 35° of the course. */
export const RANGE_M = 46300;
export const CAPTURE_DEG = 35;
/**
 * The shortest runway worth an approach.
 *
 * Nothing below about six hundred metres carries published approach guidance
 * anywhere, and a glider strip does not have a PAPI beside it. Siegerland is
 * the case that forced the number: beside its 1620 m runway the index lists a
 * 600 m grass strip, a 500 m cross strip and a 300 m glider lane, and standing
 * on the 13 threshold the aeroplane was told it was approaching the glider
 * lane — which was true of the geometry and nonsense in the cockpit.
 */
export const MIN_LENGTH_M = 600;

const metres = (from, to) => ({
  n: (to.lat - from.lat) * M,
  e: (to.lon - from.lon) * M * Math.cos(from.lat * DEG),
});

const wrap = (deg) => {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

/** One landable direction: where its threshold is and which way it points. */
function end(airport, strip, runway, which) {
  const length = strip.length;
  const rad = strip.heading * DEG;
  const alongN = Math.cos(rad);
  const alongE = Math.sin(rad);
  const low = which === 'le';
  // The displaced threshold is published data and it moves the aiming point,
  // so it moves the path: a glide path to the painted end of the pavement at
  // a field with three hundred metres of displacement is three hundred metres
  // of approach lights you would be landing on.
  const displaced = ((low ? runway.leDisplacedFt : runway.heDisplacedFt) ?? 0) * FT;
  const back = (length / 2 - displaced) * (low ? -1 : 1);
  const scale = Math.cos(airport.lat * DEG);
  // The height the path aims at is the height of *this* threshold, which is
  // not the field elevation: the field's is one number for the whole aerodrome
  // and is usually the highest point of the landing area. OurAirports has both
  // thresholds for twelve thousand runways; where it does not, the field
  // elevation is the only number there is and the path says so.
  const published = low ? runway.leElevationFt : runway.heElevationFt;
  const elevFt = Number.isFinite(published) ? published : (airport.elevationFt ?? 0);
  return {
    ident: airport.ident,
    name: airport.name,
    runway: (low ? runway.leId : runway.heId) || '?',
    lat: strip.lat + (back * alongN) / M,
    lon: strip.lon + (back * alongE) / (M * scale),
    course: ((strip.heading + (low ? 0 : 180)) % 360 + 360) % 360,
    elevFt,
    // Whether that height is the threshold's own or the whole field's, because
    // on a sloping runway the difference is the difference between a glide
    // path and a guess, and nothing downstream should have to assume.
    surveyedEnd: Number.isFinite(published),
    // Runway lighting, the one thing OurAirports says about what is installed
    // here. A PAPI is not an edge light, but an unlit runway has neither.
    lighted: Boolean(runway.lighted),
    lengthM: length,
    widthM: Math.max(18, (runway.widthFt ?? 100) * FT),
    displacedM: displaced,
    measured: Boolean(runway.measured),
  };
}

/**
 * Every direction you could land at a field, both ends of every runway.
 *
 * A runway the index could not place is left out rather than approached. When
 * the two end coordinates disagree with the published length by more than a
 * third, `runwayLine` falls back to laying the strip out around the airport
 * point on the heading in its number — good enough to start an aeroplane on,
 * nowhere near good enough to hang a glide path on, because the thing it
 * describes may be a few hundred metres from the real asphalt. A path to a
 * guessed threshold is worse than no path at all: it looks exactly as
 * convincing as a correct one.
 */
export function approachEnds(airport) {
  if (!airport?.runways?.length) return [];
  const out = [];
  const main = runwayLine(airport);
  if (main && !main.laidOut && main.length >= MIN_LENGTH_M) {
    const strip = { lat: main.lat, lon: main.lon, heading: main.heading, length: main.length };
    out.push(end(airport, strip, main.runway, 'le'), end(airport, strip, main.runway, 'he'));
  }
  for (const runway of airport.runways.slice(1)) {
    const strip = plainLine(airport, runway);
    if (strip && strip.length >= MIN_LENGTH_M) {
      out.push(end(airport, strip, runway, 'le'), end(airport, strip, runway, 'he'));
    }
  }
  return out;
}

/**
 * The end you are actually arriving at.
 *
 * Two things decide it, the way they decide it in the cockpit: where you are
 * — is this end's extended centreline pointing at you — and where you are
 * heading. Position alone picks nonsense overhead the field, where every end
 * is equally "out there"; heading alone picks the runway you happen to be
 * tracking across the circuit. The sum of the two, with position counting
 * more, picks what a pilot would call downwind for.
 */
export function pickEnd(ends, aircraft) {
  const scored = ends.map((approach) => {
    const d = metres(approach, aircraft);
    const toPlane = (Math.atan2(d.e, d.n) / DEG + 360) % 360;
    // Zero when the aeroplane sits straight out on this end's final.
    const offCourse = Math.abs(wrap(toPlane - ((approach.course + 180) % 360)));
    const heading = aircraft.heading === undefined ? null : (aircraft.heading / DEG + 360) % 360;
    const offHeading = heading === null ? 0 : Math.abs(wrap(heading - approach.course));
    return { score: offCourse + offHeading * 0.6, approach };
  });
  if (!scored.length) return null;
  scored.sort((a, b) => a.score - b.score);
  // Parallel runways are the same geometry twice and score within a degree of
  // each other, so geometry cannot separate them and something else has to:
  // the longer one, which is the one with the approach lights, the longer
  // taxi-off and the published procedure. Fifteen degrees is wide enough to
  // hold two parallels and far too narrow to reach a crossing runway.
  const close = scored.filter((entry) => entry.score <= scored[0].score + 15);
  close.sort((a, b) => b.approach.lengthM - a.approach.lengthM);
  return close[0].approach;
}

/**
 * Where you are relative to the path, in the units a cockpit uses.
 *
 * `locDeg` and `gsDeg` are the angular errors — positive is right of course
 * and above the path — and the dots are those errors over a real full-scale
 * deflection, so one dot here means what one dot means on a PFD rather than
 * whatever looked right on screen. `altFt` is above mean sea level, the same
 * datum the field elevation is published on.
 */
export function deviation(approach, aircraft, altFt) {
  const d = metres(approach, aircraft);
  const rad = approach.course * DEG;
  const along = d.n * Math.cos(rad) + d.e * Math.sin(rad);
  const across = -d.n * Math.sin(rad) + d.e * Math.cos(rad);
  const toGo = -along; // metres still to fly to the threshold; negative is past it
  const heightFt = altFt - (approach.elevFt + TCH_FT);
  // Beyond the threshold there is no approach left to be off, and close in
  // the angles blow up: a hundred metres out, ten metres left is 6°.
  const base = Math.max(toGo, 150);
  const locDeg = (Math.atan2(across, base) / DEG);
  const slopeDeg = Math.atan2(heightFt * FT, base) / DEG;
  const targetFt = approach.elevFt + TCH_FT + (Math.max(toGo, 0) * Math.tan(GLIDE_DEG * DEG)) / FT;
  const live =
    toGo > 200 && toGo < RANGE_M && Math.abs(locDeg) < CAPTURE_DEG && heightFt > -100;
  return {
    toGo,
    across,
    heightFt,
    locDeg,
    gsDeg: slopeDeg - GLIDE_DEG,
    slopeDeg,
    locDots: locDeg / LOC_FULL_DEG,
    gsDots: (slopeDeg - GLIDE_DEG) / GS_FULL_DEG,
    targetFt,
    live,
  };
}

/**
 * Where the PAPI stands, and which way its lamps look.
 *
 * Left of the runway, abeam the aiming point, four units in a row running
 * away from the asphalt — which is where it is at the fields this draws it
 * at. The aiming point is three hundred metres in from the threshold on
 * anything long enough to have one; on a six-hundred-metre strip it is
 * proportional, because three hundred metres would put the lights halfway
 * down it.
 */
export function papiUnits(approach) {
  const rad = approach.course * DEG;
  const alongN = Math.cos(rad);
  const alongE = Math.sin(rad);
  const leftN = Math.sin(rad);
  const leftE = -Math.cos(rad);
  const aim = Math.min(300, Math.max(120, approach.lengthM * 0.25));
  const scale = Math.cos(approach.lat * DEG);
  return PAPI_ANGLES.map((angle, i) => {
    const out = approach.widthM / 2 + 15 + i * 9;
    return {
      angle,
      lat: approach.lat + (aim * alongN + out * leftN) / M,
      lon: approach.lon + (aim * alongE + out * leftE) / (M * scale),
    };
  });
}

/**
 * What a lamp shows from where you are: white above its setting, red below.
 *
 * This is the whole of a PAPI. There is no logic above the four lamps and no
 * picture to look up — each unit is a split beam, and which half of it you
 * are in is a question about one angle.
 */
export function papiColours(approach, aircraft, altFt) {
  const units = papiUnits(approach);
  return units.map((unit) => {
    const d = metres(unit, aircraft);
    const range = Math.hypot(d.n, d.e);
    // The lamp itself sits about a metre over the grass, which matters at a
    // hundred metres and not at all at ten kilometres.
    const lampFt = approach.elevFt + 3.3;
    const angle = Math.atan2((altFt - lampFt) * FT, Math.max(1, range)) / DEG;
    return { ...unit, range, white: angle >= unit.angle };
  });
}
