#!/usr/bin/env python3
"""The score for the long way up, two minutes in one shot, synthesised from
the film's cue sheet.

    node ascent/render.mjs --cues   # writes ascent/out/cues.json
    python3 ascent/score.py         # writes ascent/out/score.wav
    python3 ascent/score.py CUES.json OUT.wav   # any other cut

The voices are the journey's (and the reel's before it): sums of sines and
filtered noise, nothing sampled. The arrangement follows the dot. His
footsteps are a felt pulse under everything, thinned so it never becomes a
clickfest. College is a music box in F. The gate year is a clock that limps
when the cramming cracks, and the music goes under the ground with the camera.
The job hunt walks down D, C, Bb, A into the fog until there is only a cursor
blinking at the bottom of the valley, one ping from far away, and half a
second of real silence before "yes.". The climb is the reel's drive, with the
stack built under his feet as rising arpeggios; it tape-stops when the
provision crashes and comes back reconciled. At the top the camera pulls back,
the line he walked is sung once from end to end, a press rolls across the
plate, and D minor turns major at sunrise.

Every section edge is read from the cue sheet (see S below), and chords are
laid to fit whatever length a section turns out to be, so a re-cut of the
picture moves the music with it.
"""

import json
import re
import sys
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
DUR = 120.0
N = int(SR * DUR)
HERE = Path(__file__).parent
OUT = HERE / "out"
CUES_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT / "cues.json"
WAV_PATH = Path(sys.argv[2]) if len(sys.argv) > 2 else OUT / "score.wav"
rng = np.random.default_rng(2026)

CUES = sorted(json.load(open(CUES_PATH)), key=lambda c: c["t"])


def cues(kind, v=None):
    return [c for c in CUES if c["type"] == kind and (v is None or c["v"] == v)]


def opt(kind, v=None, i=0):
    """The time of the i-th cue of a kind (optionally with value v), or None."""
    cs = cues(kind, v)
    return cs[i]["t"] if -len(cs) <= i < len(cs) else None


def first(*vals):
    for v in vals:
        if v is not None:
            return v


def plus(t, d):
    return None if t is None else t + d


# ---------------------------------------------------------------- the line he walks

def path_height():
    """His altitude along the line, 0 at the bottom of the valley and 1 at the
    summit. The line is the skyline of the range, mirrored, as film.js draws it."""
    sky = json.load(open(HERE.parent / "public/assets/annapurna-skyline.json"))
    ys = np.array(sky["y"], float)
    s, px, py = 0.34, -30, 92
    x = np.arange(960)
    ridge = np.interp(((x + 0.5 - px) / s) / sky["step"], np.arange(len(ys)), ys) * s + py
    path = ridge[::-1]
    return (path.max() - path) / (path.max() - path.min())


HEIGHT = path_height()


def height_at(x):
    return float(np.interp(x, np.arange(len(HEIGHT)), HEIGHT))


def waypoint_xs(n):
    """Where the four markers stand on the line (film.js WAYPOINTS)."""
    try:
        js = (HERE / "film.js").read_text()
        body = re.search(r"WAYPOINTS\s*=\s*\[(.*?)\];", js, re.S).group(1)
        xs = [float(v) for v in re.findall(r"\[\s*(-?[\d.]+)\s*,", body)]
        if len(xs) == n:
            return xs
    except (OSError, AttributeError, ValueError):
        pass
    return list(np.linspace(0, len(HEIGHT) - 1, n))


STEPS = [(c["t"], c["v"]) for c in cues("step")]


def passes(x):
    """When he first walks past x on the line."""
    for t, v in STEPS:
        if v >= x:
            return t


def walking_again(after):
    """The first step after `after` where he is properly climbing, not easing off."""
    ts = [t for t, _ in STEPS if t >= after]
    for i in range(len(ts) - 3):
        if ts[i + 3] - ts[i] < 0.6:
            return ts[i]


def earliest(*vals):
    vals = [v for v in vals if v is not None]
    return min(vals) if vals else None


# ================================================================ the film, in one table
#
# Every structural time the arrangement uses. Anything the film emits as a cue
# is read from the cue sheet; each entry falls back to its neighbours if a
# re-cut drops that cue, so nothing here is a bare number of seconds.

S = {}
S["start"] = first(opt("start"), opt("step"), 0.0)                        # he starts walking
S["title"] = first(opt("word", 3), S["start"] + 1.0)                     # "the long way up"
S["college"] = first(earliest(plus(opt("word", 0), -0.2), plus(opt("join"), -0.6)), S["title"] + 6.0)
S["goal"] = first(opt("word", 1), plus(opt("word", 2), -0.7), plus(opt("leave", i=-1), 0.1), S["college"] + 11.0)
S["gate"] = first(opt("day"), plus(opt("crack"), -5.0), S["goal"] + 8.0)
S["crack"] = first(opt("crack"), S["gate"] + 5.0)
S["under"] = first(opt("under"), S["crack"] + 1.2)
S["surface"] = first(opt("surface"), S["under"] + 3.6)                  # the camera starts back up
S["tinker"] = S["surface"] + 1.4                                          # and is back on the surface
S["alone"] = first(opt("alone"), plus(opt("reply"), -3.9), S["tinker"] + 18.0)
S["fog"] = first(opt("fog"), S["alone"] - 11.0)
_valley = int(np.argmin(HEIGHT))                                         # the last rise before the valley
_crest = max(0, _valley - 90) + int(np.argmax(HEIGHT[max(0, _valley - 90):_valley]))
S["fall"] = float(np.clip(first(passes(_crest), S["fog"] - 1.5), S["tinker"] + 2.0, S["fog"]))
S["send"] = first(opt("send"), S["alone"] - 4.0)
S["yes"] = first(opt("yes"), S["alone"] + 7.4)
S["silence"] = first(opt("silence"), S["yes"] - 0.28)
S["reply"] = first(opt("reply"), S["alone"] + 3.0)
S["land"] = first(opt("land"), S["reply"] + 0.65)
S["quote"] = first(opt("word", 5), S["silence"] - 1.5)
S["climb"] = first(walking_again(S["yes"]), S["yes"])
S["crash"] = first(opt("crash"), S["climb"] + 8.0)
S["reconcile"] = first(opt("reconcile"), S["crash"] + 3.2)
S["fixed"] = first(opt("fixed"), S["reconcile"] + 1.1)
S["gather"] = first(opt("gather"), S["fixed"] + 0.4)
S["numeral"] = first(opt("numeral"), S["gather"] + 1.2)
S["burst"] = first(opt("burst"), S["numeral"] + 1.8)
S["summit"] = first(opt("summit"), plus(opt("step", i=-1), 0.0), S["burst"] + 11.0)
S["spur"] = first(opt("spur"), S["burst"] + 0.4 * (S["summit"] - S["burst"]))
S["runners"] = first(opt("runners"), S["spur"] + 0.4 * (S["summit"] - S["spur"]))
S["pull"] = first(opt("pull"), S["summit"] + 0.4)
S["print"] = first(opt("print"), S["pull"] + 3.5)
S["press"] = first(opt("press"), plus(opt("flip"), 0.7), S["print"] + 4.2)
S["hold"] = first(opt("hold"), S["press"] - 2.7)                        # the line is inked: the dominant, held
S["flip"] = first(opt("flip"), S["press"] - 0.7)                        # the plate turns over onto the bed
S["pressed"] = first(opt("pressed"), S["press"] + 1.6)
S["sunrise"] = first(opt("sunrise"), S["pressed"] + 0.4)
# D major lands as the roller hits its stop. If the roller uncovers the sun on
# its way across, the chord starts to turn under it there; if the sun comes up
# after the print, it waits for the sun.
S["resolve"] = S["sunrise"] if S["sunrise"] > S["pressed"] + 0.05 else S["pressed"]
S["turn"] = min(S["sunrise"], S["resolve"])
S["closing"] = first(opt("closing"), S["resolve"] + 1.0)

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


def nearest(f, names):
    grid = np.array(scale(names, 2, 30))
    return float(grid[np.argmin(np.abs(np.log(grid / f)))])


MINOR_PENT = ["D", "F", "G", "A", "C"]
MAJOR_PENT = ["D", "E", "F#", "A", "B"]
F_PENT = ["F", "G", "A", "C", "D"]

# ---------------------------------------------------------------- buses

