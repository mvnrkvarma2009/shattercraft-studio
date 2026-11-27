#!/usr/bin/env node
/**
 * End-to-end verification suite for Shattercraft built HTML targets.
 * Tests offline (file://) and HTTP (serve.mjs) rendering, HUD bounds,
 * WebGL non-blank rendering, and live interactive features at 1600x900 and 1280x720.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CHROMIUM, CHROMIUM_ARGS, DIST, playwright} from '../paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {chromium} = playwright();

const EXPECTED_FILES = [
  'studio.html',
  'v8-live.html',
  'v8-film.html',
  'strandbeest-live.html',
  'strandbeest-film.html',
  'turbofan-live.html',
  'turbofan-film.html',
];

const LIVE_PAGES = ['v8-live.html', 'strandbeest-live.html', 'turbofan-live.html'];
const FILM_PAGES = ['v8-film.html', 'strandbeest-film.html', 'turbofan-film.html'];
const VIEWPORTS = [
  {width: 1600, height: 900},
  {width: 1280, height: 720},
];

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const {port} = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
}

async function waitForHttp(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startServeMjs() {
  const servePath = path.join(ROOT, 'serve.mjs');
  if (!fs.existsSync(servePath)) {
    throw new Error(`Missing ${servePath}`);
  }
  const port = await getFreePort();
  const child = spawn(process.execPath, [servePath, '--port', String(port), '--no-open'], {
    cwd: ROOT,
    env: {...process.env, PORT: String(port), NO_OPEN: '1'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (d) => (logs += d.toString()));
  child.stderr.on('data', (d) => (logs += d.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(`${baseUrl}/studio.html`, 8000);
  } catch (err) {
    child.kill();
    throw new Error(`serve.mjs failed to start on ${baseUrl}: ${err.message}\n${logs}`);
  }
  return {
    baseUrl,
    stop: () =>
      new Promise((resolve) => {
        if (child.killed || child.exitCode !== null) return resolve();
        child.once('exit', resolve);
        child.kill();
        setTimeout(resolve, 1500);
      }),
  };
}

/**
 * Samples pixels from the WebGL canvas via 2D drawImage(canvas) or screenshot fallback
 * to verify non-blank rendering and visual variance.
 */
async function checkWebGLNonBlank(page) {
  const stats = await page.evaluate(() => {
    const glCanvas = document.querySelector('#gl') || document.querySelector('canvas');
    if (!glCanvas) return {ok: false, reason: 'no canvas element'};
    const rect = glCanvas.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100) {
      return {ok: false, reason: `canvas rect too small: ${rect.width}x${rect.height}`};
    }
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 36;
    const ctx = probe.getContext('2d');
    ctx.drawImage(glCanvas, 0, 0, probe.width, probe.height);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let minL = 255;
    let maxL = 0;
    let sum = 0;
    const n = probe.width * probe.height;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (lum < minL) minL = lum;
      if (lum > maxL) maxL = lum;
      sum += lum;
    }
    const mean = sum / n;
    let varSum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      varSum += (lum - mean) * (lum - mean);
    }
    const std = Math.sqrt(varSum / n);
    return {
      ok: std > 2 && maxL - minL > 12,
      w: glCanvas.width,
      h: glCanvas.height,
      mean: Number(mean.toFixed(1)),
      std: Number(std.toFixed(1)),
      range: Number((maxL - minL).toFixed(1)),
    };
  });
  return stats;
}

async function getCanvasHash(page) {
  return page.evaluate(() => {
    const glCanvas = document.querySelector('#gl') || document.querySelector('canvas');
    const probe = document.createElement('canvas');
    probe.width = 48;
    probe.height = 27;
    const ctx = probe.getContext('2d');
    ctx.drawImage(glCanvas, 0, 0, probe.width, probe.height);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += data[i] + data[i + 1] * 2 + data[i + 2] * 3;
    }
    return sum;
  });
}

async function checkLayoutUnclipped(page, vp, kind) {
  const issues = await page.evaluate(({width, height, kind}) => {
    const problems = [];
    const tol = 2;
    const checkBox = (label, el) => {
      if (!el) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.left < -tol || r.top < -tol || r.right > width + tol || r.bottom > height + tol) {
        problems.push(
          `${label} clipped: [${r.left.toFixed(1)}, ${r.top.toFixed(1)}, ${r.right.toFixed(1)}, ${r.bottom.toFixed(1)}] vs ${width}x${height}`,
        );
      }
    };

    if (kind === 'studio') {
      if (document.documentElement.scrollWidth > width + tol) {
        problems.push(`studio horizontal overflow: scrollWidth=${document.documentElement.scrollWidth} > ${width}`);
      }
      return problems;
    }

    const app = document.getElementById('app');
    checkBox('#app', app);

    if (kind === 'live') {
      for (const sel of [
        '[data-testid="tour-chip"]',
        '[data-testid="quality-pill"]',
        '[data-testid="sound-pill"]',
        '[data-testid="explode-slider"]',
        '.live-tools',
      ]) {
        checkBox(sel, document.querySelector(sel));
      }
      // Also verify non-overlapping pills inside .live-pills
      const pills = [...document.querySelectorAll('.live-pills > *')].filter(
        (el) => getComputedStyle(el).display !== 'none',
      );
      for (let i = 1; i < pills.length; i++) {
        const a = pills[i - 1].getBoundingClientRect();
        const b = pills[i].getBoundingClientRect();
        if (a.right > b.left + 1) {
          problems.push(`pill overlap: ${a.right.toFixed(1)} > ${b.left.toFixed(1)}`);
        }
      }
    } else if (kind === 'film') {
      checkBox('.hud .hdr', document.querySelector('.hud .hdr'));
      checkBox('.hud .bot', document.querySelector('.hud .bot'));
    }
    return problems;
  }, {...vp, kind});
  assert.deepEqual(issues, [], `Layout clipping issues (${kind} @ ${vp.width}x${vp.height}):\n${issues.join('\n')}`);
}

