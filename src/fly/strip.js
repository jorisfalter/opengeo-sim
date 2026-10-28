// A runway you can land on, at any of the 28,338 fields in the index.
//
// The six built airports have a surveyed platform under them. Everywhere else
// the wheels are on the global terrain model, and along a runway that model
// has a few tens of centimetres of noise in it — flat ground sampled from
// space, 25 m apart, and interpolated. You cannot see it. You can feel it: the
// roll-out at Deurne hobbles.
//
// So this lays a paper runway. The terrain is sampled along each centreline, a
// straight line is fitted through those heights, and that line is the ground
// inside the strip, fading into the terrain at the edges. It is the same probe
// the built airports use — the difference is only where the centreline's
// heights come from, a fit to the DEM here and a survey there.
import { Cartographic, sampleTerrainMostDetailed } from 'cesium';
import { runwayGround } from './airport.js';

const FT = 0.3048;
const SAMPLES = 9; // along each runway, which is enough for a straight line

/**
 * Builds the ground probe for one field, or null when the terrain will not
 * answer for it. Async: it costs one terrain sample.
 */
export async function buildStrip(terrain, airport) {
  const runways = airport.runways.filter((runway) => runway.lengthFt > 0);
  if (!runways.length) return null;

  const probes = [];
  for (const runway of runways) {
    for (let i = 0; i < SAMPLES; i += 1) {
      const t = i / (SAMPLES - 1);
      probes.push(Cartographic.fromDegrees(
        runway.leLon + (runway.heLon - runway.leLon) * t,
        runway.leLat + (runway.heLat - runway.leLat) * t,
      ));
    }
  }
  await sampleTerrainMostDetailed(terrain, probes);

  const built = [];
  runways.forEach((runway, index) => {
    const slice = probes.slice(index * SAMPLES, (index + 1) * SAMPLES);
    const heights = slice.map((point) => point.height);
    if (!heights.every((h) => Number.isFinite(h) && h > -500 && h < 9000)) return;
    // Least squares, not the profile itself: a runway is flat or evenly
    // sloped, and following the DEM point by point would put the noise back
    // under the wheels, which is the whole thing being removed here. The fit
    // still meets the surrounding terrain at the ends, so there is no step
    // where the strip stops.
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    heights.forEach((h, i) => {
      sx += i;
      sy += h;
      sxy += i * h;
      sxx += i * i;
    });
    const n = SAMPLES;
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const base = (sy - slope * sx) / n;
    built.push({
      width: Math.max(18, (runway.widthFt || 100) * FT),
      centre: slice.map((point, i) => ({
        lat: (point.latitude * 180) / Math.PI,
        lon: (point.longitude * 180) / Math.PI,
        h: base + slope * i,
      })),
    });
  });
  if (!built.length) return null;

  const widest = Math.max(...built.map((runway) => runway.width)) / 2;
  // Nothing is drawn here, so the strip may only speak for the strip: a
  // corridor the width of the runway and a skirt that hands back to the
  // terrain within sixty metres of it.
  return runwayGround({ runways: built }, { full: widest + 10, fade: widest + 70 });
}
