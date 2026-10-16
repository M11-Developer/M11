#!/usr/bin/env bash
# ============================================================================
# إدراج بيانات مفتاح التوقيع في ملف إعدادات التصدير (بلا بايثون — awk فقط)
#   tools/patch_presets.sh <مسار المفتاح> <المستخدم> <كلمة السر> [الملف]
# Godot يحتاج السطور موجودة داخل قسم [preset.N.options]، وملفنا لا يحويها.
# ============================================================================
set -euo pipefail

KS="${1:?مسار المفتاح مطلوب}"
US="${2:-m11}"
PW="${3:-m11localwar}"
CFG="${4:-project/export_presets.cfg}"

awk -v ks="$KS" -v us="$US" -v pw="$PW" '
function is_hdr(l) { return l ~ /^\[/ }
{
  L[NR] = $0
  N = NR
}
END {
  # 1) نجمع مواضع بدايات الأقسام
  ns = 0
  for (i = 1; i <= N; i++) if (is_hdr(L[i])) { S[++ns] = i; H[ns] = L[i] }
  out = 0
  for (s = 1; s <= ns; s++) {
    beg = S[s]
    end = (s < ns) ? S[s + 1] - 1 : N
    opts = (H[s] ~ /\.options\]/)
    # نطبع سطر العنوان
    print L[beg]
    if (!opts) {
      for (i = beg + 1; i <= end; i++) print L[i]
      continue
    }
    # نطبع محتوى القسم مع تحديث أسطر المفتاح وإسقاط المكرّر
    inserted = 0
    for (i = beg + 1; i <= end; i++) {
      if (L[i] ~ /^keystore\/release=/)         { print "keystore/release=\"" ks "\""; inserted = 1; continue }
      if (L[i] ~ /^keystore\/release_user=/)    { print "keystore/release_user=\"" us "\""; continue }
      if (L[i] ~ /^keystore\/release_password=/) { print "keystore/release_password=\"" pw "\""; continue }
      print L[i]
    }
    if (!inserted) {
      print "keystore/release=\"" ks "\""
      print "keystore/release_user=\"" us "\""
      print "keystore/release_password=\"" pw "\""
    }
  }
}
' "$CFG" > "$CFG.tmp"
mv "$CFG.tmp" "$CFG"
echo "✔ بيانات المفتاح مُدرجة في $CFG"
grep -n "keystore/" "$CFG" || true
