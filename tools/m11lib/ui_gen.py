"""مولّد واجهة اللاعب (UI Kit) والأيقونات — كل شيء بالكود وبـ SVG/9-Slice.

وفق القسم 16: لا نستهلك صورًا مولّدة للأزرار والإطارات والأيقونات البسيطة:
  * إطارات 9-Slice (لوحة/زر/حقل) تُرسم مرة واحدة صغيرة وتُمدّ في المحرك.
  * أيقونات الأسلحة/العتاد/الإعدادات/الرتب تُرسم كبكسل آرت مضمّن.
  * أيقونة التطبيق + صور المعاينة.
"""
from __future__ import annotations

import math

import numpy as np

from . import draw as D
from . import palette as pal

PANEL = pal.shade("shadow_gray", 6, 0.16)
ACCENT = pal.shade("brass_yellow", 5, 0.2)
DANGER = pal.shade("red_light", 5, 0.2)
HEALTH = pal.shade("team_green", 5, 0.22)
ARMOR = pal.shade("steel_blue", 5, 0.22)


def panel_9slice(w=24, h=24, fill="panel", accent=True, radius=2) -> np.ndarray:
    """إطار 9-Slice: حواف 8 بكسل قابلة للتمدّد في المحرك بلا تشويه."""
    c = D.Canvas(w, h, ss=D.SS)
    f = PANEL if fill == "panel" else pal.shade("night_blue", 6, 0.16)
    c.rect(0, 0, w, h, f[1], radius=radius)
    c.rect(1, 1, w - 2, h - 2, f[2], 0.85)
    c.rect(1, 1, w - 2, 2, f[3], 0.5)
    c.rect(0, 0, w, 1, f[0])
    c.rect(0, h - 1, w, 1, f[0])
    c.rect(0, 0, 1, h, f[0])
    c.rect(w - 1, 0, 1, h, f[0])
    if accent:
        c.rect(1, 0, w - 2, 1, ACCENT[3], 0.7)
    img = c.downsample("area")
    img = D.quantize(img, _qcol())
    return img


def button(w=26, h=12, state="normal", kind="primary") -> np.ndarray:
    c = D.Canvas(w, h, ss=D.SS)
    base = {"primary": ARMOR, "danger": DANGER, "neutral": PANEL, "gold": ACCENT}[kind]
    if state == "disabled":
        base = [pal.hue_shift(v, 0, -0.5, 0) for v in base]
    c.rect(0, 0, w, h, base[1], radius=1.4)
    c.rect(1, 1, w - 2, h - 2, base[2], 0.9)
    c.rect(1, 1, w - 2, (h - 2) * 0.5, base[3], 0.5)
    if state == "pressed":
        c.rect(0, 0, w, h, "black", 0.35)
        c.rect(1, 1, w - 2, 1, base[0], 0.6)
    else:
        c.rect(1, 1, w - 2, 1, base[4], 0.8)
        c.rect(0, h - 1, w, 1, base[0], 0.8)
    if state == "hover":
        c.rect(0, 0, w, 1, "white_glow", 0.35)
    img = c.downsample("area")
    return D.quantize(img, _qcol())


