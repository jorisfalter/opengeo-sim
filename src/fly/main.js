// Flight view: a light jet you fly yourself, over streamed open geodata.
// See docs/flight-view.md.
//
// The flying is JSBSim — FlightGear's flight dynamics engine, as WebAssembly,
// at 120 Hz — on an aircraft model written for this project. You have the
// controls from the first frame; the autopilot is a button, not the default.
import { asset } from '../base.js';
import {
  Cartesian3,
  Cartographic,
  HeadingPitchRoll,
  Math as CesiumMath,
  Matrix4,
  Transforms,
  sampleTerrainMostDetailed,
} from 'cesium';
import { createScene } from './scene.js';
import { addAirport, clipGlobeTo, runwayGround } from './airport.js';
import { addAircraft } from './aircraft.js';
import { autopilot as simpleAutopilot, createAircraft, step as simpleStep } from './flight.js';
import { autopilot as routeAutopilot, createFdm, holdAutopilot } from './jsbsim.js';
import { createTerrainService } from './terrain.js';
import { createControls } from './controls.js';
import { createPanel } from './panel.js';
import { createMinimap } from './minimap.js';
import { createLookahead } from './lookahead.js';
import { createScenery } from './scenery.js';
import { createSound } from './sound.js';
import { PLACES, findPlace } from './places.js';
import { loadAirports, nearestAirports, searchAirports, startFrom } from './airports.js';
import { ATTRIBUTION } from './providers.js';
import './fly.css';

const SUN_TIME = '2026-09-30T10:20:00+02:00';
// Time acceleration. Cruise is the boring part of any flight, so it goes up to
// eight; close to the ground it is held back, because contact forces and the
// gear want small steps and a crash at eight times speed is not a landing.
//
// Eight is the top because that is where the simulation still holds together.
// At sixteen the autopilot's outer loops, which run once a frame, cover two
// seconds of flight per pass and lose a hundred knots before they catch it.
const RATES = [0.25, 0.5, 1, 2, 4, 8];
const LOW_RATE_CAP = 4;
const LOW_ALTITUDE = 300; // metres above ground
const KT = 0.514444;
const FT = 0.3048;
const DEG = Math.PI / 180;
const METERS_PER_DEGREE = 111320;

// The valley route, for the autopilot's route mode and for anyone who wants to
// watch it flown rather than fly it. Altitudes are metres above sea level.
const ROUTE = [
  { name: 'Chambéry', lat: 45.632, lon: 5.905, msl: 1400, speed: 200 },
  { name: 'Montmélian', lat: 45.505, lon: 6.055, msl: 2600, speed: 250, gear: false, flaps: 0 },
  { name: 'Albertville', lat: 45.664, lon: 6.392, msl: 3000, speed: 260 },
  { name: 'Moûtiers', lat: 45.484, lon: 6.533, msl: 2900, speed: 230 },
  { name: 'Bozel', lat: 45.443, lon: 6.648, msl: 2450, speed: 170, radius: 700, gear: true, flaps: 1 },
  { name: 'Final 22', lat: 45.4186, lon: 6.664, msl: 2180, speed: 135, radius: 500, gear: true, flaps: 1 },
  { name: 'Courchevel', lat: 45.3992, lon: 6.6373, msl: 1960, speed: 115, radius: 200, gear: true, flaps: 2, land: true, glide: 0.105 },
];

const params = new URLSearchParams(window.location.search);
const useJsbsim = (params.get('fdm') ?? 'jsbsim') !== 'simple';
const loading = document.querySelector('#loading');
const status = (text) => {
  loading.textContent = text;
};
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

