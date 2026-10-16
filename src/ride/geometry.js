// Turns the flat arrays from scripts/build-ride.mjs into a 3D track and a
// camera pose lookup.
//
// Heights: the builder stores AHN railhead and ground heights in metres NAP,
// and the rendered terrain uses its own datum (roughly NAP + 43 m).
//
// The two models also disagree about what ground *is*: AHN often classifies a
// bridge deck as terrain, while the rendered DTM shows the water underneath. So
// the railhead cannot be derived from the difference between them — on a bridge
// that difference collapses to zero and the camera drops to the canal.
//
// Instead the NAP profile is kept as-is and shifted into the render datum by a
// single offset, measured as the median difference between the two models at
// points that are not on a structure. A floor at terrain + a small clearance
// keeps the track from sinking into the rendered ground where they disagree.
import { Cartesian3, Cartographic, sampleTerrainMostDetailed } from 'cesium';

const TERRAIN_PROBE_STEP = 10; // sample every Nth axis point, interpolate between
const RAIL_GAUGE_HALF = 0.7175; // 1435 mm standard gauge
const DEFAULT_RAIL_OFFSET = 0.4;
const MIN_CLEARANCE = 0.3; // never let the track sink into the rendered terrain
// ...but only lift it this far. The rendered terrain mesh has road viaducts
// baked into it here and there, and following one of those would put the train
// on top of the motorway bridge it is supposed to pass underneath.
const MAX_TERRAIN_LIFT = 1.5;
const METERS_PER_DEGREE_LAT = 111320;

const lerp = (a, b, t) => a + (b - a) * t;

/** Metres east/north to a lat/lon offset around a reference latitude. */
function offsetDegrees(lat, east, north) {
  const lonScale = METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  return { dLat: north / METERS_PER_DEGREE_LAT, dLon: east / lonScale };
}

/**
 * Polygon that follows the track at `halfWidth` metres either side. Used to cut
 * a slot through the building tileset: PDOK models a station hall as one solid
 * LoD 2.2 block, so without this the cab camera ends up inside the building at
 * Amsterdam Centraal and Sloterdijk.
 */
export function corridorPolygon(ride, halfWidth = 11, stride = 20, range) {
  const { axis } = ride;
  const first = range ? Math.max(0, Math.round(range.from / ride.step)) : 0;
  const last = range
    ? Math.min(axis.lat.length - 1, Math.round(range.to / ride.step))
    : axis.lat.length - 1;
  const count = last + 1;
  const edge = (i, side) => {
    const heading = axis.heading[i];
    const { dLat, dLon } = offsetDegrees(
      axis.lat[i],
      Math.cos(heading) * halfWidth * side,
      -Math.sin(heading) * halfWidth * side,
    );
    return Cartesian3.fromDegrees(axis.lon[i] + dLon, axis.lat[i] + dLat);
  };
  const positions = [];
  for (let i = first; i < count; i += stride) positions.push(edge(i, 1));
  positions.push(edge(last, 1));
  for (let i = last; i >= first; i -= stride) positions.push(edge(i, -1));
  positions.push(edge(first, -1));
  return positions;
}

