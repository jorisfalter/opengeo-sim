// The real flight model: JSBSim, the same engine FlightGear flies on, compiled
// to WebAssembly and stepped from the browser.
//
// It replaces the point-mass model in flight.js and keeps its interface, so the
// view code does not care which one it is flying. What changes is that the
// aerodynamics are now solved rather than approximated: thrust lapses with
// altitude, a climb bleeds speed, the wing stalls because it runs out of lift,
// and the gear and brakes bring the aeroplane to a stop by themselves.
//
// The aircraft and engine definitions in public/fdm are our own work, written
// against published PC-24 figures and checked by scripts/test-fdm.mjs. JSBSim
// itself is LGPL 2.1 and is loaded as an unmodified library; see ATTRIBUTION.md.
import { asset } from '../base.js';

import { JSBSimSdk } from '@0x62/jsbsim-wasm';

const DT = 1 / 120; // JSBSim runs at a fixed rate; frames are split into steps.
// A JSBSim step costs about 23 microseconds, so 160 of them is under four
// milliseconds of a frame — affordable, and enough to deliver sixteen times
// real time even on a machine managing only twelve frames a second. Beyond
// that the physics would eat the frame it is meant to fit inside.
const MAX_STEPS = 160;
const FT = 0.3048;
const KT = 0.514444;
const DEG = Math.PI / 180;
const FILES = ['aircraft/pc24/pc24.xml', 'engine/fj44.xml', 'engine/direct.xml'];

/** Loads JSBSim and the aeroplane. Resolves once the model is in place. */
export async function createFdm(start, { onStatus } = {}) {
  onStatus?.('JSBSim laden…');
  const sdk = await JSBSimSdk.create({
    moduleUrl: asset('fdm/wasm/jsbsim_wasm.mjs'),
    wasmUrl: asset('fdm/wasm/jsbsim_wasm.wasm'),
    log: { console: false },
  });

  onStatus?.('Vliegtuigmodel laden…');
  const sources = await Promise.all(
    FILES.map((path) => fetch(asset(`fdm/${path}`)).then((res) => res.text())),
  );
  FILES.forEach((path, i) => sdk.writeDataFile(path, sources[i]));
  sdk.configurePaths({
    rootDir: '/runtime',
    aircraftPath: 'aircraft',
    enginePath: 'engine',
    systemsPath: 'systems',
  });
  if (!sdk.loadModel('pc24')) throw new Error('JSBSim weigerde het vliegtuigmodel');
  sdk.setDt(DT);

  const fdm = new Fdm(sdk);
  fdm.reset(start);
  return fdm;
}

class Fdm {
  constructor(sdk) {
    this.sdk = sdk;
    // Commanded attitude. The keyboard moves these and an inner loop flies to
    // them, which is what makes a real flight model keyboard-flyable: you ask
    // for ten degrees of pitch, the aeroplane works out the elevator.
    this.cmdPitch = 0;
    this.cmdBank = 0;
    this.trim = 0;
    this.law = 'assist';
    this.axes = { pitch: 0, roll: 0, yaw: 0, trim: 0 };
    this.ground = 0;
    this.steer = 0;
    this.aircraft = {};
  }

  get(prop) {
    return this.sdk.getPropertyValue(prop);
  }

  set(prop, value) {
    this.sdk.setPropertyValue(prop, value);
  }

