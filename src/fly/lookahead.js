import { Cartographic, Math as CesiumMath, Request, RequestType } from 'cesium';

/**
 * Ask for the ground before you get there.
 *
 * Cesium loads what the camera can see, and refines it as you approach. That
 * is right for a map and wrong for an aeroplane: at 450 knots you cross eight
 * kilometres a minute, so the tile that is sharp enough at the moment it
 * matters was requested far too late, and the valley ahead sharpens in your
 * face instead of being there already.
 *
 * So once a second we work out where the aeroplane will be in half a minute
 * and a minute, and ask every active layer for that tile. The request goes
 * through the ordinary scheduler — if it is busy with tiles you can actually
 * see, it refuses ours, which is exactly the right priority. What arrives
 * lands in the browser's cache, and when Cesium asks for it a minute later it
 * is already there.
 */
const EARTH = 6371000;
const EVERY_MS = 1000;
const HORIZONS = [30, 60];

// Which zoom level to ask for.
//
// Guessing this wrong is worse than not guessing at all: a tile at the wrong
// level is bandwidth spent on something nobody will ever draw. So it is
// derived the way Cesium derives it, from how much ground one screen pixel
// covers when you are standing over that spot, widened by whatever screen
// space error the globe is currently willing to tolerate.
const EQUATOR_PIXEL = 156543.03; // metres per pixel at level 0, 256 px tiles
function levelFor(viewer, agl, lat) {
  const fov = viewer.camera.frustum.fovy ?? (75 * Math.PI) / 180;
  const pixels = viewer.canvas.clientHeight || 600;
  const metresPerPixel = (2 * Math.max(agl, 150) * Math.tan(fov / 2)) / pixels;
  const sse = viewer.scene.globe.maximumScreenSpaceError || 2;
  const cos = Math.cos(CesiumMath.toRadians(lat));
  const level = Math.log2((EQUATOR_PIXEL * cos) / Math.max(0.1, metresPerPixel * sse));
  return Math.min(17, Math.max(8, Math.round(level)));
}

/** Where a track takes you, on a sphere. Good to a few metres over 100 km. */
function ahead(lat, lon, headingRad, metres) {
  const d = metres / EARTH;
  const φ1 = CesiumMath.toRadians(lat);
  const λ1 = CesiumMath.toRadians(lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(headingRad));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(headingRad) * Math.sin(d) * Math.cos(φ1),
      Math.cos(d) - Math.sin(φ1) * Math.sin(φ2),
    );
  return Cartographic.fromDegrees(CesiumMath.toDegrees(λ2), CesiumMath.toDegrees(φ2));
}

export function createLookahead(viewer, { enabled = true } = {}) {
  const asked = new Set();
  let last = 0;
  let served = 0;

  const request = () =>
    new Request({
      throttle: true,
      throttleByServer: true,
      type: RequestType.IMAGERY,
      // Cesium sorts by priority ascending, so a large number means "only if
      // you have nothing better to do".
      priority: 1000,
    });

  const take = (key) => {
    if (asked.has(key)) return false;
    // The set is a guess-log, not a cache; the browser holds the actual tiles.
    if (asked.size > 4000) asked.clear();
    asked.add(key);
    return true;
  };

  return {
    get asked() {
      return served;
    },
    update(aircraft, now = performance.now()) {
      if (!enabled || now - last < EVERY_MS) return;
      last = now;
      const speed = aircraft.speed ?? 0;
      if (aircraft.onGround || speed < 60) return;

      const level = levelFor(viewer, aircraft.agl ?? 0, aircraft.lat);
      const layers = viewer.imageryLayers;
      for (const seconds of HORIZONS) {
        const carto = ahead(aircraft.lat, aircraft.lon, aircraft.heading, speed * seconds);
        for (let i = 0; i < layers.length; i++) {
          const provider = layers.get(i).imageryProvider;
          if (!provider?.ready && provider?.ready !== undefined) continue;
          const scheme = provider?.tilingScheme;
          if (!scheme) continue;
          const z = Math.min(level, provider.maximumLevel ?? level);
          const rect = provider.rectangle;
          if (rect && !inside(rect, carto)) continue;
          const xy = scheme.positionToTileXY(carto, z);
          if (!xy) continue;
          if (!take(`i${i}:${z}:${xy.x}:${xy.y}`)) continue;
          // A refusal means the scheduler is full of tiles you can see. Good.
          if (provider.requestImage(xy.x, xy.y, z, request())) served++;
        }
        const terrain = viewer.terrainProvider;
        const tScheme = terrain?.tilingScheme;
        if (!tScheme) continue;
        const tz = Math.min(level, 13);
        const txy = tScheme.positionToTileXY(carto, tz);
        if (txy && take(`t:${tz}:${txy.x}:${txy.y}`)) {
          try {
            if (terrain.getTileDataAvailable(txy.x, txy.y, tz) !== false) {
              if (terrain.requestTileGeometry(txy.x, txy.y, tz, request())) served++;
            }
          } catch {
            // A terrain provider that would rather not be asked is no reason
            // to stop flying.
          }
        }
      }
    },
  };
}

const inside = (rect, carto) =>
  carto.longitude >= rect.west &&
  carto.longitude <= rect.east &&
  carto.latitude >= rect.south &&
  carto.latitude <= rect.north;
