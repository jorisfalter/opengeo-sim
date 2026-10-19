// Cockpit overlay: an attitude indicator, the numbers a pilot actually scans,
// and the route state. Deliberately not a PC-24 panel — the point is to fly
// the valley and look out of the window.
import { toFeet, toFpm, toKnots } from './flight.js';

export function createHud(root, flight) {
  root.innerHTML = `
    <div class="fly-hud">
      <div class="fly-hud__top">
        <div class="fly-hud__title">
          <strong>${flight.title}</strong>
          <span>${flight.subtitle}</span>
        </div>
        <div class="fly-hud__modes">
          <button data-view="cockpit" class="is-active">Cockpit</button>
          <button data-view="chase">Buitenaanzicht</button>
          <button data-view="free">Vrij kijken</button>
        </div>
      </div>

      <div class="fly-hud__middle">
        <div class="fly-hud__attitude">
          <div class="fly-hud__ball"><i></i></div>
          <div class="fly-hud__crosshair"></div>
        </div>
      </div>

      <div class="fly-hud__panel">
        <div class="fly-hud__gauges">
          <div class="fly-gauge"><span data-field="ias">0</span><label>kt IAS</label></div>
          <div class="fly-gauge"><span data-field="alt">0</span><label>ft</label></div>
          <div class="fly-gauge"><span data-field="vs">0</span><label>ft/min</label></div>
          <div class="fly-gauge"><span data-field="hdg">000</span><label>koers</label></div>
        </div>
        <dl class="fly-hud__readout">
          <div><dt>Bestemming</dt><dd data-field="dest">—</dd></div>
          <div><dt>Height above field</dt><dd data-field="agl">—</dd></div>
          <div><dt>Gas</dt><dd data-field="thr">0%</dd></div>
          <div><dt>Config</dt><dd data-field="cfg">—</dd></div>
          <div><dt>Bank</dt><dd data-field="bank">0°</dd></div>
          <div><dt>Modus</dt><dd data-field="mode">Autopiloot</dd></div>
        </dl>
        <div class="fly-hud__controls">
          <button data-action="ap">Autopiloot uit</button>
          <button data-action="gear">Gear</button>
          <button data-action="flaps">Flaps</button>
          <button data-action="slower">−</button>
          <span data-field="rate">1×</span>
          <button data-action="faster">+</button>
          <button data-action="restart">Opnieuw</button>
        </div>
      </div>
      <p class="fly-hud__credit">${flight.attribution}</p>
      <p class="fly-hud__keys">pijltjes sturen · <kbd>A</kbd>/<kbd>Z</kbd> gas · <kbd>G</kbd> gear · <kbd>F</kbd> flaps · <kbd>B</kbd> remmen · <kbd>P</kbd> autopiloot · <kbd>C</kbd> camera</p>
    </div>`;

  const field = (name) => root.querySelector(`[data-field="${name}"]`);
  const ball = root.querySelector('.fly-hud__ball');

  return {
    update(aircraft, nav) {
      // The real flight model knows its indicated airspeed; the simple one only
      // has a true airspeed, which near the ground is close enough.
      const ias = aircraft.kias ?? toKnots(aircraft.speed);
      field('ias').textContent = Math.round(ias);
      field('alt').textContent = Math.round(toFeet(aircraft.alt) / 10) * 10;
      field('vs').textContent = Math.round(toFpm(aircraft.vs) / 50) * 50;
      field('hdg').textContent = String(
        Math.round((aircraft.heading * 180) / Math.PI + 360) % 360,
      ).padStart(3, '0');
      field('dest').textContent = nav.distance
        ? `${nav.name} · ${(nav.distance / 1000).toFixed(1)} km`
        : nav.name;
      field('agl').textContent =
        nav.agl === null ? '—' : `${Math.round(toFeet(nav.agl) / 10) * 10} ft`;
      field('thr').textContent = `${Math.round(aircraft.throttle * 100)}%`;
      field('cfg').textContent = `${aircraft.gear ? 'gear' : 'clean'} · flaps ${aircraft.flaps}${
        aircraft.onGround ? ' · grond' : ''
      }`;
      field('bank').textContent = `${Math.round((aircraft.bank * 180) / Math.PI)}°`;
      // Attitude ball: roll with the bank, slide with the flight path angle.
      const pitchPixels = ((aircraft.pitch * 180) / Math.PI) * 3.2;
      ball.style.transform = `rotate(${(-aircraft.bank * 180) / Math.PI}deg) translateY(${pitchPixels}px)`;
    },
    setMode(auto) {
      field('mode').textContent = auto ? 'Autopiloot' : 'Handmatig';
      root.querySelector('[data-action="ap"]').textContent = auto
        ? 'Autopilot off'
        : 'Autopilot on';
    },
    setRate(rate) {
      field('rate').textContent = `${rate}×`;
    },
    setView(mode) {
      root.querySelectorAll('[data-view]').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.view === mode);
      });
      root.querySelector('.fly-hud__middle').style.opacity = mode === 'cockpit' ? '1' : '0';
    },
  };
}
