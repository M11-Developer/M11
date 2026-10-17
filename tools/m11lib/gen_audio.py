"""توليد الصوت إجرائيًا (Synthesis) — أصوات الأسلحة والمحيط والموسيقى بلا ملفات خارجية.

يعمل هذا الملف بأربع طبقات:
  1) `synth`: أدوات توليد أساسية (موجات، ضجيج، مغلّفات، فلاتر، صدى، ضغط).
  2) `weapons`: أصوات الأسلحة الطبقية (طبقة قريبة حادة + ذيل بعيد) — القسم 12.
  3) `ambience`: حلقات محيطية (رياح، مدينة، قاعدة، غابة، مطر، معركة بعيدة).
  4) `music`: 6 مقطوعات متكيفة (قائمة، لوبي، BR هادئة، BR نهائية، DM سريعة، فوز/خسارة).

كل الناتج يُحفظ OGG/Vorbis أحادي أو ستيريو بمعدل 44.1kHz. الموسيقى ستيريو 96kbps
لأن الحجم المتاح يسمح بجودة عالية (القسم 19 من دفتر المشروع).
"""
from __future__ import annotations

import math
import os

import numpy as np

SR = 44100


# --------------------------------------------------------------- أدوات أساسية
def rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def t_axis(dur: float, sr: int = SR) -> np.ndarray:
    return np.arange(int(dur * sr), dtype=np.float32) / sr


def sine(freq, dur, sr=SR, phase=0.0):
    t = t_axis(dur, sr)
    return np.sin(2 * math.pi * freq * t + phase).astype(np.float32)


def saw(freq, dur, sr=SR):
    t = t_axis(dur, sr)
    return (2 * ((t * freq) % 1.0) - 1.0).astype(np.float32)


def square(freq, dur, sr=SR, duty=0.5):
    t = t_axis(dur, sr)
    return np.where((t * freq) % 1.0 < duty, 1.0, -1.0).astype(np.float32)


def noise(dur, sr=SR, seed=0):
    n = int(dur * sr)
    return rng(seed).normal(0, 1, n).astype(np.float32)


def env_ad(dur, attack=0.002, decay=None, curve=2.0, sr=SR):
    """مغلّف هجوم/تلاشٍ أسّي (AD Envelope)."""
    n = int(dur * sr)
    a = max(1, int(attack * sr))
    d = n - a
    e = np.zeros(n, dtype=np.float32)
    e[:a] = np.linspace(0, 1, a, dtype=np.float32) ** 0.6
    if d > 0:
        e[a:] = np.exp(-np.linspace(0, 1, d) * curve).astype(np.float32)
    return e


def env_adsr(dur, a=0.01, d=0.1, s=0.7, r=0.3, sr=SR):
    n = int(dur * sr)
    na, nd, nr = int(a * sr), int(d * sr), int(r * sr)
    ns = max(0, n - na - nd - nr)
    parts = [np.linspace(0, 1, max(1, na), dtype=np.float32),
             np.linspace(1, s, max(1, nd), dtype=np.float32),
             np.full(max(1, ns), s, dtype=np.float32),
             np.linspace(s, 0, max(1, nr), dtype=np.float32)]
    e = np.concatenate(parts)[:n]
    if len(e) < n:
        e = np.pad(e, (0, n - len(e)))
    return e.astype(np.float32)


def lowpass(x, cutoff, sr=SR, order=2):
    """ممر منخفض بسيط (One-pole مكرر + تنعيم) — كافٍ لصوت الألعاب."""
    y = x.astype(np.float32)
    for _ in range(order):
        a = math.exp(-2 * math.pi * cutoff / sr)
        b = 1 - a
        out = np.empty_like(y)
        acc = 0.0
        # تنفيذ متجهي على شكل تجميع أسّي
        alpha = a
        # استخدام مرشّح IIR بسيط عبر scipy غير متوفر → نستخدم حلقة بخطوات كتلية
        out[0] = acc = b * y[0]
        for i in range(1, len(y)):
            acc = alpha * acc + b * y[i]
            out[i] = acc
        y = out
    return y


def lowpass_fast(x, cutoff, sr=SR, order=2):
    """نسخة سريعة بالضرب في نافذة متحركة (FIR ممر منخفض بسيط)."""
    n = max(3, int(sr / max(60.0, cutoff)))
    k = np.hanning(n)
    k /= k.sum()
    y = np.convolve(x, k, mode="same").astype(np.float32)
    if order > 1:
        y = np.convolve(y, k, mode="same").astype(np.float32)
    return y