  /** Puts the aeroplane somewhere, on the ground or in the air, and trims it. */
  reset(start) {
    const sdk = this.sdk;
    this.ground = start.groundHeight ?? start.alt - 1.6;
    this.set('ic/lat-geod-deg', start.lat);
    this.set('ic/long-gc-deg', start.lon);
    this.set('ic/terrain-elevation-ft', this.ground / FT);
    this.set('ic/psi-true-deg', start.heading);
    this.set('ic/vc-kts', start.speed ?? 0);
    this.set('ic/gamma-deg', 0);
    if (start.onGround) this.set('ic/h-agl-ft', 1.6 / FT);
    else this.set('ic/h-sl-ft', start.alt / FT);
    this.set('propulsion/set-running', -1);
    sdk.runIc();

    this.set('fcs/throttle-cmd-norm[0]', start.throttle ?? 0);
    this.set('fcs/throttle-cmd-norm[1]', start.throttle ?? 0);
    this.set('gear/gear-cmd-norm', start.gear ? 1 : 0);
    this.set('fcs/flap-cmd-norm', (start.flaps ?? 0) / 2);
    // Gear and flaps travel on a timer; in the air they are wanted now.
    if (!start.onGround) {
      this.set('gear/gear-pos-norm', start.gear ? 1 : 0);
      this.set('fcs/flap-pos-deg', ((start.flaps ?? 0) / 2) * 33);
    }
    this.cmdPitch = this.get('attitude/theta-rad');
    this.cmdBank = 0;
    this.sample();
  }

  /** Copies JSBSim's state into the plain object the view code reads. */
  sample() {
    const a = this.aircraft;
    a.lat = this.get('position/lat-geod-deg');
    a.lon = this.get('position/long-gc-deg');
    a.alt = this.get('position/h-sl-ft') * FT;
    a.agl = this.get('position/h-agl-ft') * FT;
    a.heading = this.get('attitude/psi-rad');
    a.pitch = this.get('attitude/theta-rad');
    a.bank = this.get('attitude/phi-rad');
    a.alpha = this.get('aero/alpha-rad');
    a.speed = this.get('velocities/vtrue-kts') * KT;
    a.kias = this.get('velocities/vc-kts');
    a.mach = this.get('velocities/mach');
    a.vs = this.get('velocities/h-dot-fps') * FT;
    a.gLoad = this.get('accelerations/Nz');
    a.throttle = this.get('fcs/throttle-cmd-norm[0]');
    a.gear = this.get('gear/gear-cmd-norm') > 0.5;
    a.flaps = Math.round((this.get('fcs/flap-cmd-norm') * 2 * 10) / 10);
    a.brakes = this.get('fcs/left-brake-cmd-norm') > 0.5;
    a.onGround = this.get('gear/unit/WOW') > 0.5 || this.get('gear/unit[1]/WOW') > 0.5;
    a.thrust = this.get('propulsion/engine/thrust-lbs') + this.get('propulsion/engine[1]/thrust-lbs');
    a.stall = a.alpha > 14 * DEG;
    return a;
  }

