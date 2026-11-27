// GTF-1200 Geared Turbofan explorer film: the engine (turbofan.js) on the pale studio (stage.js) under the
// telemetry overlay (console.js). Pure deterministic function of t (26s tour):
// hero orbit -> 3.06:1 planetary gearbox -> longitudinal SECTION cutaway -> TOGA throttle ramp ->
// 20-nozzle annular combustor -> dual-spool HPT/LPT turbine & Mach plume -> front swept fan -> hero.
import {runSim} from '../kit/runtime.js';
import {createConsole} from './console.js';
import {createTurbofanStage} from './stage.js';
import {cycleAt, E, STATION_MAP, STATIONS} from './thermo.js';

export const SCRIPT = [
  {t: 0, cam: 'open', cut: 'glass', station: 'FAN'},
  {t: 3.5, cam: 'gearbox', station: 'GEARBOX'},
  {t: 7.0, cam: 'side', cut: 'section', station: 'HPC'},
  {t: 10.5, throttle: [0.25, 1.0, 1.8]},
  {t: 14.2, cam: 'burner', station: 'BURNER'},
  {t: 17.6, cam: 'turbine', station: 'LPT'},
  {t: 20.8, cam: 'front', cut: 'glass', station: 'FAN'},
  {t: 23.2, cam: 'hero', cut: 'glass'},
];

export const DURATION = 26;
export const DEFAULTS = {
  duration: DURATION,
  fps: 60,
  theme: 'light',
  hud: {enabled: false, title: 'gtf1200', subtitle: ''},
  director: {enabled: false},
  watermark: '',
};

const D2R = Math.PI / 180;
const mm = (v) => v * 0.001;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoother = (x) => {
  const u = clamp01(x);
  return u * u * u * (u * (u * 6 - 15) + 10);
};
const ss = (a, b, t) => smoother((t - a) / (b - a));
const PLAY = 30; // playback divider: 1/30 speed so 3,400 RPM fan blades & 3.06:1 gears read crisply

// ------------------------------------------------------------ throttle & dual-spool angle integration
const THR_EV = SCRIPT.find((e) => e.throttle);
export const throttleAt = (t) => {
  const [a, b, d] = THR_EV.throttle;
  return a + (b - a) * ss(THR_EV.t, THR_EV.t + d, t);
};

const DT = 1 / 240;
const FAN_DEG = [];
const N2_DEG = [];
{
  let fDeg = 8;
  let cDeg = 14;
  for (let t = 0; t <= DURATION + 1; t += DT) {
    FAN_DEG.push(fDeg);
    N2_DEG.push(cDeg);
    const cy = cycleAt(throttleAt(t + DT / 2));
    fDeg += ((cy.fanRpm / 60) * 360 * DT) / PLAY;
    cDeg += ((cy.coreRpm / 60) * 360 * DT) / PLAY;
  }
}

const interp = (arr, t) => {
  const u = Math.max(0, Math.min(arr.length - 2, t / DT));
  const i = Math.floor(u);
  return arr[i] + (arr[i + 1] - arr[i]) * (u - i);
};

export const fanDegAt = (t) => interp(FAN_DEG, t);
export const n2DegAt = (t) => interp(N2_DEG, t);
export const cutAt = (t) => SCRIPT.filter((e) => e.cut && e.t <= t).pop()?.cut ?? 'glass';
export const stationAt = (t) => SCRIPT.filter((e) => e.station && e.t <= t).pop()?.station ?? 'FAN';

