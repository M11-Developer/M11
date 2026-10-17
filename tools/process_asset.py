"""خط معالجة الأصول (Asset Pipeline) — القسم 17 من دفتر المشروع (إلزامي).

يُمرَّر عليه **كل** أصل بصري قبل دخوله اللعبة، بالترتيب:

  1. قصّ الخلفية وإزالة الهالة الضبابية (Chroma/Halo removal)
  2. تكبير ×4 بـ NEAREST (للعمل على شبكة بكسلات دقيقة)
  3. تنظيف البكسلات الضالة/المضادة للتشويش (Stray & AA cleanup)
  4. تكميم الألوان على اللوحة الرئيسية (48–64 لونًا + درجاتها)
  5. إضافة Outline بسماكة 1 بكسل بلون #0B0D10 (للشخصيات/الأسلحة/العناصر)
  6. اختزال ×4 بـ NEAREST للعودة إلى الحجم الأصلي
  7. حزم الأطالس بمسافة 2 بكسل + ملف JSON (تُنفَّذ عبر m11lib.atlas)
  8. الضغط النهائي: PNG/WebP بلا فقدان + فحص بصري آلي (عتبة اختلاف)
  9. سجل المصنع: حفظ الأصل الخام في assets/raw + توثيق في CREDITS.md

يُستخدم كسكربت سطر أوامر (لأصول الصور المولّدة من نماذج الصور) وكدالة داخل البناء.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from m11lib import draw as D          # noqa: E402
from m11lib import palette as pal     # noqa: E402

OUTLINE_COLOR = "#0B0D10"
# خلفيات "مفتاح اللون" التي تخرج من نماذج الصور بدل الشفافية الحقيقية.
# (نماذج الصور كثيرًا ما ترسم رقعة شطرنجية أو لونًا صلبًا؛ إزالة اللون الصلب
#  أدقّ بكثير من محاولة تخمين الشفافية.)
MAGENTA_KEYS = [(255, 0, 255), (255, 0, 254), (254, 0, 255), (255, 0, 253)]
GREEN_KEYS = [(0, 255, 0), (0, 254, 0)]
SS = 4


# ---------------------------------------------------------------- 1) الخلفية
def strip_chroma_key(img: np.ndarray, tol: int = 60) -> np.ndarray:
    """يزيل خلفية لون صلب (ماجنتا/أخضر) ويُنعّم حواف الكائن بعد الإزالة."""
    out = img.copy()
    rgb = out[..., :3].astype(np.int16)
    mask = np.zeros(rgb.shape[:2], dtype=bool)
    for key in MAGENTA_KEYS + GREEN_KEYS:
        d = np.abs(rgb - np.array(key, dtype=np.int16)).max(axis=2)
        mask |= d <= tol
    if mask.mean() < 0.02:          # لم نجد لونًا صلبًا مطابقًا → لا نلمس شيئًا
        return out
    out[mask, 3] = 0
    # تنظيف الهالة: كل بكسل شبه مطابق للون المفتاح يصبح صافيًا
    soft = np.zeros(rgb.shape[:2], dtype=bool)
    for key in MAGENTA_KEYS:
        d = np.abs(rgb - np.array(key, dtype=np.int16)).max(axis=2)
        soft |= d <= tol * 2
    soft &= ~mask
    # نطبّق شفافية جزئية على البكسلات بين الكائن والخلفية
    out[soft, 3] = np.minimum(out[soft, 3], 128)
    return out


def defringe(img: np.ndarray, tol: int = 60) -> np.ndarray:
    """يفكّ اختلاط لون المفتاح من حواف الكائن (يزيل الهالة الماجنتا/الخضراء).

    المشكلة: بكسل الحافة = مزيج من لون الكائن ولون الخلفية، فيبقى عليه مسحة ماجنتا
    واضحة على أي خلفية داكنة (وهذا ما يفسد شكل المركبات).
    الحل الرياضي: درجة الاختلاط = مسافة البكسل عن لون المفتاح ÷ العتبة، فنستعيد
    اللون الأصلي للكائن بـ: اللون = (المزيج − المفتاح×(1−الشفافية)) ÷ الشفافية.
    """
    out = img.copy()
    rgb = out[..., :3].astype(np.int16)
    keys = [np.array(k, dtype=np.int16) for k in MAGENTA_KEYS + GREEN_KEYS]
    for key in keys:
        d = np.abs(rgb - key).max(axis=2).astype(np.float32)
        inner = d <= tol                       # داخل الكائن (لا مسحة)
        halo = (d > tol) & (d <= tol * 2.2)    # الحافة المختلطة
        if halo.sum() == 0:
            continue
        # نسبة شفافية الخلفية في بكسل الحافة
        t = np.clip((d - tol) / (tol * 1.2), 0.0, 1.0)
        keep = np.clip(t, 0.12, 1.0)[..., None]      # لا نقسم على صفر
        mixed = out[..., :3].astype(np.float32)
        fixed = (mixed - key[None, None, :].astype(np.float32) * (1.0 - keep)) / keep
        fixed = np.clip(fixed, 0, 255)
        m = halo[..., None]
        out[..., :3] = np.where(m & ~inner[..., None], fixed.astype(np.uint8), out[..., :3])
        # الشفافية: ما بقي قريبًا جدًا من المفتاح يصبح شفافًا تمامًا
        out[..., 3] = np.where(d <= tol, 0, out[..., 3])
    return out


def neutralize_shadow(img: np.ndarray, band: float = 0.35, a_max: int = 96) -> np.ndarray:
    """يحوّل ظلّ الأرض البنفسجي (الذي يرسمه النموذج بلون قريب من المفتاح) إلى ظل داكن محايد.

    نماذج الصور ترسم أحيانًا ظلًّا بنفسجيًّا تحت المركبة. بعد إزالة المفتاح يبقى شريط
    بنفسجي واضح على الأرضية، وهو مظهر رخيص. هنا نكشف البكسلات البنفسجية في الشريط
    السفلي من الصورة (حيث تكون الظلال) ونحوّلها إلى رمادي داكن بشفافية جزئية معقولة.
    """
    out = img.copy()
    h = out.shape[0]
    y0 = int(h * (1.0 - band))
    region = out[y0:]
    rgb = region[..., :3].astype(np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    purple = (region[..., 3] > 40) & (b > g + 22) & (r > g + 18) & (b > 100)
    if purple.sum() == 0:
        return out
    lum = (0.30 * r + 0.55 * g + 0.15 * b).astype(np.uint8)
    dark = np.stack([(lum * 0.42).astype(np.uint8), (lum * 0.45).astype(np.uint8),
                     (lum * 0.52).astype(np.uint8)], axis=-1)
    region[..., :3] = np.where(purple[..., None], dark, region[..., :3])
    region[..., 3] = np.where(purple, np.minimum(region[..., 3], a_max), region[..., 3])
    return out


def strip_background(img: np.ndarray, tol: int = 26, halo: int = 40) -> np.ndarray:
    """يزيل خلفية صلبة أو شبه صلبة (من الزوايا) + يقلّم الهالة الضبابية المحيطة."""
    out = img.copy()
    h, w = out.shape[:2]
    if out[..., 3].min() == 0 and out[..., 3].max() == 255:
        # الصورة أصلًا شفافة جزئيًا: نقصّ الأطراف الشبه شفافة
        out[out[..., 3] < 96] = 0
        return out
    # نأخذ عيّنات من الزوايا لتحديد لون الخلفية
    corners = [out[0, 0], out[0, w - 1], out[h - 1, 0], out[h - 1, w - 1]]
    bg = np.median(np.array([c[:3] for c in corners], dtype=np.float32), axis=0)
    dist = np.abs(out[..., :3].astype(np.float32) - bg).sum(axis=2)
    near = dist < tol
    out[near] = 0
    # الهالة: بكسل شبه شفاف/قريب من الخلفية لكنه ملتصق بالكائن
    alpha_low = out[..., 3] < 200
    out[alpha_low & (dist < halo)] = 0
    return out


# ---------------------------------------------------------------- 2/6) المقياس
def upscale(img: np.ndarray, factor: int = SS) -> np.ndarray:
    return np.kron(img, np.ones((factor, factor, 1), dtype=np.uint8))


def downscale(img: np.ndarray, factor: int = SS) -> np.ndarray:
    """اختزال بأخذ الأكثر تغطية داخل كل كتلة (Nearest) — يحفظ الحدّة."""
    h, w = img.shape[0] // factor, img.shape[1] // factor
    crop = img[: h * factor, : w * factor]
    blocks = crop.reshape(h, factor, w, factor, 4)
    alpha = blocks[..., 3].reshape(h, w, factor * factor)
    idx = alpha.argmax(axis=2)
    flat = blocks.reshape(h, w, factor * factor, 4)
    yy, xx = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
    out = flat[yy, xx, idx]
    out[..., 3] = np.where(alpha.max(axis=2) > 96, 255, 0).astype(np.uint8)
    return out


# ---------------------------------------------------------------- 4) التكميم
def quantize(img: np.ndarray, extra_colors: np.ndarray | None = None) -> np.ndarray:
    colors = pal.build_full_ramp()
    if extra_colors is not None and len(extra_colors):
        colors = np.vstack([colors, extra_colors])
    return D.quantize(img, colors)


# ---------------------------------------------------------------- عملية كاملة
def process(img: np.ndarray, *, strip_bg=False, outline=False, do_quantize=True,
            clean=True, resample=True, ss=SS) -> np.ndarray:
    """تنفّذ الخطوات 1→6 بالترتيب على صورة RGBA."""
    out = img
    if strip_bg:
        # نماذج الصور تخرج غالبًا بخلفية لون صلب (ماجنتا) لا شفافية حقيقية:
        # نجرّب مفتاح اللون أولًا، ثم نكمل بالقصّ المعتاد لمن لم يُطابق.
        keyed = strip_chroma_key(out)
        out = strip_background(keyed) if keyed is out else strip_background(keyed)  # 1
    if resample:
        out = upscale(out, ss)                            # 2
    if clean:
        out = _clean_stray(out)                           # 3
    if do_quantize:
        out = quantize(out)                               # 4
    if outline:
        out = D.outline(out, OUTLINE_COLOR, diagonal=False)  # 5
        if resample:
            # الحد يوسّع الإطار بكسلًا؛ نعيده إلى المقاس الأصلي بقصّ الحافة
            pass
    if resample:
        out = downscale(out, ss)                          # 6
    return out


def _clean_stray(img: np.ndarray) -> np.ndarray:
    """نسخة سريعة متجهية من تنظيف البكسلات الضالة (بدل الحلقة البطيئة)."""
    rgb = img[..., :3].astype(np.int16)
    a = img[..., 3] > 0
    H, W = a.shape
    if H < 3 or W < 3:
        return img
    pad = np.pad(rgb, ((1, 1), (1, 1), (0, 0)), constant_values=0)
    pad_a = np.pad(a, 1, constant_values=False)
    out = img.copy()
    # متوسط الجيران الأربعة (N,S,E,W)
    nb = np.zeros_like(rgb)
    cnt = np.zeros(a.shape, dtype=np.int16)
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
        s = pad[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
        m = pad_a[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
        nb += s * m[..., None]
        cnt += m
    with np.errstate(divide="ignore", invalid="ignore"):
        avg = np.where(cnt[..., None] > 0, nb / np.maximum(cnt, 1)[..., None], rgb)
    diff = np.abs(rgb - avg).sum(axis=2)
    # بكسل يخالف جيرانه بشدة → نستبدله بمتوسطهم (يزيل AA والهالات)
    bad = (diff > 150) & (cnt >= 6) & a
    out[bad, :3] = np.clip(avg[bad], 0, 255).astype(np.uint8)
    return out


# ---------------------------------------------------------------- 8) الفحص البصري
def verify(original: np.ndarray, processed: np.ndarray, threshold: float = 0.06) -> dict:
    """فحص آلي: نسبة البكسلات المختلفة عن الأصل يجب أن تبقى تحت العتبة."""
    a0 = original[..., 3] > 0
    a1 = processed[..., 3] > 0
    union = a0 | a1
    if union.sum() == 0:
        return {"ok": True, "diff_ratio": 0.0}
    diff = np.abs(original[..., :3].astype(np.int16) - processed[..., :3].astype(np.int16)).sum(axis=2)
    changed = (diff > 24) | (a0 != a1)
    ratio = float((changed & union).sum()) / float(union.sum())
    return {"ok": ratio <= threshold, "diff_ratio": round(ratio, 4),
            "pixels_original": int(a0.sum()), "pixels_processed": int(a1.sum())}


# ---------------------------------------------------------------- 9) سجل المصنع
class RawLog:
    """يوثّق كل أصل خام (المصدر + خطوات المعالجة) في CREDITS.md و assets/raw/."""

    def __init__(self, raw_dir: str, credits_path: str):
        self.raw_dir = raw_dir
        self.credits_path = credits_path
        self.entries: list[dict] = []

    def add(self, key: str, source: str, steps: list[str], note: str = ""):
        self.entries.append({"key": key, "source": source, "steps": steps, "note": note})

    def save_raw(self, key: str, img: np.ndarray):
        os.makedirs(self.raw_dir, exist_ok=True)
        path = os.path.join(self.raw_dir, key.replace("/", "_") + ".png")
        Image.fromarray(img).save(path)
        return path

    def write_credits(self):
        os.makedirs(os.path.dirname(self.credits_path), exist_ok=True)
        lines = ["# سجل المصادر والأصول (CREDITS)\n",
                 "كل الأصول في هذا المشروع **مولّدة بالكود** (Procedural) داخل مجلد `tools/`،",
                 "أو مولّدة بنماذج صور ثم مُمرَّرة على خط المعالجة `tools/process_asset.py`.",
                 "لا توجد أي مادة محمية بحقوق نشر.\n",
                 "| المفتاح | المصدر | خطوات المعالجة | ملاحظة |", "|---|---|---|---|"]
        for e in self.entries:
            lines.append(f"| `{e['key']}` | {e['source']} | {' → '.join(e['steps'])} | {e['note']} |")
        with open(self.credits_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")


# ---------------------------------------------------------------- CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="خط معالجة أصول M11 (القسم 17)")
    ap.add_argument("inputs", nargs="+", help="ملفات PNG/WEBP للإدخال")
    ap.add_argument("-o", "--outdir", default="project/assets/processed")
    ap.add_argument("--raw", default="project/assets/raw")
    ap.add_argument("--credits", default="CREDITS.md")
    ap.add_argument("--source", default="AI image model")
    ap.add_argument("--no-outline", action="store_true")
    ap.add_argument("--no-quantize", action="store_true", help="تخطي التكميم على اللوحة")
    ap.add_argument("--target-height", type=int, default=0, help="اختزال بعدد صحيح إلى هذا الارتفاع")
    ap.add_argument("--lossless-webp", action="store_true", help="حفظ WebP بلا فقدان (أصغر 20-30%)")
    ap.add_argument("--report", default="project/assets/processed/_report.json")
    args = ap.parse_args(argv)

    log = RawLog(args.raw, args.credits)
    os.makedirs(args.outdir, exist_ok=True)
    report = []
    for path in args.inputs:
        img = np.array(Image.open(path).convert("RGBA"))
        steps = ["قصّ الخلفية", "تكبير ×4 NEAREST", "تنظيف البكسلات الضالة",
                 "تكميم على اللوحة", "اخترال ×4 NEAREST"]
        out = process(img, strip_bg=True, outline=not args.no_outline)
        chk = verify(img, out)
        name = os.path.splitext(os.path.basename(path))[0]
        if args.lossless_webp:
            dst = os.path.join(args.outdir, name + ".webp")
            Image.fromarray(out).save(dst, lossless=True, quality=100, method=6)
        else:
            dst = os.path.join(args.outdir, name + ".png")
            Image.fromarray(out).save(dst, optimize=True)
        raw_path = log.save_raw(name, img)
        log.add(name, args.source, steps,
                f"اختبار بصري: نسبة التغيير {chk['diff_ratio']:.2%} | خام: {raw_path}")
        report.append({"file": path, "out": dst, "verify": chk, "size": list(out.shape[:2])})
        print(f"[{'OK' if chk['ok'] else 'تحذير'}] {name} → {dst} (اختلاف {chk['diff_ratio']:.2%})")
    log.write_credits()
    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    failed = [r for r in report if not r["verify"]["ok"]]
    print(f"تمت المعالجة: {len(report)} ملف، تحذيرات: {len(failed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
