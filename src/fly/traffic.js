// Other people's aeroplanes.
//
// Real airlines on real city pairs, flown by nobody: the route table built by
// scripts/build-routes.mjs holds 48,000 of them, and this puts aircraft on the
// ones that pass near you. There is no server and no live feed — a flight's
// existence, its departure time and its flight number all come from a hash of
// the route, so two people flying the same minute over the same country see
// the same traffic without anything being exchanged. That is also why it will
// still work when multiplayer arrives: other players are simply more of this.
//
// The flying itself is a point on a great circle with a climb, a cruise and a
// descent. It is not a flight model and does not pretend to be one; it is what
// an aeroplane three miles away looks like, which is a shape, a direction and
// a height.
import { Cartesian3, Color, HeadingPitchRoll, Quaternion, Transforms } from 'cesium';
import { asset } from '../base.js';

const DEG = Math.PI / 180;
const FT = 0.3048;
const KT = 0.514444;
const EARTH_KM = 6371;

// How far away an aeroplane is still worth drawing, and how many at once.
const RANGE_KM = 130;
// Rescan the route table when the aeroplane has moved this far, or this long.
const RESCAN_KM = 15;
const RESCAN_MS = 20000;
// How often to ask which flights exist; their positions move every frame.
const CENSUS_MS = 500;

/** A small deterministic hash: the same route always gives the same number. */
function hash(...parts) {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0) / 0xffffffff;
}

/** Cruising level, the way a flight plan picks one: by how far it is going. */
const cruiseFt = (km) => {
  if (km < 200) return 12000;
  if (km < 500) return 22000;
  if (km < 1200) return 31000;
  if (km < 3000) return 36000;
  return 38000;
};

// What an IATA type code says about size and speed. There is one model and it
// is a narrowbody, so the rest is scale: a Dash 8 is two thirds of it and a
// 747 half again. Three classes is all the resolution three miles of air
// gives you anyway.
const TURBOPROP = /^(DH[1-8]|AT[0-9]|SF3|JS[0-9]|EM2|BE[0-9]|D[HC]8|CNA|C(2|4|5|6)[0-9])/;
const REGIONAL = /^(CR[0-9]|ER[0-9]|E7[0-9]|E9[0-9]|RJ[0-9]|F[0-9]{2}|AR[0-9])/;
const WIDEBODY = /^(7[4-8][0-9]|L10|D10|M11|A3(3|4|5|8)|38[0-9]|IL9)/;

/** Cruise true airspeed in m/s, from the aircraft type where it is telling. */
function cruiseSpeed(type) {
  const t = String(type ?? '');
  if (TURBOPROP.test(t)) return 280 * KT;
  if (REGIONAL.test(t)) return 420 * KT;
  return 460 * KT;
}

/** How big to draw it, against the 37 m airframe the model actually is. */
function sizeOf(type) {
  const t = String(type ?? '');
  if (TURBOPROP.test(t)) return 0.65;
  if (REGIONAL.test(t)) return 0.8;
  if (WIDEBODY.test(t)) return 1.65;
  return 1;
}

const toRad = (deg) => deg * DEG;

/** Great-circle distance in kilometres. */
function distanceKm(aLat, aLon, bLat, bLon) {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const la = toRad(aLat);
  const lb = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A point a fraction of the way along the great circle from A to B. */
function along(aLat, aLon, bLat, bLon, f) {
  const la = toRad(aLat);
  const lo = toRad(aLon);
  const lb = toRad(bLat);
  const lp = toRad(bLon);
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(
    Math.sin((lb - la) / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin((lp - lo) / 2) ** 2,
  )));
  if (d < 1e-9) return [aLat, aLon];
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(la) * Math.cos(lo) + B * Math.cos(lb) * Math.cos(lp);
  const y = A * Math.cos(la) * Math.sin(lo) + B * Math.cos(lb) * Math.sin(lp);
  const z = A * Math.sin(la) + B * Math.sin(lb);
  return [Math.atan2(z, Math.hypot(x, y)) / DEG, Math.atan2(y, x) / DEG];
}

