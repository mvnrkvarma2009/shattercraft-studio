// The GTF-1200 Geared Turbofan stage: pale grey museum studio (#f3f3f4 -> #e3e4e6), soft floor shadow,
// 5-box studio PMREM with front-fill + cool rear rim, GTAO with clippingPlanes sync & aoSkip, VSM shadows,
// and stencil-capped longitudinal section cutaways.
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {Pass} from 'three/addons/postprocessing/Pass.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {buildTurbofan} from './turbofan.js';

const V3 = THREE.Vector3;
export const BG = {top: '#f3f3f4', mid: '#e9eaec', low: '#e3e4e6'};

export function createTurbofanStage({canvas, look = {}}) {
  const lo = !!look.lo;
  const hard = look.shadow === 'hard';
  const engineOpts = lo ? (look.engine || {}) : {caps: '#d4d7dc', ...(look.engine || {})};

  const renderer = new THREE.WebGLRenderer({canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance'});
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = lo ? THREE.BasicShadowMap : hard ? THREE.PCFShadowMap : THREE.VSMShadowMap;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 512;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, BG.top);
    gr.addColorStop(0.55, BG.mid);
    gr.addColorStop(1, BG.low);
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
  }

  const camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.05, 80);
  const BASE_FOV = camera.fov;
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(4, 4, {type: THREE.HalfFloatType, samples: lo ? 0 : 8, stencilBuffer: !!engineOpts.caps}),
  );
  composer.addPass(new RenderPass(scene, camera));

  const gtao = new GTAOPass(scene, camera, 4, 4);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = look.ao ?? 0.72;
  gtao.updateGtaoMaterial({radius: 0.14, distanceExponent: 1.4, thickness: 0.8, scale: 1.0, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false});
  gtao.updatePdMaterial({lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16});

  class Toggle extends Pass {
    constructor(fn) {
      super();
      this.needsSwap = false;
      this.fn = fn;
    }
    render() {
      this.fn();
    }
  }
  const aoSkip = (on) => {
    shade.visible = on;
    if (eng.cap) eng.cap.visible = on;
  };
  composer.addPass(new Toggle(() => aoSkip(false)));
  composer.addPass(gtao);
  composer.addPass(new Toggle(() => aoSkip(true)));
  if (lo) gtao.enabled = false;
  composer.addPass(new OutputPass());

  if (!lo) {
    const env = new THREE.Scene();
    env.background = new THREE.Color('#d9dadd');
    const box = (w, h, pos, k, tint = '#ffffff') => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({color: new THREE.Color(tint).multiplyScalar(k), side: THREE.DoubleSide}),
      );
      m.position.copy(pos);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    box(12, 12, new V3(0, 14, 2), 2.6);
    if (look.studio !== 'plain') {
      box(3, 14, new V3(-12, 4, 6), 3.4);
      box(3, 14, new V3(12, 4, -4), 2.2);
      box(18, 2, new V3(0, 2, 14), 1.6);
      box(16, 4, new V3(0, -1.5, 11), 1.35);
      box(14, 5, new V3(0, 8, -10), 2.4, '#e6eefc');
    }
    const g = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({color: '#c9cacd', side: THREE.DoubleSide}));
    g.rotation.x = -Math.PI / 2;
    g.position.y = -2;
    env.add(g);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.02).texture;
    scene.environmentIntensity = 1.0;
    pm.dispose();
  }

  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(-2.4, 6.2, 3.4);
  sun.target.position.set(0, 0, -0.2);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, {left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 0.5, far: 16});
  sun.shadow.mapSize.set(hard || lo ? 2048 : 4096, hard || lo ? 2048 : 4096);
  sun.shadow.radius = hard ? 1 : 14;
  sun.shadow.blurSamples = 24;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.002;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight('#ffffff', '#cfd0d3', lo ? 2.2 : 0.74));

  const FLOOR_Y = -1.16;
  const shade = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 36),
    new THREE.ShadowMaterial({color: '#5d636c', opacity: 0.24, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8}),
  );
  shade.rotation.x = -Math.PI / 2;
  shade.position.y = FLOOR_Y;
  shade.receiveShadow = true;
  shade.userData.isFloor = true;
  scene.add(shade);

  const eng = buildTurbofan(engineOpts);
  scene.add(eng.root);
  if (eng.cap) scene.add(eng.cap);

  const size = {w: 1600, h: 900};
  const resize = (w, h, pr) => {
    size.w = w;
    size.h = h;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    const aspect = w / h;
    camera.fov = aspect < 16 / 9 ? Math.min(54, (2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) * ((16 / 9) / aspect)) * 180) / Math.PI) : BASE_FOV;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  };

  const frame = (state, cam, ops = {}) => {
    eng.update(state, ops);
    const {tx, ty, tz, az, el, d} = cam;
    camera.position.set(tx + d * Math.cos(el) * Math.sin(az), ty + d * Math.sin(el), tz + d * Math.cos(el) * Math.cos(az));
    camera.lookAt(tx, ty, tz);
    camera.setViewOffset(size.w, size.h, -(cam.sx ?? 0), -(cam.sy ?? 0), size.w, size.h);
    camera.updateMatrixWorld();
    composer.render();
  };

  const pv = new V3();
  const project = (x, y, z) => {
    pv.set(x, y, z).project(camera);
    if (pv.z > 1) return null;
    return [(pv.x * 0.5 + 0.5) * size.w - (size.w - 1600) * 0.5, (-pv.y * 0.5 + 0.5) * size.h - (size.h - 900) * 0.5];
  };

  const setQuality = ({samples, ao, shadow}) => {
    if (samples !== undefined) {
      for (const t of [composer.renderTarget1, composer.renderTarget2]) {
        t.samples = samples;
        t.dispose();
      }
    }
    if (ao !== undefined) gtao.enabled = ao;
    if (shadow !== undefined) {
      sun.shadow.mapSize.set(shadow, shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  };

  const setCut = (mode, distWorld = 0, normal) => {
    eng.setCut(mode, distWorld, normal);
    gtao.normalMaterial.clippingPlanes = mode === 'section' ? [eng.CLIP] : null;
    gtao.normalMaterial.needsUpdate = true;
  };

  return {renderer, scene, camera, eng, composer, gtao, sun, resize, frame, project, size, FLOOR_Y, setQuality, setCut};
}
