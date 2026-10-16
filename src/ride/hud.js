// HUD overlay: everything the cab view cannot show by itself.
const fmtTime = (seconds) => {
  const total = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export function createHud(root, ride, run, rides = []) {
  root.innerHTML = `
    <div class="ride-hud">
      <div class="ride-hud__top">
        <div class="ride-hud__title">
          <select data-action="ride" aria-label="Rit">
            ${rides
              .map(
                (entry) =>
                  `<option value="${entry.id}"${entry.id === ride.id ? ' selected' : ''}>${entry.title}</option>`,
              )
              .join('')}
          </select>
          <span>${ride.line} · ${(ride.length / 1000).toFixed(2)} km · situatie 2026</span>
        </div>
        <div class="ride-hud__modes">
          <button data-view="cab" class="is-active">Cabine</button>
          <button data-view="chase">Achter de trein</button>
          <button data-view="free">Vrij kijken</button>
        </div>
      </div>
      <div class="ride-hud__panel">
        <div class="ride-hud__progress">
          <div class="ride-hud__bar"><div class="ride-hud__fill"></div></div>
          <div class="ride-hud__stops"></div>
        </div>
        <div class="ride-hud__bottom">
        <div class="ride-hud__speed"><span class="ride-hud__value">0</span><span>km/u</span></div>
        <dl class="ride-hud__readout">
          <div><dt>Volgende</dt><dd data-field="next">—</dd></div>
          <div><dt>Kilometrering</dt><dd data-field="chainage">0,00 km</dd></div>
          <div><dt>Rijtijd</dt><dd data-field="clock">00:00</dd></div>
          <div><dt>Baanvaksnelheid</dt><dd data-field="limit">—</dd></div>
          <div><dt>Boogradius</dt><dd data-field="radius">—</dd></div>
          <div><dt>Railhoogte</dt><dd data-field="height">—</dd></div>
        </dl>
        <div class="ride-hud__controls">
          <button data-action="toggle">Pauze</button>
          <button data-action="slower">−</button>
          <span data-field="rate">1×</span>
          <button data-action="faster">+</button>
          <button data-action="restart">Opnieuw</button>
          <label><input type="checkbox" data-layer="buildings" checked /> Gebouwen</label>
          <label><input type="checkbox" data-layer="ground" /> BGT-terrein</label>
          <label><input type="checkbox" data-layer="rails" checked /> Spoor</label>
          <label><input type="checkbox" data-layer="catenary" checked /> Bovenleiding</label>
        </div>
        </div>
      </div>
      <p class="ride-hud__credit">${ride.attribution.geometry}<br />${ride.attribution.terrain} · ${ride.attribution.imagery}</p>
    </div>`;

  const stopsEl = root.querySelector('.ride-hud__stops');
  stopsEl.innerHTML = run.stops
    .map((stop) => {
      const left = (stop.chainage / ride.length) * 100;
      return `<span style="left:${left.toFixed(2)}%"><i></i>${stop.name.replace('Amsterdam ', '')}</span>`;
    })
    .join('');

  const fill = root.querySelector('.ride-hud__fill');
  const value = root.querySelector('.ride-hud__value');
  const field = (name) => root.querySelector(`[data-field="${name}"]`);

  return {
    update(state, pose) {
      fill.style.width = `${((state.s / ride.length) * 100).toFixed(2)}%`;
      value.textContent = Math.round(state.v * 3.6);
      const next = run.stopAhead(state.s);
      const remaining = Math.max(0, next.chainage - state.s);
      field('next').textContent =
        state.done && remaining < 5
          ? 'eindpunt'
          : `${next.name} · ${(remaining / 1000).toFixed(2)} km`;
      field('chainage').textContent = `${(state.s / 1000).toFixed(2).replace('.', ',')} km`;
      field('clock').textContent = `${fmtTime(state.t)} / ${fmtTime(run.duration)}`;
      field('limit').textContent = `${Math.round(pose.speedLimit)} km/u`;
      const radius = Math.abs(pose.curvature) < 1e-5 ? null : Math.abs(1 / pose.curvature);
      field('radius').textContent = radius ? `${Math.round(radius)} m` : 'recht';
      field('height').textContent = pose.railNap
        ? `${pose.railNap.toFixed(1)} m NAP${pose.bridge ? ' · kunstwerk' : ''}`
        : `${pose.aboveGround.toFixed(1)} m boven maaiveld`;
    },
    setRate(rate) {
      field('rate').textContent = `${rate}×`;
    },
    setPaused(paused) {
      root.querySelector('[data-action="toggle"]').textContent = paused ? 'Rijden' : 'Pauze';
    },
    setView(mode) {
      root.querySelectorAll('[data-view]').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.view === mode);
      });
    },
  };
}
