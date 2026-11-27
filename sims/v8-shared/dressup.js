// Museum-grade LS/crate dress-up hardware for the Shattercraft V8: sculpted stepped finned cast-aluminum oil sump
// with oil sight glass & slosh bar, cobalt-blue spin-on oil filter & AN-10 cooler lines, yellow-ring dipstick,
// 6 pressed brass freeze plugs, gear-reduction starter motor, ATI-style harmonic damper, centrifugal water pump
// with impeller sight-port & animated coolant flow, vented alternator with spinning rotor, open 5-spoke PS pulley,
// and finned hybrid windowed/solid valve covers.
import * as THREE from 'three';

const V3 = THREE.Vector3;

function roundedRectShape(w, h, r) {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.min(r, hw, hh);
  const sh = new THREE.Shape();
  sh.moveTo(-hw + rr, -hh);
  sh.lineTo(hw - rr, -hh);
  sh.quadraticCurveTo(hw, -hh, hw, -hh + rr);
  sh.lineTo(hw, hh - rr);
  sh.quadraticCurveTo(hw, hh, hw - rr, hh);
  sh.lineTo(-hw + rr, hh);
  sh.quadraticCurveTo(-hw, hh, -hw, hh - rr);
  sh.lineTo(-hw, -hh + rr);
  sh.quadraticCurveTo(-hw, -hh, -hw + rr, -hh);
  sh.closePath();
  return sh;
}

function roundedRectPath(w, h, r) {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.min(r, hw, hh);
  const p = new THREE.Path();
  p.moveTo(-hw + rr, -hh);
  p.quadraticCurveTo(-hw, -hh, -hw, -hh + rr);
  p.lineTo(-hw, hh - rr);
  p.quadraticCurveTo(-hw, hh, -hw + rr, hh);
  p.lineTo(hw - rr, hh);
  p.quadraticCurveTo(hw, hh, hw, hh - rr);
  p.lineTo(hw, -hh + rr);
  p.quadraticCurveTo(hw, -hh, hw - rr, -hh);
  p.closePath();
  return p;
}

function makeRimGeo(rOut, rIn, width, seg = 36) {
  const sh = new THREE.Shape();
  sh.absarc(0, 0, rOut, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, rIn, 0, Math.PI * 2, true);
  sh.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(sh, {
    depth: width,
    bevelEnabled: false,
    curveSegments: seg,
  });
  geo.translate(0, 0, -width / 2);
  return geo;
}

