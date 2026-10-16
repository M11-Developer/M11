"""هيكل الشخصية (Rig) — يرسم جنود البكسل آرت إجرائيًا بدقة عالية.

الفكرة: نعرّف هيكلًا عظميًا رقميًا (عظام + زوايا) ثم نرسم كل عضو كمضلّع
مع تظليل بالخطوط (Ramps) وDithering وإضاءة اتجاهية، ثم نمرّر الناتج على
سلسلة المعالجة: اختزال ×4 بـ Nearest ← تكميم على اللوحة ← حد خارجي 1 بكسل.

المقاس: ارتفاع الشخصية ≈ 64 بكسل (القسم 3.1بند 2) — وهي أكبر من المعتاد في
ألعاب البكسل الصغيرة، وهذا ما يسمح بتفاصيل الوجه والعتاد.

كل الشخصيات تستخدم **نفس الهيكل** لتشترك في الأنيميشن، ونغيّر:
  - نمط الخوذة/الوشاح/الشعر/الهوائي (Silhouette) → 10 شخصيات مميزة
  - لوحة الألوان (Palette Swap) → 4 أزياء × 10 ألوان فرق = مئات المتغيرات
"""
from __future__ import annotations

import math

import numpy as np

from . import draw as D
from . import palette as pal

# أطوال العظام (بكسل نهائي عند scale=1) — نسب "بطولية" (رأس كبير، جذع عريض)
L = dict(torso=15.6, neck=1.8, head_r=5.8, upper_arm=7.6, fore_arm=6.8,
         thigh=11.6, shin=11.4, foot=4.0, hand_r=2.6, shoulder_w=13.0)
# ارتفاع الشخصية الكلي ≈ head(13) + neck(2.4) + torso(16) + legs(24.6) + boot(2) ≈ 58..62


def fk(origin, angle_deg, length, scale=1.0):
    """Forward kinematics: نقطة جديدة بزاوية (0 = لأسفل، + = للأمام/اليمين)."""
    a = math.radians(angle_deg)
    return (origin[0] + math.sin(a) * length * scale, origin[1] + math.cos(a) * length * scale)


class Operator:
    """وصف الشخصية: الهوية البصرية + الألوان + نمط العتاد."""

    STYLES = ("commando", "scout", "heavy", "nightops", "medic", "sniper",
              "demolition", "engineer", "recon", "standard")

    def __init__(self, key: str, name_ar: str, gender: str, skin: str,
                 uniform: str = "olive", style: str = "standard",
                 accent: str = "team_green", bio: str = "", helmet: str = "mid_gray",
                 hair: str = "brown_dark", scarf: bool = False):
        self.key = key
        self.name_ar = name_ar
        self.gender = gender
        self.skin = skin
        self.uniform = uniform
        self.style = style
        self.accent = accent
        self.bio = bio
        self.helmet = helmet
        self.hair = hair
        self.scarf = scarf