BUSES = {k: np.zeros((N, 2)) for k in ["drums", "bass", "pad", "sfx", "bell", "air", "foley", "far"]}
SEND = {"drums": 0.10, "bass": 0.0, "pad": 0.30, "sfx": 0.22, "bell": 0.50, "air": 0.35, "foley": 0.08, "far": 1.0}
DRY = {"far": 0.3}                        # far away: mostly room
MUSIC = ["drums", "bass", "pad", "bell"]  # what goes under the ground and into the fog


def place(bus, t0, x, gain=1.0, pan=0.0):
    """Mix mono or stereo x into a bus at t0 seconds, equal-power panned."""
    if x.ndim == 1:
        a = (np.clip(pan, -1, 1) + 1) * np.pi / 4
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


def sstep(a, b, v):
    x = np.clip((np.asarray(v, float) - a) / (b - a), 0, 1)
    return x * x * (3 - 2 * x)


def in_out_cubic(u):
    u = np.clip(u, 0, 1)
    return np.where(u < 0.5, 4 * u ** 3, 1 - (-2 * u + 2) ** 3 / 2)


def fades(dur, a=0.01, r=0.01):
    t = T(int(dur * SR))
    return np.minimum(1, t / a) * np.clip((dur - t) / r, 0, 1)


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
        if f * ratio < SR / 2.2:
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
    dmin = float(np.min(d))
    out = np.zeros((n, 2))
    for f in freqs:
        for ch, cents in ((0, (-9, 3)), (1, (-3, 8))):
            for c in cents:
                ff = f * 2 ** (c / 1200)
                ph0 = rng.uniform(0, 2 * np.pi)
                for k in range(1, 40):
                    # stop once a harmonic is inaudible even at its brightest
                    if ff * k > 7000 or (k ** -1.15) * np.exp(-(k - 1) * dmin) < 2e-3:
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


# new for this film ----------------------------------------------


def felt(amp=1.0, f=82, dur=0.1):
    """A footstep: a soft, low thump with a little grit on the front."""
    n = int(dur * SR)
    t = T(n)
    body = np.sin(2 * np.pi * np.cumsum(f * (1 + 0.8 * np.exp(-t / 0.008))) / SR) * np.exp(-t / 0.028)
    grit = butter(rng.standard_normal(n) * np.exp(-t / 0.004), "bandpass", [500, 2200]) * 0.35
    return amp * (body + grit) * np.minimum(1, t / 0.0015)


def buzz(f0, dur, amp=1.0, tau=0.15, odd=(1, 3, 5, 7)):
    """Rust: a clipped, square-ish tone."""
    n = int(dur * SR)
    t = T(n)
    x = sum(np.sin(2 * np.pi * f0 * k * t) / k for k in odd) * np.exp(-t / tau)
    return amp * np.tanh(2.5 * x)


def clang(f, dur=0.8, amp=1.0):
    """Struck steel: inharmonic partials that die fast, and a tap of noise."""
    n = int(dur * SR)
    t = T(n)
    x = np.zeros(n)
    for ratio, a, d in [(1, 1, 0.35), (2.32, 0.6, 0.2), (3.87, 0.45, 0.12), (5.43, 0.3, 0.08), (7.1, 0.2, 0.05)]:
        x += a * np.sin(2 * np.pi * f * ratio * t + rng.uniform(0, 6)) * np.exp(-t / (dur * d))
    tap = butter(rng.standard_normal(n) * np.exp(-t / 0.004), "bandpass", [1500, 6000]) * 0.6
    return amp * (x + tap) * np.minimum(1, t / 0.0008)


def noise_bed(dur, lo, hi, amp=1.0, lfo=0.25, depth=0.5):
    """Band-limited noise that breathes slowly: wind, fog, a room, a fan."""
    n = int(dur * SR)
    t = T(n)
    x = butter(rng.standard_normal(n), "bandpass", [lo, hi])
    wob = 1 - depth * (0.5 + 0.5 * np.sin(2 * np.pi * lfo * t + rng.uniform(0, 6)) * np.sin(2 * np.pi * lfo * 0.37 * t + 1))
    return amp * x * wob


def tape_stop(names, t0, dur, mute_until):
    """The music falters: the named buses slow to a halt over dur seconds, as if
    the tape lost its motor, and stay silent until mute_until."""
    i0, n = int(t0 * SR), int(dur * SR)
    if i0 + n + 2 > N:
        return
    u = np.arange(n) / n
    pos = np.cumsum((1 - u) ** 1.7)
    env = np.minimum(1, (1 - u) / 0.15)
    for b in names:
        src = BUSES[b][i0: i0 + n + 2].copy()
        for ch in range(2):
            BUSES[b][i0: i0 + n, ch] = np.interp(pos, np.arange(len(src)), src[:, ch]) * env
        BUSES[b][i0 + n: int(mute_until * SR)] = 0


def tv_lowpass(x, fc, block=128):
    """Two one-pole low-passes whose cutoff follows fc (block-wise, state
    carried), blended back to dry wherever fc is up out of the way."""
    y = x.copy()
    z1 = np.zeros((1, x.shape[1]))
    z2 = np.zeros((1, x.shape[1]))
    for i in range(0, len(x), block):
        j = min(len(x), i + block)
        if fc[i] >= 16000:
            z1[0] = z2[0] = x[j - 1]
            continue
        a = np.exp(-2 * np.pi * fc[i] / SR)
        s, z1 = signal.lfilter([1 - a], [1, -a], x[i:j], axis=0, zi=z1 * a)
        y[i:j], z2 = signal.lfilter([1 - a], [1, -a], s, axis=0, zi=z2 * a)
        z1, z2 = z1 / a, z2 / a
    w = np.clip((16000 - fc) / 6000, 0, 1)[:, None]
    return x * (1 - w) + y * w


# ================================================================ harmony

BAR, BEAT = 2.0, 0.5

VOICING = {
    "Dm9": ["D3", "A3", "C4", "E4", "F4"],
    "Dm": ["D3", "A3", "D4", "F4", "A4"],
    "F": ["F2", "C3", "F3", "A3", "C4"],
    "C": ["C3", "G3", "C4", "E4", "G4"],
    "Bb": ["Bb2", "F3", "Bb3", "D4", "F4"],
    "Bbmaj7": ["Bb2", "F3", "A3", "D4", "F4"],
    "Gm": ["G2", "D3", "G3", "Bb3", "D4"],
    "Gm9": ["G2", "D3", "F3", "A3", "Bb3"],
    "A": ["A2", "E3", "A3", "C#4", "E4"],
    "Asus4": ["A2", "E3", "A3", "D4", "E4"],
    "D5": ["D2", "A2", "D3"],
    "D": ["D3", "A3", "D4", "F#4", "A4", "E5"],
}
ROOT = {"Dm9": "D2", "Dm": "D2", "F": "F2", "C": "C2", "Bb": "Bb1", "Bbmaj7": "Bb1", "Gm": "G1",
        "Gm9": "G1", "A": "A1", "Asus4": "A1", "D5": "D2", "D": "D2"}


def notes(ch):
    return [hz(n) for n in VOICING[ch]]


def snap(t, anchor):
    """The first beat at or after t on the grid that starts at anchor."""
    return anchor + np.ceil((t - anchor) / BEAT - 1e-6) * BEAT


def fit(t0, t1, body, tail=(), bar=BAR, cycle=True, exact=False):
    """Lay chords over [t0, t1) in bars of about `bar` seconds on the beat grid
    from t0. The body repeats (or, with cycle=False, its first chord stretches
    or it is cut short), and the tail always ends the span. exact=True keeps
    bars at exactly `bar` seconds and lets the last one run short."""
    if t1 - t0 < BEAT / 2:
        return []
    if exact:
        k = int(np.ceil((t1 - t0) / bar - 1e-6))
        return [(t0 + i * bar, body[i % len(body)]) for i in range(k)]
    nb = max(1, int(round((t1 - t0) / bar)))
    tail = list(tail)[-nb:] if tail else []
    nbody = nb - len(tail)
    if cycle:
        seq = [body[i % len(body)] for i in range(nbody)]
    elif nbody >= len(body):
        seq = [body[0]] * (nbody - len(body) + 1) + list(body[1:])
    else:
        seq = list(body[:nbody])
    seq += tail
    L = (t1 - t0) / nb
    return [(t0 + round(i * L / BEAT) * BEAT, ch) for i, ch in enumerate(seq)]


