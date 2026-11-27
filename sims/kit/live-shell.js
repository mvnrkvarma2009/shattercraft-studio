// Shared live runtime shell for interactive Shattercraft pages (-live).
// Handles 1600x900 stage fitting, pointer drag orbit, double-click reset, wheel & pinch zoom,
// keyboard shortcuts + '?' cheat-sheet overlay, Auto-Tour state machine (25s idle resume),
// Adaptive FPS Quality Guard (HIGH / MED / LOW), and clean UI hooks for Inspector & WebAudio.
import { warmComposer } from './warm.js';

export const STAGE_W = 1600;
export const STAGE_H = 900;
export const DEFAULT_IDLE = 25;

export const DEFAULT_TIERS = [
  { name: 'HIGH', samples: 4, ao: true, shadow: 2048, pr: 1.5 },
  { name: 'MED', samples: 4, ao: false, shadow: 2048, pr: 1.5 },
  { name: 'LOW', samples: 2, ao: false, shadow: 1024, pr: 1.25 },
];

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

const DEFAULT_SHORTCUTS = [
  ['1 – 6', 'Switch preset camera views'],
  ['SPACE', 'Pause / resume simulation'],
  ['← / →', 'Step crank / throttle / wind'],
  ['H', 'Hide / show HUD overlay'],
  ['Q', 'Cycle quality tier (HIGH / MED / LOW)'],
  ['M', 'Mute / unmute procedural WebAudio'],
  ['S', 'Download clean PNG snapshot of current view'],
  ['DBL-CLICK', 'Reset camera orbit & zoom'],
  ['ESC', 'Clear pinned part inspector / close help'],
  ['?', 'Toggle this shortcuts guide'],
];