  /**
   * Advances the model by `dt` seconds of simulated time.
   *
   * `input` arrives in one of three shapes:
   *   { attitude: { pitch, bank }, throttle }   the autopilot, flying an attitude
   *   { law: 'assist', pitch, roll, yaw, ... }  axes command an attitude
   *   { law: 'direct', pitch, roll, yaw, ... }  axes are the control surfaces
   */
  step(input, dt, groundHeight) {
    if (Number.isFinite(groundHeight)) {
      // The ground must not teleport. Terrain data has holes and coarse tiles
      // in it, and a height that jumps a few hundred metres in one frame puts
      // the gear that far inside the hillside; the spring then answers with a
      // few million pounds and throws the aeroplane into orbit. Under the
      // aircraft the ground can only change as fast as it is flying over it, so
      // that is the limit: a hundred per cent gradient at the current speed.
      // The floor is low enough that running off the end into a hillside
      // stops the aeroplane rather than quietly lifting it up the slope.
      const rate = Math.max(8, this.aircraft.speed ?? 0) * Math.max(dt, DT);
      this.ground += clamp(groundHeight - this.ground, -rate, rate);
    }
    const a = this.aircraft;

    this.law = input.law === 'direct' && !input.attitude ? 'direct' : 'assist';
    this.axes = input;
    if (input.attitude) {
      // The autopilot hands over an attitude straight away.
      this.cmdPitch = input.attitude.pitch;
      this.cmdBank = input.attitude.bank;
    } else if (this.law === 'assist') {
      // Keyboard and mouse: pitch moves at 7°/s, bank at 45°/s, and both hold
      // where they are let go, which is what makes four keys enough to fly.
      //
      // The hand moves in real time, not simulated time. Integrating these on
      // the simulated step would make a tap on the arrow key worth sixteen
      // times as much attitude at sixteen times speed, which is unflyable.
      const hand = input.handDt ?? dt;
      this.cmdPitch += input.pitch * 7 * DEG * hand;
      this.cmdBank += input.roll * 45 * DEG * hand;
      // Wings roll themselves level when the stick is centred; the nose does
      // not, because an attitude that will not hold is no use on an approach.
      if (!input.roll) this.cmdBank *= Math.max(0, 1 - 1.2 * hand);
      this.cmdPitch = clamp(this.cmdPitch + (input.trim ?? 0) * 10 * DEG * hand, -15 * DEG, 20 * DEG);
      this.cmdBank = clamp(this.cmdBank, -67 * DEG, 67 * DEG);
    }
    // On the ground below rotate speed there is nothing to command but the nose.
    if (a.onGround && this.law === 'assist') this.cmdBank = 0;
    // The rudder pedals steer the nosewheel on the ground and yaw in the air.
    this.steer = clamp(input.yaw ?? 0, -1, 1);

    this.set('fcs/throttle-cmd-norm[0]', input.throttle);
    this.set('fcs/throttle-cmd-norm[1]', input.throttle);
    // It has to be the -asl- property. Writing position/terrain-elevation-ft at
    // runtime reads back fine and changes nothing: the aeroplane keeps touching
    // down on the height it was initialised with, which on a mountain approach
    // means landing a few hundred metres under the runway.
    this.set('position/terrain-elevation-asl-ft', this.ground / FT);

    const steps = Math.min(MAX_STEPS, Math.max(1, Math.round(dt / DT)));
    for (let i = 0; i < steps; i += 1) {
      this.fly(a.onGround);
      if (!this.sdk.run()) break;
      this.sample();
    }
    return this.aircraft;
  }

