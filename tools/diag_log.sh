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

echo "=== ملخّص ===" >> "$OUT"
echo "حجم السجل: $(wc -c < "$LOG" 2>/dev/null) بايت | أسطر: $(wc -l < "$LOG" 2>/dev/null)" >> "$OUT"
for K in "configuration errors" "Android build template not installed" "Java SDK path" \
         "keystore" "apksigner" "build-tools" "No export template" "Target SDK" \
         "Failed to load script" "Parse Error" "Cannot"; do
  N=$(grep -c "$K" "$LOG" 2>/dev/null)
  [ "$N" != "0" ] && echo "  [$N] $K" >> "$OUT"
done

# 1) سياق سبب فشل الإعداد (السبب في الأسطر التالية للرسالة)
LINE=$(grep -n "configuration errors" "$LOG" 2>/dev/null | head -1 | cut -d: -f1)
if [ -n "$LINE" ]; then
  echo "=== سبب فشل الإعداد (سطر $LINE) ===" >> "$OUT"
  sed -n "$(( LINE > 10 ? LINE - 10 : 1 )),$(( LINE + 7 ))p" "$LOG" | sed 's/^/  /' >> "$OUT"
fi

# 2) نافذة أول محاولة تصدير
S=$(grep -n "EXPORT-DEBUG1 START" "$LOG" 2>/dev/null | head -1 | cut -d: -f1)
if [ -n "$S" ]; then
  echo "=== أول محاولة تصدير (من سطر $S) ===" >> "$OUT"
  sed -n "$(( S > 3 ? S - 3 : 1 )),$(( S + 34 ))p" "$LOG" | sed 's/^/  /' >> "$OUT"
fi

# 3) نتائج التصدير
echo "=== النتائج ===" >> "$OUT"
grep -E "debug_export_exit|debug_export_exit2|release_apk_exit|release_aab_exit|مفقود:|= OK|saving" "$LOG" 2>/dev/null | head -12 | sed 's/^/  /' >> "$OUT"

# 4) ملفات APK التي وُجدت في المشروع
echo "=== ملفات APK/AAB ===" >> "$OUT"
find /github/workspace -name "*.apk" -o -name "*.aab" 2>/dev/null | grep -v export_templates | head -8 >> "$OUT"

wc -c "$OUT"
head -c 4000 "$OUT"
