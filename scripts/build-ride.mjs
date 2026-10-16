#!/usr/bin/env node
// Builds the track centerline for a cab ride from OpenStreetMap data.
//
//   npm run build:ride -- --ride ams-centraal-sloterdijk
//   npm run build:ride -- --ride ams-centraal-schiphol --refresh
//
// Dutch OSM rail geometry is imported from ProRail data, so the track axis,
// switches and signals are accurate enough for a cab perspective. GTFS
// shapes.txt is not: it is simplified per pattern (maxShapePoints) and
// sometimes runs between the two tracks instead of on one of them.
//
// Elevation is deliberately not in the output. The viewer samples the PDOK
// quantized-mesh DTM in the browser, so the track can never drift away from
// the terrain that is actually rendered. See docs/cabride-demo-plan.md, P0.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { sampleAhn, fillGaps, medianFilter } from './ahn.mjs';

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
];
const ATTEMPTS = 6;
const RETRY_WAIT = 15000;
const USER_AGENT = 'trainconnections-ride-builder/0.1';

// Endpoints are given as station names plus a track name. The station name is
// resolved against the OSM station nodes in the fetched data; the track name
// disambiguates. Amsterdam Centraal has fifteen platform tracks, and
// Sloterdijk is a crossing station where the Zaanlijn and the Westelijke
// Ringspoorbaan sit on different levels, so "nearest node" alone picks the
// wrong platform.
//
// There is no Amsterdam Centraal -> Amsterdam Zuid ride: the curve at
// Riekerpolder aansluiting joins the Zuidtak (Zuidelijke Ringspoorbaan) to the
// Schiphollijn, not to the Westelijke Ringspoorbaan coming from Lelylaan. The
// rail graph shows it and the NS journey planner agrees — CS to Zuid needs at
// least one change. The real routing is CS -> Schiphol and then Schiphol ->
// Amsterdam Zuid, which is why those are two separate rides here.
const RIDES = {
  'ams-centraal-sloterdijk': {
    title: 'Amsterdam Centraal → Amsterdam Sloterdijk',
    line: 'Zaanlijn / Westelijke Ringspoorbaan',
    bbox: [52.3705, 4.821, 52.3985, 4.908],
    start: { station: 'Amsterdam Centraal', track: 'Spoor 14' },
    end: { station: 'Amsterdam Sloterdijk', track: 'Westelijke Ringspoorbaan' },
    vmax: 130,
  },
  'haarlem-zandvoort': {
    title: 'Haarlem → Zandvoort aan Zee',
    line: 'Spoorlijn Haarlem – Zandvoort',
    bbox: [52.362, 4.518, 52.398, 4.652],
    start: { station: 'Haarlem' },
    end: { station: 'Zandvoort aan Zee' },
    vmax: 130,
  },
  'ams-centraal-lelylaan': {
    title: 'Amsterdam Centraal → Amsterdam Lelylaan',
    line: 'Zaanlijn / Westelijke Ringspoorbaan',
    bbox: [52.328, 4.802, 52.3985, 4.908],
    start: { station: 'Amsterdam Centraal', track: 'Spoor 14' },
    end: { station: 'Amsterdam Lelylaan', track: 'Westelijke Ringspoorbaan' },
    vmax: 130,
  },
  'ams-centraal-schiphol': {
    title: 'Amsterdam Centraal → Schiphol Airport',
    line: 'Zaanlijn / Westelijke Ringspoorbaan / Schiphollijn',
    bbox: [52.29, 4.73, 52.3985, 4.908],
    start: { station: 'Amsterdam Centraal', track: 'Spoor 14' },
    end: { station: 'Schiphol Airport', track: 'Schiphollijn' },
    vmax: 130,
  },
  'schiphol-ams-zuid': {
    title: 'Schiphol Airport → Amsterdam Zuid',
    line: 'Schiphollijn / Zuidtak',
    bbox: [52.29, 4.73, 52.36, 4.908],
    start: { station: 'Schiphol Airport', track: 'Schiphollijn' },
    end: { station: 'Amsterdam Zuid', track: 'Zuidelijke Ringspoorbaan' },
    vmax: 130,
  },
};

