#!/usr/bin/env python3
"""The score for the long way up, synthesised from the film's cue sheet.

    node journey/render.mjs --cues   # writes journey/out/cues.json
    python3 journey/score.py         # writes journey/out/score.wav

Same voices as the reel's score, arranged to the story. A music box over the
college years in F. The gate year ticks like a clock until the cramming cracks.
The job hunt drops out to almost nothing, and the one reply that comes back is
a single ping. Everything stops for a quarter of a second before "yes.", then
the reel's drive runs through the excloud years, and the range comes up in the
reel's own finale, D minor turned major at sunrise.
"""

import json
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
DUR = 60.0
N = int(SR * DUR)
HERE = Path(__file__).parent
OUT = HERE / "out"
rng = np.random.default_rng(8091)

CUES = json.load(open(OUT / "cues.json"))


def cues(kind):
    return [c for c in CUES if c["type"] == kind]


# ---------------------------------------------------------------- pitch

NAMES = {"C": 0, "C#": 1, "Db": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "Ab": 8, "A": 9, "Bb": 10, "B": 11}


def hz(note):
    name, octave = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((12 * (octave + 1) + NAMES[name] - 69) / 12)


def scale(names, lo, count):
    out, octave = [], lo
    while len(out) < count:
        for n in names:
            out.append(hz(f"{n}{octave}"))
        octave += 1
    return out[:count]


MINOR_PENT = ["D", "F", "G", "A", "C"]
MAJOR_PENT = ["D", "E", "F#", "A", "B"]

# ---------------------------------------------------------------- buses

BUSES = {k: np.zeros((N, 2)) for k in ["drums", "bass", "pad", "sfx", "bell", "air"]}
SEND = {"drums": 0.10, "bass": 0.0, "pad": 0.30, "sfx": 0.22, "bell": 0.50, "air": 0.35}


def place(bus, t0, x, gain=1.0, pan=0.0):
    """Mix mono or stereo x into a bus at t0 seconds, equal-power panned."""
    if x.ndim == 1:
        a = (pan + 1) * np.pi / 4
        x = np.stack([x * np.cos(a), x * np.sin(a)], axis=1)
    i0 = int(round(t0 * SR))
    if i0 < 0:
        x, i0 = x[-i0:], 0
    i1 = min(N, i0 + len(x))
    if i1 > i0:
        BUSES[bus][i0:i1] += gain * x[: i1 - i0]


def T(n):
    return np.arange(n) / SR


def butter(x, kind, f, order=2):
    sos = signal.butter(order, f, btype=kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def svf_sweep(x, f0, f1, q=0.7, curve=None):
    """Band-pass with a moving centre: a chamberlin state-variable filter."""
    n = len(x)
    u = np.linspace(0, 1, n) if curve is None else curve
    fc = f0 * (f1 / f0) ** u
    F = 2 * np.sin(np.pi * np.minimum(fc, SR / 6) / SR)
    low = band = 0.0
    y = np.empty(n)
    for i in range(n):
        high = x[i] - low - q * band
        band += F[i] * high
        low += F[i] * band
        y[i] = band
    return y


# ---------------------------------------------------------------- voices


def kick(amp=1.0, dur=0.55, low=44):
    n = int(dur * SR)
    t = T(n)
    f = low + 120 * np.exp(-t / 0.032)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.3)
    click = butter(rng.standard_normal(n) * np.exp(-t / 0.0025), "highpass", 1800) * 0.35
    return amp * np.tanh(1.4 * (body + click))


def sub_boom(amp=1.0, dur=2.2):
    n = int(dur * SR)
    t = T(n)
    f = 30 + 34 * np.exp(-t / 0.25)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    return amp * np.tanh(1.8 * x)


def snare(amp=1.0, dur=0.4):
    n = int(dur * SR)
    t = T(n)
    noise = butter(rng.standard_normal(n), "bandpass", [1500, 7000]) * np.exp(-t / 0.11)
    tone = np.sin(2 * np.pi * 186 * t) * np.exp(-t / 0.05)
    return amp * (0.8 * noise + 0.5 * tone)


def clap(amp=1.0):
    n = int(0.35 * SR)
    t = T(n)
    env = np.zeros(n)
    for d in (0, 0.011, 0.023):
        i = int(d * SR)
        env[i:] += np.exp(-(t[: n - i]) / 0.008)
    env += 0.5 * np.exp(-t / 0.12) * (t > 0.023)
    return amp * butter(rng.standard_normal(n), "bandpass", [900, 3200]) * env


