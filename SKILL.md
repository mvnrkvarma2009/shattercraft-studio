---
name: shattercraft
description: Build an interactive 3D simulator of a real machine or mechanism (an engine, a landing gear, a walking linkage, a pump, a gearbox) as one offline HTML page people can take apart, with live panels driven by the same model that moves the parts, a button for every subsystem, cutaways, camera views and an auto tour that hands control to the visitor; then record it frame by frame to a 60 fps video with a synced procedural score. Use when someone asks how a machine works, wants a "visual explainer", a "simulator", a "cutaway", an "exploded view" or an "interactive 3D lesson", or wants a 3D object shown working rather than described.
---

# Shattercraft

One machine, one page. The visitor sees the thing run, presses a button, and the part doing the work opens up while the gauges around it read the real numbers. Left alone, the page tours itself with a cursor. The same code records a film of the tour, frame by frame, with a score built on the same timeline.

`SKILL_DIR` below is the folder this file lives in. Builds and renders go to `./shattercraft-out` of the folder you run from.

## First run

```
cd "$SKILL_DIR" && npm run setup
```

(`npm install && npx playwright install chromium`). The pages need nothing else. The video needs `ffmpeg` on PATH and the score needs Python 3 (standard library only). Set `FFMPEG`, `PYTHON` or `CHROMIUM` to point at other binaries.

To build all simulators + the Studio Hub, launch the local studio server, and verify everything:

```
npm run build    # node sims/build.mjs → shattercraft-out/dist/*.html
npm run studio   # node serve.mjs → serves shattercraft-out/dist/ with / → studio.html
npm test         # node tests/verify-builds.mjs
```

## The 3 examples + Studio Hub

Build one, open the HTML (or launch `npm run studio` for the Studio Hub at `studio.html`), press buttons. Copy the closest one when you start a new machine.

| | The machine | What drives it | Worth stealing |
|---|---|---|---|
| `studio` | **Shattercraft Studio Hub** (`sims/studio/`), served at `/` by `serve.mjs`. | Links `v8-live`, `strandbeest-live`, `turbofan-live`, film previews, kinematic specs, and controls guide. | Clean light-studio launch hub for a multi-machine suite. |
| `v8-*` | A cross-plane V8 with glass liners, 2:1 helical timing gears, roller-rockers & stencil caps: the charge burns inside the cylinder you track, valves lift on their cams, 8 pistons move from the exact slider-crank. | Crank angle. Firing order 1-8-4-3-6-5-7-2, a chamber pressure & torque model for the indicator diagram. | Cutaway modes (glass, section, solid), the firing order as a cylinder picker, live scrubbable charts synced to the crank. |
| `strandbeest-*` | Theo Jansen's Strandbeest, 20 legs on one crankshaft, walking broadside over sand with DUNE / SLATE studio palettes. | Wind. The crank speed is integrated from it; every joint follows by circle intersection from Jansen's 11 link lengths. | An exact linkage solver in 67 lines, instanced tubes, foot traces, a contact chart of all 20 feet. |
| `turbofan-*` | GTF-1200 dual-spool high-bypass geared turbofan (18-blade fan, exposed 3.06:1 star planetary gearbox, concentric LPC/HPC/HPT/LPT spools, annular burner). | Throttle `0..1` (IDLE → TOGA) driving N1/N2 spools and Brayton cycle stations `P0..P9` / `T0..T9`. | Exposed planetary gearbox, concentric dual-spool rotation, Brayton station scrubber, stencil-capped nacelle cutaway. |

Each machine comes in 3 folders: `<name>-shared/` holds the machine, `<name>-film/` the recorded tour, `<name>-live/` the page you drive.

```
node "$SKILL_DIR/sims/build.mjs" v8-live          # → shattercraft-out/dist/v8-live.html, offline, ~800 KB
node "$SKILL_DIR/sims/build.mjs"                  # all examples + studio
```

## How a machine is built

One folder per machine, split by job. The examples follow this exactly:

| File | Job |
|---|---|
| `kin.js` / `thermo.js` / `jansen.js` | The math. Real dimensions in real units, one input (crank angle, throttle, wind) and every pose and readout as a function of it. No three.js in here. |
| `engine.js` / `turbofan.js` / `beast.js` | The geometry, built from code: lathed parts, tubes, instanced links. `update(input)` poses it. Tag meshes with `userData.part = {name, subsystem, material, spec, liveSpec}` and `userData.explodeVec` for inspector & explode support. |
| `stage.js` | Studio, lights, shadows, post (GTAO, bloom). `frame(state, cam)` draws one frame. |
| `console.js` | The overlay: fixed 1600 x 900 CSS layout of panels, charts, toggles, callouts with leaders. `update(state)` redraws it from the frame's state. |
| `film.js` | A `SCRIPT` of operator moves (views, isolate, cutaway, throttle) and `render(t)` as a pure function of time. |
| `live.js` | The same machine in real time, built on `sims/kit/live-shell.js`, `sims/kit/inspector.js`, and `sims/kit/webaudio.js`: buttons, sliders, orbit, double-click reset, zoom, keys + `?` shortcuts guide, part picking with live telemetry, explode/cut-plane controls, quality tiers, and muted-by-default procedural sound. With no input it plays `film.js`'s script as an auto tour with a cursor; any click, drag, wheel or key hands control over, 25 s of quiet hands it back. |
| `score.py` | The sound on the film's timeline. |

