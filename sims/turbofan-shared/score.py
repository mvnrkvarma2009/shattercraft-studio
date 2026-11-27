"""Score for the GTF-1200 Geared Turbofan explorer: cool studio lo-fi bed (Dm9, 96 bpm),
subtle dual-spool turbine hum & jet air swell rising across the 10.5s TOGA throttle ramp,
and crisp tactile clicks on every beat and cutaway latch.

    python run_sfx.py sims/turbofan-shared/score.py
"""

import os

from sfx.score_kit import airy, bed, chords, hz, rumble
from sfx.synth import click

TIMELINE = "../turbofan-film/timeline.json"
OUT = os.path.join(os.environ.get("SHATTERCRAFT_OUT", "shattercraft-out"), "turbofan-score.wav")
TARGET_LUFS = -14.0
SEED = 27

CHORDS = chords("Dm9:D2 A2 C3 E3 F3/D1", "Bbmaj7:Bb1 F2 A2 D3/Bb1", "Gm9:G2 D3 F3 A3/G1", "A7sus4:A2 D3 E3 G3/A1")
MOTIF = [(0.5, hz("A4")), (1.5, hz("F4")), (2.5, hz("E4"))]
CLICKS = (3.5, 7.0, 10.5, 14.2, 17.6, 20.8, 23.2)
THROTTLE = (10.5, 0.25, 1.0, 1.8)


def smoother(x):
    u = min(1.0, max(0.0, x))
    return u * u * u * (u * (u * 6 - 15) + 10)


def throttle_at(t):
    t0, a, b, d = THROTTLE
    return a + (b - a) * smoother((t - t0) / d)


def score(mix, tl):
    dur = tl["duration"]
    left, right, low, drums = bed(
        dur, 96, CHORDS, MOTIF, motif_voice="epiano", kicks=(0, 2.5), snares=(), hats=8, swing=0.0, keys_vel=0.68, keys_lp=3600
    )
    mix.put_stereo(0, left, right, 0.12)
    mix.put(0, low, 0.11)
    mix.put(0, drums, 0.038)

    # Subtle dual-spool turbine core hum rising with TOGA throttle ramp
    mix.put(0.2, rumble(dur - 0.5, lambda t: 74.0 + 48.0 * throttle_at(t), level=0.45), 0.045)

    # Jet exhaust airflow swell under the TOGA ramp (10.5s -> 12.3s)
    mix.put(THROTTLE[0], airy(THROTTLE[3] + 1.2, 340, 1850, 0.7), 0.038)

    # Tactile clicks on every beat + cutaway latch accents
    for t in CLICKS:
        mix.put(t, click(2500, 0.024), 0.052)
    mix.put(7.02, click(1550, 0.03), 0.035)
    mix.put(20.82, click(1850, 0.028), 0.032)

    # Soft air sweep on major camera moves
    for t in (3.5, 7.0, 14.2, 17.6, 20.8, 23.2):
        mix.put(t, airy(1.1, 650, 1450, 0.55), 0.018)
