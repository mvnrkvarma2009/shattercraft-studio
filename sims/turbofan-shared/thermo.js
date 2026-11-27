// GTF-1200 Dual-Spool Geared Turbofan thermodynamic & kinematic cycle model (pure JS, no Three.js).
// Single normalized throttle (0..1, IDLE -> TOGA) drives dual-spool N1/N2 speeds, 3.06:1 star planetary
// reduction gearbox kinematics, Brayton cycle station pressures P0..P9 (bar) and temperatures T0..T9 (K),
// net thrust (8..145 kN), bypass ratio (12.0:1), EGT (°C), and fuel flow (kg/s).

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;

export const E = {
  name: 'GTF-1200',
  bypassRatio: 12.0,
  gearRatio: 3.06,
  exactGearRatio: 98 / 32, // 3.0625:1 star planetary (Z_ring=98, Z_sun=32, Z_planet=33, 5 planets)
  fanBlades: 18,
  combustorNozzles: 20,
  n1IdlePct: 22,
  n1MaxRpm: 3400,
  n2IdlePct: 58,
  n2MaxRpm: 10400,
  thrustIdleKn: 8,
  thrustMaxKn: 145,
  fanDiaMm: 1920,
  nacelleDiaMm: 2100,
  lengthMm: 3100,
  gearbox: {
    type: 'Star Planetary (Fixed Carrier)',
    sunTeeth: 32,
    planetTeeth: 33,
    ringTeeth: 98,
    planets: 5,
    ratio: 3.06,
    exactRatio: 98 / 32,
  },
  stages: {fan: 1, lpc: 3, hpc: 6, hpt: 2, lpt: 4},
};

export const STATIONS = [
  {id: 'FAN', index: 0, name: 'Swept Titanium Fan', code: 'S2', zMm: 940, spool: 'N1', desc: '18 wide-chord swept Ti-6Al-4V blades · 12.0:1 bypass'},
  {id: 'GEARBOX', index: 1, name: '3.06:1 Star Gearbox', code: 'GBX', zMm: 540, spool: 'N1/LPT', desc: '32T sun → five 33T helical planets → 98T fan ring'},
  {id: 'LPC', index: 2, name: '3-Stage LP Booster', code: 'S2.3', zMm: 220, spool: 'N1', desc: '3-stage axial booster compressed at fan spool speed'},
  {id: 'HPC', index: 3, name: '6-Stage HP Compressor', code: 'S3', zMm: -260, spool: 'N2', desc: '6-stage high-pressure core spool (up to 10,400 RPM)'},
  {id: 'BURNER', index: 4, name: 'Annular Combustor', code: 'S4', zMm: -690, spool: 'CORE', desc: '20 dual-orifice fuel nozzles · lean-burn annular flame'},
  {id: 'HPT', index: 5, name: '2-Stage HP Turbine', code: 'S4.5', zMm: -935, spool: 'N2', desc: 'Single-crystal Inconel blades driving N2 HPC spool'},
  {id: 'LPT', index: 6, name: '4-Stage LP Turbine', code: 'S5', zMm: -1235, spool: 'LPT', desc: 'High-speed 4-stage turbine driving gearbox sun at 3.06× N1'},
  {id: 'NOZZLE', index: 7, name: 'Chevron Core Nozzle', code: 'S9', zMm: -1580, spool: 'EXH', desc: '14-lobe scalloped mixer & Inconel exhaust tailcone'},
];

export const STATION_MAP = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

/** N1 % (22..100) from normalized throttle (0..1). */
export const n1At = (throttle) => {
  const u = clamp01(throttle);
  return E.n1IdlePct + (100 - E.n1IdlePct) * Math.pow(u, 0.9);
};

/** N2 % (58..100) from normalized throttle (0..1). */
export const n2At = (throttle) => {
  const u = clamp01(throttle);
  return E.n2IdlePct + (100 - E.n2IdlePct) * Math.pow(u, 0.72);
};

/**
 * Computes full dual-spool Brayton thermodynamic state at normalized throttle (0..1).
 * Returns N1/N2 %, RPMs, P0..P9 (bar), T0..T9 (K), EGT (°C), net thrust (kN), fuel flow (kg/s),
 * pressure ratios, mass flow, and per-station telemetry.
 */