Shared kit upgrades in `sims/kit/`:
- `live-shell.js`: Responsive 1600×900 stage fitting, orbit/double-click reset/wheel/pinch/keyboard controls + `?` shortcuts overlay, auto-tour state machine (`.tourchip`), adaptive FPS Quality Guard (`Q: HIGH/MED/LOW`, `perf.age > 4.5 s`), and hooks for inspector and WebAudio.
- `inspector.js`: Raycast part picking on pointer move/click (`mesh.userData.part`), subtle highlight + floating engineering tooltip with real-time `liveSpec` telemetry, clickable `PINNED ×` unpin button (plus toggle-unpin on re-click, clear on empty space, and Auto-Tour handoff without accidental pinning), **Explode (0–100%)** displacement (radial/axial from rest positions / `userData.explodeVec`), and **Cut Plane** offset control compatible with built-in cutaway / `X-RAY` / `SPLIT` modes.
- `webaudio.js`: Zero-dependency procedural Web Audio synthesizer for `-live` pages (default muted; unlocked on `SOUND: OFF/ON` toggle click; supports V8 `FAULT` acoustic modes `misfire` and `knock` + master limiter).
- `gltf-bridge.js`: Helper to load `.glb` assemblies via `GLTFLoader`, normalize scale/grounding to studio units, enable shadows, tag `userData.part`, and inject shared clipping planes.

For a machine outside `SKILL_DIR`, make a folder with a `main.js` and import the kit by name: `import {runSim} from 'shattercraft-kit/runtime.js'`. Build it with `node "$SKILL_DIR/sims/build.mjs" ./my-machine`.

## Rules that decide whether it works

1. **Start from a reference, never from imagination.** A photo, a cutaway drawing from a manual, a clip of the real thing. Build against it and compare frame by frame. Machines invented from a sentence come out generic every time; the same model rebuilds a real one closely when it has something to match.
2. **Real numbers, one source.** Get the real dimensions first (bore, stroke, gear ratio, link lengths). Every gauge, chart and label reads from the same function that poses the parts, so nothing on screen can disagree with the motion. Check one by hand: in the GTF-1200, a `3.06:1` star planetary gearbox turns the 18-blade fan at `3400 RPM` when the LP turbine spool runs at `10,404 RPM`.
3. **One input drives everything.** Pose from the crank angle, the stroke or the wind. Nothing is keyframed by hand, so the film, the live page and the score never drift.
4. **The part doing the work opens up.** Isolate it, cut it, x-ray it (`X-RAY`), split it 50/50 (`SPLIT`), simulate faults (`FAULT` modes: Normal / Misfire / Knock / Overheat), or explode it with the Inspector slider. A camera that goes inside is worth more than ten orbits.
5. **Light studio, one accent.** Pale backgrounds read in a feed; dark ones lose the first second. The accent marks the thing that is changing. Watch near-white parts on a pale backdrop: give them an ink outline or a darker ground.
6. **Pick the camera for the mechanism.** A planar linkage seen face-on collapses into a lattice; a 3/4 view along the spine keeps every leg readable.
7. **Fix collisions with a number.** When a part pokes through another, scale or move it in the parameter block. Never hide it with the camera.

## Live page rules

- **Test on an integrated GPU.** A page that runs at 60 fps on a desktop card can drop to 15 fps on a laptop's built-in one. `live-shell.js` includes the adaptive FPS Quality Guard (`HIGH`/`MED`/`LOW`): no AO, lower pixel ratio, smaller shadow maps, panels redrawn every other frame. Find the expensive shader first: a displacement computed 5 times per vertex costs more than every tier together.
- **Warm the shaders.** `kit/warm.js` compiles every program in parallel before the first frame, so the page never freezes on first draw.
- **Keep the page under 1 MB.** Link crawlers (X, Slack) read the share card from the HTML and give up on a 15 MB page. Big models go out as files next to the page: `build.json` → `{"external": {"heavy.glb": "light.glb"}}`.

## render(t) contract

```js
import {runSim} from '../kit/runtime.js';

const DEFAULTS = {duration: 20, fps: 60, hud: {enabled: false}, director: {enabled: false}};

runSim(DEFAULTS, async ({cfg, canvas, capture}) => {
  // build the scene, precompute anything stateful
  return {render(t) { /* draw frame t from scratch */ return {}; }, resize() {}};
});
```