# D minor; F for college; the lament bass down into the valley; the drive up
# the other side; the widest chords at the top; D major at sunrise
DRIVE = ["Dm", "Bb", "F", "C"]
drive_anchor = S["yes"] if S["climb"] - S["yes"] < 1.0 else snap(S["climb"], S["yes"])
PLAN = (
    fit(S["start"], S["college"], ["Dm9"], tail=["Bbmaj7", "C"])
    + fit(S["college"], S["goal"], ["F", "C", "Dm", "Bb", "F", "C", "Bb", "C"], tail=["Dm"])
    + fit(S["goal"], max(S["goal"] + 1, S["gate"] - 2), ["Bbmaj7", "C"], cycle=False)
    + [(max(S["goal"] + 1, S["gate"] - 2), "Asus4"), (max(S["goal"] + 1.5, S["gate"] - 1), "A")]
    + fit(S["gate"], S["crack"], ["Dm", "Bb", "Gm"], tail=["A"])
    + [(S["crack"] + min(1.7, 0.5 * (S["under"] - S["crack"])), "Gm")]
    + fit(S["under"], S["tinker"], ["Dm", "Bbmaj7", "C"], bar=1.5, cycle=False)
    + fit(S["tinker"], S["fall"], DRIVE)
    + fit(S["fall"], S["alone"], ["Dm", "C", "Bb", "A", "Gm", "A"], cycle=False)
    + [(S["alone"], "D5"), (S["land"], "Bbmaj7"), (S["quote"], "A"), (S["yes"], "Dm")]
    + fit(drive_anchor, S["crash"] + 1.0, DRIVE, exact=True)
    + [(S["crash"] + 0.6 * (S["reconcile"] - S["crash"]), "Gm"), (S["reconcile"], "Asus4")]
    + fit(S["fixed"], S["gather"], ["Dm", "Bb", "Gm"], cycle=False)
    + [(S["gather"], "C"), (S["numeral"], "F")]
    + fit(S["burst"], S["summit"] - 0.8, ["C", "Dm", "Bb", "F"], tail=["Gm"])
    + [(S["summit"] - 0.8, "A"), (S["summit"], "Dm"), (S["pull"], "Bbmaj7"), (min(S["print"], S["hold"] - 0.5), "Gm9"),
       (S["hold"], "Asus4"), (S["press"], "A"), (S["turn"], "D")]
)
PLAN.sort(key=lambda p: p[0])


def chord_at(t):
    ch = PLAN[0][1]
    for t0, c in PLAN:
        if t0 <= t + 1e-6:
            ch = c
    return ch


def spans(t0, t1):
    """The chords between t0 and t1, clipped: [(a, b, chord)]."""
    out = []
    for i, (a, ch) in enumerate(PLAN):
        b = PLAN[i + 1][0] if i + 1 < len(PLAN) else DUR
        a2, b2 = max(a, t0), min(b, t1)
        if b2 > a2 + 1e-6:
            out.append((a2, b2, ch))
    return out


# ================================================================ arrangement helpers


def bed(t0, t1, amp, attack=0.3, release=0.5, overlap=0.5, dark=None, shape=None):
    for a, b, ch in spans(t0, t1):
        place("pad", a, pad(notes(ch), b - a + overlap, amp, attack=attack, release=release, dark=dark, shape=shape))


def held_bass(t0, t1, amp, tau=1.6):
    for a, b, ch in spans(t0, t1):
        place("bass", a, subnote(hz(ROOT[ch]), b - a + 0.05, amp, tau=tau))


def pulse_bass(t0, t1, amp, step=0.25, anchor=0.0, octave_every=4):
    for a, b, ch in spans(t0, t1):
        f = hz(ROOT[ch])
        k = int(np.ceil((a - anchor) / step - 1e-6))
        t = anchor + k * step
        while t < b - 1e-6:
            oct_ = 2 if octave_every and k % octave_every == 2 else 1
            place("bass", t, pluck(f * oct_, step * 0.95, amp if k % 2 == 0 else amp * 0.68, harm=6, bright=0.6))
            t += step
            k += 1


def arp(t0, t1, amp, step=0.125, anchor=0.0, octave=2, pattern=(0, 2, 1, 3, 2, 4, 3, 1), bright=1.6, pan=0.25):
    for a, b, ch in spans(t0, t1):
        tones = [f * octave for f in notes(ch)[1:]]
        k = int(np.ceil((a - anchor) / step - 1e-6))
        t = anchor + k * step
        while t < b - 1e-6:
            f = tones[pattern[k % len(pattern)] % len(tones)]
            place("bell", t, pluck(f, 0.22, amp * (1 if k % 2 == 0 else 0.7), harm=5, bright=bright), pan=pan * np.sin(k * 0.9))
            t += step
            k += 1


def drums(t0, t1, style, level=1.0, anchor=None):
    anchor = t0 if anchor is None else anchor
    t = snap(t0, anchor)
    while t < t1 - 1e-6:
        beat = round((t - anchor) / BEAT)
        if style == "soft":
            place("drums", t + BEAT / 2, hat(0.06 * level), pan=0.25)
            if beat % 2 == 0:
                place("drums", t, kick(0.35 * level, 0.4))
        elif style == "heart":
            if beat % 2 == 0:
                place("drums", t, kick(0.4 * level, 0.35, low=48))
        elif style == "grind":
            if beat % 2 == 0:
                place("drums", t, kick(0.5 * level, 0.35, low=50))
            for q in range(4):
                place("drums", t + q * BEAT / 4, hat((0.035 if q % 2 else 0.05) * level), pan=-0.15 + 0.1 * q)
        elif style == "four":
            place("drums", t, kick(0.8 * level))
            place("drums", t + BEAT / 2, hat(0.14 * level), pan=0.2)
            if beat % 2 == 1:
                place("drums", t, clap(0.35 * level))
        elif style == "bounce":
            place("drums", t, kick((0.8 if beat % 2 == 0 else 0.55) * level))
            if beat % 4 == 3:
                place("drums", t + 0.75 * BEAT, kick(0.4 * level, 0.3))
            place("drums", t + BEAT / 2, hat(0.2 * level, open_=beat % 2 == 1), pan=0.25)
            if beat % 2 == 1:
                place("drums", t, clap(0.36 * level))
        elif style == "drive":
            place("drums", t, kick(0.9 * level))
            if beat % 2 == 1:
                place("drums", t, clap(0.42 * level))
            place("drums", t + BEAT / 2, hat(0.16 * level), pan=0.2)
            place("drums", t + BEAT / 4, hat(0.07 * level), pan=-0.25)
            place("drums", t + 3 * BEAT / 4, hat(0.09 * level), pan=0.3)
        t += BEAT


def roll(t0, t1, a0, a1, gap=0.125):
    t = t0
    while t < t1:
        place("drums", t, snare(a0 + (a1 - a0) * (t - t0) / (t1 - t0)), pan=0.1)
        gap = max(0.03, gap * 0.86)
        t += gap


def riser(t0, dur, amp, f1=9000, glide_amp=0.045):
    if dur <= 0.05:
        return
    n = int(dur * SR)
    rt = T(n) / dur
    place("air", t0, svf_sweep(rng.standard_normal(n), 300, f1, q=0.5, curve=rt ** 1.5) * rt ** 2, amp)
    if glide_amp:
        place("sfx", t0, glide(110, 880, dur, glide_amp, harm=0.4))


def flat(v):
    return lambda t: np.full(len(t), v)


# ================================================================ 0 - college: a cursor, then a walk

st, ttl, col = S["start"], S["title"], S["college"]
for c in cues("blink"):
    if c["t"] < st:
        place("sfx", c["t"], tick(0.3, 2400))
        place("sfx", c["t"], blip(hz("D4"), 0.1, 0.1, 0))
place("air", 0.0, noise_bed(st + 1.0, 200, 3000, 0.012, lfo=0.3) * fades(st + 1.0, 1.2, 0.8))
place("air", st - 0.5, whoosh(1.5, 400, 6000, 0.12, peak=0.95))
bed(st, col, 0.045, attack=1.2, dark=lambda t: 0.6 - 0.25 * np.minimum(1, t / 4))
held_bass(st, col, 0.18, tau=2.5)
place("bell", st, pluck(hz("D3"), 0.8, 0.12, harm=5, bright=1.2))
for c in cues("word", 3):   # the title
    place("bass", c["t"], sub_boom(0.32, 2.2))
    place("air", c["t"], hat(0.1, open_=True))
    for k, nn in enumerate(["D4", "F4", "A4", "C5", "E5"]):
        place("bell", c["t"] + k * 0.035, bell(hz(nn), 2.8, 0.065), pan=-0.4 + 0.2 * k)
