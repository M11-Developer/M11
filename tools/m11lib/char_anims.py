"""تعريفات الأنيميشن — كل الوضعيات المطلوبة (القسم 7) مولّدة إجرائيًا.

الأنيميشن هنا **مُعاملي** (Parametric): كل وضعية دالة رياضية في رقم الإطار،
فتحصل على حركة سلسة متسقة بلا رسم يدوي لكل إطار، مع إمكانية إضافة إطارات
بلا حدود. القاعدة الفنية: 12-18 إطارًا/ثانية للعرض + ترجمة بكسلي فرعي في المحرك.
"""
from __future__ import annotations

import math

from .char_rig import L, Pose, fk

TAU = math.pi * 2


def _s(t, phase=0.0, amp=1.0, bias=0.0):
    return bias + amp * math.sin((t * TAU) + phase)


def _c(t, phase=0.0, amp=1.0, bias=0.0):
    return bias + amp * math.cos((t * TAU) + phase)


def _bump(t, center=0.5, width=0.35):
    """نبضة ناعمة (0..1) حول مركز معيّن — لحركات الضربة/الاندفاع."""
    d = abs(((t - center + 0.5) % 1.0) - 0.5)
    return max(0.0, 1.0 - (d / width) ** 2)


# ---------------------------------------------------------------- الوضعيات
def p_idle(f, n):
    """وقوف: تنفّس + نقل وزن خفيف."""
    t = f / n
    breathe = _s(t, 0, 0.8)
    return Pose(lean=1.6 + _s(t, 0, 0.6), hip_f=1.5 + _s(t, 0, 0.8),
                hip_b=-1.5 - _s(t, 0, 0.8), knee_f=2.0, knee_b=-2.5,
                sh_f=6 + breathe * 0.4, el_f=-14, sh_b=-8, el_b=-16,
                dy=-breathe * 0.5, head=_s(t, 0, 0.9, 0.4))


def p_walk(f, n):
    t = f / n
    return Pose(lean=3.2, hip_f=_s(t, 0, 22, 2), knee_f=max(0, _s(t, -0.6, 26, 10)),
                hip_b=_s(t, math.pi, 22, 2), knee_b=max(0, _s(t, math.pi - 0.6, 24, 8)),
                foot_f=_s(t, 0.4, -12, 6), foot_b=_s(t, math.pi, -10, 4),
                sh_f=_s(t, math.pi, 16, 8), el_f=-16 - _s(t, math.pi, 8, 0),
                sh_b=_s(t, 0, 16, -8), el_b=-14 + _s(t, 0, 8, 0),
                dy=-abs(_s(t, 0.0, 0.9)), head=1.0)


def p_run(f, n):
    t = f / n
    return Pose(lean=9.0, hip_f=_s(t, 0, 34, 6), knee_f=max(0, _s(t, -0.7, 46, 18)),
                hip_b=_s(t, math.pi, 32, 2), knee_b=max(0, _s(t, math.pi - 0.7, 42, 14)),
                foot_f=_s(t, 0.4, -18, 10), foot_b=_s(t, math.pi, -16, 6),
                sh_f=_s(t, math.pi, 30, 16), el_f=-48 - _s(t, math.pi, 14, 0),
                sh_b=_s(t, 0, 28, -14), el_b=-44 + _s(t, 0, 12, 0),
                dy=-1.4 - abs(_s(t, 0.1, 1.4)), head=2.5)


def p_sprint(f, n):
    p = p_run(f, n)
    return p.copy(lean=15.0, hip_f=p.hip_f * 1.15, hip_b=p.hip_b * 1.15, dy=p.dy - 0.6, head=5.5)


def p_jump(f, n):
    """قفزة: 3 إطارات (تحضير/ارتفاع/هبوط)."""
    k = f / max(1, n - 1)
    return Pose(lean=4 - 6 * k, hip_f=-16 + 26 * k, hip_b=18 - 30 * k,
                knee_f=34 - 20 * k, knee_b=40 - 26 * k, foot_f=10 - 16 * k,
                sh_f=-24 + 40 * k, el_f=-34, sh_b=-18 + 22 * k, el_b=-30,
                dy=-2.5 * k, head=1)


def p_fall(f, n):
    k = f / max(1, n - 1)
    return Pose(lean=5, hip_f=-10 - 12 * k, hip_b=8 + 14 * k, knee_f=26 + 10 * k,
                knee_b=30 + 12 * k, foot_f=-6, sh_f=14 + 12 * k, el_f=-40,
                sh_b=-14, el_b=-36, head=2, dy=0.5 * k)