- `render(t)` is pure: no `Math.random` (use `rng(seed)` from `kit/util.js` at setup), no `Date`, no state carried between frames. Capture calls it at arbitrary times.
- Anything that moves by its own rules (agents, particles) is simulated once at load into typed arrays; `render` only reads them. A quantity integrated over time (the Strandbeest's crank under a changing wind) is integrated in closed form or tabulated at load.
- Every beat goes into `<name>-film/timeline.json` in seconds. The score reads the same file.
- Frame 0 is the thumbnail. It must already show the machine.

## Commands

```
node "$SKILL_DIR/sims/build.mjs" v8-film
node "$SKILL_DIR/sims/capture.mjs" v8-film --size 1600x900 --dpr 1.2 --stills beats --cols 4 --out shattercraft-out/v8-beats.png
node "$SKILL_DIR/sims/capture.mjs" v8-film --size 1600x900 --dpr 1.2 --still 12.5 --out shattercraft-out/v8-12.5.png
node "$SKILL_DIR/sims/capture.mjs" v8-film --size 1600x900 --dpr 1.2 --out shattercraft-out/v8-silent.mp4
python "$SKILL_DIR/run_sfx.py" "$SKILL_DIR/sims/v8-shared/score.py"
ffmpeg -y -i shattercraft-out/v8-silent.mp4 -i shattercraft-out/v8-score.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart shattercraft-out/v8.mp4
node "$SKILL_DIR/wave.mjs" shattercraft-out/v8.mp4 --timeline "$SKILL_DIR/sims/v8-film/timeline.json"
```

`--size` is the CSS layout and `--dpr` multiplies it: 1600 x 900 at 1.2 gives 1920 x 1080. Capture prints the GPU it got; a software renderer means the GPU flags in `paths.mjs` did not take.

## Verification & Review loop

For automated build and headless browser verification across the Studio Hub and all simulators:

```
npm test    # runs node tests/verify-builds.mjs
```

For visual film verification, you cannot watch the video; you can look at frames. Never report a machine as done without reading sheets of the current render.

1. `--stills beats`: one tile per timeline beat, 0.3 s after it, each labelled `t=`.
2. Read every tile against the checklist below.
3. Zoom in: `--stills every:0.2 --from A --to B` for a transition, `--still T` for one full frame.
4. Fix, rebuild, go back to 1. Stop when a full pass finds nothing.
5. Final: `node "$SKILL_DIR/sheet.mjs" --video <final.mp4> --timeline <timeline.json>` and read that too: it shows what the encoder wrote.

Checklist:

- **The mechanism.** Every part that should touch touches; nothing passes through anything; the numbers on the panels match the pose.
- **Composition.** One focal point per frame. Nothing important within 60 px of an edge. Labels never cover the part they name.
- **Type.** Nothing clipped. The key readout reads at phone width.
- **3D.** Bloom eats detail: keep emissive layers under 1.0. Near-white surfaces blow out. Glossy metal under a low light streaks: roughness ≥ 0.45 and envMapIntensity ≈ 0.5 on big surfaces.
- **Timing.** Each state holds long enough to read: 1 s for a short phrase plus 0.25 s per word beyond three.

## three.js traps the examples already hit

- `smoothstep(a, b, x)` with `a > b` returns 0 on Windows (ANGLE/D3D). Write `1.0 - smoothstep(b, a, x)`.
- A `ShadowMaterial` or a decal a fraction of a millimetre above the floor loses the depth test inside a post-processing render target. Give it `polygonOffset`.
- A quad laid into the ground with a mirrored mapping gets culled as a back face. Use `DoubleSide`.
- One NaN pixel blacks out the whole frame through bloom. Clamp every `pow()` base in a shader.
- GTAO on a clipped (cutaway) model needs the same clipping planes on `gtao.normalMaterial`, or the cut half returns as a pale ghost.

## Sound

`sfx/` synthesises every sound in pure Python (48 kHz, reproducible) and reads the film's timeline, so sound cannot drift out of sync. `python "$SKILL_DIR/run_sfx.py" --list` shows the generators. `sample()` adds the recorded CC0 sounds in `sfx/samples/`. `sfx/score_kit.py` has the beds and accents the 3 scores use: a chord bed, a soft thud per power stroke, a motor, air under a drag.

- Every time comes from the timeline, never a typed number.
- Mastering is automatic: −14 LUFS, true peak ≤ −2 dBFS.
- Accent, never narrate: continuous motion stays silent. One key for every tonal sound.

## Taste, with numbers

- Easing: entrances `cubic-bezier(0.16, 1, 0.3, 1)`, exits `cubic-bezier(0.6, 0, 0.9, 0.35)` at half the entrance's length, state to state `cubic-bezier(0.65, 0, 0.35, 1)`. Linear only for continuous motion.
- The machine fills 60-70% of its viewport. Labels never under 34 px on a 1080 canvas.
- One accent, and it means something: the part that is working right now.
- Nothing dead-still: one element always alive.

## Credits

The kit, frame capture, sfx engine and review rules come from [whaleyxbt/claude-motion](https://github.com/whaleyxbt/claude-motion) (MIT). The recorded samples are CC0 from Freesound, trimmed by [Barty-Bart/motion-graphics](https://github.com/Barty-Bart/motion-graphics) (MIT); sources in `sfx/samples/SOURCES.md`.