  /**
   * The inner loop: elevator and aileron to hold the commanded attitude, rudder
   * to take the sideslip out. Positive elevator is trailing edge down, so a
   * nose-up correction is a negative command.
   *
   * The elevator needs an integrator, not just a proportional term. Holding an
   * attitude takes a standing deflection that changes with speed, flap setting
   * and centre of gravity, and a proportional loop can only produce that by
   * sitting on a standing error — eight degrees of it on the approach, which is
   * the difference between landing and flying into a mountain. The integrator is
   * the trim wheel, and it does the same job here as it does in the cockpit.
   */
  fly(onGround) {
    if (this.law === 'direct') {
      // Nothing between the pilot and the surfaces but the trim.
      const axes = this.axes;
      this.set('fcs/elevator-cmd-norm', clamp(-axes.pitch - (axes.trim ?? 0), -1, 1));
      this.set('fcs/aileron-cmd-norm', clamp(axes.roll, -1, 1));
      this.set('fcs/rudder-cmd-norm', clamp(axes.yaw ?? 0, -1, 1));
      // Keep the auto-trim where the pilot left it, so switching laws back
      // does not snap the nose.
      this.trim = clamp(-(axes.trim ?? 0), -0.8, 0.8);
      return;
    }
    const pitch = this.get('attitude/theta-rad');
    const bank = this.get('attitude/phi-rad');
    const q = this.get('velocities/q-aero-rad_sec');
    const p = this.get('velocities/p-aero-rad_sec');
    const beta = this.get('aero/beta-rad');
    // Gains fall off with airspeed the way a real surface's authority rises, so
    // the loop stays steady from 60 knots to 440.
    const scale = clamp(200 / Math.max(60, this.get('velocities/vc-kts')), 0.45, 2.2);

    // Rolling on the wheels, the attitude loop has nothing to do and doing it
    // anyway is harmful: the gear holds the attitude, the loop sees no
    // response, its integrator winds up, and the moment the wheels go light
    // the stored-up elevator throws the aeroplane into the air. Going down
    // Courchevel that produced two dozen hops before rotate speed. So below
    // rotate speed on the ground the stick goes straight to the elevator and
    // the integrator is held still, and the loop fades in over the twenty
    // knots either side of rotation rather than switching.
    const kias = this.get('velocities/vc-kts');
    const onWheels = onGround ? clamp((95 - kias) / 20, 0, 1) : 0;

    const error = this.cmdPitch - pitch;
    const demand = -(error * 2.6 - q * 0.9) * scale;
    const stick = -(this.axes.pitch ?? 0) - (this.axes.trim ?? 0);
    const elevator = clamp(
      (demand + this.trim) * (1 - onWheels) + stick * onWheels,
      -1,
      1,
    );
    // Anti-windup: the trim only moves while the surface has somewhere to go,
    // and never while the aeroplane is sitting on its wheels.
    if (onWheels < 0.5 && (Math.abs(elevator) < 0.98 || Math.sign(error) !== -Math.sign(elevator))) {
      this.trim = clamp(this.trim - error * 0.9 * DT, -0.8, 0.8);
    }
    this.set('fcs/elevator-cmd-norm', elevator);
    // Keep the commanded attitude on the aeroplane's own while it is rolling,
    // so rotation starts from where the nose actually is.
    if (onWheels > 0.5) this.cmdPitch = pitch;
    const aileron = ((this.cmdBank - bank) * 1.6 - p * 0.5) * scale;
    this.set('fcs/aileron-cmd-norm', clamp(aileron, -1, 1));
    // On the ground the rudder steers; in the air it only keeps the ball centred.
    // Pedals. Two corrections live here, both found by measuring rather than
    // reasoning about conventions:
    //
    //  - The sign was inverted. With this aeroplane's CnDr, a positive rudder
    //    command yaws the nose LEFT, so right pedal has to be negative. Full
    //    right pedal used to turn the aeroplane twenty degrees to the left.
    //  - On the ground the rudder alone barely does anything at taxi speed.
    //    The nosewheel is driven by fcs/steer-cmd-norm, which was never set,
    //    so there was effectively no steering below flying speed.
    const pedal = -this.steer;
    this.set('fcs/rudder-cmd-norm', clamp(onGround ? pedal : pedal * 0.6 - beta * 2.0, -1, 1));
    // Nosewheel authority tapers off with speed, or a bootful of pedal during
    // the take-off roll would put the aeroplane in the grass.
    const taper = clamp(1.4 - this.get('velocities/vg-fps') / 70, 0.15, 1);
    this.set('fcs/steer-cmd-norm', clamp(onGround ? pedal * taper : 0, -1, 1));
  }

  setGear(down) {
    // Retracting the gear with weight on the wheels would drop the aeroplane
    // through the runway, so it is simply not allowed.
    if (!down && this.aircraft.onGround) return;
    this.set('gear/gear-cmd-norm', down ? 1 : 0);
  }

  setFlaps(notch) {
    this.set('fcs/flap-cmd-norm', clamp(notch / 2, 0, 1));
  }

  setBrakes(on) {
    this.set('fcs/left-brake-cmd-norm', on ? 1 : 0);
    this.set('fcs/right-brake-cmd-norm', on ? 1 : 0);
    this.set('fcs/center-brake-cmd-norm', on ? 1 : 0);
  }

  setSpeedbrake(on) {
    this.set('fcs/speedbrake-cmd-norm', on ? 1 : 0);
  }

  get speedbrake() {
    return this.get('fcs/speedbrake-cmd-norm') > 0.5;
  }

  /** Nose wheel steering, -1..1, used on the ground. */
  steerBy(value) {
    this.steer = clamp(value, -1, 1);
  }