def icon(kind: str, size=16) -> np.ndarray:
    """أيقونات بكسل آرت 16×16: أسلحة، عتاد، إعدادات، حالات."""
    c = D.Canvas(size, size, ss=D.SS)
    s = size / 16.0
    steel = pal.shade("mid_gray", 5, 0.2)
    olive = pal.shade("olive", 5, 0.2)
    gold = pal.shade("brass_yellow", 5, 0.2)
    red = pal.shade("red_light", 5, 0.2)
    blue = pal.shade("steel_blue", 5, 0.2)

    def sc(v):
        return v * s

    if kind == "rifle":
        c.rect(sc(1), sc(7), sc(14), sc(2), steel[2])
        c.rect(sc(1), sc(7), sc(14), sc(1), steel[4], 0.8)
        c.rect(sc(3), sc(9), sc(2), sc(3), steel[1])
        c.rect(sc(9), sc(9), sc(2), sc(3), steel[1])
    elif kind == "smg":
        c.rect(sc(2), sc(7), sc(12), sc(2), steel[2])
        c.rect(sc(4), sc(9), sc(2), sc(3), steel[1])
        c.rect(sc(7), sc(9), sc(2), sc(4), steel[1])
    elif kind == "sniper":
        c.rect(sc(0), sc(8), sc(16), sc(1.6), steel[2])
        c.rect(sc(4), sc(5), sc(6), sc(2), steel[1])
        c.rect(sc(5), sc(9), sc(2), sc(3), steel[1])
        c.rect(sc(10), sc(9), sc(2), sc(3), steel[1])
    elif kind == "shotgun":
        c.rect(sc(0), sc(7), sc(16), sc(2.4), steel[2])
        c.rect(sc(2), sc(9), sc(4), sc(3), pal.shade("wood_light", 4, 0.2)[1])
        c.rect(sc(8), sc(9), sc(3), sc(3), steel[1])
    elif kind == "pistol":
        c.rect(sc(4), sc(6), sc(8), sc(2.4), steel[2])
        c.rect(sc(5), sc(8), sc(3), sc(5), steel[1])
    elif kind == "lmg":
        c.rect(sc(1), sc(7), sc(14), sc(2.6), steel[1])
        c.ellipse(sc(7), sc(12), sc(3.4), sc(3), steel[1])
        c.rect(sc(3), sc(9), sc(2), sc(3), steel[2])
    elif kind == "melee":
        c.poly([(sc(2), sc(11)), (sc(11), sc(4)), (sc(13), sc(6)), (sc(4), sc(13))], steel[4])
        c.rect(sc(1), sc(11), sc(4), sc(3), pal.shade("brown_dark", 3, 0.1)[2])
    elif kind == "grenade":
        c.ellipse(sc(8), sc(9), sc(4), sc(4.6), olive[1])
        c.ellipse(sc(7), sc(8), sc(2.6), sc(3), olive[3], 0.7)
        c.rect(sc(7), sc(4), sc(2), sc(2), steel[2])
        c.rect(sc(9), sc(3), sc(3), sc(1.4), steel[3])
    elif kind == "armor":
        c.poly([(sc(8), sc(2)), (sc(13), sc(4)), (sc(13), sc(9)), (sc(8), sc(14)), (sc(3), sc(9)), (sc(3), sc(4))], blue[2])
        c.poly([(sc(8), sc(4)), (sc(11), sc(5)), (sc(11), sc(8)), (sc(8), sc(11.5))], blue[4], 0.7)
    elif kind == "helmet":
        c.ellipse(sc(8), sc(9), sc(6), sc(5.6), olive[1])
        c.ellipse(sc(8), sc(8), sc(4.6), sc(4), olive[3], 0.8)
        c.rect(sc(2), sc(9.5), sc(12), sc(1.6), olive[0])
    elif kind == "backpack":
        c.rect(sc(3), sc(4), sc(10), sc(10), olive[1], radius=sc(1.6))
        c.rect(sc(4), sc(5), sc(8), sc(8), olive[2], 0.7)
        c.rect(sc(5), sc(8), sc(6), sc(1.4), olive[0], 0.8)
        c.rect(sc(6), sc(2), sc(4), sc(2), olive[0])
    elif kind == "medkit":
        c.rect(sc(2), sc(4), sc(12), sc(10), "white_glow", radius=sc(1))
        c.rect(sc(7), sc(5), sc(2), sc(8), red[3])
        c.rect(sc(4), sc(8), sc(8), sc(2), red[3])
    elif kind == "ammo":
        c.rect(sc(3), sc(6), sc(10), sc(8), olive[1], radius=sc(1))
        c.rect(sc(4), sc(7), sc(8), sc(2), olive[3], 0.7)
        c.rect(sc(5), sc(10), sc(2), sc(3), gold[3])
        c.rect(sc(8), sc(10), sc(2), sc(3), gold[3])
    elif kind == "jetpack":
        c.rect(sc(3), sc(4), sc(4), sc(9), steel[1], radius=sc(1))
        c.rect(sc(8), sc(4), sc(4), sc(9), steel[1], radius=sc(1))
        c.rect(sc(3), sc(5), sc(4), sc(2), steel[3], 0.7)
        c.rect(sc(8), sc(5), sc(4), sc(2), steel[3], 0.7)
        c.poly([(sc(4), sc(13)), (sc(6), sc(13)), (sc(5), sc(15.5))], "fire_orange", 0.9)
        c.poly([(sc(9), sc(13)), (sc(11), sc(13)), (sc(10), sc(15.5))], "fire_orange", 0.9)
    elif kind == "map":
        c.rect(sc(1), sc(2), sc(14), sc(12), pal.shade("sand_dark", 5, 0.2)[2])
        c.poly([(sc(2), sc(10)), (sc(6), sc(6)), (sc(9), sc(9)), (sc(13), sc(4)), (sc(14), sc(12)), (sc(2), sc(12))], olive[2])
        c.rect(sc(11), sc(3), sc(2), sc(2), "red_light")
    elif kind == "settings":
        c.ellipse(sc(8), sc(8), sc(6), sc(6), steel[1])
        c.ellipse(sc(8), sc(8), sc(3), sc(3), steel[3])
        for k in range(8):
            a = k * math.pi / 4
            c.rect(sc(8) + math.cos(a) * sc(6) - sc(1), sc(8) + math.sin(a) * sc(6) - sc(1), sc(2), sc(2), steel[0])
    elif kind == "team":
        c.ellipse(sc(8), sc(7), sc(3.4), sc(3.4), pal.hex_to_rgb(pal.ALL["skin_medium"]))
        c.ellipse(sc(8), sc(13), sc(5.4), sc(4), olive[2])
    elif kind == "enemy":
        c.ellipse(sc(8), sc(7), sc(3.4), sc(3.4), pal.hex_to_rgb(pal.ALL["skin_medium"]))
        c.ellipse(sc(8), sc(13), sc(5.4), sc(4), pal.shade("team_red", 5, 0.2)[2])
    elif kind == "ping":
        c.ellipse(sc(8), sc(8), sc(5.6), sc(5.6), ACCENT[3], 0.85)
        c.ellipse(sc(8), sc(8), sc(3.4), sc(3.4), ACCENT[4])
        c.rect(sc(7.4), sc(7.4), sc(1.2), sc(1.2), "black")
    elif kind == "warning":
        c.poly([(sc(8), sc(2)), (sc(15), sc(14)), (sc(1), sc(14))], "hazard_yellow")
        c.rect(sc(7.2), sc(6), sc(1.8), sc(5), "#0B0D10")
        c.rect(sc(7.2), sc(12), sc(1.8), sc(1.6), "#0B0D10")
    elif kind == "skull":
        c.ellipse(sc(8), sc(7), sc(5), sc(5), pal.shade("white_glow", 4, 0.2)[2])
        c.ellipse(sc(5.6), sc(6.4), sc(1.6), sc(1.8), "#0B0D10")
        c.ellipse(sc(10.4), sc(6.4), sc(1.6), sc(1.8), "#0B0D10")
        c.rect(sc(6), sc(11), sc(4), sc(3), pal.shade("white_glow", 4, 0.2)[1])
        c.rect(sc(7), sc(11.4), sc(0.6), sc(2), "#0B0D10")
        c.rect(sc(8.6), sc(11.4), sc(0.6), sc(2), "#0B0D10")
    elif kind == "flag":
        c.rect(sc(3), sc(2), sc(1.8), sc(12), steel[1])
        c.poly([(sc(5), sc(3)), (sc(14), sc(5.5)), (sc(5), sc(8))], red[2])
    elif kind == "crown":
        c.poly([(sc(2), sc(12)), (sc(3), sc(5)), (sc(6), sc(9)), (sc(8), sc(3)), (sc(10), sc(9)), (sc(13), sc(5)), (sc(14), sc(12))], gold[3])
        c.rect(sc(2), sc(12), sc(12), sc(2), gold[1])
    elif kind == "star":
        pts = []
        for k in range(10):
            a = -math.pi / 2 + k * math.pi / 5
            r = 6.6 if k % 2 == 0 else 3.0
            pts.append((sc(8 + math.cos(a) * r), sc(8 + math.sin(a) * r)))
        c.poly(pts, gold[3])
    else:
        c.rect(sc(3), sc(3), sc(10), sc(10), steel[2])

    img = c.downsample("area")
    img = D.quantize(img, _qcol())
    return D.outline(img, "#0B0D10")


