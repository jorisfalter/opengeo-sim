// A runway you can land on, at any of the 29,460 fields in the index.
//
// The nine built airports have a surveyed platform under them, cut into the
// globe and drawn. Everywhere else nothing is drawn at all: what you see is
// the orthophoto draped over the terrain model, and what the wheels touch has
// to be that same surface or the two disagree in front of your eyes.
//
// They did disagree. Along a runway the terrain model has a few tens of
// centimetres of noise in it — flat ground sampled from space, 25 m apart and
// interpolated — and the roll-out at Deurne hobbled on it. The fix was to fit
// a straight line through the sampled heights and put the wheels on that, a
// runway being flat or evenly sloped. It is, and the terrain model is not:
// at Siegerland the model carries a three-metre hump over the middle of
// runway 13/31, so the straight line started three and a half metres above
// the drawn ground and then cut three metres into it. You take off from a
// hover and land inside a hill. That is what this file got wrong.
//
// Both numbers are now known, because OurAirports publishes the elevation of
// each threshold: Siegerland's runway runs 645.0 m down to 635.0 m, straight,
// and the model's hump is the model's. Knowing it does not let us put the
// wheels on it — a plane through the two thresholds floats seven metres over
// the drawn ground at one end — so this follows what is drawn, smoothed: the
// noise goes, the hump stays, and the aeroplane is always on the surface you
// can see. The hump is the terrain model's three metres over 1.6 km, which is
// a slope of two tenths of a per cent and nothing you can feel.
//
// Flattening the picture instead is the real answer and it is a bigger one:
// it means cutting the globe open at 29,460 fields and drawing a platform in
// the hole, with no photograph to put on it. See TODO.md.
import { Cartographic, sampleTerrainMostDetailed } from 'cesium';
import { runwayGround } from './airport.js';

const FT = 0.3048;
// One sample every sixty metres: finer than the terrain model has anything to
// say about (its cells are 25 to 30 m, and the tiles here are coarser still
// away from a city), coarse enough that a 2 km runway costs 34 probes.
const STEP_M = 60;
const MIN_SAMPLES = 9;
const MAX_SAMPLES = 41;

/**
 * The noise out, the shape kept. A five-point binomial over sixty-metre
 * spacing is a filter two hundred and forty metres wide: it flattens what the
 * model invents between two of its own cells and leaves anything a runway
 * could actually be doing. The ends are not pinned — they are terrain samples
 * like the others, and the strip hands back to the terrain there, so a single
 * noisy end sample would otherwise become a short steep ramp.
 */
function smooth(heights) {
  if (heights.length < 5) return heights;
  const weights = [1, 4, 6, 4, 1];
  return heights.map((_, i) => {
    let sum = 0;
    let total = 0;
    for (let k = -2; k <= 2; k += 1) {
      const j = i + k;
      if (j < 0 || j >= heights.length) continue;
      sum += heights[j] * weights[k + 2];
      total += weights[k + 2];
    }
    return sum / total;
  });
}

const samplesFor = (lengthM) =>
  Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.round(lengthM / STEP_M) + 1));

/**
 * Builds the ground probe for one field, or null when the terrain will not
 * answer for it. Async: it costs one round of terrain samples.
 */
export async function buildStrip(terrain, airport) {
  const runways = airport.runways.filter((runway) => runway.lengthFt > 0);
  if (!runways.length) return null;

  const plans = runways.map((runway) => ({
    runway,
    count: samplesFor(runway.lengthFt * FT),
  }));
  const probes = [];
  for (const plan of plans) {
    for (let i = 0; i < plan.count; i += 1) {
      const t = i / (plan.count - 1);
      probes.push(Cartographic.fromDegrees(
        plan.runway.leLon + (plan.runway.heLon - plan.runway.leLon) * t,
        plan.runway.leLat + (plan.runway.heLat - plan.runway.leLat) * t,
      ));
    }
  }
  await sampleTerrainMostDetailed(terrain, probes);

  const built = [];
  let at = 0;
  for (const plan of plans) {
    const slice = probes.slice(at, at + plan.count);
    at += plan.count;
    const heights = slice.map((point) => point.height);
    if (!heights.every((h) => Number.isFinite(h) && h > -500 && h < 9000)) continue;
    const level = smooth(heights);
    built.push({
      width: Math.max(18, (plan.runway.widthFt || 100) * FT),
      centre: slice.map((point, i) => ({
        lat: (point.latitude * 180) / Math.PI,
        lon: (point.longitude * 180) / Math.PI,
        h: level[i],
      })),
    });
  }
  if (!built.length) return null;

  const widest = Math.max(...built.map((runway) => runway.width)) / 2;
  // Nothing is drawn here, so the strip may only speak for the strip: a
  // corridor the width of the runway and a skirt that hands back to the
  // terrain within sixty metres of it.
  return runwayGround({ runways: built }, { full: widest + 10, fade: widest + 70 });
}
