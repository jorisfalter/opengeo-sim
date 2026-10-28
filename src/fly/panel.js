// The head-up display: what you need on the glass to fly the aeroplane by
// hand. Speed on the left, altitude and vertical speed on the right, heading
// along the bottom, and in the middle a horizon with a pitch ladder and a
// flight path marker — the symbol that actually tells you where the aeroplane
// is going, as opposed to where its nose is pointing.
//
// Drawn as one SVG so it stays sharp at any window size and costs nothing to
// update: every frame moves a handful of transforms and rewrites a few labels.

const DEG = 180 / Math.PI;
const W = 1000;
const H = 620;
const PITCH_PX = 9; // pixels per degree on the ladder
const SPEED_PX = 4.4; // pixels per knot
const ALT_PX = 0.2; // pixels per foot

const tape = (count, step, draw) =>
  Array.from({ length: count }, (_, i) => draw(i * step - ((count - 1) * step) / 2)).join('');

export function createPanel(root, { title, subtitle, attribution }) {
  root.innerHTML = `
    <div class="fly-hud">
      <div class="fly-hud__top">
        <div class="fly-hud__title"><strong>${title}</strong><span>${subtitle}</span></div>
        <div class="fly-hud__modes">
          <button data-view="cockpit" class="is-active">Cockpit</button>
          <button data-view="chase">Chase</button>
          <button data-view="free">Free look</button>
          <button data-action="sound" data-el="soundButton">Sound</button>
          <button data-action="map">Map</button>
          <button data-action="plan">Plan</button>
          <button data-action="where">Start…</button>
        </div>
      </div>

      <!-- Everything you need to get off the ground, reachable with a
           trackpad alone. A keyboard shortcut nobody can find is not a
           control. -->
      <div class="fly-hud__strip">
        <div class="fly-lever">
          <button data-action="thr-down" title="Throttle back (S)">−</button>
          <div class="fly-lever__bar" data-el="leverTrack" title="Click to set the throttle"><i data-el="leverFill"></i><span data-el="leverText">0%</span></div>
          <button data-action="thr-up" title="Throttle up (W)">+</button>
        </div>
        <div class="fly-rudder">
          <button data-action="yaw-left" title="Rudder left (Q) — steers the nosewheel on the ground">◀</button>
          <span>RUDDER</span>
          <button data-action="yaw-right" title="Rudder right (E) — steers the nosewheel on the ground">▶</button>
        </div>
        <button data-action="brakes" data-el="brakeButton">Brake</button>
        <button data-action="gear" data-el="gearButton">Gear</button>
        <button data-action="flaps" data-el="flapsButton">Flaps 0</button>
        <button data-action="ap" data-el="apButton">Autopilot</button>
        <div class="fly-rate">
          <button data-action="rate-down" title="Slower (1)">«</button>
          <span data-el="rateLabel">1×</span>
          <button data-action="rate-up" title="Faster (2)">»</button>
        </div>
      </div>

      <svg class="fly-glass" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <defs>
          <clipPath id="ladderClip"><rect x="300" y="60" width="400" height="500" rx="12"/></clipPath>
          <clipPath id="speedClip"><rect x="40" y="170" width="118" height="280"/></clipPath>
          <clipPath id="altClip"><rect x="842" y="170" width="124" height="280"/></clipPath>
          <clipPath id="hdgClip"><rect x="306" y="556" width="388" height="46"/></clipPath>
        </defs>

        <!-- attitude -->
        <g clip-path="url(#ladderClip)">
          <g data-el="ladder">
            <g data-el="ladderLines">
              ${tape(37, 5, (angle) => {
                if (angle === 0) {
                  return `<line x1="-210" y1="0" x2="210" y2="0" class="g-horizon"/>`;
                }
                const y = -angle * PITCH_PX;
                const half = angle % 10 === 0 ? 74 : 40;
                const dash = angle < 0 ? ' stroke-dasharray="9 7"' : '';
                const label =
                  angle % 10 === 0
                    ? `<text x="${-half - 10}" y="${y + 5}" class="g-small" text-anchor="end">${Math.abs(angle)}</text>
                       <text x="${half + 10}" y="${y + 5}" class="g-small">${Math.abs(angle)}</text>`
                    : '';
                return `<line x1="${-half}" y1="${y}" x2="${half}" y2="${y}" class="g-line"${dash}/>${label}`;
              })}
            </g>
          </g>
        </g>
        <!-- bank scale and pointer -->
        <g transform="translate(500 310)">
          ${[-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]
            .map((angle) => {
              const long = angle % 30 === 0 || angle === 0;
              const r1 = 196;
              const r2 = long ? 176 : 186;
              const rad = (angle - 90) / DEG;
              return `<line x1="${Math.cos(rad) * r1}" y1="${Math.sin(rad) * r1}" x2="${
                Math.cos(rad) * r2
              }" y2="${Math.sin(rad) * r2}" class="g-line"/>`;
            })
            .join('')}
          <polygon points="0,-200 -11,-182 11,-182" class="g-fill" data-el="bankPointer"/>
          <g data-el="bankIndex"><polygon points="0,-172 -9,-157 9,-157" class="g-bank"/></g>
        </g>
        <!-- the aeroplane itself, and where it is actually going -->
        <g transform="translate(500 310)">
          <path d="M-96 0 h58 l12 14 l12 -14 h58" class="g-plane"/>
          <circle cx="0" cy="0" r="3" class="g-plane"/>
        </g>
        <g data-el="fpv" class="g-fpv">
          <circle cx="0" cy="0" r="13"/><line x1="-13" y1="0" x2="-30" y2="0"/>
          <line x1="13" y1="0" x2="30" y2="0"/><line x1="0" y1="-13" x2="0" y2="-26"/>
        </g>

        <!-- airspeed -->
        <rect x="40" y="170" width="118" height="280" class="g-box"/>
        <g clip-path="url(#speedClip)"><g data-el="speedTape">
          ${tape(81, 10, (kt) => {
            const y = kt * SPEED_PX;
            return `<line x1="124" y1="${y}" x2="${kt % 20 === 0 ? 102 : 114}" y2="${y}" class="g-line"/>${
              kt % 20 === 0 ? `<text x="96" y="${y + 6}" class="g-small" text-anchor="end" data-tick="${kt}">—</text>` : ''
            }`;
          })}
        </g></g>
        <path d="M30 288 h104 l20 22 l-20 22 H30 z" class="g-readout"/>
        <text x="128" y="318" class="g-big" text-anchor="end" data-el="ias">0</text>
        <text x="99" y="160" class="g-label" text-anchor="middle">KT IAS</text>
        <text x="99" y="470" class="g-label" text-anchor="middle" data-el="mach"></text>
        <g data-el="vref"><polygon points="158,0 146,-7 146,7" class="g-vref"/></g>

        <!-- altitude -->
        <rect x="842" y="170" width="124" height="280" class="g-box"/>
        <g clip-path="url(#altClip)"><g data-el="altTape">
          ${tape(49, 100, (ft) => {
            const y = ft * ALT_PX;
            return `<line x1="876" y1="${y}" x2="${ft % 500 === 0 ? 900 : 888}" y2="${y}" class="g-line"/>${
              ft % 500 === 0 ? `<text x="908" y="${y + 6}" class="g-small" data-tick="${ft}">—</text>` : ''
            }`;
          })}
        </g></g>
        <path d="M976 288 h-108 l-20 22 l20 22 H976 z" class="g-readout"/>
        <text x="872" y="318" class="g-big" data-el="alt">0</text>
        <text x="904" y="160" class="g-label" text-anchor="middle">FEET</text>
        <text x="848" y="360" class="g-label" data-el="agl">—</text>

        <!-- vertical speed -->
        <line x1="980" y1="190" x2="980" y2="430" class="g-line"/>
        ${[-4000, -2000, 0, 2000, 4000]
          .map((fpm) => `<line x1="980" y1="${310 - fpm / 40}" x2="990" y2="${310 - fpm / 40}" class="g-line"/>`)
          .join('')}
        <polygon points="978,0 994,-9 994,9" class="g-fill" data-el="vsPointer"/>
        <text x="996" y="452" class="g-label" text-anchor="end" data-el="vs">0</text>

        <!-- heading -->
        <rect x="310" y="556" width="380" height="46" class="g-box"/>
        <g clip-path="url(#hdgClip)"><g data-el="hdgTape">
          ${tape(49, 5, (deg) => {
            const x = deg * 4.2;
            return `<line x1="${x}" y1="556" x2="${x}" y2="${deg % 10 === 0 ? 570 : 564}" class="g-line"/>${
              deg % 10 === 0 ? `<text x="${x}" y="594" class="g-small" text-anchor="middle" data-tick="${deg}">—</text>` : ''
            }`;
          })}
        </g></g>
        <polygon points="500,552 490,538 510,538" class="g-fill"/>
        <text x="500" y="532" class="g-mid" text-anchor="middle" data-el="hdg">000</text>

        <!-- what the aeroplane is set to -->
        <text x="40" y="500" class="g-mid" data-el="power">N1 0%</text>
        <text x="40" y="526" class="g-label" data-el="config">gear · flaps 0</text>
        <text x="40" y="548" class="g-label" data-el="trim">trim 0</text>
        <text x="40" y="570" class="g-label" data-el="law">assisted</text>
        <text x="40" y="592" class="g-label" data-el="input">keyboard</text>
        <text x="200" y="570" class="g-label" data-el="gload">1.0 g</text>
        <text x="500" y="110" class="g-warn" text-anchor="middle" data-el="warn"></text>
        <rect x="300" y="86" width="400" height="34" fill="transparent" data-el="warnHit"/>
        <text x="500" y="86" class="g-mid" text-anchor="middle" data-el="ap"></text>
        <text x="500" y="590" class="g-rate" text-anchor="middle" data-el="rate"></text>
      </svg>

      <div class="fly-touch">
        <!-- The whole right side is the stick: put a thumb down anywhere and
             drag. No permission, no sensor, no keyboard. -->
        <div class="fly-touch__stick" data-el="stickArea">
          <svg viewBox="0 0 400 400" data-el="stickDraw" aria-hidden="true"></svg>
        </div>
        <div class="fly-touch__power">
          <button data-action="thr-up" title="Throttle up">+</button>
          <div class="fly-touch__throttle" data-el="touchThrottle" title="Throttle">
            <i data-el="touchFill"></i>
            <span data-el="touchLever">0%</span>
          </div>
          <button data-action="thr-down" title="Throttle back">−</button>
        </div>
        <div class="fly-touch__keys">
          <button data-action="brakes" data-el="touchBrake">Brake</button>
          <button data-action="gear" data-el="touchGear">Gear</button>
          <button data-action="flaps" data-el="touchFlaps">Flaps</button>
          <button data-action="ap" data-el="touchAp">AP</button>
          <button data-action="tilt" data-el="tiltButton">Tilt</button>
          <button data-action="sound" data-el="touchSound">Sound</button>
        </div>
        <!-- Only worth showing once tilt is actually on. -->
        <p class="fly-touch__status" data-el="tiltStatus"></p>
        <div class="fly-touch__tiltkeys" data-el="tiltKeys">
          <button data-action="centre">Centre</button>
          <button data-action="invert" data-el="invertButton">Nose ⇅</button>
        </div>
      </div>
      <p class="fly-hud__rotate">Turn your device sideways — this simulator flies in landscape.</p>
      <p class="fly-hud__notice" data-el="notice"></p>
      <p class="fly-hud__credit">${attribution}</p>
      <p class="fly-hud__keys">
        <kbd>↑</kbd><kbd>↓</kbd> pitch · <kbd>←</kbd><kbd>→</kbd> roll · <kbd>Q</kbd><kbd>E</kbd> rudder ·
        <kbd>W</kbd><kbd>S</kbd> throttle · <kbd>[</kbd><kbd>]</kbd> trim · <kbd>G</kbd> gear ·
        <kbd>F</kbd> flaps · <kbd>B</kbd> brakes · <kbd>V</kbd> speedbrake · <kbd>M</kbd> control law ·
        <kbd>P</kbd> autopilot · <kbd>C</kbd> camera · <kbd>J</kbd> sound · <kbd>N</kbd> map · <kbd>L</kbd> start · <kbd>R</kbd> plan ·
        <kbd>space</kbd> pause · <kbd>1</kbd><kbd>2</kbd> time up to 8× ·
        <kbd>click</kbd> mouse yoke, <kbd>Esc</kbd> releases
      </p>
    </div>`;

  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const nodes = {
    glass: root.querySelector('.fly-glass'),
    ladder: el('ladder'),
    lines: el('ladderLines'),
    bankIndex: el('bankIndex'),
    fpv: el('fpv'),
    speedTape: el('speedTape'),
    altTape: el('altTape'),
    hdgTape: el('hdgTape'),
    vsPointer: el('vsPointer'),
    vref: el('vref'),
    notice: el('notice'),
    leverFill: el('leverFill'),
    leverText: el('leverText'),
    brakeButton: el('brakeButton'),
    touchBrake: el('touchBrake'),
    touchGear: el('touchGear'),
    touchFlaps: el('touchFlaps'),
    touchAp: el('touchAp'),
    gearButton: el('gearButton'),
    flapsButton: el('flapsButton'),
    apButton: el('apButton'),
    rateLabel: el('rateLabel'),
    touchFill: el('touchFill'),
    touchLever: el('touchLever'),
    tiltButton: el('tiltButton'),
    invertButton: el('invertButton'),
    tiltKeys: el('tiltKeys'),
    tiltStatus: el('tiltStatus'),
    soundButton: el('soundButton'),
    touchSound: el('touchSound'),
    stickDraw: el('stickDraw'),
  };
  const text = (name, value) => {
    const node = el(name);
    if (node && node.textContent !== value) node.textContent = value;
  };
  const ticks = (parent, format) =>
    [...parent.querySelectorAll('[data-tick]')].map((node) => ({
      node,
      offset: Number(node.dataset.tick),
      format,
    }));
  const speedTicks = ticks(nodes.speedTape);
  const altTicks = ticks(nodes.altTape);
  const hdgTicks = ticks(nodes.hdgTape);
  let noticeTimer = null;

  return {
    update(a, extra = {}) {
      const pitch = a.pitch * DEG;
      const bank = a.bank * DEG;
      const kias = a.kias ?? 0;
      const altFt = (extra.altFt ?? 0);
      const heading = ((a.heading * DEG) % 360 + 360) % 360;

      // Horizon and ladder: roll about the aircraft symbol, slide with pitch.
      nodes.ladder.setAttribute(
        'transform',
        `translate(500 310) rotate(${-bank}) translate(0 ${pitch * PITCH_PX})`,
      );
      nodes.bankIndex.setAttribute('transform', `rotate(${-bank})`);

      // Flight path marker: where the aeroplane is going, drift and all.
      const gamma = Math.atan2(a.vs ?? 0, Math.max(20, a.speed ?? 0)) * DEG;
      const drift = ((a.alpha ?? 0) * DEG) * Math.sin(a.bank ?? 0);
      nodes.fpv.setAttribute(
        'transform',
        `translate(${500 + clamp(drift, -12, 12) * 6} ${310 - clamp(gamma - pitch, -22, 22) * PITCH_PX})`,
      );

      // Each tape is a fixed ladder of ticks that slides by the remainder and
      // relabels itself, so forty thousand feet needs no more marks than four
      // hundred: the labels move, the geometry does not.
      const speedBase = Math.round(kias / 20) * 20;
      nodes.speedTape.setAttribute('transform', `translate(0 ${310 + (kias - speedBase) * SPEED_PX})`);
      for (const tick of speedTicks) {
        const value = speedBase - tick.offset;
        tick.node.textContent = value >= 0 && value <= 500 ? String(value) : '';
      }
      const altBase = Math.round(altFt / 500) * 500;
      nodes.altTape.setAttribute('transform', `translate(0 ${310 + (altFt - altBase) * ALT_PX})`);
      for (const tick of altTicks) {
        tick.node.textContent = String(altBase - tick.offset);
      }
      const hdgBase = Math.round(heading / 10) * 10;
      nodes.hdgTape.setAttribute('transform', `translate(${500 - (heading - hdgBase) * 4.2} 0)`);
      for (const tick of hdgTicks) {
        const value = (hdgBase + tick.offset + 720) % 360;
        tick.node.textContent = String(value).padStart(3, '0');
      }

      text('ias', String(Math.round(kias)));
      text('mach', (a.mach ?? 0) > 0.4 ? `M ${(a.mach).toFixed(2)}` : '');
      text('alt', String(Math.round(altFt / 10) * 10));
      text('agl', extra.aglFt === null || extra.aglFt === undefined ? '—' : `${Math.round(extra.aglFt)} agl`);
      text('hdg', String(Math.round(heading) % 360).padStart(3, '0'));
      const fpm = ((a.vs ?? 0) / 0.3048) * 60;
      nodes.vsPointer.setAttribute('transform', `translate(0 ${310 - clamp(fpm, -4800, 4800) / 40})`);
      text('vs', `${fpm > 0 ? '+' : ''}${Math.round(fpm / 50) * 50}`);
      text('power', `N1 ${Math.round((a.throttle ?? 0) * 100)}%`);
      const lever = Math.round((a.throttle ?? 0) * 100);
      nodes.leverFill.style.height = `${lever}%`;
      nodes.leverText.textContent = `${lever}%`;
      nodes.touchFill.style.height = `${lever}%`;
      nodes.touchLever.textContent = `${lever}%`;
      nodes.tiltButton.classList.toggle('is-on', Boolean(extra.tilting));
      nodes.invertButton.classList.toggle('is-on', Boolean(extra.pitchInverted));
      nodes.tiltKeys.classList.toggle('is-on', Boolean(extra.tilting));
      for (const node of [nodes.soundButton, nodes.touchSound]) {
        node.classList.toggle('is-on', Boolean(extra.sound));
        node.textContent = extra.sound ? 'Sound on' : 'Sound off';
      }
      // Once tilt has been switched on, the facts stay on screen whether it
      // works or not: a count of readings that stays at zero is the answer.
      const status = extra.tiltStatus || (extra.tilting ? extra.tiltDiagnosis ?? '' : '');
      if (nodes.tiltStatus.textContent !== status) nodes.tiltStatus.textContent = status;
      nodes.tiltStatus.classList.toggle('is-on', Boolean(status));
      nodes.tiltStatus.classList.toggle('is-plain', Boolean(extra.tilting) && !extra.tiltStatus);
      // A tick means readings are coming in, not merely that it was switched on.
      nodes.tiltButton.textContent = extra.tiltLive
        ? 'Tilt ✓'
        : status
          ? 'Tilt ✗'
          : 'Tilt';
      // A button that does not say which way it is set is a button you have to
      // guess at, so each one carries its own state.
      nodes.touchBrake.textContent = extra.brakes ? 'Brake ON' : 'Brake off';
      nodes.touchBrake.classList.toggle('is-on', Boolean(extra.brakes));
      nodes.touchGear.textContent = a.gear ? 'Gear DOWN' : 'Gear UP';
      nodes.touchGear.classList.toggle('is-on', Boolean(a.gear));
      nodes.touchFlaps.textContent = `Flaps ${a.flaps ?? 0}`;
      nodes.touchFlaps.classList.toggle('is-on', (a.flaps ?? 0) > 0);
      const apOn = Boolean(extra.ap) && !extra.ap.startsWith('PAUSED');
      nodes.touchAp.textContent = apOn ? 'AP ON' : 'AP off';
      nodes.touchAp.classList.toggle('is-on', apOn);
      // Where the thumb went down and where it is now.
      const grip = extra.stick;
      nodes.stickDraw.innerHTML = grip
        ? `<circle cx="200" cy="200" r="86" class="g-grip"/>` +
          `<circle cx="${200 + grip.x * 86}" cy="${200 + grip.y * 86}" r="30" class="g-thumb"/>`
        : '';
      nodes.stickDraw.style.opacity = grip ? '1' : '0';
      nodes.brakeButton.classList.toggle('is-on', Boolean(extra.brakes));
      // The button says which it is, not just which colour it is.
      nodes.brakeButton.textContent = extra.brakes ? 'Brake ON' : 'Brake off';
      nodes.gearButton.classList.toggle('is-on', Boolean(a.gear));
      nodes.flapsButton.textContent = `Flaps ${a.flaps ?? 0}`;
      nodes.flapsButton.classList.toggle('is-on', (a.flaps ?? 0) > 0);
      nodes.apButton.classList.toggle('is-on', Boolean(extra.ap) && !extra.ap.startsWith('PAUSED'));
      text(
        'config',
        `${a.gear ? 'gear' : 'clean'} · flaps ${a.flaps ?? 0}${a.onGround ? ' · ground' : ''}` +
          `${extra.brakes ? ' · brake' : ''}${extra.speedbrake ? ' · speedbrake' : ''}`,
      );
      text('trim', `trim ${((extra.trim ?? 0) * 100).toFixed(0)}`);
      text('gload', `${(a.gLoad ?? 1).toFixed(1)} g`);
      text('law', extra.law === 'direct' ? 'direct' : 'assisted');
      text('input', extra.input ?? '');
      text('ap', extra.ap ?? '');
      // Two numbers only when they differ: what you asked for and what the
      // simulation is actually giving you.
      const rate = extra.rate ?? 1;
      const wanted = extra.rateWanted ?? rate;
      nodes.rateLabel.textContent = `${wanted}×`;
      nodes.rateLabel.classList.toggle('is-capped', wanted !== rate);
      text('rate', rate === 1 && wanted === 1 ? '' : wanted === rate ? `${rate}× TIJD` : `${rate}× TIJD · ${wanted}× gevraagd`);

      // Vref bug on the speed tape, and the warnings that matter close in.
      const vref = extra.vref ?? 0;
      nodes.vref.setAttribute('transform', `translate(0 ${310 + (kias - vref) * SPEED_PX})`);
      nodes.vref.style.opacity = vref && a.gear ? '1' : '0';
      const warnings = [];
      // Standing on the runway at full thrust and going nowhere is confusing
      // for exactly as long as nobody tells you the brake is on.
      if (a.onGround && extra.brakes && (a.throttle ?? 0) > 0.25) warnings.push('BRAKE ON · B or click');
      if (a.stall) warnings.push('STALL');
      if (kias > 290) warnings.push('OVERSPEED');
      // The protections, while they have the stick; see jsbsim.js protect().
      else if (a.guard === 'speed') warnings.push('VMO · NOSE HELD UP');
      if (a.guard === 'alpha' && !a.stall) warnings.push('ALPHA LIMIT');
      if ((a.mach ?? 0) > 0.76) warnings.push('MACH');
      if (extra.aglFt !== null && extra.aglFt < 500 && fpm < -1500 && !a.onGround) {
        warnings.push('SINK RATE');
      }
      if (!a.gear && extra.aglFt !== null && extra.aglFt < 700 && !a.onGround) {
        warnings.push('GEAR');
      }
      text('warn', warnings.join(' · '));
      // The invisible rectangle that catches a tap on the warning covers the
      // top of the screen whether or not anything is written there, and it
      // was swallowing clicks meant for the buttons behind it. It only exists
      // while there is a warning to tap.
      nodes.glass.classList.toggle('has-warning', warnings.length > 0);
    },

    /** Lets the warning itself undo what it is warning about. */
    setBrakeRelease(release) {
      const hit = el('warnHit');
      hit.style.cursor = 'pointer';
      hit.addEventListener('click', () => {
        if (el('warn').textContent.includes('BRAKE ON')) release();
      });
    },

    notice(message) {
      nodes.notice.textContent = message;
      nodes.notice.classList.add('is-on');
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => nodes.notice.classList.remove('is-on'), 2200);
    },

    setView(mode) {
      root.querySelectorAll('[data-view]').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.view === mode);
      });
      root.querySelector('.fly-glass').classList.toggle('is-outside', mode !== 'cockpit');
    },
  };
}

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