function makeHollowFrameGeo(wOut, hOut, rOut, wIn, hIn, rIn, depth, seg = 12, bevel = 1.4) {
  const sh = roundedRectShape(wOut, hOut, rOut);
  sh.holes.push(roundedRectPath(wIn, hIn, rIn));
  const geo = new THREE.ExtrudeGeometry(sh, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: seg,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function makeSpokedPulleyGeo(rOuter, rHub, spokes, width, spokeHalfAngle, seg = 36, rBore = 8) {
  const sh = new THREE.Shape();
  sh.absarc(0, 0, rOuter, 0, Math.PI * 2, false);
  const rInner = rOuter - 5.5;
  const step = (Math.PI * 2) / spokes;
  for (let i = 0; i < spokes; i++) {
    const a0 = i * step + spokeHalfAngle;
    const a1 = (i + 1) * step - spokeHalfAngle;
    if (a1 <= a0 + 0.08) continue;
    const hole = new THREE.Path();
    hole.moveTo(Math.cos(a0) * rHub, Math.sin(a0) * rHub);
    hole.absarc(0, 0, rInner, a0, a1, false);
    hole.lineTo(Math.cos(a1) * rHub, Math.sin(a1) * rHub);
    hole.absarc(0, 0, rHub, a1, a0, true);
    hole.closePath();
    sh.holes.push(hole);
  }
  const bore = new THREE.Path();
  bore.absarc(0, 0, rBore, 0, Math.PI * 2, true);
  sh.holes.push(bore);
  const geo = new THREE.ExtrudeGeometry(sh, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.9,
    bevelSize: 0.8,
    bevelSegments: 1,
    curveSegments: seg,
  });
  geo.translate(0, 0, -width / 2);
  return geo;
}

/** GLSL flowing coolant pulse material (ANGLE/D3D11 safe + section clipping aware + uOverheat tint). */
function makeCoolantFlowMaterial(lo = false) {
  if (lo) {
    return new THREE.MeshBasicMaterial({color: '#14d8c4', transparent: true, opacity: 0.72, depthWrite: false});
  }
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clipping: true,
    uniforms: {
      uTime: {value: 0},
      uFlow: {value: 1},
      uOverheat: {value: 0},
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
      uniform float uTime;
      uniform float uFlow;
      uniform float uOverheat;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewPos;
      void main() {
        #include <clipping_planes_fragment>
        vec3 n = normalize(vNormalV);
        vec3 v = normalize(vViewPos);
        float fresnel = pow(max(1.0 - abs(dot(n, v)), 0.0001), 1.4);
        float wave = 0.5 + 0.5 * sin(vUv.x * 26.0 - uTime * (7.5 + 5.0 * uOverheat) + sin(vUv.y * 12.566) * 0.6);
        float pulse = pow(max(wave, 0.0001), 2.2) * clamp(uFlow, 0.25, 2.0);
        float oh = clamp(uOverheat, 0.0, 1.0);
        vec3 baseCol = mix(vec3(0.0, 0.659, 0.588), vec3(1.0, 0.290, 0.078), oh);
        vec3 pulseCore = mix(vec3(0.722, 1.0, 0.957), vec3(1.0, 0.824, 0.502), oh);
        vec3 col = mix(baseCol, pulseCore, clamp(pulse * 0.82 + fresnel * 0.35, 0.0, 1.0));
        float alpha = clamp(0.48 + 0.34 * pulse + 0.16 * fresnel, 0.0, 0.94);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

/** Create custom dress-up materials matching hi-tier Physical/Standard and lo-tier Lambert builds. */
export function createDressupMaterials(M, lo = false) {
  const filterBlue = lo
    ? new THREE.MeshLambertMaterial({color: '#1456c8', flatShading: true})
    : new THREE.MeshPhysicalMaterial({color: '#1456c8', roughness: 0.24, metalness: 0.18, clearcoat: 0.65, clearcoatRoughness: 0.14});
  const dipstickYellow = lo
    ? new THREE.MeshLambertMaterial({color: '#f2c118', flatShading: true})
    : new THREE.MeshPhysicalMaterial({color: '#f2c118', roughness: 0.34, metalness: 0.05, clearcoat: 0.45, clearcoatRoughness: 0.2});
  const copperWinding = lo
    ? new THREE.MeshLambertMaterial({color: '#9c4c24', flatShading: true})
    : new THREE.MeshStandardMaterial({color: '#9c4c24', roughness: 0.38, metalness: 0.88});
  const rawTitanium = lo
    ? new THREE.MeshLambertMaterial({color: '#c2bbb0', flatShading: true})
    : new THREE.MeshStandardMaterial({color: '#c2bbb0', roughness: 0.24, metalness: 0.86});
  const tigWeld = lo
    ? new THREE.MeshLambertMaterial({color: '#9a9184', flatShading: true})
    : new THREE.MeshStandardMaterial({color: '#9a9184', roughness: 0.34, metalness: 0.84});
  const coralHub = lo
    ? new THREE.MeshLambertMaterial({color: '#f26a3d', flatShading: true})
    : new THREE.MeshPhysicalMaterial({color: '#f26a3d', roughness: 0.28, metalness: 0.35, clearcoat: 0.45, clearcoatRoughness: 0.2});
  const coverComposite = lo
    ? new THREE.MeshLambertMaterial({color: '#262220', flatShading: true})
    : new THREE.MeshStandardMaterial({color: '#262220', roughness: 0.42, metalness: 0.16});
  const billetTitanium = lo
    ? new THREE.MeshLambertMaterial({color: '#4b525c', flatShading: true})
    : new THREE.MeshStandardMaterial({color: '#4b525c', roughness: 0.24, metalness: 0.9});
  const satinAlloy = lo
    ? new THREE.MeshLambertMaterial({color: '#9aa1ab', flatShading: true})
    : new THREE.MeshStandardMaterial({color: '#9aa1ab', roughness: 0.24, metalness: 0.9});
  const materials = [filterBlue, dipstickYellow, copperWinding, rawTitanium, tigWeld, coralHub, coverComposite, billetTitanium, satinAlloy];
  return {filterBlue, dipstickYellow, copperWinding, rawTitanium, tigWeld, coralHub, coverComposite, billetTitanium, satinAlloy, materials};
}

/** Build stepped finned cast-aluminum oil pan sump + sight glass + lower-block dress-up (filter, AN-10 lines, dipstick, freeze plugs, starter, spark leads, EVAP harness, lifting hooks). */
export function buildSumpAndBlockDressup({M, DM, add, tag, ignore, N, plain, BANK, DECK = 226, CYL}) {
  const sumpGrp = new THREE.Group();
  tag(
    sumpGrp,
    {
      name: 'Finned Cast-Alloy Oil Sump',
      subsystem: 'Lubrication · Lower End',
      material: 'Die-Cast A356 Aluminum / 16-Bolt Rail',
      spec: 'Stepped shallow-front / deep-rear wet sump (−220..+245 mm Z) with cooling fins',
    },
    [0, -190, 0],
  );

  // Upper pan-rail flange (-220..+245 Z, flush under lower block skirt rail at y = -74)
  const panFlange = add(sumpGrp, new THREE.BoxGeometry(224, 8, 465), M.alu);
  panFlange.position.set(0, -76, 12.5);

  // Shallow front sump section (z = +40..+245, center +142.5, bottom at y = -104)
  const shallowBody = add(sumpGrp, new THREE.BoxGeometry(198, 26, 205), M.alu);
  shallowBody.position.set(0, -91, 142.5);
  for (let rx = -72; rx <= 72; rx += 24) {
    const fin = add(sumpGrp, new THREE.BoxGeometry(4, 4, 192), M.alu);
    fin.position.set(rx, -106, 142.5);
  }

  // Deep rear sump section (z = -220..+40, center -90, bottom at y = -131, fins down to -135.5 > FLOOR_Y -140)
  const deepUpper = add(sumpGrp, new THREE.BoxGeometry(202, 24, 260), M.alu);
  deepUpper.position.set(0, -90, -90);
  const deepLower = add(sumpGrp, new THREE.BoxGeometry(186, 30, 250), M.alu);
  deepLower.position.set(0, -116, -90);

  // Stepped transition gusset between shallow front and deep rear
  const stepRamp = add(sumpGrp, new THREE.BoxGeometry(186, 28, 24), M.alu);
  stepRamp.position.set(0, -113, 40);
  stepRamp.rotation.x = 0.42;

  // Longitudinal cooling fins under deep sump & side stiffening ribs (skip +x z=-90 for sight window bay)
  for (let rx = -66; rx <= 66; rx += 22) {
    const fin = add(sumpGrp, new THREE.BoxGeometry(4, 5, 238), M.alu);
    fin.position.set(rx, -133, -90);
  }
  if (!plain) {
    for (const sgn of [-1, 1]) {
      const zRibs = sgn > 0 ? [-190, -144, -36, 10] : [-190, -140, -90, -40, 10];
      for (const rz of zRibs) {
        const sideRib = add(sumpGrp, new THREE.BoxGeometry(5, 34, 6), M.alu);
        sideRib.position.set(sgn * 95, -106, rz);
      }
    }
  }

  // Bolted oil level sight-glass port on lower-left (+x) deep sump wall with dark gunmetal backing
  const sightGrp = new THREE.Group();
  sightGrp.position.set(93, -114, -90);
  sumpGrp.add(sightGrp);
  tag(sightGrp, {
    name: 'Oil Sump Sight Glass & Level',
    subsystem: 'Lubrication · Lower End',
    material: 'Borosilicate Sight Window / 6-Bolt Billet Bezel',
    spec: 'Machined oil level inspection port with dark gunmetal gauge backing',
  });
  const sightBack = add(sightGrp, new THREE.BoxGeometry(4, 18, 54), M.gunmetal);
  sightBack.position.x = -1;
  for (const tz of [-16, 0, 16]) {
    const tick = add(sightGrp, new THREE.BoxGeometry(1.5, 1.8, 6), M.steel);
    tick.position.set(1.2, 0, tz);
  }
  const sightBezelGeo = makeHollowFrameGeo(68, 26, 9, 52, 14, 6, 4, N(8), plain ? 0 : 0.7);
  sightBezelGeo.rotateZ(-Math.PI / 2);
  sightBezelGeo.rotateX(Math.PI / 2);
  const sightBezel = add(sightGrp, sightBezelGeo, M.alu);
  sightBezel.position.x = 0.5;
  for (const bz of [-28, 0, 28]) {
    for (const by of [-9, 9]) {
      const sbolt = add(sightGrp, new THREE.CylinderGeometry(1.8, 1.8, 4, 6), M.steel);
      sbolt.rotation.z = Math.PI / 2;
      sbolt.position.set(5, by, bz);
    }
  }
  const sightGlassGeo = new THREE.ExtrudeGeometry(roundedRectShape(52, 14, 6), {depth: 2.2, bevelEnabled: false, curveSegments: N(8)});
  sightGlassGeo.rotateY(Math.PI / 2);
  const sightGlass = add(sightGrp, sightGlassGeo, M.glass, false);
  sightGlass.position.x = 3.2;
  sightGlass.renderOrder = 4;

  // Internal CNC windage tray baffle + stainless steel oil pickup tube & circular Gerotor strainer screen
  const pickupGrp = new THREE.Group();
  sumpGrp.add(pickupGrp);
  tag(pickupGrp, {
    name: 'Oil Pickup Tube & Windage Baffle',
    subsystem: 'Lubrication · Lower End',
    material: '304 Stainless Tube / Louvered Windage Tray / Gerotor Screen',
    spec: 'Deep-sump Ø64 mm strainer bell (−126 mm) + crank scraper baffle tray',
  });
  for (const sgn of [-1, 1]) {
    const trayRail = add(pickupGrp, new THREE.BoxGeometry(12, 3.5, 348), M.gunmetal);
    trayRail.position.set(sgn * 74, -88, -10);
    for (const sz of [-160, 140]) {
      const standoff = add(pickupGrp, new THREE.CylinderGeometry(3.2, 3.2, 10, 6), M.alu);
      standoff.position.set(sgn * 74, -83, sz);
    }
  }
  for (let lz = -158; lz <= 130; lz += 48) {
    const louver = add(pickupGrp, new THREE.BoxGeometry(138, 2.5, 22), M.gunmetal);
    louver.position.set(0, -89, lz);
    louver.rotation.x = 0.26;
  }
  const pickupFlange = add(pickupGrp, new THREE.BoxGeometry(34, 14, 16), M.alu);
  pickupFlange.position.set(0, -83, 195);
  for (const fx of [-11, 11]) {
    const fbolt = add(pickupGrp, new THREE.CylinderGeometry(2.5, 2.5, 10, 6), M.steel);
    fbolt.position.set(fx, -86, 195);
  }
  const pickupPts = [
    new V3(0, -85, 195),
    new V3(0, -96, 145),
    new V3(-12, -101, 55),
    new V3(-8, -110, -45),
    new V3(0, -117, -126),
  ];
  add(pickupGrp, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pickupPts), N(24), 8.2, N(14), false), M.steel);
  const pickupBrace = add(pickupGrp, new THREE.BoxGeometry(6, 16, 10), M.steel);
  pickupBrace.position.set(-10, -95, 20);
  const strainerBell = add(pickupGrp, new THREE.CylinderGeometry(10, 32, 13, N(24)), M.gunmetal);
  strainerBell.position.set(0, -120, -138);
  const strainerRim = add(pickupGrp, new THREE.TorusGeometry(32, 2.2, N(8), N(24)), M.steel);
  strainerRim.rotation.x = Math.PI / 2;
  strainerRim.position.set(0, -126.5, -138);
  const strainerMesh = add(pickupGrp, new THREE.CylinderGeometry(30, 30, 2, N(24)), M.steel);
  strainerMesh.position.set(0, -126, -138);
  for (const ang of [0, Math.PI / 2]) {
    const cross = add(pickupGrp, new THREE.BoxGeometry(58, 3, 3.5), M.gunmetal);
    cross.position.set(0, -126.8, -138);
    cross.rotation.y = ang;
  }

  sumpGrp.pickupGrp = pickupGrp;
  sumpGrp.oilWave = null;
  sumpGrp.oilMat = null;

  // Hex pan-rail perimeter flange bolts
  for (const sgn of [-1, 1]) {
    for (const bz of [-206, -148, -90, -32, 26, 84, 142, 200, 236]) {
      const bolt = add(sumpGrp, new THREE.CylinderGeometry(3.2, 3.2, 6, 6), M.steel);
      bolt.position.set(sgn * 106, -81.5, bz);
    }
  }

  // Rear magnetic bronze/steel drain plug boss & plug + Deutsch oil-level sensor plug (kept above FLOOR_Y = -140)
  const drainBoss = add(sumpGrp, new THREE.CylinderGeometry(11, 12, 10, N(16)), M.alu);
  drainBoss.rotation.x = Math.PI / 2;
  drainBoss.position.set(0, -122, -218);
  const drainWasher = add(sumpGrp, new THREE.CylinderGeometry(9, 9, 2.5, N(16)), M.steel);
  drainWasher.rotation.x = Math.PI / 2;
  drainWasher.position.set(0, -122, -224);
  const drainPlug = add(sumpGrp, new THREE.CylinderGeometry(7, 7, 7, 6), M.bronze);
  drainPlug.rotation.x = Math.PI / 2;
  drainPlug.position.set(0, -122, -228);
  tag(drainPlug, {
    name: 'Magnetic Sump Drain Plug',
    subsystem: 'Lubrication · Lower End',
    material: 'Machined Silicon Bronze / Crush Washer',
    spec: 'M14 × 1.5 hex magnetic drain plug',
  });

  // Deutsch 2-pin oil-level / temp sensor plug on front-left shallow sump wall
  const oilSens = new THREE.Group();
  oilSens.position.set(101, -93, 146);
  sumpGrp.add(oilSens);
  tag(oilSens, {
    name: 'Sump Oil-Level Deutsch Sensor',
    subsystem: 'Lubrication · Telemetry',
    material: 'Brass Hex Boss / Deutsch DT-2 Plug',
    spec: 'Optical/thermal crankcase oil level & temperature sender',
  });
  add(oilSens, new THREE.CylinderGeometry(6, 6, 8, 6), M.bronze).rotation.z = Math.PI / 2;
  add(oilSens, new THREE.BoxGeometry(14, 10, 12), M.blackMatte).position.x = 8;
  add(oilSens, new THREE.BoxGeometry(4, 5, 8), DM.dipstickYellow).position.x = 13;

  // Block-mounted dress-up group (oil filter, AN-10 cooler lines, dipstick, freeze plugs, starter motor)
  const blockDressGrp = new THREE.Group();

  // 1. Cast oil filter adapter boss + ribbed vibrant cobalt-blue spin-on canister (lower-left block side, +x)
  const filterGrp = new THREE.Group();
  filterGrp.position.set(136, -60, 72);
  blockDressGrp.add(filterGrp);
  tag(
    filterGrp,
    {
      name: 'Oil Filter & Bypass Adapter',
      subsystem: 'Lubrication · Full-Flow Filtration',
      material: 'Cast Aluminum Boss / Cobalt-Blue Steel Canister',
      spec: 'Spin-on Ø62 × 70 mm canister + 1.4 bar internal bypass',
    },
    [140, -60, 0],
  );
  const adapterBody = add(filterGrp, new THREE.BoxGeometry(36, 22, 46), M.alu);
  adapterBody.position.set(-14, 4, 0);
  for (const az of [-16, 16]) {
    const abolt = add(filterGrp, new THREE.CylinderGeometry(3.5, 3.5, 16, 6), M.steel);
    abolt.rotation.z = Math.PI / 2;
    abolt.position.set(-22, 6, az);
  }
  const bypassPlug = add(filterGrp, new THREE.CylinderGeometry(5.5, 5.5, 8, 6), M.bronze);
  bypassPlug.rotation.x = Math.PI / 2;
  bypassPlug.position.set(-6, 4, 24);
  const filterPad = add(filterGrp, new THREE.CylinderGeometry(33, 34, 8, N(24)), M.alu);
  filterPad.position.set(4, 2, 0);
  const gasketLip = add(filterGrp, new THREE.TorusGeometry(31, 2.2, N(8), N(28)), M.steel);
  gasketLip.rotation.x = Math.PI / 2;
  gasketLip.position.set(4, -3, 0);
  const canister = add(filterGrp, new THREE.CylinderGeometry(30.5, 30.5, 66, N(28)), DM.filterBlue);
  canister.position.set(4, -36, 0);
  const canisterDome = add(filterGrp, new THREE.CylinderGeometry(29.5, 26, 5, N(28)), DM.filterBlue);
  canisterDome.position.set(4, -71, 0);
  if (!plain) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const flute = add(filterGrp, new THREE.BoxGeometry(3, 56, 3.2), DM.filterBlue);
      flute.position.set(4 + Math.cos(a) * 30.2, -35, Math.sin(a) * 30.2);
      flute.rotation.y = -a;
    }
  }

  // 1b. Braided stainless + red/blue anodized AN-10 oil cooler feed & return hoses
  const oilLinesGrp = new THREE.Group();
  blockDressGrp.add(oilLinesGrp);
  tag(
    oilLinesGrp,
    {
      name: 'Oil Cooler AN-10 Lines',
      subsystem: 'Lubrication · External Cooler Loop',
      material: 'Braided 304 Stainless / Anodized AN-10 Fittings',
      spec: 'Dual −10 AN feed & return hoses routing from filter boss to block gallery',
    },
    [140, -40, 0],
  );
  const addAn10Fitting = (pos, rotZ, rotY, hexMat, nutMat) => {
    const fg = new THREE.Group();
    fg.position.copy(pos);
    fg.rotation.z = rotZ;
    fg.rotation.y = rotY;
    oilLinesGrp.add(fg);
    add(fg, new THREE.CylinderGeometry(7.2, 7.2, 10, 6), hexMat);
    add(fg, new THREE.CylinderGeometry(6.4, 6.4, 8, 6), nutMat).position.y = 8;
  };
  const feedPts = [new V3(128, -54, 94), new V3(154, -46, 106), new V3(136, -46, 118), new V3(110, -48, 116)];
  const retPts = [new V3(128, -54, 50), new V3(154, -46, 42), new V3(134, -46, 36), new V3(110, -48, 40)];
  add(oilLinesGrp, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(feedPts), N(18), 4.6, N(10), false), M.steel);
  add(oilLinesGrp, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(retPts), N(18), 4.6, N(10), false), M.steel);
  addAn10Fitting(new V3(128, -54, 94), -Math.PI / 2, 0.3, M.crimson, DM.filterBlue);
  addAn10Fitting(new V3(110, -48, 116), Math.PI / 2, 0, DM.filterBlue, M.crimson);
  addAn10Fitting(new V3(128, -54, 50), -Math.PI / 2, -0.3, DM.filterBlue, M.crimson);
  addAn10Fitting(new V3(110, -48, 40), Math.PI / 2, 0, M.crimson, DM.filterBlue);

  // 2. Curved black steel dipstick guide tube rising between exhaust primaries on Left bank + yellow pull-handle
  const dipstickGrp = new THREE.Group();
  blockDressGrp.add(dipstickGrp);
  tag(
    dipstickGrp,
    {
      name: 'Dipstick & Oil Level Tube',
      subsystem: 'Lubrication · Level Gauge',
      material: 'Formed Steel Tube / Hi-Vis Nylon Pull Ring',
      spec: 'Swept guide tube clearing Cyl 3/5 primaries with yellow T-loop',
    },
    [160, 40, 0],
  );
  const dipPts = [
    new V3(112, -62, 15),
    new V3(148, -14, 16),
    new V3(236, 70, 22),
    new V3(282, 148, 30),
    new V3(300, 208, 34),
  ];
  add(dipstickGrp, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(dipPts), N(28), 3.6, N(10), false), M.blackMatte);
  const tubeFerrule = add(dipstickGrp, new THREE.CylinderGeometry(5.5, 5.5, 10, N(12)), M.steel);
  tubeFerrule.position.set(112, -62, 15);
  tubeFerrule.rotation.z = -0.5;
  const tubeBracket = add(dipstickGrp, new THREE.BoxGeometry(24, 6, 10), M.steel);
  tubeBracket.position.set(272, 146, 30);
  tubeBracket.rotation.z = -0.25;
  const dipCollar = add(dipstickGrp, new THREE.CylinderGeometry(5.8, 4.8, 14, N(12)), DM.dipstickYellow);
  dipCollar.position.set(300, 214, 34);
  const dipRing = add(dipstickGrp, new THREE.TorusGeometry(12.5, 3.2, N(10), N(24)), DM.dipstickYellow);
  dipRing.position.set(300, 232, 34);
  dipRing.rotation.y = 0.45;

  // 3. Lower block side water-jacket rails + 6 pressed brass core/freeze plugs (3 per bank)
  const freezeGrp = new THREE.Group();
  blockDressGrp.add(freezeGrp);
  tag(freezeGrp, {
    name: 'Freeze Plugs',
    subsystem: 'Engine Block · Coolant Jacket',
    material: 'Pressed Cartridge Brass (C260)',
    spec: '6 × Ø33 mm recessed expansion core plugs (3 per bank)',
  });
  for (const sgn of [-1, 1]) {
    const skirtLedge = add(freezeGrp, new THREE.BoxGeometry(14, 24, 460), M.alu);
    skirtLedge.position.set(sgn * 102, -52, 0);
    for (const fz of [165, -25, -145]) {
      const boss = add(freezeGrp, new THREE.CylinderGeometry(20, 21, 10, N(20)), M.alu);
      boss.rotation.z = Math.PI / 2;
      boss.position.set(sgn * 107, -46, fz);
      const brassRim = add(freezeGrp, new THREE.TorusGeometry(14.5, 2.5, N(8), N(20)), M.bronze);
      brassRim.rotation.y = Math.PI / 2;
      brassRim.position.set(sgn * 112.5, -46, fz);
      const brassDish = add(freezeGrp, new THREE.CylinderGeometry(13.5, 13.5, 4, N(20)), M.bronze);
      brassDish.rotation.z = Math.PI / 2;
      brassDish.position.set(sgn * 110.5, -46, fz);
    }
  }

  // 4. Rear lower-right high-torque PMGR starter motor assembly (z = -200..-286, clears R collector)
  const starterGrp = new THREE.Group();
  starterGrp.position.set(-148, -82, -234);
  blockDressGrp.add(starterGrp);
  tag(
    starterGrp,
    {
      name: 'High-Torque Starter Motor',
      subsystem: 'Starting · Gear Reduction',
      material: 'Brushed 6061 Nose Cone / Black Barrel / Copper Stud',
      spec: '1.8 kW PMGR starter (z = −200..−286 mm) with piggyback solenoid',
    },
    [-140, -50, -90],
  );
  add(starterGrp, new THREE.CylinderGeometry(32, 32, 64, N(24)), M.blackMatte).rotation.x = Math.PI / 2;
  const endCap = add(starterGrp, new THREE.CylinderGeometry(31, 31, 8, N(20)), M.alu);
  endCap.rotation.x = Math.PI / 2;
  endCap.position.z = 35;
  for (const ang of [0.8, 3.9]) {
    const tbolt = add(starterGrp, new THREE.CylinderGeometry(2.5, 2.5, 74, 6), M.steel);
    tbolt.rotation.x = Math.PI / 2;
    tbolt.position.set(Math.cos(ang) * 28, Math.sin(ang) * 28, 2);
  }
  const noseFlange = add(starterGrp, new THREE.CylinderGeometry(36, 36, 12, N(24)), M.alu);
  noseFlange.rotation.x = Math.PI / 2;
  noseFlange.position.z = -36;
  const mountEar = add(starterGrp, new THREE.BoxGeometry(36, 22, 12), M.alu);
  mountEar.position.set(22, 8, -36);
  for (const my of [2, 14]) {
    const mbolt = add(starterGrp, new THREE.CylinderGeometry(3.2, 3.2, 18, 6), M.steel);
    mbolt.rotation.x = Math.PI / 2;
    mbolt.position.set(32, my, -36);
  }
  const noseCone = add(starterGrp, new THREE.CylinderGeometry(18, 28, 16, N(18), 1, false, 0, Math.PI * 1.45), M.alu);
  noseCone.rotation.x = Math.PI / 2;
  noseCone.rotation.z = -0.6;
  noseCone.position.set(0, 0, -48);
  const pinion = add(starterGrp, new THREE.CylinderGeometry(12.5, 12.5, 14, N(14)), M.steel);
  pinion.rotation.x = Math.PI / 2;
  pinion.position.set(0, 0, -50);

  const solBridge = add(starterGrp, new THREE.BoxGeometry(34, 16, 24), M.alu);
  solBridge.position.set(-22, -4, -10);
  const solenoid = add(starterGrp, new THREE.CylinderGeometry(17.5, 17.5, 50, N(20)), M.blackMatte);
  solenoid.rotation.x = Math.PI / 2;
  solenoid.position.set(-46, -6, -4);
  const solCap = add(starterGrp, new THREE.CylinderGeometry(17.5, 17.5, 8, N(18)), M.alu);
  solCap.rotation.x = Math.PI / 2;
  solCap.position.set(-46, -6, 25);
  const termStud = add(starterGrp, new THREE.CylinderGeometry(4.2, 4.2, 14, N(10)), M.bronze);
  termStud.rotation.x = Math.PI / 2;
  termStud.position.set(-46, -2, 34);
  const termBoot = add(starterGrp, new THREE.CylinderGeometry(6.2, 6.2, 7, N(12)), M.crimson);
  termBoot.rotation.x = Math.PI / 2;
  termBoot.position.set(-46, -2, 31);
  const copperStrap = add(starterGrp, new THREE.BoxGeometry(34, 5, 8), M.bronze);
  copperStrap.position.set(-24, -4, 29);

  // 5. 8 Molded spark plug wire boot leads + ceramic spark plugs seated in head between exhaust primaries
  const S = Math.SQRT1_2;
  const bankFrames = BANK || {L: {b: [S, S], p: [S, -S]}, R: {b: [-S, S], p: [-S, -S]}};
  const cylList = CYL || [1, 2, 3, 4, 5, 6, 7, 8].map((c) => {
    const odd = c % 2 === 1;
    const pin = Math.floor((c - 1) / 2);
    return {c, bank: odd ? 'L' : 'R', z: [168, 56, -56, -168][pin] + (odd ? 11 : -11)};
  });
  const sparkLeadsGrp = new THREE.Group();
  blockDressGrp.add(sparkLeadsGrp);
  tag(
    sparkLeadsGrp,
    {
      name: 'Spark Plug & Ignition Lead',
      subsystem: 'Ignition · High-Tension Leads',
      material: 'Silicone Booted 8.5mm Leads / Alumina Ceramic Plugs',
      spec: '8 molded high-tension leads routing from coil mounts to M14 plugs',
    },
    [0, 140, 0],
  );
  for (const cy of cylList) {
    const B = bankFrames[cy.bank];
    const out = cy.bank === 'L' ? 1 : -1;
    const bg = new THREE.Group();
    bg.position.z = cy.z;
    bg.rotation.z = Math.atan2(B.b[1], B.b[0]) - Math.PI / 2;
    sparkLeadsGrp.add(bg);
    const clip = add(bg, new THREE.BoxGeometry(10, 8, 12), M.blackMatte);
    clip.position.set(out * 55, DECK + 78, 12);
    const leadPts = [
      new V3(out * 55, DECK + 78, 12),
      new V3(out * 72, DECK + 76, 15),
      new V3(out * 84, DECK + 66, 18),
      new V3(out * 76, DECK + 52, 18),
    ];
    add(bg, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(leadPts), N(14), 2.5, N(8), false), M.steel);
    const boot90 = add(bg, new THREE.CylinderGeometry(5.2, 6.0, 14, N(10)), M.blackMatte);
    boot90.position.set(out * 70, DECK + 46, 18);
    boot90.rotation.z = -out * 0.62;
  }

  // 6. Corrugated EVAP / Fuel Wire Harness Conduit along upper left valley intake shoulder + purge solenoid
  const harnessGrp = new THREE.Group();
  blockDressGrp.add(harnessGrp);
  tag(
    harnessGrp,
    {
      name: 'EVAP Harness Conduit',
      subsystem: 'Engine Management · Wiring',
      material: 'Corrugated PA6 Nylon Loom / Deutsch Connectors',
      spec: 'Ribbed EFI & EVAP purge harness sweeping along Left valley shoulder',
    },
    [60, 250, 0],
  );
  const hPts = [
    new V3(124, 212, -228),
    new V3(116, 276, -196),
    new V3(118, 278, -20),
    new V3(116, 278, 185),
    new V3(80, 282, 234),
    new V3(66, 260, 248),
  ];
  const hCurve = new THREE.CatmullRomCurve3(hPts);
  add(harnessGrp, new THREE.TubeGeometry(hCurve, N(36), 6.2, N(10), false), M.blackMatte);
  if (!plain) {
    for (let k = 1; k < 34; k++) {
      const u = k / 35;
      const p = hCurve.getPoint(u);
      const t = hCurve.getTangent(u);
      const rib = add(harnessGrp, new THREE.TorusGeometry(6.5, 1.0, 6, N(10)), M.blackMatte);
      rib.position.copy(p);
      rib.quaternion.setFromUnitVectors(new V3(0, 0, 1), t);
    }
  }
  const evapValve = add(harnessGrp, new THREE.CylinderGeometry(9, 9, 24, N(12)), M.blackMatte);
  evapValve.position.set(66, 254, 248);
  const rearPlug = add(harnessGrp, new THREE.BoxGeometry(14, 14, 18), M.blackMatte);
  rearPlug.position.set(124, 208, -234);

  // 7. Rear cylinder-head lifting hooks with lightening holes & cam sensor bosses (z = -238)
  const liftHookSh = new THREE.Shape();
  liftHookSh.moveTo(-18, -16);
  liftHookSh.lineTo(18, -16);
  liftHookSh.lineTo(14, 22);
  liftHookSh.absarc(0, 22, 14, 0, Math.PI, false);
  liftHookSh.closePath();
  const eyeHole = new THREE.Path();
  eyeHole.absarc(0, 22, 7.5, 0, Math.PI * 2, true);
  liftHookSh.holes.push(eyeHole);
  const lightHole = new THREE.Path();
  lightHole.absarc(0, 2, 4.5, 0, Math.PI * 2, true);
  liftHookSh.holes.push(lightHole);
  const liftHookGeo = new THREE.ExtrudeGeometry(liftHookSh, {depth: 7, bevelEnabled: !plain, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 1, curveSegments: N(14)});
  liftHookGeo.translate(0, 0, -3.5);
  for (const bank of ['L', 'R']) {
    const B = bankFrames[bank];
    const sgn = bank === 'L' ? 1 : -1;
    const hook = add(blockDressGrp, liftHookGeo, M.alu);
    hook.position.set((DECK + 10) * B.b[0], (DECK + 10) * B.b[1], -238);
    hook.rotation.z = Math.atan2(B.b[1], B.b[0]) - Math.PI / 2;
    tag(hook, {
      name: `Rear Lifting Hook (${bank} Bank)`,
      subsystem: 'Engine Block · Service Hardware',
      material: 'CNC 6061-T6 Alloy Bracket',
      spec: 'Lightened service lifting eye bolted to rear head face',
    });
    for (const dx of [-11, 11]) {
      const hbolt = add(blockDressGrp, new THREE.CylinderGeometry(3, 3, 10, 6), M.steel);
      hbolt.rotation.x = Math.PI / 2;
      hbolt.position.set((DECK + 2) * B.b[0] + dx * B.p[0], (DECK + 2) * B.b[1] + dx * B.p[1], -241);
    }
    const camSens = add(blockDressGrp, new THREE.CylinderGeometry(6, 6, 14, N(10)), M.blackMatte);
    camSens.rotation.x = Math.PI / 2;
    camSens.position.set(sgn * 145, 146, -242);
  }

  if (ignore) void ignore;
  return {sumpGrp, blockDressGrp, sparkLeadsGrp, harnessGrp};
}

