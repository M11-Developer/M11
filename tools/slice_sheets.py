#!/usr/bin/env python3
"""يقصّ أوراق العناصر المولّدة (ديكور، مركبات، شعارات، واجهة) إلى أطالس يستعملها المحرّك.

المدخل : `project/assets/processed/sheet_*.png` (أوراق فيها فجوات بين العناصر)
المخرج : `project/assets/atlases/props_<x>.png` + `.json`  (لمحرّك Godot)
         ونسخة في `web/assets/` (لنسخة الويب)
الأسماء : كل عنصر يحصل على اسم معنى (مثل `props_road/lamp`) بدل رقم — لأن الاسم
         المعنى هو ما يجعل الرسم في المحرّك قابلًا للقراءة بعد شهور.

كيف يعمل: يستعير كاشف الشبكة من `slice_tilesets.py` (لا يفترض مقاسًا مسبقًا: يجد
مقاطع الخلفية الفاصلة على المحورين)، ثم يقصّ محتوى كل خلية، ويحجّم العنصر إلى ارتفاع
مستهدف بضرب صحيح (Nearest دائمًا — لا استيفاء خطّي على البكسل الفني).

التشغيل:  python3 tools/slice_sheets.py
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from m11lib import atlas as atlaslib              # noqa: E402
from slice_tilesets import _grid                 # noqa: E402
from scipy import ndimage                          # noqa: E402

PROCESSED = os.path.join(ROOT, "project", "assets", "processed")
ATLAS_DIR = os.path.join(ROOT, "project", "assets", "atlases")
WEB_DIR = os.path.join(ROOT, "web", "assets")

# ---------------------------------------------------------------------------
# (الورقة المصدر) → (اسم الأطلس، مفتاح الإطار، ارتفاع العنصر المستهدف، أسماء العناصر)
# الأسماء مرتّبة بترتيب الرسم في الورقة: يسارًا→يمينًا ثم أعلى→أسفل.
# أي عنصر زائد عن القائمة يُسمّى extra_N — فلا يُهمَل شيء أبدًا.
# ---------------------------------------------------------------------------
SHEETS: dict[str, dict] = {
    # الأسماء مرتّبة بترتيب الرسم في الورقة (صفًا صفًا، يسار→يمين) — مُتحقَّق منها بصريًا
    # في /tmp/names_*.png. أي عنصر زائد يُسمّى extra_N فلا يُهمَل شيء.
    "sheet_road_props": {
        "atlas": "props_road", "key": "props_road", "h": 64, "expect": 12,
        "names": ["lamp", "bus_shelter", "dumpster", "hydrant", "bollard", "cone",
                  "cone_1", "barrier", "manhole", "sandbags", "tires"],
    },
    "sheet_props_nature": {
        "atlas": "props_nature", "key": "props_nature", "h": 60, "expect": 12,
        "names": ["dead_tree", "reeds", "cattail", "palm", "thorn_bush", "bush",
                  "log", "cactus", "boulder", "mushrooms", "leaf_pile", "rocks"],
    },
    "sheet_props_indoor": {
        "atlas": "props_indoor", "key": "props_indoor", "h": 56, "expect": 12,
        "names": ["locker", "coat_rack", "floor_lamp", "coat_rack_1", "crate_stack",
                  "filing_cabinet", "bed", "mirror", "fridge", "table", "sofa", "safe",
                  "chair", "rug_roll"],
    },
    "sheet_team_badges": {
        "atlas": "badges_team", "key": "badges_team", "h": 48, "expect": 12,
        "names": ["parachute", "skull", "wrench", "crescent", "jetpack", "falcon",
                  "anchor", "swords", "antenna", "radar", "laurel", "bolt"],
    },
    "sheet_corp_lab": {
        "atlas": "props_lab", "key": "props_lab", "h": 64, "expect": 12,
        "names": ["decon_arch", "server_rack", "pipe_elbow", "vat", "workbench", "cylinders",
                  "workbench_1", "crates", "pipe_elbow_1", "crates_1", "wall_fan", "breaker",
                  "drum", "hazmat_box", "generator", "generator_1", "hazmat_box_1", "generator_2"],
    },
    "sheet_vehicles_land": {
        "atlas": "vehicles_land", "key": "vehicles_land", "h": 96, "expect": 8,
        "names": ["tractor", "ambulance", "truck", "apc", "pickup", "jeep", "buggy", "sedan"],
    },
    "sheet_ui_touch": {
        "atlas": "ui_touch", "key": "ui_touch", "h": 64, "expect": 16,
        "names": ["fire_ring", "bar_track", "dpad", "knob", "hex_button", "square_button",
                  "button_frame", "stick_base", "dialog_panel", "dropdown", "checkbox", "radio",
                  "panel_dark", "bar_plain"],
    },
    "sheet_building_floors": {
        "atlas": "build_floors", "key": "build_floors", "h": 96, "expect": 12,
        "names": ["wall_ground_door", "wall_upper_windows", "wall_roof_balcony", "roof_slab",
                  "floor_slab_rebar", "pillar", "stairs", "wall_hole", "wall_brick_pipes",
                  "awning_strip", "wall_mural", "rubble_chunks"],
    },
    "sheet_watchtowers": {
        "atlas": "props_towers", "key": "props_towers", "h": 150, "expect": 4,
        "names": ["tower_wood", "tower_steel", "tower_pillbox", "tower_ruined"],
    },
    "sheet_water_tanks": {
        "atlas": "props_tanks", "key": "props_tanks", "h": 104, "expect": 6,
        "names": ["water_tank_roof", "silo", "fuel_tank", "pressure_tank", "water_tower", "tank_leaking"],
    },
    "sheet_roof_details": {
        "atlas": "props_roof", "key": "props_roof", "h": 56, "expect": 12,
        "names": ["ac_unit", "satellite_dish", "antenna", "chimney", "skylight", "roof_vent",
                  "hatch", "solar_panel", "clothesline", "planter", "gas_cylinders", "roof_tiles"],
    },
    "sheet_gates_fences": {
        "atlas": "props_gates", "key": "props_gates", "h": 64, "expect": 12,
        "names": ["fence_chain", "fence_corner", "fence_wood", "gate_wood_open", "gate_sliding",
                  "gate_mesh", "blast_wall", "jersey_barrier", "razor_coil", "tire_stack",
                  "roadblock", "fence_bent"],
    },
    "sheet_bridge_broken": {
        "atlas": "props_bridge", "key": "props_bridge", "h": 64, "expect": 6,
        "names": ["bridge_span", "bridge_burned", "bridge_gap", "bridge_collapsed",
                  "bridge_stone", "pier_posts"],
    },
    "sheet_elevator": {
        "atlas": "props_lift", "key": "props_lift", "h": 88, "expect": 8,
        "names": ["lift_car", "lift_shaft", "lift_scissor", "lift_piston", "counterweight",
                  "lift_panel", "lift_hazard", "pallet_crate"],
    },
    "sheet_aa_gun": {
        "atlas": "props_aa", "key": "props_aa", "h": 80, "expect": 4,
        "names": ["aa_twin", "aa_flak", "aa_quad", "aa_broken"],
    },
    "sheet_generator_unit": {
        "atlas": "props_power", "key": "props_power", "h": 72, "expect": 6,
        "names": ["gen_cabinet", "gen_engine", "power_panel", "transformer", "battery_bank", "light_tower"],
    },
    "sheet_naval_gear": {
        "atlas": "props_naval", "key": "props_naval", "h": 64, "expect": 12,
        "names": ["torpedo_tubes", "depth_charges", "anchor_chain", "bollard", "life_ring",
                  "naval_mine", "sonar_buoy", "radar_dish", "signal_lamp", "ammo_hoist",
                  "catwalk", "dock_bumper"],
    },
    "sheet_dock_cranes": {
        "atlas": "props_cranes", "key": "props_cranes", "h": 150, "expect": 6,
        "names": ["gantry_crane", "boom_crane", "dock_crane", "floating_crane",
                  "truck_crane", "crane_broken"],
    },
    "sheet_ship_hull": {
        "atlas": "props_hulls", "key": "props_hulls", "h": 110, "expect": 8,
        "names": ["hull_bow", "hull_stern", "hull_side", "hull_waterline",
                  "hull_breach", "hull_shaft", "hull_deck_edge", "hull_barnacles"],
    },
    "sheet_underwater": {
        "atlas": "props_water", "key": "props_water", "h": 56, "expect": 12,
        "names": ["coral", "seaweed", "underwater_rock", "sunken_crate", "sunken_barrel",
                  "bubbles", "fish_school", "jellyfish", "wreck_ribs", "sand_mound",
                  "chest", "anchor_sunken"],
    },
    "sheet_naval_vehicles": {
        "atlas": "vehicles_naval", "key": "vehicles_naval", "h": 88, "expect": 6,
        "names": ["rib_boat", "landing_craft", "jet_ski", "torpedo_boat", "amphibious", "tugboat"],
    },
    "sheet_water_surface": {
        "atlas": "water_surface", "key": "water", "h": 0, "expect": 8,
        "names": ["calm", "ripple", "choppy", "storm", "shallow", "oily", "waterfall", "shore"],
    },
    "sheet_operators_new": {
        "atlas": "portraits_new", "key": "portrait", "h": 96, "expect": 10, "grid": (2, 5),
        "names": ["portrait_11", "portrait_12", "portrait_13", "portrait_14", "portrait_15",
                  "portrait_16", "portrait_17", "portrait_18", "portrait_19", "portrait_20"],
    },
    "sheet_map_thumbs_a": {
        "atlas": "map_thumbs_a", "key": "thumb", "h": 0, "expect": 12, "grid": (3, 4),
        "names": ["oasis", "harbor", "sea_deck", "nightbase", "village", "ruinedcity",
                  "factory", "darkforest", "bridge", "snowpeak", "swamp", "docks"],
    },
    "sheet_map_thumbs_b": {
        "atlas": "map_thumbs_b", "key": "thumb", "h": 0, "expect": 8, "grid": (2, 4),
        "names": ["orbital", "cavern", "warzone", "valleys", "oil_rig", "port",
                  "starfield", "spare"],
    },
    "sheet_achievements_2": {
        "atlas": "medals_2", "key": "medal", "h": 56, "expect": 12, "grid": (4, 6),
        "names": ["star", "shield_wrench", "bullet", "parachute", "flame", "heart",
                  "skull", "target", "anchor", "bolt", "stopwatch", "laurel_blank"],
    },
    "sheet_operators_1_10": {
        "atlas": "portraits_orig", "key": "portrait", "h": 96, "expect": 10, "grid": (2, 5),
        "names": ["rashid", "karim", "yusuf", "tariq", "adam",
                  "layla", "noor", "hala", "sara", "mariam"],
    },
    "sheet_supply_crates": {
        "atlas": "props_supply", "key": "props_supply", "h": 52, "expect": 12,
        "names": ["ammo_crate", "med_box", "ammo_tin", "supply_bundle", "loot_box", "rifle_case",
                  "jerry_can", "water_can", "shell_crate", "electronics_case", "grenade_tin", "airdrop_pallet"],
    },
    "sheet_debris_rubble": {
        "atlas": "props_debris", "key": "props_debris", "h": 40, "expect": 14,
        "names": ["concrete_chunk", "i_beam", "wood_pile", "barrel_broken", "wire_coil",
                  "pipe_rusty", "rubble_light", "rebar", "pipe_water", "girder", "bricks",
                  "barrel_red", "gravel", "barrel_red_1", "ice_shards"],
    },
    "sheet_trees_big": {
        "atlas": "props_trees", "key": "props_trees", "h": 84, "expect": 5,
        "names": ["pine_snow", "oak_autumn", "birch_bare", "oak_big", "oak_autumn_1", "dead_tree"],
    },
}


def _fit(patch: np.ndarray, target_h: int) -> np.ndarray:
    """يحجّم عنصرًا إلى الارتفاع المستهدف بنسبة صحيحة (Nearest) — لا استيفاء خطّي أبدًا.

    مهم: الأشجار المولّدة تخرج بارتفاع 300–400 بكسل، ولو تركتها كما هي لبدت عملاقة
    بجانب تايلات 32 بكسل. لذلك نختزلها بمعامل صحيح (÷2، ÷3، ÷4) ونكبّرها بمعامل
    صحيح عند الحاجة، فيبقى البكسل الفني حادًّا بلا أي مزج.
    """
    h, w = patch.shape[:2]
    if h <= 0 or w <= 0:
        return patch
    if h > target_h * 1.25:                     # اختزال
        k = max(1, int(round(h / target_h)))
        return np.array(Image.fromarray(patch, "RGBA").resize((max(1, w // k), max(1, h // k)), Image.NEAREST))
    if target_h > h * 2.4:                      # تكبير
        k = max(2, int(round(target_h / h)))
        return np.array(Image.fromarray(patch, "RGBA").resize((w * k, h * k), Image.NEAREST))
    return patch


def kill_shadow_purple(img: np.ndarray) -> np.ndarray:
    """يحوّل ظلّ العنصر البنفسجي (من النموذج) إلى ظل رمادي داكن محايد.

    أوراق العناصر تأتي غالبًا بظل بنفسجي صغير تحت العنصر؛ وعلى أرضية اللعبة يبدو
    لونًا غريبًا (وثمه «رخيص»). نحوّل كل بكسل بنفسجي منخفض الإضاءة إلى رمادي داكن
    بشفافية معقولة، فلا يبقى أثر للأصل.
    """
    out = img.copy()
    r = out[..., 0].astype(np.int16)
    g = out[..., 1].astype(np.int16)
    b = out[..., 2].astype(np.int16)
    purple = (out[..., 3] > 30) & (b - g >= 10) & (r - g >= 4) & (b >= r - 30)
    if purple.sum() == 0:
        return out
    lum = (0.3 * r + 0.55 * g + 0.15 * b).astype(np.float32)
    grey = np.clip(lum * 0.55, 0, 70).astype(np.uint8)
    out[..., 0] = np.where(purple, grey, out[..., 0])
    out[..., 1] = np.where(purple, grey, out[..., 1])
    out[..., 2] = np.where(purple, np.clip(grey * 1.15, 0, 90).astype(np.uint8), out[..., 2])
    out[..., 3] = np.where(purple, np.minimum(out[..., 3], 130), out[..., 3])
    return out


def find_elements(img: np.ndarray, min_area: int = 60, gap: int = 6) -> list[tuple[int, int, int, int]]:
    """يجد «العناصر» في ورقة عناصر بالتحليل المترابط (لا يفترض شبكة إطلاقًا).

    كل مجموعة بكسل متّصلة = جزء؛ ثم ندمج الأجزاء المتراكبة أفقيًا (زرّ المدفع مع
    قاعدته، جذع الشجرة مع أوراقها) فيصير العنصر واحدًا. هذا يعمل مع أي ترتيب:
    صفوف مرتّبة أو متعرّجة أو أحجام مختلفة في الصف نفسه.
    """
    mask = img[..., 3] > 40
    # نوسّع قليلًا حتى تُدمج الأجزاء المتقاربة جدًا (مثل حبل ملتف بجانب عمود)
    grown = ndimage.binary_dilation(mask, iterations=gap)
    labels, n = ndimage.label(grown)
    if n == 0:
        return []
    boxes: list[list[int]] = []
    slices = ndimage.find_objects(labels)
    for sl in slices:
        if sl is None:
            continue
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        sub = mask[y0:y1, x0:x1]
        if sub.sum() < min_area:
            continue
        ys = np.where(sub.any(axis=1))[0]
        xs = np.where(sub.any(axis=0))[0]
        boxes.append([x0 + int(xs[0]), y0 + int(ys[0]),
                      x0 + int(xs[-1]) + 1, y0 + int(ys[-1]) + 1])
    # دمج الصناديق المتراكبة (توسيع صغير يعالج التداخل الحدّي)
    changed = True
    while changed:
        changed = False
        out: list[list[int]] = []
        for b in boxes:
            merged = False
            for o in out:
                if not (b[2] <= o[0] - 3 or b[0] >= o[2] + 3 or b[3] <= o[1] - 3 or b[1] >= o[3] + 3):
                    o[0], o[1] = min(o[0], b[0]), min(o[1], b[1])
                    o[2], o[3] = max(o[2], b[2]), max(o[3], b[3])
                    merged = changed = True
                    break
            if not merged:
                out.append(list(b))
        boxes = out
    # ترتيب: صفوف (بتجميع مراكز y المتقاربة) ثم يسار→يمين داخل كل صف
    boxes.sort(key=lambda b: ((b[1] + b[3]) / 2, b[0]))
    rows: list[list[list[int]]] = []
    for b in boxes:
        cy = (b[1] + b[3]) / 2
        hh = b[3] - b[1]
        placed = False
        for row in rows:
            rcy = sum((o[1] + o[3]) / 2 for o in row) / len(row)
            if abs(cy - rcy) < max(24, hh * 0.6):
                row.append(b)
                placed = True
                break
        if not placed:
            rows.append([b])
    ordered: list[tuple[int, int, int, int]] = []
    for row in rows:
        row.sort(key=lambda b: b[0])
        for b in row:
            ordered.append((b[0], b[1], b[2] - b[0], b[3] - b[1]))
    return ordered


def find_by_grid(img: np.ndarray, rows: int, cols: int, pad: int = 2) -> list[tuple[int, int, int, int]]:
    """يقطّع ورقة إلى شبكة منتظمة (صفوف×أعمدة) — تُستعمل للأوراق المستطيلة المتلاصقة.

    مصغّرات الخرائط والبورتريهات والأوسمة تُرسم متلاصقة بلا فجوات واضحة، فيفشل كشف
    العناصر المنفصلة. هنا نقسّم مساحة المحتوى بالتساوي ثم نقصّ هوامش كل خلية.
    """
    mask = img[..., 3] > 40
    ys = np.where(mask.any(axis=1))[0]
    xs = np.where(mask.any(axis=0))[0]
    if len(ys) == 0 or len(xs) == 0:
        return []
    y0, y1 = int(ys[0]), int(ys[-1]) + 1
    x0, x1 = int(xs[0]), int(xs[-1]) + 1
    boxes: list[tuple[int, int, int, int]] = []
    for r in range(rows):
        cy0 = y0 + (y1 - y0) * r // rows
        cy1 = y0 + (y1 - y0) * (r + 1) // rows
        for c in range(cols):
            cx0 = x0 + (x1 - x0) * c // cols
            cx1 = x0 + (x1 - x0) * (c + 1) // cols
            sub = mask[cy0:cy1, cx0:cx1]
            if sub.mean() < 0.05:
                continue
            sy = np.where(sub.any(axis=1))[0]
            sx = np.where(sub.any(axis=0))[0]
            if len(sy) < 4 or len(sx) < 4:
                continue
            bx = cx0 + int(sx[0]) - pad
            by = cy0 + int(sy[0]) - pad
            bw = int(sx[-1] - sx[0] + 1) + pad * 2
            bh = int(sy[-1] - sy[0] + 1) + pad * 2
            boxes.append((max(0, bx), max(0, by), bw, bh))
    return boxes


def slice_sheet(sheet: str, cfg: dict) -> dict | None:
    src = os.path.join(PROCESSED, sheet + ".png")
    if not os.path.exists(src):
        return None
    img = kill_shadow_purple(np.array(Image.open(src).convert("RGBA")))
    cfg = dict(cfg, _img=img)
    if cfg.get("grid"):
        boxes = find_by_grid(img, cfg["grid"][0], cfg["grid"][1])
        return _pack(boxes, sheet, cfg)
    # نختار فجوة الدمج التي تعطي أقرب عدد للعناصر المتوقّعة (من التلقينة الأصلية)
    expect = cfg.get("expect", 0)
    best = None
    for g in (2, 3, 4, 5, 6, 8, 10):
        boxes = find_elements(img, gap=g)
        score = abs(len(boxes) - expect) if expect else 0
        if best is None or score < best[0] - 0.001 or (score == best[0] and g > best[1]):
            best = (score, g, boxes)
    boxes = best[2]
    if not boxes:
        return None
    return _pack(boxes, sheet, cfg)


def _pack(boxes: list[tuple[int, int, int, int]], sheet: str, cfg: dict) -> dict:
    img = cfg["_img"]
    names = cfg["names"]
    frames: dict[str, np.ndarray] = {}
    for i, (x, y, w, h) in enumerate(boxes):
        name = names[i] if i < len(names) else f"extra_{i}"
        patch = img[y:y + h, x:x + w] if not cfg["h"] else _fit(img[y:y + h, x:x + w], cfg["h"])
        frames[f"{cfg['key']}/{name}"] = patch
    info = atlaslib.pack_frames(cfg["atlas"], frames, ATLAS_DIR, scale=1, pad=2)
    with open(os.path.join(ATLAS_DIR, f"{cfg['atlas']}_meta.json"), "w", encoding="utf-8") as f:
        json.dump({"source": sheet, "frames": list(frames.keys())}, f,
                  ensure_ascii=False, separators=(",", ":"))
    os.makedirs(WEB_DIR, exist_ok=True)
    for ext in (".png", ".json"):
        s = os.path.join(ATLAS_DIR, f"{cfg['atlas']}{ext}")
        if os.path.exists(s):
            with open(s, "rb") as fi, open(os.path.join(WEB_DIR, f"{cfg['atlas']}{ext}"), "wb") as fo:
                fo.write(fi.read())
    return {"atlas": cfg["atlas"], "count": len(frames), "size": info["size"]}



def main() -> int:
    total, done, out = 0, 0, []
    for sheet, cfg in SHEETS.items():
        r = slice_sheet(sheet, cfg)
        if not r:
            print(f"… {sheet:24s} لا ملف مصدر")
            continue
        done += 1
        total += r["count"]
        out.append({"atlas": r["atlas"], "source": sheet, "frames": r["count"]})
        print(f"✓ {r['atlas']:14s} {r['count']:3d} عنصرًا → {r['size'][0]}×{r['size'][1]}")
    with open(os.path.join(ATLAS_DIR, "props_manifest.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    with open(os.path.join(WEB_DIR, "props_manifest.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"✓ الإجمالي: {done} أطالس، {total} عنصرًا")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
