// Shattercraft Studio Hub — Unified Editorial Broadsheet Hub anchored by Originkit cta-04 hero,
// with real rendered 3D CAD cover visuals for SIM-01 V8, SIM-02 Strandbeest, and SIM-03 GTF-1200 Turbofan.
import v8CoverUrl from './v8-cover.js';
import strandbeestCoverUrl from './strandbeest-cover.js';
import turbofanCoverUrl from './turbofan-cover.js';
import { attachFlickerText } from '../kit/flicker-text.js';
import { mountPaperlineArchive } from './paperline-archive.js';

document.title = 'Shattercraft Studio — Master Project';

const MASTER_V8 = {
  id: 'v8',
  code: 'SIM-01 · MASTER PROJECT · POWERTRAIN',
  tag: '90° CROSS-PLANE',
  name: 'V8 · Four-Stroke Engine',
  accent: '#f26a3d',
  bg: '#f4efe6',
  cover: v8CoverUrl,
  coverLabel: 'LIVE 3D SIMULATOR · CROSS-RAM EFI · 4-INTO-1 · SERPENTINE · BOOST',
  coverAlt: 'V8 Cross-Plane Four-Stroke Engine 3D CAD Studio Render',
  liveHref: 'v8-live.html',
  filmHref: 'v8-film.html',
  filmDur: '26.0 s',
  desc: 'Museum-grade cross-plane V8 featuring cutaway cross-ram dual-plenum intake with 8 sequential EFI injectors, 4-into-1 tubular merge collectors, CNC spoked 24T→72T→48T helical timing drive & serpentine belt circuit, GLSL volumetric combustion, stencil section caps, and interactive +0.8 bar forced induction physics.',
  highlights: [
    'Cutaway Cross-Ram EFI',
    '4-Into-1 Merge Headers',
    'Serpentine + Spoked 2:1',
    'GLSL Spark + +0.8 Bar Boost',
    'Stencil Section Caps',
    'Cross-Plane V8 WebAudio',
  ],
  specs: [
    ['DISPLACEMENT', '5.8 L · 101.6 × 89 mm'],
    ['INDUCTION', 'Cross-Ram · +0.8 Bar Boost'],
    ['FIRING ORDER', '1-8-4-3-6-5-7-2'],
    ['OUTPUT', '492→665 Nm · 300–8000 RPM'],
  ],
};

const MACHINES = [
  {
    id: 'strandbeest',
    code: 'SIM-02 · KINEMATICS',
    tag: 'JANSEN 1990',
    name: 'Strandbeest SB-10 Walker',
    accent: '#d47431',
    bg: '#efe5d6',
    cover: strandbeestCoverUrl,
    coverLabel: 'LIVE 3D SIMULATOR · 20 JANSEN LEGS · DUNE / SLATE STUDIO',
    coverAlt: 'Strandbeest SB-10 Wind-Powered Walker 3D Studio Render',
    liveHref: 'strandbeest-live.html',
    filmHref: 'strandbeest-film.html',
    filmDur: '30.7 s',
    desc: 'Wind-powered beach walker driven by 10 sails and a 10-throw crankshaft (36° phase wave) actuating 20 mirrored 11-bar Theo Jansen linkages over simulated dune sand with Dune/Slate palettes.',
    specs: [
      ['LEG COUNT', '20 · 10 Stations × 2'],
      ['LINKAGE', '11 Holy Numbers / Leg'],
      ['STRIDE / LIFT', '672 mm · 268 mm Lift'],
      ['WIND DRIVE', '0–16 m/s · 155° Stance'],
    ],
  },
  {
    id: 'turbofan',
    code: 'SIM-03 · PROPULSION',
    tag: '3.06:1 GEARED',
    name: 'GTF-1200 Geared Turbofan',
    accent: '#f26a3d',
    bg: '#f2ece3',
    cover: turbofanCoverUrl,
    coverLabel: 'LIVE 3D SIMULATOR · 18-BLADE FAN · 3.06:1 PLANETARY · DUAL-SPOOL',
    coverAlt: 'GTF-1200 Dual-Spool Geared Turbofan 3D CAD Studio Render',
    liveHref: 'turbofan-live.html',
    filmHref: 'turbofan-film.html',
    filmDur: '26.0 s',
    desc: 'Dual-spool high-bypass geared turbofan with an 18-blade swept titanium fan, exposed 3.06:1 star planetary reduction gearbox, concentric LPC/HPC/HPT/LPT spools, annular combustor plasma, and Brayton scrubber.',
    specs: [
      ['BYPASS / GEAR', '12.0 : 1 · 3.06 : 1 Star'],
      ['SPOOL SPEEDS', 'N1 3,400 · N2 10,400 RPM'],
      ['THRUST RANGE', '8 – 145 kN (IDLE → TOGA)'],
      ['ARCHITECTURE', '1-3-6 Comp · 2-4 Turb'],
    ],
  },
];

