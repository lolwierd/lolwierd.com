#!/usr/bin/env python3
"""The score for the reel, synthesised from the cue sheet.

    node reel/render.mjs --cues   # writes reel/out/cues.json
    python3 reel/score.py         # writes reel/out/score.wav

Every event the picture draws (a core booting, a VM splitting, a block being
reconciled, a pod landing) is in cues.json with the time it happens, so the
sound for it is placed on that sample rather than on a guess. Nothing here is
sampled: kicks, bells, plucks and pads are sums of sines and filtered noise.

The harmony follows the picture. D minor while the reel is underground and at
night, a dominant that has nowhere to go as the numbers pile up, a bar of
almost nothing in the sky, and then the same chord turned major when the sun
comes up over the ridge.
"""

import json
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
DUR = 30.0
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

    t0, dur = 22.0, 0.58
    n = int(dur * SR)
    u = np.arange(n) / n
    e = np.where(u < 0.5, 4 * u ** 3, 1 - (-2 * u + 2) ** 3 / 2)
    x = e * 960
    return t0, x, ridge(x)


# ================================================================ arrangement

BAR = 2.0
BEAT = 0.5

# --- 0-2: the dot and the matrix -------------------------------------------
for c in cues("tick"):
    place("sfx", c["t"], tick(0.5, 2400), pan=0)
    place("sfx", c["t"], blip(hz("D3"), 0.12, 0.25, 0), pan=0)
place("sfx", 0.75, glide(420, 980, 0.25, 0.10))

B8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
      12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
      3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
      15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21]
