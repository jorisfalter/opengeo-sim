#!/usr/bin/env node
// Builds the things that stand on the ground: buildings now, woods alongside
// them, for one area at a time.
//
//   npm run build:scenery -- --area courchevel
//
// Footprints and tags come from OpenStreetMap; the height of each building is
// whatever OSM knows (a `height` tag, else storeys, else a guess from what
// kind of building it is) and the ground under it comes from the same IGN
// elevation service the airports use, which answers worldwide.
//
// Output is one compact JSON per area: a few thousand footprints at six
// decimal places, which is about a metre — finer than the data deserves.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cachedOverpass } from './overpass.mjs';
import { elevationAt } from './dem.mjs';

const IGN_ELEVATION = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
const ELEVATION_BATCH = 50;
const MIN_FOOTPRINT = 40; // m², below this it is a shed and not worth a draw call
const MAX_BUILDINGS = 6000; // per area, largest first

// Each area is a box around somewhere the aeroplane actually gets close to the
// ground. Four kilometres across is about what you see on an approach.
const AREAS = {
  // Flanders. The Netherlands needs none of these: PDOK streams LoD 2.2
  // buildings for the whole country straight into the viewer.
  kiewit: { name: 'Hasselt-Kiewit', bbox: [50.92, 5.33, 50.99, 5.43] },
  genk: { name: 'Genk', bbox: [50.94, 5.46, 51.00, 5.56] },
  lommel: { name: 'Lommel en de grens', bbox: [51.19, 5.25, 51.27, 5.38] },
  courchevel: { name: 'Courchevel', bbox: [45.38, 6.58, 45.44, 6.69] },
  meribel: { name: 'Méribel', bbox: [45.38, 6.54, 45.44, 6.60] },
  megeve: { name: 'Megève', bbox: [45.80, 6.59, 45.88, 6.69] },
  moutiers: { name: 'Moûtiers en Bozel', bbox: [45.43, 6.50, 45.51, 6.60] },
  albertville: { name: 'Albertville', bbox: [45.63, 6.35, 45.70, 6.43] },
  chambery: { name: 'Chambéry en Challes', bbox: [45.54, 5.87, 45.60, 6.00] },
  // The city box stops short of the airfield, which sits further north on the
  // lake; without this one you land at Chambéry-Savoie in open country.
  bourget: { name: 'Aix-les-Bains en LFLB', bbox: [45.61, 5.85, 45.70, 5.94] },
  annecy: { name: 'Annecy', bbox: [45.89, 6.08, 45.94, 6.16] },
  geneve: { name: 'Genève', bbox: [46.20, 6.08, 46.26, 6.18] },
  annemasse: { name: 'Annemasse', bbox: [46.17, 6.21, 46.22, 6.28] },
  alpedhuez: { name: "Alpe d'Huez", bbox: [45.07, 6.05, 45.11, 6.10] },
};

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const R = 6378137;
const toRad = (deg) => (deg * Math.PI) / 180;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Footprint area in square metres, by the shoelace formula in a local plane. */
function footprintArea(points) {
  const lat0 = points[0].lat;
  const mLon = (Math.PI / 180) * R * Math.cos(toRad(lat0));
  const mLat = (Math.PI / 180) * R;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.lon * mLon * (b.lat * mLat) - b.lon * mLon * (a.lat * mLat);
  }
  return Math.abs(sum) / 2;
}

const centroid = (points) => ({
  lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
  lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
});

/**
 * How tall. OSM gives a height often enough in towns and almost never in
 * villages, so there is a ladder of fallbacks ending in a guess by type —
 * which is still better than making every building the same box.
 */
const BY_TYPE = {
  chapel: 9, church: 16, cathedral: 30, hangar: 10, terminal: 12,
  apartments: 14, residential: 9, house: 7, detached: 7, bungalow: 5,
  hotel: 15, commercial: 9, retail: 7, industrial: 10, warehouse: 9,
  barn: 7, farm: 8, chalet: 9, garage: 3, garages: 3, shed: 3, roof: 3,
  school: 9, hospital: 18, office: 16, tower: 25,
};

function heightOf(tags) {
  const direct = Number.parseFloat(tags.height ?? '');
  if (Number.isFinite(direct) && direct > 1 && direct < 400) return direct;
  const levels = Number.parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) return levels * 3 + 1.5;
  return BY_TYPE[tags.building] ?? BY_TYPE[tags['building:part']] ?? 8;
}

