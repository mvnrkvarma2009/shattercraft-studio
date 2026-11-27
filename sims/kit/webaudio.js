// Zero-dependency procedural Web Audio synthesizer for Shattercraft -live pages.
// Default muted; lazily creates and unlocks AudioContext on the SOUND toggle click.
// Supports authentic 90° cross-plane V8 pulses + slow-motion rocker/cam ticks,
// GTF-1200 dual-spool geared turbofan (18-blade fan BPF + 3:1 planetary whine + quadratic jet roar),
// and Strandbeest desert wind + PVC footfalls.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const V8_ORDER = [1, 8, 4, 3, 6, 5, 7, 2];

/**
 * Creates a procedural WebAudio engine for live simulators.
 * @param {object} [opts]
 */
export function createAudioEngine(opts = {}) {
  let defaultKind = opts.kind || 'v8';
  let volume = opts.volume ?? 0.35;
  let enabled = false;
  let ctx = null;
  let master = null;
  let analyser = null;
  let freqData = null;
  let timeData = null;
  let noiseBuf = null;
  let nodes = null;

  // Edge detectors & live pulse tracking
  let prevFiring = null;
  let prevV8Slot = null;
  let prevCamSlot = null;
  let prevPhaseBucket = null;
  let prevFootfalls = null;
  let prevRpm = null;
  let lastRpmNorm = 0.09;
  let lastBoost = 0;
  let pulseEnv = 0;
  let pulseTime = 0;
  let pulseSmooth = 0.15;

  const makeDriveCurve = (amount = 2.2) => {
    const n = 256;
    const curve = new Float32Array(n);
    const norm = Math.tanh(amount) || 1;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = Math.tanh(amount * x) / norm;
    }
    return curve;
  };

  const buildNoiseBuffer = (ac) => {
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    }
    return buf;
  };

  const ensureContext = () => {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.55;
      freqData = new Uint8Array(analyser.frequencyBinCount);
      timeData = new Uint8Array(analyser.fftSize);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      // Master safety limiter before destination so 7,000 RPM + Boost never clips digitally
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 2;
      limiter.ratio.value = 16;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.08;
      master.connect(analyser);
      master.connect(comp);
      comp.connect(limiter);
      limiter.connect(ctx.destination);
      noiseBuf = buildNoiseBuffer(ctx);
      return true;
    } catch (_) {
      ctx = null;
      return false;
    }
  };

  const initGraph = (kind) => {
    if (!ctx || nodes?.kind === kind) return;
    if (nodes) {
      try {
        nodes.cleanup();
      } catch (_) {}
      nodes = null;
    }

    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(master);

    if (kind === 'v8') {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 190;
      filter.Q.value = 2.6;

      // Soft header saturation + tuned cross-plane exhaust body resonance
      const shaper = ctx.createWaveShaper();
      shaper.curve = makeDriveCurve(2.1);
      shaper.oversample = '2x';

      const exhaustRes = ctx.createBiquadFilter();
      exhaustRes.type = 'peaking';
      exhaustRes.frequency.value = 128;
      exhaustRes.Q.value = 1.9;
      exhaustRes.gain.value = 5.5;

      const postLp = ctx.createBiquadFilter();
      postLp.type = 'lowpass';
      postLp.frequency.value = 920;
      postLp.Q.value = 0.85;

      const oscHalf = ctx.createOscillator();
      oscHalf.type = 'sawtooth';
      oscHalf.frequency.value = 14;

      const oscA = ctx.createOscillator();
      oscA.type = 'sawtooth';
      oscA.frequency.value = 28;

      const oscB = ctx.createOscillator();
      oscB.type = 'triangle';
      oscB.frequency.value = 42;

      const oscC = ctx.createOscillator();
      oscC.type = 'sawtooth';
      oscC.frequency.value = 56.4;

      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = 20;

      const gHalf = ctx.createGain();
      gHalf.gain.value = 0.2;
      const gA = ctx.createGain();
      gA.gain.value = 0.24;
      const gB = ctx.createGain();
      gB.gain.value = 0.22;
      const gSub = ctx.createGain();
      gSub.gain.value = 0.36;
      const gC = ctx.createGain();
      gC.gain.value = 0.14;

      const hiss = ctx.createBufferSource();
      hiss.buffer = noiseBuf;
      hiss.loop = true;
      const hissBp = ctx.createBiquadFilter();
      hissBp.type = 'bandpass';
      hissBp.frequency.value = 1100;
      hissBp.Q.value = 1.1;
      const hissGain = ctx.createGain();
      hissGain.gain.value = 0.03;

      oscHalf.connect(gHalf).connect(filter);
      oscA.connect(gA).connect(filter);
      oscB.connect(gB).connect(filter);
      oscC.connect(gC).connect(filter);
      sub.connect(gSub).connect(filter);
      filter.connect(shaper).connect(exhaustRes).connect(postLp).connect(out);
      hiss.connect(hissBp).connect(hissGain).connect(out);

      oscHalf.start(now);
      oscA.start(now);
      oscB.start(now);
      oscC.start(now);
      sub.start(now);
      hiss.start(now);

      nodes = {
        kind,
        oscHalf,
        oscA,
        oscB,
        oscC,
        sub,
        filter,
        exhaustRes,
        postLp,
        hissBp,
        hissGain,
        out,
        cleanup() {
          oscHalf.stop();
          oscA.stop();
          oscB.stop();
          oscC.stop();
          sub.stop();
          hiss.stop();
          out.disconnect();
        },
      };
    } else if (kind === 'turbofan') {
      // 18-blade fan blade-pass tone (fundamental + 2nd harmonic)
      const fanOsc = ctx.createOscillator();
      fanOsc.type = 'triangle';
      fanOsc.frequency.value = 280;
      const fanOsc2 = ctx.createOscillator();
      fanOsc2.type = 'sine';
      fanOsc2.frequency.value = 560;
      const fanFilter = ctx.createBiquadFilter();
      fanFilter.type = 'lowpass';
      fanFilter.frequency.value = 1200;
      fanFilter.Q.value = 1.4;
      const fanGain = ctx.createGain();
      fanGain.gain.value = 0.12;
      const fanG2 = ctx.createGain();
      fanG2.gain.value = 0.35;

      // 3.06:1 star planetary gearbox mesh whine
      const gearOsc = ctx.createOscillator();
      gearOsc.type = 'sine';
      gearOsc.frequency.value = 1250;
      const gearBp = ctx.createBiquadFilter();
      gearBp.type = 'bandpass';
      gearBp.frequency.value = 1450;
      gearBp.Q.value = 3.2;
      const gearGain = ctx.createGain();
      gearGain.gain.value = 0.05;

      // Quadratic jet exhaust broadband roar + core bypass rush
      const jetSrc = ctx.createBufferSource();
      jetSrc.buffer = noiseBuf;
      jetSrc.loop = true;
      const jetLp = ctx.createBiquadFilter();
      jetLp.type = 'lowpass';
      jetLp.frequency.value = 320;
      jetLp.Q.value = 0.9;
      const jetGain = ctx.createGain();
      jetGain.gain.value = 0.12;

      const coreSrc = ctx.createBufferSource();
      coreSrc.buffer = noiseBuf;
      coreSrc.loop = true;
      const coreBp = ctx.createBiquadFilter();
      coreBp.type = 'bandpass';
      coreBp.frequency.value = 820;
      coreBp.Q.value = 1.1;
      const coreGain = ctx.createGain();
      coreGain.gain.value = 0.06;

      fanOsc.connect(fanFilter);
      fanOsc2.connect(fanG2).connect(fanFilter);
      fanFilter.connect(fanGain).connect(out);
      gearOsc.connect(gearBp).connect(gearGain).connect(out);
      jetSrc.connect(jetLp).connect(jetGain).connect(out);
      coreSrc.connect(coreBp).connect(coreGain).connect(out);

      fanOsc.start(now);
      fanOsc2.start(now);
      gearOsc.start(now);
      jetSrc.start(now);
      coreSrc.start(now);

      nodes = {
        kind,
        fanOsc,
        fanOsc2,
        fanFilter,
        fanGain,
        gearOsc,
        gearBp,
        gearGain,
        jetLp,
        jetGain,
        coreBp,
        coreGain,
        out,
        cleanup() {
          fanOsc.stop();
          fanOsc2.stop();
          gearOsc.stop();
          jetSrc.stop();
          coreSrc.stop();
          out.disconnect();
        },
      };
    } else {
      const windSrc = ctx.createBufferSource();
      windSrc.buffer = noiseBuf;
      windSrc.loop = true;
      const windBp = ctx.createBiquadFilter();
      windBp.type = 'bandpass';
      windBp.frequency.value = 340;
      windBp.Q.value = 0.9;
      const windGain = ctx.createGain();
      windGain.gain.value = 0;

      const whistleSrc = ctx.createBufferSource();
      whistleSrc.buffer = noiseBuf;
      whistleSrc.loop = true;
      const whistleBp = ctx.createBiquadFilter();
      whistleBp.type = 'bandpass';
      whistleBp.frequency.value = 920;
      whistleBp.Q.value = 3.5;
      const whistleGain = ctx.createGain();
      whistleGain.gain.value = 0;

      windSrc.connect(windBp).connect(windGain).connect(out);
      whistleSrc.connect(whistleBp).connect(whistleGain).connect(out);

      windSrc.start(now);
      whistleSrc.start(now);

      nodes = {
        kind: 'strandbeest',
        windBp,
        windGain,
        whistleBp,
        whistleGain,
        out,
        cleanup() {
          windSrc.stop();
          whistleSrc.stop();
          out.disconnect();
        },
      };
    }
  };

  const bumpPulse = (strength = 0.7) => {
    const t = ctx ? ctx.currentTime : 0;
    const dt = Math.max(0, t - pulseTime);
    const decayed = pulseEnv * Math.exp(-dt * 9.5);
    pulseEnv = clamp(Math.max(decayed, strength), 0, 1);
    pulseTime = t;
  };

  const triggerOverrunPop = (bank, rpmNorm, boost = 0, doubleBurst = false) => {
    if (!enabled || !ctx || ctx.state !== 'running' || !master) return;
    const now = ctx.currentTime;
    const isLeft = bank === 'L';
    const panVal = isLeft ? -0.36 : 0.36;
    let dest = master;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = panVal;
      panner.connect(master);
      dest = panner;
    }

    const strength = clamp(0.52 + rpmNorm * 0.35 + boost * 0.4, 0.35, 1.15);
    const spawnBurst = (offset, amp) => {
      const t0 = now + offset;
      const snap = ctx.createBufferSource();
      snap.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 920 + Math.random() * 1100 + rpmNorm * 620;
      bp.Q.value = 2.4;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.34 * amp, t0);
      sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.036);
      snap.connect(bp).connect(sg).connect(dest);
      snap.start(t0, Math.random() * 1.1, 0.044);

      const thump = ctx.createOscillator();
      thump.type = 'triangle';
      thump.frequency.setValueAtTime(155 + Math.random() * 45, t0);
      thump.frequency.exponentialRampToValueAtTime(46, t0 + 0.048);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.26 * amp, t0);
      tg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.054);
      thump.connect(tg).connect(dest);
      thump.start(t0);
      thump.stop(t0 + 0.058);
    };

    spawnBurst(0, strength);
    if (doubleBurst) {
      spawnBurst(0.024 + Math.random() * 0.018, strength * 0.72);
    }
    bumpPulse(clamp(0.72 + 0.28 * strength, 0, 1));
  };

  const triggerV8BankPulse = (bank, rpmNorm, strength = 0.7, boost = 0) => {
    if (!enabled || !ctx || ctx.state !== 'running' || !master) return;
    const now = ctx.currentTime;
    const isLeft = bank === 'L';
    const panVal = isLeft ? -0.26 : 0.26;
    const amp = clamp(strength * (1 + boost * 0.32), 0.1, 1.3);

    let dest = master;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = panVal;
      panner.connect(master);
      dest = panner;
    }

    // Punchy cross-plane low thump + mid header transient + ignition snap
    const subOsc = ctx.createOscillator();
    const subG = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime((isLeft ? 92 : 100) + rpmNorm * 32, now);
    subOsc.frequency.exponentialRampToValueAtTime(isLeft ? 33 : 36, now + 0.082);
    subG.gain.setValueAtTime(0.35 * amp, now);
    subG.gain.exponentialRampToValueAtTime(0.001, now + 0.098);
    subOsc.connect(subG).connect(dest);
    subOsc.start(now);
    subOsc.stop(now + 0.105);

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    const fStart = (isLeft ? 112 : 128) + rpmNorm * 62;
    const fEnd = isLeft ? 38 : 44;
    osc.frequency.setValueAtTime(fStart, now);
    osc.frequency.exponentialRampToValueAtTime(fEnd, now + 0.062);
    g.gain.setValueAtTime(0.26 * amp, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.078);
    osc.connect(g).connect(dest);
    osc.start(now);
    osc.stop(now + 0.084);

    const bark = ctx.createBufferSource();
    bark.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (isLeft ? 260 : 335) + rpmNorm * 480 + boost * 220;
    bp.Q.value = 1.7;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime((0.2 + boost * 0.11) * amp, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 0.058);
    bark.connect(bp).connect(bg).connect(dest);
    bark.start(now, Math.random() * 1.1, 0.068);

    if (boost > 0.15 || rpmNorm > 0.2) {
      const sparkSnap = ctx.createBufferSource();
      sparkSnap.buffer = noiseBuf;
      const sbp = ctx.createBiquadFilter();
      sbp.type = 'bandpass';
      sbp.frequency.value = 1350 + rpmNorm * 700 + boost * 400;
      sbp.Q.value = 2.6;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime((0.12 + boost * 0.12) * amp, now);
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.022);
      sparkSnap.connect(sbp).connect(sg).connect(dest);
      sparkSnap.start(now, Math.random() * 1.2, 0.028);
    }

    bumpPulse(clamp(0.54 + 0.46 * amp, 0, 1));
  };

  const triggerFire = (strength = 0.8, bank = 'L') => {
    if (!enabled || !ctx || ctx.state !== 'running' || !master) return;
    const b = bank === 'R' ? 'R' : 'L';
    const s = clamp(strength, 0.1, 1.2);
    triggerV8BankPulse(b, lastRpmNorm, s, lastBoost);
    if (s >= 0.85 || lastBoost > 0.25) {
      triggerOverrunPop(b, lastRpmNorm, lastBoost, s > 1.0);
    }
  };

  const triggerMisfireBackfire = (bank, rpmNorm, boost = 0) => {
    if (!enabled || !ctx || ctx.state !== 'running' || !master) return;
    const now = ctx.currentTime;
    const panVal = bank === 'L' ? -0.34 : 0.34;
    let dest = master;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = panVal;
      panner.connect(master);
      dest = panner;
    }

    const amp = clamp(0.65 + rpmNorm * 0.35 + boost * 0.3, 0.45, 1.1);
    const boom = ctx.createOscillator();
    boom.type = 'triangle';
    boom.frequency.setValueAtTime(168 + Math.random() * 42, now);
    boom.frequency.exponentialRampToValueAtTime(38, now + 0.095);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.32 * amp, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    boom.connect(bg).connect(dest);
    boom.start(now);
    boom.stop(now + 0.115);

    const puff = ctx.createBufferSource();
    puff.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 390 + Math.random() * 260;
    bp.Q.value = 2.8;
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.3 * amp, now);
    pg.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
    puff.connect(bp).connect(pg).connect(dest);
    puff.start(now, Math.random() * 1.1, 0.095);
    bumpPulse(0.62 * amp);
  };

  const triggerKnockPing = (bank, rpmNorm, strength = 0.8) => {
    if (!enabled || !ctx || ctx.state !== 'running' || !master) return;
    const now = ctx.currentTime;
    const panVal = bank === 'L' ? -0.2 : 0.2;
    let dest = master;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = panVal;
      panner.connect(master);
      dest = panner;
    }

    const amp = clamp(strength, 0.2, 1.1);
    const fPing = 3150 + Math.random() * 1150 + rpmNorm * 450;
    const ping = ctx.createOscillator();
    ping.type = 'sine';
    ping.frequency.setValueAtTime(fPing, now);
    ping.frequency.exponentialRampToValueAtTime(fPing * 0.86, now + 0.032);
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.24 * amp, now);
    pg.gain.exponentialRampToValueAtTime(0.001, now + 0.034);
    ping.connect(pg).connect(dest);
    ping.start(now);
    ping.stop(now + 0.038);

    const clack = ctx.createBufferSource();
    clack.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4600 + Math.random() * 1200;
    bp.Q.value = 6.5;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.28 * amp, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.016);
    clack.connect(bp).connect(cg).connect(dest);
    clack.start(now, Math.random() * 1.2, 0.022);
    bumpPulse(clamp(0.75 * amp, 0, 1));
  };

  const triggerClick = (type = 'lock', strength = 0.6) => {
    if (!enabled || !ctx || ctx.state !== 'running' || !master) return;
    const now = ctx.currentTime;
    const amp = clamp(strength, 0.05, 1);

    if (type === 'fire') {
      triggerV8BankPulse('L', 0.2, amp);
      return;
    }

    if (type === 'rocker') {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400 + Math.random() * 650;
      bp.Q.value = 5.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18 * amp, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.022);
      src.connect(bp).connect(g).connect(master);
      src.start(now, Math.random() * 1.4, 0.03);
      return;
    }

    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = type === 'foot' ? 420 + Math.random() * 140 : 1650;
    bp.Q.value = type === 'foot' ? 3.2 : 4.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime((type === 'foot' ? 0.16 : 0.35) * amp, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + (type === 'foot' ? 0.045 : 0.055));
    src.connect(bp).connect(g).connect(master);
    src.start(now, Math.random() * 1.2, 0.08);
  };

  const setEnabled = async (on) => {
    const next = !!on;
    if (next) {
      if (!ensureContext()) {
        enabled = false;
        return false;
      }
      try {
        if (ctx.state === 'suspended') await ctx.resume();
      } catch (_) {}
      initGraph(defaultKind);
      enabled = true;
      master.gain.setTargetAtTime(volume, ctx.currentTime, 0.04);
    } else {
      enabled = false;
      if (ctx && master) {
        master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      }
    }
    return enabled;
  };

  const toggle = () => setEnabled(!enabled);

  const setVolume = (v) => {
    volume = clamp(v, 0, 1);
    if (enabled && ctx && master) {
      master.gain.setTargetAtTime(volume, ctx.currentTime, 0.03);
    }
  };

  const update = (state = {}) => {
    const kind = state.kind || defaultKind;
    defaultKind = kind;
    if (!enabled || !ctx || ctx.state !== 'running') return;
    initGraph(kind);
    if (!nodes) return;

    const now = ctx.currentTime;
    const paused = !!state.paused;

    if (kind === 'v8') {
      const rpm = clamp(state.rpm ?? 700, 0, 9000);
      const rpmNorm = rpm / 8000;
      const boost = clamp(state.boostBar ?? state.boost ?? 0, 0, 1.5);
      const fault = state.fault || 'none';
      const decel = prevRpm != null && prevRpm - rpm > 18;
      prevRpm = rpm;
      lastRpmNorm = rpmNorm;
      lastBoost = boost;

      const playScale = clamp(state.playScale ?? 1 / 20, 1 / 120, 2);
      const slowMode = playScale <= 0.12;
      const timeFactor = clamp(Math.sqrt(playScale * 12), 0.35, 1.4);

      const fireHz = (rpm / 60) * 4 * playScale;
      // Phase-locked modulation on the 90° combustion cycle when firing pulses are visually resolvable
      let phaseMod = 0;
      if (!paused && typeof state.th === 'number' && fireHz < 55) {
        const cyc = ((((state.th % 90) + 90) % 90) / 90);
        phaseMod = Math.pow(Math.max(0, 1 - cyc * 1.65), 1.6);
      }

      const overheatExtra = fault === 'overheat' ? 0.18 : 0;
      const baseHz = clamp((rpm / 60) * 1.45 * timeFactor, 16, 230);
      nodes.oscHalf.frequency.setTargetAtTime(Math.max(12, baseHz * 0.5), now, 0.04);
      nodes.oscA.frequency.setTargetAtTime(baseHz, now, 0.04);
      nodes.oscB.frequency.setTargetAtTime(baseHz * 1.5, now, 0.04);
      nodes.oscC.frequency.setTargetAtTime(baseHz * 2.01, now, 0.04);
      nodes.sub.frequency.setTargetAtTime(Math.max(18, baseHz * 0.5), now, 0.04);
      nodes.filter.frequency.setTargetAtTime(
        paused ? 85 : 115 + rpm * 0.13 * timeFactor + (boost + overheatExtra) * 95 + phaseMod * (70 + rpmNorm * 90),
        now,
        0.04
      );
      nodes.exhaustRes.frequency.setTargetAtTime(118 + rpmNorm * 85, now, 0.06);
      nodes.postLp.frequency.setTargetAtTime(paused ? 420 : 780 + rpm * 0.22 + boost * 420, now, 0.05);
      nodes.hissBp.frequency.setTargetAtTime(680 + rpm * 0.3 + (boost + overheatExtra * 2) * 520, now, 0.05);
      nodes.hissGain.gain.setTargetAtTime(
        paused ? 0.004 : (0.015 + rpmNorm * 0.08 + boost * 0.04 + overheatExtra * 0.08) * (slowMode ? 0.65 : 1),
        now,
        0.05
      );
      nodes.out.gain.setTargetAtTime(
        paused ? 0.12 : (slowMode ? 0.54 : 0.86) * (0.9 + 0.18 * phaseMod + boost * 0.1),
        now,
        0.04
      );

      if (!paused && typeof state.th === 'number') {
        const slot = Math.floor(state.th / 90);
        if (prevV8Slot !== null && slot !== prevV8Slot) {
          const idx = ((slot % 8) + 8) % 8;
          const firingCyl = state.firing || V8_ORDER[idx];
          const bank = firingCyl % 2 === 1 ? 'L' : 'R';
          // Accent Cyl 1 and consecutive-bank cross-plane cadence (8->4 R, 5->7 L)
          const cadenceAccent = firingCyl === 1 || firingCyl === 4 || firingCyl === 7 ? 1.12 : 0.94;
          if (fireHz < 70) {
            if (fault === 'misfire' && firingCyl === 4) {
              // Drop Cyl 4 firing thump and intermittently pop unburned charge in the collector
              if (Math.random() < 0.65) {
                triggerMisfireBackfire(bank, rpmNorm, boost);
              } else {
                bumpPulse(0.2);
              }
            } else {
              triggerV8BankPulse(bank, rpmNorm, (slowMode ? 0.84 : 0.62) * cadenceAccent, boost);
              if (fault === 'knock' && (boost > 0.05 || rpm > 900 || Math.random() < 0.75)) {
                triggerKnockPing(bank, rpmNorm, 0.72 + boost * 0.28);
              }
              const highLoadPop = boost > 0.22 && rpm > 1300 && (firingCyl === 4 || firingCyl === 7 || Math.random() < 0.28);
              const decelPop = decel && rpm > 1100 && Math.random() < 0.58;
              if (highLoadPop || decelPop) {
                triggerOverrunPop(bank, rpmNorm, boost, decelPop || (boost > 0.5 && rpm > 2000));
              }
            }
          } else {
            if (fault === 'knock' && Math.random() < 0.35) {
              triggerKnockPing(bank, rpmNorm, 0.65);
            }
            bumpPulse(clamp(0.48 + rpmNorm * 0.4 + boost * 0.22, 0, 1));
          }
        }
        prevV8Slot = slot;

        if (slowMode) {
          const camSlot = Math.floor(state.th / 45);
          if (prevCamSlot !== null && camSlot !== prevCamSlot) {
            triggerClick('rocker', 0.45 + rpmNorm * 0.25);
          }
          prevCamSlot = camSlot;
        } else {
          prevCamSlot = Math.floor(state.th / 45);
        }
      } else if (!paused && state.firing != null && state.firing !== prevFiring) {
        prevFiring = state.firing;
        const cylNum = Number(state.firing);
        const bank = cylNum % 2 === 1 ? 'L' : 'R';
        if (fireHz < 85) {
          if (fault === 'misfire' && cylNum === 4) {
            if (Math.random() < 0.65) triggerMisfireBackfire(bank, rpmNorm, boost);
          } else {
            triggerV8BankPulse(bank, rpmNorm, 0.55, boost);
            if (fault === 'knock') triggerKnockPing(bank, rpmNorm, 0.7);
          }
        }
      }
    } else if (kind === 'turbofan') {
      const throttle = clamp(state.throttle ?? 0.35, 0, 1);
      const n1Raw = state.n1 ?? 22 + throttle * 78;
      const n2Raw = state.n2 ?? 58 + throttle * 42;
      const n1 = clamp(n1Raw > 1.5 ? n1Raw / 100 : n1Raw, 0, 1.1);
      const n2 = clamp(n2Raw > 1.5 ? n2Raw / 100 : n2Raw, 0, 1.1);
      const playScale = clamp(state.playScale ?? 1, 0.02, 2);
      const scaleMod = clamp(Math.sqrt(playScale), 0.35, 1.15);

      // 18-blade fan blade-pass frequency (3400 RPM max -> ~1020 Hz max, softened for studio comfort)
      const fanRpm = n1 * 3400;
      const bpf = clamp((fanRpm / 60) * 18 * 0.65 * scaleMod, 80, 960);
      nodes.fanOsc.frequency.setTargetAtTime(bpf, now, 0.05);
      nodes.fanOsc2.frequency.setTargetAtTime(bpf * 2, now, 0.05);
      nodes.fanFilter.frequency.setTargetAtTime(320 + n1 * 1400, now, 0.06);
      nodes.fanGain.gain.setTargetAtTime(paused ? 0.02 : 0.04 + n1 * 0.14, now, 0.06);

      // 3.06:1 star planetary gearbox mesh whine
      const gearHz = clamp(580 + n2 * 1650 * scaleMod, 420, 2600);
      nodes.gearOsc.frequency.setTargetAtTime(gearHz, now, 0.05);
      nodes.gearBp.frequency.setTargetAtTime(gearHz * 1.05, now, 0.05);
      nodes.gearGain.gain.setTargetAtTime(paused ? 0.005 : 0.012 + n1 * n2 * 0.06, now, 0.06);

      // Quadratic jet exhaust broadband roar
      const quad = Math.pow(0.18 + 0.82 * throttle, 2);
      nodes.jetLp.frequency.setTargetAtTime(160 + quad * 640, now, 0.06);
      nodes.jetGain.gain.setTargetAtTime(paused ? 0.015 : 0.05 + quad * 0.44, now, 0.06);
      nodes.coreBp.frequency.setTargetAtTime(480 + n2 * 920, now, 0.06);
      nodes.coreGain.gain.setTargetAtTime(paused ? 0.008 : 0.02 + quad * 0.16, now, 0.06);
      nodes.out.gain.setTargetAtTime(paused ? 0.16 : 0.85, now, 0.06);
    } else if (kind === 'strandbeest') {
      const wind = clamp(state.wind ?? 0, 0, 20);
      const wNorm = wind / 16;
      nodes.windBp.frequency.setTargetAtTime(220 + wNorm * 420, now, 0.08);
      nodes.windGain.gain.setTargetAtTime(0.02 + wNorm * 0.32, now, 0.08);
      nodes.whistleBp.frequency.setTargetAtTime(640 + wNorm * 780, now, 0.08);
      nodes.whistleGain.gain.setTargetAtTime(wNorm > 0.25 ? (wNorm - 0.25) * 0.08 : 0, now, 0.08);

      if (!paused) {
        if (typeof state.footfalls === 'number') {
          if (prevFootfalls != null && state.footfalls > prevFootfalls) {
            triggerClick('foot', clamp(0.25 + wNorm * 0.45, 0.2, 0.7));
          }
          prevFootfalls = state.footfalls;
        } else if (typeof state.phase === 'number') {
          const bucket = Math.floor((state.phase / (Math.PI * 2)) * 10);
          if (prevPhaseBucket != null && bucket !== prevPhaseBucket && (state.moving ?? wind > 0.6)) {
            triggerClick('foot', clamp(0.2 + wNorm * 0.4, 0.2, 0.65));
          }
          prevPhaseBucket = bucket;
        }
      }
    }
  };

  const getPulse = () => {
    if (!enabled || !ctx || ctx.state !== 'running' || !analyser || !freqData || !timeData) return 0;
    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);

    // Low + low-mid band bins (0..7 => ~0..750 Hz for fftSize=512)
    const bins = Math.min(8, freqData.length);
    let bandSum = 0;
    for (let i = 0; i < bins; i++) {
      const w = i < 3 ? 1.25 : 0.85;
      bandSum += (freqData[i] / 255) * w;
    }
    const bandEnergy = clamp(bandSum / (bins * 0.62), 0, 1);

    // Time-domain RMS transient energy for sub-frame beat lock
    let sq = 0;
    const len = timeData.length;
    for (let i = 0; i < len; i += 2) {
      const d = (timeData[i] - 128) / 128;
      sq += d * d;
    }
    const rms = clamp(Math.sqrt(sq / (len * 0.5)) * 3.1, 0, 1);

    // Adaptive baseline subtraction amplifies beat spikes over steady idle drone
    const rawAcoustic = bandEnergy * 0.62 + rms * 0.48;
    pulseSmooth += (rawAcoustic - pulseSmooth) * 0.08;
    const dynamicBurst = clamp(rawAcoustic + Math.max(0, rawAcoustic - pulseSmooth) * 1.45, 0, 1);

    const dt = Math.max(0, ctx.currentTime - pulseTime);
    const env = pulseEnv * Math.exp(-dt * 8.8);
    return clamp(Math.max(env * 0.96, dynamicBurst), 0, 1);
  };

  const dispose = () => {
    if (nodes) {
      try {
        nodes.cleanup();
      } catch (_) {}
      nodes = null;
    }
    if (ctx) {
      ctx.close().catch(() => {});
      ctx = null;
    }
    master = null;
    analyser = null;
    freqData = null;
    timeData = null;
    pulseEnv = 0;
    enabled = false;
  };

  return {
    get enabled() {
      return enabled;
    },
    setEnabled,
    toggle,
    setVolume,
    update,
    getPulse,
    triggerFire,
    triggerClick,
    dispose,
  };
}
