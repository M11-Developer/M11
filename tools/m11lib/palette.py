"""اللوحة اللونية الرئيسية للمشروع (Master Palette).

قاعدة المشروع: **كل** أصل بصري يستمد ألوانه من هذه اللوحة (48-64 لونًا) لضمان
تناسق بصري كامل بين الشخصيات والأسلحة والخرائط والواجهة.

تعمل اللوحة على نمط "العائلات اللونية" (Ramps): لكل عائلة 3-5 درجات من الأغمق
إلى الأفتح، وهذا ما يسمح بتنفيذ **Hue-Shifting** (الظل يزرقّ والضوء يصفّر) بدل
إضافة الأسود والأبيض.
"""
from __future__ import annotations

import numpy as np

# --- الملحق (أ) من دفتر المشروع + توسعة إلى 64 لونًا ---
BASE = {
    "black": "#0B0D10",          # أسود الخطوط (الحدود الخارجية)
    "shadow_gray": "#1B2028",    # أعمق الظلال
    "dark_slate": "#242B36",
    "mid_gray": "#3A4453",       # معدن/أسلحة
    "light_gray": "#6B7A8F",     # معدن مضاء
    "steel_light": "#93A3B8",
    "white_glow": "#EAF2FF",     # أعلى إضاءة
    "white_pure": "#FFFFFF",
    "night_blue": "#10182B",     # سماء الليل/ظل بارد
    "blue_shadow": "#1D2C46",
    "steel_blue": "#2E5A88",
    "blue_bright": "#4A90D9",
    "cyan_glow": "#7FD2F5",
    "sand_light": "#D9B26A",
    "sand_dark": "#A8823C",
    "sand_deep": "#7A5C25",
    "earth": "#6E4B23",
    "brown_dark": "#3E2A17",
    "wood_light": "#8A5F33",
    "wood_dark": "#5A3C1F",
    "olive_light": "#7FA05A",
    "olive": "#4E6B3A",
    "olive_dark": "#2F4426",
    "olive_deep": "#1F2E19",
    "blood_red": "#8E2B2B",
    "red_light": "#C1443B",
    "red_bright": "#E4534E",
    "fire_orange": "#E8734A",
    "flame_yellow": "#F2A65A",
    "blast_yellow": "#FFD98A",
    "brass_yellow": "#F5D76E",
    "poison_purple": "#6B4C8A",
    "purple_dark": "#3C2A52",
    "smoke_cyan": "#9BB8C4",
    "smoke_gray": "#7E8A97",
    "accent_teal": "#4FD1C5",
    "gold": "#F2C14E",
    "gold_dark": "#B4872A",
    "skin_light": "#E8B08A",
    "skin_medium": "#C98A62",
    "skin_dark": "#8A5A3B",
    "skin_deep": "#5C3A24",
}

# توسعة: خطوط إضافية تحتاجها التفاصيل الدقيقة (زجاج، حديد مصدأ، نبات، ماء)
EXTENDED = {
    "glass_hi": "#BFE9F5",
    "glass_lo": "#2B4A5E",
    "rust_light": "#B4602F",
    "rust_dark": "#7A3B1C",
    "concrete_hi": "#9AA0A6",
    "concrete": "#767C82",
    "concrete_lo": "#4C5259",
    "plant_hi": "#A8C46B",
    "plant_lo": "#38542C",
    "water_hi": "#5FA8C9",
    "water_lo": "#1E4E६6".replace("६", "6"),
    "hazard_yellow": "#E8C547",
    "hazard_black": "#22262B",
    "neon_pink": "#E85D9B",
    "neon_green": "#8BE85D",
    "team_blue": "#3D7DD8",
    "team_red": "#D8563D",
    "team_green": "#4FB06A",
    "team_yellow": "#D8C13D",
    "team_purple": "#9B5DE8",
    "team_orange": "#E88A3D",
    "team_white": "#DCE3EC",
    "team_black": "#2A3038",
    # رتب/طبقات (للجوائز والرتب العسكرية)
    "bronze": "#A9743C", "silver": "#B9C2CC", "platinum": "#8FD4E8",
    "diamond": "#7CC6F2", "legendary": "#F2A65A", "mythic": "#E85D9B",
}

