// Originkit Flicker Text (adapted cleanly from Originkit OutlineFillText into vanilla DOM/JS).
// Supports:
// - Enter trigger (`textEnterFlickerEnabled`): 2s easeInOut letter-opacity flicker (intensity 10, 30% opacity)
// - Hover trigger (`textHoverFlickerEnabled`): 2s easeInOut word + letter flicker (flickerCount 3, 30% opacity)
// - Deterministic capture-safe mode (`window.__CAPTURE`): keeps static filled typography clean during frame capture
// - Preserves continuous textContent / innerText for automated assertions & screen readers

function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = sampleX(t) - x;
      const d = sampleDX(t);
      if (Math.abs(dx) < 1e-6 || d === 0) break;
      t -= dx / d;
    }
    return sampleY(Math.max(0, Math.min(1, t)));
  };
}

function makeEaseFn(ease) {
  if (Array.isArray(ease) && ease.length === 4) {
    return cubicBezier(ease[0], ease[1], ease[2], ease[3]);
  }
  switch (ease) {
    case 'easeIn':
      return (t) => t * t;
    case 'easeOut':
      return (t) => 1 - (1 - t) * (1 - t);
    case 'easeInOut':
      return (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
    default:
      return (t) => t;
  }
}

function generateTimings(count, totalMs, easeCurve) {
  const fn = makeEaseFn(easeCurve);
  const intervals = [];
  let prev = 0;
  for (let i = 1; i <= count; i++) {
    const cur = fn(i / count) * totalMs;
    intervals.push(Math.max(0, cur - prev));
    prev = cur;
  }
  return intervals;
}

function buildVisibleItems(cfg) {
  const sc = Math.min(cfg.strokeCount ?? 1, cfg.flickerCount);
  if (!cfg.showStroke) return Array(cfg.flickerCount).fill('filled');
  const fillCount = Math.max(1, cfg.flickerCount - sc);
  const strokes = Array(sc).fill('outline');
  if (cfg.strokePosition === 'start') return [...strokes, ...Array(fillCount).fill('filled')];
  if (cfg.strokePosition === 'end') return [...Array(fillCount - 1).fill('filled'), ...strokes, 'filled'];
  const before = Math.floor(fillCount / 2);
  return [...Array(before).fill('filled'), ...strokes, ...Array(fillCount - before).fill('filled')];
}

const DEFAULT_ENTER_CFG = {
  duration: 2,
  easeCurve: 'easeInOut',
  flickerCount: 10,
  showStroke: false,
  strokePosition: 'start',
  strokeCount: 1,
  strokeWidth: 1.5,
  restState: 'filled',
  delay: 0,
  wordFlickerEnabled: false,
  letterFlickerEnabled: true,
  letterFlickerMode: 'opacity',
  letterFlickerIntensity: 10,
  letterFlickerOpacity: 30,
};

const DEFAULT_HOVER_CFG = {
  duration: 2,
  easeCurve: 'easeInOut',
  flickerCount: 3,
  showStroke: false,
  strokePosition: 'start',
  strokeCount: 1,
  strokeWidth: 1.5,
  restState: 'filled',
  delay: 0,
  wordFlickerEnabled: true,
  letterFlickerEnabled: true,
  letterFlickerMode: 'opacity',
  letterFlickerIntensity: 10,
  letterFlickerOpacity: 30,
};

/**
 * Attaches Originkit Flicker Text behavior (enter letter-opacity flicker + hover word/letter flicker)
 * onto an existing element or replaces its text with interactive per-character spans.
 * @param {HTMLElement} el
 * @param {object} [opts]
 */
export function attachFlickerText(el, opts = {}) {
  if (!el) return null;
  const text = opts.text ?? el.textContent ?? 'NAGENDRA VARMA';
  const fillColor = opts.color || 'inherit';
  const enterCfg = {...DEFAULT_ENTER_CFG, ...(opts.enter || {})};
  const hoverCfg = {...DEFAULT_HOVER_CFG, ...(opts.hover || {})};
  const enterEnabled = opts.enterEnabled !== false;
  const hoverEnabled = opts.hoverEnabled !== false;

  // Keep original text crisp & deterministic during frame capture
  if (typeof window !== 'undefined' && window.__CAPTURE) {
    el.textContent = text;
    return {destroy() {}};
  }

  el.textContent = '';
  el.style.display = el.style.display || 'inline-block';
  el.style.pointerEvents = 'auto';
  el.style.cursor = hoverEnabled ? 'default' : el.style.cursor;
  el.style.letterSpacing = el.style.letterSpacing || '-0.02em';

  const chars = [...text];
  const nonSpaceIndices = [];
  const spans = chars.map((ch, i) => {
    const sp = document.createElement('span');
    sp.textContent = ch;
    sp.style.display = 'inline';
    sp.style.transition = 'none';
    if (ch.trim() !== '') nonSpaceIndices.push(i);
    el.appendChild(sp);
    return sp;
  });

  let timers = [];
  let hasPlayed = false;
  let enterDone = !enterEnabled;
  let currentPhase = enterCfg.restState;
  let flickerLetters = new Set();

  const clearTimers = () => {
    for (const id of timers) clearTimeout(id);
    timers = [];
  };

  const applyStyles = (cfg) => {
    const phaseColor =
      currentPhase === 'invisible'
        ? 'transparent'
        : currentPhase === 'outline'
          ? 'transparent'
          : fillColor;
    el.style.color = phaseColor;
    el.style.webkitTextFillColor = phaseColor;
    el.style.webkitTextStroke =
      currentPhase === 'outline' ? `${cfg.strokeWidth}px ${fillColor}` : '0px transparent';

    const dimOp = String((cfg.letterFlickerOpacity ?? 30) / 100);
    for (let i = 0; i < spans.length; i++) {
      const active =
        cfg.letterFlickerEnabled &&
        (currentPhase === 'filled' || currentPhase === 'outline') &&
        flickerLetters.has(i);
      spans[i].style.opacity = active ? dimOp : '';
    }
  };

  const runAnimation = (cfg) => {
    clearTimers();
    flickerLetters = new Set();
    if (!cfg.wordFlickerEnabled && !cfg.letterFlickerEnabled) return;

    const totalMs = cfg.duration * 1000;
    const scheduleTicks = (windowStart, windowDuration) => {
      if (!cfg.letterFlickerEnabled || nonSpaceIndices.length === 0) return;
      const cycleDuration = Math.round(
        1000 * Math.pow(50 / 1000, ((cfg.letterFlickerIntensity ?? 10) - 1) / 19),
      );
      const sub1 = Math.round(cycleDuration / 3);
      const sub2 = Math.round((2 * cycleDuration) / 3);
      const windowEnd = windowStart + windowDuration;
      let tickCursor = windowStart;

      while (tickCursor < windowEnd) {
        const t1 = tickCursor;
        const tFill = tickCursor + sub1;
        const t2 = tickCursor + sub2;
        const picked = new Set();
        const count = Math.min(nonSpaceIndices.length, Math.floor(Math.random() * 2) + 1);
        const pool = [...nonSpaceIndices];
        for (let k = 0; k < count; k++) {
          const rIdx = Math.floor(Math.random() * pool.length);
          picked.add(pool.splice(rIdx, 1)[0]);
        }
        timers.push(
          setTimeout(() => {
            flickerLetters = picked;
            applyStyles(cfg);
          }, t1),
        );
        if (tFill < windowEnd) {
          timers.push(
            setTimeout(() => {
              flickerLetters = new Set();
              applyStyles(cfg);
            }, tFill),
          );
        }
        if (t2 < windowEnd) {
          timers.push(
            setTimeout(() => {
              flickerLetters = picked;
              applyStyles(cfg);
            }, t2),
          );
        }
        tickCursor += cycleDuration;
      }
      timers.push(
        setTimeout(() => {
          flickerLetters = new Set();
          applyStyles(cfg);
        }, windowEnd),
      );
    };

    if (cfg.wordFlickerEnabled) {
      currentPhase = cfg.restState;
      applyStyles(cfg);
      const sequence = [];
      for (const item of buildVisibleItems(cfg)) {
        sequence.push('invisible', item);
      }
      const intervals = generateTimings(sequence.length, totalMs, cfg.easeCurve);
      let cursor = cfg.delay * 1000;
      const phaseSlots = [];
      sequence.forEach((phase, i) => {
        const startMs = cursor;
        const durationMs = intervals[i] ?? 0;
        phaseSlots.push({phase, startMs, durationMs});
        timers.push(
          setTimeout(() => {
            currentPhase = phase;
            applyStyles(cfg);
          }, startMs),
        );
        cursor += durationMs;
      });
      timers.push(
        setTimeout(() => {
          currentPhase = cfg.restState;
          flickerLetters = new Set();
          applyStyles(cfg);
        }, cursor),
      );
      for (const slot of phaseSlots) {
        if (slot.phase === 'filled' || slot.phase === 'outline') {
          scheduleTicks(slot.startMs, slot.durationMs);
        }
      }
    } else {
      currentPhase = cfg.restState;
      applyStyles(cfg);
      scheduleTicks(cfg.delay * 1000, totalMs);
    }
  };

  let observer = null;
  if (enterEnabled && typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!hasPlayed) {
              hasPlayed = true;
              enterDone = false;
              runAnimation(enterCfg);
              const doneTimer = setTimeout(() => {
                enterDone = true;
              }, (enterCfg.delay + enterCfg.duration) * 1000);
              timers.push(doneTimer);
            }
          } else {
            hasPlayed = false;
            enterDone = false;
            clearTimers();
            flickerLetters = new Set();
            currentPhase = enterCfg.restState;
            applyStyles(enterCfg);
          }
        }
      },
      {threshold: 0},
    );
    observer.observe(el);
  } else if (enterEnabled) {
    hasPlayed = true;
    runAnimation(enterCfg);
    timers.push(
      setTimeout(() => {
        enterDone = true;
      }, (enterCfg.delay + enterCfg.duration) * 1000),
    );
  }

  const onEnter = () => {
    if (!hoverEnabled) return;
    if (enterEnabled && !enterDone) return;
    runAnimation(hoverCfg);
  };
  el.addEventListener('mouseenter', onEnter);

  return {
    triggerHover: onEnter,
    destroy() {
      clearTimers();
      observer?.disconnect();
      el.removeEventListener('mouseenter', onEnter);
    },
  };
}