def hat(amp=1.0, open_=False):
    n = int((0.25 if open_ else 0.06) * SR)
    t = T(n)
    return amp * butter(rng.standard_normal(n), "highpass", 7500) * np.exp(-t / (0.09 if open_ else 0.018))


def tick(amp=1.0, f=2600):
    n = int(0.03 * SR)
    t = T(n)
    tone = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.004)
    noise = butter(rng.standard_normal(n), "highpass", 3000) * np.exp(-t / 0.0015)
    return amp * (tone + 0.5 * noise)


def click(amp=1.0):
    n = int(0.008 * SR)
    t = T(n)
    return amp * butter(rng.standard_normal(n), "bandpass", [2500, 9000]) * np.exp(-t / 0.0012)


def blip(f, dur=0.09, amp=1.0, tone=0.2):
    n = int(dur * SR)
    t = T(n)
    env = np.minimum(1, t / 0.002) * np.exp(-t / (dur / 3.5))
    x = np.sin(2 * np.pi * f * t) + tone * np.sin(2 * np.pi * 3 * f * t) / 3 + tone * np.sin(2 * np.pi * 5 * f * t) / 7
    return amp * x * env


def glide(f0, f1, dur, amp=1.0, harm=0.15):
    n = int(dur * SR)
    t = T(n)
    f = f0 * (f1 / f0) ** (t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    env = np.minimum(1, t / 0.01) * np.minimum(1, (dur - t) / 0.03)
    return amp * env * (np.sin(ph) + harm * np.sin(2 * ph))


def bell(f, dur=1.6, amp=1.0):
    n = int(dur * SR)
    t = T(n)
    x = np.zeros(n)
    for ratio, a, d in [(1, 1, 1), (2.0, 0.45, 0.55), (2.76, 0.35, 0.4), (5.4, 0.2, 0.22), (8.93, 0.1, 0.12)]:
        x += a * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / (dur * d / 3))
    return amp * x * np.minimum(1, t / 0.0015)


def pluck(f, dur=0.25, amp=1.0, harm=7, bright=1.0):
    n = int(dur * SR)
    t = T(n)
    x = np.zeros(n)
    for k in range(1, harm + 1):
        x += (1 / k) * np.sin(2 * np.pi * f * k * t) * np.exp(-t * (3 + 9 * k / bright))
    env = np.minimum(1, t / 0.003) * np.minimum(1, (dur - t) / 0.01)
    return amp * x * env


def subnote(f, dur, amp=1.0, tau=1.4):
    """A held bass note: mostly sine, a little second harmonic, slow decay."""
    n = int(dur * SR)
    t = T(n)
    env = np.minimum(1, t / 0.012) * np.exp(-t / tau) * np.minimum(1, (dur - t) / 0.15)
    return amp * env * np.tanh(1.3 * (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)))


def pad(freqs, dur, amp=1.0, attack=0.6, release=0.8, dark=None, shape=None):
    """Detuned additive saws. dark(t) sets how fast harmonics fall away, which
    is a low-pass you can sweep without running a filter."""
    n = int(dur * SR)
    t = T(n)
    d = np.full(n, 0.35) if dark is None else dark(t)
    out = np.zeros((n, 2))
    for f in freqs:
        for ch, cents in ((0, (-9, 3)), (1, (-3, 8))):
            for c in cents:
                ff = f * 2 ** (c / 1200)
                ph0 = rng.uniform(0, 2 * np.pi)
                for k in range(1, 40):
                    if ff * k > 7000:
                        break
                    out[:, ch] += (k ** -1.15) * np.exp(-(k - 1) * d) * np.sin(2 * np.pi * ff * k * t + ph0 * k)
    env = np.minimum(1, t / attack) * np.minimum(1, np.maximum(0, (dur - t) / release))
    if shape is not None:
        env = env * shape(t)
    return amp * out * env[:, None] / (len(freqs) * 2)


def whoosh(dur, f0, f1, amp=1.0, peak=0.5, q=0.6):
    n = int(dur * SR)
    t = T(n) / dur
    env = np.where(t < peak, (t / peak) ** 2.2, np.exp(-(t - peak) / (1 - peak) * 4))
    x = svf_sweep(rng.standard_normal(n), f0, f1, q=q)
    return amp * x * env


def crackle(dur, rate, amp=1.0, decay=None):
    n = int(dur * SR)
    x = np.zeros(n)
    count = int(rate * dur)
    where = np.sort(rng.uniform(0, 1, count) ** 1.6) * (n - 1)
    for w in where.astype(int):
        a = rng.uniform(0.2, 1.0) * (np.exp(-w / SR / decay) if decay else 1)
        x[w] += a * rng.choice([-1, 1])
    x = butter(x, "bandpass", [1800, 9000])
    return amp * x