const CONTROLS = [
  ['DRAG / DBL-CLICK', 'Orbit azimuth/elevation; double-click canvas to reset camera'],
  ['WHEEL / PINCH', 'Zoom smoothly between macro detail and full assembly'],
  ['HOVER / CLICK 3D', 'Inspect parts with real-time live telemetry tooltip'],
  ['EXPLODE SLIDER', '0–100% assembly separation along mechanical axes'],
  ['SECTION SLIDER', 'Scrub stencil-capped cross-section cut plane'],
  ['CHART SCRUB', 'Drag V8 Valve Timing, Strandbeest Wind, or Turbofan Brayton'],
  ['Q: HIGH / MED / LOW', 'Adaptive FPS Quality Guard + manual quality tier toggle'],
  ['SOUND / ? HELP', 'Mutes/unmutes procedural WebAudio; press ? for shortcuts'],
];

const CLI_DOCS = [
  ['npm run build', 'Bundle studio.html and all -live / -film standalone HTML pages into shattercraft-out/dist/'],
  ['npm run studio', 'Serve shattercraft-out/dist/ over HTTP with / mapped to studio.html'],
  ['npm test', 'Run headless Playwright build, WebGL, layout, and interactive control verification'],
  ['node sims/capture.mjs turbofan-film --stills beats', 'Render deterministic 60 fps film MP4 or contact-sheet stills'],
];

