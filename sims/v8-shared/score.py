"""Score for the V8 four-stroke explorer: cool Am9 studio bed (92 bpm), cross-plane V8 rhythmic
combustion hits (1-8-4-3-6-5-7-2 L/R bank cadence), harmonic exhaust growl, crisp afterfire
flame-pop transients & percussive drive synced to the 700->2400 RPM ramp and key camera beats.

    python run_sfx.py sims/v8-shared/score.py

Times and the crank model mirror v8-shared/film.js (SCRIPT, rpmAt, 1/20 playback).
"""

import math
import os
import random

from sfx.dsp import svf
from sfx.score_kit import airy, bed, chords, hz, rumble, thud
from sfx.synth import SR, bandnoise, click, kick, snare

TIMELINE = "../v8-film/timeline.json"
OUT = os.path.join(os.environ.get("SHATTERCRAFT_OUT", "shattercraft-out"), "v8-score.wav")
TARGET_LUFS = -14.0
SEED = 13

CHORDS = chords("Am9:A2 E3 G3 B3 C4/A1", "Fmaj7:F2 C3 E3 A3/F1", "Cmaj7:C3 E3 G3 B3/C2", "G6:G2 D3 E3 B3/G1")
MOTIF = [(0.5, hz("E5")), (1.5, hz("C5")), (2.5, hz("B4"))]
BEATS = (0.0, 3.5, 6.9, 9.7, 12.1, 14.7, 17.3, 19.9, 22.5)
CLICKS = (3.5, 6.9, 9.7, 12.1, 14.7, 17.3, 19.9, 22.5)
RPM = (12.1, 700.0, 2400.0, 1.4)
V8_ORDER = (1, 8, 4, 3, 6, 5, 7, 2)


def smoother(x):
    u = min(1.0, max(0.0, x))
    return u * u * u * (u * (u * 6 - 15) + 10)


def rpm_at(t):
    t0, a, b, d = RPM
    return a + (b - a) * smoother((t - t0) / d)


def firings(dur, dt=1 / 480):
    """Return (time, cylinder_number) for every 90-degree cross-plane firing event."""
    out, th, t, nxt, slot = [], 12.0, 0.0, 90.0, 1
    while t < dur:
        th += rpm_at(t) / 60 * 360 * dt / 20
        if th >= nxt:
            out.append((t, V8_ORDER[slot % 8]))
            nxt += 90
            slot += 1
        t += dt
    return out


def combustion_hit(bank, rpm_norm, accent=1.0):
    """Layered cross-plane combustion punch: sub pitch-drop + mid header bark + plasma spark snap."""
    dur = 0.145 - 0.042 * rpm_norm
    n = max(1, int(dur * SR))
    is_left = bank == "L"
    f0 = (102.0 if is_left else 112.0) + 38.0 * rpm_norm
    f1 = 36.0 if is_left else 40.0
    bark = bandnoise(n, lambda k: (245.0 if is_left else 315.0) + 390.0 * rpm_norm, q=1.55)
    out = []
    ph = 0.0
    for k in range(n):
        t = k / SR
        f = f1 + (f0 - f1) * math.exp(-t / 0.022)
        ph += 2.0 * math.pi * f / SR
        env_sub = math.exp(-t / (0.044 - 0.012 * rpm_norm)) * min(1.0, t / 0.0018)
        env_bark = math.exp(-t / 0.025) * min(1.0, t / 0.001)
        snap = math.sin(2.0 * math.pi * (1020.0 + 680.0 * rpm_norm) * t) * math.exp(-t / 0.0055) * (0.16 + 0.16 * rpm_norm)
        s = 0.82 * math.sin(ph) * env_sub + (0.46 + 0.28 * rpm_norm) * bark[k] * env_bark + snap
        out.append(accent * math.tanh(1.42 * s))
    return out


