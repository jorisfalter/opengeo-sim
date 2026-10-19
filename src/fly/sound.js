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
const CORE = 42; // Hz at idle; the fundamental of the low-pressure spool

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

export function createSound({ onNotice } = {}) {
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
    coreFilter.frequency.value = 320;
    coreFilter.Q.value = 0.8;
    coreFilter.connect(coreGain).connect(master);
    const oscillators = [1, 2, 3.02].map((ratio) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = CORE * ratio;
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
    whine.frequency.value = 1200;
    whine.Q.value = 9;
    noiseSource(ctx, buffer).connect(whine).connect(whineGain).connect(master);

    // Airflow over the airframe: broad noise, brighter the faster you go.
    const airGain = ctx.createGain();
    airGain.gain.value = 0;
    const air = ctx.createBiquadFilter();
    air.type = 'bandpass';
    air.frequency.value = 700;
    air.Q.value = 0.6;
    noiseSource(ctx, buffer).connect(air).connect(airGain).connect(master);

    // Wheels: low rumble, only while something is touching the ground.
    const rollGain = ctx.createGain();
    rollGain.gain.value = 0;
    const roll = ctx.createBiquadFilter();
    roll.type = 'lowpass';
    roll.frequency.value = 150;
    noiseSource(ctx, buffer).connect(roll).connect(rollGain).connect(master);

    // Stall warning: the one sound that is meant to be unpleasant.
    const hornGain = ctx.createGain();
    hornGain.gain.value = 0;
    const horn = ctx.createOscillator();
    horn.type = 'square';
    horn.frequency.value = 760;
    horn.connect(hornGain).connect(master);
    horn.start();

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
      onNotice?.('Sound on');
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
        ramp(osc.frequency, CORE * ratio * (0.8 + spool * 1.5), 0.25);
      }
      ramp(parts.coreGain.gain, 0.22 + spool * 0.55, 0.2);
      ramp(parts.coreFilter.frequency, 240 + spool * 520, 0.2);

      ramp(parts.whine.frequency, 900 + spool * 2600, 0.25);
      ramp(parts.whineGain.gain, 0.04 + spool * 0.30, 0.2);

      // Airflow: roughly the square of the speed, thinner in thin air.
      const q = (kias / 250) ** 2;
      const thin = Math.max(0.35, 1 - altFt / 45000);
      ramp(parts.airGain.gain, Math.min(0.55, q * 0.55) * thin, 0.15);
      ramp(parts.air.frequency, 420 + Math.min(1, kias / 300) * 1500, 0.15);

      const rolling = aircraft.onGround ? Math.min(1, kias / 90) : 0;
      ramp(parts.rollGain.gain, rolling * 0.35, 0.1);

      ramp(parts.hornGain.gain, aircraft.stall ? 0.10 : 0, 0.05);
    },
  };
}