bayer_notes = scale(MINOR_PENT, 5, 16)
for c in cues("bayer"):
    v = int(c["v"])
    col = B8.index(v) % 8
    f = bayer_notes[min(15, v * 16 // 64)]
    place("bell", c["t"], blip(f, 0.07, 0.13, 0.35), pan=(col - 3.5) / 4.5)

place("air", 1.62, whoosh(0.4, 400, 9000, 0.35, peak=0.96))

# --- the two hits --------------------------------------------------------------
for c in cues("hit"):
    big = c["v"] == 2
    place("drums", c["t"], kick(1.0, 0.8))
    place("bass", c["t"], sub_boom(0.9 if big else 0.7, 2.6 if big else 1.8))
    n = int(1.2 * SR)
    burst = butter(rng.standard_normal(n), "lowpass", 3500) * np.exp(-T(n) / (0.35 if big else 0.18))
    place("air", c["t"], burst, 0.35 if big else 0.25)

# --- drums -----------------------------------------------------------------
def drums(t0, t1, style):
    t = t0
    while t < t1 - 1e-6:
        beat = round((t - t0) / BEAT)
        if style == "half":
            if beat % 2 == 0:
                place("drums", t, kick(0.7))
        else:
            place("drums", t, kick(0.85))
            if beat % 2 == 1:
                place("drums", t, clap(0.42))
            place("drums", t + BEAT / 2, hat(0.16), pan=0.2)
            if style == "sixteenths":
                place("drums", t + BEAT / 4, hat(0.07), pan=-0.25)
                place("drums", t + 3 * BEAT / 4, hat(0.09), pan=0.3)
        t += BEAT


drums(3.0, 6.0, "half")
drums(6.0, 10.0, "eighths")
drums(10.0, 18.0, "sixteenths")
drums(18.0, 19.5, "eighths")
# the roll into the sky
t, gap = 19.0, 0.125
while t < 19.95:
    place("drums", t, snare(0.10 + 0.25 * (t - 19.0)), pan=0.1)
    gap = max(0.03, gap * 0.87)
    t += gap
# the finale in half time
for tk in (23.0, 24.0):
    place("drums", tk, kick(0.7, 0.7))
for ts in (23.5, 24.5):
    place("drums", ts, snare(0.3))
place("drums", 25.0, kick(0.55, 0.7))

# --- bass ------------------------------------------------------------------
ROOT = {"Dm": "D2", "Bb": "Bb1", "F": "F2", "C": "C2", "A": "A1", "Gm": "G1"}
PLAN = [(2, "Dm"), (4, "Bb"), (6, "F"), (8, "C"), (10, "Dm"), (12, "Bb"), (14, "F"), (16, "C"), (17, "A"), (18, "Gm"), (19, "A")]
for i, (t0, ch) in enumerate(PLAN):
    t1 = PLAN[i + 1][0] if i + 1 < len(PLAN) else 20.0
    f = hz(ROOT[ch])
    if t0 < 6:
        place("bass", t0, subnote(f, t1 - t0 + 0.1, 0.42, tau=1.6))
        continue
    t = t0
    k = 0
    while t < t1 - 1e-6:
        oct_ = 2 if k % 4 == 2 else 1
        acc = 0.55 if k % 2 == 0 else 0.38
        step = 0.125 if t0 >= 19 else 0.25
        place("bass", t, pluck(f * oct_, step * 0.95, acc, harm=6, bright=0.6))
        t += step
        k += 1
# the finale: one long root under everything
place("bass", 22.0, subnote(hz("D2"), 3.4, 0.45, tau=2.2))
place("bass", 24.0, subnote(hz("Bb1"), 1.4, 0.4, tau=1.5))
# the root comes back up under the sunrise and holds to the end
sun_env = lambda t: np.minimum(1, t / 0.9) * (1 - 0.45 * np.clip((t - 1.8) / 3.0, 0, 1))
n = int(4.75 * SR)
place("bass", 25.25, subnote(hz("D2"), 4.75, 0.5, tau=99) * sun_env(T(n)))

# --- pads ------------------------------------------------------------------
VOICING = {
    "Dm": ["D3", "A3", "D4", "F4", "A4"],
    "Bb": ["Bb2", "F3", "Bb3", "D4", "F4"],
    "F": ["F2", "C3", "F3", "A3", "C4"],
    "C": ["C3", "G3", "C4", "E4", "G4"],
    "A": ["A2", "E3", "A3", "C#4", "E4"],
    "Gm": ["G2", "D3", "G3", "Bb3", "D4"],
    "Dm9": ["D4", "F4", "A4", "C5", "E5"],
    "Bbmaj7": ["Bb2", "F3", "A3", "D4", "F4"],
    "D": ["D3", "A3", "D4", "F#4", "A4", "E5"],
}
for i, (t0, ch) in enumerate(PLAN):
    t1 = PLAN[i + 1][0] if i + 1 < len(PLAN) else 20.0
    lvl = 0.16 if t0 < 6 else 0.13
    place("pad", t0, pad([hz(n) for n in VOICING[ch]], t1 - t0 + 0.6, lvl, attack=0.25, release=0.6))
place("pad", 20.0, pad([hz(n) for n in VOICING["Dm9"]], 2.4, 0.12, attack=0.8, release=0.5, dark=lambda t: 0.9 - 0.3 * t / 2.4))
place("pad", 22.0, pad([hz(n) for n in VOICING["Dm"]], 2.6, 0.2, attack=0.02, release=0.6, dark=lambda t: 0.15 + 0.5 * np.minimum(1, t / 1.5)))
place("pad", 24.0, pad([hz(n) for n in VOICING["Bbmaj7"]], 1.7, 0.17, attack=0.3, release=0.5))
# sunrise: the same chord, major, opening up as the light arrives
place("pad", 24.95, pad([hz(n) for n in VOICING["D"]], 5.05, 0.5, attack=1.0, release=1.1,
                        dark=lambda t: 1.0 - 0.8 * np.minimum(1, t / 1.8),
                        shape=lambda t: 1 - 0.5 * np.clip((t - 2.2) / 2.6, 0, 1)))
place("pad", 25.35, pad([hz(n) for n in ["D5", "A5", "F#5", "E6"]], 4.65, 0.16, attack=0.5, release=1.0,
                        dark=lambda t: 0.6 - 0.3 * np.minimum(1, t / 1.5)))
place("drums", 25.35, kick(0.55, 0.9))
place("bass", 25.35, sub_boom(0.4, 2.0))

# --- metal -----------------------------------------------------------------
boot_notes = scale(MINOR_PENT, 4, 16)
for c in cues("boot"):
    k = int(c["v"])
    place("sfx", c["t"], blip(boot_notes[min(15, k)] * 2, 0.07, 0.12, 0.5), pan=((k % 4) - 1.5) / 4)
for c in cues("fail"):
    n = int(0.08 * SR)
    t = T(n)
    buzz = sum(np.sin(2 * np.pi * 110 * k * t) / k for k in (1, 3, 5, 7, 9)) + sum(np.sin(2 * np.pi * 116.5 * k * t) / k for k in (1, 3, 5))
    place("sfx", c["t"], np.tanh(2 * buzz) * np.exp(-t / 0.05), 0.12, pan=-0.1)
for c in cues("scan"):
    place("sfx", c["t"], glide(300, 1400, 0.25, 0.08))
for c in cues("fixed"):
    place("bell", c["t"], bell(hz("A5"), 1.2, 0.12), pan=0.2)
    place("bell", c["t"] + 0.06, bell(hz("D6"), 1.2, 0.10), pan=0.3)

# --- whips -----------------------------------------------------------------
for c in cues("whip"):
    place("air", c["t"] - 0.05, whoosh(0.6, 250, 7000, 0.3, peak=0.5), pan=0)
    place("drums", c["t"] + 0.25, kick(0.35, 0.3, low=60))

# --- compute ---------------------------------------------------------------
for c in cues("split"):
    place("sfx", c["t"], click(rng.uniform(0.05, 0.1)), pan=rng.uniform(-0.2, 0.9))
place("sfx", 8.1, glide(180, 420, 0.16, 0.1))
cp_notes = ["A5", "C6", "D6", "E6"]
for c in cues("checkpoint"):
    place("bell", c["t"], bell(hz(cp_notes[int(c["v"]) - 1]), 0.9, 0.09), pan=-0.2 + 0.25 * c["v"])
for c in cues("land"):
    place("drums", c["t"], kick(0.35, 0.25, low=80), pan=0.4)
for c in cues("thaw"):
    place("bell", c["t"], bell(hz("D6"), 1.4, 0.1), pan=0.4)
    place("bell", c["t"] + 0.05, bell(hz("A6"), 1.4, 0.07), pan=0.5)

# --- storage ---------------------------------------------------------------
rec_notes = scale(MINOR_PENT, 5, 10)
for i, c in enumerate(cues("reconcile")):
    place("sfx", c["t"], tick(0.10, 3200), pan=0.15)
    place("bell", c["t"], blip(rec_notes[i % 10], 0.06, 0.06, 0.2), pan=0.15)

# --- network ---------------------------------------------------------------
for c in cues("ping"):
    x = blip(hz("E6"), 0.5, 0.12, 0.05)
    for k, d in enumerate((0.13, 0.26, 0.39)):
        place("sfx", c["t"] + d, x, 0.45 ** (k + 1), pan=-0.5 + 0.25 * k)
    place("sfx", c["t"], x, pan=-0.45)
for c in cues("reply"):
    place("sfx", c["t"], glide(900, 1500, 0.12, 0.08), pan=-0.4)
    place("sfx", c["t"] + 0.14, glide(1500, 1200, 0.1, 0.06), pan=-0.45)
for i, c in enumerate(cues("hop")):
    place("sfx", c["t"], blip(hz(["E5", "G5", "A5", "C6"][i]), 0.08, 0.1, 0.4), pan=0.45)
for c in cues("answer"):
    place("bell", c["t"], bell(hz("D6"), 1.0, 0.09), pan=0.5)
    place("bell", c["t"], bell(hz("A6"), 1.0, 0.06), pan=0.55)

# --- kubernetes ------------------------------------------------------------
pod_notes = scale(MINOR_PENT, 5, 9)
for c in cues("pod"):
    k = int(c["v"])
    place("bell", c["t"] + 0.3, pluck(pod_notes[k] , 0.3, 0.09, harm=5, bright=2), pan=(k / 8 - 0.5) * 1.2)
    place("sfx", c["t"], click(0.06), pan=0)
for c in cues("evict"):
    place("sfx", c["t"], glide(1100, 380, 0.3, 0.09), pan=-0.5)
for c in cues("node"):
    place("drums", c["t"], kick(0.3, 0.2, low=110), pan=0.4)
    place("bell", c["t"] + 0.05, bell(hz("F6"), 0.8, 0.06), pan=0.45)

# --- tooling ---------------------------------------------------------------
for c in cues("fill"):
    r = int(c["v"])
    place("sfx", c["t"], tick(0.07, [3400, 2600, 1900][r]), pan=0.35)

# --- people ----------------------------------------------------------------
place("air", 17.9, whoosh(0.7, 8000, 500, 0.3, peak=0.85), pan=0)
slam_notes = ["A4", "D5", "F5"]
for i, c in enumerate(cues("slam")):
    place("drums", c["t"], kick(0.6, 0.35))
    place("drums", c["t"], clap(0.3))
    place("bell", c["t"], bell(hz(slam_notes[i]), 1.1, 0.12), pan=(-0.5, 0, 0.5)[i])
    for k in range(4):
        place("sfx", c["t"] + 0.02 + k * 0.03, tick(0.04, 3000 + 400 * k), pan=(-0.5, 0, 0.5)[i])
# riser into the burst
n = int(1.55 * SR)
rt = T(n) / 1.55
riser = svf_sweep(rng.standard_normal(n), 300, 9000, q=0.5, curve=rt ** 1.5) * rt ** 2
place("air", 18.0, riser, 0.4)
place("sfx", 18.0, glide(110, 880, 1.5, 0.05, harm=0.4))

# --- the sky ---------------------------------------------------------------
for c in cues("burst"):
    place("air", c["t"], whoosh(1.2, 900, 12000, 0.45, peak=0.12, q=0.4))
    place("bell", c["t"] + 0.02, bell(hz("D6"), 2.4, 0.08))
star_notes = scale(MINOR_PENT, 6, 8)
for k in range(15):
    ts = 20.25 + k * 0.12 + rng.uniform(0, 0.08)
    place("bell", ts, bell(star_notes[rng.integers(0, 8)], 2.0, rng.uniform(0.02, 0.05)), pan=rng.uniform(-0.8, 0.8))
for c in cues("comet"):
    n = int(0.6 * SR)
    x = whoosh(0.6, 7000, 1800, 0.22, peak=0.2)
    pan = np.linspace(0.7, -0.5, n)
    a = (pan + 1) * np.pi / 4
    place("air", c["t"], np.stack([x * np.cos(a), x * np.sin(a)], 1))

# --- the range -------------------------------------------------------------
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
place("air", 21.6, whoosh(1.0, 300, 5000, 0.25, peak=0.42))
# the terrain printing: ink on paper, thinning out as the plate fills
place("sfx", 22.05, crackle(1.9, 900, 0.5, decay=0.7), pan=0)
for c in cues("word"):
    place("drums", c["t"], kick(0.3, 0.3, low=70))
    place("bell", c["t"], bell(hz("D5" if c["t"] < 22.6 else "A5"), 1.8, 0.10))
for c in cues("header"):
    for k in range(6):
        place("sfx", c["t"] + k * 0.06, tick(0.05, 2800 - 150 * k), pan=-0.6 + 0.24 * k)
place("air", 24.6, whoosh(1.2, 200, 3000, 0.18, peak=0.7))
for c in cues("sunrise"):
    place("sfx", c["t"], glide(hz("D3"), hz("D4"), 1.2, 0.05, harm=0.3), pan=0.5)
# daybreak: the light arriving, a major pentatonic run spreading out from the sun
shimmer = scale(MAJOR_PENT, 5, 16)
for k in range(16):
    ts = 25.35 + k * 0.105
    place("bell", ts, bell(shimmer[k], 1.6, 0.11 * (1 - k / 22)), pan=0.55 - k * 0.07)
place("bell", 25.35, bell(hz("D5"), 3.0, 0.14), pan=0.5)
place("bell", 25.35, bell(hz("F#5"), 3.0, 0.09), pan=0.55)
place("bell", 25.35, bell(hz("A5"), 3.0, 0.07), pan=0.6)
for c in cues("type"):
    place("sfx", c["t"], tick(0.09, 2200 + 100 * (int(c["v"]) % 3)), pan=-0.55)
    place("sfx", c["t"], click(0.05), pan=-0.55)
for c in cues("blink"):
    place("sfx", c["t"], tick(0.22, 2400), pan=-0.4)
place("bell", 27.05, bell(hz("A5"), 2.5, 0.06), pan=-0.4)

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
fade_in = np.minimum(1, T(N) / 0.004)
fade_out = np.clip((DUR - T(N)) / 0.35, 0, 1)
mix *= (fade_in * fade_out)[:, None]

OUT.mkdir(exist_ok=True)
wavfile.write(OUT / "score.wav", SR, (mix * 32767).astype(np.int16))
print(f"wrote {OUT / 'score.wav'}  peak {20 * np.log10(np.max(np.abs(mix))):.1f} dBFS  rms {20 * np.log10(np.sqrt(np.mean(mix ** 2))):.1f} dBFS")
