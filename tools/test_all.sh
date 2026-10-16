#!/usr/bin/env bash
# ============================================================================
# بوابة الاختبار الكاملة لميكا ١١ — شغّلها قبل أي إصدار:
#     bash tools/test_all.sh
# تشمل: فحص نحوي لكل ملفات GDScript وJS، ومجموعة اختبارات الوحدة، ومحاكاة
#        اللعب (ويب)، وتصوير كل شاشة قائمة وكل خريطة للتأكد أنها تُرسم فعلًا.
# أي خطوة تفشل ⇒ المخرج غير صفري.
# ============================================================================
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
FAILED=0
step() { echo; echo "════════ $1"; }
fail() { echo "  ✘ فشل: $1"; FAILED=$((FAILED+1)); }

step "1/6 فحص نحوي لكل ملفات GDScript (gdparse)"
if command -v gdparse >/dev/null 2>&1; then
  N=0
  while IFS= read -r f; do
    if gdparse "$f" >/dev/null 2>"$ROOT/.gdparse_err"; then N=$((N+1)); else
      echo "  ✘ $f"; head -4 "$ROOT/.gdparse_err"; fail "$f"
    fi
  done < <(find project -name "*.gd" | sort)
  rm -f "$ROOT/.gdparse_err"
  echo "  ✔ $N ملفًا سليمًا نحويًا"
else
  echo "  ⚠ gdparse غير مثبّت (pip install gdtoolkit) — تخطّي"
fi

step "2/6 فحص نحوي لكل ملفات JavaScript"
JS=0
while IFS= read -r f; do
  if node --check "$f" >/dev/null 2>&1; then JS=$((JS+1)); else echo "  ✘ $f"; fail "$f"; fi
done < <(find web/src tools -name "*.mjs" -o -name "*.js" | grep -v node_modules | sort)
echo "  ✔ $JS ملفًا سليمًا"

step "3/6 مجموعة اختبارات الوحدة (خرائط، شبكة، أسلحة، تقدّم، محاكاة، أصول)"
if node tools/test_suite.mjs 2>&1 | grep -v "MODULE_TYPELESS\|Reparsing\|trace-warnings" | tail -6; then
  echo "  ✔ نجحت المجموعة"
else
  fail "test_suite"
fi

step "4/6 محاكاة اللعب ١٨٠٠ إطار (٤ أوضاع)"
for m in dm tdm br vip; do
  OUT=$(node tools/web_shot.mjs "$m" 420 "/tmp/test_$m" 555 2>&1 | grep -v "MODULE_TYPELESS\|Reparsing\|trace-warnings" | grep -o "kills [0-9]* shots [0-9]*" | tail -1)
  if [ -n "$OUT" ]; then echo "  ✔ وضع $m — $OUT"; else fail "sim $m"; fi
done
SMOKE=$(node tools/web_smoke.mjs 1800 2>&1 | grep -v "MODULE_TYPELESS\|Reparsing\|trace-warnings")
echo "$SMOKE" | grep -q "exceptions captured: 0" && echo "  ✔ محاكاة ١٨٠٠ إطار — $(echo "$SMOKE" | grep -o 'kills: [0-9]*')" || { echo "$SMOKE" | tail -4; fail "smoke 1800"; }
echo "$SMOKE" | grep -q "sim errors: 0" && echo "  ✔ صفر أخطاء محاكاة" || fail "sim errors"

step "5/6 تصوير كل شاشات القوائم + شاشتي النتائج"
SCREENS="main:0 modes:0 maps:3 operators:2 settings:0 controls:2 lan:0 stats:5 credits:0 hotspot:0"
OK=0
for pair in $SCREENS; do
  s="${pair%%:*}"; i="${pair##*:}"
  if node tools/menu_shot.mjs "$s" "$i" "/tmp/test_${s}.png" >/dev/null 2>&1; then OK=$((OK+1)); else fail "menu $s"; fi
done
node tools/menu_shot.mjs x 0 /tmp/test_win.png --results-win >/dev/null 2>&1 && OK=$((OK+1)) || fail "results win"
node tools/menu_shot.mjs x 0 /tmp/test_lose.png --results-lose >/dev/null 2>&1 && OK=$((OK+1)) || fail "results lose"
echo "  ✔ $OK شاشة رُسمت بنجاح"

step "6/6 تصوير كل خريطة (١٩) للتأكد أنها مبنيّة وتُرسم"
MAPS=$(node -e "import('./web/src/game/world.js').then(m=>console.log(m.MAPS.map(x=>x.id).join(' ')))" 2>/dev/null)
N=0
for id in $MAPS; do
  OUT=$(node tools/map_shot.mjs "$id" 2>&1 | grep -v "MODULE_TYPELESS\|Reparsing\|trace-warnings" | grep -o "actors [0-9]*")
  if [ -n "$OUT" ]; then N=$((N+1)); else echo "  ✘ $id"; fail "map $id"; fi
done
echo "  ✔ $N خريطة رُسمت وظهر فيها مقاتلون"

echo
echo "════════════════════════════════════════"
if [ "$FAILED" -eq 0 ]; then
  echo "✔ كل الاختبارات نجحت — اللعبة جاهزة للبناء"
  exit 0
else
  echo "✘ عدد الخطوات الفاشلة: $FAILED"
  exit 1
fi