  destroy() {
    this.sdk.destroy?.();
  }
}

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

/**
 * Autopilot for the real flight model. Three cascaded loops, the way an
 * autopilot is actually built: the route gives a heading, heading gives a bank,
 * and the altitude gives a vertical speed which gives a pitch attitude.
 *
 * The throttle is flown on energy rather than on speed alone. Speed alone looks
 * right until the aeroplane ends up below its profile: it is then fast for the
 * leg, so the thrust comes back, while the nose is up to climb — which is how a
 * real aeroplane ends up mushing down at high alpha with the engines at idle.
 * Adding the vertical speed error means being low commands thrust.
 *
 * The last leg is different. Flying to a point will not land an aeroplane; it
 * will circle one. A leg marked `land` is flown as an approach instead: track
 * the runway axis, hold a gradient down to the threshold, flare, and brake.
 */
export function autopilot(fdm, route, state, dt = 1 / 60) {
  const a = fdm.aircraft;
  const target = route[state.leg];
  if (!target) return { attitude: { pitch: 0, bank: 0 }, throttle: a.throttle };

  const METERS_PER_DEGREE = 111320;
  const dNorth = (target.lat - a.lat) * METERS_PER_DEGREE;
  const dEast = (target.lon - a.lon) * METERS_PER_DEGREE * Math.cos(a.lat * DEG);
  const distance = Math.hypot(dNorth, dEast);
  if (distance < (target.radius ?? 900) && state.leg < route.length - 1) state.leg += 1;

  let course = Math.atan2(dEast, dNorth);
  let wantedAlt = target.alt;
  let wantedSpeed = (target.speed ?? 220) * KT;
  let flare = false;

  if (target.land) {
    // Along-track and cross-track against the runway axis, so the aeroplane
    // flies the centreline rather than aiming at the threshold from wherever it
    // happens to be.
    const axis = target.heading * DEG;
    const along = dNorth * Math.cos(axis) + dEast * Math.sin(axis);
    const across = -dNorth * Math.sin(axis) + dEast * Math.cos(axis);
    course = axis + clamp(Math.atan2(across, Math.max(300, along)), -40 * DEG, 40 * DEG);
    // Courchevel is flown at about six degrees, twice an airliner's approach.
    wantedAlt = target.alt + Math.max(0, along) * (target.glide ?? 0.105);
    // Hold the approach speed to the threshold, then flare: nose up, idle, and
    // aim a couple of metres into the runway so the aeroplane keeps settling.
    if (a.agl < 9) {
      flare = true;
      wantedAlt = a.alt - 2;
      wantedSpeed = (target.speed ?? 115) * 0.88 * KT;
    }
  }

  let error = course - a.heading;
  while (error > Math.PI) error -= 2 * Math.PI;
  while (error < -Math.PI) error += 2 * Math.PI;
  const bank = clamp(error * 1.3, -35 * DEG, 35 * DEG);

  // Vertical speed first, then the pitch attitude that flies it. Pitch is the
  // flight path angle plus the angle of attack, which is why this loop needs
  // the aeroplane's own alpha rather than a guess.
  const maxDown = a.gear ? 6 : 12;
  const wantedVs = clamp((wantedAlt - a.alt) * 0.03, flare ? -0.8 : -maxDown, 14);
  const gamma = Math.asin(clamp(wantedVs / Math.max(a.speed, 50), -0.3, 0.3));
  let pitch = clamp(gamma + a.alpha, -12 * DEG, 16 * DEG);

  // Speed protection. The flight model will stall if asked to, so the autopilot
  // has to not ask: below the configuration's minimum the nose comes down, and
  // the climb waits.
  const floor = (a.flaps > 0 ? 110 : 140) * (a.gear ? 1 : 1.05);
  if (a.kias < floor) pitch = Math.min(pitch, a.alpha - (floor - a.kias) * 0.4 * DEG);

  let throttle = autoThrottle(a, tasFor(a, Math.min(wantedSpeed / KT, limitKias(a))), wantedVs, dt);
  if (flare) throttle = Math.min(throttle, 0.1);

  // Down: everything that stops an aeroplane, at once. Courchevel's runway is
  // 500 m long, so there is no waiting for the speed to come off by itself.
  if (a.onGround && target.land) {
    fdm.setBrakes(true);
    fdm.setSpeedbrake(true);
    throttle = 0;
    pitch = 0;
  }

  const config = { gear: target.gear ?? a.gear, flaps: target.flaps ?? a.flaps };
  return { attitude: { pitch, bank }, throttle, config, distance, target, flare };
}

