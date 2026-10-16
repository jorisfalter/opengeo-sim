// Ground height under the aircraft, anywhere in the world.
//
// The flight model needs a terrain height every frame, synchronously, and
// Cesium offers nothing that does that well. `Globe.getHeight` only knows
// tiles the camera has already drawn, so it is empty ahead of you and wrong
// behind you, and `sampleTerrainMostDetailed` is a network call.
//
// So this keeps a grid of sampled heights that follows the aircraft: resampled
// asynchronously as it moves, read synchronously with bilinear interpolation.
// The grid's span follows the height above ground — a hundred metres of
// resolution matters on short final and not at all in the cruise — so flying
// low asks for a small, fine patch and flying high for a large, coarse one.
import { Cartographic, sampleTerrainMostDetailed } from 'cesium';

const METERS_PER_DEGREE = 111320;
const SIDE = 33; // grid is SIDE × SIDE samples, 1089 points a request

export function createTerrainService(terrain, { onError } = {}) {
  let grid = null; // { lat0, lon0, dLat, dLon, span, heights: Float64Array }
  let pending = false;
  let failures = 0;

  // How much ground to cover. Height sets the resolution it is worth having —
  // a hundred metres matters on final and not at all in the cruise — and speed
  // sets how much is needed, because a patch has to outlast the time it takes
  // to sample the next one. Getting the second term wrong is how the aeroplane
  // flew off the edge of its own terrain and landed on the last height it had.
  // The cap is high because of time acceleration: at sixteen times speed the
  // aeroplane covers two kilometres of ground a second, and a forty kilometre
  // patch is gone before the next one has been fetched. Up there the samples
  // are kilometres apart and that is fine — nothing is about to touch it.
  const spanFor = (agl, speed) =>
    Math.min(120000, Math.max(1600, Math.abs(agl) * 4 + Math.abs(speed) * 30 + 1600));

  async function resample(lat, lon, span) {
    pending = true;
    const halfLat = span / 2 / METERS_PER_DEGREE;
    const halfLon = halfLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const lat0 = lat - halfLat;
    const lon0 = lon - halfLon;
    const dLat = (halfLat * 2) / (SIDE - 1);
    const dLon = (halfLon * 2) / (SIDE - 1);

    const points = [];
    for (let row = 0; row < SIDE; row += 1) {
      for (let col = 0; col < SIDE; col += 1) {
        points.push(Cartographic.fromDegrees(lon0 + col * dLon, lat0 + row * dLat));
      }
    }
    try {
      await sampleTerrainMostDetailed(terrain, points);
      const heights = new Float64Array(points.length);
      let usable = 0;
      for (let i = 0; i < points.length; i += 1) {
        const height = points[i].height;
        // A hole in the terrain reads as undefined or as a wild value; both
        // would be fed to the landing gear, so neither is allowed through.
        heights[i] = Number.isFinite(height) && height > -500 && height < 9000 ? height : NaN;
        if (!Number.isNaN(heights[i])) usable += 1;
      }
      if (usable > points.length * 0.5) {
        grid = { lat0, lon0, dLat, dLon, span, heights };
        failures = 0;
      } else {
        failures += 1;
      }
    } catch (error) {
      failures += 1;
      onError?.(error);
    } finally {
      pending = false;
    }
  }

  return {
    /**
     * Called every frame. Decides whether the patch still covers where the
     * aircraft is going and, if not, starts a new one — centred ahead of the
     * aircraft, because that is where it will need the ground next.
     */
    update({ lat, lon, agl, speed = 0, heading = 0 }) {
      if (pending || failures > 4) return;
      const want = spanFor(agl, speed);
      // Lead the aircraft, but never so far that it sits on the edge of its
      // own patch: a fifth of the span, no more.
      const lead = Math.min(want * 0.2, speed * 12);
      const aheadLat = lat + (Math.cos(heading) * lead) / METERS_PER_DEGREE;
      const aheadLon =
        lon +
        (Math.sin(heading) * lead) /
          (METERS_PER_DEGREE * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));

      if (!grid) {
        resample(aheadLat, aheadLon, want);
        return;
      }
      // Resample when the aircraft nears the edge of the patch, or when the
      // resolution no longer suits the height it is flying at.
      const centreLat = grid.lat0 + ((SIDE - 1) * grid.dLat) / 2;
      const centreLon = grid.lon0 + ((SIDE - 1) * grid.dLon) / 2;
      const offLat = Math.abs(lat - centreLat) / ((SIDE - 1) * grid.dLat);
      const offLon = Math.abs(lon - centreLon) / ((SIDE - 1) * grid.dLon);
      const wrongSize = want < grid.span * 0.45 || want > grid.span * 2.2;
      if (offLat > 0.22 || offLon > 0.22 || wrongSize) resample(aheadLat, aheadLon, want);
    },

    /**
     * Height in metres above the ellipsoid, or null when outside the patch.
     *
     * `conservative` returns the highest of the four surrounding samples
     * instead of interpolating between them. The patch is sampled every fifty
     * metres or so and the rendered terrain is finer than that, so in a steep
     * valley the interpolated value can sit well below the hillside you can
     * see — and the aeroplane then flies into it and ends up inside the
     * ground, looking at the black underside of the world. Biasing upward
     * close to the ground trades a slightly early touchdown on rough terrain
     * for not being swallowed by it.
     */
    heightAt(lat, lon, conservative = false) {
      if (!grid) return null;
      const x = (lon - grid.lon0) / grid.dLon;
      const y = (lat - grid.lat0) / grid.dLat;
      if (x < 0 || y < 0 || x > SIDE - 1 || y > SIDE - 1) return null;
      const col = Math.min(SIDE - 2, Math.floor(x));
      const row = Math.min(SIDE - 2, Math.floor(y));
      const fx = x - col;
      const fy = y - row;
      const at = (r, c) => grid.heights[r * SIDE + c];
      const a = at(row, col);
      const b = at(row, col + 1);
      const c = at(row + 1, col);
      const d = at(row + 1, col + 1);
      if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) {
        // On the edge of a hole, take the nearest sample that is real.
        for (const value of [a, b, c, d]) if (!Number.isNaN(value)) return value;
        return null;
      }
      if (conservative) return Math.max(a, b, c, d);
      return (
        a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
      );
    },

    get ready() {
      return grid !== null;
    },
  };
}