# ---------------------------------------------------------------- the ridge

def ridge_track():
    """The skyline at the head of the drawn line, per sample, so the tone that
    draws the ridge climbs and falls with the actual range."""
    sky = json.load(open(HERE.parent / "public/assets/annapurna-skyline.json"))
    ys = np.array(sky["y"], float)
    s, px, py = 0.34, -30, 92

    def ridge(x):
        f = ((x + 0.5 - px) / s) / sky["step"]
        return np.interp(f, np.arange(len(ys)), ys) * s + py

    t0, dur = 52.0, 0.58
    n = int(dur * SR)
    u = np.arange(n) / n
    e = np.where(u < 0.5, 4 * u ** 3, 1 - (-2 * u + 2) ** 3 / 2)
    x = e * 960
    return t0, x, ridge(x)




# ================================================================ arrangement

BAR = 2.0
BEAT = 0.5

VOICING = {
    "Fmaj9": ["F3", "C4", "E4", "G4", "A4"],
    "F": ["F2", "C3", "F3", "A3", "C4"],
    "C": ["C3", "G3", "C4", "E4", "G4"],
    "Dm": ["D3", "A3", "D4", "F4", "A4"],
    "Bb": ["Bb2", "F3", "Bb3", "D4", "F4"],
    "Gm": ["G2", "D3", "G3", "Bb3", "D4"],
    "A": ["A2", "E3", "A3", "C#4", "E4"],
    "Bbmaj7": ["Bb2", "F3", "A3", "D4", "F4"],
    "D": ["D3", "A3", "D4", "F#4", "A4", "E5"],
}
ROOT = {"Fmaj9": "F2", "F": "F2", "C": "C2", "Dm": "D2", "Bb": "Bb1", "Gm": "G1", "A": "A1"}

# where the harmony sits under each part of the story
PLAN = [
    (2, "Fmaj9"), (4, "F"), (6, "C"), (8, "Dm"), (10, "Bb"), (11, "C"),   # svit, the goal
    (12, "Dm"), (14, "Bb"), (16, "F"),                                   # gate: cram, then clarity
    (18, "Dm"), (20, "Bb"), (22, "C"),                                   # the oracle boxes
    (24, "Gm"), (26, "A"),                                               # no interviews
    (28, "F"), (30, "C"), (32, "Dm"),                                    # the ticket
    (34, "Dm"), (36, "Bb"), (38, "F"), (40, "C"), (42, "Dm"),            # three years
    (44, "Bb"), (46, "F"), (48, "C"), (49, "Gm"), (50, "A"),             # handover, side projects, now
]
PLAN_END = 51.75


def span(i):
    t0, ch = PLAN[i]
    t1 = PLAN[i + 1][0] if i + 1 < len(PLAN) else PLAN_END
    return t0, t1, ch


# how loud the bed is, by act: quiet at college, down at the job hunt,
# nothing at all in the breath before "yes."
def bed_level(t):
    if t < 12: return 0.10
    if t < 18: return 0.11
    if t < 23.5: return 0.12
    if t < 28: return 0.08
    if t < 32.6: return 0.11
    if t < 34: return 0.06
    return 0.13


for i in range(len(PLAN)):
    t0, t1, ch = span(i)
    if 33.75 <= t0 < 34:
        continue
    end = min(t1, 33.75) if t0 < 33.75 else t1
    place("pad", t0, pad([hz(n) for n in VOICING[ch]], end - t0 + 0.5, bed_level(t0), attack=0.25 if t0 < 34 else 0.05, release=0.5))

# bass: held roots early, a pulse once things start moving
for i in range(len(PLAN)):
    t0, t1, ch = span(i)
    f = hz(ROOT[ch])
    if t0 < 18 or 23.5 <= t0 < 28:
        place("bass", t0, subnote(f, t1 - t0 + 0.05, 0.34 if t0 < 18 else 0.26, tau=1.6))
        continue
    stop = min(t1, 33.75) if t0 < 34 else t1
    t, k = t0, 0
    step = 0.25 if t0 < 49 else 0.125
    while t < stop - 1e-6:
        oct_ = 2 if k % 4 == 2 else 1
        acc = (0.5 if k % 2 == 0 else 0.34) * (0.65 if t0 < 34 else 1.0)
        place("bass", t, pluck(f * oct_, step * 0.95, acc, harm=6, bright=0.6))
        t += step
        k += 1