export function cycleAt(throttle = 0.35) {
  const u = clamp01(throttle);
  const n1Pct = n1At(u);
  const n2Pct = n2At(u);
  const n1Norm = n1Pct / 100;
  const n2Norm = n2Pct / 100;

  const fanRpm = n1Norm * E.n1MaxRpm;
  const lptRpm = fanRpm * E.gearRatio;
  const coreRpm = n2Norm * E.n2MaxRpm;

  // Station 0 & 1: Sea-level static ambient (ISA 15 °C, 1.013 bar) & intake lip
  const P0 = 1.013;
  const T0 = 288.15;
  const P1 = 1.01;
  const T1 = 288.25;

  // Station 2: Fan face
  const P2 = 1.005;
  const T2 = 288.5;

  // Fan pressure ratio (1.07..1.48) & bypass exit (S21)
  const fpr = 1.04 + 0.44 * Math.pow(n1Norm, 1.85);
  const P21 = P2 * fpr;
  const T21 = T2 * Math.pow(fpr, 0.2857 / 0.9);

  // LPC pressure ratio (1.26..2.60)
  const lpcPr = 1.15 + 1.45 * Math.pow(n1Norm, 1.7);
  const P25 = P21 * lpcPr;
  const T25 = T21 * Math.pow(lpcPr, 0.2857 / 0.89);

  // HPC pressure ratio (3.22..9.50) -> Station 3 (total OPR ~4.3..36.5)
  const hpcPr = 2.6 + 6.9 * Math.pow((n2Pct - 40) / 60, 1.65);
  const P3 = P25 * hpcPr;
  const T3 = T25 * Math.pow(hpcPr, 0.2857 / 0.88);
  const opr = P3 / P2;

  // Station 4: Annular combustor exit (4% burner pressure drop, TET 860..1750 K)
  const P4 = P3 * 0.96;
  const T4 = 860 + 890 * Math.pow(u, 0.78);

  // Station 4.5: HPT exit (work balance with HPC)
  const T45 = T4 - (T3 - T25) / 0.9;
  const P45 = P4 * Math.pow(Math.max(0.25, T45 / T4), 1 / (0.25 * 0.9));

  // Station 5: LPT exit (EGT) -> 683..1133 K (410..860 °C)
  const T5 = 683 + (T4 - 860) * 0.505;
  const P5 = P45 * Math.pow(Math.max(0.25, T5 / T45), 1 / (0.25 * 0.91));

  // Station 6..9: Exhaust mixer, nozzle inlet, throat, plume exit
  const P6 = P5 * 0.99;
  const T6 = T5;
  const P7 = P6 * 0.985;
  const T7 = T6 * 0.995;
  const P8 = Math.max(P0, P7 * 0.54);
  const T8 = T7 * Math.pow(P8 / P7, 0.25 * 0.93);
  const P9 = P0;
  const T9 = T7 * Math.pow(P9 / P7, 0.25 * 0.94);

  const P = [P0, P1, P2, P3, P4, P5, P6, P7, P8, P9];
  const T = [T0, T1, T2, T3, T4, T5, T6, T7, T8, T9];

  // Thrust (8..145 kN), bypass split (12:1), EGT (°C), fuel flow (kg/s)
  const thrustKn = E.thrustIdleKn + (E.thrustMaxKn - E.thrustIdleKn) * Math.pow(u, 1.35);
  const bypassThrustKn = thrustKn * 0.84;
  const coreThrustKn = thrustKn * 0.16;
  const egtC = T5 - 273.15;
  const fuelFlowKgS = 0.14 + 1.34 * Math.pow(u, 1.25);
  const tsfc = (fuelFlowKgS / thrustKn) * 1000; // g/(kN·s)
  const massFlowKgS = 140 + 360 * n1Norm;
  const coreFlowKgS = massFlowKgS / (1 + E.bypassRatio);
  const bypassFlowKgS = massFlowKgS - coreFlowKgS;

  const stations = {
    FAN: {id: 'FAN', name: 'Swept Titanium Fan', code: 'S2/S21', pBar: P21, tK: T21, rpm: fanRpm, ratio: fpr},
    GEARBOX: {id: 'GEARBOX', name: '3.06:1 Star Gearbox', code: 'GBX', pBar: P21, tK: T21 + 14, rpm: lptRpm, ratio: E.gearRatio},
    LPC: {id: 'LPC', name: '3-Stage LP Booster', code: 'S2.5', pBar: P25, tK: T25, rpm: fanRpm, ratio: lpcPr},
    HPC: {id: 'HPC', name: '6-Stage HP Compressor', code: 'S3', pBar: P3, tK: T3, rpm: coreRpm, ratio: hpcPr},
    BURNER: {id: 'BURNER', name: 'Annular Combustor', code: 'S4', pBar: P4, tK: T4, rpm: coreRpm, ratio: 0.96},
    HPT: {id: 'HPT', name: '2-Stage HP Turbine', code: 'S4.5', pBar: P45, tK: T45, rpm: coreRpm, ratio: P45 / P4},
    LPT: {id: 'LPT', name: '4-Stage LP Turbine', code: 'S5', pBar: P5, tK: T5, rpm: lptRpm, ratio: P5 / P45},
    NOZZLE: {id: 'NOZZLE', name: 'Chevron Core Nozzle', code: 'S9', pBar: P7, tK: T9, rpm: 0, ratio: P7 / P9},
  };

  return {
    throttle: u,
    n1Pct,
    n2Pct,
    fanRpm,
    coreRpm,
    lptRpm,
    gearRatio: E.gearRatio,
    bypassRatio: E.bypassRatio,
    fpr,
    lpcPr,
    hpcPr,
    opr,
    thrustKn,
    bypassThrustKn,
    coreThrustKn,
    egtC,
    fuelFlowKgS,
    tsfc,
    massFlowKgS,
    coreFlowKgS,
    bypassFlowKgS,
    P0, P1, P2, P3, P4, P5, P6, P7, P8, P9,
    T0, T1, T2, T3, T4, T5, T6, T7, T8, T9,
    P21, T21, P25, T25, P45, T45,
    P,
    T,
    stations,
  };
}

