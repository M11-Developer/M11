#!/usr/bin/env python3
"""بناء كل أصول اللعبة بالكود → أطالس + JSON + صوت (قابل للتشغيل أكثر من مرة).

الاستخدام:
    python3 tools/build_assets.py                # كل شيء (رسوم + صوت + تقارير)
    python3 tools/build_assets.py --only chars   # جزء واحد
    python3 tools/build_assets.py --quick        # نسخة سريعة (للاختبار)
    python3 tools/build_assets.py --no-audio

المخرجات:
    project/assets/atlases/*.png|json   (لواجهة Godot + نسخة الويب)
    project/assets/audio/**/*.ogg
    project/assets/raw/**               (الأصل الخام للتوثيق)
    web/assets/**                       (نسخة اللعبة في المتصفح)
    docs/ASSET_REPORT.md                (تقرير الأحجام والإحصاءات)
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import shutil
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from m11lib import atlas as atlaslib      # noqa: E402
from m11lib import char_anims as CA       # noqa: E402
from m11lib import draw as draw            # noqa: E402
from m11lib import char_rig as CR         # noqa: E402
from m11lib import palette as pal         # noqa: E402
from m11lib import ui_gen as UI           # noqa: E402
from m11lib import weapons_gen as WG      # noqa: E402
from m11lib import world_gen as WORLD     # noqa: E402

ATLAS_DIR = os.path.join(ROOT, "project", "assets", "atlases")
RAW_DIR = os.path.join(ROOT, "project", "assets", "raw")
AUDIO_DIR = os.path.join(ROOT, "project", "assets", "audio")
WEB_ASSETS = os.path.join(ROOT, "web", "assets")
DOCS = os.path.join(ROOT, "docs")

# ------------------------------------------------------------------ الشخصيات
# قائمة الأنيميشن المستخدمة فعليًا في اللعب (الباقي متاح عبر --all-anims)
GAMEPLAY_ANIMS = [
    "idle", "walk", "run", "sprint", "jump", "fall", "jetpack", "prone", "crawl",
    "slide", "roll", "climb", "walljump", "ledge", "dbno",
    "death0", "death1", "death2", "win", "victory", "taunt",
    "throw", "melee", "reload", "heal", "revive", "switch", "swim", "drive",
]
ALL_ANIMS = list(CA.ANIMS.keys())


def pack_multi(groups: dict, meta: dict, scale=1, pad=2) -> dict:
    """يحزم عدة أطالس: {name: {key: img}} → ملفات PNG + JSON لكل مجموعة.

    يستخدم قصّ الإطارات (trim) مع حفظ الإزاحة (offset) → أطالس أصغر بكثير.
    """
    report = {}
    for name, frames in groups.items():
        a = atlaslib.Atlas(name, pad=pad)
        offsets = {}
        for k in sorted(frames):
            img, ox, oy = atlaslib.trim_with_offset(frames[k])
            a.add(k, img)
            offsets[k] = [int(ox), int(oy)]
        png, js, size = a.save(ATLAS_DIR, scale=scale, name=name)
        with open(os.path.join(ATLAS_DIR, f"{name}.json"), "r", encoding="utf-8") as f:
            data = json.load(f)
        data["offsets"] = offsets
        data["canvas"] = meta.get("canvas", [96, 78]) if name.startswith("char") else None
        if name == "arms":
            data["hand_anchor"] = meta.get("hand_anchor")
            data["angles"] = meta.get("aim_angles")
            data["postures"] = list(meta.get("postures", {}).keys())
            data["arm_anchor"] = meta.get("arm_anchor")
            data["origin"] = meta.get("origin")
            data["baseline"] = meta.get("baseline")
        if name == "characters":
            data.update({"baseline": meta.get("baseline"), "origin": meta.get("origin"),
                         "anims": meta.get("anims"), "aim_angles": meta.get("aim_angles"),
                         "postures": meta.get("postures"), "arm_anchor": meta.get("arm_anchor"),
                         "operators": meta.get("operators"), "canvas": meta.get("canvas")})
        with open(os.path.join(ATLAS_DIR, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        report[name] = {"png": png, "json": js, "size": size, "count": len(frames),
                        "mb": round(os.path.getsize(png) / 1048576, 3)}
    return report


def _rig_draw(op, pose):
    """يرسم الهيكل ويعيد (الكانفس، معلومات المفاصل مثل موضع الكف)."""
    c = draw.Canvas(96, 78, ss=draw.SS)
    rig = CR.Rig(op, arms_only=True)
    info = rig.draw(c, pose)
    return c, (info or {})


def _finish(c):
    """يُكمل الإطار: تصغير + تكميم + حد خارجي (نفس خط أنابيب make_operator_sprite)."""
    img = c.downsample("nearest")
    img = draw.quantize(img, CR._quant_colors())
    return draw.outline(img, "#0B0D10")


def build_characters(quick=False, ops=None, anims=None, aim_angles=None, hand_anchors=True):
    """يبني كل إطارات الشخصيات: جسم + أذرع تصويب مستقلة."""
    ops = ops or CR.OPERATORS
    anims = anims or (GAMEPLAY_ANIMS[:8] if quick else GAMEPLAY_ANIMS)
    aim_angles = aim_angles or CA.AIM_ANGLES
    frames = {}
    meta_ops = {}
    hand_anchor = {}
    t0 = time.time()
    for op_i, op in enumerate(ops):
        first = (hand_anchors and op_i == 0)
        meta_ops[op.key] = dict(name=op.name_ar, gender=op.gender, style=op.style,
                                bio=op.bio, skin=op.skin, uniform=op.uniform,
                                accent=op.accent, helmet=op.helmet, hair=op.hair)
        for anim in anims:
            n, fn, fps = CA.ANIMS[anim]
            for f in range(n):
                pose = fn(f, n)
                img = CR.make_operator_sprite(op, pose)
                frames[f"{op.key}/{anim}/{f}"] = img
        # أذرع التصويب: أذرع وحدها موجّهة بالزاوية (تُركّب فوق الجسم في المحرك)
        for posture, cfg in CA.AIM_POSTURES.items():
            base_n, base_fn, _ = CA.ANIMS[cfg["base_anim"]]
            base_pose = base_fn(0, base_n)
            for ang in aim_angles:
                ap = CA.arm_pose(posture, ang)
                pose = base_pose.copy(lean=cfg.get("lean", 6.0), sh_f=ap.sh_f, el_f=ap.el_f,
                                      sh_b=ap.sh_b, el_b=ap.el_b, no_legs=True, arms_only=True)
                if first:
                    # نقطة الكف الفعلية من الهيكل — يثبّت عليها السلاح في المحرك بدقة
                    c, info = _rig_draw(op, pose)
                    img = _finish(c)
                    hand = info.get("hand")
                    if hand:
                        hand_anchor[f"{posture}/{ang}"] = [round(float(hand[0]), 2), round(float(hand[1]), 2)]
                else:
                    img = CR.make_operator_sprite(op, pose, size=(96, 78), arms_only=True)
                frames[f"{op.key}/armframe/{posture}/{ang}"] = img
    meta = {
        "hand_anchor": hand_anchor,
        "canvas": [96, 78],
        "baseline": 64,
        "origin": [40, 42],            # نقطة الأصل داخل الإطار (الحوض)
        "anims": {a: {"frames": CA.ANIMS[a][0], "fps": CA.ANIMS[a][2]} for a in anims},
        "aim_angles": aim_angles,
        "arm_anchor": {k: {"x": v["anchor"][0], "y": v["anchor"][1], "reach": v["reach"]}
                       for k, v in CA.AIM_POSTURES.items()},
        "postures": {k: v for k, v in CA.AIM_POSTURES.items()},
        "operators": meta_ops,
    }
    print(f"  الشخصيات: {len(frames)} إطارًا في {time.time() - t0:.1f} ثانية")
    return frames, meta


def pack_weapons(frames: dict, meta: dict):
    """يحزم أطلس الأسلحة مع قصّ الإطارات + كتابة نقاط الارتساء (grip/muzzle)."""
    a = atlaslib.Atlas("weapons", pad=2)
    offsets = {}
    for k in sorted(frames):
        img, ox, oy = atlaslib.trim_with_offset(frames[k])
        a.add(k, img)
        offsets[k] = [int(ox), int(oy)]
    png, js, size = a.save(ATLAS_DIR, scale=1, name="weapons")
    with open(os.path.join(ATLAS_DIR, "weapons.json"), "r", encoding="utf-8") as fh:
        data = json.load(fh)
    data["offsets"] = offsets
    data["anchors"] = meta.get("anchors", {})
    with open(os.path.join(ATLAS_DIR, "weapons.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(ATLAS_DIR, "weapons_meta.json"), "w", encoding="utf-8") as fh:
        json.dump({k: v for k, v in meta.items() if k != "anchors"}, fh, ensure_ascii=False, separators=(",", ":"))
    return {"png": png, "json": js, "size": size, "count": len(frames),
            "mb": round(os.path.getsize(png) / 1048576, 3)}


def build_weapons():
    """كل الأسلحة + نسخها بزوايا الرسم المسموحة (0/±15/±30/±45/±60/±90)."""
    frames = {}
    meta = {"specs": [], "angles": [0, 15, 30, 45, 60, 90, -15, -30, -45, -60, -90, 180, 135], "anchors": {}}
    CW, CH = WG.W / 2, WG.H / 2

    def rot_pt(pt, ang):
        """يدوّر نقطة ارتساء حول مركز الإطار بنفس تحويل rotate_sprite."""
        th = math.radians(-ang)
        dx, dy = pt[0] - CW, pt[1] - CH
        return [round(CW + dx * math.cos(th) + dy * math.sin(th), 2),
                round(CH - dx * math.sin(th) + dy * math.cos(th), 2)]

    for spec in WG.SPECS:
        img = WG.draw_weapon(spec)
        anchors = WG.weapon_anchors(spec)
        frames[f"{spec.key}/0"] = img
        meta["anchors"][f"{spec.key}/0"] = anchors
        # زوايا مرسومة مسبقًا (قاعدة 3.2: ممنوع تدوير حر)
        for ang in meta["angles"][1:]:
            frames[f"{spec.key}/{ang}"] = rotate_sprite(img, ang)
            meta["anchors"][f"{spec.key}/{ang}"] = {
                "grip": rot_pt(anchors["grip"], ang),
                "muzzle": rot_pt(anchors["muzzle"], ang),
                "len": anchors["len"],
            }
        meta["specs"].append(dict(key=spec.key, name=spec.name_ar, cls=spec.cls,
                                  length=spec.length, body=spec.body, mag=spec.mag,
                                  scope=spec.scope, stock=spec.stock, muzzle=spec.muzzle,
                                  bipod=spec.bipod, extra=spec.extra))
    print(f"  الأسلحة: {len(WG.SPECS)} سلاحًا × {len(meta['angles'])} زاوية")
    return frames, meta


def rotate_sprite(img: np.ndarray, angle_deg: float) -> np.ndarray:
    """تدوير بكسلي نظيف (Nearest + بلا تنعيم) — يُحفظ مسبقًا لكل زاوية مسموحة."""
    from PIL import Image
    pil = Image.fromarray(img)
    # للتوسيع: نحتفظ بالمقاس الأصلي ونقصّ إن لزم
    rot = pil.rotate(-angle_deg, resample=Image.NEAREST, expand=False, fillcolor=(0, 0, 0, 0))
    return np.array(rot)


def build_world(quick=False):
    frames = {}
    tiles_meta = {}
    for theme_key in (WORLD.THEMES if not quick else {"city": WORLD.THEMES["city"]}):
        tiles = WORLD.build_tileset(theme_key, variants=3 if not quick else 1)
        frames.update({f"tile/{k}": v for k, v in tiles.items()})
        tiles_meta[theme_key] = dict(name_ar=WORLD.THEMES[theme_key]["name_ar"],
                                     material=WORLD.THEMES[theme_key]["mat"],
                                     tile_size=WORLD.TS)
    props = WORLD.build_props()
    frames.update({f"prop/{k}": v for k, v in props.items()})
    print(f"  العالم: {len(frames)} تايل/عنصر")
    return frames, {"tiles": tiles_meta, "props": sorted(props.keys()), "tile_size": WORLD.TS}


def build_vfx():
    vfx = WORLD.build_vfx()
    frames = {}
    meta = {}
    for key, seq in vfx.items():
        for i, im in enumerate(seq):
            frames[f"{key}/{i}"] = im
        meta[key] = len(seq)
    print(f"  المؤثرات: {len(meta)} مجموعة ({sum(meta.values())} إطارًا)")
    return frames, meta


def build_ui():
    ui = UI.build_ui()
    frames = {f"ui/{k}": v for k, v in ui.items()}
    # أيقونة التطبيق + صورة المعاينة + شاشة التحميل
    frames["app/icon512"] = UI.app_icon(512)
    frames["app/loading"] = UI.loading_art(320, 180)
    print(f"  الواجهة: {len(frames)} عنصرًا (مع الأيقونة والبوستر)")
    return frames, {"icons": UI.UI_ICONS, "ranks": 8, "crosshairs": 4}


def build_audio(quick=False):
    """يولّد كل المؤثرات والموسيقى والمحيط → OGG."""
    from m11lib import gen_audio as GA
    from m11lib import weapons_gen as WGL
    out = {}
    t0 = time.time()
    os.makedirs(AUDIO_DIR, exist_ok=True)
    # 1) أسلحة: قريب/متوسط/بعيد لكل فئة
    classes = sorted({s.cls for s in WGL.SPECS})
    by_class = {}
    for cls in classes:
        for i, dist in enumerate(("near", "mid", "far")):
            a = GA.weapon_shot(cls, seed=hash((cls, dist)) % 999 + 1, dist=dist)
            p = os.path.join(AUDIO_DIR, f"weapons/{cls}_{dist}.ogg")
            GA.write_ogg(p, a)
            by_class[f"{cls}_{dist}"] = p
    # 2) انفجارات بأحجام مختلفة
    for name, size in (("grenade", 0.7), ("explosion", 1.0), ("big", 1.5), ("flash", 0.4)):
        a = GA.explosion(seed=abs(hash(name)) % 500 + 1, size=size)
        p = os.path.join(AUDIO_DIR, f"explosions/{name}.ogg")
        GA.write_ogg(p, a)
    # 3) ارتطامات بالمواد + خطوات
    for mat in ("dirt", "metal", "wood", "water", "concrete", "glass", "flesh"):
        GA.write_ogg(os.path.join(AUDIO_DIR, f"impacts/{mat}.ogg"), GA.impact(mat, hash(mat) % 400))
        for i in range(3):
            GA.write_ogg(os.path.join(AUDIO_DIR, f"footsteps/{mat}_{i}.ogg"),
                         GA.footstep(mat if mat in ("metal", "wood", "water", "dirt") else "concrete",
                                     seed=100 + i * 7 + hash(mat) % 50, hard=(i == 2)))
    # 4) إعادة تعمير لكل فئة
    for cls in classes:
        GA.write_ogg(os.path.join(AUDIO_DIR, f"reload/{cls}.ogg"), GA.reload_sound(cls, hash(cls) % 300))
    # 5) واجهة + مؤثرات لعب
    for k in ("click", "back", "confirm", "error", "kill", "headshot", "level_up", "pickup", "hitmarker"):
        GA.write_ogg(os.path.join(AUDIO_DIR, f"ui/{k}.ogg"), GA.ui_click(k, hash(k) % 200))
    # 6) أصوات الشخصيات (غير لفظية)
    for i, g in enumerate(("male_low", "male_mid", "female_mid", "female_high")):
        pitch = {"male_low": 0.85, "male_mid": 1.0, "female_mid": 1.35, "female_high": 1.5}[g]
        for kind in ("effort", "pain", "death", "victory", "taunt"):
            GA.write_ogg(os.path.join(AUDIO_DIR, f"voices/{g}_{kind}.ogg"),
                         GA.voice_grunt(kind, pitch=pitch, seed=500 + i * 11 + hash(kind) % 50))
    # 7) محيط
    amb = ("desert_wind", "city_far", "base_hum", "forest_night", "rain", "battle_distant")
    for a in amb:
        dur = 6.0 if quick else 16.0
        GA.write_ogg(os.path.join(AUDIO_DIR, f"ambience/{a}.ogg"), GA.ambience(a, dur, seed=hash(a) % 900),
                     stereo=True)
    # 8) موسيقى (6+1 مقطوعات، ستيريو)
    tracks = ("menu_theme", "lobby_theme", "br_calm", "br_final", "dm_fast", "victory", "defeat")
    for t in tracks:
        if quick and t not in ("menu_theme", "dm_fast"):
            continue
        x = GA.render_track(t)
        GA.write_ogg(os.path.join(AUDIO_DIR, f"music/{t}.ogg"), x, stereo=True)
    print(f"  الصوت: تم في {time.time() - t0:.1f} ثانية")
    return dirstat(AUDIO_DIR)


def dirstat(path):
    total = 0
    count = 0
    for root, _, files in os.walk(path):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
            count += 1
    return {"files": count, "bytes": total, "mb": round(total / 1048576, 2)}


def write_report(report: dict):
    os.makedirs(DOCS, exist_ok=True)
    lines = ["# تقرير الأصول (Asset Report)\n",
             f"تم التوليد: {time.strftime('%Y-%m-%d %H:%M')} (UTC)\n",
             "كل الأصول مولّدة بالكود عبر `tools/build_assets.py` — بلا أي مواد خارجية.\n",
             "## الأطالس", "", "| الأطلس | الإطارات | المقاس | حجم PNG |", "|---|---|---|---|"]
    for name, info in report.get("atlases", {}).items():
        lines.append(f"| `{name}` | {info['count']} | {info['size'][0]}×{info['size'][1]} | "
                     f"{info['mb']} MB |")
    if "audio" in report and report["audio"].get("files"):
        lines += ["", "## الصوت", "",
                  f"عدد الملفات: {report['audio']['files']} — الحجم: {report['audio']['mb']} MB",
                  "", "التقسيم: أسلحة (قريب/متوسط/بعيد لكل فئة) · انفجارات · خطوات (4 أسطح × حالتين) ·",
                  "إصابات · إعادة تعبئة · واجهة · أصوات شخصيات عربية · محيط (رياح/مطر/مدينة/معركة) · موسيقى تكيفية.", ""]
    for key, label in (("raw", "النسخ الخام (خارج الحزمة)"), ("fonts", "الخطوط"),
                       ("web", "نسخة الويب")):
        d = report.get(key)
        if d and d.get("files"):
            lines += [f"### {label}", "",
                      f"عدد الملفات: {d['files']} — الحجم: {d['mb']} MB", ""]
    lines += ["", "## المجموع", "",
              f"- الرسوم: **{report.get('graphics_mb', 0)} MB**",
              f"- الصوت: **{report.get('audio_mb', 0)} MB**",
              f"- الإجمالي: **{report.get('total_mb', 0)} MB**", ""]
    with open(os.path.join(DOCS, "ASSET_REPORT.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    with open(os.path.join(DOCS, "asset_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)


def report_from_disk() -> dict:
    """يبني تقرير الأصول من الملفات الموجودة بلا إعادة توليد (سريع)."""
    rep = {"atlases": {}, "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ"), "from_disk": True}
    if os.path.isdir(ATLAS_DIR):
        for fn in sorted(os.listdir(ATLAS_DIR)):
            if not fn.endswith(".png"):
                continue
            name = fn[:-4]
            path = os.path.join(ATLAS_DIR, fn)
            from PIL import Image
            with Image.open(path) as im:
                size = list(im.size)
            count = 0
            jpath = os.path.join(ATLAS_DIR, f"{name}.json")
            if os.path.exists(jpath):
                try:
                    with open(jpath, encoding="utf-8") as f:
                        jd = json.load(f)
                    count = len(jd.get("frames", jd)) if isinstance(jd, dict) else 0
                except Exception:
                    count = 0
            rep["atlases"][name] = {"count": count, "size": size,
                                    "mb": round(os.path.getsize(path) / 1048576, 3)}
    rep["audio"] = dirstat(AUDIO_DIR) if os.path.isdir(AUDIO_DIR) else {"files": 0, "mb": 0}
    rep["graphics_mb"] = round(sum(v["mb"] for v in rep["atlases"].values()), 2)
    rep["audio_mb"] = rep["audio"]["mb"]
    rep["total_mb"] = round(rep["graphics_mb"] + rep["audio_mb"], 2)
    # إحصاءات إضافية مفيدة للوثائق
    rep["raw"] = dirstat(RAW_DIR) if os.path.isdir(RAW_DIR) else {"files": 0, "mb": 0}
    rep["fonts"] = dirstat(os.path.join(ROOT, "project", "assets", "fonts"))
    rep["web"] = dirstat(os.path.join(ROOT, "web", "assets"))
    return rep


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="all",
                    choices=["all", "chars", "weapons", "world", "vfx", "ui", "audio", "app", "report"])
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--no-web", action="store_true", help="لا تنسخ إلى web/assets")
    args = ap.parse_args(argv)

    if args.only == "report":
        rep = report_from_disk()
        write_report(rep)
        print(f"✓ تقرير الأصول: {len(rep['atlases'])} أطلسًا، رسوم {rep['graphics_mb']} MB، "
              f"صوت {rep['audio_mb']} MB، إجمالي {rep['total_mb']} MB")
        return 0
    os.makedirs(ATLAS_DIR, exist_ok=True)
    os.makedirs(RAW_DIR, exist_ok=True)
    t_all = time.time()
    report = {"atlases": {}, "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ")}

    def do(name, fn, meta_name=None, scale=1):
        print(f"• بناء {name} ...")
        frames, meta = fn()
        info = atlaslib.pack_frames(name, frames, ATLAS_DIR, scale=scale, pad=2)
        mb = round(os.path.getsize(info["png"]) / 1048576, 2)
        report["atlases"][name] = {"count": info["count"], "size": info["size"], "mb": mb}
        with open(os.path.join(ATLAS_DIR, f"{name}_meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  ✓ {name}: {info['count']} إطارًا، {info['size'][0]}×{info['size'][1]}، {mb} MB")
        return frames

    def do_chars():
        print("• بناء الشخصيات ...")
        frames, meta = build_characters(quick=args.quick)
        # تقسيم الأطالس: جسم كل شخصية في أطلس مستقل + الأذرع المشتركة
        groups: dict[str, dict] = {}
        for k, img in frames.items():
            if "/armframe/" in k:
                groups.setdefault("arms", {})[k] = img
            else:
                groups.setdefault(f"char_{k.split('/')[0]}", {})[k] = img
        infos = pack_multi(groups, meta)
        for name, info in infos.items():
            report["atlases"][name] = {"count": info["count"], "size": info["size"], "mb": info["mb"]}
            print(f"  ✓ {name}: {info['count']} إطارًا، {info['size'][0]}×{info['size'][1]}، {info['mb']} MB")
        # بيانات الشخصيات المشتركة (أحجام/أوضاع/أذرع) في ملف meta واحد
        with open(os.path.join(ATLAS_DIR, "characters_meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  الشخصيات: {len(frames)} إطارًا، {len(groups)} أطلسًا")

    only = args.only
    if only in ("all", "chars"):
        do_chars()
    if only in ("all", "weapons"):
        print("• بناء الأسلحة ...")
        wframes, wmeta = build_weapons()
        winfo = pack_weapons(wframes, wmeta)
        report["atlases"]["weapons"] = {"count": winfo["count"], "size": winfo["size"], "mb": winfo["mb"]}
        print(f"  ✓ weapons: {winfo['count']} إطارًا، {winfo['size'][0]}×{winfo['size'][1]}، {winfo['mb']} MB")
    if only in ("all", "world"):
        do("world", lambda: build_world(quick=args.quick))
    if only in ("all", "vfx"):
        do("vfx", build_vfx)
    if only in ("all", "ui"):
        do("ui", build_ui)
    if only in ("all", "ui", "app"):
        # أصول مستقلة خارج الأطالس: أيقونة التطبيق + الخلفية + شاشة التحميل
        import subprocess
        subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                     "gen_app_art.py")], check=False)
    if only in ("all", "audio") and not args.no_audio:
        print("• توليد الصوت ...")
        report["audio"] = build_audio(quick=args.quick)

    graphics = sum(v.get("mb", 0) for v in report["atlases"].values())
    report["graphics_mb"] = round(graphics, 2)
    report["audio_mb"] = report.get("audio", {}).get("mb", 0)
    report["total_mb"] = round(graphics + report["audio_mb"], 2)

    # نسخة الويب
    if not args.no_web:
        os.makedirs(WEB_ASSETS, exist_ok=True)
        for root, _, files in os.walk(ATLAS_DIR):
            for f in files:
                shutil.copy2(os.path.join(root, f), os.path.join(WEB_ASSETS, f))
        # نسخة مضغوطة من الأطالس للويب (WebP بلا فقدان: أصغر 25-40%)
        if not args.quick:
            try:
                from PIL import Image
                for f in os.listdir(ATLAS_DIR):
                    if f.endswith(".png"):
                        src = os.path.join(ATLAS_DIR, f)
                        dst = os.path.join(WEB_ASSETS, f.replace(".png", ".webp"))
                        Image.open(src).save(dst, lossless=True, quality=100, method=6)
            except Exception as e:  # pragma: no cover
                print("  (تخطي WebP:", e, ")")

    write_report(report)
    # سجل المصادر
    rawlog = __import__("process_asset").RawLog(RAW_DIR, os.path.join(ROOT, "CREDITS.md"))
    for name, info in report["atlases"].items():
        rawlog.add(name, "توليد برمجي: tools/m11lib/", 
                   ["رسم فائق ×4", "تكميم على اللوحة", "حد خارجي", "اختزال NEAREST", "حزم أطلس"],
                   f"{info['count']} إطارًا")
    if "audio" in report:
        rawlog.add("audio", "توليد صوتي برمجي: tools/m11lib/gen_audio.py",
                   ["Vorbis OGG", "تطبيع", "صدى"],
                   f"{report['audio']['files']} ملفًا، {report['audio']['mb']} MB")
    rawlog.write_credits()

    print(f"\n✔ تم كل شيء في {time.time() - t_all:.1f} ثانية")
    print(f"  رسوم: {report['graphics_mb']} MB | صوت: {report['audio_mb']} MB | "
          f"إجمالي: {report['total_mb']} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