# a music box over the college years: the chord, broken into eighths
box_notes = {ch: [hz(n) for n in VOICING[ch]][1:] for ch in VOICING}
for i in range(len(PLAN)):
    t0, t1, ch = span(i)
    if t0 >= 12:
        break
    t, k = max(t0, 3.5), 0
    while t < t1 - 1e-6:
        notes = box_notes[ch]
        f = notes[[0, 2, 1, 3, 2, 3, 1, 2][k % 8] % len(notes)] * 2
        place("bell", t, bell(f, 0.9, 0.035 + 0.01 * (k % 2 == 0)), pan=0.3 * np.sin(k))
        t += 0.25
        k += 1


def drums(t0, t1, style, level=1.0):
    t = t0
    while t < t1 - 1e-6:
        beat = round((t - t0) / BEAT)
        if style == "soft":
            place("drums", t + BEAT / 2, hat(0.06 * level), pan=0.25)
            if beat % 2 == 0:
                place("drums", t, kick(0.35 * level, 0.4))
        elif style == "clock":
            place("drums", t, tick(0.07 * level, 2600 if beat % 2 == 0 else 2100), pan=-0.2 if beat % 2 == 0 else 0.2)
            place("drums", t + BEAT / 2, tick(0.05 * level, 2350), pan=0)
        elif style == "four":
            place("drums", t, kick(0.8 * level))
            place("drums", t + BEAT / 2, hat(0.14 * level), pan=0.2)
            if beat % 2 == 1:
                place("drums", t, clap(0.35 * level))
        elif style == "drive":
            place("drums", t, kick(0.9 * level))
            if beat % 2 == 1:
                place("drums", t, clap(0.42 * level))
            place("drums", t + BEAT / 2, hat(0.16 * level), pan=0.2)
            place("drums", t + BEAT / 4, hat(0.07 * level), pan=-0.25)
            place("drums", t + 3 * BEAT / 4, hat(0.09 * level), pan=0.3)
        t += BEAT


drums(6.0, 12.0, "soft")
drums(12.5, 16.0, "clock")
drums(16.0, 18.0, "soft", 1.2)
drums(18.0, 23.5, "four", 0.6)
drums(28.5, 32.5, "soft", 1.3)
drums(34.0, 43.0, "drive")
drums(43.0, 49.0, "four", 0.9)
drums(49.0, 51.0, "four")
# two rolls: into "yes." and into the range
for (r0, r1) in [(32.9, 33.72), (51.0, 51.72)]:
    t, gap = r0, 0.125
    while t < r1:
        place("drums", t, snare(0.08 + 0.3 * (t - r0) / (r1 - r0)), pan=0.1)
        gap = max(0.03, gap * 0.86)
        t += gap
for (r0, dur) in [(32.2, 1.55), (50.25, 1.5)]:
    n = int(dur * SR)
    rt = T(n) / dur
    place("air", r0, svf_sweep(rng.standard_normal(n), 300, 9000, q=0.5, curve=rt ** 1.5) * rt ** 2, 0.38)
    place("sfx", r0, glide(110, 880, dur, 0.045, harm=0.4))

# ---------------------------------------------------------------- the title
for c in cues("tick"):
    place("sfx", c["t"], tick(0.5, 2400))
    place("sfx", c["t"], blip(hz("F3"), 0.12, 0.22, 0))
for c in cues("key"):
    place("sfx", c["t"], tick(0.11, 2200 + 90 * (int(c["v"]) % 3)), pan=-0.1 + 0.02 * c["v"])
    place("sfx", c["t"], click(0.05))
place("air", 1.55, whoosh(0.5, 500, 7000, 0.22, peak=0.9))
for c in cues("title"):
    place("bass", c["t"], sub_boom(0.45, 2.0))
    for k, n in enumerate(["F4", "A4", "C5", "E5", "G5"]):
        place("bell", c["t"] + k * 0.035, bell(hz(n), 2.6, 0.07), pan=-0.4 + 0.2 * k)
for c in cues("sub"):
    place("sfx", c["t"], crackle(0.35, 120, 0.25))

# ---------------------------------------------------------------- whips and lines
for c in cues("whip"):
    place("air", c["t"] - 0.05, whoosh(0.6, 250, 7000, 0.26, peak=0.5))
    if c["t"] > 34:
        place("drums", c["t"] + 0.25, kick(0.3, 0.3, low=60))
for c in cues("cut"):
    place("air", c["t"], whoosh(0.28, 600, 9000, 0.2, peak=0.5))