OPERATORS = [
    Operator("rashid", "راشد", "m", "skin_medium", "olive", "commando", "team_green",
             "قائد فريق الجبهة؛ أمضى 12 عامًا في وحدات الصحراء.\nحمل وسام التميّز ثلاث مرات ولا يتحدث عن السبب أبدًا.",
             "olive_dark", "brown_dark", True),
    Operator("karim", "كريم", "m", "skin_light", "sand_light", "scout", "team_blue",
             "قنّاص انتهازي يفضّل المسافات البعيدة على الزحام.\nيعدّ كل رصاصة قبل أن يطلقها، ثم يطلق واحدة.",
             "sand_deep", "brown_dark"),
    Operator("yusuf", "يوسف", "m", "skin_deep", "mid_gray", "heavy", "team_orange",
             "مهندس ألغام سابق تحوّل إلى حامل درع ثقيل للفريق.\nيستخدم جسده غطاءً لمن خلفه، ويصف ذلك بالعمل العادي.",
             "shadow_gray", "black"),
    Operator("tariq", "طارق", "m", "skin_dark", "olive_dark", "nightops", "team_purple",
             "عمل في وحدات العمليات الليلية قبل أن يختفي من السجلات.\nلا أحد يعرف اسمه الحقيقي، الجميع يعرف صوته.",
             "black", "black"),
    Operator("adam", "آدم", "m", "skin_medium", "steel_blue", "medic", "team_white",
             "مسعف ميداني أنقذ أربعين جريحًا في حصار واحد.\nيحمل البندقية فقط لأن الوقت لا يسمح بالجروح.",
             "light_gray", "earth"),
    Operator("layla", "ليلى", "f", "skin_medium", "olive", "scout", "team_green",
             "استطلاعية سريعة، تسبق الفريق دائمًا بثلاثين ثانية.\nتعرف كل زاوية في الخريطة قبل أن تدخلها.",
             "olive_dark", "black", True),
    Operator("noor", "نور", "f", "skin_light", "mid_gray", "sniper", "team_blue",
             "مدرّبة قنص من فريق النخبة.\nتحسب الريح بالإحساس، وتصيب من الطلقة الأولى.",
             "shadow_gray", "brown_dark"),
    Operator("hala", "هالة", "f", "skin_dark", "sand_dark", "demolition", "team_red",
             "خبيرة تفكيك متفجرات، أهدأ شخص في الفريق تحت النار.\nتمسك القنبلة كأنها كوب شاي.",
             "brown_dark", "black"),
    Operator("sara", "سارة", "f", "skin_light", "olive_dark", "engineer", "team_yellow",
             "مهندسة ميدانية تبني الدفاعات في دقائق.\nتمدح المتفجرات المصنوعة يدويًا أكثر من أي بندقية.",
             "earth", "brown_dark", True),
    Operator("mariam", "مريم", "f", "skin_deep", "steel_blue", "recon", "accent_teal",
             "قائدة فريق الاستطلاع الجوي بالطائرات المسيّرة.\nترى الخريطة من فوق قبل أن يتنفّس العدو.",
             "blue_shadow", "black"),
    Operator("faisal", "فيصل", "m", "skin_dark", "sand_dark", "commander", "team_orange",
             "قائد ميداني من مدرسة الصحراء؛ يخطّط للقتال كما يخطّط الشطرنجي لآخر ثلاث نقلات.\nلا يرفع صوته أبدًا، ولهذا يستمع إليه الجميع.",
             "sand_deep", "black", True),
    Operator("zayd", "زيد", "m", "skin_deep", "steel_blue", "sailor", "team_blue",
             "بحّار سابق في خفر السواحل قبل أن يمسك البندقية.\nيعرف البحر أكثر مما يعرف البر، ويعرف متى ينسحب.",
             "blue_shadow", "black"),
    Operator("omar", "عمر", "m", "skin_medium", "mid_gray", "gunner", "team_red",
             "رامي مدفع ثقيل يعرف وزن كل رصاصة في المقذوفة.\nيهدئ نفسه بعد كل اشتباك بإصلاح المدفع بنفسه.",
             "shadow_gray", "brown_dark"),
    Operator("khalid", "خالد", "m", "skin_light", "olive", "medic", "team_white",
             "مسعف ميداني ثانٍ، تدرّب في الميناء على انتشال الغرقى.\nيحمل حقيبة أثقل من رشاشته، ويعدّها الأهم.",
             "light_gray", "earth"),
    Operator("salem", "سالم", "m", "skin_medium", "olive_dark", "demolition", "team_yellow",
             "رجل متفجرات يحبّ الصوت العالي والخطة البسيطة.\nيقول إن الباب المغلق ليس مشكلة، بل دعوة.",
             "olive_dark", "black"),
    Operator("amal", "أمل", "f", "skin_deep", "steel_blue", "sailor", "accent_teal",
             "ضابطة سطح سفينة، تدير شؤون السفينة كما تدير الاشتباك: بالترتيب.\nتقسّم الذخيرة قبل المعركة لا بعدها.",
             "blue_shadow", "black", True),
    Operator("rana", "رنا", "f", "skin_light", "sand_light", "sniper", "team_purple",
             "قنّاصة تعمل من أبراج الميناء، تختار موقعها قبل أن تُفتح اللعبة.\nتحبّ الضباب لأنه يخفيها ويُظهر الأهداف.",
             "sand_deep", "brown_dark"),
    Operator("dina", "دينا", "f", "skin_medium", "mid_gray", "engineer", "team_green",
             "مهندسة موانئ تركّب المنصات والسلالم بسرعة لا تُصدَّق.\nتحمل مفتاحًا واحدًا وتفتح به كل شيء.",
             "shadow_gray", "black"),
    Operator("yasmin", "ياسمين", "f", "skin_dark", "olive", "recon", "team_blue",
             "مراقبة من الجو بطائرة مسيّرة صغيرة، تعطي إحداثيات دقيقة كل عشر ثوانٍ.\nصوتها الهادئ في اللاسلكي هو أفضل غطاء للفريق.",
             "olive_dark", "black"),
    Operator("hind", "هند", "f", "skin_light", "olive_dark", "heavy", "team_orange",
             "حاملة الدرع الثقيل الجديدة، كانت تقود شاحنات في الصحراء.\nتضع الدرع أمام الفريق وتقول إن هذا كل ما تفعله.",
             "earth", "brown_dark"),
]

OP_BY_KEY = {o.key: o for o in OPERATORS}

# لوحة تشكيل الهوية (شرائط/عمامة/وشاح) — تُستخدم في التفاصيل الصغيرة
IDENTITY = {
    "rashid": dict(scarf="blood_red", band="gold", emblem=True),
    "karim": dict(scarf="sand_dark", band="brown_dark", cape=True),
    "yusuf": dict(scarf="shadow_gray", band="team_orange"),
    "tariq": dict(scarf="purple_dark", band="team_purple", goggles=True),
    "adam": dict(scarf="white_glow", band="team_white", emblem=True),
    "layla": dict(scarf="olive_dark", band="team_green", tail=True),
    "noor": dict(scarf="shadow_gray", band="team_blue", tail=True, goggles=True),
    "hala": dict(scarf="brown_dark", band="team_red", tail=True),
    "sara": dict(scarf="earth", band="team_yellow", tail=True, emblem=True),
    "mariam": dict(scarf="blue_shadow", band="accent_teal", tail=True, antenna=True),
}


def _mat(op: Operator):
    """خطوط التدرّج لكل مادة لونية (Ramp من الأغمق للأفتح) مع Hue-Shift."""
    return {
        "skin": pal.shade(op.skin, 6, 0.20),
        "uniform": pal.shade(op.uniform, 6, 0.20),
        "vest": pal.shade("mid_gray", 6, 0.26),
        "strap": pal.shade("brown_dark", 5, 0.16),
        "boot": pal.shade("brown_dark", 5, 0.16),
        "metal": pal.shade(op.helmet, 6, 0.22),
        "accent": pal.shade(op.accent, 6, 0.22),
        "belt": pal.shade("mid_gray", 5, 0.18),
        "hair": pal.shade(op.hair, 4, 0.14),
    }


def _darker(ramp, d=0.05):
    """نسخة أغمق من خط تدرّج (للأعضاء الخلفية → إحساس العمق)."""
    return [pal.hue_shift(v, -0.012, 0.01, -d) for v in ramp]


