// SB-10 as a page you drive: the film's console (console.js) over the stage (stage.js), run in real time using the
// shared kit shell (live-shell.js), part inspector + explode/section (inspector.js), and procedural WebAudio
// (webaudio.js). Left alone it plays the film's script as an auto tour with the operator's cursor, looped; a click,
// drag, wheel or key hands control to the visitor, and 25 s of quiet hands it back. Wind drives the crank here too:
// theta is integrated frame by frame, and the console reads its last seconds from a short history.
import * as THREE from 'three';
import { createInspector } from '../kit/inspector.js';
import { createLiveShell, STAGE_H, STAGE_W } from '../kit/live-shell.js';
import { createAudioEngine } from '../kit/webaudio.js';
import { legAt, legZ, phaseOf, S, STRIDE } from './beast.js';
import { createConsole, VIEW_KEYS, WIND_MAX } from './console.js';
import { DURATION, HERO, isoAt, makeConsoleFrame, makeCursor, rpsAt, scriptView, VIEW_FN, windAt } from './film.js';
import { FOOT_MIN, footLift } from './jansen.js';
import { createBeestStage, PALETTES } from './stage.js';

const D2R = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoother = (x) => {
  const u = clamp(x, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
};
const ss = (a, b, t) => smoother((t - a) / (b - a));
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

const TIERS = [
  { name: 'HIGH', samples: 8, shadow: 4096, blur: 20, radius: 7, ao: 16, pcf: false, grains: 9000, pr: 2 },
  { name: 'MED', samples: 4, shadow: 2048, blur: 10, radius: 5, ao: 8, pcf: false, grains: 6000, pr: 1.5 },
  { name: 'LOW', samples: 0, shadow: 1024, blur: 6, radius: 2, ao: 0, pcf: true, grains: 3000, pr: 1.1 },
];

const EXTRA_CSS = `
.vb{pointer-events:auto;cursor:pointer}
.vb:hover{filter:brightness(.94)}
.windhit{position:absolute;pointer-events:auto;cursor:ew-resize}
`;

export function runLive() {
  const style = document.createElement('style');
  style.textContent = EXTRA_CSS;
  document.head.appendChild(style);

  const app = document.getElementById('app');
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  app.appendChild(canvas);

  const st = createBeestStage({ canvas, palette: 'dune', ink: 0.7 });
  st.usePrintRing(640);
  const ui = createConsole(app);
  const tourCursorAt = makeCursor(ui);

  // Section plane along the spine (Z): 0 leaves the full beast unclipped; +/- sweeps inward from either end.
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 100);
  for (const m of Object.values(st.beast.mats)) {
    m.clippingPlanes = [clipPlane];
    m.clipShadows = true;
  }

  // ------------------------------------------------------------ state
  let simT = 0; // stops while paused
  let theta = 0;
  let flow = 0;
  let dist = 0;
  let footfalls = 0;
  let paused = false;
  let wind = 6;
  let windTarget = 6;
  let iso = 0;
  let isoTarget = 0;
  let isoOnAt = Infinity;
  let xray = false;
  const tr = { on: false, theta0: 0, done: null, fade: 0 };
  let view = 'cine';
  let viewAt0 = 0;
  let prevLoop = 0;
  let prevIso = 0;
  const cam = { ...VIEW_FN.cine(0, 0) };
  let ring = { t: -9, x: 0, y: 0 };

  // the last 14 s of the crank and the wind, for the console's histories
  const hist = [];
  const histAt = (t, key) => {
    if (!hist.length) return key === 'th' ? theta : wind;
    if (t <= hist[0].t) return key === 'th' ? hist[0].th - rpsAt(hist[0].w) * Math.PI * 2 * (hist[0].t - t) : hist[0].w;
    const last = hist[hist.length - 1];
    if (t >= last.t) return key === 'w' ? wind : last[key];
    let lo = 0;
    let hi = hist.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (hist[m].t <= t) lo = m;
      else hi = m;
    }
    const a = hist[lo];
    const b = hist[hi];
    return a[key] + (b[key] - a[key]) * ((t - a.t) / (b.t - a.t || 1));
  };
  const frameConsole = makeConsoleFrame(ui, st, { thetaAt: (t) => histAt(t, 'th'), windAt: (t) => histAt(t, 'w') });

  const setView = (v) => {
    if (v === view) return;
    view = v;
    viewAt0 = shell.T;
  };
  const setIso = (on) => {
    isoTarget = on ? 1 : 0;
    if (on) {
      isoOnAt = simT;
      setView('leg');
    } else if (view === 'leg') setView('front');
  };
  const setTrace = (on) => {
    if (on === tr.on) return;
    tr.on = on;
    if (on) Object.assign(tr, { theta0: theta, done: null });
  };
  const setPaused = (p) => {
    paused = p;
    ui.btn.pause.textContent = p ? '▶ RESUME' : '❚❚ PAUSE';
  };
  const setXray = (on) => {
    xray = !!on;
    st.beast.setXray?.(xray);
  };

  const audio = createAudioEngine({ kind: 'strandbeest', volume: 0.35 });

  const shell = createLiveShell({
    app,
    canvas,
    stage: st,
    ui,
    duration: DURATION,
    tiers: TIERS,
    chipTop: 46,
    orbitBounds: { azSign: -1, elSign: 1, minEl: -10, maxEl: 70, minK: 0.45, maxK: 2.2 },
    theme: {
      bg: '#e9e2d6',
      border: 'rgba(110,98,78,0.55)',
      ink: '#3a342b',
      mute: '#8a7f6c',
      accent: '#d0592a',
      panel: 'rgba(243,238,227,0.92)',
    },
    shortcuts: [
      ['1–5', 'Camera views (Cine, Leg, Front, Side, Top)'],
      ['I / T / Y', 'Isolate hero leg · Trace foot loops · X-Ray frame'],
      ['← / →', 'Adjust wind speed ±1 m/s'],
      ['SPACE', 'Pause / resume simulation'],
      ['H / Q / M / S', 'Hide HUD · Quality tier · Sound · PNG snap'],
      ['DBL-CLICK', 'Reset camera orbit'],
      ['ESC / ?', 'Clear selection · Toggle shortcuts'],
    ],
    audio,
    onStartTour: () => {
      prevLoop = 0;
      prevIso = 0;
      if (paused) setPaused(false);
      setTrace(false);
      setXray(false);
    },
    onTakeOver: () => {
      windTarget = wind;
      isoTarget = iso > 0.5 ? 1 : 0;
    },
    onKey: (key) => {
      const v = { 1: 'cine', 2: 'leg', 3: 'front', 4: 'side', 5: 'top' }[key];
      if (v) ui.btn[v].click();
      else if (key === 'i') ui.btn.iso.click();
      else if (key === 't') ui.btn.trace.click();
      else if (key === 'y') ui.btn.xray.click();
      else if (key === ' ') ui.btn.pause.click();
      else if (key === 'arrowright' || key === 'arrowleft') {
        shell.takeOver();
        windTarget = clamp(windTarget + (key === 'arrowright' ? 1 : -1), 0, WIND_MAX);
      } else return false;
      return true;
    },
  });

  const inspector = createInspector({
    scene: st.scene,
    camera: st.camera,
    renderer: st.renderer,
    canvas,
    root: st.beast.group,
    domParent: app,
    stageSize: { w: STAGE_W, h: STAGE_H },
    toStage: shell.toStage,
    accent: '#d0592a',
    theme: {
      border: 'rgba(110,98,78,0.55)',
      ink: '#2f2a22',
      mute: '#8a7f6c',
      panel: 'rgba(243,238,227,0.95)',
    },
    getLiveSpec: (part) => {
      const rps = paused ? 0 : rpsAt(wind) * ss(0.3, 1.5, wind);
      const rpmNow = rps * 60;
      const degNow = (((theta * 180) / Math.PI) % 360 + 360) % 360;
      const legMatch = part.name?.match(/\b(\d{2})([FB])\b/);
      if (legMatch) {
        const sIdx = Math.min(9, Math.max(0, Number(legMatch[1]) - 1));
        const sideIdx = legMatch[2] === 'B' ? 1 : 0;
        const J = legAt(sIdx, sideIdx, theta);
        const liftMm = Math.max(0, (J.F[1] - FOOT_MIN) * 12);
        return [
          { label: 'FOOT LIFT', value: `${liftMm.toFixed(0)} mm` },
          { label: 'STANCE', value: liftMm < 6 ? 'ON SAND' : 'SWING · 672 mm' },
        ];
      }
      if (/wind propulsion/i.test(part.subsystem || '') || /sail|mast|boom/i.test(part.name || '')) {
        const sailKn = wind * wind * 0.61 * 0.9 * 10 * 0.001;
        return [
          { label: 'WIND', value: `${wind.toFixed(1)} m/s` },
          { label: 'SAIL LOAD', value: `${sailKn.toFixed(2)} kN` },
        ];
      }
      if (part.subsystem === 'Drivetrain' || /crank/i.test(part.name || '')) {
        return [
          { label: 'CRANK', value: `${rpmNow.toFixed(1)} RPM` },
          { label: 'PHASE', value: `${degNow.toFixed(0)}°` },
        ];
      }
      const speedMs = rps * Math.abs(STRIDE) * S;
      return [
        { label: 'SPEED', value: `${speedMs.toFixed(2)} m/s` },
        { label: 'DIST', value: `${dist.toFixed(1)} m` },
      ];
    },
    onCutPlane: (offset) => {
      const active = Math.abs(offset) >= 0.015;
      st.renderer.localClippingEnabled = active;
      if (!active) {
        clipPlane.normal.set(0, 0, -1);
        clipPlane.constant = 100;
        return;
      }
      const span = st.beast.length * 0.52;
      if (offset > 0) {
        clipPlane.normal.set(0, 0, -1);
        clipPlane.constant = (1 - offset) * span * 2 - span;
      } else {
        clipPlane.normal.set(0, 0, 1);
        clipPlane.constant = (1 + offset) * span * 2 - span;
      }
    },
  });
  shell.connectInspector(inspector);

  const pulse = (key) => {
    const r = ui.btn[key].getBoundingClientRect();
    const [x, y] = shell.toStage(r.left + r.width / 2, r.top + r.height / 2);
    ring = { t: shell.T, x, y };
  };

  // STUDIO: DUNE / SLATE toggle pill inside top live pill bar
  let studioMode = 'dune';
  const studioPill = document.createElement('button');
  studioPill.type = 'button';
  studioPill.className = 'live-pill';
  studioPill.dataset.testid = 'studio-pill';
  studioPill.title = 'Toggle Dune / Slate studio backdrop';
  studioPill.innerHTML = '<i class="dot"></i><span>STUDIO: DUNE</span>';
  const pillsRow = shell.bar.querySelector('.live-pills');
  const helpBtn = pillsRow?.querySelector('[data-testid="help-pill"]');
  if (pillsRow) pillsRow.insertBefore(studioPill, helpBtn || null);
  const setStudio = (mode) => {
    const next = mode === 'slate' ? 'slate' : 'dune';
    studioMode = st.setPalette(next);
    const isSlate = studioMode === 'slate';
    studioPill.classList.toggle('on', isSlate);
    studioPill.querySelector('span').textContent = `STUDIO: ${studioMode.toUpperCase()}`;
    document.body.style.background = PALETTES[studioMode].bg;
    document.documentElement.style.background = PALETTES[studioMode].bg;
    return studioMode;
  };
  studioPill.addEventListener('pointerdown', (e) => e.stopPropagation());
  studioPill.addEventListener('click', (e) => {
    e.stopPropagation();
    shell.touch();
    setStudio(studioMode === 'dune' ? 'slate' : 'dune');
  });

  // the wind slider's hit area over its track + interactive wind history chart (DRAG TO SCRUB)
  const [kx0, ky] = ui.knobAt(0);
  const [kx1] = ui.knobAt(WIND_MAX);
  const windHit = document.createElement('div');
  windHit.className = 'windhit';
  Object.assign(windHit.style, { left: `${kx0 - 12}px`, top: `${ky - 13}px`, width: `${kx1 - kx0 + 24}px`, height: '26px' });
  ui.root.appendChild(windHit);
  {
    const bindWindScrub = (el, xStart, width, immediate) => {
      const onMove = (e) => {
        const [x] = shell.toStage(e.clientX, e.clientY);
        const w = clamp(((x - xStart) / width) * WIND_MAX, 0, WIND_MAX);
        windTarget = w;
        if (immediate) wind = w;
        shell.touch();
      };
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        shell.takeOver();
        el.setPointerCapture?.(e.pointerId);
        const up = () => {
          removeEventListener('pointermove', onMove);
          removeEventListener('pointerup', up);
        };
        addEventListener('pointermove', onMove);
        addEventListener('pointerup', up);
        onMove(e);
      });
    };
    bindWindScrub(windHit, kx0, kx1 - kx0, false);
    if (ui.windHist && ui.windBox) {
      bindWindScrub(ui.windHist, ui.windBox.x, ui.windBox.w, true);
    }
  }

  for (const k of VIEW_KEYS) {
    ui.btn[k].addEventListener('click', () => {
      shell.takeOver();
      pulse(k);
      if (k !== 'leg' && isoTarget) isoTarget = 0;
      if (k === 'leg') setIso(true);
      else setView(k);
      shell.resetOrbit();
    });
  }
  ui.btn.iso.addEventListener('click', () => {
    shell.takeOver();
    pulse('iso');
    setIso(!isoTarget);
  });
  ui.btn.trace.addEventListener('click', () => {
    shell.takeOver();
    pulse('trace');
    setTrace(!tr.on);
  });
  ui.btn.xray.addEventListener('click', () => {
    shell.takeOver();
    pulse('xray');
    setXray(!xray);
  });
  ui.btn.pause.addEventListener('click', () => {
    shell.takeOver();
    pulse('pause');
    setPaused(!paused);
  });

  // ------------------------------------------------------------ footprints as the feet land
  const wasDown = new Array(20).fill(true);
  const layPrints = (bx) => {
    for (let r = 0; r < 20; r++) {
      const s = r % 10;
      const side = r < 10 ? 0 : 1;
      const ps = theta + phaseOf(s);
      const down = footLift(side ? Math.PI - ps : ps) < 0.5;
      if (down && !wasDown[r]) {
        st.addPrint(bx + legAt(s, side, theta).F[0] * S, legZ(s, side) * S, simT, (((r * 7919) % 100) / 100 - 0.5) * 0.25);
        footfalls++;
      }
      wasDown[r] = down;
    }
  };

  // ------------------------------------------------------------ the frame
  let odd = false;
  shell.start(({ T, dt, apOn, cyc, loop, off, tier }) => {
    let since = T - viewAt0;
    let cursor;
    if (apOn) {
      if (loop > prevLoop) {
        prevLoop = loop;
        prevIso = 0;
      }
      const [t0, v] = scriptView(cyc);
      view = v;
      since = cyc - t0;
      // keep the view's clock running so a takeover continues the move instead of jumping
      viewAt0 = T - since;
      windTarget = windAt(cyc);
      const isoNow = isoAt(cyc);
      if (isoNow > 0.01 && prevIso <= 0.01) isoOnAt = simT;
      prevIso = isoNow;
      isoTarget = isoNow;
      cursor = tourCursorAt(cyc);
      // from the second loop on, the pointer glides from where the last one left it
      if (loop > 0 && cyc < 0.8) {
        const end = tourCursorAt(DURATION - 0.01);
        const k = ss(0, 0.8, cyc);
        cursor = { ...cursor, x: end.x + (cursor.x - end.x) * k, y: end.y + (cursor.y - end.y) * k };
      }
    } else {
      const rk = Math.max(0, 1 - (T - ring.t) / 0.55);
      cursor = { x: -99, y: -99, press: false, drag: false, ring: rk, ringX: ring.x, ringY: ring.y };
    }

    wind += (windTarget - wind) * (1 - Math.exp(-dt / 0.35));
    iso += (isoTarget - iso) * (1 - Math.exp(-dt / 0.2));

    // the crank: wind sets its rate, a dead calm lets it coast to a stop
    if (!paused) {
      simT += dt;
      const rps = rpsAt(wind) * ss(0.3, 1.5, wind);
      const th0 = theta;
      theta += rps * Math.PI * 2 * dt;
      flow += wind * dt * 0.35;
      dist += Math.abs(st.bodyPos(theta).x - st.bodyPos(th0).x);
    }
    if (!paused || !hist.length) hist.push({ t: simT, th: theta, w: wind });
    else if (hist.length) hist[hist.length - 1].w = wind;
    while (hist.length > 2 && hist[0].t < simT - 14) hist.shift();
    const b = st.bodyPos(theta);
    if (!paused) layPrints(b.x);

    audio.update({
      kind: 'strandbeest',
      wind,
      phase: theta,
      footfalls,
      paused,
      moving: !paused && wind > 0.6,
    });

    // the foot traces: the hero's loop draws itself from the click, the rest fade in when it closes
    let heroTrace = 0;
    let trace = 0;
    tr.fade += ((tr.on ? 1 : 0) - tr.fade) * (1 - Math.exp(-dt / 0.25));
    if (tr.on || tr.fade > 0.01) {
      heroTrace = Math.min(1, (theta - tr.theta0) / (Math.PI * 2));
      if (heroTrace >= 1 && tr.done === null) tr.done = simT;
      trace = tr.done === null ? 0 : ss(tr.done, tr.done + 0.9, simT);
    }

    // the camera eases toward the view's own move plus the visitor's orbit; a wide swing backs off on the way
    const tgt = VIEW_FN[view](since, b.x);
    tgt.az += off.az;
    tgt.el = clamp(tgt.el + off.el, 2, 82);
    tgt.d *= off.k;
    const k = 1 - Math.exp(-dt / 0.55);
    const dAz = wrapDeg(tgt.az - cam.az);
    cam.az += dAz * k;
    for (const key of ['tx', 'ty', 'tz', 'el', 'd', 'sx', 'sy']) cam[key] += (tgt[key] - cam[key]) * k;
    const swing = Math.min(1, Math.abs(dAz) / 90);
    st.frame(theta, simT, { ...cam, el: (cam.el + 8 * swing) * D2R, az: cam.az * D2R, d: cam.d + 2.5 * swing }, { wind, flow, iso, hero: HERO, trace, heroTrace, traceFade: tr.on ? 1 : tr.fade });

    // the console: every frame on a fast GPU, every other frame (the pointer every frame) on a slow one
    odd = !odd;
    if (tier > 0 && odd) ui.pointer(cursor);
    else frameConsole(simT, { view, since, iso, cursor, labelStart: isoOnAt, trace: tr.on ? 1 : 0, xray: xray ? 1 : 0, dist });
  });

  window.LIVE = {
    st,
    cam,
    shell,
    inspector,
    audio,
    setStudio,
    get studio() {
      return studioMode;
    },
    setXray,
    get xray() {
      return xray;
    },
    startTour: shell.startTour,
    takeOver: shell.takeOver,
    get tier() {
      return shell.tier;
    },
    get T() {
      return shell.T;
    },
  };
}