# every line of narration is printed: a little ink as it lands
for c in cues("line"):
    place("sfx", c["t"], crackle(0.36, 90 if c["v"] else 50, 0.16), pan=-0.45)

# ---------------------------------------------------------------- 2018
win_notes = scale(MAJOR_PENT, 5, 12)
for i, c in enumerate(cues("window")):
    place("bell", c["t"], blip(win_notes[i % 12] * (2 ** -(1/12 * 3)), 0.06, 0.035, 0.3), pan=rng.uniform(-0.5, 0.5))
for c in cues("browser"):
    place("sfx", c["t"], glide(300, 700, 0.2, 0.05))
for c in cues("row"):
    place("sfx", c["t"], tick(0.05, 3000 - 120 * c["v"]), pan=0.3)
for c in cues("phones"):
    place("sfx", c["t"], glide(500, 260, 0.25, 0.05))
for c in cues("cellrow"):
    place("sfx", c["t"], click(0.06), pan=-0.2)
    place("sfx", c["t"] + 0.07, click(0.05), pan=0.2)
for c in cues("shipped"):
    place("bell", c["t"], bell(hz("C6"), 1.4, 0.08), pan=0.2)
    place("bell", c["t"] + 0.07, bell(hz("F6"), 1.4, 0.07), pan=0.3)

# ---------------------------------------------------------------- the goal
for c in cues("word"):
    place("drums", c["t"], kick(0.25, 0.35, low=70))
    place("bell", c["t"], bell(hz("F5" if c["t"] < 10.2 else "C6"), 1.8, 0.07))
for c in cues("slab"):
    place("sfx", c["t"], glide(80, 60, 0.4, 0.12, harm=0.5))
blk = scale(MAJOR_PENT, 4, 14)
for c in cues("block"):
    place("drums", c["t"], kick(0.12, 0.15, low=90 + 6 * c["v"]))
    place("bell", c["t"], pluck(blk[int(c["v"]) % 14] * 1.5, 0.25, 0.05, harm=4, bright=2))

# ---------------------------------------------------------------- 2022, gate
for c in cues("cram"):
    k = int(c["v"])
    # each subject lands a little lower and a little more squashed
    place("sfx", c["t"], glide(900 - 40 * k, 500 - 25 * k, 0.07, 0.07, harm=0.6), pan=0.1)
for c in cues("crack"):
    n = int(0.35 * SR)
    t = T(n)
    buzz = sum(np.sin(2 * np.pi * 98 * k * t) / k for k in (1, 3, 5, 7)) * np.exp(-t / 0.2)
    place("sfx", c["t"], np.tanh(2.5 * buzz) * 0.12)
    place("air", c["t"], butter(rng.standard_normal(n), "bandpass", [300, 3000]) * np.exp(-t / 0.08) * 0.25)
tier_notes = ["F5", "D5", "C5", "A4", "F4"]
for c in cues("tier"):
    place("bell", c["t"], bell(hz(tier_notes[int(c["v"])]), 1.6, 0.08), pan=0.2 - 0.1 * c["v"])
for c in cues("week"):
    place("sfx", c["t"], click(0.025 + 0.015 * (c["v"] == 0)), pan=-0.3 + 0.012 * (CUES.index(c) % 52))

# ---------------------------------------------------------------- oracle
for c in cues("pi"):
    place("sfx", c["t"], glide(200, 500, 0.3, 0.06))
for c in cues("log"):
    place("sfx", c["t"], tick(0.04, 3200), pan=-0.5)
for c in cues("server"):
    place("drums", c["t"], kick(0.2, 0.25, low=70), pan=0.3)
    place("sfx", c["t"], glide(120, 240, 0.2, 0.05), pan=0.3)
chip_notes = scale(MINOR_PENT, 5, 8)
for c in cues("chip"):
    place("bell", c["t"], blip(chip_notes[int(c["v"]) % 8], 0.08, 0.07, 0.4), pan=0.35)
for c in cues("mail"):
    place("sfx", c["t"], glide(700, 1600, 0.25, 0.05), pan=0.6)
    place("sfx", c["t"] + 0.35, glide(1600, 900, 0.25, 0.05), pan=0.6)
for c in cues("error"):
    for k in range(4):
        n = int(0.07 * SR)
        t = T(n)
        buzz = sum(np.sin(2 * np.pi * 180 * j * t) / j for j in (1, 3, 5))
        place("sfx", c["t"] + k * 0.2, np.tanh(2 * buzz) * np.exp(-t / 0.04) * 0.06, pan=-0.1)
