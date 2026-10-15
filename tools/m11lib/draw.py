"""محرّك رسم بكسلي عالي الجودة يعمل بالكود (بدون صور).

الفكرة الأساسية (القسم 3 من دفتر المشروع):
  1. نرسم الأصل بدقة **4 أضعاف** الحجم النهائي (Super-sampling) على شبكة دقيقة.
  2. نضيف التفاصيل: تظليل بالخطوط (Ramps) + Dithering يدوي + Hue-Shift.
  3. نختزل ×4 بـ Nearest Neighbor → كثافة تفاصيل عالية بلا ضبابية.
  4. نكمّم الألوان على اللوحة الرئيسية ونضيف حدًّا خارجيًا 1 بكسل.

كل الدوال هنا تعمل على مصفوفة RGBA (numpy uint8) بارتفاع×عرض×4.
"""
from __future__ import annotations

import numpy as np

from . import palette as pal

SS = 4  # عامل الرسم الفائق (Super-Sampling)


class Canvas:
    """لوحة رسم RGBA بسيطة مع عمليات بكسلي مناسبة للفن البكسلي."""

    def __init__(self, w: int, h: int, ss: int = SS):
        self.ss = ss
        self.w = w
        self.h = h
        self.W = w * ss
        self.H = h * ss
        # نخزّن الألوان كـ float32 RGB + قناع تغطية (coverage) للشفافية
        self.rgb = np.zeros((self.H, self.W, 3), dtype=np.float32)
        self.cov = np.zeros((self.H, self.W), dtype=np.float32)
        # مكدّس أقنعة القصّ (Clip): يسمح بحصر الرسم داخل شكل (مثل: الخوذة أعلى الرأس فقط)
        self._clip = None

    # ---------- القصّ (Clipping) ----------
    def clip(self, mask: np.ndarray):
        """يبدأ منطقة قصّ جديدة (تُتقاطع مع القصّ الحالي)."""
        prev = self._clip
        self._clip = mask if prev is None else (prev & mask)
        return prev

    def unclip(self, prev=None):
        self._clip = prev

    def clip_rect(self, x, y, w, h):
        X = np.arange(self.W)[None, :]
        Y = np.arange(self.H)[:, None]
        x, y, w, h = [int(v * self.ss) for v in (x, y, w, h)]
        return self.clip((X >= x) & (X < x + w) & (Y >= y) & (Y < y + h))

    def shape_mask(self, kind, *args) -> np.ndarray:
        """يبني قناع شكل منطقي بلا رسمه (للتمرير إلى clip)."""
        X = np.arange(self.W)[None, :]
        Y = np.arange(self.H)[:, None]
        if kind == "ellipse":
            cx, cy, rx, ry = args
            if rx <= 0 or ry <= 0:
                return np.zeros((self.H, self.W), dtype=bool)
            return ((X - cx * self.ss) / (rx * self.ss)) ** 2 + ((Y - cy * self.ss) / (ry * self.ss)) ** 2 <= 1.0
        if kind == "rect":
            x, y, w, h = [int(v * self.ss) for v in args]
            return (X >= x) & (X < x + w) & (Y >= y) & (Y < y + h)
        raise ValueError(kind)

    # ---------- عمليات أساسية ----------
    def _coords(self, x, y):
        X = np.arange(self.W)[None, :]
        Y = np.arange(self.H)[:, None]
        return X, Y

    def fill_shape(self, mask: np.ndarray, color, coverage: float = 1.0):
        """يملأ قناعًا منطقيًا (H×W) بلون مع تغطية معيّنة."""
        c = np.array(pal.hex_to_rgb(color) if isinstance(color, str) else color, dtype=np.float32)
        m = mask.astype(bool)
        if self._clip is not None:
            m = m & self._clip
        self.rgb[m] = (1 - coverage) * self.rgb[m] + coverage * c
        self.cov[m] = np.minimum(1.0, self.cov[m] + coverage)

    def rect(self, x, y, w, h, color, coverage=1.0, radius=0):
        """مستطيل بوحدات البكسل النهائي (يُضرب ×ss داخليًا)."""
        x, y, w, h = [int(v * self.ss) for v in (x, y, w, h)]
        radius = int(radius * self.ss)
        X = np.arange(self.W)[None, :]
        Y = np.arange(self.H)[:, None]
        inside = (X >= x) & (X < x + w) & (Y >= y) & (Y < y + h)
        if radius > 0:
            cx = np.clip(X, x + radius, x + w - radius)
            cy = np.clip(Y, y + radius, y + h - radius)
            d = (X - cx) ** 2 + (Y - cy) ** 2
            inside &= d <= radius ** 2
        self.fill_shape(inside, color, coverage)

    def ellipse(self, cx, cy, rx, ry, color, coverage=1.0):
        cx, cy, rx, ry = cx * self.ss, cy * self.ss, rx * self.ss, ry * self.ss
        X = np.arange(self.W)[None, :]
        Y = np.arange(self.H)[:, None]
        inside = ((X - cx) / max(rx, 0.5)) ** 2 + ((Y - cy) / max(ry, 0.5)) ** 2 <= 1.0
        self.fill_shape(inside, color, coverage)

    def poly(self, pts, color, coverage=1.0):
        """مضلّع محدّب/مقعر بنقطة داخلية لكل بكسل (Even-Odd)."""
        from PIL import Image, ImageDraw
        img = Image.new("1", (self.W, self.H), 0)
        d = ImageDraw.Draw(img)
        d.polygon([(float(px * self.ss), float(py * self.ss)) for px, py in pts], fill=1)
        self.fill_shape(np.array(img, dtype=bool), color, coverage)

    def line(self, x0, y0, x1, y1, color, width=1.0, coverage=1.0):
        from PIL import Image, ImageDraw
        img = Image.new("1", (self.W, self.H), 0)
        d = ImageDraw.Draw(img)
        d.line([(x0 * self.ss, y0 * self.ss), (x1 * self.ss, y1 * self.ss)],
               fill=1, width=max(1, int(width * self.ss)))
        self.fill_shape(np.array(img, dtype=bool), color, coverage)

    # ---------- تظليل ----------
    def dither_mask(self, x, y, w, h, ratio: float, phase: int = 0) -> np.ndarray:
        """قناع Dithering بشبكة Bayer 4×4 (احتمال 0..1) — بديل التدرج الناعم."""
        bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6],
                          [3, 11, 1, 9], [15, 7, 13, 5]], dtype=np.float32) / 16.0
        x, y, w, h = [int(v * self.ss) for v in (x, y, w, h)]
        X = np.arange(self.W)[None, :]
        Y = np.arange(self.H)[:, None]
        bx = ((X + phase) // 1) % 4
        by = (Y // 1) % 4
        thr = bayer[by % 4, bx % 4]
        inside = (X >= x) & (X < x + w) & (Y >= y) & (Y < y + h)
        return inside & (thr < ratio)

    def shade_rect(self, x, y, w, h, ramp, direction="v", strength: float = 0.6):
        """تظليل تدريجي داخل مستطيل باستخدام Dithering (بدل التدرج السلس).

        ramp = قائمة ألوان من الأغمق إلى الأفتح.
        """
        n = len(ramp)
        steps = max(1, int((h if direction == "v" else w) * strength))
        for i in range(steps):
            r = i / max(1, steps - 1)
            idx = min(n - 1, int(r * n))
            if direction == "v":
                band = (x, y + i, w, 1)
                # نسبة الاختلاط مع اللون التالي (Dithering)
                frac = (r * n) - idx
            else:
                band = (x + i, y, 1, h)
                frac = (r * n) - idx
            self.rect(*band, ramp[idx])
            if frac > 0.05 and idx + 1 < n:
                m = self.dither_mask(*band, ratio=frac, phase=i)
                self.fill_shape(m, ramp[idx + 1])

    def global_light(self, ramp, light_dir=(-1.0, -1.0), amount: float = 0.35):
        """إضاءة اتجاهية عامة: تُفتّح الحواف المواجهة للضوء وتُغمّق المقابلة.

        تُطبّق باختزال على مستوى الشبكة الفائقة (4x) لتنتج تفاصيل غنية.
        """
        cov = self.cov > 0.05
        if not cov.any():
            return
        gy, gx = np.gradient(self.cov.astype(np.float32))
        lx, ly = light_dir
        n = np.sqrt(gx ** 2 + gy ** 2) + 1e-5
        lam = np.clip((gx / n) * lx + (gy / n) * ly, -1, 1)
        hi = cov & (lam > 0.55) & (self.cov < 0.95)
        lo = cov & (lam < -0.45)
        self.fill_shape(hi, ramp[-1], amount)
        self.fill_shape(lo, ramp[0], amount * 0.9)

    # ---------- الاختزال والتكميم ----------
    def downsample(self, algo: str = "area", thresh: float = 0.45) -> np.ndarray:
        """اختزال ×ss إلى شبكة البكسل النهائية.

        algo="area" (الافتراضي): كل بكسل نهائي = متوسط البكسلات الفائقة المغطاة
        (يُشبه طريقة الفنان: البكسل النهائي يمثّل الأغلبية) → شكل نظيف ومقصود.
        algo="nearest": يأخذ البكسل الأكثر تغطية (يحفظ الأدقّ/الأرفع).
        """
        # ترتيب الذاكرة هو (h, ss, w, ss) — نعيد الترتيب إلى (h, w, ss, ss) قبل التسطيح
        rgb4 = self.rgb.reshape(self.h, self.ss, self.w, self.ss, 3).transpose(0, 2, 1, 3, 4)
        cov4 = self.cov.reshape(self.h, self.ss, self.w, self.ss).transpose(0, 2, 1, 3)
        flat_cov = cov4.reshape(self.h, self.w, self.ss * self.ss)
        flat_rgb = rgb4.reshape(self.h, self.w, self.ss * self.ss, 3)
        if algo == "nearest":
            idx = flat_cov.argmax(axis=2)
            yy, xx = np.meshgrid(np.arange(self.h), np.arange(self.w), indexing="ij")
            out_rgb = flat_rgb[yy, xx, idx]
            out_a = flat_cov.max(axis=2) > 0.35
        else:
            wgt = np.clip(flat_cov, 0.0, 1.0)
            sw = wgt.sum(axis=2, keepdims=True)
            out_rgb = np.where(sw > 1e-4, (flat_rgb * wgt[..., None]).sum(axis=2) / np.maximum(sw, 1e-4), 0)
            out_a = flat_cov.mean(axis=2) > thresh
        img = np.zeros((self.h, self.w, 4), dtype=np.uint8)
        img[..., :3] = np.clip(out_rgb, 0, 255).astype(np.uint8)
        img[..., 3] = np.where(out_a, 255, 0).astype(np.uint8)
        return img


# ---------- عمليات على الصور النهائية ----------

def quantize(img: np.ndarray, colors: np.ndarray | None = None) -> np.ndarray:
    """تكميم الألوان إلى اللوحة الرئيسية (يشمل درجاتها المشتقة)."""
    if colors is None:
        colors = pal.build_full_ramp()
    out = img.copy()
    a = img[..., 3] > 0
    if not a.any():
        return out
    px = img[a][:, :3].astype(np.float32)
    # أقرب لون بالمسافة الإقليدية في فضاء RGB (سريع ومتوافق مع الفن البكسلي)
    d = ((px[:, None, :] - colors[None, :, :]) ** 2).sum(axis=2)
    out[a, :3] = colors[d.argmin(axis=1)].astype(np.uint8)
    return out


def clean_stray_pixels(img: np.ndarray, threshold: int = 1) -> np.ndarray:
    """يزيل البكسلات الضالة/المضادة للتشويش (AA):

    أي بكسل يخالف أغلبية جيرانه (8-جيران) يُستبدل بلون الجار الغالب.
    """
    out = img.copy()
    a = img[..., 3] > 0
    H, W = a.shape
    if H < 3 or W < 3:
        return out
    pads = np.pad(img.astype(np.int16), ((1, 1), (1, 1), (0, 0)))
    for y in range(1, H + 1):
        for x in range(1, W + 1):
            if not a[y - 1, x - 1]:
                continue
            nb = pads[y - 1:y + 2, x - 1:x + 2, :3].reshape(9, 3)
            nba = pads[y - 1:y + 2, x - 1:x + 2, 3].reshape(9)
            nb = nb[nba > 0]
            if len(nb) < 5:
                continue
            cur = pads[y, x, :3]
            dist = np.abs(nb - cur).sum(axis=1)
            if np.count_nonzero(dist <= threshold * 3) <= 1:
                # البكسل شاذ → نأخذه من الجار الأقرب
                out[y - 1, x - 1, :3] = nb[dist.argmin()]
    return out


def outline(img: np.ndarray, color: str = "#0B0D10", diagonal: bool = False) -> np.ndarray:
    """يضيف حدًّا خارجيًا بسماكة 1 بكسل (alpha dilate) — بصمة الفن البكسلي."""
    a = img[..., 3] > 0
    H, W = a.shape
    pad = np.pad(a, 1)
    acc = np.zeros_like(a)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)) + (((-1, -1), (-1, 1), (1, -1), (1, 1)) if diagonal else ()):
        acc |= pad[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
    ring = acc & ~a
    out = np.zeros((H + 2, W + 2, 4), dtype=np.uint8)
    out[1:-1, 1:-1] = img
    c = pal.hex_to_rgb(color)
    out[1:-1, 1:-1][ring] = (*c, 255)
    return out


def trim(img: np.ndarray, pad: int = 0) -> np.ndarray:
    """يقصّ المساحات الشفافة الزائدة."""
    a = img[..., 3] > 0
    if not a.any():
        return img
    ys, xs = np.where(a)
    y0, y1 = max(0, ys.min() - pad), min(img.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(img.shape[1], xs.max() + 1 + pad)
    return img[y0:y1, x0:x1]


def palette_swap(img: np.ndarray, mapping: dict) -> np.ndarray:
    """تبديل ألوان (Palette Swap) — أساس نظام الجلود بمئات المتغيّرات وبحجم صفر."""
    out = img.copy()
    for src, dst in mapping.items():
        s = pal.hex_to_rgb(src) if isinstance(src, str) else src
        d = pal.hex_to_rgb(dst) if isinstance(dst, str) else dst
        m = (out[..., 0] == s[0]) & (out[..., 1] == s[1]) & (out[..., 2] == s[2]) & (out[..., 3] > 0)
        out[m, 0], out[m, 1], out[m, 2] = d[0], d[1], d[2]
    return out
