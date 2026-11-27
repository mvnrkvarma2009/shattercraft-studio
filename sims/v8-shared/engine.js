// The V8 itself, built from code in millimetres in the look of a clean study model: a gloss-black open block of
// V-shaped bulkheads, glass cylinder liners with a GLSL volumetric charge + TDC spark flash, cutaway cross-ram
// intake plenum + 8 velocity stacks + crimson billet fuel rails & sequential pulsing injectors, 4-into-1 exhaust
// merge collectors, front serpentine belt drive (water pump, tensioner, alternator), CNC lightened 2:1 helical
// timing gears, articulated roller-rockers + crimson coil-on-plug packs, cross-plane crank, machined flywheel,
// ribbed oil sump, and solid-capped section cuts.
import * as THREE from 'three';
import { buildAccessoryDressup, buildHybridValveCovers, buildSumpAndBlockDressup, createDressupMaterials } from './dressup.js';
import { BANK, bankXY, chargeOf, CYL, E, exhaustPulse, FIRE, injectorPulse, liftEx, liftIn, piston, pinXY, psi, PIN_PHASE, pressure, rockerAngle, sparkIntensity, VALVE } from './kin.js';

const V3 = THREE.Vector3;
const D2R = Math.PI / 180;
const DECK = E.deck;
const smoother = (x) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};

// ------------------------------------------------------------ geometry helpers
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
  if (holeR) {
    const h = new THREE.Path();
    h.absarc(0, 0, holeR, 0, Math.PI * 2, true);
    sh.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.0, bevelSegments: 1, curveSegments: 4 });
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
// a gear's blank: a plain disc at the pitch radius, the same width, bevel and bore, no teeth
function discGeo(r, width, holeR = 0, seg = 48) {
  const sh = new THREE.Shape();
  sh.absarc(0, 0, r, 0, Math.PI * 2, false);
  if (holeR) {
    const h = new THREE.Path();
    h.absarc(0, 0, holeR, 0, Math.PI * 2, true);
    sh.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 1.0, bevelSegments: 1, curveSegments: seg });
  g.translate(0, 0, -width / 2);
  return g;
}
function helixGeo(r, wire, turns, len, seg = 220) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const a = u * turns * Math.PI * 2;
    pts.push(new V3(Math.cos(a) * r, u * len, Math.sin(a) * r));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, wire, 8, false);
}
// a crank web: the main boss, the pin boss and a counterweight sector opposite the pin, in the XY plane
function webGeo(thick, cs = 28) {
  const sh = new THREE.Shape();
  const R = 76;
  sh.moveTo(-R * Math.sin(1.05), -R * Math.cos(1.05));
  sh.absarc(0, 0, R, -Math.PI / 2 - 1.05, -Math.PI / 2 + 1.05, false);
  sh.lineTo(30, 10);
  sh.absarc(0, E.r, 31, 0, Math.PI, false);
  sh.lineTo(-30, 10);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: 2.4, bevelSize: 2.2, bevelSegments: 2, curveSegments: cs });
  g.translate(0, 0, -thick / 2);
  return g;
}
// a V bulkhead: the crank bore, two arms up to each bank's deck
function bulkheadGeo(thick, cs = 24) {
  const sh = new THREE.Shape();
  const W = 54;
  const arm = (bank, w, d) => {
    const B = BANK[bank];
    return [d * B.b[0] + w * B.p[0], d * B.b[1] + w * B.p[1]];
  };
  const ordered = [[-95, -70], [95, -70], arm('L', W + 18, 40), arm('L', W, DECK - 12), arm('L', -W, DECK - 12), [0, 118], arm('R', -W, DECK - 12), arm('R', W, DECK - 12), arm('R', W + 18, 40)];
  ordered.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  sh.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, 44, 0, Math.PI * 2, true);
  sh.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 2, curveSegments: cs });
  g.translate(0, 0, -thick / 2);
  return g;
}

// Volumetric GLSL charge material (ANGLE/D3D11 safe: all pow() bases clamped > 0)
function makeChargeMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clipping: true,
    uniforms: {
      uColor: { value: new THREE.Color('#3f8de0') },
      uOpacity: { value: 0.35 },
      uSpark: { value: 0 },
      uSwirl: { value: 0 },
      uStroke: { value: 0 },
      uBeat: { value: 0 },
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
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uSpark;
      uniform float uSwirl;
      uniform float uStroke;
      uniform float uBeat;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        #include <clipping_planes_fragment>
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewPos);
        float fresnel = pow(max(1.0 - abs(dot(n, v)), 0.0001), 1.65);
        float topBias = pow(max(vUv.y, 0.0001), 1.35);
        float swirl = 0.5 + 0.5 * sin(vUv.x * 18.84955 + vUv.y * 9.0 - uSwirl);
        vec3 col = uColor;
        float alpha = uOpacity * (0.65 + 0.55 * fresnel);
        if (uStroke > 1.5 && uStroke < 2.5) {
          // Multi-layer turbulent combustion fire: sapphire ignition -> gold-white core -> crimson-orange flame front
          float turbA = 0.5 + 0.5 * sin(vUv.x * 18.84955 - uSwirl * 2.2 + sin(vUv.y * 10.0 + uSwirl) * 1.4);
          float turbB = 0.5 + 0.5 * cos(vUv.x * 31.4159 + vUv.y * 14.0 - uSwirl * 3.1);
          float billow = clamp(0.55 * turbA + 0.45 * turbB, 0.0, 1.0);
          vec3 sapphire = vec3(0.08, 0.56, 1.0);
          vec3 goldCore = vec3(1.0, 0.94, 0.66);
          vec3 flameMid = vec3(1.0, 0.42, 0.05);
          vec3 flameOuter = vec3(0.84, 0.09, 0.10);
          col = mix(flameOuter, flameMid, clamp(billow * 0.85 + 0.25 * topBias, 0.0, 1.0));
          float hotMix = clamp((0.45 + 0.4 * uBeat) * topBias * (0.55 + 0.45 * billow) + uSpark * 0.55 * topBias, 0.0, 1.0);
          col = mix(col, goldCore, hotMix);
          float blueKernel = uSpark * pow(max(vUv.y, 0.0001), 2.4) * (0.65 + 0.35 * fresnel);
          col = mix(col, sapphire, clamp(blueKernel * 0.72, 0.0, 0.78));
          alpha = uOpacity * (0.82 + 0.45 * fresnel + 0.28 * billow) + (uSpark * 0.44 + uBeat * 0.22) * topBias;
        } else if (uStroke < 0.5) {
          col = mix(col, vec3(0.55, 0.82, 1.0), 0.25 * swirl);
          alpha *= (0.85 + 0.25 * swirl);
        } else if (uStroke > 2.5) {
          float pulse = 0.5 + 0.5 * sin(vUv.y * 12.0 - uSwirl * 1.4);
          col = mix(col, vec3(0.95, 0.55, 0.28), (0.18 + 0.14 * uBeat) * pulse * topBias);
        }
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.94));
      }
    `,
  });
}

// Dual-layer GLSL continuous exhaust collector flame shader (smooth supersonic blue core / multi-frequency fire tongue)
function makeCollectorFlameMaterial(isCore) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clipping: true,
    uniforms: {
      uPulse: { value: 0 },
      uBeat: { value: 0 },
      uSwirl: { value: 0 },
      uOpacity: { value: 0 },
      uIsCore: { value: isCore ? 1.0 : 0.0 },
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
      uniform float uPulse;
      uniform float uBeat;
      uniform float uSwirl;
      uniform float uOpacity;
      uniform float uIsCore;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        #include <clipping_planes_fragment>
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewPos);
        float edgeFade = pow(max(abs(dot(n, v)), 0.0001), 0.65);
        float ang = vUv.x * 6.2831853;
        vec3 col;
        float a;
        if (uIsCore > 0.5) {
          float coreLen = smoothstep(0.0, 0.08, vUv.y) * pow(max(1.0 - vUv.y, 0.0001), 1.65);
          float shockNode = exp(-pow((vUv.y - 0.16) * 7.5, 2.0)) * 0.75 + exp(-pow((vUv.y - 0.36) * 8.5, 2.0)) * 0.35;
          vec3 blueViolet = vec3(0.14, 0.36, 1.0);
          vec3 hotCyanWhite = vec3(0.88, 0.96, 1.0);
          col = mix(blueViolet, hotCyanWhite, clamp(shockNode * 0.9 + (1.0 - vUv.y) * 0.45, 0.0, 1.0));
          a = clamp(uOpacity * 1.1, 0.0, 0.96) * coreLen * edgeFade * (0.72 + 0.4 * shockNode + 0.25 * uBeat);
        } else {
          float turbA = 0.5 + 0.5 * sin(ang * 2.0 + vUv.y * 5.2 - uSwirl * 3.8 + 1.3 * cos(ang * 3.0 - vUv.y * 3.6 + uSwirl * 1.9));
          float turbB = 0.5 + 0.5 * cos(ang * 4.0 - vUv.y * 8.5 + uSwirl * 2.6);
          float flameTurb = clamp(0.62 * turbA + 0.38 * turbB, 0.0, 1.0);
          float tipCutoff = smoothstep(1.0, 0.42 + 0.38 * flameTurb, vUv.y);
          float rootIn = smoothstep(0.0, 0.07, vUv.y);
          vec3 whiteGold = vec3(1.0, 0.95, 0.68);
          vec3 blazeOrange = vec3(1.0, 0.44, 0.04);
          vec3 deepCrimson = vec3(0.82, 0.08, 0.02);
          col = mix(blazeOrange, deepCrimson, smoothstep(0.28, 0.88, vUv.y + 0.14 * (1.0 - flameTurb)));
          col = mix(col, whiteGold, smoothstep(0.32, 0.0, vUv.y) * (0.72 + 0.28 * uBeat));
          float axial = pow(max(1.0 - vUv.y, 0.0001), 0.95) * rootIn * tipCutoff;
          a = clamp(uOpacity * 1.15, 0.0, 0.96) * axial * edgeFade * (0.68 + 0.35 * flameTurb + 0.24 * uPulse);
        }
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.96));
      }
    `,
  });
}

// Crisp translucent cyan-cobalt Fresnel X-Ray ShaderMaterial (FrontSide so backfaces never muddy internals)
function makeXrayMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    clipping: true,
    uniforms: {
      uColor: { value: new THREE.Color('#5eb8f2') },
      uRimColor: { value: new THREE.Color('#2d86d6') },
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
      uniform vec3 uRimColor;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        #include <clipping_planes_fragment>
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewPos);
        float ndv = max(dot(n, v), 0.0);
        float rim = pow(max(1.0 - ndv, 0.0001), 2.1);
        vec3 col = mix(uColor, uRimColor, rim * 0.7);
        float alpha = clamp(0.11 + 0.24 * rim, 0.11, 0.35);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

