// V8 · Four-Stroke, the explorer film: the engine (engine.js) on the pale studio (stage.js) under the overlay
// (console.js). The crank runs at engine speed × playback (1/20: 700 rpm turns 210° a second on screen). An operator
// isolates cylinder 1 (showcasing pivoting roller-rockers, volumetric charge & TDC spark flash), switches to cylinder 6,
// looks down the valley, opens the throttle to 2,400 rpm, inspects the solid-capped SECTION cutaway, then views the
// meshing 24T-72T-48T front timing drive and hero views. A pure deterministic function of t.
import {runSim} from '../kit/runtime.js';
import {CAMS, createConsole, RPM_MAX} from './console.js';
import {bankXY, CYL, E, ORDER, psi} from './kin.js';
import {createV8Stage} from './stage.js';

export const SCRIPT = [
  {t: 0.0, cam: 'open', cut: 'glass', track: 1},
  {t: 4.2, cam: 'front', cut: 'glass'},
  {t: 8.6, cam: 'valley', cut: 'glass'},
  {t: 11.4, cam: 'side', cut: 'glass'},
  {t: 14.0, cam: 'side', xray: true, cut: 'glass'},
  {t: 18.4, cam: 'hero', wire: true, cut: 'glass'},
  {t: 21.6, cam: 'hero', cut: 'glass'},
];
export const DURATION = 26;
export const DEFAULTS = {duration: DURATION, fps: 60, theme: 'light', hud: {enabled: false, title: 'v8d', subtitle: ''}, director: {enabled: false}, watermark: ''};
const D2R = Math.PI / 180;
const mm = (v) => v * 0.001;
const smoother = (x) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};
const ss = (a, b, t) => smoother((t - a) / (b - a));
const PLAY = 20; // playback divider: 1/20 speed

// ------------------------------------------------------------ engine speed and the crank angle
export const rpmAt = (t) => {
  if (t < 4.2) return 750 + (1600 - 750) * ss(0.3, 4.0, t);
  if (t < 8.6) return 1600 + (1800 - 1600) * ss(4.2, 5.2, t) + (2600 - 1800) * ss(5.2, 8.4, t);
  if (t < 14.0) return 2600 + (2800 - 2600) * ss(8.6, 9.4, t) + (6400 - 2800) * ss(9.6, 13.4, t);
  if (t < 18.4) return 6400 + (2800 - 6400) * ss(14.0, 15.8, t);
  if (t < 21.6) return 2800 + (1800 - 2800) * ss(18.4, 20.0, t);
  return 1800 + (1100 - 1800) * ss(21.6, 24.4, t);
};
const DT = 1 / 240;
const TH = [];
{
  let th = 12;
  for (let t = 0; t <= DURATION + 1; t += DT) {
    TH.push(th);
    th += ((rpmAt(t + DT / 2) / 60) * 360 * DT) / PLAY;
  }
}
export const thetaAt = (t) => {
  const u = Math.max(0, Math.min(TH.length - 2, t / DT));
  const i = Math.floor(u);
  return TH[i] + (TH[i + 1] - TH[i]) * (u - i);
};
export const trackAt = (t) => SCRIPT.filter((e) => e.track && e.t <= t).pop()?.track ?? 1;
export const cutAt = () => 'glass';
export const boostAt = (t) => 0.8 * ss(9.0, 10.0, t) * (1 - ss(13.6, 14.3, t));
export const xrayAt = (t) => t >= 14.0 && t < 18.4;
export const wireAt = (t) => t >= 18.4 && t < 21.6;