const SHELL_CSS = (theme, chipTop) => `
html,body{background:${theme.bg};overflow:hidden}
#app{position:absolute!important;inset:auto!important;left:0;top:0;width:${STAGE_W}px;height:${STAGE_H}px;transform-origin:0 0}
#gl{position:absolute;inset:auto;display:block;touch-action:none;cursor:grab}
#gl.drag{cursor:grabbing}
.live-bar{position:absolute;left:800px;top:${chipTop}px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:5px;z-index:40;pointer-events:none;font-variant-numeric:tabular-nums}
.live-bar.hidden{display:none}
.live-pills{display:flex;align-items:center;gap:5px;pointer-events:auto}
.tourchip,.live-pill{display:flex;align-items:center;gap:6px;height:21px;padding:0 10px;border:1px solid ${theme.border};border-radius:2px;background:${theme.panel};color:${theme.ink};font:700 8.6px 'JetBrains Mono',Inter,monospace;letter-spacing:1.25px;white-space:nowrap;cursor:pointer;pointer-events:auto;user-select:none;box-shadow:0 1px 2px rgba(20,22,26,.04);transition:filter .12s ease,border-color .12s ease}
.tourchip:hover,.live-pill:hover{filter:brightness(.97);border-color:${theme.ink}}
.tourchip i{display:block;width:6px;height:6px;border-radius:50%;background:${theme.accent}}
.tourchip.on i{animation:live-blink 1.2s steps(2) infinite}
.live-pill.on{border-color:${theme.accent};color:${theme.accent}}
.live-pill .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:${theme.mute}}
.live-pill.on .dot{background:${theme.accent}}
.live-help-btn{padding:0 8px;min-width:22px;justify-content:center}
.live-tools{display:flex;align-items:center;gap:12px;height:23px;padding:0 11px;border:1px solid ${theme.border};border-radius:2px;background:${theme.panel};color:${theme.ink};font:600 8.4px 'JetBrains Mono',monospace;letter-spacing:1.15px;pointer-events:auto;box-shadow:0 1px 2px rgba(20,22,26,.04)}
.live-ctl{display:flex;align-items:center;gap:7px;white-space:nowrap}
.live-ctl label{color:${theme.mute};font-weight:700}
.live-ctl span{min-width:34px;text-align:right;color:${theme.ink};font-weight:700;font-variant-numeric:tabular-nums}
.live-ctl input[type=range]{-webkit-appearance:none;appearance:none;width:82px;height:2px;background:${theme.border};outline:none;margin:0;cursor:ew-resize}
.live-ctl input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:9px;height:11px;background:${theme.accent};border:none;border-radius:1px;cursor:ew-resize}
.live-ctl input[type=range]::-moz-range-thumb{width:9px;height:11px;background:${theme.accent};border:none;border-radius:1px;cursor:ew-resize}
.live-reset{border:1px solid ${theme.border};border-radius:2px;background:#fff;padding:1px 6px;color:${theme.ink};font:700 8px 'JetBrains Mono',monospace;letter-spacing:1px;cursor:pointer}
.live-reset:hover{border-color:${theme.accent};color:${theme.accent}}
.live-help{position:absolute;left:800px;top:145px;transform:translateX(-50%);width:420px;padding:14px 16px;border:1px solid ${theme.border};border-top:3px solid ${theme.accent};border-radius:2px;background:${theme.panel};color:${theme.ink};font-family:'JetBrains Mono',Inter,monospace;z-index:80;box-shadow:0 12px 34px rgba(16,18,22,.16);display:none;pointer-events:auto}
.live-help.open{display:block}
.live-help-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding-bottom:7px;border-bottom:1px solid ${theme.border};font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase}
.live-help-close{border:1px solid ${theme.border};background:#fff;color:${theme.ink};font:700 9px 'JetBrains Mono',monospace;padding:2px 7px;border-radius:2px;cursor:pointer}
.live-help-close:hover{border-color:${theme.accent};color:${theme.accent}}
.live-help-grid{display:grid;grid-template-columns:92px 1fr;gap:6px 12px;font-size:10px;line-height:1.4}
.live-help-k{font-weight:700;color:${theme.accent};letter-spacing:.6px}
.live-help-d{color:${theme.ink}}
.turn{position:fixed;left:0;right:0;bottom:18px;text-align:center;font:600 12px/1.4 'JetBrains Mono',monospace;letter-spacing:1px;color:${theme.mute};text-transform:uppercase;display:none}
.live-ctx{position:fixed;z-index:120;min-width:196px;padding:6px;border-radius:6px;border:1px solid ${theme.border};background:${theme.panel};box-shadow:0 16px 38px rgba(15,12,8,.22);display:none;flex-direction:column;gap:2px;font:600 11px/1.35 'JetBrains Mono',Inter,monospace;color:${theme.ink};backdrop-filter:blur(8px)}
.live-ctx.open{display:flex}
.live-ctx button{appearance:none;border:0;background:transparent;color:inherit;font:inherit;text-align:left;padding:7px 10px;border-radius:4px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:14px}
.live-ctx button:hover{background:rgba(242,106,61,.14);color:${theme.accent}}
.live-ctx kbd{font-size:9.5px;opacity:.55;font-weight:600}
@keyframes live-blink{50%{opacity:.15}}
@media (orientation:portrait) and (max-width:820px){.turn{display:block}}
`;

/**
 * Creates the shared live interactive shell around a 1600x900 Three.js stage.
 * @param {object} opts
 */