class Pose:
    """حالة الهيكل في لحظة ما (زوايا بالدرجات + إزاحات) — كل القيم اختيارية."""

    __slots__ = ("hip_b", "knee_b", "foot_b", "hip_f", "knee_f", "foot_f",
                 "sh_b", "el_b", "sh_f", "el_f", "lean", "head", "dy", "dx",
                 "jet", "prone", "no_legs", "show_arms", "scale", "arm_anchor",
                 "weapon_pitch", "crouch", "arms_only")

    def __init__(self, **kw):
        self.hip_b = kw.get("hip_b", 0.0)
        self.knee_b = kw.get("knee_b", 0.0)
        self.foot_b = kw.get("foot_b", 0.0)
        self.hip_f = kw.get("hip_f", 0.0)
        self.knee_f = kw.get("knee_f", 0.0)
        self.foot_f = kw.get("foot_f", 0.0)
        self.sh_b = kw.get("sh_b", 0.0)
        self.el_b = kw.get("el_b", 0.0)
        self.sh_f = kw.get("sh_f", 0.0)
        self.el_f = kw.get("el_f", 0.0)
        self.lean = kw.get("lean", 0.0)
        self.head = kw.get("head", 0.0)
        self.dy = kw.get("dy", 0.0)
        self.dx = kw.get("dx", 0.0)
        self.jet = kw.get("jet", False)
        self.prone = kw.get("prone", False)
        self.no_legs = kw.get("no_legs", False)
        self.show_arms = kw.get("show_arms", True)
        self.scale = kw.get("scale", 1.0)
        self.arm_anchor = kw.get("arm_anchor", None)
        self.weapon_pitch = kw.get("weapon_pitch", 0.0)
        self.crouch = kw.get("crouch", 0.0)
        self.arms_only = kw.get("arms_only", False)

    def copy(self, **kw) -> "Pose":
        p = Pose()
        for k in self.__slots__:
            setattr(p, k, getattr(self, k))
        for k, v in kw.items():
            setattr(p, k, v)
        return p