for c in cues("word", 4):   # his name under it
    place("sfx", c["t"], crackle(0.35, 120, 0.22))
# a few notes for the walk as the title fades, if there is room before college
for d, nn in [(3.0, "A4"), (4.0, "F4"), (5.0, "C5"), (6.0, "G4"), (6.5, "A4")]:
    if ttl + d < col - 0.3:
        place("bell", ttl + d, bell(hz(nn), 1.6, 0.035), pan=0.2)

# ================================================================ college, in F

goal, gate = S["goal"], S["gate"]
leave0 = first(opt("leave"), goal - 2.0)
bed(col, goal, 0.09, attack=0.3, dark=flat(0.4))
held_bass(col, goal, 0.33, tau=1.8)
# the music box: the chord, broken into eighths
k = 0
for a, b, ch in spans(col, leave0 + 1.0):
    tones = [f * 2 for f in notes(ch)[1:]]
    t = snap(a, col) if k else col
    k = int(round((t - col) / 0.25))
    while t < b - 1e-6:
        place("bell", t, bell(tones[[0, 2, 1, 3, 2, 3, 1, 2][k % 8] % len(tones)], 0.9, 0.038 + 0.011 * (k % 2 == 0)), pan=0.3 * np.sin(k))
        t += 0.25
        k += 1
drums(first(plus(opt("join", i=-1), 0.2), col + 2.0), leave0, "soft", 1.0, anchor=col)
# friends fall in beside him, one note each; later they peel off, the same
# notes back down and out to the sides
FRIEND_OFF = [-7, -4, 3.5, 6, -10]
FRIEND_NOTE = ["F4", "A4", "C5", "E5", "G5"]
for c in cues("join"):
    i = int(c["v"]) % 5
    place("bell", c["t"], bell(hz(FRIEND_NOTE[i]), 1.4, 0.07), pan=FRIEND_OFF[i] / 12)
    place("sfx", c["t"], felt(0.1, 110))
for c in cues("leave"):
    i = int(c["v"]) % 5
    f = hz(FRIEND_NOTE[4 - i])
    place("bell", c["t"], bell(f, 1.8, 0.05), pan=(i - 2) * 0.35)
    place("far", c["t"] + 0.1, glide(f, f * 1.5, 1.2, 0.02, harm=0.1), pan=(i - 2) * 0.45)
for c in cues("fest"):      # a firework over the campus
    place("sfx", c["t"] - 0.35, glide(700, 2400, 0.35, 0.03, harm=0.05), pan=0.15)
    place("sfx", c["t"], clap(0.25), pan=0.15)
    place("sfx", c["t"], crackle(2.2, 380, 0.3, decay=0.7), pan=0.2)
    for k, nn in enumerate(["F6", "A6", "C7", "D6", "G6"]):
        place("bell", c["t"] + 0.02 + k * 0.05, bell(hz(nn), 1.8, 0.03), pan=-0.3 + 0.2 * k)
for c in cues("phone"):     # the app, drawn, then filled in cell by cell
    place("sfx", c["t"], glide(300, 700, 0.6, 0.03))
cell_notes = scale(F_PENT, 5, 12)
for c in cues("cell"):
    r, q = divmod(int(c["v"]), 4)
    place("bell", c["t"], pluck(cell_notes[(r + q) % 12], 0.2, 0.04, harm=4, bright=2), pan=-0.3 + 0.2 * q)
    place("sfx", c["t"], click(0.04), pan=-0.3 + 0.2 * q)
for c in cues("shipped") + cues("flag"):
    place("sfx", c["t"] - 0.1, glide(400, 1800, 0.7, 0.03, harm=0.1), pan=0.3)
    place("bell", c["t"], bell(hz("C6"), 1.4, 0.07), pan=0.25)
    place("bell", c["t"] + 0.07, bell(hz("F6"), 1.4, 0.06), pan=0.3)
for c in cues("star"):
    place("bell", c["t"], bell(hz("A6"), 2.4, 0.06), pan=0.35)
    place("bell", c["t"] + 0.09, bell(hz("E7"), 1.6, 0.025), pan=0.4)
    place("air", c["t"], whoosh(0.8, 3000, 9000, 0.05, peak=0.1))

# ================================================================ one goal: a lift, a held breath

dom = max(goal + 1, gate - 2)           # where the dominant starts
breath0, breath1 = max(goal + 2.5, gate - 3.0), gate - 0.4
bed(goal, dom, 0.11, attack=0.9, dark=lambda t: 0.55 - 0.3 * np.minimum(1, t / 2.5))
bed(dom, breath1, 0.09, attack=0.25, release=0.3, overlap=0.2, dark=lambda t: 0.25 + 0.3 * np.minimum(1, t / 1.5))
held_bass(goal, dom, 0.34, tau=2.4)
place("bass", dom, subnote(hz("A1"), breath1 - dom, 0.28, tau=3))
drums(goal, min(goal + 3.0, dom), "heart", 1.0)
place("sfx", goal, glide(hz("D3"), hz("D4"), 1.6, 0.04, harm=0.3), pan=0.1)
# the held breath: one high note that does not move
place("bell", breath0, glide(hz("A5"), hz("A5") * 1.0005, breath1 - breath0, 0.018, harm=0.05)
      * fades(breath1 - breath0, 0.8, 0.05), pan=-0.1)
bigs = cues("word", 2)
for j, c in enumerate(bigs):
    place("drums", c["t"], kick(0.32, 0.5, low=52))
    place("bass", c["t"], sub_boom(0.22, 1.6))
    place("bell", c["t"], bell(hz("F5" if j == 0 else "C6"), 2.2, 0.08), pan=-0.2 if j == 0 else 0.2)
    place("bell", c["t"] + 0.04, bell(hz("Bb4" if j == 0 else "G5"), 2.2, 0.05))
riser(breath1 - 1.6, 1.6, 0.08, f1=5000, glide_amp=0)

# ================================================================ the gate year

crack, under, surface = S["crack"], S["under"], S["surface"]
bed(gate, crack, 0.28, attack=0.3, dark=flat(0.5))
held_bass(gate, crack, 0.16, tau=3.0)
pulse_bass(gate, crack, 0.44, anchor=gate, octave_every=0)
drums(gate, crack, "grind", 1.0)
# the clock: tick, tock, on every beat until the cramming cracks, then it limps
t, k = gate, 0
while t < under - 1e-6:
    limp = t >= crack
    if not limp or k % 3 == 0:
        a = 0.07 if limp else 0.11
        f = (2700 if k % 2 == 0 else 1900) * (0.94 if limp else 1)
        place("drums", t, tick(a, f), pan=-0.25 if k % 2 == 0 else 0.25)
        place("drums", t, blip(f / 4, 0.05, a * 0.4, 0))
    t += BEAT
    k += 1
for c in cues("day"):       # a tally mark under every day he walked
    n = int(0.03 * SR)
    place("sfx", c["t"], butter(rng.standard_normal(n), "bandpass", [2500, 7000]) * np.exp(-T(n) / 0.006) * 0.05, pan=0.1)
for c in cues("crack"):     # the tally marks rust and he shakes
    place("sfx", c["t"], buzz(98, 0.4, 0.12, tau=0.2))
    n = int(0.35 * SR)
    place("air", c["t"], butter(rng.standard_normal(n), "bandpass", [300, 3000]) * np.exp(-T(n) / 0.08) * 0.25)
    place("drums", c["t"], kick(0.4, 0.5, low=40))
    for j in range(22):
        place("sfx", c["t"] + 0.02 + j * 0.045, click(0.05 * (1 - j / 24)), pan=rng.uniform(-0.3, 0.3))
    # the chord sags and goes out of tune
    for f in notes(chord_at(c["t"] - 0.01))[2:]:
        place("pad", c["t"], glide(f, f * 2 ** (-1.3 / 12), 1.8, 0.022, harm=0.35) * np.exp(-T(int(1.8 * SR)) / 0.9), pan=rng.uniform(-0.3, 0.3))