def rank_badge(index: int, size=20) -> np.ndarray:
    """شارة رتبة عسكرية مولّدة إجرائيًا (نجوم/أشرطة/الوان تتغير بالرتبة)."""
    c = D.Canvas(size, size, ss=D.SS)
    tiers = ["bronze", "steel_blue", "light_gray", "gold", "accent_teal", "neon_pink"]
    cols = pal.shade(tiers[min(index, len(tiers) - 1)], 5, 0.22)
    s = size / 20.0
    c.poly([(6 * s, 17 * s), (6 * s, 6 * s), (10 * s, 3 * s), (14 * s, 6 * s), (14 * s, 17 * s)], cols[1])
    c.poly([(7 * s, 16 * s), (7 * s, 7 * s), (10 * s, 5 * s), (13 * s, 7 * s), (13 * s, 16 * s)], cols[2], 0.8)
    c.rect(6 * s, 16 * s, 8 * s, 2 * s, cols[0])
    stars = min(5, 1 + index // 2)
    for k in range(stars):
        x = (10 - (stars - 1) * 1.8 + k * 3.6) * s
        c.rect(x, 9 * s, 1.6 * s, 1.6 * s, "gold")
        c.rect(x - 0.8 * s, 10 * s, 3.2 * s, 1.0 * s, "gold_dark")
    for k in range(min(4, index % 4 + 1)):
        c.rect((8 + k * 0.8) * s, (13 - k * 1.4) * s, 4 * s, 0.9 * s, cols[4], 0.8)
    img = c.downsample("area")
    return D.outline(D.quantize(img, _qcol()), "#0B0D10")


def achievement_icon(kind: str, size=20) -> np.ndarray:
    return icon(kind, size)


def crosshair(style: int = 0, size=16) -> np.ndarray:
    """4 أنماط تصويب مختلفة (نقطة/صليب/دائرة/دائرة منقطة)."""
    c = D.Canvas(size, size, ss=D.SS)
    m = size // 2
    col = "white_glow"
    if style == 0:
        c.rect(m - 0.5, m - 4, 1, 3, col)
        c.rect(m - 0.5, m + 2, 1, 3, col)
        c.rect(m - 4, m - 0.5, 3, 1, col)
        c.rect(m + 2, m - 0.5, 3, 1, col)
        c.rect(m - 0.5, m - 0.5, 1, 1, "red_light")
    elif style == 1:
        c.ellipse(m, m, 5, 5, col, 0.9)
        c.ellipse(m, m, 4, 4, "black", 0.9)
        c.rect(m - 0.5, m - 0.5, 1, 1, col)
    elif style == 2:
        c.rect(m - 0.5, m - 6, 1, 4, col)
        c.rect(m - 0.5, m + 3, 1, 4, col)
        c.rect(m - 6, m - 0.5, 4, 1, col)
        c.rect(m + 3, m - 0.5, 4, 1, col)
        c.rect(m - 1, m - 1, 2, 2, col, 0.5)
    else:
        for k in range(8):
            a = k * math.pi / 4
            c.ellipse(m + math.cos(a) * 5, m + math.sin(a) * 5, 1.1, 1.1, col, 0.95)
    return c.downsample("area")


def app_icon(size: int = 512) -> np.ndarray:
    """أيقونة التطبيق: جندي بجيت باك على خلفية دائرية داكنة (تُبنى إجرائيًا عالية الدقة)."""
    # نرسم بمقياس العنصر (1 وحدة = 16 بكسل في العالم)، ثم نكبّر بعامل صحيح
    from . import char_rig as CR
    from . import char_anims as CA
    op = CR.OPERATORS[0]
    n, fn, _ = CA.ANIMS["jetpack"]
    pose = fn(2, n).copy(lean=8, sh_f=-40, el_f=-30, sh_b=-30, el_b=-26)
    soldier = CR.make_operator_sprite(op, pose, size=(96, 78))
    soldier = soldier[:, :, :]
    # خلفية دائرية
    unit = 4
    world = size // unit          # 128 وحدة
    c = D.Canvas(world, world, ss=D.SS)
    cx = cy = world / 2
    navy = pal.shade("night_blue", 6, 0.2)
    # هالة خارجية
    c.ellipse(cx, cy, world * 0.5 - 1, world * 0.5 - 1, navy[0])
    c.ellipse(cx, cy, world * 0.47, world * 0.47, navy[2])
    c.ellipse(cx, cy, world * 0.44, world * 0.44, navy[1])
    # إشعاع خلفي (Sunburst) بتفاصيل بكسلية
    for k in range(16):
        a = k * math.pi / 8
        c.poly([(cx, cy), (cx + math.cos(a) * world * 0.5, cy + math.sin(a) * world * 0.5),
                (cx + math.cos(a + 0.12) * world * 0.5, cy + math.sin(a + 0.12) * world * 0.5)], navy[3], 0.35)
    c.ellipse(cx, cy - world * 0.02, world * 0.30, world * 0.30, navy[4], 0.35)
    # خطوط أفقية (خلفية تقنية)
    for k in range(5, world - 5, 4):
        c.rect(4, k, world - 8, 0.5, "cyan_glow", 0.06)
    img = c.downsample("area")
    bg = D.quantize(img, _qcol())
    # لصق الجندي في المنتصف (مقياس صحيح: 1 بكسل عالم × 4)
    big = np.kron(soldier, np.ones((unit, unit, 1), dtype=np.uint8))
    H, W = bg.shape[:2]
    oy = int(H * 0.5) - big.shape[0] // 2 + int(H * 0.06)
    ox = int(W * 0.5) - big.shape[1] // 2
    # دمج بالشفافية داخل دائرة الأيقونة
    ys = slice(max(0, oy), min(H, oy + big.shape[0]))
    xs = slice(max(0, ox), min(W, ox + big.shape[1]))
    sub = big[ys.start - oy:ys.stop - oy, xs.start - ox:xs.stop - ox]
    a = sub[..., 3:4].astype(np.float32) / 255.0
    region = bg[ys, xs]
    region[..., :3] = (region[..., :3] * (1 - a) + sub[..., :3] * a).astype(np.uint8)
    region[..., 3] = 255
    bg[ys, xs] = region
    # حلقة خارجية ذهبية
    ring = np.zeros((H, W), dtype=bool)
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    ring = (d > world * 0.47) & (d < world * 0.5)
    bg[ring] = (*pal.hex_to_rgb(pal.ALL["gold"]), 255)
    bg[~((d < world * 0.5))] = 0
    return bg


def loading_art(w=320, h=180) -> np.ndarray:
    """شاشة تحميل/بوستر: أفق مدينة وقت الغسق مع طبقات عمق + دخان (مولّدة بالكود)."""
    c = D.Canvas(w, h, ss=D.SS)
    sky = pal.shade("fire_orange", 8, 0.4)
    navy = pal.shade("night_blue", 8, 0.3)
    # سماء بتدرّج Dithering (من البرتقالي عند الأفق إلى الأزرق الليلي فوق)
    for i in range(h):
        t = i / h
        if t < 0.45:
            col = sky[int(t / 0.45 * 3)]
        else:
            col = navy[int((t - 0.45) / 0.55 * 7)]
        c.rect(0, i, w, 1, col)
        if 0.2 < t < 0.75:
            m = c.dither_mask(0, i, w, 1, ratio=0.35 + 0.3 * math.sin(t * 12), phase=i)
            c.fill_shape(m, sky[4] if t < 0.5 else navy[2], 0.5)
    # شمس غاربة + هالة
    c.ellipse(w * 0.72, h * 0.52, 16, 16, "blast_yellow", 0.85)
    c.ellipse(w * 0.72, h * 0.52, 9, 9, "white_glow", 0.9)
    c.ellipse(w * 0.72, h * 0.52, 26, 24, "fire_orange", 0.22)
    # سحاب طبقي
    for k in range(9):
        x = (k * 47 + 11) % w
        y = 20 + (k * 13) % int(h * 0.42)
        c.ellipse(x, y, 22 + (k % 3) * 8, 4 + (k % 2) * 2, "smoke_gray", 0.22)
    # أفق مدينة (طبقات ثلاثة لعمق)
    def skyline(y_base, col, seed, amp=18, step=9):
        rng = np.random.default_rng(seed)
        for x in range(0, w, step):
            hh = int(rng.integers(6, amp))
            c.rect(x, y_base - hh, step - 1, hh, col)
            if rng.random() < 0.6:
                for k in range(2):
                    if rng.random() < 0.5:
                        c.rect(x + 1 + k * 3, y_base - hh + 3, 1.6, 2, "blast_yellow", 0.5)
    skyline(int(h * 0.62), navy[1], 7, 26)
    skyline(int(h * 0.74), navy[0], 12, 34)
    skyline(int(h * 0.88), "#0B0D10", 21, 26)
    # دخان وأعمدة نار
    for k in range(4):
        x = 40 + k * 70
        c.ellipse(x, h * 0.66, 26 + k * 5, 24, "smoke_gray", 0.18)
        c.ellipse(x, h * 0.72, 16, 12, "fire_orange", 0.14)
    # أرضية
    c.rect(0, h - 14, w, 14, pal.shade("brown_dark", 6, 0.2)[1])
    for x in range(0, w, 6):
        c.rect(x + (x % 3), h - 12, 3, 2, pal.shade("brown_dark", 6, 0.2)[3], 0.4)
    img = c.downsample("area")
    return D.quantize(img, _qcol())


def minimap_frame(size=64) -> np.ndarray:
    c = D.Canvas(size, size, ss=D.SS)
    c.ellipse(size / 2, size / 2, size / 2 - 1.4, size / 2 - 1.4, PANEL[1])
    c.ellipse(size / 2, size / 2, size / 2 - 2.4, size / 2 - 2.4, "night_blue", 0.5)
    for k in range(16):
        a = k * math.pi / 8
        x0 = size / 2 + math.cos(a) * (size / 2 - 1)
        y0 = size / 2 + math.sin(a) * (size / 2 - 1)
        c.rect(x0 - 0.6, y0 - 0.6, 1.2, 1.2, ACCENT[3])
    c.rect(size / 2 - 0.8, 1.6, 1.6, 3.4, "white_glow")   # مؤشر الشمال
    img = c.downsample("area")
    return D.quantize(img, _qcol())


_QC = None


def _qcol():
    global _QC
    if _QC is None:
        cols = [pal.hex_to_rgb(pal.ALL[n]) for n in pal.NAMES]
        for n in ("shadow_gray", "mid_gray", "steel_blue", "brass_yellow", "gold",
                  "red_light", "team_green", "team_red", "team_blue", "olive",
                  "night_blue", "fire_orange", "smoke_gray", "accent_teal", "sand_dark"):
            cols.extend(pal.shade(n, 6, 0.22))
        _QC = np.array(cols, dtype=np.float32)
    return _QC


UI_ICONS = ["rifle", "smg", "sniper", "shotgun", "pistol", "lmg", "melee", "grenade",
            "armor", "helmet", "backpack", "medkit", "ammo", "jetpack", "map", "settings",
            "team", "enemy", "ping", "warning", "skull", "flag", "crown", "star"]


def build_ui() -> dict:
    """يبني كل عناصر الواجهة في قاموس واحد."""
    out = {}
    out["panel"] = panel_9slice(24, 24)
    out["panel_deep"] = panel_9slice(24, 24, fill="deep")
    out["panel_flat"] = panel_9slice(24, 24, accent=False)
    for kind in ("primary", "danger", "neutral", "gold"):
        for state in ("normal", "pressed", "hover", "disabled"):
            out[f"btn_{kind}_{state}"] = button(26, 12, state, kind)
    for k in UI_ICONS:
        out[f"icon_{k}"] = icon(k)
    for i in range(8):
        out[f"rank_{i}"] = rank_badge(i)
    for s in range(4):
        out[f"crosshair_{s}"] = crosshair(s)
    out["minimap_frame"] = minimap_frame(64)
    return out
