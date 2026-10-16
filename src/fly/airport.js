// Airport geometry from the builder's JSON.
//
// The streamed terrain is a 30 m DEM, which on a mountain shoulder is off by
// several metres and has no idea a runway is there. So the pavement is built
// from surveyed IGN heights and laid on top, with a skirt wide enough to hide
// the seam, and the globe is cut away underneath so the DEM cannot poke
// through the asphalt.
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  ClippingPolygon,
  ClippingPolygonCollection,
  Color,
  ColorGeometryInstanceAttribute,
  CornerType,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolylineVolumeGeometry,
  Primitive,
  PrimitiveCollection,
} from 'cesium';

const METERS_PER_DEGREE = 111320;
export const SKIRT_MARGIN = 26; // platform half-width beyond the pavement edge
export const SKIRT_OVERRUN = 45; // platform carries on past both runway ends
const SKIRT_BELOW = 0.9; // platform top below the asphalt, a visible kerb rather
// than a coplanar surface: half a metre was not enough to win the depth test
const CLIP_MARGIN = 16; // hole in the globe, kept inside the platform
const ASPHALT = Color.fromCssColorString('#3d3c3a');
const SKIRT = Color.fromCssColorString('#6b6355');
const PAINT = Color.fromCssColorString('#e8e6df');
const TAXI = Color.fromCssColorString('#4a4846');

// A polyline volume is extruded with the bottom of its cross section sitting on
// the line, not centred on it — measured, because getting it wrong buries the
// asphalt under its own platform. So a slab is described by the height of its
// top surface and the line is dropped by its thickness.
const section = (half, thickness) => [
  new Cartesian2(-half, 0),
  new Cartesian2(half, 0),
  new Cartesian2(half, thickness),
  new Cartesian2(-half, thickness),
];

/** Slab of `thickness` whose top surface lands `drop` below each point. */
const slab = (points, half, thickness, drop, color) =>
  volume(
    points.map((point) => toCartesian(point, drop + thickness)),
    section(half, thickness),
    color,
  );

const toCartesian = (point, drop = 0) =>
  Cartesian3.fromDegrees(point.lon, point.lat, point.h - drop);

function offsetPoint(point, heading, metres) {
  const lonScale = METERS_PER_DEGREE * Math.cos((point.lat * Math.PI) / 180);
  return {
    lat: point.lat + (-Math.sin(heading) * metres) / METERS_PER_DEGREE,
    lon: point.lon + (Math.cos(heading) * metres) / lonScale,
    h: point.h,
  };
}

const volume = (positions, shape, color) =>
  new GeometryInstance({
    geometry: new PolylineVolumeGeometry({
      polylinePositions: positions.slice(),
      shapePositions: shape,
      cornerType: CornerType.MITERED,
      vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
    }),
    attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) },
  });

// One primitive per volume. Batching several polyline volumes into a single
// primitive silently drops everything after the first, which is how the
// asphalt ended up hidden under its own platform.
function collect(instances) {
  const collection = new PrimitiveCollection();
  for (const instance of instances) {
    collection.add(
      new Primitive({
        geometryInstances: instance,
        appearance: new PerInstanceColorAppearance({ translucent: false, flat: false }),
        asynchronous: false,
      }),
    );
  }
  return collection;
}

/** Extends a centreline by `metres` at both ends, keeping the gradient. */
function extend(centre, metres) {
  const first = centre[0];
  const second = centre[1] ?? centre[0];
  const last = centre.at(-1);
  const penultimate = centre.at(-2) ?? last;
  const step = (a, b) => {
    const span = Math.hypot(
      (b.lat - a.lat) * METERS_PER_DEGREE,
      (b.lon - a.lon) * METERS_PER_DEGREE * Math.cos((a.lat * Math.PI) / 180),
    );
    const scale = span > 0 ? metres / span : 0;
    return {
      lat: a.lat + (a.lat - b.lat) * scale,
      lon: a.lon + (a.lon - b.lon) * scale,
      h: a.h + (a.h - b.h) * scale,
    };
  };
  return [step(first, second), ...centre, step(last, penultimate)];
}

/** Heading along the centreline at index i, in radians from north. */
function headingAt(centre, i) {
  const a = centre[Math.max(0, i - 1)];
  const b = centre[Math.min(centre.length - 1, i + 1)];
  const east = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  return Math.atan2(east, b.lat - a.lat);
}

