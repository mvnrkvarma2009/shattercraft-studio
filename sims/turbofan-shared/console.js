// GTF-1200 Geared Turbofan telemetry console: 1600x900 hairline museum light-studio overlay
// (#f3f3f4, #16181b, #d6182b) matching sims/v8-shared/console.js.
// Displays dual-spool N1/N2 readouts, Thrust/EGT/Fuel Flow, live 3.06:1 star planetary gearbox SVG,
// 12:1 bypass vs core airflow schematic, station state, interactive Brayton T-P station profile
// (DRAG TO SCRUB throttle 0-100%), Brayton cycle balance, bottom-center station picker, transport,
// camera/cutaway/overlay toggles, and 3D leader callouts.
import {attachFlickerText} from '../kit/flicker-text.js';
import {braytonProfile, cycleAt, E, gearboxAngles, STATION_MAP, STATIONS} from './thermo.js';

export const C = {
  ink: '#16181b',
  mute: '#8b8f95',
  faint: '#c9ccd0',
  line: '#e1e3e6',
  panel: 'rgba(248,248,249,.94)',
  red: '#d6182b',
  blue: '#3d8fe0',
  grey: '#5d6670',
  orange: '#f05a23',
  exh: '#8b8f95',
};

export const CAMS = ['hero', 'front', 'side', 'gearbox', 'burner', 'turbine'];
export const CUTS = ['glass', 'section', 'solid'];
export const OVERLAYS = ['callouts', 'flow', 'plasma', 'isolate', 'charts', 'xray'];
export const STATION_PICKER = ['FAN', 'GEARBOX', 'HPC', 'BURNER', 'TURBINE', 'NOZZLE'];

const CSS = `
#app{font-family:Inter,system-ui,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.ui{position:absolute;inset:0;pointer-events:none}
.pn{position:absolute;background:${C.panel};border:1px solid ${C.line};box-shadow:0 1px 2px rgba(20,22,26,.04)}
.cp{font-size:9.6px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;white-space:nowrap}
.mu{color:${C.mute}}
.tb{position:absolute;height:19px;padding:0 7px;display:flex;align-items:center;justify-content:center;font-size:8.8px;font-weight:600;letter-spacing:.9px;text-transform:uppercase;border:1px solid ${C.line};background:#fff;color:${C.ink};white-space:nowrap}
.stb{position:absolute;height:25px;display:flex;align-items:center;justify-content:center;font-size:8.8px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;border:1px solid ${C.line};background:#fff;color:${C.ink};white-space:nowrap;border-radius:2px}
.call{position:absolute;white-space:nowrap}
.call b{display:block;font-size:11.5px;font-weight:600;letter-spacing:.1px}
.call span{display:block;font-size:8.6px;font-weight:500;letter-spacing:1.4px;color:${C.mute};text-transform:uppercase;margin-top:2px}
.cur{position:absolute;left:0;top:0;z-index:50;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))}
.ring{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:1.5px solid ${C.red};opacity:0;z-index:49}
`;

const el = (h) => {
  const d = document.createElement('div');
  d.innerHTML = h.trim();
  return d.firstElementChild;
};

function gearPath(teeth, rOut, rRoot, holeR = 0) {
  let d = '';
  const da = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a0 = i * da;
    const pts = [
      [rRoot, a0],
      [rRoot, a0 + da * 0.2],
      [rOut, a0 + da * 0.34],
      [rOut, a0 + da * 0.62],
      [rRoot, a0 + da * 0.76],
    ];
    pts.forEach(([r, a], k) => {
      const x = (r * Math.cos(a)).toFixed(2);
      const y = (r * Math.sin(a)).toFixed(2);
      d += `${i === 0 && k === 0 ? 'M' : 'L'}${x} ${y}`;
    });
  }
  d += 'Z';
  if (holeR > 0) {
    d += ` M${holeR.toFixed(2)} 0 A${holeR} ${holeR} 0 1 0 ${(-holeR).toFixed(2)} 0 A${holeR} ${holeR} 0 1 0 ${holeR.toFixed(2)} 0 Z`;
  }
  return d;
}

function internalGearPath(teeth, rTip, rRoot, rOuter) {
  let d = `M${rOuter} 0 A${rOuter} ${rOuter} 0 1 0 ${-rOuter} 0 A${rOuter} ${rOuter} 0 1 0 ${rOuter} 0 Z `;
  const da = (Math.PI * 2) / teeth;
  const off = -0.5 * da;
  for (let i = 0; i < teeth; i++) {
    const a0 = off - i * da;
    const pts = [
      [rRoot, a0],
      [rRoot, a0 - da * 0.2],
      [rTip, a0 - da * 0.34],
      [rTip, a0 - da * 0.62],
      [rRoot, a0 - da * 0.76],
    ];
    pts.forEach(([r, a], k) => {
      const x = (r * Math.cos(a)).toFixed(2);
      const y = (r * Math.sin(a)).toFixed(2);
      d += `${i === 0 && k === 0 ? 'M' : 'L'}${x} ${y}`;
    });
  }
  return d + 'Z';
}

function resolveStationMeta(stationId) {
  const id = String(stationId || 'FAN').toUpperCase();
  if (id === 'TURBINE') {
    return {
      id: 'TURBINE',
      code: 'S4.5–S5',
      name: '2+4 Dual-Spool Turbine',
      spool: 'N2 / LPT',
      desc: '2-stage HPT drives HPC · 4-stage LPT drives 3.06:1 gearbox',
    };
  }
  return STATION_MAP[id] || STATIONS[0];
}

