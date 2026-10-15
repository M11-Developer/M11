"""مولّد عالم اللعبة: التايل سيتس + العناصر التفاعلية + مؤثرات VFX.

كل شيء هنا مولّد بالكود (القسم 16 من دفتر المشروع) — لا صور خارجية:
  * 4 مجموعات تايل (32×32) لعائلات الخرائط: مدينة مدمرة، صحراء/قرية، قاعدة ليلية، غابة/ميناء
  * 24 عنصرًا تفاعليًا (صناديق، براميل متفجرة، أكياس رمل، أبواب، مصاعد، مصابيح...)
  * شرائح مؤثرات (انفجار/فوهة/دم/غبار/دخان/شرارة/ماء/حطام/نار/فلاش)
القواعد الفنية: نفس اللوحة اللونية، Dithering يدوي، Hue-Shift، حد خارجي للعناصر.
"""
from __future__ import annotations

import json
import math

import numpy as np

from . import draw as D
from . import palette as pal

TS = 32  # مقاس التايل


# --------------------------------------------------------------- التايلات
def _noise(seed: int, w: int, h: int, octaves=3, scale=4.0) -> np.ndarray:
    """ضجيج قيمي متعدد الطبقات (Value Noise) بـ numpy — لملء الأسطح بتفاصيل طبيعية."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), dtype=np.float32)
    amp = 1.0
    tot = 0.0
    for o in range(octaves):
        gw = max(2, int(w / (scale / (2 ** o))))
        gh = max(2, int(h / (scale / (2 ** o))))
        g = rng.random((gh + 1, gw + 1)).astype(np.float32)
        # تكبير بأقرب جار للحصول على كتل بكسلية حادة
        ys = (np.arange(h) * gh / h).astype(int)
        xs = (np.arange(w) * gw / w).astype(int)
        up = g[np.clip(ys, 0, gh - 1)][:, np.clip(xs, 0, gw - 1)]
        out += up * amp
        tot += amp
        amp *= 0.5
    return out / tot


def _dither_with(img, ramp, seeds: int, tile_mask: np.ndarray, base_idx=2):
    """يعبّئ قناعًا بلونين مع Dithering بنمط Bayer — تدرّج بكسلي نظيف."""
    H, W = img.shape[:2]
    bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0
    n = _noise(seeds, W, H, 3, 3.0)
    thr = bayer[np.arange(H)[:, None] % 4, np.arange(W)[None, :] % 4]
    hi = tile_mask & ((n > 0.5) & (thr < (n - 0.5) * 1.6)) | (tile_mask & (n > 0.72))
    lo = tile_mask & ~hi & (n < 0.35)
    for m, c in ((tile_mask, ramp[base_idx]), (hi, ramp[min(len(ramp) - 1, base_idx + 2)]),
                 (lo, ramp[max(0, base_idx - 2)])):
        c_rgb = np.array(pal.hex_to_rgb(c) if isinstance(c, str) else c, dtype=np.float32)
        img[m, :3] = c_rgb
        img[m, 3] = 255


def tile_block(theme: dict, kind: str, variant: int = 0) -> np.ndarray:
    """ينتج تايل 32×32.

    kinds: solid / top / platform / back / slope_r / slope_l / stairs / pillar / girder
    """
    img = np.zeros((TS, TS, 4), dtype=np.uint8)
    rng = np.random.default_rng(hash((kind, variant)) % 2 ** 31)
    base = pal.shade(theme["base"], 6, 0.22)
    top = pal.shade(theme["top"], 6, 0.24)
    accent = pal.shade(theme["accent"], 5, 0.2)
    full = np.ones((TS, TS), dtype=bool)

    if kind == "solid" or kind == "top":
        _dither_with(img, base, variant * 17 + 3, full, 2)
        # تفاصيل: شقوق/طوب/ألواح حسب المادة
        if theme["mat"] in ("concrete", "stone"):
            for r in range(0, TS, 8):
                y = r + (4 if (r // 8) % 2 else 0)
                m = np.zeros((TS, TS), dtype=bool)
                m[y:y + 1, :] = True
                img[m, :3] = pal.hex_to_rgb(base[0])
                m2 = np.zeros((TS, TS), dtype=bool)
                m2[y:y + 1, 0:TS:16] = True
                img[m2, :3] = pal.hex_to_rgb(base[1])
        elif theme["mat"] == "metal":
            for c in range(0, TS, 8):
                m = np.zeros((TS, TS), dtype=bool)
                m[:, c:c + 1] = True
                img[m, :3] = pal.hex_to_rgb(base[1])
            for r in range(2, TS, 8):
                m = np.zeros((TS, TS), dtype=bool)
                m[r:r + 1, :] = True
                img[m, :3] = pal.hex_to_rgb(base[3],) if False else pal.hex_to_rgb(base[3])
            # براغي في الزوايا
            for (yy, xx) in ((3, 3), (3, TS - 5), (TS - 5, 3), (TS - 5, TS - 5)):
                img[yy:yy + 2, xx:xx + 2, :3] = pal.hex_to_rgb(base[4])
        elif theme["mat"] == "wood":
            for r in range(0, TS, 6):
                m = np.zeros((TS, TS), dtype=bool)
                m[r:r + 1, :] = True
                img[m, :3] = pal.hex_to_rgb(base[0])
            for (yy, xx) in ((4, 6), (4, 24), (16, 4), (16, 28), (26, 14)):
                img[yy, xx, :3] = pal.hex_to_rgb(base[4])
        elif theme["mat"] == "sand":
            for k in range(6):
                yy, xx = int(rng.integers(2, TS - 2)), int(rng.integers(2, TS - 2))
                img[yy, xx, :3] = pal.hex_to_rgb(base[4] if k % 2 else base[0])
    if kind == "top":
        # سطح: طبقة أفتح أعلى التايل + نبات/رمل/ثلج حسب الثيم
        img[0:3, :, :3] = pal.hex_to_rgb(top[4])
        img[0:1, :, :3] = pal.hex_to_rgb(top[5])
        img[3:5, :, :3] = pal.hex_to_rgb(top[3])
        for x in range(0, TS, 1):
            if rng.random() < 0.35:
                hh = int(rng.integers(1, 3))
                img[5:5 + hh, x, :3] = pal.hex_to_rgb(top[2])
        if theme.get("grass"):
            for x in range(0, TS, 2):
                if rng.random() < 0.55:
                    h = int(rng.integers(2, 5))
                    img[TS - h:TS, x, :3] = pal.hex_to_rgb(top[4])
                    img[TS - h - 1, x, :3] = pal.hex_to_rgb(top[5])
    elif kind == "platform":
        img[:] = 0
        frame = pal.shade("mid_gray", 5, 0.2)
        m = np.ones((TS, TS), dtype=bool)
        _dither_with(img, frame, variant + 11, m, 1)
        # فتحات الشبكة المعدنية
        for y in range(3, TS - 3, 6):
            for x in range(3, TS - 3, 6):
                img[y:y + 3, x:x + 3, :3] = pal.hex_to_rgb("#0B0D10")
        img[0:2, :, :3] = pal.hex_to_rgb("light_gray")
        img[TS - 2:TS, :, :3] = pal.hex_to_rgb("#0B0D10")
    elif kind == "back":
        # طبقة خلفية (داكنة، بلا تفاصيل قوية) لخلق عمق
        dark = pal.shade(theme["back"], 5, 0.18)
        _dither_with(img, dark, variant * 23 + 7, full, 1)
        for k in range(4):
            y = int(rng.integers(3, TS - 3))
            x = int(rng.integers(3, TS - 8))
            img[y:y + 2, x:x + int(rng.integers(3, 7)), :3] = pal.hex_to_rgb(dark[3])
    elif kind in ("slope_r", "slope_l"):
        img[:] = 0
        _dither_with(img, base, variant + 5, full, 2)
        m = np.zeros((TS, TS), dtype=bool)
        for y in range(TS):
            x = y if kind == "slope_r" else TS - 1 - y
            m[y, x:] = True if kind == "slope_r" else False
            if kind == "slope_r":
                m[y, x:] = True
            else:
                m[y, :x + 1] = True
        img[~m] = 0
        for y in range(TS):
            xs = np.where(m[y])[0]
            if len(xs):
                img[y, xs[0]:xs[0] + 2] = (*pal.hex_to_rgb(top[4]), 255)
    elif kind == "stairs":
        img[:] = 0
        steps = 4
        sh = TS // steps
        for i in range(steps):
            y0 = i * sh
            x0 = i * sh
            m = np.zeros((TS, TS), dtype=bool)
            m[y0:y0 + sh, x0:] = True
            _dither_with(img, base, variant + i, m, 2)
            img[y0:y0 + 1, x0:, :3] = pal.hex_to_rgb(top[4])
    elif kind == "pillar":
        img[:] = 0
        m = np.zeros((TS, TS), dtype=bool)
        m[:, 8:24] = True
        _dither_with(img, base, variant + 2, m, 2)
        img[:, 8:10, :3] = pal.hex_to_rgb(base[4])
        img[:, 22:24, :3] = pal.hex_to_rgb(base[0])
        for y in range(0, TS, 10):
            img[y:y + 2, 8:24, :3] = pal.hex_to_rgb(base[1])
    elif kind == "girder":
        img[:] = 0
        m = np.zeros((TS, TS), dtype=bool)
        m[0:6, :] = True
        m[TS - 6:TS, :] = True
        m[:, 12:20] = True
        _dither_with(img, pal.shade("steel_blue", 5, 0.2), variant + 3, m, 2)
        for x in range(2, TS, 6):
            img[6:TS - 6, x:x + 2, :3] = pal.hex_to_rgb("shadow_gray")
    return img


THEMES = {
    "city": dict(mat="concrete", base="concrete", top="concrete_hi", back="night_blue",
                 accent="rust_light", name_ar="مدينة مدمرة"),
    "desert": dict(mat="sand", base="sand_dark", top="sand_light", back="brown_dark",
                   accent="earth", name_ar="قرية صحراوية", grass=False),
    "base": dict(mat="metal", base="mid_gray", top="steel_light", back="shadow_gray",
                 accent="hazard_yellow", name_ar="قاعدة عسكرية"),
    "forest": dict(mat="wood", base="olive_dark", top="olive_light", back="olive_deep",
                   accent="plant_hi", name_ar="غابة وميناء", grass=True),
    "village": dict(mat="stone", base="earth", top="sand_light", back="brown_dark",
                    accent="wood_light", name_ar="قرية طينية", grass=True),
}
TILE_KINDS = ["solid", "top", "platform", "back", "slope_r", "slope_l", "stairs", "pillar", "girder"]


def build_tileset(theme_key: str, variants: int = 3) -> dict:
    """يبني مجموعة تايلات لثيم واحد: {name: image}."""
    th = THEMES[theme_key]
    out = {}
    for kind in TILE_KINDS:
        for v in range(variants if kind in ("solid", "top", "back") else 1):
            out[f"{theme_key}/{kind}{'' if v == 0 else '_' + str(v)}"] = tile_block(th, kind, v)
    return out


# --------------------------------------------------------------- العناصر
def prop(kind: str, theme_key: str = "city", variant: int = 0, w: int = 34, h: int = 34) -> np.ndarray:
    """يرسم عنصرًا تفاعليًا/زينة (34×34 افتراضيًا، بعضها أعرض/أطول)."""
    c = D.Canvas(w, h, ss=D.SS)
    th = THEMES[theme_key]
    rng = np.random.default_rng(hash((kind, theme_key, variant)) % 2 ** 31)
    steel = pal.shade("mid_gray", 5, 0.2)
    wood = pal.shade("wood_light", 5, 0.2)
    metal = pal.shade("shadow_gray", 5, 0.2)
    sand = pal.shade("sand_light", 5, 0.18)
    olive = pal.shade("olive", 5, 0.2)

    if kind == "crate":
        c.rect(3, 6, w - 6, h - 10, wood[1])
        c.rect(3, 6, w - 6, h - 10, wood[0], 0.2)
        c.rect(4, 7, w - 8, h - 12, wood[2])
        for i in range(w - 8):
            c.rect(4 + i, 7 + i * (h - 12) / (w - 8), 1, 1, wood[0], 0.08)
        for k in range(3):
            c.rect(4, 9 + k * ((h - 14) / 3), w - 8, 1, wood[0], 0.55)
        c.rect(3, 6, w - 6, 2, wood[4], 0.7)
        for (yy, xx) in ((8, 5), (8, w - 8), (h - 7, 5), (h - 7, w - 8)):
            c.rect(xx, yy, 2, 2, steel[2])
    elif kind == "barrel":
        c.rect(8, 4, w - 16, h - 8, metal[2], radius=2)
        c.rect(9, 5, w - 18, h - 10, metal[3], 0.4)
        for k in range(2):
            c.rect(8, 10 + k * 10, w - 16, 2, metal[0], 0.7)
        if variant == 1:   # متفجر: أشرطة تحذير
            c.rect(8, 12, w - 16, 6, "hazard_yellow", 0.9)
            c.rect(10, 12, 3, 6, "#0B0D10", 0.85)
            c.rect(16, 12, 3, 6, "#0B0D10", 0.85)
            c.rect(22, 12, 3, 6, "#0B0D10", 0.85)
        elif variant == 2:  # ماء
            c.rect(8, 12, w - 16, 6, "water_hi", 0.8)
            c.rect(9, 13, w - 18, 3, "water_lo", 0.5)
        c.ellipse(8 + (w - 16) / 2, 4, (w - 16) / 2, 2.4, metal[3])
        c.ellipse(8 + (w - 16) / 2, 4, (w - 16) / 2 - 1.6, 1.5, metal[4], 0.6)
    elif kind == "sandbag":
        ys = [(h - 10, 0), (h - 10, 1), (h - 18, 0)]
        for i, (yy, off) in enumerate([(h - 11, 0), (h - 11, 1), (h - 19, 0)]):
            x = 2 + off * 9
            c.ellipse(x + 7, yy + 4, 8, 5, sand[2])
            c.ellipse(x + 8, yy + 3, 6, 3, sand[4], 0.6)
            c.ellipse(x + 6, yy + 6, 6, 2.4, sand[0], 0.35)
    elif kind == "tree":
        c.rect(w / 2 - 2, h * 0.45, 4, h * 0.5, pal.shade("brown_dark", 4, 0.15)[1])
        c.rect(w / 2 - 2, h * 0.45, 2, h * 0.5, pal.shade("brown_dark", 4, 0.15)[3], 0.6)
        for k in range(5):
            cx = w / 2 + math.cos(k * 1.3) * 6
            cy = h * 0.32 + math.sin(k * 1.7) * 4
            c.ellipse(cx, cy, 9 - k * 0.6, 7 - k * 0.5, olive[1 + (k % 2)])
        c.ellipse(w / 2 - 2, h * 0.24, 8, 6, olive[4], 0.55)
        c.ellipse(w / 2 + 3, h * 0.34, 6, 4, olive[0], 0.4)
    elif kind == "bush":
        for k in range(4):
            c.ellipse(w / 2 + (k - 1.5) * 4, h - 8 - (k % 2) * 2, 6, 5, olive[1 + (k % 3)])
        c.ellipse(w / 2 - 3, h - 12, 5, 3.4, olive[4], 0.5)
    elif kind == "rock":
        pts = [(4, h - 4), (6, h - 12), (12, h - 16), (20, h - 15), (26, h - 9), (28, h - 4)]
        c.poly(pts, pal.shade("concrete", 5, 0.18)[2])
        c.poly([(8, h - 6), (10, h - 12), (16, h - 15), (18, h - 12), (14, h - 6)], pal.shade("concrete", 5, 0.18)[4], 0.6)
    elif kind == "fence":
        c.rect(2, 4, 1.6, h - 6, steel[1])
        c.rect(w - 4, 4, 1.6, h - 6, steel[1])
        for y in range(6, h - 4, 4):
            c.rect(3, y, w - 6, 0.8, steel[2], 0.8)
        for x in range(4, w - 4, 4):
            c.line(x, 5, x + 4, h - 3, steel[3], 0.7, 0.8)
            c.line(x + 4, 5, x, h - 3, steel[3], 0.7, 0.8)
    elif kind == "ladder":
        c.rect(8, 2, 3, h - 4, steel[2])
        c.rect(w - 12, 2, 3, h - 4, steel[2])
        for y in range(4, h - 4, 5):
            c.rect(9, y, w - 20, 2, steel[3])
            c.rect(9, y, w - 20, 0.8, steel[4], 0.6)
    elif kind == "pipe":
        c.rect(0, h / 2 - 3, w, 7, steel[2])
        c.rect(0, h / 2 - 3, w, 2, steel[4], 0.7)
        c.rect(0, h / 2 + 2, w, 2, steel[0], 0.7)
        for x in range(4, w, 12):
            c.rect(x, h / 2 - 4, 3, 9, steel[1])
            c.rect(x, h / 2 - 4, 3, 2, steel[3], 0.6)
    elif kind == "lamp":
        c.rect(w / 2 - 2, 6, 4, h - 10, steel[1])
        c.rect(w / 2 - 6, 4, 12, 4, steel[2])
        c.ellipse(w / 2, 6, 5, 3, "blast_yellow", 0.85)
        c.ellipse(w / 2, 5, 3, 2, "white_glow", 0.9)
        c.rect(w / 2 - 6, 8, 12, 1.4, steel[0], 0.8)
    elif kind == "sign":
        c.rect(w / 2 - 1.6, 10, 3.2, h - 14, steel[1])
        c.rect(4, 4, w - 8, 10, pal.shade("red_light", 5, 0.2)[2])
        c.rect(5, 5, w - 10, 4, "white_glow", 0.85)
        c.rect(4, 4, w - 8, 1.4, pal.shade("red_light", 5, 0.2)[4], 0.8)
    elif kind == "generator":
        c.rect(3, 8, w - 6, h - 12, metal[2])
        c.rect(4, 9, w - 8, h - 14, metal[3], 0.4)
        for k in range(4):
            c.rect(6 + k * 5, 11, 3, h - 18, metal[0], 0.7)
        c.rect(6, 6, w - 12, 3, steel[2])
        c.rect(8, 26, 4, 3, "hazard_yellow", 0.8)
    elif kind == "door":
        c.rect(2, 2, w - 4, h - 4, steel[2])
        c.rect(3, 3, w - 6, h - 6, steel[3], 0.35)
        for y in range(5, h - 5, 6):
            c.rect(4, y, w - 8, 1, steel[0], 0.5)
        c.rect(w - 9, h / 2 - 2, 4, 4, "brass_yellow", 0.9)
        c.rect(w - 9, h / 2 - 2, 4, 1.4, "gold", 0.7)
    elif kind == "elevator":
        c.rect(2, 2, w - 4, h - 4, steel[1])
        c.rect(3, 3, (w - 6) / 2 - 0.5, h - 6, steel[3], 0.5)
        c.rect((w) / 2 + 0.5, 3, (w - 6) / 2 - 0.5, h - 6, steel[3], 0.5)
        c.rect(w / 2 - 0.6, 3, 1.2, h - 6, steel[0])
        for y in range(6, h - 6, 8):
            c.rect(6, y, w - 12, 1, steel[4], 0.35)
    elif kind == "water":
        c.rect(0, 4, w, h - 8, "water_hi", 0.75)
        for y in range(6, h - 6, 3):
            c.rect(2, y, w - 4, 0.8, "water_lo", 0.35)
        c.rect(0, 4, w, 1.4, "cyan_glow", 0.6)
    elif kind == "tire":
        c.ellipse(w / 2, h / 2, 11, 11, "#0B0D10")
        c.ellipse(w / 2, h / 2, 10, 10, metal[0])
        c.ellipse(w / 2, h / 2, 6, 6, metal[2])
        c.ellipse(w / 2, h / 2, 4, 4, metal[0], 0.6)
    elif kind == "tent":
        c.poly([(2, h - 3), (w / 2, 4), (w - 2, h - 3)], olive[2])
        c.poly([(w / 2, 4), (w / 2 + 4, h - 3), (w - 2, h - 3)], olive[1])
        c.poly([(6, h - 4), (w / 2, 7), (w / 2, h - 4)], olive[4], 0.35)
        c.rect(w / 2 - 1, 6, 2, h - 10, olive[0], 0.6)
    elif kind == "watchtower":
        for dx in (5, w - 8):
            c.rect(dx, 8, 3, h - 10, wood[1])
        c.rect(3, 4, w - 6, 6, wood[2])
        c.rect(3, 4, w - 6, 1.6, wood[4], 0.7)
        for y in range(12, h - 6, 7):
            c.line(6, y, w - 7, y + 4, wood[0], 0.8, 0.7)
            c.line(w - 7, y, 6, y + 4, wood[0], 0.8, 0.7)
    elif kind == "rubble":
        for k in range(9):
            x = float(rng.integers(2, w - 6))
            y = float(rng.integers(h - 14, h - 4))
            s = float(rng.integers(2, 5))
            c.rect(x, y, s, s, pal.shade("concrete", 5, 0.18)[int(rng.integers(1, 5))])
    elif kind == "ammo_box":
        c.rect(4, 10, w - 8, h - 14, olive[1], radius=1)
        c.rect(5, 11, w - 10, h - 16, olive[2])
        c.rect(6, 12, w - 12, 2, olive[4], 0.5)
        c.rect(w / 2 - 5, 8, 10, 3, olive[0])
        c.rect(7, 18, w - 14, 1.4, "#0B0D10", 0.5)
    elif kind == "medkit":
        c.rect(6, 10, w - 12, h - 16, "white_glow", radius=1)
        c.rect(7, 11, w - 14, h - 18, "white_glow", 0.6)
        c.rect(w / 2 - 4, 16, 8, 3, "red_light")
        c.rect(w / 2 - 1.5, 13, 3, 9, "red_light")
        c.rect(12, 8, w - 24, 2.4, "mid_gray")
    elif kind == "glass":
        c.rect(1, 1, w - 2, h - 2, "glass_hi", 0.35)
        c.rect(1, 1, w - 2, 1.4, "white_glow", 0.6)
        c.rect(1, 1, 1.4, h - 2, "white_glow", 0.5)
        for k in range(3):
            c.line(4 + k * 8, 3, 3 + k * 8, h - 3, "white_glow", 0.8, 0.25)
    elif kind == "airstrike_beacon":
        c.rect(w / 2 - 1.6, 10, 3.2, h - 12, steel[1])
        c.rect(w / 2 - 5, 6, 10, 6, "red_light", 0.9)
        c.rect(w / 2 - 3, 7, 6, 3, "white_glow", 0.8)
    elif kind == "drone_pad":
        c.ellipse(w / 2, h / 2, 14, 6, steel[2], 0.8)
        c.ellipse(w / 2, h / 2, 11, 4, steel[3], 0.5)
        c.rect(w / 2 - 2, h / 2 - 8, 4, 16, "accent_teal", 0.55)
    elif kind == "flag":
        c.rect(5, 4, 2, h - 6, steel[1])
        c.poly([(7, 5), (w - 4, 9), (7, 15)], pal.shade("team_red", 5, 0.2)[2])
        c.poly([(7, 5), (w - 6, 8), (7, 11)], pal.shade("team_red", 5, 0.2)[4], 0.55)
    else:
        c.rect(4, 4, w - 8, h - 8, steel[2])
    c.global_light(steel, light_dir=(-0.7, -0.7), amount=0.3)
    img = c.downsample("area")
    img = D.quantize(img, _qcol())
    return D.outline(img, "#0B0D10")


PROPS = ["crate", "barrel", "sandbag", "tree", "bush", "rock", "fence", "ladder", "pipe", "lamp",
         "sign", "generator", "door", "elevator", "water", "tire", "tent", "watchtower", "rubble",
         "ammo_box", "medkit", "glass", "airstrike_beacon", "drone_pad", "flag"]


def build_props() -> dict:
    out = {}
    for k in PROPS:
        for v in range(3 if k in ("barrel", "crate", "rock") else 1):
            out[f"{k}{'' if v == 0 else '_' + str(v)}"] = prop(k, variant=v,
                                                              w=34 if k != "watchtower" else 38,
                                                              h=34 if k != "watchtower" else 46)
    return out


# --------------------------------------------------------------- VFX
def vfx_sequence(kind: str, frames: int, size: int = 48) -> list[np.ndarray]:
    """يبني شريحة مؤثر (قائمة إطارات) إجرائيًا — بلا صور جاهزة."""
    out = []
    for f in range(frames):
        t = f / max(1, frames - 1)
        c = D.Canvas(size, size, ss=D.SS)
        cx = cy = size / 2
        if kind == "explosion":
            r = 3 + t * size * 0.42
            c.ellipse(cx, cy, r, r * 0.92, "fire_orange", 0.85 if t < 0.9 else 0.5)
            c.ellipse(cx, cy, r * 0.78, r * 0.72, "flame_yellow", 0.9)
            c.ellipse(cx, cy, r * 0.5, r * 0.46, "blast_yellow", 0.95 if t < 0.5 else 0.6)
            if t > 0.25:
                c.ellipse(cx, cy, r * 1.25, r * 1.1, "smoke_gray", 0.45 * t)
            if t > 0.05:
                c.ellipse(cx, cy, r * 1.05, r, "blast_yellow", 0.28 * (1 - t))
            for k in range(6):
                a = k * 1.05 + t * 2
                rr = r * (1.1 + 0.5 * t)
                c.ellipse(cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.7, 1.8 + t * 1.6, 1.6 + t * 1.4, "smoke_gray", 0.5 * (1 - t))
        elif kind == "muzzle":
            r = 8 + t * 12
            c.ellipse(cx - 2, cy, r, r * 0.42, "blast_yellow", 0.95 - t * 0.4)
            c.ellipse(cx - 4, cy, r * 0.6, r * 0.3, "white_glow", 0.95 - t * 0.5)
            c.poly([(cx + 2, cy - 3), (cx + r * 0.9, cy), (cx + 2, cy + 3)], "flame_yellow", 0.8 - t * 0.5)
            for k in range(3):
                a = (k - 1) * 0.5
                c.poly([(cx, cy), (cx + r * 0.7, cy + a * r * 0.5 - 2), (cx + r * 0.5, cy + a * r * 0.6 + 2)],
                       "fire_orange", 0.55 - t * 0.35)
        elif kind == "blood":
            for k in range(7):
                a = k * 0.9 + 0.3
                rr = 3 + t * 9 * (0.5 + (k % 3) * 0.3)
                c.ellipse(cx + math.cos(a) * rr, cy + math.sin(a) * rr, 2.2 - t, 2.2 - t, "blood_red", 0.9 - t * 0.5)
                c.ellipse(cx + math.cos(a) * rr, cy + math.sin(a) * rr, 1.1, 1.1, "red_bright", 0.7 - t * 0.4)
        elif kind == "dust":
            for k in range(8):
                a = k * 0.8
                rr = 2 + t * 12
                c.ellipse(cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.6, 3 + t * 2.4, 2.4 + t * 2, "sand_light", 0.55 * (1 - t))
                c.ellipse(cx + math.cos(a) * rr * 0.7, cy + math.sin(a) * rr * 0.5, 2, 1.6, "sand_dark", 0.35 * (1 - t))
        elif kind == "smoke":
            for k in range(6):
                a = k * 1.1 + t * 0.8
                rr = 4 + t * 10
                c.ellipse(cx + math.cos(a) * rr, cy - t * 12 + math.sin(a) * rr * 0.5,
                          5 + t * 3, 4.4 + t * 2.6, "smoke_gray", 0.5 * (1 - t * 0.7))
                c.ellipse(cx + math.cos(a) * rr, cy - t * 11, 3.4, 3, "smoke_cyan", 0.35 * (1 - t))
        elif kind == "spark":
            for k in range(9):
                a = k * 0.7 + 0.4
                rr = 2 + t * 15
                c.rect(cx + math.cos(a) * rr, cy + math.sin(a) * rr, 1.6, 1.6, "brass_yellow", 0.95 - t * 0.7)
                c.rect(cx + math.cos(a) * rr * 0.8, cy + math.sin(a) * rr * 0.8, 1.0, 1.0, "white_glow", 0.8 - t * 0.6)
        elif kind == "water_splash":
            for k in range(8):
                a = -math.pi * (0.15 + 0.7 * k / 7)
                rr = 3 + t * 12
                c.ellipse(cx + math.cos(a) * rr, cy + math.sin(a) * rr, 1.8, 2.4, "water_hi", 0.85 - t * 0.5)
                c.ellipse(cx + math.cos(a) * rr * 0.6, cy + math.sin(a) * rr * 0.6, 1.2, 1.6, "cyan_glow", 0.6 - t * 0.4)
            c.ellipse(cx, cy + 2, 6 + t * 8, 2 + t * 2.4, "water_lo", 0.5 * (1 - t))
        elif kind == "debris":
            for k in range(8):
                a = k * 0.9
                rr = 2 + t * 13
                s = 3 - t * 1.4
                c.rect(cx + math.cos(a) * rr, cy + math.sin(a) * rr, s, s, pal.shade("concrete", 5, 0.18)[(k % 4) + 1],
                       0.9 - t * 0.4)
        elif kind == "jet":
            c.ellipse(cx, cy + 4 - t * 3, 4.4 - t * 1.4, 7 - t * 2.4, "fire_orange", 0.85 - t * 0.4)
            c.ellipse(cx, cy + 3 - t * 2, 3.0 - t, 5 - t * 1.6, "flame_yellow", 0.95 - t * 0.5)
            c.ellipse(cx, cy + 2, 1.8 - t * 0.6, 3 - t, "blast_yellow", 0.95 - t * 0.6)
            c.ellipse(cx, cy + 6, 5 + t * 2, 3 + t, "smoke_cyan", 0.3 * (1 - t))
        elif kind == "fire":
            w = 5 + math.sin(t * math.pi * 2) * 1.4
            c.ellipse(cx, cy + 4 - t * 2, w, 8 + t * 3, "fire_orange", 0.9 - t * 0.3)
            c.ellipse(cx, cy + 5, w * 0.65, 6 + t * 2, "flame_yellow", 0.95 - t * 0.35)
            c.ellipse(cx, cy + 6, w * 0.34, 4 + t, "blast_yellow", 0.95 - t * 0.4)
        elif kind == "flashbang":
            r = t * size * 0.7
            c.ellipse(cx, cy, r, r, "white_glow", 0.95 * (1 - t) ** 0.6)
            if t > 0.2:
                c.ellipse(cx, cy, r * 1.2, r * 1.2, "white_glow", 0.35 * (1 - t))
        elif kind == "hitmarker":
            r = 5 + t * 3
            for a in (0.785, 2.356, 3.927, 5.498):
                c.line(cx + math.cos(a) * r, cy + math.sin(a) * r,
                       cx + math.cos(a) * (r + 4), cy + math.sin(a) * (r + 4), "white_glow", 1.6, 1.0 - t)
        img = c.downsample("area")
        img = D.quantize(img, _qcol())
        out.append(img)
    return out


VFX_SETS = {"explosion": 8, "muzzle": 3, "blood": 5, "dust": 5, "smoke": 8, "spark": 5,
            "water_splash": 6, "debris": 5, "jet": 5, "fire": 6, "flashbang": 6, "hitmarker": 4}


def build_vfx() -> dict:
    out = {}
    for k, n in VFX_SETS.items():
        out[k] = vfx_sequence(k, n, 48 if k != "hitmarker" else 32)
    return out


_QC = None


def _qcol():
    global _QC
    if _QC is None:
        cols = [pal.hex_to_rgb(pal.ALL[n]) for n in pal.NAMES]
        for n in ("concrete", "sand_light", "mid_gray", "wood_light", "olive", "steel_blue",
                  "rust_light", "fire_orange", "blood_red", "water_hi", "smoke_gray", "earth"):
            cols.extend(pal.shade(n, 5, 0.18))
        _QC = np.array(cols, dtype=np.float32)
    return _QC
