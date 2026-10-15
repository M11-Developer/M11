#!/usr/bin/env python3
"""يولّد أصول التطبيق **بأيادي الكود** (بلا أي نموذج صور):

    project/assets/atlases/app_icon.png      512×512   أيقونة التطبيق (مضاعف ×4)
    project/assets/atlases/app_icon_bg.png  1024×576   خلفية القوائم / لوحة الأيقونة
    project/assets/atlases/app_loading.png   640×360   شاشة التحميل (Boot splash)
    web/assets/{app_icon,app_icon_bg,app_loading}.png  نسخ الويب

القواعد المطبّقة من دفتر المشروع (القسم 3):
  • لوحة ألوان واحدة فقط (71 لونًا) — كل الألوان من `m11lib.palette`.
  • بلا تنعيم: رسم فائق (×4) ثم اختزال بالمنطقة → بكسل نظيف، والتكبير للعرض
    يكون بعدد صحيح فقط (Nearest).
  • قناع Dithering بشبكة Bayer 4×4 في كل التدرّجات (السماء والأفق).
  • حد خارجي #0B0D10 في الأيقونة، وظلال/إضاءات منقولة الصبغة (Hue Shift).
  • بلا أي نص داخل الصورة — العربية تُرسم متجهة داخل المحرك.

التشغيل:  python3 tools/gen_app_art.py
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from m11lib import char_anims as CA  # noqa: E402
from m11lib import char_rig as CR  # noqa: E402
from m11lib import draw as D  # noqa: E402
from m11lib import palette as pal  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATLAS_DIR = os.path.join(ROOT, "project", "assets", "atlases")
WEB_DIR = os.path.join(ROOT, "web", "assets")
OUTLINE = "#0B0D10"


def _qcol() -> np.ndarray:
    return np.array([pal.hex_to_rgb(pal.ALL[n]) for n in pal.NAMES], dtype=np.int16)


def _save(img: np.ndarray, path: str, up: int = 1) -> dict:
    pil = Image.fromarray(img.astype(np.uint8), "RGBA" if img.shape[2] == 4 else "RGB")
    if up > 1:
        pil = pil.resize((pil.width * up, pil.height * up), Image.NEAREST)  # تكبير بعدد صحيح
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pil.save(path, "PNG", optimize=True)
    return {"path": os.path.relpath(path, ROOT), "size": [pil.width, pil.height],
            "kb": round(os.path.getsize(path) / 1024, 1)}


def _blit(dst: np.ndarray, src: np.ndarray, ox: int, oy: int) -> None:
    """لصق RGBA فوق RGBA (دمج ألفا صحيح، بلا أي تنعيم)."""
    H, W = dst.shape[:2]
    ys = slice(max(0, oy), min(H, oy + src.shape[0]))
    xs = slice(max(0, ox), min(W, ox + src.shape[1]))
    sub = src[ys.start - oy:ys.stop - oy, xs.start - ox:xs.stop - ox]
    if sub.size == 0:
        return
    a = sub[..., 3:4].astype(np.float32) / 255.0
    base = dst[ys, xs].astype(np.float32)
    base[..., :3] = a * sub[..., :3] + (1.0 - a) * base[..., :3]
    base[..., 3] = np.maximum(base[..., 3], sub[..., 3])
    dst[ys, xs] = base.astype(np.uint8)


# ============================================================================
# 1) أيقونة التطبيق
# ============================================================================
def make_icon(logical: int = 128, unit: int = 4) -> np.ndarray:
    """درع دائري ذهبي بمقاتل جيت باك — مقروء حتى في مقاس 48 بكسل."""
    w = logical
    c = D.Canvas(w, w, ss=D.SS)
    cx = cy = w / 2.0
    navy = pal.shade("night_blue", 9, 0.20)
    gold = pal.shade("gold", 8, 0.14)
    inner = w * 0.428

    # الحلقة: حد أسود → ذهبي داكن → ذهبي → لمعة علوية
    c.ellipse(cx, cy, w * 0.500, w * 0.500, OUTLINE)
    c.ellipse(cx, cy, w * 0.482, w * 0.482, gold[1])
    c.ellipse(cx, cy, w * 0.468, w * 0.468, gold[4])
    ring = c.shape_mask("ellipse", cx, cy - w * 0.015, w * 0.474, w * 0.474)
    prev = c.clip(ring & (np.arange(c.H)[:, None] < int(c.H * 0.36)))
    c.ellipse(cx, cy - w * 0.015, w * 0.474, w * 0.474, gold[7])
    c.unclip(prev)

    # القرص الداخلي بتدرّج دائري (4 حلقات)
    c.ellipse(cx, cy, inner, inner, navy[0])
    c.ellipse(cx, cy, inner - 2, inner - 2, navy[2])
    c.ellipse(cx, cy, inner - 5, inner - 5, navy[3])
    c.ellipse(cx, cy + w * 0.04, inner - 8, inner - 8, navy[4], 0.5)

    disc = c.shape_mask("ellipse", cx, cy, inner - 1, inner - 1)
    prev = c.clip(disc)
    # توهّج دائري ناعم في المنتصف (بلا بقع)
    c.ellipse(cx, cy - w * 0.04, w * 0.34, w * 0.32, navy[5], 0.22)
    c.ellipse(cx, cy - w * 0.04, w * 0.22, w * 0.20, navy[6], 0.20)
    # أفق/أرضية أسفل القرص
    c.ellipse(cx, cy + w * 0.34, inner * 1.05, w * 0.16, navy[0], 0.65)
    c.rect(0, cy + w * 0.335, w, w, navy[0], 0.85)
    # ظلّ المقاتل
    c.ellipse(cx, cy + w * 0.325, w * 0.24, w * 0.03, OUTLINE, 0.75)
    # ضوء حافة سماوي أسفل اليسار (Light Rim)
    c.ellipse(cx - w * 0.10, cy + w * 0.16, inner - 6, inner - 6, "cyan_glow", 0.05)
    # ثلاث شرارات صغيرة
    for sx, sy, r in ((w * 0.20, w * 0.30, 1.2), (w * 0.80, w * 0.26, 1.0), (w * 0.74, w * 0.44, 0.8)):
        c.ellipse(sx, sy, r, r, "flame_yellow", 0.9)
    c.unclip(prev)

    bg = D.quantize(c.downsample("area"), _qcol())

    # المقاتل: نفس الهيكل المستخدم في اللعبة (اتساق تام مع السبرايتات)
    op = CR.OPERATORS[0]
    n, fn, _ = CA.ANIMS["jetpack"]
    pose = fn(2, n).copy(lean=5, sh_f=-36, el_f=-26, sh_b=-26, el_b=-22)
    soldier = CR.make_operator_sprite(op, pose, size=(76, 62), scale=1.05)
    _blit(bg, soldier, int(bg.shape[1] * 0.5) - soldier.shape[1] // 2,
          int(bg.shape[0] * 0.735) - soldier.shape[0])

    if unit > 1:
        bg = np.kron(bg, np.ones((unit, unit, 1), dtype=np.uint8))
    return bg


# ============================================================================
# 2) لوحة المنظر (Key Art) — تُستخدم خلفية للقوائم وشاشة التحميل
# ============================================================================
def _sky_ramp() -> list[np.ndarray]:
    """تدرّج سماء واحد متّصل (ليل → بنفسجي → أحمر → برتقالي) من اللوحة نفسها."""
    ramp: list[np.ndarray] = []
    for name, steps, spread in (("night_blue", 6, 0.40), ("purple_dark", 4, 0.30),
                                ("blood_red", 4, 0.22), ("fire_orange", 6, 0.30),
                                ("flame_yellow", 3, 0.22)):
        cols = pal.shade(name, steps, spread)
        seq = list(cols)
        if name in ("night_blue", "purple_dark"):
            seq = seq[::-1]                      # الغامق عند القمة
        ramp.extend(seq)
    return ramp


def make_key_art(w: int, h: int, subject: bool = True, skyline: bool = True) -> np.ndarray:
    """غروب صحراوي: سماء مرقّشة، شمس، أفق مدينة، جرف أمامي، ومقاتل يحلّق.

    الترتيب من الخلف للأمام = مبدأ طبقات الـParallax الخمس في اللعبة.
    """
    c = D.Canvas(w, h, ss=D.SS)
    rng = np.random.default_rng(11)
    horizon = h * 0.58
    ramp = _sky_ramp()
    n = len(ramp)

    # --- 1) السماء: تدرّج حقيقي + رقش Bayer بين كل لونين متجاورين ---
    for y in range(int(horizon) + 1):
        t = y / max(1.0, horizon)
        idx = t * (n - 1)
        i0 = int(idx)
        frac = idx - i0
        c.rect(0, y, w, 1, ramp[min(i0, n - 1)])
        if frac > 0.02:
            m = c.dither_mask(0, y, w, 1, ratio=frac, phase=y)
            c.fill_shape(m, ramp[min(i0 + 1, n - 1)], 1.0)

    # --- 2) نجوم باهتة (تختفي قرب الأفق) ---
    for _ in range(int(w * 0.07)):
        sx = rng.uniform(0, w)
        sy = rng.uniform(0, horizon * 0.42)
        a = float(rng.uniform(0.25, 0.85)) * (1.0 - sy / (horizon * 0.5))
        c.rect(int(sx), int(sy), 1, 1, "white_glow", a)

    # --- 3) سحب مسطّحة أفقية بحدّ مضيء من جهة الشمس ---
    for i in range(7):
        cy = horizon * (0.06 + i * 0.070) + float(rng.uniform(-1.0, 1.0))
        cw = w * float(rng.uniform(0.20, 0.55))
        cx0 = float(rng.uniform(-cw * 0.25, w - cw * 0.6))
        ch = 1.2 + i * 0.18
        c.ellipse(cx0 + cw * 0.5, cy, cw * 0.5, ch, ramp[int(n * 0.62)], 0.30)
        c.ellipse(cx0 + cw * 0.5, cy - ch * 0.55, cw * 0.42, ch * 0.45,
                  pal.shade("sand_light", 5, 0.2)[4], 0.35)

    # --- 4) الشمس وقرصها المتوهّج ---
    sunx, suny = w * 0.70, horizon * 0.72
    c.ellipse(sunx, suny, w * 0.105, w * 0.105, pal.shade("fire_orange", 6, 0.3)[5], 0.22)
    c.ellipse(sunx, suny, w * 0.078, w * 0.078, pal.shade("fire_orange", 6, 0.3)[5], 0.42)
    c.ellipse(sunx, suny, w * 0.050, w * 0.050, "flame_yellow", 0.95)
    c.ellipse(sunx, suny, w * 0.034, w * 0.034, "white_glow", 1.0)

    # --- 5) أفق مدينة بعيدة (ظلّ أزرق داكن + نوافذ مضاءة) ---
    if skyline:
        base = horizon + 1
        bx = -4.0
        while bx < w + 4:
            bw = float(rng.integers(5, 13))
            bh = float(rng.integers(4, max(5, int(h * 0.13))))
            dark = pal.shade("night_blue", 4, 0.2)[0]
            c.rect(bx, base - bh, bw, bh + 3, dark)
            c.rect(bx, base - bh, bw, 1, pal.shade("steel_blue", 5, 0.2)[2], 0.7)
            for wy in range(int(base - bh) + 2, int(base), 3):
                for wx in range(int(bx) + 1, int(bx + bw) - 1, 2):
                    if rng.random() < 0.20:
                        c.rect(wx, wy, 1, 1, "flame_yellow", 0.7)
            bx += bw + float(rng.integers(1, 5))

    # --- 6) كثبان متوسطة (طبقتان) ---
    def ridge(pts_y, col, cov=1.0):
        pts = [(0, h)] + [(w * fx, fy) for fx, fy in pts_y] + [(w, h)]
        c.poly(pts, col, cov)

    ridge([(0.0, horizon + 2), (0.18, horizon - h * 0.030), (0.40, horizon + h * 0.004),
           (0.62, horizon - h * 0.040), (0.84, horizon + h * 0.006), (1.0, horizon - h * 0.014)],
          pal.shade("sand_deep", 5, 0.18)[1])
    ridge([(0.0, horizon + h * 0.055), (0.24, horizon + h * 0.020), (0.52, horizon + h * 0.052),
           (0.76, horizon + h * 0.018), (1.0, horizon + h * 0.048)],
          pal.shade("sand_dark", 5, 0.18)[1])
    # خط ضوء على قمم الكثبان (من جهة الشمس)
    c.line(0, horizon - h * 0.014, w, horizon - h * 0.030, "sand_light", 0.8, 0.28)

    # --- 7) الجرف الأمامي: شبه أسود بحدّ مضيء (Foreground) ---
    ledge = [(0, h), (0, h * 0.795), (0.09, h * 0.778), (0.18, h * 0.800),
             (0.27, h * 0.856), (0.38, h * 0.884), (0.52, h * 0.858),
             (0.66, h * 0.906), (0.79, h * 0.872), (0.91, h * 0.930), (1.0, h * 0.898), (1.0, h)]
    c.poly([(w * fx, fy) for fx, fy in ledge], pal.shade("earth", 4, 0.12)[0])
    c.line(w * 0.0, h * 0.795, w * 1.0, h * 0.898, pal.shade("fire_orange", 5, 0.25)[4], 0.9, 0.55)

    # --- 8) نخيل/هوائيات على حافة الجرف (ظلال داكنة) ---
    for tx, ty, sc in ((0.145, 0.790, 1.00), (0.585, 0.870, 0.85), (0.925, 0.925, 0.70)):
        px, py = w * tx, h * ty
        col = pal.shade("earth", 4, 0.12)[0]
        c.rect(px, py - 9 * sc, 1.4 * sc, 10 * sc, col)
        for a in (-2.35, -1.85, -1.35, -0.75):
            c.line(px + 0.7, py - 9 * sc, px + float(np.cos(a)) * 5.0 * sc,
                   py - 9 * sc + float(np.sin(a)) * 4.4 * sc, col, max(1.0, 1.4 * sc))
        c.ellipse(px + 0.7, py - 10.2 * sc, 3.6 * sc, 1.4 * sc, col)

    # --- 9) المقاتل: موضوع اللوحة (يرسم بعد كل شيء) ---
    out = D.quantize(c.downsample("area"), _qcol())
    if subject:
        op = CR.OPERATORS[1]
        anim, fn, _ = CA.ANIMS["jetpack"]
        pose = fn(3, anim).copy(lean=7, sh_f=-42, el_f=-30, sh_b=-30, el_b=-26)
        if w >= 600:
            soldier = CR.make_operator_sprite(op, pose, size=(190, 148), scale=2.0)
            _blit(out, soldier, int(w * 0.20), int(h * 0.09))
        else:
            soldier = CR.make_operator_sprite(op, pose, size=(150, 118), scale=1.6)
            _blit(out, soldier, int(w * 0.24), int(h * 0.10))

    # إطار خارجي 1 بكسل بلون الحد الموحّد
    oc = pal.hex_to_rgb(OUTLINE)
    out[0, :, :3] = out[-1, :, :3] = oc
    out[:, 0, :3] = out[:, -1, :3] = oc
    return out


def main() -> int:
    made: dict = {}

    # 1) الأيقونة: 128 بكسل منطقيًا ×4 = 512×512
    icon = make_icon(128, 4)
    made["app_icon"] = _save(icon, os.path.join(ATLAS_DIR, "app_icon.png"))
    _save(icon, os.path.join(WEB_DIR, "app_icon.png"))

    # 2) خلفية القوائم: 512×288 منطقيًا ×2 = 1024×576
    bg = make_key_art(512, 288, subject=True)
    made["app_icon_bg"] = _save(bg, os.path.join(ATLAS_DIR, "app_icon_bg.png"), up=2)
    _save(bg, os.path.join(WEB_DIR, "app_icon_bg.png"), up=2)

    # 3) شاشة التحميل: 640×360 منطقيًا (نفس دقة اللعبة الداخلية، بلا تكبير)
    splash = make_key_art(640, 360, subject=True, skyline=True)
    made["app_loading"] = _save(splash, os.path.join(ATLAS_DIR, "app_loading.png"))
    _save(splash, os.path.join(WEB_DIR, "app_loading.png"))

    with open(os.path.join(ATLAS_DIR, "app_art.json"), "w", encoding="utf-8") as f:
        json.dump(made, f, ensure_ascii=False, indent=1)

    print("✓ أصول التطبيق:")
    for k, v in made.items():
        print(f"   {k}: {v['size'][0]}×{v['size'][1]} — {v['kb']} KB → {v['path']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