def crackle_pop(rpm_norm, seed=0, double_burst=False):
    """Crisp exhaust afterfire flame-pop: resonant collector thump + dual flame snap."""
    rnd = random.Random(seed)
    n = int((0.088 if double_burst else 0.058) * SR)
    fc1 = 920.0 + 820.0 * rnd.random() + 340.0 * rpm_norm
    fc2 = 1150.0 + 950.0 * rnd.random() + 300.0 * rpm_norm
    noise1 = bandnoise(n, lambda k: fc1, q=2.1)
    noise2 = bandnoise(n, lambda k: fc2, q=2.3) if double_burst else None
    out = []
    ph = 0.0
    d2 = 0.028 + 0.012 * rnd.random()
    for k in range(n):
        t = k / SR
        ph += 2.0 * math.pi * (145.0 * math.exp(-t / 0.022) + 46.0) / SR
        s = noise1[k] * 1.65 * math.exp(-t / 0.011) + 0.44 * math.sin(ph) * math.exp(-t / 0.019)
        if double_burst and t >= d2:
            dt2 = t - d2
            s += 0.78 * (noise2[k] * 1.55 * math.exp(-dt2 / 0.01) + 0.35 * math.sin(ph * 1.15) * math.exp(-dt2 / 0.015))
        out.append(math.tanh(1.48 * s))
    return out


def score(mix, tl):
    dur = tl["duration"]
    left, right, low, drums = bed(
        dur,
        92,
        CHORDS,
        MOTIF,
        motif_voice="epiano",
        kicks=(0, 1.5, 2.5),
        snares=(1, 3),
        hats=8,
        swing=0.0,
        drums_from=0,
        keys_vel=0.72,
        keys_lp=3700,
    )
    mix.put_stereo(0, left, right, 0.115)
    mix.put(0, low, 0.11)
    mix.put(0, drums, 0.044)

    # Cross-plane V8 harmonic exhaust growl tracking the 700 -> 2400 RPM ramp
    raw_rumble = rumble(dur - 0.35, lambda t: 36.0 + 34.0 * ((rpm_at(t) - 700.0) / 1700.0), level=0.62)
    growl = [math.tanh(1.55 * x) for x in raw_rumble]
    engine_hum = svf(growl, 520, 0.75, "lp")
    mix.put(0.1, engine_hum, 0.056)

    # Tight rhythmic cross-plane combustion hits (1-8-4-3-6-5-7-2 L/R bank cadence) + afterfire flame pops
    for idx, (t, cyl) in enumerate(firings(dur - 0.25)):
        rpm_norm = (rpm_at(t) - 700.0) / 1700.0
        bank = "L" if cyl % 2 == 1 else "R"
        pan = -0.24 if bank == "L" else 0.24
        accent = 1.16 if cyl in (1, 4, 7) else 0.94
        gain = (0.062 + 0.04 * rpm_norm) * accent
        mix.put(t, combustion_hit(bank, rpm_norm, accent), gain, pan=pan)

        # Afterfire flame-pop bursts during throttle surge (12.8..14.4) and consecutive-bank pairs at 2400 RPM
        if (12.8 <= t <= 14.4 and idx % 2 == 0) or (t > 14.4 and cyl in (4, 7) and idx % 3 == 0):
            double = 13.1 <= t <= 14.1 or cyl == 7
            mix.put(t + 0.016, crackle_pop(rpm_norm, seed=idx + 41, double_burst=double), 0.042, pan=pan * 1.25)

    # Key camera beat accents: tight sub-punch, crisp percussive drive, and afterfire pops on major beats
    beat_kick = kick(0.9)
    beat_snare = snare(0.45)
    for i, t in enumerate(BEATS):
        mix.put(t, thud(52 if i in (0, 4, 7) else 62, 0.095, 0.26), 0.058 if i in (0, 4, 7) else 0.04)
        if i in (0, 4, 7):
            mix.put(t, beat_kick, 0.045)
        if i in (1, 3, 5, 8):
            mix.put(t, beat_snare, 0.024)
        if i in (4, 5, 6, 7):
            mix.put(t + 0.022, crackle_pop(0.95, seed=90 + i, double_burst=(i in (4, 7))), 0.038, pan=-0.22 if i % 2 == 0 else 0.22)

    # Tactile clicks on UI transitions & section cutaway latches
    for t in CLICKS:
        mix.put(t, click(2450, 0.024), 0.055)
    mix.put(14.72, click(1550, 0.03), 0.036)
    mix.put(17.32, click(1850, 0.028), 0.033)

    # Throttle ramp intake/exhaust airflow + camera move air sweeps
    mix.put(RPM[0], airy(RPM[3] + 0.85, 360, 2100, 0.75), 0.044)
    for t in (0.0, 3.5, 9.7, 14.7, 17.3, 19.9):
        mix.put(t, airy(1.15, 680, 1550, 0.6), 0.02)