for c in cues("fixed"):
    place("bell", c["t"], bell(hz("A5"), 1.0, 0.06))

# ---------------------------------------------------------------- the job hunt
for c in cues("me"):
    place("sfx", c["t"], blip(hz("D5"), 0.15, 0.06, 0.2), pan=-0.6)
for c in cues("reach"):
    place("sfx", c["t"], glide(300, 900, 0.9, 0.035, harm=0.2), pan=0)
for c in cues("wall"):
    place("drums", c["t"], kick(0.5, 0.5, low=50))
    n = int(0.25 * SR)
    t = T(n)
    buzz = sum(np.sin(2 * np.pi * 73 * j * t) / j for j in (1, 3, 5, 7))
    place("sfx", c["t"], np.tanh(2 * buzz) * np.exp(-t / 0.12) * 0.1)
    place("bell", c["t"] + 0.02, bell(hz("C#5"), 1.5, 0.05))
for c in cues("send"):
    j = int(c["v"])
    place("sfx", c["t"], blip(1200 + 900 * rng.random(), 0.05, 0.025 + 0.02 * (j / 150), 0.3), pan=0.2 + 0.7 * rng.random())
# the one that came back
for c in cues("reply"):
    x = blip(hz("E6"), 0.6, 0.12, 0.05)
    for k, d in enumerate((0.13, 0.26)):
        place("sfx", c["t"] + d, x, 0.4 ** (k + 1), pan=0.7 - 0.3 * k)
    place("sfx", c["t"], x, pan=0.8)
for c in cues("land"):
    place("bell", c["t"], bell(hz("A5"), 1.6, 0.09), pan=0.3)
    place("bell", c["t"] + 0.06, bell(hz("E6"), 1.6, 0.06), pan=0.35)

# ---------------------------------------------------------------- the ticket
for c in cues("card"):
    place("sfx", c["t"], crackle(0.33, 220, 0.3))
for c in cues("day"):
    place("sfx", c["t"], tick(0.15, 2000), pan=0.5)
for c in cues("strike"):
    place("sfx", c["t"], whoosh(0.22, 3000, 800, 0.12, peak=0.3), pan=-0.1)
fc = scale(MINOR_PENT, 5, 10)
for c in cues("microvm"):
    place("bell", c["t"], blip(fc[int(c["v"])], 0.06, 0.07, 0.5), pan=np.sin(int(c["v"]) * 0.63) * 0.7)
for c in cues("quote"):
    place("bell", c["t"], bell(hz("A4"), 2.0, 0.06))

# ---------------------------------------------------------------- yes.
for c in cues("yes"):
    place("drums", c["t"], kick(1.0, 0.9))
    place("bass", c["t"], sub_boom(1.0, 2.6))
    n = int(1.4 * SR)
    place("air", c["t"], butter(rng.standard_normal(n), "lowpass", 4500) * np.exp(-T(n) / 0.4), 0.4)
    place("air", c["t"], hat(0.5, open_=True))
    for k, nn in enumerate(["D4", "A4", "D5", "F5"]):
        place("bell", c["t"] + k * 0.02, bell(hz(nn), 2.2, 0.08), pan=-0.3 + 0.2 * k)

# ---------------------------------------------------------------- three years, fast
boot_notes = scale(MINOR_PENT, 4, 16)
for c in cues("boot"):
    k = int(c["v"])
    place("sfx", c["t"], blip(boot_notes[min(15, k)] * 2, 0.06, 0.08, 0.5), pan=((k % 4) - 1.5) / 4)
for i, c in enumerate(cues("split")):
    if i % 3 == 0:
        place("sfx", c["t"], click(rng.uniform(0.05, 0.09)), pan=rng.uniform(-0.2, 0.9))
rec = scale(MINOR_PENT, 5, 10)
for i, c in enumerate(cues("reconcile")):
    place("sfx", c["t"], tick(0.08, 3200), pan=0.15)
    place("bell", c["t"], blip(rec[i % 10], 0.06, 0.05, 0.2), pan=0.15)
pod_notes = scale(MINOR_PENT, 5, 9)
for c in cues("pod"):
    k = int(c["v"])
    place("bell", c["t"] + 0.25, pluck(pod_notes[k], 0.3, 0.07, harm=5, bright=2), pan=(k / 8 - 0.5) * 1.2)
for c in cues("evict"):
    place("sfx", c["t"], glide(1100, 380, 0.25, 0.08), pan=-0.5)
for c in cues("node"):
    place("drums", c["t"], kick(0.25, 0.2, low=110), pan=0.4)
