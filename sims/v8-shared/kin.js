// V8 kinematics for the four-stroke explorer: a 90° cross-plane crank, firing order 1-8-4-3-6-5-7-2, the piston of
// every cylinder from the exact slider-crank, valve lift over the 720° cycle, and a chamber pressure model good
// enough to draw the indicator diagram. Engine space is millimetres: crank axis on z (front = +z), y up.
export const E = {bore: 101.6, r: 44.5, rod: 145, comp: 30, deck: 226, pinZ: [168, 56, -56, -168], rodOff: 11, cr: 10.2};
export const STROKE = 2 * E.r;
const S = Math.SQRT1_2;
// bank frames in the XY plane: b along the cylinder axis, p outward across the bank
export const BANK = {
  L: {b: [S, S], p: [S, -S], sign: 1},
  R: {b: [-S, S], p: [-S, -S], sign: -1},
};
// cylinders 1..8: odd on the left bank (+x), even on the right; 1 at the front
export const CYL = [1, 2, 3, 4, 5, 6, 7, 8].map((c) => {
  const odd = c % 2 === 1;
  const pin = Math.floor((c - 1) / 2);
  return {c, bank: odd ? 'L' : 'R', pin, z: E.pinZ[pin] + (odd ? E.rodOff : -E.rodOff)};
});
export const FIRE = {1: 0, 8: 90, 4: 180, 3: 270, 6: 360, 5: 450, 7: 540, 2: 630};
export const ORDER = [1, 8, 4, 3, 6, 5, 7, 2];
// cross-plane crank: pin angles clockwise from +y, seen from the front
export const PIN_PHASE = [45, 135, -45, 225];
const mod = (a, m) => ((a % m) + m) % m;

export const bankXY = (bank, w, d) => {
  const B = BANK[bank];
  return [d * B.b[0] + w * B.p[0], d * B.b[1] + w * B.p[1]];
};
export const pinXY = (p, th) => {
  const a = ((th + PIN_PHASE[p]) * Math.PI) / 180;
  return [E.r * Math.sin(a), E.r * Math.cos(a)];
};
/** cylinder index i (0-based): the piston pin's distance along the bank axis, the crank pin, the pin point */
export const piston = (i, th) => {
  const cy = CYL[i];
  const B = BANK[cy.bank];
  const P = pinXY(cy.pin, th);
  const pb = P[0] * B.b[0] + P[1] * B.b[1];
  const pp = P[0] * B.p[0] + P[1] * B.p[1];
  const s = pb + Math.sqrt(E.rod * E.rod - pp * pp);
  return {s, P, pin: [s * B.b[0], s * B.b[1]]};
};
// the pin distance at TDC and BDC (the same for every cylinder)
export const S_TDC = E.r + E.rod;
export const S_BDC = E.rod - E.r;
/** four-stroke phase of cylinder c in degrees after its firing TDC: 0-180 power, 180-360 exhaust, 360-540 intake, 540-720 compression */
export const psi = (c, th) => mod(th - FIRE[c], 720);
export const STROKES = ['POWER', 'EXHAUST', 'INTAKE', 'COMPRESSION'];
export const strokeOf = (ps) => STROKES[Math.floor(mod(ps, 720) / 180)];