const STEP = 2; // metres between centerline points
const SMOOTH_PASSES = 6;
const CURVATURE_WINDOW = 15; // points (= 30 m) for the heading derivative
const MAX_CANT_DEG = 5.7; // 150 mm cant over 1500 mm rail spacing
const MIN_SPEED = 40;
const MAX_TURN = (60 * Math.PI) / 180; // largest heading change per segment join
const STOP_RADII = [60, 150, 300];
const ELEVATION_STEP = 10; // metres between AHN samples, interpolated in between
// AHN samples the ballast surface, on open track as terrain and on a structure
// as the surface model. The same offset is added in both cases: a different one
// per source puts a step in the profile exactly where a bridge tag starts or
// ends, which is what produced the bump just outside Amsterdam Centraal.
const RAILHEAD_ABOVE_BALLAST = 0.25;
const MAX_DECK_RISE = 12; // a deck sits below this above its surroundings; a roof does not
const STRUCTURE_MARGIN = 10; // metres of ramp either side of a tagged structure
const MAX_GROUND_RISE = 2.5; // off-structure the railhead stays near the terrain
// 20 per mille, as a backstop only. The robust fit is what removes artefacts.
// Transverse AHN profiles show the ramp onto the high level at Sloterdijk
// climbing at about 17 along the crown of its own embankment, so a tighter cap
// would flatten real geometry instead of fixing anything.
const MAX_GRADE = 0.02;
const FIT_WINDOW = 80; // metres either side for the robust local fit
const FIT_REJECT = 0.35; // metres; residual above this drops a sample
const SURFACE_PENALTY = 0.08; // prefer the terrain model when both are usable
const EXTRAPOLATE_PENALTY = 0.15; // and prefer measured data over carrying on
const KINK_WEIGHT = 4; // cost of a one metre kink between consecutive samples

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const EARTH_RADIUS = 6378137;
const toRad = (deg) => (deg * Math.PI) / 180;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const metersPerDegree = (lat) => ({
  x: (Math.PI / 180) * EARTH_RADIUS * Math.cos(toRad(lat)),
  y: (Math.PI / 180) * EARTH_RADIUS,
});

const wrapPi = (angle) => {
  let value = angle;
  while (value > Math.PI) value -= 2 * Math.PI;
  while (value < -Math.PI) value += 2 * Math.PI;
  return value;
};

function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

// Public Overpass instances answer 429/504 under load, and overpass.osm.ch
// only carries Switzerland, so an empty result counts as a failure too.
async function overpass(query) {
  let lastError;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    for (const endpoint of OVERPASS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
          },
          body: new URLSearchParams({ data: query }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = JSON.parse(text);
        if (!json.elements?.length) throw new Error('empty result');
        return json;
      } catch (error) {
        lastError = new Error(`${endpoint} -> ${error.message}`);
        console.warn(`    overpass ${endpoint}: ${error.message}`);
      }
    }
    if (attempt < ATTEMPTS - 1) {
      console.warn(`    all mirrors failed, retrying in ${RETRY_WAIT / 1000}s`);
      await sleep(RETRY_WAIT);
    }
  }
  throw lastError;
}