// ------------------------------------------------------------ views, each a function of u (seconds since it came on)
const cylCentre = (c) => {
  const cy = CYL[c - 1];
  const [x, y] = bankXY(cy.bank, 0, 175);
  return [mm(x), mm(y), mm(cy.z)];
};
export const VIEW_FN = {
  open: (u) => {
    const k = smoother(u / 4.1);
    return {tx: 0, ty: 0.11, tz: -0.02, az: 4 + 54 * k, el: 18 + 9 * k, d: 2.2 - 0.25 * k, sx: -50, sy: 10};
  },
  hero: (u) => ({tx: 0, ty: 0.095, tz: -0.02, az: 46 + 5 * u, el: 26, d: 2.04, sx: -50, sy: 10}),
  cyl: (u, c) => {
    const [x, y, z] = cylCentre(c);
    const L = CYL[c - 1].bank === 'L';
    return {tx: x * 0.72, ty: y * 0.72 + 0.03, tz: z, az: (L ? 18 : -18) + (L ? 1 : -1) * 5.5 * u, el: 10 + 1.2 * u, d: 1.15, sx: -40, sy: 14};
  },
  valley: (u) => ({tx: 0, ty: 0.14, tz: 0, az: 14 + 7 * u, el: 60, d: 2.35, sx: -40, sy: -28}),
  side: (u) => ({tx: 0, ty: 0.1, tz: 0, az: 96 - 6 * u, el: 14 + 1.5 * u, d: 2.0, sx: -40, sy: 10}),
  front: (u) => ({tx: 0, ty: 0.065, tz: 0, az: -8 + 6 * u, el: 11 + 2 * u, d: 1.98, sx: -40, sy: 10}),
};
const FILM_POSES = [
  {t: 0.0, tx: 0, ty: 0.095, tz: -0.02, az: 52, el: 27, d: 2.08, sx: -48, sy: 10},
  {t: 4.2, tx: 0, ty: 0.088, tz: -0.01, az: 32, el: 22, d: 2.02, sx: -46, sy: 10},
  {t: 6.4, tx: 0, ty: 0.068, tz: 0, az: 6, el: 12, d: 1.94, sx: -40, sy: 10},
  {t: 8.6, tx: 0, ty: 0.072, tz: 0, az: -10, el: 14, d: 1.98, sx: -40, sy: 10},
  {t: 11.2, tx: 0, ty: 0.14, tz: 0, az: 24, el: 56, d: 2.26, sx: -40, sy: -20},
  {t: 14.0, tx: 0, ty: 0.10, tz: 0, az: 86, el: 17, d: 2.02, sx: -40, sy: 10},
  {t: 18.4, tx: 0, ty: 0.095, tz: -0.02, az: 56, el: 23, d: 2.06, sx: -46, sy: 10},
  {t: 21.6, tx: 0, ty: 0.095, tz: -0.02, az: 34, el: 21, d: 2.18, sx: -48, sy: 10},
  {t: 25.4, tx: 0, ty: 0.095, tz: -0.02, az: 46, el: 26, d: 2.04, sx: -50, sy: 10},
];
const CAM_KEYS = ['tx', 'ty', 'tz', 'az', 'el', 'd', 'sx', 'sy'];
export const camAt = (t) => {
  const n = FILM_POSES.length;
  if (t <= FILM_POSES[0].t) return {...FILM_POSES[0]};
  if (t >= FILM_POSES[n - 1].t) return {...FILM_POSES[n - 1]};
  let i = 0;
  while (i < n - 2 && FILM_POSES[i + 1].t <= t) i++;
  const a = FILM_POSES[i];
  const b = FILM_POSES[i + 1];
  const dt = b.t - a.t;
  const u = Math.min(1, Math.max(0, (t - a.t) / dt));
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const tang = (idx, key) => (idx <= 0 || idx >= n - 1 ? 0 : (0.7 * (FILM_POSES[idx + 1][key] - FILM_POSES[idx - 1][key])) / (FILM_POSES[idx + 1].t - FILM_POSES[idx - 1].t));
  const o = {};
  for (const key of CAM_KEYS) o[key] = h00 * a[key] + h10 * dt * tang(i, key) + h01 * b[key] + h11 * dt * tang(i + 1, key);
  return o;
};
export const camName = (t) => {
  if (t < 4.2) return 'hero';
  if (t < 8.6) return 'front';
  if (t < 11.8) return 'valley';
  if (t < 16.5) return 'side';
  return 'hero';
};
export const firingNow = (th) => {
  let best = 1;
  let bp = 1e9;
  for (const c of ORDER) {
    const p = psi(c, th);
    if (p < bp) {
      bp = p;
      best = c;
    }
  }
  return best;
};

