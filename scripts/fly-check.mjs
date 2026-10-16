#!/usr/bin/env node
// Flies the browser build for real, headless, and reports the result.
//
//   node scripts/fly-check.mjs                     # autopilot, Chambéry to a stop
//   node scripts/fly-check.mjs final 8             # autopilot, from short final
//   node scripts/fly-check.mjs lflb 6 manual       # hand-flown on the stick
//
// scripts/test-fdm.mjs checks the flight model in Node; this checks the whole
// browser path: the WebAssembly loads, the terrain feeds the gear, and the
// autopilot flies the valley. The scene is fast-forwarded through the flight
// model directly, because software rendering manages about one frame a second
// and a take-off would take an hour of wall clock otherwise.
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const start = process.argv[2] ?? 'lflb';
const minutes = Number(process.argv[3] ?? 20);
// 'auto' lets the autopilot fly the valley route; 'manual' flies it on the
// stick, which is the path a person actually uses and so the one that has to
// keep working.
const mode = process.argv[4] ?? 'auto';
const PORT = 4196;
const CDP = 9777;

const http = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'dist'], { stdio: 'ignore' });
const chrome = spawn(
  process.env.CHROME ?? 'google-chrome',
  [
    '--headless=new', `--remote-debugging-port=${CDP}`, '--no-sandbox', '--disable-gpu',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle',
    '--window-size=1280,800', 'about:blank',
  ],
  { stdio: 'ignore' },
);
const stop = () => {
  http.kill();
  chrome.kill();
};
process.on('exit', stop);

async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      return await (await fetch(url)).json();
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`niets op ${url}`);
}

