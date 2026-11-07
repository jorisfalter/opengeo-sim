// Engine and airflow, synthesised rather than sampled.
//
// There is no audio file here for the same reason there is no downloaded
// aircraft model: a jet is a low core rumble, a turbine whine an octave and a
// half above it, and a hiss of air that rises with the square of the speed.
// All three are a handful of oscillators and some filtered noise, and nothing
// has to be licensed, shipped or cached.
//
// A browser will not make a sound until somebody has tapped something, so this
// is built on the first tap and not before.
//
// Which engine it is comes from `voice` in src/fly/fleet.js, and those numbers
// are the engine's rather than a mixing desk's. A turbofan's tones are set by
// how fast its fan turns and how many blades it has. An FJ44's fan is 1.28 m
// across and spins at about 16,000 rpm; a Trent 900's is 2.95 m and turns at
// 2,700. Everything follows from that ratio: the low spool's fundamental
// drops from 42 Hz to 24, and the blade-passing whine from five kilohertz to
// about one — which is why a business jet sounds like a hairdryer and a
// widebody sounds like weather.
//
// `beat` is the only term that is not one engine's property but the fleet's.
// Four spools never run at exactly the same speed, so what you hear is the
// sum of four nearly-equal tones, and that sum throbs. It is the sound of a
// widebody taxiing past and of almost nothing else, and it costs one
// oscillator at 0.6 Hz wired into the core's gain.
const DEFAULT_VOICE = {
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
};

function noiseBuffer(ctx, seconds = 2) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

const noiseSource = (ctx, buffer) => {
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.loop = true;
  node.start();
  return node;
};