ALL = {**BASE, **EXTENDED}

# المعرّف الرقمي لكل لون (يُستخدم داخل الأدوات وحفظه في ملفات JSON)
NAMES = list(ALL.keys())
INDEX = {n: i for i, n in enumerate(NAMES)}


def hex_to_rgb(h):
    """يقبل لونًا بصيغة #RRGGBB أو اسمًا من أسماء اللوحة أو ثلاثية RGB جاهزة."""
    if isinstance(h, (tuple, list, np.ndarray)):
        return (int(h[0]) & 255, int(h[1]) & 255, int(h[2]) & 255)
    if not h.startswith("#"):
        return hex_to_rgb(ALL[h])
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(c) -> str:
    return "#%02X%02X%02X" % (int(c[0]) & 255, int(c[1]) & 255, int(c[2]) & 255)


def table() -> np.ndarray:
    """مصفوفة (N,3) لكل ألوان اللوحة."""
    return np.array([hex_to_rgb(ALL[n]) for n in NAMES], dtype=np.float32)


def alpha_table() -> np.ndarray:
    """اتجاه إضاءة تقديري لكل لون (يُستخدم في الترتيب/Ramp)."""
    t = table()
    return (0.299 * t[:, 0] + 0.587 * t[:, 1] + 0.114 * t[:, 2])


def _srgb_to_linear(c: np.ndarray) -> np.ndarray:
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * (c ** (1 / 2.4)) - 0.055) * 255.0


def hue_shift(rgb, d_hue: float, d_sat: float = 0.0, d_val: float = 0.0):
    """إزاحة درجة اللون/التشبّع/الإضاءة في فضاء HSV.

    القاعدة الفنية: الظلال تُزاح نحو الأزرق/البنفسجي والضوء نحو الأصفر،
    بدل خلط الأسود والأبيض (يمنع "الوحل" اللوني).
    """
    import colorsys
    r, g, b = [v / 255.0 for v in rgb]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    h = (h + d_hue) % 1.0
    s = min(1.0, max(0.0, s + d_sat))
    v = min(1.0, max(0.0, v + d_val))
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return (round(r * 255), round(g * 255), round(b * 255))


def shade(name: str, steps: int = 4, spread: float = 0.10):
    """يبني خط تدرّج (Ramp) من لون اللوحة: أغمق → أفتح مع Hue-Shift.

    مثال: shade("olive") → [داكن مزرق، داكن، أساس، فاتح مصفر، أفتح]
    """
    base = hex_to_rgb(ALL[name])
    out = []
    for i in range(steps):
        t = i / max(1, steps - 1)          # 0 = أغمق ... 1 = أفتح
        d_v = (t - 0.5) * spread * 2.0
        d_s = (0.5 - abs(t - 0.5)) * 0.10 - 0.05
        d_h = (-0.012 if t < 0.5 else 0.020)   # الظل أزرق، الضوء أصفر
        out.append(hue_shift(base, d_h, d_s, d_v))
    return out


def build_full_ramp() -> np.ndarray:
    """يبني جدول الألوان الكامل المستخدم في التكميم (لون أساس + درجاته)."""
    cols = [hex_to_rgb(ALL[n]) for n in NAMES]
    for n in ("olive", "sand_light", "mid_gray", "steel_blue", "earth", "blood_red",
              "fire_orange", "skin_medium", "concrete", "water_hi", "poison_purple",
              "brass_yellow", "rust_light"):
        cols.extend(shade(n, 5, 0.16))
    return np.array(cols, dtype=np.float32)


__all__ = ["ALL", "BASE", "EXTENDED", "NAMES", "INDEX", "hex_to_rgb", "rgb_to_hex",
           "table", "shade", "hue_shift", "build_full_ramp", "_srgb_to_linear",
           "_linear_to_srgb"]
