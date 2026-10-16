#!/usr/bin/env node
// Runs the flight model headless, so the aeroplane can be checked against its
// book figures before anyone tries to fly it.
//
//   node scripts/test-fdm.mjs            # take-off, climb to FL410, cruise, stall
//   node scripts/test-fdm.mjs --verbose  # with JSBSim's own console output
//
// JSBSim is the same engine FlightGear uses; here it runs as WebAssembly, in
// Node, which means a whole flight can be tested in a few seconds without a
// browser. The numbers to beat, from Pilatus' PC-24 figures:
//
//   rotate        ~95 KIAS          cruise      425-440 KTAS at FL410
//   initial climb ~4000 fpm         Vmo/Mmo     290 KIAS / M0.74
//   stall, clean  ~95 KIAS          stall, land ~85 KIAS
import { readFile } from 'node:fs/promises';
import { JSBSimSdk } from '@0x62/jsbsim-wasm';
import { wasmBinaryUrl, wasmModuleUrl } from '@0x62/jsbsim-wasm/wasm';

const DT = 1 / 120;
const FT_PER_M = 0.3048;

export async function boot({ log = false } = {}) {
  const sdk = await JSBSimSdk.create({
    moduleUrl: wasmModuleUrl,
    wasmUrl: wasmBinaryUrl,
    log: { console: log, stripAnsi: true },
  });
  const read = (path) => readFile(new URL(`../public/fdm/${path}`, import.meta.url), 'utf8');
  sdk.writeDataFile('aircraft/pc24/pc24.xml', await read('aircraft/pc24/pc24.xml'));
  sdk.writeDataFile('engine/fj44.xml', await read('engine/fj44.xml'));
  sdk.writeDataFile('engine/direct.xml', await read('engine/direct.xml'));
  sdk.configurePaths({
    rootDir: '/runtime',
    aircraftPath: 'aircraft',
    enginePath: 'engine',
    systemsPath: 'systems',
  });
  if (!sdk.loadModel('pc24')) throw new Error('JSBSim refused the aircraft');
  sdk.setDt(DT);
  return sdk;
}

const get = (sdk, prop) => sdk.getPropertyValue(prop);
const set = (sdk, prop, value) => sdk.setPropertyValue(prop, value);
const DEG = 180 / Math.PI;

function state(sdk) {
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
    thrust: get(sdk, 'propulsion/engine/thrust-lbs') + get(sdk, 'propulsion/engine[1]/thrust-lbs'),
    elev: get(sdk, 'fcs/elevator-pos-rad'),
  };
}

// Positive elevator deflection is trailing edge down, hence the minus signs:
// a nose-up correction is a negative command.
function holdPitch(sdk, s, target, gain = 0.06) {
  set(sdk, 'fcs/elevator-cmd-norm', Math.max(-1, Math.min(1, -(target - s.pitch) * gain)));
}

// Chase an airspeed with pitch, the way a climb is actually flown.
function holdSpeed(sdk, s, kias, { maxPitch = 20, minPitch = -5, mach = null } = {}) {
  // Whichever limit is hit first wins, which is what a crossover schedule does.
  const error = mach === null ? s.kias - kias : Math.max(s.kias - kias, (s.mach - mach) * 600);
  const target = Math.max(minPitch, Math.min(maxPitch, s.pitch + error * 0.1));
  holdPitch(sdk, s, target, 0.08);
}

function holdWings(sdk) {
  const roll = get(sdk, 'attitude/phi-rad') * DEG;
  const p = get(sdk, 'velocities/p-aero-rad_sec') * DEG;
  set(sdk, 'fcs/aileron-cmd-norm', Math.max(-1, Math.min(1, (-roll * 0.03) - p * 0.02)));
  set(sdk, 'fcs/rudder-cmd-norm', Math.max(-1, Math.min(1, -get(sdk, 'aero/beta-rad') * DEG * 0.05)));
}