// ------------------------------------------------------------ camera views (metres, degrees)
export const VIEW_FN = {
  open: (u) => {
    const k = smoother(u / 3.5);
    return {tx: 0, ty: 0.04, tz: -0.25, az: 38 + 22 * k, el: 15 + 5 * k, d: 6.4 - 0.55 * k, sx: -48, sy: 10};
  },
  hero: (u) => ({tx: 0, ty: 0.04, tz: -0.25, az: 52 + 6 * u, el: 19, d: 5.95, sx: -48, sy: 10}),
  front: (u) => ({tx: 0, ty: 0.03, tz: 0.72, az: 14 + 5 * u, el: 10 + 1.5 * u, d: 4.9, sx: -40, sy: 10}),
  side: (u) => ({tx: 0, ty: 0.02, tz: -0.35, az: 88 - 3 * u, el: 7 + 1.2 * u, d: 5.85, sx: -42, sy: 10}),
  gearbox: (u) => ({tx: 0, ty: 0.02, tz: 0.56, az: 54 + 6 * u, el: 15 + 1.2 * u, d: 2.35, sx: -34, sy: 12}),
  burner: (u) => ({tx: 0, ty: 0.02, tz: -0.68, az: 64 + 6 * u, el: 11 + 1.2 * u, d: 2.55, sx: -34, sy: 10}),
  turbine: (u) => ({tx: 0, ty: 0.02, tz: -1.18, az: 114 - 5 * u, el: 12 + 1.5 * u, d: 2.85, sx: -36, sy: 10}),
};

const VIEWS = SCRIPT.filter((e) => e.cam).map((e) => [e.t, e.cam]);
export const camAt = (t, list = VIEWS) => {
  let i = 0;
  while (i < list.length - 1 && list[i + 1][0] <= t) i++;
  const view = (k, tt) => VIEW_FN[list[k][1]](tt - list[k][0]);
  const cur = view(i, t);
  if (i === 0) return cur;
  const k = ss(list[i][0], list[i][0] + 1.55, t);
  if (k >= 1) return cur;
  return blend(view(i - 1, t), cur, k);
};

function blend(a, b, k, backOff = true) {
  const o = {};
  for (const key in b) o[key] = key === 'az' ? a.az + ((((b.az - a.az + 540) % 360) - 180) * k) : a[key] + (b[key] - a[key]) * k;
  const swing = Math.min(1, Math.abs(((b.az - a.az + 540) % 360) - 180) / 90);
  if (backOff) o.d += Math.max(0, Math.max(a.d, b.d) + 0.9 * swing - o.d) * Math.sin(Math.PI * k);
  return o;
}

export const camName = (t) => {
  const v = VIEWS.filter(([t0]) => t0 <= t).pop()[1];
  return v === 'open' ? 'hero' : v;
};