async function waitForSimReady(page, kind) {
  if (kind === 'studio') {
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    return;
  }
  if (kind === 'film') {
    await page.waitForFunction(() => window.SIM && window.SIM.ready, null, {timeout: 30000});
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.SIM.render(1.5));
    await page.waitForTimeout(150);
    return;
  }
  // live
  await page.waitForFunction(() => window.SIM_SHOWN === true, null, {timeout: 30000});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

function attachErrorCollector(page, label) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console.error ${label}] ${m.text()}`);
  });
  page.on('pageerror', (e) => {
    errors.push(`[pageerror ${label}] ${e.message}`);
  });
  return errors;
}

async function assertXrayToggle(page, fileName, testid, modeLabel = 'X-RAY') {
  const xrayBtn = page.locator(`[data-testid="${testid}"]`);
  await xrayBtn.waitFor({state: 'visible', timeout: 5000});
  const hashBefore = await getCanvasHash(page);
  await xrayBtn.click();
  await page.waitForTimeout(220);
  const glXray = await checkWebGLNonBlank(page);
  assert.ok(glXray.ok, `${fileName} ${testid} ${modeLabel} mode WebGL blank: ${JSON.stringify(glXray)}`);
  const hashAfter = await getCanvasHash(page);
  assert.notEqual(hashAfter, hashBefore, `${fileName} ${testid} ${modeLabel} mode should change rendered 3D frame`);
  await xrayBtn.click();
  await page.waitForTimeout(120);
}

async function testLiveInteractions(page, fileName) {
  // 1. Auto-tour initially active; clicking tourChip takes over; clicking again resumes; canvas drag takes over
  const tourChip = page.locator('[data-testid="tour-chip"]');
  await tourChip.waitFor({state: 'visible', timeout: 5000});
  assert.ok(
    await tourChip.evaluate((el) => el.classList.contains('on')),
    `${fileName}: tour-chip should start with .on`,
  );
  await tourChip.click();
  assert.ok(
    await tourChip.evaluate((el) => !el.classList.contains('on') && /RESUME/i.test(el.textContent || '')),
    `${fileName}: clicking tour-chip should switch to RESUME TOUR`,
  );
  await tourChip.click();
  assert.ok(
    await tourChip.evaluate((el) => el.classList.contains('on')),
    `${fileName}: clicking tour-chip again should resume AUTO TOUR`,
  );

  // Drag on canvas triggers auto-tour takeover
  const glBox = await page.locator('#gl').boundingBox();
  assert.ok(glBox && glBox.width > 200 && glBox.height > 200, `${fileName}: #gl boundingBox missing`);
  const cx = glBox.x + glBox.width * 0.5;
  const cy = glBox.y + glBox.height * 0.45;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 20, {steps: 5});
  await page.mouse.up();
  assert.ok(
    await tourChip.evaluate((el) => !el.classList.contains('on')),
    `${fileName}: dragging canvas should take over from auto-tour`,
  );

  // 2. Quality tier cycling (click once to lock manualTier=true, then verify 3-step cycle wraps back)
  const qualPill = page.locator('[data-testid="quality-pill"]');
  await qualPill.click();
  const baseTier = await qualPill.getAttribute('data-tier');
  assert.ok(baseTier, `${fileName}: quality-pill missing data-tier`);
  await qualPill.click();
  const secondTier = await qualPill.getAttribute('data-tier');
  assert.notEqual(secondTier, baseTier, `${fileName}: quality-pill click should change tier`);
  await qualPill.click();
  const thirdTier = await qualPill.getAttribute('data-tier');
  assert.notEqual(thirdTier, secondTier, `${fileName}: quality-pill second click should change tier`);
  await qualPill.click();
  const wrappedTier = await qualPill.getAttribute('data-tier');
  assert.equal(wrappedTier, baseTier, `${fileName}: quality-pill should wrap back to ${baseTier}`);

  // 3. Sound toggle (default OFF -> ON -> OFF)
  const soundPill = page.locator('[data-testid="sound-pill"]');
  assert.match((await soundPill.textContent()) || '', /OFF/i, `${fileName}: sound should default OFF`);
  await soundPill.click();
  await page.waitForTimeout(120);
  assert.match((await soundPill.textContent()) || '', /ON/i, `${fileName}: sound click should toggle ON`);
  await soundPill.click();
  await page.waitForTimeout(80);
  assert.match((await soundPill.textContent()) || '', /OFF/i, `${fileName}: second sound click should toggle OFF`);

  // 4. Explode slider changes visual output & label, reset restores 0%
  const hashBeforeExplode = await getCanvasHash(page);
  const expSlider = page.locator('[data-testid="explode-slider"]');
  await expSlider.evaluate((el) => {
    el.value = '0.8';
    el.dispatchEvent(new Event('input', {bubbles: true}));
  });
  await page.waitForTimeout(250);
  const expLabel = await page.locator('[data-val="explode"]').textContent();
  assert.equal(expLabel?.trim(), '80%', `${fileName}: explode readout should show 80%`);
  const hashAfterExplode = await getCanvasHash(page);
  assert.notEqual(
    hashAfterExplode,
    hashBeforeExplode,
    `${fileName}: explode=0.8 should visually change rendered 3D frame`,
  );

  // Cut plane slider if present
  const cutSlider = page.locator('[data-testid="cut-slider"]');
  if ((await cutSlider.count()) > 0) {
    await cutSlider.evaluate((el) => {
      el.value = '0.35';
      el.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await page.waitForTimeout(150);
    const cutLabel = await page.locator('[data-val="cut"]').textContent();
    assert.equal(cutLabel?.trim(), '+0.35', `${fileName}: cut readout should show +0.35`);
  }

  // Reset button returns explode and cut to 0
  await page.locator('[data-testid="reset-inspector"]').click();
  await page.waitForTimeout(700);
  assert.equal(
    (await page.locator('[data-val="explode"]').textContent())?.trim(),
    '0%',
    `${fileName}: RESET should restore explode to 0%`,
  );

  // 5. Part Inspector hover + click pin
  const tip = page.locator('[data-testid="inspector-tooltip"]');
  let foundPart = false;
  const grid = [
    [0.5, 0.45],
    [0.5, 0.36],
    [0.45, 0.42],
    [0.55, 0.45],
    [0.42, 0.5],
    [0.58, 0.5],
    [0.5, 0.54],
    [0.38, 0.44],
    [0.62, 0.44],
  ];
  for (const [fx, fy] of grid) {
    const px = glBox.x + glBox.width * fx;
    const py = glBox.y + glBox.height * fy;
    await page.mouse.move(px, py);
    await page.waitForTimeout(50);
    const isOn = await tip.evaluate((el) => el.classList.contains('on'));
    if (isOn) {
      const partName = (await tip.locator('.insp-name').textContent())?.trim();
      assert.ok(partName && partName.length > 0, `${fileName}: inspector tooltip .insp-name is empty`);
      await page.mouse.click(px, py);
      await page.waitForTimeout(100);
      const pinnedCount = await tip.locator('.insp-pin').count();
      if (pinnedCount === 1) {
        const liveTxt = (await tip.locator('[data-testid="inspector-live"]').textContent())?.trim() || '';
        assert.ok(liveTxt.length > 0, `${fileName}: expected non-empty [data-testid="inspector-live"] telemetry on "${partName}"`);
        const unpinBtn = tip.locator('[data-testid="inspector-unpin"]');
        await unpinBtn.waitFor({state: 'visible', timeout: 3000});
        await unpinBtn.click();
        await page.waitForTimeout(80);
        const stillOn = await tip.evaluate((el) => el.classList.contains('on'));
        assert.equal(stillOn, false, `${fileName}: [data-testid="inspector-unpin"] click should dismiss pinned inspector card`);
        foundPart = true;
        break;
      }
    }
  }
  assert.ok(foundPart, `${fileName}: Part Inspector never pinned a hovered part across central probe grid`);

  // 5a. Auto-Tour takeover click on WebGL canvas must NOT pin a part
  if ((await tourChip.textContent())?.match(/resume/i)) {
    await tourChip.click();
    await page.waitForTimeout(100);
    await page.mouse.click(glBox.x + glBox.width * 0.5, glBox.y + glBox.height * 0.45);
    await page.waitForTimeout(100);
    assert.match((await tourChip.textContent()) || '', /resume/i, `${fileName}: clicking canvas should pause Auto-Tour`);
    assert.equal(await tip.locator('.insp-pin').count(), 0, `${fileName}: Auto-Tour takeover click must NOT pin a part`);
  }

  // 5b. Help shortcut modal (? pill + Escape close)
  const helpPill = page.locator('[data-testid="help-pill"]');
  const helpModal = page.locator('[data-testid="help-modal"]');
  await helpPill.waitFor({state: 'visible', timeout: 5000});
  await helpPill.click();
  await page.waitForTimeout(80);
  assert.equal(await helpModal.getAttribute('aria-hidden'), 'false', `${fileName}: ? pill should open help-modal`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  assert.equal(await helpModal.getAttribute('aria-hidden'), 'true', `${fileName}: Escape should close help-modal`);

  // 6. Machine-specific interactive HUD controls (.tb / .bt / .vb / buttons outside .live-bar)
  const machineControls = await page.evaluate(() => {
    const bar = document.querySelector('.live-bar');
    const btns = [...document.querySelectorAll('#app .tb, #app .bt, #app .vb, #app button, #app [role="button"], #app .chip, #app .btn')].filter(
      (el) => !bar?.contains(el) && getComputedStyle(el).display !== 'none' && getComputedStyle(el).pointerEvents !== 'none',
    );
    return btns.slice(0, 4).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: (el.textContent || '').trim().slice(0, 32),
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        w: r.width,
        h: r.height,
      };
    });
  });
  assert.ok(machineControls.length > 0, `${fileName}: expected interactive machine controls in HUD`);
  for (const ctl of machineControls) {
    if (ctl.w > 2 && ctl.h > 2) {
      await page.mouse.click(ctl.x, ctl.y);
      await page.waitForTimeout(80);
    }
  }

  // 7. V8 Master Project checks: attribution, torque/power readout, VALVE TIMING drag-scrub, SECTION stencil caps
  if (fileName === 'v8-live.html') {
    const credit = page.locator('[data-testid="author-credit"]');
    await credit.waitFor({state: 'visible', timeout: 5000});
    assert.match((await credit.textContent()) || '', /made by nagendra varma/i, 'v8-live.html missing "Made by Nagendra Varma"');

    const tqPow = page.locator('[data-testid="torque-power"]');
    await tqPow.waitFor({state: 'visible', timeout: 5000});
    const tqText = (await tqPow.textContent()) || '';
    assert.match(tqText, /N·m/, 'v8-live.html torque-power missing N·m');
    assert.match(tqText, /kW/, 'v8-live.html torque-power missing kW');

    // VALVE TIMING drag-to-scrub across 0°..720°
    const vt = page.locator('[data-testid="valve-timing"]');
    await vt.waitFor({state: 'visible', timeout: 5000});
    const vtBox = await vt.boundingBox();
    assert.ok(vtBox && vtBox.width > 80 && vtBox.height > 40, 'v8-live.html valve-timing boundingBox invalid');
    const readCrankState = () =>
      page.evaluate(() => {
        const els = [...document.querySelectorAll('.ui div')];
        const crankEl = els.find((d) => /^\d+°\s*CRANK$/.test((d.textContent || '').trim()));
        const barEl = els.find((d) => /CHAMBER PRESSURE/.test((d.textContent || '').trim()));
        return {
          crank: crankEl?.textContent?.trim() || '',
          bar: barEl?.previousElementSibling?.textContent?.trim() || '',
        };
      });
    const yMid = vtBox.y + vtBox.height * 0.5;
    await page.mouse.move(vtBox.x + vtBox.width * 0.12, yMid);
    await page.mouse.down();
    await page.waitForTimeout(120);
    const s1 = await readCrankState();
    await page.mouse.move(vtBox.x + vtBox.width * 0.55, yMid, {steps: 6});
    await page.waitForTimeout(120);
    const s2 = await readCrankState();
    await page.mouse.move(vtBox.x + vtBox.width * 0.85, yMid, {steps: 6});
    await page.waitForTimeout(120);
    const s3 = await readCrankState();
    await page.mouse.up();
    assert.notEqual(s1.crank, s2.crank, `v8-live.html valve-timing scrub did not update crank angle (${s1.crank} vs ${s2.crank})`);
    assert.notEqual(s2.crank, s3.crank, `v8-live.html valve-timing scrub did not update crank angle (${s2.crank} vs ${s3.crank})`);

    // Default cutaway on initial load & after RESET must be GLASS (active C.ink = rgb(18, 13, 10))
    const glassBtn = page.locator('#app .tb', {hasText: /^GLASS$/});
    const sectionBtn = page.locator('#app .tb', {hasText: /^SECTION$/});
    const solidBtn = page.locator('#app .tb', {hasText: /^SOLID$/});
    const isActiveTb = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor === 'rgb(18, 13, 10)');
    assert.ok(await isActiveTb(glassBtn), 'v8-live.html should keep GLASS active after RESET');
    assert.ok(!(await isActiveTb(solidBtn)), 'v8-live.html SOLID should NOT be active by default or after RESET');

    // SECTION and SOLID cutaway modes render cleanly with stencil caps / hybrid valve covers and change rendered frame
    await glassBtn.click();
    await page.waitForTimeout(160);
    const hashGlass = await getCanvasHash(page);
    await sectionBtn.click();
    await page.waitForTimeout(220);
    const glSection = await checkWebGLNonBlank(page);
    assert.ok(glSection.ok, `v8-live.html SECTION mode WebGL blank: ${JSON.stringify(glSection)}`);
    const hashSection = await getCanvasHash(page);
    assert.notEqual(hashSection, hashGlass, 'v8-live.html SECTION cutaway should change rendered 3D frame');
    await solidBtn.click();
    await page.waitForTimeout(220);
    const glSolid = await checkWebGLNonBlank(page);
    assert.ok(glSolid.ok, `v8-live.html SOLID mode WebGL blank: ${JSON.stringify(glSolid)}`);
    const hashSolid = await getCanvasHash(page);
    assert.notEqual(hashSolid, hashGlass, 'v8-live.html SOLID mode (hybrid valve cover lids) should change rendered 3D frame');
    const mutedPulse = await page.evaluate(() => window.LIVE?.audio?.getPulse?.());
    assert.equal(mutedPulse, 0, `v8-live.html audio.getPulse() should be 0 when muted, got ${mutedPulse}`);
    await glassBtn.click();
    await page.waitForTimeout(120);

    // BOOST +0.8 BAR overlay toggles forced-induction telemetry & indicator pressure
    const boostBtn = page.locator('[data-testid="v8-boost"]');
    const tpEl = page.locator('[data-testid="torque-power"]');
    const tpBefore = (await tpEl.textContent()) || '';
    await boostBtn.click();
    await page.waitForTimeout(160);
    const tpBoosted = (await tpEl.textContent()) || '';
    assert.notEqual(tpBoosted, tpBefore, `v8-live.html BOOST toggle did not update torque/power (${tpBefore} vs ${tpBoosted})`);
    await boostBtn.click();
    await page.waitForTimeout(100);

    // SPLIT 50/50 longitudinal Half-Split cutaway (X = 0)
    const splitBtn = page.locator('[data-testid="v8-split"]');
    await splitBtn.waitFor({state: 'visible', timeout: 5000});
    const hashBeforeSplit = await getCanvasHash(page);
    await splitBtn.click();
    await page.waitForTimeout(220);
    const glSplit = await checkWebGLNonBlank(page);
    assert.ok(glSplit.ok, `v8-live.html SPLIT mode WebGL blank: ${JSON.stringify(glSplit)}`);
    const hashAfterSplit = await getCanvasHash(page);
    assert.notEqual(hashAfterSplit, hashBeforeSplit, 'v8-live.html SPLIT mode should change rendered 3D frame');
    await splitBtn.click();
    await page.waitForTimeout(120);

    // Dyno Presets (IDLE 750 · CRUISE 2800 · REDLINE 7000 RPM) + LED Shift-Light & Fuel Flow telemetry
    const redlineBtn = page.locator('[data-testid="dyno-redline"]');
    const cruiseBtn = page.locator('[data-testid="dyno-cruise"]');
    const idleBtn = page.locator('[data-testid="dyno-idle"]');
    const shiftLeds = page.locator('[data-testid="v8-shift-leds"]');
    const fuelTel = page.locator('[data-testid="fuel-telemetry"]');
    await redlineBtn.waitFor({state: 'visible', timeout: 5000});
    await shiftLeds.waitFor({state: 'visible', timeout: 5000});
    await fuelTel.waitFor({state: 'visible', timeout: 5000});
    await idleBtn.click();
    await page.waitForTimeout(900);
    const fuelIdle = (await fuelTel.textContent())?.trim() || '';
    assert.match(fuelIdle, /L\/HR/i, `v8-live.html fuel-telemetry missing L/HR (${fuelIdle})`);
    await redlineBtn.click();
    await page.waitForTimeout(1300);
    const redlineRpm = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.ui .cp')].find((d) => /^\d+\s+RPM$/i.test((d.textContent || '').trim()));
      return el ? parseInt(el.textContent, 10) : 0;
    });
    assert.ok(redlineRpm >= 6600, `v8-live.html dyno-redline should ramp RPM near 7000, got ${redlineRpm}`);
    const fuelRedline = (await fuelTel.textContent())?.trim() || '';
    assert.notEqual(fuelRedline, fuelIdle, `v8-live.html fuel-telemetry did not scale from IDLE (${fuelIdle}) to REDLINE (${fuelRedline})`);
    await cruiseBtn.click();
    await page.waitForTimeout(150);

    // X-RAY translucent housing mode & WIRE CAD wireframe mode
    await assertXrayToggle(page, fileName, 'v8-xray');
    await assertXrayToggle(page, fileName, 'v8-wire', 'WIRE');

    // FAULT cycle (NORMAL -> MISFIRE -> KNOCK -> OVERHEAT -> NORMAL)
    const faultBtn = page.locator('[data-testid="v8-fault"]');
    await faultBtn.waitFor({state: 'visible', timeout: 5000});
    assert.match((await faultBtn.textContent()) || '', /NORMAL/i, 'v8-live.html fault should start at NORMAL');
    await faultBtn.click();
    await page.waitForTimeout(120);
    assert.match((await faultBtn.textContent()) || '', /MISFIRE/i, 'v8-live.html fault click 1 -> MISFIRE');
    await faultBtn.click();
    await page.waitForTimeout(120);
    assert.match((await faultBtn.textContent()) || '', /KNOCK/i, 'v8-live.html fault click 2 -> KNOCK');
    await faultBtn.click();
    await page.waitForTimeout(160);
    assert.match((await faultBtn.textContent()) || '', /OVERHEAT/i, 'v8-live.html fault click 3 -> OVERHEAT');
    const glOverheat = await checkWebGLNonBlank(page);
    assert.ok(glOverheat.ok, `v8-live.html OVERHEAT fault WebGL blank: ${JSON.stringify(glOverheat)}`);
    await faultBtn.click();
    await page.waitForTimeout(100);
    assert.match((await faultBtn.textContent()) || '', /NORMAL/i, 'v8-live.html fault click 4 -> NORMAL');
    await idleBtn.click();
    await page.waitForTimeout(120);
  }

  // 8. Strandbeest checks: attribution, STUDIO DUNE/SLATE toggle, WIND chart scrub
  if (fileName === 'strandbeest-live.html') {
    const credit = page.locator('[data-testid="author-credit"]');
    await credit.waitFor({state: 'visible', timeout: 5000});
    assert.match((await credit.textContent()) || '', /made by nagendra varma/i, 'strandbeest-live.html missing "Made by Nagendra Varma"');

    const studioPill = page.locator('[data-testid="studio-pill"]');
    await studioPill.waitFor({state: 'visible', timeout: 5000});
    const t0 = (await studioPill.textContent())?.trim() || '';
    const h0 = await getCanvasHash(page);
    await studioPill.click();
    await page.waitForTimeout(240);
    const t1 = (await studioPill.textContent())?.trim() || '';
    assert.notEqual(t1, t0, `strandbeest-live.html studio-pill did not toggle (${t0} -> ${t1})`);
    const glSlate = await checkWebGLNonBlank(page);
    assert.ok(glSlate.ok, `strandbeest-live.html SLATE mode WebGL blank: ${JSON.stringify(glSlate)}`);
    const h1 = await getCanvasHash(page);
    assert.notEqual(h1, h0, 'strandbeest-live.html STUDIO DUNE/SLATE toggle should change rendered 3D scene');
    await studioPill.click();
    await page.waitForTimeout(160);

    const wc = page.locator('[data-testid="wind-chart"]');
    await wc.waitFor({state: 'visible', timeout: 5000});
    const wcBox = await wc.boundingBox();
    assert.ok(wcBox && wcBox.width > 80 && wcBox.height > 25, 'strandbeest-live.html wind-chart boundingBox invalid');
    const yMid = wcBox.y + wcBox.height * 0.5;
    await page.mouse.move(wcBox.x + wcBox.width * 0.15, yMid);
    await page.mouse.down();
    await page.waitForTimeout(100);
    const w1 = (await page.locator('[data-k="wind"]').textContent())?.trim() || '';
    await page.mouse.move(wcBox.x + wcBox.width * 0.85, yMid, {steps: 6});
    await page.waitForTimeout(100);
    const w2 = (await page.locator('[data-k="wind"]').textContent())?.trim() || '';
    await page.mouse.up();
    assert.notEqual(w1, w2, `strandbeest-live.html wind-chart scrub did not change wind (${w1} vs ${w2})`);

    await assertXrayToggle(page, fileName, 'sb-xray');
  }

  // 9. Turbofan GTF-1200 checks: attribution, N1/N2/Thrust/EGT/Fuel readouts, Brayton drag-scrub, SECTION stencil caps
  if (fileName === 'turbofan-live.html') {
    const credit = page.locator('[data-testid="author-credit"]');
    await credit.waitFor({state: 'visible', timeout: 5000});
    assert.match((await credit.textContent()) || '', /made by nagendra varma/i, 'turbofan-live.html missing "Made by Nagendra Varma"');

    for (const tid of ['readout-n1', 'readout-n2', 'readout-thrust', 'readout-egt', 'readout-fuel']) {
      const el = page.locator(`[data-testid="${tid}"]`);
      await el.waitFor({state: 'visible', timeout: 5000});
      const txt = (await el.textContent())?.trim() || '';
      assert.ok(txt.length > 0, `turbofan-live.html ${tid} empty`);
    }

    // Brayton chart drag-to-scrub throttle 0..100%
    const bc = page.locator('[data-testid="brayton-chart"]');
    await bc.waitFor({state: 'visible', timeout: 5000});
    const bcBox = await bc.boundingBox();
    assert.ok(bcBox && bcBox.width > 80 && bcBox.height > 40, 'turbofan-live.html brayton-chart boundingBox invalid');
    const yMid = bcBox.y + bcBox.height * 0.5;
    await page.mouse.move(bcBox.x + bcBox.width * 0.12, yMid);
    await page.mouse.down();
    await page.waitForTimeout(140);
    const n1Low = (await page.locator('[data-testid="readout-n1"]').textContent())?.trim() || '';
    const thrLow = (await page.locator('[data-testid="readout-thrust"]').textContent())?.trim() || '';
    await page.mouse.move(bcBox.x + bcBox.width * 0.88, yMid, {steps: 6});
    await page.waitForTimeout(140);
    const n1High = (await page.locator('[data-testid="readout-n1"]').textContent())?.trim() || '';
    const thrHigh = (await page.locator('[data-testid="readout-thrust"]').textContent())?.trim() || '';
    await page.mouse.up();
    assert.notEqual(n1Low, n1High, `turbofan-live.html brayton-chart scrub did not change N1 (${n1Low} vs ${n1High})`);
    assert.notEqual(thrLow, thrHigh, `turbofan-live.html brayton-chart scrub did not change thrust (${thrLow} vs ${thrHigh})`);

    // SECTION cutaway mode renders cleanly with stencil caps
    const sectionBtn = page.locator('#app .tb', {hasText: /^SECTION$/});
    const glassBtn = page.locator('#app .tb', {hasText: /^GLASS$/});
    await glassBtn.click();
    await page.waitForTimeout(160);
    const hashGlass = await getCanvasHash(page);
    await sectionBtn.click();
    await page.waitForTimeout(220);
    const glSection = await checkWebGLNonBlank(page);
    assert.ok(glSection.ok, `turbofan-live.html SECTION mode WebGL blank: ${JSON.stringify(glSection)}`);
    const hashSection = await getCanvasHash(page);
    assert.notEqual(hashSection, hashGlass, 'turbofan-live.html SECTION cutaway should change rendered 3D frame');
    await glassBtn.click();
    await page.waitForTimeout(120);

    await assertXrayToggle(page, fileName, 'tf-xray');
  }
}

