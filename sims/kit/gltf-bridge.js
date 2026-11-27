// Helper to load .glb assemblies via Three.js GLTFLoader, normalize scale & grounding
// into studio coordinates, enable shadows, tag meshes with userData.part metadata,
// and inject shared clipping planes for interactive section cutaways.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const V3 = THREE.Vector3;

function resolveGlbUrl(source) {
  if (typeof source !== 'string') return source;
  if (source.startsWith('url:')) return source.slice(4);
  if (source.startsWith('data:') || source.startsWith('http') || source.startsWith('/') || source.endsWith('.glb') || source.endsWith('.gltf')) {
    return source;
  }
  // esbuild base64 loader returns raw base64 for .glb imports
  return `data:model/gltf-binary;base64,${source}`;
}

/**
 * Tags meshes under `root` with `userData.part = {name, subsystem, material, spec}`.
 * `partMap` may map exact mesh/group names (or case-insensitive substrings) to metadata.
 */
export function tagMeshParts(root, partMap = {}) {
  const tagged = [];
  const entries = Object.entries(partMap);
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    let meta = partMap[obj.name] || null;
    if (!meta && obj.parent?.name && partMap[obj.parent.name]) {
      meta = partMap[obj.parent.name];
    }
    if (!meta && entries.length) {
      const hay = `${obj.name} ${obj.parent?.name || ''}`.toLowerCase();
      for (const [k, v] of entries) {
        if (hay.includes(k.toLowerCase())) {
          meta = v;
          break;
        }
      }
    }
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const part = {
      name: meta?.name || obj.name || obj.parent?.name || 'Assembly Part',
      subsystem: meta?.subsystem || obj.parent?.name || 'GLTF ASSEMBLY',
      material: meta?.material || mat?.name || 'Standard PBR',
      spec: meta?.spec || '',
    };
    obj.userData.part = part;
    if (meta?.explodeVec) obj.userData.explodeVec = meta.explodeVec;
    tagged.push({mesh: obj, part});
  });
  return tagged;
}

/**
 * Injects or clears a shared clipping plane across every material in `root`.
 */
export function applyClippingPlane(root, plane, enabled = true) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      if (!m.userData._origSide) m.userData._origSide = m.side;
      m.clippingPlanes = enabled && plane ? [plane] : null;
      m.side = enabled && plane ? THREE.DoubleSide : m.userData._origSide;
      m.needsUpdate = true;
    }
  });
}

/**
 * Loads a .glb assembly, normalizes scale and grounding, enables shadows, tags parts,
 * and configures a shared section clipping plane.
 * @param {string} source URL, `url:<path>`, or base64 GLB payload
 * @param {object} [opts]
 */
export async function loadGLB(source, opts = {}) {
  const {
    targetSize = 1.0,
    groundY = 0,
    centerXZ = true,
    castShadow = true,
    receiveShadow = true,
    partMap = {},
    clipPlane = new THREE.Plane(new V3(0, 0, -1), 0),
    clipEnabled = false,
    loader = new GLTFLoader(),
  } = opts;

  const url = resolveGlbUrl(source);
  const gltf = await loader.loadAsync(url);

  const root = new THREE.Group();
  root.name = opts.name || 'GLBAssembly';
  const model = gltf.scene || gltf.scenes[0];
  root.add(model);

  // Normalize scale to studio units and ground onto y = groundY
  model.updateWorldMatrix(true, true);
  const rawBox = new THREE.Box3().setFromObject(model);
  const rawSize = new V3();
  const rawCenter = new V3();
  rawBox.getSize(rawSize);
  rawBox.getCenter(rawCenter);

  const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z, 1e-4);
  const scale = targetSize > 0 ? targetSize / maxDim : 1;
  model.scale.multiplyScalar(scale);
  model.updateWorldMatrix(true, true);

  const scaledBox = new THREE.Box3().setFromObject(model);
  const scaledCenter = new V3();
  scaledBox.getCenter(scaledCenter);

  if (centerXZ) {
    model.position.x -= scaledCenter.x;
    model.position.z -= scaledCenter.z;
  }
  model.position.y += groundY - scaledBox.min.y;
  root.updateWorldMatrix(true, true);

  const bounds = new THREE.Box3().setFromObject(root);
  const size = new V3();
  const center = new V3();
  bounds.getSize(size);
  bounds.getCenter(center);

  const meshes = [];
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = castShadow;
    obj.receiveShadow = receiveShadow;
    meshes.push(obj);
  });

  const parts = tagMeshParts(root, partMap);
  applyClippingPlane(root, clipPlane, clipEnabled);

  let isClipOn = clipEnabled;
  const setClipEnabled = (on) => {
    isClipOn = !!on;
    applyClippingPlane(root, clipPlane, isClipOn);
  };
  const setCutPlane = (offset, axis = 'z') => {
    const minV = bounds.min[axis];
    const maxV = bounds.max[axis];
    clipPlane.constant = (minV + maxV) * 0.5 + offset * Math.max(0.05, maxV - minV) * 0.55;
    if (!isClipOn) setClipEnabled(true);
  };

  const dispose = () => {
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m?.dispose?.();
    });
  };

  return {
    root,
    model,
    gltf,
    meshes,
    parts,
    bounds,
    size,
    center,
    scale,
    clipPlane,
    setClipEnabled,
    setCutPlane,
    dispose,
  };
}