// Shared GLSL animated pulse stream for fuel rail flow & intake air swirl
function makeStreamMaterial(colA, colB, freq = 18.0, alongU = false) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clipping: true,
    uniforms: {
      uFlow: { value: 0 },
      uBeat: { value: 0 },
      uOpacity: { value: 0.75 },
      uColA: { value: new THREE.Color(colA) },
      uColB: { value: new THREE.Color(colB) },
      uFreq: { value: freq },
      uAlongU: { value: alongU ? 1.0 : 0.0 },
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
      uniform float uFlow;
      uniform float uBeat;
      uniform float uOpacity;
      uniform vec3 uColA;
      uniform vec3 uColB;
      uniform float uFreq;
      uniform float uAlongU;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        #include <clipping_planes_fragment>
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewPos);
        float edge = pow(max(abs(dot(n, v)), 0.0001), 0.55);
        vec2 st = uAlongU > 0.5 ? vUv.yx : vUv.xy;
        float p1 = pow(0.5 + 0.5 * sin(st.y * uFreq - uFlow), 2.5);
        float p2 = 0.5 + 0.5 * cos(st.x * 12.56637 + st.y * 8.0 - uFlow * 1.4);
        vec3 col = mix(uColA, uColB, clamp(0.65 * p1 + 0.35 * p2 + 0.2 * uBeat, 0.0, 1.0));
        float a = uOpacity * edge * (0.45 + 0.55 * p1 + 0.25 * uBeat);
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.94));
      }
    `,
  });
}

/** opts.plain: simpler A/B version B. opts.lo: flat-shaded low build. opts.caps: section cap colour. */
export function buildEngine(opts = {}) {
  const lo = !!opts.lo;
  const plain = !!opts.plain || lo;
  const N = (n, min = 6) => (lo ? Math.max(min, Math.round(n / 6)) : n);
  const gear = (teeth, rOut, rRoot, width, helix = 0, holeR = 0) =>
    plain ? discGeo((rOut + rRoot) / 2, width, holeR, lo ? Math.max(8, Math.round((rOut + rRoot) / 24)) : 48) : gearGeo(teeth, rOut, rRoot, width, helix, holeR);
  const root = new THREE.Group();
  const M = {
    black: new THREE.MeshPhysicalMaterial({ color: '#191b20', roughness: 0.28, metalness: 0.24, clearcoat: 0.72, clearcoatRoughness: 0.16 }),
    blackMatte: new THREE.MeshPhysicalMaterial({ color: '#22242a', roughness: 0.48, metalness: 0.22, clearcoat: 0.28 }),
    gunmetal: new THREE.MeshStandardMaterial({ color: '#464d57', roughness: 0.3, metalness: 0.86 }),
    steel: new THREE.MeshStandardMaterial({ color: '#b8bec7', roughness: 0.2, metalness: 0.96 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#e5e9ef', roughness: 0.12, metalness: 1 }),
    alu: new THREE.MeshStandardMaterial({ color: '#a3aab4', roughness: 0.27, metalness: 0.9 }),
    bronze: new THREE.MeshStandardMaterial({ color: '#b98a55', roughness: 0.28, metalness: 0.92 }),
    crimson: new THREE.MeshPhysicalMaterial({ color: '#f26a3d', roughness: 0.3, metalness: 0.22, clearcoat: 0.4 }),
    beltRubber: new THREE.MeshStandardMaterial({ color: '#1e2126', roughness: 0.84, metalness: 0.05 }),
    ceramic: new THREE.MeshPhysicalMaterial({ color: '#f3f0ea', roughness: 0.35, metalness: 0, clearcoat: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#4c6278', roughness: 0.1, metalness: 0.06, clearcoat: 1.0, clearcoatRoughness: 0.06, transparent: true, opacity: 0.31, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 }),
    red: new THREE.MeshBasicMaterial({ color: '#f26a3d', transparent: true, opacity: 0.9, depthWrite: false }),
  };
  if (lo) {
    const flat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
    Object.assign(M, {
      black: flat('#66696f'),
      blackMatte: flat('#717479'),
      gunmetal: flat('#555961'),
      steel: flat('#b9bdc3'),
      chrome: flat('#d9dde2'),
      alu: flat('#cfd2d6'),
      bronze: flat('#a37b4d'),
      crimson: flat('#f26a3d'),
      beltRubber: flat('#2a2d33'),
      ceramic: flat('#ece8e0'),
      glass: flat('#6b7f94'),
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
  const xrayKeep = (obj) => {
    if (obj) obj.traverse((o) => (o.userData.xrayKeep = true));
    return obj;
  };
  const noCap = (obj) => {
    if (obj) obj.traverse((o) => (o.userData.noCap = true));
    return obj;
  };
  const DM = createDressupMaterials(M, lo);

  // ------------------------------------------------------------ block: alloy bulkheads, rails, sculpted sump & block dress-up
  const block = new THREE.Group();
  root.add(block);
  const bh = bulkheadGeo(16, N(24));
  for (const z of [236, 112, 0, -112, -236]) {
    const bhm = add(block, bh, M.alu);
    bhm.position.z = z;
    tag(bhm, { name: 'Crankcase Bulkhead', subsystem: 'Engine Block', material: 'Cast A356 Aluminum Alloy', spec: '90° V-block rib, 16 mm thick, Ø88 mm main bore & steel cap' }, [0, 0, 0]);
    const mainCap = add(block, new THREE.BoxGeometry(118, 22, 20), M.gunmetal);
    mainCap.position.set(0, -58, z);
  }
  const solidWalls = [];
  const solidWallGrp = new THREE.Group();
  solidWallGrp.visible = false;
  block.add(solidWallGrp);
  solidWalls.push(solidWallGrp);
  for (const bank of ['L', 'R']) {
    const B = BANK[bank];
    const sgn = bank === 'L' ? 1 : -1;
    const bankRot = Math.atan2(B.b[1], B.b[0]) - Math.PI / 2;
    for (const w of [-60, 60]) {
      const r = add(block, new THREE.BoxGeometry(14, 16, 488), M.alu);
      const [x, y] = [(DECK - 18) * B.b[0] + w * B.p[0], (DECK - 18) * B.b[1] + w * B.p[1]];
      r.position.set(x, y, 0);
      r.rotation.z = bankRot;
      tag(r, { name: `Deck Stiffener Rail (${bank} Bank)`, subsystem: 'Engine Block', material: 'Cast Aluminum Alloy', spec: '14 × 16 × 488 mm cylinder deck rail' }, [B.b[0] * 40, B.b[1] * 40, 0]);
    }
    const jacket = add(solidWallGrp, new THREE.BoxGeometry(12, 114, 472), M.alu);
    jacket.position.set(152 * B.b[0] + sgn * 56 * B.p[0], 152 * B.b[1] + sgn * 56 * B.p[1], 0);
    jacket.rotation.z = bankRot;
    tag(jacket, { name: `Cylinder Bank Skirt Wall (${bank} Bank)`, subsystem: 'Engine Block', material: 'Die-Cast A356 Aluminum', spec: 'Solid structural water-jacket cylinder bank wall' }, [B.b[0] * 40, B.b[1] * 40, 0]);
    const flank = add(solidWallGrp, new THREE.BoxGeometry(14, 68, 472), M.alu);
    flank.position.set(sgn * 108, 6, 0);
    flank.rotation.z = -sgn * 0.22;
    tag(flank, { name: `Crankcase Flank Wall (${bank} Bank)`, subsystem: 'Engine Block', material: 'Die-Cast A356 Aluminum', spec: 'Structural crankcase side skirt above freeze-plug gallery' });
  }
  const valleyCover = add(solidWallGrp, new THREE.BoxGeometry(122, 10, 472), M.gunmetal);
  valleyCover.position.set(0, 134, 0);
  tag(valleyCover, { name: 'V-Valley Cover Plate', subsystem: 'Engine Block', material: 'Machined Gunmetal Billet', spec: '10 mm structural valley tray sealing lifter/crank gallery' });
  const sumpRes = buildSumpAndBlockDressup({ M, DM, add, tag, ignore, N, plain, BANK, DECK, CYL });
  const { sumpGrp, blockDressGrp, sparkLeadsGrp, harnessGrp } = sumpRes;
  block.add(sumpGrp);
  block.add(blockDressGrp);
  for (const g of [sparkLeadsGrp, harnessGrp]) {
    if (g) {
      g.userData.basePos = g.position.clone();
      if (!g.parent) block.add(g);
    }
  }
  if (sumpGrp.oilWave) xrayKeep(sumpGrp.oilWave);
  if (sumpGrp.pickupGrp) xrayKeep(sumpGrp.pickupGrp);
  const rail = add(block, new THREE.BoxGeometry(220, 12, 500), M.gunmetal);
  rail.position.set(0, -68, 0);
  tag(rail, { name: 'Lower Block Skirt Rail', subsystem: 'Engine Block', material: 'Machined Alloy Skirt Rail', spec: '220 × 12 × 500 mm pan mounting flange' }, [0, -190, 0]);

  // ------------------------------------------------------------ cylinders: liner, head, valvetrain, plug, exhaust
  const sparkMatBase = new THREE.MeshBasicMaterial({ color: '#ff8c24', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const exTubeMat = M.gunmetal.clone();
  const EX_COL_COOL = new THREE.Color('#c2bbb0');
  const EX_COL_WARM = new THREE.Color('#cc7e4e');
  const EX_COL_HOT = new THREE.Color('#d93814');
  if (!lo) {
    exTubeMat.color.copy(EX_COL_COOL);
    exTubeMat.roughness = 0.24;
    exTubeMat.metalness = 0.86;
  }
  const cyl = CYL.map((cy) => {
    const B = BANK[cy.bank];
    const bankLabel = cy.bank === 'L' ? 'Left Bank (+45°)' : 'Right Bank (−45°)';
    const g = new THREE.Group();
    g.position.z = cy.z;
    g.rotation.z = Math.atan2(B.b[1], B.b[0]) - Math.PI / 2;
    root.add(g);
    const out = cy.bank === 'L' ? 1 : -1;
    const liner = add(g, new THREE.CylinderGeometry(E.bore / 2 + 3, E.bore / 2 + 3, 118, N(48), 1, true), M.glass, false);
    liner.position.y = DECK - 59;
    liner.renderOrder = 3;
    tag(liner, { name: `Cylinder ${cy.c} Liner`, subsystem: bankLabel, material: 'Borosilicate / Honed Sleeve', spec: `Ø${E.bore} mm bore × 118 mm optical sleeve` }, [0, 70, 0]);
    for (const y of [DECK - 118, DECK]) {
      const ring = add(g, new THREE.TorusGeometry(E.bore / 2 + 4, 3.2, N(10, 4), N(48)), M.black);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      tag(ring, { name: `Cylinder ${cy.c} Liner Ring`, subsystem: bankLabel, material: 'Nitrided Steel', spec: `Ø${E.bore + 8} mm deck/base locating ring` }, [0, 70, 0]);
    }
    const head = new THREE.Group();
    g.add(head);
    tag(head, { name: `Cylinder ${cy.c} Head`, subsystem: `Cylinder Heads · ${bankLabel}`, material: 'Cast Aluminum Alloy', spec: `CR ${E.cr}:1 pent-roof chamber, 2-valve, perimeter head bolts` }, [0, 200, 0]);
    const flange = add(head, new THREE.TorusGeometry(62, 7.5, N(16, 4), N(56)), M.black);
    flange.rotation.x = Math.PI / 2;
    flange.position.y = DECK + 8;
    const cap = add(head, new THREE.CylinderGeometry(60, 64, 12, N(56)), M.black);
    cap.position.y = DECK + 14;
    const vblock = add(head, new THREE.BoxGeometry(70, 14, 46), M.black);
    vblock.position.y = DECK + 27;
    // sculpted cast-aluminum perimeter head deck rails meeting valve-cover gasket at DECK + 42..44 & 10 head bolts/bank
    for (const sx of [-48, 48]) {
      const hRail = add(head, new THREE.BoxGeometry(16, 34, 108), M.alu);
      hRail.position.set(sx, DECK + 26, 0);
      const bOffsets = cy.c <= 2 || cy.c >= 7 ? [-36, 0, 36] : [-28, 28];
      for (const bz of bOffsets) {
        if (sx < 0 && bOffsets.length === 3 && bz === 0) continue; // exactly 10 bolts per bank across 4 heads
        const hBolt = add(head, new THREE.CylinderGeometry(4.4, 4.4, 8, 6), M.steel);
        hBolt.position.set(Math.sign(sx) * 43, DECK + 45, bz);
      }
    }

    // volumetric GLSL charge column (simple basic material in lo build)
    const chargeMat = lo
      ? new THREE.MeshBasicMaterial({ color: '#4a90e2', transparent: true, opacity: 0.35, depthWrite: false })
      : makeChargeMaterial();
    const charge = new THREE.Mesh(new THREE.CylinderGeometry(E.bore / 2 - 1, E.bore / 2 - 1, 1, N(40), 8), chargeMat);
    charge.renderOrder = 2;
    ignore(charge);
    g.add(charge);

    // valves: intake on the valley side, exhaust outboard
    const valves = [
      { x: -out * 21, kind: 'in' },
      { x: out * 21, kind: 'ex' },
    ].map((v) => {
      const vg = new THREE.Group();
      xrayKeep(vg);
      head.add(vg);
      vg.position.x = v.x;
      const isIn = v.kind === 'in';
      tag(vg, {
        name: `Cyl ${cy.c} ${isIn ? 'Intake' : 'Exhaust'} Valve`,
        subsystem: `Valvetrain · ${bankLabel}`,
        material: isIn ? 'Forged Martensitic Steel' : 'Inconel 751 Superalloy',
        spec: `Ø36 mm head, ${VALVE.lift} mm lift (${isIn ? '340°–580°' : '140°–380°'})`,
      });
      const stem = add(vg, new THREE.CylinderGeometry(3.5, 3.5, 126, N(12)), M.steel);
      stem.position.y = DECK + 60;
      const disc = add(vg, new THREE.CylinderGeometry(18, 7, 6, N(28)), M.steel);
      disc.position.y = DECK - 3;
      const spring = new THREE.Group();
      xrayKeep(spring);
      noCap(spring);
      head.add(spring);
      spring.position.set(v.x, DECK + 34, 0);
      tag(spring, {
        name: `Cyl ${cy.c} ${isIn ? 'Intake' : 'Exhaust'} Valve Spring`,
        subsystem: `Valvetrain · ${bankLabel}`,
        material: 'Chrome-Silicon Steel / Bronze Damper',
        spec: 'Dual concentric coil, 48 mm free height',
      });
      if (plain) {
        const sleeve = new THREE.CylinderGeometry(15.5, 15.5, 48, N(24));
        sleeve.translate(0, 24, 0);
        add(spring, sleeve, M.steel);
      } else {
        add(spring, helixGeo(15.5, 2.6, 8, 48), M.steel);
        add(spring, helixGeo(10.5, 1.8, 10, 48), M.bronze);
      }
      const ret = add(vg, new THREE.CylinderGeometry(18, 18, 4, N(24)), M.black);
      ret.position.y = DECK + 84;
      return { ...v, vg, spring, rocker: null };
    });

    // rocker cage + steel fulcrum shafts + articulated roller-rocker arms
    const cage = new THREE.Group();
    g.add(cage);
    tag(cage, { name: `Cyl ${cy.c} Valve Cover / Rocker Cage`, subsystem: `Valvetrain · ${bankLabel}`, material: 'Machined Billet Aluminum', spec: 'Open inspection frame, twin fulcrum shafts' }, [0, 390, 0]);
    for (const zz of [-30, 30]) {
      for (const xx of [-44, 44]) {
        const post = add(cage, new THREE.BoxGeometry(6, 110, 6), M.black);
        post.position.set(xx, DECK + 93, zz);
      }
      const bar = add(cage, new THREE.BoxGeometry(94, 6, 6), M.black);
      bar.position.set(0, DECK + 148, zz);
    }
    for (const v of valves) {
      const sgn = Math.sign(v.x);
      const fx = sgn * 7;
      const fy = DECK + 130;
      const zLobe = v.kind === 'in' ? -18 : 18;
      // steel fulcrum shaft & end pedestals inside the cage
      const shaft = add(cage, new THREE.CylinderGeometry(4, 4, 66, N(14)), M.steel);
      shaft.rotation.x = Math.PI / 2;
      shaft.position.set(fx, fy, 0);
      tag(shaft, { name: `Cyl ${cy.c} Rocker Fulcrum Shaft`, subsystem: `Valvetrain · ${bankLabel}`, material: 'Hardened Bearing Steel', spec: 'Ø8 × 66 mm rocker pivot shaft' });
      // articulated roller-rocker group pivoting around (fx, fy, 0)
      const rocker = new THREE.Group();
      rocker.position.set(fx, fy, 0);
      cage.add(rocker);
      tag(rocker, {
        name: `Cyl ${cy.c} ${v.kind === 'in' ? 'Intake' : 'Exhaust'} Roller Rocker`,
        subsystem: `Valvetrain · ${bankLabel}`,
        material: 'Forged Chromoly / Needle Roller',
        spec: '1.5:1 ratio center-pivot roller rocker arm',
      });
      // pivot boss around fulcrum shaft
      const boss = add(rocker, new THREE.CylinderGeometry(7.2, 7.2, 12, N(16)), M.alu);
      boss.rotation.x = Math.PI / 2;
      // valve-side contoured arm reaching from fulcrum (0,0,0) to valve stem tip (sgn*14, -7, 0)
      const vArm = add(rocker, new THREE.BoxGeometry(16, 6.5, 9), M.gunmetal);
      vArm.position.set(sgn * 7.5, -2.5, 0);
      vArm.rotation.z = -sgn * 0.25;
      const tappet = add(rocker, new THREE.CylinderGeometry(4.5, 4.5, 6, N(12)), M.crimson);
      tappet.position.set(sgn * 14, -5.5, 0);
      // cam-side arm reaching diagonally in Z to cam lobe at x = -sgn*7, z = zLobe
      const camDx = -sgn * 7;
      const camArmLen = Math.hypot(camDx, zLobe);
      const cArm = add(rocker, new THREE.BoxGeometry(camArmLen, 6, 8), M.gunmetal);
      cArm.position.set(camDx * 0.5, 1, zLobe * 0.5);
      cArm.rotation.y = -Math.atan2(zLobe, camDx);
      // steel cam-follower roller riding on lobe base/nose
      const roller = add(rocker, new THREE.CylinderGeometry(5, 5, 10, N(16)), M.steel);
      roller.rotation.x = Math.PI / 2;
      roller.position.set(camDx, 1, zLobe);
      v.rocker = rocker;
    }

    // spark plug + crimson coil-on-plug pack + glowing TDC ignition spark arc mesh
    const plug = new THREE.Group();
    xrayKeep(plug);
    head.add(plug);
    plug.position.set(out * 46, DECK + 18, 18);
    plug.rotation.z = -out * 0.62;
    tag(plug, { name: `Cyl ${cy.c} Spark Plug & Ignition Coil`, subsystem: `Ignition · ${bankLabel}`, material: 'Alumina Ceramic / Crimson Coil-on-Plug', spec: `M14 iridium plug + coil pack firing at ${FIRE[cy.c]}° crank` }, [out * 36, 36, 0]);
    add(plug, new THREE.CylinderGeometry(6.5, 6.5, 40, N(16)), M.ceramic).position.y = 30;
    add(plug, new THREE.CylinderGeometry(8.5, 8.5, 10, 6), M.steel).position.y = 6;
    add(plug, new THREE.CylinderGeometry(2.2, 2.2, 10, N(8, 4)), M.steel).position.y = 55;
    add(plug, new THREE.CylinderGeometry(8.5, 7.5, 18, N(12)), M.blackMatte).position.y = 50;
    add(plug, new THREE.BoxGeometry(18, 14, 18), M.crimson).position.y = 63;
    // ground strap + center electrode tip + glowing TDC spark arc inside optical combustion dome
    add(plug, new THREE.CylinderGeometry(1.6, 1.6, 18, N(8, 4)), M.steel).position.y = -8;
    const sparkMat = sparkMatBase.clone();
    const sparkCoreMat = new THREE.MeshBasicMaterial({ color: '#fff9e0', transparent: true, opacity: 0, depthWrite: false });
    const sparkGlowMat = new THREE.MeshBasicMaterial({ color: '#ff5514', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const sparkArc = new THREE.Group();
    sparkArc.position.set(0, -28, 0);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(7.5, 0), sparkCoreMat);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(16, 14, 12), sparkGlowMat);
    const finA = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), sparkMat);
    const finB = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), sparkMat);
    finB.rotation.y = Math.PI / 2;
    sparkArc.add(halo, core, finA, finB);
    sparkArc.renderOrder = 6;
    sparkArc.visible = false;
    ignore(sparkArc);
    plug.add(sparkArc);

    // satin gunmetal primary exhaust runner + machined silver 2-bolt diamond exhaust port flange & bronze seal
    const exFlangeGrp = new THREE.Group();
    exFlangeGrp.position.set(out * 49, DECK + 12, -20);
    head.add(exFlangeGrp);
    tag(exFlangeGrp, { name: `Cyl ${cy.c} Exhaust Port Flange`, subsystem: `Exhaust · ${bankLabel}`, material: 'CNC 304 Stainless Flange / Silicon Bronze Seal', spec: '2-bolt diamond port flange with M8 header bolts' });
    const fSh = new THREE.Shape();
    fSh.moveTo(0, -34);
    fSh.quadraticCurveTo(18, -14, 20, 0);
    fSh.quadraticCurveTo(18, 14, 0, 34);
    fSh.quadraticCurveTo(-18, 14, -20, 0);
    fSh.quadraticCurveTo(-18, -14, 0, -34);
    const fGeo = new THREE.ExtrudeGeometry(fSh, { depth: 7, bevelEnabled: true, bevelThickness: 1, bevelSize: 1, bevelSegments: 1, curveSegments: 8 });
    fGeo.translate(0, 0, -3.5);
    const exFlange = add(exFlangeGrp, fGeo, M.alu);
    exFlange.rotation.y = Math.PI / 2;
    const sealRing = add(exFlangeGrp, new THREE.CylinderGeometry(18, 18, 10, N(18)), M.bronze);
    sealRing.rotation.z = Math.PI / 2;
    sealRing.position.x = out * 3;
    for (const bz of [-24, 24]) {
      const hBolt = add(exFlangeGrp, new THREE.CylinderGeometry(3.8, 3.8, 13, 6), M.steel);
      hBolt.rotation.z = Math.PI / 2;
      hBolt.position.set(out * 2, 0, bz);
    }
    const localOf = (wx, wy, wz) => new V3(out * (wx * B.p[0] + wy * B.p[1]), wx * B.b[0] + wy * B.b[1], wz - cy.z);
    const clusterOffX = cy.c <= 4 ? -6 : 6;
    const clusterOffY = cy.c % 4 <= 1 ? 6 : -6;
    const pts = [
      new V3(out * 50, DECK + 12, -20),
      new V3(out * 96, DECK + 5, -24),
      new V3(out * 134, DECK - 46, -42),
      localOf(out * 214 + clusterOffX, -26 + clusterOffY, -166),
      localOf(out * 216 + clusterOffX * 0.8, -26 + clusterOffY * 0.8, -196),
    ];
    const exhaust = add(head, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N(34), 14.5, N(18), false), exTubeMat);
    tag(exhaust, { name: `Cyl ${cy.c} Exhaust Header Primary`, subsystem: `Exhaust · ${bankLabel}`, material: 'Brushed Heat-Cycled Inconel 625', spec: 'Equal-length primary terminating cleanly in 4-into-1 merge housing' }, [out * 95, 10, 0]);
    return { cy, g, out, charge, chargeMat, valves, liner, head, cage, sparkArc, sparkMat, sparkCoreMat, sparkGlowMat };
  });

  // camshafts: one per bank through the cages, polished steel lobes phased to bank orientation
  const cams = ['L', 'R'].map((bank) => {
    const B = BANK[bank];
    const bankRot = Math.atan2(B.b[1], B.b[0]) - Math.PI / 2;
    const g = new THREE.Group();
    const [x, y] = [(DECK + 112) * B.b[0], (DECK + 112) * B.b[1]];
    g.position.set(x, y, 0);
    root.add(g);
    tag(g, {
      name: `${bank === 'L' ? 'Left' : 'Right'} Bank Camshaft`,
      subsystem: `Valvetrain · ${bank === 'L' ? 'Left' : 'Right'} Bank`,
      material: 'Chilled Cast Iron / Hardened Steel Lobes',
      spec: '548 mm SOHC, 0.5× crank speed, 8 lobes',
    }, [300 * B.b[0], 300 * B.b[1], 0]);
    const shaft = add(g, new THREE.CylinderGeometry(9, 9, 548, N(20)), M.black);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 10;
    const lobes = [];
    for (const c of cyl.filter((c) => c.cy.bank === bank)) {
      for (const v of c.valves) {
        const lg = new THREE.Group();
        lg.position.set(0, 0, c.cy.z + (v.kind === 'in' ? -18 : 18));
        const peak = FIRE[c.cy.c] + (v.kind === 'in' ? (VALVE.in[0] + VALVE.in[1]) / 2 : (VALVE.ex[0] + VALVE.ex[1]) / 2);
        lg.rotation.z = (peak / 2) * D2R + bankRot;
        g.add(lg);
        const sh = new THREE.Shape();
        sh.absellipse(0, 3.2, 14, 17.2, 0, Math.PI * 2, false, 0);
        const lobeGeo = lo ? new THREE.BoxGeometry(28, 34, 14).translate(0, 3.2, 7) : new THREE.ExtrudeGeometry(sh, { depth: 14, bevelEnabled: true, bevelSize: 1, bevelThickness: 1, bevelSegments: 1, curveSegments: 24 });
        const lobe = add(lg, lobeGeo, M.steel);
        lobe.position.z = -7;
        lobes.push({ lg, c, v });
      }
    }
    return { bank, g, lobes };
  });

  // Hybrid Windowed / Swappable Solid-Finned Valve Covers (L & R banks)
  const { coversGrp, leftGrp: leftCoverGrp, rightGrp: rightCoverGrp, glassWindows, solidLids } = buildHybridValveCovers({ M, DM, add, tag, N, plain, BANK, bankXY, DECK });
  root.add(coversGrp);

  // ------------------------------------------------------------ crankshaft with oil-drilled journals
  const crank = new THREE.Group();
  root.add(crank);
  tag(crank, { name: 'Cross-Plane Crankshaft', subsystem: 'Rotating Assembly', material: 'Forged 4340 Chromoly Steel', spec: '90° cross-plane, 44.5 mm throw (89 mm stroke)' }, [0, -110, 0]);
  const webG = webGeo(18, N(28));
  const webs = [];
  E.pinZ.forEach((z, p) => {
    for (const dz of [-34, 34]) {
      const w = add(crank, webG, M.black);
      w.position.z = z + dz;
      tag(w, { name: `Crankshaft Counterweight Web (Throw ${p + 1})`, subsystem: 'Rotating Assembly', material: 'Forged 4340 Chromoly Steel', spec: `R76 mm chamfered counterweight, ${PIN_PHASE[p]}° phase` });
      webs.push({ w, p });
    }
  });
  const journals = [236, 112, 0, -112, -236].map((z, idx) => {
    const jg = new THREE.Group();
    jg.position.z = z;
    crank.add(jg);
    tag(jg, { name: `Crankshaft Main Journal #${idx + 1}`, subsystem: 'Rotating Assembly', material: 'Induction-Hardened 4340 Steel', spec: 'Ø60 × 42 mm oil-drilled main journal' });
    add(jg, new THREE.CylinderGeometry(30, 30, 42, N(32)), M.steel).rotation.x = Math.PI / 2;
    const oilPort = add(jg, new THREE.CylinderGeometry(3.2, 3.2, 62, N(10)), M.blackMatte);
    oilPort.rotation.z = idx % 2 ? 0.6 : -0.6;
    return jg;
  });
  const pins = E.pinZ.map((z, p) => {
    const pg = new THREE.Group();
    pg.position.z = z;
    root.add(pg);
    tag(pg, { name: `Crankpin Throw ${p + 1} (Cyl ${p * 2 + 1}·${p * 2 + 2})`, subsystem: 'Rotating Assembly', material: 'Induction-Hardened 4340 Steel', spec: `Ø50 × 52 mm oil-drilled rod journal, ${PIN_PHASE[p]}°` }, [0, -110, 0]);
    add(pg, new THREE.CylinderGeometry(25, 25, 52, N(28)), M.steel).rotation.x = Math.PI / 2;
    const port = add(pg, new THREE.CylinderGeometry(2.8, 2.8, 52, N(10)), M.blackMatte);
    port.rotation.z = (PIN_PHASE[p] * D2R);
    return pg;
  });

  // ------------------------------------------------------------ pistons (reliefs + 3 rings) & H-beam rods (split cap + bolts)
  const pistonGeo = new THREE.CylinderGeometry(E.bore / 2 - 1.5, E.bore / 2 - 1.5, 62, N(48));
  const ringGeo = new THREE.TorusGeometry(E.bore / 2 - 1.2, 1.6, 8, N(48));
  const pist = CYL.map((cy, i) => {
    const B = BANK[cy.bank];
    const bankLabel = cy.bank === 'L' ? 'Left Bank' : 'Right Bank';
    const g = new THREE.Group();
    cyl[i].g.add(g);
    tag(g, { name: `Cylinder ${cy.c} Piston`, subsystem: `Reciprocating · ${bankLabel}`, material: 'Forged 4032 Aluminum Alloy', spec: `Ø${(E.bore - 3).toFixed(1)} mm valve-relieved crown, 3 rings` }, [0, 110, 0]);
    const body = add(g, pistonGeo, M.alu);
    body.position.y = E.comp - 31;
    // crown valve-relief pockets + wrist-pin boss reliefs
    if (!lo) {
      for (const vx of [-21, 21]) {
        const pocket = add(g, new THREE.CylinderGeometry(15.5, 14.5, 2.5, N(20)), M.blackMatte);
        pocket.position.set(vx, E.comp - 0.8, 0);
      }
      for (const pz of [-(E.bore / 2 - 5), E.bore / 2 - 5]) {
        const relief = add(g, new THREE.CylinderGeometry(14, 14, 7, N(16)), M.blackMatte);
        relief.rotation.x = Math.PI / 2;
        relief.position.set(0, 0, pz);
      }
    }
    const ringMats = [M.chrome, M.blackMatte, M.bronze];
    for (let k = 0; k < (plain ? 0 : 3); k++) {
      const r = add(g, ringGeo, ringMats[k]);
      r.rotation.x = Math.PI / 2;
      r.position.y = E.comp - 7 - k * 7;
    }
    const pinM = add(g, new THREE.CylinderGeometry(11, 11, E.bore - 10, N(16)), M.steel);
    pinM.rotation.z = Math.PI / 2;
    pinM.rotation.y = Math.PI / 2;
    tag(pinM, { name: `Cyl ${cy.c} Wrist Pin`, subsystem: `Reciprocating · ${bankLabel}`, material: 'Case-Hardened Chromoly Steel', spec: `Ø22 × ${(E.bore - 10).toFixed(1)} mm full-floating gudgeon pin` });

    const rod = new THREE.Group();
    root.add(rod);
    tag(rod, { name: `Cylinder ${cy.c} H-Beam Connecting Rod`, subsystem: `Reciprocating · ${bankLabel}`, material: 'Forged H-Beam 4340 Steel', spec: `${E.rod} mm C-to-C, split big-end cap & twin bolts` }, [110 * B.b[0], 110 * B.b[1], 0]);
    const beam = new THREE.Group();
    rod.add(beam);
    add(beam, new THREE.BoxGeometry(10, 1, 5), M.blackMatte);
    for (const fx of [-6.5, 6.5]) {
      const flangeRod = add(beam, new THREE.BoxGeometry(4, 1, 15), M.black);
      flangeRod.position.x = fx;
    }
    const big = new THREE.Group();
    rod.add(big);
    add(big, new THREE.CylinderGeometry(33, 33, 20, N(32)), M.black).rotation.x = Math.PI / 2;
    // split big-end bearing cap + twin cap bolts
    const capLine = add(big, new THREE.BoxGeometry(74, 3, 22), M.blackMatte);
    capLine.position.y = -1;
    for (const bx of [-30, 30]) {
      const bolt = add(big, new THREE.CylinderGeometry(3.8, 3.8, 18, 6), M.steel);
      bolt.position.set(bx, -7, 0);
    }
    const small = add(rod, new THREE.CylinderGeometry(17, 17, 20, N(24)), M.black);
    small.rotation.x = Math.PI / 2;

    const arrow = new THREE.Group();
    cyl[i].g.add(arrow);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 46, 12), M.red);
    shaft.position.y = -10;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(11, 26, 18), M.red);
    tip.position.y = 23;
    arrow.add(shaft, tip);
    arrow.position.set(cyl[i].out * 78, 0, 0);
    arrow.renderOrder = 5;
    ignore(arrow);
    return { g, rod, beam, big, small, arrow };
  });

  // ------------------------------------------------------------ front: CNC spoked 2:1 timing gears (24T -> 72T -> 48T) + serpentine belt drive; rear: flywheel
  const front = 268;
  const TM = 676 / 216; // exact module so R_crank(12*TM) + 2*R_idler(36*TM) + R_cam(24*TM) = 338 mm = DECK + 112
  const addHubBolt = (parent, hubR, boltR, zFace = 10) => {
    add(parent, new THREE.CylinderGeometry(hubR, hubR, 17, N(24)), M.alu).rotation.x = Math.PI / 2;
    const bolt = add(parent, new THREE.CylinderGeometry(boltR, boltR, 6, 6), M.steel);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.z = zFace;
  };

  const makeSpiderGeo = (rOut, rHub, spokes, width, spokeHalf = 0.24) => {
    const sh = new THREE.Shape();
    sh.absarc(0, 0, rOut, 0, Math.PI * 2, false);
    const step = (Math.PI * 2) / spokes;
    for (let i = 0; i < spokes; i++) {
      const a0 = i * step + spokeHalf;
      const a1 = (i + 1) * step - spokeHalf;
      const h = new THREE.Path();
      h.moveTo(Math.cos(a0) * rHub, Math.sin(a0) * rHub);
      h.absarc(0, 0, rOut - 6, a0, a1, false);
      h.lineTo(Math.cos(a1) * rHub, Math.sin(a1) * rHub);
      h.absarc(0, 0, rHub, a1, a0, true);
      h.closePath();
      sh.holes.push(h);
    }
    const bore = new THREE.Path();
    bore.absarc(0, 0, rHub * 0.45, 0, Math.PI * 2, true);
    sh.holes.push(bore);
    const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: !lo, bevelThickness: 0.8, bevelSize: 0.7, bevelSegments: 1, curveSegments: N(18) });
    g.translate(0, 0, -width / 2);
    return g;
  };

  const crankGear = new THREE.Group();
  crankGear.position.z = front;
  root.add(crankGear);
  tag(crankGear, { name: 'Crankshaft Timing Gear (24T)', subsystem: 'Timing Drive · Front', material: 'Dark Nitride-Steel Teeth / Open Alu Hub', spec: '24T, +0.35 rad helix, 2:1 drive to cams' }, [0, -110, 45]);
  const nitrideMat = lo
    ? new THREE.MeshLambertMaterial({ color: '#2f343d', flatShading: true })
    : new THREE.MeshStandardMaterial({ color: '#282c34', roughness: 0.3, metalness: 0.78 });
  add(crankGear, gear(24, 12 * TM + 2.5, 12 * TM - 2.9, 15, 0.35, 12), nitrideMat);
  addHubBolt(crankGear, 19, 8.5, 10);

  const idlerPitch = (2 * Math.PI) / 72;
  const idlers = ['L', 'R'].map((bank) => {
    const B = BANK[bank];
    const gg = new THREE.Group();
    gg.position.set(150.222 * B.b[0], 150.222 * B.b[1], front);
    root.add(gg);
    tag(gg, {
      name: `${bank === 'L' ? 'Left' : 'Right'} Timing Idler Gear (72T)`,
      subsystem: 'Timing Drive · Front',
      material: 'Dark Nitride-Steel Teeth / Open Hollow 5-Spoke CNC Spider',
      spec: '72T, −0.35 rad helix, see-through CNC spoke windows',
    }, [80 * B.b[0], 80 * B.b[1], 60]);
    add(gg, gear(72, 36 * TM + 2.5, 36 * TM - 2.9, 15, -0.35, 96), nitrideMat);
    if (!plain) add(gg, makeSpiderGeo(96, 30, 5, 13, 0.25), M.blackMatte);
    addHubBolt(gg, 26, 11, 10);
    for (let k = 0; k < (plain ? 0 : 5); k++) {
      const a = (k / 5) * Math.PI * 2;
      const stud = add(gg, new THREE.CylinderGeometry(4, 4, 17, 8), M.steel);
      stud.rotation.x = Math.PI / 2;
      stud.position.set(Math.cos(a) * 58, Math.sin(a) * 58, 0);
    }
    const idxPin = add(gg, new THREE.CylinderGeometry(3.5, 3.5, 19, 10), M.bronze);
    idxPin.rotation.x = Math.PI / 2;
    idxPin.position.set(0, 93, 0);
    return { gg, bank, c0: 0.5 * idlerPitch };
  });

  const camGears = ['L', 'R'].map((bank) => {
    const B = BANK[bank];
    const cg = new THREE.Group();
    cg.position.set((DECK + 112) * B.b[0], (DECK + 112) * B.b[1], front);
    root.add(cg);
    tag(cg, {
      name: `${bank === 'L' ? 'Left' : 'Right'} Camshaft Gear (48T)`,
      subsystem: 'Timing Drive · Front',
      material: 'Dark Nitride-Steel Teeth / Open Hollow 4-Spoke Spider / Crimson Phaser',
      spec: '48T, +0.35 rad helix, exact 2:1 (0.5× crank speed)',
    }, [300 * B.b[0], 300 * B.b[1], 45]);
    add(cg, gear(48, 24 * TM + 2.5, 24 * TM - 2.9, 15, 0.35, 62), nitrideMat);
    if (!plain) add(cg, makeSpiderGeo(62, 26, 4, 13, 0.28), M.blackMatte);
    const phaserRing = add(cg, new THREE.TorusGeometry(27, 4, N(8), N(28)), M.crimson);
    phaserRing.position.z = 7;
    addHubBolt(cg, 21, 10, 10);
    for (let k = 0; k < (plain ? 0 : 4); k++) {
      const a = (k / 4) * Math.PI * 2;
      const stud = add(cg, new THREE.CylinderGeometry(4.2, 4.2, 18, 10), M.steel);
      stud.rotation.x = Math.PI / 2;
      stud.position.set(Math.cos(a) * 44, Math.sin(a) * 44, 0);
    }
    const camDot = add(cg, new THREE.CylinderGeometry(3.5, 3.5, 19, 10), M.crimson);
    camDot.rotation.x = Math.PI / 2;
    camDot.position.set(0, 56, 0);
    return { cg, bank };
  });

  // Front Serpentine Accessory Dress-Up (Harmonic Damper, Water Pump + Thermostat, Vented Alternator, 5-Spoke PS Pulley, Tensioner & A/C + Closed Ribbed Belt at z = front + 62)
  const serpZ = front + 62;
  const accRes = buildAccessoryDressup({ M, DM, add, tag, N, plain, front });
  const { damperGrp, waterPumpGrp, altGrp, psPulleyGrp, tensionerGrp, acCompressorGrp, thermostatGrp } = accRes;
  root.add(damperGrp, waterPumpGrp, altGrp, psPulleyGrp);
  for (const g of [tensionerGrp, acCompressorGrp, thermostatGrp]) {
    if (g) {
      g.userData.basePos = g.position.clone();
      if (!g.parent) root.add(g);
    }
  }

  const serpGrp = new THREE.Group();
  root.add(serpGrp);
  tag(serpGrp, { name: 'Serpentine Accessory Belt', subsystem: 'Accessory Drive · Front', material: 'EPDM Ribbed Serpentine Belt', spec: 'Wraps Crank Damper -> PS Pulley -> Water Pump -> Tensioner -> Alternator -> A/C Compressor' }, [0, -110, 115]);

  // Extruded continuous outer serpentine belt loop wrapping Crank (r=74) -> PS Pulley (r=34) -> Water Pump (r=42) -> Tensioner (r=22) -> Alternator (r=28) -> A/C Compressor (r=32)
  {
    const serpPulleys = [
      { x: 0, y: 0, r: 75 },
      { x: -108, y: 26, r: 35 },
      { x: 0, y: 128, r: 43 },
      { x: 76, y: 78, r: 23 },
      { x: 148, y: -10, r: 29 },
      { x: 190, y: -84, r: 33 },
    ];
    const outerPts = [];
    for (let i = 0; i < serpPulleys.length; i++) {
      const a = serpPulleys[i];
      const b = serpPulleys[(i + 1) % serpPulleys.length];
      const cPrev = serpPulleys[(i + serpPulleys.length - 1) % serpPulleys.length];
      const angPrev = Math.atan2(a.y - cPrev.y, a.x - cPrev.x) + Math.PI / 2;
      const angNext = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
      let span = angNext - angPrev;
      while (span > 0) span -= Math.PI * 2;
      while (span < -Math.PI * 2) span += Math.PI * 2;
      const steps = Math.max(4, Math.round(Math.abs(span) * 6));
      for (let s = 0; s <= steps; s++) {
        const thA = angPrev + (s / steps) * span;
        outerPts.push([a.x + Math.cos(thA) * (a.r + 3.5), a.y + Math.sin(thA) * (a.r + 3.5)]);
      }
    }
    const beltSh = new THREE.Shape();
    outerPts.forEach(([x, y], idx) => (idx === 0 ? beltSh.moveTo(x, y) : beltSh.lineTo(x, y)));
    beltSh.closePath();
    const innerHole = new THREE.Path();
    const cxB = 40, cyB = 15;
    outerPts.slice().reverse().forEach(([x, y], idx) => {
      const dx = x - cxB, dy = y - cyB;
      const len = Math.hypot(dx, dy) || 1;
      const ix = x - (dx / len) * 4.2, iy = y - (dy / len) * 4.2;
      if (idx === 0) innerHole.moveTo(ix, iy);
      else innerHole.lineTo(ix, iy);
    });
    innerHole.closePath();
    beltSh.holes.push(innerHole);
    const beltGeo = new THREE.ExtrudeGeometry(beltSh, { depth: 14, bevelEnabled: false, curveSegments: N(18) });
    beltGeo.translate(0, 0, -7);
    const beltMesh = add(serpGrp, beltGeo, M.beltRubber);
    beltMesh.position.z = serpZ;
  }

  // ------------------------------------------------------------ Sculpted 8-Runner Arched Intake Plenum, Brass DBW Throttle, Fuel Rails & Injectors
  const plenumMat = lo
    ? new THREE.MeshLambertMaterial({ color: '#6b7f94', transparent: true, opacity: 0.36, depthWrite: false, side: THREE.FrontSide })
    : new THREE.MeshPhysicalMaterial({ color: '#6b7f94', roughness: 0.12, metalness: 0.05, clearcoat: 1.0, clearcoatRoughness: 0.08, transparent: true, opacity: 0.36, depthWrite: false, side: THREE.FrontSide, envMapIntensity: 1.4 });
  const brassMat = lo
    ? new THREE.MeshLambertMaterial({ color: '#c79642', flatShading: true })
    : new THREE.MeshStandardMaterial({ color: '#d4a34a', roughness: 0.24, metalness: 0.9 });

  const intakeGrp = new THREE.Group();
  root.add(intakeGrp);
  tag(intakeGrp, {
    name: 'Arched 8-Runner Cross-Ram Plenum',
    subsystem: 'Induction · Sequential Port EFI',
    material: 'Smoked Polycarbonate / Composite Spine / Brushed 6061-T6 Rails',
    spec: 'Sculpted 8-runner crossover arches over contoured surge spine, 4 bar EFI',
  }, [0, 290, 0]);

  // 90mm Flanged CNC Billet Throttle Body + Dark Anodized Bore + Visible Brass Butterfly + Recessed Booster Impeller
  const tbGrp = new THREE.Group();
  tbGrp.position.set(0, 294, 276);
  intakeGrp.add(tbGrp);
  {
    const tbFlangeSh = new THREE.Shape();
    tbFlangeSh.moveTo(-48, -48);
    tbFlangeSh.lineTo(48, -48);
    tbFlangeSh.lineTo(48, 48);
    tbFlangeSh.lineTo(-48, 48);
    tbFlangeSh.closePath();
    const tbBore = new THREE.Path();
    tbBore.absarc(0, 0, 44.5, 0, Math.PI * 2, true);
    tbFlangeSh.holes.push(tbBore);
    const tbFlangeGeo = new THREE.ExtrudeGeometry(tbFlangeSh, { depth: 9, bevelEnabled: !lo, bevelThickness: 1, bevelSize: 1, bevelSegments: 1, curveSegments: N(24) });
    tbFlangeGeo.translate(0, 0, -24);
    add(tbGrp, tbFlangeGeo, M.alu);
    for (const [fx, fy] of [[-39, -39], [39, -39], [39, 39], [-39, 39]]) {
      const fb = add(tbGrp, new THREE.CylinderGeometry(3.5, 3.5, 14, 6), M.steel);
      fb.rotation.x = Math.PI / 2;
      fb.position.set(fx, fy, -19);
    }
  }
  const tbSh = new THREE.Shape();
  tbSh.absarc(0, 0, 50, 0, Math.PI * 2, false);
  const tbHole = new THREE.Path();
  tbHole.absarc(0, 0, 44.5, 0, Math.PI * 2, true);
  tbSh.holes.push(tbHole);
  const tbHousingGeo = new THREE.ExtrudeGeometry(tbSh, { depth: 48, bevelEnabled: !lo, bevelThickness: 1.8, bevelSize: 1.4, bevelSegments: 1, curveSegments: N(30) });
  tbHousingGeo.translate(0, 0, -24);
  const tbBody = add(tbGrp, tbHousingGeo, M.alu);
  const tbThroatMat = M.blackMatte.clone();
  tbThroatMat.side = THREE.DoubleSide;
  if (!lo) tbThroatMat.color.set('#181b20');
  const tbLiner = add(tbGrp, new THREE.CylinderGeometry(44.2, 44.2, 48, N(30), 1, true), tbThroatMat);
  tbLiner.rotation.x = Math.PI / 2;
  // Recessed open-ended dark vortex shroud (z = 228..252) framing spinning 10-blade CNC compressor impeller behind brass butterfly
  const tbShroud = add(tbGrp, new THREE.CylinderGeometry(34, 44.2, 24, N(30), 1, true), tbThroatMat);
  tbShroud.rotation.x = Math.PI / 2;
  tbShroud.position.z = -36;
  const tbInnerLip = add(tbGrp, new THREE.TorusGeometry(45.2, 2.2, N(8), N(30)), tbThroatMat);
  tbInnerLip.position.z = 22.5;
  // Tapered billet venturi snout collar + steel lip
  const tbVenturi = add(tbGrp, new THREE.CylinderGeometry(45.5, 50.5, 13, N(30), 1, true), M.alu);
  tbVenturi.rotation.x = Math.PI / 2;
  tbVenturi.position.z = 29;
  const tbVenturiIn = add(tbGrp, new THREE.CylinderGeometry(44.2, 44.2, 12, N(30), 1, true), tbThroatMat);
  tbVenturiIn.rotation.x = Math.PI / 2;
  tbVenturiIn.position.z = 29.5;
  const tbLip = add(tbGrp, new THREE.TorusGeometry(44.2, 2.8, N(8), N(30)), M.steel);
  tbLip.position.z = 35.5;

  // Spinning 10-Blade Billet Booster / Compressor Impeller (solid even in X-RAY, clear of full-open butterfly)
  const intakeWheel = new THREE.Group();
  intakeWheel.position.set(0, 294, 230);
  intakeGrp.add(intakeWheel);
  const wheelHub = add(intakeWheel, new THREE.CylinderGeometry(13.5, 16, 12, N(24)), M.alu);
  wheelHub.rotation.x = Math.PI / 2;
  const spinnerBase = add(intakeWheel, new THREE.ConeGeometry(13.2, 16, N(24)), M.crimson);
  spinnerBase.rotation.x = Math.PI / 2;
  spinnerBase.position.z = 9;
  const spinnerTip = add(intakeWheel, new THREE.ConeGeometry(5.5, 7, N(18)), M.chrome);
  spinnerTip.rotation.x = Math.PI / 2;
  spinnerTip.position.z = 16;
  for (let b = 0; b < 10; b++) {
    const bg = new THREE.Group();
    bg.rotation.z = (b / 10) * Math.PI * 2;
    intakeWheel.add(bg);
    const blade = add(bg, new THREE.BoxGeometry(2.2, 27, 13.5), b % 2 ? M.steel : M.alu);
    blade.position.set(0, 26.5, -1);
    blade.rotation.y = 0.58;
    blade.rotation.z = -0.18;
  }
  xrayKeep(intakeWheel);
  tag(intakeWheel, {
    name: '10-Blade CNC Booster Impeller',
    subsystem: 'Induction · Forced Air',
    material: 'CNC 7075-T6 Titanium/Alu Blades / Anodized Spinner',
    spec: '10-blade high-flow axial-centrifugal compressor wheel synced to RPM & boost',
  });

  // Articulating DBW Warm Brass Butterfly Plate, Cross-Shaft, Crank Arm & Linkage
  const tbSleeveRing = add(tbGrp, new THREE.TorusGeometry(51.2, 2.0, 8, N(28)), M.gunmetal);
  tbSleeveRing.position.z = -6;
  const butterfly = new THREE.Group();
  xrayKeep(butterfly);
  butterfly.position.set(0, 294, 286);
  intakeGrp.add(butterfly);
  const bfPlate = add(butterfly, new THREE.CylinderGeometry(42.2, 42.2, 2.2, N(28)), brassMat);
  bfPlate.rotation.x = Math.PI / 2;
  const bfShaft = add(butterfly, new THREE.CylinderGeometry(2.8, 2.8, 96, N(12)), brassMat);
  bfShaft.rotation.z = Math.PI / 2;
  for (const sx of [-16, 16]) {
    const screw = add(butterfly, new THREE.CylinderGeometry(2.2, 2.2, 4.2, 6), M.steel);
    screw.rotation.x = Math.PI / 2;
    screw.position.x = sx;
  }
  const shaftStub = add(butterfly, new THREE.CylinderGeometry(3.8, 3.8, 12, N(10)), M.steel);
  shaftStub.rotation.z = Math.PI / 2;
  shaftStub.position.x = 50;
  const crankArm = add(butterfly, new THREE.BoxGeometry(5, 22, 10), M.gunmetal);
  crankArm.position.set(53, 8, 0);
  add(butterfly, new THREE.CylinderGeometry(4, 4, 8, 10), M.crimson).position.set(53, 17, 0);
  const dbwLink = add(intakeGrp, new THREE.CylinderGeometry(2.2, 2.2, 26, 8), M.steel);
  dbwLink.position.set(53, 305, 288);
  dbwLink.rotation.x = 0.65;
  const dbwMotor = new THREE.Group();
  dbwMotor.position.set(60, 294, 288);
  intakeGrp.add(dbwMotor);
  add(dbwMotor, new THREE.BoxGeometry(22, 44, 42), M.blackMatte);
  add(dbwMotor, new THREE.CylinderGeometry(15, 15, 26, N(18)), M.alu).rotation.z = Math.PI / 2;
  const tpsSensor = add(intakeGrp, new THREE.BoxGeometry(14, 24, 28), M.blackMatte);
  tpsSensor.position.set(-54, 294, 288);
  add(intakeGrp, new THREE.BoxGeometry(8, 14, 14), M.crimson).position.set(-62, 294, 282);
  tag(tbGrp, {
    name: '90mm CNC Billet Throttle Body',
    subsystem: 'Induction · Air Metering',
    material: 'CNC 6061-T6 / Dark Anodized Throat / Warm Brass Butterfly',
    spec: 'Ø90 mm flanged bore, brass throttle plate & shaft, DBW servo & TPS',
  });
  tag(dbwMotor, {
    name: 'DBW Throttle Actuator & TPS',
    subsystem: 'Induction · Electronic Control',
    material: 'Cast Aluminum / Matte Polyamide Servo Housing',
    spec: 'Brushless DC gearmotor driving brass butterfly linkage',
  });

  // Valley head-port mounting rails & internal surge-plenum sapphire air-swirl streams (unified sculpted LS shell built below)
  const airFlowMat = makeStreamMaterial('#0090ff', '#d6f8ff', 22.0, true);
  for (const sgn of [-1, 1]) {
    const valleyFlange = add(intakeGrp, new THREE.BoxGeometry(20, 8, 396), M.alu);
    valleyFlange.position.set(sgn * 124, 214, 0);
    valleyFlange.rotation.z = sgn * 0.72;
  }
  // Machined aluminum throttle-snout mounting collar ring mating plenum neck (z=252) to 90mm DBW throttle body
  const tbNeckCollar = add(intakeGrp, new THREE.TorusGeometry(47.5, 3.4, N(10), N(28)), M.alu);
  tbNeckCollar.position.set(0, 294, 251);

  // Twin Slotted Crimson Billet Fuel Rails (Live Glowing Cyan-Blue Fuel Flow) + AN-8 Fittings + Crossovers + FPR Gauge
  const anBlueMat = new THREE.MeshPhysicalMaterial({ color: '#1b5fd9', roughness: 0.25, metalness: 0.45, clearcoat: 0.5 });
  if (lo) anBlueMat.color.set('#2864cc');
  const fuelFlowMat = makeStreamMaterial('#00b4ff', '#ecffff', 20.0);
  for (const sgn of [-1, 1]) {
    const railGrp = new THREE.Group();
    railGrp.position.set(sgn * 96, 250, 12);
    intakeGrp.add(railGrp);
    tag(railGrp, {
      name: `${sgn > 0 ? 'Left' : 'Right'} Bank Billet Fuel Rail`,
      subsystem: 'Fuel System · Sequential EFI',
      material: 'Slotted Crimson 6061-T6 / Billet Brackets / Cyan Fuel Flow',
      spec: '4.0 bar regulated slotted rail bolted to intake runners with live flow window',
    });
    // Slotted billet cage (end blocks + top/bottom/inner bars + collars leaving outer-top sight window)
    for (const ez of [-184, 184]) {
      const endBlk = add(railGrp, new THREE.CylinderGeometry(9.2, 9.2, 28, N(12)), M.crimson);
      endBlk.rotation.x = Math.PI / 2;
      endBlk.position.z = ez;
    }
    add(railGrp, new THREE.BoxGeometry(10, 4.5, 360), M.crimson).position.set(-sgn * 3.5, 6.2, 0);
    add(railGrp, new THREE.BoxGeometry(14, 4.5, 360), M.crimson).position.set(0, -6.5, 0);
    add(railGrp, new THREE.BoxGeometry(4.5, 14, 360), M.crimson).position.set(-sgn * 6.8, 0, 0);
    for (const cz of [-105, -35, 35, 105]) {
      const band = add(railGrp, new THREE.TorusGeometry(8.8, 1.8, 6, N(14)), M.crimson);
      band.position.z = cz;
    }
    // 4 machined billet aluminum standoff brackets + socket cap bolts fastening rail to intake runners
    for (const bz of [-152, -57, 38, 133]) {
      const brk = add(railGrp, new THREE.BoxGeometry(9, 22, 12), M.alu);
      brk.position.set(-sgn * 10, -11, bz);
      const foot = add(railGrp, new THREE.BoxGeometry(16, 6, 12), M.alu);
      foot.position.set(-sgn * 14, -20, bz);
      add(railGrp, new THREE.CylinderGeometry(2.6, 2.6, 5, 6), M.steel).position.set(-sgn * 14, -15, bz);
      add(railGrp, new THREE.CylinderGeometry(2.4, 2.4, 8, 6), M.steel).position.set(-sgn * 10, 2, bz);
    }
    const sightSleeve = add(railGrp, new THREE.CylinderGeometry(6.8, 6.8, 362, N(14)), M.glass, false);
    sightSleeve.rotation.x = Math.PI / 2;
    sightSleeve.renderOrder = 3;
    const flowCore = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 356, N(12), 1, true), fuelFlowMat);
    flowCore.rotation.x = Math.PI / 2;
    flowCore.renderOrder = 2;
    xrayKeep(flowCore);
    ignore(flowCore);
    railGrp.add(flowCore);

    for (const rz of [-188, 212]) {
      const fittingRed = add(intakeGrp, new THREE.CylinderGeometry(10.5, 10.5, 9, 6), M.crimson);
      fittingRed.rotation.x = Math.PI / 2;
      fittingRed.position.set(sgn * 96, 250, rz);
      const fittingBlue = add(intakeGrp, new THREE.CylinderGeometry(9.5, 9.5, 9, 6), anBlueMat);
      fittingBlue.rotation.x = Math.PI / 2;
      fittingBlue.position.set(sgn * 96, 250, rz + (rz > 0 ? 8 : -8));
    }
  }
  const fuelCrossPtsL = [new V3(-96, 250, 222), new V3(-54, 234, 230), new V3(-14, 224, 234)];
  const fuelCrossPtsR = [new V3(96, 250, 222), new V3(54, 234, 230), new V3(14, 224, 234)];
  add(intakeGrp, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fuelCrossPtsL), N(14), 4.8, 8, false), M.steel);
  add(intakeGrp, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fuelCrossPtsR), N(14), 4.8, 8, false), M.steel);
  // Front CNC AN-6 Fuel Crossover Distribution Block mounted cleanly BELOW throttle flange (y=224 < 238)
  const anFrontBlock = new THREE.Group();
  anFrontBlock.position.set(0, 224, 234);
  intakeGrp.add(anFrontBlock);
  add(anFrontBlock, new THREE.BoxGeometry(24, 15, 16), M.alu);
  add(anFrontBlock, new THREE.BoxGeometry(16, 4, 12), M.crimson).position.y = -9;
  for (const sx of [-15, 15]) {
    const anHex = add(anFrontBlock, new THREE.CylinderGeometry(7.2, 7.2, 8, 6), anBlueMat);
    anHex.rotation.z = Math.PI / 2;
    anHex.position.x = sx;
  }
  tag(anFrontBlock, { name: 'Front AN-6 Fuel Crossover Junction', subsystem: 'Fuel System · Sequential EFI', material: 'CNC 6061-T6 / Anodized AN-6 Fittings', spec: 'Equalizes 4.0 bar supply between Left & Right fuel rails' });
  const rearCrossPts = [new V3(-96, 250, -196), new V3(-50, 262, -206), new V3(0, 264, -208), new V3(50, 262, -206), new V3(96, 250, -196)];
  add(intakeGrp, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rearCrossPts), N(18), 5.2, 8, false), M.steel);
  const fpr = add(intakeGrp, new THREE.CylinderGeometry(14, 14, 22, N(16)), M.alu);
  fpr.position.set(0, 268, -208);
  add(intakeGrp, new THREE.CylinderGeometry(12, 14, 10, N(16)), M.crimson).position.set(0, 282, -208);

  // Billet Fuel Pressure Gauge atop/aft of FPR with rotating needle
  const fprGauge = new THREE.Group();
  fprGauge.position.set(0, 298, -214);
  fprGauge.rotation.x = -0.35;
  intakeGrp.add(fprGauge);
  tag(fprGauge, { name: 'Fuel Pressure Gauge & FPR', subsystem: 'Fuel System · Sequential EFI', material: 'CNC 6061-T6 / Tempered Dial Glass', spec: '4.0–5.0 bar boost-referenced pressure gauge & billet FPR' });
  const gBezel = add(fprGauge, new THREE.CylinderGeometry(16, 16, 8, N(22)), M.alu);
  gBezel.rotation.x = Math.PI / 2;
  const gDial = add(fprGauge, new THREE.CylinderGeometry(13.2, 13.2, 1.5, N(22)), M.ceramic);
  gDial.rotation.x = Math.PI / 2;
  gDial.position.z = -3.8;
  const gWarn = add(fprGauge, new THREE.TorusGeometry(10.5, 1.4, 6, 14, Math.PI * 0.35), M.crimson);
  gWarn.position.z = -4.6;
  gWarn.rotation.z = Math.PI * 0.5;
  const fprNeedle = new THREE.Group();
  fprNeedle.position.z = -4.8;
  xrayKeep(fprNeedle);
  fprGauge.add(fprNeedle);
  add(fprNeedle, new THREE.BoxGeometry(1.6, 10, 1.2), M.crimson).position.y = 3.5;
  add(fprNeedle, new THREE.CylinderGeometry(2.6, 2.6, 2, 10), M.black).rotation.x = Math.PI / 2;
  const gGlass = add(fprGauge, new THREE.CylinderGeometry(14, 14, 1.2, N(22)), M.glass, false);
  gGlass.rotation.x = Math.PI / 2;
  gGlass.position.z = -5.4;

  // ---- Unified Sculpted LS-Style 8-Rib Manifold Shell (single seamless lofted BufferGeometry, z=-204..+252) ----
  const injSprayMatBase = new THREE.MeshBasicMaterial({ color: '#28b8ff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });

  (function buildUnifiedManifoldShell() {
    const RZ = [175, 125, 75, 25, -25, -75, -125, -175];
    const COLS = lo ? 72 : 168;
    const ROWS = lo ? 20 : 36;
    const zMin = -204, zMax = 252;
    const positions = [];
    const indices = [];

    function ringPoint(z, theta) {
      const cx = Math.sin(theta);
      const cy = -Math.cos(theta);
      const snoutT = z > 195 ? Math.min(1, (z - 195) / 57) : 0;
      const snoutW = snoutT * snoutT * (3 - 2 * snoutT);
      const rearT = z < -184 ? Math.min(1, (-184 - z) / 20) : 0;
      const rearW = rearT * rearT * (3 - 2 * rearT);

      let minD = 999;
      for (let k = 0; k < 8; k++) {
        const d = Math.abs(z - RZ[k]);
        if (d < minD) minD = d;
      }
      const u = Math.min(1, minD / 25);
      const rib = Math.pow(0.5 + 0.5 * Math.cos(u * Math.PI), 0.62) * (1 - snoutW) * (1 - rearW);

      let manX, manY;
      if (cy >= 0) {
        const sx = Math.sign(cx) * Math.pow(Math.abs(cx), 0.72);
        const sy = Math.pow(cy, 0.88);
        const halfW = 74 + 7 * rib * (0.35 + 0.65 * cy);
        const crownY = 330 + 28 * rib;
        manX = sx * halfW;
        manY = 272 + sy * (crownY - 272);
      } else {
        const sx = Math.sign(cx) * Math.pow(Math.abs(cx), 0.72);
        const halfW = 64 + 10 * (1 + cy) + 2.4 * rib * (1 + cy);
        manX = sx * halfW;
        manY = 272 + cy * 44;
      }

      const rearScale = 1 - 0.36 * rearW;
      manX *= rearScale;
      manY = 278 + (manY - 278) * rearScale;

      const snoutX = 46 * cx;
      const snoutY = 294 + 46 * cy;
      return [
        manX * (1 - snoutW) + snoutX * snoutW,
        manY * (1 - snoutW) + snoutY * snoutW,
      ];
    }

    for (let si = 0; si <= COLS; si++) {
      const z = zMin + (si / COLS) * (zMax - zMin);
      for (let ri = 0; ri < ROWS; ri++) {
        const theta = (ri / ROWS) * Math.PI * 2;
        const [x, y] = ringPoint(z, theta);
        positions.push(x, y, z);
      }
    }
    for (let si = 0; si < COLS; si++) {
      for (let ri = 0; ri < ROWS; ri++) {
        const rn = (ri + 1) % ROWS;
        const a = si * ROWS + ri;
        const b = si * ROWS + rn;
        const c = (si + 1) * ROWS + ri;
        const d = (si + 1) * ROWS + rn;
        indices.push(a, b, d);
        indices.push(a, d, c);
      }
    }
    const rearCenterIdx = (COLS + 1) * ROWS;
    positions.push(0, 278, zMin - 3);
    for (let ri = 0; ri < ROWS; ri++) {
      const rn = (ri + 1) % ROWS;
      indices.push(rearCenterIdx, rn, ri);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const manifoldShell = new THREE.Mesh(geo, plenumMat);
    manifoldShell.renderOrder = 4;
    tag(manifoldShell, {
      name: 'Unified LS-Style 8-Runner Manifold Shell',
      subsystem: 'Induction · Cross-Ram Manifold',
      material: 'Sculpted Composite (Solid) / Smoked Mineral-Sapphire (Glass)',
      spec: 'Continuous lofted 8-rib LS composite plenum shell spanning z = −204..+252 mm',
    }, [0, 320, 0]);
    intakeGrp.add(manifoldShell);

    // Sculpted lower port runner ducts flaring cleanly beneath fuel rails into cylinder head intake ports
    for (const cy of CYL) {
      const out = cy.bank === 'L' ? 1 : -1;
      const stubPts = [
        new V3(out * 64, 240, 0),
        new V3(out * 94, 224, 0),
        new V3(out * 124, 212, 0),
      ];
      const stub = add(intakeGrp, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(stubPts), N(10), 15.5, N(14), false), plenumMat, false);
      stub.scale.z = 1.28;
      stub.position.z = cy.z;
      stub.renderOrder = 4;
      tag(stub, { name: `Cyl ${cy.c} Intake Port Runner`, subsystem: 'Induction · Cross-Ram Manifold', material: 'Composite Runner', spec: 'Contoured port duct from valley plenum beneath fuel rail to head port' }, [0, 260, 0]);

      const portCollar = add(intakeGrp, new THREE.CylinderGeometry(16, 17, 10, N(16)), M.alu);
      portCollar.position.set(out * 124, 212, cy.z);
      portCollar.rotation.z = out * 0.72;
    }

    // 4 machined fuel-rail standoff pads on each side supporting rail brackets cleanly
    for (const sgn of [-1, 1]) {
      for (const bz of [-140, -45, 50, 145]) {
        const pad = add(intakeGrp, new THREE.BoxGeometry(16, 6, 14), M.alu);
        pad.position.set(sgn * 80, 226, bz);
      }
    }
  })();

  // Continuous animated cyan-cobalt vapor ribbons & vortex core streaming from throttle butterfly -> impeller -> surge plenum
  const plenumStreams = [];
  const mainSwirlCurve = new THREE.CatmullRomCurve3([
    new V3(0, 294, 282),
    new V3(0, 294, 232),
    new V3(0, 298, 180),
    new V3(0, 302, 0),
    new V3(0, 296, -182),
  ]);
  const mainCoreStream = new THREE.Mesh(new THREE.TubeGeometry(mainSwirlCurve, N(22), 14, N(12), false), airFlowMat);
  mainCoreStream.renderOrder = 3;
  xrayKeep(mainCoreStream);
  ignore(mainCoreStream);
  intakeGrp.add(mainCoreStream);
  plenumStreams.push(mainCoreStream);

  const ribbonHelixCurves = [0, 1, 2].map((ri) => {
    const pts = [];
    const steps = 22;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const z = 282 - t * 462;
      const rad = z > 215 ? 20 : 28 * Math.sin(Math.min(1, (215 - z) / 60) * 0.5 * Math.PI) * (1 - 0.25 * Math.max(0, t - 0.75) / 0.25) + 14;
      const ang = (ri * Math.PI * 2) / 3 + t * Math.PI * 5.5;
      const cyCenter = z > 210 ? 294 : 300;
      pts.push(new V3(Math.cos(ang) * rad, cyCenter + Math.sin(ang) * rad * 0.75, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const ribbon = new THREE.Mesh(new THREE.TubeGeometry(curve, N(36), 4.6, N(8), false), airFlowMat);
    ribbon.renderOrder = 3;
    xrayKeep(ribbon);
    ignore(ribbon);
    intakeGrp.add(ribbon);
    plenumStreams.push(ribbon);
    return { curve, phase: ri / 3 };
  });

  // 8 internal flared chrome velocity stacks, short machined trumpet collars & visible glowing intake mist streams
  const injectors = CYL.map((cy, idx) => {
    const out = cy.bank === 'L' ? 1 : -1;
    const zArch = 175 - idx * 50;
    const bell = add(intakeGrp, new THREE.TorusGeometry(12.5, 2.5, N(8), N(18)), M.chrome);
    bell.rotation.y = Math.PI / 2;
    bell.position.set(-out * 24, 314, zArch);
    xrayKeep(bell);

    // Short open-ended velocity stack trumpet collar at bellmouth (leaves rest of runner curve open to show live mist stream)
    const trumpet = add(intakeGrp, new THREE.CylinderGeometry(8.6, 12.2, 24, N(14), 1, true), M.alu);
    trumpet.rotation.z = -out * (Math.PI / 2 - 0.14);
    trumpet.position.set(-out * 13, 316, zArch);
    xrayKeep(trumpet);

    const streamPts = [
      new V3(-out * 30, 312, zArch),
      new V3(0, 318, zArch),
      new V3(out * 36, 292, zArch + (cy.z - zArch) * 0.45),
      new V3(out * 64, 240, cy.z),
      new V3(out * 116, 214, cy.z),
    ];
    const runnerCurve = new THREE.CatmullRomCurve3(streamPts);
    const swirlMat = airFlowMat.clone();
    const runnerSwirl = new THREE.Mesh(new THREE.TubeGeometry(runnerCurve, N(20), 9.4, N(10), false), swirlMat);
    runnerSwirl.renderOrder = 3;
    xrayKeep(runnerSwirl);
    ignore(runnerSwirl);
    intakeGrp.add(runnerSwirl);

    // Port Fuel Injector + Pulsing Spray Plume inside port runner mouth
    const inj = new THREE.Group();
    inj.position.set(out * 102, 236, cy.z);
    inj.rotation.z = out * 0.55;
    xrayKeep(inj);
    noCap(inj);
    intakeGrp.add(inj);
    add(inj, new THREE.CylinderGeometry(5.5, 5.5, 22, N(10)), M.crimson);
    add(inj, new THREE.CylinderGeometry(3.8, 3.2, 14, N(10)), M.bronze).position.y = -15;
    const sprayMat = injSprayMatBase.clone();
    const spray = new THREE.Mesh(new THREE.ConeGeometry(13, 38, N(12), 1, true), sprayMat);
    spray.position.y = -36;
    spray.visible = false;
    spray.renderOrder = 6;
    xrayKeep(spray);
    ignore(spray);
    inj.add(spray);
    tag(inj, { name: `Cyl ${cy.c} Port Fuel Injector`, subsystem: 'Fuel System · Sequential EFI', material: 'Bronze Pintle / Crimson Solenoid', spec: `4.0 bar multi-hole spray during ${cy.c} intake stroke` });
    return { cy, spray, sprayMat, runnerSwirl, swirlMat, runnerCurve };
  });

  // Atomized fuel-air droplet beads streaming continuously through throttle -> impeller -> plenum -> all 8 runner horns
  const PLENUM_BEADS = 48;
  const RUNNER_BEADS_EACH = 10;
  const TOTAL_BEADS = PLENUM_BEADS + CYL.length * RUNNER_BEADS_EACH;
  const dropletMat = new THREE.MeshBasicMaterial({ color: '#9cf5ff', transparent: true, opacity: 0.9, depthWrite: false });
  const dropletMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(2.5, 6, 5), dropletMat, TOTAL_BEADS);
  dropletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dropletMesh.renderOrder = 3;
  xrayKeep(dropletMesh);
  ignore(dropletMesh);
  intakeGrp.add(dropletMesh);
  const beadDummy = new THREE.Object3D();
  const beadPos = new V3();

  // ------------------------------------------------------------ Twin 4-into-1 Exhaust Merge Collectors & Multi-Layer Flame Plumes + Embers
  const collectors = ['L', 'R'].map((bank) => {
    const out = bank === 'L' ? 1 : -1;
    const cg = new THREE.Group();
    cg.position.set(out * 216, -26, -242);
    root.add(cg);
    tag(cg, {
      name: `${bank === 'L' ? 'Left' : 'Right'} Bank 4-into-1 Merge Collector`,
      subsystem: `Exhaust · ${bank === 'L' ? 'Left' : 'Right'} Bank`,
      material: 'Brushed Raw Titanium / Bronze V-Band',
      spec: 'Merges 4 equal-length primary tubes with O₂ sensor boss & flame plume',
    }, [out * 95, 10, 0]);
    const mergeBell = add(cg, new THREE.CylinderGeometry(31, 31, 26, N(22)), exTubeMat);
    mergeBell.rotation.x = Math.PI / 2;
    mergeBell.position.z = 48;
    const cone = add(cg, new THREE.CylinderGeometry(18, 31, 56, N(22)), exTubeMat);
    cone.rotation.x = Math.PI / 2;
    cone.position.z = 8;
    const stub = add(cg, new THREE.CylinderGeometry(19, 19, 44, N(20)), exTubeMat);
    stub.rotation.x = Math.PI / 2;
    stub.position.z = -38;
    add(cg, new THREE.TorusGeometry(20, 3.8, N(8), N(20)), M.bronze).position.z = -18;
    const o2Boss = add(cg, new THREE.CylinderGeometry(4.5, 4.5, 16, N(10)), M.steel);
    o2Boss.rotation.z = out * 0.7;
    o2Boss.position.set(out * 18, 16, -34);

    // Dual sleek GLSL continuous flame plumes (supersonic blue core + golden-amber/crimson turbulent tongue) + glowing embers
    const flameGrp = new THREE.Group();
    flameGrp.position.z = -60;
    flameGrp.visible = false;
    cg.add(flameGrp);
    const coreMat = makeCollectorFlameMaterial(true);
    const outerMat = makeCollectorFlameMaterial(false);
    const emberMat = new THREE.MeshBasicMaterial({ color: '#ffbe4a', transparent: true, opacity: 0.92, depthWrite: false });
    const coreMesh = new THREE.Mesh(new THREE.ConeGeometry(10.5, 76, N(20), 8, true), coreMat);
    coreMesh.rotation.x = -Math.PI / 2;
    coreMesh.position.z = -36;
    coreMesh.renderOrder = 6;
    const outerMesh = new THREE.Mesh(new THREE.ConeGeometry(18.5, 118, N(22), 12, true), outerMat);
    outerMesh.rotation.x = -Math.PI / 2;
    outerMesh.position.z = -56;
    outerMesh.renderOrder = 5;
    flameGrp.add(outerMesh, coreMesh);
    const emberGeo = new THREE.OctahedronGeometry(2.6, 0);
    const embers = Array.from({ length: 10 }, (_, k) => {
      const em = new THREE.Mesh(emberGeo, emberMat);
      em.renderOrder = 7;
      flameGrp.add(em);
      return { m: em, phase: k / 10, ang: k * 2.39996 };
    });
    xrayKeep(flameGrp);
    ignore(flameGrp);
    return { cg, bank, out, flameGrp, coreMat, outerMat, emberMat, embers };
  });

  // Sculpted A356 Cast-Aluminum Front Timing Cover Chest (visible behind open CNC gear spoke windows)
  const timingCover = new THREE.Group();
  timingCover.position.z = 250;
  root.add(timingCover);
  tag(timingCover, { name: 'Cast-Aluminum Timing Cover Chest', subsystem: 'Timing Drive · Front', material: 'Die-Cast A356 Aluminum / Gunmetal Bearing Carriers', spec: 'Sculpted front chest with machined crank/idler/cam bearing bosses' }, [0, 0, 28]);
  {
    const tcSh = new THREE.Shape();
    tcSh.moveTo(-66, -74);
    tcSh.lineTo(66, -74);
    tcSh.lineTo(298, 224);
    tcSh.lineTo(222, 294);
    tcSh.lineTo(0, 126);
    tcSh.lineTo(-222, 294);
    tcSh.lineTo(-298, 224);
    tcSh.closePath();
    const crankHole = new THREE.Path();
    crankHole.absarc(0, 0, 26, 0, Math.PI * 2, true);
    tcSh.holes.push(crankHole);
    for (const B of [BANK.L, BANK.R]) {
      const ch = new THREE.Path();
      ch.absarc((DECK + 112) * B.b[0], (DECK + 112) * B.b[1], 16, 0, Math.PI * 2, true);
      tcSh.holes.push(ch);
    }
    const tcGeo = new THREE.ExtrudeGeometry(tcSh, { depth: 10, bevelEnabled: true, bevelThickness: 1.4, bevelSize: 1.4, bevelSegments: 1, curveSegments: 12 });
    tcGeo.translate(0, 0, -5);
    add(timingCover, tcGeo, M.alu);
    // Machined gunmetal bearing carrier bosses + radial stiffener ribs behind open gear windows
    const cBoss = add(timingCover, new THREE.CylinderGeometry(36, 39, 13, N(24)), M.gunmetal);
    cBoss.rotation.x = Math.PI / 2;
    cBoss.position.z = 2;
    for (const B of [BANK.L, BANK.R]) {
      const iBoss = add(timingCover, new THREE.CylinderGeometry(38, 42, 13, N(24)), M.gunmetal);
      iBoss.rotation.x = Math.PI / 2;
      iBoss.position.set(150.222 * B.b[0], 150.222 * B.b[1], 2);
      const camBoss = add(timingCover, new THREE.CylinderGeometry(30, 34, 13, N(20)), M.gunmetal);
      camBoss.rotation.x = Math.PI / 2;
      camBoss.position.set((DECK + 112) * B.b[0], (DECK + 112) * B.b[1], 2);
      const rib = add(timingCover, new THREE.BoxGeometry(12, 195, 11), M.gunmetal);
      rib.position.set(112 * B.b[0], 112 * B.b[1], 1.5);
      rib.rotation.z = Math.atan2(B.b[1], B.b[0]) - Math.PI / 2;
    }
    for (const [bx, by] of [[-52, -62], [52, -62], [116, 48], [-116, 48], [218, 180], [-218, 180], [268, 240], [-268, 240], [0, 98]]) {
      const b = add(timingCover, new THREE.CylinderGeometry(4.2, 4.2, 15, 6), M.steel);
      b.rotation.x = Math.PI / 2;
      b.position.set(bx, by, 3);
    }
  }

  const bellRing = new THREE.Group();
  bellRing.position.z = -254;
  root.add(bellRing);
  tag(bellRing, { name: 'Bellhousing Flange & Rear Seal', subsystem: 'Rotating Assembly · Rear', material: 'CNC 6061-T6 Bellhousing Arch / Steel Dowels', spec: 'Rear transmission adapter arch with sculpted mount ears, twin dowels & rear main seal' }, [0, 0, -55]);
  // Sculpted upper bellhousing alignment arch + perimeter mounting ears + machined rear main seal plate
  {
    const bhSh = new THREE.Shape();
    bhSh.absarc(0, 0, 194, -0.34, Math.PI + 0.34, false);
    bhSh.absarc(0, 0, 158, Math.PI + 0.34, -0.34, true);
    bhSh.closePath();
    const bhGeo = new THREE.ExtrudeGeometry(bhSh, { depth: 14, bevelEnabled: !lo, bevelThickness: 1.2, bevelSize: 1.0, bevelSegments: 1, curveSegments: N(36) });
    bhGeo.translate(0, 0, -7);
    add(bellRing, bhGeo, M.alu);
    const topArchPad = add(bellRing, new THREE.BoxGeometry(58, 22, 16), M.alu);
    topArchPad.position.set(0, 190, 0);
    const sealPlate = add(bellRing, new THREE.CylinderGeometry(58, 60, 12, N(28)), M.gunmetal);
    sealPlate.rotation.x = Math.PI / 2;
    sealPlate.position.z = 2;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const sb = add(bellRing, new THREE.CylinderGeometry(3.2, 3.2, 16, 6), M.steel);
      sb.rotation.x = Math.PI / 2;
      sb.position.set(Math.cos(a) * 48, Math.sin(a) * 48, 2);
    }
    for (const sx of [-96, 96]) {
      const rib = add(bellRing, new THREE.BoxGeometry(14, 48, 22), M.alu);
      rib.position.set(sx, 145, 10);
      rib.rotation.z = sx > 0 ? -0.45 : 0.45;
    }
    // Lower skirt transition ears (left & right, angled to clear starter pocket at (-148, -82))
    for (const [ex, ey, rz] of [[156, -54, 0.32], [-174, -40, -0.38]]) {
      const ear = add(bellRing, new THREE.BoxGeometry(36, 22, 14), M.alu);
      ear.position.set(ex, ey, 0);
      ear.rotation.z = rz;
      const ebolt = add(bellRing, new THREE.CylinderGeometry(4.2, 4.2, 22, 6), M.steel);
      ebolt.rotation.x = Math.PI / 2;
      ebolt.position.set(ex + Math.sign(ex) * 6, ey - 2, 0);
    }
  }
  for (let k = 0; k < 8; k++) {
    const a = -0.24 + (k / 7) * (Math.PI + 0.48);
    const ex = Math.cos(a) * 190;
    const ey = Math.sin(a) * 190;
    const earGusset = add(bellRing, new THREE.BoxGeometry(24, 24, 13), M.alu);
    earGusset.position.set(Math.cos(a) * 184, Math.sin(a) * 184, 0);
    earGusset.rotation.z = a;
    const boss = add(bellRing, new THREE.CylinderGeometry(10.5, 12, 18, N(12)), M.alu);
    boss.rotation.x = Math.PI / 2;
    boss.position.set(ex, ey, 0);
    const bolt = add(bellRing, new THREE.CylinderGeometry(4.5, 4.5, 24, 6), M.steel);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(ex, ey, 0);
  }
  for (const dx of [-174, 174]) {
    const collar = add(bellRing, new THREE.CylinderGeometry(9.5, 10.5, 16, N(14)), M.alu);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(dx, -20, -2);
    const dowel = add(bellRing, new THREE.CylinderGeometry(6.5, 6.5, 28, N(12)), M.steel);
    dowel.rotation.x = Math.PI / 2;
    dowel.position.set(dx, -20, -8);
  }

  const flywheel = new THREE.Group();
  flywheel.position.z = -290;
  root.add(flywheel);
  tag(flywheel, { name: 'Machined Flywheel & Ring Gear', subsystem: 'Rotating Assembly · Rear', material: 'Billet Chromoly / 120T Steel Ring / Stepped 8-Bolt Hub', spec: 'Ø300 mm lightened stepped flywheel, 120T ring gear, 8-bolt crank flange' }, [0, -110, -90]);
  add(flywheel, new THREE.CylinderGeometry(150, 150, 18, N(72)), M.gunmetal).rotation.x = Math.PI / 2;
  add(flywheel, gear(120, 166, 158, 20, 0, 140), M.blackMatte);
  // Recessed dark matte backing + flush 6-pocket ExtrudeGeometry machined steel friction ring (zero Z-fighting or gap)
  const fwBack = add(flywheel, new THREE.CylinderGeometry(134, 134, 4, N(48)), M.blackMatte);
  fwBack.rotation.x = Math.PI / 2;
  fwBack.position.z = -8.5;
  {
    const fwSh = new THREE.Shape();
    fwSh.absarc(0, 0, 134, 0, Math.PI * 2, false);
    const hubHole = new THREE.Path();
    hubHole.absarc(0, 0, 50, 0, Math.PI * 2, true);
    fwSh.holes.push(hubHole);
    for (let k = 0; k < (plain ? 0 : 6); k++) {
      const a = (k / 6) * Math.PI * 2;
      const hole = new THREE.Path();
      hole.absarc(Math.cos(a) * 90, Math.sin(a) * 90, 16, 0, Math.PI * 2, true);
      fwSh.holes.push(hole);
    }
    const faceGeo = new THREE.ExtrudeGeometry(fwSh, { depth: 4, bevelEnabled: !lo, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 1, curveSegments: N(32) });
    const frictionFace = add(flywheel, faceGeo, M.steel);
    frictionFace.position.z = -12.6;
  }
  const fwStep = add(flywheel, new THREE.CylinderGeometry(52, 56, 20, N(32)), M.gunmetal);
  fwStep.rotation.x = Math.PI / 2;
  fwStep.position.z = -3;
  const fwHub = add(flywheel, new THREE.CylinderGeometry(39, 41, 26, N(32)), M.alu);
  fwHub.rotation.x = Math.PI / 2;
  fwHub.position.z = -3;
  const fwPilot = add(flywheel, new THREE.CylinderGeometry(16, 16, 28, N(20)), M.blackMatte);
  fwPilot.rotation.x = Math.PI / 2;
  fwPilot.position.z = -3;
  for (let k = 0; k < (plain ? 0 : 8); k++) {
    const a = (k / 8) * Math.PI * 2;
    const washer = add(flywheel, new THREE.CylinderGeometry(6, 6, 2, N(10)), M.gunmetal);
    washer.rotation.x = Math.PI / 2;
    washer.position.set(Math.cos(a) * 28, Math.sin(a) * 28, -16);
    const bolt = add(flywheel, new THREE.CylinderGeometry(4.2, 4.2, 32, 6), M.steel);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(Math.cos(a) * 28, Math.sin(a) * 28, -3);
  }

  // slim red arcs tucked neatly around the crank damper rim
  const arcs = new THREE.Group();
  arcs.position.z = front + 90;
  root.add(arcs);
  for (const a0 of [0, Math.PI]) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(84, 2.8, 8, 48, Math.PI * 0.62), M.red);
    arc.rotation.z = a0;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(8, 20, 14), M.red);
    const ta = a0 + Math.PI * 0.62;
    tip.position.set(Math.cos(ta) * 84, Math.sin(ta) * 84, 0);
    tip.rotation.z = ta;
    arcs.add(arc, tip);
  }
  arcs.renderOrder = 5;
  ignore(arcs);

  const CHARGE_COL = [new THREE.Color('#3f8de0'), new THREE.Color('#5d6670'), new THREE.Color('#ff6a1f'), new THREE.Color('#8b8f95')];
  const CHARGE_COL_MISFIRE = new THREE.Color('#6f96b8');
  const CHARGE_COL_KNOCK = new THREE.Color('#fff2b0');
  const tmp = new V3();
  const CLIP = new THREE.Plane(new V3(0, 0, -1), 0);
  const Z_CUT = new V3(0, 0, -1);

  const xrayMat = lo
    ? new THREE.MeshLambertMaterial({ color: '#5eb8f2', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.FrontSide })
    : makeXrayMaterial();
  if (tensionerGrp?.pulley) xrayKeep(tensionerGrp.pulley);
  if (acCompressorGrp?.pulley) xrayKeep(acCompressorGrp.pulley);
  const xrayMeshes = [];
  for (const grp of [block, coversGrp, timingCover, bellRing, intakeGrp, ...[thermostatGrp, acCompressorGrp, tensionerGrp].filter(Boolean), ...collectors.map((c) => c.cg), ...cyl.map((c) => c.head)]) {
    grp.traverse((m) => {
      if (m.isMesh && !m.userData.xrayKeep) xrayMeshes.push(m);
    });
  }
  let xrayOn = false;
  const setXray = (on) => {
    xrayOn = !!on;
    if (!xrayOn) {
      for (const m of ghosted) m.material = m.userData.mat0;
      ghosted.clear();
    } else if (!wireOn) {
      for (const m of xrayMeshes) {
        m.material = xrayMat;
        ghosted.add(m);
      }
    }
  };

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

  const extraSolidMats = [anBlueMat, exTubeMat, nitrideMat, tbThroatMat, brassMat, ...DM.materials];
  const coverGlassMat = coversGrp.glassMat && coversGrp.glassMat !== M.glass ? coversGrp.glassMat : null;
  for (const m of [...extraSolidMats, plenumMat, ...(coverGlassMat ? [coverGlassMat] : [])]) {
    const g = m.clone();
    g.transparent = true;
    g.depthWrite = false;
    g.clipShadows = true;
    m.clipShadows = true;
    GHOST.set(m, g);
  }
  const solidSet = new Set([M.black, M.blackMatte, M.gunmetal, M.steel, M.chrome, M.alu, M.bronze, M.crimson, M.beltRubber, M.ceramic, ...extraSolidMats]);

  let cap = null;
  const helpers = [];
  if (opts.caps) {
    for (const g of [sparkLeadsGrp, harnessGrp, serpGrp, thermostatGrp, tensionerGrp, acCompressorGrp, arcs, dbwMotor, tpsSensor, fprGauge]) noCap(g);
    const inc = THREE.IncrementWrapStencilOp;
    const dec = THREE.DecrementWrapStencilOp;
    const count = (side, op) =>
      new THREE.MeshBasicMaterial({ side, colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op, clippingPlanes: [CLIP] });
    helpers.push(count(THREE.BackSide, inc), count(THREE.FrontSide, dec));
    const parts = [];
    const bbSize = new V3();
    root.traverse((m) => {
      if (!m.isMesh || m.isInstancedMesh || m.userData.noCap || m.userData.ignoreInspect || !solidSet.has(m.material)) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      m.geometry.boundingBox.getSize(bbSize);
      const a = bbSize.x, b = bbSize.y, c = bbSize.z;
      const minD = Math.min(a, b, c);
      const maxD = Math.max(a, b, c);
      const midD = a + b + c - minD - maxD;
      if (minD >= 8 && midD >= 22) parts.push(m);
    });
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
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshStandardMaterial({ color: opts.caps, roughness: 0.55, metalness: 0, side: THREE.DoubleSide, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: rep, stencilZFail: rep, stencilZPass: rep }),
    );
    cap.renderOrder = 1.1;
    cap.userData.ignoreInspect = true;
    cap.onAfterRender = (r) => r.clearStencil();
    for (const mat of [...helpers, cap.material]) mat.visible = false;
  }
  const C0 = new V3(0, 0.1, 0);
  const Z_UNIT = new V3(0, 0, 1);
  const tmpA = new V3();
  const tmpB = new V3();
  const placeCap = () => {
    if (!cap) return;
    cap.position.copy(C0).addScaledVector(CLIP.normal, -CLIP.distanceToPoint(C0));
    cap.quaternion.setFromUnitVectors(Z_UNIT, tmp.copy(CLIP.normal).negate());
  };

  for (const m of [...Object.values(M), ...GHOST.values()]) m.clipShadows = true;
  const clipMats = () => [
    ...Object.values(M),
    ...extraSolidMats,
    plenumMat,
    ...(coverGlassMat ? [coverGlassMat] : []),
    ...GHOST.values(),
    ...cyl.flatMap((c) => [c.chargeMat, c.sparkMat, c.sparkCoreMat, c.sparkGlowMat]),
    ...injectors.flatMap((inj) => [inj.sprayMat, inj.swirlMat]),
    airFlowMat,
    fuelFlowMat,
    dropletMat,
    xrayMat,
    ...(waterPumpGrp.coolantMat ? [waterPumpGrp.coolantMat] : []),
    ...(sumpGrp.oilMat ? [sumpGrp.oilMat] : []),
    ...collectors.flatMap((col) => [col.coreMat, col.outerMat, col.emberMat]),
  ];
  let cutNow = 'glass';
  let glassOpacity = 0.36;
  let refractOn = true;
  let wireOn = false;
  const wireSnap = new Map();
  const wireMats = () => [...new Set([...Object.values(M).filter((m) => m !== M.red), ...extraSolidMats, plenumMat, ...(coverGlassMat ? [coverGlassMat] : []), ...GHOST.values()])];
  const applyWireStyle = (m) => {
    m.wireframe = true;
    if (m.color) m.color.set('#1a1410');
    if (m.emissive) {
      m.emissive.set('#1a1410');
      m.emissiveIntensity = 0.78;
    }
    if ('metalness' in m) m.metalness = 0;
    if ('roughness' in m) m.roughness = 1;
    if ('clearcoat' in m) m.clearcoat = 0;
    if ('envMapIntensity' in m) m.envMapIntensity = 0.1;
    if (m === M.glass || m === coverGlassMat) {
      m.opacity = 0.42;
    } else if (m === plenumMat) {
      m.opacity = 0.85;
    }
  };
  const applyCutMaterials = (mode) => {
    if (wireOn) return;
    const solid = mode === 'solid';
    if (lo) {
      for (const m of [...Object.values(M), ...extraSolidMats, plenumMat, ...GHOST.values()]) m.side = mode === 'section' ? THREE.DoubleSide : THREE.FrontSide;
      plenumMat.opacity = solid ? 0.96 : 0.36;
      plenumMat.transparent = !solid;
      plenumMat.depthWrite = solid;
      plenumMat.color.set(solid ? '#282422' : '#6b7f94');
      return;
    }
    M.glass.color.set(solid ? '#a6acb4' : '#6b7f94');
    M.glass.roughness = solid ? 0.34 : 0.12;
    M.glass.metalness = solid ? 0.6 : 0.05;
    M.glass.clearcoat = solid ? 0.1 : 1.0;
    M.glass.clearcoatRoughness = solid ? 0.25 : 0.08;
    M.glass.opacity = solid ? 0.96 : glassOpacity;
    M.glass.depthWrite = solid;
    plenumMat.color.set(solid ? '#282422' : '#6b7f94');
    plenumMat.roughness = solid ? 0.40 : 0.12;
    plenumMat.metalness = solid ? 0.16 : 0.05;
    plenumMat.clearcoat = solid ? 0.25 : 1.0;
    plenumMat.clearcoatRoughness = solid ? 0.28 : 0.08;
    plenumMat.opacity = solid ? 0.98 : glassOpacity;
    plenumMat.transparent = !solid;
    plenumMat.depthWrite = solid;
    plenumMat.side = mode === 'section' ? THREE.DoubleSide : THREE.FrontSide;
  };
  const setCut = (mode, zWorld = 0, normal = Z_CUT) => {
    CLIP.normal.copy(normal);
    CLIP.constant = zWorld;
    placeCap();
    if (mode === cutNow) return;
    cutNow = mode;
    for (const m of clipMats()) {
      m.clippingPlanes = mode === 'section' ? [CLIP] : null;
      m.needsUpdate = true;
    }
    if (cap) for (const mat of [...helpers, cap.material]) mat.visible = mode === 'section';
    const solid = mode === 'solid';
    for (const w of glassWindows) w.visible = !solid;
    for (const l of solidLids) l.visible = solid;
    for (const sw of solidWalls) sw.visible = solid;
    applyCutMaterials(mode);
  };
  const setRefract = (on) => {
    refractOn = !!on;
    glassOpacity = refractOn ? 0.36 : 0.22;
    if (wireOn) return;
    M.glass.envMapIntensity = refractOn ? 1.5 : 0.3;
    plenumMat.envMapIntensity = refractOn ? 1.4 : 0.35;
    if (coverGlassMat) {
      coverGlassMat.envMapIntensity = refractOn ? 1.5 : 0.3;
      coverGlassMat.opacity = refractOn ? 0.34 : 0.2;
    }
    if (cutNow !== 'solid') {
      M.glass.opacity = glassOpacity;
      plenumMat.opacity = glassOpacity;
    }
  };
  const setWireframe = (on) => {
    const next = !!on;
    if (next === wireOn) return;
    wireOn = next;
    if (next) {
      wireSnap.clear();
      for (const m of wireMats()) {
        wireSnap.set(m, {
          wireframe: !!m.wireframe,
          color: m.color ? m.color.clone() : null,
          emissive: m.emissive ? m.emissive.clone() : null,
          emissiveIntensity: m.emissiveIntensity ?? 0,
          metalness: m.metalness,
          roughness: m.roughness,
          clearcoat: m.clearcoat,
          transparent: m.transparent,
          opacity: m.opacity,
          envMapIntensity: m.envMapIntensity,
        });
        applyWireStyle(m);
      }
    } else {
      for (const [m, s] of wireSnap) {
        m.wireframe = s.wireframe;
        if (m.color && s.color) m.color.copy(s.color);
        if (m.emissive && s.emissive) m.emissive.copy(s.emissive);
        if ('emissiveIntensity' in m) m.emissiveIntensity = s.emissiveIntensity;
        if (s.metalness !== undefined) m.metalness = s.metalness;
        if (s.roughness !== undefined) m.roughness = s.roughness;
        if (s.clearcoat !== undefined) m.clearcoat = s.clearcoat;
        m.transparent = s.transparent;
        m.opacity = s.opacity;
        if (s.envMapIntensity !== undefined) m.envMapIntensity = s.envMapIntensity;
      }
      wireSnap.clear();
      applyCutMaterials(cutNow);
      setRefract(refractOn);
    }
  };

  const update = (th, ops = {}) => {
    for (const m of ghosted) m.material = m.userData.mat0;
    ghosted.clear();
    const solo = ops.solo ?? -1;
    const all = solo < 0;
    const aRest = all ? 1 : 1 - Math.min(1, Math.max(0, ops.fade ?? 1));
    const ex = ops.explode ?? 0;
    const lay = (a) => smoother((ex - a) / 0.45);
    const eSump = lay(0);
    const eCrank = lay(0.12);
    const DG = 390 * lay(0.25);
    const DC = 300 * lay(0.33);
    const DH = 200 * lay(0.42);
    const DP = 110 * lay(0.55);
    const DK = 110 * eCrank;
    const DS = 160 * eSump;
    root.position.y = 0.19 * eSump;
    sumpGrp.position.y = -DS;
    rail.position.y = -68 - DS;
    const DCover = 485 * lay(0.2);
    leftCoverGrp.position.set(DCover * BANK.L.b[0], DCover * BANK.L.b[1], 0);
    rightCoverGrp.position.set(DCover * BANK.R.b[0], DCover * BANK.R.b[1], 0);

    const cAng = -th * D2R;
    crank.rotation.z = 0;
    crank.position.y = -DK;
    for (const { w, p } of webs) w.rotation.z = -(th + PIN_PHASE[p]) * D2R;
    E.pinZ.forEach((z, p) => {
      const [x, y] = pinXY(p, th);
      pins[p].position.set(x, y - DK, z);
    });
    const chargeOn = ops.charge ?? 1;
    const arrowsOn = ops.arrows ?? 1;
    const fireOn = ops.fire ?? 0;
    const rpm = ops.rpm ?? 700;
    const rpmLoad = Math.min(1, Math.max(0, (rpm - 700) / 7300));
    const load = ops.load ?? (0.12 + 0.88 * rpmLoad);
    const boostBar = ops.boostBar ?? 0;
    const audioPulse = Math.min(1, Math.max(0, ops.audioPulse ?? 0));
    const fault = ops.fault ?? 'none';
    const misfireCyl4 = fault === 'misfire';
    const knockOn = fault === 'knock';
    const overheatOn = fault === 'overheat';
    const eIntake = lay(0.45);
    const eColl = lay(0.42);
    intakeGrp.position.y = 290 * eIntake;
    timingCover.position.z = 250 + 28 * eCrank;
    bellRing.position.z = -254 - 55 * eCrank;
    const throttleFrac = Math.min(1, 0.04 + 0.92 * rpmLoad + 0.25 * boostBar);
    const openRad = 0.17 + throttleFrac * 1.33;
    butterfly.rotation.x = -openRad;
    dbwLink.rotation.x = 0.65 + (openRad - 0.17) * 0.45;
    intakeWheel.rotation.z = -th * D2R * (4.2 + 2.8 * boostBar);
    fprNeedle.rotation.z = -0.82 + Math.min(1.65, 0.22 * load + 1.05 * boostBar + 0.28 * audioPulse + 0.05 * Math.sin(th * D2R * 4));
    fuelFlowMat.uniforms.uFreq.value = 14.0 + 14.0 * rpmLoad;
    fuelFlowMat.uniforms.uFlow.value = th * D2R * (0.9 + 2.6 * rpmLoad + 1.1 * boostBar);
    fuelFlowMat.uniforms.uBeat.value = Math.max(audioPulse, rpmLoad * 0.45);
    fuelFlowMat.uniforms.uOpacity.value = Math.min(0.98, 0.42 + 0.48 * rpmLoad + 0.2 * boostBar + 0.1 * audioPulse);
    airFlowMat.uniforms.uFreq.value = 18.0 + 14.0 * rpmLoad;
    airFlowMat.uniforms.uFlow.value = th * D2R * (1.8 + 4.4 * rpmLoad + 1.8 * boostBar);
    airFlowMat.uniforms.uBeat.value = Math.max(audioPulse, 0.25 + 0.55 * rpmLoad);
    const showPlenumCharge = chargeOn > 0.01 && ex === 0 && !wireOn && cutNow !== 'solid';
    airFlowMat.uniforms.uOpacity.value = showPlenumCharge ? Math.min(0.92, 0.36 + 0.38 * rpmLoad + 0.22 * boostBar + 0.14 * audioPulse) : 0;
    for (const psMesh of plenumStreams) psMesh.visible = showPlenumCharge && all;
    dropletMesh.visible = showPlenumCharge && all;
    if (showPlenumCharge && all) {
      dropletMat.opacity = Math.min(0.96, 0.52 + 0.34 * rpmLoad + 0.2 * boostBar);
      const plenumRate = th * (0.0022 + 0.0046 * rpmLoad + 0.0022 * boostBar);
      for (let bi = 0; bi < PLENUM_BEADS; bi++) {
        const ribIdx = bi % ribbonHelixCurves.length;
        const ribObj = ribbonHelixCurves[ribIdx];
        const u = (bi / PLENUM_BEADS + plenumRate + ribObj.phase) % 1;
        ribObj.curve.getPoint(u, beadPos);
        beadDummy.position.copy(beadPos);
        const sBead = (0.75 + 0.45 * rpmLoad + 0.3 * boostBar) * (0.75 + 0.35 * Math.sin(u * Math.PI));
        beadDummy.scale.setScalar(sBead);
        beadDummy.updateMatrix();
        dropletMesh.setMatrixAt(bi, beadDummy.matrix);
      }
    }
    if (!lo && !wireOn) {
      const heat = ex === 0 ? Math.min(1, Math.max(0, (rpm - 1800) / 5800 + boostBar * 0.28 + (overheatOn ? 0.55 : 0))) : 0;
      if (heat < 0.45) exTubeMat.color.copy(EX_COL_COOL).lerp(EX_COL_WARM, heat / 0.45);
      else exTubeMat.color.copy(EX_COL_WARM).lerp(EX_COL_HOT, (heat - 0.45) / 0.55);
      exTubeMat.emissive.setHex(0xff2e06);
      exTubeMat.emissiveIntensity = heat * 0.95 * chargeOn;
    }

    CYL.forEach((cy, i) => {
      const B = BANK[cy.bank];
      const { s, P, pin } = piston(i, th);
      const pp = pist[i];
      pp.g.position.y = s + DP;
      tmpA.set(P[0], P[1], cy.z);
      tmpB.set(pin[0], pin[1], cy.z);
      tmp.subVectors(tmpB, tmpA);
      const len = tmp.length();
      pp.rod.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
      pp.rod.position.x += DP * B.b[0];
      pp.rod.position.y += DP * B.b[1];
      pp.rod.rotation.set(0, 0, Math.atan2(tmp.y, tmp.x) - Math.PI / 2);
      pp.beam.scale.y = len - 30;
      pp.big.position.y = -len / 2;
      pp.small.position.y = len / 2;

      const ps = psi(cy.c, th);
      const crown = s + E.comp;
      const col = cyl[i];
      col.head.position.y = DH;
      col.cage.position.y = DG;
      col.charge.position.y = (crown + DECK) / 2;
      col.charge.scale.y = Math.max(1, DECK - crown);
      const key = chargeOf(ps);
      const isDead = misfireCyl4 && i === 3;
      const glow = !isDead && key === 2 ? Math.min(1, pressure(ps, load, boostBar) / 48) : 0;
      const knockFlash = knockOn && !isDead && key === 2 && ps > 15 && ps < 75 ? Math.pow(Math.max(0, Math.sin((ps - 15) * 0.45)), 4) : 0;
      let sparkK = isDead ? 0 : sparkIntensity(ps);
      if (knockFlash > 0.05) sparkK = Math.max(sparkK, knockFlash * 0.95);
      let op = chargeOn * (key === 2 ? (isDead ? 0.28 : 0.36 + 0.48 * glow + 0.2 * knockFlash) : key === 0 ? 0.32 : 0.22);
      col.charge.visible = chargeOn > 0.01;
      if (fireOn > 0 && chargeOn <= 0.01 && key === 2 && !isDead) {
        op = fireOn * (0.36 + 0.48 * glow);
        col.charge.visible = true;
      }
      if (!all && i !== solo) op *= aRest;
      if (ex > 0) col.charge.visible = false;
      const effStroke = isDead && key === 2 ? 0 : key;
      const cCol = isDead && key === 2 ? CHARGE_COL_MISFIRE : CHARGE_COL[key];
      if (lo) {
        col.chargeMat.color.copy(cCol);
        if (knockFlash > 0.05) col.chargeMat.color.lerp(CHARGE_COL_KNOCK, knockFlash * 0.7);
        col.chargeMat.opacity = op;
      } else {
        col.chargeMat.uniforms.uColor.value.copy(cCol);
        if (knockFlash > 0.05) col.chargeMat.uniforms.uColor.value.lerp(CHARGE_COL_KNOCK, knockFlash * 0.75);
        col.chargeMat.uniforms.uOpacity.value = op;
        col.chargeMat.uniforms.uSpark.value = sparkK;
        col.chargeMat.uniforms.uSwirl.value = th * D2R * 1.5;
        col.chargeMat.uniforms.uStroke.value = effStroke;
        col.chargeMat.uniforms.uBeat.value = audioPulse;
      }

      // sequential port fuel injector spray pulse + intake air-charge swirl during intake valve opening
      const ip = injectorPulse(ps);
      const injObj = injectors[i];
      const showInj = ip > 0.02 && chargeOn > 0.01 && ex === 0 && (all || i === solo || aRest > 0.15);
      injObj.spray.visible = showInj;
      if (showInj) {
        const injGain = 0.35 + 0.65 * Math.max(rpmLoad, boostBar);
        injObj.sprayMat.opacity = Math.min(0.96, ip * (0.45 + 0.5 * injGain)) * (!all && i !== solo ? aRest : 1);
        injObj.spray.scale.set(0.75 + 0.55 * ip * injGain, 0.65 + 0.65 * ip * injGain, 0.75 + 0.55 * ip * injGain);
      }
      const inLift = liftIn(ps);
      const showAir = showPlenumCharge && (all || i === solo || aRest > 0.15);
      injObj.runnerSwirl.visible = showAir;
      if (showAir) {
        const surge = Math.max(inLift, ip * 0.85);
        injObj.swirlMat.uniforms.uFreq.value = 14.0 + 12.0 * rpmLoad + 6.0 * surge;
        injObj.swirlMat.uniforms.uFlow.value = th * D2R * (2.0 + 4.8 * rpmLoad + 1.8 * boostBar + 2.2 * surge);
        injObj.swirlMat.uniforms.uBeat.value = Math.max(audioPulse, rpmLoad * 0.45, surge * 0.75);
        const baseMist = 0.18 + 0.14 * rpmLoad + 0.12 * boostBar;
        const activeOp = surge > 0.04 ? Math.min(0.95, 0.38 + surge * (0.48 + 0.28 * rpmLoad + 0.22 * boostBar)) : baseMist;
        injObj.swirlMat.uniforms.uOpacity.value = activeOp * (!all && i !== solo ? aRest : 1);
      }
      if (dropletMesh.visible) {
        const runnerRate = th * (0.0028 + 0.0052 * rpmLoad + 0.0025 * boostBar + 0.003 * inLift);
        const baseIdx = PLENUM_BEADS + i * RUNNER_BEADS_EACH;
        const beadBoost = Math.max(inLift, ip);
        for (let rbi = 0; rbi < RUNNER_BEADS_EACH; rbi++) {
          const u = (rbi / RUNNER_BEADS_EACH + runnerRate + i * 0.13) % 1;
          injObj.runnerCurve.getPoint(u, beadPos);
          beadDummy.position.copy(beadPos);
          const sRunner = (0.52 + 0.78 * beadBoost + 0.25 * rpmLoad + 0.2 * boostBar) * (0.8 + 0.25 * Math.sin(u * Math.PI));
          beadDummy.scale.setScalar(sRunner);
          beadDummy.updateMatrix();
          dropletMesh.setMatrixAt(baseIdx + rbi, beadDummy.matrix);
        }
      }

      // TDC spark arc flash inside combustion dome
      const showSpark = sparkK > 0.01 && ex === 0 && (all || i === solo || aRest > 0.15);
      col.sparkArc.visible = showSpark;
      if (showSpark) {
        const sAlpha = sparkK * ((!all && i !== solo) ? aRest : 1);
        col.sparkArc.scale.setScalar(0.75 + 0.5 * sparkK);
        col.sparkArc.rotation.z = (th * 0.7) % (Math.PI * 2);
        col.sparkMat.opacity = sAlpha * 0.9;
        col.sparkCoreMat.opacity = sAlpha;
        col.sparkGlowMat.opacity = sAlpha * 0.45;
      }

      // valves + articulated roller rockers
      for (const v of col.valves) {
        const liftNorm = v.kind === 'in' ? liftIn(ps) : liftEx(ps);
        const L = liftNorm * VALVE.lift;
        v.vg.position.y = -L;
        v.spring.scale.y = (48 - L) / 48;
        if (v.rocker) v.rocker.rotation.z = -Math.sign(v.x) * rockerAngle(liftNorm);
      }

      const { s: s2 } = piston(i, th + 2);
      const vel = s2 - s;
      pp.arrow.position.y = DECK - 70;
      pp.arrow.rotation.z = vel > 0 ? 0 : Math.PI;
      pp.arrow.scale.setScalar(arrowsOn * Math.min(1, Math.abs(vel) / 1.2));
      pp.arrow.visible = arrowsOn * Math.abs(vel) > 0.05;
    });
    if (dropletMesh.visible) dropletMesh.instanceMatrix.needsUpdate = true;

    // 4-into-1 bank exhaust collector dual-layer flame plume, ember sparks & explode separation
    collectors.forEach((colObj) => {
      colObj.cg.position.set(colObj.out * (216 + 140 * eColl), -26 + 140 * eColl, -242);
      let bankExh = 0;
      for (const cy of CYL) {
        if (cy.bank === colObj.bank) bankExh = Math.max(bankExh, exhaustPulse(psi(cy.c, th)));
      }
      let backfire = 0;
      if (misfireCyl4 && colObj.bank === 'R') {
        const ps4 = psi(4, th);
        if (ps4 > 205 && ps4 < 335) backfire = Math.pow(Math.sin(((ps4 - 205) / 130) * Math.PI), 2) * 0.85;
      }
      const flameIntensity = Math.min(1, Math.max(bankExh, backfire) * (0.62 + 0.38 * load) + boostBar * 0.35 * bankExh + audioPulse * 0.34 * (0.35 + bankExh) + backfire * 0.45);
      const showExh = flameIntensity > 0.05 && chargeOn > 0.01 && ex === 0 && (all || CYL[solo].bank === colObj.bank);
      colObj.flameGrp.visible = showExh;
      if (showExh) {
        const stretch = 0.72 + 0.58 * flameIntensity + 0.25 * boostBar + 0.24 * audioPulse + backfire * 0.35;
        const rad = 0.85 + 0.28 * flameIntensity + 0.14 * audioPulse + backfire * 0.18;
        colObj.flameGrp.scale.set(rad, rad, stretch);
        const op = Math.min(0.95, 0.38 + 0.58 * flameIntensity);
        for (const m of [colObj.coreMat, colObj.outerMat]) {
          m.uniforms.uPulse.value = Math.max(bankExh, backfire);
          m.uniforms.uBeat.value = Math.max(audioPulse, backfire);
          m.uniforms.uSwirl.value = th * D2R * 2.0;
          m.uniforms.uOpacity.value = m === colObj.coreMat ? op * 0.92 : op;
        }
        const emberActive = boostBar > 0.05 || audioPulse > 0.25 || bankExh > 0.35 || backfire > 0.15;
        colObj.emberMat.opacity = emberActive ? Math.min(0.95, 0.35 + 0.55 * audioPulse + 0.35 * boostBar) : 0;
        for (const em of colObj.embers) {
          em.m.visible = emberActive;
          if (!emberActive) continue;
          const u = (em.phase + th * 0.0065) % 1;
          const rSpread = 2.5 + u * 11;
          const a = em.ang + th * D2R * 2.5;
          em.m.position.set(Math.cos(a) * rSpread, Math.sin(a) * rSpread, -10 - u * 96);
          em.m.scale.setScalar((1 - u * 0.65) * (0.7 + 0.6 * audioPulse));
        }
      }
    });

    for (const c of cams) {
      const B = BANK[c.bank];
      c.g.position.set((DECK + 112 + DC) * B.b[0], (DECK + 112 + DC) * B.b[1], 0);
      c.g.rotation.z = cAng / 2;
    }
    crankGear.rotation.z = cAng;
    crankGear.position.set(0, -DK, front + 45 * eCrank);
    camGears.forEach(({ cg, bank }) => {
      const B = BANK[bank];
      cg.rotation.z = cAng / 2;
      cg.position.set((DECK + 112 + DC) * B.b[0], (DECK + 112 + DC) * B.b[1], front + 45 * eCrank);
    });
    idlers.forEach(({ gg, bank, c0 }) => {
      const B = BANK[bank];
      gg.rotation.z = c0 - cAng * (24 / 72);
      gg.position.set(150.222 * B.b[0], 150.222 * B.b[1], front + 45 * eCrank);
    });
    damperGrp.rotation.z = cAng;
    damperGrp.position.set(0, -DK, serpZ + 90 * eCrank);
    waterPumpGrp.position.set(0, -DK, 90 * eCrank);
    waterPumpGrp.pulley.rotation.z = cAng * 1.25;
    if (waterPumpGrp.impeller) waterPumpGrp.impeller.rotation.z = cAng * 1.25;
    if (waterPumpGrp.coolantMat?.uniforms) {
      waterPumpGrp.coolantMat.uniforms.uTime.value = th * D2R * 1.5;
      waterPumpGrp.coolantMat.uniforms.uFlow.value = 0.5 + 0.35 * load + 0.2 * boostBar;
      if (waterPumpGrp.coolantMat.uniforms.uOverheat) waterPumpGrp.coolantMat.uniforms.uOverheat.value = overheatOn ? 1 : 0;
    }
    if (sumpGrp.oilWave) {
      sumpGrp.oilWave.rotation.x = Math.sin(th * D2R * 2) * 0.014;
      sumpGrp.oilWave.rotation.z = Math.cos(th * D2R * 1.5) * 0.01;
    }
    altGrp.position.set(148 + 40 * eCrank, -10 - DK, serpZ + 90 * eCrank);
    altGrp.pulley.rotation.z = cAng * 2.6;
    if (altGrp.rotor) altGrp.rotor.rotation.z = cAng * 2.6;
    psPulleyGrp.position.set(-108 - 40 * eCrank, 26 - DK, serpZ - 2 + 90 * eCrank);
    psPulleyGrp.pulley.rotation.z = -cAng * (74 / 34);
    if (tensionerGrp) {
      const bp = tensionerGrp.userData.basePos;
      if (bp) tensionerGrp.position.set(bp.x + 22 * eCrank, bp.y - DK, bp.z + 90 * eCrank);
      if (tensionerGrp.pulley) tensionerGrp.pulley.rotation.z = cAng * (74 / 22);
    }
    if (acCompressorGrp) {
      const bp = acCompressorGrp.userData.basePos;
      if (bp) acCompressorGrp.position.set(bp.x + 48 * eCrank, bp.y - DK, bp.z + 90 * eCrank);
      if (acCompressorGrp.pulley) acCompressorGrp.pulley.rotation.z = cAng * (74 / 32);
    }
    if (thermostatGrp) {
      const bp = thermostatGrp.userData.basePos;
      if (bp) thermostatGrp.position.set(bp.x, bp.y + 28 * eCrank, bp.z + 18 * eCrank);
    }
    if (sparkLeadsGrp) {
      const bp = sparkLeadsGrp.userData.basePos;
      if (bp) sparkLeadsGrp.position.set(bp.x, bp.y + 52 * eIntake, bp.z);
    }
    if (harnessGrp) {
      const bp = harnessGrp.userData.basePos;
      if (bp) harnessGrp.position.set(bp.x, bp.y + 78 * eIntake, bp.z);
    }
    serpGrp.position.set(0, -DK, 90 * eCrank);
    flywheel.rotation.z = cAng;
    flywheel.position.set(0, -DK, -290 - 90 * eCrank);
    arcs.rotation.z = cAng * 0.25;
    arcs.position.set(0, -DK, front + 90 + 90 * eCrank);

    block.visible = all;
    intakeGrp.visible = all;
    serpGrp.visible = all;
    coversGrp.visible = all;
    collectors.forEach((colObj) => {
      colObj.cg.visible = all || CYL[solo].bank === colObj.bank;
    });
    const accRest = [tensionerGrp, acCompressorGrp, thermostatGrp].filter(Boolean);
    for (const g of [crankGear, damperGrp, waterPumpGrp, altGrp, psPulleyGrp, ...accRest, flywheel, timingCover, bellRing, arcs, ...idlers.map((x) => x.gg), ...camGears.map((x) => x.cg)]) g.visible = all;
    cyl.forEach((c, i) => {
      const on = all || i === solo;
      c.g.visible = on;
      pist[i].rod.visible = on;
    });
    for (const c of cams) c.g.visible = all || CYL[solo].bank === c.bank;
    const soloPin = all ? -1 : CYL[solo].pin;
    for (const { w, p } of webs) w.visible = all || p === soloPin;
    pins.forEach((m, p) => (m.visible = all || p === soloPin));
    for (const j of journals) j.visible = all;
    arcs.visible = all && (ops.arrows ?? 1) > 0.01;
    if (xrayOn && !wireOn) {
      for (const m of xrayMeshes) {
        m.material = xrayMat;
        ghosted.add(m);
      }
    }
    if (!all && aRest > 0.001) {
      const rest = [block, intakeGrp, serpGrp, coversGrp, timingCover, bellRing, crankGear, damperGrp, waterPumpGrp, altGrp, psPulleyGrp, ...accRest, flywheel, ...idlers.map((x) => x.gg), ...camGears.map((x) => x.cg), ...journals];
      collectors.forEach((colObj) => CYL[solo].bank !== colObj.bank && rest.push(colObj.cg));
      cyl.forEach((c, i) => i !== solo && rest.push(c.g, pist[i].rod));
      for (const c of cams) if (CYL[solo].bank !== c.bank) rest.push(c.g);
      for (const { w, p } of webs) if (p !== soloPin) rest.push(w);
      pins.forEach((m, p) => p !== soloPin && rest.push(m));
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
  return { root, update, M, cyl, pist, cams, crank, damperGrp, waterPumpGrp, altGrp, psPulleyGrp, ...(tensionerGrp ? { tensionerGrp } : {}), ...(acCompressorGrp ? { acCompressorGrp } : {}), ...(thermostatGrp ? { thermostatGrp } : {}), ...(sparkLeadsGrp ? { sparkLeadsGrp } : {}), ...(harnessGrp ? { harnessGrp } : {}), coversGrp, flywheel, timingCover, bellRing, crankGear, camGears, idlers, intakeGrp, collectors, serpGrp, setCut, setRefract, setXray, setWireframe, isWireframe: () => wireOn, CLIP, cap };
}