bed(crack + min(1.2, 0.4 * (under - crack)), under, 0.05, attack=min(1.0, 0.4 * (under - crack)), dark=flat(0.7))
for a, b, ch in spans(crack + min(1.0, 0.4 * (under - crack)), under):
    if b - a > 0.3:
        place("bass", a, subnote(hz(ROOT[ch]), b - a, 0.2, tau=2))
# under the hood: the camera goes into the ground and the music is heard
# through it; the five layers of a machine ring clear, top to bottom
place("air", under - 0.1, whoosh(1.1, 6000, 250, 0.2, peak=0.25))
place("bass", under, glide(90, 38, 1.4, 0.35, harm=0.2) * np.exp(-T(int(1.4 * SR)) / 0.8))
bed(under, S["tinker"], 0.1, attack=0.4, dark=flat(0.3))
held_bass(under, S["tinker"], 0.34, tau=2.2)
drums(under + 0.4, surface, "heart", 1.3, anchor=under)
arp(under + 0.7, S["tinker"] - 0.25, 0.05, step=0.25, anchor=under, octave=2, bright=1.2)
HOOD_NOTES = ["A5", "F5", "D5", "A4", "F4"]
for c in cues("hood"):
    nn = hz(HOOD_NOTES[int(c["v"]) % 5])
    place("sfx", c["t"], bell(nn, 1.6, 0.075), pan=0.25)
    place("sfx", c["t"], blip(nn * 2, 0.06, 0.03, 0.4), pan=0.35)
for c in cues("surface"):
    place("air", c["t"] - 0.35, whoosh(0.9, 250, 7000, 0.2, peak=0.45))
    place("sfx", c["t"] + 0.1, glide(hz("D3"), hz("A4"), 0.5, 0.04, harm=0.3))

# ================================================================ a raspberry pi, two free servers

tk0, fl0 = S["tinker"], S["fall"]
servers = cues("server")
lift1 = snap(first(opt("pi"), tk0 + 1.5), tk0)                              # the pi boots: the beat comes in
lift2 = snap(first(plus(opt("server", i=-1), 0.0), tk0 + 0.6 * (fl0 - tk0)), tk0)   # both servers up: sixteenths
bed(tk0, fl0, 0.2, attack=0.25, dark=lambda t: 0.45 - 0.2 * t / (fl0 - tk0))
pulse_bass(tk0, lift2, 0.44, anchor=tk0, octave_every=0)
pulse_bass(lift2, fl0, 0.52, anchor=tk0)
drums(tk0, lift1, "soft", 1.7)
drums(lift1, lift2, "four", 0.7, anchor=tk0)
drums(lift2, fl0, "four", 0.9, anchor=tk0)
for q in np.arange(lift2 + 0.125, fl0, 0.25):
    place("drums", q, hat(0.04), pan=-0.3)
arp(lift1, lift2, 0.045, step=0.25, anchor=tk0, bright=1.2)
arp(lift2, fl0, 0.055, step=0.125, anchor=tk0, bright=1.8)
for c in cues("pi"):
    place("sfx", c["t"], glide(200, 600, 0.35, 0.06))
    place("bell", c["t"] + 0.35, blip(hz("A5"), 0.12, 0.06, 0.3), pan=-0.2)
    place("bell", c["t"] + 0.45, blip(hz("D6"), 0.12, 0.05, 0.3), pan=-0.2)
fans_off = fl0 + 1.5
for c in servers:
    place("drums", c["t"], kick(0.25, 0.25, low=70), pan=0.3)
    place("sfx", c["t"], glide(120, 260, 0.3, 0.06), pan=0.3)
    if fans_off - c["t"] > 1.0:
        d = fans_off - c["t"] - 0.2
        place("air", c["t"] + 0.2, noise_bed(d, 180, 900, 0.022, lfo=3.1, depth=0.2) * fades(d, 0.5, 1.5), pan=0.3)
led = scale(MINOR_PENT, 6, 8)
if servers:                 # the lights on the servers blink as they come up
    for t in np.arange(servers[0]["t"] + 0.4, fl0 + 0.8, 0.2):
        if rng.random() < 0.55:
            place("bell", t, blip(led[rng.integers(8)], 0.04, 0.025, 0.5), pan=rng.uniform(0.1, 0.7))

# ================================================================ the way down, the fog, the valley

fog, alone, reply, land, quote, sil, yes = S["fog"], S["alone"], S["reply"], S["land"], S["quote"], S["silence"], S["yes"]
bed(fl0, alone, 0.058, attack=0.4, release=0.8, dark=lambda t: 0.45 + 0.35 * t / (alone - fl0))
for a, b, ch in spans(fl0, alone):
    place("bass", a, subnote(hz(ROOT[ch]), b - a + 0.05, 0.22 - 0.1 * (a - fl0) / (alone - fl0), tau=2.0))
drums(fl0, fog, "soft", 1.1, anchor=fl0)
drums(fog, min(fog + 3.0, alone), "soft", 0.7, anchor=fl0)
drums(min(fog + 3.0, alone), min(fog + 6.5, alone), "heart", 0.5, anchor=fl0)
# a line that walks down with him, one note a chord
for (a, _, _), nn in zip(spans(fl0, alone), ["A5", "G5", "F5", "E5", "D5", "C#5", "D5"]):
    place("bell", a, bell(hz(nn), 2.4, 0.05), pan=-0.15)
    place("far", a + 0.25, bell(hz(nn), 2.4, 0.035), pan=0.3)
# the fog, rising, until "yes." blows it away
d = yes + 1.2 - fog
place("air", fog, noise_bed(d, 120, 1400, 0.04, lfo=0.13, depth=0.6)
      * sstep(0, min(9.0, alone - fog), T(int(d * SR))) * (1 - 0.65 * sstep(alone - fog, alone - fog + 1, T(int(d * SR)))), pan=-0.1)
sends = cues("send")        # applications go out, faster and faster; none come back
for j, c in enumerate(sends):
    f = 1300 + 1100 * rng.random()
    a = 0.028 * (1 - 0.5 * j / max(1, len(sends)))
    p = 0.25 + 0.65 * rng.random()
    place("sfx", c["t"], blip(f, 0.05, a, 0.3), pan=p)
    place("far", c["t"] + 0.05, glide(f, f * 1.6, 0.4, a * 0.5, harm=0.05), pan=min(1, p + 0.2))
# alone, at the bottom: a low D, the fog, and the cursor
place("bass", alone, subnote(hz("D2"), land - alone + 0.3, 0.07, tau=99) * fades(land - alone + 0.3, 0.8, 0.15))
place("pad", alone, pad(notes("D5"), land - alone + 0.4, 0.03, attack=1.5, release=0.6, dark=flat(0.9)))
for c in cues("blink"):
    if c["t"] >= alone:
        place("sfx", c["t"], tick(0.07, 2400))
        place("sfx", c["t"], blip(hz("D4"), 0.08, 0.025, 0))
for c in cues("layer"):     # the first of the stack is already being laid under him
    if alone <= c["t"] < reply:
        place("bell", c["t"], pluck(hz(["D5", "A4", "F4", "D4", "A3", "D3"][int(c["v"]) % 6]), 0.4, 0.02, harm=3, bright=0.8), pan=-0.1)
for c in cues("reply"):     # the one that came back: a ping from far away
    x = blip(hz("E6"), 0.6, 0.2, 0.05)
    place("far", c["t"], x, pan=0.75)
    place("sfx", c["t"], x, 0.12, pan=0.75)
    for k, dd in enumerate((0.13, 0.26)):
        place("far", c["t"] + dd, x, 0.45 ** (k + 1), pan=0.6 - 0.3 * k)
    if land - c["t"] > 0.2:
        place("sfx", c["t"] + 0.1, glide(hz("E6"), hz("A5"), land - c["t"] - 0.1, 0.012, harm=0.0), pan=0.4)
for c in cues("land"):
    place("bell", c["t"], bell(hz("D5"), 2.4, 0.09), pan=0.05)
    place("bell", c["t"] + 0.06, bell(hz("A5"), 2.4, 0.06), pan=0.15)
    place("bass", c["t"], subnote(hz("D2"), 1.8, 0.2, tau=1.2))
# "want to give it a shot?"
bed(land, sil, 0.05, attack=0.9, release=0.2, dark=lambda t: 0.6 - 0.35 * np.minimum(1, t / 3))
place("bass", quote, subnote(hz("A1"), sil - quote, 0.24, tau=4))
for c in cues("word", 5):
    place("bell", c["t"], bell(hz("A4"), 2.0, 0.06))
    place("bell", c["t"] + 0.05, bell(hz("E5"), 2.0, 0.035), pan=0.2)
