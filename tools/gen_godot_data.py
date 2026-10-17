#!/usr/bin/env python3
"""يولّد جداول بيانات GDScript من نفس مصادر بايثون (مصدر حقيقة واحد).

  python3 tools/gen_godot_data.py

يُنتج project/src/game/data_generated.gd الذي يحوي:
  • جداول الأسلحة (كل الإحصاءات: ضرر، معدل، مخزن، ارتداد، انتشار، سرعة طلقة...)
  • الملحقات (Attachments)
  • المشغلين (10: 5 ذكور + 5 إناث) وملفاتهم
  • المستويات الصعبة للبوتات وشروط الفوز
  • الفهرس اللوني (48-64 لونًا) من لوحة المشروع
هكذا لا يختلف توازن السلاح بين نسخة الويب ونسخة جودوت أبدًا.
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from m11lib import palette as pal      # noqa: E402
from m11lib import weapons_gen as WG   # noqa: E402
from m11lib import char_rig as CR      # noqa: E402

OUT = os.path.join(ROOT, "project", "src", "game", "data_generated.gd")

# --------------------------------------------------------------------------
# جداول توازن الأسلحة — نفس ما في web/src/game/weapons.js (يُقرأ ويُطابق)
# --------------------------------------------------------------------------
WEAPON_TUNING = {
    # key: (dmg_body, dmg_head, rpm, mag, reload, spread, recoil, velocity, pen, range, rarity, weight, cls)
    "n9":          (24, 34, 380, 15, 1.5, 0.9, 1.0, 900, 0, 520, "common", 1.0),
    "scorpion":    (19, 27, 900, 20, 1.7, 1.5, 0.7, 830, 0, 460, "uncommon", 1.1),
    "handcannon":  (52, 78, 150, 6, 2.2, 1.6, 2.6, 880, 1, 620, "rare", 1.6),
    "zarqa":       (21, 30, 780, 30, 2.0, 1.3, 0.8, 900, 0, 520, "common", 1.2),
    "harrasa":     (23, 33, 660, 25, 2.1, 1.4, 0.9, 880, 0, 500, "common", 1.2),
    "timsah":      (20, 29, 820, 32, 2.3, 1.2, 0.75, 870, 0, 540, "rare", 1.3),
    "jabha":       (33, 47, 600, 30, 2.4, 1.1, 1.3, 950, 1, 800, "common", 2.4),
    "fahd":        (31, 44, 660, 30, 2.3, 1.2, 1.2, 960, 1, 780, "uncommon", 2.3),
    "saqr":        (35, 50, 520, 25, 2.6, 1.0, 1.5, 980, 1, 860, "rare", 2.7),
    "raad":        (36, 52, 480, 40, 3.2, 1.3, 1.7, 940, 2, 900, "epic", 3.3),
    "shaheen":     (88, 130, 42, 5, 3.4, 0.4, 4.5, 1200, 2, 2100, "rare", 3.0),
    "uqab":        (76, 112, 55, 8, 3.0, 0.5, 4.0, 1150, 2, 1800, "epic", 2.9),
    "thuban":      (105, 160, 32, 5, 4.0, 0.3, 5.4, 1300, 3, 2400, "legendary", 3.6),
    "mitraqa":     (14, 20, 75, 6, 2.8, 5.2, 3.0, 640, 0, 260, "common", 2.6),
    "muzdawija":   (16, 23, 120, 2, 2.4, 6.0, 3.4, 620, 0, 240, "uncommon", 2.4),
    "ali":         (12, 17, 220, 10, 3.1, 4.4, 2.6, 660, 0, 280, "rare", 3.0),
    "minjal":      (32, 46, 700, 100, 4.6, 1.8, 1.4, 950, 2, 800, "epic", 3.8),
    "jarrar":      (38, 55, 560, 150, 5.2, 2.0, 1.6, 980, 2, 900, "legendary", 4.4),
    "shuaa":       (26, 38, 900, 40, 2.2, 0.9, 0.6, 1100, 1, 700, "epic", 1.8),
    "najm":        (60, 90, 240, 25, 2.8, 1.1, 1.0, 1250, 2, 900, "mythic", 2.2),
    "burkan":      (85, 120, 40, 1, 3.6, 2.2, 5.0, 520, 2, 700, "rare", 3.4),
    "zilzal":      (130, 180, 22, 1, 5.0, 1.6, 6.4, 460, 3, 900, "legendary", 4.6),
    "shama":       (12, 16, 60, 1, 2.0, 1.0, 1.2, 600, 0, 300, "common", 0.9),
    "shafra":      (44, 64, 120, 0, 0.0, 0.0, 0.0, 0, 0, 34, "common", 0.6),
    "fas":         (62, 90, 80, 0, 0.0, 0.0, 0.0, 0, 0, 38, "uncommon", 1.2),
    "minjal_melee": (52, 76, 95, 0, 0.0, 0.0, 0.0, 0, 0, 36, "rare", 0.9),
    "hirrawa":     (38, 55, 140, 0, 0.0, 0.0, 0.0, 0, 0, 42, "common", 1.0),
    "qadifa":      (70, 70, 30, 1, 3.2, 1.8, 4.0, 480, 0, 600, "epic", 3.2),
}

FIRE_MODES = {"scorpion": "auto", "shuaa": "auto", "najm": "auto", "ali": "auto", "minjal": "auto",
              "jarrar": "auto", "jabha": "auto", "fahd": "auto", "raad": "auto", "saqr": "auto",
              "zarqa": "auto", "harrasa": "auto", "timsah": "auto", "n9": "semi", "handcannon": "semi"}

ATTACHMENTS = {
    "red_dot":   {"slot": "sight", "name_ar": "نقطة حمراء", "zoom": 1.15, "spread": -0.06, "weight": 0.2},
    "holo":      {"slot": "sight", "name_ar": "هولوغرامي", "zoom": 1.2, "spread": -0.08, "weight": 0.25},
    "scope_2x":  {"slot": "sight", "name_ar": "منظار 2×", "zoom": 1.6, "spread": -0.1, "weight": 0.35},
    "scope_4x":  {"slot": "sight", "name_ar": "منظار 4×", "zoom": 2.4, "spread": -0.14, "weight": 0.5},
    "scope_8x":  {"slot": "sight", "name_ar": "منظار 8×", "zoom": 3.6, "spread": -0.18, "weight": 0.7},
    "suppressor": {"slot": "muzzle", "name_ar": "كاتم صوت", "sound_range": 0.35, "damage": -0.05, "weight": 0.3},
    "ext_mag":   {"slot": "mag", "name_ar": "مخزن موسّع", "mag": 1.5, "weight": 0.3},
    "foregrip":  {"slot": "grip", "name_ar": "مقبض أمامي", "recoil": -0.22, "weight": 0.2},
    "laser":     {"slot": "laser", "name_ar": "ليزر", "hipfire": -0.2, "visible": True, "weight": 0.15},
    "recoil_comp": {"slot": "muzzle", "name_ar": "مخفّض ارتداد", "recoil": -0.25, "weight": 0.25},
    "bipod":     {"slot": "grip", "name_ar": "قاعدة ثنائية", "prone_recoil": -0.5, "weight": 0.4},
}


def gd_value(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return '"%s"' % v
    if isinstance(v, float):
        return repr(round(v, 4))
    if v is None:
        return "null"
    return str(v)


def gd_dict(d, indent=1):
    pad = "\t" * indent
    items = []
    for k, v in d.items():
        key = '"%s"' % k if isinstance(k, str) and not k.isidentifier() else (str(k) if not isinstance(k, str) else '"%s"' % k)
        if isinstance(v, dict):
            items.append(f"{pad}{key}: {gd_dict(v, indent + 1)}")
        elif isinstance(v, (list, tuple)):
            items.append(f"{pad}{key}: [{', '.join(gd_value(x) for x in v)}]")
        else:
            items.append(f"{pad}{key}: {gd_value(v)}")
    return "{\n" + ",\n".join(items) + "\n" + "\t" * (indent - 1) + "}"


def main():
    header = '''# ============================================================================
# ملف مولّد آليًا — لا تُحرّره يدويًا.
# المصدر: tools/gen_godot_data.py (يقرأ نفس بيانات بايثون التي بنت الأصول).
# أعِد التوليد بـ:  python3 tools/gen_godot_data.py
# ============================================================================
extends RefCounted
class_name M11Data

'''
    parts = [header]

    # الأسلحة
    parts.append("const WEAPONS: Dictionary = {\n")
    for spec in WG.SPECS:
        t = WEAPON_TUNING.get(spec.key)
        if not t:
            continue
        dmg, head, rpm, mag, reload, spread, recoil, vel, pen, rng, rarity, weight = t
        w = {
            "name_ar": spec.name_ar,
            "cls": spec.cls,
            "slot": "primary" if spec.cls in ("ar", "smg", "sr", "shotgun", "lmg", "energy", "launcher") else "secondary",
            "damage": dmg, "damage_head": head, "rpm": rpm, "mag": mag,
            "reload": reload, "spread": spread, "recoil": recoil,
            "velocity": vel, "penetration": pen, "range": rng,
            "rarity": rarity, "weight": weight,
            "fire_mode": FIRE_MODES.get(spec.key, "semi"),
            "pellets": 8 if spec.cls == "shotgun" else 1,
            "falloff": 0.72 if spec.cls in ("smg", "pistol") else 0.85,
            "auto": FIRE_MODES.get(spec.key, "semi") == "auto",
        }
        parts.append("\t%s: %s,\n" % ('"%s"' % spec.key, gd_dict(w, 2)))
    parts.append("}\n\n")

    parts.append("const ATTACHMENTS: Dictionary = {\n")
    for k, v in ATTACHMENTS.items():
        parts.append("\t%s: %s,\n" % ('"%s"' % k, gd_dict(v, 2)))
    parts.append("}\n\n")

    # المشغلون
    parts.append("const OPERATORS: Array = [\n")
    for op in CR.OPERATORS:
        parts.append('\t{"key": "%s", "name_ar": "%s", "gender": "%s", "style": "%s", "uniform": "%s", "accent": "%s"},\n'
                     % (op.key, op.name_ar, op.gender, op.style, op.uniform, op.accent))
    parts.append("]\n\n")

    parts.append('''const DIFFICULTY: Array = [
	{"name_ar": "سَهْل", "reaction": 0.62, "accuracy": 0.42, "awareness": 0.55, "aggression": 0.45, "move_speed": 0.82},
	{"name_ar": "عادي", "reaction": 0.42, "accuracy": 0.58, "awareness": 0.72, "aggression": 0.6, "move_speed": 0.9},
	{"name_ar": "صعب", "reaction": 0.28, "accuracy": 0.72, "awareness": 0.85, "aggression": 0.72, "move_speed": 0.97},
	{"name_ar": "خبير", "reaction": 0.18, "accuracy": 0.84, "awareness": 0.94, "aggression": 0.85, "move_speed": 1.0},
	{"name_ar": "أسطوري", "reaction": 0.1, "accuracy": 0.93, "awareness": 1.0, "aggression": 0.95, "move_speed": 1.05},
]

const BOT_NAMES: Array = ["فهد", "عقاب", "صقر", "خنجر", "رعد", "بركان", "شاهين", "ثعبان", "منجل", "جرّار", "زلزال", "نجم"]

const MODES: Dictionary = {
	"br": {"name_ar": "معركة البقاء", "teams": 1, "respawn": false, "loot": true, "zone": true, "dbno": true, "time": 900},
	"dm": {"name_ar": "الكل ضد الكل", "teams": 1, "respawn": true, "score_limit": 50, "time": 480},
	"tdm": {"name_ar": "فريق ضد فريق", "teams": 2, "respawn": true, "score_limit": 75, "time": 600},
	"snd": {"name_ar": "زرع وتفجير", "teams": 2, "respawn": false, "rounds": 7, "time": 120},
	"ctf": {"name_ar": "الاستيلاء على العلم", "teams": 2, "respawn": true, "score_limit": 5, "time": 720},
	"kotc": {"name_ar": "ملك التل", "teams": 2, "respawn": true, "score_limit": 300, "time": 600},
	"gun": {"name_ar": "سباق الأسلحة", "teams": 1, "respawn": true, "gun_game": true, "time": 600},
	"snipers": {"name_ar": "القنّاصة فقط", "teams": 2, "respawn": true, "pool": ["shaheen", "uqab", "thuban"]},
	"meleeOnly": {"name_ar": "المشاجرة فقط", "teams": 1, "respawn": true, "pool": ["shafra", "fas", "minjal_melee", "hirrawa"]},
	"pistols": {"name_ar": "المسدسات فقط", "teams": 2, "respawn": true, "pool": ["n9", "scorpion", "handcannon"]},
	"infection": {"name_ar": "العدوى", "teams": 2, "respawn": true, "time": 420},
	"survival": {"name_ar": "موجات البقاء", "teams": 1, "respawn": true, "waves": true, "time": 1200},
	"armsRace": {"name_ar": "سباق التسلح", "teams": 2, "respawn": true, "random_weapon": true},
	"training": {"name_ar": "ساحة التدريب", "teams": 0, "respawn": true, "targets": true},
	"custom": {"name_ar": "غرفة مخصصة", "teams": 1, "respawn": true},
	"tournament": {"name_ar": "بطولة", "teams": 1, "respawn": false, "tournament": true, "time": 480},
	"vip": {"name_ar": "اغتيال الشخصية المهمة", "teams": 2, "respawn": true, "vip": true, "time": 600},
	"goldenCard": {"name_ar": "الكرت الذهبي", "teams": 2, "respawn": true, "golden": true, "time": 600},
	"elevator": {"name_ar": "المصعد", "teams": 1, "respawn": true, "elevator": true, "time": 600},
}

const GUN_GAME_LADDER: Array = ["n9", "scorpion", "zarqa", "harrasa", "timsah", "mitraqa", "jabha", "fahd", "uqab", "minjal", "raad", "shuaa", "shaheen", "shafra"]

const PACKAGE_ID: String = "com.m11.localwar"
const APP_NAME_AR: String = "ميكا ١١"
const MIN_SDK: int = 26
const TARGET_SDK: int = 35
const PERMISSIONS: Array = ["ACCESS_WIFI_STATE", "CHANGE_WIFI_MULTICAST_STATE", "NEARBY_WIFI_DEVICES"]
''')

    # اللوحة اللونية
    parts.append("const PALETTE_NAMES: Array = [\n")
    for n in pal.NAMES:
        parts.append('\t"%s",\n' % n)
    parts.append("]\n\nconst PALETTE_HEX: Dictionary = {\n")
    for n in pal.NAMES:
        parts.append('\t"%s": "%s",\n' % (n, pal.ALL[n]))
    parts.append("}\n")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("".join(parts))
    size = os.path.getsize(OUT)
    print(f"✔ كُتب {os.path.relpath(OUT, ROOT)} ({size // 1024} KB) — "
          f"{len(WG.SPECS)} سلاحًا، {len(ATTACHMENTS)} ملحقًا، {len(CR.OPERATORS)} مشغلًا، {len(pal.NAMES)} لونًا")


if __name__ == "__main__":
    main()
