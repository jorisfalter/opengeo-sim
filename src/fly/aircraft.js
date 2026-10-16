// A PC-24, built here rather than downloaded.
//
// The outside view is the only thing that sees it, but boxes were not doing
// the shape justice — a light jet is a tapered tube with swept wings and a
// T-tail, and none of those is a box. So the mesh is authored: a lofted
// fuselage through a dozen stations, wings with sweep, taper, dihedral and
// thickness, nacelles, fin and stabiliser.
//
// Writing it beats finding one. Free aircraft models exist, but the good ones
// come out of FlightGear and X-Plane and carry GPL or worse; this is a few
// dozen numbers and the licence question never arises. Dimensions follow the
// published PC-24: 16.85 m long, 17.0 m span, 5.4 m tall.
import {
  BoundingSphere,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  HeadingPitchRoll,
  PerInstanceColorAppearance,
  Primitive,
  PrimitiveType,
  Transforms,
} from 'cesium';

const WHITE = Color.fromCssColorString('#ececed');
const TRIM = Color.fromCssColorString('#1d3557');
const GLASS = Color.fromCssColorString('#20262e');
const METAL = Color.fromCssColorString('#9aa0a6');

/**
 * The shape below is authored nose-forward: x along the fuselage, y out the
 * left wing, z up. Cesium's heading/pitch/roll body frame is not that — it is
 * x to the right, y forward, z up — so every vertex is turned a quarter turn
 * on the way in.
 *
 * This was wrong from the start and invisible while the aeroplane was seven
 * boxes: a box 12 m by 2 m reads the same whichever way you look at it. The
 * moment it had a nose and swept wings it was obviously flying sideways.
 */
const toCesiumFrame = ([x, y, z]) => [-y, x, z];

/**
 * Turns a list of faces — each three or four points in model space, wound
 * anticlockwise seen from outside — into a Cesium geometry with flat normals.
 * Flat shading is right here: an airframe this size reads by its facets.
 */
function mesh(rawFaces) {
  const faces = rawFaces.map((face) => face.map(toCesiumFrame));
  const positions = [];
  const normals = [];
  const indices = [];
  for (const face of faces) {
    const [a, b, c] = face;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    const base = positions.length / 3;
    for (const point of face) {
      positions.push(point[0], point[1], point[2]);
      normals.push(n[0] / len, n[1] / len, n[2] / len);
    }
    for (let i = 1; i + 1 < face.length; i += 1) indices.push(base, base + i, base + i + 1);
  }
  const attributes = new GeometryAttributes();
  attributes.position = new GeometryAttribute({
    componentDatatype: ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: new Float64Array(positions),
  });
  attributes.normal = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 3,
    values: new Float32Array(normals),
  });
  return new Geometry({
    attributes,
    indices: new Uint16Array(indices),
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere: BoundingSphere.fromVertices(positions),
  });
}

/** A ring of points around the x axis at station `x`, radius `r`, centre `z`. */
const ring = (x, r, z, sides, squash = 1) =>
  Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [x, Math.cos(a) * r, z + Math.sin(a) * r * squash];
  });

/** Skins a sequence of rings into quads. */
function loft(rings) {
  const faces = [];
  for (let s = 0; s + 1 < rings.length; s += 1) {
    const a = rings[s];
    const b = rings[s + 1];
    for (let i = 0; i < a.length; i += 1) {
      const j = (i + 1) % a.length;
      faces.push([a[i], a[j], b[j], b[i]]);
    }
  }
  return faces;
}

/** A wing panel: a flat plate with thickness, swept and tapered to the tip. */
function panel({ rootX, rootChord, rootZ, tipY, sweep, tipChord, dihedral, thick, mirror = true }) {
  const build = (side) => {
    const y = tipY * side;
    const rootLE = [rootX, 0, rootZ];
    const rootTE = [rootX - rootChord, 0, rootZ];
    const tipLE = [rootX - sweep, y, rootZ + dihedral];
    const tipTE = [rootX - sweep - tipChord, y, rootZ + dihedral];
    const up = (p) => [p[0], p[1], p[2] + thick / 2];
    const down = (p) => [p[0], p[1], p[2] - thick / 2];
    const order = side > 0 ? [rootLE, tipLE, tipTE, rootTE] : [rootLE, rootTE, tipTE, tipLE];
    const top = order.map(up);
    const bottom = order.map(down).reverse();
    const faces = [top, bottom];
    for (let i = 0; i < order.length; i += 1) {
      const a = order[i];
      const b = order[(i + 1) % order.length];
      faces.push([up(a), up(b), down(b), down(a)]);
    }
    return faces;
  };
  return mirror ? [...build(1), ...build(-1)] : build(1);
}

