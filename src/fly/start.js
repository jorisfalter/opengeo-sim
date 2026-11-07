// Where the flight begins.
//
// Opening fly.html put you on runway 36 at Chambéry whether that was where you
// wanted to be or not. The picker that could take you somewhere else existed
// only once you were already flying — the wrong way round, because choosing
// where to go is the first thing you want to do and was the last thing the
// simulator offered.
//
// So it asks first, and it asks while the scene, the terrain, the airfield
// surveys and the flight model are all still loading behind it. Choosing
// therefore costs nothing: the loading line keeps moving under the menu, and
// by the time most people have read the regions the aeroplane is ready to be
// placed. A URL that already names a start skips the menu entirely, so every
// link that worked before still works and lands where it says.
import { GROUPS, PLACES, groupsOf } from './places.js';
import { loadAirports, searchAirports, startFrom } from './airports.js';
import { DEFAULT_TYPE, FLEET, typeFor } from './fleet.js';

// Where the aerial photography is centimetres a pixel instead of Sentinel-2's
// ten metres. A random field inside one of these is worth flying from; a
// random field in the middle of Kazakhstan is a grey smear with a runway
// drawn on it, so the two are offered as separate dice.
const COVERED = [
  { name: 'France', box: [-5.2, 41.3, 9.6, 51.1] },
  { name: 'Switzerland', box: [5.9, 45.8, 10.6, 47.9] },
  { name: 'South Tyrol', box: [10.3, 46.15, 12.55, 47.15] },
  { name: 'Austria', box: [9.4, 46.3, 17.2, 49.1] },
  { name: 'the Netherlands', box: [3.3, 50.7, 7.3, 53.6] },
  { name: 'Flanders', box: [2.5, 50.6, 5.95, 51.55] },
];

// A PC-24 lands on gravel and grass in real life, but a random unsurveyed
// 400 m strip is a bad first impression, so the dice ask for something a jet
// can plainly use. OurAirports spells its surfaces freely — ASP, ASPH,
// asphalt, CON, concrete, PEM — but `npm run build:airports` has already
// sorted that out and writes one of hard, soft, other, water or snow. Matching
// the raw spellings here found nothing at all: 28,338 fields, no candidates,
// and a die that silently refused to roll.
//
// How long the runway has to be is the aeroplane's business, not this file's:
// a thousand metres for the PC-24, three thousand for the A380, both in
// fleet.js. Counted over the index: 8,835 hard fields in the world are long
// enough for the PC-24 and 1,033 for the A380, 311 and 41 of them inside the
// sharp photography. Roll the dice with the big one selected and the pool
// shrinks by a factor of eight, which is exactly what should happen.
const HARD = 'hard';

const inBox = (airport, [west, south, east, north]) =>
  airport.lon >= west && airport.lon <= east && airport.lat >= south && airport.lat <= north;