async function osmData(ride, cachePath, refresh) {
  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8'));
      console.log(`    cache ${cachePath} (${cached.elements.length} elements)`);
      return cached;
    } catch {
      // no usable cache, fetch below
    }
  }
  const [south, west, north, east] = ride.bbox;
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:180];
(
  way["railway"="rail"]["service"!~"."]["usage"!="industrial"](${bbox});
  way["barrier"~"^(noise_barrier|wall|retaining_wall)$"](${bbox});
);
out geom tags;
(
  node["railway"~"^(station|halt)$"](${bbox});
  node["railway"="signal"](${bbox});
  node["railway"="switch"](${bbox});
);
out body;`;
  const data = await overpass(query);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(data));
  console.log(`    fetched and cached in ${cachePath}`);
  return data;
}

const nodeKey = (lat, lon) => `${lat.toFixed(7)},${lon.toFixed(7)}`;

// Overpass `out geom` gives no node ids, so nodes are matched on rounded
// coordinates. That works because ways sharing a node share its exact
// coordinates. Edges are directed: a train cannot reverse over a switch, so
// the path search runs over edge states with a maximum heading change. On an
// undirected node graph Dijkstra happily produces paths that run past
// Sloterdijk and double back.
function buildGraph(ways) {
  const nodes = new Map();
  const edges = [];
  const addNode = (point, way) => {
    const key = nodeKey(point.lat, point.lon);
    let node = nodes.get(key);
    if (!node) {
      node = { key, lat: point.lat, lon: point.lon, out: [], tracks: new Set() };
      nodes.set(key, node);
    }
    if (way.tags?.name) node.tracks.add(way.tags.name);
    return node;
  };
  for (const way of ways) {
    const geometry = way.geometry?.filter(Boolean);
    if (!geometry || geometry.length < 2) continue;
    for (let i = 1; i < geometry.length; i += 1) {
      const a = addNode(geometry[i - 1], way);
      const b = addNode(geometry[i], way);
      if (a === b) continue;
      const cost = haversine(a, b);
      if (cost < 1e-6) continue;
      const heading = Math.atan2((b.lon - a.lon) * Math.cos(toRad(a.lat)), b.lat - a.lat);
      const forward = { id: edges.length, from: a, to: b, cost, heading, way };
      edges.push(forward);
      const backward = {
        id: edges.length,
        from: b,
        to: a,
        cost,
        heading: wrapPi(heading + Math.PI),
        way,
      };
      edges.push(backward);
      forward.reverse = backward;
      backward.reverse = forward;
      a.out.push(forward);
      b.out.push(backward);
    }
  }
  return { nodes, edges };
}

function nearestNode(nodes, target) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of nodes.values()) {
    if (target.track && !node.tracks.has(target.track)) continue;
    const distance = haversine(node, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  if (!best) throw new Error(`no track node found for ${JSON.stringify(target)}`);
  return { node: best, distance: bestDistance };
}

// A station has a platform track per direction, and the nearest node may sit
// on the one that cannot be reached from our direction of travel. Offering
// every candidate inside a radius as a goal lets Dijkstra pick the first
// reachable one, which is the nearest along the track.
function goalNodes(nodes, target, radii = STOP_RADII) {
  for (const radius of radii) {
    const set = new Set();
    for (const node of nodes.values()) {
      if (target.track && !node.tracks.has(target.track)) continue;
      if (haversine(node, target) <= radius) set.add(node);
    }
    if (set.size) return { set, radius };
  }
  throw new Error(`no track nodes within ${radii.at(-1)} m of ${JSON.stringify(target)}`);
}

class MinHeap {
  constructor() {
    this.items = [];
  }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].cost <= a[i].cost) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let min = i;
        if (left < a.length && a[left].cost < a[min].cost) min = left;
        if (right < a.length && a[right].cost < a[min].cost) min = right;
        if (min === i) break;
        [a[min], a[i]] = [a[i], a[min]];
        i = min;
      }
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
}

function findPath(startNode, goals, edgeCount, maxTurn) {
  const dist = new Float64Array(edgeCount).fill(Infinity);
  const prev = new Int32Array(edgeCount).fill(-1);
  const done = new Uint8Array(edgeCount);
  const queue = new MinHeap();
  for (const edge of startNode.out) {
    dist[edge.id] = edge.cost;
    queue.push({ edge, cost: edge.cost });
  }
  let final = null;
  while (queue.size) {
    const { edge } = queue.pop();
    if (done[edge.id]) continue;
    done[edge.id] = 1;
    if (goals.has(edge.to)) {
      final = edge;
      break;
    }
    for (const next of edge.to.out) {
      if (next === edge.reverse) continue;
      if (Math.abs(wrapPi(next.heading - edge.heading)) > maxTurn) continue;
      const cost = dist[edge.id] + next.cost;
      if (cost < dist[next.id]) {
        dist[next.id] = cost;
        prev[next.id] = edge.id;
        queue.push({ edge: next, cost });
      }
    }
  }
  if (!final) return null;
  const chain = [];
  for (let id = final.id; id !== -1; id = prev[id]) chain.push(id);
  chain.reverse();
  return { chain, length: dist[final.id] };
}

const toLocal = (points, origin) => {
  const { x: mx, y: my } = metersPerDegree(origin.lat);
  return points.map((point) => ({
    x: (point.lon - origin.lon) * mx,
    y: (point.lat - origin.lat) * my,
    tags: point.tags,
  }));
};

function resample(points, step) {
  const out = [];
  let carry = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    let t = carry;
    while (t < length) {
      out.push({ x: a.x + (dx * t) / length, y: a.y + (dy * t) / length, tags: a.tags });
      t += step;
    }
    carry = t - length;
  }
  const last = points[points.length - 1];
  out.push({ x: last.x, y: last.y, tags: last.tags });
  return out;
}

// Moving average over x/y. The ProRail import has decimetre-scale kinks; the
// camera visibly shudders on them without this.
function smooth(points, passes) {
  let current = points;
  for (let pass = 0; pass < passes; pass += 1) {
    current = current.map((point, i) => {
      if (i === 0 || i === current.length - 1) return point;
      const a = current[i - 1];
      const b = current[i + 1];
      return { ...point, x: (a.x + 2 * point.x + b.x) / 4, y: (a.y + 2 * point.y + b.y) / 4 };
    });
  }
  return current;
}

// Curvature as heading change per metre over a window. More robust than the
// circumscribed circle of three points, which blows up on near-straight track.
const curvatureProfile = (headings, step, window) =>
  headings.map((_, i) => {
    const lo = Math.max(0, i - window);
    const hi = Math.min(headings.length - 1, i + window);
    const ds = (hi - lo) * step;
    return ds < 1e-6 ? 0 : wrapPi(headings[hi] - headings[lo]) / ds;
  });

const tagFlag = (tags, name, values) => {
  const value = tags?.[name];
  return value ? values.includes(value) : false;
};

// Distance from each smoothed point to the original OSM polyline: the
// acceptance check from the plan (smoothing cuts corners).
function deviationStats(smoothed, original) {
  const distances = smoothed.map((point) => {
    let best = Infinity;
    for (let i = 1; i < original.length; i += 1) {
      const a = original[i - 1];
      const b = original[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-9) continue;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
      const d = Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
      if (d < best) best = d;
    }
    return best;
  });
  const sorted = [...distances].sort((a, b) => a - b);
  return {
    p50: Number(sorted[Math.floor(sorted.length * 0.5)].toFixed(2)),
    p95: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
  };
}

// Contiguous runs of a flag array, reported so structures that need a manual
// deck height can be found quickly (the DTM is ground level, not deck level).
function runs(flags, chainage) {
  const out = [];
  let start = -1;
  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i] && start === -1) start = i;
    if ((!flags[i] || i === flags.length - 1) && start !== -1) {
      out.push({
        from: chainage[start],
        to: chainage[i],
        length: Number((chainage[i] - chainage[start]).toFixed(1)),
      });
      start = -1;
    }
  }
  return out;
}

// Builds the railhead profile in metres NAP.
//
// AHN terrain is the base, but it has nodata under station roofs and most
// bridges, and on a bridge it would return the road or water underneath. So:
// terrain where it exists, surface on bridges, and interpolation where both are
// unusable — which is exactly the case under the roofs of Amsterdam Centraal
// and the high level of Sloterdijk. A surface sample more than MAX_DECK_RISE
// above the terrain baseline is a roof, not a deck, and is discarded.
async function railProfile(axis, step) {
  // Widen the structure flag: the deck starts before the tagged bridge does,
  // and an abutment sampled as terrain would pull the profile back down to the
  // water right at the edge of the span.
  const margin = Math.round(STRUCTURE_MARGIN / STEP);
  const elevated = axis.bridge.map((flag, i) => {
    const from = Math.max(0, i - margin);
    const to = Math.min(axis.bridge.length - 1, i + margin);
    for (let j = from; j <= to; j += 1) if (axis.bridge[j] || axis.layer[j] > 0) return true;
    return false;
  });

  const indices = [];
  for (let i = 0; i < axis.lat.length; i += Math.max(1, Math.round(step / STEP))) indices.push(i);
  const last = axis.lat.length - 1;
  if (indices.at(-1) !== last) indices.push(last);
  const points = indices.map((i) => ({ lat: axis.lat[i], lon: axis.lon[i] }));
  const needsSurface = indices.some((i) => elevated[i]);

  const progress = (label) => (done, total) => {
    if (done === total) console.log(`    ${label}: ${total} WCS requests`);
  };
  const terrain = await sampleAhn(points, {
    coverage: 'dtm_05m',
    halfWindow: 1.5,
    pick: 0.5,
    onProgress: progress('AHN terrain (dtm_05m)'),
  });
  const surface = needsSurface
    ? await sampleAhn(points, {
        coverage: 'dsm_05m',
        halfWindow: 1.2,
        pick: 0.3,
        onProgress: progress('AHN surface (dsm_05m)'),
      })
    : new Array(points.length).fill(null);

  const baseline = fillGaps(terrain);

  // Which model to believe is decided per sample by smoothness, not by the OSM
  // bridge tag. Those tags are patchy — along the A10 the same viaduct is tagged
  // in pieces — and switching source mid-structure makes the profile jump
  // between the deck and the ground underneath it.
  //
  // Every sample offers up to three candidates: the terrain model, the surface
  // model, and "carry on at the current gradient" for the stretches where
  // neither is usable (under a station roof, under a road deck). A small
  // dynamic program then picks the path with the least kink, measured as the
  // second difference, which is exactly what a railway's vertical alignment
  // minimises in the first place.
  const candidates = indices.map((i, k) => {
    const list = [];
    if (terrain[k] !== null) list.push({ h: terrain[k] + RAILHEAD_ABOVE_BALLAST, cost: 0 });
    if (surface[k] !== null) {
      const rise = surface[k] - (baseline[k] ?? surface[k]);
      if (rise <= MAX_DECK_RISE) {
        list.push({ h: surface[k] + RAILHEAD_ABOVE_BALLAST, cost: SURFACE_PENALTY });
      }
    }
    list.push({ h: null, cost: EXTRAPOLATE_PENALTY }); // continue the gradient
    return list;
  });

  const heightOf = (option, previous, before) =>
    option.h ?? (previous === null ? null : 2 * previous - (before ?? previous));

  const seed = candidates[0].find((option) => option.h !== null)?.h ?? baseline[0] ?? 0;
  let states = candidates[1].map((option) => {
    const h = heightOf(option, seed, seed);
    return h === null ? null : { h, previous: seed, cost: option.cost, path: [seed, h] };
  });
  states = states.filter(Boolean);
  for (let k = 2; k < candidates.length; k += 1) {
    const next = [];
    for (const option of candidates[k]) {
      let best = null;
      for (const state of states) {
        const h = heightOf(option, state.h, state.previous);
        if (h === null) continue;
        const kink = h - 2 * state.h + state.previous;
        const cost = state.cost + option.cost + KINK_WEIGHT * kink * kink;
        if (!best || cost < best.cost) best = { h, previous: state.h, cost, path: [...state.path, h] };
      }
      if (best) next.push(best);
    }
    states = next;
  }
  const chosen = states.reduce((best, state) => (!best || state.cost < best.cost ? state : best), null);
  const railSamples = chosen ? chosen.path : indices.map((i, k) => baseline[k]);
  const usedSurface = candidates.filter(
    (list, k) => list.some((o) => o.cost === SURFACE_PENALTY) && Math.abs((railSamples[k] ?? 0) - ((surface[k] ?? 0) + RAILHEAD_ABOVE_BALLAST)) < 0.01,
  ).length;

  const gaps = railSamples.filter((value) => value === null).length;

  // A railway's vertical alignment is a sequence of constant gradients joined by
  // vertical curves, so the profile is fitted rather than filtered: a weighted
  // local line fit over +/- FIT_WINDOW, re-weighted twice, which drops samples
  // that disagree with their surroundings. That is what a station roof caught in
  // the surface window, a parapet, or a train standing on a deck looks like, and
  // a median filter smears those into a steep ramp instead of removing them.
  const sampleStep = step;
  const filled = fillGaps(railSamples);
  const half = Math.max(2, Math.round(FIT_WINDOW / sampleStep));
  let weight = filled.map((_, k) => (railSamples[k] === null ? 0.25 : 1));
  let fitted = [...filled];
  for (let pass = 0; pass < 3; pass += 1) {
    fitted = filled.map((value, k) => {
      const lo = Math.max(0, k - half);
      const hi = Math.min(filled.length - 1, k + half);
      let sw = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      for (let j = lo; j <= hi; j += 1) {
        const w = weight[j];
        if (!w) continue;
        const x = (j - k) * sampleStep;
        sw += w;
        sx += w * x;
        sy += w * filled[j];
        sxx += w * x * x;
        sxy += w * x * filled[j];
      }
      const det = sw * sxx - sx * sx;
      if (sw < 1e-6 || Math.abs(det) < 1e-9) return value;
      const slope = (sw * sxy - sx * sy) / det;
      return (sy - slope * sx) / sw;
    });
    weight = filled.map((value, k) => {
      if (railSamples[k] === null) return 0.25;
      return Math.abs(value - fitted[k]) > FIT_REJECT ? 0 : 1;
    });
  }
  const rejected = weight.filter((w) => w === 0).length;

  // Interpolate the fitted samples back onto every axis point.
  const rail = new Array(axis.lat.length);
  for (let k = 0; k < indices.length - 1; k += 1) {
    const from = indices[k];
    const to = indices[k + 1];
    for (let i = from; i <= to; i += 1) {
      const t = to === from ? 0 : (i - from) / (to - from);
      rail[i] = fitted[k] + (fitted[k + 1] - fitted[k]) * t;
    }
  }
  rail[last] = fitted.at(-1);

  // Gradient limit, applied in both directions until it settles, so a single
  // steep sample cannot drag the whole profile after it.
  const maxStep = MAX_GRADE * STEP;
  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 1; i < rail.length; i += 1) {
      rail[i] = Math.max(rail[i - 1] - maxStep, Math.min(rail[i - 1] + maxStep, rail[i]));
    }
    for (let i = rail.length - 2; i >= 0; i -= 1) {
      rail[i] = Math.max(rail[i + 1] - maxStep, Math.min(rail[i + 1] + maxStep, rail[i]));
    }
  }

  // Vertical curves.
  const smoothed = rail.map((_, i) => {
    const from = Math.max(0, i - 15);
    const to = Math.min(rail.length - 1, i + 15);
    let sum = 0;
    for (let j = from; j <= to; j += 1) sum += rail[j];
    return sum / (to - from + 1);
  });
  for (let i = 0; i < rail.length; i += 1) rail[i] = smoothed[i];

  const ground = new Array(axis.lat.length);
  const groundFilled = medianFilter(baseline, 2);
  for (let k = 0; k < indices.length - 1; k += 1) {
    const from = indices[k];
    const to = indices[k + 1];
    for (let i = from; i <= to; i += 1) {
      const t = to === from ? 0 : (i - from) / (to - from);
      ground[i] = groundFilled[k] + (groundFilled[k + 1] - groundFilled[k]) * t;
    }
  }
  ground[last] = groundFilled.at(-1);

  const grades = rail.slice(1).map((value, i) => (value - rail[i]) / STEP);
  return {
    rail: rail.map((value) => Number(value.toFixed(2))),
    ground: ground.map((value) => Number(value.toFixed(2))),
    stats: {
      source: 'AHN dtm_05m + dsm_05m via PDOK WCS',
      sampleStep: step,
      samples: indices.length,
      interpolatedSamples: gaps,
      rejectedSamples: rejected,
      surfaceSamples: usedSurface,
      min: Number(Math.min(...rail).toFixed(2)),
      max: Number(Math.max(...rail).toFixed(2)),
      maxGrade: Number((Math.max(...grades.map(Math.abs)) * 1000).toFixed(1)),
      steepestAt: Number(
        (
          axis.chainage[grades.indexOf(grades.find((g) => Math.abs(g) === Math.max(...grades.map(Math.abs))))] / 1000
        ).toFixed(2),
      ),
    },
  };
}

async function main() {
  const rideId = arg('ride', 'ams-centraal-sloterdijk');
  const ride = RIDES[rideId];
  if (!ride) {
    console.error(`Unknown ride: ${rideId}. Choose from: ${Object.keys(RIDES).join(', ')}`);
    process.exit(1);
  }
  const out = resolve(arg('out', `public/ride/${rideId}.json`));
  const cachePath = resolve(arg('cache', `data/ride/${rideId}.overpass.json`));
  const startTrack = arg('start-track', ride.start.track);

  console.log(`Ride ${rideId}: ${ride.title}`);
  console.log('1/6 OSM data (tracks, stations, signals, switches)');
  const data = await osmData(ride, cachePath, flag('refresh'));
  const allWays = data.elements.filter((element) => element.type === 'way');
  const ways = allWays.filter((way) => way.tags?.railway === 'rail');
  const barrierWays = allWays.filter((way) => way.tags?.barrier);
  const nodesRaw = data.elements.filter((element) => element.type === 'node');
  // Metro and light rail stops also carry railway=station (Centraal Station,
  // Station Sloterdijk); they are not train calls.
  const isHeavyRail = (tags = {}) =>
    !['subway', 'light_rail', 'tram', 'monorail'].includes(tags.station) &&
    tags.subway !== 'yes' &&
    tags.light_rail !== 'yes' &&
    tags.tram !== 'yes';
  const stations = nodesRaw.filter(
    (node) => ['station', 'halt'].includes(node.tags?.railway) && isHeavyRail(node.tags),
  );
  const signals = nodesRaw.filter((node) => node.tags?.railway === 'signal');
  const switches = nodesRaw.filter((node) => node.tags?.railway === 'switch');
  console.log(
    `    ${ways.length} track ways, ${barrierWays.length} barriers, ${stations.length} stations, ${signals.length} signals, ${switches.length} switches`,
  );

  const resolveEndpoint = (spec, what) => {
    if (spec.lat && spec.lon) return { lat: spec.lat, lon: spec.lon, track: spec.track };
    const hit = stations.find((station) => station.tags?.name === spec.station);
    if (!hit) {
      throw new Error(
        `${what}: station "${spec.station}" not in the OSM data (candidates: ${stations
          .map((station) => station.tags?.name)
          .join(', ')})`,
      );
    }
    return { lat: hit.lat, lon: hit.lon, track: spec.track, station: spec.station };
  };
  const startSpec = resolveEndpoint(ride.start, 'start');
  const endSpec = resolveEndpoint(ride.end, 'end');

  console.log('2/6 Building the graph and searching the shortest track path');
  const { nodes, edges } = buildGraph(ways);
  const from = nearestNode(nodes, { ...startSpec, track: startTrack });
  const to = goalNodes(nodes, endSpec);
  console.log(
    `    ${nodes.size} nodes / ${edges.length / 2} segments; start ${from.distance.toFixed(1)} m from ${startTrack ?? 'start point'}, ${to.set.size} goal candidates within ${to.radius} m`,
  );
  const route = findPath(from.node, to.set, edges.length, MAX_TURN);
  if (!route) throw new Error('no continuous track path between start and end');
  const chainEdges = route.chain.map((id) => edges[id]);
  console.log(`    path: ${chainEdges.length} segments, ${(route.length / 1000).toFixed(3)} km`);

  console.log('3/6 Resampling, smoothing, curvature and cant');
  const origin = { lat: chainEdges[0].from.lat, lon: chainEdges[0].from.lon };
  // Each point carries the tags of the segment that *leaves* it, because the
  // resampler hands a new point the tags of the segment it starts from. Using
  // the incoming edge instead shifts every bridge flag one OSM segment (up to
  // 60 m) along the route, which drops the track to the water at the start of a
  // bridge and lifts it onto the road deck just after passing under one.
  const raw = [
    ...chainEdges.map((edge) => ({
      lat: edge.from.lat,
      lon: edge.from.lon,
      tags: edge.way.tags ?? {},
    })),
    {
      lat: chainEdges.at(-1).to.lat,
      lon: chainEdges.at(-1).to.lon,
      tags: chainEdges.at(-1).way.tags ?? {},
    },
  ];
  const rawLocal = toLocal(raw, origin);
  const local = smooth(resample(rawLocal, STEP), SMOOTH_PASSES);

  const headings = local.map((point, i) => {
    const a = local[Math.max(0, i - 1)];
    const b = local[Math.min(local.length - 1, i + 1)];
    return Math.atan2(b.x - a.x, b.y - a.y);
  });
  const curvature = curvatureProfile(headings, STEP, CURVATURE_WINDOW);

  const { x: mx, y: my } = metersPerDegree(origin.lat);
  const axis = {
    lat: [],
    lon: [],
    chainage: [],
    heading: [],
    curvature: [],
    cant: [],
    speed: [],
    bridge: [],
    tunnel: [],
    layer: [],
  };
  let travelled = 0;
  for (let i = 0; i < local.length; i += 1) {
    const point = local[i];
    if (i > 0) travelled += Math.hypot(point.x - local[i - 1].x, point.y - local[i - 1].y);
    const k = curvature[i];
    const radius = Math.abs(k) < 1e-6 ? Infinity : Math.abs(1 / k);
    const tagged = Number.parseInt(point.tags?.maxspeed ?? '', 10);
    const lineSpeed = Number.isFinite(tagged) ? tagged : ride.vmax;
    // curve speed at maximum cant: v = sqrt(R * g * tan(cant))
    const curveSpeed = Number.isFinite(radius)
      ? Math.sqrt(radius * 9.81 * Math.tan((MAX_CANT_DEG * Math.PI) / 180)) * 3.6
      : Infinity;
    const speed = Math.max(MIN_SPEED, Math.min(lineSpeed, curveSpeed));
    const cant = Number.isFinite(radius)
      ? Math.min(MAX_CANT_DEG, (Math.atan((speed / 3.6) ** 2 / (9.81 * radius)) * 180) / Math.PI) *
        Math.sign(k)
      : 0;
    const layer = Number.parseInt(point.tags?.layer ?? '0', 10);
    axis.lat.push(Number((origin.lat + point.y / my).toFixed(8)));
    axis.lon.push(Number((origin.lon + point.x / mx).toFixed(8)));
    axis.chainage.push(Number(travelled.toFixed(2)));
    axis.heading.push(Number(headings[i].toFixed(5)));
    axis.curvature.push(Number(k.toFixed(7)));
    axis.cant.push(Number(cant.toFixed(3)));
    axis.speed.push(Number(speed.toFixed(1)));
    axis.bridge.push(tagFlag(point.tags, 'bridge', ['yes', 'viaduct']) ? 1 : 0);
    axis.tunnel.push(tagFlag(point.tags, 'tunnel', ['yes', 'building_passage']) ? 1 : 0);
    axis.layer.push(Number.isFinite(layer) ? layer : 0);
  }

  const deviation = deviationStats(local, rawLocal);
  console.log(
    `    deviation from the OSM polyline: p50 ${deviation.p50} m, p95 ${deviation.p95} m, max ${deviation.max} m`,
  );

  let elevation = null;
  if (!flag('no-elevation')) {
    console.log('4/6 Sampling the AHN height profile (terrain + surface)');
    elevation = await railProfile(axis, Number(arg('elevation-step', ELEVATION_STEP)));
    axis.rail = elevation.rail;
    axis.ground = elevation.ground;
    console.log(
      `    railhead ${elevation.stats.min} to ${elevation.stats.max} m NAP, steepest ${elevation.stats.maxGrade} per mille, ` +
        `at km ${elevation.stats.steepestAt}; ${elevation.stats.samples} samples, ${elevation.stats.surfaceSamples} taken from the surface model, ${elevation.stats.rejectedSamples} rejected by the fit`,
    );
  }

  console.log('5/6 Projecting stations, signals and switches onto the axis');
  const project = (target) => {
    let best = { index: 0, distance: Infinity };
    for (let i = 0; i < axis.lat.length; i += 1) {
      const distance = haversine({ lat: axis.lat[i], lon: axis.lon[i] }, target);
      if (distance < best.distance) best = { index: i, distance };
    }
    return best;
  };
  const onAxis = (items, maxOffset) =>
    items
      .map((item) => {
        const hit = project(item);
        return {
          lat: item.lat,
          lon: item.lon,
          chainage: axis.chainage[hit.index],
          offset: Number(hit.distance.toFixed(1)),
          tags: item.tags ?? {},
        };
      })
      .filter((item) => item.offset < maxOffset)
      .sort((a, b) => a.chainage - b.chainage);

  // OSM sometimes carries several nodes for one station; keep the closest.
  const byName = new Map();
  for (const candidate of onAxis(stations, 220)) {
    const name = candidate.tags.name ?? 'unknown';
    const previous = byName.get(name);
    if (!previous || candidate.offset < previous.offset) byName.set(name, candidate);
  }
  const stops = [...byName.values()]
    .sort((a, b) => a.chainage - b.chainage)
    .map((stop) => ({
      name: stop.tags.name ?? 'unknown',
      uic: stop.tags['railway:ref'] ?? stop.tags.ref ?? null,
      lat: stop.lat,
      lon: stop.lon,
      chainage: stop.chainage,
      offset: stop.offset,
    }));
  console.log(
    `    stops: ${stops.map((stop) => `${stop.name} @${(stop.chainage / 1000).toFixed(2)}km`).join(', ')}`,
  );

  const signalList = onAxis(signals, 20).map((signal) => ({
    chainage: signal.chainage,
    offset: signal.offset,
    lat: signal.lat,
    lon: signal.lon,
    kind: signal.tags['railway:signal:main']
      ? 'main'
      : signal.tags['railway:signal:distant']
        ? 'distant'
        : 'other',
  }));
  const switchList = onAxis(switches, 10).map((item) => ({ chainage: item.chainage }));

  // Walls and noise barriers that actually line this track: anything further
  // than 25 m from the axis belongs to a street, not to the railway. Runs of
  // consecutive close points are kept so the viewer can extrude them.
  const barriers = [];
  for (const way of barrierWays) {
    let run = [];
    for (const point of way.geometry ?? []) {
      const hit = project(point);
      if (hit.distance <= 25) {
        run.push({ lat: point.lat, lon: point.lon, chainage: axis.chainage[hit.index] });
      } else if (run.length > 1) {
        barriers.push({ kind: way.tags.barrier, points: run });
        run = [];
      } else {
        run = [];
      }
    }
    if (run.length > 1) barriers.push({ kind: way.tags.barrier, points: run });
  }
  const barrierLength = barriers.reduce((total, wall) => {
    let length = 0;
    for (let i = 1; i < wall.points.length; i += 1) length += haversine(wall.points[i - 1], wall.points[i]);
    return total + length;
  }, 0);
  console.log(`    ${barriers.length} wall runs along the track, ${Math.round(barrierLength)} m total`);

  const bridgeRuns = runs(axis.bridge, axis.chainage).filter((run) => run.length > 5);
  const tunnelRuns = runs(axis.tunnel, axis.chainage).filter((run) => run.length > 5);
  if (bridgeRuns.length) {
    console.log(
      `    bridge runs (deck height needs a manual override if it matters): ${bridgeRuns
        .map((run) => `${(run.from / 1000).toFixed(2)}-${(run.to / 1000).toFixed(2)}km`)
        .join(', ')}`,
    );
  }

  const radii = axis.curvature
    .map((k) => (Math.abs(k) < 1e-6 ? Infinity : Math.abs(1 / k)))
    .filter((radius) => Number.isFinite(radius));
  const payload = {
    id: rideId,
    title: ride.title,
    line: ride.line,
    generated: new Date().toISOString(),
    attribution: {
      geometry: '© OpenStreetMap contributors (NL rail from the ProRail import), ODbL',
      terrain: '© Kadaster/PDOK 3D Basisvoorziening DTM, CC BY 4.0',
      imagery: '© Kadaster/PDOK Luchtfoto Actueel Ortho 8cm RGB, CC BY 4.0',
      buildings: '© Kadaster/PDOK 3D Basisvoorziening Gebouwen en Terreinen, CC BY 4.0',
    },
    step: STEP,
    length: axis.chainage[axis.chainage.length - 1],
    count: axis.lat.length,
    startTrack: startTrack ?? null,
    endpoints: [ride.start.station, ride.end.station].filter(Boolean),
    deviation,
    elevation: elevation?.stats ?? null,
    minRadius: Number(Math.min(...radii).toFixed(0)),
    bridgeRuns,
    tunnelRuns,
    stops,
    signals: signalList,
    switches: switchList,
    barriers,
    axis,
  };

  await mkdir(dirname(out), { recursive: true });
  const json = JSON.stringify(payload);
  await writeFile(out, json);

  // Manifest so the viewer can offer a ride picker without hard-coding a list.
  const manifestPath = resolve(dirname(out), 'index.json');
  let manifest = [];
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    // first ride
  }
  manifest = manifest.filter((entry) => entry.id !== rideId);
  manifest.push({
    id: rideId,
    title: ride.title,
    length: Number((payload.length / 1000).toFixed(2)),
    stops: stops.length,
  });
  manifest.sort((a, b) => a.length - b.length);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(
    `6/6 ${out} — ${(json.length / 1024).toFixed(0)} kB, ${payload.count} points, ` +
      `${(payload.length / 1000).toFixed(3)} km, smallest radius ${payload.minRadius} m, ` +
      `speed ${Math.min(...axis.speed)}-${Math.max(...axis.speed)} km/h, ` +
      `${signalList.length} signals, ${switchList.length} switches`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
