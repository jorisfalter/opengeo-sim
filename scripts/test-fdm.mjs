#!/usr/bin/env node
// Runs the flight model headless, so an aeroplane can be checked against its
// book figures before anyone tries to fly it.
//
//   node scripts/test-fdm.mjs                  # the PC-24
//   node scripts/test-fdm.mjs a380             # the A380
//   node scripts/test-fdm.mjs --verbose        # with JSBSim's own console output
//
// JSBSim is the same engine FlightGear uses; here it runs as WebAssembly, in
// Node, which means a whole flight can be tested in a few seconds without a
// browser.
//
// The profiles below are the book figures, and they are the point of the file:
// the same script flies a six-tonne light jet and a four-hundred-and-fifty
// tonne widebody, and what changes is a dozen numbers rather than any of the
// code. Where the script does have to know which aeroplane it is flying —
// how hard to pull on the elevator, how many engines to add up — that is in
// the profile too.
import { readFile } from 'node:fs/promises';
import { JSBSimSdk } from '@0x62/jsbsim-wasm';
import { wasmBinaryUrl, wasmModuleUrl } from '@0x62/jsbsim-wasm/wasm';

const DT = 1 / 120;
const FT_PER_M = 0.3048;

export const PROFILES = {
  pc24: {
    name: 'PC-24',
    files: ['aircraft/pc24/pc24.xml', 'engine/fj44.xml', 'engine/direct.xml'],
    engines: 2,
    //   rotate        ~95 KIAS          cruise      425-440 KTAS at FL410
    //   initial climb ~4000 fpm         Vmo/Mmo     290 KIAS / M0.74
    //   stall, clean  ~95 KIAS          stall, land ~85 KIAS
    rotate: 95,
    takeoffFlap: 0.5,
    climbPitch: 12,
    climbKias: [200, 240],
    mach: 0.7,
    topFt: 41000,
    splits: [10000, 20000, 30000, 40000],
    stallFrom: 160,
    touchdown: 102,
    landingFlapDeg: 33,
    parkedAglFt: 1.6 / FT_PER_M,
    // How hard the harness pulls, per job. These are not the simulator's own
    // gains — the browser flies an inner loop with an integrator and rate
    // damping — they are only what it takes to make this script hold an
    // attitude without hunting. One number for all four jobs does not work:
    // the rotation wants to be brisk and the stall entry wants to be gentle
    // enough that the wing, rather than the harness, decides when it breaks.
    gain: { rotate: 0.06, schedule: 0.078, cruise: 0.1, stall: 0.12 },
    speedGain: 0.1,
  },
  a380: {
    name: 'A380',
    files: ['aircraft/a380/a380.xml', 'engine/trent900.xml', 'engine/direct.xml'],
    engines: 4,
    //   rotate        ~150 KIAS         cruise      M0.85, 490 KTAS at FL370
    //   initial climb ~2500 fpm         Vmo/Mmo     340 KIAS / M0.89
    //   stall, clean  ~160 KIAS         stall, land ~115 KIAS
    rotate: 150,
    takeoffFlap: 0.5,
    climbPitch: 12.5,
    climbKias: [250, 320],
    mach: 0.85,
    topFt: 39000,
    splits: [10000, 20000, 30000, 38000],
    stallFrom: 230,
    touchdown: 140,
    landingFlapDeg: 35,
    // The centre of gravity rests five and a half metres up on an aeroplane
    // whose wheels are two storeys tall.
    parkedAglFt: 5.6 / FT_PER_M,
    // Half the PC-24's, or less: 36 million slug-feet-squared of pitch
    // inertia answers the elevator slowly, and a gain that suits six tonnes
    // makes this one porpoise. Both ends were measured. At 0.025 the rotation
    // took fourteen seconds to reach the screen height — the harness being
    // timid, not the aeroplane being heavy. At 0.09 on the stall entry the
    // loop yanked the nose to 16 degrees at 210 knots and the script called
    // that a stall; the wing was nowhere near giving up.
    gain: { rotate: 0.045, schedule: 0.03, cruise: 0.05, stall: 0.05 },
    speedGain: 0.06,
  },
};

