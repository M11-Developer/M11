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


def _grid(img: np.ndarray) -> list[tuple[int, int, int, int]]:
    """يستخرج مستطيلات البلاطات من أي ورقة (نماذج الصور لا تحترم 32×32).

    الطريقة: نجد صفوف المحتوى بالإسقاط الرأسي، ثم نقسم كل صف إلى أعمدة بعدد
    يساوي عرض المحتوى ÷ ارتفاع الصف (لأن البلاطات المولّدة مربّعة عمليًا).
    هذا يعمل حتى لو تلاصقت البلاطات بلا فواصل فارغة بينها.
    """
    a = img[..., 3] > 40
    rows = _runs(a.any(axis=1), min_len=10, gap=3)
    boxes: list[tuple[int, int, int, int]] = []
    for (y0, y1) in rows:
        band = a[y0:y1]
        if band.mean() < 0.12:
            continue
        cols = _runs(band.any(axis=0), min_len=10, gap=3)
        row_h = y1 - y0
        # نقطع كل مقطع أفقي إلى بلاطات مربّعة (العرض ÷ الارتفاع)
        pieces: list[tuple[int, int]] = []
        for (x0, x1) in cols:
            w = x1 - x0
            k = max(1, int(round(w / max(8, row_h * 0.92))))
            step = w / k
            for i in range(k):
                px0 = int(round(x0 + i * step))
                px1 = int(round(x0 + (i + 1) * step))
                if px1 - px0 >= 10:
                    pieces.append((px0, px1))
        for (x0, x1) in pieces:
            sub = a[y0:y1, x0:x1]
            if sub.mean() > 0.22:
                boxes.append((x0, y0, x1 - x0, row_h))
    return boxes


def _to_tile(patch: np.ndarray, size: int = TILE) -> np.ndarray:
    """يختزل بلاطة بأي مقاس إلى 32×32 بـNearest (بلا أي تنعيم)."""
    return np.array(Image.fromarray(patch, "RGBA").resize((size, size), Image.NEAREST))


def slice_one(theme: str, sheet: str) -> dict | None:
    src = os.path.join(RAW, sheet + ".png")
    if not os.path.exists(src):
        return None
    img = np.array(Image.open(src).convert("RGBA"))
    img = strip_chroma_key(img, tol=70)
    img = D.quantize(img, pal.table())
    boxes = _grid(img)
    if not boxes:
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