class Rig:
    """يرسم الشخصية لوضعية معيّنة على Canvas (قبل الاختزال)."""

    def __init__(self, op: Operator, scale: float = 1.0, body_only: bool = False,
                 detail: int = 2, arms_only: bool = False):
        self.op = op
        self.M = _mat(op)
        self.scale = scale
        self.body_only = body_only
        self.arms_only = arms_only
        self.detail = detail          # 2 = كامل، 1 = متوسط (للأعداء البعيدين)
        self.ID = IDENTITY.get(op.key, {})

    def _s(self, v):
        return v * self.scale

    # ---------------------------------------------------------------- الرأس
    def _head(self, c: D.Canvas, hx, hy):
        """الرأس: وجه واضح (عين، حاجب، أنف جانبي، فك) + خوذة قبعية لا تحجب الوجه.

        نستخدم قناع قصّ (clip) لتحصر الخوذة في الجزء العلوي من الرأس، فيبقى الوجه
        ظاهرًا — وهذا الفارق الأساسي بين شخصية "مقنّعة" وشخصية لها ملامح.
        """
        M, op, ID = self.M, self.op, self.ID
        s = self.scale
        hr = L["head_r"]

        # --- 1) الشعر/خلف الجمجمة (يُغطّى بالخوذة لاحقًا) ---
        if op.gender == "f":
            hair = M["hair"]
            c.ellipse(hx - self._s(3.6), hy + self._s(2.0), self._s(2.4), self._s(4.6), hair[1])
            c.ellipse(hx - self._s(4.2), hy + self._s(3.6), self._s(1.9), self._s(3.0), hair[0], 0.85)
            c.ellipse(hx - self._s(5.0), hy + self._s(5.4), self._s(1.4), self._s(2.2), hair[0], 0.6)
        else:
            c.ellipse(hx - self._s(1.0), hy - self._s(0.6), self._s(5.6), self._s(5.2), M["hair"][0])

        # --- 2) الرقبة (مع ظل الفك) ---
        c.rect(hx - self._s(2.2), hy + self._s(3.2), self._s(4.4), self._s(3.8), M["skin"][1])
        c.rect(hx - self._s(2.4), hy + self._s(6.0), self._s(4.8), self._s(1.6), M["skin"][0], 0.8)

        # --- 3) الوجه ---
        c.ellipse(hx - self._s(0.4), hy + self._s(0.6), self._s(hr), self._s(hr * 0.96), M["skin"][2])
        c.ellipse(hx + self._s(1.0), hy + self._s(1.8), self._s(hr * 0.74), self._s(hr * 0.66), M["skin"][3], 0.85)
        c.ellipse(hx - self._s(2.6), hy + self._s(1.0), self._s(hr * 0.46), self._s(hr * 0.56), M["skin"][0], 0.45)
        c.ellipse(hx + self._s(2.6), hy + self._s(3.4), self._s(hr * 0.46), self._s(hr * 0.34), M["skin"][1], 0.7)  # الفك
        c.rect(hx + self._s(4.2), hy + self._s(0.8), self._s(1.7), self._s(1.7), M["skin"][3])   # الأنف (بروفايل)
        c.rect(hx + self._s(4.0), hy + self._s(2.4), self._s(1.1), self._s(0.9), M["skin"][1], 0.8)
        c.ellipse(hx - self._s(2.4), hy + self._s(0.6), self._s(1.3), self._s(1.9), M["skin"][1], 0.9)  # الأذن
        c.rect(hx - self._s(2.8), hy + self._s(0.6), self._s(0.9), self._s(1.2), M["skin"][0], 0.6)
        # العين + الحاجب + الفم
        c.rect(hx + self._s(1.6), hy - self._s(0.2), self._s(2.1), self._s(1.5), "#0B0D10")
        c.rect(hx + self._s(2.4), hy - self._s(0.2), self._s(1.0), self._s(0.9), M["skin"][4], 0.55)
        c.rect(hx + self._s(1.3), hy - self._s(1.8), self._s(2.9), self._s(1.0), M["hair"][0], 0.95)
        c.rect(hx + self._s(2.2), hy + self._s(3.1), self._s(1.8), self._s(0.8), M["skin"][0], 0.85)

        # --- 4) النظارة/الكمامة (قبل الخوذة حتى لا تُغطّى) ---
        if ID.get("goggles"):
            c.rect(hx + self._s(0.6), hy - self._s(0.8), self._s(4.4), self._s(2.6), M["vest"][2])
            c.rect(hx + self._s(3.4), hy - self._s(0.4), self._s(1.9), self._s(1.6), "cyan_glow", 0.6)
            c.rect(hx + self._s(0.8), hy + self._s(1.4), self._s(4.0), self._s(0.7), M["vest"][0], 0.7)

        # --- 5) الخوذة: تُرسم داخل قناع يقتصر على أعلى الرأس ---
        brim_y = hy - self._s(0.4 if op.style != "heavy" else 1.0)
        st = op.style
        if st in ("nightops", "demolition"):
            brim_y = hy + self._s(0.8)      # قلنسوة تغطي أكثر (عمليات ليلية)
        prev = c.clip_rect(hx - self._s(8.0), hy - self._s(11.5), self._s(16.0),
                           (brim_y - (hy - self._s(11.5))))
        hw = hr * 1.14
        hh = hr * 0.94
        if st == "heavy":
            c.ellipse(hx - self._s(0.4), hy - self._s(1.4), self._s(hw), self._s(hh), M["metal"][2])
            c.ellipse(hx + self._s(0.6), hy - self._s(2.4), self._s(hw * 0.74), self._s(hh * 0.56), M["metal"][3], 0.9)
            c.rect(hx - self._s(6.2), hy - self._s(2.6), self._s(12.4), self._s(2.6), M["metal"][1])
            c.rect(hx - self._s(6.0), hy - self._s(2.4), self._s(12.0), self._s(0.9), M["metal"][4], 0.6)
            c.rect(hx - self._s(7.4), hy - self._s(1.4), self._s(2.2), self._s(3.6), M["vest"][2])   # واقي جانبي
            c.rect(hx + self._s(3.2), hy - self._s(6.4), self._s(2.6), self._s(1.8), M["accent"][2], 0.9)
        elif st == "commando":
            c.ellipse(hx - self._s(0.4), hy - self._s(1.2), self._s(hw), self._s(hh * 0.96), M["metal"][2])
            c.ellipse(hx + self._s(0.8), hy - self._s(2.2), self._s(hw * 0.72), self._s(hh * 0.58), M["metal"][3], 0.9)
            c.rect(hx - self._s(5.8), hy - self._s(2.2), self._s(11.6), self._s(2.2), M["metal"][1])
            c.rect(hx - self._s(5.6), hy - self._s(2.0), self._s(11.2), self._s(0.8), M["metal"][4], 0.6)
            c.rect(hx - self._s(0.6), hy - self._s(6.0), self._s(2.4), self._s(1.8), M["accent"][2])   # مثبّت
            c.rect(hx - self._s(7.0), hy - self._s(1.6), self._s(1.8), self._s(2.6), M["metal"][1])   # سماعة
            c.rect(hx - self._s(7.2), hy + self._s(0.4), self._s(1.4), self._s(1.2), M["accent"][3], 0.7)
        elif st in ("sniper", "recon"):
            c.ellipse(hx - self._s(0.4), hy - self._s(1.0), self._s(hw * 0.96), self._s(hh * 0.88), M["metal"][2])
            c.ellipse(hx + self._s(0.8), hy - self._s(2.0), self._s(hw * 0.68), self._s(hh * 0.5), M["metal"][3], 0.9)
            c.rect(hx - self._s(5.6), hy - self._s(2.0), self._s(11.2), self._s(1.8), M["metal"][1])
            c.rect(hx + self._s(1.6), hy - self._s(1.8), self._s(3.0), self._s(1.2), "glass_hi", 0.75)
            c.rect(hx - self._s(5.6), hy - self._s(0.4), self._s(2.2), self._s(2.2), M["strap"][1])   # رقعة قماش
        else:
            c.ellipse(hx - self._s(0.4), hy - self._s(1.0), self._s(hw), self._s(hh * 0.92), M["metal"][2])
            c.ellipse(hx + self._s(0.8), hy - self._s(2.0), self._s(hw * 0.72), self._s(hh * 0.54), M["metal"][3], 0.9)
            c.rect(hx - self._s(5.6), hy - self._s(2.0), self._s(11.2), self._s(1.8), M["metal"][1])
            c.rect(hx - self._s(5.4), hy - self._s(1.8), self._s(10.8), self._s(0.8), M["metal"][4], 0.65)
            if st == "medic":
                c.rect(hx - self._s(1.0), hy - self._s(5.6), self._s(2.6), self._s(1.6), "white_glow")
                c.rect(hx - self._s(4.6), hy - self._s(1.6), self._s(2.0), self._s(1.8), M["accent"][2], 0.8)
        # شريط الهوية على جبهة الخوذة (يعمل داخل القصّ)
        band = ID.get("band")
        if band:
            bc = pal.shade(band, 5, 0.16)
            c.rect(hx - self._s(5.2), brim_y - self._s(2.2), self._s(10.4), self._s(1.4), bc[2])
            c.rect(hx - self._s(5.2), brim_y - self._s(2.2), self._s(10.4), self._s(0.6), bc[3], 0.8)
        c.unclip(prev)
        # حافة الخوذة السفلية (خط داكن يفصل الخوذة عن الوجه)
        c.line(hx - self._s(5.4), brim_y, hx + self._s(5.0), brim_y, M["metal"][0], 1.0 * s)
        if ID.get("antenna"):
            c.line(hx - self._s(1.8), hy - self._s(6.4), hx - self._s(4.2), hy - self._s(10.2), M["metal"][2], 1.0 * s)
            c.rect(hx - self._s(5.0), hy - self._s(11.4), self._s(1.7), self._s(1.7), M["accent"][4])
        if ID.get("emblem"):
            c.rect(hx - self._s(5.8), hy - self._s(0.4), self._s(2.0), self._s(1.8), "gold", 0.95)
            c.rect(hx - self._s(5.4), hy, self._s(1.2), self._s(1.0), "gold_dark", 0.8)
        # الوشاح أسفل الفك (يتحرك إجرائيًا بالفيزياء)
        if ID.get("scarf"):
            sc = pal.shade(ID["scarf"], 5, 0.16)
            c.poly([(hx - self._s(3.6), hy + self._s(4.2)), (hx - self._s(4.8), hy + self._s(6.4)),
                    (hx - self._s(2.4), hy + self._s(7.0)), (hx - self._s(1.8), hy + self._s(4.6))], sc[2])
            c.poly([(hx - self._s(4.6), hy + self._s(5.6)), (hx - self._s(5.8), hy + self._s(8.2)),
                    (hx - self._s(4.2), hy + self._s(8.4)), (hx - self._s(3.4), hy + self._s(6.0))], sc[1])
            c.rect(hx - self._s(2.6), hy + self._s(4.4), self._s(3.0), self._s(1.2), sc[3], 0.8)

    # ------------------------------------------------------------- الجذع
    def _torso(self, c: D.Canvas, pelvis, chest, lean):
        M = self.M
        s = self.scale
        px, py = pelvis
        cx, cy = chest
        # الوركين/الحوض
        c.poly([(px - self._s(7.4), py + self._s(2.0)), (px + self._s(7.2), py + self._s(2.0)),
                (px + self._s(8.0), py - self._s(3.2)), (px - self._s(8.2), py - self._s(3.2))], M["uniform"][1])
        # الجذع (شكل شبه منحرف: أعرض عند الكتفين)
        c.poly([(px - self._s(7.8), py - self._s(1.0)), (px + self._s(7.6), py - self._s(1.0)),
                (cx + self._s(10.4), cy + self._s(2.6)), (cx - self._s(10.6), cy + self._s(2.6))], M["uniform"][1])
        c.poly([(px - self._s(7.0), py - self._s(2.4)), (px + self._s(6.8), py - self._s(2.4)),
                (cx + self._s(9.4), cy + self._s(3.6)), (cx - self._s(9.6), cy + self._s(3.6))], M["uniform"][2])
        # قماش مطوي (خطوط تظليل أفقية رفيعة)
        for i in range(1, 3):
            c.line(px - self._s(6.4), py - self._s(3.0 + i * 3.4), px + self._s(6.2),
                   py - self._s(3.0 + i * 3.4), M["uniform"][0], 0.6 * s, 0.30)
        # الدرع الواقي (Vest) بطبقتين
        c.poly([(cx - self._s(8.8), cy + self._s(3.0)), (cx + self._s(8.8), cy + self._s(3.0)),
                (px + self._s(5.4), py - self._s(12.4)), (px - self._s(5.6), py - self._s(12.4))], M["vest"][2])
        c.poly([(cx - self._s(8.6), cy + self._s(3.2)), (cx + self._s(8.6), cy + self._s(3.2)),
                (px + self._s(5.2), py - self._s(12.6)), (px - self._s(5.4), py - self._s(12.6))], M["vest"][1], 0.4)
        # خطوط النسيج (MOLLE) الأفقية على الصدر
        for k in range(3):
            yy = cy + self._s(5.4 + k * 3.4)
            c.rect(cx - self._s(8.4), yy, self._s(16.6), self._s(0.8), M["vest"][4], 0.55)
        c.poly([(cx - self._s(8.4), cy + self._s(3.6)), (cx + self._s(0.8), cy + self._s(3.6)),
                (px - self._s(0.8), py - self._s(12.2)), (px - self._s(5.4), py - self._s(12.2))], M["vest"][3], 0.75)
        c.poly([(cx + self._s(2.4), cy + self._s(3.4)), (cx + self._s(9.2), cy + self._s(3.4)),
                (px + self._s(6.0), py - self._s(11.8)), (px + self._s(3.0), py - self._s(11.8))], M["vest"][1], 0.5)
        # جيوب الذخيرة (3 جيوب) + مشابك
        for i, off in enumerate((-8.6, -5.2, -1.8, 1.6)):
            c.rect(cx + self._s(off), cy + self._s(9.0), self._s(3.0), self._s(3.2), M["strap"][2])
            c.rect(cx + self._s(off + 0.2), cy + self._s(9.2), self._s(2.6), self._s(1.0), M["strap"][3], 0.75)
            c.rect(cx + self._s(off + 0.9), cy + self._s(12.0), self._s(1.0), self._s(1.2), M["metal"][3], 0.9)
        c.rect(cx + self._s(3.0), cy + self._s(4.4), self._s(2.6), self._s(2.6), M["strap"][1])   # جيب صغير أعلى الصدر
        # صفيحة الصدر + الشارة
        c.rect(cx - self._s(3.4), cy + self._s(2.2), self._s(6.0), self._s(2.6), M["vest"][5], 0.7)
        c.rect(cx - self._s(3.2), cy + self._s(2.4), self._s(5.6), self._s(1.0), M["vest"][5], 0.5)
        c.rect(cx + self._s(1.6), cy + self._s(1.2), self._s(3.2), self._s(2.4), M["accent"][3], 0.9)
        # الحزام + خرطوشة/حافظة
        c.rect(px - self._s(8.0), py - self._s(6.4), self._s(15.8), self._s(2.6), M["belt"][2])
        c.rect(px - self._s(8.2), py - self._s(6.6), self._s(15.8), self._s(0.9), M["belt"][3], 0.7)
        c.rect(px + self._s(1.0), py - self._s(6.2), self._s(2.6), self._s(2.4), M["accent"][3])
        c.rect(px + self._s(1.4), py - self._s(5.6), self._s(1.8), self._s(1.2), M["accent"][4], 0.8)
        c.rect(px - self._s(7.0), py - self._s(6.0), self._s(2.6), self._s(4.4), M["strap"][2], 0.9)
        c.rect(px - self._s(6.8), py - self._s(5.6), self._s(2.2), self._s(0.9), M["strap"][3], 0.7)  # حافظة جانبية
        # حمالات الكتف (X-Cross straps)
        c.line(cx - self._s(5.0), cy + self._s(3.0), px + self._s(3.0), py - self._s(6.6), M["strap"][2], 1.6 * s)
        c.line(cx + self._s(4.6), cy + self._s(3.0), px - self._s(3.0), py - self._s(6.6), M["strap"][2], 1.6 * s)
        # الجيت باك / الحقيبة الظهرية (خلف الجسم = يسار الشاشة)
        bw = 7.0 if self.op.style != "heavy" else 8.2
        bh = 12.0 if self.op.style != "heavy" else 13.0
        bx = cx - self._s(6.4) - self._s(bw)
        by = cy + self._s(2.6)
        c.rect(bx, by, self._s(bw), self._s(bh), M["metal"][1], radius=self._s(1.6))
        c.rect(bx + self._s(0.4), by + self._s(0.6), self._s(bw - 1.0), self._s(bh - 1.6), M["metal"][2], 0.9)
        c.rect(bx + self._s(0.4), by + self._s(1.0), self._s(bw - 1.6), self._s(1.6), M["metal"][3], 0.75)
        c.rect(bx + self._s(1.0), by + self._s(4.0), self._s(2.0), self._s(2.0), M["accent"][3], 0.85)
        if self.detail > 1:
            c.rect(bx + self._s(0.8), by + self._s(bh - 5.0), self._s(bw - 2.0), self._s(0.9), M["metal"][0], 0.7)
            c.rect(bx + self._s(0.8), by + self._s(bh - 2.4), self._s(bw - 2.0), self._s(0.9), M["metal"][0], 0.7)
        # فوهتا الدفع
        c.rect(bx + self._s(0.9), by + self._s(bh), self._s(1.9), self._s(2.6), M["metal"][1])
        c.rect(bx + self._s(bw - 2.6), by + self._s(bh), self._s(1.9), self._s(2.6), M["metal"][1])
        c.rect(bx + self._s(1.2), by + self._s(bh + 0.3), self._s(1.3), self._s(1.0), M["metal"][0])
        c.rect(bx + self._s(bw - 2.3), by + self._s(bh + 0.3), self._s(1.3), self._s(1.0), M["metal"][0])
        if self.op.style == "medic":
            c.rect(cx + self._s(3.0), cy + self._s(8.0), self._s(3.4), self._s(3.4), "white_glow")
            c.rect(cx + self._s(4.2), cy + self._s(8.6), self._s(1.0), self._s(2.2), "red_light")
            c.rect(cx + self._s(3.6), cy + self._s(9.2), self._s(2.2), self._s(1.0), "red_light")
        if self.op.style == "engineer":
            c.rect(bx + self._s(1.0), by + self._s(bh - 7.4), self._s(3.4), self._s(2.4), M["accent"][2])
            c.rect(bx + self._s(1.4), by + self._s(bh - 6.8), self._s(2.6), self._s(1.2), M["accent"][4], 0.7)

    # ------------------------------------------------------------- الأعضاء
    def _limb(self, c: D.Canvas, p0, p1, w0, w1, ramp, light=(-0.7, -0.7), sep=0.0):
        """عضو مخروطي مع تظليل جانبي (يمنحه حجماً واضحاً)."""
        s = self.scale
        w0, w1 = w0 * s, w1 * s
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        ln = math.hypot(dx, dy) or 1e-3
        nx, ny = -dy / ln, dx / ln
        c.poly([(p0[0] + nx * w0, p0[1] + ny * w0), (p1[0] + nx * w1, p1[1] + ny * w1),
                (p1[0] - nx * w1, p1[1] - ny * w1), (p0[0] - nx * w0, p0[1] - ny * w0)], ramp[2])
        side = 1.0 if (nx * light[0] + ny * light[1]) > 0 else -1.0
        # الجانب المضاء (خط تدرّج أفتح)
        c.poly([(p0[0] + side * nx * w0 * 0.95, p0[1] + side * ny * w0 * 0.95),
                (p1[0] + side * nx * w1 * 0.95, p1[1] + side * ny * w1 * 0.95),
                (p1[0] + side * nx * w1 * 0.3, p1[1] + side * ny * w1 * 0.3),
                (p0[0] + side * nx * w0 * 0.3, p0[1] + side * ny * w0 * 0.3)], ramp[4], 0.9)
        # الجانب المظلل
        c.poly([(p0[0] - side * nx * w0 * 0.4, p0[1] - side * ny * w0 * 0.4),
                (p1[0] - side * nx * w1 * 0.4, p1[1] - side * ny * w1 * 0.4),
                (p1[0] - side * nx * w1, p1[1] - side * ny * w1),
                (p0[0] - side * nx * w0, p0[1] - side * ny * w0)], ramp[0], 0.6)
        if sep:
            # خطا فصل داكنان على جانبي العضو (يفصل الذراع عن الجذع والساق عن الساق)
            for sgn in (1.0, -1.0):
                c.line(p0[0] + sgn * nx * w0, p0[1] + sgn * ny * w0,
                       p1[0] + sgn * nx * w1, p1[1] + sgn * ny * w1, "#0B0D10", 1.0 * s)
        # خط الركبة/الكوع (تفصيل)
        mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
        c.line(mid[0] - nx * w0 * 0.5, mid[1] - ny * w0 * 0.5,
               mid[0] + nx * w0 * 0.5, mid[1] + ny * w0 * 0.5, ramp[3], 0.5 * s, 0.5)

    def _legs(self, c: D.Canvas, hip_f, hip_b, pose: Pose):
        M, s = self.M, self.scale
        back_u = _darker(M["uniform"])
        knee_b = fk(hip_b, pose.hip_b, L["thigh"], s)
        ankle_b = fk(knee_b, pose.hip_b + pose.knee_b, L["shin"], s)
        knee_f = fk(hip_f, pose.hip_f, L["thigh"], s)
        ankle_f = fk(knee_f, pose.hip_f + pose.knee_f, L["shin"], s)
        # الساق الخلفية
        self._limb(c, hip_b, knee_b, 5.6, 4.6, back_u)
        self._limb(c, knee_b, ankle_b, 4.6, 3.8, back_u)
        c.ellipse(knee_b[0], knee_b[1], self._s(3.4), self._s(3.2), M["vest"][1], 0.9)
        self._boot(c, ankle_b, pose.foot_b, M, back=True)
        # الساق الأمامية
        self._limb(c, hip_f, knee_f, 6.0, 4.9, M["uniform"], sep=1.0)
        self._limb(c, knee_f, ankle_f, 4.9, 4.0, M["uniform"], sep=1.0)
        c.ellipse(knee_f[0], knee_f[1], self._s(3.8), self._s(3.6), M["vest"][2])
        c.ellipse(knee_f[0] + self._s(0.5), knee_f[1] - self._s(0.5), self._s(1.8), self._s(1.6), M["vest"][3], 0.8)
        c.rect(knee_f[0] - self._s(2.2), knee_f[1] - self._s(3.0), self._s(4.4), self._s(1.2), M["vest"][3], 0.6)
        self._boot(c, ankle_f, pose.foot_f, M, back=False)
        # جيوب الفخذ (تفصيل الملابس)
        if self.detail > 1:
            p = ((hip_f[0] + knee_f[0]) / 2, (hip_f[1] + knee_f[1]) / 2)
            c.rect(p[0] + self._s(1.0), p[1] - self._s(1.6), self._s(3.0), self._s(3.4), M["uniform"][0], 0.6)
            c.rect(p[0] + self._s(1.2), p[1] - self._s(1.2), self._s(2.6), self._s(1.0), M["uniform"][3], 0.45)

    def _boot(self, c: D.Canvas, ankle, ang, M, back=False):
        s = self.scale
        a = math.radians(ang)
        ramp = _darker(M["boot"], 0.04) if back else M["boot"]
        t0 = (ankle[0] - self._s(2.6), ankle[1] - self._s(2.0))
        t1 = (ankle[0] + self._s(2.4), ankle[1] - self._s(2.0))
        tip = (ankle[0] + math.sin(a) * self._s(L["foot"] + 1.6) + self._s(2.2),
               ankle[1] + math.cos(a) * self._s(1.8) + self._s(1.4))
        c.poly([t0, t1, (tip[0] + self._s(0.6), tip[1] + self._s(1.0)), (ankle[0] - self._s(2.8), ankle[1] + self._s(2.2))],
               ramp[2])
        c.poly([t0, t1, (tip[0] - self._s(0.6), tip[1] - self._s(0.4)), (ankle[0] - self._s(2.2), ankle[1] - self._s(0.2))],
               ramp[3], 0.75)
        c.rect(ankle[0] - self._s(2.9), ankle[1] + self._s(1.6), self._s(5.6), self._s(1.3), ramp[0])   # النعل
        c.rect(ankle[0] - self._s(3.2), ankle[1] - self._s(3.0), self._s(6.2), self._s(1.6), ramp[1])   # الرباط
        c.rect(ankle[0] - self._s(3.0), ankle[1] - self._s(2.9), self._s(5.8), self._s(0.5), ramp[3], 0.6)
        c.rect(ankle[0] + self._s(1.2), ankle[1] - self._s(0.6), self._s(1.4), self._s(1.2), "mid_gray", 0.7)  # مشبك

    def _arms(self, c: D.Canvas, sh_f, sh_b, pose: Pose, weapon=None):
        """يرسم الذراعين؛ الكف الأمامي هو نقطة تعليق السلاح."""
        M, s = self.M, self.scale
        back_u = _darker(M["uniform"])
        elbow_b = fk(sh_b, pose.sh_b, L["upper_arm"], s)
        hand_b = fk(elbow_b, pose.sh_b + pose.el_b, L["fore_arm"], s)
        # الذراع الخلفية (مع كتف واقٍ)
        c.ellipse(sh_b[0], sh_b[1] - self._s(0.6), self._s(3.6), self._s(3.2), M["vest"][1])
        self._limb(c, sh_b, elbow_b, 4.4, 3.4, back_u)
        self._limb(c, elbow_b, hand_b, 3.4, 2.8, back_u)
        c.ellipse(elbow_b[0], elbow_b[1], self._s(2.0), self._s(1.9), M["vest"][1], 0.8)
        c.ellipse(hand_b[0], hand_b[1], L["hand_r"] * s, L["hand_r"] * s, M["strap"][1])
        c.rect(hand_b[0] - self._s(2.0), hand_b[1] - self._s(2.6), self._s(4.0), self._s(1.4), M["strap"][0], 0.7)
        # حمالة الصدر (تعبر الجسم) — تُرسم أسفل الذراع فتبدو الذراع فوقها
        # الذراع الأمامية
        elbow_f = fk(sh_f, pose.sh_f, L["upper_arm"], s)
        hand_f = fk(elbow_f, pose.sh_f + pose.el_f, L["fore_arm"], s)
        c.ellipse(sh_f[0] + self._s(1.0), sh_f[1] - self._s(0.8), self._s(5.6), self._s(5.0), M["accent"][2])   # لوح الكتف
        c.ellipse(sh_f[0] + self._s(1.4), sh_f[1] - self._s(1.6), self._s(3.8), self._s(3.0), M["accent"][3], 0.8)
        c.ellipse(sh_f[0] - self._s(0.6), sh_f[1] + self._s(1.0), self._s(4.8), self._s(4.2), M["vest"][2])
        self._limb(c, sh_f, elbow_f, 4.6, 3.6, M["uniform"], sep=1.0)
        self._limb(c, elbow_f, hand_f, 3.6, 3.0, M["uniform"], sep=1.0)
        c.ellipse(elbow_f[0], elbow_f[1], self._s(2.2), self._s(2.1), M["vest"][2])               # واقي الكوع
        c.ellipse(elbow_f[0] + self._s(0.5), elbow_f[1] - self._s(0.6), self._s(1.4), self._s(1.2), M["vest"][3], 0.7)
        c.ellipse(hand_f[0], hand_f[1], L["hand_r"] * s, L["hand_r"] * s, M["strap"][2])         # قفاز
        c.ellipse(hand_f[0] + self._s(0.5), hand_f[1] - self._s(0.5), self._s(1.5), self._s(1.5), M["strap"][3], 0.7)
        c.rect(hand_f[0] - self._s(2.2), hand_f[1] - self._s(2.8), self._s(4.4), self._s(1.5), M["strap"][1])
        return hand_f

    # -------------------------------------------------------------- الرسم
    def draw(self, c: D.Canvas, pose: Pose) -> dict:
        """يرسم الشخصية كاملة ويعيد نقاط مفصلية (لتعليق السلاح والجزيئات)."""
        s = self.scale
        base_x, base_y = 40.0 * s + pose.dx * s, 42.0 * s + pose.dy * s
        if pose.prone:
            base_y = 50.0 * s + pose.dy * s
        lean = math.radians(pose.lean)
        chest = (base_x + math.sin(lean) * L["torso"] * s, base_y - math.cos(lean) * L["torso"] * s)
        head = (chest[0] + math.sin(math.radians(pose.lean + pose.head)) * (L["neck"] + 5.4) * s,
                chest[1] - math.cos(math.radians(pose.lean + pose.head)) * (L["neck"] + 5.4) * s)
        hip_f = (base_x + 1.2 * s, base_y + 0.4 * s)
        hip_b = (base_x - 1.6 * s, base_y + 0.4 * s)
        sh_f = (chest[0] + 1.0 * s, chest[1] + 1.6 * s)
        sh_b = (chest[0] - 1.4 * s, chest[1] + 1.4 * s)
        if pose.arm_anchor:
            sh_f = (pose.arm_anchor[0], pose.arm_anchor[1])
        if not self.arms_only:
            if not pose.no_legs:
                self._legs(c, hip_f, hip_b, pose)
            self._torso(c, (base_x, base_y), chest, lean)
            self._head(c, head[0], head[1])
        hand = None
        if pose.show_arms and not self.body_only:
            hand = self._arms(c, sh_f, sh_b, pose)
        if pose.jet:
            bx = chest[0] - 6.4 * s - 6.2 * s + 1.2 * s
            for i, off in enumerate((0.0, 4.4 * s)):
                c.ellipse(bx + off, chest[1] + 17.4 * s, 2.2 * s, 3.8 * s, "fire_orange", 0.9)
                c.ellipse(bx + off, chest[1] + 19.6 * s, 1.5 * s, 2.8 * s, "flame_yellow", 0.95)
                c.ellipse(bx + off, chest[1] + 21.6 * s, 0.9 * s, 1.8 * s, "blast_yellow", 0.9)
        # إضاءة حافية (Rim Light) من أعلى اليسار → تفصل الشخصية عن الخلفية
        if not self.arms_only:
            c.global_light(self.M["uniform"], light_dir=(-0.72, -0.68), amount=0.34)
        return {"hand": hand or (base_x + 6.0 * s, base_y - 4.0 * s), "head": head, "chest": chest,
                "foot_y": base_y + 25.0 * s, "pelvis": (base_x, base_y),
                "shoulder_f": sh_f, "shoulder_b": sh_b}


