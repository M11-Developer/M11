#!/usr/bin/env python3
# ============================================================================
# إدراج بيانات مفتاح التوقيع داخل ملف إعدادات التصدير (export_presets.cfg)
#   python3 tools/patch_presets.py <مسارات المفتاح> <اسم المستخدم> <كلمة السر>
# يعمل على كل الأقسام [preset.N.options] ويضيف السطور إن لم تكن موجودة،
# أو يحدّث قيمها إن كانت موجودة. السبب: Godot يحتاج السطور موجودة مسبقًا،
# وملفنا لا يحويها إطلاقًا (كان sed يفشل بصمت).
# ============================================================================
import re
import sys

KEYS = ["keystore/release", "keystore/release_user", "keystore/release_password",
        "keystore/debug", "keystore/debug_user", "keystore/debug_password"]


def patch(path: str, values: dict) -> int:
    lines = open(path, encoding="utf-8").read().splitlines()
    out, i, changed, in_options = [], 0, 0, False
    while i < len(lines):
        line = lines[i]
        if line.startswith("[preset.") and line.endswith("]") and "options" not in line:
            in_options = False
        if line.strip().startswith("[preset.") and "options" in line:
            in_options = True
        # نجمع كتلة القسم كاملة لنعرف هل نحن في نهايتها
        if in_options:
            # نهاية القسم = سطر يبدأ بـ '[' بعده، أو نهاية الملف
            j = i
            block = []
            while j < len(lines) and not (j > i and lines[j].startswith("[")):
                block.append(lines[j])
                j += 1
            for key, val in values.items():
                pat = re.compile(rf"^{re.escape(key)}=.*$")
                hit = False
                for idx, bl in enumerate(block):
                    if pat.match(bl):
                        block[idx] = f'{key}="{val}"'
                        hit = True
                        changed += 1
                if not hit:
                    block.append(f'{key}="{val}"')
                    changed += 1
            out.extend(block)
            i = j
            in_options = False
            continue
        out.append(line)
        i += 1
    open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")
    return changed


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("الاستخدام: patch_presets.py <البذرة> <المستخدم> <كلمة السر> [ملف الإعدادات]")
        raise SystemExit(2)
    ks, user, pw = sys.argv[1:4]
    cfg = sys.argv[4] if len(sys.argv) > 4 else "project/export_presets.cfg"
    n = patch(cfg, {"keystore/release": ks, "keystore/release_user": user,
                    "keystore/release_password": pw})
    print(f"✔ حُدِّثت {n} سطرًا في {cfg}")
    for l in open(cfg, encoding="utf-8"):
        if "keystore/" in l:
            print("  " + l.rstrip())
