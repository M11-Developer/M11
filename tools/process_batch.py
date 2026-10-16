#!/usr/bin/env python3
"""خط معالجة دفعات الصور المولّدة (القسم 17 من دفتر المشروع).

يمرّر **كل** صورة في `project/assets/raw/` على الخطوات:
  1. إزالة مفتاح اللون (ماجنتا) أو الخلفية الصلبة.
  2. تنظيف البكسلات الشاردة (Stray pixels).
  3. تكميم الألوان على اللوحة الرئيسية (71 لونًا).
  4. الحفاظ على حد 1 بكسل (الأصول المولّدة أصلًا بحد — لا نضيف حدًا مزدوجًا).
  5. اختزال بعدد صحيح إلى المقاس المستهدف (Nearest) — بلا أي تنعيم.
  6. حفظ الناتج في `project/assets/processed/` + سطر في `CREDITS.md` + تقرير JSON.

التشغيل:  python3 tools/process_batch.py [--only name1,name2]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from m11lib import draw as D          # noqa: E402
from m11lib import palette as pal     # noqa: E402
from process_asset import (strip_chroma_key, strip_background, defringe,
                           neutralize_shadow, _clean_stray)  # noqa: E402

RAW_DIR = os.path.join(ROOT, "project", "assets", "raw")
OUT_DIR = os.path.join(ROOT, "project", "assets", "processed")
CREDITS = os.path.join(ROOT, "CREDITS.md")

# كل أصل: الوصف، المقاس المستهدف (0 = كما هو)، وهل يُترك شفافًا
JOBS: dict[str, dict] = {
    # لوحات فنّية كاملة (خلفيات) → مضاعف صحيح للدقة الداخلية 640×360
    "key_art_menu": {"desc": "لوحة القائمة الرئيسية (Key Art)", "target": (1280, 720), "alpha": False},
    "poster_loading": {"desc": "بوستر شاشة التحميل", "target": (1280, 720), "alpha": False},
    # أوراق سبرايتات (مرجع فنّي + مقارنة جودة)
    "sheet_char_male": {"desc": "ورقة وضعيات — مقاتل (8 وضعيات)", "target": (0, 0), "alpha": True},
    "sheet_char_female": {"desc": "ورقة وضعيات — مقاتلة (8 وضعيات)", "target": (0, 0), "alpha": True},
    "sheet_weapons": {"desc": "ورقة أسلحة (8 قطع)", "target": (0, 0), "alpha": True},
    "sheet_vfx": {"desc": "ورقة مؤثرات (انفجار 8 إطارات + وميض + دخان)", "target": (0, 0), "alpha": True},
    "tileset_military": {"desc": "مجموعة تايلات — عسكري/صناعي", "target": (0, 0), "alpha": True},
    "tileset_desert": {"desc": "مجموعة تايلات — صحراوي/قرية", "target": (0, 0), "alpha": True},
    "ui_kit": {"desc": "مجموعة واجهة (HUD Kit): إطارات وأزرار ومؤشرات", "target": (0, 0), "alpha": True},
    "app_icon_art": {"desc": "أيقونة التطبيق (لوحة فنية مربعة)", "target": (512, 512), "alpha": False},
    "sheet_char_urban": {"desc": "ورقة وضعيات — مقاتل عمليات ليلية", "target": (0, 0), "alpha": True},
    "sheet_char_desert": {"desc": "ورقة وضعيات — مقاتلة استطلاع صحراوي", "target": (0, 0), "alpha": True},
    "sheet_attachments": {"desc": "ورقة ملحقات الأسلحة (11 ملحقًا)", "target": (0, 0), "alpha": True},
    "sheet_weapons_heavy": {"desc": "ورقة أسلحة ثقيلة ومتفجرات (8 قطع)", "target": (0, 0), "alpha": True},
    "sheet_vehicles": {"desc": "ورقة مركبات وعتاد ميداني (8 قطع)", "target": (0, 0), "alpha": True},
    "sheet_icons_rank": {"desc": "مجموعة أوسمة ورتب (12 أيقونة)", "target": (0, 0), "alpha": True},
    "tileset_snow": {"desc": "مجموعة تايلات — ثلج/جبل", "target": (0, 0), "alpha": True},
    "tileset_scifi": {"desc": "مجموعة تايلات — محطة فضائية", "target": (0, 0), "alpha": True},
    # --- الدفعة الثالثة: طبقات منظر + أيقونات غنائم + بورتريهات + مركبات + واجهة + عناصر
    "bg_parallax_desert": {"desc": "طبقة منظر — واحة صحراوية (16:9)", "target": (1280, 720), "alpha": False},
    "bg_parallax_forest_night": {"desc": "طبقة منظر — غابة ليلية (16:9)", "target": (1280, 720), "alpha": False},
    "bg_parallax_factory": {"desc": "طبقة منظر — مصنع (16:9)", "target": (1280, 720), "alpha": False},
    "bg_parallax_snow": {"desc": "طبقة منظر — جبال ثلجية (16:9)", "target": (1280, 720), "alpha": False},
    "bg_parallax_space": {"desc": "طبقة منظر — محطة فضائية (16:9)", "target": (1280, 720), "alpha": False},
    "sheet_loot_icons": {"desc": "أيقونات غنائم (12 قطعة)", "target": (0, 0), "alpha": True},
    "sheet_operator_portraits": {"desc": "بورتريهات المشغلين (8 وجوه)", "target": (0, 0), "alpha": True},
    "sheet_vehicles_air": {"desc": "مركبات جوية ومائية (6 مركبات)", "target": (0, 0), "alpha": True},
    "ui_scoreboard": {"desc": "واجهة لوحة النتائج والأوامر السريعة", "target": (0, 0), "alpha": True},
    "sheet_props_nature": {"desc": "عناصر طبيعية للخرائط (12 عنصرًا)", "target": (0, 0), "alpha": True},
    # --- الدفعة الرابعة: عناصر داخلية + طقس + آثار + تايلات + أوسمة + عتاد + واجهة + منظر
    # --- الدفعة الخامسة: بيئات (ساحل/واحة ليلية) + تايلات (ميناء/مستنقع) + أصول كبيرة
    "bg_parallax_coast": {"desc": "طبقة منظر — ساحل وميناء (16:9)", "target": (1280, 720), "alpha": False},
    "bg_parallax_oasis_night": {"desc": "طبقة منظر — واحة ليلية (16:9)", "target": (1280, 720), "alpha": False},
    "tileset_port": {"desc": "مجموعة تايلات — ميناء وحاويات", "target": (0, 0), "alpha": True},
    "tileset_swamp": {"desc": "مجموعة تايلات — مستنقع/أدغال", "target": (0, 0), "alpha": True},
    "sheet_trees_big": {"desc": "أشجار ضخمة (5 أشجار، ارتفاع 110 بكسل)", "target": (0, 0), "alpha": True},
    "sheet_debris_rubble": {"desc": "أنقاض ودمار (14 قطعة)", "target": (0, 0), "alpha": True},
    "sheet_cars_wrecked": {"desc": "سيارات مدنية محطمة (8 مركبات)", "target": (0, 0), "alpha": True},
    "sheet_platforms_industrial": {"desc": "منصات وجسور صناعية (12 قطعة)", "target": (0, 0), "alpha": True},
    "sheet_flags": {"desc": "رايات وأعلام بلا شعارات (10 قطع)", "target": (0, 0), "alpha": True},

    # --- الدفعة السادسة: بحرية/سفن + لافتات + مؤثرات كبيرة + أيقونات أوضاع + مبانٍ
    "sheet_signs": {"desc": "لافتات ولوحات فارغة بلا نص (12 قطعة)", "target": (0, 0), "alpha": True},
    "bg_parallax_sea_storm": {"desc": "طبقة منظر — بحر عاصف (16:9)", "target": (1280, 720), "alpha": False},
    "bg_parallax_naval_base": {"desc": "طبقة منظر — قاعدة بحرية عند الفجر (16:9)", "target": (1280, 720), "alpha": False},
    "sheet_boats": {"desc": "زوارق وقوارب بحرية (8 قطع)", "target": (0, 0), "alpha": True},
    "sheet_ships_big": {"desc": "سفن كبيرة (5 سفن، هياكل بلا شعارات)", "target": (0, 0), "alpha": True},
    "tileset_ship_interior": {"desc": "مجموعة تايلات — داخل سفينة/مركبة", "target": (0, 0), "alpha": True},
    "sheet_explosion_big": {"desc": "انفجار كبير (12 إطارًا 128×128)", "target": (0, 0), "alpha": True},
    "sheet_gas_smoke_fx": {"desc": "غازات ودخان (10 عناصر مؤثرات)", "target": (0, 0), "alpha": True},
    "sheet_mode_icons": {"desc": "أيقونات أوضاع اللعب (16 أيقونة)", "target": (0, 0), "alpha": True},
    "sheet_buildings_large": {"desc": "مبانٍ كبيرة معيارية (8 مبانٍ)", "target": (0, 0), "alpha": True},
    # --- الدفعة السابعة: تايلات مكمّلة + مركبات أرضية + ديكور + واجهة لمس + شعارات + مختبر
    "tileset_space": {"desc": "مجموعة تايلات — محطة فضائية بسقف وأرضية", "target": (0, 0), "alpha": True},
    "tileset_deck_naval": {"desc": "مجموعة تايلات — سطح سفينة حربية", "target": (0, 0), "alpha": True},
    "tileset_village_clay": {"desc": "مجموعة تايلات — قرية طينية صحراوية", "target": (0, 0), "alpha": True},
    "sheet_vehicles_land": {"desc": "مركبات أرضية (8 مركبات)", "target": (0, 0), "alpha": True},
    "sheet_road_props": {"desc": "ديكور شوارع ومرور (12 قطعة)", "target": (0, 0), "alpha": True},
    "sheet_props_nature": {"desc": "عناصر طبيعية إضافية (12 عنصرًا)", "target": (0, 0), "alpha": True},
    "sheet_props_indoor": {"desc": "أثاث داخلي (12 قطعة)", "target": (0, 0), "alpha": True},
    "sheet_ui_touch": {"desc": "عناصر واجهة لمس كبيرة (16 عنصرًا)", "target": (0, 0), "alpha": True},
    "sheet_team_badges": {"desc": "شعارات فرق وأوسمة (12 شعارًا)", "target": (0, 0), "alpha": True},
    "sheet_corp_lab": {"desc": "عتاد مختبر وشركة (12 قطعة)", "target": (0, 0), "alpha": True},
    # --- الدفعة الثامنة: مباني وأصول عملاقة (طوابق، أبراج، خزانات، سطوح، أسوار، جسور، مصاعد، مدافع، مولّدات)
    "sheet_building_floors": {"desc": "مقاطع مبنى متعدد الطوابق (12 قطعة)", "target": (0, 0), "alpha": True},
    "sheet_watchtowers": {"desc": "أبراج مراقبة (4 أبراج)", "target": (0, 0), "alpha": True},
    "sheet_water_tanks": {"desc": "خزانات وصوامع صناعية (6 قطع)", "target": (0, 0), "alpha": True},
    "sheet_roof_details": {"desc": "تفاصيل سطوح (12 قطعة)", "target": (0, 0), "alpha": True},
    "sheet_gates_fences": {"desc": "بوابات وأسوار (12 قطعة)", "target": (0, 0), "alpha": True},
    "sheet_bridge_broken": {"desc": "مقاطع جسر خشبي مكسور (6 قطع)", "target": (0, 0), "alpha": True},
    "sheet_elevator": {"desc": "مصاعد ومنصات صناعية (8 قطع)", "target": (0, 0), "alpha": True},
    "sheet_aa_gun": {"desc": "مدافع مضادة للطائرات (4 مدافع)", "target": (0, 0), "alpha": True},
    "sheet_generator_unit": {"desc": "وحدات توليد ومحطات كهرباء (6 وحدات)", "target": (0, 0), "alpha": True},
    "sheet_wall_modular": {"desc": "تايلات تحصينات معيارية (16 بلاطة)", "target": (0, 0), "alpha": True},
    # --- الدفعة التاسعة: طبقات سماء وأجواء (10 طبقات، خلفيات 16:9)
    "bg_sky_storm": {"desc": "طبقة سماء — عاصفة رعدية (16:9)", "target": (1280, 720), "alpha": False},
    "bg_sky_dust": {"desc": "طبقة سماء — عاصفة غبار صحراوية (16:9)", "target": (1280, 720), "alpha": False},
    "bg_sky_snowfall": {"desc": "طبقة سماء — تساقط ثلج (16:9)", "target": (1280, 720), "alpha": False},
    "bg_sky_dawn": {"desc": "طبقة سماء — فجر بتدرّج دافئ (16:9)", "target": (1280, 720), "alpha": False},
    "bg_sky_galaxy": {"desc": "طبقة سماء — ليل بمجرة ونجوم (16:9)", "target": (1280, 720), "alpha": False},
    "bg_sky_war_red": {"desc": "طبقة سماء — حرب حمراء ودخان (16:9)", "target": (1280, 720), "alpha": False},
    "bg_sky_station": {"desc": "طبقة سماء — داخل محطة فضائية (16:9)", "target": (1280, 720), "alpha": False},
    "bg_sky_cave_glow": {"desc": "طبقة سماء — كهف مضيء بالبلورات (16:9)", "target": (1280, 720), "alpha": False},
    "bg_sky_swamp": {"desc": "طبقة سماء — مستنقع ضبابي (16:9)", "target": (1280, 720), "alpha": False},
    "bg_sky_port_fog": {"desc": "طبقة سماء — ميناء ضبابي ليلًا (16:9)", "target": (1280, 720), "alpha": False},
    # --- الدفعة العاشرة: تطوير بحري (عتاد سفن، أوناش، حفر نفط، هياكل سفن، تحت الماء، موجات، مراكب، بورتريهات)
    "sheet_naval_gear": {"desc": "عتاد بحري (12 قطعة)", "target": (0, 0), "alpha": True},
    "sheet_dock_cranes": {"desc": "أوناش ميناء (6 أوناش)", "target": (0, 0), "alpha": True},
    "tileset_oil_rig": {"desc": "مجموعة تايلات — منصة حفر بحرية", "target": (0, 0), "alpha": True},
    "sheet_ship_hull": {"desc": "مقاطع هياكل سفن (8 مقاطع)", "target": (0, 0), "alpha": True},
    "sheet_underwater": {"desc": "عناصر تحت الماء (12 عنصرًا)", "target": (0, 0), "alpha": True},
    "sheet_naval_vehicles": {"desc": "مراكب قابلة للاستعمال (6 مراكب)", "target": (0, 0), "alpha": True},
    "sheet_water_surface": {"desc": "أشرطة سطح الماء المتغيّرة (8 أشرطة)", "target": (0, 0), "alpha": True},
    "sheet_operators_new": {"desc": "بورتريهات 10 مشغّلين جدد", "target": (0, 0), "alpha": True},
    "bg_parallax_oil_rig": {"desc": "طبقة منظر — منصة نفط عند الغروب (16:9)", "target": (1280, 720), "alpha": False},
    "bg_sky_harbor_dawn": {"desc": "طبقة سماء — ميناء عند الفجر (16:9)", "target": (1280, 720), "alpha": False},
    # --- الدفعة الثانية عشرة: فن ترويجي وملصقات وأيقونة الإصدار ---
    "promo_hero_squad": {"desc": "فن ترويجي — الفرقة في بلدة محترقة (16:9)", "target": (1280, 720), "alpha": False},
    "poster_br_drop": {"desc": "ملصق رأسي — إنزال مظلي فوق الوادي", "target": (0, 0), "alpha": False},
    "promo_naval_assault": {"desc": "فن ترويجي — إنزال بحري على الأرصفة (16:9)", "target": (1280, 720), "alpha": False},
    "poster_cqb_duel": {"desc": "ملصق رأسي — اشتباك داخل مخزن", "target": (0, 0), "alpha": False},
    "splash_boot_helmet": {"desc": "شاشة إقلاع — خوذة على أكياس رمل عند الفجر (16:9)", "target": (1280, 720), "alpha": False},
    "promo_night_ops": {"desc": "فن ترويجي — غارة ليلية بمناظير رؤية ليلية (16:9)", "target": (1280, 720), "alpha": False},
    "promo_lan_squad": {"desc": "فن ترويجي — الفرقة على السطح عند الغروب (16:9)", "target": (1280, 720), "alpha": False},
    "store_feature_banner": {"desc": "بانر المتجر العريض — بانوراما ساحة القتال", "target": (0, 0), "alpha": False},
    # --- الدفعة الحادية عشرة: مصغّرات الخرائط + فن رئيسي + ملصقات النصر/الهزيمة + أوسمة + بورتريهات + صناديق
    "sheet_map_thumbs_a": {"desc": "مصغّرات خرائط — الجزء الأول (12 خريطة)", "target": (0, 0), "alpha": True},
    "sheet_map_thumbs_b": {"desc": "مصغّرات خرائط — الجزء الثاني (8 خرائط)", "target": (0, 0), "alpha": True},
    "key_art_main": {"desc": "الفن الرئيسي — الفريق في الميناء (16:9)", "target": (1280, 720), "alpha": False},
    "key_art_naval": {"desc": "ملصق — هجوم بحري ليلي (16:9)", "target": (1280, 720), "alpha": False},
    "poster_victory": {"desc": "شاشة النصر — الفريق على الأنقاض (16:9)", "target": (1280, 720), "alpha": False},
    "poster_defeat": {"desc": "شاشة الهزيمة — خوذة وبندقية في المطر (16:9)", "target": (1280, 720), "alpha": False},
    "sheet_achievements_2": {"desc": "أوسمة إنجازات (12 وسامًا)", "target": (0, 0), "alpha": True},
    "sheet_operators_1_10": {"desc": "بورتريهات المشغّلين الأصليين (10 وجوه)", "target": (0, 0), "alpha": True},
    "sheet_supply_crates": {"desc": "صناديق عتاد وذخيرة (12 صندوقًا)", "target": (0, 0), "alpha": True},
    "sheet_props_indoor": {"desc": "عناصر داخلية/صناعية (12 عنصرًا)", "target": (0, 0), "alpha": True},
    "sheet_weather_effects": {"desc": "طبقات طقس (مطر/ثلج/ضباب/رمال/شرر)", "target": (0, 0), "alpha": True},
    "sheet_impact_decals": {"desc": "آثار الطلقات والانفجارات (16 أثرًا)", "target": (0, 0), "alpha": True},
    "tileset_urban": {"desc": "مجموعة تايلات — مدينة حديثة", "target": (0, 0), "alpha": True},
    "tileset_cave": {"desc": "مجموعة تايلات — كهف/منجم", "target": (0, 0), "alpha": True},
    "sheet_achievement_icons": {"desc": "أوسمة الإنجازات (16 شارة)", "target": (0, 0), "alpha": True},
    "sheet_gadgets": {"desc": "أدوات ميدانية (10 أدوات)", "target": (0, 0), "alpha": True},
    "sheet_melee_armor": {"desc": "مشاجرة ودروع وخوذ وحقائب (12 قطعة)", "target": (0, 0), "alpha": True},
    "ui_results_panels": {"desc": "واجهة نتائج المباراة", "target": (0, 0), "alpha": True},
    "bg_parallax_city_dusk": {"desc": "طبقة منظر — مدينة الغسق (16:9)", "target": (1280, 720), "alpha": False},
    "bg_parallax_coast": {"desc": "طبقة منظر — ساحل وميناء (16:9)", "target": (1280, 720), "alpha": False},
    "sheet_props_indoor": {"desc": "عناصر داخلية/صناعية (12 عنصرًا)", "target": (0, 0), "alpha": True},
}


def _nearest_resize(arr: np.ndarray, target: tuple[int, int]) -> np.ndarray:
    """اختزال/تكبير بعدد صحيح فقط بـNearest (يمنع أي بكسلات غير متساوية)."""
    if not target or target == (0, 0):
        return arr
    tw, th = target
    h, w = arr.shape[:2]
    if (tw, th) == (w, h):
        return arr
    sr = w / tw
    if abs(sr - round(sr)) > 0.02:
        # ليس مضاعفًا صحيحًا: نستعمل Nearest العادي لكن نوثّق النسبة
        sr_note = round(sr, 3)
    else:
        sr_note = int(round(sr))
    pil = Image.fromarray(arr, "RGBA")
    pil = pil.resize((tw, th), Image.NEAREST)
    out = np.array(pil)
    out._sr = sr_note  # type: ignore[attr-defined]
    return out


def process_one(name: str, cfg: dict, scratch: list[str]) -> dict:
    src = os.path.join(RAW_DIR, f"{name}.png")
    if not os.path.exists(src):
        return {"name": name, "status": "missing"}
    img = np.array(Image.open(src).convert("RGBA"))
    h, w = img.shape[:2]
    # 1) إزالة الخلفية (مفتاح لون أو صلبة)
    keyed = strip_chroma_key(img)
    transparent_ratio = float((keyed[..., 3] < 32).mean())
    if transparent_ratio < 0.02 and cfg.get("alpha", True):
        keyed = strip_background(keyed)
        transparent_ratio = float((keyed[..., 3] < 32).mean())
    out = keyed
    # 2) تنظيف البكسلات الشاردة
    out = defringe(out)
    out = neutralize_shadow(out)
    out = _clean_stray(out)
    # 3) تكميم الألوان على اللوحة الرئيسية
    out = D.quantize(out, pal.table())
    # 4) اختزال بعدد صحيح إن طُلب مقاس مستهدف
    tgt = tuple(cfg.get("target", (0, 0)))
    sr = 1
    if tgt != (0, 0):
        ow, oh = out.shape[1], out.shape[0]
        tw, th = tgt
        ratio = ow / tw
        sr = int(round(ratio)) if abs(ratio - round(ratio)) < 0.02 else round(ratio, 2)
        out = np.array(Image.fromarray(out, "RGBA").resize((tw, th), Image.NEAREST))
    os.makedirs(OUT_DIR, exist_ok=True)
    dst = os.path.join(OUT_DIR, f"{name}.png")
    pil = Image.fromarray(out, "RGBA")
    if not cfg.get("alpha", True):
        # خلفيات: أزل قناة الشفافية تمامًا (لا معنى للشفافية في لوحة كاملة)
        pil = pil.convert("RGB")
    pil.save(dst, "PNG", optimize=True)
    scratch.append(name)
    return {"name": name, "desc": cfg["desc"], "status": "ok",
            "raw_size": [w, h], "out_size": [pil.width, pil.height],
            "scale": sr, "transparent_pct": round(transparent_ratio * 100, 1),
            "kb_raw": round(os.path.getsize(src) / 1024, 1),
            "kb_out": round(os.path.getsize(dst) / 1024, 1)}


def append_credits(rows: list[dict]) -> None:
    if not os.path.exists(CREDITS):
        return
    with open(CREDITS, encoding="utf-8") as f:
        txt = f.read()
    marker = "## دفعات الصور المولّدة (AI) — بعد المرور على خط المعالجة"
    if marker not in txt:
        txt += ("\n\n" + marker + "\n\n"
                "| المفتاح | الوصف | الخام | بعد المعالجة | النسبة | الشفافية |\n"
                "|---|---|---|---|---|---|\n")
    lines = []
    for r in rows:
        if r.get("status") != "ok":
            continue
        key = f"`{r['name']}`"
        if key in txt:
            continue
        lines.append(f"| {key} | {r['desc']} | {r['raw_size'][0]}×{r['raw_size'][1]} | "
                     f"{r['out_size'][0]}×{r['out_size'][1]} | ×{r['scale']} | {r['transparent_pct']}% |")
    if lines:
        txt = txt.rstrip() + "\n" + "\n".join(lines) + "\n"
    with open(CREDITS, "w", encoding="utf-8") as f:
        f.write(txt)


def guess_job(path: str) -> dict:
    """يخمّن إعداد المعالجة لأي ملف غير مُعرَّف في JOBS (وضع التوليد اليدوي).

    الاتجاه   : ملفات 16:9 → خلفية 1280×720؛ ما عداها → كما هي.
    الشفافية  : تبقى إن كان في الصورة شفافية فعلية أو خلفية لون مفتاح
                (ماجنتا/أخضر) — وإلا تُعامَل كصورة كاملة (خلفية).
    """
    from PIL import Image as _I
    with _I.open(path) as im:
        w, h = im.size
        a = np.array(im.convert("RGBA"))[..., 3]
    has_alpha = bool((a < 32).mean() > 0.01)
    keyed = defringe(strip_chroma_key(np.array(_I.open(path).convert("RGBA"))))
    has_key = bool((keyed[..., 3] < 32).mean() > 0.02)
    alpha = has_alpha or has_key
    ratio = w / max(1, h)
    target = (1280, 720) if (not alpha and abs(ratio - 16 / 9) < 0.06) else (0, 0)
    desc = "أصل مُضاف يدويًا (يُعالَج تلقائيًا)"
    return {"desc": desc, "target": target, "alpha": alpha}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--auto", action="store_true",
                    help="يعالج كل ملف في raw/ غير مُعرَّف في JOBS بإعدادات مخمّنة")
    ap.add_argument("--watch", action="store_true",
                    help="يراقب raw/ ويعالج كل ملف جديد تلقائيًا (حتى تتوقف بـCtrl+C)")
    args = ap.parse_args(argv)
    only = [x for x in args.only.split(",") if x]
    rows = []
    jobs = dict(JOBS)
    if args.auto or args.watch:
        for fn in sorted(os.listdir(RAW_DIR)) if os.path.isdir(RAW_DIR) else []:
            if fn.endswith(".png") and fn[:-4] not in jobs:
                jobs[fn[:-4]] = guess_job(os.path.join(RAW_DIR, fn))
    for name, cfg in jobs.items():
        if only and name not in only:
            continue
        r = process_one(name, cfg, [])
        rows.append(r)
        if r.get("status") == "ok":
            print(f"✓ {name:20s} {r['raw_size'][0]}×{r['raw_size'][1]} → {r['out_size'][0]}×{r['out_size'][1]} "
                  f"(×{r['scale']}) شفافية {r['transparent_pct']}% — {r['kb_out']} KB")
        else:
            print(f"… {name:20s} {r.get('status')}")
    rep = os.path.join(OUT_DIR, "_report.json")
    old = {}
    if os.path.exists(rep):
        try:
            old = json.load(open(rep, encoding="utf-8"))
        except Exception:
            old = {}
    old.update({r["name"]: r for r in rows if r.get("status") == "ok"})
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(rep, "w", encoding="utf-8") as f:
        json.dump(old, f, ensure_ascii=False, indent=1)
    append_credits(rows)
    print(f"✓ صار في المعالجة: {len(old)} أصلًا")

    if args.watch:
        print("… أراقب project/assets/raw — ضع أي صورة PNG جديدة وأنتقل معالجتها (Ctrl+C للخروج)")
        seen = set(old.keys())
        try:
            while True:
                time.sleep(3)
                if not os.path.isdir(RAW_DIR):
                    continue
                for fn in sorted(os.listdir(RAW_DIR)):
                    if not fn.endswith(".png") or fn[:-4] in seen:
                        continue
                    name = fn[:-4]
                    cfg = JOBS.get(name) or guess_job(os.path.join(RAW_DIR, fn))
                    r = process_one(name, cfg, [])
                    seen.add(name)
                    print(("✓ " if r.get("status") == "ok" else "… ") + f"{name}: {r.get('status')} " +
                          (f"{r['out_size'][0]}×{r['out_size'][1]} شفافية {r['transparent_pct']}%"
                           if r.get("status") == "ok" else ""))
                    if r.get("status") == "ok":
                        old[name] = r
                        append_credits([r])
                        with open(rep, "w", encoding="utf-8") as f:
                            json.dump(old, f, ensure_ascii=False, indent=1)
        except KeyboardInterrupt:
            print("… توقفت المراقبة")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