const SIDES = 12;

// Fuselage stations: x, radius, centreline height. The tail lifts, the way a
// jet's does to clear the ground on rotation.
const FUSELAGE = [
  [8.35, 0.06, 0.05], [8.0, 0.38, 0.03], [7.4, 0.66, 0.0], [6.5, 0.86, 0.0],
  [5.2, 0.96, 0.0], [2.0, 1.0, 0.0], [-1.5, 1.0, 0.0], [-3.4, 0.93, 0.08],
  [-5.2, 0.74, 0.3], [-6.8, 0.5, 0.6], [-8.0, 0.22, 0.85], [-8.5, 0.06, 0.95],
];

function nacelle(y) {
  const rings = [
    ring(-2.3, 0.30, 0.55, SIDES), ring(-2.6, 0.62, 0.55, SIDES),
    ring(-4.4, 0.64, 0.55, SIDES), ring(-5.1, 0.52, 0.55, SIDES),
    ring(-5.5, 0.34, 0.55, SIDES),
  ].map((r) => r.map(([x, ry, rz]) => [x, ry + y, rz]));
  // Pylon from the nacelle to the fuselage side.
  const pylon = panel({
    rootX: -3.0, rootChord: 1.6, rootZ: 0.55, tipY: y, sweep: 0.3,
    tipChord: 1.3, dihedral: 0, thick: 0.16, mirror: false,
  });
  return [...loft(rings), ...pylon];
}

export function addAircraft(viewer) {
  const parts = [
    { colour: WHITE, faces: loft(FUSELAGE.map(([x, r, z]) => ring(x, r, z, SIDES, 0.92))) },
    {
      colour: WHITE,
      faces: panel({
        rootX: 1.5, rootChord: 3.1, rootZ: -0.62, tipY: 8.5,
        sweep: 2.1, tipChord: 1.35, dihedral: 0.62, thick: 0.26,
      }),
    },
    {
      colour: TRIM,
      faces: panel({
        // The fin, drawn as a wing standing on its root.
        rootX: -4.6, rootChord: 3.0, rootZ: 0.8, tipY: 3.5,
        sweep: 1.9, tipChord: 1.5, dihedral: 0, thick: 0.22, mirror: false,
      }).map((face) => face.map(([x, y, z]) => [x, z - 0.8, y + 0.8])),
    },
    {
      colour: WHITE,
      faces: panel({
        rootX: -6.3, rootChord: 1.7, rootZ: 4.3, tipY: 3.5,
        sweep: 0.8, tipChord: 0.95, dihedral: 0.1, thick: 0.18,
      }),
    },
    { colour: METAL, faces: [...nacelle(1.6), ...nacelle(-1.6)] },
    {
      colour: GLASS,
      // Windscreen: a short wedge over the nose.
      faces: loft([ring(6.6, 0.72, 0.35, SIDES, 0.5), ring(5.0, 0.8, 0.45, SIDES, 0.45)]),
    },
    {
      colour: TRIM,
      // Cheatline along the waist, a thin ring segment either side.
      faces: loft([ring(5.0, 1.0, -0.22, SIDES, 0.14), ring(-2.0, 1.02, -0.22, SIDES, 0.14)]),
    },
  ];

  const instances = parts.map(
    (part) =>
      new GeometryInstance({
        geometry: mesh(part.faces),
        attributes: { color: ColorGeometryInstanceAttribute.fromColor(part.colour) },
      }),
  );
  const primitive = new Primitive({
    geometryInstances: instances,
    appearance: new PerInstanceColorAppearance({ translucent: false, flat: false }),
    asynchronous: false,
  });
  viewer.scene.primitives.add(primitive);

  const hpr = new HeadingPitchRoll();
  return {
    primitive,
    update(position, heading, pitch, roll) {
      hpr.heading = heading;
      hpr.pitch = pitch;
      hpr.roll = roll;
      primitive.modelMatrix = Transforms.headingPitchRollToFixedFrame(position, hpr);
    },
    setVisible(visible) {
      primitive.show = visible;
    },
  };
}