def highpass_fast(x, cutoff, sr=SR, order=1):
    y = x.astype(np.float32)
    for _ in range(order):
        lp = lowpass_fast(y, cutoff, sr)
        y = y - lp
    return y


def bandpass_fast(x, lo, hi, sr=SR):
    return highpass_fast(lowpass_fast(x, hi, sr), lo, sr)


def reverb(x, decay=0.35, mix=0.25, sr=SR, seed=3):
    """صدى بالالتفاف السريع (FFT Convolution) مع استجابة نبضية مولّدة.

    أسرع بمراحل من الحلقات اليدوية، ويعطي فضاءً واقعيًا (قاعة/شارع) بلا تكلفة.
    """
    if mix <= 0:
        return x.astype(np.float32)
    r = rng(seed)
    n = max(64, int(decay * sr))
    t = np.linspace(0, 1, n, dtype=np.float32)
    ir = r.normal(0, 1, n).astype(np.float32) * np.exp(-t * 5.5).astype(np.float32)
    # انعكاسات مبكرة (Early Reflections) تعطي إحساس المكان
    for ms, gain in ((7.3, 0.6), (13.1, 0.45), (19.7, 0.35), (27.4, 0.25), (41.2, 0.18)):
        i = int(ms * sr / 1000)
        if i < n:
            ir[i] += gain
    ir = lowpass_fast(ir, 4200, sr, 1)
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-6
    L = len(x) + n
    y = np.fft.irfft(np.fft.rfft(x, L) * np.fft.rfft(ir, L), L)[:len(x)].astype(np.float32)
    out = x.astype(np.float32) + y * mix * 2.2
    return (out / (1 + mix * 0.8)).astype(np.float32)


def soft_clip(x, drive=1.4):
    return np.tanh(x * drive).astype(np.float32)


def normalize(x, peak=0.95):
    m = float(np.max(np.abs(x))) if len(x) else 1.0
    return (x * (peak / m if m > 1e-6 else 1.0)).astype(np.float32)


def mix_at(base, clip, offset_sec, gain=1.0, sr=SR):
    i = int(offset_sec * sr)
    if i >= len(base):
        return base
    n = min(len(clip), len(base) - i)
    base[i:i + n] += clip[:n] * gain
    return base


# --------------------------------------------------------------- أصوات الأسلحة
def _gunshot(seed=1, dur=0.34, body=180.0, crack=2600.0, boom=90.0, bright=1.0):
    """طلقة: طبقة الجسم (انفجار البارود) + الصدع الحاد + ذيل (Reverb) + صوت الميكانيكا."""
    r = rng(seed)
    n = int(dur * SR)
    out = np.zeros(n, dtype=np.float32)
    # 1) الصدع (Crack): ضجيج حاد جدًا بمغلّف سريع
    c = noise(dur, seed=seed, sr=SR)
    c = bandpass_fast(c, crack * 0.5, min(16000, crack * 2.2), SR)
    c *= env_ad(dur, 0.0006, curve=7.0) * 0.85 * bright
    out += c
    # 2) الجسم: نبضة منخفضة (تكبير الهواء)
    b = sine(body, dur, SR) * env_ad(dur, 0.001, curve=3.2) * 0.5
    b += sine(boom, dur, SR) * env_ad(dur, 0.002, curve=2.0) * 0.35
    out += b
    # 3) الهسهسة (Shhh) — انفجار الغاز
    h = bandpass_fast(noise(dur, seed=seed + 7, sr=SR), 1200, 9000, SR)
    h *= env_ad(dur, 0.001, curve=9.0) * 0.35
    out += h
    # 4) رنّة معدنية للميكانيكا
    m = env_mul(sine(3200 * bright, dur * 0.5, SR), dur * 0.5, 0.0005, 12.0) * 0.10
    n = min(len(out), len(m))
    out[:n] += m[:n]
    return soft_clip(out, 1.25)


def _tail(x, dur=0.5, seed=5, g=0.4):
    """ذيل انعكاس بعيد (نسخة مكبوتة منخفضة التردد بتأخير) — طبقة 'متوسط/بعيد'."""
    y = lowpass_fast(x, 2200, SR)
    d = int(0.035 * SR)
    y = np.concatenate([np.zeros(d, dtype=np.float32), y * g])
    y = lowpass_fast(y, 900, SR)
    return normalize(y, 0.5)