export function addAirport(viewer, airport, options = {}) {
  const instances = [];
  const markings = [];

  for (const runway of airport.runways) {
    const centre = runway.centre;
    const half = runway.width / 2;
    // The platform the runway sits on. It has to be wider and longer than the
    // hole cut in the globe below, and its top has to stay clear of the
    // asphalt, or the two surfaces fight over the same pixels.
    instances.push(
      slab(extend(centre, SKIRT_OVERRUN), half + SKIRT_MARGIN, 16, SKIRT_BELOW, SKIRT),
    );
    instances.push(slab(centre, half, 0.7, 0, ASPHALT));

    // Centreline dashes, edge lines and a threshold bar at each end.
    for (let i = 0; i + 1 < centre.length; i += 2) {
      markings.push(slab([centre[i], centre[i + 1]], 0.45, 0.06, -0.05, PAINT));
    }
    for (const side of [-1, 1]) {
      const edge = centre.map((point, i) =>
        offsetPoint(point, headingAt(centre, i), side * (half - 1.2)),
      );
      markings.push(slab(edge, 0.4, 0.06, -0.05, PAINT));
    }
    for (const end of [0, centre.length - 1]) {
      const heading = headingAt(centre, end);
      const bar = [
        offsetPoint(centre[end], heading, -half + 1),
        offsetPoint(centre[end], heading, half - 1),
      ];
      markings.push(slab(bar, 3, 0.06, -0.05, PAINT));
    }
  }

  // A big field has aprons by the dozen and each one is its own primitive, so
  // the largest are kept and the rest left out: Geneva's 163 surfaces are two
  // hundred draw calls that nobody looks at while flying past.
  const surfaces = [...airport.surfaces]
    .filter((surface) => surface.points.length >= 2)
    .sort((a, b) => (b.points.length * b.width) - (a.points.length * a.width))
    .slice(0, options.maxSurfaces ?? 40);
  for (const surface of surfaces) {
    instances.push(slab(surface.points, Math.max(8, surface.width) / 2, 0.6, 0, TAXI));
  }

  const pavement = collect(instances);
  const paint = collect(markings);
  viewer.scene.primitives.add(pavement);
  viewer.scene.primitives.add(paint);

  // The ring that cuts the coarse DEM out from under the platform. It is
  // returned rather than installed: see clipGlobeTo() for why only one of
  // these may be on the globe at a time.
  const runway = airport.runways[0];
  const ring = [];
  for (const side of [1, -1]) {
    const order = side === 1 ? runway.centre : [...runway.centre].reverse();
    order.forEach((point, i) => {
      const heading = headingAt(runway.centre, side === 1 ? i : runway.centre.length - 1 - i);
      const edge = offsetPoint(point, heading, side * CLIP_MARGIN);
      ring.push(Cartesian3.fromDegrees(edge.lon, edge.lat));
    });
  }

  return { pavement, paint, clipRing: ring, centre: runway.centre[Math.floor(runway.centre.length / 2)] };
}

/**
 * Puts one airport's hole in the globe, and only one.
 *
 * Cesium builds a single signed distance field for the whole
 * ClippingPolygonCollection, sized to the union of its polygons. Two airports
 * sixty kilometres apart therefore stretch that field across sixty kilometres,
 * and a strip of asphalt thirty metres wide falls far below one texel of it.
 * The result is not a missing runway but a missing landscape: with both
 * polygons loaded, every mountain around Courchevel disappeared and the
 * aeroplane sat in a void. With one, it is correct.
 *
 * So the hole follows the aeroplane: whichever airport it is near, or none.
 */
export function clipGlobeTo(viewer, airport) {
  if (viewer.scene.globe.__clippedTo === (airport?.id ?? null)) return;
  viewer.scene.globe.__clippedTo = airport?.id ?? null;
  viewer.scene.globe.clippingPolygons = airport
    ? new ClippingPolygonCollection({ polygons: [new ClippingPolygon({ positions: airport.clipRing })] })
    : undefined;
}

/** Ground height along a runway, for the flight model to land on. */
/**
 * Ground height over a runway, with a skirt.
 *
 * The height is interpolated **along the centreline**, not snapped to the
 * nearest surveyed point. The survey is sampled every ten metres, so snapping
 * turns a 12.65% slope into a staircase with 1.26 m treads — and taking those
 * at fifty metres a second is five kerbs a second under the wheels. That is
 * what made the aeroplane bounce nineteen times on the way down Courchevel.
 *
 * The survey is exact on the pavement and has to give way to the terrain
 * beyond it, and the handover has to be gradual: a hard edge is a step of a
 * hundred metres at Courchevel, where the strip is a shelf cut into a
 * mountain, and a step is what puts the landing gear inside the hillside.
 *
 * Returns `{ h, weight }`, weight 1 on the pavement falling to 0 at the edge
 * of the skirt, or null beyond it.
 */
export function runwayGround(airport, options = {}) {
  const lines = airport.runways.map((runway) => runway.centre);
  // The survey is only authoritative as far as the platform is drawn; beyond
  // its edge there is nothing to stand on, so the handover starts there.
  const widest = Math.max(...airport.runways.map((runway) => runway.width)) / 2;
  const full = options.full ?? widest + SKIRT_MARGIN - 6;
  const fade = options.fade ?? full + 110;

  return (lat, lon) => {
    const lonScale = METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
    let best = null;
    for (const centre of lines) {
      for (let i = 0; i + 1 < centre.length; i += 1) {
        const a = centre[i];
        const b = centre[i + 1];
        const bx = (b.lon - a.lon) * lonScale;
        const by = (b.lat - a.lat) * METERS_PER_DEGREE;
        const px = (lon - a.lon) * lonScale;
        const py = (lat - a.lat) * METERS_PER_DEGREE;
        const len2 = bx * bx + by * by;
        const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
        const distance = Math.hypot(px - bx * t, py - by * t);
        if (!best || distance < best.distance) {
          best = {
            distance,
            h: a.h + (b.h - a.h) * t,
            // Only the very ends of a centreline count as "past the threshold".
            atEnd: (i === 0 && t <= 0) || (i === centre.length - 2 && t >= 1),
          };
        }
      }
    }
    if (!best) return null;
    // Past a threshold the platform only carries on for SKIRT_OVERRUN metres,
    // so the survey must stop there too. It used to keep answering "runway
    // height" for forty metres beyond the end, where at Courchevel the
    // hillside is already climbing — and the view from inside a hill is black.
    const reach = best.atEnd ? Math.min(full, SKIRT_OVERRUN) : full;
    const outer = best.atEnd ? reach + 60 : fade;
    if (best.distance > outer) return null;
    const weight = best.distance <= reach ? 1 : 1 - (best.distance - reach) / (outer - reach);
    return { h: best.h, weight };
  };
}

export { ArcType };
