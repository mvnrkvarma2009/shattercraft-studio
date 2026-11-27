// Universal Part Inspector, Explode Displacement, and Cut Plane controller for Shattercraft live pages.
// - Raycasts scene meshes on hover/click, ignoring floor/shadow planes and invisible hitboxes.
// - Reads mesh.userData.part ({name, subsystem, material, spec, liveSpec}) or parent group names.
// - Supports dynamic live telemetry via part.liveSpec(part, obj, instanceId) or opts.getLiveSpec(part, obj, instanceId).
// - Renders a floating engineering tooltip + non-invasive 3D highlight proxy mesh.
// - Supports universal radial/axial Explode (0..1) from saved rest positions and Cut Plane offset (-1..1).
import * as THREE from 'three';

const V3 = THREE.Vector3;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

const INSPECTOR_CSS = (theme) => `
.insp-tip{position:absolute;left:0;top:0;min-width:205px;max-width:310px;padding:9px 11px;border:1px solid ${theme.border};border-left:3px solid ${theme.accent};border-radius:3px;background:${theme.panel};color:${theme.ink};font-family:'JetBrains Mono',Inter,monospace;pointer-events:none;z-index:60;box-shadow:0 4px 16px rgba(0,0,0,.12);opacity:0;transition:opacity .1s ease;font-variant-numeric:tabular-nums}
.insp-tip.on{opacity:1}
.insp-sub{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:8.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${theme.accent};margin-bottom:3px}
.insp-pin{padding:1px 4px;border:1px solid ${theme.accent};font-size:7.5px;border-radius:2px}
.insp-close{pointer-events:auto;cursor:pointer;background:transparent;color:${theme.accent};font:inherit;font-size:7.5px;font-weight:700;letter-spacing:1.1px;line-height:1.2;padding:2px 5px}
.insp-tip:not(.on) .insp-close{pointer-events:none}
.insp-close:hover{background:${theme.accent};color:#fff}
.insp-name{font-family:Inter,system-ui,sans-serif;font-size:13px;font-weight:700;line-height:1.25;color:${theme.ink};margin-bottom:5px}
.insp-meta{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:9px;line-height:1.4;color:${theme.mute}}
.insp-meta b{color:${theme.ink};font-weight:600}
.insp-live{margin-top:6px;padding-top:5px;border-top:1px dashed ${theme.border};font-size:9px;line-height:1.4;color:${theme.accent};font-weight:700;letter-spacing:.4px}
.insp-live:empty{display:none}
`;

function isVisibleBranch(obj) {
  let cur = obj;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  return true;
}

function isIgnoredMesh(obj) {
  if (!obj.isMesh) return true;
  if (obj.userData?.ignoreInspect || obj.userData?.isFloor) return true;
  if (obj.userData?.part || obj.userData?.parts || obj.userData?.getPart) return false;

  const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  if (!mat) return true;
  if (mat.isShadowMaterial) return true;
  if (mat.isShaderMaterial) return true;
  if (mat.transparent && mat.opacity <= 0.03) return true;

  if (obj.geometry?.type === 'PlaneGeometry') {
    const p = obj.geometry.parameters;
    if (p && (p.width >= 8 || p.height >= 8)) return true;
  }
  return false;
}

function normalizePart(p) {
  if (typeof p === 'string') return {name: p, subsystem: 'COMPONENT', material: '', spec: '', liveSpec: null};
  return {
    name: p.name || 'Component',
    subsystem: p.subsystem || 'ASSEMBLY',
    material: p.material || '',
    spec: p.spec || p.dimensions || '',
    liveSpec: p.liveSpec ?? null,
    id: p.id ?? null,
    meta: p.meta ?? null,
  };
}

function resolvePartInfo(hit, rootLimit) {
  const obj = hit.object;
  if (!obj) return null;

  if (typeof obj.userData?.getPart === 'function') {
    const info = obj.userData.getPart(hit.instanceId, hit);
    if (info) return normalizePart(info);
  }
  if (obj.userData?.parts && hit.instanceId != null && obj.userData.parts[hit.instanceId]) {
    return normalizePart(obj.userData.parts[hit.instanceId]);
  }
  if (obj.userData?.part) {
    return normalizePart(obj.userData.part);
  }

  let cur = obj;
  while (cur && cur !== rootLimit?.parent) {
    if (cur.userData?.part) return normalizePart(cur.userData.part);
    cur = cur.parent;
  }

  cur = obj;
  let fallbackName = '';
  let subsystem = 'MECHANICAL ASSEMBLY';
  while (cur && cur !== rootLimit?.parent) {
    if (cur.name && !fallbackName) fallbackName = cur.name;
    else if (cur.name && cur.name !== fallbackName) {
      subsystem = cur.name;
      break;
    }
    cur = cur.parent;
  }
  const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  return {
    name: fallbackName || 'Assembly Component',
    subsystem,
    material: mat?.name || '',
    spec: '',
    liveSpec: null,
  };
}