/** iPhones and iPads mute Web Audio with the hardware switch, silently. */
const isApple = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function createSound({ onNotice, voice } = {}) {
  const V = { ...DEFAULT_VOICE, ...(voice ?? {}) };
  let ctx = null;
  let parts = null;
  let on = false;

  function build() {
    ctx = new (window.AudioContext ?? window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = 0.0;
    // Everything got louder, so a limiter sits between it and the speaker.
    const guard = ctx.createDynamicsCompressor();
    guard.threshold.value = -10;
    guard.knee.value = 6;
    guard.ratio.value = 8;
    guard.attack.value = 0.005;
    guard.release.value = 0.2;
    master.connect(guard).connect(ctx.destination);

    const buffer = noiseBuffer(ctx);

    // Core: three sawtooths an octave apart through a low-pass, which is what
    // makes it a turbine rather than a buzzer.
    const coreGain = ctx.createGain();
    coreGain.gain.value = 0;
    const coreFilter = ctx.createBiquadFilter();
    coreFilter.type = 'lowpass';
    coreFilter.frequency.value = V.coreLow;
    coreFilter.Q.value = 0.8;
    coreFilter.connect(coreGain).connect(master);
    const oscillators = [1, 2, 3.02].map((ratio) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = V.core * ratio;
      const gain = ctx.createGain();
      gain.gain.value = [0.6, 0.3, 0.14][[1, 2, 3.02].indexOf(ratio)];
      osc.connect(gain).connect(coreFilter);
      osc.start();
      return { osc, ratio };
    });

    // Turbine whine: narrow band noise that climbs with the throttle.
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    const whine = ctx.createBiquadFilter();
    whine.type = 'bandpass';
    whine.frequency.value = V.whine[0] + V.whine[1] * 0.1;
    whine.Q.value = V.whineQ;
    noiseSource(ctx, buffer).connect(whine).connect(whineGain).connect(master);

    // Airflow over the airframe: broad noise, brighter the faster you go.
    const airGain = ctx.createGain();
    airGain.gain.value = 0;
    const air = ctx.createBiquadFilter();
    air.type = 'bandpass';
    air.frequency.value = V.air[0];
    air.Q.value = 0.6;
    noiseSource(ctx, buffer).connect(air).connect(airGain).connect(master);

    // Wheels: low rumble, only while something is touching the ground.
    const rollGain = ctx.createGain();
    rollGain.gain.value = 0;
    const roll = ctx.createBiquadFilter();
    roll.type = 'lowpass';
    roll.frequency.value = V.roll;
    noiseSource(ctx, buffer).connect(roll).connect(rollGain).connect(master);

    // Stall warning: the one sound that is meant to be unpleasant.
    const hornGain = ctx.createGain();
    hornGain.gain.value = 0;
    const horn = ctx.createOscillator();
    horn.type = 'square';
    horn.frequency.value = 760;
    horn.connect(hornGain).connect(master);
    horn.start();

    // The throb of engines that are not quite in step. It is wired into the
    // core's gain as an audio-rate input, so it adds to whatever `update`
    // sets there rather than fighting it.
    if (V.beat > 0) {
      const beat = ctx.createOscillator();
      beat.type = 'sine';
      beat.frequency.value = V.beat;
      const depth = ctx.createGain();
      depth.gain.value = 0.11;
      beat.connect(depth).connect(coreGain.gain);
      beat.start();
    }

    parts = { master, coreGain, coreFilter, oscillators, whine, whineGain, air, airGain, roll, rollGain, hornGain };
  }

  const ramp = (param, value, time = 0.08) =>
    param.setTargetAtTime(value, ctx.currentTime, time);

  /**
   * A short rising note when the sound is switched on. It is not decoration:
   * "I hear nothing" and "the engine mix is too quiet" look the same from
   * here, and a deliberate blip separates them in one tap.
   */
  function chirp() {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  }

  return {
    get enabled() {
      return on;
    },

    /**
     * What the browser thinks of our audio, in its own words: "suspended"
     * means it is refusing to play, "running" means the sound is leaving the
     * graph and anything still silent is the device's own doing.
     */
    get state() {
      return ctx ? ctx.state : 'none';
    },

    /** Must be called from a real tap, or the browser will refuse. */
    async toggle() {
      if (on) {
        on = false;
        if (parts) ramp(parts.master.gain, 0, 0.1);
        await ctx?.suspend();
        onNotice?.('Sound off');
        return false;
      }
      if (!ctx) build();
      await ctx.resume();
      on = true;
      ramp(parts.master.gain, 1.0, 0.25);
      chirp();
      // Three things can still leave you in silence after this point, and the
      // only honest thing to do is name them. A context that will not run is
      // the browser refusing; an iPhone with its ringer switch flicked across
      // mutes Web Audio entirely and tells nobody; and the chirp is there so
      // that "I hear the beep but not the engine" is a different report from
      // "I hear nothing at all".
      if (ctx.state !== 'running') {
        onNotice?.('The browser is still blocking sound — tap once more');
      } else if (isApple()) {
        onNotice?.('Sound on — silent? check the ringer switch');
      } else {
        onNotice?.('Sound on');
      }
      return true;
    },

    /** An analyser on the master bus, so a test can prove sound comes out. */
    probe() {
      if (!ctx || !parts) return null;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      parts.master.connect(analyser);
      return {
        level() {
          const data = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (const sample of data) sum += sample * sample;
          return Math.sqrt(sum / data.length);
        },
      };
    },

    /** Called every frame; everything follows the aeroplane's own state. */
    update(aircraft) {
      if (!on || !parts) return;
      const throttle = aircraft.throttle ?? 0;
      const kias = aircraft.kias ?? 0;
      const altFt = (aircraft.alt ?? 0) / 0.3048;

      // Spool speed follows the lever but lags it, the way a turbine does.
      const spool = 0.22 + throttle * 0.78;
      for (const { osc, ratio } of parts.oscillators) {
        ramp(osc.frequency, V.core * ratio * (0.8 + spool * 1.5), 0.25);
      }
      ramp(parts.coreGain.gain, V.coreGain[0] + spool * V.coreGain[1], 0.2);
      ramp(parts.coreFilter.frequency, V.coreLow * 0.75 + spool * V.coreLow * 1.63, 0.2);

      ramp(parts.whine.frequency, V.whine[0] + spool * V.whine[1], 0.25);
      ramp(parts.whineGain.gain, V.whineGain[0] + spool * V.whineGain[1], 0.2);

      // Airflow: roughly the square of the speed, thinner in thin air.
      const q = (kias / 250) ** 2;
      const thin = Math.max(0.35, 1 - altFt / 45000);
      ramp(parts.airGain.gain, Math.min(V.airGain, q * V.airGain) * thin, 0.15);
      ramp(parts.air.frequency, V.air[0] + Math.min(1, kias / 300) * V.air[1], 0.15);

      const rolling = aircraft.onGround ? Math.min(1, kias / 90) : 0;
      ramp(parts.rollGain.gain, rolling * 0.35, 0.1);

      ramp(parts.hornGain.gain, aircraft.stall ? 0.10 : 0, 0.05);
    },
  };
}