export function createConsole(app) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const ui = el(`<div class="ui"></div>`);
  app.appendChild(ui);
  const add = (h) => {
    const n = el(h);
    ui.appendChild(n);
    return n;
  };

  // ------------------------------------------------------------ header & dual-spool N1/N2 readouts
  add(`<div style="position:absolute;left:35px;top:33px;width:43px;height:3px;background:${C.red}"></div>`);
  const authorEl = add(`<div class="cp" data-testid="author-credit" style="position:absolute;left:88px;top:29px;padding-left:8px;border-left:1px solid ${C.faint};font-size:8.6px;font-weight:600;letter-spacing:1.5px;color:${C.mute}">MADE BY <span data-flicker-nv style="color:${C.ink}">NAGENDRA VARMA</span></div>`);
  attachFlickerText(authorEl.querySelector('[data-flicker-nv]'), {color: C.ink});
  add(`<div style="position:absolute;left:35px;top:46px;font-size:21.5px;font-weight:700;letter-spacing:-.25px">GTF-1200 <span style="color:${C.red}">·</span> Geared Turbofan</div>`);
  add(`<div class="cp" style="position:absolute;left:35px;top:76px;font-weight:500;letter-spacing:1.35px;font-size:8.8px">12:1 BYPASS &nbsp;•&nbsp; 3.06:1 STAR PLANETARY &nbsp;•&nbsp; DUAL-SPOOL</div>`);

  add(`<div class="cp mu" style="position:absolute;left:35px;top:98px;font-size:8.4px">N1 FAN SPOOL</div>`);
  add(`<div class="cp mu" style="position:absolute;left:184px;top:98px;font-size:8.4px">N2 CORE SPOOL</div>`);
  const n1Big = add(`<div data-testid="readout-n1" style="position:absolute;left:33px;top:110px;font-size:44px;font-weight:800;letter-spacing:-2.4px;color:${C.red};line-height:1">22.0<span style="font-size:17px;letter-spacing:0;margin-left:2px">%</span></div>`);
  const n2Big = add(`<div data-testid="readout-n2" style="position:absolute;left:183px;top:116px;font-size:29px;font-weight:700;letter-spacing:-1.4px;color:${C.ink};line-height:1">58.0<span style="font-size:13px;letter-spacing:0;margin-left:2px">%</span></div>`);
  const n1RpmEl = add(`<div class="cp mu" style="position:absolute;left:35px;top:157px;font-size:8.4px">748 RPM</div>`);
  const n2RpmEl = add(`<div class="cp mu" style="position:absolute;left:184px;top:157px;font-size:8.4px">6,032 RPM</div>`);

  add(`<div style="position:absolute;left:35px;top:172px;width:138px;height:6px;background:#e6e7e9"></div>`);
  const n1Fill = add(`<div style="position:absolute;left:35px;top:172px;height:6px;background:${C.red}"></div>`);
  add(`<div style="position:absolute;left:184px;top:172px;width:110px;height:6px;background:#e6e7e9"></div>`);
  const n2Fill = add(`<div style="position:absolute;left:184px;top:172px;height:6px;background:${C.ink}"></div>`);

  const metStrip = add(`<div data-testid="engine-metrics" style="position:absolute;left:35px;top:190px;width:259px;height:44px;display:grid;grid-template-columns:1fr 1fr 1fr;border-top:1px solid ${C.line};border-bottom:1px solid ${C.line};background:rgba(248,248,249,.78)"></div>`);
  const mkMetric = (label, testId, border, color = C.ink) => {
    const cell = el(`<div style="display:flex;flex-direction:column;justify-content:center;padding:0 7px;${border ? `border-left:1px solid ${C.line};` : ''}"><span class="cp mu" style="font-size:7.6px;letter-spacing:1.1px">${label}</span><span data-testid="${testId}" style="font-size:13.5px;font-weight:700;color:${color};margin-top:2px">0</span></div>`);
    metStrip.appendChild(cell);
    return cell.lastElementChild;
  };
  const thrustEl = mkMetric('THRUST', 'readout-thrust', false, C.red);
  const egtEl = mkMetric('EGT', 'readout-egt', true, C.ink);
  const fuelEl = mkMetric('FUEL FLOW', 'readout-fuel', true, C.ink);

  // ------------------------------------------------------------ left top: 3.06:1 star planetary gearbox SVG
  add(`<div class="pn" style="left:35px;top:244px;width:259px;height:218px"></div>`);
  add(`<div class="cp" style="position:absolute;left:46px;top:256px;font-weight:700;font-size:9px;letter-spacing:1.1px">3.06:1 GEARBOX</div>`);
  const gbxRpmEl = add(`<div class="cp mu" style="position:absolute;right:${1600 - 283}px;top:256px;font-size:8.2px;font-weight:500;letter-spacing:1px"></div>`);
  const gbxSvg = add(`<svg style="position:absolute;left:46px;top:273px" width="237" height="150" viewBox="0 0 237 150"></svg>`);
  add(`<div style="position:absolute;left:46px;top:427px;width:237px;height:1px;background:${C.line}"></div>`);
  add(`<div style="position:absolute;left:46px;top:434px;font-size:9.2px;color:${C.mute}">32T Sun → five 33T planets → 98T fan ring</div>`);
  add(`<div style="position:absolute;left:46px;top:447px;font-size:8.8px;color:${C.mute}">Fixed carrier · <b style="color:${C.ink}">ω_sun / ω_ring = −3.0625</b></div>`);

  // Prebuild static gear paths inside gbxSvg for smooth 60fps rotation transforms
  const gCx = 90;
  const gCy = 74;
  const mGbx = 1.12;
  const rSunP = (E.gearbox.sunTeeth * mGbx) / 2;
  const rPlanP = (E.gearbox.planetTeeth * mGbx) / 2;
  const rRingP = (E.gearbox.ringTeeth * mGbx) / 2;
  const rCarr = rSunP + rPlanP;
  const sunD = gearPath(E.gearbox.sunTeeth, rSunP + 1.1, rSunP - 1.3, 5.2);
  const planetD = gearPath(E.gearbox.planetTeeth, rPlanP + 1.1, rPlanP - 1.3, 4.4);
  const ringD = internalGearPath(E.gearbox.ringTeeth, rRingP - 1.1, rRingP + 1.3, rRingP + 8.5);

  let carrierLines = '';
  const planetCenters = [];
  for (let k = 0; k < E.gearbox.planets; k++) {
    const phi = (k * Math.PI * 2) / E.gearbox.planets;
    const px = gCx + rCarr * Math.cos(phi);
    const py = gCy + rCarr * Math.sin(phi);
    planetCenters.push([px, py]);
    carrierLines += `<line x1="${gCx}" y1="${gCy}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${C.faint}" stroke-width="1.2" stroke-dasharray="2 2"/>`;
  }
  gbxSvg.innerHTML = `
    <g id="gbx-ring" transform="rotate(0 ${gCx} ${gCy})">
      <path d="${ringD}" fill="#eceef1" fill-rule="evenodd" stroke="${C.ink}" stroke-width=".95"/>
      <circle cx="${(gCx + rRingP + 4.8).toFixed(1)}" cy="${gCy}" r="2.3" fill="${C.ink}"/>
    </g>
    ${carrierLines}
    <g id="gbx-sun" transform="rotate(0 ${gCx} ${gCy})">
      <path d="${sunD}" fill="rgba(214,24,43,.16)" fill-rule="evenodd" stroke="${C.red}" stroke-width="1.1"/>
      <circle cx="${(gCx + rSunP - 4.5).toFixed(1)}" cy="${gCy}" r="2" fill="${C.red}"/>
    </g>
    ${planetCenters
      .map(
        ([px, py], k) => `<g id="gbx-p${k}" transform="rotate(0 ${px.toFixed(2)} ${py.toFixed(2)})">
          <path d="${planetD}" transform="translate(${px.toFixed(2)} ${py.toFixed(2)})" fill="#fff" fill-rule="evenodd" stroke="${C.grey}" stroke-width=".95"/>
          <circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="2.2" fill="${C.ink}"/>
          ${k === 0 ? `<circle cx="${(px + rPlanP - 4.5).toFixed(2)}" cy="${py.toFixed(2)}" r="1.7" fill="${C.red}"/>` : ''}
        </g>`,
      )
      .join('')}
    <circle cx="${gCx}" cy="${gCy}" r="4.2" fill="#fff" stroke="${C.red}" stroke-width="1.3"/>
    <text x="164" y="34" font-size="8.2" font-weight="700" letter-spacing="1" fill="${C.red}">SUN 32T</text>
    <text id="gbx-sun-rpm" x="164" y="46" font-size="10" font-weight="700" fill="${C.ink}">0 RPM</text>
    <text x="164" y="68" font-size="8.2" font-weight="700" letter-spacing="1" fill="${C.grey}">5× PLANET</text>
    <text x="164" y="80" font-size="9.5" font-weight="600" fill="${C.ink}">33T HELICAL</text>
    <text x="164" y="102" font-size="8.2" font-weight="700" letter-spacing="1" fill="${C.ink}">RING 98T</text>
    <text id="gbx-ring-rpm" x="164" y="114" font-size="10" font-weight="700" fill="${C.ink}">0 RPM</text>
  `;
  const gbxRingG = gbxSvg.querySelector('#gbx-ring');
  const gbxSunG = gbxSvg.querySelector('#gbx-sun');
  const gbxPlanGs = planetCenters.map((_, k) => gbxSvg.querySelector(`#gbx-p${k}`));
  const gbxSunRpmTxt = gbxSvg.querySelector('#gbx-sun-rpm');
  const gbxRingRpmTxt = gbxSvg.querySelector('#gbx-ring-rpm');

  // ------------------------------------------------------------ left bottom: 12:1 bypass vs core airflow SVG
  add(`<div class="pn" style="left:35px;top:470px;width:259px;height:212px"></div>`);
  add(`<div class="cp" style="position:absolute;left:46px;top:482px;font-weight:700">12:1 BYPASS AIRFLOW</div>`);
  const flowTotalEl = add(`<div class="cp mu" style="position:absolute;right:${1600 - 283}px;top:482px;font-size:8.4px;font-weight:500"></div>`);
  const flowSvg = add(`<svg style="position:absolute;left:46px;top:500px" width="237" height="142" viewBox="0 0 237 142"></svg>`);
  add(`<div style="position:absolute;left:46px;top:646px;width:237px;height:1px;background:${C.line}"></div>`);
  const flowFoot = add(`<div style="position:absolute;left:46px;top:654px;font-size:9px;color:${C.mute}">OPR <b style="color:${C.ink}">0</b> &nbsp;·&nbsp; TSFC <b style="color:${C.ink}">0</b> g/kN·s</div>`);

  // ------------------------------------------------------------ transport (bottom-left)
  add(`<div class="pn" style="left:35px;top:774px;width:259px;height:111px"></div>`);
  const btn = {};
  btn.pause = add(`<div class="tb" style="left:45px;top:782px;width:99px;height:26px;background:${C.red};color:#fff;border-color:${C.red};font-size:9.6px">❚❚ &nbsp;PAUSE</div>`);
  btn.back = add(`<div class="tb" style="left:149px;top:782px;width:66px;height:26px;font-size:9.6px">−10%</div>`);
  btn.fwd = add(`<div class="tb" style="left:219px;top:782px;width:66px;height:26px;font-size:9.6px">+10%</div>`);
  add(`<div class="cp" style="position:absolute;left:45px;top:818px;font-weight:500">THROTTLE</div>`);
  const thrVal = add(`<div class="cp" style="position:absolute;right:${1600 - 284}px;top:818px;font-weight:700"></div>`);
  const SL = {x: 46, w: 238};
  add(`<div style="position:absolute;left:${SL.x}px;top:836px;width:${SL.w}px;height:2px;background:#e1e3e6"></div>`);
  const thrKnob = add(`<div style="position:absolute;top:831px;width:9px;height:11px;margin-left:-4.5px;background:${C.red}"></div>`);
  add(`<div class="cp" style="position:absolute;left:45px;top:851px;font-weight:500">PLAYBACK</div>`);
  const playVal = add(`<div class="cp" style="position:absolute;right:${1600 - 284}px;top:851px;font-weight:700"></div>`);
  add(`<div style="position:absolute;left:${SL.x}px;top:869px;width:${SL.w}px;height:2px;background:#e1e3e6"></div>`);
  const playKnob = add(`<div style="position:absolute;top:864px;width:9px;height:11px;margin-left:-4.5px;background:${C.red}"></div>`);

  // ------------------------------------------------------------ legend (top-center)
  add(`<div class="cp" style="position:absolute;left:566px;top:33px;display:flex;gap:16px;font-weight:500;font-size:9.4px">
    ${[
      ['COLD BYPASS', C.blue],
      ['COMPRESSED CORE', C.grey],
      ['COMBUSTION', C.orange],
      ['EXHAUST PLUME', C.red],
    ]
      .map(([n, c]) => `<span><i style="display:inline-block;width:15px;height:2.4px;background:${c};vertical-align:middle;margin-right:6px"></i>${n}</span>`)
      .join('')}</div>`);

  // ------------------------------------------------------------ right top: station state
  add(`<div class="pn" style="left:1318px;top:36px;width:245px;height:212px"></div>`);
  const stCode = add(`<div class="cp" style="position:absolute;left:1329px;top:47px;font-weight:600"></div>`);
  const stSpool = add(`<div class="cp mu" style="position:absolute;right:${1600 - 1552}px;top:47px;font-weight:500"></div>`);
  const stBig = add(`<div style="position:absolute;left:1329px;top:63px;font-size:18.5px;font-weight:700;letter-spacing:-.2px"></div>`);
  const stDesc = add(`<div style="position:absolute;left:1329px;top:87px;width:224px;font-size:9.5px;line-height:1.35;color:${C.mute}"></div>`);
  const stRows = add(`<div style="position:absolute;left:1329px;top:118px;width:224px;display:grid;grid-template-columns:1fr auto;row-gap:3px"></div>`);
  add(`<div style="position:absolute;left:1329px;top:163px;width:224px;height:1px;background:${C.line}"></div>`);
  const stBarBig = add(`<div style="position:absolute;left:1328px;top:171px;font-size:32px;font-weight:800;letter-spacing:-1.4px;color:${C.red};line-height:1"></div>`);
  const stBarUnit = add(`<div style="position:absolute;left:1395px;top:173px;font-size:9.2px;font-weight:600;letter-spacing:.9px;line-height:1.35">BAR<br><span style="color:${C.mute};font-size:7.8px">PRESSURE</span></div>`);
  const stTempBig = add(`<div style="position:absolute;right:${1600 - 1552}px;top:172px;text-align:right;font-size:21px;font-weight:700;letter-spacing:-.8px;color:${C.ink};line-height:1"></div>`);
  add(`<div class="cp mu" style="position:absolute;right:${1600 - 1552}px;top:196px;font-size:7.6px;letter-spacing:1.1px">TEMP (K)</div>`);
  add(`<div style="position:absolute;left:1329px;top:214px;width:224px;height:5px;background:#e6e7e9"></div>`);
  const stBarFill = add(`<div style="position:absolute;left:1329px;top:214px;height:5px;background:${C.red}"></div>`);
  add(`<div class="cp mu" style="position:absolute;left:1329px;top:225px;font-size:7.8px">0 BAR</div>`);
  add(`<div class="cp mu" style="position:absolute;right:${1600 - 1552}px;top:225px;font-size:7.8px">40 BAR</div>`);

  // ------------------------------------------------------------ right middle: interactive Brayton T-P station profile
  add(`<div class="pn" data-g="charts" style="left:1318px;top:256px;width:245px;height:212px"></div>`);
  add(`<div class="cp" data-g="charts" style="position:absolute;left:1329px;top:267px;font-weight:700;font-size:9px;letter-spacing:1.1px">BRAYTON T–P</div>`);
  add(`<div class="cp mu" data-g="charts" style="position:absolute;right:${1600 - 1552}px;top:267px;font-weight:500;font-size:8.4px;letter-spacing:1px">DRAG TO SCRUB</div>`);
  const brLeg = add(`<div class="cp" data-g="charts" style="position:absolute;left:1329px;top:284px;font-weight:500;font-size:8.6px"></div>`);
  const brayton = add(`<svg data-g="charts" data-testid="brayton-chart" style="position:absolute;left:1324px;top:300px;touch-action:none" width="234" height="162"></svg>`);

  // ------------------------------------------------------------ right lower: Brayton cycle & core metrics
  add(`<div class="pn" data-g="charts" style="left:1318px;top:476px;width:245px;height:186px"></div>`);
  add(`<div class="cp" data-g="charts" style="position:absolute;left:1329px;top:487px;font-weight:700">BRAYTON CYCLE LOOP</div>`);
  const tsVal = add(`<div class="cp mu" data-g="charts" style="position:absolute;right:${1600 - 1552}px;top:487px;font-weight:500"></div>`);
  const cySvg = add(`<svg data-g="charts" style="position:absolute;left:1324px;top:504px" width="234" height="150"></svg>`);

  // ------------------------------------------------------------ bottom-right: camera, cutaway, overlays
  add(`<div class="pn" style="left:1296px;top:668px;width:268px;height:217px"></div>`);
  const group = (title, keys, y, labels) => {
    add(`<div class="cp mu" style="position:absolute;left:1305px;top:${y}px;font-weight:500">${title}</div>`);
    let x = 1305;
    let yy = y + 15;
    keys.forEach((k) => {
      const w = Math.round(labels[k].length * 6.2 + 14);
      if (x + w > 1556) {
        x = 1305;
        yy += 23;
      }
      btn[k] = add(`<div class="tb"${k === 'xray' ? ' data-testid="tf-xray"' : ''} style="left:${x}px;top:${yy}px;width:${w}px">${labels[k]}</div>`);
      x += w + 4;
    });
  };
  const L = Object.fromEntries([...CAMS, ...CUTS, ...OVERLAYS].map((k) => [k, k === 'xray' ? 'X-RAY' : k.toUpperCase()]));
  group('CAMERA', CAMS, 676, L);
  group('CUTAWAY', CUTS, 743, L);
  group('OVERLAYS', OVERLAYS, 793, L);

  // ------------------------------------------------------------ bottom-center: station picker
  add(`<div class="cp mu" style="position:absolute;left:0;right:0;top:794px;text-align:center;font-weight:500"><span style="color:${C.ink}">STATION PICKER</span> &nbsp;— &nbsp;CLICK TO INSPECT</div>`);
  const stationBtn = {};
  {
    const widths = STATION_PICKER.map((id) => Math.round(id.length * 6.8 + 22));
    const gap = 8;
    const totalW = widths.reduce((a, b) => a + b, 0) + gap * (STATION_PICKER.length - 1);
    let x = 800 - totalW / 2;
    STATION_PICKER.forEach((id, i) => {
      const w = widths[i];
      stationBtn[id] = add(`<div class="stb" data-testid="station-${id.toLowerCase()}" style="left:${x.toFixed(1)}px;top:814px;width:${w}px">${id}</div>`);
      x += w + gap;
    });
  }
  const stationSub = add(`<div class="cp" style="position:absolute;left:0;right:0;top:850px;text-align:center;font-weight:600;font-size:8.6px;color:${C.ink}"></div>`);
  add(`<div class="cp mu" style="position:absolute;left:0;right:0;top:873px;text-align:center;font-weight:500">DRAG TO ORBIT &nbsp;·&nbsp; SCROLL TO ZOOM &nbsp;·&nbsp; DBL-CLICK RESET &nbsp;·&nbsp; H HIDES OVERLAY</div>`);

  // ------------------------------------------------------------ callouts, pointer
  const callSvg = add(`<svg data-callouts style="position:absolute;inset:0;overflow:visible" width="1600" height="900"></svg>`);
  const callG = add(`<div data-callouts style="position:absolute;inset:0"></div>`);
  const ring = add(`<div class="ring"></div>`);
  const cur = add(`<div class="cur"><svg width="22" height="22" viewBox="0 0 34 34"><path d="M4 3 L30 13.5 L17.5 17.5 L13.5 30 Z" fill="#111" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg></div>`);

  const centre = (n) => {
    const ur = ui.getBoundingClientRect();
    const r = n.getBoundingClientRect();
    const sc = ur.width ? ur.width / 1600 : 1;
    return [(r.left - ur.left + r.width / 2) / sc, (r.top - ur.top + r.height / 2) / sc];
  };

  const spots = {
    ...Object.fromEntries(Object.entries(btn).map(([k, n]) => [k, centre(n)])),
    ...Object.fromEntries(Object.entries(stationBtn).map(([k, n]) => [`station_${k}`, centre(n)])),
  };
  const knobX = (v) => SL.x + Math.min(1, Math.max(0, v)) * SL.w;

  const pointer = (c = {x: -99, y: -99, press: false, ring: 0, ringX: 0, ringY: 0}) => {
    cur.style.display = c.x < 0 ? 'none' : 'block';
    cur.style.transform = `translate(${(c.x - 3).toFixed(2)}px, ${(c.y - 2).toFixed(2)}px) scale(${c.press ? 0.88 : 1})`;
    ring.style.left = `${c.ringX}px`;
    ring.style.top = `${c.ringY}px`;
    ring.style.opacity = String(c.ring * 0.85);
    ring.style.transform = `scale(${(0.35 + 0.9 * (1 - c.ring)).toFixed(3)})`;
  };

  return {
    spots,
    stationSpot: (i) => {
      const id = STATION_PICKER[i] || STATION_PICKER[0];
      return spots[`station_${id}`];
    },
    throttleKnob: (v) => [knobX(v), 836],
    playKnob: (v) => [knobX(v), 869],
    brayton,
    braytonPlot: {x: 1324 + 22, w: 234 - 44},
    btn,
    stationBtn,
    root: ui,
    update(s) {
      const throttle = Math.min(1, Math.max(0, s.throttle ?? 0.35));
      const cy = s.cycle || cycleAt(throttle);
      const fanDeg = s.fanDeg ?? 0;

      // Header readouts
      n1Big.innerHTML = `${cy.n1Pct.toFixed(1)}<span style="font-size:17px;letter-spacing:0;margin-left:2px">%</span>`;
      n2Big.innerHTML = `${cy.n2Pct.toFixed(1)}<span style="font-size:13px;letter-spacing:0;margin-left:2px">%</span>`;
      n1RpmEl.textContent = `${Math.round(cy.fanRpm).toLocaleString('en-US')} RPM`;
      n2RpmEl.textContent = `${Math.round(cy.coreRpm).toLocaleString('en-US')} RPM`;
      n1Fill.style.width = `${((cy.n1Pct / 100) * 138).toFixed(1)}px`;
      n2Fill.style.width = `${((cy.n2Pct / 100) * 110).toFixed(1)}px`;

      thrustEl.innerHTML = `${cy.thrustKn.toFixed(1)} <i style="font-style:normal;font-size:9px;font-weight:500;color:${C.mute}">kN</i>`;
      egtEl.innerHTML = `${Math.round(cy.egtC)} <i style="font-style:normal;font-size:9px;font-weight:500;color:${C.mute}">°C</i>`;
      fuelEl.innerHTML = `${cy.fuelFlowKgS.toFixed(2)} <i style="font-style:normal;font-size:9px;font-weight:500;color:${C.mute}">kg/s</i>`;

      // Transport
      thrVal.textContent = `${Math.round(throttle * 100)}% ${throttle < 0.08 ? 'IDLE' : throttle > 0.92 ? 'TOGA' : ''}`.trim();
      thrKnob.style.left = `${knobX(throttle).toFixed(1)}px`;
      playVal.textContent = s.playText || '1 / 30 SPEED';
      playKnob.style.left = `${knobX(s.playK ?? 0.33).toFixed(1)}px`;
      btn.pause.innerHTML = s.paused ? '▶ &nbsp;PLAY' : '❚❚ &nbsp;PAUSE';

      // 3.06:1 Star Planetary Gearbox SVG synced to fanDeg
      {
        const {ringRad, sunRad, planetRads} = gearboxAngles(fanDeg);
        const r2d = 180 / Math.PI;
        gbxRingG.setAttribute('transform', `rotate(${(ringRad * r2d).toFixed(2)} ${gCx} ${gCy})`);
        gbxSunG.setAttribute('transform', `rotate(${(sunRad * r2d).toFixed(2)} ${gCx} ${gCy})`);
        for (let k = 0; k < planetRads.length; k++) {
          const [px, py] = planetCenters[k];
          gbxPlanGs[k].setAttribute('transform', `rotate(${(planetRads[k] * r2d).toFixed(2)} ${px.toFixed(2)} ${py.toFixed(2)})`);
        }
        gbxRpmEl.innerHTML = `<b style="color:${C.ink}">${Math.round(cy.lptRpm)}</b> → ${Math.round(cy.fanRpm)} RPM`;
        gbxSunRpmTxt.textContent = `${Math.round(cy.lptRpm)} RPM`;
        gbxRingRpmTxt.textContent = `${Math.round(cy.fanRpm)} RPM`;
      }

      // 12:1 Bypass vs Core Airflow SVG
      {
        flowTotalEl.innerHTML = `<b style="color:${C.ink}">${cy.massFlowKgS.toFixed(0)}</b> KG/S`;
        flowFoot.innerHTML = `OPR <b style="color:${C.ink}">${cy.opr.toFixed(1)}:1</b> &nbsp;·&nbsp; FPR <b style="color:${C.ink}">${cy.fpr.toFixed(2)}</b> &nbsp;·&nbsp; TSFC <b style="color:${C.ink}">${cy.tsfc.toFixed(1)}</b>`;
        const dashOff = -((fanDeg * 0.38) % 24);
        const dashCore = -((fanDeg * 0.72) % 24);
        const hotAlpha = (0.35 + 0.65 * throttle).toFixed(2);
        flowSvg.innerHTML = `
          <rect x="2" y="6" width="233" height="128" fill="#fff" stroke="${C.line}"/>
          <path d="M12 18 L195 22 L222 32 L222 50 L12 50 Z" fill="rgba(61,143,224,.10)" stroke="${C.blue}" stroke-width=".9"/>
          <path d="M12 124 L195 120 L222 110 L222 92 L12 92 Z" fill="rgba(61,143,224,.10)" stroke="${C.blue}" stroke-width=".9"/>
          <path d="M12 56 L95 56 L138 60 L222 62 L222 80 L138 82 L95 86 L12 86 Z" fill="rgba(214,24,43,.10)" stroke="${C.ink}" stroke-width=".9"/>
          <rect x="132" y="62" width="42" height="18" fill="${C.orange}" opacity="${hotAlpha}"/>
          <line x1="16" y1="34" x2="216" y2="38" stroke="${C.blue}" stroke-width="1.4" stroke-dasharray="10 6" stroke-dashoffset="${dashOff.toFixed(1)}"/>
          <line x1="16" y1="108" x2="216" y2="104" stroke="${C.blue}" stroke-width="1.4" stroke-dasharray="10 6" stroke-dashoffset="${dashOff.toFixed(1)}"/>
          <line x1="20" y1="77" x2="218" y2="77" stroke="${C.red}" stroke-width="1.3" stroke-dasharray="8 6" stroke-dashoffset="${dashCore.toFixed(1)}"/>
          <line x1="26" y1="14" x2="26" y2="128" stroke="${C.ink}" stroke-width="2"/>
          <text x="34" y="29" font-size="8" font-weight="700" fill="${C.blue}">BYPASS · 12.0 : 1 (${cy.bypassFlowKgS.toFixed(0)} kg/s)</text>
          <text x="34" y="42" font-size="7.2" fill="${C.mute}">84% THRUST · ${cy.bypassThrustKn.toFixed(1)} kN</text>
          <text x="34" y="69" font-size="7.4" font-weight="700" fill="${C.ink}">CORE 1.0 (${cy.coreFlowKgS.toFixed(1)} kg/s)</text>
          <text x="34" y="105" font-size="7.2" fill="${C.mute}">16% THRUST · ${cy.coreThrustKn.toFixed(1)} kN</text>
          <text x="34" y="118" font-size="7.2" fill="${C.ink}">TET ${Math.round(cy.T4)} K · EGT ${Math.round(cy.egtC)} °C</text>
        `;
      }

      // Station State (top-right)
      const activeId = String(s.station || 'FAN').toUpperCase();
      const meta = resolveStationMeta(activeId);
      const stData =
        activeId === 'TURBINE'
          ? {
              pBar: (cy.P45 + cy.P5) * 0.5,
              tK: (cy.T45 + cy.T5) * 0.5,
              rpm: cy.lptRpm,
              ratio: cy.P4 / Math.max(0.1, cy.P5),
            }
          : cy.stations[activeId] || cy.stations.FAN;

      stCode.innerHTML = `STATION <b>${meta.code}</b>`;
      stSpool.textContent = meta.spool;
      stBig.textContent = meta.name;
      stBig.style.color = activeId === 'BURNER' || activeId === 'HPT' || activeId === 'LPT' || activeId === 'TURBINE' ? C.red : C.ink;
      stDesc.textContent = meta.desc;
      stRows.innerHTML = `
        <span class="cp mu" style="font-size:8px">SPOOL SPEED</span><span style="font-size:10.5px;font-weight:700">${stData.rpm > 0 ? `${Math.round(stData.rpm).toLocaleString('en-US')} RPM` : 'STATIC NOZZLE'}</span>
        <span class="cp mu" style="font-size:8px">STAGE RATIO</span><span style="font-size:10.5px;font-weight:700">${stData.ratio.toFixed(2)} : 1</span>
      `;
      stBarBig.textContent = stData.pBar < 10 ? stData.pBar.toFixed(2) : stData.pBar.toFixed(1);
      stBarUnit.style.left = `${1334 + Math.max(46, stBarBig.getBoundingClientRect().width) + 6}px`;
      stTempBig.textContent = `${Math.round(stData.tK)} K`;
      stBarFill.style.width = `${Math.min(224, (stData.pBar / 40) * 224).toFixed(1)}px`;

      // Brayton T-P Station Profile (interactive DRAG TO SCRUB throttle 0-100%)
      {
        const prof = braytonProfile(throttle);
        const W = 234;
        const X = (u) => 22 + u * (W - 44);
        const Yp = (p) => 112 - Math.min(1, p / 40) * 92;
        const Yt = (t) => 112 - Math.min(1, (t - 250) / 1600) * 92;

        let pPath = '';
        let tPath = '';
        prof.forEach((pt, idx) => {
          const x = X(pt.xNorm).toFixed(1);
          pPath += `${idx ? 'L' : 'M'}${x} ${Yp(pt.pBar).toFixed(1)}`;
          tPath += `${idx ? 'L' : 'M'}${x} ${Yt(pt.tK).toFixed(1)}`;
        });
        const pArea = `${pPath} L${X(1).toFixed(1)} 112 L${X(0).toFixed(1)} 112 Z`;

        const activeMatch = activeId === 'TURBINE' ? 'LPT' : activeId;
        let h = `
          <text x="19" y="16" font-size="6.3" text-anchor="end" fill="${C.blue}">40b</text>
          <text x="19" y="66" font-size="6.3" text-anchor="end" fill="${C.blue}">20</text>
          <text x="19" y="114" font-size="6.3" text-anchor="end" fill="${C.blue}">0</text>
          <text x="215" y="16" font-size="6.3" fill="${C.red}">1850K</text>
          <text x="215" y="66" font-size="6.3" fill="${C.red}">1050</text>
          <text x="215" y="114" font-size="6.3" fill="${C.red}">250</text>
          <line x1="${X(0)}" x2="${X(1)}" y1="112" y2="112" stroke="${C.ink}" stroke-width=".8"/>
          <line x1="${X(0)}" x2="${X(0)}" y1="18" y2="112" stroke="${C.line}" stroke-width=".8"/>
          <line x1="${X(1)}" x2="${X(1)}" y1="18" y2="112" stroke="${C.line}" stroke-width=".8"/>
          <path d="${pArea}" fill="rgba(61,143,224,.11)"/>
          <path d="${pPath}" fill="none" stroke="${C.blue}" stroke-width="1.5"/>
          <path d="${tPath}" fill="none" stroke="${C.red}" stroke-width="1.6"/>
        `;
        for (const pt of prof) {
          const x = X(pt.xNorm);
          const isAct = pt.id === activeMatch;
          h += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="20" y2="112" stroke="${isAct ? C.red : C.line}" stroke-width="${isAct ? 1 : 0.6}" stroke-dasharray="${isAct ? '' : '2 2'}"/>`;
          h += `<circle cx="${x.toFixed(1)}" cy="${Yp(pt.pBar).toFixed(1)}" r="${isAct ? 3.2 : 2.1}" fill="${isAct ? C.blue : '#fff'}" stroke="${C.blue}" stroke-width="1.2"/>`;
          h += `<circle cx="${x.toFixed(1)}" cy="${Yt(pt.tK).toFixed(1)}" r="${isAct ? 3.4 : 2.2}" fill="${isAct ? C.red : '#fff'}" stroke="${C.red}" stroke-width="1.2"/>`;
          h += `<text x="${x.toFixed(1)}" y="123" font-size="6.2" text-anchor="middle" font-weight="${isAct ? '700' : '500'}" fill="${isAct ? C.ink : C.mute}">${pt.label}</text>`;
        }

        // Interactive Throttle Scrub bar & cursor inside Brayton SVG
        const tx = X(throttle);
        h += `
          <rect x="0" y="0" width="${W}" height="162" fill="transparent"/>
          <rect x="${X(0)}" y="138" width="${X(1) - X(0)}" height="4" fill="#e6e7e9"/>
          <rect x="${X(0)}" y="138" width="${(tx - X(0)).toFixed(1)}" height="4" fill="${C.red}"/>
          <line x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="18" y2="146" stroke="${C.red}" stroke-width="1.2" opacity=".75"/>
          <polygon points="${(tx - 4).toFixed(1)},133 ${(tx + 4).toFixed(1)},133 ${tx.toFixed(1)},138" fill="${C.red}"/>
          <rect x="${(tx - 4).toFixed(1)}" y="135" width="8" height="10" fill="${C.red}"/>
          <text x="${X(0)}" y="157" font-size="6" letter-spacing=".8" fill="${C.mute}">IDLE 0%</text>
          <text x="${X(0.5)}" y="157" font-size="6" letter-spacing=".8" text-anchor="middle" fill="${C.ink}">THROTTLE ${Math.round(throttle * 100)}%</text>
          <text x="${X(1)}" y="157" font-size="6" letter-spacing=".8" text-anchor="end" fill="${C.mute}">TOGA 100%</text>
        `;
        brayton.innerHTML = h;
        brLeg.innerHTML = `<span style="color:${C.blue}">—</span> P <b style="color:${C.ink}">${cy.P3.toFixed(1)}</b> bar &nbsp; <span style="color:${C.red}">—</span> TET <b style="color:${C.ink}">${Math.round(cy.T4)}</b> K`;
      }

      // Brayton P-V / T-S Thermodynamic Cycle Loop (right lower)
      {
        tsVal.innerHTML = `OPR <b style="color:${C.ink}">${cy.opr.toFixed(1)}:1</b>`;
        const W = 234;
        const X = (sNorm) => 22 + sNorm * (W - 38);
        const Y = (tK) => 124 - Math.min(1, (tK - 250) / 1600) * 102;
        const s0 = 0.12;
        const s3 = 0.18 + 0.04 * throttle;
        const s4 = 0.45 + 0.38 * throttle;
        const s5 = s4 + 0.08 + 0.06 * throttle;
        const pts = [
          [s0, cy.T0, '0'],
          [s3, cy.T3, '3'],
          [s4, cy.T4, '4'],
          [s5, cy.T5, '5'],
          [s5 + 0.04, cy.T9, '9'],
        ];
        const loopPath =
          `M${X(pts[0][0]).toFixed(1)} ${Y(pts[0][1]).toFixed(1)} ` +
          `Q${X(s3 * 0.92).toFixed(1)} ${Y((cy.T0 + cy.T3) * 0.52).toFixed(1)} ${X(pts[1][0]).toFixed(1)} ${Y(pts[1][1]).toFixed(1)} ` +
          `Q${X((s3 + s4) * 0.5).toFixed(1)} ${Y((cy.T3 + cy.T4) * 0.52).toFixed(1)} ${X(pts[2][0]).toFixed(1)} ${Y(pts[2][1]).toFixed(1)} ` +
          `L${X(pts[3][0]).toFixed(1)} ${Y(pts[3][1]).toFixed(1)} ` +
          `L${X(pts[4][0]).toFixed(1)} ${Y(pts[4][1]).toFixed(1)} Z`;
        let h = `
          <text x="18" y="18" font-size="6.2" text-anchor="end" fill="${C.mute}">K</text>
          <text x="18" y="${Y(1600) + 2}" font-size="6.2" text-anchor="end" fill="${C.mute}">1600</text>
          <text x="18" y="${Y(900) + 2}" font-size="6.2" text-anchor="end" fill="${C.mute}">900</text>
          <text x="18" y="${Y(300) + 2}" font-size="6.2" text-anchor="end" fill="${C.mute}">300</text>
          <line x1="${X(0)}" x2="${X(1)}" y1="124" y2="124" stroke="${C.ink}" stroke-width=".8"/>
          <line x1="${X(0)}" x2="${X(0)}" y1="18" y2="124" stroke="${C.ink}" stroke-width=".8"/>
          <path d="${loopPath}" fill="rgba(214,24,43,.12)" stroke="${C.ink}" stroke-width="1.3"/>
          <text x="${X((s3 + s4) * 0.5).toFixed(1)}" y="${(Y(cy.T4) - 6).toFixed(1)}" font-size="6.1" text-anchor="middle" fill="${C.red}">COMBUSTION</text>
          <text x="${X(s0 + 0.05).toFixed(1)}" y="${(Y(cy.T3 * 0.72)).toFixed(1)}" font-size="6" fill="${C.mute}">COMPR</text>
          <text x="${X(s4 + 0.05).toFixed(1)}" y="${(Y((cy.T4 + cy.T5) * 0.5)).toFixed(1)}" font-size="6" fill="${C.mute}">TURBINE</text>
          <circle cx="${X(pts[2][0]).toFixed(1)}" cy="${Y(pts[2][1]).toFixed(1)}" r="3.2" fill="${C.red}"/>
          <text x="${X(1)}" y="137" font-size="6" letter-spacing=".8" text-anchor="end" fill="${C.mute}">ENTROPY s → · T4 ${Math.round(cy.T4)} K / EGT ${Math.round(cy.egtC)} °C</text>
        `;
        cySvg.innerHTML = h;
      }

      // Station Picker (bottom-center)
      const pickerMatch = activeId === 'HPT' || activeId === 'LPT' ? 'TURBINE' : activeId;
      for (const id of STATION_PICKER) {
        const on = pickerMatch === id;
        stationBtn[id].style.background = on ? C.red : '#fff';
        stationBtn[id].style.color = on ? '#fff' : C.ink;
        stationBtn[id].style.borderColor = on ? C.red : C.line;
      }
      stationSub.textContent = `${meta.code} · ${meta.name.toUpperCase()} · ${stData.pBar.toFixed(1)} BAR · ${Math.round(stData.tK)} K`;

      // Toggles (bottom-right)
      for (const k of CAMS) {
        const on = s.cam === k;
        btn[k].style.background = on ? C.ink : '#fff';
        btn[k].style.color = on ? '#fff' : C.ink;
        btn[k].style.borderColor = on ? C.ink : C.line;
      }
      for (const k of CUTS) {
        const on = s.cut === k;
        btn[k].style.background = on ? C.ink : '#fff';
        btn[k].style.color = on ? '#fff' : C.ink;
        btn[k].style.borderColor = on ? C.ink : C.line;
      }
      for (const k of OVERLAYS) {
        const on = !!(s.overlays && s.overlays[k]);
        btn[k].style.background = on ? C.red : '#fff';
        btn[k].style.color = on ? '#fff' : C.ink;
        btn[k].style.borderColor = on ? C.red : C.line;
      }

      // 3D Callouts & Leader Lines
      let lh = '';
      let ch = '';
      for (const c of s.callouts || []) {
        if (c.o < 0.02 || !c.at) continue;
        const [ax, ay] = c.at;
        const [lx, ly] = c.label;
        lh += `<polyline points="${ax.toFixed(1)},${ay.toFixed(1)} ${lx.toFixed(1)},${(ly + 16).toFixed(1)} ${(lx + c.w).toFixed(1)},${(ly + 16).toFixed(1)}" fill="none" stroke="${C.mute}" stroke-width=".8" opacity="${c.o.toFixed(2)}"/>`;
        if (c.name) {
          ch += `<div class="call" style="left:${lx.toFixed(1)}px;top:${(ly - 10).toFixed(1)}px;opacity:${c.o.toFixed(2)}"><b>${c.name}</b><span>${c.sub}</span></div>`;
        }
      }
      callSvg.innerHTML = lh;
      callG.innerHTML = ch;
      pointer(s.cursor);
    },
    pointer,
  };
}
