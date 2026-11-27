// GTF-1200 Dual-Spool Geared Turbofan 3D CAD model (100% procedural Three.js in mm, 0.001 world scale).
// Features: 18-blade twisted/swept titanium fan + crimson-spiral spinner, sculpted 200° structural cutaway
// nacelle (bolted frames, axial stringers, swept titanium pylon, crimson CNC section rim, bright aluminum
// acoustic inner liner), 3.06:1 star planetary reduction gearbox (32T sun -> five 33T helical planets ->
// 98T ring + 5 bronze oil jets + 5-spoke torque drive bell), intermediate-case bevel tower shaft + contoured
// Accessory Gearbox (AGB) & braided stainless/bronze plumbing, 3-LPC + 6-HPC + 2-HPT + 4-LPT stages with
// gunmetal-hub/titanium/bronze contrast, open 165° combustor window + multi-layer GLSL plasma & 20 3D
// swirl flamelets, dual-cone Mach shock-diamond exhaust plume, stencil SECTION caps, isolation & explode.
import * as THREE from 'three';
import {E, gearboxAngles, STATIONS} from './thermo.js';

const V3 = THREE.Vector3;
const D2R = Math.PI / 180;
const smoother = (x) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};

// Matches LatheGeometry + rotateX(PI/2) mapping: x = r*sin(phi), y = -r*cos(phi), z = z_mm.
const lathePos = (r, phi, z) => new V3(r * Math.sin(phi), -r * Math.cos(phi), z);

// ------------------------------------------------------------ procedural CAD geometry helpers
function gearGeo(teeth, rOut, rRoot, width, helix = 0, holeR = 0) {
  const sh = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const da = (Math.PI * 2) / teeth;
    const pts = [
      [rRoot, a0],
      [rRoot, a0 + da * 0.2],
      [rOut, a0 + da * 0.33],
      [rOut, a0 + da * 0.62],
      [rRoot, a0 + da * 0.75],
    ];
    pts.forEach(([r, a], k) => (i === 0 && k === 0 ? sh.moveTo(r * Math.cos(a), r * Math.sin(a)) : sh.lineTo(r * Math.cos(a), r * Math.sin(a))));
  }
  sh.closePath();
  if (holeR > 0) {
    const h = new THREE.Path();
    h.absarc(0, 0, holeR, 0, Math.PI * 2, true);
    sh.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(sh, {depth: width, bevelEnabled: true, bevelThickness: 1.4, bevelSize: 1.1, bevelSegments: 1, curveSegments: 4});
  g.translate(0, 0, -width / 2);
  if (helix) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = (p.getZ(i) / width) * helix;
      const x = p.getX(i);
      const y = p.getY(i);
      p.setXY(i, x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a));
    }
  }
  g.computeVertexNormals();
  return g;
}

function internalGearGeo(teeth, rTip, rRoot, rOuter, width, helix = 0) {
  const sh = new THREE.Shape();
  sh.absarc(0, 0, rOuter, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  const da = (Math.PI * 2) / teeth;
  const off = -0.5 * da;
  for (let i = 0; i < teeth; i++) {
    const a0 = off - (i / teeth) * Math.PI * 2;
    const pts = [
      [rRoot, a0],
      [rRoot, a0 - da * 0.2],
      [rTip, a0 - da * 0.33],
      [rTip, a0 - da * 0.62],
      [rRoot, a0 - da * 0.75],
    ];
    pts.forEach(([r, a], k) => (i === 0 && k === 0 ? hole.moveTo(r * Math.cos(a), r * Math.sin(a)) : hole.lineTo(r * Math.cos(a), r * Math.sin(a))));
  }
  hole.closePath();
  sh.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(sh, {depth: width, bevelEnabled: true, bevelThickness: 1.4, bevelSize: 1.0, bevelSegments: 1, curveSegments: 3});
  g.translate(0, 0, -width / 2);
  if (helix) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = (p.getZ(i) / width) * helix;
      const x = p.getX(i);
      const y = p.getY(i);
      p.setXY(i, x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a));
    }
  }
  g.computeVertexNormals();
  return g;
}