/** Brayton cycle profile points along the engine axis for SVG charts: [{id, label, xNorm, pBar, tK}]. */
export function braytonProfile(throttle = 0.35) {
  const c = cycleAt(throttle);
  return [
    {id: 'AMBIENT', label: '0', xNorm: 0.0, pBar: c.P0, tK: c.T0},
    {id: 'FAN', label: '2', xNorm: 0.14, pBar: c.P21, tK: c.T21},
    {id: 'LPC', label: '2.5', xNorm: 0.28, pBar: c.P25, tK: c.T25},
    {id: 'HPC', label: '3', xNorm: 0.45, pBar: c.P3, tK: c.T3},
    {id: 'BURNER', label: '4', xNorm: 0.62, pBar: c.P4, tK: c.T4},
    {id: 'HPT', label: '4.5', xNorm: 0.74, pBar: c.P45, tK: c.T45},
    {id: 'LPT', label: '5', xNorm: 0.87, pBar: c.P5, tK: c.T5},
    {id: 'NOZZLE', label: '9', xNorm: 1.0, pBar: c.P9, tK: c.T9},
  ];
}

/** Star planetary gearbox angles (radians) for a given fan rotation angle fanDeg (degrees). */
export function gearboxAngles(fanDeg) {
  const th = (fanDeg * Math.PI) / 180;
  const {sunTeeth, planetTeeth, ringTeeth, planets} = E.gearbox;
  const ringRad = th;
  const sunRad = -th * (ringTeeth / sunTeeth);
  const planetRads = [];
  for (let k = 0; k < planets; k++) {
    const phi = (k * Math.PI * 2) / planets;
    const alpha0 = phi * (1 + sunTeeth / planetTeeth);
    planetRads.push(alpha0 + th * (ringTeeth / planetTeeth));
  }
  return {ringRad, sunRad, planetRads};
}