export function profileFor(argv = process.argv.slice(2)) {
  const named = argv.find((arg) => !arg.startsWith('-'));
  const profile = PROFILES[(named ?? 'pc24').toLowerCase()];
  if (!profile) {
    throw new Error(`unknown aircraft "${named}" — try ${Object.keys(PROFILES).join(' or ')}`);
  }
  return profile;
}

export async function boot({ log = false, profile = PROFILES.pc24 } = {}) {
  const sdk = await JSBSimSdk.create({
    moduleUrl: wasmModuleUrl,
    wasmUrl: wasmBinaryUrl,
    log: { console: log, stripAnsi: true },
  });
  const read = (path) => readFile(new URL(`../public/fdm/${path}`, import.meta.url), 'utf8');
  for (const path of profile.files) sdk.writeDataFile(path, await read(path));
  sdk.configurePaths({
    rootDir: '/runtime',
    aircraftPath: 'aircraft',
    enginePath: 'engine',
    systemsPath: 'systems',
  });
  const model = profile.files[0].split('/')[1];
  if (!sdk.loadModel(model)) throw new Error('JSBSim refused the aircraft');
  sdk.setDt(DT);
  return sdk;
}

const get = (sdk, prop) => sdk.getPropertyValue(prop);
const set = (sdk, prop, value) => sdk.setPropertyValue(prop, value);
const DEG = 180 / Math.PI;

function thrust(sdk, engines) {
  let total = 0;
  for (let i = 0; i < engines; i += 1) {
    total += get(sdk, i === 0 ? 'propulsion/engine/thrust-lbs' : `propulsion/engine[${i}]/thrust-lbs`);
  }
  return total;
}

function state(sdk, profile) {
  return {
    t: sdk.getSimTime(),
    kias: get(sdk, 'velocities/vc-kts'),
    ktas: get(sdk, 'velocities/vtrue-kts'),
    mach: get(sdk, 'velocities/mach'),
    altFt: get(sdk, 'position/h-sl-ft'),
    aglFt: get(sdk, 'position/h-agl-ft'),
    pitch: get(sdk, 'attitude/theta-rad') * DEG,
    alpha: get(sdk, 'aero/alpha-rad') * DEG,
    vsFpm: get(sdk, 'velocities/h-dot-fps') * 60,
    weight: get(sdk, 'inertia/weight-lbs'),
    thrust: thrust(sdk, profile.engines),
    elev: get(sdk, 'fcs/elevator-pos-rad'),
  };
}

// Positive elevator deflection is trailing edge down, hence the minus signs:
// a nose-up correction is a negative command.
function holdPitch(sdk, s, target, gain) {
  set(sdk, 'fcs/elevator-cmd-norm', Math.max(-1, Math.min(1, -(target - s.pitch) * gain)));
}

// Chase an airspeed with pitch, the way a climb is actually flown.
function holdSpeed(sdk, s, kias, { maxPitch = 20, minPitch = -5, mach = null, profile } = {}) {
  // Whichever limit is hit first wins, which is what a crossover schedule does.
  const error = mach === null ? s.kias - kias : Math.max(s.kias - kias, (s.mach - mach) * 600);
  const target = Math.max(minPitch, Math.min(maxPitch, s.pitch + error * profile.speedGain));
  holdPitch(sdk, s, target, profile.gain.schedule);
}

function holdWings(sdk) {
  const roll = get(sdk, 'attitude/phi-rad') * DEG;
  const p = get(sdk, 'velocities/p-aero-rad_sec') * DEG;
  set(sdk, 'fcs/aileron-cmd-norm', Math.max(-1, Math.min(1, (-roll * 0.03) - p * 0.02)));
  set(sdk, 'fcs/rudder-cmd-norm', Math.max(-1, Math.min(1, -get(sdk, 'aero/beta-rad') * DEG * 0.05)));
}

function throttles(sdk, profile, value) {
  for (let i = 0; i < profile.engines; i += 1) set(sdk, `fcs/throttle-cmd-norm[${i}]`, value);
}