GUN_PARAMS = {
    #     مدة   ترددات            قيمة القراءة
    "pistol":   dict(dur=0.28, body=210, crack=2900, bright=1.05),
    "smg":      dict(dur=0.22, body=250, crack=3100, bright=1.15),
    "ar":       dict(dur=0.32, body=180, crack=2700, bright=1.0),
    "sr":       dict(dur=0.55, body=130, crack=2200, bright=0.9),
    "shotgun":  dict(dur=0.48, body=110, crack=1800, bright=0.8),
    "lmg":      dict(dur=0.36, body=150, crack=2400, bright=0.95),
    "energy":   dict(dur=0.30, body=520, crack=4200, bright=1.3),
    "launcher": dict(dur=0.60, body=80, crack=1400, bright=0.7),
}


def weapon_shot(cls: str, seed: int = 1, dist: str = "near") -> np.ndarray:
    p = GUN_PARAMS.get(cls, GUN_PARAMS["ar"])
    core = _gunshot(seed=seed, dur=p["dur"], body=p["body"], crack=p["crack"], bright=p["bright"])
    if dist == "near":
        out = core
    elif dist == "mid":
        out = lowpass_fast(core, 5200, SR) * 0.85
        out = mix_at(out, _tail(core, g=0.5), 0.012, 0.9)
    else:
        out = lowpass_fast(core, 2000, SR) * 0.5
        out = mix_at(out, _tail(core, g=0.9, dur=0.8), 0.03, 1.0)
        out = reverb(out, 0.5, 0.5, SR, seed)
    if cls == "energy":
        out = out + 0.25 * sine(880, len(out) / SR, SR) * env_ad(len(out) / SR, 0.005, curve=6)
    return normalize(out, 0.92)


def explosion(seed=11, size=1.0) -> np.ndarray:
    dur = 1.6 * size
    r = rng(seed)
    low = lowpass_fast(noise(dur, seed=seed, sr=SR), 180, SR, 2) * env_ad(dur, 0.004, curve=1.8) * 1.3
    mid = bandpass_fast(noise(dur, seed=seed + 3, sr=SR), 200, 2600, SR) * env_ad(dur, 0.006, curve=2.4) * 0.9
    crack = noise(dur, seed=seed + 9, sr=SR) * env_ad(dur, 0.001, curve=14) * 0.7
    rumble = sine(42 * size, dur, SR) * env_ad(dur, 0.01, curve=1.4) * 0.6
    out = low + mid + crack + rumble
    out = reverb(out, 0.6, 0.35, SR, seed)
    return normalize(soft_clip(out, 1.1), 0.98)


def impact(material: str, seed=21) -> np.ndarray:
    dur = {"dirt": 0.16, "metal": 0.22, "wood": 0.18, "water": 0.30, "concrete": 0.20,
           "glass": 0.34, "flesh": 0.14}.get(material, 0.18)
    r = rng(seed)
    if material == "metal":
        x = bandpass_fast(noise(dur, seed=seed, sr=SR), 1800, 9000, SR) * env_ad(dur, 0.0004, curve=9) * 0.7
        clip_len = int(dur * 0.6 * SR)
        for f, g in ((3400, 0.4), (5200, 0.3), (7800, 0.2)):
            x[:clip_len] += g * env_mul(sine(f, dur * 0.6, SR), dur * 0.6, 0.0003, 10)
    elif material == "wood":
        x = bandpass_fast(noise(dur, seed=seed, sr=SR), 300, 3200, SR) * env_ad(dur, 0.0006, curve=8) * 0.8
        x[: int(dur * 0.7 * SR)] += 0.35 * env_mul(sine(420, dur * 0.7, SR), dur * 0.7, 0.001, 7)
    elif material == "water":
        x = lowpass_fast(noise(dur, seed=seed, sr=SR), 1400, SR) * env_ad(dur, 0.002, curve=3.2) * 0.9
        x += bandpass_fast(noise(dur, seed=seed + 1, sr=SR), 200, 900, SR) * env_ad(dur, 0.01, curve=2.5) * 0.4
    elif material == "concrete":
        x = bandpass_fast(noise(dur, seed=seed, sr=SR), 600, 5200, SR) * env_ad(dur, 0.0007, curve=8) * 0.85
        x[: int(dur * 0.4 * SR)] += 0.3 * env_mul(sine(220, dur * 0.4, SR), dur * 0.4, 0.001, 9)
    elif material == "glass":
        x = bandpass_fast(noise(dur, seed=seed, sr=SR), 4000, 12000, SR) * env_ad(dur, 0.0004, curve=5) * 0.6
        clip_len = int(dur * 0.4 * SR)
        for k in range(6):
            f = 2400 + k * 900
            x[:clip_len] += 0.18 * env_mul(sine(f, dur * 0.4, SR), dur * 0.4, 0.0005, 11 + k)
    elif material == "flesh":
        x = lowpass_fast(noise(dur, seed=seed, sr=SR), 900, SR) * env_ad(dur, 0.001, curve=6) * 0.9
        x += 0.2 * sine(160, dur, SR) * env_ad(dur, 0.002, curve=5)
    else:  # dirt
        x = lowpass_fast(noise(dur, seed=seed, sr=SR), 2200, SR) * env_ad(dur, 0.001, curve=6) * 0.9
    return normalize(x, 0.8)


