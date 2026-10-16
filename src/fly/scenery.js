// What stands on the ground: buildings, and the woods they sit among.
//
// Footprints come from OpenStreetMap with a real height where OSM knows one,
// and each one is placed on the ground elevation measured at its centroid, so
// a village on a slope steps down the hillside instead of floating on a plane.
//
// Everything in an area goes into a single Cesium primitive. Two thousand
// separate primitives would be two thousand draw calls; one batched primitive
// is one, and Cesium builds it on a worker thread so the frame rate does not
// notice it arriving.
import { asset } from '../base.js';
import { plantTrees } from './trees.js';
import { NETHERLANDS, dutchBuildings } from './providers.js';
import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
} from 'cesium';

const METERS_PER_DEGREE = 111320;
const NEAR = 16000; // metres: build an area when the aeroplane is this close
const FAR = 26000; // and let it go again beyond this

// Alpine roofs and renders, muted enough not to look like a spreadsheet.
const PALETTE = [
  '#8a7f72', '#7d7368', '#9a8d7d', '#6f675e', '#a3978a',
  '#857a6d', '#938779', '#776d63',
].map((css) => Color.fromCssColorString(css));

/** Stable per-building variation, so the same building is the same colour. */
const pick = (lat, lon) => {
  const hash = Math.abs(Math.round(lat * 1e5) * 31 + Math.round(lon * 1e5) * 17);
  return PALETTE[hash % PALETTE.length];
};

export function createScenery(viewer, { datum, onStatus, trees = true } = {}) {
  const areas = new Map();
  // A phone has a tenth of the fill rate, so it gets a tenth of the forest.
  const budget = window.matchMedia?.('(pointer: coarse)').matches ? 1200 : 7000;

  // The Netherlands is not a box of footprints like the others: PDOK streams
  // the whole country as 3D Tiles, so it is one tileset switched on when you
  // are over it and off again when you are not.
  let dutch = null;
  let dutchPending = false;
  function updateDutch(lat, lon) {
    const [south, west, north, east] = NETHERLANDS;
    const over = lat > south - 0.4 && lat < north + 0.4 && lon > west - 0.4 && lon < east + 0.4;
    if (over && !dutch && !dutchPending) {
      dutchPending = true;
      dutchBuildings()
        .then((tileset) => {
          dutch = tileset;
          viewer.scene.primitives.add(tileset);
        })
        .catch(() => {})
        .finally(() => {
          dutchPending = false;
        });
    } else if (!over && dutch) {
      viewer.scene.primitives.remove(dutch);
      dutch = null;
    }
  }

  function build(data) {
    const instances = data.buildings.map((b) => {
      const positions = b.p.map(([lat, lon]) => Cartesian3.fromDegrees(lon, lat));
      // Sunk into the ground: the terrain is a 30 m DEM and a building standing
      // exactly on its own measured elevation hovers over the mesh as often as
      // it meets it.
      const base = b.g + datum - 1.5;
      return new GeometryInstance({
        geometry: new PolygonGeometry({
          polygonHierarchy: new PolygonHierarchy(positions),
          height: base,
          extrudedHeight: base + b.h + 1.5,
          vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: { color: ColorGeometryInstanceAttribute.fromColor(pick(b.p[0][0], b.p[0][1])) },
      });
    });
    return new Primitive({
      geometryInstances: instances,
      appearance: new PerInstanceColorAppearance({ translucent: false, flat: false }),
      asynchronous: true,
      releaseGeometryInstances: true,
    });
  }

  const distanceTo = (bbox, lat, lon) => {
    const [south, west, north, east] = bbox;
    const dLat = Math.max(south - lat, 0, lat - north) * METERS_PER_DEGREE;
    const dLon =
      Math.max(west - lon, 0, lon - east) * METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
    return Math.hypot(dLat, dLon);
  };

  return {
    /** Registers an area without loading it; loading waits until you fly near. */
    register(id, bbox) {
      if (!areas.has(id)) areas.set(id, { id, bbox, primitive: null, loading: false, failed: false });
    },

    /** Called every frame: brings nearby areas in and lets distant ones go. */
    update(lat, lon) {
      updateDutch(lat, lon);
      for (const area of areas.values()) {
        const distance = distanceTo(area.bbox, lat, lon);
        if (distance < NEAR && !area.primitive && !area.loading && !area.failed) {
          area.loading = true;
          onStatus?.(`Gebouwen van ${area.id} laden…`);
          fetch(asset(`scenery/${area.id}.json`))
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
            .then((data) => {
              area.primitive = build(data);
              area.count = data.buildings.length;
              viewer.scene.primitives.add(area.primitive);
              if (trees) {
                const planted = plantTrees(viewer, data.forest, { budget });
                area.trees = planted?.billboards ?? null;
                area.treeCount = planted?.planted ?? 0;
              }
            })
            .catch(() => {
              area.failed = true;
            })
            .finally(() => {
              area.loading = false;
            });
        } else if (distance > FAR && area.primitive) {
          viewer.scene.primitives.remove(area.primitive);
          area.primitive = null;
          if (area.trees) {
            viewer.scene.primitives.remove(area.trees);
            area.trees = null;
          }
        }
      }
    },

    get loaded() {
      const loaded = [...areas.values()]
        .filter((a) => a.primitive)
        .map((a) => `${a.id}: ${a.count} gebouwen, ${a.treeCount ?? 0} bomen`);
      if (dutch) loaded.unshift('PDOK 3D-gebouwen (heel NL)');
      return loaded;
    },
  };
}