riser(quote - 0.2, sil - quote + 0.2, 0.22, f1=8000, glide_amp=0.035)
roll(sil - min(0.85, sil - quote), sil, 0.04, 0.26)

# ================================================================ yes.

for c in cues("yes") or [{"t": yes}]:
    place("drums", c["t"], kick(1.0, 0.9))
    place("bass", c["t"], sub_boom(1.0, 2.8))
    n = int(1.6 * SR)
    place("air", c["t"], butter(rng.standard_normal(n), "lowpass", 5000) * np.exp(-T(n) / 0.45), 0.45)
    place("air", c["t"], hat(0.55, open_=True))
    place("air", c["t"] + 0.05, whoosh(1.8, 900, 7000, 0.12, peak=0.08))   # the ring that clears the fog
    for k, nn in enumerate(["D4", "A4", "D5", "F5", "A5"]):
        place("bell", c["t"] + k * 0.02, bell(hz(nn), 2.6, 0.085), pan=-0.4 + 0.2 * k)

# ================================================================ the climb

crash, rec, fixed = S["crash"], S["reconcile"], S["fixed"]
drive0 = snap(max(S["climb"], yes + 1.0), yes)       # the beat comes in once he is walking
stop_len = min(0.7, 0.5 * (rec - crash))
d1 = crash + stop_len + 0.3                          # the drive runs on under the tape stop
if drive0 - yes > 1.6:                               # a held "yes.": the chord rings until he walks
    place("pad", yes, pad(notes("Dm"), drive0 - yes + 0.3, 0.12, attack=0.05, release=0.4, dark=flat(0.3)))
    place("bass", yes + 1.0, subnote(hz("D2"), drive0 - yes - 1.0, 0.3, tau=3))
    bed(drive0, d1, 0.15, attack=0.05, dark=flat(0.3))
else:
    bed(yes, d1, 0.15, attack=0.05, dark=flat(0.3))
pulse_bass(max(yes, drive0 - 1.0), d1, 0.5, anchor=yes)
drums(drive0, drive0 + 1.0, "four", 0.8, anchor=yes)
drums(drive0 + 1.0, d1, "drive", 1.0, anchor=yes)
arp(drive0 + 1.0, d1, 0.04, step=0.25, anchor=yes, octave=2, bright=1.4, pattern=(0, 1, 2, 3, 2, 1))

# the crash: rust, and the whole machine loses its motor
tape_stop(MUSIC, crash, stop_len, fixed)
for c in cues("crash"):
    place("sfx", c["t"], buzz(110, 0.35, 0.13, tau=0.15, odd=(1, 3, 5, 7, 9)), pan=-0.4)
    place("drums", c["t"] + 0.02, kick(0.5, 0.5, low=38))
    place("air", c["t"], crackle(1.5, 260, 0.25, decay=0.5), pan=-0.3)
    for j in range(4):     # crashed mid-provision
        place("sfx", c["t"] + 0.35 + j * 0.2, buzz(180, 0.07, 0.05, tau=0.04, odd=(1, 3, 5)), pan=-0.1)
d = rec - crash - 0.4
if d > 0.5:
    tt = T(int(d * SR))
    place("pad", crash + 0.4, (np.sin(2 * np.pi * hz("D2") * tt) + 0.8 * np.sin(2 * np.pi * hz("D2") * 1.03 * tt)
                               + 0.3 * np.sin(2 * np.pi * hz("Ab2") * tt)) * fades(d, 0.8, 0.3) * 0.035)
g = crash + 0.6 * (rec - crash)
place("pad", g, pad(notes("Gm"), rec - g + 0.3, 0.06, attack=min(1.2, 0.8 * (rec - g)), release=0.3, dark=lambda t: 0.8 - 0.2 * t))
drums(g, rec, "heart", 0.9, anchor=yes)
# reconcile: a scan sweeps the broken block, the loop ticks, and it is fixed
d = fixed - rec
rt = T(int(d * SR)) / d
place("air", rec, svf_sweep(rng.standard_normal(len(rt)), 500, 5000, q=0.35, curve=rt) * (0.3 + 0.7 * rt), 0.12, pan=0.2)
place("pad", rec, pad(notes("Asus4"), d + 0.2, 0.08, attack=min(0.6, d / 2), release=0.15, dark=lambda t: 0.6 - 0.3 * t / d))
recn = scale(MINOR_PENT, 5, 10)
for j, t in enumerate(np.arange(rec, fixed - 0.05, 0.125)):
    place("sfx", t, tick(0.05, 2800 + 60 * j), pan=0.2)
    place("bell", t, blip(recn[j % 10], 0.06, 0.035, 0.2), pan=0.2)
for c in cues("fixed"):
    place("bell", c["t"], bell(hz("A5"), 1.6, 0.08), pan=0.2)
    place("bell", c["t"] + 0.05, bell(hz("D6"), 1.6, 0.06), pan=0.25)
    place("drums", c["t"], kick(0.6, 0.5))
    place("air", c["t"], hat(0.2, open_=True))

gth, num, bst, spur0, run0, summit, pull = (S[k] for k in ("gather", "numeral", "burst", "spur", "runners", "summit", "pull"))
top = summit - 0.8
# the drive comes back and climbs to the top
back = min(fixed + 2.0, gth)                        # a bar to find its feet, then the drive again
bed(fixed, summit, 0.15, attack=0.1, dark=flat(0.28))
pulse_bass(fixed, summit, 0.5, anchor=yes)
drums(fixed, back, "four", 0.8, anchor=yes)
drums(back, gth, "drive", 1.0, anchor=yes)
arp(back, gth, 0.04, step=0.25, anchor=yes, octave=2, bright=1.4, pattern=(0, 1, 2, 3, 2, 1))
drums(gth, num, "four", 0.7, anchor=yes)
drums(num, spur0 - 0.6, "drive", 1.0, anchor=yes)
drums(spur0 - 0.6, run0, "bounce", 1.0, anchor=yes)
drums(run0, top, "drive", 1.05, anchor=yes)
for q in np.arange(snap(run0, yes), top, 0.125):   # the runners come and go in sixteenths
    place("drums", q, hat(0.05), pan=rng.uniform(-0.5, 0.5))
arp(num, spur0 - 0.6, 0.04, step=0.25, anchor=yes, octave=2, bright=1.4, pattern=(0, 1, 2, 3, 2, 1))
arp(run0, top, 0.045, step=0.125, anchor=yes, octave=2, bright=2.0)
# 4,000 accounts gather into a number, then scatter into stars
riser(gth, num - gth, 0.14, f1=7000, glide_amp=0.03)
swarm_notes = scale(MINOR_PENT, 5, 10)
for _ in range(160):
    f = swarm_notes[rng.integers(10)]
    place("bell", gth + 0.55 * rng.random(), glide(f, f * 1.9, 1.1, 0.005, harm=0.0) * np.exp(-T(int(1.1 * SR)) / 0.5), pan=rng.uniform(-0.8, 0.8))
for c in cues("numeral"):
    place("drums", c["t"], kick(0.6, 0.7))
    place("bass", c["t"], sub_boom(0.3, 2.0))
    for k, nn in enumerate(["F4", "A4", "C5", "F5", "A5"]):
        place("bell", c["t"] + k * 0.025, bell(hz(nn), 2.2, 0.06), pan=-0.4 + 0.2 * k)
star_notes = scale(MINOR_PENT, 5, 14)
for c in cues("burst"):
    place("air", c["t"], whoosh(1.4, 8000, 1500, 0.1, peak=0.06))
    for _ in range(60):
        r = rng.random()
        place("bell", c["t"] + 0.35 * rng.random() + 1.2 * r ** 2.2, bell(star_notes[rng.integers(14)] * 2, 1.2, 0.03 * (1 - 0.6 * r)), pan=rng.uniform(-0.9, 0.9))
# side projects branch off the trail: little pops, climbing
spur_notes = ["D5", "F5", "G5", "A5", "C6", "D6"]
for c in cues("spur"):
    k = int(c["v"]) % 6
    p = -0.5 + 0.2 * k
    place("sfx", c["t"], glide(hz(spur_notes[k]) / 2, hz(spur_notes[k]), 0.12, 0.05, harm=0.3), pan=p)
    place("bell", c["t"] + 0.1, pluck(hz(spur_notes[k]), 0.35, 0.08, harm=5, bright=2), pan=p)
    place("bell", c["t"] + 0.45, bell(hz(spur_notes[k]) * 2, 0.8, 0.03), pan=p)
    place("sfx", c["t"] + 0.45, click(0.08), pan=p)