def env_mul(sig, dur, attack=0.001, curve=7.0, sr=SR):
    """يضرب إشارة طويلة بمغلّف أقصر بعد قصّها (يمنع عدم تطابق الأطوال)."""
    n = int(dur * sr)
    return sig[:n] * env_ad(dur, attack, curve=curve, sr=sr)


def _add_trunc(base, clip, gain=1.0):
    """يضيف مقطعًا أقصر إلى بداية قاعدة أطول (مع حماية من عدم تطابق الأطوال)."""
    n = min(len(base), len(clip))
    base[:n] += clip[:n] * gain
    return base


def footstep(surface: str, seed=31, hard=False) -> np.ndarray:
    dur = 0.18
    r = rng(seed)
    base = bandpass_fast(noise(dur, seed=seed, sr=SR), 120, 3000, SR) * env_ad(dur, 0.001, curve=7) * 0.8
    if surface == "metal":
        _add_trunc(base, env_mul(bandpass_fast(noise(dur, seed=seed + 2, sr=SR), 2000, 7000, SR),
                                 dur * 0.6, 0.0005, 11), 0.35)
    elif surface == "wood":
        _add_trunc(base, env_mul(sine(180, dur * 0.6, SR), dur * 0.6, 0.001, 9), 0.3)
    elif surface == "water":
        base = lowpass_fast(noise(0.32, seed=seed, sr=SR), 1600, SR) * env_ad(0.32, 0.003, curve=3) * 0.9
        base += bandpass_fast(noise(0.32, seed=seed + 5, sr=SR), 300, 1400, SR) * env_ad(0.32, 0.02, curve=2)
    elif surface == "grass":
        base = highpass_fast(base, 1800) * 0.9
    elif surface == "sand":
        base = lowpass_fast(base, 1200, SR) * 0.9
    if hard:
        base = lowpass_fast(base, 900, SR)
    return normalize(base, 0.55)


def reload_sound(cls: str, seed=41) -> np.ndarray:
    """سلسلة إعادة تعمير ميكانيكية: إخراج المخزن ← إدخاله ← تعشيق ← إغلاق."""
    dur = 1.1
    out = np.zeros(int(dur * SR), dtype=np.float32)
    clanks = [(0.02, 0.5, 5200), (0.18, 0.75, 1800), (0.34, 0.4, 3200), (0.55, 0.95, 700),
              (0.72, 0.6, 2400), (0.92, 0.5, 900)]
    if cls == "shotgun":
        clanks = [(0.05, 0.8, 900), (0.30, 0.7, 1500), (0.55, 0.8, 900), (0.80, 0.6, 1200)]
    elif cls == "sr":
        clanks = [(0.06, 0.7, 2400), (0.30, 0.8, 900), (0.60, 0.9, 1600), (0.88, 0.6, 3000)]
    for (t0, g, f) in clanks:
        n = int(0.12 * SR)
        c = bandpass_fast(noise(0.12, seed=seed + int(t0 * 100), sr=SR), f * 0.5, min(14000, f * 2.4), SR)
        c *= env_ad(0.12, 0.0006, curve=10)
        c += 0.3 * sine(f, 0.12, SR) * env_ad(0.12, 0.001, curve=8)
        mix_at(out, c, t0, g)
    # حركة بلاستيك/معدن خفيفة بين الخطوات
    rustle = highpass_fast(noise(dur, seed=seed + 99, sr=SR), 3000) * 0.06
    out += rustle * env_adsr(dur, 0.05, 0.2, 0.5, 0.4)
    return normalize(out, 0.75)