/** Build front accessory dress-up: harmonic damper, workable water pump (impeller sight-port + coolant flow), vented alternator with spinning rotor, open 5-spoke PS/idler pulley. */
export function buildAccessoryDressup({M, DM, add, tag, N, plain, front}) {
  const serpZ = front + 62;

  // 1. ATI / LS-style multi-stepped forged gunmetal-titanium harmonic crank damper & coral-vermilion hub at (0, 0, serpZ)
  const damperGrp = new THREE.Group();
  damperGrp.position.set(0, 0, serpZ);
  tag(
    damperGrp,
    {
      name: 'Harmonic Crankshaft Damper & Sheave',
      subsystem: 'Accessory Drive · Front',
      material: 'CNC Dark Titanium Sheave / Satin Alloy Hub / Coral Anodized Cap',
      spec: 'Ø148 mm multi-rib sheave + Ø120 × 32 mm harmonic inertia ring',
    },
    [0, -110, 90],
  );
  add(damperGrp, new THREE.CylinderGeometry(74, 74, 15, N(48)), DM.billetTitanium).rotation.x = Math.PI / 2;
  for (const lz of [-7, -2.4, 2.4, 7]) {
    add(damperGrp, new THREE.TorusGeometry(74.4, lz === -7 || lz === 7 ? 1.8 : 0.9, N(8, 4), N(48)), M.gunmetal).position.z = lz;
  }
  const inertiaRing = add(damperGrp, new THREE.CylinderGeometry(60, 60, 32, N(48)), M.gunmetal);
  inertiaRing.rotation.x = Math.PI / 2;
  inertiaRing.position.z = -10;
  const elastomer = add(damperGrp, new THREE.TorusGeometry(51, 4.2, N(8, 4), N(44)), M.beltRubber);
  elastomer.position.z = 5;
  const innerHubGeo = plain
    ? new THREE.CylinderGeometry(47, 47, 10, N(24)).rotateX(Math.PI / 2)
    : makeSpokedPulleyGeo(47, 22, 6, 10, 0.24, N(28));
  const innerHub = add(damperGrp, innerHubGeo, DM.satinAlloy);
  innerHub.position.z = 6;
  const centerBoss = add(damperGrp, new THREE.CylinderGeometry(23, 23, 22, N(24)), DM.coralHub);
  centerBoss.rotation.x = Math.PI / 2;
  centerBoss.position.z = 1;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const hbolt = add(damperGrp, new THREE.CylinderGeometry(3.2, 3.2, 7, 6), M.steel);
    hbolt.rotation.x = Math.PI / 2;
    hbolt.position.set(Math.cos(a) * 34, Math.sin(a) * 34, 11);
  }
  const crankWasher = add(damperGrp, new THREE.CylinderGeometry(16, 16, 4, N(20)), DM.satinAlloy);
  crankWasher.rotation.x = Math.PI / 2;
  crankWasher.position.z = 13;
  const crankBolt = add(damperGrp, new THREE.CylinderGeometry(10, 10, 9, 6), M.steel);
  crankBolt.rotation.x = Math.PI / 2;
  crankBolt.position.z = 17;

  // 2. Sculpted satin-alloy water pump scroll housing + impeller sight-port + translucent coolant flow gooseneck + dark titanium 4-spoke pulley
  const waterPumpGrp = new THREE.Group();
  tag(
    waterPumpGrp,
    {
      name: 'Centrifugal Coolant Water Pump & Thermostat',
      subsystem: 'Cooling · Front',
      material: 'Satin Brushed Alloy / Dark Titanium Pulley / Bronze Impeller',
      spec: 'Ø84 mm open 4-spoke pulley (1.25×), visible 6-vane impeller & coolant flow',
    },
    [0, 40, 90],
  );
  // Central scroll volute recessed chamber (z = front+24..front+52) with dark wet interior backing
  const wpVolute = add(waterPumpGrp, new THREE.CylinderGeometry(45, 48, 22, N(28)), DM.satinAlloy);
  wpVolute.rotation.x = Math.PI / 2;
  wpVolute.position.set(0, 128, front + 35);
  const wpChamberBack = add(waterPumpGrp, new THREE.CylinderGeometry(37, 37, 4, N(28)), M.gunmetal);
  wpChamberBack.rotation.x = Math.PI / 2;
  wpChamberBack.position.set(0, 128, front + 40);

  // Rotating 6-vane bronze/steel water impeller visible through polycarbonate sight-port
  const wpImpeller = new THREE.Group();
  wpImpeller.position.set(0, 128, front + 46);
  waterPumpGrp.add(wpImpeller);
  waterPumpGrp.impeller = wpImpeller;
  add(wpImpeller, new THREE.CylinderGeometry(11, 12, 10, N(16)), M.steel).rotation.x = Math.PI / 2;
  add(wpImpeller, new THREE.CylinderGeometry(33, 33, 2.2, N(24)), M.bronze).rotation.x = Math.PI / 2;
  wpImpeller.children[wpImpeller.children.length - 1].position.z = -3;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const vane = add(wpImpeller, new THREE.BoxGeometry(20, 3.2, 6.5), k % 2 === 0 ? M.bronze : M.steel);
    vane.position.set(Math.cos(a) * 20, Math.sin(a) * 20, 0.5);
    vane.rotation.z = a + 0.42;
  }

  // Machined circular polycarbonate sight-glass bezel on front of volute (z = front + 52)
  const wpSightBezel = add(waterPumpGrp, makeRimGeo(42, 34, 6, N(32)), DM.satinAlloy);
  wpSightBezel.position.set(0, 128, front + 49);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const sb = add(waterPumpGrp, new THREE.CylinderGeometry(2.0, 2.0, 4, 6), M.steel);
    sb.rotation.x = Math.PI / 2;
    sb.position.set(Math.cos(a) * 38, 128 + Math.sin(a) * 38, front + 52.5);
  }
  const wpSightGlass = add(waterPumpGrp, new THREE.CylinderGeometry(35, 35, 2.5, N(28)), M.glass, false);
  wpSightGlass.rotation.x = Math.PI / 2;
  wpSightGlass.position.set(0, 128, front + 51.5);
  wpSightGlass.renderOrder = 4;

  // Pump mounting legs + hex bolts
  for (const sgn of [-1, 1]) {
    const leg = add(waterPumpGrp, new THREE.BoxGeometry(58, 22, 22), DM.satinAlloy);
    leg.position.set(sgn * 42, 118, front + 34);
    leg.rotation.z = sgn * 0.25;
    for (const dy of [-6, 8]) {
      const wbolt = add(waterPumpGrp, new THREE.CylinderGeometry(3.2, 3.2, 14, 6), M.steel);
      wbolt.rotation.x = Math.PI / 2;
      wbolt.position.set(sgn * 64, 114 + dy, front + 44);
    }
  }
  // Horizontal radiator outlet hose barb / neck
  const outletNeck = add(waterPumpGrp, new THREE.CylinderGeometry(16, 18, 42, N(20)), DM.satinAlloy);
  outletNeck.rotation.z = Math.PI / 2;
  outletNeck.rotation.y = -0.25;
  outletNeck.position.set(-56, 134, front + 40);
  const outletBead = add(waterPumpGrp, new THREE.TorusGeometry(16.5, 2.2, N(8), N(20)), M.steel);
  outletBead.rotation.y = Math.PI / 2 - 0.25;
  outletBead.position.set(-76, 134, front + 45);

  // Vertical bolted thermostat gooseneck (`thermostatGrp`) + bypass barb feeding routed upper coolant crossover bridge
  const thermostatGrp = new THREE.Group();
  waterPumpGrp.add(thermostatGrp);
  tag(thermostatGrp, {
    name: 'Thermostat Housing',
    subsystem: 'Cooling · Bypass & Outlet',
    material: 'Satin Brushed Alloy / Brass Bleed Screw',
    spec: 'Dual-bolted 87°C thermostat housing + bypass neck + upper crossover',
  });
  const statBase = add(thermostatGrp, new THREE.CylinderGeometry(22, 26, 26, N(20)), DM.satinAlloy);
  statBase.position.set(-28, 168, front + 36);
  const statFlange = add(thermostatGrp, new THREE.BoxGeometry(52, 8, 44), DM.satinAlloy);
  statFlange.position.set(-28, 184, front + 36);
  for (const fx of [-46, -10]) {
    const sbolt = add(thermostatGrp, new THREE.CylinderGeometry(3.2, 3.2, 12, 6), M.steel);
    sbolt.position.set(fx, 190, front + 36);
  }
  const bypassBarb = add(thermostatGrp, new THREE.CylinderGeometry(5.5, 6.2, 18, N(12)), DM.satinAlloy);
  bypassBarb.rotation.z = Math.PI / 2;
  bypassBarb.position.set(-54, 174, front + 36);
  const bleedScrew = add(thermostatGrp, new THREE.CylinderGeometry(3.5, 3.5, 8, 6), M.bronze);
  bleedScrew.position.set(-14, 190, front + 48);
  const statNeckPts = [
    new V3(-28, 188, front + 36),
    new V3(-38, 206, front + 37),
    new V3(-50, 220, front + 38),
  ];
  add(thermostatGrp, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(statNeckPts), N(12), 13.5, N(16), false), DM.satinAlloy);
  const crossTee = add(thermostatGrp, new THREE.CylinderGeometry(16, 16, 26, N(18)), DM.satinAlloy);
  crossTee.rotation.z = Math.PI / 2;
  crossTee.position.set(-50, 220, front + 38);

  // Inline borosilicate coolant flow sight capsule centered cleanly on the front crossover bridge (below TB)
  const sightPts = [new V3(-38, 220, front + 38), new V3(0, 220, front + 38), new V3(38, 220, front + 38)];
  const sightCurve = new THREE.CatmullRomCurve3(sightPts);
  const sightOuter = add(waterPumpGrp, new THREE.TubeGeometry(sightCurve, N(12), 13.5, N(18), false), M.glass, false);
  sightOuter.renderOrder = 4;
  const coolantMat = makeCoolantFlowMaterial(plain);
  const coolantFlow = add(waterPumpGrp, new THREE.TubeGeometry(sightCurve, N(14), 10.8, N(16), false), coolantMat, false);
  coolantFlow.renderOrder = 3;
  tag(coolantFlow, {
    name: 'Upper Coolant Crossover & Sight Capsule',
    subsystem: 'Cooling · Upper Manifold',
    material: 'Borosilicate Capsule / Molded EPDM / Billet Head Ports',
    spec: 'Dual-bank crossover bridge routing thermostat discharge to L & R heads',
  });
  waterPumpGrp.coolantFlow = coolantFlow;
  waterPumpGrp.coolantMat = coolantMat;
  for (const cx of [-38, 38]) {
    const collar = add(waterPumpGrp, new THREE.CylinderGeometry(16, 16, 10, N(18)), DM.satinAlloy);
    collar.rotation.z = Math.PI / 2;
    collar.position.set(cx, 220, front + 38);
    const clamp = add(waterPumpGrp, new THREE.TorusGeometry(15.2, 1.5, N(6, 4), N(18)), M.steel);
    clamp.rotation.y = Math.PI / 2;
    clamp.position.set(cx + Math.sign(cx) * 5, 220, front + 38);
  }

  // Molded ribbed black EPDM hoses routing from crossover bridge back to machined alu front cylinder-head water ports
  const bankHoseSpecs = [
    {
      sgn: -1,
      pts: [
        new V3(-62, 220, front + 38),
        new V3(-108, 228, front + 24),
        new V3(-140, 234, front),
        new V3(-140, 212, front - 36),
      ],
      portZ: front - 44,
      portLen: 32,
    },
    {
      sgn: 1,
      pts: [
        new V3(42, 220, front + 38),
        new V3(106, 228, front + 24),
        new V3(140, 234, front),
        new V3(140, 212, front - 34),
      ],
      portZ: front - 38,
      portLen: 18,
    },
  ];
  for (const bh of bankHoseSpecs) {
    const hoseCurve = new THREE.CatmullRomCurve3(bh.pts);
    add(waterPumpGrp, new THREE.TubeGeometry(hoseCurve, N(22), 10.5, N(14), false), M.beltRubber);
    if (!plain) {
      for (const u of [0.22, 0.45, 0.7]) {
        const p = hoseCurve.getPoint(u);
        const t = hoseCurve.getTangent(u);
        const rib = add(waterPumpGrp, new THREE.TorusGeometry(10.8, 1.2, 6, N(14)), M.beltRubber);
        rib.position.copy(p);
        rib.quaternion.setFromUnitVectors(new V3(0, 0, 1), t);
      }
    }
    // Machined satin-alloy cylinder-head water port block + 2 flange bolts + hose clamp
    const portBoss = add(waterPumpGrp, new THREE.BoxGeometry(28, 22, bh.portLen), DM.satinAlloy);
    portBoss.position.set(bh.sgn * 140, 209, bh.portZ);
    const portNeck = add(waterPumpGrp, new THREE.CylinderGeometry(12.5, 13.5, 16, N(16)), DM.satinAlloy);
    portNeck.rotation.x = Math.PI / 2;
    portNeck.position.set(bh.sgn * 140, 212, front - 32);
    const clampRear = add(waterPumpGrp, new THREE.TorusGeometry(11.4, 1.5, N(6, 4), N(16)), M.steel);
    clampRear.position.set(bh.sgn * 140, 212, front - 26);
    for (const dx of [-10, 10]) {
      const pbolt = add(waterPumpGrp, new THREE.CylinderGeometry(2.5, 2.5, 6, 6), M.steel);
      pbolt.rotation.x = Math.PI / 2;
      pbolt.position.set(bh.sgn * 140 + dx, 201, bh.portZ + bh.portLen / 2 + 1.5);
    }
  }

  // Dark CNC billet open 4-spoke water pump pulley at (0, 128, serpZ) exposing spinning impeller
  const wpPulley = new THREE.Group();
  wpPulley.position.set(0, 128, serpZ);
  waterPumpGrp.add(wpPulley);
  waterPumpGrp.pulley = wpPulley;
  add(wpPulley, makeRimGeo(42, 38.5, 15, N(36)), DM.billetTitanium);
  for (const lz of [-7, -2.5, 2.5, 7]) {
    add(wpPulley, new THREE.TorusGeometry(42.4, lz === -7 || lz === 7 ? 1.5 : 0.85, N(8, 4), N(36)), M.gunmetal).position.z = lz;
  }
  const wpFaceGeo = plain
    ? makeRimGeo(40, 20, 6, N(20))
    : makeSpokedPulleyGeo(40, 17.5, 4, 6, 0.24, N(24), 7);
  const wpFace = add(wpPulley, wpFaceGeo, DM.billetTitanium);
  wpFace.position.z = 3;
  const wpHub = add(wpPulley, new THREE.CylinderGeometry(16, 16, 12, N(20)), DM.satinAlloy);
  wpHub.rotation.x = Math.PI / 2;
  wpHub.position.z = 5;
  const wpCap = add(wpPulley, new THREE.CylinderGeometry(7.5, 7.5, 4, N(16)), DM.coralHub);
  wpCap.rotation.x = Math.PI / 2;
  wpCap.position.z = 10.5;
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const pb = add(wpPulley, new THREE.CylinderGeometry(2.8, 2.8, 7, 6), M.steel);
    pb.rotation.x = Math.PI / 2;
    pb.position.set(Math.cos(a) * 11, Math.sin(a) * 11, 10);
  }

  // 3. Vented satin-alloy alternator with dark titanium pulley & spinning rotor (`altGrp.rotor`) at (+148, -10, serpZ)
  const altGrp = new THREE.Group();
  altGrp.position.set(148, -10, serpZ);
  tag(
    altGrp,
    {
      name: '140A Vented Alternator & Copper Stator',
      subsystem: 'Electrical · Accessory Drive',
      material: 'Slotted Satin Alloy / Copper Stator / Dark Titanium Pulley',
      spec: 'Ø56 mm 6-rib pulley (2.6×), 8-vent case exposing whirling rotor & stator',
    },
    [120, -20, 90],
  );
  const altPulley = new THREE.Group();
  altGrp.add(altPulley);
  altGrp.pulley = altPulley;
  add(altPulley, new THREE.CylinderGeometry(28, 28, 15, N(28)), DM.billetTitanium).rotation.x = Math.PI / 2;
  for (const lz of [-6.5, -2.5, 2.5, 6.5]) {
    add(altPulley, new THREE.TorusGeometry(28.3, 1.0, N(6, 4), N(28)), M.gunmetal).position.z = lz;
  }
  const altShaft = add(altPulley, new THREE.CylinderGeometry(9.5, 9.5, 22, N(16)), M.steel);
  altShaft.rotation.x = Math.PI / 2;
  const altNut = add(altPulley, new THREE.CylinderGeometry(7, 7, 6, 6), M.gunmetal);
  altNut.rotation.x = Math.PI / 2;
  altNut.position.z = 11;

  // Spinning alternator rotor assembly (front/rear cooling fan blades + slotted copper/steel claw-pole rotor)
  const altRotor = new THREE.Group();
  altGrp.add(altRotor);
  altGrp.rotor = altRotor;
  const fanHub = add(altRotor, new THREE.CylinderGeometry(33, 33, 3, N(24)), M.steel);
  fanHub.rotation.x = Math.PI / 2;
  fanHub.position.z = -12;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const blade = add(altRotor, new THREE.BoxGeometry(11, 2.8, 5.5), M.steel);
    blade.position.set(Math.cos(a) * 26, Math.sin(a) * 26, -13);
    blade.rotation.z = a + 0.45;
  }
  const rotorDrum = add(altRotor, new THREE.CylinderGeometry(24, 24, 22, N(20)), M.gunmetal);
  rotorDrum.rotation.x = Math.PI / 2;
  rotorDrum.position.z = -31;
  const rotorCopperCore = add(altRotor, new THREE.CylinderGeometry(28.5, 28.5, 14, N(20)), DM.copperWinding);
  rotorCopperCore.rotation.x = Math.PI / 2;
  rotorCopperCore.position.z = -31;
  if (!plain) {
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const pole = add(altRotor, new THREE.BoxGeometry(4.5, 4.5, 21), k % 2 === 0 ? M.steel : DM.copperWinding);
      pole.position.set(Math.cos(a) * 30.5, Math.sin(a) * 30.5, -31);
      pole.rotation.z = a;
    }
  }

  // Open stator end-winding coils + stacked visible copper coil rings inside the 8 radial cooling slots
  for (const sz of [-20, -42]) {
    add(altGrp, new THREE.TorusGeometry(34.8, 2.8, N(8, 4), N(28)), DM.copperWinding).position.z = sz;
  }
  for (const sz of [-38, -33.5, -28.5, -24]) {
    add(altGrp, new THREE.TorusGeometry(35.4, 1.4, N(6, 4), N(28)), DM.copperWinding).position.z = sz;
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const statorBar = add(altGrp, new THREE.BoxGeometry(3.8, 3.8, 24), DM.copperWinding);
    statorBar.position.set(Math.cos(a) * 35.2, Math.sin(a) * 35.2, -31);
    statorBar.rotation.z = a;
  }

  // Front & rear slotted satin-alloy shell halves + 8 radial cooling vent ribs
  const frontShell = add(altGrp, new THREE.CylinderGeometry(40, 41, 9, N(28)), DM.satinAlloy);
  frontShell.rotation.x = Math.PI / 2;
  frontShell.position.z = -16.5;
  const rearShell = add(altGrp, new THREE.CylinderGeometry(41, 38, 9, N(28)), DM.satinAlloy);
  rearShell.rotation.x = Math.PI / 2;
  rearShell.position.z = -45.5;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const rib = add(altGrp, new THREE.BoxGeometry(5.2, 5.2, 26), DM.satinAlloy);
    rib.position.set(Math.cos(a) * 39, Math.sin(a) * 39, -31);
    rib.rotation.z = a;
    if (k % 2 === 0) {
      const caseBolt = add(altGrp, new THREE.CylinderGeometry(2.2, 2.2, 38, 6), M.steel);
      caseBolt.rotation.x = Math.PI / 2;
      caseBolt.position.set(Math.cos(a) * 38, Math.sin(a) * 38, -31);
    }
  }

  // Satin-alloy mounting bracket arm sweeping inboard-down to block bulkhead (clears 72T idler)
  const mountArm = add(altGrp, new THREE.BoxGeometry(20, 16, 62), DM.satinAlloy);
  mountArm.position.set(-34, -26, -60);
  mountArm.rotation.y = -0.35;
  mountArm.rotation.x = 0.14;
  const pivotEar = add(altGrp, new THREE.CylinderGeometry(9, 9, 26, N(14)), DM.satinAlloy);
  pivotEar.rotation.x = Math.PI / 2;
  pivotEar.position.set(-24, -28, -32);
  const pivotBolt = add(altGrp, new THREE.CylinderGeometry(4, 4, 34, 6), M.steel);
  pivotBolt.rotation.x = Math.PI / 2;
  pivotBolt.position.set(-24, -28, -32);

  // Rear regulator pack & copper B+ terminal stud (outboard quadrant, clears 72T idler)
  const regPack = add(altGrp, new THREE.BoxGeometry(24, 26, 12), M.blackMatte);
  regPack.position.set(16, -14, -54);
  const bPlusStud = add(altGrp, new THREE.CylinderGeometry(3.8, 3.8, 12, N(10)), M.bronze);
  bPlusStud.rotation.x = Math.PI / 2;
  bPlusStud.position.set(20, -18, -62);
  const bPlusBoot = add(altGrp, new THREE.CylinderGeometry(6, 6, 6, N(12)), DM.coralHub);
  bPlusBoot.rotation.x = Math.PI / 2;
  bPlusBoot.position.set(20, -18, -59);

  // 4. Forged dark titanium open 5-spoke idler / power-steering pulley at (-108, +26, serpZ - 2)
  const psPulleyGrp = new THREE.Group();
  psPulleyGrp.position.set(-108, 26, serpZ - 2);
  tag(
    psPulleyGrp,
    {
      name: '5-Spoke Idler / Power-Steering Pulley',
      subsystem: 'Accessory Drive · Front',
      material: 'CNC Dark Titanium Billet / Satin Alloy Bracket',
      spec: 'Ø68 mm open 5-spoke multi-rib pulley with machined steel bore',
    },
    [-100, 20, 90],
  );
  const psPulley = new THREE.Group();
  psPulleyGrp.add(psPulley);
  psPulleyGrp.pulley = psPulley;
  add(psPulley, makeRimGeo(34, 30.5, 15, N(36)), DM.billetTitanium);
  for (const lz of [-7, -2.5, 2.5, 7]) {
    add(psPulley, new THREE.TorusGeometry(34.4, lz === -7 || lz === 7 ? 1.4 : 0.85, N(8, 4), N(36)), M.gunmetal).position.z = lz;
  }
  const psSpiderGeo = plain
    ? new THREE.CylinderGeometry(32, 32, 8, N(24)).rotateX(Math.PI / 2)
    : makeSpokedPulleyGeo(33, 13.5, 5, 9, 0.2, N(24));
  add(psPulley, psSpiderGeo, DM.billetTitanium);
  const psBore = add(psPulley, new THREE.CylinderGeometry(11.5, 11.5, 14, N(20)), DM.satinAlloy);
  psBore.rotation.x = Math.PI / 2;
  const psBolt = add(psPulley, new THREE.CylinderGeometry(6, 6, 18, 6), DM.coralHub);
  psBolt.rotation.x = Math.PI / 2;

  const psHub = add(psPulleyGrp, new THREE.CylinderGeometry(18, 21, 18, N(20)), DM.satinAlloy);
  psHub.rotation.x = Math.PI / 2;
  psHub.position.z = -17;
  const psArm = add(psPulleyGrp, new THREE.BoxGeometry(20, 18, 66), DM.satinAlloy);
  psArm.position.set(28, -24, -56);
  psArm.rotation.y = 0.42;
  psArm.rotation.x = -0.35;
  for (const bx of [44, 52]) {
    const pbolt = add(psPulleyGrp, new THREE.CylinderGeometry(3.2, 3.2, 16, 6), M.steel);
    pbolt.rotation.x = Math.PI / 2;
    pbolt.position.set(bx, -42, -84);
  }

  // 5. Spring-loaded Belt Tensioner (`tensionerGrp`) riding belt span between Water Pump & Alternator
  const tensionerGrp = new THREE.Group();
  tensionerGrp.position.set(64, 52, serpZ);
  tag(
    tensionerGrp,
    {
      name: 'Belt Tensioner',
      subsystem: 'Accessory Drive · Front',
      material: 'Satin Brushed Alloy Arm / Dark Titanium Idler Pulley',
      spec: 'Ø44 mm spring-loaded automatic serpentine tensioner (74/22 ratio)',
    },
    [40, 20, 90],
  );
  const tensBarrel = add(tensionerGrp, new THREE.CylinderGeometry(18, 18, 18, N(20)), DM.satinAlloy);
  tensBarrel.rotation.x = Math.PI / 2;
  tensBarrel.position.z = -22;
  add(tensionerGrp, new THREE.CylinderGeometry(14, 14, 4, N(16)), M.gunmetal).rotation.x = Math.PI / 2;
  tensionerGrp.children[tensionerGrp.children.length - 1].position.z = -12;
  const tensArm = add(tensionerGrp, new THREE.BoxGeometry(16, 34, 10), DM.satinAlloy);
  tensArm.position.set(6, 13, -15);
  tensArm.rotation.z = -0.42;
  const tensBoss = add(tensionerGrp, new THREE.CylinderGeometry(10, 10, 14, N(16)), DM.satinAlloy);
  tensBoss.rotation.x = Math.PI / 2;
  tensBoss.position.set(12, 26, -12);
  const tensPulley = new THREE.Group();
  tensPulley.position.set(12, 26, 0);
  tensionerGrp.add(tensPulley);
  tensionerGrp.pulley = tensPulley;
  add(tensPulley, new THREE.CylinderGeometry(22, 22, 15, N(24)), DM.billetTitanium).rotation.x = Math.PI / 2;
  for (const lz of [-7, 7]) add(tensPulley, new THREE.TorusGeometry(22.4, 1.3, N(6, 4), N(24)), M.gunmetal).position.z = lz;
  add(tensPulley, new THREE.CylinderGeometry(9, 9, 17, N(16)), M.gunmetal).rotation.x = Math.PI / 2;
  const tensBolt = add(tensPulley, new THREE.CylinderGeometry(5, 5, 20, 6), M.steel);
  tensBolt.rotation.x = Math.PI / 2;

  // 6. Lower-Left Compact A/C Compressor (`acCompressorGrp`) at (+190, -84, serpZ) with 6-groove clutch pulley
  const acCompressorGrp = new THREE.Group();
  acCompressorGrp.position.set(190, -84, serpZ);
  tag(
    acCompressorGrp,
    {
      name: 'A/C Compressor',
      subsystem: 'Accessory Drive · Climate',
      material: 'Satin Ribbed Alloy / Dark Titanium Pulley / Coral Clutch',
      spec: 'Ø64 mm 6-groove clutch pulley (2.31×), ribbed body & pigtail plug',
    },
    [130, -40, 90],
  );
  const acPulley = new THREE.Group();
  acCompressorGrp.add(acPulley);
  acCompressorGrp.pulley = acPulley;
  add(acPulley, new THREE.CylinderGeometry(32, 32, 15, N(28)), DM.billetTitanium).rotation.x = Math.PI / 2;
  for (const lz of [-6.5, -2.5, 2.5, 6.5]) {
    add(acPulley, new THREE.TorusGeometry(32.4, 1.0, N(6, 4), N(28)), M.gunmetal).position.z = lz;
  }
  const acClutchPlate = add(acPulley, new THREE.CylinderGeometry(24, 24, 5, N(24)), DM.coralHub);
  acClutchPlate.rotation.x = Math.PI / 2;
  acClutchPlate.position.z = 8;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const riv = add(acPulley, new THREE.CylinderGeometry(3.2, 3.2, 4, 8), M.gunmetal);
    riv.rotation.x = Math.PI / 2;
    riv.position.set(Math.cos(a) * 16, Math.sin(a) * 16, 10.5);
  }
  const acShaftNut = add(acPulley, new THREE.CylinderGeometry(6.5, 6.5, 8, 6), M.steel);
  acShaftNut.rotation.x = Math.PI / 2;
  acShaftNut.position.z = 11;

  const acBody = add(acCompressorGrp, new THREE.CylinderGeometry(40, 41, 64, N(24)), DM.satinAlloy);
  acBody.rotation.x = Math.PI / 2;
  acBody.position.z = -50;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const acRib = add(acCompressorGrp, new THREE.BoxGeometry(4, 4, 58), DM.satinAlloy);
    acRib.position.set(Math.cos(a) * 40.5, Math.sin(a) * 40.5, -50);
    acRib.rotation.z = a;
  }
  const acManifold = add(acCompressorGrp, new THREE.BoxGeometry(34, 18, 26), DM.satinAlloy);
  acManifold.position.set(-8, 36, -64);
  for (const px of [-16, 0]) {
    const port = add(acCompressorGrp, new THREE.CylinderGeometry(6.5, 6.5, 10, N(12)), M.steel);
    port.position.set(px, 47, -64);
  }
  const acPlug = add(acCompressorGrp, new THREE.BoxGeometry(12, 10, 14), M.blackMatte);
  acPlug.position.set(16, 38, -28);
  const acBracket = add(acCompressorGrp, new THREE.BoxGeometry(62, 16, 48), DM.satinAlloy);
  acBracket.position.set(-48, 8, -62);
  for (const bz of [-78, -46]) {
    const abolt = add(acCompressorGrp, new THREE.CylinderGeometry(3.2, 3.2, 18, 6), M.steel);
    abolt.rotation.z = Math.PI / 2;
    abolt.position.set(-72, 10, bz);
  }

  return {damperGrp, waterPumpGrp, altGrp, psPulleyGrp, tensionerGrp, acCompressorGrp, thermostatGrp};
}

