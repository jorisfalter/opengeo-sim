/**
 * A flight plan, and the guidance that flies it.
 *
 * The autopilot already knew how to hold a heading and a height; what it
 * could not do was be told where to go. This turns a list of places into the
 * two numbers that loop wants — a heading and an altitude — and keeps them
 * coming until the last waypoint is behind you.
 *
 * The navigation is great-circle rather than flat: over a sixty-kilometre
 * Alpine leg the difference is metres, but the formulae are no harder and
 * they do not break when somebody plans Reykjavik to Samedan.
 */
const R = 6371000;
const DEG = Math.PI / 180;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function distanceBetween(from, to) {
  const φ1 = from.lat * DEG;
  const φ2 = to.lat * DEG;
  const dφ = φ2 - φ1;
  const dλ = (to.lon - from.lon) * DEG;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing along the great circle, in radians from north. */
export function bearingBetween(from, to) {
  const φ1 = from.lat * DEG;
  const φ2 = to.lat * DEG;
  const dλ = (to.lon - from.lon) * DEG;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return Math.atan2(y, x);
}

/** Signed metres off the leg: positive means the aeroplane is right of it. */
function crossTrack(from, to, pos) {
  const d13 = distanceBetween(from, pos) / R;
  if (d13 === 0) return 0;
  const θ13 = bearingBetween(from, pos);
  const θ12 = bearingBetween(from, to);
  return Math.asin(clamp(Math.sin(d13) * Math.sin(θ13 - θ12), -1, 1)) * R;
}

export function createPlan({ onNotice } = {}) {
  const points = [];
  let index = 0;
  // Where the aeroplane was when the plan was armed, so the first leg is a
  // line from there rather than from nowhere.
  let origin = null;

  const api = {
    get points() {
      return points;
    },
    get index() {
      return index;
    },
    get finished() {
      return index >= points.length;
    },
    add(point) {
      points.push({ name: point.name, lat: point.lat, lon: point.lon, alt: point.alt ?? null });
      return points.length;
    },
    remove(i) {
      points.splice(i, 1);
      if (index > points.length) index = points.length;
    },
    clear() {
      points.length = 0;
      index = 0;
      origin = null;
    },

    /**
     * Start flying it from wherever you are. The leg picked is the first one
     * whose waypoint is still ahead of the aeroplane — fly halfway down a
     * plan by hand, arm it, and it carries on rather than turning back.
     */
    arm(aircraft) {
      origin = { lat: aircraft.lat, lon: aircraft.lon };
      index = 0;
      let best = Infinity;
      points.forEach((point, i) => {
        const d = distanceBetween(aircraft, point);
        const course = bearingBetween(aircraft, point);
        let off = course - (aircraft.heading ?? course);
        while (off > Math.PI) off -= 2 * Math.PI;
        while (off < -Math.PI) off += 2 * Math.PI;
        // Behind you counts double, so a waypoint you have passed only wins
        // when there is nothing ahead at all.
        const cost = d * (Math.abs(off) > Math.PI / 2 ? 2.5 : 1);
        if (cost < best) {
          best = cost;
          index = i;
        }
      });
      return points[index] ?? null;
    },

    /** Everything the autopilot and the glass need, or null when it is done. */
    guide(aircraft) {
      if (index >= points.length) return null;
      let target = points[index];
      const distance = distanceBetween(aircraft, target);

      // Turn early, and know when you have missed.
      //
      // The first version captured at nine seconds of flying — 1.3 km at
      // cruise — and flew straight past, because the autopilot banks 25
      // degrees and at 283 knots that is a turn radius of 4.6 kilometres. A
      // waypoint inside your own turning circle cannot be reached, and with
      // nothing to say so the aeroplane chased it over the horizon. (It ended
      // up in the Jura.)
      //
      // So: capture at most of a turn radius, and sequence anyway the moment
      // the waypoint falls behind the wing, which is what the second test
      // means — bearing to it more than ninety degrees off the leg.
      const groundSpeed = Math.max(40, aircraft.speed ?? 120);
      const radius = (groundSpeed * groundSpeed) / (9.81 * Math.tan(25 * DEG));
      const capture = Math.max(700, radius * 0.9);
      const legCourse = bearingBetween(index > 0 ? points[index - 1] : (origin ?? aircraft), target);
      let behind = bearingBetween(aircraft, target) - legCourse;
      while (behind > Math.PI) behind -= 2 * Math.PI;
      while (behind < -Math.PI) behind += 2 * Math.PI;
      if (distance < capture || Math.abs(behind) > Math.PI / 2) {
        index += 1;
        origin = { lat: target.lat, lon: target.lon };
        if (index >= points.length) {
          onNotice?.(`${target.name} — plan complete`);
          return null;
        }
        onNotice?.(`Next: ${points[index].name}`);
        target = points[index];
      }

      const from = index > 0 ? points[index - 1] : (origin ?? aircraft);
      const direct = bearingBetween(aircraft, target);
      const left = distanceBetween(aircraft, target);
      // Close in, go straight at it; further out, fly the line between the
      // waypoints and cut back onto it at up to thirty-five degrees.
      let heading = direct;
      if (left > 3000) {
        const course = bearingBetween(from, target);
        const off = crossTrack(from, target, aircraft);
        heading = course + clamp(-off * 0.03, -35, 35) * DEG;
      }

      let remaining = left;
      for (let i = index; i < points.length - 1; i += 1) {
        remaining += distanceBetween(points[i], points[i + 1]);
      }

      return {
        heading,
        alt: target.alt ?? aircraft.alt,
        name: target.name,
        distance: left,
        remaining,
        seconds: remaining / groundSpeed,
      };
    },
  };
  return api;
}