// ------------------------------------------------------------ the operator's pointer
const REST = [[820, 470], [700, 430], [900, 520], [760, 380]];
export function makeCursor(ui) {
  const EV = [
    {t: 4.2, spot: ui.spots.front, drag: 0},
    {t: 8.6, spot: ui.spots.valley, drag: 0},
    {t: 9.6, spot: ui.speedKnob(2800 / RPM_MAX), to: ui.speedKnob(6400 / RPM_MAX), drag: 3.4},
    {t: 14.0, spot: ui.spots.xray, drag: 0},
    {t: 18.4, spot: ui.spots.wire, drag: 0},
    {t: 21.6, spot: ui.spots.hero, drag: 0},
  ];
  const WP = [[0, 980, 640]];
  EV.forEach((e, i) => {
    WP.push([e.t - 0.16, ...e.spot]);
    if (e.drag) {
      for (let k = 0; k <= 12; k++) {
        const tt = e.t + (k / 12) * e.drag;
        WP.push([tt + 0.02, ...ui.speedKnob(rpmAt(tt) / RPM_MAX)]);
      }
      WP.push([e.t + e.drag + 0.3, ...e.to]);
    } else WP.push([e.t + 0.24, ...e.spot]);
    if (i === EV.length - 1 || EV[i + 1].t - (e.t + e.drag) > 1.8) {
      WP.push([e.t + e.drag + 1.2, ...REST[i % REST.length]]);
    }
  });
  WP.sort((a, b) => a[0] - b[0]);
  return (t) => {
    let i = 0;
    while (i < WP.length - 2 && t > WP[i + 1][0]) i++;
    const [t0, x0, y0] = WP[i];
    const [t1, x1, y1] = WP[i + 1];
    const lin = t1 - t0 < 0.2;
    const k = lin ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : ss(t0, t1, t);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const bow = lin ? 0 : Math.sin(Math.PI * k) * Math.min(24, len * 0.07);
    let press = false;
    let ring = 0;
    let rx = 0;
    let ry = 0;
    for (const e of EV) {
      if (t >= e.t - 0.07 && t < e.t + Math.max(0.09, e.drag + 0.1)) press = true;
      if (t >= e.t && t < e.t + 0.55) {
        ring = 1 - (t - e.t) / 0.55;
        [rx, ry] = e.spot;
      }
    }
    return {x: x0 + (x1 - x0) * k + (len ? (-(y1 - y0) / len) * bow : 0), y: y0 + (y1 - y0) * k + (len ? ((x1 - x0) / len) * bow : 0), press, ring, ringX: rx, ringY: ry};
  };
}

