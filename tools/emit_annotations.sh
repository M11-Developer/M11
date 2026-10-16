#!/usr/bin/env bash
# ============================================================================
# يبثّ أخطاء سجل البناء على شكل تعليقات (annotations) يقرأها المطوّر/الأداة
# عبر واجهة GitHub، لأن سجلات Actions الكاملة قد تكون محجوبة.
#   tools/emit_annotations.sh <ملف السجل> [نمط الفلترة] [مستوى] [عدد]
# ============================================================================
set +e
LOG="${1:-/tmp/m11-build.log}"
PAT="${2:-ERROR|error:|Failed|failed|Unable|not found|Missing|missing|Could not|invalid|Exception}"
LEVEL="${3:-error}"
COUNT="${4:-8}"
CTX="${5:-0}"   # عدد أسطر السياق بعد كل سطر مطابق

[ -f "$LOG" ] || { echo "::warning::لا يوجد سجل في $LOG"; exit 0; }

# نجمع السطور المهمة ثم نقسّمها إلى قطع بحجم آمن (تجاوز حد التعليق الواحد)
grep -nE -A "$CTX" "$PAT" "$LOG" | tail -400 > /tmp/m11-errs.txt
if [ ! -s /tmp/m11-errs.txt ]; then
  tail -120 "$LOG" > /tmp/m11-errs.txt
fi
tail -c 12000 /tmp/m11-errs.txt | fold -w 850 | tail -"$COUNT" > /tmp/m11-chunks.txt

i=0
while IFS= read -r chunk; do
  [ -z "$chunk" ] && continue
  i=$((i + 1))
  msg="$(printf '%s' "$chunk" | sed -e 's/%/%25/g' -e 's/\r/%0D/g')"
  echo "::${LEVEL} title=M11 log $i::${msg}"
done < /tmp/m11-chunks.txt
echo "عدد التعليقات المرسلة: $i"