export function createLiveShell(opts = {}) {
  const app = opts.app || document.getElementById('app');
  if (!app) throw new Error('createLiveShell: #app element not found');

  let canvas = opts.canvas || app.querySelector('#gl');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'gl';
    app.appendChild(canvas);
  }

  const stage = opts.stage;
  const duration = Math.max(0.1, opts.duration || 26);
  const idleSeconds = opts.idleSeconds ?? DEFAULT_IDLE;
  const tiers = opts.tiers && opts.tiers.length ? opts.tiers : DEFAULT_TIERS;
  const chipTop = opts.chipTop ?? 56;
  const shortcuts = opts.shortcuts || DEFAULT_SHORTCUTS;
  const bounds = {
    minEl: -25,
    maxEl: 70,
    minK: 0.4,
    maxK: 2.4,
    azSign: 1,
    elSign: 1,
    ...(opts.orbitBounds || {}),
  };
  const theme = {
    bg: '#ecedef',
    border: '#e1e3e6',
    ink: '#16181b',
    mute: '#8b8f95',
    accent: '#d6182b',
    panel: 'rgba(255,255,255,0.94)',
    ...(opts.theme || {}),
  };

  const top = Number(document.body.dataset.top || 0);
  const styleEl = document.createElement('style');
  styleEl.textContent = SHELL_CSS(theme, chipTop);
  document.head.appendChild(styleEl);

  const uiRoot = opts.ui?.root || app;

  const turnNote = document.createElement('div');
  turnNote.className = 'turn';
  turnNote.textContent = 'Turn your phone sideways for the full console';
  document.body.appendChild(turnNote);

  const bar = document.createElement('div');
  bar.className = 'live-bar';
  const pills = document.createElement('div');
  pills.className = 'live-pills';
  bar.appendChild(pills);

  const goBackToStudio = () => {
    if (history.length > 1 && document.referrer) {
      history.back();
    } else {
      location.href = 'studio.html';
    }
  };

  const backChip = document.createElement('button');
  backChip.type = 'button';
  backChip.className = 'live-pill';
  backChip.dataset.testid = 'back-studio';
  backChip.title = 'Back to Studio Hub';
  backChip.textContent = '← STUDIO';
  backChip.addEventListener('pointerdown', (e) => e.stopPropagation());
  backChip.addEventListener('click', (e) => {
    e.stopPropagation();
    goBackToStudio();
  });
  pills.appendChild(backChip);

  const tourChip = document.createElement('div');
  tourChip.className = 'tourchip on';
  tourChip.setAttribute('role', 'button');
  tourChip.setAttribute('tabindex', '0');
  tourChip.dataset.testid = 'tour-chip';
  pills.appendChild(tourChip);

  const qualChip = document.createElement('button');
  qualChip.type = 'button';
  qualChip.className = 'live-pill live-qual';
  qualChip.dataset.testid = 'quality-pill';
  qualChip.title = 'Cycle rendering quality (Q)';
  pills.appendChild(qualChip);

  const soundChip = document.createElement('button');
  soundChip.type = 'button';
  soundChip.className = 'live-pill live-sound';
  soundChip.dataset.testid = 'sound-pill';
  soundChip.title = 'Toggle procedural WebAudio (M)';
  soundChip.innerHTML = '<i class="dot"></i><span>SOUND: OFF</span>';
  pills.appendChild(soundChip);

  const helpChip = document.createElement('button');
  helpChip.type = 'button';
  helpChip.className = 'live-pill live-help-btn';
  helpChip.dataset.testid = 'help-pill';
  helpChip.title = 'Keyboard shortcuts (?)';
  helpChip.textContent = '?';
  pills.appendChild(helpChip);

  const showTools = opts.showTools !== false;
  const hasCutPlane = opts.hasCutPlane !== false;
  const tools = document.createElement('div');
  tools.className = 'live-tools';
  if (!showTools) tools.style.display = 'none';

  const expWrap = document.createElement('div');
  expWrap.className = 'live-ctl';
  expWrap.innerHTML = `<label for="live-explode">EXPLODE</label><input id="live-explode" data-testid="explode-slider" type="range" min="0" max="1" step="0.01" value="0"><span data-val="explode">0%</span>`;
  tools.appendChild(expWrap);

  let cutInput = null;
  let cutValEl = null;
  if (hasCutPlane) {
    const cutWrap = document.createElement('div');
    cutWrap.className = 'live-ctl';
    cutWrap.innerHTML = `<label for="live-cut">SECTION</label><input id="live-cut" data-testid="cut-slider" type="range" min="-1" max="1" step="0.01" value="0"><span data-val="cut">0.00</span>`;
    tools.appendChild(cutWrap);
    cutInput = cutWrap.querySelector('#live-cut');
    cutValEl = cutWrap.querySelector('[data-val="cut"]');
  }

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'live-reset';
  resetBtn.dataset.testid = 'reset-inspector';
  resetBtn.textContent = 'RESET';
  tools.appendChild(resetBtn);
  bar.appendChild(tools);
  uiRoot.appendChild(bar);

  // Keyboard shortcuts cheat-sheet overlay
  const helpModal = document.createElement('div');
  helpModal.className = 'live-help';
  helpModal.dataset.testid = 'help-modal';
  helpModal.setAttribute('role', 'dialog');
  helpModal.setAttribute('aria-hidden', 'true');
  helpModal.innerHTML = `
    <div class="live-help-hdr">
      <span>KEYBOARD &amp; INTERACTION SHORTCUTS</span>
      <button type="button" class="live-help-close" data-testid="help-close">ESC</button>
    </div>
    <div class="live-help-grid">
      ${shortcuts.map(([k, d]) => `<span class="live-help-k">${k}</span><span class="live-help-d">${d}</span>`).join('')}
    </div>`;
  uiRoot.appendChild(helpModal);

  const expInput = expWrap.querySelector('#live-explode');
  const expValEl = expWrap.querySelector('[data-val="explode"]');

  // ------------------------------------------------------------ state
  const lightDevice = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
  let tier = typeof opts.initialTier === 'number' ? clamp(opts.initialTier, 0, tiers.length - 1) : lightDevice ? tiers.length - 1 : 0;
  let manualTier = false;
  let scale = 1;
  let fitReady = false;

  let T = 0;
  let lastInput = 0;
  let hidden = false;
  let helpOpen = false;
  let explode = 0;
  let cutOffset = 0;
  let soundOn = false;
  const off = { az: 0, el: 0, k: 1 };
  const AP = { on: true, t0: 0, loop: 0 };

  let inspector = opts.inspector || null;
  let audio = opts.audio || null;

  const tierLabel = (i) => tiers[i]?.name || ['HIGH', 'MED', 'LOW'][i] || `T${i + 1}`;

  const fit = () => {
    const h = innerHeight - top;
    scale = Math.min(innerWidth / STAGE_W, h / STAGE_H);
    app.style.transform = `translate(${(innerWidth - STAGE_W * scale) / 2}px, ${top + (h - STAGE_H * scale) / 2}px) scale(${scale})`;
    const glW = Math.max(STAGE_W, innerWidth / (scale || 1));
    const glH = Math.max(STAGE_H, h / (scale || 1));
    canvas.style.inset = 'auto';
    canvas.style.left = `${-(glW - STAGE_W) / 2}px`;
    canvas.style.top = `${-(glH - STAGE_H) / 2}px`;
    canvas.style.width = `${glW}px`;
    canvas.style.height = `${glH}px`;
    if (stage?.resize) {
      const prMax = tiers[tier]?.pr ?? 2;
      stage.resize(glW, glH, clamp((devicePixelRatio || 1) * scale, 0.75, prMax));
    }
  };

  const applyTier = () => {
    const tObj = tiers[tier];
    const { pr, name, ...q } = tObj;
    void pr;
    void name;
    stage?.setQuality?.(q);
    qualChip.textContent = `Q: ${tierLabel(tier)}`;
    qualChip.dataset.tier = tierLabel(tier);
    opts.onQualityChange?.(tier, tObj);
    if (fitReady) fit();
  };

  applyTier();
  fit();
  fitReady = true;
  addEventListener('resize', fit);

  const toStage = (cx, cy) => {
    const r = app.getBoundingClientRect();
    return [(cx - r.left) / (scale || 1), (cy - r.top) / (scale || 1)];
  };

  // ------------------------------------------------------------ auto-tour state machine
  const renderTourChip = () => {
    tourChip.classList.toggle('on', AP.on);
    tourChip.innerHTML = AP.on ? '<i></i>AUTO TOUR · CLICK TO TAKE OVER' : '▶ RESUME TOUR';
  };
  renderTourChip();

  const touch = () => {
    lastInput = T;
  };

  const resetOrbit = () => {
    Object.assign(off, { az: 0, el: 0, k: 1 });
  };

  const startTour = () => {
    AP.on = true;
    AP.t0 = T;
    AP.loop = 0;
    resetOrbit();
    renderTourChip();
    opts.onStartTour?.();
  };

  const takeOver = () => {
    lastInput = T;
    if (!AP.on) return;
    const cyc = (T - AP.t0) % duration;
    AP.on = false;
    renderTourChip();
    opts.onTakeOver?.(cyc);
  };

  tourChip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    lastInput = T;
    if (AP.on) takeOver();
    else startTour();
  });

  const setHelpOpen = (open) => {
    helpOpen = !!open;
    helpModal.classList.toggle('open', helpOpen);
    helpModal.setAttribute('aria-hidden', helpOpen ? 'false' : 'true');
    helpChip.classList.toggle('on', helpOpen);
  };

  helpChip.addEventListener('pointerdown', (e) => e.stopPropagation());
  helpChip.addEventListener('click', (e) => {
    e.stopPropagation();
    setHelpOpen(!helpOpen);
  });
  helpModal.addEventListener('pointerdown', (e) => e.stopPropagation());
  helpModal.querySelector('[data-testid="help-close"]').addEventListener('click', (e) => {
    e.stopPropagation();
    setHelpOpen(false);
  });

  addEventListener('pointerdown', (e) => {
    if (helpOpen && !helpModal.contains(e.target) && e.target !== helpChip) {
      setHelpOpen(false);
    }
    if (bar.contains(e.target) || helpModal.contains(e.target)) return;
    takeOver();
  });

  // ------------------------------------------------------------ quality, sound, explode, cut controls
  const setQuality = (idx, isManual = true) => {
    tier = clamp(idx, 0, tiers.length - 1);
    if (isManual) manualTier = true;
    applyTier();
  };

  qualChip.addEventListener('pointerdown', (e) => e.stopPropagation());
  qualChip.addEventListener('click', (e) => {
    e.stopPropagation();
    setQuality((tier + 1) % tiers.length, true);
  });

  const syncSoundUI = () => {
    soundChip.classList.toggle('on', soundOn);
    soundChip.innerHTML = `<i class="dot"></i><span>SOUND: ${soundOn ? 'ON' : 'OFF'}</span>`;
  };

  const setSound = async (on) => {
    const next = !!on;
    if (audio?.setEnabled) {
      soundOn = await audio.setEnabled(next);
    } else {
      soundOn = next;
    }
    syncSoundUI();
    opts.onSoundToggle?.(soundOn);
    return soundOn;
  };

  soundChip.addEventListener('pointerdown', (e) => e.stopPropagation());
  soundChip.addEventListener('click', (e) => {
    e.stopPropagation();
    void setSound(!soundOn);
  });

  const syncExplodeUI = (v) => {
    explode = clamp(v, 0, 1);
    expInput.value = explode.toFixed(2);
    expValEl.textContent = `${Math.round(explode * 100)}%`;
  };

  const setExplode = (v) => {
    syncExplodeUI(v);
    inspector?.setExplode?.(explode);
    opts.onExplode?.(explode);
    return explode;
  };

  const syncCutUI = (v) => {
    cutOffset = clamp(v, -1, 1);
    if (cutInput) cutInput.value = cutOffset.toFixed(2);
    if (cutValEl) cutValEl.textContent = `${cutOffset >= 0 ? '+' : ''}${cutOffset.toFixed(2)}`;
  };

  const setCutPlane = (v) => {
    syncCutUI(v);
    inspector?.setCutPlane?.(cutOffset);
    opts.onCutPlane?.(cutOffset);
    return cutOffset;
  };

  expInput.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    takeOver();
  });
  expInput.addEventListener('input', () => {
    lastInput = T;
    setExplode(parseFloat(expInput.value));
  });

  if (cutInput) {
    cutInput.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      takeOver();
    });
    cutInput.addEventListener('input', () => {
      lastInput = T;
      setCutPlane(parseFloat(cutInput.value));
    });
  }

  resetBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    takeOver();
    setExplode(0);
    setCutPlane(0);
    resetOrbit();
    inspector?.clearSelection?.();
  });

  const setHidden = (h) => {
    hidden = !!h;
    if (opts.ui?.root) opts.ui.root.style.display = hidden ? 'none' : '';
    bar.classList.toggle('hidden', hidden);
    if (hidden) setHelpOpen(false);
    inspector?.setVisible?.(!hidden);
  };

  // ------------------------------------------------------------ pointer orbit, dblclick reset, pinch-touch, wheel, picking
  const pointers = new Map();
  let dragMoved = false;
  let downPos = null;
  let wasTourActive = false;
  let pinchDist0 = 0;

  const pairDist = () => {
    const pts = [...pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  };

  canvas.addEventListener('dblclick', (e) => {
    e.preventDefault();
    takeOver();
    resetOrbit();
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button === 3) {
      e.preventDefault();
      goBackToStudio();
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_) { }
    if (pointers.size === 1) {
      downPos = { x: e.clientX, y: e.clientY };
      dragMoved = false;
      wasTourActive = AP.on;
      canvas.classList.add('drag');
    } else if (pointers.size === 2) {
      dragMoved = true;
      pinchDist0 = pairDist();
      takeOver();
    }
  });

  // Custom CAD context menu on right-click (replaces browser <canvas> "Save image as" menu without Back)
  const ctxMenu = document.createElement('div');
  ctxMenu.className = 'live-ctx';
  ctxMenu.innerHTML = [
    '<button type="button" data-ctx="back"><span>← Back to Studio</span><kbd>BACK</kbd></button>',
    '<button type="button" data-ctx="reset"><span>Reset Camera</span><kbd>R</kbd></button>',
    '<button type="button" data-ctx="snap"><span>Save Snapshot PNG</span><kbd>S</kbd></button>',
    '<button type="button" data-ctx="hud"><span>Toggle HUD</span><kbd>H</kbd></button>',
  ].join('');
  document.body.appendChild(ctxMenu);
  const closeCtx = () => ctxMenu.classList.remove('open');
  ctxMenu.addEventListener('pointerdown', (e) => e.stopPropagation());
  ctxMenu.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset?.ctx;
    closeCtx();
    if (act === 'back') goBackToStudio();
    else if (act === 'reset') { takeOver(); resetOrbit(); }
    else if (act === 'snap') {
      try {
        const a = document.createElement('a');
        a.download = `${document.title || 'shattercraft'}-snapshot.png`;
        a.href = canvas.toDataURL('image/png');
        a.click();
      } catch (_) { }
    } else if (act === 'hud') setHidden(!hidden);
  });
  addEventListener('pointerdown', closeCtx);
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const mw = 204;
    const mh = 148;
    const x = Math.min(e.clientX, Math.max(8, innerWidth - mw - 8));
    const y = Math.min(e.clientY, Math.max(8, innerHeight - mh - 8));
    ctxMenu.style.left = `${x}px`;
    ctxMenu.style.top = `${y}px`;
    ctxMenu.classList.add('open');
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 3) {
      e.preventDefault();
      goBackToStudio();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) {
      const [sx, sy] = toStage(e.clientX, e.clientY);
      inspector?.hoverAtClient?.(e.clientX, e.clientY);
      opts.onHoverCanvas?.(sx, sy, e.clientX, e.clientY, e);
      return;
    }

    const prev = pointers.get(e.pointerId);
    const dxPx = e.clientX - prev.x;
    const dyPx = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const d = pairDist();
      if (pinchDist0 > 4 && d > 4) {
        const ratio = pinchDist0 / d;
        off.k = clamp(off.k * ratio, bounds.minK, bounds.maxK);
        pinchDist0 = d;
        lastInput = T;
      }
      return;
    }

    if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) {
      dragMoved = true;
    }
    if (dragMoved) {
      takeOver();
      off.az += (dxPx / (scale || 1)) * 0.3 * bounds.azSign;
      off.el = clamp(off.el + (dyPx / (scale || 1)) * 0.2 * bounds.elSign, bounds.minEl, bounds.maxEl);
      lastInput = T;
    }
  });

  const endPointer = (e, isUp) => {
    const had = pointers.has(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist0 = 0;
    if (pointers.size === 0) {
      canvas.classList.remove('drag');
      if (isUp && had && !dragMoved) {
        const [sx, sy] = toStage(e.clientX, e.clientY);
        if (!wasTourActive) inspector?.pickAtClient?.(e.clientX, e.clientY);
        opts.onClickCanvas?.(sx, sy, e.clientX, e.clientY, e);
      }
      downPos = null;
      dragMoved = false;
      wasTourActive = false;
    }
  };

  canvas.addEventListener('pointerup', (e) => endPointer(e, true));
  canvas.addEventListener('pointercancel', (e) => endPointer(e, false));
  canvas.addEventListener('pointerleave', () => {
    if (pointers.size === 0) inspector?.clearHover?.();
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.15) return;
      e.preventDefault();
      takeOver();
      off.k = clamp(off.k * Math.exp(e.deltaY * 0.0012), bounds.minK, bounds.maxK);
    },
    { passive: false },
  );

  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const targetTag = e.target?.tagName;
    if (targetTag === 'INPUT' && e.target !== expInput && e.target !== cutInput) return;

    const key = e.key.toLowerCase();
    if (key === 'escape') {
      if (helpOpen) setHelpOpen(false);
      else inspector?.clearSelection?.();
      return;
    }
    if (e.key === '?' || (key === '/' && e.shiftKey)) {
      setHelpOpen(!helpOpen);
      e.preventDefault();
      return;
    }

    const handled = opts.onKey?.(key, e);
    if (handled === true || e.defaultPrevented) return;

    if (key === 'h') setHidden(!hidden);
    else if (key === 'q') setQuality((tier + 1) % tiers.length, true);
    else if (key === 'm') void setSound(!soundOn);
    else if (key === 's') {
      try {
        const a = document.createElement('a');
        a.download = `${document.title || 'shattercraft'}-snapshot.png`;
        a.href = canvas.toDataURL('image/png');
        a.click();
      } catch (_) { }
    } else if (key === 'r') {
      takeOver();
      resetOrbit();
    } else return;
    e.preventDefault();
  });

  // ------------------------------------------------------------ frame + Adaptive FPS Quality Guard
  const perf = { n: 0, sum: 0, slow: 0, age: 0 };
  const stepPerf = (dt) => {
    if (manualTier || tier >= tiers.length - 1) return;
    perf.age += dt;
    if (perf.age <= 6.0) return;
    perf.sum += dt;
    perf.n++;
    if (perf.sum >= 0.7 && perf.n >= 10) {
      perf.slow = perf.sum / perf.n > 0.075 ? perf.slow + 1 : 0;
      perf.sum = 0;
      perf.n = 0;
      if (perf.slow >= 6) {
        tier++;
        applyTier();
        Object.assign(perf, { age: 0, slow: 0 });
      }
    }
  };

  let rafId = 0;
  let running = false;
  const start = async (frameFn) => {
    if (running) return;
    running = true;
    startTour();
    if (stage?.renderer && stage?.composer && stage?.scene && stage?.camera) {
      await warmComposer(stage.renderer, stage.composer, stage.scene, stage.camera);
    }
    let last = performance.now();
    const tick = (now) => {
      if (!running) return;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      T += dt;
      stepPerf(dt);

      let cyc = 0;
      let loop = 0;
      if (AP.on) {
        const c = T - AP.t0;
        loop = Math.floor(c / duration);
        cyc = c - loop * duration;
        if (loop > AP.loop) AP.loop = loop;
      } else if (T - lastInput > idleSeconds) {
        startTour();
      }

      const state = {
        T,
        dt,
        apOn: AP.on,
        cyc,
        loop: AP.loop,
        off,
        tier,
        tierName: tierLabel(tier),
        scale,
        explode,
        cutOffset,
        soundOn,
        hidden,
        helpOpen,
      };

      frameFn?.(state);
      inspector?.sync?.();

      if (!window.SIM_SHOWN) {
        window.SIM_SHOWN = true;
        dispatchEvent(new Event('simframe'));
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  };

  const stop = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const connectInspector = (insp) => {
    inspector = insp;
    if (inspector) {
      inspector.setExplode?.(explode);
      inspector.setCutPlane?.(cutOffset);
    }
  };

  const connectAudio = (aud) => {
    audio = aud;
    if (audio) syncSoundUI();
  };

  return {
    app,
    canvas,
    bar,
    tourChip,
    qualChip,
    soundChip,
    helpChip,
    helpModal,
    explodeInput: expInput,
    cutInput,
    off,
    AP,
    toStage,
    fit,
    startTour,
    takeOver,
    touch,
    resetOrbit,
    setQuality,
    setSound,
    setExplode,
    syncExplodeUI,
    setCutPlane,
    syncCutUI,
    setHidden,
    setHelpOpen,
    connectInspector,
    connectAudio,
    stepPerf,
    start,
    stop,
    get tier() {
      return tier;
    },
    get tierName() {
      return tierLabel(tier);
    },
    get T() {
      return T;
    },
    get scale() {
      return scale;
    },
    get explode() {
      return explode;
    },
    get cutOffset() {
      return cutOffset;
    },
    get soundOn() {
      return soundOn;
    },
    get hidden() {
      return hidden;
    },
    get helpOpen() {
      return helpOpen;
    },
  };
}
