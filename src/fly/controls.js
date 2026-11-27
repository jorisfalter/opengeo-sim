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

// Looking out of the window. Holding shift turns the four arrows from a stick
// into a head: a runway you are not pointing at is one you cannot see, and in
// a cockpit view the only way to find it is to turn and look.
//
// Two ways, and they are different on purpose. Shift and the arrows, or a drag
// with the right mouse button, are *held*: a glance. You look, you let go, you
// are facing forward again, and a glance cannot be forgotten.
//
// The two LOOK buttons are *steps*: each click turns the head another forty-five
// degrees and leaves it there, and a click the other way brings it back. Holding
// a button down to keep ninety degrees of right is not a thing hands do while
// also flying, and it was the first thing anyone tried. What makes it safe is
// that the glass says so — LOOK 90° R beside the attitude, which is dimmed to a
// tenth while the head is turned — so a head you left over your shoulder is
// announced rather than quietly in effect. A glance still springs back, now to
// wherever the head is parked rather than always to the front.
const LOOK_KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
};
const LOOK_RATE = (140 * Math.PI) / 180; // degrees a second on the keys
const LOOK_YAW_MAX = (140 * Math.PI) / 180; // over your shoulder, not past it
const LOOK_STEP = (45 * Math.PI) / 180; // one click of a LOOK button
const LOOK_PARK_MAX = (135 * Math.PI) / 180; // three clicks, and no further
const LOOK_PITCH_MAX = (70 * Math.PI) / 180;
const LOOK_RETURN = 11; // how fast the head comes back, per second
const MOUSE_LOOK = 0.0032; // radians a pixel on a right-button drag

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
    // Where the head is pointing, relative to straight ahead, in radians.
    // `park` is where it returns to: zero unless the LOOK buttons put it
    // somewhere and left it there.
    look: { yaw: 0, pitch: 0, park: 0 },
  };
  let mouseLooking = false;

  const held = (names) => names.some((code) => keys.has(code));
  const axis = (minus, plus) => (held(minus) ? -1 : 0) + (held(plus) ? 1 : 0);

  // A key that is down is remembered until its keyup arrives, and on macOS
  // that keyup does not always arrive: hold shift for Cmd+Shift+4 and the
  // screenshot overlay swallows it, so the page still believes shift is down
  // minutes later. With shift meaning "the arrows are a head, not a stick",
  // that was an aeroplane which silently stopped answering the controls —
  // in assisted law it then holds the attitude it had, wings down and nose
  // on the horizon, for as long as you like.
  //
  // Every keyboard and mouse event carries the true state of the four
  // modifiers, so they are read from the event rather than remembered, and
  // the next key you press puts a stuck one right.
  const MODIFIERS = [
    ['ShiftLeft', 'ShiftRight', 'shiftKey'],
    ['ControlLeft', 'ControlRight', 'ctrlKey'],
    ['AltLeft', 'AltRight', 'altKey'],
    ['MetaLeft', 'MetaRight', 'metaKey'],
  ];
  const syncModifiers = (event) => {
    for (const [left, right, flag] of MODIFIERS) {
      if (event[flag]) continue;
      keys.delete(left);
      keys.delete(right);
    }
  };

  // ---- mouse as a yoke ----------------------------------------------------
  const onMouseMove = (event) => {
    syncModifiers(event);
    // The right button is the head, whether or not the yoke has the pointer:
    // drag with it and you look around, let go and you are facing forward
    // again. It is the one gesture that is free — the left button is already
    // the stick, and under pointer lock there is nothing else left.
    if (event.buttons & 2) {
      mouseLooking = true;
      state.look.yaw = clamp(
        state.look.yaw + event.movementX * MOUSE_LOOK,
        -LOOK_YAW_MAX,
        LOOK_YAW_MAX,
      );
      state.look.pitch = clamp(
        state.look.pitch - event.movementY * MOUSE_LOOK,
        -LOOK_PITCH_MAX,
        LOOK_PITCH_MAX,
      );
      return;
    }
    mouseLooking = false;
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
  // Without this the right-button drag opens the browser's own menu over the
  // windscreen on the way past.
  element.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('mouseup', (event) => {
    if (event.button === 2) mouseLooking = false;
  });
  window.addEventListener('mousemove', onMouseMove);

  // ---- keyboard -----------------------------------------------------------
  //
  // A focused text field owns the keyboard, and until this it did not.
  //
  // Every control here is a letter, and the axes are held keys that have to
  // swallow their own keypresses — a W that scrolls the page is not a
  // throttle. Those two facts together meant that typing a destination into
  // the search field dropped the E, the D and the S into the controls and
  // sent the L to the start menu: "Düsseldorf" arrived as "üorf" with the
  // aeroplane rolling right. Worse in the coordinate fields, where Minus and
  // Period are the trim and the rudder, so a negative longitude could not be
  // typed at all.
  //
  // So an input, a textarea, a select or anything contenteditable takes the
  // lot while it has the focus, and a focused button keeps its own space bar
  // and return — otherwise clicking Gear and then pressing space pauses the
  // simulation instead of pressing the button again.
  const TEXT_FIELD = /^(?:input|textarea|select)$/i;
  const owns = (node, code) => {
    if (!(node instanceof HTMLElement)) return false;
    if (node.isContentEditable || TEXT_FIELD.test(node.tagName)) return true;
    return node.tagName === 'BUTTON' && (code === 'Space' || code === 'Enter');
  };
  const onKeyDown = (event) => {
    syncModifiers(event);
    if (owns(event.target, event.code)) return;
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
  const onKeyUp = (event) => {
    syncModifiers(event);
    keys.delete(event.code);
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());
  // Switching tabs or spaces does not always blur the window, and whatever
  // was held at that moment is held forever otherwise.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) keys.clear();
  });

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

  // Shift *and* an arrow is a glance out of the window. Shift on its own is
  // nothing at all — deliberately, because a modifier that takes the stick
  // away on its own is one key away from an aeroplane that does not answer.
  const shiftDown = () => keys.has('ShiftLeft') || keys.has('ShiftRight');
  const looking = () =>
    shiftDown() &&
    Boolean(axis(LOOK_KEYS.left, LOOK_KEYS.right) || axis(LOOK_KEYS.down, LOOK_KEYS.up));

  /**
   * Moves the head, or lets it come back — to where it is parked, which is
   * straight ahead unless a LOOK button put it over your shoulder.
   */
  function headLook(dt) {
    const shift = looking();
    const x = shift ? axis(LOOK_KEYS.left, LOOK_KEYS.right) : 0;
    const y = shift ? axis(LOOK_KEYS.down, LOOK_KEYS.up) : 0;
    if (x || y) {
      state.look.yaw = clamp(state.look.yaw + x * LOOK_RATE * dt, -LOOK_YAW_MAX, LOOK_YAW_MAX);
      state.look.pitch = clamp(
        state.look.pitch + y * LOOK_RATE * dt,
        -LOOK_PITCH_MAX,
        LOOK_PITCH_MAX,
      );
      return;
    }
    if (mouseLooking) return;
    // Back to where the head belongs, quickly but not instantly: a head that
    // snaps is a cut, and a cut is the one thing that loses you the horizon.
    const back = Math.exp(-LOOK_RETURN * dt);
    state.look.yaw = state.look.park + (state.look.yaw - state.look.park) * back;
    state.look.pitch *= back;
    if (Math.abs(state.look.yaw - state.look.park) < 0.002) state.look.yaw = state.look.park;
    if (Math.abs(state.look.pitch) < 0.002) state.look.pitch = 0;
  }

  return {
    state,

    /**
     * One click of a LOOK button: forty-five degrees further that way, and
     * the head stays there. Clicking the other way walks it back, through
     * straight ahead and on round if you keep going.
     */
    stepLook(direction) {
      const wanted = state.look.park + direction * LOOK_STEP;
      // Within a degree of the front, park on the front exactly, so that three
      // clicks left after three clicks right is dead ahead and not a rounding
      // error you can see.
      state.look.park =
        Math.abs(wanted) < LOOK_STEP / 2 ? 0 : clamp(wanted, -LOOK_PARK_MAX, LOOK_PARK_MAX);
      return state.look.park;
    },

    /** Straight ahead again, whatever was asked for. */
    centreLook() {
      state.look.park = 0;
      return 0;
    },

    /** Where the head is parked, in degrees; zero means facing forward. */
    get lookParkDeg() {
      return (state.look.park * 180) / Math.PI;
    },

    /** Where the head is, in degrees: negative left, positive right. */
    get lookDeg() {
      return (state.look.yaw * 180) / Math.PI;
    },

    /** Reads every input and returns the axes for this frame. */
    sample(dt) {
      headLook(dt);
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
          // Shift has taken the arrows for the head this frame, so they are
          // not also the stick: a glance to the left must not roll you into
          // the turn it was meant to avoid.
          state.pitch = looking() ? 0 : axis(KEY_AXES.pitchDown, KEY_AXES.pitchUp);
          state.roll = looking() ? 0 : axis(KEY_AXES.rollLeft, KEY_AXES.rollRight);
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