const app = document.getElementById('app');
app.innerHTML = `
  <section class="cta-04" data-testid="studio-hero-cta" aria-label="Shattercraft Studio Dispatch">
    <div class="cta04-topbar">
      <span class="cta04-chip credit"><i></i>MADE BY <span data-flicker-nv>NAGENDRA VARMA</span></span>
      <div class="cta04-nav">
        <a class="cta04-chip cta04-link" href="https://github.com/mvnrkvarma2009" target="_blank" rel="noopener noreferrer">GITHUB ↗</a>
        <a class="cta04-chip cta04-link" href="https://www.linkedin.com/in/nagendra-varma-mudunuri-4366103a5?utm_source=share_via&utm_content=profile&utm_medium=member_android" target="_blank" rel="noopener noreferrer">LINKEDIN ↗</a>
        <a class="cta04-chip cta04-link" href="mailto:nagendravarma0307@gmail.com">nagendravarma0307@gmail.com</a>
      </div>
    </div>

    <div class="news">
      <p class="meta">
        Zero-Dependency 3D CAD
        <span></span>
        3 Interactive Editions + 3 Films
      </p>
      <h1 class="cta04-h">SHATTERCRAFT <span class="cta04-h-studio">STUDIO</span></h1>
      <p class="cta04-sub">Three mechanical worlds, built in pure code.</p>
      <p class="lede">
        Explore real-time cross-plane combustion kinematics, 11-bar Theo Jansen linkages, and dual-spool turbine thermodynamics—with stencil section cutaways, X-Ray view, and procedural WebAudio.
      </p>
      <div class="cta04-launchbar" role="navigation" aria-label="Simulator Quick Launch">
        <a class="cta04-pill primary" href="${MASTER_V8.liveHref}">Launch V8 Engine →</a>
        <a class="cta04-pill" href="strandbeest-live.html">Strandbeest</a>
        <a class="cta04-pill" href="turbofan-live.html">GTF-1200 Turbofan</a>
        <a class="cta04-pill" href="#machines">Browse Catalog ↓</a>
      </div>
      <p class="proof" id="cta04-note">
        Press <b>1</b>, <b>2</b>, or <b>3</b> anywhere to launch live · <a href="#controls">Controls &amp; shortcuts</a>
      </p>
      <div class="issue">
        <div id="cta04-front" aria-label="Shattercraft Studio Dispatch broadsheet"></div>
      </div>
    </div>
  </section>

  <main class="studio-shell">
    <div class="st-section-head" id="machines">
      <div>
        <div class="st-kicker">EDITION INDEX · 3 INTERACTIVE BUILDS + 3 CINEMATIC FILMS</div>
        <div class="st-section-title">Master Project &amp; Simulator Editions</div>
      </div>
      <p class="st-section-note">
        Self-contained single-file builds with live thermodynamic &amp; kinematic telemetry, stencil caps, and procedural sound.
      </p>
    </div>

    <article class="mc-featured" data-machine="v8" style="--mc-accent:${MASTER_V8.accent};--mc-bg:${MASTER_V8.bg}">
      <div class="mc-top"></div>
      <div class="mc-featured-body">
        <div class="mc-featured-info">
          <div class="mc-head">
            <div class="mc-code">
              <span>${MASTER_V8.code}</span>
              <span class="mc-pill-master">MASTER PROJECT</span>
            </div>
            <h2 class="mc-name">${MASTER_V8.name}</h2>
            <p class="mc-desc">${MASTER_V8.desc}</p>
          </div>
          <div class="mc-highlights">
            ${MASTER_V8.highlights.map((h) => `<span class="mc-hl-chip">${h}</span>`).join('')}
          </div>
          <div class="mc-specs">
            ${MASTER_V8.specs.map(([k, v]) => `<div><div class="mc-spec-k">${k}</div><div class="mc-spec-v">${v}</div></div>`).join('')}
          </div>
          <div class="mc-actions">
            <a class="btn btn-primary" data-testid="launch-v8-live" href="${MASTER_V8.liveHref}">Launch V8 Live →</a>
            <button type="button" class="btn btn-film" data-film="${MASTER_V8.filmHref}" data-title="${MASTER_V8.name} · Master Film (${MASTER_V8.filmDur})">▶ Master Film</button>
            <a class="btn" href="${MASTER_V8.filmHref}" title="Open standalone V8 film page">↗</a>
          </div>
        </div>
        <div class="mc-featured-preview">
          <span class="mc-preview-label">${MASTER_V8.coverLabel}</span>
          <img class="mc-cover-img" src="${MASTER_V8.cover}" alt="${MASTER_V8.coverAlt}" />
        </div>
      </div>
    </article>

    <section class="st-grid" aria-label="Additional Simulators">
      ${MACHINES.map(
  (m) => `
        <article class="mc-card" data-machine="${m.id}" style="--mc-accent:${m.accent};--mc-bg:${m.bg}">
          <div class="mc-top"></div>
          <div class="mc-head">
            <div class="mc-code"><span>${m.code}</span><span class="tag">${m.tag}</span></div>
            <h2 class="mc-name">${m.name}</h2>
            <p class="mc-desc">${m.desc}</p>
          </div>
          <div class="mc-preview">
            <span class="mc-preview-label">${m.coverLabel}</span>
            <img class="mc-cover-img" src="${m.cover}" alt="${m.coverAlt}" />
          </div>
          <div class="mc-specs">
            ${m.specs.map(([k, v]) => `<div><div class="mc-spec-k">${k}</div><div class="mc-spec-v">${v}</div></div>`).join('')}
          </div>
          <div class="mc-actions">
            <a class="btn btn-primary" data-testid="launch-${m.id}-live" href="${m.liveHref}">Launch Live →</a>
            <button type="button" class="btn btn-film" data-film="${m.filmHref}" data-title="${m.name} · Film (${m.filmDur})">▶ Film</button>
            <a class="btn" href="${m.filmHref}" title="Open standalone film page">↗</a>
          </div>
        </article>`,
).join('')}
    </section>

    <section class="st-lower" id="controls">
      <div class="st-box">
        <h2>Interactive Controls &amp; Shortcuts</h2>
        <div class="ctl-grid">
          ${CONTROLS.map(([k, d]) => `<div class="ctl-item"><span class="ctl-key">${k}</span><span class="ctl-desc">${d}</span></div>`).join('')}
        </div>
      </div>
      <div class="st-box">
        <h2>Build &amp; Capture Workflow</h2>
        <div class="cli-list">
          ${CLI_DOCS.map(([cmd, desc]) => `<div class="cli-row"><code>${cmd}</code><span>${desc}</span></div>`).join('')}
        </div>
      </div>
    </section>

    <footer class="st-footer">
      <span>SHATTERCRAFT STUDIO HUB · <b>MADE BY <span data-flicker-nv>NAGENDRA VARMA</span></b> · PRESS 1 / 2 / 3 TO LAUNCH</span>
      <div class="st-footer-links">
        <a class="st-footer-link" href="https://github.com/mvnrkvarma2009" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
        <a class="st-footer-link" href="https://www.linkedin.com/in/nagendra-varma-mudunuri-4366103a5?utm_source=share_via&utm_content=profile&utm_medium=member_android" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>
        <a class="st-footer-link" href="mailto:nagendravarma0307@gmail.com">nagendravarma0307@gmail.com</a>
      </div>
    </footer>
  </main>

  <div class="film-modal" data-testid="film-modal" role="dialog" aria-modal="true" aria-hidden="true">
    <div class="film-dialog">
      <div class="film-bar">
        <span data-film-title>FILM PREVIEW</span>
        <button type="button" class="btn" data-film-close style="height:28px;padding:0 12px">✕ Close</button>
      </div>
      <iframe class="film-frame" data-film-frame src="about:blank" title="Film Preview"></iframe>
    </div>
  </div>
`;