/**
 * Ground elevations. IGN's "wld" resource is not in fact worldwide — over
 * Belgium and the Netherlands it answers -99999 — so anything it will not
 * answer for falls back to the Terrarium tiles, which cover the globe and are
 * what the rail builder already uses.
 */
async function elevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += ELEVATION_BATCH) {
    const batch = points.slice(i, i + ELEVATION_BATCH);
    const url =
      `${IGN_ELEVATION}?resource=ign_rge_alti_wld&zonly=true&delimiter=|` +
      `&lon=${batch.map((p) => p.lon.toFixed(6)).join('|')}` +
      `&lat=${batch.map((p) => p.lat.toFixed(6)).join('|')}`;
    let json = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const res = await fetch(url);
      if (res.ok) {
        json = await res.json();
        break;
      }
      if (res.status !== 429 && res.status < 500) throw new Error(`IGN elevation: HTTP ${res.status}`);
      await sleep(1500 * 2 ** attempt);
    }
    if (!json) throw new Error('IGN elevation: gaf het op na zes pogingen');
    const values = json.elevations.map((value) => (typeof value === 'number' ? value : value.z));
    // -99999 is IGN for "outside my coverage".
    for (const [k, value] of values.entries()) {
      out.push(Number.isFinite(value) && value > -1000 ? value : await elevationAt(batch[k].lat, batch[k].lon, { zoom: 12 }));
    }
    if (i % (ELEVATION_BATCH * 10) === 0) {
      process.stdout.write(`    hoogtes ${Math.min(i + ELEVATION_BATCH, points.length)}/${points.length}\r`);
    }
    await sleep(320);
  }
  process.stdout.write('\n');
  return out;
}

async function main() {
  const id = arg('area', 'courchevel');
  const area = AREAS[id];
  if (!area) {
    console.error(`Onbekend gebied: ${id}. Kies uit: ${Object.keys(AREAS).join(', ')}`);
    process.exit(1);
  }
  const out = resolve(arg('out', `public/scenery/${id}.json`));
  const cachePath = resolve(arg('cache', `data/scenery/${id}.overpass.json`));
  const [south, west, north, east] = area.bbox;

  console.log(`Gebied ${area.name}`);
  console.log('1/4 OSM-gebouwen en bos');
  const query = `[out:json][timeout:180];
(
  way["building"](${south},${west},${north},${east});
  way["natural"="wood"](${south},${west},${north},${east});
  way["landuse"="forest"](${south},${west},${north},${east});
);
out geom tags;`;
  const data = await cachedOverpass(query, cachePath, flag('refresh'));
  const ways = data.elements.filter((element) => element.type === 'way' && element.geometry?.length > 3);

  const raw = ways.filter((way) => way.tags?.building);
  const woods = ways.filter((way) => way.tags?.natural === 'wood' || way.tags?.landuse === 'forest');
  console.log(`    ${raw.length} gebouwen, ${woods.length} bospercelen`);

  console.log('2/4 Grondvlakken filteren');
  const kept = raw
    .map((way) => {
      const points = way.geometry.filter(Boolean);
      return { points, area: footprintArea(points), tags: way.tags };
    })
    .filter((b) => b.area >= MIN_FOOTPRINT)
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_BUILDINGS);
  console.log(`    ${kept.length} gehouden (minimaal ${MIN_FOOTPRINT} m²)`);
  if (!kept.length) throw new Error('geen gebouwen in dit vak');

  console.log('3/4 Grondhoogtes bij IGN');
  const grounds = await elevations(kept.map((b) => centroid(b.points)));

  console.log('4/4 Schrijven');
  const round = (value, places) => Number(value.toFixed(places));
  const buildings = kept.map((b, i) => ({
    // Footprints are closed by the renderer, so the repeated last point goes.
    p: b.points
      .slice(0, b.points.at(-1).lat === b.points[0].lat && b.points.at(-1).lon === b.points[0].lon ? -1 : undefined)
      .map((point) => [round(point.lat, 6), round(point.lon, 6)]),
    h: round(heightOf(b.tags), 1),
    g: round(grounds[i] ?? 0, 1),
  }));

  const forest = woods.map((way) => ({
    p: way.geometry.filter(Boolean).map((point) => [round(point.lat, 5), round(point.lon, 5)]),
  }));

  const payload = { area: area.name, bbox: area.bbox, buildings, forest };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(payload));
  const kb = Math.round(JSON.stringify(payload).length / 1024);
  console.log(`    ${out} — ${kb} kB, ${buildings.length} gebouwen, ${forest.length} bospercelen`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