def p_jetpack(f, n):
    """طيران بالجيت باك: جسم مائل، أرجل مرتدّة، نار خلفية."""
    t = f / n
    return Pose(lean=16 + _s(t, 0, 2.2), hip_f=-14 + _s(t, 0, 5), hip_b=6 + _s(t, math.pi, 5),
                knee_f=22 + _s(t, 0.6, 6), knee_b=30 + _s(t, math.pi, 6),
                foot_f=-10, foot_b=-6, sh_f=-16 + _s(t, 0, 3), el_f=-40,
                sh_b=-10 + _s(t, math.pi, 3), el_b=-34, jet=True,
                dy=-1.0 + _s(t, 0, 0.5), head=4)


def p_prone(f, n):
    """انبطاح: الجسم أفقي قرب الأرض."""
    return Pose(lean=76, hip_f=-96, hip_b=-88, knee_f=6, knee_b=10, foot_f=16, foot_b=12,
                sh_f=-70, el_f=-10, sh_b=-64, el_b=-12, prone=True, head=-24, dy=1.0)


def p_crawl(f, n):
    t = f / n
    return Pose(lean=74 + _s(t, 0, 3), hip_f=-92 + _s(t, 0, 16), hip_b=-84 + _s(t, math.pi, 16),
                knee_f=8 + max(0, _s(t, 0.5, 18)), knee_b=10 + max(0, _s(t, math.pi + 0.5, 18)),
                sh_f=-66 + _s(t, math.pi, 10), el_f=-14, sh_b=-60 + _s(t, 0, 10), el_b=-16,
                prone=True, head=-22, dy=1.4)


def p_slide(f, n):
    k = f / max(1, n - 1)
    return Pose(lean=34 + 10 * k, hip_f=52, knee_f=-16, hip_b=-6, knee_b=64, foot_f=-20,
                foot_b=10, sh_f=-30, el_f=-30, sh_b=-40, el_b=-24, dy=6.0, head=-6)


def p_roll(f, n):
    t = f / n
    return Pose(lean=_c(t * 2, 0, 55, 10), hip_f=40 + _s(t, 0, 30), knee_f=max(0, _s(t, -0.5, 70, 40)),
                hip_b=30 + _s(t, math.pi, 30), knee_b=max(0, _s(t, math.pi - 0.5, 70, 40)),
                sh_f=-20, el_f=-70, sh_b=-30, el_b=-70, dy=6.5 - 2.0 * abs(_s(t, 0, 1)), head=-20)


def p_climb(f, n):
    t = f / n
    return Pose(lean=-14, hip_f=_s(t, 0, 26, 14), knee_f=max(0, _s(t, -0.5, 40, 26)),
                hip_b=_s(t, math.pi, 26, 14), knee_b=max(0, _s(t, math.pi - 0.5, 40, 26)),
                sh_f=_s(t, math.pi, 40, -58), el_f=-20, sh_b=_s(t, 0, 40, -52), el_b=-18,
                dy=-3.0 + _s(t, 0, 1.2), head=-8)


def p_walljump(f, n):
    k = f / max(1, n - 1)
    return Pose(lean=-22 + 40 * k, hip_f=-30 - 14 * k, hip_b=24 + 16 * k, knee_f=40, knee_b=44,
                sh_f=-46 + 20 * k, el_f=-30, sh_b=-30, el_b=-34, dy=-1.5 + 3 * k, head=-10 + 14 * k)


def p_ledge(f, n):
    """تشبّت بحافة: ذراعان ممدودتان للأعلى، الجسم معلّق."""
    k = f / max(1, n - 1)
    return Pose(lean=-6 + 8 * k, hip_f=18 + 10 * k, hip_b=-6 - 10 * k, knee_f=44, knee_b=20,
                sh_f=-104 + 12 * k, el_f=-14, sh_b=-96 + 14 * k, el_b=-16,
                dy=-6.0 + 1.5 * k, head=-14)


def p_dbno(f, n):
    """مُطرح (DBNO): زحف ضعيف على الأرض."""
    t = f / n
    return Pose(lean=68 + _s(t, 0, 6), hip_f=-84 + _s(t, 0, 10), hip_b=-76 + _s(t, math.pi, 10),
                knee_f=14, knee_b=18, sh_f=-52 + _s(t, math.pi, 12), el_f=-18,
                sh_b=-48 + _s(t, 0, 12), el_b=-20, prone=True, head=-18 + _s(t, 0, 4), dy=2.2)