function discGeo(r, width, holeR = 0, seg = 48) {
  const sh = new THREE.Shape();
  sh.absarc(0, 0, r, 0, Math.PI * 2, false);
  if (holeR > 0) {
    const h = new THREE.Path();
    h.absarc(0, 0, holeR, 0, Math.PI * 2, true);
    sh.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(sh, {depth: width, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.0, bevelSegments: 1, curveSegments: seg});
  g.translate(0, 0, -width / 2);
  return g;
}

/**
 * Lofted twisted & swept airfoil blade in local space (span along +Y from rIn..rOut, chord in X-Z).
 * Airfoil pitch angle is measured from the tangential X axis toward the axial Z axis.
 */
function twistedBladeGeo({
  rIn,
  rOut,
  chordIn,
  chordOut,
  twistInDeg,
  twistOutDeg,
  thickIn = 12,
  thickOut = 5,
  camber = 0.08,
  sweepZ = 0,
  leanX = 0,
  spanSegs = 6,
  chordSegs = 10,
}) {
  const ringPts = chordSegs * 2;
  const pos = [];
  const uvs = [];
  const idx = [];

  for (let i = 0; i <= spanSegs; i++) {
    const u = i / spanSegs;
    const r = rIn + (rOut - rIn) * u;
    const c = chordIn + (chordOut - chordIn) * u;
    const th = (thickIn + (thickOut - thickIn) * u) * 0.5;
    const pitch = (twistInDeg + (twistOutDeg - twistInDeg) * u) * D2R;
    const sw = sweepZ * (Math.sin(u * Math.PI) * 0.45 - u * u * 0.85);
    const ln = leanX * Math.sin(u * Math.PI * 0.85);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);

    for (let j = 0; j < ringPts; j++) {
      const top = j < chordSegs;
      const t = top ? j / chordSegs : 1 - (j - chordSegs) / chordSegs;
      const yt = th * (2.969 * Math.sqrt(Math.max(0, t)) - 1.26 * t - 3.516 * t * t + 2.843 * t * t * t - 1.015 * t * t * t * t);
      const yc = camber * c * 4 * t * (1 - t);
      const lx = (t - 0.5) * c;
      const ly = yc + (top ? yt : -yt * 0.72);
      const x = lx * cp - ly * sp + ln;
      const z = lx * sp + ly * cp + sw;
      pos.push(x, r, z);
      uvs.push(j / ringPts, u);
    }
  }

  for (let i = 0; i < spanSegs; i++) {
    const row0 = i * ringPts;
    const row1 = (i + 1) * ringPts;
    for (let j = 0; j < ringPts; j++) {
      const jn = (j + 1) % ringPts;
      const a = row0 + j;
      const b = row0 + jn;
      const c = row1 + jn;
      const d = row1 + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  const tipCenter = pos.length / 3;
  let tx = 0, ty = 0, tz = 0;
  const tipRow = spanSegs * ringPts;
  for (let j = 0; j < ringPts; j++) {
    tx += pos[(tipRow + j) * 3];
    ty += pos[(tipRow + j) * 3 + 1];
    tz += pos[(tipRow + j) * 3 + 2];
  }
  pos.push(tx / ringPts, ty / ringPts, tz / ringPts);
  uvs.push(0.5, 1);
  for (let j = 0; j < ringPts; j++) {
    idx.push(tipRow + j, tipRow + ((j + 1) % ringPts), tipCenter);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Merges `count` rotated copies of `bladeGeo` around Z into one crisp blisk/stator BufferGeometry. */
function ringBladesGeo(bladeGeo, count, twistOffset = 0) {
  const srcPos = bladeGeo.attributes.position;
  const srcIdx = bladeGeo.index;
  const vCount = srcPos.count;
  const pos = new Float32Array(vCount * count * 3);
  const idx = [];

  for (let k = 0; k < count; k++) {
    const ang = twistOffset + (k / count) * Math.PI * 2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const base = k * vCount;
    for (let i = 0; i < vCount; i++) {
      const x = srcPos.getX(i);
      const y = srcPos.getY(i);
      const z = srcPos.getZ(i);
      const o = (base + i) * 3;
      pos[o] = x * ca - y * sa;
      pos[o + 1] = x * sa + y * ca;
      pos[o + 2] = z;
    }
    for (let i = 0; i < srcIdx.count; i++) {
      idx.push(base + srcIdx.getX(i));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function latheZ(ptsRZ, seg = 64, phiStart = 0, phiLength = Math.PI * 2) {
  const v2 = ptsRZ.map(([r, z]) => new THREE.Vector2(Math.max(0.01, r), z));
  const g = new THREE.LatheGeometry(v2, seg, phiStart, phiLength);
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** Caps the flat radial slice of an open LatheGeometry profile at angle `phi` cleanly in 3D space. */
function latheCutFaceGeo(ptsRZ, phi, flipNormal = false) {
  const closed = ptsRZ[0][0] === ptsRZ[ptsRZ.length - 1][0] && ptsRZ[0][1] === ptsRZ[ptsRZ.length - 1][1]
    ? ptsRZ.slice(0, -1)
    : ptsRZ;
  const sh = new THREE.Shape();
  closed.forEach(([r, z], i) => (i === 0 ? sh.moveTo(r, z) : sh.lineTo(r, z)));
  sh.closePath();
  const g = new THREE.ShapeGeometry(sh);
  // Map 2D Shape (r, z, 0) -> (r*sin(phi), -r*cos(phi), z)
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const m = new THREE.Matrix4().makeBasis(
    new V3(sp, -cp, 0),
    new V3(0, 0, 1),
    new V3(-cp, -sp, 0),
  );
  g.applyMatrix4(m);
  if (flipNormal) {
    const idx = g.getIndex();
    if (idx) {
      const a = idx.array;
      for (let i = 0; i < a.length; i += 3) {
        const tmp = a[i + 1];
        a[i + 1] = a[i + 2];
        a[i + 2] = tmp;
      }
      idx.needsUpdate = true;
    }
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------ GLSL Volumetric Shaders (ANGLE/D3D11 safe)
function makeCombustorMaterial(layerBias = 0) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clipping: true,
    uniforms: {
      uThrottle: {value: 0.35},
      uSwirl: {value: 0},
      uOpacity: {value: 0.94},
      uLayer: {value: layerBias},
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_vertex>
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      varying vec3 vLocalPos;
      void main() {
        vUv = uv;
        vLocalPos = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mvPosition.xyz;
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform float uThrottle;
      uniform float uSwirl;
      uniform float uOpacity;
      uniform float uLayer;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      varying vec3 vLocalPos;
      void main() {
        #include <clipping_planes_fragment>
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewPos);
        float fresnel = pow(max(1.0 - abs(dot(n, v)), 0.0001), 1.35);
        // Align angle 0 to nozzle #1 at (0, +r) -> atan(y, x) - PI/2
        float ang = atan(vLocalPos.y, vLocalPos.x) - 1.5707963268;
        float zNorm = clamp((-vLocalPos.z - 582.0) / 242.0, 0.0, 1.0);
        float rNorm = clamp((length(vLocalPos.xy) - 246.0) / 110.0, 0.0, 1.0);
        float heat = clamp(uThrottle, 0.0, 1.0);

        // 20 supersonic swirl nozzle jets curving helically downstream
        float helix = ang + zNorm * (1.25 - 0.35 * heat) - uSwirl * 0.24;
        float jet20 = 0.5 + 0.5 * cos(helix * 20.0);
        float jetCore = pow(max(jet20, 0.0001), 2.4);

        // Multi-octave swirling plasma turbulence
        float t1 = 0.5 + 0.5 * sin(ang * 20.0 - zNorm * 14.0 + uSwirl * 4.2);
        float t2 = 0.5 + 0.5 * cos(ang * 40.0 + zNorm * 23.0 - uSwirl * 6.8 + uLayer * 2.1);
        float t3 = 0.5 + 0.5 * sin(ang * 12.0 + zNorm * 9.0 - uSwirl * 3.1);
        float swirlVortex = 0.5 * t1 + 0.32 * t2 + 0.18 * t3;

        // Smooth axial envelope: ignites sharply right at injector mouth, feathers into HPT inlet
        float leadIn = smoothstep(0.0, 0.12, zNorm);
        float tailOut = pow(max(1.0 - smoothstep(0.55, 1.0, zNorm), 0.0001), 0.72);
        float axialEnv = leadIn * tailOut;

        // Radial dome envelope inside combustor annulus
        float radialEnv = 0.68 + 0.32 * sin(clamp(rNorm, 0.0, 1.0) * 3.14159265);

        // Saturated vivid plasma palette
        vec3 pilotSapphire = vec3(0.0, 0.54, 1.0);
        vec3 pilotCyan = vec3(0.08, 0.93, 1.0);
        vec3 crimsonFlame = vec3(0.96, 0.12, 0.02);
        vec3 solarAmber = vec3(1.0, 0.54, 0.04);
        vec3 whiteHot = vec3(1.0, 0.96, 0.76);

        // Pilot zone: intense electric blue-cyan right off the 20 atomizer tips
        float pilotZone = smoothstep(0.36, 0.02, zNorm) * (0.45 + 0.55 * jetCore);
        vec3 pilotCol = mix(pilotSapphire, pilotCyan, 0.35 + 0.65 * pow(max(jet20, 0.0001), 1.6));

        // Primary combustion flame: molten crimson -> solar amber
        vec3 flameCol = mix(crimsonFlame, solarAmber, smoothstep(0.25, 0.85, swirlVortex * (0.55 + 0.45 * heat)));

        // Blend pilot blue into downstream orange-amber core
        float flameWeight = smoothstep(0.04, 0.34, zNorm) * (0.38 + 0.62 * heat);
        vec3 col = mix(pilotCol, flameCol, clamp(flameWeight, 0.0, 1.0));

        // Incandescent white-gold peaks inside swirl cores
        float hotPeak = pow(max(jetCore * swirlVortex * axialEnv, 0.0001), 1.55) * (0.25 + 0.75 * heat);
        col = mix(col, whiteHot, clamp(hotPeak * 0.92, 0.0, 0.92));

        // Subtle electric cyan streaks even at TOGA along fuel shear layer
        col += pilotCyan * 0.24 * pow(max(jetCore * (1.0 - zNorm), 0.0001), 1.8) * (0.5 + 0.5 * swirlVortex);

        float density = axialEnv * radialEnv * (0.46 + 0.44 * jetCore + 0.24 * swirlVortex + 0.14 * fresnel);
        float alpha = uOpacity * density * (0.68 + 0.32 * heat);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
      }
    `,
  });
}

function makeFlameletMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clipping: true,
    uniforms: {
      uThrottle: {value: 0.35},
      uSwirl: {value: 0},
      uOpacity: {value: 0.95},
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_vertex>
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mvPosition.xyz;
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform float uThrottle;
      uniform float uSwirl;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        #include <clipping_planes_fragment>
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewPos);
        // Lathe nozzle flamelet: vUv.y runs 0 (injector tip) -> 1 (downstream flare tip)
        float u = clamp(vUv.y, 0.0, 1.0);
        float heat = clamp(uThrottle, 0.0, 1.0);
        float core = pow(max(abs(dot(n, v)), 0.0001), 0.8);
        float streak = 0.5 + 0.5 * sin(vUv.x * 18.84956 + u * 9.0 - uSwirl * 5.2);
        float ripple = 0.5 + 0.5 * cos(u * 14.0 - uSwirl * 6.5);

        vec3 cyanPilot = vec3(0.02, 0.88, 1.0);
        vec3 cobalt = vec3(0.0, 0.42, 0.98);
        vec3 goldWhite = vec3(1.0, 0.94, 0.66);
        vec3 molten = vec3(0.98, 0.22, 0.02);

        vec3 pCol = mix(cobalt, cyanPilot, 0.45 + 0.55 * streak);
        vec3 hCol = mix(molten, goldWhite, pow(max(core * (0.45 + 0.55 * ripple), 0.0001), 1.35));
        vec3 col = mix(pCol, hCol, smoothstep(0.08, 0.50, u) * (0.45 + 0.55 * heat));
        float env = smoothstep(0.0, 0.12, u) * pow(max(1.0 - u, 0.0001), 0.72);
        float alpha = uOpacity * env * (0.58 + 0.42 * core) * (0.72 + 0.28 * heat);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
      }
    `,
  });
}

function makePlumeMaterial(isCore = false) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clipping: true,
    uniforms: {
      uThrottle: {value: 0.35},
      uSwirl: {value: 0},
      uOpacity: {value: isCore ? 0.92 : 0.74},
      uIsCore: {value: isCore ? 1.0 : 0.0},
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_vertex>
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mvPosition.xyz;
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform float uThrottle;
      uniform float uSwirl;
      uniform float uOpacity;
      uniform float uIsCore;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      varying vec3 vLocalPos;
      void main() {
        #include <clipping_planes_fragment>
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewPos);
        float viewSoft = pow(max(abs(dot(n, v)), 0.0001), uIsCore > 0.5 ? 0.85 : 1.25);
        float zNorm = clamp((-vLocalPos.z - 1575.0) / 960.0, 0.0, 1.0);
        float ang = atan(vLocalPos.y, vLocalPos.x);
        float heat = clamp(uThrottle, 0.0, 1.0);

        // Soft entry out of nozzle & feathered tail vanish
        float entry = smoothstep(0.0, 0.06, zNorm);
        float tail = pow(max(1.0 - zNorm, 0.0001), uIsCore > 0.5 ? 1.15 : 1.55);

        if (uIsCore > 0.5) {
          // 5 high-contrast Mach shock-diamond standing pressure bicones
          float wave = 0.5 + 0.5 * cos(zNorm * 31.4159265 - uSwirl * 1.6);
          float shockNode = pow(max(wave, 0.0001), 2.8);
          float shockHalo = pow(max(wave, 0.0001), 1.2);
          float harmonic = pow(max(0.5 + 0.5 * cos(zNorm * 62.831853 + uSwirl * 2.4), 0.0001), 2.2);
          float chevronMod = 0.78 + 0.22 * cos(ang * 14.0 - uSwirl * 2.0);

          vec3 deepCobalt = vec3(0.08, 0.28, 0.92);
          vec3 royalViolet = vec3(0.36, 0.18, 0.88);
          vec3 amberDiamond = vec3(1.0, 0.52, 0.06);
          vec3 incandescentNode = vec3(1.0, 0.92, 0.56);

          vec3 carrierCol = mix(deepCobalt, royalViolet, 0.4 + 0.4 * sin(zNorm * 12.0));
          vec3 nodeCol = mix(amberDiamond, incandescentNode, pow(max(shockNode * (0.45 + 0.55 * heat), 0.0001), 1.3));
          vec3 col = mix(carrierCol, nodeCol, clamp(shockNode * (0.55 + 0.45 * heat) + 0.22 * harmonic * heat, 0.0, 1.0));

          float alpha = uOpacity * entry * tail * viewSoft * chevronMod * (0.28 + 0.32 * shockHalo + 0.68 * shockNode) * (0.42 + 0.58 * heat);
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.94));
        } else {
          // Outer feathered shear mixing envelope synced to 14 scalloped chevron lobes
          float chev = 0.5 + 0.5 * cos(ang * 14.0 + zNorm * 4.5 - uSwirl * 1.8);
          float turb = 0.5 + 0.5 * sin(ang * 28.0 - zNorm * 16.0 + uSwirl * 4.0);
          vec3 idleSapphire = vec3(0.14, 0.46, 0.92);
          vec3 crimsonPlume = vec3(0.84, 0.09, 0.16);
          vec3 amberPlume = vec3(0.98, 0.36, 0.05);

          vec3 hotShear = mix(crimsonPlume, amberPlume, 0.32 + 0.68 * chev * (0.5 + 0.5 * turb));
          vec3 col = mix(idleSapphire, hotShear, smoothstep(0.08, 0.52, heat));
          float alpha = uOpacity * entry * tail * viewSoft * (0.58 + 0.42 * chev) * (0.34 + 0.66 * heat);
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.78));
        }
      }
    `,
  });
}

function makeXrayMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clipping: true,
    uniforms: {
      uColor: {value: new THREE.Color('#435366')},
      uCenterAlpha: {value: 0.07},
      uRimAlpha: {value: 0.30},
      uPower: {value: 2.0},
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_vertex>
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mvPosition.xyz;
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor;
      uniform float uCenterAlpha;
      uniform float uRimAlpha;
      uniform float uPower;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        #include <clipping_planes_fragment>
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewPos);
        float ndotv = abs(dot(n, v));
        float fresnel = pow(max(1.0 - ndotv, 0.0001), uPower);
        float alpha = mix(uCenterAlpha, uRimAlpha, fresnel);
        vec3 col = mix(uColor, uColor * 0.72, fresnel * 0.65);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

/**
 * Builds the procedural GTF-1200 Dual-Spool Geared Turbofan.
 * @param {object} opts { caps?: string, lo?: boolean, plain?: boolean }
 */
export function buildTurbofan(opts = {}) {
  const lo = !!opts.lo;
  const plain = !!opts.plain || lo;
  const N = (n, min = 8) => (lo ? Math.max(min, Math.round(n / 4)) : n);
  const gear = (teeth, rOut, rRoot, width, helix = 0, holeR = 0) =>
    plain ? discGeo((rOut + rRoot) / 2, width, holeR, N(36)) : gearGeo(teeth, rOut, rRoot, width, helix, holeR);

  const root = new THREE.Group();
  const M = {
    obsidian: new THREE.MeshPhysicalMaterial({color: '#16181c', roughness: 0.32, metalness: 0.24, clearcoat: 0.65, clearcoatRoughness: 0.18}),
    obsidianMatte: new THREE.MeshPhysicalMaterial({color: '#202329', roughness: 0.55, metalness: 0.18, clearcoat: 0.2}),
    titanium: new THREE.MeshStandardMaterial({color: '#88909b', roughness: 0.24, metalness: 0.88}),
    gunmetal: new THREE.MeshStandardMaterial({color: '#3f454e', roughness: 0.34, metalness: 0.82}),
    steel: new THREE.MeshStandardMaterial({color: '#d4d8de', roughness: 0.18, metalness: 0.96}),
    chrome: new THREE.MeshStandardMaterial({color: '#eef1f5', roughness: 0.12, metalness: 1.0}),
    alu: new THREE.MeshStandardMaterial({color: '#c9cdd4', roughness: 0.32, metalness: 0.78}),
    bronze: new THREE.MeshStandardMaterial({color: '#c08e54', roughness: 0.26, metalness: 0.9}),
    inconel: new THREE.MeshStandardMaterial({color: '#5f574f', roughness: 0.36, metalness: 0.82}),
    crimson: new THREE.MeshPhysicalMaterial({color: '#d6182b', roughness: 0.26, metalness: 0.22, clearcoat: 0.58}),
    carbonShell: new THREE.MeshPhysicalMaterial({color: '#464d57', roughness: 0.38, metalness: 0.72, clearcoat: 0.4}),
    coreShell: new THREE.MeshStandardMaterial({color: '#6b727d', roughness: 0.34, metalness: 0.78}),
    thermalWall: new THREE.MeshStandardMaterial({color: '#13151b', roughness: 0.72, metalness: 0.28}),
    nacWindow: new THREE.MeshPhysicalMaterial({color: '#ffffff', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.025, depthWrite: false, side: THREE.DoubleSide}),
    cutawayLip: new THREE.MeshPhysicalMaterial({color: '#d6182b', roughness: 0.22, metalness: 0.45, clearcoat: 0.55}),
    shroud: new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: 0.03,
      depthWrite: false,
      side: THREE.DoubleSide,
      envMapIntensity: 1.2,
    }),
    flowBlue: new THREE.MeshBasicMaterial({color: '#3d8fe0', transparent: true, opacity: 0.82, depthWrite: false}),
    flowHot: new THREE.MeshBasicMaterial({color: '#f05a23', transparent: true, opacity: 0.85, depthWrite: false}),
  };

  if (lo) {
    const flat = (color) => new THREE.MeshLambertMaterial({color, flatShading: true});
    Object.assign(M, {
      obsidian: flat('#383c44'),
      obsidianMatte: flat('#464b54'),
      titanium: flat('#88909b'),
      gunmetal: flat('#555b64'),
      steel: flat('#c4c8ce'),
      chrome: flat('#dce0e5'),
      alu: flat('#c6cacf'),
      bronze: flat('#b08351'),
      inconel: flat('#645c55'),
      crimson: flat('#d6182b'),
      carbonShell: flat('#4d545e'),
      coreShell: flat('#6b727d'),
      thermalWall: flat('#181a20'),
      nacWindow: flat('#cfd3d8'),
      cutawayLip: flat('#d6182b'),
      shroud: flat('#7c828a'),
    });
  }

  const add = (parent, geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const tag = (obj, part, explodeVec) => {
    obj.userData.part = part;
    if (explodeVec) obj.userData.explodeVec = Array.isArray(explodeVec) ? new V3(...explodeVec) : explodeVec.clone();
    return obj;
  };
  const ignore = (obj) => {
    obj.traverse((o) => (o.userData.ignoreInspect = true));
    return obj;
  };

  // Cutaway arcs: 200° structural back/top shroud (135°..335°), 160° camera-facing bay (-25°..+135°)
  const NAC_PHI0 = 135 * D2R;
  const NAC_ARC = 200 * D2R;
  const NAC_PHI1 = NAC_PHI0 + NAC_ARC; // 335°
  const COMP_PHI0 = -25 * D2R;
  const COMP_ARC = 160 * D2R;

  // ------------------------------------------------------------ 0. Outer Nacelle & Core Fairings
  const nacelleGrp = new THREE.Group();
  root.add(nacelleGrp);
  tag(nacelleGrp, {
    name: 'Bypass Nacelle & Structural Cowl',
    subsystem: 'Nacelle · 12.0:1 Bypass Duct',
    material: 'CFRP / Satin Titanium Acoustic Cowl',
    spec: 'Ø2,100 mm OD · 200° cutaway bay · 4 bolted rib frames',
  }, [0, 520, 420]);

  const nacPts = [
    [955, 1140], [958, 960], [964, 720], [958, 350], [944, -60], [920, -455],
    [958, -455], [998, -120], [1038, 320], [1052, 720], [1036, 1020], [995, 1160], [955, 1140],
  ];
  const nacOuterR = (z) => {
    const u = Math.min(1, Math.max(0, (z + 455) / (1160 + 455)));
    return 958 + 94 * Math.sin(u * Math.PI * 0.88);
  };
  const nacInnerR = (z) => {
    const u = Math.min(1, Math.max(0, (z + 455) / (1140 + 455)));
    return 920 + 42 * Math.sin(u * Math.PI * 0.7);
  };

  // 200° satin carbon-titanium structural cowl
  const nacShell = add(nacelleGrp, latheZ(nacPts, N(64), NAC_PHI0, NAC_ARC), M.carbonShell);
  nacShell.renderOrder = 2;

  // Light satin brushed-aluminum acoustic inner liner along the inside of the 200° cowl
  // (bright light-studio wall so dark HUD ink always stays crisp in close-up camera modes)
  const acousticPts = [
    [953, 1085], [956, 940], [961, 720], [955, 350], [941, -60], [918, -445],
    [926, -445], [948, -60], [961, 350], [967, 720], [962, 940], [959, 1085], [953, 1085],
  ];
  const acousticLiner = add(nacelleGrp, latheZ(acousticPts, N(56), NAC_PHI0 + 0.02, NAC_ARC - 0.04), M.alu, false);
  tag(acousticLiner, {
    name: 'Perforated Acoustic Bypass Liner',
    subsystem: 'Nacelle · Acoustic Attenuation',
    material: 'Brushed 6061 Aluminum Honeycomb Liner',
    spec: 'Reduces fan BPF tone by 14 EPNdB inside bypass duct',
  }, [0, 520, 420]);

  // 160° complement solid wall + mirrored structural ribs/stringers (visible ONLY in SOLID and SECTION modes)
  const nacComplement = new THREE.Group();
  nacelleGrp.add(nacComplement);
  const nacCompShell = add(nacComplement, latheZ(nacPts, N(48), COMP_PHI0, COMP_ARC), M.carbonShell);
  nacCompShell.renderOrder = 2;
  nacComplement.visible = false;

  // Cutaway end-face crimson caps & edge trim rails ONLY visible in GLASS mode (closed faces flush on NAC_PHI0 / NAC_PHI1)
  const glassTrimGrp = new THREE.Group();
  nacelleGrp.add(glassTrimGrp);
  add(glassTrimGrp, latheCutFaceGeo(nacPts, NAC_PHI0, false), M.cutawayLip, false);
  add(glassTrimGrp, latheCutFaceGeo(nacPts, NAC_PHI1, true), M.cutawayLip, false);

  // Subtle exterior crimson trim beading along cut edges
  for (const phiEdge of [NAC_PHI0, NAC_PHI1]) {
    const lipPts = [
      [920, -455], [944, -60], [958, 350], [964, 720], [958, 960], [955, 1090],
    ].map(([r, z]) => lathePos(r - 1, phiEdge, z));
    add(glassTrimGrp, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lipPts), N(28), 5.5, 6, false), M.crimson, false);
  }

  // Shared builder for bolted circumferential rib frames, hex fasteners, axial stringers & inner acoustic divider rings
  const ribZPos = [-360, -70, 230, 680];
  const divZPos = [-240, 80, 420, 780];
  const addNacelleStructure = (parent, phi0, arc, {ribPad, boltCount, stringerCount, stringerBias, stringerTrim, divPad}) => {
    const ribSeg = Math.max(16, Math.round((24 * arc) / NAC_ARC));
    for (const rz of ribZPos) {
      const r = nacOuterR(rz) + 3;
      const arcPts = [];
      for (let i = 0; i <= ribSeg; i++) {
        const phi = phi0 + ribPad + (i / ribSeg) * (arc - ribPad * 2);
        arcPts.push(lathePos(r, phi, rz));
      }
      add(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arcPts), N(ribSeg), 7, 6, false), M.gunmetal);
      for (let b = 0; b < boltCount; b++) {
        const phi = phi0 + 0.06 + (b / (boltCount - 1)) * (arc - 0.12);
        const bolt = add(parent, new THREE.CylinderGeometry(7.5, 7.5, 9, 6), M.steel, false);
        bolt.position.copy(lathePos(r + 4, phi, rz));
        bolt.lookAt(0, 0, rz);
        bolt.rotateX(Math.PI / 2);
      }
    }
    for (let s = 0; s < stringerCount; s++) {
      const phi = phi0 + ((s + stringerBias) / stringerCount) * (arc - stringerTrim);
      const sPts = [];
      for (let i = 0; i <= 18; i++) {
        const z = -435 + (i / 18) * (1080 + 435);
        sPts.push(lathePos(nacOuterR(z) + 3, phi, z));
      }
      add(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sPts), N(20), 6, 6, false), M.titanium, false);
    }
    const divSeg = Math.max(14, Math.round((20 * arc) / NAC_ARC));
    for (const bz of divZPos) {
      const rIn = nacInnerR(bz) - 2;
      const bPts = [];
      for (let i = 0; i <= divSeg; i++) {
        const phi = phi0 + divPad + (i / divSeg) * (arc - divPad * 2);
        bPts.push(lathePos(rIn, phi, bz));
      }
      add(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bPts), N(divSeg), 4, 6, false), M.gunmetal, false);
    }
  };

  // 200° primary cutaway cowl structural grid & 160° complement structural grid (full 360° wrap in SOLID/SECTION/X-RAY)
  addNacelleStructure(nacelleGrp, NAC_PHI0, NAC_ARC, {ribPad: 0.02, boltCount: 13, stringerCount: 6, stringerBias: 0.6, stringerTrim: 0.08, divPad: 0.04});
  addNacelleStructure(nacComplement, COMP_PHI0, COMP_ARC, {ribPad: -0.025, boltCount: 11, stringerCount: 5, stringerBias: 0.5, stringerTrim: 0, divPad: -0.045});

  // Sculpted Swept Titanium Wing-Mount Pylon Strut at 12 o'clock crown
  const pylonGrp = new THREE.Group();
  nacelleGrp.add(pylonGrp);
  tag(pylonGrp, {
    name: 'Swept Titanium Wing Pylon & Thrust Links',
    subsystem: 'Nacelle · Airframe Mount',
    material: 'Forged Ti-6Al-4V / Inconel Mount Fittings',
    spec: 'Primary upper pylon with twin clevis lugs & thrust fairing',
  }, [0, 560, 420]);
  const pylonShape = new THREE.Shape();
  pylonShape.moveTo(-420, -10);
  pylonShape.lineTo(740, -10);
  pylonShape.lineTo(540, 185);
  pylonShape.lineTo(290, 215);
  pylonShape.lineTo(-290, 175);
  pylonShape.closePath();
  const pylonGeo = new THREE.ExtrudeGeometry(pylonShape, {depth: 48, bevelEnabled: true, bevelThickness: 8, bevelSize: 6, bevelSegments: 2});
  pylonGeo.translate(0, 0, -24);
  pylonGeo.rotateY(-Math.PI / 2);
  const pylonBody = add(pylonGrp, pylonGeo, M.titanium);
  pylonBody.position.set(0, 1020, 0);
  // Saddle base flange bolted onto top of nacelle + crimson mount pin bosses
  const pylonSaddle = add(pylonGrp, new THREE.BoxGeometry(118, 28, 760), M.gunmetal);
  pylonSaddle.position.set(0, 1028, 220);
  for (const lz of [-180, 120, 420]) {
    const boss = add(pylonGrp, new THREE.CylinderGeometry(18, 18, 76, N(14)), M.steel);
    boss.rotation.z = Math.PI / 2;
    boss.position.set(0, 1140, lz);
    const capPin = add(pylonGrp, new THREE.CylinderGeometry(9, 9, 86, N(10)), M.crimson);
    capPin.rotation.z = Math.PI / 2;
    capPin.position.set(0, 1140, lz);
  }

  // Heated Titanium Anti-Ice Inlet Lip Ring (full 360° nose cowl framing the fan)
  const lipPts = [
    [952, 1085], [1040, 1085], [1030, 1138], [992, 1172], [958, 1152], [952, 1085],
  ];
  const inletLip = add(nacelleGrp, latheZ(lipPts, N(72)), M.chrome);
  tag(inletLip, {
    name: 'Heated Titanium Inlet Lip',
    subsystem: 'Nacelle · Inlet',
    material: 'Polished Titanium Ti-6Al-4V',
    spec: 'Ø2,060 mm laminar boundary anti-ice lip',
  }, [0, 520, 620]);

  // 16 Bypass Outlet Guide Vanes (OGVs) bridging core splitter to nacelle (z = +480)
  const ogvGrp = new THREE.Group();
  ogvGrp.position.z = 480;
  root.add(ogvGrp);
  tag(ogvGrp, {
    name: 'Bypass Outlet Guide Vanes (16×)',
    subsystem: 'Bypass Duct · Fan Exit',
    material: 'Carbon-Epoxy / Titanium Leading Edge',
    spec: '16 structural de-swirl vanes, 12.0:1 bypass stream',
  }, [0, 0, 320]);
  const ogvBlade = twistedBladeGeo({
    rIn: 445, rOut: 956, chordIn: 135, chordOut: 145, twistInDeg: 78, twistOutDeg: 86,
    thickIn: 14, thickOut: 10, camber: 0.04, spanSegs: 4, chordSegs: 6,
  });
  add(ogvGrp, ringBladesGeo(ogvBlade, 16), M.obsidian);

  // Core cowling / splitter fairing (z = +495..-1420)
  const coreCowlGrp = new THREE.Group();
  root.add(coreCowlGrp);
  tag(coreCowlGrp, {
    name: 'Core Splitter & Engine Casing',
    subsystem: 'Core Shroud',
    material: 'Titanium-Aluminide Split Core Casing',
    spec: 'Splits 12:1 bypass flow from core gas path · 200° structural arc',
  }, [0, -440, 0]);
  const coreCowlPts = [
    [438, 495], [420, 320], [395, 20], [385, -520], [392, -880], [440, -1120], [492, -1420],
    [516, -1420], [468, -1100], [418, -860], [412, -520], [422, 20], [448, 320], [462, 485], [438, 495],
  ];
  const ccShell = add(coreCowlGrp, latheZ(coreCowlPts, N(64), NAC_PHI0, NAC_ARC), M.coreShell);
  ccShell.renderOrder = 2;
  const ccComplement = add(coreCowlGrp, latheZ(coreCowlPts, N(48), COMP_PHI0, COMP_ARC), M.coreShell);
  ccComplement.visible = false;

  const coreTrimGrp = new THREE.Group();
  coreCowlGrp.add(coreTrimGrp);
  add(coreTrimGrp, latheCutFaceGeo(coreCowlPts, NAC_PHI0, false), M.cutawayLip, false);
  add(coreTrimGrp, latheCutFaceGeo(coreCowlPts, NAC_PHI1, true), M.cutawayLip, false);

  // Core splitter titanium leading-edge ring (full 360° clean intake lip at z = 490)
  const splitterLip = add(coreCowlGrp, latheZ([[438, 468], [462, 468], [456, 502], [440, 500], [438, 468]], N(56)), M.steel);
  tag(splitterLip, {
    name: 'Core Flow Splitter Nose Ring',
    subsystem: 'Core Shroud · Splitter',
    material: 'Machined Inconel / Titanium',
    spec: 'Divides bypass stream from LPC core entry',
  });

  // ------------------------------------------------------------ 1. Station 0: FAN (18-Blade Swept Titanium Fan + Spiral Spinner)
  const fanGrp = new THREE.Group();
  root.add(fanGrp);
  tag(fanGrp, {
    name: '18-Blade Swept Fan Assembly',
    subsystem: 'LP Spool (N1) · Fan Stage',
    material: 'Ti-6Al-4V Hollow-Core Titanium',
    spec: 'Ø1,920 mm tip, 18 swept blades, max 3,400 RPM',
  }, [0, 0, 860]);

  const fanRotor = new THREE.Group();
  fanRotor.position.z = 940;
  fanGrp.add(fanRotor);

  const spinner = new THREE.Group();
  fanRotor.add(spinner);
  tag(spinner, {
    name: 'Elliptical Fan Spinner Cone',
    subsystem: 'LP Spool (N1) · Inlet',
    material: 'Anodized Aluminum / Crimson Spiral',
    spec: '370 mm aerodynamic nose cone + visual rotation spiral',
  }, [0, 0, 1140]);
  const spinPts = [[0.01, 140], [272, 140]];
  for (let i = 1; i <= 14; i++) {
    const u = i / 14;
    const z = 140 + u * 370;
    const r = 272 * Math.cos(u * Math.PI * 0.5);
    spinPts.push([Math.max(0.01, r), z]);
  }
  add(spinner, latheZ(spinPts, N(48)), M.obsidian);

  const spiralPts = [];
  for (let i = 0; i <= 56; i++) {
    const u = 0.08 + (i / 56) * 0.88;
    const z = 510 - u * 370;
    const r = 272 * Math.sin(u * Math.PI * 0.5) + 3.5;
    const a = u * Math.PI * 2.6;
    spiralPts.push(new V3(Math.cos(a) * r, Math.sin(a) * r, z));
  }
  add(spinner, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spiralPts), N(64), 6.5, 8, false), M.crimson);

  add(fanRotor, discGeo(274, 210, 130, N(48)), M.titanium);
  const fanNoseFlange = add(fanRotor, new THREE.CylinderGeometry(274, 274, 28, N(48)), M.steel);
  fanNoseFlange.rotation.x = Math.PI / 2;
  fanNoseFlange.position.z = 115;

  const singleFanBlade = twistedBladeGeo({
    rIn: 268,
    rOut: 945,
    chordIn: 225,
    chordOut: 325,
    twistInDeg: 54,
    twistOutDeg: 22,
    thickIn: 22,
    thickOut: 7.5,
    camber: 0.075,
    sweepZ: -62,
    leanX: 46,
    spanSegs: lo ? 4 : 8,
    chordSegs: lo ? 6 : 11,
  });
  for (let i = 0; i < E.fanBlades; i++) {
    const b = add(fanRotor, singleFanBlade, M.titanium);
    b.rotation.z = (i / E.fanBlades) * Math.PI * 2;
    tag(b, {
      name: `Fan Blade #${i + 1} / ${E.fanBlades}`,
      subsystem: 'LP Spool (N1) · Fan Stage',
      material: 'Diffusion-Bonded Ti-6Al-4V',
      spec: 'Wide-chord swept airfoil, 54° root → 22° tip twist',
    });
  }

  // Sculpted 5-Spoke Fan Torque Drive Bell coupling 98T Ring Gear (z=540) to Fan Hub (z=840)
  const fanDriveBell = new THREE.Group();
  fanRotor.add(fanDriveBell);
  tag(fanDriveBell, {
    name: '5-Spoke Fan Torque Drive Bell',
    subsystem: 'Fan Drive · Reduction Output',
    material: 'Forged Maraging Steel',
    spec: 'Lightened 5-spoke torque bell coupling 98T ring gear to fan hub',
  });
  const bellFlangeAft = add(fanDriveBell, new THREE.TorusGeometry(162, 10, N(10), N(40)), M.steel);
  bellFlangeAft.position.z = -362;
  const bellFlangeFwd = add(fanDriveBell, new THREE.TorusGeometry(224, 10, N(10), N(40)), M.gunmetal);
  bellFlangeFwd.position.z = -102;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const arm = add(fanDriveBell, new THREE.BoxGeometry(34, 14, 275), M.steel);
    arm.position.set(Math.cos(a) * 193, Math.sin(a) * 193, -232);
    arm.rotation.z = a + Math.PI / 2;
    arm.rotation.x = 0.23;
    const rib = add(fanDriveBell, new THREE.BoxGeometry(12, 22, 265), M.gunmetal);
    rib.position.set(Math.cos(a) * 193, Math.sin(a) * 193, -232);
    rib.rotation.z = a + Math.PI / 2;
    rib.rotation.x = 0.23;
  }

  // ------------------------------------------------------------ 2. Station 1: GEARBOX (Exposed 3.06:1 Star Planetary)
  const gbxGrp = new THREE.Group();
  gbxGrp.position.z = 540;
  root.add(gbxGrp);
  tag(gbxGrp, {
    name: '3.06:1 Star Planetary Gearbox',
    subsystem: 'Fan Drive Gear System (FDGS)',
    material: 'Carburized 9310 Steel / Silicon Bronze Carrier',
    spec: '32T Sun → five 33T Helical Planets → 98T Ring (3.06:1)',
  }, [0, 0, 480]);

  const {sunTeeth, planetTeeth, ringTeeth, planets} = E.gearbox;
  const MOD = 1.5;
  const rSun = sunTeeth * MOD;
  const rPlanet = planetTeeth * MOD;
  const rRing = ringTeeth * MOD;

  const sunGear = new THREE.Group();
  gbxGrp.add(sunGear);
  add(sunGear, gear(sunTeeth, rSun + 3.2, rSun - 3.6, 66, 0.28, 22), M.steel);
  add(sunGear, new THREE.CylinderGeometry(31, 31, 86, N(24)), M.chrome).rotation.x = Math.PI / 2;
  tag(sunGear, {
    name: 'Planetary Sun Gear (32T)',
    subsystem: 'FDGS · LPT Input',
    material: 'Case-Hardened 9310 Alloy Steel',
    spec: '32T helical, +0.28 rad helix, driven at 3.06× fan speed',
  });

  const ringGear = new THREE.Group();
  gbxGrp.add(ringGear);
  const ringGeo = plain
    ? latheZ([[rRing, -35], [rRing + 28, -35], [rRing + 28, 35], [rRing, 35], [rRing, -35]], N(48))
    : internalGearGeo(ringTeeth, rRing - 3.2, rRing + 3.6, rRing + 26, 70, -0.28);
  add(ringGear, ringGeo, M.gunmetal);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const lug = add(ringGear, new THREE.BoxGeometry(24, 14, 24), M.crimson);
    lug.position.set(Math.cos(a) * (rRing + 26), Math.sin(a) * (rRing + 26), 24);
    lug.rotation.z = a;
  }
  tag(ringGear, {
    name: 'Internal Fan Ring Gear (98T)',
    subsystem: 'FDGS · Output Ring',
    material: 'Nitrided Forged Steel',
    spec: '98T internal helical teeth, drives fan at 1/3.06 LPT speed',
  });

  const starCarrier = new THREE.Group();
  gbxGrp.add(starCarrier);
  tag(starCarrier, {
    name: 'Fixed Star Planetary Carrier',
    subsystem: 'FDGS · Torque Reaction Frame',
    material: 'Machined Silicon Bronze & Titanium',
    spec: '5-pin stationary carrier transferring 3.06:1 reaction torque',
  });
  const carrierRingRear = add(starCarrier, new THREE.TorusGeometry(rSun + rPlanet, 11, N(12), N(48)), M.bronze);
  carrierRingRear.position.z = -46;
  const carrierRingFront = add(starCarrier, new THREE.TorusGeometry(rSun + rPlanet, 9, N(12), N(48)), M.bronze);
  carrierRingFront.position.z = 46;

  const planetGears = [];
  for (let k = 0; k < planets; k++) {
    const phi = (k * Math.PI * 2) / planets;
    const px = Math.cos(phi) * (rSun + rPlanet);
    const py = Math.sin(phi) * (rSun + rPlanet);

    const pin = add(starCarrier, new THREE.CylinderGeometry(16, 16, 102, N(20)), M.bronze);
    pin.rotation.x = Math.PI / 2;
    pin.position.set(px, py, 0);

    const pg = new THREE.Group();
    pg.position.set(px, py, 0);
    gbxGrp.add(pg);
    add(pg, gear(planetTeeth, rPlanet + 3.2, rPlanet - 3.6, 66, -0.28, 17), M.alu);
    add(pg, new THREE.CylinderGeometry(24, 24, 72, N(20)), M.steel).rotation.x = Math.PI / 2;
    tag(pg, {
      name: `Helical Planet Gear #${k + 1} (33T)`,
      subsystem: 'FDGS · Star Planetary',
      material: 'Case-Hardened 9310 Steel / Journal Bearing',
      spec: `33T helical, −0.28 rad helix at ${(phi / D2R).toFixed(0)}° carrier station`,
    });
    planetGears.push(pg);
  }

  // 5 bronze oil-jet nozzles aimed between sun and planet gear meshes
  for (let k = 0; k < planets; k++) {
    const phi = (k * Math.PI * 2) / planets + Math.PI / planets;
    const oilJet = new THREE.Group();
    const nozzleBody = add(oilJet, new THREE.CylinderGeometry(4.5, 3, 52, N(8)), M.bronze);
    nozzleBody.rotation.x = Math.PI / 2;
    const nozzleTip = add(oilJet, new THREE.SphereGeometry(5.5, N(8), N(6)), M.chrome);
    nozzleTip.position.z = -27;
    oilJet.position.set(Math.cos(phi) * (rSun + rPlanet * 0.8), Math.sin(phi) * (rSun + rPlanet * 0.8), 44);
    oilJet.lookAt(Math.cos(phi) * (rSun + 6), Math.sin(phi) * (rSun + 6), 0);
    gbxGrp.add(oilJet);
    tag(oilJet, {
      name: `Oil Jet Spray Nozzle #${k + 1}`,
      subsystem: 'FDGS · Lubrication',
      material: 'Silicon Bronze / Chrome Orifice Tip',
      spec: 'Pressurized synthetic ester jet at 32T/33T helical mesh',
    });
  }

  // ------------------------------------------------------------ Concentric Dual-Spool Shafts + Intermediate AGB & Plumbing
  const lpShaft = new THREE.Group();
  root.add(lpShaft);
  tag(lpShaft, {
    name: 'LP Inner Drive Shaft (LPT → Sun)',
    subsystem: 'LP Spool · High-Speed Core Shaft',
    material: 'Vacuum-Melted Maraging Steel',
    spec: 'Ø54 × 1,960 mm inner shaft at 3.06× fan speed (max 10,404 RPM)',
  });
  add(lpShaft, new THREE.CylinderGeometry(27, 27, 1960, N(24)), M.chrome).rotation.x = Math.PI / 2;
  lpShaft.position.z = -410;
  for (let z = -900; z <= 420; z += 330) {
    const stripe = add(lpShaft, new THREE.BoxGeometry(62, 10, 26), M.crimson);
    stripe.position.z = z + 410;
  }

  const hpShaft = new THREE.Group();
  root.add(hpShaft);
  tag(hpShaft, {
    name: 'HP Outer Hollow Spool Shaft (HPT → HPC)',
    subsystem: 'HP Spool (N2) · Concentric Core',
    material: 'Inconel 718 Tubular Shaft',
    spec: 'Ø118 × 1,040 mm concentric outer shaft (up to 10,400 RPM)',
  });
  const hpTube = add(hpShaft, new THREE.CylinderGeometry(59, 59, 1040, N(32), 1, true), M.bronze);
  hpTube.rotation.x = Math.PI / 2;
  hpTube.position.z = -490;
  for (let z = -960; z <= -40; z += 230) {
    const rib = add(hpShaft, new THREE.BoxGeometry(126, 12, 22), M.steel);
    rib.position.z = z;
  }

  // Accessory Gearbox (AGB), Intermediate-Frame Bevel Tower Shaft (at z=+25 clear of all rotor stages) & External Plumbing
  const agbGrp = new THREE.Group();
  root.add(agbGrp);
  tag(agbGrp, {
    name: 'Accessory Gearbox (AGB) & Transfer Drive',
    subsystem: 'Accessories · Mechanical PTO (N2)',
    material: 'Cast Mg-Al Alloy / Braided 321 SS Piping',
    spec: 'Driven from N2 HP spool at Intermediate Case (z = +25 mm) without blade interference',
  }, [0, -480, 0]);

  // N2 HP bevel takeoff ring + lower beveled pinion collar at z = +25 (clear gap between LPC Stage 3 & HPC Stage 1!)
  const tgbCollar = add(agbGrp, new THREE.CylinderGeometry(76, 70, 38, N(20)), M.steel);
  tgbCollar.rotation.x = Math.PI / 2;
  tgbCollar.position.set(0, 0, 25);
  const tgbPinion = add(agbGrp, new THREE.CylinderGeometry(24, 34, 36, N(16)), M.bronze);
  tgbPinion.position.set(0, -82, 25);

  // Radial Tower Shaft inside streamlined bifurcation shroud (y = -85 .. -475 at z = +25)
  const towerShaft = add(agbGrp, new THREE.CylinderGeometry(13, 13, 395, N(16)), M.chrome);
  towerShaft.position.set(0, -280, 25);
  const towerSleeve = add(agbGrp, new THREE.CylinderGeometry(22, 22, 165, N(16)), M.gunmetal);
  towerSleeve.position.set(0, -395, 25);
  tag(towerShaft, {
    name: 'Radial Bevel Transfer Tower Shaft',
    subsystem: 'AGB · HP Spool PTO',
    material: 'Ground 4340 Alloy Steel',
    spec: 'Extracts shaft power via Intermediate Frame strut at z = +25 mm',
  });

  // Contoured AGB Pod Housing under core shroud (y = -485..-575, z = +55..-245, inside outer nacelle envelope)
  const agbPod = add(agbGrp, new THREE.BoxGeometry(200, 88, 250), M.gunmetal);
  agbPod.position.set(0, -522, -95);
  const agbSump = add(agbGrp, new THREE.BoxGeometry(164, 24, 220), M.alu);
  agbSump.position.set(0, -574, -95);
  const agbCap = add(agbGrp, new THREE.CylinderGeometry(28, 28, 56, N(14)), M.crimson);
  agbCap.rotation.z = Math.PI / 2;
  agbCap.position.set(95, -522, 15);
  tag(agbPod, {
    name: 'Cast Accessory Gearbox Housing',
    subsystem: 'AGB · Engine Core Sump',
    material: 'Precision Cast WE43 Magnesium-Aluminium',
    spec: 'Houses bevel reduction gear train for 4 external engine accessories',
  });

  // 4 distinct engine-driven accessory units mounted on AGB pads
  const accSpecs = [
    {x: -66, y: -522, z: -260, r: 34, l: 105, m: M.alu, name: 'High-Pressure Vane Fuel Pump'},
    {x: 68, y: -518, z: -270, r: 32, l: 118, m: M.obsidianMatte, name: 'Integrated Drive Generator (IDG)'},
    {x: 64, y: -522, z: 75, r: 28, l: 88, m: M.titanium, name: 'Dual Hydraulic EDP Pump'},
    {x: -64, y: -522, z: 72, r: 30, l: 82, m: M.steel, name: 'Lube & Scavenge Oil Pump'},
  ];
  for (const acc of accSpecs) {
    const unit = add(agbGrp, new THREE.CylinderGeometry(acc.r, acc.r * 0.94, acc.l, N(16)), acc.m);
    unit.rotation.x = Math.PI / 2;
    unit.position.set(acc.x, acc.y, acc.z);
    const flange = add(agbGrp, new THREE.CylinderGeometry(acc.r + 6, acc.r + 6, 12, N(16)), M.bronze);
    flange.rotation.x = Math.PI / 2;
    flange.position.set(acc.x, acc.y, acc.z > 0 ? acc.z - acc.l * 0.42 : acc.z + acc.l * 0.42);
    tag(unit, {
      name: acc.name,
      subsystem: 'AGB · Accessory Drive Pad',
      material: 'Machined Aerospace Alloy / Bronze Pad Flange',
      spec: 'Quick-disconnect V-band accessory mount on AGB',
    });
  }

  // Fuel Distribution T-Block on bottom of Combustor Fuel Manifold (0, -397, -568)
  const manifoldT = add(agbGrp, new THREE.BoxGeometry(44, 24, 34), M.bronze);
  manifoldT.position.set(0, -402, -568);

  // 3 External Braided SS/Bronze Fuel & Oil Lines cleanly hugging BELOW Core Cowl (r >= 418, ZERO core intersections!)
  for (let p = 0; p < 3; p++) {
    const xOff = -28 + p * 28;
    const yBelly = -458 + (p === 1 ? 8 : 0);
    const pipePts = [
      new V3(xOff * 1.4, -490, -210),
      new V3(xOff * 1.2, yBelly, -320),
      new V3(xOff * 0.85, -438, -445),
      new V3(xOff * 0.35, -412, -562),
    ];
    const pipe = add(agbGrp, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pipePts), N(26), 6.5, 8, false), p === 1 ? M.steel : M.bronze);
    tag(pipe, {
      name: p === 1 ? 'Main High-Pressure Fuel Supply Line' : `External Oil / Servo Line #${p + 1}`,
      subsystem: 'AGB · External Plumbing',
      material: p === 1 ? 'Braided 321 Stainless Steel' : 'Brazed Silicon Bronze AN Line',
      spec: 'Routed below core casing into 20-port combustor manifold T-block',
    });
  }
  // 2 clamp brackets anchoring pipes under HPC casing
  for (const cz of [-335, -470]) {
    const clampBar = add(agbGrp, new THREE.BoxGeometry(86, 12, 16), M.gunmetal);
    clampBar.position.set(0, -446, cz);
  }

  // Stage-4 HPC Bleed-Air Extraction Duct hugging outside core cowl down to AGB/Anti-ice header
  const bleedDuctPts = [
    new V3(120, -405, -290),
    new V3(145, -435, -220),
    new V3(145, -455, -80),
    new V3(120, -475, 45),
  ];
  const bleedDuct = add(agbGrp, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bleedDuctPts), N(22), 14, 10, false), M.titanium);
  tag(bleedDuct, {
    name: 'HPC Stage-4 Bleed Extraction Duct',
    subsystem: 'HPC · Pneumatic Anti-Ice Feed',
    material: 'Insulated Titanium-321 Bellows Duct',
    spec: 'Routes compressed Stage-4 air around core shroud forward',
  });

  // ------------------------------------------------------------ Helper for axial compressor / turbine stages
  const buildAxialStages = (parent, stages, matHub, matBlade, matStator, explodeVec, labelFn) => {
    const rotors = [];
    const stators = [];
    for (const s of stages) {
      const rg = new THREE.Group();
      rg.position.z = s.z;
      parent.add(rg);
      add(rg, discGeo(s.rHub, s.discW, s.holeR, N(36)), matHub);
      // Chrome bolt-ring highlights on rotor web
      add(rg, new THREE.TorusGeometry(s.rHub * 0.72, 4.5, N(6), N(24)), M.steel);
      const bGeo = twistedBladeGeo({
        rIn: s.rHub - 4,
        rOut: s.rTip,
        chordIn: s.chord,
        chordOut: s.chord * 0.9,
        twistInDeg: s.twistIn,
        twistOutDeg: s.twistOut,
        thickIn: 7,
        thickOut: 4,
        camber: s.camber ?? 0.08,
        spanSegs: lo ? 2 : 4,
        chordSegs: lo ? 4 : 7,
      });
      add(rg, ringBladesGeo(bGeo, s.blades), matBlade);
      tag(rg, labelFn(s, true), explodeVec);
      rotors.push(rg);

      if (s.statorZ != null) {
        const sg = new THREE.Group();
        sg.position.z = s.statorZ;
        parent.add(sg);
        const sGeo = twistedBladeGeo({
          rIn: s.rHub + 12,
          rOut: s.rTip + 14,
          chordIn: s.chord * 0.85,
          chordOut: s.chord * 0.85,
          twistInDeg: -s.twistIn * 0.75,
          twistOutDeg: -s.twistOut * 0.75,
          thickIn: 6,
          thickOut: 4,
          camber: -0.06,
          spanSegs: lo ? 2 : 3,
          chordSegs: lo ? 4 : 6,
        });
        add(sg, ringBladesGeo(sGeo, s.blades + 4), matStator);
        add(sg, new THREE.TorusGeometry(s.rTip + 16, 7.5, N(8), N(48)), matStator);
        tag(sg, labelFn(s, false), explodeVec);
        stators.push(sg);
      }
    }
    return {rotors, stators};
  };

  // ------------------------------------------------------------ 3. Station 2: LPC (3-Stage Booster)
  const lpcGrp = new THREE.Group();
  root.add(lpcGrp);
  tag(lpcGrp, {
    name: '3-Stage LP Booster Compressor',
    subsystem: 'LP Spool (N1) · Booster',
    material: 'Forged Ti-6Al-4V Blisks / Bronze Stators',
    spec: '3 axial stages (PR 1.26–2.60:1), driven at N1 fan speed',
  }, [0, 0, 240]);

  const lpcStages = [
    {n: 1, z: 330, statorZ: 280, rHub: 225, rTip: 410, holeR: 90, discW: 28, chord: 56, blades: 28, twistIn: 48, twistOut: 32},
    {n: 2, z: 225, statorZ: 175, rHub: 240, rTip: 398, holeR: 90, discW: 26, chord: 52, blades: 32, twistIn: 46, twistOut: 30},
    {n: 3, z: 120, statorZ: 70, rHub: 255, rTip: 386, holeR: 90, discW: 24, chord: 48, blades: 34, twistIn: 44, twistOut: 28},
  ];
  const lpcParts = buildAxialStages(lpcGrp, lpcStages, M.gunmetal, M.steel, M.bronze, [0, 0, 240], (s, isR) => ({
    name: `LPC Stage ${s.n} ${isR ? 'Rotor Blisk' : 'Stator Ring'}`,
    subsystem: 'LPC · Low-Pressure Booster',
    material: isR ? 'Gunmetal Drum / Ti-6Al-4V Blades' : 'Silicon Bronze Stator Shroud',
    spec: `Stage ${s.n}/3 · ${s.blades + (isR ? 0 : 4)} airfoils · Ø${Math.round(s.rTip * 2)} mm`,
  }));

  // ------------------------------------------------------------ 4. Station 3: HPC (6-Stage Core Compressor)
  const hpcGrp = new THREE.Group();
  root.add(hpcGrp);
  tag(hpcGrp, {
    name: '6-Stage HP Core Compressor',
    subsystem: 'HP Spool (N2) · Core Compression',
    material: 'Gunmetal Rotor Hubs / Ti-6242 Blades / Bronze Vanes',
    spec: '6 converging stages (OPR up to 36.5:1), max 10,400 RPM',
  }, [0, 0, 0]);

  const hpcStages = [0, 1, 2, 3, 4, 5].map((i) => ({
    n: i + 1,
    z: -25 - i * 88,
    statorZ: -69 - i * 88,
    rHub: 264 + i * 10,
    rTip: 378 - i * 3.2,
    holeR: 62,
    discW: 22,
    chord: 44 - i * 2.2,
    blades: 36 + i * 3,
    twistIn: 44 - i * 1.2,
    twistOut: 30 - i * 1.0,
  }));
  const hpcParts = buildAxialStages(hpcGrp, hpcStages, M.gunmetal, M.steel, M.bronze, [0, 0, 0], (s, isR) => ({
    name: `HPC Stage ${s.n} ${isR ? 'Rotor Disc' : 'Stator Vanes'}`,
    subsystem: 'HPC · High-Pressure Core (N2)',
    material: isR ? (s.n <= 3 ? 'Ti-6242 Blisk' : 'Inconel 718 / Ti Hub') : 'Bronze Variable Vane Ring',
    spec: `Stage ${s.n}/6 · ${s.blades + (isR ? 0 : 4)} blades · ${s.n === 6 ? 'T3 up to 886 K' : 'axial compression'}`,
  }));

  const bleedRing = add(hpcGrp, new THREE.TorusGeometry(408, 12, N(10), N(48)), M.bronze);
  bleedRing.position.z = -290;
  tag(bleedRing, {
    name: 'HPC Interstage Bleed-Air Manifold',
    subsystem: 'HPC · Pneumatic Bleed',
    material: 'Brazed Silicon Bronze / Inconel',
    spec: 'Stage 4 customer & anti-ice bleed manifold',
  });

  // ------------------------------------------------------------ 5. Station 4: BURNER (Open 165° Combustor Window + Multi-Layer GLSL Plasma)
  const burnerGrp = new THREE.Group();
  root.add(burnerGrp);
  tag(burnerGrp, {
    name: 'Annular Lean-Burn Combustor',
    subsystem: 'Hot Section · Combustion (S4)',
    material: 'Ceramic-Coated Inconel 718 / Hastelloy X',
    spec: '20 dual-orifice swirl nozzles · 165° cutaway plasma chamber · T4 1,750 K',
  }, [0, 0, -260]);

  // Open combustor viewing window facing +X camera: phi = 20°..185° (165° open)
  // Solid outer liner + dark thermal shield spans the BACK 195°: phi = 185°..380°
  const BURN_PHI0 = 185 * D2R;
  const BURN_ARC = 195 * D2R;
  const BURN_PHI1 = BURN_PHI0 + BURN_ARC; // 380° (= 20°)
  const BURN_WIN_PHI0 = 20 * D2R;
  const BURN_WIN_ARC = 165 * D2R;

  const outerLinerPts = [
    [358, -565], [372, -620], [370, -760], [352, -830],
    [364, -830], [384, -760], [386, -620], [370, -565], [358, -565],
  ];
  const burnerOuterLiner = add(burnerGrp, latheZ(outerLinerPts, N(48), BURN_PHI0, BURN_ARC), M.inconel);
  const outerLinerComplement = add(burnerGrp, latheZ(outerLinerPts, N(40), BURN_WIN_PHI0, BURN_WIN_ARC), M.inconel);
  outerLinerComplement.visible = false;

  // Dark TBC Ceramic thermal backing wall tucked INSIDE the back 195° outer liner (r=348..356)
  // AND on the outer barrel of the inner liner (r=234..252) so combustion plasma contrasts sharply!
  const backThermalPts = [
    [349, -572], [355, -572], [368, -625], [366, -755], [349, -824], [344, -824], [359, -755], [361, -625], [349, -572],
  ];
  const burnerBackThermal = add(burnerGrp, latheZ(backThermalPts, N(36), BURN_PHI0 + 0.02, BURN_ARC - 0.04), M.thermalWall, false);

  const burnerTrimGrp = new THREE.Group();
  burnerGrp.add(burnerTrimGrp);
  add(burnerTrimGrp, latheCutFaceGeo(outerLinerPts, BURN_PHI0, false), M.cutawayLip, false);
  add(burnerTrimGrp, latheCutFaceGeo(outerLinerPts, BURN_PHI1, true), M.cutawayLip, false);

  // Inner combustion liner in dark thermal ceramic + structural front/aft bronze collars
  add(burnerGrp, latheZ([
    [232, -565], [220, -620], [222, -760], [240, -830],
    [252, -830], [234, -760], [232, -620], [244, -565], [232, -565],
  ], N(56)), M.thermalWall);

  // Fuel manifold ring + 20 machined bronze & steel fuel nozzles
  const fuelManifold = add(burnerGrp, new THREE.TorusGeometry(397, 9.5, N(10), N(56)), M.crimson);
  fuelManifold.position.z = -568;
  tag(fuelManifold, {
    name: '20-Port Fuel Distribution Manifold',
    subsystem: 'Hot Section · Fuel System',
    material: 'Braided Stainless / Crimson Thermal Jacket',
    spec: 'Supplies 20 dual-orifice swirl nozzles (0.14–1.48 kg/s)',
  });

  const flameletMat = lo
    ? new THREE.MeshBasicMaterial({color: '#00c8ff', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide})
    : makeFlameletMaterial();
  const singleFlameGeo = latheZ([[1, 0], [18, -32], [28, -95], [14, -155], [2, -185]], N(12));

  const flameletsGrp = new THREE.Group();
  burnerGrp.add(flameletsGrp);
  ignore(flameletsGrp);

  for (let i = 0; i < E.combustorNozzles; i++) {
    const a = (i / E.combustorNozzles) * Math.PI * 2;
    const ng = new THREE.Group();
    ng.rotation.z = a;
    ng.position.z = -575;
    burnerGrp.add(ng);
    const stem = add(ng, new THREE.CylinderGeometry(7, 7, 108, N(10)), M.bronze);
    stem.position.y = 352;
    const tip = add(ng, new THREE.CylinderGeometry(16, 11, 34, N(14)), M.steel);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(0, 300, -14);
    tag(ng, {
      name: `Fuel Swirl Injector #${i + 1} / 20`,
      subsystem: 'Combustor · Fuel Injection',
      material: 'Machined Silicon Bronze & Stellite Tip',
      spec: 'Dual-orifice air-blast atomizer nozzle',
    });

    // Anchored 3D swirling flamelet cone projecting downstream from nozzle tip
    const fl = new THREE.Mesh(singleFlameGeo, flameletMat);
    fl.position.set(-Math.sin(a) * 298, Math.cos(a) * 298, -592);
    fl.rotation.z = a;
    fl.rotation.y = 0.08;
    fl.renderOrder = 6;
    ignore(fl);
    flameletsGrp.add(fl);
  }

  // Dual Concentric GLSL Volumetric Annular Combustor Plasma Shells (z = -584..-824)
  const combMatOuter = lo
    ? new THREE.MeshBasicMaterial({color: '#ff6a1f', transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide})
    : makeCombustorMaterial(0.0);
  const combMatInner = lo ? combMatOuter : makeCombustorMaterial(1.0);

  const combOuterMesh = new THREE.Mesh(latheZ([[326, -584], [336, -650], [334, -760], [322, -824]], N(56)), combMatOuter);
  combOuterMesh.renderOrder = 5;
  ignore(combOuterMesh);
  burnerGrp.add(combOuterMesh);

  const combInnerMesh = new THREE.Mesh(latheZ([[268, -584], [260, -650], [262, -760], [274, -824]], N(56)), combMatInner);
  combInnerMesh.renderOrder = 5;
  ignore(combInnerMesh);
  burnerGrp.add(combInnerMesh);

  // ------------------------------------------------------------ 6. Station 5: HPT (2-Stage High-Pressure Turbine)
  const hptGrp = new THREE.Group();
  root.add(hptGrp);
  tag(hptGrp, {
    name: '2-Stage HP Turbine (N2 Drive)',
    subsystem: 'Hot Section · HPT (S4.5)',
    material: 'Single-Crystal CMSX-4 / Bronze NGVs',
    spec: '2 film-cooled stages extracting work to drive 6-stage HPC',
  }, [0, 0, -520]);

  const hptStages = [
    {n: 1, z: -885, statorZ: -850, rHub: 248, rTip: 368, holeR: 64, discW: 26, chord: 50, blades: 44, twistIn: -46, twistOut: -32, camber: -0.09},
    {n: 2, z: -975, statorZ: -932, rHub: 244, rTip: 382, holeR: 64, discW: 26, chord: 52, blades: 46, twistIn: -44, twistOut: -30, camber: -0.09},
  ];
  const hptParts = buildAxialStages(hptGrp, hptStages, M.gunmetal, M.alu, M.bronze, [0, 0, -520], (s, isR) => ({
    name: `HPT Stage ${s.n} ${isR ? 'Single-Crystal Rotor' : 'NGV Stator'}`,
    subsystem: 'HPT · High-Pressure Turbine (N2)',
    material: isR ? 'CMSX-4 Single-Crystal Nickel Alloy' : 'TBC-Coated Silicon Bronze NGV',
    spec: `Stage ${s.n}/2 · ${s.blades + (isR ? 0 : 4)} cooled airfoils`,
  }));

  // ------------------------------------------------------------ 7. Station 6: LPT (4-Stage Low-Pressure Turbine)
  const lptGrp = new THREE.Group();
  root.add(lptGrp);
  tag(lptGrp, {
    name: '4-Stage High-Speed LP Turbine',
    subsystem: 'Hot Section · LPT (S5 → 3.06:1 Gearbox)',
    material: 'Titanium-Aluminide (TiAl) / Bronze Stators',
    spec: '4 expanding stages running at 3.06× fan speed (up to 10,404 RPM)',
  }, [0, 0, -780]);

  const lptStages = [0, 1, 2, 3].map((i) => ({
    n: i + 1,
    z: -1085 - i * 94,
    statorZ: -1042 - i * 94,
    rHub: 236 - i * 6,
    rTip: 400 + i * 25,
    holeR: 32,
    discW: 24,
    chord: 50 + i * 3,
    blades: 48 + i * 3,
    twistIn: -44 + i * 1.5,
    twistOut: -26 + i * 1.0,
    camber: -0.08,
  }));
  const lptParts = buildAxialStages(lptGrp, lptStages, M.gunmetal, M.titanium, M.bronze, [0, 0, -780], (s, isR) => ({
    name: `LPT Stage ${s.n} ${isR ? 'TiAl Rotor' : 'Stator Ring'}`,
    subsystem: 'LPT · High-Speed Fan Drive Turbine',
    material: isR ? 'Gamma Titanium Aluminide (TiAl)' : 'Inconel / Bronze Vane Ring',
    spec: `Stage ${s.n}/4 · ${s.blades + (isR ? 0 : 4)} blades · Ø${Math.round(s.rTip * 2)} mm`,
  }));

  // ------------------------------------------------------------ 8. Station 7: NOZZLE (Chevron Mixer, Tailcone & Dual-Cone Mach Plume)
  const nozzleGrp = new THREE.Group();
  root.add(nozzleGrp);
  tag(nozzleGrp, {
    name: 'Chevron Exhaust Mixer & Tailcone',
    subsystem: 'Exhaust · Core Nozzle (S9)',
    material: 'Inconel 625 Acoustic Chevron Alloy',
    spec: '14-lobe scalloped mixer + dual-cone Mach shock-diamond plume',
  }, [0, 0, -1040]);

  const nozPts = [
    [488, -1420], [472, -1530], [442, -1620],
    [464, -1620], [496, -1530], [514, -1420], [488, -1420],
  ];
  const nozShell = add(nozzleGrp, latheZ(nozPts, N(56)), M.gunmetal);
  const nozChevrons = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const chev = add(nozzleGrp, new THREE.ConeGeometry(42, 95, 4), M.inconel);
    chev.rotation.z = a;
    chev.rotation.x = -Math.PI / 2;
    chev.position.set(Math.cos(a) * 442, Math.sin(a) * 442, -1645);
    chev.scale.set(1.2, 1, 0.35);
    nozChevrons.push(chev);
  }
  const conePts = [
    [0.01, -1815], [16, -1800], [105, -1680], [185, -1540], [220, -1420], [0.01, -1420],
  ];
  add(nozzleGrp, latheZ(conePts, N(48)), M.inconel);

  // Dual Nested Mach Shock-Diamond Plume Shells (open tapered LatheGeometry around Z, z = -1575..-2550)
  const plumeCoreMat = lo
    ? new THREE.MeshBasicMaterial({color: '#6b8bff', transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide})
    : makePlumeMaterial(true);
  const plumeOuterMat = lo
    ? new THREE.MeshBasicMaterial({color: '#f05a23', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide})
    : makePlumeMaterial(false);

  // Sleek aerodynamic inner Mach shock-diamond core cone (shock diamonds rendered sharply in GLSL)
  const corePlumePts = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    const z = -1580 - u * 890;
    const r = 215 * (1 - u * 0.84) + 14;
    corePlumePts.push([r, z]);
  }
  const plumeCoreMesh = new THREE.Mesh(latheZ(corePlumePts, N(40)), plumeCoreMat);
  plumeCoreMesh.renderOrder = 6;
  ignore(plumeCoreMesh);
  nozzleGrp.add(plumeCoreMesh);

  // Outer feathered chevron mixing shear envelope
  const outerPlumePts = [];
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    const z = -1575 - u * 980;
    const r = 435 * (1 - u * 0.48);
    outerPlumePts.push([r, z]);
  }
  const plumeOuterMesh = new THREE.Mesh(latheZ(outerPlumePts, N(44)), plumeOuterMat);
  plumeOuterMesh.renderOrder = 5;
  ignore(plumeOuterMesh);
  nozzleGrp.add(plumeOuterMesh);

  // ------------------------------------------------------------ Airflow Streamlines (12:1 Cold Bypass & Hot Core)
  const flowGrp = new THREE.Group();
  root.add(flowGrp);
  ignore(flowGrp);
  const coldArrows = [];
  const hotArrows = [];
  const makeStreamArrow = (r, mat, len = 180) => {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, len, 10), mat);
    shaft.rotation.x = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(20, 48, 12), mat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -len * 0.5 - 20;
    g.add(shaft, tip);
    g.position.set(r.x, r.y, 0);
    g.renderOrder = 5;
    flowGrp.add(g);
    return g;
  };
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.25;
    coldArrows.push({
      mesh: makeStreamArrow({x: Math.cos(a) * 735, y: Math.sin(a) * 735}, M.flowBlue, 220),
      phase: i / 6,
      zStart: 1220,
      zSpan: 1950,
    });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    hotArrows.push({
      mesh: makeStreamArrow({x: Math.cos(a) * 310, y: Math.sin(a) * 310}, M.flowHot, 170),
      phase: i / 4,
      zStart: -820,
      zSpan: 1180,
    });
  }

  // ------------------------------------------------------------ Cutaway & Stencil Caps
  const stations = [fanGrp, gbxGrp, lpcGrp, hpcGrp, burnerGrp, hptGrp, lptGrp, nozzleGrp];
  const stationNames = STATIONS.map((s) => s.id);

  const tmp = new V3();
  const CLIP = new THREE.Plane(new V3(-1, 0, 0), 0);
  const X_CUT = new V3(-1, 0, 0);

  const GHOST = new Map(
    Object.values(M).map((m) => {
      const g = m.clone();
      g.transparent = true;
      g.depthWrite = false;
      return [m, g];
    }),
  );
  root.traverse((m) => m.isMesh && (m.userData.mat0 = m.material));
  const ghosted = new Set();

  const xrayMat = lo
    ? new THREE.MeshLambertMaterial({color: '#435366', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide})
    : makeXrayMaterial();
  const xrayMeshes = [];
  for (const obj of [
    nacelleGrp,
    coreCowlGrp,
    agbPod,
    agbSump,
    agbCap,
    towerSleeve,
    burnerOuterLiner,
    outerLinerComplement,
    burnerBackThermal,
    burnerTrimGrp,
    nozShell,
    ...nozChevrons,
  ]) {
    obj.traverse((m) => {
      if (m.isMesh && !m.userData.ignoreInspect) xrayMeshes.push(m);
    });
  }
  let xrayOn = false;
  const setXray = (on) => {
    xrayOn = !!on;
  };

  let cap = null;
  const helpers = [];
  if (opts.caps) {
    const inc = THREE.IncrementWrapStencilOp;
    const dec = THREE.DecrementWrapStencilOp;
    const count = (side, op) =>
      new THREE.MeshBasicMaterial({
        side,
        colorWrite: false,
        depthWrite: false,
        depthTest: false,
        stencilWrite: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilFail: op,
        stencilZFail: op,
        stencilZPass: op,
        clippingPlanes: [CLIP],
      });
    helpers.push(count(THREE.BackSide, inc), count(THREE.FrontSide, dec));
    // Include only closed/manifold structural solids (exclude open overlay caps & glass)
    const solid = new Set([M.obsidian, M.obsidianMatte, M.titanium, M.gunmetal, M.steel, M.chrome, M.alu, M.bronze, M.inconel, M.crimson, M.carbonShell, M.coreShell, M.thermalWall]);
    const skipStencil = new Set([acousticLiner]);
    const parts = [];
    root.traverse((m) => m.isMesh && solid.has(m.material) && !skipStencil.has(m) && parts.push(m));
    for (const m of parts) {
      for (const mat of helpers) {
        const h = new THREE.Mesh(m.geometry, mat);
        h.renderOrder = 1;
        h.userData.ignoreInspect = true;
        m.add(h);
      }
    }
    const rep = THREE.ReplaceStencilOp;
    cap = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 5.2),
      new THREE.MeshStandardMaterial({
        color: opts.caps,
        roughness: 0.55,
        metalness: 0,
        side: THREE.DoubleSide,
        stencilWrite: true,
        stencilRef: 0,
        stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: rep,
        stencilZFail: rep,
        stencilZPass: rep,
      }),
    );
    cap.renderOrder = 1.1;
    cap.userData.ignoreInspect = true;
    cap.onAfterRender = (r) => r.clearStencil();
    for (const mat of [...helpers, cap.material]) mat.visible = false;
  }

  const C0 = new V3(0, 0, -0.2);
  const placeCap = () => {
    if (!cap) return;
    cap.position.copy(C0).addScaledVector(CLIP.normal, -CLIP.distanceToPoint(C0));
    cap.quaternion.setFromUnitVectors(new V3(0, 0, 1), tmp.copy(CLIP.normal).negate());
  };

  for (const m of [...Object.values(M), ...GHOST.values()]) m.clipShadows = true;
  const clipMats = () => [...Object.values(M), ...GHOST.values(), xrayMat, combMatOuter, combMatInner, flameletMat, plumeCoreMat, plumeOuterMat];
  let cutNow = 'glass';
  let glassOpacity = 0.03;

  const setCut = (mode, distWorld = 0, normal = X_CUT) => {
    CLIP.normal.copy(normal);
    CLIP.constant = distWorld;
    placeCap();
    if (mode === cutNow) return;
    cutNow = mode;
    for (const m of clipMats()) {
      m.clippingPlanes = mode === 'section' ? [CLIP] : null;
      m.needsUpdate = true;
    }
    if (cap) for (const mat of [...helpers, cap.material]) mat.visible = mode === 'section';

    const showFullShell = mode === 'solid' || mode === 'section';
    nacComplement.visible = showFullShell;
    ccComplement.visible = showFullShell;
    outerLinerComplement.visible = showFullShell;
    glassTrimGrp.visible = !showFullShell;
    coreTrimGrp.visible = !showFullShell;
    burnerTrimGrp.visible = !showFullShell;

    if (lo) {
      for (const m of [...Object.values(M), ...GHOST.values()]) m.side = mode === 'section' ? THREE.DoubleSide : THREE.FrontSide;
      return;
    }
    M.shroud.color.set(showFullShell ? '#464d57' : '#ffffff');
    M.shroud.transparent = !showFullShell;
    M.shroud.opacity = showFullShell ? 1.0 : glassOpacity;
    M.shroud.depthWrite = showFullShell;
    M.shroud.needsUpdate = true;
  };

  const setRefract = (on) => {
    glassOpacity = on ? 0.06 : 0.025;
    M.shroud.envMapIntensity = on ? 1.4 : 0.3;
    if (cutNow === 'glass') M.shroud.opacity = glassOpacity;
  };

  const resolveSoloSet = (solo) => {
    if (solo == null || solo === -1 || solo === 'ALL') return null;
    if (typeof solo === 'string') {
      const up = solo.toUpperCase();
      if (up === 'TURBINE') return new Set([5, 6]);
      const idx = stationNames.indexOf(up);
      return idx >= 0 ? new Set([idx]) : null;
    }
    return solo >= 0 && solo < stations.length ? new Set([solo]) : null;
  };

  // ------------------------------------------------------------ Frame Update
  const update = (state, ops = {}) => {
    for (const m of ghosted) m.material = m.userData.mat0;
    ghosted.clear();

    const sObj = typeof state === 'number' ? {fanDeg: state} : state || {};
    const fanDeg = sObj.fanDeg ?? sObj.th ?? 0;
    const n2Deg = sObj.n2Deg ?? fanDeg * 2.8;
    const throttle = Math.min(1, Math.max(0, sObj.throttle ?? ops.throttle ?? 0.35));
    const timeSec = sObj.time ?? fanDeg / 180;

    const soloSet = resolveSoloSet(ops.solo);
    const all = !soloSet;
    const aRest = all ? 1 : 1 - Math.min(1, Math.max(0, ops.fade ?? 0.92));

    const ex = ops.explode ?? 0;
    const lay = (a) => smoother((ex - a) / 0.45);
    const eNac = lay(0);
    const eFan = lay(0.08);
    const eGbx = lay(0.16);
    const eLpc = lay(0.24);
    const eBurn = lay(0.32);
    const eHpt = lay(0.40);
    const eLpt = lay(0.48);
    const eNoz = lay(0.56);

    nacelleGrp.position.set(0, 480 * eNac, 360 * eNac);
    coreCowlGrp.position.set(0, -400 * eNac, 0);
    agbGrp.position.set(0, -420 * eNac, 0);
    ogvGrp.position.z = 480 + 300 * eGbx;

    fanGrp.position.z = 820 * eFan;
    spinner.position.z = 260 * lay(0.02);
    gbxGrp.position.z = 540 + 440 * eGbx;
    lpcGrp.position.z = 220 * eLpc;
    hpcGrp.position.z = 0;
    burnerGrp.position.z = -260 * eBurn;
    hptGrp.position.z = -500 * eHpt;
    lptGrp.position.z = -760 * eLpt;
    nozzleGrp.position.z = -1020 * eNoz;

    // Dual-spool & 3.06:1 star planetary kinematics
    const {ringRad, sunRad, planetRads} = gearboxAngles(fanDeg);
    const n2Rad = n2Deg * D2R;

    fanRotor.rotation.z = ringRad;
    ringGear.rotation.z = ringRad;
    sunGear.rotation.z = sunRad;
    lpShaft.rotation.z = sunRad;
    for (let k = 0; k < planetGears.length; k++) {
      planetGears[k].rotation.z = planetRads[k];
    }
    for (const r of lpcParts.rotors) r.rotation.z = ringRad;
    for (const r of hpcParts.rotors) r.rotation.z = n2Rad;
    hpShaft.rotation.z = n2Rad;
    for (const r of hptParts.rotors) r.rotation.z = n2Rad;
    for (const r of lptParts.rotors) r.rotation.z = sunRad;

    // Volumetric combustor & dual-cone Mach plume shaders
    const plasmaOn = (ops.plasma ?? 1) > 0.01 && ex === 0;
    const flowOn = (ops.flow ?? 1) > 0.01 && ex === 0;
    const showBurnPlasma = plasmaOn && (all || soloSet.has(4) || aRest > 0.05);
    combOuterMesh.visible = showBurnPlasma;
    combInnerMesh.visible = showBurnPlasma;
    flameletsGrp.visible = showBurnPlasma;
    const showPlume = plasmaOn && (all || soloSet.has(7) || aRest > 0.05);
    plumeCoreMesh.visible = showPlume;
    plumeOuterMesh.visible = showPlume;

    const swirl = timeSec * (2.8 + 6.0 * throttle);
    if (!lo) {
      const burnMul = (ops.plasma ?? 1) * (all || soloSet.has(4) ? 1 : aRest);
      combMatOuter.uniforms.uThrottle.value = throttle;
      combMatOuter.uniforms.uSwirl.value = swirl;
      combMatOuter.uniforms.uOpacity.value = 0.94 * burnMul;
      combMatInner.uniforms.uThrottle.value = throttle;
      combMatInner.uniforms.uSwirl.value = swirl * 1.15;
      combMatInner.uniforms.uOpacity.value = 0.92 * burnMul;
      flameletMat.uniforms.uThrottle.value = throttle;
      flameletMat.uniforms.uSwirl.value = swirl;
      flameletMat.uniforms.uOpacity.value = 0.95 * burnMul;

      const nozMul = (ops.plasma ?? 1) * (all || soloSet.has(7) ? 1 : aRest);
      plumeCoreMat.uniforms.uThrottle.value = throttle;
      plumeCoreMat.uniforms.uSwirl.value = swirl;
      plumeCoreMat.uniforms.uOpacity.value = 0.94 * nozMul;
      plumeOuterMat.uniforms.uThrottle.value = throttle;
      plumeOuterMat.uniforms.uSwirl.value = swirl;
      plumeOuterMat.uniforms.uOpacity.value = 0.78 * nozMul;
    } else {
      combMatOuter.opacity = (ops.plasma ?? 1) * (0.45 + 0.45 * throttle);
      flameletMat.opacity = (ops.plasma ?? 1) * (0.4 + 0.5 * throttle);
      plumeCoreMat.opacity = (ops.plasma ?? 1) * (0.3 + 0.45 * throttle);
      plumeOuterMat.opacity = (ops.plasma ?? 1) * (0.18 + 0.35 * throttle);
    }

    // Animated bypass & core airflow arrows
    flowGrp.visible = flowOn && all;
    if (flowGrp.visible) {
      const flowSpeed = 0.35 + 0.95 * throttle;
      for (const item of coldArrows) {
        const u = (item.phase + timeSec * flowSpeed) % 1;
        item.mesh.position.z = item.zStart - u * item.zSpan;
      }
      for (const item of hotArrows) {
        const u = (item.phase + timeSec * (flowSpeed * 1.4)) % 1;
        item.mesh.position.z = item.zStart - u * item.zSpan;
      }
    }

    // Isolation / ghosting visibility
    const showNacelle = all;
    nacelleGrp.visible = showNacelle;
    coreCowlGrp.visible = showNacelle;
    agbGrp.visible = all || soloSet.has(3);
    ogvGrp.visible = all || soloSet.has(0);
    lpShaft.visible = all || soloSet.has(1) || soloSet.has(6);
    hpShaft.visible = all || soloSet.has(3) || soloSet.has(5);
    stations.forEach((sg, i) => {
      sg.visible = all || soloSet.has(i);
    });

    if (xrayOn) {
      for (const m of xrayMeshes) {
        m.material = xrayMat;
        ghosted.add(m);
      }
    }

    if (!all && aRest > 0.001) {
      const rest = [nacelleGrp, coreCowlGrp];
      if (!soloSet.has(3)) rest.push(agbGrp);
      if (!soloSet.has(0)) rest.push(ogvGrp);
      if (!soloSet.has(1) && !soloSet.has(6)) rest.push(lpShaft);
      if (!soloSet.has(3) && !soloSet.has(5)) rest.push(hpShaft);
      stations.forEach((sg, i) => !soloSet.has(i) && rest.push(sg));
      for (const [m, g] of GHOST) g.opacity = (m.transparent ? m.opacity : 1) * aRest;
      for (const o of rest) {
        o.visible = true;
        o.traverse((m) => {
          if (m.isMesh && GHOST.has(m.userData.mat0)) {
            m.material = GHOST.get(m.userData.mat0);
            ghosted.add(m);
          }
        });
      }
    }
  };

  root.scale.setScalar(0.001);
  return {root, update, M, stations, stationNames, setCut, setRefract, setXray, CLIP, cap};
}