runner_notes = scale(MINOR_PENT, 5, 10)
for c in cues("runners"):   # warpbuild: runners that live for a moment
    place("bell", c["t"], bell(hz("D6"), 1.4, 0.06), pan=0.3)
    for t in np.arange(c["t"] + 0.125, top, 0.125):
        if rng.random() < 0.45:
            place("sfx", t, blip(runner_notes[rng.integers(10)] * 2, 0.05, 0.03, 0.5), pan=rng.uniform(-0.6, 0.6))
# the stack, built under his feet from the metal up: a rising arpeggio for
# each column of layers, thinned so they never pile on each other
groups = []
for c in cues("layer"):
    if not groups or c["v"] >= groups[-1][-1]["v"]:
        groups.append([])
    groups[-1].append(c)
last = -9.0
for grp in groups:
    g0 = grp[0]["t"]
    if g0 < yes or (crash - 0.2 <= g0 < fixed) or g0 >= pull or g0 - last < 1.45:
        continue
    last = g0
    tones = notes(chord_at(g0))
    ladder = [tones[0] * 2, tones[1] * 2, tones[2] * 2, tones[3] * 2, tones[4] * 2, tones[2] * 4]
    for c in grp:
        k = 5 - int(np.clip(c["v"], 0, 5))
        place("bell", c["t"], pluck(ladder[k], 0.3, 0.05 + 0.006 * k, harm=5, bright=1.6), pan=-0.35 + 0.14 * k)
# up to the summit
roll(top, summit - 0.02, 0.05, 0.3)
riser(summit - 1.6, 1.6, 0.14, f1=8000, glide_amp=0.03)
for c in cues("summit") or [{"t": summit}]:
    place("drums", c["t"], kick(0.75, 0.8))
    place("bass", c["t"], sub_boom(0.4, 2.4))
    place("air", c["t"], hat(0.35, open_=True))
    for k, nn in enumerate(["D5", "A5", "D6", "F6"]):
        place("bell", c["t"] + k * 0.03, bell(hz(nn), 2.4, 0.06), pan=-0.3 + 0.2 * k)
    place("pad", c["t"], pad(notes("Dm"), pull - c["t"] + 0.4, 0.12, attack=0.02, release=0.5))

# ================================================================ the whole ridge, then the press

prn, hold, flip, press, pressed = S["print"], S["hold"], S["flip"], S["press"], S["pressed"]
turn, resolve = S["turn"], S["resolve"]
g9 = min(prn, hold - 0.5)
# the pull-back: a swell, the widest chords in the film; the terrain prints on
# Gm9, and the dominant is held while the line is inked
place("pad", pull, pad(notes("Bbmaj7") + [hz("C5"), hz("F5")], g9 - pull + 0.8, 1.15, attack=0.8 * (g9 - pull), release=0.8,
                       dark=lambda t: 0.9 - 0.65 * np.minimum(1, t / (g9 - pull)),
                       shape=lambda t: (0.35 + 0.65 * np.clip(t / (0.8 * (g9 - pull)), 0, 1) ** 1.5) / np.maximum(1e-3, np.minimum(1, t / (0.8 * (g9 - pull)))) * (1 - 0.4 * np.clip((t - (g9 - pull)) / 0.8, 0, 1))))
place("pad", g9, pad(notes("Gm9") + [hz("D5"), hz("A5")], hold - g9 + 0.6, 0.22, attack=0.5, release=0.6, dark=flat(0.3)))
place("pad", hold, pad(notes("Asus4"), press - hold + 0.3, 0.16, attack=0.4, release=0.4, dark=flat(0.4),
                       shape=lambda t: 1 - 0.4 * np.clip((t - 0.8) / (press - hold), 0, 1)))
place("bass", pull, subnote(hz("Bb1"), g9 - pull + 0.1, 0.34, tau=3))
place("bass", g9, subnote(hz("G1"), hold - g9 + 0.05, 0.3, tau=3))
place("bass", hold, subnote(hz("A1"), press - hold + 0.05, 0.28, tau=3))
place("air", pull - 0.2, whoosh(prn - pull + 0.9, 150, 2500, 0.2, peak=0.75, q=0.4))
place("bass", pull, sub_boom(0.35, 3.0))
for c in cues("print"):     # the range prints in below the line
    place("foley", c["t"], felt(0.25, 60, 0.2))
    place("foley", c["t"], crackle(2.8, 650, 0.28, decay=1.0))
for c in cues("hold"):      # the line he walked is inked, end to end
    place("foley", c["t"] - 0.4, noise_bed(0.9, 500, 3000, 0.035, lfo=1.1, depth=0.3) * np.sin(np.pi * T(int(0.9 * SR)) / 0.9))
    place("foley", c["t"], felt(0.15, 70, 0.15))
# the line, sung once from end to end as the markers come up on it: higher on
# the ridge is higher in pitch
wps = cues("waypoint")
if len(wps) >= 2:
    wx = waypoint_xs(len(wps))
    wt = [w["t"] for w in wps]
    n = int((wt[-1] - wt[0] + 0.25) * SR)
    tt = wt[0] + T(n)
    xs = np.interp(tt, wt + [wt[-1] + 0.25], wx + [wx[-1]])
    f = hz("D4") * 2 ** (2 * np.interp(xs, np.arange(len(HEIGHT)), HEIGHT))
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = (np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)) * fades(n / SR, 0.02, 0.15) * 0.05
    a = (xs / max(wx) * 1.6 - 0.8 + 1) * np.pi / 4
    place("bell", wt[0], np.stack([tone * np.cos(a), tone * np.sin(a)], 1))
    for w, x in zip(wps, wx):
        place("bell", w["t"], bell(nearest(hz("D4") * 2 ** (2 * height_at(x)), MINOR_PENT), 2.0, 0.07), pan=x / max(wx) * 1.6 - 0.8)
# the plate turns over onto the bed of the press: air as it goes edge-on, and
# its weight as it lands
place("foley", flip, whoosh(press - flip + 0.1, 200, 2600, 0.2, peak=0.55))


def press_roll(t0, t1, marks=()):
    """A heavy roller crossing the plate left to right: the weight of it, the
    paper feeding under it, the gear teeth and one bump per turn, all with the
    speed of the roller (fastest mid-frame, as film.js eases it). `marks` are
    the moments it uncovers something printed; the paper bites a little there."""
    dur = t1 - t0
    n = int(dur * SR)
    u = T(n) / dur
    pos = in_out_cubic(u)
    speed = np.gradient(pos) * SR * dur / 1.5
    pan = -0.85 + 1.7 * pos
    out = np.zeros((n, 2))
    cos_, sin_ = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)

    def add(x, i=0):
        m = min(n - i, len(x))
        out[i:i + m, 0] += x[:m] * cos_[i:i + m]
        out[i:i + m, 1] += x[:m] * sin_[i:i + m]

    add(butter(rng.standard_normal(n), "bandpass", [28, 180]) * (0.2 + 0.8 * speed) * 1.3)
    add(np.sin(2 * np.pi * np.cumsum(42 + 16 * speed) / SR) * (0.15 + 0.5 * speed) * 0.45)
    grain = np.minimum(1, np.abs(butter(rng.standard_normal(n), "lowpass", 40)) * 3)
    add(butter(rng.standard_normal(n), "bandpass", [1200, 6500]) * speed ** 1.4 * (0.6 + 0.4 * grain) * 0.1)
    travel = np.cumsum(speed) / SR
    for rate, make in ((26, lambda s: click(0.07 * (0.3 + 0.7 * s))), (3.2, lambda s: felt(0.3 * (0.4 + 0.6 * s), 55, 0.12))):
        ticks_ = travel * rate
        for k in range(1, int(ticks_[-1]) + 1):
            i = int(np.searchsorted(ticks_, k))
            add(make(speed[i]), i)
    for m in marks:
        i = int((m - t0) * SR)
        if 0 <= i < n:
            add(crackle(0.3, 320, 0.16, decay=0.12), i)
    return out * fades(dur, 0.04, 0.03)[:, None]