function line(label, s) {
  return (
    `${label}: ${s.kias.toFixed(0)} KIAS / ${s.ktas.toFixed(0)} KTAS / M${s.mach.toFixed(3)} at ` +
    `${Math.round(s.altFt).toLocaleString('en-US')} ft, ${s.vsFpm.toFixed(0)} fpm, ` +
    `alpha ${s.alpha.toFixed(1)}°, thrust ${s.thrust.toFixed(0)} lbs`
  );
}

async function main() {
  const sdk = await boot({ log: process.argv.includes('--verbose') });

  // Start on the runway at Chambéry: 779 ft, heading 180, brakes off, running.
  set(sdk, 'ic/lat-geod-deg', 45.6448);
  set(sdk, 'ic/long-gc-deg', 5.8797);
  set(sdk, 'ic/terrain-elevation-ft', 779);
  set(sdk, 'ic/h-agl-ft', 6);
  set(sdk, 'ic/psi-true-deg', 180);
  set(sdk, 'ic/vc-kts', 0);
  set(sdk, 'propulsion/set-running', -1);
  sdk.runIc();

  console.log(`model: ${sdk.getModelName()} | dt ${sdk.getDeltaT().toFixed(5)} s | weight ${Math.round(state(sdk).weight).toLocaleString('en-US')} lbs`);

  // ---- take-off -----------------------------------------------------------
  set(sdk, 'fcs/throttle-cmd-norm[0]', 1);
  set(sdk, 'fcs/throttle-cmd-norm[1]', 1);
  set(sdk, 'fcs/flap-cmd-norm', 0.5);
  set(sdk, 'gear/gear-cmd-norm', 1);

  let rotated = false;
  let airborne = null;
  let climb1000 = null;
  for (let i = 0; i < 120 * 120; i += 1) {
    const s = state(sdk);
    holdWings(sdk);
    if (!rotated && s.kias > 95) {
      rotated = true;
      console.log(`  rotate at ${s.kias.toFixed(0)} KIAS after ${s.t.toFixed(1)} s`);
    }
    if (rotated) holdPitch(sdk, s, 12);
    if (!airborne && s.aglFt > 35) {
      airborne = s.t;
      console.log(`  airborne at ${s.t.toFixed(1)} s, ${s.kias.toFixed(0)} KIAS, screen height in ${(s.t - 0).toFixed(1)} s`);
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

  // ---- climb to FL410 on a speed schedule ---------------------------------
  // 200 KIAS to 10,000 ft, then 240 KIAS until M0.70 takes over.
  let last = null;
  const splits = [10000, 20000, 30000, 40000];
  let next = 0;
  for (let i = 0; i < 120 * 3600; i += 1) {
    const s = state(sdk);
    last = s;
    holdWings(sdk);
    holdSpeed(sdk, s, s.altFt < 10000 ? 200 : 240, { mach: 0.7 });
    if (next < splits.length && s.altFt > splits[next]) {
      console.log(` ${line(`  passing ${(splits[next] / 1000).toFixed(0)},000 ft`, s)} (${(s.t / 60).toFixed(1)} min)`);
      next += 1;
    }
    if (s.altFt > 41000 || s.t > 3000) break;
    if (!sdk.run()) throw new Error('JSBSim stopped');
  }
  console.log(`  climb to ${Math.round(last.altFt).toLocaleString('en-US')} ft took ${(last.t / 60).toFixed(1)} min`);

  // ---- cruise -------------------------------------------------------------
  for (const throttle of [1.0, 0.85]) {
    set(sdk, 'fcs/throttle-cmd-norm[0]', throttle);
    set(sdk, 'fcs/throttle-cmd-norm[1]', throttle);
    const holdAlt = Math.round(state(sdk).altFt / 500) * 500;
    for (let i = 0; i < 120 * 600; i += 1) {
      const s = state(sdk);
      holdWings(sdk);
      holdPitch(sdk, s, Math.max(-4, Math.min(6, (holdAlt - s.altFt) * 0.004 - s.vsFpm * 0.0015)), 0.1);
      if (!sdk.run()) break;
    }
    console.log(' ', line(`  cruise at ${(throttle * 100).toFixed(0)}% N1 cmd`, state(sdk)));
  }

  // ---- stall, clean and in the landing configuration ----------------------
  for (const [label, flap, gear] of [['clean', 0, 0], ['landing', 1, 1]]) {
    sdk.runIc();
    set(sdk, 'ic/h-sl-ft', 10000);
    set(sdk, 'ic/vc-kts', 160);
    set(sdk, 'ic/gamma-deg', 0);
    set(sdk, 'propulsion/set-running', -1);
    sdk.runIc();
    set(sdk, 'fcs/flap-cmd-norm', flap);
    set(sdk, 'gear/gear-cmd-norm', gear);
    set(sdk, 'fcs/throttle-cmd-norm[0]', 0.08);
    set(sdk, 'fcs/throttle-cmd-norm[1]', 0.08);
    // Hold the height at idle and let the speed bleed off. The wing runs
    // out of lift where alpha reaches the top of the lift curve, so that, and
    // not an altitude loss, is the criterion; it works with gear and flap down
    // too, where idle thrust cannot hold height in the first place.
    let broke = null;
    let stalling = 0;
    let integral = 0;
    const t0 = sdk.getSimTime();
    for (let i = 0; i < 120 * 300; i += 1) {
      const s = state(sdk);
      holdWings(sdk);
      // A proportional loop settles for a steady sink rate and so never
      // reaches the stall; the integrator keeps pulling until the wing gives up.
      integral = Math.max(-0.5, Math.min(25, integral - s.vsFpm * 0.00008));
      holdPitch(sdk, s, Math.max(-5, Math.min(25, integral - s.vsFpm * 0.002)), 0.12);
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
    const at = broke ?? state(sdk);
    console.log(
      `  stall, ${label}: ${at.kias.toFixed(0)} KIAS at alpha ${at.alpha.toFixed(1)}°` +
        `${broke ? '' : ' (no break inside 300 s)'}`,
    );
  }

  // ---- landing roll -------------------------------------------------------
  // Touchdown speed on a flat runway, everything out, and how far it takes.
  sdk.runIc();
  set(sdk, 'ic/lat-geod-deg', 45.6448);
  set(sdk, 'ic/long-gc-deg', 5.8797);
  set(sdk, 'ic/terrain-elevation-ft', 779);
  set(sdk, 'ic/h-agl-ft', 1.6 / FT_PER_M);
  set(sdk, 'ic/psi-true-deg', 180);
  set(sdk, 'ic/vc-kts', 102);
  set(sdk, 'propulsion/set-running', -1);
  sdk.runIc();
  set(sdk, 'fcs/flap-cmd-norm', 1);
  set(sdk, 'fcs/flap-pos-deg', 33);
  set(sdk, 'gear/gear-cmd-norm', 1);
  set(sdk, 'gear/gear-pos-norm', 1);
  set(sdk, 'fcs/throttle-cmd-norm[0]', 0);
  set(sdk, 'fcs/throttle-cmd-norm[1]', 0);
  set(sdk, 'fcs/speedbrake-cmd-norm', 1);
  for (const brake of ['left', 'right', 'center']) set(sdk, `fcs/${brake}-brake-cmd-norm`, 1);
  const from = sdk.getSimTime();
  let roll = 0;
  for (let i = 0; i < 120 * 120; i += 1) {
    const s = state(sdk);
    set(sdk, 'fcs/elevator-cmd-norm', 0);
    roll += get(sdk, 'velocities/vg-fps') * DT * FT_PER_M;
    if (s.kias < 5) break;
    if (!sdk.run()) break;
  }
  console.log(
    `  landing roll: 102 KIAS to a stop in ${Math.round(roll)} m, ` +
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
