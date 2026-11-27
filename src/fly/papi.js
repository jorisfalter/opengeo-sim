/**
 * The PAPI: four lamps beside the threshold, and nothing on the glass.
 *
 * This is the one approach aid that is entirely out of the window. Each unit
 * is a lamp with a sharp horizontal edge between a white beam above and a red
 * one below, set a third of a degree apart, so "two white two red" is not a
 * rule the simulator applies — it is what you see when you are between the
 * second and third setting, which is 3°. Fly high and the reds turn white one
 * at a time; sink and they go back. There is no scale to read and no
 * instrument to tune, which is exactly why it does not feel like a game.
 *
 * Drawn as four points rather than four boxes on purpose: a PAPI is visible
 * from five miles out, where its housings are a thousandth of a pixel wide.
 * A light is a light at any range, and Cesium's point primitives are the only
 * thing here that behaves that way.
 */
import {
  Cartesian3,
  Cartographic,
  Color,
  DistanceDisplayCondition,
  NearFarScalar,
  PointPrimitiveCollection,
  sampleTerrainMostDetailed,
} from 'cesium';
import { papiColours, papiUnits } from './approach.js';

// Measured off photographs of the real thing rather than chosen: the white
// beam is a cold filament white, the red a deep signal red.
const WHITE = Color.fromCssColorString('#fffbf0');
const RED = Color.fromCssColorString('#ff2b16');

export function createPapi(viewer, terrain) {
  const points = viewer.scene.primitives.add(new PointPrimitiveCollection());
  let key = null;
  let lamps = [];
  let shown = [];
  let installing = null;
  let retryAt = 0;
  let enabled = true;

  const clear = () => {
    points.removeAll();
    lamps = [];
    shown = [];
    key = null;
  };

  /**
   * Puts the lamps on the ground.
   *
   * The angles are measured against the threshold's published elevation,
   * which is the datum the approach is built on; the lamps themselves have to
   * stand on the terrain the viewer is actually drawing, or they float or
   * sink. So the geometry comes from the record and the height from a terrain
   * probe, each from the source that is right about it.
   */
  async function install(approach) {
    const wanted = `${approach.ident}/${approach.runway}`;
    key = wanted;
    const units = papiUnits(approach);
    const probes = units.map((unit) => Cartographic.fromDegrees(unit.lon, unit.lat));
    try {
      await sampleTerrainMostDetailed(terrain, probes);
    } catch {
      // Nothing to stand on yet.
    }
    if (key !== wanted) return; // the destination changed while we were waiting
    // The published field elevation is above mean sea level and this viewer
    // works above the ellipsoid, and in France those differ by some forty-five
    // metres. So there is no sensible fallback: without a terrain height the
    // lamps would be buried. Ask again next frame instead.
    if (!probes.every((probe) => Number.isFinite(probe.height))) {
      key = null;
      // Wait a couple of seconds before asking again, or a field whose terrain
      // never arrives turns into a terrain request every frame.
      retryAt = performance.now() + 2000;
      return;
    }
    points.removeAll();
    lamps = units.map((unit, i) => {
      const height = probes[i].height;
      return points.add({
        position: Cartesian3.fromDegrees(unit.lon, unit.lat, height + 0.9),
        color: RED,
        pixelSize: 8,
        outlineWidth: 0,
        // Bright and close, small and far: a lamp that keeps its full size at
        // twenty kilometres is a flare, not a light. Eight pixels because at
        // eleven the four of them ran together into one lozenge at two miles,
        // where the real array is four separate lights nine metres apart.
        scaleByDistance: new NearFarScalar(500, 1.15, 20000, 0.5),
        translucencyByDistance: new NearFarScalar(14000, 1, 30000, 0.35),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 32000),
      });
    });
    shown = lamps.map(() => null);
  }

  return {
    get enabled() {
      return enabled;
    },

    /** What the four lamps are showing, for the checks in scripts/. */
    get lamps() {
      return shown.map((white) => (white === null ? '?' : white ? 'W' : 'R')).join(' ');
    },

    toggle() {
      enabled = !enabled;
      if (!enabled) clear();
      return enabled;
    },

    /** Called every frame with the approach in use, or null when there is none. */
    update(approach, aircraft, altFt) {
      if (!enabled) return;
      // An unlit runway has no PAPI, and until now every runway had one —
      // four lamps beside a thousand-metre grass strip that in daylight has
      // nothing beside it but a windsock. OurAirports does not record the
      // approach aids, but it does record whether a runway is lit, and that
      // is the closest the public-domain data comes: ten thousand runways of
      // thirty-nine thousand. It is a proxy and it is wrong in both
      // directions — a lit runway may have no PAPI — but it is a published
      // fact instead of an assumption.
      if (!approach || approach.lighted === false) {
        if (key) clear();
        return;
      }
      // A destination four hundred kilometres away does not need its lamps
      // put on the ground yet, and putting them there costs a terrain probe.
      const scale = Math.cos((aircraft.lat * Math.PI) / 180);
      const away = Math.hypot(
        (approach.lat - aircraft.lat) * 111320,
        (approach.lon - aircraft.lon) * 111320 * scale,
      );
      if (away > 40000) {
        if (key) clear();
        return;
      }
      const wanted = `${approach.ident}/${approach.runway}`;
      if (wanted !== key) {
        if (!installing && performance.now() >= retryAt) {
          installing = install(approach).finally(() => {
            installing = null;
          });
        }
        return;
      }
      if (!lamps.length) return;
      const colours = papiColours(approach, aircraft, altFt);
      colours.forEach((unit, i) => {
        if (shown[i] === unit.white) return;
        shown[i] = unit.white;
        lamps[i].color = unit.white ? WHITE : RED;
      });
    },

    destroy() {
      viewer.scene.primitives.remove(points);
    },
  };
}