def ui_click(kind="click", seed=51) -> np.ndarray:
    dur = {"click": 0.07, "back": 0.09, "confirm": 0.18, "error": 0.22, "kill": 0.35,
           "headshot": 0.45, "level_up": 0.9, "pickup": 0.16, "hitmarker": 0.1}.get(kind, 0.1)
    if kind in ("click", "hitmarker"):
        f = 1500 if kind == "click" else 2400
        x = env_mul(sine(f, dur, SR), dur, 0.0005, 12)
        x += 0.4 * env_mul(bandpass_fast(noise(dur, seed=seed, sr=SR), 2000, 8000, SR), dur, 0.0004, 14)
    elif kind == "back":
        x = sine(700, dur, SR) * env_ad(dur, 0.0005, curve=10)
    elif kind == "confirm":
        x = np.concatenate([sine(880, dur / 2, SR) * env_ad(dur / 2, 0.001, curve=5),
                            sine(1320, dur / 2, SR) * env_ad(dur / 2, 0.001, curve=5)])
    elif kind == "error":
        x = env_mul(sine(220, dur, SR), dur, 0.002, 4) + 0.5 * env_mul(square(110, dur, SR, 0.3), dur, 0.002, 4)
    elif kind == "kill":
        x = np.concatenate([sine(660, 0.1, SR) * env_ad(0.1, 0.001, curve=5),
                            sine(990, 0.1, SR) * env_ad(0.1, 0.001, curve=5),
                            sine(1320, 0.15, SR) * env_ad(0.15, 0.001, curve=4)])
    elif kind == "headshot":
        x = np.concatenate([sine(1568, 0.08, SR) * env_ad(0.08, 0.001, curve=6),
                            sine(2093, 0.1, SR) * env_ad(0.1, 0.001, curve=6),
                            sine(2637, 0.22, SR) * env_ad(0.22, 0.001, curve=5)])
    elif kind == "level_up":
        notes = [523, 659, 784, 1046, 1318]
        parts = [sine(f, 0.16, SR) * env_ad(0.16, 0.002, curve=4) for f in notes]
        x = np.concatenate(parts)
        x = reverb(x, 0.4, 0.3, SR, seed)
    elif kind == "pickup":
        x = sine(1046, dur, SR) * env_ad(dur, 0.001, curve=8) + 0.5 * sine(1568, dur, SR) * env_ad(dur, 0.001, curve=10)
    else:
        x = env_mul(noise(dur, seed=seed, sr=SR), dur, 0.001, 8)
    return normalize(x, 0.7)


def voice_grunt(kind: str, pitch: float = 1.0, seed=61) -> np.ndarray:
    """مؤثر صوتي غير لفظي للشخصيات (لا يحتوي كلامًا — تجنبًا لأي حقوق).

    نوّلد صوت "همهمة/صرخة قصيرة" من أشكال موجية صوتية (Formants) بسيطة:
    ناقل (Pulse) + مرشّحات رنين ثلاثية تعطي إحساس الحلق/الفم.
    """
    dur = {"effort": 0.35, "pain": 0.45, "death": 0.8, "victory": 0.9, "taunt": 0.6}.get(kind, 0.4)
    r = rng(seed)
    base_f = (150 if pitch > 1.0 else 120) * pitch
    t = t_axis(dur)
    # نموذج المزمار: ناقل متغيّر التردد
    f0 = base_f * (1 + 0.12 * np.sin(2 * math.pi * 5 * t) - 0.25 * (t / dur))
    phase = 2 * math.pi * np.cumsum(f0) / SR
    glottal = (np.sin(phase) ** 2 * 0.6 + np.sin(2 * phase) * 0.25)
    if kind in ("pain", "death"):
        glottal += 0.3 * r.normal(0, 1, len(t))
    x = glottal.astype(np.float32)
    # مرشّحات رنين (Formants)
    formats = {"effort": [(600, 900), (1000, 1500), (2600, 1200)],
               "pain": [(700, 1100), (1200, 1400), (2800, 1000)],
               "death": [(500, 900), (900, 1300), (2400, 900)],
               "victory": [(650, 1000), (1100, 1600), (2700, 1300)],
               "taunt": [(600, 950), (1050, 1400), (2500, 1100)]}[kind]
    for (f, g) in formats:
        x += (g / 1500.0) * np.sin(2 * math.pi * f * t) * glottal * 0.4
    x *= env_adsr(dur, 0.03, 0.1, 0.6, 0.4)
    x = bandpass_fast(x, 120, 5000, SR)
    x = reverb(x, 0.4, 0.25, SR, seed)
    return normalize(soft_clip(x, 0.8), 0.75)


