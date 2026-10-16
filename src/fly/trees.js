// Trees, from OpenStreetMap's woods.
//
// The sprite is drawn here rather than downloaded. A spruce silhouette is a
// triangle and a trunk, the Alps are full of them, and drawing it means there
// is no asset to ship and no licence to honour — which matters more in this
// project than a photograph would.
//
// Each tree is a billboard clamped to the terrain, so nothing needs a height:
// the GPU puts them on whatever the ground turns out to be. They fade in a
// couple of kilometres out and are gone by five, because at cruise they are
// invisible anyway and they are the one thing here that scales by the
// thousand.
import { BillboardCollection, Cartesian2, Cartesian3, HeightReference, NearFarScalar } from 'cesium';

const METERS_PER_DEGREE = 111320;

/** One spruce, in two tones, on a transparent canvas. */
function spruceSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4a3a2a';
  ctx.fillRect(21, 74, 6, 22);
  // Three skirts, darker at the bottom, with a lit left side.
  const tiers = [
    { y: 10, w: 13, h: 30 },
    { y: 32, w: 18, h: 32 },
    { y: 52, w: 23, h: 30 },
  ];
  for (const [i, tier] of tiers.entries()) {
    ctx.fillStyle = ['#3f6b3f', '#365c36', '#2d4f2e'][i];
    ctx.beginPath();
    ctx.moveTo(24, tier.y);
    ctx.lineTo(24 + tier.w, tier.y + tier.h);
    ctx.lineTo(24 - tier.w, tier.y + tier.h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = ['#4e7d4a', '#456f43', '#3b613a'][i];
    ctx.beginPath();
    ctx.moveTo(24, tier.y);
    ctx.lineTo(24 - tier.w, tier.y + tier.h);
    ctx.lineTo(24 - tier.w * 0.35, tier.y + tier.h);
    ctx.closePath();
    ctx.fill();
  }
  return canvas;
}

let sprite = null;

const inside = (lat, lon, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ay, ax] = ring[i];
    const [by, bx] = ring[j];
    if (ay > lat !== by > lat && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
};

/**
 * Scatters trees through the woods of one area and returns the collection.
 * `budget` is a hard cap: the largest woods are planted first, so running out
 * costs you the copses and not the forests.
 */
export function plantTrees(viewer, forest, { budget = 7000, spacing = 42 } = {}) {
  if (!forest?.length) return null;
  sprite = sprite ?? spruceSprite();
  const billboards = new BillboardCollection({ scene: viewer.scene });

  const withArea = forest
    .map((wood) => {
      const ring = wood.p;
      let south = 90;
      let north = -90;
      let west = 180;
      let east = -180;
      for (const [lat, lon] of ring) {
        south = Math.min(south, lat);
        north = Math.max(north, lat);
        west = Math.min(west, lon);
        east = Math.max(east, lon);
      }
      const mLon = METERS_PER_DEGREE * Math.cos((((south + north) / 2) * Math.PI) / 180);
      return { ring, south, north, west, east, span: (north - south) * METERS_PER_DEGREE * (east - west) * mLon };
    })
    .sort((a, b) => b.span - a.span);

  let planted = 0;
  for (const wood of withArea) {
    if (planted >= budget) break;
    const mLon = METERS_PER_DEGREE * Math.cos((((wood.south + wood.north) / 2) * Math.PI) / 180);
    const stepLat = spacing / METERS_PER_DEGREE;
    const stepLon = spacing / mLon;
    for (let lat = wood.south; lat < wood.north && planted < budget; lat += stepLat) {
      for (let lon = wood.west; lon < wood.east && planted < budget; lon += stepLon) {
        // Jittered, or a forest looks like an orchard.
        const jLat = lat + (Math.random() - 0.5) * stepLat * 0.9;
        const jLon = lon + (Math.random() - 0.5) * stepLon * 0.9;
        if (!inside(jLat, jLon, wood.ring)) continue;
        billboards.add({
          position: Cartesian3.fromDegrees(jLon, jLat),
          image: sprite,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          verticalOrigin: 1, // BOTTOM: the trunk sits on the ground
          width: 9 + Math.random() * 6,
          height: 16 + Math.random() * 12,
          // Visible from two kilometres, gone by five: closer than that they
          // are worth drawing, further and they are a grey haze.
          scaleByDistance: new NearFarScalar(300, 1.3, 5000, 0.6),
          translucencyByDistance: new NearFarScalar(2500, 1, 5200, 0),
          pixelOffset: new Cartesian2(0, 0),
        });
        planted += 1;
      }
    }
  }
  viewer.scene.primitives.add(billboards);
  return { billboards, planted };
}