async function main() {
  status('Loading airfields…');
  // Everything the builder has produced. Two of them are mountain strips and
  // the rest are the valley fields you would actually divert to.
  const AIRPORT_IDS = ['lflb', 'lflj', 'lsgg', 'lfli', 'lflp', 'lfhm', 'lfkx', 'lfhu', 'lfle'];
  const loaded = Object.fromEntries(
    await Promise.all(
      AIRPORT_IDS.map(async (id) => [id, await fetch(asset(`fly/${id}.json`)).then((res) => res.json())]),
    ),
  );
  const [lflb, lflj] = [loaded.lflb, loaded.lflj];

  status('Connecting terrain and aerial imagery…');
  const { viewer, scene, terrain } = await createScene(document.querySelector('#scene'), {
    time: SUN_TIME,
  });

  // IGN heights are above sea level, the terrain renders above the ellipsoid.
  // The difference is the geoid undulation, measured here rather than assumed:
  // the median gap along the flat runway at Chambéry, where a 30 m DEM is
  // accurate. It comes out at 49.5 m, the EGM2008 value for Savoie, and it is
  // what every height in this file is shifted by.
  // Each airfield is placed against the terrain it will actually be drawn on,
  // not against an absolute datum.
  //
  // The surveyed heights are above sea level and the terrain renders above the
  // ellipsoid, so a geoid offset is needed in any case — about +49.5 m here.
  // But measuring it once at Chambéry and using it everywhere was wrong, and
  // Courchevel showed why: the survey put its runway seventeen metres below
  // the streamed terrain around it, so cutting the globe away over the strip
  // left the aeroplane at the bottom of a seventeen-metre trench, looking at
  // black sky, bouncing off the walls on the take-off roll.
  //
  // Seventeen metres is not a geoid error. It is a 30 m DEM smoothing away a
  // shelf cut into a mountain. So the offset is measured per airfield, along
  // its own runway, and absorbs both: the geoid, and the DEM's own opinion of
  // the ground there. The absolute altitude is then a little off at Courchevel
  // and the *slope* — the whole reason that airfield is interesting — is
  // exactly as surveyed. That is the right way round.
  status('Surveying the airfields against the terrain…');
  const measureDatum = async (airport) => {
    const centre = airport.runways[0].centre;
    const step = Math.max(1, Math.floor(centre.length / 12));
    const picks = centre.filter((_, i) => i % step === 0);
    const probes = picks.map((point) => Cartographic.fromDegrees(point.lon, point.lat));
    await sampleTerrainMostDetailed(terrain, probes);
    const deltas = probes
      .map((probe, i) => probe.height - picks[i].h)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    return deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0;
  };
  const datums = Object.fromEntries(
    await Promise.all(AIRPORT_IDS.map(async (id) => [id, await measureDatum(loaded[id])])),
  );
  // Chambéry's is the one used for altitudes away from an airfield, because it
  // is flat enough for a 30 m DEM to be honest there.
  const datum = datums.lflb;

  /**
   * A runway is a designed surface, so its profile has to be smooth. The
   * survey is sampled every ten metres and its node-to-node slope wanders by
   * up to five per cent; a five per cent kink taken at fifty metres a second
   * is an instantaneous 2.6 m/s kick, which is why the aeroplane bounced
   * nineteen times on the way down Courchevel. A binomial filter over five
   * points — fifty metres — takes the kinks out and leaves the 12.65% mean
   * slope and the 19.6% steepest section exactly where they were.
   */
  const smoothProfile = (points) => {
    if (points.length < 5) return points;
    const h = points.map((point) => point.h);
    const weights = [1, 4, 6, 4, 1];
    const out = h.map((_, i) => {
      let sum = 0;
      let total = 0;
      for (let k = -2; k <= 2; k += 1) {
        const j = i + k;
        if (j < 0 || j >= h.length) continue;
        const w = weights[k + 2];
        sum += h[j] * w;
        total += w;
      }
      return sum / total;
    });
    // The ends are where the aeroplane meets the terrain, so they stay put.
    out[0] = h[0];
    out[out.length - 1] = h[h.length - 1];
    return points.map((point, i) => ({ ...point, h: out[i] }));
  };

  const lift = (airport, offset) => ({
    ...airport,
    runways: airport.runways.map((runway) => ({
      ...runway,
      centre: smoothProfile(runway.centre).map((point) => ({ ...point, h: point.h + offset })),
    })),
    surfaces: airport.surfaces.map((surface) => ({
      ...surface,
      points: surface.points.map((point) => ({ ...point, h: point.h + offset })),
    })),
  });
  const airports = Object.fromEntries(
    AIRPORT_IDS.map((id) => [id, lift(loaded[id], datums[id])]),
  );

  status('Building runways and aprons…');
  const built = Object.fromEntries(
    AIRPORT_IDS.map((id) => [id, { id, ...addAirport(viewer, airports[id]) }]),
  );
  const runwayProbes = AIRPORT_IDS.map((id) => runwayGround(airports[id]));

  // Only one airport's hole may be in the globe at a time; see clipGlobeTo.
  // Whichever is within fifteen kilometres gets it, and otherwise none does.
  const updateClipping = (lat, lon) => {
    let nearest = null;
    let best = 15000;
    for (const airport of Object.values(built)) {
      const d = Math.hypot(
        (airport.centre.lat - lat) * METERS_PER_DEGREE,
        (airport.centre.lon - lon) * METERS_PER_DEGREE * Math.cos(lat * DEG),
      );
      if (d < best) {
        best = d;
        nearest = airport;
      }
    }
    clipGlobeTo(viewer, nearest);
  };

  // Ground under the aircraft, anywhere. The airport survey wins where it has
  // something to say; elsewhere a patch of terrain that follows the aeroplane.
  // The globe is the last resort rather than the first: it only knows tiles it
  // has drawn and answers for the rest with whatever is nearest, which on one
  // approach was a 2600 m peak half a valley away.
  const terrainService = createTerrainService(terrain, {
    onError: (error) => console.warn('terrein', error),
  });
  let lastGround = airports.lflb.runways[0].centre[0].h;
  // Close to the ground the terrain patch is read conservatively; see
  // terrain.js for why interpolating there puts you inside a hillside.
  let lowFlying = false;
  const groundHeight = (lat, lon) => {
    const sampled = terrainService.heightAt(lat, lon, lowFlying);
    for (const probe of runwayProbes) {
      const survey = probe(lat, lon);
      if (!survey) continue;
      // On the pavement the survey wins outright; across the skirt it hands
      // over to the terrain, so taxiing off the edge is a slope and not a step.
      lastGround =
        survey.weight >= 1 || sampled === null
          ? survey.h
          : survey.h * survey.weight + sampled * (1 - survey.weight);
      return lastGround;
    }
    if (sampled !== null) {
      lastGround = sampled;
      return lastGround;
    }
    // A gap in the patch. Repeating the last height would fly the aeroplane
    // onto a surface that is not there, which is worse than a coarse answer.
    const drawn = scene.globe.getHeight(Cartographic.fromDegrees(lon, lat));
    if (Number.isFinite(drawn) && drawn > -400 && drawn < 9000) lastGround = drawn;
    return lastGround;
  };

  const threshold = airports.lflj.runways[0].centre[0];
  const route = ROUTE.map((leg) =>
    leg.land
      ? { ...leg, lat: threshold.lat, lon: threshold.lon, alt: threshold.h, heading: airports.lflj.runways[0].heading }
      : { ...leg, alt: leg.msl + datum },
  );

  // ---- where to begin -----------------------------------------------------
  const bearingTo = (from, to) => {
    const east = (to.lon - from.lon) * Math.cos(from.lat * DEG);
    return ((Math.atan2(east, to.lat - from.lat) / DEG) + 360) % 360;
  };

  function resolvePlace(place) {
    if (place.airport) {
      const runway = airports[place.airport].runways[0];
      const centre = runway.centre;
      // Which end to line up on. At Courchevel this is the whole difference
      // between a departure and a very short one: you take off downhill, on
      // 04 from the top, and land uphill on 22. The data starts at the low
      // end, so a naive "first point, stored heading" points you up the slope.
      const start = place.end === 'high' ? centre.length - 3 : 2;
      const towards = place.end === 'high' ? centre.length - 6 : 5;
      const point = centre[Math.max(0, Math.min(centre.length - 1, start))];
      const aim = centre[Math.max(0, Math.min(centre.length - 1, towards))];
      const east = (aim.lon - point.lon) * Math.cos(point.lat * DEG);
      const heading = ((Math.atan2(east, aim.lat - point.lat) / DEG) + 360) % 360;
      return { ...place, lat: point.lat, lon: point.lon, alt: point.h + 1.6, heading };
    }
    return { ...place, alt: place.msl + datum, heading: place.heading ?? bearingTo(place, route[6]) };
  }

  /**
   * Airfields from OurAirports have an elevation above sea level and no
   * survey, so their height comes from the terrain the viewer will actually
   * draw — measured at the spot, the same trick used for the built airports.
   */
  async function resolveWorldPlace(place) {
    const probe = [Cartographic.fromDegrees(place.lon, place.lat)];
    await sampleTerrainMostDetailed(terrain, probe);
    const ground = Number.isFinite(probe[0].height) ? probe[0].height : datum;
    return { ...place, alt: ground + 1.6, groundHeight: ground };
  }

  // A place can also come straight out of the URL, which is the whole point of
  // a simulator whose scenery is the world rather than a built area.
  const fromUrl =
    params.has('lat') && params.has('lon')
      ? {
          id: 'url',
          name: `${Number(params.get('lat')).toFixed(3)}, ${Number(params.get('lon')).toFixed(3)}`,
          lat: Number(params.get('lat')),
          lon: Number(params.get('lon')),
          msl: Number(params.get('alt') ?? 3000),
          heading: Number(params.get('hdg') ?? 0),
          speed: Number(params.get('speed') ?? 250),
          throttle: 0.6,
        }
      : null;
  const startPlace = fromUrl ?? findPlace(params.get('start')) ?? findPlace('lflb');

  status('Starting the flight model…');
  const start = resolvePlace(startPlace);
  terrainService.update({ lat: start.lat, lon: start.lon, agl: start.onGround ? 0 : 1500 });
  start.groundHeight = groundHeight(start.lat, start.lon);

  let sim;
  if (useJsbsim) {
    const fdm = await createFdm(start, { onStatus: status });
    sim = {
      name: 'JSBSim',
      aircraft: fdm.aircraft,
      step: (input, dt, ground) => fdm.step(input, dt, ground),
      routeAutopilot: (state, dt) => routeAutopilot(fdm, route, state, dt),
      holdAutopilot: (target, dt) => holdAutopilot(fdm, target, dt),
      setGear: (down) => fdm.setGear(down),
      setFlaps: (notch) => fdm.setFlaps(notch),
      setBrakes: (on) => fdm.setBrakes(on),
      setSpeedbrake: (on) => fdm.setSpeedbrake(on),
      get speedbrake() {
        return fdm.speedbrake;
      },
      teleport: (place) => fdm.reset(place),
      get: (prop) => fdm.get(prop),
    };
  } else {
    const aircraft = createAircraft(start);
    sim = {
      name: 'point-mass',
      aircraft,
      step: (input, dt, ground) => {
        aircraft.throttle = input.throttle;
        simpleStep(aircraft, input, dt, ground);
        // The point-mass model has no atmosphere, so the glass is given the
        // true airspeed as indicated. Below ten thousand feet the two are
        // close; above it the number is optimistic and says so in the docs.
        aircraft.kias = aircraft.speed / KT;
        aircraft.agl = ground === null ? undefined : aircraft.alt - ground;
        return aircraft;
      },
      routeAutopilot: (state) => simpleAutopilot(aircraft, route, state),
      holdAutopilot: () => ({ pitch: 0, roll: 0, throttle: aircraft.throttle }),
      setGear: (down) => {
        aircraft.gear = down;
      },
      setFlaps: (notch) => {
        aircraft.flaps = notch;
      },
      setBrakes: (on) => {
        aircraft.brakes = on;
      },
      setSpeedbrake: () => {},
      speedbrake: false,
      teleport: (place) => Object.assign(aircraft, createAircraft(place)),
      get: () => NaN,
    };
  }
  const aircraft = sim.aircraft;

  // ---- the glass ----------------------------------------------------------
  const panel = createPanel(document.querySelector('#hud'), {
    title: 'PC-24 · vrij vliegen',
    subtitle: `${startPlace.name} · ${sim.name} · IGN, swisstopo and PDOK · the rest worldwide`,
    attribution: ATTRIBUTION,
  });

  // Buildings and villages, loaded as the aeroplane comes near them. The
  // boxes match scripts/build-scenery.mjs; anything not built yet simply
  // never loads and nothing breaks.
  const SCENERY = {
    courchevel: [45.38, 6.58, 45.44, 6.69],
    meribel: [45.38, 6.54, 45.44, 6.60],
    megeve: [45.80, 6.59, 45.88, 6.69],
    moutiers: [45.43, 6.50, 45.51, 6.60],
    albertville: [45.63, 6.35, 45.70, 6.43],
    chambery: [45.54, 5.87, 45.60, 6.00],
    bourget: [45.61, 5.85, 45.70, 5.94],
    annecy: [45.89, 6.08, 45.94, 6.16],
    geneve: [46.20, 6.08, 46.26, 6.18],
    annemasse: [46.17, 6.21, 46.22, 6.28],
    alpedhuez: [45.07, 6.05, 45.11, 6.10],
    kiewit: [50.92, 5.33, 50.99, 5.43],
    genk: [50.94, 5.46, 51.00, 5.56],
    lommel: [51.19, 5.25, 51.27, 5.38],
  };
  const scenery = createScenery(viewer, { datum });
  const sound = createSound({ onNotice: (message) => panel.notice(message) });
  for (const [id, bbox] of Object.entries(SCENERY)) scenery.register(id, bbox);

  const mapRoot = document.createElement('div');
  mapRoot.className = 'fly-map';
  document.body.append(mapRoot);
  // On a phone the screen is the scarce thing and the map covers the altitude
  // tape, so it starts closed there and opens with the Map button.
  const smallScreen = window.matchMedia('(pointer: coarse)').matches;
  const minimap = createMinimap(mapRoot, {
    places: PLACES.filter((place) => place.lat !== undefined),
    airports: AIRPORT_IDS.map((id) => ({
      id,
      name: airports[id].name ?? id.toUpperCase(),
      icao: (airports[id].icao ?? id).toUpperCase(),
      lat: built[id].centre.lat,
      lon: built[id].centre.lon,
      heading: airports[id].runways[0].heading,
      length: airports[id].runways[0].length,
    })),
    onNotice: (message) => panel.notice(message),
  });
  if (smallScreen) minimap.toggle(false);

  const picker = document.createElement('div');
  picker.className = 'fly-picker';
  picker.innerHTML = `
    <div class="fly-picker__sheet">
      <h2>Where do you want to begin?</h2>
      <ul>${PLACES.map(
        (place) =>
          `<li><button data-place="${place.id}"><strong>${place.name}</strong><span>${place.note}</span></button></li>`,
      ).join('')}</ul>
      <form data-el="find">
        <label>Any airfield on earth:
          <input name="q" placeholder="ICAO or name, e.g. LSZS or Samedan" autocomplete="off">
        </label>
      </form>
      <ul class="fly-picker__hits" data-el="hits"></ul>
      <form data-el="coords">
        <label>Or anywhere else: <input name="lat" placeholder="latitude" inputmode="decimal"></label>
        <label><input name="lon" placeholder="longitude" inputmode="decimal"></label>
        <label><input name="alt" placeholder="m above sea level" inputmode="decimal" value="3000"></label>
        <button type="submit">Go there</button>
      </form>
      <p>The terrain and the satellite imagery are worldwide; only the two Alpine fields have a surveyed runway to stand on.</p>
      <button class="fly-picker__close" data-action="close">Close</button>
    </div>`;
  document.body.append(picker);
  const showPicker = (show) => picker.classList.toggle('is-open', show);

  async function goTo(place) {
    // A place can name an airfield instead of a position; the index knows
    // where its runways are and which way they lie.
    if (place.icao) {
      await loadAirports();
      const found = searchAirports(place.icao, 1)[0];
      const lined = found && startFrom(found);
      if (!lined) {
        panel.notice(`${place.icao} not found`);
        return;
      }
      await goTo({ ...lined, name: place.name, note: place.note });
      return;
    }
    const resolved = place.terrainStart ? await resolveWorldPlace(place) : resolvePlace(place);
    terrainService.update({ lat: resolved.lat, lon: resolved.lon, agl: resolved.onGround ? 0 : 1500 });
    resolved.groundHeight = resolved.groundHeight ?? groundHeight(resolved.lat, resolved.lon);
    lastGround = resolved.groundHeight;
    sim.teleport(resolved);
    controls.setThrottle(resolved.throttle ?? 0);
    controls.setTrim(0);
    navState.leg = resolved.route ?? 0;
    autoMode = 'off';
    panel.notice(`Now at ${place.name}`);
    showPicker(false);
  }

  // ---- state --------------------------------------------------------------
  const navState = { leg: start.route ?? 0 };
  let view = params.get('view') ?? 'cockpit';
  let autoMode = 'off'; // off | hold | route
  let hold = null;
  let rateIndex = RATES.indexOf(1);
  let paused = false;
  let brakes = start.onGround;
  // Rudder from the on-screen buttons, held rather than clicked.
  let buttonYaw = 0;
  let last = performance.now();

  const setView = (mode) => {
    view = mode;
    panel.setView(mode);
    model.setVisible(mode !== 'cockpit');
    scene.screenSpaceCameraController.enableInputs = mode === 'free';
  };
  const model = addAircraft(viewer);

  // One way in and out of the parking brake, so the key and the button cannot
  // disagree and both say what they did. A toggle that confirms nothing gets
  // pressed twice by anyone who is not sure it worked.
  const setBrakes = (on) => {
    brakes = on;
    sim.setBrakes(on);
    panel.notice(on ? 'Parking brake on' : 'Parking brake off');
  };

  const setRate = (index) => {
    rateIndex = Math.max(0, Math.min(RATES.length - 1, index));
    const wanted = RATES[rateIndex];
    const low = aircraft.onGround || (aircraft.agl ?? 1e9) < LOW_ALTITUDE;
    panel.notice(
      low && wanted > LOW_RATE_CAP
        ? `${wanted}× requested — near the ground ${LOW_RATE_CAP}× is the limit`
        : `${wanted}× time`,
    );
  };

  const lookahead = createLookahead(viewer, { enabled: params.get('ahead') !== '0' });

  // How much detail is worth asking for.
  //
  // The tile count grows with the square of this number, so it is the biggest
  // single lever on how fast the landscape fills in. On the ground and in the
  // circuit you are looking at the texture of the runway, so it stays sharp;
  // at cruise you are looking at a valley from eight kilometres and the extra
  // detail is bytes nobody sees. The step is gradual so tiles are not thrown
  // away and re-fetched while you climb through it.
  const detailFor = (a) => {
    const agl = a.agl ?? 0;
    const t = Math.min(1, Math.max(0, (agl - 600) / 4400));
    scene.globe.maximumScreenSpaceError = 1.5 + t * 1.5;
  };

  const vrefFor = () => (aircraft.flaps >= 2 ? 110 : aircraft.flaps === 1 ? 125 : 150);

  const controls = createControls(viewer.canvas, {
    onNotice: (message) => panel.notice(message),
    onAction: (code) => {
      switch (code) {
        case 'KeyG':
          sim.setGear(!aircraft.gear);
          panel.notice(aircraft.gear ? 'Gear up' : 'Gear down');
          break;
        case 'KeyF':
          sim.setFlaps((aircraft.flaps + 1) % 3);
          break;
        case 'KeyB':
          setBrakes(!brakes);
          break;
        case 'KeyV':
          sim.setSpeedbrake(!sim.speedbrake);
          break;
        case 'KeyC':
          setView(view === 'cockpit' ? 'chase' : view === 'chase' ? 'free' : 'cockpit');
          break;
        case 'KeyP':
          cycleAutopilot();
          break;
        case 'Space':
          paused = !paused;
          panel.notice(paused ? 'Paused' : 'Running');
          break;
        case 'BracketLeft':
        case 'BracketRight':
          break;
        case 'Digit1':
          setRate(rateIndex - 1);
          break;
        case 'Digit2':
          setRate(rateIndex + 1);
          break;
        case 'KeyL':
          showPicker(!picker.classList.contains('is-open'));
          break;
        case 'KeyN':
          minimap.toggle();
          break;
        case 'KeyJ':
          sound.toggle();
          break;
        default:
          break;
      }
    },
  });

  function cycleAutopilot() {
    const onRoute = autoMode === 'route';
    if (autoMode === 'off') {
      autoMode = 'hold';
      hold = { heading: aircraft.heading, alt: aircraft.alt, speed: aircraft.kias ?? 250 };
      panel.notice('Autopilot: heading and altitude hold');
    } else if (!onRoute) {
      autoMode = 'route';
      panel.notice('Autopilot: route to Courchevel');
    } else {
      autoMode = 'off';
      panel.notice('Autopilot off — you are flying');
    }
  }

  setView(view);
  controls.setThrottle(start.throttle ?? 0);
  sim.setBrakes(brakes);
  panel.setBrakeRelease(() => setBrakes(false));

  // ---- the loop -----------------------------------------------------------
  function frame(now) {
    // Two clocks. The simulation step is clamped, so one slow frame cannot
    // launch the aeroplane across a valley; the controls run on the real
    // elapsed time, so the throttle lever takes two seconds to travel whether
    // the machine is managing sixty frames a second or six.
    const wall = Math.min(0.5, (now - last) / 1000);
    const real = Math.min(0.1, wall);
    last = now;
    // The rate you asked for, and the rate you get: near the ground it is held
    // back, and the glass shows whichever is in force rather than whichever
    // was requested.
    const low = aircraft.onGround || (aircraft.agl ?? 1e9) < LOW_ALTITUDE;
    const rate = low ? Math.min(LOW_RATE_CAP, RATES[rateIndex]) : RATES[rateIndex];
    const delta = paused ? 0 : real * rate;

    const axes = controls.sample(wall);
    if (delta > 0) {
      // Taking the controls switches the autopilot out, the way it would.
      const nudge = controls.tilting && !controls.stick ? 0.45 : 0.2;
      if (autoMode !== 'off' && (Math.abs(axes.pitch) > nudge || Math.abs(axes.roll) > nudge)) {
        autoMode = 'off';
        panel.notice('Autopilot off — you are flying');
      }

      let input;
      if (autoMode === 'route') {
        input = sim.routeAutopilot(navState, delta);
        if (input.config) {
          if (input.config.gear !== aircraft.gear && (input.config.gear || !aircraft.onGround)) {
            sim.setGear(input.config.gear);
          }
          if (input.config.flaps !== aircraft.flaps) sim.setFlaps(input.config.flaps);
        }
      } else if (autoMode === 'hold') {
        input = sim.holdAutopilot(hold, delta);
      } else if (controls.tilting && !controls.stick) {
        // Twenty degrees of phone is twenty degrees of aeroplane. The model
        // takes an attitude directly — the same door the autopilot uses.
        input = {
          attitude: {
            pitch: clamp(axes.pitch * 18, -14, 18) * DEG,
            bank: clamp(axes.roll * 40, -45, 45) * DEG,
          },
          yaw: clamp(axes.yaw + buttonYaw, -1, 1),
          throttle: axes.throttle,
        };
      } else {
        input = {
          law: axes.law,
          handDt: wall,
          pitch: axes.pitch,
          roll: axes.roll,
          yaw: clamp(axes.yaw + buttonYaw, -1, 1),
          trim: axes.trim,
          throttle: axes.throttle,
        };
      }
      if (autoMode !== 'off') controls.setThrottle(input.throttle);
      // With tilt, "touching the controls" has to mean a real deflection or
      // the autopilot would drop out from hand tremor alone.

      lowFlying = (aircraft.agl ?? 1e9) < 150;
      updateClipping(aircraft.lat, aircraft.lon);
      if (!params.has('bare')) scenery.update(aircraft.lat, aircraft.lon);
      detailFor(aircraft);
      lookahead.update(aircraft);
      terrainService.update({
        lat: aircraft.lat,
        lon: aircraft.lon,
        agl: aircraft.agl ?? 1000,
        // At four times speed the ground goes by four times as fast, so the
        // patch has to be four times as far ahead. Feeding the raw airspeed
        // here is how you fly off the edge of your own terrain.
        speed: (aircraft.speed ?? 0) * rate,
        heading: aircraft.heading ?? 0,
      });
      sim.step(input, delta, groundHeight(aircraft.lat, aircraft.lon));
    }

    // The camera that rides behind the aeroplane.
  //
  // It used to sit seventy metres due north-of-track and look five degrees
  // down, which is right only in level flight: climb away and the aeroplane
  // rises out of the top of the frame, bank and it swings out of the side.
  // The fix is to stop thinking in latitude and longitude. The offset is
  // taken in the aeroplane's own frame — so far back, so far up, from the
  // tail — and the camera aims at a point ahead of the nose rather than at
  // the aeroplane, which is what lets you see where you are going.
  //
  // It follows an attitude of its own: most of the pitch and a third of the
  // bank. A camera welded to the airframe makes the world roll instead of the
  // aeroplane, and that is how you lose your bearings and your lunch.
  const CHASE = { back: 62, up: 11, ahead: 260, follow: 2.8 };
  let chaseEye = null;
  const scratch = new Cartesian3();

  function chaseCamera(position, a, dt) {
    const attitude = new HeadingPitchRoll(a.heading, a.pitch * 0.65, a.bank * 0.3);
    const frame = Transforms.headingPitchRollToFixedFrame(position, attitude);
    // x is right, y is forward and z is up in this frame — which is why the
    // aeroplane mesh had to be rotated into it as well.
    const wanted = Matrix4.multiplyByPoint(frame, new Cartesian3(0, -CHASE.back, CHASE.up), new Cartesian3());
    const aim = Matrix4.multiplyByPoint(frame, new Cartesian3(0, CHASE.ahead, 0), new Cartesian3());
    // A camera that snaps to its ideal point transmits every twitch of the
    // gear and every gust. This one catches up over about a third of a second,
    // which reads as a camera being flown rather than bolted on.
    const lag = 1 - Math.exp(-CHASE.follow * dt);
    chaseEye = chaseEye
      ? Cartesian3.lerp(chaseEye, wanted, lag, new Cartesian3())
      : Cartesian3.clone(wanted);
    // Teleports, and the first frame after one, must not be flown to.
    if (Cartesian3.distance(chaseEye, wanted) > 4000) chaseEye = Cartesian3.clone(wanted);
    const direction = Cartesian3.normalize(
      Cartesian3.subtract(aim, chaseEye, new Cartesian3()),
      new Cartesian3(),
    );
    const up = Cartesian3.normalize(
      Matrix4.multiplyByPointAsVector(frame, Cartesian3.UNIT_Z, scratch),
      new Cartesian3(),
    );
    viewer.camera.setView({ destination: chaseEye, orientation: { direction, up } });
  }

  // ---- camera -----------------------------------------------------------
    const position = Cartesian3.fromDegrees(aircraft.lon, aircraft.lat, aircraft.alt);
    model.update(position, aircraft.heading, aircraft.pitch, aircraft.bank);
    if (view === 'cockpit') {
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(aircraft.lon, aircraft.lat, aircraft.alt + 1.1),
        orientation: {
          heading: aircraft.heading,
          pitch: aircraft.pitch + CesiumMath.toRadians(1.5),
          roll: aircraft.bank,
        },
      });
    } else if (view === 'chase') {
      chaseCamera(position, aircraft, real);
    }

    const ground = groundHeight(aircraft.lat, aircraft.lon);
    panel.update(aircraft, {
      altFt: (aircraft.alt - datum) / FT,
      aglFt: aircraft.agl !== undefined ? aircraft.agl / FT : (aircraft.alt - ground) / FT,
      trim: axes.trim,
      law: axes.law,
      input: axes.yoke ? 'mouse' : axes.source,
      brakes,
      speedbrake: sim.speedbrake,
      vref: vrefFor(),
      tilting: controls.tilting,
      pitchInverted: controls.pitchInverted,
      tiltStatus: controls.tiltStatus,
      tiltDiagnosis: controls.tiltDiagnosis,
      tiltLive: controls.tiltLive,
      stick: controls.stick,
      sound: sound.enabled,
      rate,
      rateWanted: RATES[rateIndex],
      ap:
        autoMode === 'route'
          ? `AUTOPILOOT · ${route[navState.leg]?.name ?? ''}`
          : autoMode === 'hold'
            ? `AUTOPILOOT · ${Math.round((hold.heading / DEG + 360) % 360)}° · ${Math.round((hold.alt - datum) / FT / 100) * 100} ft`
            : paused
              ? 'GEPAUZEERD'
              : '',
    });
    sound.update(aircraft);
    minimap.update(aircraft, {
      route: autoMode === 'route' ? route : [],
      leg: autoMode === 'route' ? navState.leg : null,
    });
    requestAnimationFrame(frame);
  }

  // ---- buttons ------------------------------------------------------------
  // Steering is held, not clicked, so the rudder buttons work on press and
  // release rather than on click — including when the pointer slides off them.
  const hud = document.querySelector('#hud');
  for (const [action, value] of [['yaw-left', -1], ['yaw-right', 1]]) {
    const button = hud.querySelector(`[data-action="${action}"]`);
    const press = (on) => {
      buttonYaw = on ? value : 0;
      button.classList.toggle('is-on', on);
    };
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      press(true);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      button.addEventListener(type, () => press(false));
    }
  }

  controls.attachStick(document.querySelector('[data-el="stickArea"]'));

  // Both throttles are sliders: drag anywhere on them to set the lever.
  for (const name of ['leverTrack', 'touchThrottle']) {
    const track = document.querySelector(`[data-el="${name}"]`);
    if (!track) continue;
    const set = (event) => {
      const box = track.getBoundingClientRect();
      controls.setThrottle(1 - (event.clientY - box.top) / box.height);
    };
    track.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      track.setPointerCapture?.(event.pointerId);
      set(event);
    });
    track.addEventListener('pointermove', (event) => {
      if (event.buttons) set(event);
    });
  }

  // The old single-slider wiring, kept for the desktop strip.
  document.querySelector('#hud').addEventListener('click', (event) => {
    const { view: mode, action } = event.target.closest('button')?.dataset ?? {};
    if (mode) setView(mode);
    switch (action) {
      case 'where':
        showPicker(true);
        break;
      case 'thr-up':
        controls.nudgeThrottle(0.1);
        break;
      case 'thr-down':
        controls.nudgeThrottle(-0.1);
        break;
      case 'thr-set':
        break;
      case 'brakes':
      case 'release-brakes':
        setBrakes(action === 'brakes' ? !brakes : false);
        break;
      case 'gear':
        sim.setGear(!aircraft.gear);
        break;
      case 'flaps':
        sim.setFlaps((aircraft.flaps + 1) % 3);
        break;
      case 'ap':
        cycleAutopilot();
        break;
      case 'rate-down':
        setRate(rateIndex - 1);
        break;
      case 'rate-up':
        setRate(rateIndex + 1);
        break;
      case 'map':
        minimap.toggle();
        break;
      case 'sound':
        sound.toggle();
        break;
      case 'tilt':
        if (controls.tilting) controls.disableTilt();
        else controls.enableTilt();
        break;
      case 'centre':
        controls.centreTilt();
        break;
      case 'invert':
        controls.toggleInvertPitch();
        break;
      default:
        break;
    }
  });
  picker.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.action === 'close') showPicker(false);
    if (button.dataset.place) goTo(findPlace(button.dataset.place));
  });
  // Searching the world index. It is only fetched the first time somebody
  // types, so a session that never looks never pays for it.
  const hits = picker.querySelector('[data-el="hits"]');
  const findInput = picker.querySelector('[data-el="find"] input');
  let worldHits = [];
  const renderHits = () => {
    hits.innerHTML = worldHits
      .map(
        (airport, i) =>
          `<li><button data-hit="${i}"><strong>${airport.ident} · ${airport.name}</strong>` +
          `<span>${Math.round(airport.runways[0].lengthFt * 0.3048)} m ${airport.runways[0].surface}` +
          ` · ${airport.country} · ${airport.elevationFt} ft</span></button></li>`,
      )
      .join('');
  };
  findInput.addEventListener('input', async () => {
    const query = findInput.value;
    if (query.trim().length < 2) {
      worldHits = [];
      renderHits();
      return;
    }
    await loadAirports();
    worldHits = searchAirports(query);
    renderHits();
  });
  picker.querySelector('[data-el="find"]').addEventListener('submit', (event) => event.preventDefault());
  hits.addEventListener('click', (event) => {
    const i = event.target.closest('button')?.dataset.hit;
    if (i === undefined) return;
    const place = startFrom(worldHits[Number(i)]);
    if (place) goTo(place);
  });

  picker.querySelector('[data-el="coords"]').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const lat = Number(data.get('lat'));
    const lon = Number(data.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    goTo({
      id: 'custom',
      name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
      lat,
      lon,
      msl: Number(data.get('alt')) || 3000,
      heading: 0,
      speed: 250,
      throttle: 0.6,
    });
  });

  // Exposed for scripts/fly-check.mjs and for anyone poking at it from the
  // console; see docs/flight-view.md.
  window.__places = PLACES;
  window.__fly = {
    viewer,
    lookahead,
    scene,
    sim,
    aircraft,
    route,
    navState,
    datum,
    airports,
    groundHeight,
    terrainService,
    scenery,
    sound,
    goTo,
    places: PLACES,
    pause: (value) => {
      paused = value;
    },
    setAutopilot: (mode) => {
      autoMode = mode;
    },
  };
  loading.classList.add('is-hidden');
  // Say, once, that nobody else is flying this.
  panel.notice(
    start.onGround
      ? 'You are flying. Brake off with B, throttle up with W, rotate at 95 kt.'
      : 'You are flying. Arrows steer, W and S for throttle, P for the autopilot.',
  );
  console.info(
    `${sim.name} · start "${startPlace.id}" · offsets ` +
      AIRPORT_IDS.map((id) => `${id} ${datums[id].toFixed(1)}`).join(' ') +
      ' m · ' +
      `Courchevel ${airports.lflj.runways[0].length} m @ ${airports.lflj.runways[0].slope}%`,
  );
  requestAnimationFrame(frame);
}

main().catch((error) => {
  console.error(error);
  status(`Could not load the flight: ${error.message}`);
  loading.classList.add('is-error');
});