# --------------------------------------------------------------- المحيط
def ambience(kind: str, dur: float = 12.0, seed: int = 71) -> np.ndarray:
    """حلقة محيطية (تُشغّل Loop في المحرك)."""
    r = rng(seed)
    n = int(dur * SR)
    out = np.zeros(n, dtype=np.float32)
    if kind == "desert_wind":
        w = lowpass_fast(noise(dur, seed=seed, sr=SR), 700, SR, 2)
        mod = (0.5 + 0.5 * np.sin(2 * math.pi * 0.07 * t_axis(dur)))  # هبّات
        out += w * mod * 0.8
        out += 0.15 * bandpass_fast(noise(dur, seed=seed + 3, sr=SR), 1000, 3400, SR) * mod
    elif kind == "city_far":
        base = lowpass_fast(noise(dur, seed=seed, sr=SR), 500, SR, 2) * 0.5
        out += base
        for k in range(6):   # أصداء انفجارات بعيدة
            t0 = r.random() * (dur - 1.2)
            e = lowpass_fast(noise(1.1, seed=seed + 10 + k, sr=SR), 160, SR, 2) * env_ad(1.1, 0.01, curve=2.2)
            out = mix_at(out, e, float(t0), 0.5 + 0.3 * r.random())
        for k in range(4):   # سيارات/منبهات بعيدة
            f = 400 + r.random() * 500
            e = sine(f, 0.8, SR) * env_ad(0.8, 0.05, curve=3) * 0.12
            out = mix_at(out, e, float(r.random() * (dur - 1)), 0.7)
    elif kind == "base_hum":
        hum = sine(60, dur, SR) * 0.35 + sine(120, dur, SR) * 0.16 + sine(180, dur, SR) * 0.08
        out += hum * (0.8 + 0.2 * np.sin(2 * math.pi * 0.3 * t_axis(dur)))
        out += lowpass_fast(noise(dur, seed=seed, sr=SR), 300, SR) * 0.25
        for k in range(3):
            e = bandpass_fast(noise(0.4, seed=seed + 20 + k, sr=SR), 400, 2000, SR) * env_ad(0.4, 0.05, curve=4) * 0.25
            out = mix_at(out, e, float(r.random() * (dur - 0.5)), 0.8)
    elif kind == "forest_night":
        out += lowpass_fast(noise(dur, seed=seed, sr=SR), 400, SR, 2) * 0.35
        for k in range(14):   # حشرات
            f = 2600 + r.random() * 2400
            ln = 0.05 + r.random() * 0.12
            e = bandpass_fast(noise(ln, seed=seed + 30 + k, sr=SR), f * 0.8, min(12000, f * 1.3), SR)
            e *= env_ad(ln, 0.005, curve=6) * 0.25
            out = mix_at(out, e, float(r.random() * (dur - ln)), 0.9)
    elif kind == "rain":
        rain = highpass_fast(noise(dur, seed=seed, sr=SR), 900) * 0.35
        out += rain
        out += lowpass_fast(noise(dur, seed=seed + 1, sr=SR), 600, SR, 2) * 0.3
        for k in range(20):   # قطرات
            ln = 0.03 + r.random() * 0.05
            e = bandpass_fast(noise(ln, seed=seed + 40 + k, sr=SR), 1200, 8000, SR) * env_ad(ln, 0.001, curve=9) * 0.2
            out = mix_at(out, e, float(r.random() * (dur - ln)), 1.0)
    elif kind == "battle_distant":
        out += lowpass_fast(noise(dur, seed=seed, sr=SR), 400, SR, 2) * 0.35
        for k in range(10):
            t0 = float(r.random() * (dur - 1.6))
            e = explosion(seed + k, 0.8) * (0.15 + 0.25 * r.random())
            out = mix_at(out, lowpass_fast(e, 700, SR), t0, 0.8)
    elif kind == "menu_wind":
        out += lowpass_fast(noise(dur, seed=seed, sr=SR), 500, SR, 2) * 0.5
    # تنظيف الحواف للحلقات: مزج أول/آخر 0.5 ثانية (Crossfade) لمنع النقر
    xf = int(0.4 * SR)
    if len(out) > 3 * xf:
        a, b = out[:xf].copy(), out[-xf:].copy()
        w = np.linspace(0, 1, xf).astype(np.float32)
        out[:xf] = a * w + b * (1 - w)
        out = out[:-xf]
    return normalize(out, 0.7)


