// Ride view: drives the camera along a track axis over open Dutch geodata.
// See docs/cabride-demo-plan.md — this is phase P0 + P1 of that plan.
import { createScene, clipCorridor, clipGlobe } from './scene.js';
import { buildTrack, corridorPolygon } from './geometry.js';
import { addTrackFurniture } from './trackfurniture.js';
import { buildRun } from './drive.js';
import { createHud } from './hud.js';
import './ride.css';

const DEFAULT_RIDE = 'ams-centraal-sloterdijk';
const CAB_HEIGHT = 2.6; // above railhead, roughly a sprinter cab window
const CHASE_BACK = 38;
const CHASE_UP = 8.5;
const RATES = [0.25, 0.5, 1, 2, 4, 8];
const SUN_TIME = '2026-09-27T15:20:00+02:00';

const params = new URLSearchParams(window.location.search);
const rideId = params.get('ride') ?? DEFAULT_RIDE;
// ?t= starts the run part way in, which is how screenshots and demos skip the
// slow pull out of Amsterdam Centraal.
const startTime = Number(params.get('t') ?? 0);
const startView = params.get('view') ?? 'cab';

const loading = document.querySelector('#loading');
const status = (text) => {
  loading.textContent = text;
};

async function main() {
  status('Traject laden…');
  const response = await fetch(`/ride/${rideId}.json`);
  if (!response.ok) throw new Error(`rit "${rideId}" niet gevonden (HTTP ${response.status})`);
  const ride = await response.json();
  document.title = `${ride.title} — TrainConnections`;

  status('Terrein, luchtfoto en 3D-gebouwen van PDOK verbinden…');
  const { viewer, scene, terrain, layers } = await createScene(document.querySelector('#scene'), {
    time: SUN_TIME,
  });

  status('Hoogte van de baan bepalen…');
  const track = await buildTrack(ride, terrain);
  status('Spoor, bovenleiding en perrons bouwen…');
  const furniture = addTrackFurniture(viewer, ride, track);
  clipCorridor(layers.buildings, corridorPolygon(ride));
  clipGlobe(
    scene.globe,
    track.underpasses.map((range) => corridorPolygon(ride, 9, 5, range)),
  );
  if (track.underpasses.length) {
    console.info(
      `onderdoorgangen uit het terrein gesneden: ${track.underpasses
        .map((r) => `${(r.from / 1000).toFixed(2)}-${(r.to / 1000).toFixed(2)} km`)
        .join(', ')}`,
    );
  }
  const run = buildRun(ride);
  // The manifest is written by the builder; a missing one just means no picker.
  const rides = await fetch('/ride/index.json')
    .then((res) => (res.ok ? res.json() : []))
    .catch(() => []);
  const hud = createHud(document.querySelector('#hud'), ride, run, rides);

  let view = 'cab';
  let paused = false;
  let rateIndex = RATES.indexOf(1);
  let time = Number.isFinite(startTime) ? startTime : 0;
  let last = performance.now();

  const setView = (mode) => {
    view = mode;
    hud.setView(mode);
    scene.screenSpaceCameraController.enableInputs = mode === 'free';
  };
  setView(['cab', 'chase', 'free'].includes(startView) ? startView : 'cab');

  function frame(now) {
    const delta = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!paused) time += delta * RATES[rateIndex];
    const state = run.stateAt(time);
    const pose = track.poseAt(state.s);
    hud.update(state, pose);

    if (view !== 'free') {
      // Bogie movement: enough to stop the camera looking like it is on rails
      // made of glass, not enough to be noticed as a loop.
      const sway = Math.sin(state.s / 13.7) * 0.0022 + Math.sin(state.s / 4.3) * 0.0008;
      const bounce = Math.sin(state.s / 9.1) * 0.02;
      if (view === 'cab') {
        viewer.camera.setView({
          destination: track.poseAt(state.s, CAB_HEIGHT + bounce).position,
          orientation: {
            heading: pose.heading,
            pitch: pose.pitch + sway * 0.4,
            roll: pose.cant + sway,
          },
        });
      } else {
        const behind = track.poseAt(Math.max(0, state.s - CHASE_BACK), CHASE_UP);
        viewer.camera.setView({
          destination: behind.position,
          orientation: {
            heading: behind.heading,
            pitch: -Math.atan((CHASE_UP - CAB_HEIGHT) / CHASE_BACK),
            roll: behind.cant * 0.5,
          },
        });
      }
    }
    requestAnimationFrame(frame);
  }

  document.querySelector('#hud').addEventListener('click', (event) => {
    const { view: mode, action } = event.target.dataset;
    if (mode) setView(mode);
    if (action === 'toggle') {
      paused = !paused;
      hud.setPaused(paused);
    }
    if (action === 'restart') {
      time = 0;
      paused = false;
      hud.setPaused(false);
    }
    if (action === 'faster') rateIndex = Math.min(RATES.length - 1, rateIndex + 1);
    if (action === 'slower') rateIndex = Math.max(0, rateIndex - 1);
    if (action === 'faster' || action === 'slower') hud.setRate(RATES[rateIndex]);
  });
  document.querySelector('#hud').addEventListener('change', (event) => {
    if (event.target.dataset.action === 'ride') {
      // A different ride means different geometry, terrain samples and a
      // different speed profile, so it reloads rather than swapping in place.
      const next = new URLSearchParams(window.location.search);
      next.set('ride', event.target.value);
      next.delete('t');
      window.location.search = next.toString();
      return;
    }
    const layer = event.target.dataset.layer;
    if (layer === 'buildings') layers.buildings.show = event.target.checked;
    if (layer === 'ground') layers.ground.show = event.target.checked;
    if (layer === 'rails') furniture.setTrack(event.target.checked);
    if (layer === 'catenary') furniture.setCatenary(event.target.checked);
  });
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      paused = !paused;
      hud.setPaused(paused);
    }
    if (event.key === 'c') setView(view === 'cab' ? 'chase' : 'cab');
    if (event.key === 'f') setView('free');
    if (event.key === '+' || event.key === '=') {
      rateIndex = Math.min(RATES.length - 1, rateIndex + 1);
      hud.setRate(RATES[rateIndex]);
    }
    if (event.key === '-') {
      rateIndex = Math.max(0, rateIndex - 1);
      hud.setRate(RATES[rateIndex]);
    }
  });

  // Debug handle: lets the console (and the screenshot harness) inspect the
  // scene without exporting anything the page itself depends on.
  window.__ride = { viewer, scene, ride, run, track, layers, furniture };

  loading.classList.add('is-hidden');
  console.info(
    `${ride.title}: ${(ride.length / 1000).toFixed(3)} km, ${ride.count} axis points, ` +
      `simulated run ${Math.round(run.duration)} s, smallest radius ${ride.minRadius} m`,
  );
  requestAnimationFrame(frame);
}

main().catch((error) => {
  console.error(error);
  status(`Kon de rit niet laden: ${error.message}`);
  loading.classList.add('is-error');
});