marks = [c["t"] for c in cues("header") + cues("sunrise") if press < c["t"] < pressed]
place("foley", press, press_roll(press, pressed, marks))
place("foley", press, kick(0.45, 0.45, low=45), pan=-0.7)          # the plate lands, the latch drops
place("foley", press, clang(170, 0.5, 0.08), pan=-0.85)
place("foley", press + 0.01, click(0.2), pan=-0.85)
for c in cues("header") + cues("sunrise"):   # anything printed after the roller has gone
    if c["t"] >= pressed:
        place("foley", c["t"], crackle(0.3, 200, 0.12))
# the music holds its breath on the dominant while the roller runs, and turns
# toward D under it as the sun is uncovered
place("pad", press, pad(notes("A"), turn - press + 0.3, 0.1, attack=0.2, release=0.3, dark=flat(0.45)))
place("bass", press, subnote(hz("A1"), turn - press + 0.1, 0.18, tau=5))
if resolve - turn > 0.2:
    place("pad", turn, pad(notes("D"), resolve - turn + 0.4, 0.12, attack=resolve - turn, release=0.4, dark=flat(0.8)))
    place("sfx", turn, glide(hz("D3"), hz("D4"), resolve - turn + 0.05, 0.05, harm=0.3) * fades(resolve - turn + 0.05, resolve - turn, 0.03), pan=0.5)
else:
    place("sfx", resolve, glide(hz("D3"), hz("D4"), 1.2, 0.05, harm=0.3), pan=0.5)
for c in cues("pressed") or [{"t": pressed}]:
    place("foley", c["t"], kick(0.62, 0.6, low=40), pan=0.8)        # it hits the stop
    place("foley", c["t"], clang(140, 0.9, 0.16), pan=0.85)
    place("foley", c["t"] + 0.012, clang(311, 0.4, 0.06), pan=0.8)
    place("foley", c["t"] + 0.09, click(0.18), pan=0.9)             # the ratchet
    place("foley", c["t"] + 0.14, click(0.12), pan=0.9)
    place("foley", c["t"] + 0.12, whoosh(0.4, 1800, 8000, 0.12, peak=0.35), pan=0.4)   # the sheet lifts
    place("foley", c["t"] + 0.12, crackle(0.35, 220, 0.2), pan=0.3)

# ================================================================ sunrise, D major

rem = DUR - resolve
place("pad", resolve - 0.05, pad(notes("D"), rem + 0.05, 0.62, attack=0.3, release=1.2,
                                 dark=lambda t: 1.0 - 0.8 * np.minimum(1, t / 1.8),
                                 shape=lambda t: 1 - 0.55 * np.clip((t - 2.5) / (rem - 2.0), 0, 1)))
place("pad", resolve, pad([hz(n) for n in ["D5", "A5", "F#5", "E6"]], rem, 0.2, attack=0.5, release=1.2,
                          dark=lambda t: 0.6 - 0.3 * np.minimum(1, t / 1.5),
                          shape=lambda t: 1 - 0.5 * np.clip((t - 2.5) / (rem - 2.0), 0, 1)))
if resolve - pressed > 0.15:                 # the stop already had its own weight
    place("drums", resolve, kick(0.55, 0.9))
place("bass", resolve, sub_boom(0.45, 2.2))
n = int((rem + 0.1) * SR)
place("bass", resolve - 0.1, subnote(hz("D2"), rem + 0.1, 0.44, tau=99)
      * np.minimum(1, T(n) / 0.5) * (1 - 0.5 * np.clip((T(n) - 1.8) / (rem - 1.5), 0, 1)))
shimmer = scale(MAJOR_PENT, 5, 16)
for k in range(16):
    place("bell", resolve + 0.03 + k * 0.105, bell(shimmer[k], 1.6, 0.1 * (1 - k / 22)), pan=0.55 - k * 0.07)
for nn, g_, p in [("D5", 0.13, 0.5), ("F#5", 0.08, 0.55), ("A5", 0.065, 0.6)]:
    place("bell", resolve + 0.03, bell(hz(nn), 3.0, g_), pan=p)
for c in cues("type"):      # the address, typed; the last thing that ticks
    place("sfx", c["t"], tick(0.07, 2200 + 100 * (int(c["v"]) % 3)), pan=-0.55)
    place("sfx", c["t"], click(0.045), pan=-0.55)
for c in cues("closing"):   # still climbing.
    place("bell", c["t"], bell(hz("D6"), 2.4, 0.05), pan=-0.5)
    # a slow walk down the new chord while the page settles
    for d, nn in [(1.5, "A5"), (2.5, "F#5"), (3.5, "E5"), (4.5, "D5")]:
        if c["t"] + d < DUR - 1.2:
            place("bell", c["t"] + d, bell(hz(nn), 2.2, 0.04), pan=-0.2)

# ================================================================ footsteps, and ink


def step_level(t):
    """How loud his feet are: a pulse you feel more than hear, under the music,
    and all but gone in the fog."""
    if t < S["college"]: return 0.07
    if t < leave0: return 0.045
    if t < S["gate"]: return 0.06
    if t < S["crack"]: return 0.05
    if t < S["under"]: return 0.065
    if t < S["surface"]: return 0.04
    if t < S["fall"]: return 0.045
    if t < S["fog"]: return 0.04
    if t < S["yes"]: return 0.04 * (1 - 0.9 * sstep(S["fog"], S["fog"] + 4, t))
    return 0.035


last, side = -9.0, 1
for t, x in STEPS:
    if t - last < 0.22:     # at a run his feet blur; keep about one in every quarter second
        continue
    last, side = t, -side
    place("foley", t, felt(step_level(t) * rng.uniform(0.8, 1.1), 70 + 30 * height_at(x)), pan=0.08 * side)

INK = {0: (90, 0.12, -0.4), 1: (60, 0.08, -0.4), 2: (140, 0.14, 0.0), 5: (110, 0.1, 0.0), 6: (60, 0.06, 0.0)}
for c in cues("word"):      # each line printing in: a little ink
    if int(c["v"]) in INK:  # the title, the name and "yes." have their own sounds
        rate, amp, pan = INK[int(c["v"])]
        place("foley", c["t"], crackle(0.4 if c["v"] == 2 else 0.34, rate, amp), pan=pan)

# ================================================================ mix

# the music goes under the ground with the camera, and into the fog with him
FILTER = sorted([
    (0.0, 20000), (DUR, 20000),
    (S["under"], 20000), (S["under"] + 1.0, 420), (S["surface"], 600), (S["surface"] + 1.2, 20000),
    (S["fog"], 20000), (S["fog"] + 0.4 * (S["alone"] - S["fog"]), 3500), (S["alone"], 900), (S["land"], 1100),
    (S["quote"], 5000), (S["silence"], 20000),
])
fk_t, fk_f = zip(*FILTER)
fc = np.exp(np.interp(T(N), fk_t, np.log(fk_f)))
for b in MUSIC:
    BUSES[b] = tv_lowpass(BUSES[b], fc)

# the breath before "yes." is actually silent, reverb tails and all
MUTE = np.ones(N)
m0, m1 = int(round(S["silence"] * SR)), int(round(S["yes"] * SR))
ramp = int(0.008 * SR)
MUTE[max(0, m0 - ramp):m0] = np.linspace(1, 0, min(ramp, m0))
MUTE[m0:m1] = 0


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


dry = sum(BUSES[k] * DRY.get(k, 1.0) for k in BUSES)
send = sum(BUSES[k] * SEND[k] for k in BUSES)
ir = reverb_ir()
wet = np.stack([signal.fftconvolve(send[:, c], ir[:, c])[:N] for c in range(2)], 1) * 0.55

mix = dry + wet
mix = butter(mix, "highpass", 24)
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
mix = mix / np.max(np.abs(mix)) * 10 ** (-1.0 / 20)
mix *= MUTE[:, None]
mix *= (np.minimum(1, T(N) / 0.004) * np.clip((DUR - T(N)) / 0.4, 0, 1))[:, None]

WAV_PATH.parent.mkdir(parents=True, exist_ok=True)
wavfile.write(WAV_PATH, SR, np.round(mix * 32767).astype(np.int16))
print(f"wrote {WAV_PATH}  peak {20 * np.log10(np.max(np.abs(mix))):.1f} dBFS  rms {20 * np.log10(np.sqrt(np.mean(mix ** 2))):.1f} dBFS")