def p_death(f, n, variant=0):
    k = f / max(1, n - 1)
    if variant == 0:      # سقوط للخلف
        return Pose(lean=-10 - 70 * k, hip_f=-40 * k, hip_b=20 * k, knee_f=30 + 40 * k,
                    knee_b=40 + 30 * k, sh_f=-40 * k, el_f=-20, sh_b=30 * k, el_b=-30,
                    dy=10 * k, head=-30 * k)
    if variant == 1:      # سقوط للأمام
        return Pose(lean=30 + 60 * k, hip_f=-60 * k, hip_b=-40 * k, knee_f=20 + 50 * k,
                    knee_b=30 + 40 * k, sh_f=-60 * k, el_f=-40, sh_b=-50 * k, el_b=-40,
                    dy=12 * k, head=20 * k)
    # تدوّم ثم سقوط جانبي
    return Pose(lean=20 * math.sin(k * math.pi) - 50 * k, hip_f=-30 * k, hip_b=30 * k,
                knee_f=40 * k, knee_b=50 * k, sh_f=-20 + 40 * k, el_f=-30, sh_b=-40 * k,
                el_b=-20, dy=11 * k, head=-24 * k)


def p_win(f, n):
    t = f / n
    return Pose(lean=-6 + _s(t, 0, 3), hip_f=_s(t, 0, 6, 4), hip_b=-_s(t, 0, 6, 4),
                knee_f=4, knee_b=4, sh_f=-140 + _s(t, 0, 10), el_f=-26,
                sh_b=-30 + _s(t, math.pi, 12), el_b=-30, dy=-1.5 - abs(_s(t, 0, 1.5)), head=-6)


def p_taunt(f, n):
    t = f / n
    return Pose(lean=2, hip_f=6, hip_b=-6, knee_f=6, knee_b=4,
                sh_f=-90 - _s(t * 2, 0, 30), el_f=-60, sh_b=-20, el_b=-40,
                dy=-abs(_s(t, 0, 1.0)), head=_s(t * 2, 0, 8))


def p_throw(f, n):
    """رمي قنبلة: دورة تحضير ← إطلاق ← متابعة."""
    k = f / max(1, n - 1)
    if k < 0.4:
        u = k / 0.4
        return Pose(lean=-4 + 8 * u, sh_f=-130 + 20 * u, el_f=-90 + 30 * u,
                    sh_b=-70 + 20 * u, el_b=-60, hip_f=6, hip_b=-6, dy=-1.0 * u, head=-4)
    u = (k - 0.4) / 0.6
    return Pose(lean=6 - 10 * u, sh_f=-110 + 60 * u, el_f=-60 + 30 * u,
                sh_b=-50 + 40 * u, el_b=-50 + 20 * u, hip_f=8 - 6 * u, hip_b=-8 + 6 * u,
                dy=-1.2 + 2.2 * u, head=-2 + 6 * u)


def p_melee(f, n):
    """ضربة مشاجرة: شحن ثم ضربة أفقية."""
    k = f / max(1, n - 1)
    swing = math.sin(min(1.0, k * 1.6) * math.pi)
    return Pose(lean=-6 + 14 * k, sh_f=-70 + 110 * swing, el_f=-80 + 60 * swing,
                sh_b=-30 + 20 * swing, el_b=-50, hip_f=10 * (1 - k), hip_b=-10 * (1 - k),
                knee_f=8, knee_b=8, dy=-1.0 * swing, head=4 * k)


def p_reload(f, n):
    k = f / max(1, n - 1)
    dip = math.sin(k * math.pi)
    return Pose(lean=4 + 4 * dip, sh_f=-52 + 26 * dip, el_f=-70 + 40 * dip,
                sh_b=-40 + 18 * dip, el_b=-60 + 30 * dip, hip_f=4, hip_b=-4, dy=dip * 1.2, head=6 * dip)


def p_heal(f, n):
    k = f / max(1, n - 1)
    dip = math.sin(k * math.pi)
    return Pose(lean=6 + 6 * dip, sh_f=-70 + 40 * dip, el_f=-100 + 30 * dip,
                sh_b=-20, el_b=-30, hip_f=5, hip_b=-5, knee_f=10 * dip, knee_b=-10 * dip,
                dy=2.5 * dip, head=14 * dip)


def p_revive(f, n):
    k = f / max(1, n - 1)
    dip = math.sin(k * math.pi)
    return Pose(lean=44 + 10 * dip, hip_f=-46 + 8 * dip, hip_b=-40 + 8 * dip, knee_f=52, knee_b=58,
                sh_f=-96 + 10 * dip, el_f=-24, sh_b=-92 + 10 * dip, el_b=-26,
                dy=6.5, head=10)


def p_switch(f, n):
    k = f / max(1, n - 1)
    dip = math.sin(k * math.pi)
    return Pose(lean=3, sh_f=-30 - 24 * dip, el_f=-60 - 20 * dip, sh_b=-20 - 18 * dip,
                el_b=-50, hip_f=3, hip_b=-3, dy=dip * 0.8, head=4 * dip)