function formatLiveValue(val) {
  if (val == null || val === false || val === '') return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    return val
      .map((item) => {
        if (Array.isArray(item)) return `${item[0]}: ${item[1]}`;
        if (item && typeof item === 'object') return item.label ? `${item.label}: ${item.value}` : String(item.value ?? '');
        return String(item);
      })
      .filter(Boolean)
      .join(' · ');
  }
  if (typeof val === 'object') {
    if ('value' in val) return val.label ? `${val.label}: ${val.value}` : String(val.value ?? '');
    return Object.entries(val)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  }
  return String(val);
}

/**
 * Creates a part inspector + universal explode + cut-plane controller.
 * @param {object} opts
 */
export function createInspector(opts) {
  const {
    scene,
    camera,
    root = scene,
    domParent = document.getElementById('app'),
    stageSize = {w: 1600, h: 900},
    toStage = null,
    accent = '#d6182b',
    explodeScale = 0.35,
    universalExplode = typeof opts.onExplode !== 'function',
    cutAxis = 'z',
    cutRange = null,
    clipPlane = null,
    getLiveSpec = null,
    onExplode = null,
    onCutPlane = null,
    onHover = null,
    onSelect = null,
    filter = null,
  } = opts;

  const theme = {
    border: '#d9dce0',
    ink: '#16181b',
    mute: '#6f747c',
    accent,
    panel: 'rgba(255,255,255,0.95)',
    ...(opts.theme || {}),
  };

  const styleEl = document.createElement('style');
  styleEl.textContent = INSPECTOR_CSS(theme);
  document.head.appendChild(styleEl);

  const tip = document.createElement('div');
  tip.className = 'insp-tip';
  tip.dataset.testid = 'inspector-tooltip';
  tip.addEventListener('pointerdown', (e) => {
    if (e.target?.closest?.('[data-testid="inspector-unpin"]')) e.stopPropagation();
  });
  tip.addEventListener('click', (e) => {
    if (e.target?.closest?.('[data-testid="inspector-unpin"]')) {
      e.stopPropagation();
      clearSelection();
      clearHover();
    }
  });
  domParent?.appendChild(tip);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // Non-invasive highlight proxy mesh rendered over the hovered/selected mesh
  const hiMat = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  const hiGeoEmpty = new THREE.BufferGeometry();
  const hiMesh = new THREE.Mesh(hiGeoEmpty, hiMat);
  hiMesh.visible = false;
  hiMesh.frustumCulled = false;
  hiMesh.castShadow = false;
  hiMesh.receiveShadow = false;
  hiMesh.renderOrder = 999;
  hiMesh.matrixAutoUpdate = false;
  hiMesh.userData.ignoreInspect = true;
  scene.add(hiMesh);

  let hovered = null;
  let selected = null;
  let visible = true;
  let explode = 0;
  let cutOffset = 0;
  let lastTipKey = '';
  let lastLiveText = '';
  let liveEl = null;

  const tmpMat4 = new THREE.Matrix4();
  const tmpInstMat4 = new THREE.Matrix4();
  const tmpV = new V3();

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const computeLiveText = (active) => {
    if (!active) return '';
    const p = active.part;
    let raw = null;
    if (typeof p.liveSpec === 'function') raw = p.liveSpec(p, active.mesh, active.instanceId);
    else if (p.liveSpec != null) raw = p.liveSpec;
    if (raw == null && typeof getLiveSpec === 'function') {
      raw = getLiveSpec(p, active.mesh, active.instanceId);
    }
    return formatLiveValue(raw);
  };

  const syncHighlight = () => {
    const active = selected || hovered;
    if (!visible || !active || !active.mesh || !isVisibleBranch(active.mesh)) {
      hiMesh.visible = false;
      return;
    }
    const target = active.mesh;
    if (hiMesh.geometry !== target.geometry) {
      hiMesh.geometry = target.geometry;
    }
    target.updateWorldMatrix(true, false);
    if (target.isInstancedMesh && active.instanceId != null && active.instanceId < target.count) {
      target.getMatrixAt(active.instanceId, tmpInstMat4);
      tmpMat4.multiplyMatrices(target.matrixWorld, tmpInstMat4);
      hiMesh.matrixWorld.copy(tmpMat4);
    } else {
      hiMesh.matrixWorld.copy(target.matrixWorld);
    }
    hiMesh.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, hiMesh.matrixWorld);

    const tMat = Array.isArray(target.material) ? target.material[0] : target.material;
    const planes = tMat?.clippingPlanes || null;
    if (hiMat.clippingPlanes !== planes) {
      hiMat.clippingPlanes = planes;
      hiMat.needsUpdate = true;
    }
    hiMat.opacity = selected ? 0.32 : 0.22;
    hiMesh.visible = true;
  };

  hiMesh.onBeforeRender = (_r, _s, cam) => {
    const active = selected || hovered;
    if (!active || !active.mesh) return;
    const target = active.mesh;
    if (target.isInstancedMesh && active.instanceId != null && active.instanceId < target.count) {
      target.getMatrixAt(active.instanceId, tmpInstMat4);
      hiMesh.matrixWorld.multiplyMatrices(target.matrixWorld, tmpInstMat4);
    } else {
      hiMesh.matrixWorld.copy(target.matrixWorld);
    }
    hiMesh.modelViewMatrix.multiplyMatrices(cam.matrixWorldInverse, hiMesh.matrixWorld);
  };

  const renderTooltip = () => {
    const active = selected || hovered;
    if (!visible || !active) {
      tip.classList.remove('on');
      tip.innerHTML = '';
      liveEl = null;
      lastTipKey = '';
      lastLiveText = '';
      return;
    }
    const p = active.part;
    const isPinned = !!selected;
    const tipKey = `${active.mesh.uuid}:${active.instanceId ?? ''}:${isPinned ? 1 : 0}:${p.name}:${p.subsystem}:${p.material}:${p.spec}`;
    if (tipKey !== lastTipKey) {
      lastTipKey = tipKey;
      const rows = [];
      if (p.material) rows.push(`<span>MAT</span><b>${esc(p.material)}</b>`);
      if (p.spec) rows.push(`<span>SPEC</span><b>${esc(p.spec)}</b>`);
      tip.innerHTML = `<div class="insp-sub"><span>${esc(p.subsystem)}</span>${isPinned ? '<button type="button" class="insp-pin insp-close" data-testid="inspector-unpin" title="Unpin part (ESC)">PINNED ×</button>' : ''}</div>
        <div class="insp-name">${esc(p.name)}</div>
        ${rows.length ? `<div class="insp-meta">${rows.join('')}</div>` : ''}
        <div class="insp-live" data-testid="inspector-live"></div>`;
      liveEl = tip.querySelector('.insp-live');
      lastLiveText = '';
    }

    const liveText = computeLiveText(active);
    if (liveEl && liveText !== lastLiveText) {
      lastLiveText = liveText;
      liveEl.textContent = liveText;
    }
    tip.classList.add('on');

    let sx = active.stageX;
    let sy = active.stageY;
    if (sx == null || sy == null) {
      active.mesh.getWorldPosition(tmpV);
      tmpV.project(camera);
      const canvas = opts.renderer?.domElement || opts.canvas || opts.sceneDom;
      const gw = canvas?.offsetWidth || stageSize.w;
      const gh = canvas?.offsetHeight || stageSize.h;
      sx = (tmpV.x * 0.5 + 0.5) * gw - (gw - stageSize.w) * 0.5;
      sy = (-tmpV.y * 0.5 + 0.5) * gh - (gh - stageSize.h) * 0.5;
    }
    const tw = tip.offsetWidth || 220;
    const th = tip.offsetHeight || 72;
    const x = clamp(sx + 18, 14, stageSize.w - tw - 14);
    const y = clamp(sy + 18, 14, stageSize.h - th - 14);
    tip.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  };

  const clientToStage = (cx, cy) => {
    if (toStage) return toStage(cx, cy);
    if (!domParent) return [cx, cy];
    const r = domParent.getBoundingClientRect();
    return [((cx - r.left) / (r.width || 1)) * stageSize.w, ((cy - r.top) / (r.height || 1)) * stageSize.h];
  };

  const raycastClient = (cx, cy) => {
    const dom = opts.renderer?.domElement || opts.canvas || opts.sceneDom;
    let rect;
    if (dom) rect = dom.getBoundingClientRect();
    else if (domParent) rect = domParent.getBoundingClientRect();
    else return null;

    if (rect.width < 1 || rect.height < 1) return null;
    ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    const hits = raycaster.intersectObject(root, true);
    for (const hit of hits) {
      const obj = hit.object;
      if (!isVisibleBranch(obj)) continue;
      if (isIgnoredMesh(obj)) continue;
      if (filter && !filter(obj, hit)) continue;
      const part = resolvePartInfo(hit, root);
      if (!part) continue;
      const [stageX, stageY] = clientToStage(cx, cy);
      return {mesh: obj, instanceId: hit.instanceId ?? null, part, hit, stageX, stageY};
    }
    return null;
  };

  const hoverAtClient = (cx, cy) => {
    const res = raycastClient(cx, cy);
    hovered = res;
    syncHighlight();
    renderTooltip();
    onHover?.(res?.part || null, res);
    return res?.part || null;
  };

  const pickAtClient = (cx, cy) => {
    const res = raycastClient(cx, cy);
    if (!res) {
      selected = null;
      hovered = null;
      syncHighlight();
      renderTooltip();
      onSelect?.(null, null);
      return null;
    }
    const sameAsSelected =
      selected &&
      selected.mesh.uuid === res.mesh.uuid &&
      (selected.instanceId ?? null) === (res.instanceId ?? null);
    if (sameAsSelected) {
      selected = null;
      hovered = res;
      syncHighlight();
      renderTooltip();
      onSelect?.(null, null);
      return null;
    }
    selected = res;
    hovered = res;
    syncHighlight();
    renderTooltip();
    onSelect?.(res.part, res);
    return res.part;
  };

  const clearHover = () => {
    hovered = null;
    syncHighlight();
    renderTooltip();
    onHover?.(null, null);
  };

  const clearSelection = () => {
    selected = null;
    syncHighlight();
    renderTooltip();
    onSelect?.(null, null);
  };

  // ------------------------------------------------------------ universal Explode
  let cachedCentroid = null;
  let cachedBox = null;

  const ensureBounds = () => {
    if (cachedBox) return cachedBox;
    root.updateWorldMatrix(true, true);
    cachedBox = new THREE.Box3().setFromObject(root);
    cachedCentroid = new V3();
    cachedBox.getCenter(cachedCentroid);
    return cachedBox;
  };

  const applyUniversalExplode = (k) => {
    ensureBounds();
    const boxSize = new V3();
    cachedBox.getSize(boxSize);
    const diag = Math.max(0.1, boxSize.length());

    const targets = [];
    root.traverse((obj) => {
      if (obj === root) return;
      if (obj.userData?.ignoreInspect || obj.userData?.isFloor) return;
      if (obj.userData?.explodeVec) {
        targets.push(obj);
        return;
      }
      if (obj.isMesh && !isIgnoredMesh(obj) && !obj.parent?.userData?.explodeVec) {
        targets.push(obj);
      }
    });

    const pBox = new THREE.Box3();
    const pCenter = new V3();
    for (const obj of targets) {
      if (!obj.userData._restPos) {
        obj.userData._restPos = obj.position.clone();
      }
      let vec = obj.userData._autoExplodeVec;
      if (obj.userData.explodeVec) {
        const ev = obj.userData.explodeVec;
        vec = Array.isArray(ev) ? new V3(ev[0], ev[1], ev[2]) : ev.clone();
      } else if (!vec) {
        pBox.setFromObject(obj);
        pBox.getCenter(pCenter);
        vec = pCenter.clone().sub(cachedCentroid);
        if (vec.lengthSq() < 1e-6) vec.set(0, 1, 0);
        else vec.normalize().multiplyScalar(diag * explodeScale);
        obj.userData._autoExplodeVec = vec;
      }
      obj.position.copy(obj.userData._restPos).addScaledVector(vec, k);
    }
  };

  const setExplode = (k) => {
    explode = clamp01(k);
    if (universalExplode) applyUniversalExplode(explode);
    onExplode?.(explode);
    return explode;
  };

  // ------------------------------------------------------------ Cut Plane offset
  const getCutWorldConstant = (offset) => {
    if (cutRange) {
      const [lo, hi] = cutRange;
      return lo + ((offset + 1) * 0.5) * (hi - lo);
    }
    const b = ensureBounds();
    const minV = b.min[cutAxis];
    const maxV = b.max[cutAxis];
    const span = Math.max(0.05, maxV - minV);
    return (minV + maxV) * 0.5 + offset * (span * 0.55);
  };

  const setCutPlane = (offset) => {
    cutOffset = clamp(offset, -1, 1);
    const worldConst = getCutWorldConstant(cutOffset);
    if (clipPlane) clipPlane.constant = worldConst;
    onCutPlane?.(cutOffset, worldConst);
    return cutOffset;
  };

  const setVisible = (v) => {
    visible = !!v;
    syncHighlight();
    renderTooltip();
  };

  const dispose = () => {
    scene.remove(hiMesh);
    hiGeoEmpty.dispose();
    hiMat.dispose();
    tip.remove();
    styleEl.remove();
  };

  return {
    hoverAtClient,
    pickAtClient,
    clearHover,
    clearSelection,
    setExplode,
    getExplode: () => explode,
    setCutPlane,
    getCutPlane: () => cutOffset,
    setVisible,
    sync: () => {
      syncHighlight();
      if (visible && (hovered || selected)) renderTooltip();
    },
    getSelected: () => selected?.part || null,
    getHovered: () => hovered?.part || null,
    dispose,
  };
}