/**
 * The fastest this aeroplane may legally go where it is now, in KIAS: Vmo low
 * down, Mmo high up, whichever bites first, with a margin so the autopilot
 * does not live on the red line.
 */
function limitKias(a) {
  const VMO = 282; // red line 290
  const MMO = 0.72; // red line 0.74
  const byMach = (a.mach ?? 0) > 0.15 ? (a.kias * MMO) / a.mach : Infinity;
  return Math.min(VMO, byMach);
}

/** Indicated to true, measured from the aeroplane rather than assumed. */
const tasFor = (a, kias) => kias * KT * (a.speed / Math.max(1, a.kias * KT));

/**
 * Autothrottle.
 *
 * The old one added a speed error straight onto the lever every frame, which
 * is an integrator with a gain of about twenty. It did exactly what that
 * predicts: slammed to full, overshot, slammed to idle, and hunted between the
 * stops for the whole flight.
 *
 * This one asks for a *rate* of lever movement, bounded to what a thrust lever
 * actually does — about three seconds from idle to full — and works on total
 * energy, because climbing and accelerating both need thrust while trading one
 * for the other needs none. The deadband stops it fidgeting once it is there.
 */
function autoThrottle(a, wantedTas, wantedVs, dt) {
  const energyError = (wantedVs - a.vs) + (wantedTas - a.speed) * 0.35;
  if (Math.abs(energyError) < 0.3) return a.throttle;
  const rate = clamp(energyError * 0.05, -0.3, 0.3);
  return clamp(a.throttle + rate * Math.min(dt, 0.5), 0, 1);
}

/**
 * The other autopilot: no route, just hold what the aeroplane is doing. This
 * is the one that matters in free flight — wings level, a heading, a height —
 * and it is what the autopilot button gives you away from the valley route.
 */
export function holdAutopilot(fdm, target, dt = 1 / 60) {
  const a = fdm.aircraft;
  let error = (target.heading ?? a.heading) - a.heading;
  while (error > Math.PI) error -= 2 * Math.PI;
  while (error < -Math.PI) error += 2 * Math.PI;
  const bank = clamp(error * 1.6, -25 * DEG, 25 * DEG);

  const wantedVs = clamp(((target.alt ?? a.alt) - a.alt) * 0.03, -10, 12);
  const gamma = Math.asin(clamp(wantedVs / Math.max(a.speed, 50), -0.25, 0.25));
  let pitch = clamp(gamma + a.alpha, -10 * DEG, 14 * DEG);
  const floor = (a.flaps > 0 ? 110 : 140) * (a.gear ? 1 : 1.05);
  if (a.kias < floor) pitch = Math.min(pitch, a.alpha - (floor - a.kias) * 0.4 * DEG);

  // With nothing asked for, cruise at the limit: that is what the aeroplane is
  // for, and anything slower is a choice nobody made.
  const wantedKias = Math.min(target.speed ?? limitKias(a), limitKias(a));
  const throttle = autoThrottle(a, tasFor(a, wantedKias), wantedVs, dt);
  return { attitude: { pitch, bank }, throttle };
}

export const toKnots = (ms) => ms / KT;
export const toFeet = (m) => m / FT;
export const toFpm = (ms) => (ms / FT) * 60;