const targets = await waitFor(`http://127.0.0.1:${CDP}/json/list`);
await waitFor(`http://127.0.0.1:${PORT}/fly.html`).catch(() => {});
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const problems = [];
await once(ws, 'open');
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    problems.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate faalde');
  return r.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/fly.html?start=${start}&fdm=jsbsim` });

// Wait for the model to load, which means WebAssembly, terrain and airports.
for (let i = 0; i < 120; i += 1) {
  if (await evaluate('!!window.__fly')) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const ready = await evaluate('window.__fly ? window.__fly.sim.name : null');
if (!ready) {
  console.error('vlucht niet geladen:', await evaluate("document.querySelector('#loading')?.textContent"));
  process.exit(1);
}
console.log(`geladen: ${ready}, start "${start}"`);


if (mode === 'manual') {
  // A scripted pair of hands: brakes off, full thrust, rotate, climb, level
  // off, turn ninety degrees right, roll out. Everything goes through the same
  // axes the keyboard and the gamepad feed, in the assisted control law.
  const flown = await evaluate(`(async () => {
    const f = window.__fly;
    f.pause(true);
    f.setAutopilot('off');
    f.sim.setBrakes(false);
    const FT = 0.3048, DEG = 180 / Math.PI, dt = 1 / 60;
    const marks = [];
    let t = 0, rotated = false, airborne = null, levelled = false, turning = false;
    let heading0 = null, turned = null, rolledOut = null, maxBank = 0;
    while (t < ${minutes} * 60) {
      const a = f.aircraft;
      const agl = (a.agl ?? 0) / FT;
      const hdg = ((a.heading * DEG) % 360 + 360) % 360;
      maxBank = Math.max(maxBank, Math.abs(a.bank * DEG));
      let pitch = 0, roll = 0;

      if (!airborne) {
        if (a.kias > 95) { if (!rotated) { rotated = true; marks.push('rotatie op ' + Math.round(a.kias) + ' KIAS na ' + t.toFixed(0) + ' s'); } pitch = 0.9; }
        if (agl > 35) { airborne = t; marks.push('los na ' + t.toFixed(0) + ' s, ' + Math.round(a.kias) + ' KIAS'); f.sim.setGear(false); f.sim.setFlaps(0); }
      } else if (!levelled) {
        // Hold about twelve degrees on the stick, then push over at 8000 ft.
        const want = (a.alt - f.datum) / FT > 8000 ? 2 : 12;
        pitch = Math.max(-1, Math.min(1, (want - a.pitch * DEG) * 0.3));
        if ((a.alt - f.datum) / FT > 8000 && Math.abs(a.vs) < 3) {
          levelled = true; heading0 = hdg; turning = true;
          marks.push('genivelleerd op ' + Math.round((a.alt - f.datum) / FT) + ' ft na ' + (t / 60).toFixed(1) + ' min, ' + Math.round(a.kias) + ' KIAS');
        }
      } else {
        pitch = Math.max(-1, Math.min(1, (2 - a.pitch * DEG) * 0.3));
        let delta = ((hdg - heading0 + 540) % 360) - 180;
        if (turning) {
          roll = delta < 85 ? 0.6 : -0.4;
          if (delta >= 86 && Math.abs(a.bank * DEG) < 6) {
            turning = false; turned = t;
            marks.push('bocht van 90° klaar na ' + (t / 60).toFixed(1) + ' min, bank tot ' + Math.round(maxBank) + '°, ' + Math.round(a.kias) + ' KIAS');
          }
        } else if (turned && !rolledOut && t - turned > 20) {
          rolledOut = t;
          marks.push('vleugels waterpas gehouden, koers ' + Math.round(hdg) + '°, ' + Math.round((a.alt - f.datum) / FT) + ' ft');
          break;
        }
      }

      f.terrainService.update({ lat: a.lat, lon: a.lon, agl: a.agl ?? 1000, speed: a.speed ?? 0, heading: a.heading ?? 0 });
      f.sim.step({ law: 'assist', pitch, roll, yaw: 0, trim: 0, throttle: 1 }, dt, f.groundHeight(a.lat, a.lon));
      t += dt;
      if (Math.round(t * 60) % 1800 === 0) await new Promise((r) => setTimeout(r, 0));
      if (!Number.isFinite(a.alt)) { marks.push('model liep vast'); break; }
    }
    const a = f.aircraft;
    f.pause(false);
    return { marks, end: { kias: Math.round(a.kias), altFt: Math.round((a.alt - f.datum) / FT), hdg: Math.round(((a.heading * 180 / Math.PI) % 360 + 360) % 360), bank: +(a.bank * 180 / Math.PI).toFixed(1) }, simMinutes: +(t / 60).toFixed(1) };
  })()`);
  for (const mark of flown.marks) console.log(' ', mark);
  console.log(
    `eind ${flown.end.kias} KIAS, ${flown.end.altFt.toLocaleString('nl-NL')} ft, koers ` +
      `${flown.end.hdg}°, bank ${flown.end.bank}° · ${flown.simMinutes} min met de hand gevlogen`,
  );
  ws.close();
  stop();
  process.exit(0);
}

// Fly it, in-page, 30 simulated steps a second, reporting every simulated minute.
const flown = await evaluate(`(async () => {
  const f = window.__fly;
  f.pause(true); // the page's own frame loop must not step the model as well
  f.sim.setBrakes(false); // a start on the runway has the parking brake set
  const KT = 0.514444, FT = 0.3048;
  const marks = [];
  let t = 0, airborne = null, maxAlt = 0, touchdown = null, stopped = null, lastGroundFt = 0;
  const dt = 1 / 30;
  let nextMark = 60;
  while (t < ${minutes} * 60) {
    const a = f.aircraft;
    const nav = f.sim.routeAutopilot(f.navState);
    // Full thrust and a take-off rotation until the autopilot's legs take over.
    const input = !airborne && a.onGround && a.kias < 110
      ? { attitude: { pitch: a.kias > 95 ? 0.14 : 0, bank: 0 }, throttle: 1 }
      : nav;
    if (input.config) {
      if (input.config.gear !== a.gear) f.sim.setGear(input.config.gear);
      if (input.config.flaps !== a.flaps) f.sim.setFlaps(input.config.flaps);
    }
    lastGroundFt = f.groundHeight(a.lat, a.lon) / FT;
    f.terrainService.update({ lat: a.lat, lon: a.lon, agl: a.agl ?? 1000, speed: a.speed ?? 0, heading: a.heading ?? 0 });
    f.sim.step(input, dt, lastGroundFt * FT);
    t += dt;
    if (!airborne && !a.onGround && a.agl > 10) {
      airborne = t;
      marks.push('los op ' + Math.round(a.kias) + ' KIAS na ' + t.toFixed(0) + ' s');
    }
    if (airborne && a.alt > maxAlt) maxAlt = a.alt;
    if (airborne && !touchdown && a.onGround) {
      touchdown = t;
      marks.push('neer op ' + Math.round(a.kias) + ' KIAS, ' + Math.round(a.vs / FT * 60) + ' fpm, na ' + (t / 60).toFixed(1) + ' min');
      f.sim.setBrakes(true); f.sim.setFlaps(2);
    }
    if (touchdown && !stopped && a.kias < 5) { stopped = t; marks.push('stil na ' + (t - touchdown).toFixed(0) + ' s uitrollen'); break; }
    if (t > nextMark) {
      const leg = f.route[f.navState.leg];
      marks.push('  ' + (t / 60).toFixed(0) + ' min: ' + Math.round(a.kias) + ' KIAS, ' +
        Math.round((a.alt - f.datum) / FT) + ' ft, ' + Math.round(a.agl / FT) + ' agl, grond ' + Math.round(lastGroundFt) + ' (jsb ' + Math.round(f.sim.get('position/terrain-elevation-asl-ft')) + '/' + Math.round(f.sim.get('position/h-sl-ft')) + '), naar ' + (leg ? leg.name : '-') +
        ' | thr ' + a.throttle.toFixed(2) + ' ' + Math.round(a.thrust) + ' lbs, pitch ' +
        (a.pitch * 180 / Math.PI).toFixed(1) + ' cmd ' + (input.attitude.pitch * 180 / Math.PI).toFixed(1) +
        ', alpha ' + (a.alpha * 180 / Math.PI).toFixed(1) + ', vs ' + Math.round(a.vs / FT * 60) +
        ', cfg ' + (a.gear ? 'G' : '-') + a.flaps);
      nextMark += 120;
    }
    // Yield now and then so the page stays responsive and the loop is not killed.
    if (Math.round(t * 30) % 900 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  f.pause(false);
  const a = f.aircraft;
  return { marks, maxAltFt: Math.round((maxAlt - f.datum) / FT), leg: f.route[f.navState.leg] ? f.route[f.navState.leg].name : null,
    end: { kias: Math.round(a.kias), altFt: Math.round((a.alt - f.datum) / FT), aglFt: Math.round(a.agl / FT), onGround: a.onGround },
    simMinutes: +(t / 60).toFixed(1) };
})()`);

for (const mark of flown.marks) console.log(' ', mark);
console.log(
  `hoogste punt ${flown.maxAltFt.toLocaleString('nl-NL')} ft · eind ${flown.end.kias} KIAS, ` +
    `${flown.end.altFt.toLocaleString('nl-NL')} ft (${flown.end.aglFt} agl)` +
    `${flown.end.onGround ? ', op de grond' : ''} · leg ${flown.leg} · ${flown.simMinutes} min gevlogen`,
);
if (problems.length) {
  console.log('fouten in de pagina:');
  for (const p of problems.slice(0, 5)) console.log('  ', p.split('\n')[0]);
}
ws.close();
stop();
