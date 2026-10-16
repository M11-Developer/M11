#!/usr/bin/env python3
"""يقصّ مجموعات التايلات المولّدة (32×32) إلى أطالس يستعملها المحرّك مباشرة.

المدخل : `project/assets/raw/tileset_*.png` (خلفية ماجنتا، بلاطات 32×32 في صفوف)
المخرج : `project/assets/atlases/tiles_<theme>.png` + `.json` (بأسماء إطارات
         مطابقة تمامًا لما يبحث عنه المحرّك: `tile/<theme>/solid`, `solid_1` … إلخ)
         + نسخة في `web/assets/`.

الفكرة: المحرّك (renderer.js) يبحث أولًا عن أطلس `tiles_<theme>`، فإن وُجد استخدم
بلاطات الذكاء الاصطناعي، وإلا رجع إلى الأطلس البرمجي `world` كما كان — أي أن
إضافة أي مجموعة تايلات جديدة مستقبلًا لا تحتاج لمسّ أي سطر كود.

التشغيل:  python3 tools/slice_tilesets.py
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from m11lib import atlas as atlaslib          # noqa: E402
from m11lib import draw as D                  # noqa: E402
from m11lib import palette as pal             # noqa: E402
from process_asset import strip_chroma_key    # noqa: E402

RAW = os.path.join(ROOT, "project", "assets", "raw")
PROCESSED = os.path.join(ROOT, "project", "assets", "processed")
ATLAS_DIR = os.path.join(ROOT, "project", "assets", "atlases")
WEB_DIR = os.path.join(ROOT, "web", "assets")
TILE = 32

# theme → ملف المصدر. الأسماء تُطابق ثيمات الخرائط في اللعبة (world.js / world.gd)
SHEETS: dict[str, str] = {
    "urban": "tileset_urban",
    "cave": "tileset_cave",
    "port": "tileset_port",
    "swamp": "tileset_swamp",
    "snow": "tileset_snow",
    "space": "tileset_space",
    "industrial": "tileset_military",
    "sand": "tileset_desert",
    "ship": "tileset_ship_interior",
    "deck": "tileset_deck_naval",       # سطح سفينة حربية (خريطة sea_deck)
    "village": "tileset_village_clay",  # القرية الطينية (خريطة village)
}

# ترتيب الأسماء داخل كل مجموعة (البلاطات تُقرأ يسارًا→يمينًا، أعلى→أسفل).
# أي بلاطة زائدة عن القائمة تُسمّى extra_N — فلا يُهمَل شيء أبدًا.
NAMES = ["solid", "solid_1", "solid_2", "top", "top_1", "top_2",
         "back", "back_1", "back_2", "platform", "piece", "piece_1"]


def _runs(proj: np.ndarray, min_len: int, gap: int = 2) -> list[tuple[int, int]]:
    """يحوّل إسقاطًا منطقيًا (وجود محتوى) إلى مقاطع [بداية، نهاية) متّصلة."""
    runs = []
    i = 0
    n = len(proj)
    while i < n:
        if proj[i]:
            j = i
            holes = 0
            k = i
            while k < n:
                if proj[k]:
                    j = k
                    holes = 0
                else:
                    holes += 1
                    if holes > gap:
                        break
                k += 1
            if j - i + 1 >= min_len:
                runs.append((i, j + 1))
            i = j + 1
        else:
            i += 1
    return runs


def _bands(proj: np.ndarray, thresh: float) -> list[tuple[int, int]]:
    """يجد مقاطع «الفصل» (أعمدة/صفوف خلفية شبه كاملة) من إسقاط الخلفية."""
    out, i, n = [], 0, len(proj)
    while i < n:
        if proj[i] >= thresh:
            j = i
            while j < n and proj[j] >= thresh:
                j += 1
            out.append((i, j))
            i = j
        else:
            i += 1
    return out


def _split_x(mask: np.ndarray, min_cell: int = 40) -> list[tuple[int, int]]:
    """يقسّم العرض إلى خلايا (أعمدة) عبر مقاطع الخلفية العمودية."""
    bg = (~mask).mean(axis=0)          # ملف تعريفي بطول العرض (محور x)
    return _cells(_bands(bg, 0.7), mask.shape[1], min_cell)


def _split_y(mask: np.ndarray, min_cell: int = 40) -> list[tuple[int, int]]:
    """يقسّم الارتفاع إلى خلايا (صفوف) عبر مقاطع الخلفية الأفقية."""
    bg = (~mask).mean(axis=1)          # ملف تعريفي بطول الارتفاع (محور y)
    return _cells(_bands(bg, 0.7), mask.shape[0], min_cell)


def _cells(seps: list[tuple[int, int]], size: int, min_cell: int) -> list[tuple[int, int]]:
    """يحوّل مقاطع الفصل إلى حدود خلايا، ثم يدمج الخلايا الأنحف من الحد الأدنى."""
    edges = [0]
    for a, b in seps:
        if a > 0 and b < size:
            edges.append((a + b) // 2)
    edges.append(size)
    raw = [(edges[i], edges[i + 1]) for i in range(len(edges) - 1) if edges[i + 1] - edges[i] >= 6]
    merged: list[list[int]] = []
    for a, b in raw:
        if merged and (b - a) < min_cell:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    return [(a, b) for a, b in merged if b - a >= min_cell // 2]


def _grid(img: np.ndarray) -> list[tuple[int, int, int, int]]:
    """يستخرج مستطيلات البلاطات من أي ورقة بلاطات (لا نفترض مقاس 32×32 أبدًا).

    الطريقة: نجد مقاطع الخلفية الفاصلة على المحورين (لأن كل الأوراق المولّدة تحتوي
    فجوات)، فتصير الخلايا هي التقاطع بين مقاطع الأعمدة ومقاطع الصفوف. ثم نقصّ محتوى
    كل خلية وحده. أي ورقة بلا فجوات تعود لشبكة واحدة (بلاطة واحدة) بلا خطأ.
    """
    a = img[..., 3] > 40
    rows = _split_y(a)          # نطاقات y (صفوف)
    cols = _split_x(a)          # نطاقات x (أعمدة)
    boxes: list[tuple[int, int, int, int]] = []
    for (y0, y1) in rows:
        for (x0, x1) in cols:
            sub = a[y0:y1, x0:x1]
            if sub.mean() < 0.10:
                continue
            ys = np.where(sub.any(axis=1))[0]
            xs = np.where(sub.any(axis=0))[0]
            if len(ys) < 8 or len(xs) < 8:
                continue
            boxes.append((x0 + int(xs[0]), y0 + int(ys[0]),
                          int(xs[-1] - xs[0] + 1), int(ys[-1] - ys[0] + 1)))
    return boxes


def _to_tile(patch: np.ndarray, size: int = TILE) -> np.ndarray:
    """يختزل بلاطة بأي مقاس إلى 32×32 بـNearest (بلا أي تنعيم)."""
    return np.array(Image.fromarray(patch, "RGBA").resize((size, size), Image.NEAREST))


def _dominant_key(img: np.ndarray, tol: int = 46) -> np.ndarray:
    """يزيل خلفية لون سائد من إطار الصورة (حتى لو لم تكن ماجنتا صافية).

    نماذج الصور ترسم أحيانًا ماجنتا «مغبّرة» مثل (211,34,122) أو (182,63,133)،
    فلا يلتقطها مفتاح الماجنتا الصافي. الحل: نأخذ وسيط ألوان إطار الصورة (بكسلين
    من كل حافة) كخلفية، ونُزيل كل ما يقاربه. وإن لم يكن الإطار موحّدًا نُرجع الصورة كما هي.
    """
    out = img.copy()
    b = 2
    edge = np.concatenate([out[:b].reshape(-1, 4), out[-b:].reshape(-1, 4),
                           out[:, :b].reshape(-1, 4), out[:, -b:].reshape(-1, 4)])
    key = np.median(edge[:, :3], axis=0)
    far = np.abs(edge[:, :3].astype(np.int16) - key.astype(np.int16)).max(axis=1)
    if (far <= tol).mean() < 0.55:      # الإطار غير موحّد ⇒ لا نخاطر
        return out
    rgb = out[..., :3].astype(np.int16)
    d = np.abs(rgb - key.astype(np.int16)).max(axis=2)
    out[d <= tol, 3] = 0
    out[(d > tol) & (d <= tol * 2), 3] = np.minimum(out[(d > tol) & (d <= tol * 2), 3], 128)
    return out


def slice_one(theme: str, sheet: str) -> dict | None:
    # نفضّل الملف المعالَج (شفافية حقيقية + ألوان مكمَّمة)، وإلا نعالج الخام هنا
    src = os.path.join(PROCESSED, sheet + ".png")
    if not os.path.exists(src):
        src = os.path.join(RAW, sheet + ".png")
        if not os.path.exists(src):
            return None
        img = np.array(Image.open(src).convert("RGBA"))
        img = _dominant_key(strip_chroma_key(img, tol=70))
        img = D.quantize(img, pal.table())
    else:
        img = np.array(Image.open(src).convert("RGBA"))
    boxes = _grid(img)
    if not boxes:
        print(f"   ⚠ {sheet}: لم أجد بلاطات — تحقّق من الخلفية")
        return None
    frames: dict[str, np.ndarray] = {}
    for i, (x, y, w, h) in enumerate(boxes):
        name = NAMES[i] if i < len(NAMES) else f"extra_{i}"
        frames[f"tile/{theme}/{name}"] = _to_tile(img[y:y + h, x:x + w])
    info = atlaslib.pack_frames(f"tiles_{theme}", frames, ATLAS_DIR, scale=1, pad=2)
    with open(os.path.join(ATLAS_DIR, f"{sheet}_meta.json"), "w", encoding="utf-8") as f:
        json.dump({"theme": theme, "tiles": len(frames), "names": list(frames.keys())},
                  f, ensure_ascii=False, separators=(",", ":"))
    # نسخة الويب
    os.makedirs(WEB_DIR, exist_ok=True)
    for ext in (".png", ".json"):
        s = os.path.join(ATLAS_DIR, f"tiles_{theme}{ext}")
        if os.path.exists(s):
            with open(s, "rb") as fi, open(os.path.join(WEB_DIR, f"tiles_{theme}{ext}"), "wb") as fo:
                fo.write(fi.read())
    return {"theme": theme, "tiles": len(frames), "size": info["size"],
            "mb": round(os.path.getsize(info["png"]) / 1048576, 3)}


def main() -> int:
    total = 0
    out = []
    for theme, sheet in SHEETS.items():
        r = slice_one(theme, sheet)
        if not r:
            print(f"… {theme:11s} لا ملف مصدر ({sheet})")
            continue
        total += r["tiles"]
        out.append(r)
        print(f"✓ {theme:11s} {r['tiles']:3d} بلاطة → {r['size'][0]}×{r['size'][1]} ({r['mb']} MB)")
    man = os.path.join(ATLAS_DIR, "tiles_manifest.json")
    with open(man, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    with open(os.path.join(WEB_DIR, "tiles_manifest.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"✓ الإجمالي: {len(out)} ثيمًا، {total} بلاطة")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
