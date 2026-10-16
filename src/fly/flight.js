// A point-mass flight model with enough inertia to feel like an aeroplane and
// not enough detail to be a type rating. Roughly a PC-24: 8.3 t, two 15 kN
// engines, 425 kt cruise, approach around 100 kt.
//
// The aircraft is flown by its flight path: pitch input moves a commanded climb
// angle, roll commands a bank, and the turn rate follows g·tan(bank)/V the way a
// coordinated turn does. That gives the right feel — speed bleeding in a climb,
// the nose dropping when you pull too slowly — without modelling a single
// aerofoil.

const G = 9.80665;
const KT = 0.514444; // knots to m/s
const FT = 0.3048;

export const LIMITS = {
  mass: 8300,
  maxThrust: 30000, // N, both engines
  dragK: 0.00085, // drag = dragK * V^2 * (1 + gearDrag + flapDrag)
  vMin: 78 * KT, // stall-ish, gear and flaps out
  vMax: 440 * KT,
  maxBank: (60 * Math.PI) / 180,
  maxPitch: (25 * Math.PI) / 180,
  rotate: 95 * KT,
  vRef: 100 * KT,
};

export function createAircraft(start) {
  return {
    lat: start.lat,
    lon: start.lon,
    alt: start.alt, // metres above the ellipsoid
    heading: (start.heading * Math.PI) / 180,
    bank: 0,
    pitch: 0, // commanded flight path angle
    speed: (start.speed ?? 0) * KT,
    vs: 0,
    throttle: start.throttle ?? 0,
    gear: start.gear ?? true,
    flaps: start.flaps ?? 1,
    brakes: false,
    onGround: start.onGround ?? false,
    gLoad: 1,
  };
}

/**
 * Advances the aircraft. `input` carries pitch/roll/throttle in [-1, 1] and the
 * ground height under the aircraft so it can sit on a runway and flare onto it.
 */
export function step(aircraft, input, dt, groundHeight) {
  const a = aircraft;
  const drag = LIMITS.dragK * a.speed * a.speed * (1 + (a.gear ? 0.35 : 0) + a.flaps * 0.3);
  const thrust = a.throttle * LIMITS.maxThrust;
  const brake = a.onGround && a.brakes ? 4500 : 0;

  // Controls move commanded bank and flight path angle, with a rate limit that
  // stands in for control authority and inertia.
  const bankTarget = input.roll * LIMITS.maxBank;
  a.bank += Math.max(-1.4 * dt, Math.min(1.4 * dt, bankTarget - a.bank));
  const pitchTarget = input.pitch * LIMITS.maxPitch;
  a.pitch += Math.max(-0.6 * dt, Math.min(0.6 * dt, pitchTarget - a.pitch));

  if (a.onGround) {
    a.bank = 0;
    // No flying below rotate speed, whatever the stick says.
    if (a.speed < LIMITS.rotate) a.pitch = Math.min(a.pitch, 0);
  }

  // Longitudinal: thrust minus drag minus the component of gravity along the
  // flight path.
  const gamma = a.onGround ? 0 : a.pitch;
  const accel = (thrust - drag - brake) / LIMITS.mass - G * Math.sin(gamma);
  a.speed = Math.max(0, a.speed + accel * dt);

  // Stall: below minimum speed the nose drops no matter what.
  if (!a.onGround && a.speed < LIMITS.vMin) {
    a.pitch = Math.min(a.pitch, -0.12);
  }

  if (!a.onGround) {
    const turnRate = (G * Math.tan(a.bank)) / Math.max(a.speed, 40);
    a.heading = (a.heading + turnRate * dt + 2 * Math.PI) % (2 * Math.PI);
    a.gLoad = 1 / Math.max(0.2, Math.cos(a.bank));
  } else {
    a.heading = (a.heading + input.roll * 0.35 * dt * Math.min(1, a.speed / 30)) % (2 * Math.PI);
    a.gLoad = 1;
  }

  a.vs = a.speed * Math.sin(gamma);
  a.alt += a.vs * dt;

  const ground = groundHeight ?? -Infinity;
  if (a.alt <= ground + 1.6) {
    a.alt = ground + 1.6;
    if (!a.onGround && a.vs < -6) a.hardLanding = true;
    a.onGround = true;
    a.vs = 0;
  } else if (a.onGround && a.speed > LIMITS.rotate && a.pitch > 0.02) {
    a.onGround = false;
  } else if (a.alt > ground + 2.5) {
    a.onGround = false;
  }

  // Move over the ground.
  const distance = a.speed * Math.cos(gamma) * dt;
  const METERS_PER_DEGREE = 111320;
  a.lat += (distance * Math.cos(a.heading)) / METERS_PER_DEGREE;
  a.lon +=
    (distance * Math.sin(a.heading)) / (METERS_PER_DEGREE * Math.cos((a.lat * Math.PI) / 180));
  return a;
}

/**
 * Autopilot: flies a list of waypoints with simple proportional control. Good
 * enough to fly the valley route from Chambéry and put the aircraft on final at
 * Courchevel without anyone touching the keyboard.
 */
export function autopilot(aircraft, route, state) {
  const a = aircraft;
  const target = route[state.leg];
  if (!target) return { pitch: 0, roll: 0, throttle: a.throttle };

  const METERS_PER_DEGREE = 111320;
  const dNorth = (target.lat - a.lat) * METERS_PER_DEGREE;
  const dEast = (target.lon - a.lon) * METERS_PER_DEGREE * Math.cos((a.lat * Math.PI) / 180);
  const distance = Math.hypot(dNorth, dEast);
  if (distance < (target.radius ?? 900) && state.leg < route.length - 1) state.leg += 1;

  let error = Math.atan2(dEast, dNorth) - a.heading;
  while (error > Math.PI) error -= 2 * Math.PI;
  while (error < -Math.PI) error += 2 * Math.PI;
  const roll = Math.max(-1, Math.min(1, error * 1.6));

  // Descend like an aeroplane, not like a lift: 1000 ft/min in the cruise and
  // gentler still once the gear is down for the approach.
  const altitudeError = target.alt - a.alt;
  const maxDown = a.gear ? 6 : 9;
  const wantedVs = Math.max(-maxDown, Math.min(10, altitudeError * 0.025));
  const wantedGamma = Math.asin(Math.max(-0.35, Math.min(0.35, wantedVs / Math.max(a.speed, 50))));
  const pitch = Math.max(-1, Math.min(1, wantedGamma / LIMITS.maxPitch));

  const wantedSpeed = (target.speed ?? 220) * KT;
  const throttle = Math.max(0, Math.min(1, a.throttle + (wantedSpeed - a.speed) * 0.02));
  return { pitch, roll, throttle, distance, target };
}

export const toKnots = (ms) => ms / KT;
export const toFeet = (m) => m / FT;
export const toFpm = (ms) => (ms / FT) * 60;
