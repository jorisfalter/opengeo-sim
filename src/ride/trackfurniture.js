// Near-field track furniture: what an aerial dataset cannot give you.
//
// Photogrammetry and LoD 2.2 buildings are fine from 50 m up and useless at 5 m
// from a cab window, which is exactly where ballast, sleepers, rail heads,
// catenary masts, wires, signals and platform edges live. All of it is derived
// from the track axis and the OSM objects the builder projected onto it, so it
// follows the real alignment instead of being decoration. Plan phase P2.
import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  CornerType,
  BoxGeometry,
  GeometryInstance,
  HeadingPitchRoll,
  PerInstanceColorAppearance,
  PolylineVolumeGeometry,
  Primitive,
  Transforms,
} from 'cesium';

const VOLUME_STEP = 4; // metres between polyline-volume vertices
const GAUGE_HALF = 0.7175;
const BALLAST_DROP = 0.5; // centre of the bed below the railhead
const RAIL_LIFT = 0.04; // rail line above the railhead, clear of the bed
const MIN_SIGNAL_SPACING = 400;
const MAST_SPACING = 50;
const MAST_LATERAL = 3.3;
const MAST_HEIGHT = 7.6;
const CONTACT_WIRE = 5.4; // above railhead
const MESSENGER_WIRE = 6.7;
const WIRE_SAG = 0.35;
const STAGGER = 0.25;
const PLATFORM_HALF_LENGTH = 105;
const PLATFORM_INNER = 3.1;
const PLATFORM_OUTER = 8.6;
const PLATFORM_HEIGHT = 0.84; // NS standard platform is 84 cm above the rail
const CANOPY_HEIGHT = 3.6; // above the platform
const DECK_DROP = 1.55; // centre of a viaduct deck below the railhead
const SLEEPER_DROP = 0.18;

// Cross-section of a polyline volume: x sideways, y up, in metres. A volume is
// drawn around the centre of its own cross section, not around y = 0, so a
// profile is kept symmetric here and the *line* it is extruded along carries the
// offset instead. Getting this wrong puts the ballast on top of the rails.
const section = (lateral, up) => new Cartesian2(lateral, up);

const rgb = (css) => Color.fromCssColorString(css);
const BALLAST = rgb('#6d6555');
const SLEEPER = rgb('#453d34');
const RAIL_STEEL = rgb('#c3c0ba');
const STEEL = rgb('#6f7378');
const WIRE = rgb('#4f5358');
const PLATFORM = rgb('#b9b3a8');
const CANOPY = rgb('#8e8880');
const CONCRETE = rgb('#8a8681');
const WALL = rgb('#9c968c');

function volume(positions, shape, color) {
  return new GeometryInstance({
    geometry: new PolylineVolumeGeometry({
      // Each volume gets its own copy of the line: Cesium takes ownership of
      // the array it is handed, so sharing one between volumes leaves every
      // volume after the first with nothing to build from.
      polylinePositions: positions.slice(),
      shapePositions: shape,
      cornerType: CornerType.ROUNDED,
      vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
    }),
    attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) },
  });
}

const box = (position, heading, dimensions, color) =>
  new GeometryInstance({
    geometry: BoxGeometry.fromDimensions({
      dimensions,
      vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
    }),
    modelMatrix: Transforms.headingPitchRollToFixedFrame(
      position,
      new HeadingPitchRoll(heading, 0, 0),
    ),
    attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) },
  });

const colored = (instances, translucent = false) =>
  new Primitive({
    geometryInstances: instances,
    appearance: new PerInstanceColorAppearance({ translucent, flat: false }),
    asynchronous: false,
  });

/**
 * Ballast bed plus both rail heads.
 *
 * The bed is a polyline volume, which is the right primitive for a long
 * extruded profile. The rails are not: a cross section of a few centimetres
 * comes out of the volume builder as a sliver that never resolves on screen, so
 * they are drawn as polylines instead. Their width is in pixels rather than
 * metres, which is the usual trick for thin linework and reads correctly from
 * the cab.
 */
