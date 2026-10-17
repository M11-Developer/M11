"""مولّد الأسلحة — 27 سلاحًا إجرائيًا بمقياس موحّد ولوحة ألوان المشروع.

كل سلاح يُبنى من مواصفة رقمية (Spec) ثم يُرسم بالبرامترات:
    النظام: ماسورة، ماسورة فرعية، مخزن (مستقيم/منحني/أسطواني)، أخمص،
            مقبض، منظار (معدني/نقطة حمراء/تلسكوبي)، قضيب rails، أرجل ثنائية.
الألوان: خشب/بوليمر/معدن مسحوب — مع تظليل وتفاصيل (فتحات تبريد، مثبّت الخرطوش).

النتيجة: أطالس PNG + JSON بنفس مقياس الشخصيات (1 وحدة = 16 بكسل) وبقواعد
القسم 3: رسم فائق ×4، تكميم على اللوحة، حد خارجي 1 بكسل.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field

import numpy as np

from . import draw as D
from . import palette as pal

# ------------------------------------------------------------------ الأنماط
BODY = {
    "steel": ("mid_gray", "steel_light"),
    "dark": ("shadow_gray", "mid_gray"),
    "wood": ("brown_dark", "wood_light"),
    "polymer": ("olive_deep", "olive"),
    "desert": ("sand_dark", "sand_light"),
    "gold": ("gold_dark", "gold"),
    "energy": ("purple_dark", "neon_pink"),
}


@dataclass
class WeaponSpec:
    """مواصفة رسم السلاح (كل الأطوال بالبكسل النهائي، السلاح يتجه لليمين)."""
    key: str
    name_ar: str
    cls: str                       # pistol/smg/ar/sr/shotgun/lmg/energy/launcher/melee
    length: int = 52               # الطول الكلي التقريبي
    body: str = "steel"
    barrel: float = 0.42           # نسبة الماسورة من الطول
    barrel_thick: float = 3.0
    stock: str = "solid"           # none/folding/solid/skeleton
    mag: str = "box"               # none/box/curved/drum/stick/energy
    grip: str = "pistol"           # pistol/rifle/vertical
    scope: str = "iron"            # iron/dot/scope2/scope4/scope8/laser
    handguard: str = "rails"       # rails/wood/solid/none
    muzzle: str = "plain"          # plain/brake/suppressor/flash
    bipod: bool = False
    extra: dict = field(default_factory=dict)


SPECS: list[WeaponSpec] = [
    # --- مسدسات ---
    WeaponSpec("n9", "نصل 9", "pistol", 26, "steel", 0.5, 2.4, "none", "box", "pistol", "iron", "none", "plain"),
    WeaponSpec("scorpion", "عقرب", "pistol", 30, "dark", 0.52, 2.6, "none", "stick", "pistol", "dot", "none", "brake", extra=dict(auto=True)),
    WeaponSpec("handcannon", "مدفع اليد", "pistol", 32, "wood", 0.55, 3.4, "none", "box", "pistol", "iron", "none", "brake", extra=dict(heavy=True)),
    # --- رشاشات خفيفة ---
    WeaponSpec("zarqa", "زرقة", "smg", 44, "polymer", 0.36, 2.8, "folding", "box", "pistol", "dot", "rails", "plain"),
    WeaponSpec("harrasa", "هرّاسة", "smg", 40, "dark", 0.34, 2.8, "none", "box", "pistol", "iron", "solid", "plain"),
    WeaponSpec("timsah", "تمساح", "smg", 50, "dark", 0.40, 2.6, "folding", "curved", "pistol", "dot", "rails", "suppressor"),
    # --- بنادق هجومية ---
    WeaponSpec("jabha", "جبهة", "ar", 62, "wood", 0.44, 3.0, "solid", "curved", "rifle", "iron", "wood", "brake"),
    WeaponSpec("fahd", "فهد", "ar", 60, "dark", 0.46, 3.0, "skeleton", "box", "rifle", "dot", "rails", "flash"),
    WeaponSpec("saqr", "صقر", "ar", 58, "desert", 0.44, 3.0, "none", "box", "rifle", "scope4", "rails", "brake", extra=dict(bullpup=True)),
    WeaponSpec("raad", "رعد", "ar", 66, "steel", 0.42, 3.6, "solid", "drum", "rifle", "scope2", "rails", "brake", bipod=True, extra=dict(heavy=True)),
    # --- قنص ---
    WeaponSpec("shaheen", "شاهين", "sr", 72, "wood", 0.56, 2.6, "solid", "box", "rifle", "scope8", "wood", "brake", bipod=True),
    WeaponSpec("uqab", "عقاب", "sr", 66, "dark", 0.52, 2.8, "skeleton", "box", "rifle", "scope4", "rails", "flash"),
    WeaponSpec("thuban", "ثعبان", "sr", 78, "steel", 0.58, 4.0, "solid", "box", "rifle", "scope8", "rails", "brake", bipod=True, extra=dict(heavy=True)),
    # --- شوزن ---
    WeaponSpec("mitraqa", "مطرقة", "shotgun", 58, "wood", 0.52, 3.6, "solid", "none", "rifle", "iron", "wood", "plain", extra=dict(pump=True)),
    WeaponSpec("muzdawija", "مزدوجة", "shotgun", 50, "wood", 0.56, 4.0, "none", "none", "pistol", "iron", "wood", "plain", extra=dict(double=True)),
    WeaponSpec("ali", "آلي الرش", "shotgun", 60, "dark", 0.50, 3.8, "solid", "drum", "rifle", "dot", "rails", "brake", extra=dict(auto=True)),
    # --- رشاشات ثقيلة ---
    WeaponSpec("minjal", "منجل", "lmg", 70, "dark", 0.50, 3.6, "solid", "drum", "rifle", "scope2", "rails", "flash", bipod=True),
    WeaponSpec("jarrar", "جرّار", "lmg", 76, "steel", 0.52, 4.4, "solid", "drum", "rifle", "iron", "rails", "brake", bipod=True, extra=dict(heavy=True)),
    # --- طاقة / استثنائية ---
    WeaponSpec("shuaa", "شعاع", "energy", 58, "energy", 0.44, 3.2, "skeleton", "energy", "rifle", "dot", "rails", "plain", extra=dict(glow=True)),
    WeaponSpec("najm", "نجم البلازما", "energy", 62, "energy", 0.48, 4.0, "solid", "energy", "rifle", "scope2", "rails", "plain", extra=dict(glow=True)),
    WeaponSpec("burkan", "بركان", "launcher", 54, "dark", 0.40, 6.0, "solid", "none", "rifle", "iron", "solid", "plain", extra=dict(thumper=True)),
    WeaponSpec("zilzal", "زلزال", "launcher", 74, "olive", 0.60, 6.4, "none", "none", "rifle", "scope2", "solid", "plain", extra=dict(rocket=True)),
    # --- إشارة / مشاجرة ---
    WeaponSpec("shama", "شمعة إشارة", "pistol", 28, "red", 0.52, 5.0, "none", "none", "pistol", "iron", "none", "plain", extra=dict(flare=True)),
    WeaponSpec("shafra", "شفرة", "melee", 26, "steel", 0.62, 2.0, "none", "none", "none", "none", "none", "plain", extra=dict(knife=True)),
    WeaponSpec("fas", "فأس", "melee", 34, "wood", 0.5, 3.0, "none", "none", "none", "none", "none", "plain", extra=dict(axe=True)),
    WeaponSpec("minjal_melee", "منجل قتال", "melee", 32, "steel", 0.6, 2.4, "none", "none", "none", "none", "none", "plain", extra=dict(sickle=True)),
    WeaponSpec("hirrawa", "هراوة", "melee", 36, "dark", 0.7, 3.4, "none", "none", "none", "none", "none", "plain", extra=dict(baton=True)),
    WeaponSpec("qadifa", "قاذفة شظايا", "launcher", 46, "dark", 0.44, 4.4, "folding", "box", "rifle", "iron", "rails", "plain", extra=dict(grenade=True)),
]

SPEC_BY_KEY = {w.key: w for w in SPECS}

# إضافات/ملحقات تُرسم فوق السلاح (Attachments)
ATTACH_SLOTS = {
    "sight": ("iron", "dot", "scope2", "scope4", "scope8"),
    "muzzle": ("plain", "brake", "suppressor", "flash"),
    "grip": ("none", "vertical", "angled"),
    "mag": ("std", "extended", "drum"),
    "laser": (False, True),
}


def _ramp(body_key: str, steps=5):
    """خط تدرّج لوني لهيكل السلاح."""
    if body_key in BODY:
        base, hi = BODY[body_key]
        ramp = pal.shade(base, steps, 0.22)
        ramp[-1] = pal.hex_to_rgb(pal.ALL[hi])
        ramp[-2] = ((ramp[-2][0] + ramp[-1][0]) // 2, (ramp[-2][1] + ramp[-1][1]) // 2, (ramp[-2][2] + ramp[-1][2]) // 2)
        return ramp
    return pal.shade("mid_gray", steps, 0.2)


W, H = 84, 34   # مقاس إطار السلاح (يسمح بأطول سلاح + الملحقات)
# معامل تصغير السلاح داخل الإطار: الشخصية 61 بكسل طولًا، والسلاح يجب أن يتراوح
# 40–70 بكسل (القسم 3). الرسم الأصلي يملأ الإطار، لذا نرسم بـ SCALE < 1.
SCALE = 0.66


class _ScaledCanvas:
    """غلاف يحجّم كل إحداثيات الرسم بمقدار ثابت (يبقى الرسم الفائق 4× سليمًا)."""

    def __init__(self, canvas, k):
        self._c = canvas
        self._k = k

    def rect(self, x, y, w, h, color, coverage=1.0, radius=0, **kw):
        k = self._k
        return self._c.rect(x * k, y * k, w * k, h * k, color, coverage, radius * k, **kw)

    def ellipse(self, cx, cy, rx, ry, color, coverage=1.0):
        k = self._k
        return self._c.ellipse(cx * k, cy * k, rx * k, ry * k, color, coverage)

    def poly(self, pts, color, coverage=1.0):
        k = self._k
        return self._c.poly([(x * k, y * k) for (x, y) in pts], color, coverage)

    def line(self, x0, y0, x1, y1, color, width=1.0, coverage=1.0):
        k = self._k
        return self._c.line(x0 * k, y0 * k, x1 * k, y1 * k, color, max(1.0, width * k), coverage)

    # تمرير أي دالة أخرى إلى الكانفس الأصلي (light/outline/clip/...)
    def __getattr__(self, name):
        return getattr(self._c, name)


def weapon_anchors(spec: WeaponSpec) -> dict:
    """نقاط الارتساء الحقيقية داخل إطار السلاح (بالإحداثيات النهائية).

    grip   = موضع القبضة (حيث تلتقي اليد بالمقبض) — تُرسم به الأسلحة في اللعبة.
    muzzle = فوهة الماسورة — تُرسم عندها وميض الطلق والطلقات.
    """
    L = min(spec.length, W - 16)
    x0 = 6
    x1 = x0 + L
    cy = 17 if spec.cls == "pistol" else 18
    barrel_x = x1 - L * spec.barrel
    gx = barrel_x - (8.0 if spec.cls == "pistol" else 10.0)
    return {
        "grip": [round((gx + 3.0) * SCALE, 2), round((cy + 4.2) * SCALE, 2)],
        "muzzle": [round((x1 + 2.0) * SCALE, 2), round(cy * SCALE, 2)],
        "len": round(L * SCALE, 2),
    }


def draw_weapon(spec: WeaponSpec, attach: dict | None = None, ss: int = D.SS) -> np.ndarray:
    """يرسم سلاحًا واحدًا في إطار 84×34 (بمقياس SCALE)، يتجه لليمين."""
    attach = attach or {}
    c = _ScaledCanvas(D.Canvas(W, H, ss=ss), SCALE)
    R = _ramp(spec.body)
    steel = pal.shade("mid_gray", 5, 0.22)
    dark = pal.shade("shadow_gray", 5, 0.18)
    gt = attach.get("sight", spec.scope)
    muzzle = attach.get("muzzle", spec.muzzle)
    grip_kind = attach.get("grip", spec.grip)
    magazine = attach.get("mag", spec.mag)
    laser = attach.get("laser", False)

    L = min(spec.length, W - 16)
    x0 = 6                     # بداية السلاح (الأخمص)
    x1 = x0 + L                # نهاية الماسورة (الفوهة)
    cy = 18                    # محور الماسورة
    if spec.cls == "pistol":
        cy = 17
    barrel_x = x1 - L * spec.barrel
    # ---------------- الجسم/الماسورة ----------------
    bt = spec.barrel_thick
    ex = spec.extra
    if ex.get("rocket") or ex.get("thumper"):
        # قاذف: ماسورة سميكة + فتحة أمامية
        c.rect(barrel_x, cy - bt * 0.9, x1 - barrel_x, bt * 1.8, R[2], radius=1.2 * ss / ss)
        c.rect(barrel_x, cy - bt * 0.9, x1 - barrel_x, bt * 0.7, R[4], 0.75)
        c.rect(x1 - 3.5, cy - bt * 0.7, 3.5, bt * 1.4, R[0])
        c.ellipse(x1 - 1.4, cy, 1.5, bt * 0.75, R[0])
        c.ellipse(x1 - 1.4, cy, 0.9, bt * 0.5, "black")
    elif ex.get("energy"):
        c.rect(barrel_x, cy - bt * 0.75, x1 - barrel_x, bt * 1.5, R[2])
        c.rect(barrel_x, cy - bt * 0.75, x1 - barrel_x, bt * 0.6, "neon_green", 0.55)   # أنبوب طاقة
        for k in range(4):
            c.rect(barrel_x + 4 + k * 6, cy - bt * 0.9, 1.2, bt * 1.8, R[0], 0.8)
        c.rect(x1 - 4, cy - bt * 1.1, 4, bt * 2.2, R[2])
        c.ellipse(x1 - 1.2, cy, 1.4, bt * 0.9, "cyan_glow", 0.9)
    else:
        c.rect(barrel_x, cy - bt * 0.6, x1 - barrel_x, bt * 1.2, R[2])
        c.rect(barrel_x, cy - bt * 0.6, x1 - barrel_x, bt * 0.5, R[4], 0.8)     # لمعة أعلى الماسورة
        c.rect(barrel_x, cy + bt * 0.2, x1 - barrel_x, bt * 0.5, R[0], 0.7)     # ظل أسفل الماسورة
        if spec.cls in ("lmg", "sr") or bt > 3.0:
            for k in range(6):    # فتحات تبريد
                xx = barrel_x + 5 + k * 5
                if xx < x1 - 5:
                    c.rect(xx, cy - bt * 0.5, 1.4, bt, "black", 0.75)
    # ---------------- الفوهة (Muzzle) ----------------
    if muzzle == "suppressor":
        c.rect(x1 - 2, cy - bt * 0.8, 9, bt * 1.6, dark[2])
        c.rect(x1 - 2, cy - bt * 0.8, 9, bt * 0.5, dark[3], 0.6)
        c.rect(x1 - 1, cy - bt * 0.5, 7, bt * 0.4, dark[0], 0.7)
    elif muzzle == "brake":
        c.rect(x1 - 1, cy - bt * 0.85, 5, bt * 1.7, dark[2])
        c.rect(x1 + 1, cy - bt * 0.7, 1.2, bt * 1.4, "black", 0.8)
        c.rect(x1 + 3, cy - bt * 0.7, 1.2, bt * 1.4, "black", 0.8)
    elif muzzle == "flash":
        c.rect(x1 - 1, cy - bt * 0.9, 4, bt * 1.8, steel[3])
        c.rect(x1 + 1.4, cy - bt * 0.6, 1.6, bt * 1.2, "black", 0.7)
    # ---------------- الجسم (Receiver) ----------------
    rec_h = 5.0 if spec.cls != "pistol" else 4.6
    c.rect(barrel_x - (12 if spec.cls != "pistol" else 8), cy - rec_h * 0.5 - 0.4,
           (12 if spec.cls != "pistol" else 8) + 3, rec_h + 0.8, R[2], radius=1.0)
    c.rect(barrel_x - (12 if spec.cls != "pistol" else 8), cy - rec_h * 0.5 - 0.4,
           (12 if spec.cls != "pistol" else 8) + 3, rec_h * 0.55, R[4], 0.65)
    # مؤخّرة + مقبض المسدس
    c.rect(barrel_x - (12 if spec.cls != "pistol" else 8), cy + rec_h * 0.4,
           (12 if spec.cls != "pistol" else 8) + 1, rec_h * 0.5, R[0], 0.65)
    if spec.cls == "pistol" or grip_kind == "pistol":
        gx = barrel_x - (11 if spec.cls != "pistol" else 7)
        c.poly([(gx + 2.4, cy + rec_h * 0.4), (gx + 6.0, cy + rec_h * 0.4),
                (gx + 4.6, cy + rec_h * 0.4 + 7.0), (gx + 1.8, cy + rec_h * 0.4 + 6.4)], R[1])
        c.poly([(gx + 2.6, cy + rec_h * 0.4), (gx + 4.0, cy + rec_h * 0.4),
                (gx + 3.2, cy + rec_h * 0.4 + 6.4), (gx + 2.0, cy + rec_h * 0.4 + 5.8)], R[3], 0.55)
        # حلقة الزناد
        c.poly([(gx + 6.0, cy + rec_h * 0.5), (gx + 8.4, cy + rec_h * 0.5),
                (gx + 8.0, cy + rec_h * 0.5 + 3.4), (gx + 6.2, cy + rec_h * 0.5 + 3.0)], R[0], 0.85)
    # ---------------- المخزن ----------------
    mag_pos = (barrel_x - 6.0, cy + rec_h * 0.4)
    if magazine in ("box", "curved", "stick", "drum", "energy"):
        if magazine == "curved":
            c.poly([(mag_pos[0], mag_pos[1]), (mag_pos[0] + 5.0, mag_pos[1]),
                    (mag_pos[0] + 6.6, mag_pos[1] + 9.4), (mag_pos[0] + 1.4, mag_pos[1] + 10.2)], R[1])
            c.poly([(mag_pos[0] + 1.0, mag_pos[1] + 1.0), (mag_pos[0] + 2.6, mag_pos[1] + 1.0),
                    (mag_pos[0] + 3.6, mag_pos[1] + 8.6), (mag_pos[0] + 2.0, mag_pos[1] + 8.8)], R[3], 0.5)
            for k in range(3):
                c.line(mag_pos[0] + 1.0, mag_pos[1] + 3.0 + k * 2.6, mag_pos[0] + 5.6,
                       mag_pos[1] + 3.6 + k * 2.6, R[0], 0.7, 0.7)
        elif magazine == "drum":
            c.ellipse(mag_pos[0] + 4.4, mag_pos[1] + 5.2, 5.6, 5.4, R[1])
            c.ellipse(mag_pos[0] + 4.4, mag_pos[1] + 5.2, 4.2, 4.0, R[2])
            c.ellipse(mag_pos[0] + 5.6, mag_pos[1] + 4.2, 2.0, 1.8, R[4], 0.7)
            for k in range(8):
                a = k / 8 * math.tau
                c.rect(mag_pos[0] + 4.4 + math.cos(a) * 3.5 - 0.5, mag_pos[1] + 5.2 + math.sin(a) * 3.4 - 0.5,
                       1.0, 1.0, R[0], 0.8)
        elif magazine == "stick":
            c.rect(mag_pos[0] + 1.0, mag_pos[1], 3.0, 11.0, R[1])
            c.rect(mag_pos[0] + 1.2, mag_pos[1] + 0.6, 1.4, 9.8, R[3], 0.5)
        elif magazine == "energy":
            c.rect(mag_pos[0] + 0.6, mag_pos[1], 4.0, 7.0, dark[2])
            c.rect(mag_pos[0] + 1.2, mag_pos[1] + 1.0, 2.8, 4.6, "cyan_glow", 0.7)
            c.rect(mag_pos[0] + 1.2, mag_pos[1] + 1.0, 1.2, 4.6, "white_glow", 0.5)
        else:
            c.rect(mag_pos[0] + 1.4, mag_pos[1], 3.6, 8.2, R[1])
            c.rect(mag_pos[0] + 1.6, mag_pos[1] + 0.6, 1.6, 7.0, R[3], 0.5)
        if attach.get("mag") == "extended":
            c.rect(mag_pos[0] + 1.6, mag_pos[1] + 8.0, 3.2, 3.4, R[1])
        if attach.get("mag") == "drum" and magazine != "drum":
            c.ellipse(mag_pos[0] + 3.4, mag_pos[1] + 6.0, 4.4, 4.2, R[1])
            c.ellipse(mag_pos[0] + 3.4, mag_pos[1] + 6.0, 3.2, 3.0, R[2])
    # ---------------- الحاضن الأمامي / الخشب ----------------
    if spec.handguard == "rails" and spec.cls != "pistol":
        hx = barrel_x - 2.0
        c.rect(hx, cy - bt * 1.1, 11.0, bt * 2.2, R[1], radius=1.0)
        c.rect(hx, cy - bt * 1.1, 11.0, bt * 0.6, R[3], 0.65)
        for k in range(4):
            c.rect(hx + 1.4 + k * 2.6, cy - bt * 0.9, 1.0, bt * 1.8, R[0], 0.7)
        if grip_kind == "vertical":
            c.rect(hx + 4.0, cy + bt * 1.1, 2.8, 5.4, R[1])
            c.rect(hx + 4.2, cy + bt * 1.3, 1.2, 4.6, R[3], 0.5)
        if grip_kind == "angled":
            c.poly([(hx + 3.6, cy + bt * 1.1), (hx + 6.0, cy + bt * 1.1),
                    (hx + 4.6, cy + bt * 1.1 + 4.6), (hx + 2.8, cy + bt * 1.1 + 4.0)], R[1])
    elif spec.handguard == "wood" and spec.cls != "pistol":
        hx = barrel_x - 1.0
        c.rect(hx, cy - bt * 1.0, 12.0, bt * 2.0, pal.shade("wood_light", 5, 0.2)[2], radius=1.0)
        c.rect(hx, cy - bt * 1.0, 12.0, bt * 0.7, pal.shade("wood_light", 5, 0.2)[4], 0.6)
        c.rect(hx, cy + bt * 0.3, 12.0, bt * 0.7, pal.shade("wood_light", 5, 0.2)[0], 0.6)
        for k in range(3):
            c.rect(hx + 2.0 + k * 3.4, cy - bt * 0.9, 0.8, bt * 1.8, pal.shade("wood_dark", 3, 0.1)[1], 0.55)
    elif spec.handguard == "solid" and spec.cls != "pistol":
        hx = barrel_x - 1.0
        c.rect(hx, cy - bt * 1.0, 10.0, bt * 2.0, R[1], radius=1.0)
        c.rect(hx, cy - bt * 1.0, 10.0, bt * 0.6, R[3], 0.6)
    # ---------------- الأخمص (Stock) ----------------
    if spec.stock == "solid":
        sx = barrel_x - 12
        c.poly([(sx, cy - 1.4), (sx + 6.0, cy - 1.4), (sx + 5.0, cy + 4.4), (sx - 1.6, cy + 5.6)], R[1])
        c.poly([(sx + 0.6, cy - 0.8), (sx + 5.0, cy - 0.8), (sx + 4.2, cy + 3.6), (sx - 0.6, cy + 4.6)], R[3], 0.5)
        c.rect(sx - 1.8, cy - 2.2, 2.2, 8.6, R[0])   # كتف الأخمص
    elif spec.stock == "skeleton":
        sx = barrel_x - 12
        c.rect(sx - 1.6, cy - 1.8, 2.4, 8.4, R[1])
        c.poly([(sx, cy - 1.4), (sx + 5.6, cy - 1.4), (sx + 5.6, cy - 0.2), (sx, cy - 0.2)], R[2])
        c.poly([(sx + 1.0, cy + 3.4), (sx + 5.6, cy + 3.4), (sx + 5.6, cy + 4.6), (sx + 1.0, cy + 4.6)], R[2])
        c.rect(sx - 1.6, cy - 2.0, 2.0, 1.6, R[0], 0.8)
    elif spec.stock == "folding":
        sx = barrel_x - 12
        c.rect(sx + 1.0, cy - 1.2, 5.0, 2.2, R[2])
        c.rect(sx + 1.0, cy - 1.2, 5.0, 0.9, R[4], 0.6)
        c.rect(sx + 4.6, cy + 0.6, 2.4, 2.6, R[1])
    # ---------------- تفاصيل القراءة (front sight / ejection port) ----------------
    if spec.cls not in ("melee",) and not ex.get("rocket") and not ex.get("thumper"):
        # قاعدة الغاز + منصّة المنظار الأمامي
        gx = barrel_x + (x1 - barrel_x) * 0.62
        c.rect(gx, cy - bt * 1.5, 3.0, bt * 0.9, R[1])
        c.rect(gx + 0.8, cy - bt * 2.4, 1.2, bt * 0.9, R[0])     # مسند المنظار الأمامي
        # فتحة القذف + مقبض السحب
        if spec.cls in ("ar", "smg", "lmg", "sr"):
            c.rect(barrel_x - 7.4, cy - rec_h * 0.10, 3.4, 1.6, "black", 0.7)
            c.rect(barrel_x - 8.6, cy - rec_h * 0.42, 2.2, 1.2, R[3], 0.85)
        # محوّل النيران (selector) بلون تمييز
        c.rect(barrel_x - 10.6, cy + rec_h * 0.05, 2.6, 1.1, R[0], 0.7)
        c.rect(barrel_x - 10.2, cy + rec_h * 0.12, 1.6, 0.8, "accent_teal", 0.5)
        # أنبوب مخزن (للشوزن) تحت الماسورة
        if spec.cls == "shotgun":
            c.rect(barrel_x, cy + bt * 0.7, x1 - barrel_x - 6, bt * 1.1, R[1])
            c.rect(barrel_x, cy + bt * 0.8, x1 - barrel_x - 6, bt * 0.35, R[3], 0.6)
            c.rect(x0 + L * 0.30, cy + bt * 0.6, 7.0, bt * 1.6, pal.shade("wood_dark", 4, 0.16)[1], radius=1.0)  # المضخة
    if ex.get("bullpup"):
        # بندقية Bullpup: المخزن خلف المقبض والحاضن ممتد للأمام
        c.rect(barrel_x - 12, cy + rec_h * 0.2, 8.0, 4.4, R[1], radius=1.0)
        c.rect(barrel_x - 11.4, cy + rec_h * 0.35, 6.6, 3.0, R[3], 0.5)
        c.rect(barrel_x - 4.0, cy - rec_h * 0.7, 3.0, 2.0, R[0], 0.7)
    # ---------------- المنظار (Sight) ----------------
    top = cy - rec_h * 0.5 - 0.6
    if gt == "dot":
        c.rect(barrel_x - 7.0, top - 3.6, 4.2, 3.0, dark[1])
        c.rect(barrel_x - 6.6, top - 3.2, 3.4, 1.8, "glass_lo", 0.9)
        c.rect(barrel_x - 5.4, top - 2.9, 1.2, 1.2, "red_light", 0.95)
    elif gt in ("scope2", "scope4", "scope8"):
        ln = {"scope2": 9.0, "scope4": 12.0, "scope8": 16.0}[gt]
        rr = {"scope2": 2.4, "scope4": 2.8, "scope8": 3.2}[gt]
        c.rect(barrel_x - ln * 0.5 - 2, top - rr * 2.0, ln, rr * 2.0, dark[1], radius=1.0)
        c.rect(barrel_x - ln * 0.5 - 2, top - rr * 2.0, ln, rr * 0.8, dark[3], 0.6)
        c.ellipse(barrel_x + ln * 0.5 - 2, top - rr, 1.6, rr * 0.9, "glass_lo")   # عدسة أمامية
        c.ellipse(barrel_x + ln * 0.5 - 2.2, top - rr - 0.4, 0.9, rr * 0.5, "glass_hi", 0.8)
        c.ellipse(barrel_x - ln * 0.5 - 2, top - rr, 1.3, rr * 0.7, "glass_lo", 0.8)
        # حوامل المنظار
        c.rect(barrel_x - ln * 0.4, top - rr * 0.6, 1.6, rr * 1.4, dark[2], 0.9)
        c.rect(barrel_x + ln * 0.3, top - rr * 0.6, 1.6, rr * 1.4, dark[2], 0.9)
        # حلقات ضبط
        c.rect(barrel_x - ln * 0.18, top - rr * 2.1, 1.4, rr * 2.2, "black", 0.55)
    elif gt == "laser":
        c.rect(barrel_x - 1.0, cy + bt * 1.0, 4.0, 2.2, dark[1])
        c.rect(barrel_x + 3.0, cy + bt * 1.4, 1.4, 1.4, "red_light", 0.9)
    else:   # مسدس/حديدي
        c.rect(barrel_x + 1.0, top - 1.8, 1.6, 2.0, dark[1])
        c.rect(barrel_x - 6.0, top - 1.8, 1.6, 2.0, dark[1])
        if spec.cls in ("ar", "smg", "lmg"):
            c.rect(barrel_x - 7.0, top - 2.6, 3.0, 3.0, dark[1], radius=0.6)
    # ---------------- ملحقات إضافية ----------------
    if laser:
        c.rect(barrel_x + 6.0, cy + bt * 0.8, 5.0, 2.4, dark[1])
        c.rect(barrel_x + 11.0, cy + bt * 1.2, 1.4, 1.4, "neon_pink", 0.9)
    if spec.bipod:
        c.line(barrel_x + 3.0, cy + bt * 1.4, barrel_x - 1.0, cy + 9.0, steel[1], 1.4)
        c.line(barrel_x + 3.0, cy + bt * 1.4, barrel_x + 7.0, cy + 9.0, steel[1], 1.4)
        c.rect(barrel_x + 2.0, cy + bt * 1.0, 2.4, 2.0, dark[2])
    # ---------------- حالات خاصة: مشاجرة ----------------
    ex = spec.extra
    if ex.get("knife"):
        c.poly([(20, cy - 2.0), (52, cy - 2.6), (62, cy - 0.4), (52, cy + 2.2), (20, cy + 1.6)], steel[4])
        c.poly([(24, cy - 1.4), (50, cy - 1.8), (58, cy - 0.4)], "white_glow", 0.65)
        c.rect(12, cy - 1.2, 9, 5.0, dark[2])          # المقبض
        c.rect(12, cy - 1.0, 9, 1.4, dark[4], 0.6)
        c.rect(19, cy + 1.4, 4.0, 1.6, dark[1])
    elif ex.get("axe"):
        c.rect(10, cy - 1.2, 26, 3.0, pal.shade("wood_light", 4, 0.2)[1])
        c.poly([(30, cy - 8.0), (40, cy - 6.0), (41, cy + 2.0), (30, cy + 4.0)], steel[3])
        c.poly([(31, cy - 7.0), (38, cy - 5.4), (38.6, cy + 0.6), (31, cy + 2.4)], steel[4], 0.7)
        c.poly([(30, cy - 8.0), (34, cy - 7.6), (34, cy + 3.4), (30, cy + 4.0)], steel[1], 0.8)
    elif ex.get("sickle"):
        c.rect(12, cy - 1.0, 14, 2.6, dark[1])
        c.poly([(26, cy - 1.0), (44, cy - 8.0), (52, cy - 12.0), (54, cy - 9.0), (46, cy - 4.0), (28, cy + 1.6)], steel[3])
        c.poly([(27, cy - 0.6), (43, cy - 7.0), (50, cy - 10.6), (51, cy - 9.0), (44, cy - 5.0), (28, cy + 0.8)], steel[4], 0.6)
    elif ex.get("baton"):
        c.rect(10, cy - 1.6, 28, 3.2, dark[2])
        c.rect(10, cy - 1.6, 6, 3.2, dark[0])
        c.rect(16, cy - 1.4, 22, 1.2, dark[4], 0.6)
    elif ex.get("flare"):
        c.rect(barrel_x - 3, cy - 2.6, 10, 5.2, pal.shade("red_light", 5, 0.2)[2], radius=1.0)
        c.rect(barrel_x - 3, cy - 2.6, 10, 1.6, pal.shade("red_light", 5, 0.2)[4], 0.7)
        c.ellipse(x1 + 1.0, cy, 2.2, 2.6, "flame_yellow", 0.9)
    # إضاءة عامة + تكميم + حد خارجي
    c.global_light(R, light_dir=(-0.5, -0.85), amount=0.3)
    img = c.downsample("area")
    img = D.quantize(img, _qcol())
    img = D.outline(img, "#0B0D10")
    return img


_QC = None


def _qcol():
    global _QC
    if _QC is None:
        cols = [pal.hex_to_rgb(pal.ALL[n]) for n in pal.NAMES]
        for n in ("mid_gray", "shadow_gray", "wood_light", "sand_light", "olive",
                  "steel_blue", "brass_yellow", "gold", "red_light", "rust_light"):
            cols.extend(pal.shade(n, 5, 0.2))
        _QC = np.array(cols, dtype=np.float32)
    return _QC


def build_all(attach_overrides: dict | None = None):
    """يبني كل الأسلحة كقاموس {key: صورة} مع مقاسات موحّدة."""
    out = {}
    for spec in SPECS:
        attach = (attach_overrides or {}).get(spec.key, {})
        out[spec.key] = draw_weapon(spec, attach)
    return out


if __name__ == "__main__":
    from PIL import Image
    imgs = build_all()
    keys = list(imgs.keys())
    cols = 4
    rows = (len(keys) + cols - 1) // cols
    h, w = imgs[keys[0]].shape[:2]
    sheet = np.zeros((rows * h, cols * w, 4), dtype=np.uint8)
    for i, k in enumerate(keys):
        r, cc = divmod(i, cols)
        sheet[r * h:(r + 1) * h, cc * w:(cc + 1) * w] = imgs[k]
    Image.fromarray(sheet).save("/tmp/weapons.png")
    print("weapons sheet:", sheet.shape, "count:", len(keys))