async function testStudioPage(page, isHttp) {
  const info = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({
      href: a.getAttribute('href'),
      text: (a.textContent || '').trim(),
    }));
    const covers = [...document.querySelectorAll('img.mc-cover-img')].map((img) => ({
      alt: img.alt || '',
      complete: img.complete,
      w: img.naturalWidth,
      h: img.naturalHeight,
    }));
    const cardIds = [...document.querySelectorAll('.mc-card, article, section')].map((el) => el.dataset?.id || '').filter(Boolean);
    const cardTitles = [...document.querySelectorAll('h2, h3')].map((el) => (el.textContent || '').trim()).filter((t) => /V8|Strandbeest|Turbofan|GTF-1200/i.test(t));
    const heroEl = document.querySelector('[data-testid="studio-hero-cta"]');
    const heroCv = document.querySelector('#cta04-front canvas');
    const heroBox = heroEl ? heroEl.getBoundingClientRect() : null;
    const heroCvBox = heroCv ? heroCv.getBoundingClientRect() : null;
    const text = document.body.innerText;
    return {
      links,
      covers,
      cardIds,
      cardTitles,
      heroOk: !!(heroBox && heroBox.width > 300 && heroBox.height > 200 && heroCv && heroCv.width > 300 && heroCvBox && heroCvBox.height > 100),
      textLen: text.length,
      text,
    };
  });
  assert.ok(info.textLen > 100, 'studio.html rendered sparse/empty body');
  assert.ok(info.heroOk, 'studio.html cta-04 hero section or PaperlineArchive canvas did not render cleanly');
  assert.match(info.text, /shattercraft studio/i, 'studio.html missing "SHATTERCRAFT STUDIO" title');
  assert.doesNotMatch(info.text, /\bteardown\b/i, 'studio.html visible text should not contain "teardown"');
  assert.doesNotMatch(info.text, /\bcessna\b/i, 'studio.html visible text should not contain "cessna"');
  assert.match(info.text, /made by nagendra varma/i, 'studio.html missing "Made by Nagendra Varma" attribution');
  assert.ok(DIST.endsWith(path.join('shattercraft-out', 'dist')), `Expected DIST in shattercraft-out/dist, got ${DIST}`);
  assert.ok(info.covers.length >= 3, `studio.html expected 3 real 3D cover images, found ${info.covers.length}`);
  for (const cov of info.covers) {
    assert.ok(cov.complete && cov.w > 100 && cov.h > 100, `studio.html cover image broken: ${JSON.stringify(cov)}`);
  }
  assert.ok(info.cardTitles.length >= 3, `studio.html expected 3 machine cards, found ${info.cardTitles.length}`);
  assert.match(info.cardTitles[0], /V8/i, `Expected SIM-01 V8 first, got ${info.cardTitles}`);
  assert.match(info.cardTitles[1], /Strandbeest/i, `Expected SIM-02 Strandbeest second, got ${info.cardTitles}`);
  assert.match(info.cardTitles[2], /Turbofan|GTF-1200/i, `Expected SIM-03 GTF-1200 Turbofan third, got ${info.cardTitles}`);
  for (const target of ['v8-live.html', 'strandbeest-live.html', 'turbofan-live.html']) {
    assert.ok(
      info.links.some((l) => l.href && l.href.includes(target)),
      `studio.html missing link to ${target}`,
    );
  }
  for (const docImg of ['docs/studio-hub.png', 'docs/v8-ultimate.png', 'docs/strandbeest.png', 'docs/turbofan-gtf1200.png']) {
    const fullImg = path.join(ROOT, docImg);
    assert.ok(fs.existsSync(fullImg) && fs.statSync(fullImg).size > 10000, `Missing README showcase image: ${docImg}`);
  }
  if (isHttp) {
    // Verify studio page links are reachable via serve.mjs
    for (const target of ['v8-live.html', 'strandbeest-live.html', 'turbofan-live.html', 'turbofan-film.html', 'v8-film.html']) {
      const url = new URL(target, page.url()).href;
      const res = await fetch(url);
      assert.equal(res.status, 200, `serve.mjs returned ${res.status} for ${target}`);
    }
  }
}

