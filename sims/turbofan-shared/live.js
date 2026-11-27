// GTF-1200 Geared Turbofan interactive runtime: integrates the 3D studio stage (stage.js),
// telemetry console (console.js), 26s Auto-Tour script (film.js), shared live shell (live-shell.js),
// dynamic Part Inspector + Explode + Longitudinal Section Scrub (inspector.js), and dual-spool WebAudio (webaudio.js).
import {createInspector} from '../kit/inspector.js';
import {createLiveShell, STAGE_H, STAGE_W} from '../kit/live-shell.js';
import {createAudioEngine} from '../kit/webaudio.js';
import {CAMS, createConsole, CUTS, OVERLAYS, STATION_PICKER} from './console.js';
import {camAt, camName, DURATION, makeConsoleFrame, makeCursor, SCRIPT, stationAt, throttleAt, VIEW_FN} from './film.js';
import {createTurbofanStage} from './stage.js';
import {cycleAt} from './thermo.js';

const D2R = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoother = (x) => {
  const u = clamp(x, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
};
const ss = (a, b, t) => smoother((t - a) / (b - a));
const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

const PLAYS = [1 / 60, 1 / 40, 1 / 30, 1 / 15, 1 / 8, 1 / 3, 1];
const playText = (p) => (p >= 1 ? '1× SPEED' : `1 / ${Math.round(1 / p)} SPEED`);

const CONSOLE_CSS = `
#app{position:absolute!important;inset:auto!important;left:0;top:0;width:1600px;height:900px;transform-origin:0 0}
.tb,.stb{pointer-events:auto;cursor:pointer}
.tb:hover,.stb:hover{filter:brightness(.95)}
.hit{position:absolute;pointer-events:auto;cursor:pointer}
.hit.ew{cursor:ew-resize}
[data-testid="brayton-chart"]{pointer-events:auto;cursor:ew-resize}
`;

function liveSpecForPart(part, cy) {
  const txt = `${part?.name || ''} ${part?.subsystem || ''}`.toUpperCase();
  if (txt.includes('SUN') || txt.includes('PLANET') || txt.includes('RING') || txt.includes('CARRIER') || txt.includes('GEARBOX') || txt.includes('FDGS') || txt.includes('LP INNER')) {
    return [
      {label: 'SUN (LPT)', value: `${Math.round(cy.lptRpm)} RPM`},
      {label: 'RING (FAN)', value: `${Math.round(cy.fanRpm)} RPM (3.06:1)`},
    ];
  }
  if (txt.includes('FAN') || txt.includes('SPINNER') || txt.includes('OUTLET GUIDE')) {
    return [
      {label: 'N1 SPOOL', value: `${cy.n1Pct.toFixed(1)}% · ${Math.round(cy.fanRpm)} RPM`},
      {label: 'FPR / BPR', value: `${cy.fpr.toFixed(2)} · 12.0:1`},
    ];
  }
  if (txt.includes('NACELLE') || txt.includes('INLET') || txt.includes('CORE SPLITTER')) {
    return [
      {label: 'MASS FLOW', value: `${cy.massFlowKgS.toFixed(0)} kg/s`},
      {label: 'BYPASS / CORE', value: `${cy.bypassFlowKgS.toFixed(0)} / ${cy.coreFlowKgS.toFixed(1)} kg/s`},
    ];
  }
  if (txt.includes('LPC') || txt.includes('BOOSTER')) {
    return [
      {label: 'S2.5', value: `${cy.P25.toFixed(1)} bar · ${Math.round(cy.T25)} K`},
      {label: 'LPC PR', value: `${cy.lpcPr.toFixed(2)} : 1`},
    ];
  }
  if (txt.includes('HPC') || txt.includes('HP OUTER') || txt.includes('BLEED')) {
    return [
      {label: 'N2 / S3', value: `${cy.n2Pct.toFixed(1)}% · ${cy.P3.toFixed(1)} bar`},
      {label: 'T3 / OPR', value: `${Math.round(cy.T3)} K · ${cy.opr.toFixed(1)}:1`},
    ];
  }
  if (txt.includes('COMBUSTOR') || txt.includes('FUEL') || txt.includes('INJECTOR')) {
    return [
      {label: 'S4 TET', value: `${Math.round(cy.T4)} K · ${cy.P4.toFixed(1)} bar`},
      {label: 'FUEL FLOW', value: `${cy.fuelFlowKgS.toFixed(2)} kg/s`},
    ];
  }
  if (txt.includes('HPT') || txt.includes('HP TURBINE')) {
    return [
      {label: 'S4.5', value: `${cy.P45.toFixed(1)} bar · ${Math.round(cy.T45)} K`},
      {label: 'N2 SPOOL', value: `${Math.round(cy.coreRpm)} RPM`},
    ];
  }
  if (txt.includes('LPT') || txt.includes('LP TURBINE')) {
    return [
      {label: 'S5 EGT', value: `${Math.round(cy.egtC)} °C · ${cy.P5.toFixed(1)} bar`},
      {label: 'LPT SHAFT', value: `${Math.round(cy.lptRpm)} RPM`},
    ];
  }
  if (txt.includes('AGB') || txt.includes('ACCESSORY') || txt.includes('IDG') || txt.includes('PUMP') || txt.includes('TRANSFER') || txt.includes('TOWER')) {
    return [
      {label: 'N2 PTO DRIVE', value: `${cy.n2Pct.toFixed(1)}% · ${Math.round(cy.coreRpm)} RPM`},
      {label: 'FUEL / CORE', value: `${cy.fuelFlowKgS.toFixed(2)} kg/s · ${cy.P3.toFixed(1)} bar`},
    ];
  }
  if (txt.includes('NOZZLE') || txt.includes('EXHAUST')) {
    return [
      {label: 'NET THRUST', value: `${cy.thrustKn.toFixed(1)} kN`},
      {label: 'EGT / TSFC', value: `${Math.round(cy.egtC)} °C · ${cy.tsfc.toFixed(1)}`},
    ];
  }
  return [
    {label: 'THRUST', value: `${cy.thrustKn.toFixed(1)} kN`},
    {label: 'N1 / N2', value: `${cy.n1Pct.toFixed(1)}% / ${cy.n2Pct.toFixed(1)}%`},
  ];
}

export function runLive() {
  const style = document.createElement('style');
  style.textContent = CONSOLE_CSS;
  document.head.appendChild(style);

  const app = document.getElementById('app');
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  app.appendChild(canvas);

  const st = createTurbofanStage({canvas});
  const ui = createConsole(app);
  const tourCursor = makeCursor(ui);
  const frameConsole = makeConsoleFrame(ui, st);

  // ------------------------------------------------------------ state
  let fanDeg = 8;
  let n2Deg = 14;
  let simTime = 0;
  let throttle = 0.25;
  let throttleTarget = 0.25;
  let playI = 2; // 1 / 30 SPEED
  let paused = false;
  let view = 'hero';
  let viewAt = 0;
  let station = 'FAN';
  let cut = 'glass';
  const ov = {callouts: 1, flow: 1, plasma: 1, isolate: 0, charts: 1, xray: 0};
  const cam = {...VIEW_FN.open(0)};
  let ring = {t: -9, x: 0, y: 0};
  const pulse = (x, y) => (ring = {t: shell?.T ?? 0, x, y});
  const pulseBtn = (k) => ui.spots[k] && pulse(...ui.spots[k]);

  let shell = null;
  const audio = createAudioEngine({kind: 'turbofan'});

  const setView = (v) => {
    view = v;
    viewAt = shell.T;
    shell.resetOrbit();
  };

  shell = createLiveShell({
    app,
    canvas,
    stage: st,
    ui,
    duration: DURATION,
    chipTop: 58,
    orbitBounds: {minEl: -25, maxEl: 65, minK: 0.42, maxK: 2.2},
    audio,
    shortcuts: [
      ['1 – 6', 'Switch camera (Hero, Front, Side, Gearbox, Burner, Turbine)'],
      ['SPACE', 'Pause / resume spool rotation'],
      ['← / →', 'Step throttle −10% / +10%'],
      ['H', 'Hide / show telemetry console'],
      ['Y', 'Toggle X-Ray housing transparency'],
      ['Q', 'Cycle quality tier (HIGH / MED / LOW)'],
      ['M', 'Toggle dual-spool turbofan WebAudio'],
      ['S', 'Save clean PNG snapshot'],
      ['DBL-CLICK', 'Reset camera orbit & zoom'],
      ['ESC', 'Clear pinned part / close modal'],
      ['?', 'Toggle this shortcut guide'],
    ],
    onStartTour() {
      paused = false;
      playI = 2;
      cut = 'glass';
      Object.assign(ov, {callouts: 1, flow: 1, plasma: 1, isolate: 0, charts: 1, xray: 0});
      st.eng.setXray?.(false);
      shell?.syncExplodeUI(0);
      shell?.syncCutUI(0);
    },
    onTakeOver(cyc) {
      view = camName(cyc);
      station = stationAt(cyc);
      const tNow = shell.T;
      const lastCamEv = SCRIPT.filter((e) => e.cam && e.t <= cyc).pop();
      viewAt = tNow - (cyc - (lastCamEv ? lastCamEv.t : 0));
      if (view === 'hero' && cyc < 3.5) viewAt = tNow - 4;
      throttleTarget = throttle;
    },
    onKey(key, e) {
      const v = {1: 'hero', 2: 'front', 3: 'side', 4: 'gearbox', 5: 'burner', 6: 'turbine'}[key];
      if (v) {
        shell.takeOver();
        setView(v);
      } else if (key === ' ') {
        shell.takeOver();
        paused = !paused;
      } else if (key === 'arrowleft') {
        shell.takeOver();
        throttleTarget = clamp(throttleTarget - 0.1, 0, 1);
      } else if (key === 'arrowright') {
        shell.takeOver();
        throttleTarget = clamp(throttleTarget + 0.1, 0, 1);
      } else if (key === 'arrowup') {
        shell.takeOver();
        throttleTarget = clamp(throttleTarget + 0.05, 0, 1);
      } else if (key === 'arrowdown') {
        shell.takeOver();
        throttleTarget = clamp(throttleTarget - 0.05, 0, 1);
      } else if (key === 'y') {
        shell.takeOver();
        pulseBtn('xray');
        ov.xray = ov.xray ? 0 : 1;
        st.eng.setXray?.(!!ov.xray);
      } else {
        return false;
      }
      e.preventDefault();
      return true;
    },
  });

  const inspector = createInspector({
    scene: st.scene,
    camera: st.camera,
    renderer: st.renderer,
    canvas,
    root: st.eng.root,
    domParent: app,
    stageSize: {w: STAGE_W, h: STAGE_H},
    toStage: shell.toStage,
    accent: '#d6182b',
    onExplode: () => {},
    getLiveSpec: (part) => liveSpecForPart(part, cycleAt(throttle)),
  });
  shell.connectInspector(inspector);

  // Scrubbing SECTION activates section mode; clicking RESET restores glass cutaway
  shell.cutInput?.addEventListener('input', () => {
    cut = 'section';
  });
  shell.bar.querySelector('[data-testid="reset-inspector"]')?.addEventListener('click', () => {
    cut = 'glass';
    ov.isolate = 0;
    ov.xray = 0;
    st.eng.setXray?.(false);
  });

  // ------------------------------------------------------------ console controls
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
      if (k !== 'section') shell.syncCutUI(0);
    });
  }
  for (const k of OVERLAYS) {
    ui.btn[k].addEventListener('click', () => {
      shell.takeOver();
      pulseBtn(k);
      ov[k] = ov[k] ? 0 : 1;
    });
  }
  ui.btn.pause.addEventListener('click', () => {
    shell.takeOver();
    pulseBtn('pause');
    paused = !paused;
  });
  for (const [k, d] of [
    ['back', -0.1],
    ['fwd', 0.1],
  ]) {
    ui.btn[k].addEventListener('click', () => {
      shell.takeOver();
      pulseBtn(k);
      throttleTarget = clamp(throttleTarget + d, 0, 1);
    });
  }

  // Bottom-center Station Picker
  const STATION_VIEW_MAP = {
    FAN: 'front',
    GEARBOX: 'gearbox',
    HPC: 'side',
    BURNER: 'burner',
    TURBINE: 'turbine',
    NOZZLE: 'turbine',
  };
  for (const id of STATION_PICKER) {
    ui.stationBtn[id].addEventListener('click', () => {
      shell.takeOver();
      pulseBtn(`station_${id}`);
      station = id;
      if (STATION_VIEW_MAP[id]) setView(STATION_VIEW_MAP[id]);
    });
  }

  // Throttle & Playback sliders
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
      e.stopPropagation();
      shell.takeOver();
      d.setPointerCapture?.(e.pointerId);
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
      move(e);
    });
    ui.root.appendChild(d);
  };
  slider(ui.throttleKnob, (u) => {
    throttleTarget = u;
    throttle = u;
  });
  slider(ui.playKnob, (k) => {
    playI = Math.round(k * (PLAYS.length - 1));
  });

  // Interactive Brayton T-P chart: pointer click/drag scrubs throttle 0..1 and takes over from auto-tour
  if (ui.brayton && ui.braytonPlot) {
    const scrubAt = (e) => {
      const [sx] = shell.toStage(e.clientX, e.clientY);
      const u = clamp((sx - ui.braytonPlot.x) / ui.braytonPlot.w, 0, 1);
      throttleTarget = u;
      throttle = u;
      shell.touch();
    };
    ui.brayton.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      shell.takeOver();
      ui.brayton.setPointerCapture?.(e.pointerId);
      const move = (ev) => scrubAt(ev);
      const up = (ev) => {
        try {
          ui.brayton.releasePointerCapture?.(ev.pointerId);
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

  // ------------------------------------------------------------ frame loop
  shell.start(({T, dt, apOn, cyc, loop, off, explode, cutOffset}) => {
    let tgt;
    let cursor;
    let since;
    let tourActive = apOn;

    if (tourActive && loop > 0) {
      shell.takeOver();
      tourActive = false;
      view = 'hero';
      viewAt = T;
      station = 'FAN';
      cut = 'glass';
      ov.isolate = 0;
      ov.xray = 0;
      ov.flow = 1;
      ov.plasma = 1;
      throttleTarget = 0.25;
      paused = false;
      shell.resetOrbit();
    }

    if (tourActive) {
      view = camName(cyc);
      station = stationAt(cyc);
      cut = 'glass';
      ov.isolate = cyc >= 3.5 && cyc < 7.0 ? 1 : 0;
      ov.xray = cyc >= 7.0 && cyc < 14.2 ? 1 : 0;
      throttleTarget = cyc >= 21.8 ? 0.25 : throttleAt(cyc);
      tgt = camAt(cyc);
      const t0 = SCRIPT.filter((e) => e.cam && e.t <= cyc).pop().t;
      since = cyc - t0;
      cursor = tourCursor(cyc);
    } else {
      since = T - viewAt;
      tgt = VIEW_FN[view](since);
      tgt.az += off.az;
      tgt.el = clamp(tgt.el + off.el, -15, 78);
      tgt.d *= off.k;
      const rk = Math.max(0, 1 - (T - ring.t) / 0.55);
      cursor = {x: -99, y: -99, press: false, ring: rk, ringX: ring.x, ringY: ring.y};
    }

    throttle += (throttleTarget - throttle) * (1 - Math.exp(-dt / 0.22));
    const cy = cycleAt(throttle);
    const playScale = PLAYS[playI];
    if (!paused) {
      fanDeg += (cy.fanRpm / 60) * 360 * dt * playScale;
      n2Deg += (cy.coreRpm / 60) * 360 * dt * playScale;
      simTime += dt * playScale * 30;
    }

    const k = 1 - Math.exp(-dt / (apOn ? 0.18 : 0.42));
    cam.az += wrap(tgt.az - cam.az) * k;
    for (const key of ['tx', 'ty', 'tz', 'el', 'd', 'sx', 'sy']) {
      cam[key] += (tgt[key] - cam[key]) * k;
    }

    const solo = ov.isolate ? station : -1;
    st.setCut(cut, cutOffset * 0.85);
    st.eng.setXray?.(!!ov.xray);
    st.frame(
      {fanDeg, n2Deg, throttle, time: simTime},
      {...cam, az: cam.az * D2R, el: cam.el * D2R},
      {solo, flow: ov.flow, plasma: ov.plasma, explode, throttle},
    );

    audio.update({
      kind: 'turbofan',
      n1: cy.n1Pct,
      n2: cy.n2Pct,
      throttle,
      playScale,
      paused,
    });

    for (const n of ui.root.querySelectorAll('[data-g="charts"]')) {
      n.style.visibility = ov.charts ? '' : 'hidden';
    }

    frameConsole(T, {
      fanDeg,
      n2Deg,
      throttle,
      cam: view,
      station,
      cursor,
      since,
      live: {
        solo: !!ov.isolate,
        overlays: {...ov},
        cut,
        paused,
        playText: playText(playScale),
        playK: playI / (PLAYS.length - 1),
      },
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
    get throttle() {
      return throttle;
    },
    get station() {
      return station;
    },
  };
}