/** Initial bearing from one point to another, in radians. */
function bearing(aLat, aLon, bLat, bLon) {
  const la = toRad(aLat);
  const lb = toRad(bLat);
  const dLon = toRad(bLon - aLon);
  return Math.atan2(
    Math.sin(dLon) * Math.cos(lb),
    Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dLon),
  );
}

export function createTraffic(viewer, { onNotice, max = 40 } = {}) {
  // How many to draw at once. A phone is drawing the world as well.
  const MAX_LIVE = max;
  let table = null;
  let loading = null;
  let enabled = true;
  let nearby = []; // routes worth asking about
  let scannedAt = null;
  let census = null;
  const live = []; // { entity, flight }
  const pool = [];
  let list = []; // what the map is shown

  function load() {
    if (table) return Promise.resolve(table);
    loading =
      loading ??
      fetch(asset('airports/routes.json'))
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((data) => {
          // Midpoints up front: the first cull is one distance per route and
          // it runs over all forty-eight thousand of them.
          data.mid = data.routes.map((route) => {
            const from = data.airports[route[1]];
            const to = data.airports[route[2]];
            return along(from[1], from[2], to[1], to[2], 0.5);
          });
          table = data;
          return table;
        })
        .catch((error) => {
          onNotice?.('No traffic data');
          console.warn('verkeer', error);
          return null;
        });
    return loading;
  }

  /**
   * Everything a route needs to be flown, worked out once when it comes into
   * range rather than on every frame: a flight every so often — between forty
   * minutes and four hours, from the hash — lasting as long as the distance
   * says. The hashing is string work and there can be thousands of these.
   */
  function schedule(index) {
    const route = table.routes[index];
    const km = route[4];
    const speed = cruiseSpeed(table.equipment[route[3]]);
    // How often this pair is flown. Short-haul several times a day, long-haul
    // once or twice, which is both how airlines work and what keeps the sky
    // from filling up: every route flying every hour put three hundred and
    // fifty aeroplanes inside a hundred and thirty kilometres of Brussels,
    // which is three times the real thing on its busiest afternoon.
    const period = (90 + hash('p', index) * 180) * 60 * (1 + km / 1500);
    return {
      index,
      route,
      km,
      speed,
      duration: (km * 1000) / speed + 900, // plus a quarter hour of climb and descent
      period,
      offset: hash('o', index) * period,
    };
  }

  /** Everything in the air on one route at this moment. */
  function flightsOn(entry, now) {
    const { duration, period, offset } = entry;
    const out = [];
    // Long flights outlast their own interval, so look back far enough.
    const first = Math.floor((now - duration - offset) / period) + 1;
    const last = Math.floor((now - offset) / period);
    for (let n = first; n <= last; n += 1) {
      const start = offset + n * period;
      const progress = (now - start) / duration;
      // Inside the stretch of this route that comes within range — which,
      // because the window never reaches the ends, also keeps an aeroplane
      // from being drawn at its own airport doing cruise speed along the
      // ground. It joins the sky after rotating and leaves before the
      // approach.
      if (progress < entry.window[0] || progress > entry.window[1]) continue;
      out.push({ ...entry, n, progress });
    }
    return out;
  }

  /** Where that flight is, and how it is sitting. */
  function state(flight) {
    const { route, progress, km } = flight;
    const from = table.airports[route[1]];
    const to = table.airports[route[2]];
    const [lat, lon] = along(from[1], from[2], to[1], to[2], progress);
    const top = cruiseFt(km);
    // A quarter of an hour of climb and the same of descent, or a third of
    // the flight each when the flight is shorter than that.
    const slice = Math.min(0.33, 900 / flight.duration);
    let ft;
    let vsFt = 0;
    if (progress < slice) {
      const f = progress / slice;
      ft = from[3] + (top - from[3]) * f;
      vsFt = (top - from[3]) / (slice * flight.duration) * 60;
    } else if (progress > 1 - slice) {
      const f = (1 - progress) / slice;
      ft = to[3] + (top - to[3]) * f;
      vsFt = -((top - to[3]) / (slice * flight.duration)) * 60;
    } else {
      ft = top;
    }
    const ahead = along(from[1], from[2], to[1], to[2], Math.min(1, progress + 0.002));
    return {
      lat,
      lon,
      alt: ft * FT,
      ft,
      vsFt,
      heading: bearing(lat, lon, ahead[0], ahead[1]),
      pitch: Math.atan2(vsFt * FT / 60, flight.speed),
    };
  }

  /** Callsign and flight number, both from the hash, so they never change. */
  function callsign(flight) {
    const airline = table.airlines[flight.route[0]];
    const number = 100 + Math.floor(hash('n', flight.index, flight.n % 7) * 8900);
    return { code: `${airline[0]}${number}`, airline, spoken: `${airline[2]} ${number}` };
  }

  /** A livery, after a fashion: a steady colour per airline. */
  const tint = (icao) => Color.fromHsl(hash('c', icao), 0.55, 0.62, 1);

  function take() {
    const entity = pool.pop();
    if (entity) {
      entity.show = true;
      return entity;
    }
    return viewer.entities.add({
      model: {
        uri: asset('fly/airliner.glb'),
        minimumPixelSize: 24,
        maximumScale: 120,
        color: Color.WHITE,
      },
      position: Cartesian3.ZERO,
      orientation: Quaternion.IDENTITY,
    });
  }

  function release(entity) {
    entity.show = false;
    pool.push(entity);
  }

  /**
   * When a route is within range, as a window on its own progress.
   *
   * Walking the whole route and asking "where is this flight now, and is it
   * near" costs two great-circle interpolations per flight per census, and
   * over eight thousand routes that is a frame every half second. But a route
   * is a fixed line and we are a fixed point until we move: the stretch of it
   * that comes within range is one arc, and it can be found once. After that
   * the census is a division and two comparisons.
   */
  function rangeWindow(from, to, km, lat, lon) {
    const steps = Math.max(8, Math.min(64, Math.ceil(km / 60)));
    let first = -1;
    let last = -1;
    for (let i = 0; i <= steps; i += 1) {
      const [pLat, pLon] = along(from[1], from[2], to[1], to[2], i / steps);
      if (distanceKm(lat, lon, pLat, pLon) > RANGE_KM) continue;
      if (first < 0) first = i;
      last = i;
    }
    if (first < 0) return null;
    // One step either side, because the samples are coarser than the arc.
    return [
      Math.max(0.02, (first - 1) / steps),
      Math.min(0.98, (last + 1) / steps),
    ];
  }

  /** Narrows forty-eight thousand routes down to the ones passing nearby. */
  function scan(lat, lon) {
    const out = [];
    for (let i = 0; i < table.routes.length; i += 1) {
      const route = table.routes[i];
      const mid = table.mid[i];
      const reach = route[4] / 2 + RANGE_KM;
      // Latitude alone throws most of the world out without a single call to
      // a trigonometric function, which matters at forty-eight thousand.
      if (Math.abs(mid[0] - lat) * 111 > reach) continue;
      if (distanceKm(lat, lon, mid[0], mid[1]) > reach) continue;
      const window = rangeWindow(
        table.airports[route[1]],
        table.airports[route[2]],
        route[4],
        lat,
        lon,
      );
      // Passing close to the middle of a long route is not the same as coming
      // near it: half the ones that survive the first test never do.
      if (!window) continue;
      const entry = schedule(i);
      entry.window = window;
      out.push(entry);
    }
    return out;
  }

  return {
    load,

    get list() {
      return list;
    },

    get enabled() {
      return enabled;
    },

    toggle(on) {
      enabled = on ?? !enabled;
      if (!enabled) {
        for (const item of live) release(item.entity);
        live.length = 0;
        list = [];
      } else {
        load();
        scannedAt = null;
        census = null;
      }
      onNotice?.(enabled ? 'Traffic on' : 'Traffic off');
      return enabled;
    },

    /**
     * @param aircraft where we are
     * @param seconds  the clock the traffic flies on, in seconds. Wall clock,
     *   so that everyone shares it, and it runs at whatever rate the
     *   simulator's own time is running at.
     */
    update(aircraft, seconds) {
      if (!enabled) return;
      if (!table) {
        load();
        return;
      }
      const now = performance.now();
      if (
        !scannedAt ||
        now - scannedAt.at > RESCAN_MS ||
        distanceKm(aircraft.lat, aircraft.lon, scannedAt.lat, scannedAt.lon) > RESCAN_KM
      ) {
        scannedAt = { lat: aircraft.lat, lon: aircraft.lon, at: now };
        nearby = scan(aircraft.lat, aircraft.lon);
      }

      // Who is in the air and near is a question about every route in range;
      // where each of the forty we are drawing has got to is a question about
      // forty. The first is asked twice a second, the second every frame, and
      // that is the difference between this costing nothing and costing the
      // scene its frame rate.
      if (!census || now - census > CENSUS_MS) {
        census = now;
        const found = [];
        for (const entry of nearby) {
          for (const flight of flightsOn(entry, seconds)) {
            const where = state(flight);
            const away = distanceKm(aircraft.lat, aircraft.lon, where.lat, where.lon);
            if (away > RANGE_KM) continue;
            found.push({ flight, away });
          }
        }
        // Nearest first, because the cut at forty should drop the specks.
        found.sort((a, b) => a.away - b.away);
        found.length = Math.min(found.length, MAX_LIVE);
        while (live.length > found.length) release(live.pop().entity);
        while (live.length < found.length) live.push({ entity: take(), key: null });
        found.forEach(({ flight }, i) => {
          live[i].flight = flight;
        });
      }

      list = live.map((slot) => {
        const flight = slot.flight;
        // The progress moves on between censuses; everything else is fixed.
        flight.progress = (seconds - (flight.offset + flight.n * flight.period)) / flight.duration;
        const where = state(flight);
        const away = distanceKm(aircraft.lat, aircraft.lon, where.lat, where.lon);
        const key = `${flight.index}/${flight.n}`;
        if (slot.key !== key) {
          // Everything that does not change while this aeroplane is this
          // aeroplane. The callsign is a hash over strings and the colour a
          // second one; doing both for forty of them on every frame was most
          // of what this cost.
          slot.key = key;
          slot.sign = callsign(flight);
          slot.entity.model.color = tint(slot.sign.airline[0]);
          slot.entity.model.scale = sizeOf(table.equipment[flight.route[3]]);
        }
        const sign = slot.sign;
        const position = Cartesian3.fromDegrees(where.lon, where.lat, where.alt);
        slot.entity.position = position;
        // The model is authored nose along +Z and up along +Y, which Cesium
        // maps to forward and up in the entity's own frame; a heading, a
        // pitch and no roll is therefore all it takes to sit it in the sky.
        slot.entity.orientation = Transforms.headingPitchRollQuaternion(
          position,
          new HeadingPitchRoll(where.heading, where.pitch, 0),
        );
        return {
          lat: where.lat,
          lon: where.lon,
          ft: where.ft,
          vsFt: where.vsFt,
          heading: where.heading,
          away,
          callsign: sign.code,
          spoken: sign.spoken,
          airline: sign.airline[3],
          type: table.equipment[flight.route[3]],
          from: table.airports[flight.route[1]][0],
          to: table.airports[flight.route[2]][0],
          relativeFt: where.ft - (aircraft.alt ?? 0) / FT,
        };
      });
    },
  };
}