/** Build hybrid glass-windowed + swappable solid-finned valve covers with chamfered perimeter cooling fins & badge plates. */
export function buildHybridValveCovers({M, DM, add, tag, N, plain, BANK, bankXY, DECK}) {
  void bankXY;
  const coversGrp = new THREE.Group();
  const glassWindows = [];
  const solidLids = [];
  const banks = {};
  const glassMat = plain
    ? M.glass
    : new THREE.MeshPhysicalMaterial({
        color: '#42586e',
        roughness: 0.09,
        metalness: 0.06,
        clearcoat: 1.0,
        clearcoatRoughness: 0.06,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
  coversGrp.glassMat = glassMat;
  const compositeMat = DM.coverComposite || M.blackMatte;

  const gasketGeo = makeHollowFrameGeo(116, 450, 16, 98, 430, 12, 4.5, N(12), 0.4);
  const skirtFlangeGeo = makeHollowFrameGeo(118, 452, 16, 98, 430, 12, 6, N(12), plain ? 0 : 0.8);
  const upperRailGeo = makeHollowFrameGeo(108, 442, 14, 98, 430, 12, 107, N(12), plain ? 0 : 1.1);
  const bezelFrameGeo = makeHollowFrameGeo(112, 444, 14, 80, 400, 10, 7, N(12), plain ? 0 : 1.2);

  const winShape = roundedRectShape(84, 404, 10);
  const windowGeo = new THREE.ExtrudeGeometry(winShape, {depth: 3.5, bevelEnabled: false, curveSegments: N(12)});
  windowGeo.rotateX(-Math.PI / 2);

  const solidLidGeo = new THREE.ExtrudeGeometry(winShape, {
    depth: 5,
    bevelEnabled: !plain,
    bevelThickness: 1.0,
    bevelSize: 1.0,
    bevelSegments: 1,
    curveSegments: N(12),
  });
  solidLidGeo.rotateX(-Math.PI / 2);

  for (const bank of ['L', 'R']) {
    const B = BANK[bank];
    const bankLabel = bank === 'L' ? 'Left Bank (+45°)' : 'Right Bank (−45°)';
    const bg = new THREE.Group();
    bg.rotation.z = Math.atan2(B.b[1], B.b[0]) - Math.PI / 2;
    coversGrp.add(bg);
    banks[bank] = bg;
    tag(
      bg,
      {
        name: `${bank === 'L' ? 'Left' : 'Right'} Hybrid Windowed Valve Cover`,
        subsystem: `Valvetrain · ${bankLabel}`,
        material: 'Crystal Polycarbonate Shell / Brushed Billet Frame / Finned Solid Lid',
        spec: '8-bolt brushed billet rail, clear polycarbonate walls, swappable GLASS/SOLID lid',
      },
      [390 * B.b[0], 390 * B.b[1], 0],
    );

    const gasket = add(bg, gasketGeo, M.beltRubber);
    gasket.position.y = DECK + 42;

    const skirt = add(bg, skirtFlangeGeo, DM.satinAlloy || M.alu);
    skirt.position.y = DECK + 46;

    const rail = add(bg, upperRailGeo, glassMat, false);
    rail.position.y = DECK + 52;
    rail.renderOrder = 4;
    glassWindows.push(rail);

    const bezel = add(bg, bezelFrameGeo, DM.satinAlloy || M.alu);
    bezel.position.y = DECK + 158;

    // Semicircular cam-end reliefs at front/rear (cam shaft axis at y = DECK + 112)
    for (const ez of [-222, 222]) {
      const relief = add(bg, new THREE.CylinderGeometry(19, 19, 10, N(18), 1, false, -Math.PI / 2, Math.PI), DM.satinAlloy || M.alu);
      relief.rotation.x = -Math.PI / 2;
      relief.position.set(0, DECK + 112, ez + Math.sign(ez) * 2);
      const trim = add(bg, new THREE.TorusGeometry(19, 2.2, N(6, 4), N(16), Math.PI), M.gunmetal);
      trim.position.set(0, DECK + 112, ez + Math.sign(ez) * 7);
    }

    // CNC chamfered perimeter silver cooling fins + corner structural stanchions + engraved badge strips
    for (const rz of [-168, -112, -56, 0, 56, 112, 168]) {
      for (const sgn of [-1, 1]) {
        const rib = add(bg, new THREE.BoxGeometry(15, 4.2, 7.5), M.steel);
        rib.position.set(sgn * 48.5, DECK + 165.5, rz);
      }
    }
    for (const sgn of [-1, 1]) {
      const strip = add(bg, new THREE.BoxGeometry(3.8, 3.2, 412), M.steel);
      strip.position.set(sgn * 56.5, DECK + 159, 0);
      const shoulderBevel = add(bg, new THREE.BoxGeometry(7.5, 5, 424), DM.satinAlloy || M.alu);
      shoulderBevel.position.set(sgn * 52, DECK + 154, 0);
      shoulderBevel.rotation.z = -sgn * 0.45;
      const innerBead = add(bg, new THREE.BoxGeometry(2.6, 2.5, 402), M.chrome);
      innerBead.position.set(sgn * 41.2, DECK + 165.8, 0);
      for (const pz of [-210, 210]) {
        const pillar = add(bg, new THREE.BoxGeometry(6, 107, 6), DM.billetTitanium || M.gunmetal);
        pillar.position.set(sgn * 51.5, DECK + 105.5, pz);
      }
    }
    for (const ez of [-210, 210]) {
      const badge = add(bg, new THREE.BoxGeometry(44, 3.2, 10), M.steel);
      badge.position.set(0, DECK + 166, ez);
      for (const bx of [-18, 18]) {
        const rivet = add(bg, new THREE.CylinderGeometry(1.4, 1.4, 2, 6), M.gunmetal);
        rivet.position.set(bx, DECK + 167.5, ez);
      }
    }

    // 8 perimeter silver hex bolts bolted directly onto lower head flange lip (DECK + 52)
    for (const sgn of [-1, 1]) {
      for (const bz of [-168, -56, 56, 168]) {
        const washer = add(bg, new THREE.CylinderGeometry(4.4, 4.4, 1.8, N(12)), M.steel);
        washer.position.set(sgn * 54.5, DECK + 53.2, bz);
        const bolt = add(bg, new THREE.CylinderGeometry(3.2, 3.2, 6, 6), M.gunmetal);
        bolt.position.set(sgn * 54.5, DECK + 56, bz);
      }
    }

    // Knurled / ribbed oil filler neck & cap on bank 'L' front inboard shoulder (clear of rockers, window & fuel rail)
    if (bank === 'L') {
      const fillGrp = new THREE.Group();
      fillGrp.position.set(-34, DECK + 163, 211);
      bg.add(fillGrp);
      tag(fillGrp, {
        name: 'Billet Oil Filler Neck & Cap',
        subsystem: 'Lubrication · Left Valve Cover',
        material: 'Knurled Billet / Coral-Anodized Badge',
        spec: 'Quarter-turn sealed fill cap on Left Bank front shoulder',
      });
      add(fillGrp, new THREE.CylinderGeometry(14, 17, 6, N(20)), M.alu).position.y = 2;
      add(fillGrp, new THREE.CylinderGeometry(12, 13.5, 16, N(20)), M.gunmetal).position.y = 10;
      add(fillGrp, new THREE.CylinderGeometry(17.5, 17.5, 9, N(24)), M.gunmetal).position.y = 21;
      if (!plain) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const knurl = add(fillGrp, new THREE.BoxGeometry(2.4, 9, 2.4), M.alu);
          knurl.position.set(Math.cos(a) * 17.5, 21, Math.sin(a) * 17.5);
          knurl.rotation.y = -a;
        }
      }
      add(fillGrp, new THREE.CylinderGeometry(11.5, 11.5, 2, N(20)), DM.coralHub).position.y = 26;
      const wingGrip = add(fillGrp, new THREE.BoxGeometry(32, 6.5, 7), M.alu);
      wingGrip.position.y = 27.5;
      wingGrip.rotation.y = 0.45;
    }

    // Smoked mineral-sapphire polycarbonate top inspection window (visible in GLASS & SECTION)
    const winMesh = add(bg, windowGeo, glassMat, false);
    winMesh.position.y = DECK + 160;
    winMesh.renderOrder = 4;
    glassWindows.push(winMesh);

    // Swappable contoured satin charcoal-composite LS valve cover shell & finned top lid (visible in SOLID mode)
    const lidGrp = new THREE.Group();
    lidGrp.visible = false;
    bg.add(lidGrp);
    const solidWall = add(lidGrp, upperRailGeo, compositeMat);
    solidWall.position.y = DECK + 52;
    const solidTop = add(lidGrp, solidLidGeo, compositeMat);
    solidTop.position.y = DECK + 160;
    for (let fx = -28; fx <= 28; fx += 14) {
      const fin = add(lidGrp, new THREE.BoxGeometry(3.8, 4.5, 384), fx === 0 ? DM.coralHub : M.alu);
      fin.position.set(fx, DECK + 166.5, 0);
    }
    for (const cz of [-168, -56, 56, 168]) {
      const coilBoss = add(lidGrp, new THREE.BoxGeometry(18, 6, 18), M.gunmetal);
      coilBoss.position.set((bank === 'L' ? 1 : -1) * 46, DECK + 161, cz);
      const coilBolt = add(lidGrp, new THREE.CylinderGeometry(2.4, 2.4, 4, 6), M.steel);
      coilBolt.position.set((bank === 'L' ? 1 : -1) * 46, DECK + 165, cz);
    }
    solidLids.push(lidGrp);
  }

  return {coversGrp, leftGrp: banks.L, rightGrp: banks.R, glassWindows, solidLids};
}
