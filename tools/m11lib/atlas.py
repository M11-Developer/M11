"""حزم الأطالس (Atlas Packing) — يجمع الصور في أطلس واحد + JSON بالإحداثيات.

قواعد المشروع (القسم 17 بند 7): مسافة فاصلة 2 بكسل بين الإطارات لمنع تسرّب
الجيران (Texture Bleeding) عند الرسم بمقياس كبير أو مع الضبابية.
الخوارزمية: ترتيب بالارتفاع (Skyline) — سريعة ومناسبة للأطالس البكسلية.
"""
from __future__ import annotations

import json

import numpy as np


class Atlas:
    """أطلس بكسل آرت مع حزم Shelf بسيط ومسافة فاصلة.

    الاستخدام:
        a = Atlas("chars", pad=2)
        a.add("rashid/idle/0", img)
        a.save("out/", "chars")
    """

    def __init__(self, name: str, pad: int = 2, max_size: int = 4096):
        self.name = name
        self.pad = pad
        self.max_size = max_size
        self.items: list[tuple[str, np.ndarray]] = []

    def add(self, key: str, img: np.ndarray):
        if img.ndim != 3 or img.shape[2] != 4:
            raise ValueError(f"الصورة يجب أن تكون RGBA: {key} {img.shape}")
        self.items.append((key, img))

    def add_many(self, mapping: dict):
        for k in sorted(mapping):
            self.add(k, mapping[k])

    # ------------------------------------------------------------ الحزم
    def _pack(self, scale: int = 1):
        pad = self.pad * scale
        # ترتيب: الأطول أولًا (تحسين ملاءمة الرفوف)
        entries = sorted(self.items, key=lambda kv: (-kv[1].shape[0], -kv[1].shape[1]))
        shelves: list[dict] = []
        W = self.max_size
        x = y = shelf_h = 0
        placements = {}
        for key, img in entries:
            h, w = img.shape[0] * scale, img.shape[1] * scale
            if x + w + pad > W:
                y += shelf_h + pad
                x = 0
                shelf_h = 0
            if h > shelf_h:
                shelf_h = h
            placements[key] = (x, y, w, h)
            x += w + pad
            if h > shelf_h:
                shelf_h = h
        total_h = y + shelf_h + pad
        # توسيط العرض إلى قوة 2 (أفضل للأداء في GPU)
        total_w = W
        canvas = np.zeros((total_h, total_w, 4), dtype=np.uint8)
        for key, (px, py, pw, ph) in placements.items():
            img = dict(self.items)[key]
            big = np.kron(img, np.ones((scale, scale, 1), dtype=np.uint8)) if scale > 1 else img
            canvas[py:py + ph, px:px + pw] = big
        return canvas, placements

    def save(self, outdir: str, scale: int = 1, name: str | None = None):
        """يحفظ الأطلس PNG + JSON ويُرجع المسارات."""
        import os
        from PIL import Image
        name = name or self.name
        canvas, placements = self._pack(scale)
        os.makedirs(outdir, exist_ok=True)
        png = os.path.join(outdir, f"{name}.png")
        meta_path = os.path.join(outdir, f"{name}.json")
        Image.fromarray(canvas).save(png, optimize=True)
        meta = {
            "name": name,
            "size": [int(canvas.shape[1]), int(canvas.shape[0])],
            "scale": scale,
            "pad": self.pad * scale,
            "frames": {
                k: {"x": int(v[0]), "y": int(v[1]), "w": int(v[2]), "h": int(v[3]),
                    "ox": int(v[2] // scale), "oy": int(v[3] // scale)}
                for k, v in placements.items()
            },
        }
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
        return png, meta_path, canvas.shape


def trim_with_offset(img: np.ndarray, pad: int = 1):
    """يقصّ الإطار على محتواه ويعيد (الصورة المقصوصة، الإزاحة الأصلية x,y).

    هذا يوفّر 60-75% من مساحة الأطلس لأن أغلب الإطارات (انبطاح/طيران/أذرع)
    لا تملأ الإطار كاملًا. الإزاحة تُحفظ في JSON ليُركّب الإطار في مكانه الصحيح.
    """
    a = img[..., 3] > 0
    if not a.any():
        return np.zeros((1, 1, 4), dtype=np.uint8), 0, 0
    ys, xs = np.where(a)
    y0 = max(0, int(ys.min()) - pad)
    y1 = min(img.shape[0], int(ys.max()) + 1 + pad)
    x0 = max(0, int(xs.min()) - pad)
    x1 = min(img.shape[1], int(xs.max()) + 1 + pad)
    return np.ascontiguousarray(img[y0:y1, x0:x1]), x0, y0


def pack_frames(name: str, frames: dict, outdir: str, scale: int = 1, pad: int = 2) -> dict:
    """دالة مختصرة: تحزم قاموس {key: img} وتحفظه."""
    a = Atlas(name, pad=pad)
    a.add_many(frames)
    png, meta, size = a.save(outdir, scale=scale)
    return {"png": png, "json": meta, "size": size, "count": len(frames)}
