// The aeroplanes, built here rather than downloaded.
//
// The outside view is the only thing that sees them, but boxes were not doing
// the shape justice — a light jet is a tapered tube with swept wings and a
// T-tail, and none of those is a box. So the meshes are authored: a lofted
// fuselage through a dozen stations, wings with sweep, taper, dihedral and
// thickness, nacelles, fin and stabiliser.
//
// Writing them beats finding them. Free aircraft models exist, but the good
// ones come out of FlightGear and X-Plane and carry GPL or worse; these are a
// few dozen numbers each and the licence question never arises. Dimensions
// follow the published aircraft: the PC-24 is 16.85 m long, 17.0 m span and
// 5.4 m tall; the A380 is 72.72 m, 79.75 m and 24.1 m.
//
// Everything below the helpers is data. Adding the second aeroplane added one
// entry to SHAPES and three helpers — a box, a shift and a nacelle that takes
// its dimensions instead of knowing them — and changed no geometry code at
// all, which is the test of whether the first aeroplane was written as a shape
// or as a special case.
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

/** A rectangular box, for struts and pylons: six quads, wound outwards. */
function box([x0, x1], [y0, y1], [z0, z1]) {
  const p = (x, y, z) => [x, y, z];
  return [
    [p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)],
    [p(x0, y1, z0), p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1)],
    [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)],
    [p(x1, y1, z0), p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1)],
    [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)],
    [p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0), p(x0, y0, z0)],
  ];
}

/** Moves a set of faces bodily. Winglets are fins that live out at the tip. */
const shift = (faces, [dx, dy, dz]) =>
  faces.map((face) => face.map(([x, y, z]) => [x + dx, y + dy, z + dz]));

/**
 * Stands a panel on end, so a wing becomes a fin: the span direction becomes
 * height and the thickness direction becomes span. `base` is the z the root
 * was drawn at, and the height it then stands on.
 */
const upright = (faces, base) =>
  faces.map((face) => face.map(([x, y, z]) => [x, z - base, y + base]));

/**
 * A podded engine: five rings from the intake lip to the exhaust.
 *
 * The proportions are one engine's, measured off the PC-24 nacelle this
 * started as — lip at 47% of the maximum radius, full width 9% of the length
 * aft of it, the fan case from there to two thirds back, then a taper to 53%
 * at the jet pipe. Scaling those by length and radius is what makes a 2.95 m
 * Trent and a 1.28 m FJ44 both look like what they are.
 */
function nacelle({ front, length, radius, y, z }) {
  const stations = [
    [0, 0.47], [0.09, 0.97], [0.66, 1.0], [0.88, 0.81], [1.0, 0.53],
  ];
  const rings = stations.map(([along, scale]) =>
    ring(front - along * length, radius * scale, z, SIDES).map(([x, ry, rz]) => [x, ry + y, rz]),
  );
  return loft(rings);
}

const SIDES = 12;

// Fuselage stations: x, radius, centreline height. The tail lifts, the way a
// jet's does to clear the ground on rotation.
const PC24_FUSELAGE = [
  [8.35, 0.06, 0.05], [8.0, 0.38, 0.03], [7.4, 0.66, 0.0], [6.5, 0.86, 0.0],
  [5.2, 0.96, 0.0], [2.0, 1.0, 0.0], [-1.5, 1.0, 0.0], [-3.4, 0.93, 0.08],
  [-5.2, 0.74, 0.3], [-6.8, 0.5, 0.6], [-8.0, 0.22, 0.85], [-8.5, 0.06, 0.95],
];

/** The PC-24's engines: a nacelle on the fuselage side, on a short pylon. */
function pc24Engine(y) {
  const pylon = panel({
    rootX: -3.0, rootChord: 1.6, rootZ: 0.55, tipY: y, sweep: 0.3,
    tipChord: 1.3, dihedral: 0, thick: 0.16, mirror: false,
  });
  return [...nacelle({ front: -2.3, length: 3.2, radius: 0.64, y, z: 0.55 }), ...pylon];
}

// The A380's fuselage: 7.14 m wide and 8.41 m tall, which is the one dimension
// that gives the aeroplane away from any angle. A ring is drawn round in y and
// scaled in z, so the squash factor is 4.205 / 3.57.
const A380_FUSELAGE = [
  [36.1, 0.25, 1.05], [35.0, 1.15, 0.85], [33.0, 2.15, 0.5], [30.5, 2.95, 0.2],
  [27.0, 3.35, 0.0], [22.0, 3.57, 0.0], [10.0, 3.57, 0.0], [-5.0, 3.57, 0.0],
  [-14.0, 3.5, 0.1], [-20.0, 3.2, 0.4], [-25.0, 2.6, 0.9], [-29.5, 1.8, 1.5],
  [-33.5, 0.9, 2.1], [-36.6, 0.15, 2.5],
];

// Where the wing is, in one place, because the engines hang off it and have to
// follow it: leading edge at the root, chord, how far aft and how far up the
// tip goes, and the semi-span.
const A380_WING = {
  rootX: 12.1, rootChord: 17.7, rootZ: -2.4, tipY: 39.9, sweep: 27.9, dihedral: 3.6,
};

/**
 * One of the A380's four engines, hung under the wing on a pylon.
 *
 * The engine's station and height are worked out from the wing rather than
 * written down, because the wing sweeps back 28 m and rises 3.6 m over its
 * semi-span: an outboard engine on an inboard engine's coordinates would hang
 * in the air eight metres ahead of the leading edge. `fraction` is how far out
 * along the span it sits.
 */