// ------------------------------------------------------------ the overlay's data for a frame
export function makeConsoleFrame(ui, st) {
  const P = (x, y, z) => st.project(mm(x), mm(y), mm(z));
  const Lb = [Math.SQRT1_2, Math.SQRT1_2];
  return (t, {th, cam, cyl, rpm, cursor, since, live, cut, xray, wire}) => {
    const solo = live ? live.solo : false;
    const cy = CYL[cyl - 1];
    const vis = ss(1.1, 1.8, since) * (live && !live.overlays.callouts ? 0 : 1);
    const boostBar = live ? (live.overlays.boost ? 0.8 : 0) : boostAt(t);
    const callouts = [];
    if (!solo && (cam === 'hero' || cam === 'side')) {
      callouts.push(
        {name: 'Cross-Ram EFI & AN Rails', sub: 'DBW THROTTLE · 8 INJECTORS', at: P(36, 286, 40), label: [942, 168], w: 158, o: vis},
        {name: 'Hybrid Windowed Valve Covers', sub: 'BILLET RAILS · POLYCARBONATE', at: P(210, 260, -110), label: [1104, 290], w: 174, o: vis},
        {name: 'Finned Sump & Oil Filter', sub: 'CAST ALLOY · 4-INTO-1 COLLECTORS', at: P(140, -95, 40), label: [1096, 616], w: 196, o: vis},
        {name: 'Harmonic Damper & Serpentine', sub: '24T:72T:48T GEARS · WATER PUMP', at: P(0, 128, 330), label: [302, 186], w: 192, o: vis},
      );
    }
    if (solo) {
      const [x, y] = bankXY(cy.bank, 0, E.deck + 112);
      callouts.push({name: 'Roller Rocker & Cam', sub: 'HALF CRANK SPEED', at: P(x, y, cy.z), label: [720, 226], w: 132, o: vis});
    }
    const [bx, by] = bankXY(cy.bank, 0, E.deck - 40);
    const lead = live && !live.overlays.callouts ? 0 : 1;
    callouts.push({name: '', sub: '', at: solo ? P(0, 0, cy.z) : P(0, 0, 312), label: [282, 152], w: 0, o: lead});
    callouts.push({name: '', sub: '', at: P(bx, by, cy.z), label: [1318 - 0.01, 501], w: 0, o: 0.9 * lead * (live && !live.overlays.charts ? 0 : 1)});
    const ps = psi(cyl, th);
    ui.update({
      rpm,
      rpmK: rpm / RPM_MAX,
      playText: live ? live.playText : '1 / 20 SPEED',
      playK: live ? live.playK : 0.33,
      paused: live ? live.paused : false,
      theta: th,
      psi: ps,
      cyl,
      pin: cy.pin,
      firing: firingNow(th),
      cam,
      cut: live ? live.cut : cut ?? 'glass',
      load: 1,
      boostBar,
      overlays: live ? live.overlays : {callouts: 1, charge: 1, arrows: 1, isolate: solo ? 1 : 0, refract: 1, charts: 1, boost: boostBar > 0.05 ? 1 : 0, split: 0, wire: wire ? 1 : 0},
      xray: live ? !!live.xray : !!xray,
      fault: live ? live.fault || 'none' : 'none',
      callouts,
      cursor,
    });
  };
}

export function makeFilm() {
  return async ({canvas, capture}) => {
    const st = createV8Stage({canvas});
    const resize = () => st.resize(1600, 900, capture ? devicePixelRatio || 1 : Math.min(devicePixelRatio || 1, 2));
    resize();
    const ui = createConsole(document.getElementById('app'));
    const cursorAt = makeCursor(ui);
    const frame = makeConsoleFrame(ui, st);
    window.V8 = st;
    let lastXray = false;
    let lastWire = false;
    return {
      resize,
      render(t) {
        const th = thetaAt(t);
        const cam = camName(t);
        const cyl = trackAt(t);
        const cut = cutAt(t);
        const c = camAt(t);
        const t0 = SCRIPT.filter((e) => e.t <= t).pop()?.t ?? 0;
        const firePhase = ((th % 90) + 90) % 90;
        const fireEnv = Math.pow(Math.max(0, 1 - firePhase / 42), 1.65);
        let beatAccent = 0;
        for (const e of SCRIPT) {
          const dtb = t - e.t;
          if (dtb >= 0 && dtb < 0.75) beatAccent = Math.max(beatAccent, Math.exp(-dtb * 4.5));
        }
        const rpm = rpmAt(t);
        const rpmNorm = (rpm - 500) / 2500;
        const boostBar = boostAt(t);
        const xrayOn = xrayAt(t);
        const wireOn = wireAt(t);
        if (!xrayOn && lastXray) {
          st.eng.setXray?.(false);
          lastXray = false;
        }
        if (!wireOn && lastWire) {
          st.eng.setWireframe?.(false);
          lastWire = false;
        }
        if (xrayOn && !lastXray) {
          st.eng.setXray?.(true);
          lastXray = true;
        }
        if (wireOn && !lastWire) {
          st.eng.setWireframe?.(true);
          lastWire = true;
        }
        const audioPulse = Math.min(1, fireEnv * (0.58 + 0.34 * Math.max(0, rpmNorm)) + beatAccent * 0.42);
        st.setCut(cut, CYL[cyl - 1].z * 0.001);
        st.frame(th, {...c, az: c.az * D2R, el: c.el * D2R}, {solo: -1, boostBar, audioPulse, rpm});
        frame(t, {th, cam, cyl, rpm, cursor: cursorAt(t), since: t - t0, cut, xray: xrayOn, wire: wireOn});
        return {};
      },
    };
  };
}
void CAMS;

export const run = () => runSim(DEFAULTS, makeFilm());
