#!/usr/bin/env node
// Builds airport geometry for the flight view from OpenStreetMap plus the IGN
// elevation service.
//
//   npm run build:airport -- --airport lflj
//
// The global terrain the viewer streams is a 30 m DEM: fine for a mountain
// range seen from a cockpit, far too coarse for a runway. Courchevel in
// particular is a 537 m strip with an 18.6% slope carved into a shoulder at
// 2000 m, and a 30 m DEM turns that into a vague bump. So the runway, its
// apron and its threshold are modelled here from the OSM outlines with real
// heights sampled from IGN RGE ALTI (1 m), and the viewer lays that on top of
// the streamed terrain.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cachedOverpass } from './overpass.mjs';

const IGN_ELEVATION = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
const ELEVATION_BATCH = 50; // points per request, the service accepts a list
const CENTRELINE_STEP = 10; // metres between sampled points along a runway

const AIRPORTS = {
  lflj: {
    icao: 'LFLJ',
    name: 'Courchevel Altiport',
    bbox: [45.38, 6.61, 45.41, 6.66],
    note: '537 m, 18.6% slope, no go-around',
  },
  lflb: {
    icao: 'LFLB',
    name: 'Chambéry-Savoie',
    bbox: [45.62, 5.86, 45.67, 5.91],
    note: 'runway 18/36 beside the Lac du Bourget',
  },
  lsgg: {
    icao: 'LSGG',
    name: 'Genève Aéroport',
    bbox: [46.21, 6.08, 46.26, 6.14],
    note: '3900 m, the big one in the valley',
  },
  lfli: {
    icao: 'LFLI',
    name: 'Annemasse',
    bbox: [46.18, 6.25, 46.21, 6.29],
    note: 'grass and tarmac under the Geneva approach',
  },
  lflp: {
    icao: 'LFLP',
    name: 'Annecy-Meythet',
    bbox: [45.92, 6.08, 45.94, 6.12],
    note: 'at the top of the lake, mountains on three sides',
  },
  lfhm: {
    icao: 'LFHM',
    name: 'Megève Altiport',
    bbox: [45.81, 6.64, 45.83, 6.67],
    note: 'the other mountain strip, 520 m at 1470 m',
  },
  lfkx: {
    icao: 'LFKX',
    name: 'Méribel Altiport',
    bbox: [45.38, 6.56, 45.42, 6.60],
    note: 'the next valley over from Courchevel',
  },
  lfhu: {
    icao: 'LFHU',
    name: "Alpe d'Huez Altiport",
    bbox: [45.08, 6.07, 45.10, 6.10],
    note: 'the third French altiport, above the hairpins',
  },
  lfka: {
    icao: 'LFKA',
    name: 'Albertville',
    bbox: [45.63, 6.32, 45.65, 6.35],
    note: 'flat, in the valley, on the Courchevel route',
  },
  lfle: {
    icao: 'LFLE',
    name: 'Chambéry-Challes-les-Eaux',
    bbox: [45.55, 5.96, 45.58, 5.99],
    note: 'gliding field south of Chambéry, flat',
  },
};

// Heights outside France come from the same IGN endpoint: its `wld` resource
// is a worldwide blend rather than RGE ALTI's one metre, so a Swiss airport is
// built at DEM accuracy. Geneva and Annemasse are flat valley fields, which is
// exactly the case where that is good enough.

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const EARTH_RADIUS = 6378137;
const toRad = (deg) => (deg * Math.PI) / 180;
const METERS_PER_DEGREE_LAT = 111320;

function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Heights in metres above sea level from the IGN elevation service, in
 * batches. The service rate-limits, so a 429 is a reason to wait rather than
 * to give up: building four airports in a row trips it every time.
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
      const wait = 1500 * 2 ** attempt;
      process.stdout.write(`    IGN ${res.status}, opnieuw over ${(wait / 1000).toFixed(0)} s\n`);
      await sleep(wait);
    }
    if (!json) throw new Error('IGN elevation: gaf het op na zes pogingen');
    out.push(...json.elevations.map((value) => (typeof value === 'number' ? value : value.z)));
    await sleep(350); // pace it, rather than find the limit again
  }
  return out;
}