def p_swim(f, n):
    t = f / n
    return Pose(lean=72 + _s(t, 0, 4), hip_f=-88 + _s(t, 0, 22), hip_b=-80 + _s(t, math.pi, 22),
                knee_f=10 + max(0, _s(t, 0.4, 24)), knee_b=12 + max(0, _s(t, math.pi + 0.4, 24)),
                sh_f=-60 + _s(t, math.pi, 30), el_f=-30, sh_b=-56 + _s(t, 0, 30), el_b=-28,
                prone=True, head=-16, dy=1.0)


def p_drive(f, n):
    k = f / max(1, n - 1)
    return Pose(lean=26, hip_f=-40, hip_b=-30, knee_f=56, knee_b=64, sh_f=-64, el_f=-24,
                sh_b=-58, el_b=-26, dy=4.0 + 0.6 * math.sin(k * math.pi), head=4)


def p_victory(f, n):
    """احتفال بالفوز: قفزة + رفع السلاح."""
    t = f / n
    hop = abs(_s(t, 0, 4))
    return Pose(lean=-8, hip_f=-8 + _s(t, 0, 12), hip_b=4 - _s(t, 0, 12), knee_f=20 + hop,
                knee_b=16 + hop, sh_f=-150 - _s(t * 2, 0, 12), el_f=-20,
                sh_b=-40, el_b=-30, dy=-hop, head=-10)


# اسم الأنيميشن ← (عدد الإطارات, دالة, إطارات/ثانية مقترحة)
ANIMS: dict[str, tuple[int, object, int]] = {
    "idle": (6, p_idle, 12), "walk": (8, p_walk, 12), "run": (8, p_run, 14),
    "sprint": (8, p_sprint, 16), "jump": (3, p_jump, 14), "fall": (3, p_fall, 12),
    "jetpack": (6, p_jetpack, 14), "prone": (1, p_prone, 8), "crawl": (6, p_crawl, 10),
    "slide": (2, p_slide, 12), "roll": (5, p_roll, 16), "climb": (6, p_climb, 12),
    "walljump": (3, p_walljump, 14), "ledge": (2, p_ledge, 10), "dbno": (2, p_dbno, 6),
    "death0": (6, lambda f, n: p_death(f, n, 0), 10),
    "death1": (6, lambda f, n: p_death(f, n, 1), 10),
    "death2": (6, lambda f, n: p_death(f, n, 2), 10),
    "win": (6, p_win, 12), "victory": (6, p_victory, 12), "taunt": (6, p_taunt, 12),
    "throw": (6, p_throw, 14), "melee": (5, p_melee, 16), "reload": (6, p_reload, 12),
    "heal": (6, p_heal, 12), "revive": (6, p_revive, 12), "switch": (4, p_switch, 14),
    "swim": (6, p_swim, 10), "drive": (3, p_drive, 10), "sprintfire": (8, p_sprint, 16),
}

# الوضعيات التي تحتاج ذراع تصويب مستقلة (تُرسم فوق الجسم) + نقطة الكتف + مدى الذراع
AIM_POSTURES: dict[str, dict] = {
    "stand": dict(anchor=(27.2, 29.4), reach=11.4, base_anim="idle", dy=0.0),
    "crouch": dict(anchor=(27.0, 34.5), reach=11.0, base_anim="prone", dy=0.0),
    "prone": dict(anchor=(27.6, 53.0), reach=11.6, base_anim="prone", dy=0.0),
    "jet": dict(anchor=(27.6, 30.0), reach=11.4, base_anim="jetpack", dy=0.0),
}

AIM_ANGLES = [0, 15, 30, 45, 60, 90, 120, 135, 150, 165, 180, -15, -30, -45, -60, -90,
              -120, -135, -150, -165]  # درجات: 0 = يمين أفقي، 90 = لأسفل، -90 = لأعلى


def arm_pose(posture: str, angle_deg: float) -> Pose:
    """يحسب زوايا الكتف/المرفق بالـ IK ليجعل الكف على امتداد زاوية التصويب.

    الشكل الناتج: الذراعان (أمامية + خلفية) تمسكان السلاح باتجاه الزاوية.
    """
    a = math.radians(angle_deg)
    dx, dy = math.cos(a), math.sin(a)
    sh_f = math.degrees(math.atan2(dx, dy))       # زاوية الذراع من الأسفل نحو الأمام
    return Pose(sh_f=sh_f, el_f=-14, sh_b=sh_f - 9, el_b=-12, show_arms=True)


META = dict(
    canvas=(74, 76), baseline=64.0, center_x=26.0,
    anims={k: dict(frames=v[0], fps=v[2]) for k, v in ANIMS.items()},
    aim_postures=AIM_POSTURES, aim_angles=AIM_ANGLES, limb=L,
)