function permanentWay(ride, track) {
  // The bed is extruded along a line half a metre below the railhead.
  const bedLine = [];
  for (let s = 0; s <= ride.length; s += VOLUME_STEP)
    bedLine.push(track.point(s, 0, -BALLAST_DROP));
  bedLine.push(track.point(ride.length, 0, -BALLAST_DROP));

  const ballast = [
    section(-3.4, -0.25),
    section(3.4, -0.25),
    section(2.3, 0.25),
    section(-2.3, 0.25),
  ];
  const railLine = (side) => {
    const points = [];
    for (let s = 0; s <= ride.length; s += VOLUME_STEP) {
      points.push(track.point(s, side * GAUGE_HALF, RAIL_LIFT));
    }
    points.push(track.point(ride.length, side * GAUGE_HALF, RAIL_LIFT));
    return points;
  };

  // Sleeper deck: a continuous band rather than 9000 individual ties, which is
  // a compromise but does give the bed its two-tone reading at speed.
  const sleeperLine = [];
  for (let s = 0; s <= ride.length; s += VOLUME_STEP) {
    sleeperLine.push(track.point(s, 0, -SLEEPER_DROP));
  }
  sleeperLine.push(track.point(ride.length, 0, -SLEEPER_DROP));
  const sleepers = [
    section(-1.35, -0.08),
    section(1.35, -0.08),
    section(1.35, 0.08),
    section(-1.35, 0.08),
  ];

  return {
    bed: colored([volume(bedLine, ballast, BALLAST), volume(sleeperLine, sleepers, SLEEPER)]),
    rails: [railLine(-1), railLine(1)],
  };
}

/**
 * A deck under the track wherever the builder found a bridge, with parapets.
 * Without it the aerial photo stays at ground level and the train appears to
 * float over the road or water it is crossing.
 */
function viaducts(ride, track) {
  const instances = [];
  const deck = [section(-4.6, -0.7), section(4.6, -0.7), section(4.6, 0.7), section(-4.6, 0.7)];
  const parapet = [
    section(-0.12, -0.5),
    section(0.12, -0.5),
    section(0.12, 0.5),
    section(-0.12, 0.5),
  ];
  for (const run of ride.bridgeRuns ?? []) {
    if (run.length < 20) continue;
    const from = Math.max(0, run.from - 4);
    const to = Math.min(ride.length, run.to + 4);
    const line = (lateral, up) => {
      const points = [];
      for (let s = from; s <= to; s += VOLUME_STEP) points.push(track.point(s, lateral, up));
      points.push(track.point(to, lateral, up));
      return points;
    };
    instances.push(volume(line(0, -DECK_DROP), deck, CONCRETE));
    for (const side of [-1, 1]) {
      instances.push(volume(line(side * 4.5, 0.15), parapet, CONCRETE));
    }
  }
  return instances.length ? colored(instances) : null;
}

/**
 * Catenary: masts on one side with a cantilever, a contact wire that staggers
 * from mast to mast, and a messenger wire that sags between them. Of all the
 * near-field objects this is the one that makes a view read as railway.
 */
function catenary(ride, track) {
  const masts = [];
  const contact = [];
  const messenger = [];
  for (let s = 0; s <= ride.length; s += MAST_SPACING) {
    const heading = track.headingAt(s);
    const base = track.point(s, MAST_LATERAL, MAST_HEIGHT / 2);
    masts.push(box(base, heading, new Cartesian3(0.26, 0.26, MAST_HEIGHT), STEEL));
    const arm = track.point(s, MAST_LATERAL / 2, CONTACT_WIRE + 0.9);
    masts.push(box(arm, heading, new Cartesian3(MAST_LATERAL, 0.1, 0.1), STEEL));
  }
  const span = MAST_SPACING;
  for (let s = 0; s <= ride.length; s += 5) {
    const spanIndex = Math.floor(s / span);
    const t = (s % span) / span;
    // stagger alternates per span so the wire does not wear a groove
    const from = spanIndex % 2 ? STAGGER : -STAGGER;
    const to = spanIndex % 2 ? -STAGGER : STAGGER;
    contact.push(track.point(s, from + (to - from) * t, CONTACT_WIRE));
    messenger.push(track.point(s, 0, MESSENGER_WIRE - WIRE_SAG * Math.sin(Math.PI * t)));
  }
  return { masts: colored(masts), contact, messenger };
}

/**
 * Signal posts on their OSM positions. OSM carries a signal for every track and
 * direction, which along this corridor is one every 30 m; thinning them to the
 * main signals with a minimum spacing keeps the ones a driver would actually
 * read.
 */
function signals(ride, track) {
  const instances = [];
  let previous = -Infinity;
  for (const signal of ride.signals) {
    if (signal.kind === 'other') continue;
    if (signal.chainage - previous < MIN_SIGNAL_SPACING) continue;
    previous = signal.chainage;
    const heading = track.headingAt(signal.chainage);
    const side = signal.offset > 1 ? 1 : -1;
    const lateral = Math.min(6, Math.max(2.6, signal.offset)) * side;
    const height = signal.kind === 'distant' ? 2.2 : 3.4;
    instances.push(
      box(
        track.point(signal.chainage, lateral, height / 2),
        heading,
        new Cartesian3(0.14, 0.14, height),
        STEEL,
      ),
    );
    instances.push(
      box(
        track.point(signal.chainage, lateral, height + 0.35),
        heading,
        new Cartesian3(0.34, 0.26, 0.7),
        signal.kind === 'distant' ? rgb('#c8a23a') : rgb('#2f7d4f'),
      ),
    );
  }
  return colored(instances);
}