/** Resamples a way to fixed spacing and returns points with chainage. */
function resample(geometry, step) {
  const out = [];
  let carry = 0;
  for (let i = 1; i < geometry.length; i += 1) {
    const a = geometry[i - 1];
    const b = geometry[i];
    const length = haversine(a, b);
    if (length < 1e-6) continue;
    let t = carry;
    while (t < length) {
      const f = t / length;
      out.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
      t += step;
    }
    carry = t - length;
  }
  out.push(geometry[geometry.length - 1]);
  return out;
}

const bearing = (a, b) => {
  const east = (b.lon - a.lon) * Math.cos(toRad((a.lat + b.lat) / 2));
  return Math.atan2(east, b.lat - a.lat);
};

/** Offsets a point sideways by `metres`, perpendicular to `heading`. */
function offset(point, heading, metres) {
  const east = Math.cos(heading) * metres;
  const north = -Math.sin(heading) * metres;
  const lonScale = METERS_PER_DEGREE_LAT * Math.cos(toRad(point.lat));
  return { lat: point.lat + north / METERS_PER_DEGREE_LAT, lon: point.lon + east / lonScale };
}

async function main() {
  const id = arg('airport', 'lflj');
  const airport = AIRPORTS[id];
  if (!airport) {
    console.error(`Unknown airport: ${id}. Choose from: ${Object.keys(AIRPORTS).join(', ')}`);
    process.exit(1);
  }
  const out = resolve(arg('out', `public/fly/${id}.json`));
  const cachePath = resolve(arg('cache', `data/fly/${id}.overpass.json`));
  const [south, west, north, east] = airport.bbox;

  console.log(`Airport ${airport.icao} — ${airport.name}`);
  console.log('1/4 OSM data');
  const query = `[out:json][timeout:120];
(
  way["aeroway"~"^(runway|taxiway|apron|helipad|hangar|terminal)$"](${south},${west},${north},${east});
  node["aeroway"="aerodrome"](${south},${west},${north},${east});
  way["aeroway"="aerodrome"](${south},${west},${north},${east});
);
out geom tags;`;
  const data = await cachedOverpass(query, cachePath, flag('refresh'));
  const ways = data.elements.filter((element) => element.type === 'way');
  // Pick the runway by its length on the ground, not by how many points it
  // happens to be drawn with: a closed way is the pavement outline rather than
  // a centreline, and a short fragment is a helipad or an apron lane. Sorting
  // on the point count gave Megève a 109 m "runway".
  const runLength = (way) =>
    (way.geometry ?? []).slice(1).reduce((sum, point, i) => sum + haversine(way.geometry[i], point), 0);
  const runways = ways
    .filter((way) => way.tags?.aeroway === 'runway')
    // Two points is a perfectly good centreline; Megève's is drawn that way.
    .filter((way) => way.geometry?.length >= 2)
    .filter((way) => {
      const first = way.geometry[0];
      const last = way.geometry.at(-1);
      return Math.abs(first.lat - last.lat) > 1e-7 || Math.abs(first.lon - last.lon) > 1e-7;
    })
    .filter((way) => runLength(way) > 250)
    .sort((a, b) => runLength(b) - runLength(a))
    .slice(0, 2);
  const aprons = ways
    .filter((way) => ['apron', 'taxiway'].includes(way.tags?.aeroway))
    .filter((way) => (way.geometry?.length ?? 0) >= 2)
    .sort((a, b) => runLength(b) - runLength(a))
    .slice(0, 60);
  const marker = data.elements.find((element) => element.tags?.aeroway === 'aerodrome');
  console.log(`    ${runways.length} runways, ${aprons.length} taxiways/aprons`);
  if (!runways.length) throw new Error('no runway in the OSM data for this bbox');

  console.log('2/4 Runway centrelines and IGN elevations');
  const built = [];
  for (const way of runways) {
    const geometry = way.geometry.filter(Boolean);
    const points = resample(geometry, CENTRELINE_STEP);
    const along = bearing(points[0], points.at(-1));
    // Three samples across the pavement instead of one on the centreline: a
    // metre of drift sideways on an 18% slope is worth several metres of
    // height, and the median of the three throws that out.
    const across = [-8, 0, 8].map((side) => points.map((point) => offset(point, along, side)));
    const lanes = [];
    for (const lane of across) lanes.push(await elevations(lane));
    const heights = points.map((_, i) => {
      const values = lanes.map((lane) => lane[i]).sort((a, b) => a - b);
      return values[1];
    });
    const width = Number.parseFloat(way.tags.width ?? '') || (id === 'lflj' ? 40 : id === 'lsgg' ? 50 : 30);
    let chainage = 0;
    const centre = points.map((point, i) => {
      if (i > 0) chainage += haversine(points[i - 1], point);
      return {
        lat: Number(point.lat.toFixed(7)),
        lon: Number(point.lon.toFixed(7)),
        h: Number(heights[i].toFixed(2)),
        s: Number(chainage.toFixed(1)),
      };
    });
    // A runway is a designed surface, so the profile is smoothed over a 50 m
    // window and forced to stay monotone: Courchevel climbs all the way.
    const window = 2;
    const smoothed = centre.map((point, i) => {
      const from = Math.max(0, i - window);
      const to = Math.min(centre.length - 1, i + window);
      let sum = 0;
      for (let j = from; j <= to; j += 1) sum += centre[j].h;
      return sum / (to - from + 1);
    });
    const climbing = smoothed.at(-1) >= smoothed[0];
    for (let i = 1; i < smoothed.length; i += 1) {
      if (climbing) smoothed[i] = Math.max(smoothed[i], smoothed[i - 1]);
      else smoothed[i] = Math.min(smoothed[i], smoothed[i - 1]);
    }
    centre.forEach((point, i) => {
      point.h = Number(smoothed[i].toFixed(2));
    });

    const length = centre.at(-1).s;
    const rise = centre.at(-1).h - centre[0].h;
    const heading = along;
    const grades = centre
      .slice(1)
      .map((point, i) => (point.h - centre[i].h) / (point.s - centre[i].s));
    const maxSlope = Math.max(...grades.map(Math.abs)) * 100;
    built.push({
      ref: way.tags.ref ?? '',
      surface: way.tags.surface ?? 'asphalt',
      width,
      length: Number(length.toFixed(1)),
      slope: Number(((rise / length) * 100).toFixed(2)),
      maxSlope: Number(maxSlope.toFixed(2)),
      heading: Number((((heading * 180) / Math.PI + 360) % 360).toFixed(1)),
      low: centre[0],
      high: centre.at(-1),
      centre,
    });
    console.log(
      `    ${way.tags.ref ?? 'runway'}: ${length.toFixed(0)} m, ${width} m wide, ` +
        `${centre[0].h.toFixed(0)}->${centre.at(-1).h.toFixed(0)} m, slope ${((rise / length) * 100).toFixed(1)}% (max ${maxSlope.toFixed(1)}%)`,
    );
  }

  console.log('3/4 Aprons and taxiways');
  const surfaces = [];
  for (const way of aprons) {
    const geometry = way.geometry.filter(Boolean);
    if (geometry.length < 2) continue;
    const points = geometry.length > 60 ? geometry.filter((_, i) => i % 2 === 0) : geometry;
    const heights = await elevations(points);
    surfaces.push({
      kind: way.tags.aeroway,
      width: Number.parseFloat(way.tags.width ?? '') || 18,
      closed: geometry[0].lat === geometry.at(-1).lat && geometry[0].lon === geometry.at(-1).lon,
      points: points.map((point, i) => ({
        lat: Number(point.lat.toFixed(7)),
        lon: Number(point.lon.toFixed(7)),
        h: Number(heights[i].toFixed(2)),
      })),
    });
  }

  console.log('4/4 Writing');
  const payload = {
    id,
    icao: airport.icao,
    name: airport.name,
    note: airport.note,
    generated: new Date().toISOString(),
    attribution: {
      geometry: '© OpenStreetMap contributors, ODbL',
      elevation: '© IGN RGE ALTI via the Géoplateforme elevation API',
      imagery: '© IGN BD ORTHO via the Géoplateforme WMTS',
    },
    reference: marker
      ? { lat: marker.lat ?? marker.center?.lat, lon: marker.lon ?? marker.center?.lon }
      : { lat: built[0].low.lat, lon: built[0].low.lon },
    runways: built,
    surfaces,
  };
  await mkdir(dirname(out), { recursive: true });
  const json = JSON.stringify(payload);
  await writeFile(out, json);
  console.log(`    ${out} — ${(json.length / 1024).toFixed(0)} kB, ${surfaces.length} surfaces`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