# ------------------------------------------------------------------ الواجهة
def make_operator_sprite(op: Operator, pose: Pose, size=(96, 78), body_only=False,
                         flip=False, scale: float = 1.0, detail: int = 2,
                         ss: int = D.SS, quant: bool = True, do_outline: bool = True,
                         arms_only: bool = False) -> np.ndarray:
    """يبني سبرايت الشخصية كاملًا: رسم فائق ← تكميم ← حد خارجي.

    body_only=True  → الجسم بلا أذرع (تُرسم الأذرع كإطار مستقل موجّه نحو التصويب).
    arms_only=True  → الأذرع وحدها (تُركّب فوق الجسم في المحرك).
    """
    c = D.Canvas(*size, ss=ss)
    rig = Rig(op, scale=scale, body_only=body_only, detail=detail, arms_only=arms_only)
    rig.draw(c, pose)
    img = c.downsample("nearest")
    if quant:
        img = D.quantize(img, _quant_colors())
    if do_outline:
        img = D.outline(img, "#0B0D10")
    if flip:
        img = img[:, ::-1].copy()
    return img


_QCOL: np.ndarray | None = None


def _quant_colors() -> np.ndarray:
    global _QCOL
    if _QCOL is None:
        cols = [pal.hex_to_rgb(pal.ALL[n]) for n in pal.NAMES]
        for n in ("olive", "sand_light", "mid_gray", "steel_blue", "earth", "blood_red",
                  "fire_orange", "skin_medium", "skin_light", "skin_dark", "skin_deep",
                  "brown_dark", "shadow_gray", "accent_teal", "team_blue", "team_red",
                  "team_green", "team_yellow", "team_purple", "team_orange", "team_white",
                  "light_gray", "brass_yellow", "gold", "rust_light", "concrete",
                  "water_hi", "poison_purple", "glass_hi", "hair", "mouse"):
            pass
        for n in ("olive_dark", "steel_blue", "sand_dark", "olive_light", "hazard_yellow"):
            cols.extend(pal.shade(n, 5, 0.18))
        _QCOL = np.array(cols, dtype=np.float32)
    return _QCOL
