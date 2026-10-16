#!/usr/bin/env python3
# ============================================================================
# فحص حزمة APK بعد البناء (بلا أي أدوات أندرويد):
#   python3 tools/check_apk.py build/M11-debug.apk
# يتحقق من: سلامة ZIP، وجود مكتبة Godot للأبنية المطلوبة، وجود الأصول، غياب
#            الأصول الخام، وعدم وجود أي إذن ممنوع (الإنترنت/الموقع) في البيان.
# ============================================================================
import sys, zipfile, re

BANNED = ["android.permission.INTERNET", "android.permission.ACCESS_FINE_LOCATION",
          "android.permission.ACCESS_COARSE_LOCATION", "android.permission.READ_PHONE_STATE"]
ALLOWED = ["android.permission.ACCESS_WIFI_STATE", "android.permission.CHANGE_WIFI_MULTICAST_STATE",
           "android.permission.NEARBY_WIFI_DEVICES", "android.permission.RECORD_AUDIO"]


def main(path: str) -> int:
    z = zipfile.ZipFile(path)
    bad = z.testzip()
    if bad:
        print(f"✘ ملف تالف داخل الحزمة: {bad}")
        return 1
    names = z.namelist()
    print(f"✔ الحزمة سليمة — {len(names)} ملفًا")

    libs = sorted({n for n in names if n.startswith("lib/")})
    have_arm64 = any("arm64-v8a" in n for n in libs)
    have_arm32 = any("armeabi-v7a" in n for n in libs)
    godot_so = [n for n in libs if "godot" in n.lower()]
    print(f"  مكتبات: arm64={have_arm64} armv7={have_arm32} ({len(libs)} ملف)"
          f"{' | Godot: ' + godot_so[0] if godot_so else ''}")

    assets = [n for n in names if n.startswith("assets/")]
    print(f"  أصول اللعبة المضمّنة: {len(assets)} ملفًا")

    # نقرأ البيان (XML ثنائي: النصوص UTF-16 أو UTF-8) ونبحث عن الأذونات
    blob = b""
    for n in names:
        if n.endswith(".xml") or n.startswith("AndroidManifest"):
            blob += z.read(n)
    found_banned = [p for p in BANNED if p.encode() in blob or p.encode("utf-16-le") in blob]
    found_allowed = [p for p in ALLOWED if p.encode() in blob or p.encode("utf-16-le") in blob]
    print("  الأذونات المطلوبة: " + (", ".join(p.rsplit('.', 1)[-1] for p in found_allowed) or "لا شيء"))
    if found_banned:
        print("✘ أذونات ممنوعة: " + ", ".join(found_banned))
        return 1
    print("✔ لا يوجد أي إذن إنترنت/موقع في الحزمة")

    raw = [n for n in assets if n.startswith(("assets/raw/", "assets/processed/"))]
    if raw:
        print(f"✘ الأصول الخام دخلت الحزمة ({len(raw)} ملفًا)")
        return 1
    print("✔ الأصول الخام خارج الحزمة (القسم 17.9)")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("الاستخدام: python3 tools/check_apk.py <ملف.apk>")
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
