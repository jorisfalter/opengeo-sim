// Off the runway and onto a stand.
//
// Landing is where this simulator used to stop. You roll out, the aeroplane
// comes to a halt on the centreline, and there is nothing to do and nowhere
// to go — which is also the one moment a real flight is busiest, because the
// runway behind you belongs to somebody else now.
//
// So: ask for a taxi route. The ground layout comes from OpenStreetMap,
// fetched for the field you are actually standing on rather than built in
// advance, because there are twenty-eight thousand fields in the index and
// the one you want is whichever one you just landed at. OSM maps taxiways,
// aprons and stands at most airports that have them, worldwide, under the
// same ODbL the rest of this project's OSM data carries.
//
// What comes back is a route off the runway at the nearest exit ahead of you
// and along the taxiways to a parking position, drawn on the ground, with the
// distance to run and the next turn on the glass.
import { Cartesian3, Color } from 'cesium';

const M = 111320;
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
];
// How far around the aeroplane to ask for. Three kilometres covers Heathrow
// end to end and is a small query for a field that is a strip and a shed.
const RADIUS = 3000;
// A runway is a road you are trying to get off, so every metre of it costs
// four. The route still uses it when it has to — at a field whose only
// taxiway is at the far end, rolling out is the only way off.
const RUNWAY_COST = 4;
// An aeroplane cannot reverse. Turning round on the spot is not free either,
// so a route that starts by sending you back the way you came has to be
// enormously better than one that does not.
const BACKWARDS = 1200;
// How far a stand may sit from the nearest taxiway and still be reached: the
// last stretch across the apron is drawn straight, because OSM maps aprons as
// areas and an area is not a route.
const APRON_REACH = 160;
const ARRIVED = 16; // metres from the stand
const STRAYED = 70; // metres off the route before it is worth asking again

const metres = (a, b) =>
  Math.hypot(
    (a.lat - b.lat) * M,
    (a.lon - b.lon) * M * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180),
  );

const QUERY = (lat, lon) => `[out:json][timeout:30];
(way["aeroway"~"^(taxiway|taxilane|runway|parking_position)$"](around:${RADIUS},${lat},${lon});
 node["aeroway"~"^(parking_position|gate)$"](around:${RADIUS},${lat},${lon}););
out body; >; out skel qt;`;

async function ask(lat, lon) {
  let lastError;
  for (const endpoint of MIRRORS) {
    try {
      const response = await fetch(endpoint, { method: 'POST', body: QUERY(lat, lon) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Overpass unreachable');
}

/**
 * The taxiways as a graph, joined where ways share a node — which is what
 * makes this routable at all. Overpass is asked for `out body; >; out skel`
 * precisely for those node ids: with geometry alone two taxiways crossing at
 * a junction are two lines that happen to touch, and nothing can turn from
 * one onto the other.
 */
function buildGraph(data) {
  const nodes = new Map();
  const ways = [];
  for (const element of data.elements ?? []) {
    if (element.type === 'node') nodes.set(element.id, { lat: element.lat, lon: element.lon });
    else if (element.type === 'way') ways.push(element);
  }
  const adj = new Map();
  const edge = (a, b, cost) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, cost });
  };
  let taxiways = 0;
  for (const way of ways) {
    const kind = way.tags?.aeroway;
    const weight = kind === 'runway' ? RUNWAY_COST : kind === 'taxiway' || kind === 'taxilane' ? 1 : 0;
    if (!weight) continue;
    if (kind !== 'runway') taxiways += 1;
    for (let i = 1; i < (way.nodes?.length ?? 0); i += 1) {
      const a = way.nodes[i - 1];
      const b = way.nodes[i];
      if (!nodes.has(a) || !nodes.has(b)) continue;
      const cost = metres(nodes.get(a), nodes.get(b)) * weight;
      edge(a, b, cost);
      edge(b, a, cost);
    }
  }
  // Stands. OSM draws a parking position either as a point or as the line an
  // aeroplane follows onto it; for a line the end that is further from the
  // taxiways is the nose-in end, which is where you are going.
  const stands = [];
  for (const element of data.elements ?? []) {
    if (element.type === 'node' && /^(parking_position|gate)$/.test(element.tags?.aeroway ?? '')) {
      stands.push({ id: element.id, ...nodes.get(element.id), ref: element.tags.ref ?? '' });
    }
  }
  for (const way of ways) {
    if (way.tags?.aeroway !== 'parking_position') continue;
    const ends = [way.nodes[0], way.nodes[way.nodes.length - 1]].filter((id) => nodes.has(id));
    for (const id of ends) stands.push({ id, ...nodes.get(id), ref: way.tags.ref ?? '' });
  }
  return { nodes, adj, stands, taxiways };
}

/** The point on segment a→b nearest p, as a fraction along it. */
function along(p, a, b) {
  const scale = Math.cos((a.lat * Math.PI) / 180);
  const ax = a.lon * scale;
  const bx = b.lon * scale;
  const px = p.lon * scale;
  const dx = bx - ax;
  const dy = b.lat - a.lat;
  const len = dx * dx + dy * dy;
  if (!len) return 0;
  return Math.max(0, Math.min(1, ((px - ax) * dx + (p.lat - a.lat) * dy) / len));
}

/**
 * Where to start from: the nearest point on the nearest edge, not the nearest
 * node. A runway is two points six hundred metres apart, so the nearest
 * *node* to an aeroplane that has just rolled out is a threshold, and a route
 * from there sends you back to it.
 */
function graft(graph, position) {
  let best = null;
  for (const [from, list] of graph.adj) {
    for (const { to } of list) {
      if (to < from) continue; // each edge once
      const a = graph.nodes.get(from);
      const b = graph.nodes.get(to);
      const t = along(position, a, b);
      const point = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
      const d = metres(position, point);
      if (!best || d < best.d) best = { d, from, to, point };
    }
  }
  return best;
}

function dijkstra(graph, startId) {
  const cost = new Map([[startId, 0]]);
  const prev = new Map();
  // A binary heap is not worth it here: a big airport is a few thousand
  // nodes, and this runs once when you press the button.
  const queue = [[0, startId]];
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [c, id] = queue.shift();
    if (c > (cost.get(id) ?? Infinity)) continue;
    for (const { to, cost: w } of graph.adj.get(id) ?? []) {
      const next = c + w;
      if (next < (cost.get(to) ?? Infinity)) {
        cost.set(to, next);
        prev.set(to, id);
        queue.push([next, to]);
      }
    }
  }
  return { cost, prev };
}

