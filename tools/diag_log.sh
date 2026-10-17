#!/usr/bin/env bash
# ============================================================================
# تشخيص سجل بناء أندرويد بلا أي أدوات خارجية (لا بايثون — صورة godot-ci تفتقرها).
#   bash tools/diag_log.sh /tmp/m11-build.log
# يكتب الخلاصة في /tmp/m11-diag.txt على شكل مقاطع صغيرة تُقرأ من تعليقات GitHub.
# ============================================================================
set +e
LOG="${1:-/tmp/m11-build.log}"
OUT=/tmp/m11-diag.txt
: > "$OUT"

# 1) سياق سبب فشل الإعداد (السبب في الأسطر التالية للرسالة)
LINE=$(grep -n "configuration errors" "$LOG" 2>/dev/null | head -1 | cut -d: -f1)
if [ -n "$LINE" ]; then
  echo "=== سبب فشل الإعداد (سطر $LINE) ===" >> "$OUT"
  sed -n "$(( LINE > 2 ? LINE - 2 : 1 )),$(( LINE + 14 ))p" "$LOG" | sed 's/^/  /' >> "$OUT"
  # نسخة خام (od) لكشف أي محارف خفيّة تمنع قراءة السبب
  echo "  --- خام (od) ---" >> "$OUT"
  sed -n "${LINE},$(( LINE + 2 ))p" "$LOG" | head -c 400 | od -c | head -8 | sed 's/^/  /' >> "$OUT"
fi

# 2) نافذة أول محاولة تصدير
S=$(grep -n "EXPORT-DEBUG1 START" "$LOG" 2>/dev/null | head -1 | cut -d: -f1)
if [ -n "$S" ]; then
  echo "=== أول محاولة تصدير (من سطر $S) ===" >> "$OUT"
  sed -n "$(( S > 2 ? S - 2 : 1 )),$(( S + 16 ))p" "$LOG" | sed 's/^/  /' >> "$OUT"
fi

# 3) نتائج التصدير
echo "=== النتائج ===" >> "$OUT"
grep -E "debug_export_exit|debug_export_exit2|release_apk_exit|release_aab_exit|مفقود:|= OK|saving" "$LOG" 2>/dev/null | head -12 | sed 's/^/  /' >> "$OUT"

# 3ب) إعداد التصدير والمفاتيح الفعلية
echo "=== أدوات أندرويد ===" >> "$OUT"
ls -1 /usr/lib/android-sdk/build-tools/*/apksigner 2>/dev/null | head -4 >> "$OUT"
ls -1 /usr/lib/android-sdk/build-tools 2>/dev/null | tr '\n' ' ' >> "$OUT"; echo >> "$OUT"
echo "=== أدوات متاحة ===" >> "$OUT"
echo "  curl=$(command -v curl || echo MISSING) wget=$(command -v wget || echo MISSING) python3=$(command -v python3 || echo MISSING) unzip=$(command -v unzip || echo MISSING)" >> "$OUT"
grep -E "java_sdk_path|android_sdk_path|debug_keystore|JAVA_DIR" "$LOG" 2>/dev/null | head -8 >> "$OUT"
echo "=== أسطر المفتاح في الإعدادات ===" >> "$OUT"
grep -n "keystore/" /github/workspace/project/export_presets.cfg 2>/dev/null | head -8 >> "$OUT"

# 4) ملفات APK التي وُجدت في المشروع
echo "=== ملفات APK/AAB ===" >> "$OUT"
find /github/workspace -name "*.apk" -o -name "*.aab" 2>/dev/null | grep -v export_templates | head -8 >> "$OUT"

# 5) ملفات إعدادات المحرّر في النظام كله (لمعرفة أيّ ملف يقرأه Godot فعلًا)
echo "=== ملفات editor_settings ===" >> "$OUT"
find / -name "editor_settings-*.tres" 2>/dev/null | head -6 >> "$OUT"
for F in $(find / -name "editor_settings-4.3.tres" 2>/dev/null | head -2); do
  echo "--- $F ---" >> "$OUT"
  grep -E "java_sdk_path|android_sdk_path|debug_keystore" "$F" 2>/dev/null | head -6 >> "$OUT"
done

echo "=== ملخّص ===" >> "$OUT"
echo "حجم السجل: $(wc -c < "$LOG" 2>/dev/null) بايت | أسطر: $(wc -l < "$LOG" 2>/dev/null)" >> "$OUT"
for K in "configuration errors" "Android build template not installed" "Java SDK path" \
         "keystore" "apksigner" "build-tools" "No export template" "Target SDK" \
         "Failed to load script" "Parse Error" "Cannot"; do
  N=$(grep -c "$K" "$LOG" 2>/dev/null)
  [ "$N" != "0" ] && echo "  [$N] $K" >> "$OUT"
done



wc -c "$OUT"
head -c 4000 "$OUT"