// ------------------------------------------------------------ operator cursor automation
const REST = [[820, 470], [700, 430], [900, 520], [760, 380]];
export function makeCursor(ui) {
  const spotOf = (k) => (ui.spots && ui.spots[k]) || [1400, 760];
  const knobOf = (u) => (ui.throttleKnob ? ui.throttleKnob(u) : [160, 836]);
  const EV = SCRIPT.filter((e) => e.t > 0).map((e) => {
    if (e.throttle) return {t: e.t, spot: knobOf(e.throttle[0]), to: knobOf(e.throttle[1]), drag: e.throttle[2]};
    if (e.cam) return {t: e.t, spot: spotOf(e.cam), drag: 0};
    return {t: e.t, spot: spotOf(e.cut || 'glass'), drag: 0};
  });
  const WP = [[0, 980, 640]];
  EV.forEach((e, i) => {
    WP.push([e.t - 0.16, ...e.spot]);
    if (e.drag) {
      for (let k = 0; k <= 12; k++) {
        const tt = e.t + (k / 12) * e.drag;
        WP.push([tt + 0.02, ...knobOf(throttleAt(tt))]);
      }
      WP.push([e.t + e.drag + 0.3, ...e.to]);
    } else WP.push([e.t + 0.24, ...e.spot]);
    WP.push([e.t + e.drag + 1.6, ...REST[i % REST.length]]);
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

// ------------------------------------------------------------ overlay telemetry & callouts per frame
export function makeConsoleFrame(ui, st) {
  const P = (x, y, z) => st.project(mm(x), mm(y), mm(z));
  return (t, {fanDeg, n2Deg, throttle, cam, station, cursor, since, live, cut}) => {
    const cy = cycleAt(throttle);
    const solo = live ? live.solo : false;
    const vis = ss(0.9, 1.6, since) * (live && !live.overlays.callouts ? 0 : 1);
    const callouts = [];

    if (!solo && (cam === 'hero' || cam === 'side' || cam === 'front')) {
      callouts.push(
        {name: '18-Blade Swept Fan', sub: `${Math.round(cy.fanRpm)} RPM · 12.0:1 BPR`, at: P(0, 640, 940), label: [340, 118], w: 138, o: vis},
        {name: '3.06:1 Star Gearbox', sub: '32T SUN → 5×33T → 98T RING', at: P(0, 145, 540), label: [915, 148], w: 162, o: vis},
        {name: 'Annular Combustor', sub: `${Math.round(cy.T4)} K · 20 NOZZLES`, at: P(0, 340, -690), label: [1065, 625], w: 144, o: vis},
      );
    } else if (cam === 'gearbox') {
      callouts.push(
        {name: '3.06:1 Star Planetary', sub: `SUN ${Math.round(cy.lptRpm)} RPM → FAN ${Math.round(cy.fanRpm)} RPM`, at: P(0, 120, 540), label: [915, 220], w: 168, o: vis},
      );
    } else if (cam === 'burner') {
      callouts.push(
        {name: '20-Nozzle Combustor', sub: `P4 ${cy.P4.toFixed(1)} BAR · T4 ${Math.round(cy.T4)} K`, at: P(0, 310, -670), label: [890, 128], w: 158, o: vis},
      );
    } else if (cam === 'turbine') {
      callouts.push(
        {name: '2+4 Dual-Spool Turbine', sub: `EGT ${Math.round(cy.egtC)} °C · LPT ${Math.round(cy.lptRpm)} RPM`, at: P(0, 360, -1180), label: [935, 235], w: 166, o: vis},
      );
    }

    const stMeta = STATION_MAP[station] || STATIONS[0];
    const lead = live && !live.overlays.callouts ? 0 : 1;
    callouts.push({name: '', sub: '', at: P(0, 0, stMeta.zMm), label: [1318, 120], w: 0, o: 0.9 * lead * (live && !live.overlays.charts ? 0 : 1)});

    ui.update?.({
      throttle,
      cycle: cy,
      fanDeg,
      n2Deg,
      lptDeg: -fanDeg * E.exactGearRatio,
      playText: live ? live.playText : '1 / 30 SPEED',
      playK: live ? live.playK : 0.33,
      paused: live ? live.paused : false,
      station,
      cam,
      cut: live ? live.cut : cut ?? 'glass',
      overlays: live ? live.overlays : {callouts: 1, flow: 1, plasma: 1, isolate: solo ? 1 : 0, charts: 1, xray: 0},
      callouts,
      cursor,
    });
  };
}

export function makeFilm() {
  return async ({canvas, capture}) => {
    const st = createTurbofanStage({canvas});
    const resize = () => st.resize(1600, 900, capture ? devicePixelRatio || 1 : Math.min(devicePixelRatio || 1, 2));
    resize();
    const ui = createConsole(document.getElementById('app'));
    const cursorAt = makeCursor(ui);
    const frame = makeConsoleFrame(ui, st);
    window.TURBOFAN = st;
    return {
      resize,
      render(t) {
        const throttle = throttleAt(t);
        const fanDeg = fanDegAt(t);
        const n2Deg = n2DegAt(t);
        const cam = camName(t);
        const station = stationAt(t);
        const cut = cutAt(t);
        const c = camAt(t);
        const t0 = VIEWS.filter(([a]) => a <= t).pop()[0];
        st.setCut(cut, 0);
        st.eng.setXray?.(false);
        st.frame({fanDeg, n2Deg, throttle, time: t}, {...c, az: c.az * D2R, el: c.el * D2R}, {solo: -1, flow: 1, plasma: 1});
        frame(t, {fanDeg, n2Deg, throttle, cam, station, cursor: cursorAt(t), since: t - t0, cut});
        return {};
      },
    };
  };
}

export const run = () => runSim(DEFAULTS, makeFilm());