# --------------------------------------------------------------- الموسيقى
class Music:
    """مولّد مقطوعات موسيقية إجرائيًا: سلّم/إيقاع/تناسق هارموني + آلات بسيطة.

    البنية: طبقات (Bass / Pad / Arp / Lead / Perc) على مقياس وترتيب كوردات ثابت،
    مع إمكانية تغيير الشدة (Intensity) للانتقال بين "هادئة" و"نهائية متوترة".
    """

    SCALES = {
        "phrygian": [0, 1, 3, 5, 7, 8, 10],     # شرقي/توتر
        "minor": [0, 2, 3, 5, 7, 8, 10],        # حزن/بطولي
        "harmonic_minor": [0, 2, 3, 5, 7, 8, 11],
        "major": [0, 2, 4, 5, 7, 9, 11],
    }

    def __init__(self, root_hz: float = 110.0, scale="minor", bpm=100, seed=1):
        self.root = root_hz
        self.scale = self.SCALES[scale]
        self.bpm = bpm
        self.r = rng(seed)
        self.beat = 60.0 / bpm

    def note_hz(self, degree: int) -> float:
        n = len(self.scale)
        octave, idx = divmod(degree, n)
        semis = self.scale[idx] + 12 * octave
        return self.root * (2 ** (semis / 12.0))

    # --- آلات ---
    def bass(self, dur, freq, seed=0):
        t = t_axis(dur)
        x = saw(freq, dur) * 0.6 + sine(freq, dur) * 0.5 + square(freq * 0.5, dur, duty=0.35) * 0.25
        x = lowpass_fast(x, 500 + freq * 2, SR, 2)
        return x * env_adsr(dur, 0.006, 0.06, 0.75, min(0.2, dur * 0.4))

    def pad(self, dur, freqs, seed=0):
        t = t_axis(dur)
        x = np.zeros(len(t), dtype=np.float32)
        for i, f in enumerate(freqs):
            det = 1 + (i - len(freqs) / 2) * 0.0022
            x += (saw(f * det, dur) * 0.18 + sine(f * 2 * det, dur) * 0.10)
        x = lowpass_fast(x, 2600, SR, 2)
        lfo = 0.7 + 0.3 * np.sin(2 * math.pi * 0.12 * t + seed)
        return x * env_adsr(dur, 0.25, 0.3, 0.8, 0.5) * lfo

    def pluck(self, dur, freq, seed=0):
        t = t_axis(dur)
        x = saw(freq, dur) * 0.5 + sine(freq, dur) * 0.5
        x = lowpass_fast(x, 3400, SR, 2)
        e = np.exp(-t * 7.5).astype(np.float32)
        return x * e

    def lead(self, dur, freq, seed=0):
        t = t_axis(dur)
        vib = 1 + 0.008 * np.sin(2 * math.pi * 5.5 * t)
        x = square(freq * vib, dur, duty=0.5) * 0.35 + saw(freq * vib, dur) * 0.3
        x = bandpass_fast(x, 300, 5200, SR)
        return x * env_adsr(dur, 0.02, 0.1, 0.7, 0.25)

    def kick(self, dur=0.3):
        t = t_axis(dur)
        f = 120 * np.exp(-t * 22) + 45
        x = sine(1, dur) * 0
        ph = 2 * math.pi * np.cumsum(f) / SR
        x = np.sin(ph).astype(np.float32) * np.exp(-t * 9).astype(np.float32)
        x += 0.3 * lowpass_fast(noise(dur, seed=3, sr=SR), 200, SR) * np.exp(-t * 30).astype(np.float32)
        return x

    def snare(self, dur=0.22, seed=7):
        t = t_axis(dur)
        x = bandpass_fast(noise(dur, seed=seed, sr=SR), 900, 7000, SR) * np.exp(-t * 16).astype(np.float32)
        x += 0.3 * sine(190, dur) * np.exp(-t * 22).astype(np.float32)
        return x

    def hat(self, dur=0.09, seed=11, open=False):
        t = t_axis(dur)
        x = highpass_fast(noise(dur, seed=seed, sr=SR), 6500) * np.exp(-t * (10 if open else 34)).astype(np.float32)
        return x * 0.5

    def tom(self, dur=0.3, f=140):
        t = t_axis(dur)
        ph = 2 * math.pi * np.cumsum(f * np.exp(-t * 5) + f * 0.4) / SR
        return np.sin(ph).astype(np.float32) * np.exp(-t * 8).astype(np.float32)

    def build(self, dur=8.0, seed=1, intensity=0.5):
        """يبني مقطوعة كاملة بلوب بطول `dur` ثانية."""
        x = np.zeros(int(dur * SR), dtype=np.float32)
        beat = self.beat
        bars = int(dur / (beat * 4))
        # ترتيب الكوردات (4 بارات): i - VI - III - VII (بطولي/توتر)
        prog = [[0, 2, 4], [5, 7, 9], [2, 4, 6], [6, 8, 10]]
        for bar in range(bars):
            t0 = bar * beat * 4
            chord = prog[bar % len(prog)]
            # Bass
            for k in range(4):
                deg = chord[0] - 7
                x = mix_at(x, self.bass(beat * 0.9, self.note_hz(deg + (7 if k % 2 else 0)), bar),
                           t0 + k * beat, 0.5)
            # Pad
            x = mix_at(x, self.pad(beat * 4.1, [self.note_hz(d) for d in chord], bar),
                       t0, 0.42 + 0.1 * intensity)
            # Arp / Lead
            if intensity > 0.25:
                steps = 8
                for k in range(steps):
                    deg = chord[k % len(chord)] + (7 if (k % 4) >= 2 else 0)
                    v = 0.26 * intensity if k % 2 == 0 else 0.18 * intensity
                    x = mix_at(x, self.pluck(beat * 0.5, self.note_hz(deg + 7), bar * 3 + k),
                               t0 + k * beat * 0.5, v)
            if intensity > 0.6:
                for k in range(4):
                    deg = chord[k % len(chord)] + 14
                    x = mix_at(x, self.lead(beat * 0.9, self.note_hz(deg), bar * 5 + k),
                               t0 + k * beat, 0.16)
            # Perc
            if intensity > 0.15:
                for k in range(4):
                    x = mix_at(x, self.kick(), t0 + k * beat, 0.7 * (0.6 + intensity))
                for k in (1, 3):
                    x = mix_at(x, self.snare(seed=bar * 7 + k), t0 + k * beat, 0.42 * (0.5 + intensity))
                for k in range(8):
                    x = mix_at(x, self.hat(seed=bar * 11 + k, open=(k == 7)),
                               t0 + k * beat * 0.5, 0.3 * (0.4 + intensity))
                if intensity > 0.7:
                    for k in range(2):
                        x = mix_at(x, self.tom(f=150 - k * 30), t0 + 3.0 * beat + k * beat * 0.5, 0.4)
        x = reverb(x, 0.45, 0.22, SR, seed)
        x = soft_clip(x, 1.15)
        return normalize(x, 0.85)