/**
 * A platform either side of every stop, as a run of boxes rather than one long
 * slab: boxes follow the curve well enough over 12 m and, unlike a thin volume,
 * they are guaranteed to show up.
 */
function platforms(ride, track) {
  const instances = [];
  const width = PLATFORM_OUTER - PLATFORM_INNER;
  const offset = (PLATFORM_INNER + PLATFORM_OUTER) / 2;
  for (const stop of ride.stops) {
    const from = Math.max(0, stop.chainage - PLATFORM_HALF_LENGTH);
    const to = Math.min(ride.length, stop.chainage + PLATFORM_HALF_LENGTH);
    if (to - from < 40) continue;
    for (let s = from; s <= to; s += 12) {
      const heading = track.headingAt(s);
      for (const side of [-1, 1]) {
        instances.push(
          box(
            track.point(s, side * offset, PLATFORM_HEIGHT / 2),
            heading,
            new Cartesian3(width, 12.4, PLATFORM_HEIGHT),
            PLATFORM,
          ),
        );
        // canopy: a roof slab on two rows of columns
        instances.push(
          box(
            track.point(s, side * offset, PLATFORM_HEIGHT + CANOPY_HEIGHT),
            heading,
            new Cartesian3(width - 0.6, 12.4, 0.22),
            CANOPY,
          ),
        );
        for (const post of [-0.35, 0.35]) {
          instances.push(
            box(
              track.point(s, side * (offset + post * width), PLATFORM_HEIGHT + CANOPY_HEIGHT / 2),
              heading,
              new Cartesian3(0.18, 0.18, CANOPY_HEIGHT),
              CANOPY,
            ),
          );
        }
      }
    }
  }
  return instances.length ? colored(instances) : null;
}

// Noise barriers and retaining walls the builder found within 25 m of the axis.
// They matter more than their size suggests: a wall running past the window is
// what gives the cab view its sense of speed.
const WALL_HEIGHT = { noise_barrier: 2.8, wall: 1.8, retaining_wall: 1.2 };

function walls(ride, track) {
  const instances = [];
  for (const wall of ride.barriers ?? []) {
    const height = WALL_HEIGHT[wall.kind] ?? 1.8;
    const line = wall.points.map((point) =>
      Cartesian3.fromDegrees(
        point.lon,
        point.lat,
        track.heightAt(point.chainage) + height / 2 - 0.3,
      ),
    );
    if (line.length < 2) continue;
    const shape = [
      section(-0.1, -height / 2),
      section(0.1, -height / 2),
      section(0.1, height / 2),
      section(-0.1, height / 2),
    ];
    instances.push(volume(line, shape, WALL));
  }
  return instances.length ? colored(instances) : null;
}

/**
 * Builds everything and adds it to the scene. Returns toggles so the HUD can
 * switch layers, which is also the quickest way to see what the open data does
 * and does not give you.
 */
export function addTrackFurniture(viewer, ride, track) {
  const { scene } = viewer;
  const { bed, rails: railLines } = permanentWay(ride, track);
  const wires = catenary(ride, track);
  const posts = signals(ride, track);
  const decks = platforms(ride, track);
  const bridges = viaducts(ride, track);
  const barriers = walls(ride, track);

  const rails = railLines.map((positions) =>
    viewer.entities.add({
      polyline: { positions, width: 2.4, arcType: 0, material: RAIL_STEEL },
    }),
  );
  const contact = viewer.entities.add({
    polyline: {
      positions: wires.contact,
      width: 1.6,
      arcType: 0,
      material: WIRE,
    },
  });
  const messenger = viewer.entities.add({
    polyline: {
      positions: wires.messenger,
      width: 1.2,
      arcType: 0,
      material: WIRE,
    },
  });

  for (const primitive of [bed, wires.masts, posts]) scene.primitives.add(primitive);
  if (decks) scene.primitives.add(decks);
  if (bridges) scene.primitives.add(bridges);
  if (barriers) scene.primitives.add(barriers);

  return {
    setTrack(visible) {
      bed.show = visible;
      for (const rail of rails) rail.show = visible;
      if (decks) decks.show = visible;
      if (bridges) bridges.show = visible;
      if (barriers) barriers.show = visible;
    },
    setCatenary(visible) {
      wires.masts.show = visible;
      posts.show = visible;
      contact.show = visible;
      messenger.show = visible;
    },
  };
}