for c in cues("fill"):
    place("sfx", c["t"], tick(0.06, [3400, 2600, 1900][int(c["v"])]), pan=0.35)

# ---------------------------------------------------------------- postgres and a loop
loop_notes = [hz("D6"), hz("A5"), hz("F5")]
for c in cues("loop"):
    place("bell", c["t"], blip(loop_notes[int(c["v"])], 0.09, 0.07, 0.3), pan=(0, 0.5, -0.5)[int(c["v"])])
for c in cues("crash"):
    n = int(0.3 * SR)
    t = T(n)
    buzz = sum(np.sin(2 * np.pi * 110 * k * t) / k for k in (1, 3, 5, 7, 9))
    place("sfx", c["t"], np.tanh(2 * buzz) * np.exp(-t / 0.15) * 0.12, pan=-0.5)
for c in cues("converge"):
    place("bell", c["t"], bell(hz("D6"), 1.4, 0.09), pan=-0.4)
    place("bell", c["t"] + 0.05, bell(hz("A6"), 1.4, 0.06), pan=-0.3)

# ---------------------------------------------------------------- handover
place("air", 42.8, whoosh(0.7, 8000, 500, 0.25, peak=0.85))
slam_notes = ["A4", "D5", "F5"]
for i, c in enumerate(cues("slam")):
    place("drums", c["t"], kick(0.5, 0.35))
    place("drums", c["t"], clap(0.28))
    place("bell", c["t"], bell(hz(slam_notes[i]), 1.1, 0.1), pan=(-0.5, 0, 0.5)[i])

# ---------------------------------------------------------------- side projects
tile_notes = ["C5", "D5", "F5", "G5", "A5", "C6"]
for c in cues("tile"):
    k = int(c["v"])
    place("bell", c["t"], bell(hz(tile_notes[k]), 1.2, 0.08), pan=-0.5 + (k % 3) * 0.5)
    place("sfx", c["t"], click(0.06), pan=-0.5 + (k % 3) * 0.5)

# ---------------------------------------------------------------- now
for c in cues("job"):
    place("sfx", c["t"], blip(1600 + 120 * c["v"], 0.04, 0.05, 0.4), pan=-0.4 + 0.1 * c["v"])
for c in cues("pass"):
    place("sfx", c["t"], tick(0.06, 2800), pan=-0.4 + 0.1 * c["v"])

# ---------------------------------------------------------------- the range (the reel's finale, thirty seconds on)
S0 = 30.0
for c in cues("hit"):
    place("drums", c["t"], kick(1.0, 0.8))
    place("bass", c["t"], sub_boom(0.9, 2.6))
    n = int(1.2 * SR)
    place("air", c["t"], butter(rng.standard_normal(n), "lowpass", 3500) * np.exp(-T(n) / 0.35), 0.35)
t0, xs, ys = ridge_track()
n = len(xs)
height = np.clip((440 - ys) / 210, 0, 1)
f = hz("A3") * 2 ** (height * 2.2)
ph = 2 * np.pi * np.cumsum(f) / SR
env = np.minimum(1, T(n) / 0.02) * np.minimum(1, (T(n)[::-1]) / 0.12)
tone = (np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)) * env * 0.11
pan = xs / 960 * 1.6 - 0.8
a = (pan + 1) * np.pi / 4
place("sfx", t0, np.stack([tone * np.cos(a), tone * np.sin(a)], 1))
place("air", 51.6, whoosh(0.5, 300, 6000, 0.25, peak=0.8))
place("sfx", 52.05, crackle(1.9, 900, 0.5, decay=0.7))
for c in cues("headline"):
    place("drums", c["t"], kick(0.3, 0.3, low=70))
    place("bell", c["t"], bell(hz("D5" if c["t"] < 52.6 else "A5"), 1.8, 0.10))
for c in cues("header"):
    for k in range(6):
        place("sfx", c["t"] + k * 0.06, tick(0.05, 2800 - 150 * k), pan=-0.6 + 0.24 * k)
place("pad", 52.0, pad([hz(n) for n in VOICING["Dm"]], 2.6, 0.2, attack=0.02, release=0.6, dark=lambda t: 0.15 + 0.5 * np.minimum(1, t / 1.5)))
place("bass", 52.0, subnote(hz("D2"), 3.4, 0.45, tau=2.2))
for tk in (53.0, 54.0):
    place("drums", tk, kick(0.7, 0.7))
for ts in (53.5, 54.5):
    place("drums", ts, snare(0.3))
