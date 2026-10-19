// Everything the pilot touches: keyboard, mouse and gamepad, collapsed into
// one set of axes the flight model understands.
//
// Two control laws, because a keyboard and a joystick want opposite things:
//
//   assist  the axes command an attitude — ask for ten degrees of pitch and
//           an inner loop finds the elevator. Flyable with four arrow keys.
//   direct  the axes are the control surfaces. What a real aeroplane does,
//           and what a stick or a gamepad deserves.
//
// A gamepad is picked up automatically when one is used; nothing has to be
// configured. The mouse becomes a yoke on click, with pointer lock, and lets
// go on Escape.

// The right hand flies on the arrows, the left hand works the throttle on
// W and S. Page Up and Page Down are kept because other simulators use them,
// but they cannot be the only way: on a MacBook keyboard they are Fn+arrow,
// which nobody guesses, and a throttle you cannot find is an aeroplane that
// does not move.
const KEY_AXES = {
  pitchUp: ['ArrowDown'],
  pitchDown: ['ArrowUp'],
  rollLeft: ['ArrowLeft', 'KeyA'],
  rollRight: ['ArrowRight', 'KeyD'],
  yawLeft: ['KeyQ', 'Comma'],
  yawRight: ['KeyE', 'Period'],
  throttleUp: ['KeyW', 'PageUp', 'Equal', 'NumpadAdd'],
  throttleDown: ['KeyS', 'PageDown', 'Minus', 'NumpadSubtract'],
  trimUp: ['BracketLeft', 'Numpad1'],
  trimDown: ['BracketRight', 'Numpad7'],
};

// Pitch is inverted on purpose: pulling back, which is stick-down on a mouse
// and arrow-down on a keyboard, raises the nose. That is how an aeroplane works
// and it is worth not quietly "fixing".
const HELD = new Set(Object.values(KEY_AXES).flat());

