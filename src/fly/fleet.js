// Two aeroplanes, and everything that differs between them.
//
// The simulator had one aircraft and said so in about thirty places: the
// rotate speed in a notice, the reference speeds on the glass, VMO and MMO
// inside the overspeed protection, the stick gains in the inner loop, how far
// behind the chase camera sits, how long a runway the dice will roll. None of
// that was wrong — it was simply all written down as literals, which is the
// right way to write the first aeroplane and the wrong way to write the
// second.
//
// So this file is the fleet, and the rule is that no number which would change
// if you swapped the aeroplane may live anywhere else. The payoff is visible
// in the diff that introduced it: adding an A380 touched the flight model, the
// mesh and this table, and almost nothing else.
//
// What is NOT in here is aerodynamics. That lives in public/fdm, in JSBSim's
// own XML, where it belongs; these are the numbers the *viewer* needs to know
// about the aeroplane JSBSim is flying — what to put on the glass, what the
// protections should protect, how hard the keyboard is allowed to pull.

const FT = 0.3048;

export const FLEET = {
  pc24: {
    id: 'pc24',
    name: 'PC-24',
    label: 'PC-24',
    note: 'Light twinjet · 8 t · happy on 1,000 m',
    // What JSBSim needs: the model name and the files to put in front of it.
    model: 'pc24',
    files: ['aircraft/pc24/pc24.xml', 'engine/fj44.xml', 'engine/direct.xml'],
    engines: 2,
    // Where the centre of gravity rests when the aeroplane is parked, which is
    // what `ic/h-agl-ft` is measured to. Getting this wrong by a metre puts
    // the wheels inside the runway and the gear springs answer with millions
    // of pounds; see settle() in jsbsim.js.
    parkedCg: 1.6,
    // The envelope the assisted law protects. Measured on the airframe: the
    // wing breaks at 15.4 degrees clean and 14.0 with gear and flap.
    vmo: 290,
    mmo: 0.74,
    guardAlpha: 12,
    stallAlpha: 14,
    gUp: 2.4,
    gDown: -0.5,
    // What the stick may ask for, and how fast.
    pitchRate: 7,
    rollRate: 45,
    trimRate: 10,
    pitchRange: [-15, 20],
    bankLimit: 67,
    // The inner loop that holds the commanded attitude.
    gains: { pitch: 2.6, pitchRate: 0.9, roll: 1.6, rollRate: 0.5, trim: 0.9 },
    // Where the elevator stops being an attitude loop and becomes a stick,
    // because the gear is holding the attitude instead of the air: rotate
    // speed, and the band either side of it over which the loop fades in.
    rotateKias: 95,
    rotateFade: 20,
    // The autopilot keeps a margin under the airframe's own limits, and will
    // not fly slower than this in each flap setting.
    apVmo: 282,
    apMmo: 0.72,
    apFloor: [140, 110, 110],
    apBank: 35,
    // How high over the threshold the autopilot starts the flare.
    flareAgl: 9,
    // Reference speeds by flap notch, for the tape, and what each notch is
    // called on the glass.
    vref: [150, 125, 110],
    flapDeg: [0, 15, 33],
    flapNames: ['0', '1', '2'],
    // The shortest runway the start menu's dice will offer. A PC-24 lands on
    // gravel and grass in real life, but a random unsurveyed 400 m strip is a
    // bad first impression.
    minRunwayFt: 3280,
    // The camera that rides behind it, and the pilot's eye in the cockpit
    // view, both in the aeroplane's own frame: metres forward and up from the
    // centre of gravity.
    chase: { back: 62, up: 11, ahead: 260, follow: 2.8 },
    eye: { forward: 0, up: 1.1 },
    shape: 'pc24',
    // What it sounds like. The numbers are the engine's, not a mixing desk's:
    // see the note at the top of sound.js.
    voice: {
      core: 42,
      coreLow: 320,
      coreGain: [0.22, 0.55],
      whine: [900, 2600],
      whineQ: 9,
      whineGain: [0.04, 0.30],
      air: [420, 1500],
      airGain: 0.55,
      roll: 150,
      beat: 0,
    },
    title: 'PC-24 · free flight',
  },

  a380: {
    id: 'a380',
    name: 'A380',
    label: 'A380',
    note: 'Widebody · 450 t · wants 3,000 m',
    model: 'a380',
    files: ['aircraft/a380/a380.xml', 'engine/trent900.xml', 'engine/direct.xml'],
    engines: 4,
    // 5.8 m, measured by letting the model settle on its own gear and
    // reading `agl` back: see the note on the legs in a380.xml. Half a metre
    // out here is an aeroplane whose engines are underground.
    parkedCg: 5.8,
    vmo: 340,
    mmo: 0.89,
    // Measured in scripts/test-fdm.mjs: the wing breaks at 15.3 degrees clean
    // and 15.5 in the landing configuration, so the guard sits at 12.
    guardAlpha: 12,
    stallAlpha: 14,
    gUp: 2.3,
    gDown: -0.4,
    // Half the PC-24's pitch rate and a third of its roll rate, and that is
    // the aeroplane, not a limiter: 36 million slug-feet-squared of pitch
    // inertia and a 260-foot span do not answer any faster. Asking a widebody
    // for 45 degrees a second of roll gets you full aileron and 12 degrees a
    // second, which feels exactly like a broken simulator.
    pitchRate: 3.5,
    rollRate: 14,
    trimRate: 5,
    pitchRange: [-12, 18],
    bankLimit: 35,
    // Lower proportional gain, higher rate damping. Eleven times less pitch
    // acceleration per degree of elevator than the PC-24 means a loop tuned
    // for the light jet saturates the surface and then overshoots on the way
    // back; the rate term is what stops that.
    gains: { pitch: 1.5, pitchRate: 1.8, roll: 0.9, rollRate: 0.9, trim: 0.5 },
    rotateKias: 150,
    rotateFade: 30,
    apVmo: 330,
    apMmo: 0.86,
    apFloor: [200, 180, 166, 155, 146],
    apBank: 25,
    // Twice the PC-24's: the main wheels are seven metres below the pilot and
    // the aeroplane takes four seconds to change its mind about anything.
    flareAgl: 18,
    // Five positions, not three, because the real lever has five: 0, 1, 2, 3
    // and FULL. Two notches is enough aeroplane for a light jet, where the
    // choice is take-off or landing; a widebody is configured in stages down
    // the approach and collapsing that into one step throws away the thing
    // that makes flying one feel like flying one.
    //
    // The angles are nine degrees apart because JSBSim's kinematic component
    // commands a fraction of the last detent rather than a detent index: the
    // lever sends notch/4, and 4 x 9 = 36 makes the two agree exactly. The
    // detents themselves only set how fast it travels between them, 22
    // seconds end to end.
    //
    // Reference speeds are 1.3 x the one-g stall at each setting, worked out
    // from the lift curve in a380.xml: CLmax runs 1.26, 1.57, 1.87, 2.18,
    // 2.48 and the stall 160, 144, 131, 122, 114 knots at 450 tonnes.
    vref: [208, 187, 171, 158, 148],
    flapDeg: [0, 9, 18, 27, 36],
    flapNames: ['0', '1', '2', '3', 'FULL'],
    // 2,990 m. The measured take-off distance to screen height at 450 tonnes
    // is 2,756 m and the landing roll 862 m, so this is the take-off that
    // sets the figure, with a couple of hundred metres in hand. Anything
    // shorter and the dice would be rolling for a crash.
    minRunwayFt: 9800,
    // Further back, higher, and looking further ahead, because the aeroplane
    // is four times as long and the camera has to contain it.
    chase: { back: 180, up: 42, ahead: 600, follow: 2.2 },
    // The flight deck is 28 m ahead of the centre of gravity and 1.2 m above
    // it, which is 7.0 m over the runway. On a widebody that fore-and-aft
    // offset is not a detail: it is why the nose wheel goes somewhere other
    // than where you are looking, and why the runway seems to arrive from
    // underneath on the flare.
    eye: { forward: 28, up: 1.2 },
    shape: 'a380',
    // A Trent 900 does not sound like a small FJ44 played louder. Its fan is
    // 2.95 m across and turns at about 2,700 rpm against the FJ44's 16,000,
    // so every tone in the engine lands an octave and a half lower: the
    // fundamental is a rumble you feel more than hear, and the blade-passing
    // whine sits near 1 kHz instead of 5. The beat is the giveaway that there
    // are four of them — no two spools run at exactly the same speed, so the
    // sum of them throbs slowly, which is the sound of a widebody taxiing
    // past and of nothing else.
    voice: {
      core: 24,
      coreLow: 180,
      coreGain: [0.30, 0.62],
      whine: [420, 1100],
      whineQ: 5,
      whineGain: [0.05, 0.22],
      air: [300, 1100],
      airGain: 0.62,
      roll: 90,
      beat: 0.6,
    },
    title: 'A380 · free flight',
  },
};

export const DEFAULT_TYPE = 'pc24';

/** The aeroplane a URL or a menu asked for, or the PC-24 if it asked for nonsense. */
export function typeFor(id) {
  const key = String(id ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return FLEET[key] ?? FLEET[DEFAULT_TYPE];
}

/** Reference speed for the flap setting the aeroplane is actually in. */
export const vrefFor = (type, flaps) => type.vref[Math.min(type.vref.length - 1, flaps | 0)];

/** The autopilot's slowest allowed speed in this configuration. */
export const floorFor = (type, flaps, gear) =>
  type.apFloor[Math.min(type.apFloor.length - 1, flaps | 0)] * (gear ? 1 : 1.05);

/** Where the cockpit eye sits, in metres above the ground, parked. */
export const eyeHeight = (type) => type.parkedCg + type.eye.up;

export const feetOf = (metres) => metres / FT;