function line(label, s) {
  return (
    `${label}: ${s.kias.toFixed(0)} KIAS / ${s.ktas.toFixed(0)} KTAS / M${s.mach.toFixed(3)} at ` +
    `${Math.round(s.altFt).toLocaleString('en-US')} ft, ${s.vsFpm.toFixed(0)} fpm, ` +
    `alpha ${s.alpha.toFixed(1)}°, thrust ${s.thrust.toFixed(0)} lbs`
  );
}

async function main() {
  const profile = profileFor();
  const sdk = await boot({ log: process.argv.includes('--verbose'), profile });
  const now = () => state(sdk, profile);

  // Start on the runway at Chambéry: 779 ft, heading 180, brakes off, running.
  set(sdk, 'ic/lat-geod-deg', 45.6448);
  set(sdk, 'ic/long-gc-deg', 5.8797);
  set(sdk, 'ic/terrain-elevation-ft', 779);
  set(sdk, 'ic/h-agl-ft', profile.parkedAglFt + 4);
  set(sdk, 'ic/psi-true-deg', 180);
  set(sdk, 'ic/vc-kts', 0);
  set(sdk, 'propulsion/set-running', -1);
  sdk.runIc();

  console.log(`model: ${sdk.getModelName()} | dt ${sdk.getDeltaT().toFixed(5)} s | weight ${Math.round(now().weight).toLocaleString('en-US')} lbs`);

  // ---- take-off -----------------------------------------------------------
  throttles(sdk, profile, 1);
  set(sdk, 'fcs/flap-cmd-norm', profile.takeoffFlap);
  set(sdk, 'gear/gear-cmd-norm', 1);

  let rotated = false;
  let airborne = null;
  let climb1000 = null;
  let roll = 0;
  for (let i = 0; i < 180 * 120; i += 1) {
    const s = now();
    holdWings(sdk);
    if (!airborne) roll += get(sdk, 'velocities/vg-fps') * DT * FT_PER_M;
    if (!rotated && s.kias > profile.rotate) {
      rotated = true;
      console.log(`  rotate at ${s.kias.toFixed(0)} KIAS after ${s.t.toFixed(1)} s, ${Math.round(roll)} m`);
    }
    if (rotated) holdPitch(sdk, s, profile.climbPitch, profile.gain.rotate);
    if (!airborne && s.aglFt > profile.parkedAglFt + 35) {
      airborne = s.t;
      console.log(`  airborne at ${s.t.toFixed(1)} s, ${s.kias.toFixed(0)} KIAS, ground roll ${Math.round(roll)} m`);
      set(sdk, 'gear/gear-cmd-norm', 0);
      set(sdk, 'fcs/flap-cmd-norm', 0);
    }
    if (airborne && s.aglFt > 1000) {
      climb1000 = s;
      break;
    }
    if (!sdk.run()) throw new Error('JSBSim stopped');
  }
  if (climb1000) console.log(' ', line('  at 1000 ft agl', climb1000));

  // ---- climb to the top on a speed schedule --------------------------------
  let last = null;
  let next = 0;
  for (let i = 0; i < 120 * 5400; i += 1) {
    const s = now();
    last = s;
    holdWings(sdk);
    const schedule = s.altFt < 10000 ? profile.climbKias[0] : profile.climbKias[1];
    holdSpeed(sdk, s, schedule, { mach: profile.mach, profile });
    if (next < profile.splits.length && s.altFt > profile.splits[next]) {
      console.log(` ${line(`  passing ${(profile.splits[next] / 1000).toFixed(0)},000 ft`, s)} (${(s.t / 60).toFixed(1)} min)`);
      next += 1;
    }
    if (s.altFt > profile.topFt || s.t > 5000) break;
    if (!sdk.run()) throw new Error('JSBSim stopped');
  }
  console.log(`  climb to ${Math.round(last.altFt).toLocaleString('en-US')} ft took ${(last.t / 60).toFixed(1)} min`);

  // ---- cruise -------------------------------------------------------------
  for (const throttle of [1.0, 0.85]) {
    throttles(sdk, profile, throttle);
    const holdAlt = Math.round(now().altFt / 500) * 500;
    for (let i = 0; i < 120 * 600; i += 1) {
      const s = now();
      holdWings(sdk);
      holdPitch(
        sdk,
        s,
        Math.max(-4, Math.min(6, (holdAlt - s.altFt) * 0.004 - s.vsFpm * 0.0015)),
        profile.gain.cruise,
      );
      if (!sdk.run()) break;
    }
    console.log(' ', line(`  cruise at ${(throttle * 100).toFixed(0)}% N1 cmd`, now()));
  }

  // ---- stall, clean and in the landing configuration ----------------------
  for (const [label, flap, gear] of [['clean', 0, 0], ['landing', 1, 1]]) {
    sdk.runIc();
    set(sdk, 'ic/h-sl-ft', 10000);
    set(sdk, 'ic/vc-kts', profile.stallFrom);
    set(sdk, 'ic/gamma-deg', 0);
    set(sdk, 'propulsion/set-running', -1);
    sdk.runIc();
    set(sdk, 'fcs/flap-cmd-norm', flap);
    set(sdk, 'gear/gear-cmd-norm', gear);
    throttles(sdk, profile, 0.08);
    // Hold the height at idle and let the speed bleed off. The wing runs
    // out of lift where alpha reaches the top of the lift curve, so that, and
    // not an altitude loss, is the criterion; it works with gear and flap down
    // too, where idle thrust cannot hold height in the first place.
    let broke = null;
    let stalling = 0;
    let integral = 0;
    const t0 = sdk.getSimTime();
    for (let i = 0; i < 120 * 600; i += 1) {
      const s = now();
      holdWings(sdk);
      // A proportional loop settles for a steady sink rate and so never
      // reaches the stall; the integrator keeps pulling until the wing gives up.
      integral = Math.max(-0.5, Math.min(25, integral - s.vsFpm * 0.00008));
      holdPitch(sdk, s, Math.max(-5, Math.min(25, integral - s.vsFpm * 0.002)), profile.gain.stall);
      if (s.t - t0 > 15 && (s.alpha > 15 || s.vsFpm < -2500)) {
        stalling += DT;
        if (stalling > 1) {
          broke = s;
          break;
        }
      } else {
        stalling = 0;
      }
      if (!sdk.run()) break;
    }
    const at = broke ?? now();
    console.log(
      `  stall, ${label}: ${at.kias.toFixed(0)} KIAS at alpha ${at.alpha.toFixed(1)}°` +
        `${broke ? '' : ' (no break inside 600 s)'}`,
    );
  }

  // ---- landing roll -------------------------------------------------------
  // Touchdown speed on a flat runway, everything out, and how far it takes.
  sdk.runIc();
  set(sdk, 'ic/lat-geod-deg', 45.6448);
  set(sdk, 'ic/long-gc-deg', 5.8797);
  set(sdk, 'ic/terrain-elevation-ft', 779);
  set(sdk, 'ic/h-agl-ft', profile.parkedAglFt);
  set(sdk, 'ic/psi-true-deg', 180);
  set(sdk, 'ic/vc-kts', profile.touchdown);
  set(sdk, 'propulsion/set-running', -1);
  sdk.runIc();
  set(sdk, 'fcs/flap-cmd-norm', 1);
  set(sdk, 'fcs/flap-pos-deg', profile.landingFlapDeg);
  set(sdk, 'gear/gear-cmd-norm', 1);
  set(sdk, 'gear/gear-pos-norm', 1);
  throttles(sdk, profile, 0);
  set(sdk, 'fcs/speedbrake-cmd-norm', 1);
  for (const brake of ['left', 'right', 'center']) set(sdk, `fcs/${brake}-brake-cmd-norm`, 1);
  const from = sdk.getSimTime();
  let stop = 0;
  for (let i = 0; i < 120 * 240; i += 1) {
    const s = now();
    set(sdk, 'fcs/elevator-cmd-norm', 0);
    stop += get(sdk, 'velocities/vg-fps') * DT * FT_PER_M;
    if (s.kias < 5) break;
    if (!sdk.run()) break;
  }
  console.log(
    `  landing roll: ${profile.touchdown} KIAS to a stop in ${Math.round(stop)} m, ` +
      `${(sdk.getSimTime() - from).toFixed(0)} s, flat and dry`,
  );

  sdk.destroy?.();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