const modal = app.querySelector('.film-modal');
const modalTitle = app.querySelector('[data-film-title]');
const modalFrame = app.querySelector('[data-film-frame]');
const closeModal = () => {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  modalFrame.src = 'about:blank';
};
app.querySelectorAll('[data-film]').forEach((btn) => {
  btn.addEventListener('click', () => {
    modalTitle.textContent = btn.dataset.title || 'FILM PREVIEW';
    modalFrame.src = btn.dataset.film;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  });
});
app.querySelector('[data-film-close]').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

const heroFrontEl = document.getElementById('cta04-front');
if (heroFrontEl) {
  mountPaperlineArchive(heroFrontEl, {
    title: 'The Shattercraft Times',
    text: 'Pure Code\nLive Machines',
    ink: '#141110',
    paper: '#F4F2EC',
    background: '#F4F2EC',
    size: 80,
    speed: 52,
    hold: 18000,
    dryness: 45,
    pageScale: 104,
    pageAlign: 'top',
  });
}

addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.key === 'Escape' && modal.classList.contains('open')) return closeModal();
  if (modal.classList.contains('open') || e.metaKey || e.ctrlKey || e.altKey) return;
  const href = { 1: 'v8-live.html', 2: 'strandbeest-live.html', 3: 'turbofan-live.html' }[e.key];
  if (href) location.href = href;
});

app.querySelectorAll('[data-flicker-nv]').forEach((el) => {
  attachFlickerText(el, { color: getComputedStyle(el).color || '#fff6ec' });
});