/** A field a jet can use, picked at random, optionally inside the good imagery. */
function randomField(index, covered, minLengthFt) {
  const pool = index.filter((airport) => {
    const runway = airport.runways[0];
    if (!runway || !(runway.lengthFt >= minLengthFt) || runway.surface !== HARD) return false;
    if (covered && !COVERED.some((region) => inBox(airport, region.box))) return false;
    // Only offer what the simulator can actually line up on.
    return Boolean(startFrom(airport));
  });
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// No region is open to begin with, and that is deliberate. Opening one puts
// thirteen fields between the regions and everything else, and the dice and
// the search box fall off the bottom of the sheet — so the menu would offer
// three ways to choose and show one. Closed, all three are on the first
// screen, and a region expands under the pill you pressed.

const escape = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Shows the menu and resolves with what to start from: a `PLACES` id, or an
 * ICAO code from the world index. Resolves immediately with null when the URL
 * already said where to go.
 */
export function askWhereToStart(params) {
  if (params.has('start') || (params.has('lat') && params.has('lon')) || params.has('bare')) {
    return { chosen: Promise.resolve(null), status: () => {}, dismiss: () => {} };
  }

  const menu = document.createElement('div');
  menu.className = 'fly-picker fly-start is-open';
  menu.innerHTML = `
    <div class="fly-picker__sheet">
      <h2>Where do you want to begin?</h2>
      <p class="fly-start__lead">Pick a region for a hand-picked field, roll for one, or name any airfield on earth.</p>
      <div class="fly-start__fleet" data-el="fleet">
        ${Object.values(FLEET)
          .map(
            (aircraft) =>
              `<button type="button" data-aircraft="${escape(aircraft.id)}"><strong>${escape(
                aircraft.label,
              )}</strong><span>${escape(aircraft.note)}</span></button>`,
          )
          .join('')}
      </div>
      <div class="fly-start__regions" data-el="regions">
        ${GROUPS.map(
          (group) => `<button type="button" data-region="${escape(group)}">${escape(group)}</button>`,
        ).join('')}
      </div>
      <ul data-el="fields"></ul>
      <div class="fly-start__dice">
        <button type="button" data-dice="covered">Surprise me — sharp photography</button>
        <button type="button" data-dice="world">Surprise me — anywhere on earth</button>
      </div>
      <form data-el="find">
        <label>Or any airfield on earth:
          <input name="q" placeholder="ICAO or name, e.g. LSZS or Samedan" autocomplete="off" />
        </label>
      </form>
      <ul class="fly-picker__hits" data-el="hits"></ul>
      <p data-el="note">The terrain and the satellite imagery are worldwide. Aerial photography a few
        centimetres a pixel covers France, Switzerland, South Tyrol, Austria, the Netherlands and
        Flanders; only Chambéry and Courchevel have a surveyed runway under the wheels.</p>
      <p class="fly-start__status" data-el="status">Loading…</p>
    </div>`;
  document.body.append(menu);
  const el = (name) => menu.querySelector(`[data-el="${name}"]`);

  const showRegion = (group) => {
    for (const button of menu.querySelectorAll('[data-region]')) {
      button.classList.toggle('is-on', button.dataset.region === group);
    }
    el('fields').innerHTML = PLACES.filter((place) => groupsOf(place).includes(group))
      .map(
        (place) =>
          `<li><button type="button" data-place="${escape(place.id)}"><strong>${escape(
            place.name,
          )}</strong><span>${escape(place.note ?? '')}</span></button></li>`,
      )
      .join('');
  };

  // Which aeroplane, kept here until the start is settled. It goes back into
  // the params object this function was handed, which is the one the simulator
  // reads — the menu is answered long before anything looks at the type.
  let aircraft = typeFor(params.get('aircraft'));
  const showAircraft = () => {
    for (const button of menu.querySelectorAll('[data-aircraft]')) {
      button.classList.toggle('is-on', button.dataset.aircraft === aircraft.id);
    }
  };
  showAircraft();

  let settle;
  const chosen = new Promise((resolve) => {
    settle = (value) => {
      // Put the choice in the URL, so a reload and a shared link both land
      // here rather than back at the menu.
      const url = new URL(window.location.href);
      url.searchParams.set('start', value);
      if (aircraft.id === DEFAULT_TYPE) url.searchParams.delete('aircraft');
      else url.searchParams.set('aircraft', aircraft.id);
      params.set('aircraft', aircraft.id);
      window.history.replaceState({}, '', url);
      menu.remove();
      resolve(value);
    };
  });

  const think = (text) => {
    el('note').textContent = text;
  };

  menu.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.place) {
      settle(button.dataset.place);
      return;
    }
    if (button.dataset.aircraft) {
      aircraft = typeFor(button.dataset.aircraft);
      showAircraft();
      think(
        `${aircraft.label}: ${aircraft.note}. The dice will only offer fields with ` +
          `${((Math.round((aircraft.minRunwayFt * 0.3048) / 100) * 100).toLocaleString('en-US'))} m ` +
          'or more of hard runway.',
      );
      return;
    }
    if (button.dataset.region) {
      // Pressing the open region again folds it away, so the sheet can be put
      // back the way it was found.
      showRegion(button.classList.contains('is-on') ? null : button.dataset.region);
      return;
    }
    if (button.dataset.ident) {
      settle(button.dataset.ident);
      return;
    }
    if (button.dataset.dice) {
      const covered = button.dataset.dice === 'covered';
      button.disabled = true;
      think('Reading the world index — 28,000 airfields…');
      const index = await loadAirports().catch(() => null);
      button.disabled = false;
      if (!index) {
        think('The world index would not load. The regions above work without it.');
        return;
      }
      const field = randomField(index, covered, aircraft.minRunwayFt);
      if (!field) {
        think(`No field came up. ${aircraft.label} needs a long runway — try the other dice.`);
        return;
      }
      settle(field.ident);
    }
  });

  el('find').addEventListener('submit', (event) => {
    event.preventDefault();
    const first = el('hits').querySelector('button');
    if (first) settle(first.dataset.ident);
  });
  el('find').querySelector('input').addEventListener('input', async (event) => {
    const query = event.target.value.trim();
    if (query.length < 2) {
      el('hits').innerHTML = '';
      return;
    }
    await loadAirports().catch(() => null);
    el('hits').innerHTML = searchAirports(query, 8)
      .map(
        (field) =>
          `<li><button type="button" data-ident="${escape(field.ident)}"><strong>${escape(
            field.ident,
          )}</strong> ${escape(field.name)}<span>${escape(field.country ?? '')} · ${Math.round(
            (field.runways[0]?.lengthFt ?? 0) * 0.3048,
          )} m ${escape(field.runways[0]?.surface ?? '')}</span></button></li>`,
      )
      .join('');
  });

  return {
    chosen,
    // The loading line keeps reporting underneath the menu, because a menu
    // over a frozen screen looks like a menu over a broken simulator.
    status: (text) => {
      const node = el('status');
      if (node) node.textContent = text;
    },
    dismiss: () => menu.remove(),
  };
}