// valves: lift 0..1 as a smooth bump between opening and closing (degrees after firing TDC)
export const VALVE = {ex: [140, 380], in: [340, 580], lift: 10.5};
const bump = (ps, [a, b]) => {
  const x = (mod(ps - a, 720)) / (b - a);
  return x >= 0 && x <= 1 ? Math.sin(Math.PI * x) ** 2 : 0;
};
export const liftEx = (ps) => bump(ps, VALVE.ex);
export const liftIn = (ps) => bump(ps, VALVE.in);
/** piston position as a fraction of the stroke from TDC (0 at TDC, 1 at BDC), at phase ps */
export const pistonFrac = (ps) => {
  const a = (ps * Math.PI) / 180;
  const sp = E.r * Math.cos(a) + Math.sqrt(E.rod * E.rod - (E.r * Math.sin(a)) ** 2);
  return (S_TDC - sp) / STROKE;
};
/** cylinder volume in units of the clearance volume (1 at TDC, cr at BDC), at phase ps */
export const volume = (ps) => 1 + (E.cr - 1) * pistonFrac(ps);
/** chamber pressure in bar: scales cleanly with load (0.25..1), boostBar (0..1.2), and optional fault ('none'|'misfire'|'knock'|'overheat') */
export const pressure = (ps, load = 1, boostBar = 0, fault = 'none') => {
  ps = mod(ps, 720);
  const V = volume(ps);
  const pBoost = 1 + Math.max(0, boostBar);
  const effLoad = Math.max(0.25, Math.min(1.15, load));
  const burnScale = (0.38 + 0.62 * effLoad) * (1 + Math.max(0, boostBar) * 0.56);
  if (ps >= 360 && ps < 540) return 0.9 * pBoost * (0.65 + 0.35 * effLoad);
  if (ps >= 180 && ps < 360) return 1.1 + (0.4 + 0.25 * Math.max(0, boostBar)) * Math.max(0, 1 - (ps - 180) / 40);
  if (ps >= 540) {
    const baseComp = Math.max(0.9 * pBoost, 0.95 * pBoost * Math.pow(E.cr / V, 1.32));
    if (fault === 'knock' && ps >= 714) {
      const pre = (ps - 714) / 6;
      return baseComp + 11 * burnScale * pre * pre;
    }
    return baseComp;
  }
  const comp = 0.95 * pBoost * Math.pow(E.cr / V, 1.32);
  if (fault === 'misfire') return Math.max(0.9, comp);
  // power: the burn rises over the first 10 degrees, then the gas expands
  const burn = 54 * burnScale * Math.pow(1 / V, 1.28);
  const k = Math.min(1, ps / 10);
  let p = Math.max(1.1, comp + (burn - comp) * (k * k * (3 - 2 * k)));
  if (fault === 'knock' && ps < 28) {
    p += 16 * burnScale * Math.exp(-(((ps - 5) / 5) ** 2)) * (0.75 + 0.25 * Math.cos(ps * 2.1));
  } else if (fault === 'overheat') {
    p *= 0.96;
  }
  return p;
};
/** sequential port fuel injector spray pulse (0..1) timed cleanly inside the intake stroke (355°..485°) */
export const injectorPulse = (ps) => {
  ps = mod(ps, 720);
  if (ps < 355 || ps > 485) return 0;
  const u = (ps - 355) / 130;
  return Math.pow(Math.sin(Math.PI * u), 0.7);
};
/** exhaust collector thermal wave (0..1) during blowdown & exhaust stroke (155°..340°) */
export const exhaustPulse = (ps) => {
  ps = mod(ps, 720);
  if (ps < 155 || ps > 340) return 0;
  const u = (ps - 155) / 185;
  return Math.pow(1 - u, 1.3) * Math.min(1, u * 6);
};
/** the charge colour key: 0 air & fuel, 1 compressed, 2 combustion, 3 exhaust */
export const chargeOf = (ps) => {
  ps = mod(ps, 720);
  if (ps < 60) return 2;
  if (ps < 360) return 3;
  if (ps < 540) return 0;
  return 1;
};

const PISTON_AREA = Math.PI * ((E.bore * 0.001) / 2) ** 2;
const R_M = E.r * 0.001;
const L_RATIO = E.r / E.rod;

/** instantaneous crank torque at crank angle th (deg): returns { total, byCyl } in N·m */
export const torqueAt = (th, load = 1, boostBar = 0, fault = 'none') => {
  let total = 0;
  const byCyl = CYL.map((cy) => {
    const ps = psi(cy.c, th);
    const phi = (ps * Math.PI) / 180;
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    const lever = R_M * sinP * (1 + (L_RATIO * cosP) / Math.sqrt(1 - (L_RATIO * sinP) ** 2));
    // net gas force above 1 bar crankcase pressure acting on piston crown
    const cylFault = fault === 'misfire' && cy.c === 4 ? 'misfire' : fault;
    const force = (pressure(ps, load, boostBar, cylFault) - 1.0) * 1e5 * PISTON_AREA;
    const tq = force * lever;
    total += tq;
    return tq;
  });
  return {total, byCyl};
};

/** instantaneous shaft power in kW at crank angle th (deg) and engine speed rpm */
export const powerAt = (th, rpm, load = 1, boostBar = 0, fault = 'none') => (torqueAt(th, load, boostBar, fault).total * ((rpm * Math.PI) / 30)) / 1000;

/** ignition spark flash intensity (0..1) over 0°..8° ATDC (with 0.5° BTDC float-safe ramp) */
export const sparkIntensity = (ps) => {
  const p = mod(ps, 720);
  if (p >= 719.5) return 0.7 + 0.3 * ((p - 719.5) / 0.5);
  if (p > 8) return 0;
  return Math.pow(1 - p / 8, 1.5);
};

/** rocker arm pivot angle in radians for normalized valve lift (0..1) */
export const rockerAngle = (lift) => Math.atan2(Math.max(0, Math.min(1, lift)) * VALVE.lift, 14);
