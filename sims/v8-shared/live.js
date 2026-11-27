// The V8 as a page you drive: the film's engine and overlay, run in real time. Camera views, the cutaway (glass,
// section through the tracked cylinder, solid), the overlays (callouts, charge, arrows, isolate, refraction, charts),
// the firing order to pick the tracked cylinder, PAUSE and ±15°, the engine speed and playback sliders, an orbit you
// drag, a zoom on the wheel, H to hide the overlay, plus Part Inspector, Explode, Section Scrub, Quality Tier, and
// procedural WebAudio via sims/kit/live-shell.js, inspector.js, and webaudio.js.
import {Vector3} from 'three';
import {createInspector} from '../kit/inspector.js';
import {createLiveShell} from '../kit/live-shell.js';
import {createAudioEngine} from '../kit/webaudio.js';
import {CAMS, createConsole, CUTS, OVERLAYS, RPM_MAX} from './console.js';
import {firingNow, makeConsoleFrame, VIEW_FN} from './film.js';
import {CYL, FIRE, ORDER, exhaustPulse, injectorPulse, liftEx, liftIn, powerAt, pressure, psi, sparkIntensity, strokeOf, torqueAt} from './kin.js';
import {createV8Stage} from './stage.js';

const D2R = Math.PI / 180;
const HALF_NORM = new Vector3(-1, 0, 0);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoother = (x) => {
  const u = clamp(x, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
};
const ss = (a, b, t) => smoother((t - a) / (b - a));
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
// playback steps: the film runs at 1/20
const PLAYS = [1 / 60, 1 / 40, 1 / 20, 1 / 10, 1 / 5, 1 / 2, 1];
const playText = (p) => (p >= 1 ? '1× SPEED' : `1 / ${Math.round(1 / p)} SPEED`);

// V8 Live Auto-Tour choreography: 24.0s cohesive single-pass reveal in GLASS (no SECTION, no SOLID, no isolate)
const TOUR_DURATION = 24;
const TOUR_POSES = [
  {t: 0.0, view: 'hero', tx: 0, ty: 0.095, tz: -0.02, az: 52, el: 27, d: 2.08, sx: -48, sy: 10},
  {t: 4.8, view: 'hero', tx: 0, ty: 0.095, tz: -0.02, az: 34, el: 23, d: 2.04, sx: -46, sy: 10},
  {t: 7.2, view: 'front', tx: 0, ty: 0.068, tz: 0, az: 8, el: 13, d: 1.96, sx: -40, sy: 10},
  {t: 10.2, view: 'front', tx: 0, ty: 0.072, tz: 0, az: -12, el: 13, d: 1.98, sx: -40, sy: 10},
  {t: 12.6, view: 'valley', tx: 0, ty: 0.14, tz: 0, az: 22, el: 56, d: 2.26, sx: -40, sy: -20},
  {t: 15.0, view: 'side', tx: 0, ty: 0.10, tz: 0, az: 86, el: 17, d: 2.02, sx: -40, sy: 10},
  {t: 18.5, view: 'hero', tx: 0, ty: 0.095, tz: -0.02, az: 58, el: 23, d: 2.06, sx: -46, sy: 10},
  {t: 21.2, view: 'hero', tx: 0, ty: 0.095, tz: -0.02, az: 34, el: 21, d: 2.18, sx: -48, sy: 10},
  {t: 23.6, view: 'hero', tx: 0, ty: 0.095, tz: -0.02, az: 46, el: 26, d: 2.04, sx: -50, sy: 10},
];
const tourCamName = (t) => {
  if (t < 5.5) return 'hero';
  if (t < 10.5) return 'front';
  if (t < 12.8) return 'valley';
  if (t < 16.8) return 'side';
  return 'hero';
};
const tourRpmAt = (t) => {
  if (t < 5.5) return 1100 + (2400 - 1100) * ss(0.4, 5.2, t);
  if (t < 10.5) return 2400 + (2800 - 2400) * ss(5.5, 8.2, t);
  if (t < 11.8) return 2800 + (4200 - 2800) * ss(10.5, 11.8, t);
  if (t < 15.0) return 4200 + (6400 - 4200) * ss(11.8, 14.5, t);
  if (t < 18.5) return 6400 + (2800 - 6400) * ss(15.0, 16.8, t);
  if (t < 21.2) return 2800 + (1800 - 2800) * ss(18.5, 20.2, t);
  return 1800 + (1100 - 1800) * ss(21.2, 23.4, t);
};
const TOUR_KEYS = ['tx', 'ty', 'tz', 'az', 'el', 'd', 'sx', 'sy'];
function tourCamAt(t) {
  const n = TOUR_POSES.length;
  if (t <= TOUR_POSES[0].t) return {...TOUR_POSES[0]};
  if (t >= TOUR_POSES[n - 1].t) return {...TOUR_POSES[n - 1]};
  let i = 0;
  while (i < n - 2 && TOUR_POSES[i + 1].t <= t) i++;
  const a = TOUR_POSES[i];
  const b = TOUR_POSES[i + 1];
  const dt = b.t - a.t;
  const u = clamp((t - a.t) / dt, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const tang = (idx, key) => (idx <= 0 || idx >= n - 1 ? 0 : (0.7 * (TOUR_POSES[idx + 1][key] - TOUR_POSES[idx - 1][key])) / (TOUR_POSES[idx + 1].t - TOUR_POSES[idx - 1].t));
  const o = {};
  for (const key of TOUR_KEYS) o[key] = h00 * a[key] + h10 * dt * tang(i, key) + h01 * b[key] + h11 * dt * tang(i + 1, key);
  return o;
}

const CONSOLE_CSS = `
#app{position:absolute!important;inset:auto!important;left:0;top:0;width:1600px;height:900px;transform-origin:0 0}
.tb{pointer-events:auto;cursor:pointer}
.tb:hover{filter:brightness(.95)}
.hit{position:absolute;pointer-events:auto;cursor:pointer}
.hit.ew{cursor:ew-resize}
[data-testid="valve-timing"]{pointer-events:auto;cursor:ew-resize}
`;

export function runLive() {
  // Set 1600x900 layout box before createConsole so ui.spots measures unscaled stage coords
  const style = document.createElement('style');
  style.textContent = CONSOLE_CSS;
  document.head.appendChild(style);

  const app = document.getElementById('app');
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  app.appendChild(canvas);
  const st = createV8Stage({canvas});
  const ui = createConsole(app);
  const frameConsole = makeConsoleFrame(ui, st);

  // ------------------------------------------------------------ state
  let th = 12;
  let rpm = 1100;
  let rpmTarget = 1100;
  let playI = 2;
  let paused = false;
  let view = 'hero';
  let viewAt = 0;
  let cyl = 1;
  let cut = 'glass';
  let xray = false;
  const FAULTS = ['none', 'misfire', 'knock', 'overheat'];
  let faultI = 0;
  const ov = {callouts: 1, charge: 1, arrows: 1, isolate: 0, refract: 1, charts: 1, boost: 0, split: 0, wire: 0};
  const cam = {...tourCamAt(0)};
  let ring = {t: -9, x: 0, y: 0};
  const pulse = (x, y) => (ring = {t: shell?.T ?? 0, x, y});
  const pulseBtn = (k) => pulse(...ui.spots[k]);

  let shell = null;
  const audio = createAudioEngine({kind: 'v8'});
  const getLiveSpec = (part) => {
    if (!part?.name) return null;
    const name = part.name;
    const sub = part.subsystem || '';
    const boostBar = ov.boost ? 0.8 : 0;
    const fault = FAULTS[faultI];
    const cm = name.match(/\bCyl(?:inder)?\s*([1-8])\b/i);
    if (cm) {
      const c = Number(cm[1]);
      const ps = psi(c, th);
      const stName = strokeOf(ps);
      const cylFault = fault === 'misfire' && c === 4 ? 'misfire' : fault;
      const bar = pressure(ps, 1, boostBar, cylFault);
      const barStr = bar < 10 ? bar.toFixed(1) : Math.round(bar);
      if (/Injector/i.test(name)) {
        const ip = injectorPulse(ps);
        return `CYL ${c} · ${stName} · ${ip > 0.05 ? `SPRAY ${(ip * 100).toFixed(0)}%` : 'PORT CLOSED'}`;
      }
      if (/Valve|Rocker|Spring/i.test(name)) {
        return `CYL ${c} · ${stName} · IN ${liftIn(ps).toFixed(2)} / EX ${liftEx(ps).toFixed(2)}`;
      }
      if (/Plug|Coil|Lead|Boot/i.test(name)) {
        if (fault === 'misfire' && c === 4) return `CYL 4 · MISFIRE (NO SPARK) · ${barStr} BAR`;
        const spark = sparkIntensity(ps);
        return `CYL ${c} · ${stName} · ${barStr} BAR${spark > 0.02 ? ' · IGNITION ARC' : ''}`;
      }
      if (fault === 'misfire' && c === 4) return `CYL 4 · MISFIRE · ${barStr} BAR · ${Math.round(ps)}°`;
      return `CYL ${c} · ${stName} · ${barStr} BAR · ${Math.round(ps)}°${fault === 'knock' && ps < 30 ? ' · KNOCK' : ''}`;
    }
    if (/Collector/i.test(name)) {
      const bank = /Left/i.test(name) ? 'L' : 'R';
      const wave = Math.max(...CYL.filter((cy) => cy.bank === bank).map((cy) => exhaustPulse(psi(cy.c, th))));
      return `${bank} BANK · ${wave > 0.05 ? `BLOWDOWN ${(wave * 100).toFixed(0)}%` : 'SCAVENGING'}`;
    }
    if (/Oil Cooler|AN-10/i.test(name)) {
      const oilBar = (2.2 + (rpm / RPM_MAX) * 3.8).toFixed(1);
      const oilLpm = Math.round(14 + (rpm / RPM_MAX) * 38);
      return `OIL COOLER ${oilBar} BAR · ${oilLpm} L/min`;
    }
    if (/Oil Sump|Sight Glass|Drain Plug|Oil-Level/i.test(name)) {
      const oilTemp = Math.round(58 + (rpm / RPM_MAX) * 44);
      const oilBar = (2.2 + (rpm / RPM_MAX) * 3.8).toFixed(1);
      return `OIL SUMP · ${oilTemp}°C · ${oilBar} BAR · LEVEL FULL`;
    }
    if (/Oil Filter|Bypass/i.test(name)) {
      const oilBar = (2.2 + (rpm / RPM_MAX) * 3.8).toFixed(1);
      return `OIL PRESSURE ${oilBar} BAR · BYPASS 1.2 BAR`;
    }
    if (/Dipstick|Freeze Plug/i.test(name)) {
      const blockTemp = Math.round(82 + (rpm / RPM_MAX) * 14);
      return `OIL LEVEL FULL · BLOCK ${blockTemp}°C`;
    }
    if (/Starter/i.test(name)) {
      return `12V GEAR STARTER · ${rpm < 400 ? 'CRANKING' : 'PINION DISENGAGED'} (${Math.round(rpm)} RPM)`;
    }
    if (/A\/C|Compressor/i.test(name)) {
      return `A/C ${Math.round(rpm * 1.45)} RPM · ${boostBar > 0 ? 'CLUTCH BYPASS' : 'CLUTCH ENGAGED'}`;
    }
    if (/Tensioner/i.test(name)) {
      return `BELT TENSION 240 N · WP ${Math.round(rpm * 1.25)} RPM`;
    }
    if (/EVAP|Harness|Conduit/i.test(name)) {
      const purge = Math.round(15 + (rpm / RPM_MAX) * 85);
      return `12V ECU HARNESS · ${Math.round(rpm)} RPM · EVAP ${purge}%`;
    }
    if (/Spark|Ignition Lead/i.test(name)) {
      return `FIRING CYL ${firingNow(th)} · 42 kV COIL-NEAR-PLUG`;
    }
    if (/Valve Cover|Filler Neck/i.test(name)) {
      const camDeg = Math.round((((th * 0.5) % 360) + 360) % 360);
      return `VALVETRAIN · CAM ${camDeg}° · ${cut.toUpperCase()} VIEW`;
    }
    if (/90mm|DBW|Throttle/i.test(name)) {
      const tps = clamp(Math.round(14 + ((rpm / RPM_MAX) * 0.75 + (boostBar > 0 ? 0.25 : 0)) * 86), 14, 100);
      const mapBar = (0.9 + boostBar).toFixed(2);
      return `90mm BORE · ${tps}% OPEN · MAP ${mapBar} BAR`;
    }
    if (/Fuel Pressure|Fuel Rail|AN-8|Fuel Crossover|FPR/i.test(name)) {
      const rpmFrac = clamp(rpm / RPM_MAX, 0, 1);
      const boostMul = 1 + boostBar * 0.55;
      const misfireMul = fault === 'misfire' ? 0.875 : 1;
      const fuelBar = (4.0 + 0.22 + 0.8 * boostBar + 0.05 * Math.sin(((th * Math.PI) / 180) * 4)).toFixed(2);
      const fuelLhr = ((2.8 + Math.pow(rpmFrac, 1.35) * 168) * boostMul * misfireMul).toFixed(1);
      const fuelDuty = Math.min(99, Math.round((7 + rpmFrac * 78) * boostMul * misfireMul));
      return `FUEL ${fuelBar} BAR · ${fuelLhr} L/hr · DUTY ${fuelDuty}%`;
    }
    if (/Alternator/i.test(name)) {
      return `FAN ${Math.round(rpm * 2.6)} RPM · 14.2 V · ${Math.round(32 + (rpm / RPM_MAX) * 98)} A`;
    }
    if (/Coolant|Water Pump|Thermostat/i.test(name)) {
      const flowLpm = Math.round(28 + (rpm / RPM_MAX) * 115);
      const tempC = fault === 'overheat' ? 118 : Math.round(84 + (rpm / RPM_MAX) * 10);
      return `WP ${Math.round(rpm * 1.25)} RPM · ${tempC}°C${fault === 'overheat' ? ' OVERHEAT!' : ' · STAT OPEN'} · ${flowLpm} L/min`;
    }
    if (/Timing Cover|Timing Chest/i.test(name)) {
      return `2:1 HELICAL DRIVE · CRANK ${Math.round(rpm)} RPM · CAM ${Math.round(rpm * 0.5)} RPM`;
    }
    if (/Idler|Power-Steering/i.test(name)) {
      return `PS PULLEY ${Math.round(rpm * (74 / 34))} RPM · 2.18:1`;
    }
    if (/Harmonic|Damper/i.test(name)) {
      const crankDeg = Math.round(((th % 720) + 720) % 720);
      return `DAMPER ${crankDeg}° · ${Math.round(rpm)} RPM · ${Math.round(torqueAt(th, 1, boostBar, fault).total)} N·m`;
    }
    if (/Bellhousing/i.test(name)) {
      return `SAE BELLHOUSING · ${Math.round(rpm)} RPM · ${Math.round(torqueAt(th, 1, boostBar, fault).total)} N·m`;
    }
    if (/Arched|Runner Plenum|Intake|Plenum/i.test(name + ' ' + sub)) {
      const tps = clamp(Math.round(14 + ((rpm / RPM_MAX) * 0.75 + (boostBar > 0 ? 0.25 : 0)) * 86), 14, 100);
      const mapBar = (0.9 + boostBar).toFixed(2);
      return `8-RUNNER PLENUM · MAP ${mapBar} BAR · ${tps}% TPS`;
    }
    if (/Serpentine|Tensioner/i.test(name + ' ' + sub)) {
      return `WP ${Math.round(rpm * 1.25)} RPM · ALT ${Math.round(rpm * 2.6)} RPM`;
    }
    if (/Camshaft/i.test(name)) {
      const camDeg = Math.round((((th * 0.5) % 360) + 360) % 360);
      return `CAM ${camDeg}° (1:2) · ${Math.round(rpm * 0.5)} RPM`;
    }
    if (/Crankshaft|Crankpin|Gear|Flywheel|Pulley|Counterweight|Journal|Timing|Bellhousing|Rotating/i.test(name + ' ' + sub)) {
      const crankDeg = Math.round(((th % 720) + 720) % 720);
      const tq = Math.round(torqueAt(th, 1, boostBar, fault).total);
      const kw = powerAt(th, rpm, 1, boostBar, fault).toFixed(1);
      return `${crankDeg}° · ${Math.round(rpm)} RPM · ${tq} N·m · ${kw} kW`;
    }
    return `FIRING CYL ${firingNow(th)} · ${Math.round(rpm)} RPM · ${powerAt(th, rpm, 1, boostBar, fault).toFixed(1)} kW`;
  };

  const V8_THEME = {
    bg: '#f4efe6',
    border: '#dfd4c5',
    ink: '#120d0a',
    mute: '#8e7a6c',
    accent: '#f26a3d',
    panel: 'rgba(255, 250, 242, 0.94)',
  };

  const inspector = createInspector({
    scene: st.scene,
    camera: st.camera,
    renderer: st.renderer,
    canvas,
    root: st.eng.root,
    domParent: app,
    accent: '#d95126',
    theme: {...V8_THEME, accent: '#d95126'},
    getLiveSpec,
    onExplode: () => {},
  });

  shell = createLiveShell({
    app,
    canvas,
    stage: st,
    ui,
    duration: TOUR_DURATION,
    idleSeconds: 1e9,
    chipTop: 58,
    theme: V8_THEME,
    orbitBounds: {minEl: -20, maxEl: 60, minK: 0.45, maxK: 2.2},
    shortcuts: [
      ['1 – 5', 'Camera views (Hero, Front, Side, Valley, Cyl)'],
      ['SPACE', 'Pause / play crank rotation'],
      ['← / →', 'Step crank angle ±15°'],
      ['↑ / ↓', 'Adjust engine speed ±300 RPM'],
      ['H', 'Hide / show HUD overlay'],
      ['Q', 'Cycle quality tier (HIGH / MED / LOW)'],
      ['M', 'Mute / unmute cross-plane V8 audio'],
      ['X', 'Toggle 50/50 longitudinal Half-Split cutaway'],
      ['Y', 'Toggle X-Ray cutaway housing'],
      ['W', 'Toggle CAD wireframe topology'],
      ['F', 'Cycle fault mode (Normal / Misfire / Knock / Overheat)'],
      ['S', 'Save clean 3D PNG snapshot'],
      ['DBL-CLICK', 'Reset camera orbit & zoom'],
      ['ESC', 'Clear pinned part inspector / close help'],
      ['?', 'Toggle this shortcuts guide'],
    ],
    inspector,
    audio,
    onStartTour() {
      paused = false;
      playI = 2;
      view = 'hero';
      cyl = 1;
      rpm = 1100;
      rpmTarget = 1100;
      cut = 'glass';
      xray = false;
      faultI = 0;
      st.eng.setXray?.(false);
      st.eng.setWireframe?.(false);
      Object.assign(ov, {callouts: 1, charge: 1, arrows: 1, isolate: 0, refract: 1, charts: 1, boost: 0, split: 0, wire: 0});
      shell?.syncExplodeUI(0);
      shell?.syncCutUI(0);
    },
    onTakeOver(cyc) {
      view = tourCamName(cyc);
      viewAt = shell.T;
      ov.isolate = 0;
    },
    onKey(key, e) {
      const v = {1: 'hero', 2: 'front', 3: 'side', 4: 'valley', 5: 'cyl'}[key];
      if (v) {
        shell.takeOver();
        setView(v);
      } else if (key === ' ') {
        shell.takeOver();
        paused = !paused;
      } else if (key === 'arrowleft') {
        shell.takeOver();
        paused = true;
        th -= 15;
      } else if (key === 'arrowright') {
        shell.takeOver();
        paused = true;
        th += 15;
      } else if (key === 'arrowup') {
        shell.takeOver();
        rpmTarget = clamp(rpmTarget + 300, 300, RPM_MAX);
      } else if (key === 'arrowdown') {
        shell.takeOver();
        rpmTarget = clamp(rpmTarget - 300, 300, RPM_MAX);
      } else if (key === 'x') {
        shell.takeOver();
        ov.split = ov.split ? 0 : 1;
      } else if (key === 'y') {
        shell.takeOver();
        xray = !xray;
        st.eng.setXray?.(xray);
      } else if (key === 'w') {
        shell.takeOver();
        ov.wire = ov.wire ? 0 : 1;
        st.eng.setWireframe?.(!!ov.wire);
      } else if (key === 'f') {
        shell.takeOver();
        faultI = (faultI + 1) % FAULTS.length;
      } else {
        return false;
      }
      e.preventDefault();
      return true;
    },
  });

  // Scrubbing SECTION activates section mode; clicking RESET restores solid cutaway
  shell.cutInput?.addEventListener('input', () => {
    cut = 'section';
  });
  shell.bar.querySelector('[data-testid="reset-inspector"]')?.addEventListener('click', () => {
    cut = 'glass';
    ov.split = 0;
    ov.wire = 0;
    xray = false;
    faultI = 0;
    st.eng.setXray?.(false);
    st.eng.setWireframe?.(false);
  });

  // ------------------------------------------------------------ controls
  const setView = (v) => {
    view = v;
    viewAt = shell.T;
    shell.resetOrbit();
    ov.isolate = v === 'cyl' ? 1 : 0;
  };
  for (const k of CAMS) {
    ui.btn[k].addEventListener('click', () => {
      shell.takeOver();
      pulseBtn(k);
      setView(k);
    });
  }
  for (const k of CUTS) {
    ui.btn[k].addEventListener('click', () => {
      shell.takeOver();
      pulseBtn(k);
      cut = k;
      ov.split = 0;
      if (k !== 'section') shell.syncCutUI(0);
    });
  }
  for (const k of OVERLAYS) {
    ui.btn[k].addEventListener('click', () => {
      shell.takeOver();
      pulseBtn(k);
      ov[k] = ov[k] ? 0 : 1;
      if (k === 'wire') st.eng.setWireframe?.(!!ov.wire);
    });
  }
  for (const [k, tgtRpm] of [['idle', 750], ['cruise', 2800], ['redline', 7000]]) {
    ui.btn[k]?.addEventListener('click', () => {
      shell.takeOver();
      pulseBtn(k);
      rpmTarget = tgtRpm;
    });
  }
  ui.btn.xray?.addEventListener('click', () => {
    shell.takeOver();
    pulseBtn('xray');
    xray = !xray;
    st.eng.setXray?.(xray);
  });
  ui.btn.fault?.addEventListener('click', () => {
    shell.takeOver();
    pulseBtn('fault');
    faultI = (faultI + 1) % FAULTS.length;
  });
  ui.btn.pause.addEventListener('click', () => {
    shell.takeOver();
    pulseBtn('pause');
    paused = !paused;
  });
  for (const [k, d] of [['back', -15], ['fwd', 15]]) {
    ui.btn[k].addEventListener('click', () => {
      shell.takeOver();
      pulseBtn(k);
      paused = true;
      th += d;
    });
  }
  // the firing order: click a cylinder to track it
  ORDER.forEach((c, i) => {
    const [x, y] = ui.foSpot(i);
    const d = document.createElement('div');
    d.className = 'hit';
    Object.assign(d.style, {left: `${x - 14}px`, top: `${y - 14}px`, width: '28px', height: '28px', borderRadius: '50%'});
    d.addEventListener('click', () => {
      shell.takeOver();
      pulse(x, y);
      cyl = c;
      if (view === 'cyl') viewAt = shell.T - 0.01;
    });
    ui.root.appendChild(d);
  });
  // the two sliders: drag along their tracks
  const slider = (knobAt, apply) => {
    const [x0, y] = knobAt(0);
    const [x1] = knobAt(1);
    const d = document.createElement('div');
    d.className = 'hit ew';
    Object.assign(d.style, {left: `${x0 - 8}px`, top: `${y - 11}px`, width: `${x1 - x0 + 16}px`, height: '22px'});
    const move = (e) => {
      const [x] = shell.toStage(e.clientX, e.clientY);
      apply(clamp((x - x0) / (x1 - x0), 0, 1));
      shell.touch();
    };
    d.addEventListener('pointerdown', (e) => {
      shell.takeOver();
      d.setPointerCapture(e.pointerId);
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      move(e);
    });
    ui.root.appendChild(d);
  };
  slider(ui.speedKnob, (k) => (rpmTarget = clamp(k * RPM_MAX, 300, RPM_MAX)));
  slider(ui.playKnob, (k) => (playI = Math.round(k * (PLAYS.length - 1))));

  // valve timing chart: click or drag horizontally across 0°..720° to scrub crank phase
  if (ui.vt && ui.vtPlot) {
    const scrubAt = (e) => {
      const [sx] = shell.toStage(e.clientX, e.clientY);
      const u = clamp((sx - ui.vtPlot.x) / ui.vtPlot.w, 0, 1);
      paused = true;
      th = FIRE[cyl] + Math.min(719.9, u * 720);
      shell.touch();
    };
    ui.vt.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      shell.takeOver();
      ui.vt.setPointerCapture?.(e.pointerId);
      const move = (ev) => scrubAt(ev);
      const up = (ev) => {
        try {
          ui.vt.releasePointerCapture?.(ev.pointerId);
        } catch (_) {}
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
      scrubAt(e);
    });
  }

  // ------------------------------------------------------------ the frame
  shell.start(({T, dt, apOn, cyc, off, explode, cutOffset}) => {
    let tgt;
    let cursor;
    let since;
    let solo = false;
    const activeTour = apOn;
    if (activeTour) {
      view = tourCamName(cyc);
      cyl = 1;
      rpmTarget = tourRpmAt(cyc);
      tgt = tourCamAt(cyc);
      cut = 'glass';
      ov.isolate = 0;
      ov.boost = cyc >= 11.5 && cyc < 15.0 ? 1 : 0;
      const wantXray = cyc >= 15.0 && cyc < 18.5;
      if (xray !== wantXray) {
        xray = wantXray;
        st.eng.setXray?.(xray);
      }
      const wantWire = cyc >= 18.5 && cyc < 21.2 ? 1 : 0;
      if (ov.wire !== wantWire) {
        ov.wire = wantWire;
        st.eng.setWireframe?.(!!wantWire);
      }
      since = cyc;
      cursor = {x: -99, y: -99, press: false, ring: 0, ringX: 0, ringY: 0};
    } else {
      since = T - viewAt;
      tgt = VIEW_FN[view](since, cyl);
      tgt.az += off.az;
      tgt.el = clamp(tgt.el + off.el, -10, 80);
      tgt.d *= off.k;
      solo = !!ov.isolate;
      const rk = Math.max(0, 1 - (T - ring.t) / 0.55);
      cursor = {x: -99, y: -99, press: false, ring: rk, ringX: ring.x, ringY: ring.y};
    }

    rpm += (rpmTarget - rpm) * (1 - Math.exp(-dt / 0.35));
    if (!paused) th += (rpm / 60) * 360 * dt * PLAYS[playI];

    const k = 1 - Math.exp(-dt / (activeTour ? 0.25 : 0.45));
    cam.az += wrap(tgt.az - cam.az) * k;
    for (const key of ['tx', 'ty', 'tz', 'el', 'd', 'sx', 'sy']) cam[key] += (tgt[key] - cam[key]) * k;

    const boostBar = ov.boost ? 0.8 : 0;
    const fault = FAULTS[faultI];
    const livePulse = audio?.getPulse?.() ?? 0;
    const firePhase = ((th % 90) + 90) % 90;
    const phasePulse = paused ? 0 : Math.pow(Math.max(0, 1 - firePhase / 42), 1.65) * (0.62 + 0.38 * (rpm / RPM_MAX));
    const audioPulse = audio?.enabled ? Math.min(1, Math.max(livePulse, phasePulse * 0.45)) : phasePulse;
    if (ov.split) st.setCut('section', cutOffset * 0.35, HALF_NORM);
    else st.setCut(cut, CYL[cyl - 1].z * 0.001 + cutOffset * 0.45);
    st.eng.setRefract(!!ov.refract);
    st.frame(th, {...cam, az: cam.az * D2R, el: cam.el * D2R}, {solo: solo ? cyl - 1 : -1, charge: ov.charge, arrows: ov.arrows, explode, boostBar, audioPulse, rpm, fault});

    audio.update({kind: 'v8', th, cyl, rpm, firing: firingNow(th), playScale: PLAYS[playI], paused, boostBar, fault});

    for (const n of ui.root.querySelectorAll('[data-g="charts"]')) n.style.visibility = ov.charts ? '' : 'hidden';
    frameConsole(T, {
      th,
      cam: view,
      cyl,
      rpm,
      cursor,
      since,
      live: {solo, overlays: {...ov}, cut, paused, playText: playText(PLAYS[playI]), playK: playI / (PLAYS.length - 1), xray, fault},
    });
  });

  window.LIVE = {
    st,
    cam,
    shell,
    inspector,
    audio,
    startTour: () => shell.startTour(),
    takeOver: () => shell.takeOver(),
    get tier() {
      return shell.tier;
    },
    get T() {
      return shell.T;
    },
  };
}