function a380Engine(side, fraction, { radius, length, drop }) {
  const w = A380_WING;
  const y = side * w.tipY * fraction;
  const leadingEdge = w.rootX - w.sweep * fraction;
  const wingZ = w.rootZ + w.dihedral * fraction;
  const z = wingZ - drop;
  const front = leadingEdge + radius * 2.0;
  return [
    ...nacelle({ front, length, radius, y, z }),
    // Pylon: a slab from the top of the nacelle up into the wing.
    ...box(
      [front - length * 0.75, front - length * 0.1],
      [y - 0.45, y + 0.45],
      [z + radius * 0.6, wingZ + 0.4],
    ),
  ];
}

const SHAPES = {
  pc24: () => [
    { colour: WHITE, faces: loft(PC24_FUSELAGE.map(([x, r, z]) => ring(x, r, z, SIDES, 0.92))) },
    {
      colour: WHITE,
      faces: panel({
        rootX: 1.5, rootChord: 3.1, rootZ: -0.62, tipY: 8.5,
        sweep: 2.1, tipChord: 1.35, dihedral: 0.62, thick: 0.26,
      }),
    },
    {
      colour: TRIM,
      faces: upright(
        panel({
          // The fin, drawn as a wing standing on its root.
          rootX: -4.6, rootChord: 3.0, rootZ: 0.8, tipY: 3.5,
          sweep: 1.9, tipChord: 1.5, dihedral: 0, thick: 0.22, mirror: false,
        }),
        0.8,
      ),
    },
    {
      colour: WHITE,
      faces: panel({
        rootX: -6.3, rootChord: 1.7, rootZ: 4.3, tipY: 3.5,
        sweep: 0.8, tipChord: 0.95, dihedral: 0.1, thick: 0.18,
      }),
    },
    { colour: METAL, faces: [...pc24Engine(1.6), ...pc24Engine(-1.6)] },
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
  ],

  a380: () => {
    const w = A380_WING;
    // 2.33 m below the wing at that station puts the inboard nacelle's
    // centre 3.56 m under the fuselage centreline, where a380.xml hangs its
    // engines, and leaves 0.76 m of daylight under it when parked.
    const engine = { radius: 1.48, length: 7.3, drop: 2.33 };
    return [
      { colour: WHITE, faces: loft(A380_FUSELAGE.map(([x, r, z]) => ring(x, r, z, SIDES, 1.178))) },
      {
        colour: WHITE,
        faces: panel({
          rootX: w.rootX, rootChord: w.rootChord, rootZ: w.rootZ, tipY: w.tipY,
          sweep: w.sweep, tipChord: 4.0, dihedral: w.dihedral, thick: 1.3,
        }),
      },
      {
        // Winglets: short fins standing on the wing tip, which is 28 m aft of
        // the root and 3.6 m above it.
        colour: WHITE,
        faces: [1, -1].flatMap((side) =>
          shift(
            upright(
              panel({
                rootX: 0, rootChord: 3.6, rootZ: 0, tipY: 3.4,
                sweep: 1.4, tipChord: 2.0, dihedral: 0, thick: 0.35, mirror: false,
              }),
              0,
            ),
            [w.rootX - w.sweep, side * w.tipY, w.rootZ + w.dihedral],
          ),
        ),
      },
      {
        colour: TRIM,
        faces: upright(
          panel({
            // The fin: 14 m of it, standing on the top of the fuselage.
            rootX: -24.0, rootChord: 12.0, rootZ: 3.2, tipY: 14.2,
            sweep: 9.0, tipChord: 4.5, dihedral: 0, thick: 0.9, mirror: false,
          }),
          3.2,
        ),
      },
      {
        colour: WHITE,
        faces: panel({
          // Horizontal stabiliser, bigger than a 737's whole wing.
          rootX: -27.0, rootChord: 8.5, rootZ: 0.6, tipY: 15.2,
          sweep: 7.0, tipChord: 3.0, dihedral: 0.4, thick: 0.6,
        }),
      },
      {
        colour: METAL,
        faces: [1, -1].flatMap((side) => [
          ...a380Engine(side, 0.326, engine),
          ...a380Engine(side, 0.639, engine),
        ]),
      },
      {
        colour: GLASS,
        // The flight deck, eight metres back from the nose and tucked between
        // the two passenger decks.
        faces: loft([
          ring(34.0, 1.85, 1.5, SIDES, 0.40),
          ring(31.4, 2.75, 1.4, SIDES, 0.32),
        ]),
      },
      {
        colour: TRIM,
        // Two cheatlines, one along each deck. On this aeroplane that is not
        // decoration: a single band reads as a narrowbody with a very large
        // tail, and two is the only thing that says double-decker.
        //
        // Both stay inside the parallel middle of the fuselage, 24 m forward
        // of the centre of gravity to 16 m aft. The first version ran them up
        // to the flight deck, where the fuselage has narrowed to 2.3 m and a
        // 3.0 m band stands 70 cm proud of it: from above the aeroplane had a
        // navy blue blister on the nose. A band has to be drawn a few
        // centimetres outside the skin it sits on, which means it can only go
        // where the skin's radius is known — here, the part that does not
        // change.
        faces: [
          ...loft([
            ring(24.0, 3.60, -1.1, SIDES, 0.05),
            ring(-16.0, 3.55, -1.1, SIDES, 0.05),
          ]),
          ...loft([
            ring(24.0, 3.25, 2.0, SIDES, 0.05),
            ring(-14.0, 3.20, 2.0, SIDES, 0.05),
          ]),
        ],
      },
    ];
  },
};

/**
 * Puts an aeroplane in the scene and hands back the handle that flies it.
 * `shape` names an entry in SHAPES; anything else gets the PC-24.
 */
export function addAircraft(viewer, shape = 'pc24') {
  const parts = (SHAPES[shape] ?? SHAPES.pc24)();

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