export async function buildTrack(ride, terrain) {
  const { axis } = ride;
  const count = axis.lat.length;

  const probeIndices = [];
  for (let i = 0; i < count; i += TERRAIN_PROBE_STEP) probeIndices.push(i);
  if (probeIndices.at(-1) !== count - 1) probeIndices.push(count - 1);
  const probes = probeIndices.map((i) => Cartographic.fromDegrees(axis.lon[i], axis.lat[i]));
  await sampleTerrainMostDetailed(terrain, probes);

  // Terrain height per axis point, linearly interpolated between probes.
  const terrainHeight = new Float64Array(count);
  for (let k = 0; k < probeIndices.length - 1; k += 1) {
    const from = probeIndices[k];
    const to = probeIndices[k + 1];
    const a = probes[k].height ?? 0;
    const b = probes[k + 1].height ?? 0;
    for (let i = from; i <= to; i += 1) {
      terrainHeight[i] = lerp(a, b, to === from ? 0 : (i - from) / (to - from));
    }
  }
  terrainHeight[count - 1] = probes.at(-1).height ?? 0;

  const railHeight = new Float64Array(count);
  const aboveGround = new Float64Array(count);
  const hasProfile = Boolean(axis.rail && axis.ground);
  let datum = 0;
  if (hasProfile) {
    const deltas = [];
    for (const i of probeIndices) {
      if (axis.bridge[i] || axis.layer?.[i] > 0) continue;
      deltas.push(terrainHeight[i] - axis.ground[i]);
    }
    deltas.sort((a, b) => a - b);
    datum = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0;
  }
  for (let i = 0; i < count; i += 1) {
    if (!hasProfile) {
      railHeight[i] = terrainHeight[i] + DEFAULT_RAIL_OFFSET;
    } else {
      const wanted = axis.rail[i] + datum;
      const floor = terrainHeight[i] + MIN_CLEARANCE;
      railHeight[i] = wanted >= floor ? wanted : Math.min(floor, wanted + MAX_TERRAIN_LIFT);
    }
    aboveGround[i] = railHeight[i] - terrainHeight[i];
  }

  const positions = new Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i] = Cartesian3.fromDegrees(axis.lon[i], axis.lat[i], railHeight[i]);
  }

  const index = (s) => {
    const clamped = Math.max(0, Math.min(ride.length, s));
    const i = Math.min(count - 2, Math.floor(clamped / ride.step));
    return { i, t: (clamped - axis.chainage[i]) / (axis.chainage[i + 1] - axis.chainage[i] || 1) };
  };

  /** Pose on the track at chainage `s`, with an optional height offset. */
  function poseAt(s, heightOffset = 0) {
    const { i, t } = index(s);
    const lat = lerp(axis.lat[i], axis.lat[i + 1], t);
    const lon = lerp(axis.lon[i], axis.lon[i + 1], t);
    const height = lerp(railHeight[i], railHeight[i + 1], t) + heightOffset;
    const next = railHeight[Math.min(count - 1, i + 2)];
    const grade = (next - railHeight[i]) / (2 * ride.step);
    // headings are unwrapped here: the axis stores them in (-pi, pi]
    let h0 = axis.heading[i];
    let h1 = axis.heading[i + 1];
    if (h1 - h0 > Math.PI) h1 -= 2 * Math.PI;
    if (h0 - h1 > Math.PI) h1 += 2 * Math.PI;
    return {
      position: Cartesian3.fromDegrees(lon, lat, height),
      heading: lerp(h0, h1, t),
      pitch: Math.atan(grade),
      cant: (lerp(axis.cant[i], axis.cant[i + 1], t) * Math.PI) / 180,
      speedLimit: Math.min(axis.speed[i], axis.speed[i + 1]),
      curvature: lerp(axis.curvature[i], axis.curvature[i + 1], t),
      bridge: Boolean(axis.bridge[i]),
      tunnel: Boolean(axis.tunnel[i]),
      railNap: axis.rail ? lerp(axis.rail[i], axis.rail[i + 1], t) : null,
      aboveGround: lerp(aboveGround[i], aboveGround[i + 1], t),
    };
  }

  /** Point on the track at chainage `s`, offset sideways and vertically. */
  function point(s, lateral = 0, up = 0) {
    const { i, t } = index(s);
    const lat = lerp(axis.lat[i], axis.lat[i + 1], t);
    const lon = lerp(axis.lon[i], axis.lon[i + 1], t);
    const height = lerp(railHeight[i], railHeight[i + 1], t) + up;
    if (!lateral) return Cartesian3.fromDegrees(lon, lat, height);
    const heading = headingAt(s);
    const { dLat, dLon } = offsetDegrees(
      lat,
      Math.cos(heading) * lateral,
      -Math.sin(heading) * lateral,
    );
    return Cartesian3.fromDegrees(lon + dLon, lat + dLat, height);
  }

  function headingAt(s) {
    const { i, t } = index(s);
    let h0 = axis.heading[i];
    let h1 = axis.heading[i + 1];
    if (h1 - h0 > Math.PI) h1 -= 2 * Math.PI;
    if (h0 - h1 > Math.PI) h1 += 2 * Math.PI;
    return lerp(h0, h1, t);
  }

  /** Railhead height at chainage `s`, in the datum the scene renders in. */
  const heightAt = (s) => {
    const { i, t } = index(s);
    return lerp(railHeight[i], railHeight[i + 1], t);
  };

  // Stretches where the rendered terrain sits above the track: the PDOK mesh has
  // the odd road viaduct baked into it, and the railway passes underneath. The
  // caller cuts these out of the globe, otherwise the train either climbs onto
  // the motorway or vanishes into the ground for a few seconds.
  const underpasses = [];
  let runStart = -1;
  for (let i = 0; i < count; i += 1) {
    const buried = terrainHeight[i] > railHeight[i] + 1.2;
    if (buried && runStart === -1) runStart = i;
    if ((!buried || i === count - 1) && runStart !== -1) {
      const from = axis.chainage[runStart] - 25;
      const to = axis.chainage[i] + 25;
      if (to - from > 60) underpasses.push({ from, to });
      runStart = -1;
    }
  }

  return {
    positions,
    railHeight,
    underpasses,
    terrainHeight,
    datum,
    poseAt,
    point,
    headingAt,
    heightAt,
  };
}