place("pad", 54.0, pad([hz(n) for n in VOICING["Bbmaj7"]], 1.7, 0.17, attack=0.3, release=0.5))
place("bass", 54.0, subnote(hz("Bb1"), 1.4, 0.4, tau=1.5))
place("air", 54.6, whoosh(1.2, 200, 3000, 0.18, peak=0.7))
for c in cues("sunrise"):
    place("sfx", c["t"], glide(hz("D3"), hz("D4"), 1.2, 0.05, harm=0.3), pan=0.5)
place("pad", 54.95, pad([hz(n) for n in VOICING["D"]], 5.05, 0.5, attack=1.0, release=1.1,
                        dark=lambda t: 1.0 - 0.8 * np.minimum(1, t / 1.8),
                        shape=lambda t: 1 - 0.5 * np.clip((t - 2.2) / 2.6, 0, 1)))
place("pad", 55.35, pad([hz(n) for n in ["D5", "A5", "F#5", "E6"]], 4.65, 0.16, attack=0.5, release=1.0,
                        dark=lambda t: 0.6 - 0.3 * np.minimum(1, t / 1.5)))
place("drums", 55.35, kick(0.55, 0.9))
place("bass", 55.35, sub_boom(0.4, 2.0))
sun_env = lambda t: np.minimum(1, t / 0.9) * (1 - 0.45 * np.clip((t - 1.8) / 3.0, 0, 1))
n = int(4.75 * SR)
place("bass", 55.25, subnote(hz("D2"), 4.75, 0.5, tau=99) * sun_env(T(n)))
shimmer = scale(MAJOR_PENT, 5, 16)
for k in range(16):
    place("bell", 55.35 + k * 0.105, bell(shimmer[k], 1.6, 0.11 * (1 - k / 22)), pan=0.55 - k * 0.07)
for nn, g, p in [("D5", 0.14, 0.5), ("F#5", 0.09, 0.55), ("A5", 0.07, 0.6)]:
    place("bell", 55.35, bell(hz(nn), 3.0, g), pan=p)
for c in cues("type"):
    place("sfx", c["t"], tick(0.09, 2200 + 100 * (int(c["v"]) % 3)), pan=-0.55)
    place("sfx", c["t"], click(0.05), pan=-0.55)
place("bell", 57.05, bell(hz("A5"), 2.5, 0.06), pan=-0.4)
for c in cues("closing"):
    place("bell", c["t"], bell(hz("D6"), 2.2, 0.05), pan=-0.5)
for c in cues("blink"):
    place("sfx", c["t"], tick(0.22, 2400), pan=-0.4)

# the breath before "yes." is actually silent
GATE = np.ones(N)
g0, g1 = int(33.75 * SR), int(34.0 * SR)
GATE[g0 - int(0.03 * SR):g0] = np.linspace(1, 0, int(0.03 * SR))
GATE[g0:g1] = 0


# ================================================================ mix

def reverb_ir(seconds=2.6, predelay=0.022):
    n = int(seconds * SR)
    t = T(n)
    ir = rng.standard_normal((n, 2)) * np.exp(-t / (seconds / 6.9))[:, None]
    ir = butter(ir, "lowpass", 6500)
    early = np.zeros((n, 2))
    for d, g in [(0.011, 0.5), (0.019, 0.35), (0.027, 0.3), (0.041, 0.2)]:
        early[int(d * SR), 0] += g
        early[int((d + 0.004) * SR), 1] += g
    ir = ir + early * 3
    pad_ = np.zeros((int(predelay * SR), 2))
    return np.vstack([pad_, ir]) / np.sqrt(np.sum(ir ** 2) / 2)


dry = sum(BUSES.values())
send = sum(BUSES[k] * SEND[k] for k in BUSES)
ir = reverb_ir()
wet = np.stack([signal.fftconvolve(send[:, c], ir[:, c])[:N] for c in range(2)], 1) * 0.55

mix = dry + wet
mix = butter(mix, "highpass", 24)
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
peak = np.max(np.abs(mix))
mix = mix / peak * 10 ** (-1.0 / 20)
mix *= GATE[:, None]
fade_in = np.minimum(1, T(N) / 0.004)
fade_out = np.clip((DUR - T(N)) / 0.35, 0, 1)
mix *= (fade_in * fade_out)[:, None]

OUT.mkdir(exist_ok=True)
wavfile.write(OUT / "score.wav", SR, (mix * 32767).astype(np.int16))
print(f"wrote {OUT / 'score.wav'}  peak {20 * np.log10(np.max(np.abs(mix))):.1f} dBFS  rms {20 * np.log10(np.sqrt(np.mean(mix ** 2))):.1f} dBFS")