async function main() {
  // 1. Check all built artifacts exist and are < 1 MB
  console.log(`Verifying built HTML artifacts in ${DIST}`);
  for (const file of EXPECTED_FILES) {
    const full = path.join(DIST, file);
    assert.ok(fs.existsSync(full), `Missing built file: ${full}`);
    const kb = fs.statSync(full).size / 1024;
    assert.ok(kb > 10, `Built file suspiciously small (${kb.toFixed(1)} KB): ${full}`);
    assert.ok(kb < 1024, `Built file exceeds 1 MB (${kb.toFixed(1)} KB): ${full}`);
    console.log(`  [ok] ${file} (${kb.toFixed(0)} KB)`);
  }

  const server = await startServeMjs();
  console.log(`serve.mjs listening at ${server.baseUrl}`);

  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: CHROMIUM_ARGS,
  });

  try {
    // Test HTTP root redirect / index -> studio.html
    {
      const ctx = await browser.newContext({viewport: {width: 1600, height: 900}});
      const page = await ctx.newPage();
      const errors = attachErrorCollector(page, 'http:/');
      await page.goto(`${server.baseUrl}/`, {waitUntil: 'domcontentloaded'});
      await waitForSimReady(page, 'studio');
      await testStudioPage(page, true);
      assert.deepEqual(errors, [], `Errors on ${server.baseUrl}/:\n${errors.join('\n')}`);
      await ctx.close();
      console.log('  [ok] serve.mjs / -> studio.html (1600x900)');
    }

    // Test every built HTML via both HTTP (serve.mjs) and offline file:// at 1600x900 & 1280x720
    for (const file of EXPECTED_FILES) {
      const kind = file === 'studio.html' ? 'studio' : file.endsWith('-film.html') ? 'film' : 'live';
      const modes = [
        {name: 'http', url: `${server.baseUrl}/${file}`},
        {name: 'file', url: pathToFileURL(path.join(DIST, file)).href},
      ];

      for (const mode of modes) {
        for (const vp of VIEWPORTS) {
          // Run full matrix: both viewports for HTTP; 1600x900 for file:// offline smoke check
          if (mode.name === 'file' && vp.width !== 1600) continue;

          const ctx = await browser.newContext({viewport: vp, deviceScaleFactor: 1});
          const page = await ctx.newPage();
          if (kind === 'film') {
            await page.addInitScript(() => {
              window.__CAPTURE = true;
            });
          }
          const label = `${file} [${mode.name} ${vp.width}x${vp.height}]`;
          const errors = attachErrorCollector(page, label);

          await page.goto(mode.url, {waitUntil: 'domcontentloaded'});
          await waitForSimReady(page, kind);

          if (kind !== 'studio') {
            const gl = await checkWebGLNonBlank(page);
            assert.ok(gl.ok, `${label} WebGL blank or flat: ${JSON.stringify(gl)}`);
          } else {
            await testStudioPage(page, mode.name === 'http');
          }

          await checkLayoutUnclipped(page, vp, kind);

          if (kind === 'live' && mode.name === 'http' && vp.width === 1600) {
            await testLiveInteractions(page, file);
          }

          assert.deepEqual(errors, [], `Console/page errors in ${label}:\n${errors.join('\n')}`);
          await ctx.close();
          console.log(`  [ok] ${label}`);
        }
      }
    }

    // 5.2s live soak check on v8-live.html confirming Quality Guard keeps Q: HIGH,
    // initial default is GLASS, and 1-lap Auto-Tour completes cleanly without SOLID
    {
      const ctx = await browser.newContext({viewport: {width: 1600, height: 900}, deviceScaleFactor: 1});
      const page = await ctx.newPage();
      const errors = attachErrorCollector(page, 'v8-live soak');
      await page.goto(`${server.baseUrl}/v8-live.html`, {waitUntil: 'domcontentloaded'});
      await waitForSimReady(page, 'live');
      const isInkBg = (el) => !!el && getComputedStyle(el).backgroundColor === 'rgb(18, 13, 10)';
      const initGlassOn = await page.locator('#app .tb', {hasText: /^GLASS$/}).evaluate((el) => getComputedStyle(el).backgroundColor === 'rgb(18, 13, 10)');
      const initSolidOn = await page.locator('#app .tb', {hasText: /^SOLID$/}).evaluate((el) => getComputedStyle(el).backgroundColor === 'rgb(18, 13, 10)');
      assert.ok(initGlassOn && !initSolidOn, `v8-live.html must open in GLASS mode (glass=${initGlassOn}, solid=${initSolidOn})`);

      let sawSection = false;
      let sawSolid = false;
      let sawXray = false;
      let sawWire = false;
      let soakTierOk = false;
      const startMs = Date.now();
      while (Date.now() - startMs < 36000) {
        const snap = await page.evaluate(() => {
          const findTb = (rx) => [...document.querySelectorAll('#app .tb')].find((el) => rx.test(el.textContent?.trim() || ''));
          const isInk = (rx) => {
            const b = findTb(rx);
            return !!b && getComputedStyle(b).backgroundColor === 'rgb(18, 13, 10)';
          };
          const isRed = (rx) => {
            const b = findTb(rx);
            return !!b && getComputedStyle(b).backgroundColor === 'rgb(242, 106, 61)';
          };
          const chip = document.querySelector('[data-testid="tour-chip"]');
          const q = document.querySelector('[data-testid="quality-pill"]');
          return {
            glass: isInk(/^GLASS$/),
            section: isInk(/^SECTION$/),
            solid: isInk(/^SOLID$/),
            xray: isRed(/^X-RAY$/),
            wire: isRed(/^WIRE$/),
            tourOn: !!chip?.classList.contains('on'),
            tourText: (chip?.textContent || '').trim(),
            tier: q?.getAttribute('data-tier') || '',
          };
        });
        if (snap.section) sawSection = true;
        if (snap.solid) sawSolid = true;
        if (snap.xray) sawXray = true;
        if (snap.wire) sawWire = true;
        if (!soakTierOk && Date.now() - startMs >= 5200) {
          assert.equal(snap.tier, 'HIGH', `v8-live.html Quality Guard downgraded from HIGH to ${snap.tier} within 5.2s`);
          soakTierOk = true;
        }
        if (soakTierOk && !snap.tourOn && /RESUME/i.test(snap.tourText)) break;
        await page.waitForTimeout(400);
      }
      assert.ok(soakTierOk, 'v8-live.html 5.2s soak check did not complete');
      assert.ok(!sawSolid, 'v8-live.html Auto-Tour must NEVER switch to SOLID');
      assert.ok(!sawSection, 'v8-live.html Auto-Tour must NEVER switch to SECTION');
      assert.ok(sawXray, 'v8-live.html Auto-Tour should visit X-RAY beat');
      assert.ok(sawWire, 'v8-live.html Auto-Tour should visit WIRE CAD wireframe beat');
      const endChip = page.locator('[data-testid="tour-chip"]');
      assert.ok(
        await endChip.evaluate((el) => !el.classList.contains('on') && /RESUME/i.test(el.textContent || '')),
        'v8-live.html Auto-Tour should stop automatically after 1 lap with RESUME TOUR',
      );
      const endHeroOn = await page.locator('#app .tb', {hasText: /^HERO$/}).evaluate((el) => getComputedStyle(el).backgroundColor === 'rgb(18, 13, 10)');
      const endGlassOn = await page.locator('#app .tb', {hasText: /^GLASS$/}).evaluate((el) => getComputedStyle(el).backgroundColor === 'rgb(18, 13, 10)');
      const endXrayOn = await page.locator('[data-testid="v8-xray"]').evaluate((el) => getComputedStyle(el).backgroundColor === 'rgb(242, 106, 61)');
      const endWireOn = await page.locator('[data-testid="v8-wire"]').evaluate((el) => getComputedStyle(el).backgroundColor === 'rgb(242, 106, 61)');
      assert.ok(endHeroOn, 'v8-live.html should settle in HERO view after 1-lap Auto-Tour stops');
      assert.ok(endGlassOn, 'v8-live.html should settle in GLASS mode after 1-lap Auto-Tour stops');
      assert.ok(!endXrayOn, 'v8-live.html should turn X-RAY off after 1-lap Auto-Tour stops');
      assert.ok(!endWireOn, 'v8-live.html should turn WIRE off after 1-lap Auto-Tour stops');
      assert.deepEqual(errors, [], `Console/page errors during v8-live soak:\n${errors.join('\n')}`);
      await ctx.close();
      console.log('  [ok] v8-live.html 5.2s Q: HIGH soak + 1-lap continuous GLASS (X-RAY + WIRE) Auto-Tour stop');
    }

    console.log('\nAll build, layout, WebGL, and interactive verification checks PASSED.');
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((err) => {
  console.error('\nVERIFICATION FAILED:', err);
  process.exit(1);
});
