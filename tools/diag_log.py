#!/usr/bin/env python3
# ============================================================================
# أداة تشخيص سجل بناء أندرويد — تُطبع خلاصة صغيرة تُقرأ من تعليقات GitHub.
#   python3 tools/diag_log.py [/tmp/m11-build.log]
# تُظهر: سبب فشل إعداد التصدير، أسطر الأخطاء المهمة، وحالة الملفات الناتجة.
# ============================================================================
import os
import sys

KNOWN = ["A valid Java SDK path", "Either Debug Keystore", "Debug keystore not configured",
         "Either Release Keystore", "Release keystore incorrectly", "Android build template",
         "Invalid Android SDK path", "build-tools", "apksigner", "Target SDK",
         "No export template", "template not found", "Gradle", "FAILURE:", "Execution failed"]


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/m11-build.log"
    try:
        raw = open(path, encoding="utf-8", errors="replace").read()
    except FileNotFoundError:
        print("لا يوجد سجل في", path)
        return 0
    lines = [l.rstrip() for l in raw.replace("\r", "\n").split("\n")]
    out = []

    # 1) الأسباب المعروفة
    out.append("=== الأسباب المعروفة ===")
    for pat in KNOWN:
        hits = [l for l in lines if pat.lower() in l.lower()]
        for h in hits[:3]:
            out.append(f"[{pat}] {h.strip()[:200]}")

    # 2) سياق فشل الإعداد (المهم: الأسطر التالية تحمل السبب)
    idx = [i for i, l in enumerate(lines) if "configuration errors" in l]
    for k, i in enumerate(idx[:2]):
        out.append(f"=== سياق فشل الإعداد #{k + 1} ===")
        for l in lines[max(0, i - 6):i + 8]:
            if l.strip():
                out.append("  " + l.strip()[:220])

    # 3) نافذة أول محاولة تصدير
    idx2 = [i for i, l in enumerate(lines) if "EXPORT-DEBUG1 START" in l]
    if idx2:
        out.append("=== أول محاولة تصدير (٣٠ سطرًا) ===")
        for l in lines[idx2[0]:idx2[0] + 30]:
            if l.strip():
                out.append("  " + l.strip()[:220])

    # 4) نتائج
    out.append("=== النتائج ===")
    for pat in ("debug_export_exit", "debug_export_exit2", "release_apk_exit", "release_aab_exit",
                "مفقود:", "✔ build"):
        for l in [x for x in lines if pat in x][:3]:
            out.append("  " + l.strip()[:200])

    text = "\n".join(out)
    open("/tmp/m11-diag.txt", "w", encoding="utf-8").write(text)
    print(text[:6000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