export function createControls(element, { onAction, onNotice } = {}) {
  const keys = new Set();
  const state = {
    pitch: 0, // −1 nose down … +1 nose up
    roll: 0,
    yaw: 0,
    throttle: 0,
    trim: 0,
    law: 'assist',
    source: 'keyboard',
    yoke: false,
    mouse: { x: 0, y: 0 },
  };

  const held = (names) => names.some((code) => keys.has(code));
  const axis = (minus, plus) => (held(minus) ? -1 : 0) + (held(plus) ? 1 : 0);

  // ---- mouse as a yoke ----------------------------------------------------
  const onMouseMove = (event) => {
    if (!state.yoke) return;
    // The virtual stick is in screen-ish units: half a screen is full travel.
    const scale = 2 / Math.min(window.innerWidth, window.innerHeight);
    state.mouse.x = clamp(state.mouse.x + event.movementX * scale, -1, 1);
    state.mouse.y = clamp(state.mouse.y + event.movementY * scale, -1, 1);
  };
  const releaseYoke = () => {
    if (!state.yoke) return;
    state.yoke = false;
    state.mouse.x = 0;
    state.mouse.y = 0;
    if (document.pointerLockElement) document.exitPointerLock();
    onNotice?.('Mouse yoke off');
  };
  const grabYoke = () => {
    if (state.yoke) return;
    element.requestPointerLock?.();
  };
  document.addEventListener('pointerlockchange', () => {
    state.yoke = document.pointerLockElement === element;
    if (state.yoke) {
      state.source = 'mouse';
      onNotice?.('Mouse yoke on — Esc releases');
    }
  });
  element.addEventListener('mousedown', (event) => {
    if (event.button === 0) grabYoke();
  });
  window.addEventListener('mousemove', onMouseMove);

  // ---- keyboard -----------------------------------------------------------
  const onKeyDown = (event) => {
    if (event.repeat) {
      if (HELD.has(event.code)) event.preventDefault();
      return;
    }
    keys.add(event.code);
    if (HELD.has(event.code) || event.code === 'Space') {
      event.preventDefault();
      state.source = 'keyboard';
    }
    switch (event.code) {
      case 'Escape':
        releaseYoke();
        break;
      case 'KeyM':
        state.law = state.law === 'assist' ? 'direct' : 'assist';
        onNotice?.(state.law === 'assist' ? 'Control law: assisted' : 'Control law: direct');
        onAction?.('law', state.law);
        break;
      default:
        onAction?.(event.code);
    }
  };
  const onKeyUp = (event) => keys.delete(event.code);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());

  // ---- the phone ----------------------------------------------------------
  //
  // Tilt is an *attitude* control, not a rate one: twenty degrees of phone is
  // twenty degrees of bank. That reads better than anything rate-based and it
  // is what the flight model already accepts, because the autopilot has always
  // handed it an attitude.
  //
  // The gyroscope is not the limiting factor — it resolves far better than a
  // tenth of a degree. A hand is: nobody holds a phone stiller than about half
  // a degree, and nobody holds it level either. So the reading is taken
  // relative to a captured reference, with a deadzone for tremor and a
  // low-pass for the rest.
  const tilt = {
    on: false, pitch: 0, roll: 0, ref: null, raw: null, invert: false, status: '',
    events: 0, via: '',
  };
  // Which way "nose up" is depends on how you hold the phone, and every
  // simulator ever written has this as a setting for that reason. Remembered
  // per browser; storage can throw in a private window, so it is wrapped.
  try {
    tilt.invert = localStorage.getItem('fly.invertPitch') === '1';
  } catch {
    tilt.invert = false;
  }
  const DEADZONE = 1.5; // degrees
  const SMOOTH = 0.25; // first-order filter, about 8 Hz at 60 fps
  // requestPermission is NOT an iOS marker. Brave on Android ships it too and
  // refuses by default through its fingerprinting shield — which is how an
  // Android phone ended up being told about Safari settings. The API decides
  // the flow; the user agent decides the advice. They are separate questions.
  const needsPermission = typeof window.DeviceOrientationEvent?.requestPermission === 'function';

  /** -90 or 90, from whichever API this browser still has. */
  const landscapeAngle = () => {
    // window.orientation is gone from Chrome on Android; screen.orientation is
    // missing from older Safari. Between them they always answer.
    const angle = screen.orientation?.angle ?? window.orientation ?? 90;
    return angle === 270 || angle === -90 ? -90 : 90;
  };

  const onOrientation = (event) => {
    if (event.beta === null || event.gamma === null) return;
    // Landscape: the phone's gamma is pitch and beta is roll, and which way
    // round depends on which edge is up.
    const landscapeLeft = landscapeAngle() === -90;
    // Tipping the top of the phone away from you lowers the nose, which is
    // the way a yoke works. The sign was the other way round at first.
    const pitchDeg = (landscapeLeft ? event.gamma : -event.gamma) * (tilt.invert ? -1 : 1);
    const rollDeg = landscapeLeft ? -event.beta : event.beta;
    tilt.events += 1;
    tilt.via = tilt.via || 'deviceorientation';
    // A reading that arrives after the warning was raised clears it. Leaving
    // a stale "no sensor data" on screen while the aeroplane is happily
    // banking is worse than never warning at all.
    if (tilt.status) tilt.status = '';
    tilt.raw = { pitch: pitchDeg, roll: rollDeg };
    if (!tilt.ref) tilt.ref = { pitch: pitchDeg, roll: rollDeg };
    const dz = (value) => (Math.abs(value) < DEADZONE ? 0 : value - Math.sign(value) * DEADZONE);
    const wantPitch = clamp(dz(pitchDeg - tilt.ref.pitch) / 22, -1, 1);
    const wantRoll = clamp(dz(rollDeg - tilt.ref.roll) / 30, -1, 1);
    tilt.pitch += (wantPitch - tilt.pitch) * SMOOTH;
    tilt.roll += (wantRoll - tilt.roll) * SMOOTH;
    state.source = 'tilt';
  };

  /**
   * Second way in. Some Android devices deliver devicemotion but never
   * deviceorientation, and then everything looks fine while nothing moves.
   * Gravity alone is enough: it points down, and which way it points in the
   * phone's own frame is exactly the tilt.
   */
  const onMotion = (event) => {
    const g = event.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null) return;
    if (tilt.via === 'deviceorientation') return; // the better source won
    tilt.via = 'devicemotion';
    tilt.events += 1;
    if (tilt.status) tilt.status = '';
    const toDeg = 180 / Math.PI;
    const landscapeLeft = landscapeAngle() === -90;
    // In landscape the phone's x axis runs up/down the screen and y across it.
    const pitchRaw = Math.atan2(g.x, Math.hypot(g.y, g.z)) * toDeg;
    const rollRaw = Math.atan2(g.y, Math.hypot(g.x, g.z)) * toDeg;
    const pitchDeg = (landscapeLeft ? -pitchRaw : pitchRaw) * (tilt.invert ? -1 : 1);
    const rollDeg = landscapeLeft ? -rollRaw : rollRaw;
    tilt.raw = { pitch: pitchDeg, roll: rollDeg };
    if (!tilt.ref) tilt.ref = { pitch: pitchDeg, roll: rollDeg };
    const dz = (value) => (Math.abs(value) < DEADZONE ? 0 : value - Math.sign(value) * DEADZONE);
    tilt.pitch += (clamp(dz(pitchDeg - tilt.ref.pitch) / 22, -1, 1) - tilt.pitch) * SMOOTH;
    tilt.roll += (clamp(dz(rollDeg - tilt.ref.roll) / 30, -1, 1) - tilt.roll) * SMOOTH;
    state.source = 'tilt';
  };

  /**
   * Chrome on Android sometimes only supplies the absolute variant and some
   * devices only devicemotion, so all three are taken; whichever arrives first
   * wins and the others are harmless.
   */
  function listen() {
    window.addEventListener('deviceorientation', onOrientation);
    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('devicemotion', onMotion);
    tilt.events = 0;
    tilt.via = '';
  }

  async function enableTilt() {
    const api = window.DeviceOrientationEvent;
    if (!api) {
      tilt.status = 'This browser has no orientation sensor. Steer with your thumb.';
      onNotice?.('No orientation sensor');
      return false;
    }
    // iOS has required a prompt from inside a real tap since iOS 13, and it
    // only works over HTTPS. Android asks for nothing.
    if (needsPermission) {
      try {
        if ((await api.requestPermission()) !== 'granted') {
          // iOS remembers this answer per site and will not ask twice, so a
          // refusal here is silent and permanent until the site data is
          // cleared. Saying that out loud is the whole point of this message.
          // A refusal is not the end: some browsers deny the formal permission
          // and still deliver devicemotion, so the listeners go on anyway and
          // the verdict waits for the reading count.
          tilt.status = `Permission denied. ${whereToLook()} Your thumb still works. ${diagnosis()}`;
          onNotice?.('Sensor denied — see the line at the bottom');
          // Switched on regardless: if readings turn up anyway the aeroplane
          // should use them, and if they do not, nothing is lost.
          listen();
          tilt.on = true;
          return false;
        }
      } catch (error) {
        tilt.status =
          `The sensor request failed (${error?.name ?? 'unknown'}). Tap again, ` +
          `or steer with your thumb. ${diagnosis()}`;
        onNotice?.('Could not ask for the sensor');
        return false;
      }
    }
    listen();
    tilt.on = true;
    tilt.ref = null;
    state.source = 'tilt';
    onNotice?.('Tilt control on — hold still and tap Centre');
    // A permission that resolves but delivers no readings looks exactly like a
    // broken app, so it is checked and reported.
    tilt.status = '';
    setTimeout(() => {
      if (tilt.on && !tilt.raw) {
        // Say what is actually true, with the numbers, so "still broken" and
        // "still the old build" stop looking the same from a distance.
        tilt.status = `No sensor readings. ${whereToLook()} Your thumb works regardless. ${diagnosis()}`;
        onNotice?.('Sensor sends nothing');
      }
    }, 3000);
    return true;
  }

  /** The facts, short enough to fit on a phone. */
  const isBrave = Boolean(navigator.brave);
  const platform = /iPhone|iPad|iPod/.test(navigator.userAgent)
    ? 'iOS'
    : /Android/.test(navigator.userAgent)
      ? isBrave
        ? 'Android/Brave'
        : 'Android'
      : 'desktop';

  /** Where this particular browser hides the switch. */
  const whereToLook = () => {
    if (platform === 'iOS') {
      return (
        'Turn on Settings ▸ Safari ▸ Motion & Orientation Access. It applies to all of ' +
        'Safari, so a private tab makes no difference. If it is already on, clear your ' +
        'earlier answer under Safari ▸ Advanced ▸ Website Data.'
      );
    }
    if (isBrave) {
      return (
        'Brave blocks motion sensors by default through its shield. Tap the lion in ' +
        'the address bar and turn off fingerprinting protection for this site, or ' +
        'allow sensors under Settings ▸ Site settings ▸ Motion sensors.'
      );
    }
    return 'Look under Settings ▸ Site settings ▸ Motion sensors in your browser.';
  };

  const diagnosis = () =>
    `[${platform} · sensor ${window.DeviceOrientationEvent ? 'yes' : 'no'} · ` +
    `permission ${needsPermission ? 'needed' : 'not needed'} · ` +
    `readings ${tilt.events} · source ${tilt.via || '-'} · build ${BUILD}]`;

  function disableTilt() {
    window.removeEventListener('deviceorientation', onOrientation);
    window.removeEventListener('deviceorientationabsolute', onOrientation);
    window.removeEventListener('devicemotion', onMotion);
    tilt.on = false;
    tilt.status = '';
    tilt.pitch = 0;
    tilt.roll = 0;
    state.source = 'keyboard';
    onNotice?.('Tilt control off');
  }

  // ---- a thumb on the glass -----------------------------------------------
  //
  // The one control that always works. Tilt needs a sensor and a permission
  // prompt, a keyboard needs a keyboard; dragging a thumb needs nothing. It
  // self-centres, which in the assisted law means "hold what you have now" —
  // push to change the attitude, let go to keep it.
  const stick = { active: false, id: null, x: 0, y: 0, ox: 0, oy: 0 };
  // Full deflection takes a real thumb stroke, and more of it sideways than
  // up and down because a phone in landscape has the room there.
  const STICK_TRAVEL_X = 170;
  const STICK_TRAVEL_Y = 125;
  /**
   * Progressive response. Linear travel means the first millimetre off centre
   * is worth as much as the last, which makes small corrections impossible —
   * the complaint was exactly that. Cubing most of it leaves full authority at
   * the edge while a third of the way out is worth only about a tenth.
   */
  const expo = (value) => 0.7 * value ** 3 + 0.3 * value;

  function attachStick(element) {
    if (!element) return;
    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      element.setPointerCapture?.(event.pointerId);
      stick.active = true;
      stick.id = event.pointerId;
      stick.ox = event.clientX;
      stick.oy = event.clientY;
      stick.x = 0;
      stick.y = 0;
      state.source = 'thumb';
    });
    element.addEventListener('pointermove', (event) => {
      if (!stick.active || event.pointerId !== stick.id) return;
      stick.x = clamp((event.clientX - stick.ox) / STICK_TRAVEL_X, -1, 1);
      stick.y = clamp((event.clientY - stick.oy) / STICK_TRAVEL_Y, -1, 1);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      element.addEventListener(type, (event) => {
        if (event.pointerId !== stick.id) return;
        stick.active = false;
        stick.x = 0;
        stick.y = 0;
      });
    }
  }

  // ---- gamepad ------------------------------------------------------------
  const buttonsWere = [];
  const GAMEPAD_BUTTONS = {
    0: 'KeyB', // A — brakes
    1: 'KeyG', // B — gear
    2: 'KeyF', // X — flaps
    3: 'KeyC', // Y — camera
    4: 'BracketLeft',
    5: 'BracketRight',
    9: 'KeyP',
  };

  function readGamepad(dt) {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return false;
    const dead = (value) => (Math.abs(value) < 0.12 ? 0 : value);
    const roll = dead(pad.axes[0] ?? 0);
    const pitch = -dead(pad.axes[1] ?? 0); // stick back is nose up
    const yaw = dead(pad.axes[2] ?? 0);
    // Right stick up/down as a throttle lever, or the triggers if it is idle.
    const lever = -dead(pad.axes[3] ?? 0);
    const triggers = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
    const active =
      Math.abs(roll) + Math.abs(pitch) + Math.abs(yaw) + Math.abs(lever) + Math.abs(triggers) > 0;
    if (active) state.source = 'gamepad';
    if (state.source !== 'gamepad') return false;

    state.roll = roll;
    state.pitch = pitch;
    state.yaw = yaw;
    if (Math.abs(triggers) > 0.02) state.throttle = clamp(state.throttle + triggers * dt, 0, 1);
    else if (Math.abs(lever) > 0.02) state.throttle = clamp((lever + 1) / 2, 0, 1);

    pad.buttons.forEach((button, index) => {
      const was = buttonsWere[index] ?? false;
      if (button.pressed && !was && GAMEPAD_BUTTONS[index]) onAction?.(GAMEPAD_BUTTONS[index]);
      buttonsWere[index] = button.pressed;
    });
    return true;
  }

  return {
    state,

    /** Reads every input and returns the axes for this frame. */
    sample(dt) {
      const onGamepad = readGamepad(dt);
      if (stick.active) {
        // Dragging down is pulling back, which is nose up — and it honours the
        // same Neus ⇅ preference as tilt, so there is one setting, not two.
        state.pitch = (tilt.invert ? -1 : 1) * expo(stick.y);
        state.roll = expo(stick.x);
        state.yaw = axis(KEY_AXES.yawLeft, KEY_AXES.yawRight);
        return state;
      }
      // Only hand over once readings are actually arriving. A tilt that is
      // "on" but silent would otherwise swallow the keyboard as well.
      if (tilt.on && tilt.via && !onGamepad) {
        state.pitch = tilt.pitch;
        state.roll = tilt.roll;
        state.yaw = axis(KEY_AXES.yawLeft, KEY_AXES.yawRight);
        const lever = axis(KEY_AXES.throttleDown, KEY_AXES.throttleUp);
        if (lever) state.throttle = clamp(state.throttle + lever * 0.5 * dt, 0, 1);
        return state;
      }
      if (!onGamepad) {
        if (state.yoke) {
          state.pitch = -state.mouse.y;
          state.roll = state.mouse.x;
          state.yaw = axis(KEY_AXES.yawLeft, KEY_AXES.yawRight);
        } else {
          state.pitch = axis(KEY_AXES.pitchDown, KEY_AXES.pitchUp);
          state.roll = axis(KEY_AXES.rollLeft, KEY_AXES.rollRight);
          state.yaw = axis(KEY_AXES.yawLeft, KEY_AXES.yawRight);
        }
        const lever = axis(KEY_AXES.throttleDown, KEY_AXES.throttleUp);
        if (lever) state.throttle = clamp(state.throttle + lever * 0.5 * dt, 0, 1);
        state.lever = lever;
      }
      const trimming = axis(KEY_AXES.trimDown, KEY_AXES.trimUp);
      if (trimming) state.trim = clamp(state.trim + trimming * 0.12 * dt, -1, 1);
      return state;
    },

    attachStick,
    get stick() {
      return stick.active ? { x: stick.x, y: stick.y, ox: stick.ox, oy: stick.oy } : null;
    },
    enableTilt,
    disableTilt,
    get tilting() {
      return tilt.on;
    },
    get tiltLive() {
      return tilt.on && tilt.events > 0;
    },
    get tiltStatus() {
      return tilt.status;
    },
    get tiltDiagnosis() {
      return diagnosis();
    },
    get pitchInverted() {
      return tilt.invert;
    },
    /** Flips which way to tip the phone for nose up. */
    toggleInvertPitch() {
      tilt.invert = !tilt.invert;
      tilt.ref = null; // the reference was taken in the old sense
      tilt.pitch = 0;
      try {
        localStorage.setItem('fly.invertPitch', tilt.invert ? '1' : '0');
      } catch {
        // A browser that will not remember it is not a reason to refuse.
      }
      onNotice?.(tilt.invert ? 'Nose inverted' : 'Nose normal');
      return tilt.invert;
    },

    /** Takes the phone's current attitude as neutral. */
    centreTilt() {
      tilt.ref = tilt.raw ? { ...tilt.raw } : null;
      tilt.pitch = 0;
      tilt.roll = 0;
      onNotice?.('Centred');
    },
    setThrottle(value) {
      state.throttle = clamp(value, 0, 1);
    },
    nudgeThrottle(delta) {
      state.throttle = clamp(state.throttle + delta, 0, 1);
    },
    setTrim(value) {
      state.trim = clamp(value, -1, 1);
    },
    isHeld: (code) => keys.has(code),
    releaseYoke,
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
    },
  };
}

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// Stamped in at build time by vite.config.js.
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
