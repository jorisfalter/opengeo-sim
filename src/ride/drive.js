// Speed profile for the ride: a timetable-shaped run over the track.
//
// Two passes, the way a driving-advice system does it. Backwards from every
// stop, the braking envelope sqrt(2*a*(s_stop - s)) caps the speed. Forwards,
// the train accelerates towards whichever cap is lowest at that point: line
// speed, curve speed (both from the builder) or that envelope. The result is a
// timeline the view can sample by time.

const ACCELERATION = 0.65; // m/s^2, sprinter-class unit on level track
const BRAKING = 0.7; // m/s^2 service brake
const DWELL = 45; // seconds at an intermediate stop
const DT = 0.05;

const kmhToMs = (kmh) => kmh / 3.6;

export function buildRun(ride) {
  const { axis } = ride;
  const count = axis.lat.length;
  const step = ride.step;

  // Stops that are actually on the route, origin and destination included. The
  // tolerance matters: the destination sits at the very last axis point, which
  // rounds to a hair past the stored ride length.
  const stops = ride.stops
    .filter((stop) => stop.chainage >= 0 && stop.chainage <= ride.length + 5)
    .map((stop) => ({
      ...stop,
      chainage: Math.min(stop.chainage, ride.length),
      index: Math.min(count - 1, Math.round(stop.chainage / step)),
    }));

  // Line and curve speed from the builder; the braking envelope is applied in
  // the loop below, against the next stop only. Baking every stop into one
  // array would leave a hard zero at each platform that the train can never
  // accelerate away from.
  const limit = new Float64Array(count);
  for (let i = 0; i < count; i += 1) limit[i] = kmhToMs(axis.speed[i]);

  const timeline = [];
  let time = 0;
  let distance = 0;
  let speed = 0;
  const events = [];
  let nextStop = 1;
  timeline.push({ t: 0, s: 0, v: 0 });
  // Cap the simulated run so a bad profile cannot spin here forever.
  const maxSteps = 120 * 60 * (1 / DT);
  for (let iteration = 0; iteration < maxSteps; iteration += 1) {
    const i = Math.min(count - 1, Math.round(distance / step));
    const ahead = stops[nextStop];
    const toStop = ahead ? Math.max(0, ahead.chainage - distance) : Infinity;
    const target = Math.min(limit[i], Math.sqrt(2 * BRAKING * toStop));
    if (speed < target) speed = Math.min(target, speed + ACCELERATION * DT);
    else if (speed > target) speed = Math.max(target, speed - BRAKING * DT);
    distance += speed * DT;
    time += DT;
    timeline.push({ t: time, s: distance, v: speed });

    const stop = stops[nextStop];
    if (stop && distance >= stop.chainage - 0.5) {
      // Stand still for the dwell, then carry on.
      events.push({ name: stop.name, arrival: time, chainage: stop.chainage });
      speed = 0;
      distance = stop.chainage;
      const dwell = nextStop === stops.length - 1 ? 0 : DWELL;
      for (let held = 0; held < dwell; held += 1) {
        time += 1;
        timeline.push({ t: time, s: distance, v: 0 });
      }
      nextStop += 1;
      if (nextStop >= stops.length) break;
    }
    if (distance >= ride.length) break;
  }

  const duration = timeline.at(-1).t;

  /** Position and speed at simulated second `t`, binary searched. */
  function stateAt(t) {
    const clamped = Math.max(0, Math.min(duration, t));
    let lo = 0;
    let hi = timeline.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (timeline[mid].t <= clamped) lo = mid;
      else hi = mid;
    }
    const a = timeline[lo];
    const b = timeline[hi];
    const f = b.t === a.t ? 0 : (clamped - a.t) / (b.t - a.t);
    return {
      t: clamped,
      s: a.s + (b.s - a.s) * f,
      v: a.v + (b.v - a.v) * f,
      done: clamped >= duration,
    };
  }

  /** First stop ahead of chainage `s`. */
  const stopAhead = (s) => stops.find((stop) => stop.chainage > s + 5) ?? stops.at(-1);

  return { stops, events, duration, stateAt, stopAhead };
}