export function createTaxi(viewer, { onNotice } = {}) {
  const cache = new Map();
  let graph = null;
  let line = null;
  let marker = null;
  let state = null; // { points, stand, done }
  let asking = false;

  const draw = (points, stand) => {
    erase();
    line = viewer.entities.add({
      polyline: {
        positions: points.map((p) => Cartesian3.fromDegrees(p.lon, p.lat)),
        width: 6,
        clampToGround: true,
        material: Color.fromCssColorString('#ffd166').withAlpha(0.85),
      },
    });
    marker = viewer.entities.add({
      position: Cartesian3.fromDegrees(stand.lon, stand.lat),
      point: {
        pixelSize: 13,
        color: Color.fromCssColorString('#7cd7ff'),
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        heightReference: 1, // CLAMP_TO_GROUND
      },
    });
  };

  const erase = () => {
    if (line) viewer.entities.remove(line);
    if (marker) viewer.entities.remove(marker);
    line = null;
    marker = null;
  };

  /** Routes from wherever the aeroplane is, with the graph already in hand. */
  const plot = (aircraft) => {
    const here = { lat: aircraft.lat, lon: aircraft.lon };
    const start = graft(graph, here);
    if (!start) return null;
    // A virtual node where the aeroplane stands, joined to both ends of the
    // edge it is on — and leaving it backwards costs a thousand metres,
    // because an aeroplane cannot reverse and this must not ask it to.
    const id = 'start';
    const heading = aircraft.heading ?? 0;
    const ahead = { lat: Math.cos(heading), lon: Math.sin(heading) };
    graph.nodes.set(id, start.point);
    graph.adj.set(
      id,
      [start.from, start.to].map((to) => {
        const target = graph.nodes.get(to);
        const dLat = target.lat - start.point.lat;
        const dLon = (target.lon - start.point.lon) * Math.cos((here.lat * Math.PI) / 180);
        const forward = dLat * ahead.lat + dLon * ahead.lon > 0;
        return { to, cost: metres(start.point, target) + (forward ? 0 : BACKWARDS) };
      }),
    );
    for (const to of [start.from, start.to]) {
      graph.adj.get(to).push({ to: id, cost: metres(start.point, graph.nodes.get(to)) });
    }

    const { cost, prev } = dijkstra(graph, id);
    // The stand that is cheapest to reach, counting the walk across the apron
    // at the end. Stands that are on the graph already cost nothing extra.
    let best = null;
    for (const stand of graph.stands) {
      let total = cost.get(stand.id);
      let via = stand.id;
      if (total === undefined) {
        // Not on the taxiway graph: find the nearest node that is, and add
        // the straight line across the apron to it.
        let nearest = null;
        for (const [nodeId] of graph.adj) {
          if (!cost.has(nodeId) || nodeId === id) continue;
          const d = metres(stand, graph.nodes.get(nodeId));
          if (!nearest || d < nearest.d) nearest = { d, nodeId };
        }
        if (!nearest || nearest.d > APRON_REACH) continue;
        total = cost.get(nearest.nodeId) + nearest.d;
        via = nearest.nodeId;
      }
      if (!best || total < best.total) best = { total, stand, via };
    }
    if (!best) return null;

    const path = [];
    for (let at = best.via; at !== undefined; at = prev.get(at)) {
      path.push(graph.nodes.get(at));
      if (at === id) break;
    }
    path.reverse();
    if (best.via !== best.stand.id) path.push({ lat: best.stand.lat, lon: best.stand.lon });
    // Clean up the graft so the next route starts from a graph without it.
    graph.adj.delete(id);
    graph.nodes.delete(id);
    for (const to of [start.from, start.to]) {
      graph.adj.set(to, graph.adj.get(to).filter((e) => e.to !== id));
    }
    return { points: path, stand: best.stand };
  };

  const length = (points, from = 0) => {
    let total = 0;
    for (let i = from + 1; i < points.length; i += 1) total += metres(points[i - 1], points[i]);
    return total;
  };

  return {
    get active() {
      return Boolean(state);
    },

    clear() {
      erase();
      state = null;
    },

    /**
     * Asks for a route, or clears the one you have. On the ground only: a
     * taxi route is of no use at two thousand feet and the question people
     * actually ask up there is a different one.
     */
    async request(aircraft) {
      if (state) {
        this.clear();
        onNotice?.('Taxi route off');
        return;
      }
      if (!aircraft.onGround || (aircraft.kias ?? 0) > 45) {
        onNotice?.('Taxi guidance is for the ground');
        return;
      }
      if (asking) return;
      asking = true;
      try {
        const key = `${aircraft.lat.toFixed(2)},${aircraft.lon.toFixed(2)}`;
        if (!cache.has(key)) {
          onNotice?.('Asking OpenStreetMap for the taxiways…');
          cache.set(key, buildGraph(await ask(aircraft.lat, aircraft.lon)));
        }
        graph = cache.get(key);
        if (!graph.taxiways || !graph.stands.length) {
          onNotice?.(
            graph.taxiways
              ? 'OpenStreetMap has taxiways here but no stands'
              : 'No taxiways mapped at this field',
          );
          return;
        }
        const found = plot(aircraft);
        if (!found) {
          onNotice?.('No way onto the taxiways from here');
          return;
        }
        state = { ...found, done: false };
        draw(found.points, found.stand);
        const name = found.stand.ref ? `stand ${found.stand.ref}` : 'the apron';
        onNotice?.(`Taxi to ${name} — ${Math.round(length(found.points))} m`);
      } catch (error) {
        onNotice?.(`The taxiways did not arrive: ${error.message}`);
      } finally {
        asking = false;
      }
    },

    /**
     * What to say on the glass this frame: how far is left, and which way the
     * next turn goes. Also notices when you have arrived, and when you have
     * wandered far enough off the route to want another one.
     */
    update(aircraft) {
      if (!state) return null;
      const here = { lat: aircraft.lat, lon: aircraft.lon };
      const points = state.points;
      // Where on the route we are: the nearest segment, and how far along it.
      let at = { i: 0, t: 0, d: Infinity, point: points[0] };
      for (let i = 1; i < points.length; i += 1) {
        const t = along(here, points[i - 1], points[i]);
        const point = {
          lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * t,
          lon: points[i - 1].lon + (points[i].lon - points[i - 1].lon) * t,
        };
        const d = metres(here, point);
        if (d < at.d) at = { i, t, d, point };
      }
      const stand = points[points.length - 1];
      const remaining = metres(at.point, points[at.i]) + length(points, at.i);
      const toStand = metres(here, stand);
      if (!state.done && toStand < ARRIVED && (aircraft.kias ?? 0) < 5) {
        state.done = true;
        onNotice?.(state.stand.ref ? `Parked at ${state.stand.ref}` : 'Parked');
        erase();
      }
      if (state.done) return { text: 'PARKED', done: true };
      if (at.d > STRAYED) {
        const found = plot(aircraft);
        if (found) {
          state = { ...found, done: false };
          draw(found.points, found.stand);
        }
      }
      // The next turn worth mentioning: the first vertex ahead that bends the
      // route by more than twenty-five degrees. Anything less is a taxiway
      // curving, which you simply follow.
      let turn = null;
      for (let i = at.i; i < points.length - 1; i += 1) {
        const a = points[i - 1] ?? points[i];
        const b = points[i];
        const c = points[i + 1];
        const first = Math.atan2(b.lon - a.lon, b.lat - a.lat);
        const next = Math.atan2(c.lon - b.lon, c.lat - b.lat);
        let bend = ((next - first) * 180) / Math.PI;
        while (bend > 180) bend -= 360;
        while (bend < -180) bend += 360;
        if (Math.abs(bend) < 25) continue;
        turn = { bend, distance: metres(at.point, points[at.i]) + length(points.slice(at.i, i + 1)) };
        break;
      }
      const name = state.stand.ref ? state.stand.ref : 'apron';
      const cue = turn
        ? ` · ${turn.bend < 0 ? 'left' : 'right'} in ${Math.max(0, Math.round(turn.distance / 10) * 10)} m`
        : '';
      return { text: `TAXI ${name} · ${Math.round(remaining)} m${cue}`, points, done: false };
    },
  };
}