TRACKS = {
    "menu_theme":      dict(root=110.0, scale="minor", bpm=84, seed=101, dur=68.0, intensity=0.45),
    "lobby_theme":     dict(root=123.5, scale="major", bpm=100, seed=102, dur=60.0, intensity=0.35),
    "br_calm":         dict(root=98.0, scale="phrygian", bpm=76, seed=103, dur=72.0, intensity=0.25),
    "br_final":        dict(root=98.0, scale="harmonic_minor", bpm=132, seed=104, dur=64.0, intensity=0.95),
    "dm_fast":         dict(root=130.8, scale="minor", bpm=150, seed=105, dur=64.0, intensity=0.85),
    "victory":         dict(root=146.8, scale="major", bpm=110, seed=106, dur=36.0, intensity=0.6),
    "defeat":          dict(root=87.3, scale="minor", bpm=70, seed=107, dur=32.0, intensity=0.3),
}


def render_track(name: str) -> np.ndarray:
    cfg = TRACKS[name]
    m = Music(root_hz=cfg["root"], scale=cfg["scale"], bpm=cfg["bpm"], seed=cfg["seed"])
    x = m.build(cfg["dur"], seed=cfg["seed"], intensity=cfg["intensity"])
    # ستيريو بفارق زمني بسيط (Width) — يعطي إحساس فراغ
    d = int(0.008 * SR)
    left = x
    right = np.concatenate([np.zeros(d, dtype=np.float32), x[:-d]])
    return np.stack([left, right * 0.96], axis=1)


# --------------------------------------------------------------- الكتابة
def write_ogg(path: str, audio: np.ndarray, sr: int = SR, stereo: bool = False,
              quality: float = 0.7):
    """يكتب OGG/Vorbis. مهم: تحويل المصفوفة إلى C-contiguous float32 قبل الكتابة
    (خلاف ذلك قد تنهار مكتبة الترميز)."""
    import soundfile as sf
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    if audio.ndim == 1 and stereo:
        audio = np.stack([audio, audio], axis=1)
    audio = np.ascontiguousarray(np.clip(audio, -1.0, 1.0), dtype=np.float32)
    if audio.ndim == 1:
        audio = audio[:, None]
    # الكتابة على كتل: مكتبة الترميز قد تنهار مع المخازن الضخمة في بعض البيئات
    with sf.SoundFile(path, "w", samplerate=sr, channels=audio.shape[1],
                      format="OGG", subtype="VORBIS", compression_level=quality) as f:
        for i in range(0, len(audio), 32768):
            f.write(audio[i:i + 32768])
    return os.path.getsize(path)
