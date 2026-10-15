"""فاحص السبرايت — يحوّل الصورة إلى خريطة ASCII + مقاييس كمية.

أداة تطوير (Dev tool) تُستخدم لضبط جودة الرسم: تطبع شكل السبرايت كحروف بحسب
المادة اللونية، مع أرقام النسب (الرأس/الجذع/الأرجل) وعرض الكتلة في كل صف.
هكذا نضبط الشكل بلا الحاجة لعرض صور في كل مرة.

الاستخدام:
    python3 -m m11lib.inspect_sprite            # يفحص شخصية نموذجية
"""
from __future__ import annotations

import sys

import numpy as np

from . import char_anims as CA
from . import char_rig as CR
from . import palette as pal

CLASSES = [
    ("#0B0D10", "."), ("#1B2028", "d"), ("#242B36", "d"),
    ("#3A4453", "m"), ("#6B7A8F", "m"), ("#93A3B8", "m"),
    ("#EAF2FF", "w"), ("#FFFFFF", "w"),
]


def classify(px) -> str:
    """يصنّف بكسلًا إلى فئة مادة: s=بشرة، u=زي، m=معدن، a=تمييز، r=أحمر، o=نار، . =فراغ."""
    if px[3] < 64:
        return " "
    r, g, b = int(px[0]), int(px[1]), int(px[2])
    if r < 45 and g < 45 and b < 50:
        return "#"      # الحدود/الأسود
    # بشرة: أحمر > أزرق بوضوح وليس مشبعًا جدًا
    if r > 110 and r > g > b and (r - b) > 35 and g > 90 and b > 60 and r < 240:
        if not (r > 150 and g < 110):
            return "s"
    if r > 150 and g < 110 and b < 110:
        return "r"      # أحمر قوي (دم/تمييز)
    if r > 180 and g > 110 and b < 110:
        return "o"      # نار/برتقالي
    if r > 200 and g > 190 and b < 150:
        return "y"      # ذهبي/أصفر
    if g >= r and g >= b and (g - b) > 18:
        return "u"      # أخضر زي
    if b > r and b > g and b > 90:
        return "b"      # أزرق/فولاذي
    return "m"          # رمادي/معدن


def ascii_map(img: np.ndarray, x0=0, x1=None, y0=0, y1=None, step=1) -> str:
    a = img[..., 3] > 64
    ys, xs = np.where(a)
    if len(ys) == 0:
        return "(فارغ)"
    y0 = max(0, ys.min() - 1) if y0 == 0 else y0
    y1 = min(img.shape[0], ys.max() + 2) if y1 is None else y1
    x0 = max(0, xs.min() - 1) if x0 == 0 else x0
    x1 = min(img.shape[1], xs.max() + 2) if x1 is None else x1
    out = []
    for y in range(y0, y1, step):
        row = "".join(classify(img[y, x]) for x in range(x0, x1, step))
        out.append(f"{y:3d} |{row}|")
    return "\n".join(out)


def metrics(img: np.ndarray) -> dict:
    a = img[..., 3] > 64
    ys, xs = np.where(a)
    if len(ys) == 0:
        return {}
    top, bot = int(ys.min()), int(ys.max())
    h = bot - top + 1
    widths = [int(a[y].sum()) for y in range(top, bot + 1)]
    # أعرض صف = الكتفان/الذراعان
    m = {
        "height": h, "width": int(xs.max() - xs.min() + 1),
        "top": top, "bottom": bot,
        "max_row_width": max(widths), "avg_row_width": round(float(np.mean(widths)), 1),
        "fill_ratio": round(float(a.sum()) / (h * (xs.max() - xs.min() + 1)), 3),
        "colors": int(len(np.unique(img[a][:, :3], axis=0))),
    }
    # تقدير مواقع الأقسام: الرأس (أول 25%)، الجذع (25-55%)، الأرجل (55-100%)
    m["head_rows"] = widths[:max(1, h // 4)]
    return m


def main():
    op = CR.OP_BY_KEY[sys.argv[1]] if len(sys.argv) > 1 else CR.OPERATORS[0]
    anim = sys.argv[2] if len(sys.argv) > 2 else "idle"
    frame = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    n, fn, _ = CA.ANIMS[anim]
    pose = fn(frame % n, n)
    img = CR.make_operator_sprite(op, pose)
    print(f"=== {op.name_ar} ({op.key}) / {anim} #{frame} ===")
    print(ascii_map(img))
    print(metrics(img))
    counts = {}
    for y in range(img.shape[0]):
        for x in range(img.shape[1]):
            c = classify(img[y, x])
            if c != " ":
                counts[c] = counts.get(c, 0) + 1
    print("توزيع الفئات:", counts)


if __name__ == "__main__":
    main()
