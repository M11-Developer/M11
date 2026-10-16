# ============================================================================
# العالم — توليد الخريطة (نفس خوارزمية نسخة الويب حرفيًا ليكون المنظر واحدًا)،
# التصادم، التدمير، الغنائم، المنطقة الآمنة، ومضيف اللقطات الشبكية.
# ============================================================================
extends Node2D
class_name GameWorld

signal actor_damaged(actor, amount: float, info: Dictionary)

# ثيم الخريطة → لوحة المنظر المولّدة (5 بيئات) — نفس الجدول المستخدم في نسخة الويب
# القيمة إما "اسم لوحة" أو "نهار|ليل" — والاختيار حسب حقل time_of_day في تعريف الخريطة
const THEME_BACKDROP := {
	"desert": "bg_parallax_desert|bg_parallax_oasis_night", "oasis": "bg_parallax_desert|bg_parallax_oasis_night",
	"village": "bg_parallax_desert|bg_parallax_oasis_night", "ruins": "bg_parallax_desert|bg_parallax_oasis_night",
	"forest": "bg_parallax_forest_night", "nightbase": "bg_parallax_forest_night",
	"port": "bg_parallax_naval_base|bg_parallax_sea_storm",
	"base": "bg_parallax_factory", "factory": "bg_parallax_factory",
	"city": "bg_parallax_city_dusk|bg_parallax_factory",
	"snow": "bg_parallax_snow", "mountain": "bg_parallax_snow",
	"space": "bg_sky_station", "station": "bg_sky_station", "scifi": "bg_sky_station",
	"cave": "bg_sky_cave_glow", "underground": "bg_sky_cave_glow",
	"swamp": "bg_sky_swamp", "warzone": "bg_sky_war_red",
}
# الطقس يتقدّم على الثيم (عاصفة/ثلج/ضباب) — نفس منطق نسخة الويب
const WEATHER_BACKDROP := {
	"storm": "bg_sky_storm", "snow": "bg_sky_snowfall", "fog": "bg_sky_port_fog",
	"dust": "bg_sky_dust", "rain": "bg_sky_storm",
}
const BACKDROP_DIR := "res://assets/atlases/backdrops/"

var backdrop_tex: Texture2D = null
var backdrop_offset := 0.0

# أنواع البلاط: أسماء بديلة للملف المشترك src/core/tiles.gd (مصدر واحد للحقيقة)
const TILE_EMPTY := M11Tiles.EMPTY
const TILE_SOLID := M11Tiles.SOLID
const TILE_TOP := M11Tiles.TOP
const TILE_PLATFORM := M11Tiles.PLATFORM
const TILE_CRATE := M11Tiles.CRATE
const TILE_GLASS := M11Tiles.GLASS
const TILE_SANDBAG := M11Tiles.SANDBAG
const TILE_LADDER := M11Tiles.LADDER
const TILE_WATER := M11Tiles.WATER
const TILE_HAZARD := M11Tiles.HAZARD
const TILE_BACK := M11Tiles.BACK
const TILE_GIRDER := M11Tiles.GIRDER

const SOLID_TILES := [TILE_SOLID, TILE_TOP, TILE_CRATE, TILE_GLASS, TILE_SANDBAG, TILE_GIRDER]
const DESTRUCTIBLE := {TILE_CRATE: 60.0, TILE_GLASS: 15.0, TILE_SANDBAG: 90.0, TILE_GIRDER: 140.0}

@onready var terrain: Node2D = $Terrain
@onready var entities: Node2D = $Entities
@onready var projectiles: Node2D = $Projectiles
@onready var canvas_modulate: CanvasModulate = $CanvasModulate

var map_w := 0
var map_h := 0
var tiles: PackedByteArray = PackedByteArray()
var heights: PackedInt32Array = PackedInt32Array()

# الديكور حسب الثيم — نفس الجدول في نسخة الويب (web/src/game/world.js).
# الصيغة "p:<atlas>/<name>" تعني: ارسم العنصر من أطلس الذكاء الاصطناعي هذا.
const THEME_DECOR := {
	"city": [["props_road/lamp", 3], ["props_road/dumpster", 2], ["props_road/hydrant", 1],
		["props_road/bus_shelter", 1], ["props_road/tires", 2], ["props_debris/concrete_chunk", 3],
		["props_debris/rebar", 2], ["props_debris/bricks", 2], ["props_indoor/chair", 1],
		["props_roof/ac_unit", 2], ["props_roof/satellite_dish", 1], ["props_roof/antenna", 2],
		["props_roof/chimney", 2], ["props_roof/skylight", 1], ["props_roof/planter", 2],
		["props_gates/fence_chain", 2], ["props_gates/roadblock", 2],
		["tiles_wall/top_2", 2, 1, 2], ["tiles_wall/top_1", 2, 1, 3], ["tiles_wall/piece", 1, 1, 2]],
	"base": [["props_lab/drum", 2], ["props_lab/crates", 3], ["props_lab/server_rack", 1],
		["props_lab/generator", 2], ["props_lab/cylinders", 1], ["props_lab/hazmat_box", 2],
		["props_road/bollard", 3], ["props_debris/girder", 2], ["props_debris/pipe_rusty", 2],
		["props_power/gen_cabinet", 2], ["props_power/gen_engine", 2], ["props_power/power_panel", 2],
		["props_power/transformer", 2], ["props_power/battery_bank", 1], ["props_power/light_tower", 2],
		["props_aa/aa_twin", 1], ["props_aa/aa_flak", 1], ["props_gates/gate_mesh", 2],
		["props_gates/blast_wall", 2], ["tiles_wall/solid_2", 2, 1, 3]],
	"desert": [["props_nature/cactus", 3], ["props_nature/boulder", 3], ["props_nature/rocks", 3],
		["props_nature/dead_tree", 2], ["props_road/cone", 2], ["props_road/jersey_barrier", 2],
		["props_debris/wood_pile", 2], ["props_debris/bricks", 2], ["props_nature/leaf_pile", 2],
		["props_tanks/water_tower", 1], ["props_tanks/fuel_tank", 2], ["props_tanks/tank_leaking", 2],
		["props_gates/jersey_barrier", 2], ["props_gates/tire_stack", 2],
		["tiles_wall/solid", 2, 1, 2], ["tiles_wall/extra_15", 1, 1, 2]],
	"village": [["props_nature/palm", 3], ["props_nature/bush", 3], ["props_nature/leaf_pile", 3],
		["props_indoor/rug_roll", 1], ["props_indoor/table", 1], ["props_road/tires", 2],
		["props_debris/wood_pile", 2], ["props_nature/mushrooms", 2], ["props_indoor/chair", 1],
		["props_tanks/water_tank_roof", 2], ["props_tanks/tank_leaking", 2], ["props_roof/clothesline", 2],
		["props_gates/fence_wood", 2], ["props_gates/gate_wood_open", 1], ["props_gates/tire_stack", 2],
		["props_roof/planter", 2], ["props_roof/gas_cylinders", 2]],
	"forest": [["props_trees/oak_big", 3], ["props_nature/log", 3], ["props_nature/bush", 4],
		["props_nature/cattail", 3], ["props_nature/mushrooms", 3], ["props_nature/rocks", 3],
		["props_debris/wood_pile", 2], ["props_nature/thorn_bush", 3], ["props_trees/birch_bare", 2],
		["props_bridge/bridge_span", 1], ["props_bridge/bridge_collapsed", 1], ["props_bridge/pier_posts", 1],
		["props_towers/tower_wood", 1], ["props_gates/fence_wood", 2], ["props_gates/fence_bent", 2],
		["tiles_wall/piece_1", 2, 1, 3]],
	"port": [["props_lab/drum", 3], ["props_road/tires", 3], ["props_road/barrier", 2],
		["props_debris/barrel_red", 2], ["props_debris/pipe_water", 2], ["props_lab/crates", 3],
		["props_debris/wire_coil", 2], ["props_road/jersey_barrier", 2], ["props_road/hydrant", 1],
		["props_tanks/silo", 2], ["props_tanks/pressure_tank", 1], ["props_roof/gas_cylinders", 2],
		["props_gates/gate_sliding", 1], ["props_gates/gate_mesh", 2], ["props_gates/razor_coil", 2],
		["props_lift/pallet_crate", 2], ["props_aa/aa_quad", 1], ["props_towers/tower_steel", 1]],
	"snow": [["props_trees/pine_snow", 3], ["props_nature/boulder", 3], ["props_debris/ice_shards", 3],
		["props_nature/rocks", 3], ["props_trees/birch_bare", 2], ["props_debris/concrete_chunk", 2],
		["props_nature/dead_tree", 2], ["props_debris/wood_pile", 2], ["props_road/cone", 2],
		["props_towers/tower_ruined", 1], ["props_gates/fence_bent", 2], ["props_bridge/bridge_collapsed", 1],
		["props_roof/antenna", 2], ["tiles_wall/top_2", 2, 2]],
	"space": [["props_lab/server_rack", 3], ["props_lab/vat", 2], ["props_lab/decon_arch", 1],
		["props_lab/pipe_elbow", 3], ["props_lab/breaker", 2], ["props_lab/wall_fan", 2],
		["props_debris/girder", 3], ["props_debris/i_beam", 2], ["props_lab/plastic_crates", 2],
		["props_lift/lift_car", 1], ["props_lift/lift_shaft", 1], ["props_lift/lift_scissor", 2],
		["props_lift/hazard_stripes", 2], ["props_lift/control_panel", 2],
		["props_power/power_panel", 2], ["props_power/generator_unit", 2]],
}

# ثيمات اللعبة → مجموعة الديكور المناسبة
const DECOR_FOR_THEME := {
	"city": "city", "base": "base", "desert": "desert", "forest": "forest", "port": "port",
	"village": "village", "snow": "snow", "space": "space", "industrial": "base", "cave": "base",
	"ruins": "desert", "oasis": "desert", "station": "space", "scifi": "space", "nightbase": "city",
	"mountain": "snow",
}

var props: Array = []
var loot_nodes: Array = []
var spawns: Array = []
var actors: Array = []
var pickups: Array = []
var zone := {"active": false, "center": Vector2.ZERO, "radius": 0.0, "target": 0.0, "state": "idle", "timer": 45.0}
var mode_id := "dm"
var seed_value := 12345
var match_time := 0.0
var match_state := "warmup"
var warmup := 3.0
var quality := 2
var team_scores: Array = [0, 0]
# --- نهاية المباراة: حدّ النقاط أو حدّ الوقت، ثم شاشة نتائج (القسم 8 من الدفتر) ---
var score_limit := 30
var time_limit := 300.0
var winner_team := -1
signal match_finished(result: Dictionary)
var input_manager: InputManager = null

const MAPS := {
	"oasis": {"name_ar": "الواحة المحروقة", "theme": "desert", "w": 3200, "h": 1000, "buildings": 2, "crates": 26, "trees": 5, "water": 1},
	"valleys": {"name_ar": "الوديان الكبرى", "theme": "desert", "w": 6000, "h": 1400, "buildings": 6, "crates": 60, "trees": 18, "water": 2},
	"nightbase": {"name_ar": "القاعدة الليلية", "theme": "base", "w": 2800, "h": 900, "buildings": 4, "crates": 22, "trees": 0, "water": 0},
	"ruinedcity": {"name_ar": "المدينة المهدّمة", "theme": "city", "w": 3600, "h": 1000, "buildings": 7, "crates": 30, "trees": 4, "water": 0},
	"forest": {"name_ar": "الغابة المسكونة", "theme": "forest", "w": 3400, "h": 1100, "buildings": 3, "crates": 24, "trees": 26, "water": 2},
	"village": {"name_ar": "القرية الجبلية", "theme": "village", "w": 3000, "h": 1200, "buildings": 6, "crates": 26, "trees": 12, "water": 1},
	"factory": {"name_ar": "المصنع المهجور", "theme": "base", "w": 3200, "h": 900, "buildings": 5, "crates": 34, "trees": 2, "water": 0},
	"darkforest": {"name_ar": "الغابة المظلمة", "theme": "forest", "w": 3100, "h": 1150, "buildings": 2, "crates": 18, "trees": 20, "water": 2, "time_of_day": 0.9, "backdrop": "bg_parallax_forest_night"},
	"bridge": {"name_ar": "الجسر المكسور", "theme": "city", "w": 4200, "h": 1100, "buildings": 4, "crates": 28, "trees": 6, "water": 3},
	"harbor": {"name_ar": "الميناء البحري", "theme": "port", "w": 3400, "h": 1000, "buildings": 2, "crates": 30, "trees": 1, "water": 3, "time_of_day": 0.7},
	"snowpeak": {"name_ar": "قمة الثلوج", "theme": "snow", "w": 3200, "h": 1100, "buildings": 4, "crates": 24, "trees": 8, "water": 2, "time_of_day": 0.75, "backdrop": "bg_sky_snowfall"},
	"orbital": {"name_ar": "المحطة المدارية", "theme": "space", "w": 3000, "h": 1050, "buildings": 7, "crates": 30, "trees": 0, "water": 0, "time_of_day": 0.5, "backdrop": "bg_sky_station"},
	"swamp": {"name_ar": "المستنقع المسموم", "theme": "forest", "w": 3300, "h": 1050, "buildings": 3, "crates": 22, "trees": 22, "water": 8, "time_of_day": 0.85, "backdrop": "bg_sky_swamp"},
	"warzone": {"name_ar": "منطقة الحرب", "theme": "city", "w": 3800, "h": 1150, "buildings": 12, "crates": 34, "trees": 5, "water": 2, "time_of_day": 0.2, "backdrop": "bg_sky_war_red"},
	"cavern": {"name_ar": "الكهوف المتوهجة", "theme": "cave", "w": 3100, "h": 1050, "buildings": 2, "crates": 24, "trees": 0, "water": 4, "time_of_day": 0.9, "backdrop": "bg_sky_cave_glow"},
	"starfield": {"name_ar": "حقل النجوم", "theme": "base", "w": 2600, "h": 950, "buildings": 6, "crates": 20, "trees": 4, "water": 0, "time_of_day": 0.95, "backdrop": "bg_sky_galaxy"},
	# --- جولة ١٠: الجانب البحري (مصدر الحقيقة: web/src/game/world.js) ---
	"oil_rig": {"name_ar": "المنصة النفطية", "theme": "oil", "w": 3000, "h": 1000, "buildings": 5, "crates": 24, "trees": 0, "water": 10, "time_of_day": 0.8, "backdrop": "bg_parallax_oil_rig"},
	"docks": {"name_ar": "الأرصفة الفجرية", "theme": "port", "w": 3600, "h": 1050, "buildings": 8, "crates": 36, "trees": 2, "water": 6, "time_of_day": 0.25, "backdrop": "bg_sky_harbor_dawn"},
	"sea_deck": {"name_ar": "سطح السفينة", "theme": "port", "w": 2600, "h": 900, "buildings": 1, "crates": 18, "trees": 0, "water": 2, "time_of_day": 0.9},
}


func _ready() -> void:
	add_to_group("world")
	input_manager = get_node_or_null("/root/Main/InputManager")


func setup(mode: String, map_id: String, seed_v: int) -> void:
	mode_id = mode
	seed_value = seed_v
	seed(seed_v)
	_generate(map_id)
	_build_visuals()
	match_state = "warmup"
	match_time = 0.0
	winner_team = -1


# ---------------------------------------------------------------- التوليد
func _generate(map_id: String) -> void:
	var def: Dictionary = MAPS.get(map_id, MAPS["oasis"])
	map_w = int(ceil(float(def["w"]) / Config.TILE))
	map_h = int(ceil(float(def["h"]) / Config.TILE))
	tiles.resize(map_w * map_h)
	tiles.fill(TILE_EMPTY)
	heights.resize(map_w)
	var ground_base := map_h - 5
	var hh := ground_base
	for x in map_w:
		var n := _fbm(float(x) * 1.7, 0.0, 3, 0.06)
		hh = ground_base - int(round(2.0 + n * 7.0))
		heights[x] = clampi(hh, 6, ground_base)
	# مبانٍ
	var buildings := int(def["buildings"])
	for b in buildings:
		var bw := randi_range(9, 18)
		var bh := randi_range(5, 10)
		var bx := randi_range(3, maxi(4, map_w - bw - 3))
		var by := clampi(heights[bx] - bh - 1, 3, map_h - 4)
		# تسطيح الأرض تحت المبنى
		var target := heights[bx]
		for x in range(maxi(0, bx - 2), mini(map_w, bx + bw + 2)):
			heights[x] = target
		for x in range(bx, bx + bw):
			for y in range(by, by + bh):
				var edge := x == bx or x == bx + bw - 1 or y == by or y == by + bh - 1
				if edge:
					_set_tile(x, y, TILE_SOLID)
				else:
					_set_tile(x, y, TILE_BACK if y > by + 1 else TILE_EMPTY)
		# باب
		var door_x := bx + int(bw / 2.0)
		for y in range(by + bh - 2, by + bh):
			_set_tile(door_x, y, TILE_EMPTY)
		loot_nodes.append({"x": (bx + bw * 0.5) * Config.TILE, "y": (by + bh - 2) * Config.TILE, "tier": 2})
	# أرض
	for x in map_w:
		var gy: int = maxi(5, heights[x])
		for y in range(gy, map_h - 1):
			_set_tile(x, y, TILE_TOP if y == gy else TILE_SOLID)
	# صناديق وبراميل
	for i in int(def["crates"]):
		var x := randi_range(2, map_w - 3)
		var y := clampi(heights[x] - 1, 1, map_h - 2)
		props.append({"type": "crate", "pos": Vector2(x * Config.TILE, y * Config.TILE - 28), "v": randi() % 3})
	# أشجار
	for i in int(def["trees"]):
		var x := randi_range(2, map_w - 3)
		props.append({"type": "tree", "pos": Vector2(x * Config.TILE, heights[x] * Config.TILE - 30), "v": randi() % 3})
	# ديكور الثيم من أطالس الذكاء الاصطناعي (يبني إحساس "المكان مسكون" لا فارغ)
	var decor_set: Array = THEME_DECOR.get(DECOR_FOR_THEME.get(String(def["theme"]), "city"), THEME_DECOR["city"])
	var decor_budget := 32
	var size_key := String(def.get("size", "medium"))
	if size_key == "small":
		decor_budget = 20
	elif size_key == "large" or size_key == "br":
		decor_budget = 44
	for i in decor_budget * 2:
		var pick: Array = decor_set[randi() % decor_set.size()]
		if randi_range(1, 10) > int(pick[1]) + 4:
			continue
		var dx := randi_range(2, map_w - 3)
		# لا ديكور فوق ماء أو فراغ (كان يبدو معلّقًا في الهواء)
		var ground_y: int = heights[dx]
		if get_tile(dx, ground_y) == TILE_EMPTY:
			continue
		var in_water := false
		for wy in range(1, 4):
			if get_tile(dx, ground_y + wy) == TILE_WATER:
				in_water = true
		if in_water:
			continue
		var too_close := false
		for other in props:
			if String(other["type"]).begins_with("p:") and absi(int(other["pos"].x) - dx * Config.TILE) < 22:
				too_close = true
				break
		if too_close:
			continue
		props.append({"type": "p:" + String(pick[0]),
			"pos": Vector2(dx * Config.TILE, heights[dx] * Config.TILE),
			"sc": (int(pick[2]) if pick.size() > 2 else 1),
			"stack": (int(pick[3]) if pick.size() > 3 else 1)})
	# ماء
	for i in int(def["water"]):
		var x := randi_range(4, map_w - 12)
		var y := maxi(6, heights[x] + 1)
		for dx in range(0, randi_range(4, 9)):
			for dy in range(0, 2):
				_set_tile(x + dx, y + dy, TILE_WATER)
	# نقاط ظهور موزّعة
	var step := maxi(6, int(map_w / 16.0))
	var x := 3
	while x < map_w - 3:
		spawns.append({"x": x * Config.TILE + 16.0, "y": (heights[x] - 1) * Config.TILE, "team": 0})
		x += step
	# منطقة آمنة (BR)
	if M11Data.MODES.get(mode_id, {}).get("zone", false):
		zone["active"] = true
		zone["center"] = Vector2(map_w * Config.TILE * 0.5, map_h * Config.TILE * 0.5)
		zone["radius"] = maxf(map_w, map_h) * Config.TILE * 0.55
		zone["target"] = zone["radius"]


func _fbm(x: float, y: float, octaves: int, lacunarity: float) -> float:
	var total := 0.0
	var amp := 1.0
	var freq := 1.0
	var norm := 0.0
	for i in octaves:
		total += _value_noise(x * freq, y * freq) * amp
		norm += amp
		amp *= 0.5
		freq *= (1.0 + lacunarity * 6.0)
	return total / maxf(norm, 0.0001)


func _value_noise(x: float, y: float) -> float:
	var xi := int(floor(x))
	var yi := int(floor(y))
	var xf := x - xi
	var yf := y - yi
	var u := xf * xf * (3.0 - 2.0 * xf)
	var v := yf * yf * (3.0 - 2.0 * yf)
	var a := _hash2(xi, yi)
	var b := _hash2(xi + 1, yi)
	var c := _hash2(xi, yi + 1)
	var d := _hash2(xi + 1, yi + 1)
	return lerpf(lerpf(a, b, u), lerpf(c, d, u), v)


func _hash2(x: int, y: int) -> float:
	var h := (x * 374761393 + y * 668265263 + seed_value * 2246822519) & 0x7fffffff
	h = (h ^ (h >> 13)) * 1274126177
	return float(h & 0xffff) / 65535.0


# ---------------------------------------------------------------- التايلات
func get_tile(tx: int, ty: int) -> int:
	if tx < 0 or ty < 0 or tx >= map_w or ty >= map_h:
		return TILE_SOLID
	return tiles[ty * map_w + tx]


func _set_tile(tx: int, ty: int, v: int) -> void:
	if tx < 0 or ty < 0 or tx >= map_w or ty >= map_h:
		return
	tiles[ty * map_w + tx] = v


func is_solid_tile(t: int) -> bool:
	return t in SOLID_TILES


func is_solid_at(world_pos: Vector2) -> bool:
	return is_solid_tile(get_tile(int(floor(world_pos.x / Config.TILE)), int(floor(world_pos.y / Config.TILE))))


func damage_tile(tx: int, ty: int, amount: float) -> void:
	var t := get_tile(tx, ty)
	if not DESTRUCTIBLE.has(t):
		return
	var hp: float = float(DESTRUCTIBLE[t]) - amount
	if hp <= 0.0:
		_set_tile(tx, ty, TILE_EMPTY)
	else:
		DESTRUCTIBLE[t] = hp


func explode(pos: Vector2, radius: float, power: float) -> void:
	var t0 := Vector2i(int((pos.x - radius) / Config.TILE), int((pos.y - radius) / Config.TILE))
	var t1 := Vector2i(int((pos.x + radius) / Config.TILE), int((pos.y + radius) / Config.TILE))
	for tx in range(t0.x, t1.x + 1):
		for ty in range(t0.y, t1.y + 1):
			var d := pos.distance_to(Vector2(tx * Config.TILE + 16, ty * Config.TILE + 16))
			if d <= radius:
				damage_tile(tx, ty, power * (1.0 - d / radius))
	_rebuild_dirty(t0, t1)


func _rebuild_dirty(_a: Vector2i, _b: Vector2i) -> void:
	terrain.queue_redraw()


# ---------------------------------------------------------------- الرسم
func _load_backdrop() -> void:
	# لوحة منظر بيئية من رصيد الصور المولّدة (القسم 15.2) — غيابها لا يُفشل شيء
	var def: Dictionary = MAPS.get(Config.map_id, MAPS["oasis"])
	var theme: String = def["theme"]
	# الأولوية: لوحة صريحة في تعريف الخريطة ← الطقس ← الثيم (نفس الترتيب في نسخة الويب)
	var spec := String(def.get("backdrop", ""))
	if spec == "":
		spec = String(WEATHER_BACKDROP.get(String(def.get("weather", "")), ""))
	if spec == "":
		spec = String(THEME_BACKDROP.get(theme, ""))
	var name := spec
	if spec.contains("|"):
		# نهار/ليل: نعتمد على تعريف الخريطة، ولو غاب فالليل هو الافتراضي للخرائط الداكنة
		var parts := spec.split("|")
		var tod: float = float(def.get("time_of_day", 0.5))
		var night := tod < 0.2 or tod > 0.62
		name = String(parts[1] if night else parts[0])
	var path := BACKDROP_DIR + name + ".png"
	if name != "" and ResourceLoader.exists(path):
		backdrop_tex = load(path)


func _build_visuals() -> void:
	_load_backdrop()
	terrain.draw.connect(_draw_terrain)
	terrain.queue_redraw()
	queue_redraw()


func _draw_terrain() -> void:
	var atlas: AtlasLoader.AtlasResource = AtlasLoader.instance.get_atlas("world")
	var theme: String = MAPS.get(Config.map_id, MAPS["oasis"])["theme"]
	var cam_rect := get_viewport().get_visible_rect()
	var x0 := maxi(0, int((cam_rect.position.x) / Config.TILE) - 1)
	var x1 := mini(map_w - 1, int((cam_rect.end.x) / Config.TILE) + 1)
	var y0 := maxi(0, int((cam_rect.position.y) / Config.TILE) - 1)
	var y1 := mini(map_h - 1, int((cam_rect.end.y) / Config.TILE) + 1)
	for ty in range(y0, y1 + 1):
		for tx in range(x0, x1 + 1):
			var t := get_tile(tx, ty)
			if t == TILE_EMPTY:
				continue
			var key := "tile/%s/solid" % theme
			match t:
				TILE_TOP:
					key = "tile/%s/top" % theme
				TILE_BACK:
					key = "tile/%s/back" % theme
				TILE_PLATFORM:
					key = "tile/%s/platform" % theme
				TILE_WATER:
					key = "prop/water"
				TILE_CRATE:
					key = "prop/crate"
				TILE_SANDBAG:
					key = "prop/sandbag"
				TILE_GLASS:
					key = "prop/glass"
				TILE_LADDER:
					key = "prop/ladder"
			if atlas:
				atlas.draw(terrain, key, Vector2(tx * Config.TILE, ty * Config.TILE))
	# الكائنات
	for p in props:
		if not atlas:
			continue
		var ptype := String(p["type"])
		if ptype.begins_with("p:"):
			# عنصر من أطالس الذكاء الاصطناعي: يُثبَّت من قاعدته على الأرض
			var parts := ptype.substr(2).split("/")
			if parts.size() == 2:
				var res: AtlasLoader.AtlasResource = AtlasLoader.instance.get_atlas(parts[0])
				if res:
					var fkey := parts[0] + "/" + parts[1]
					if not res.frames.has(fkey) and parts[0].begins_with("tiles_"):
						fkey = "tile/" + parts[0].substr(6) + "/" + parts[1]
					var fr: Dictionary = res.frames.get(fkey, {})
					if not fr.is_empty():
						var pos: Vector2 = p["pos"]
						var sc := float(p.get("sc", 1))
						var stack: int = mini(int(p.get("stack", 1)), 4)
						for i in stack:
							res.draw(terrain, fkey,
								Vector2(pos.x, pos.y - float(fr["h"]) * sc - i * float(fr["h"]) * sc), false, sc)
			continue
		atlas.draw(terrain, "prop/%s" % p["type"], p["pos"])


func set_quality(q: int) -> void:
	quality = q
	canvas_modulate.visible = q >= 1


# ---------------------------------------------------------------- التحديث
func _process(dt: float) -> void:
	match_time += dt
	if match_state == "warmup":
		warmup -= dt
		if warmup <= 0.0:
			match_state = "playing"
	if match_state == "playing":
		_check_match_end()
	if zone["active"]:
		_update_zone(dt)


func _check_match_end() -> void:
	# شروط النهاية: بلوغ حدّ النقاط، أو انتهاء الوقت، أو مقتل الصامد الأخير في القتال الحر
	var top: int = maxi(int(team_scores[0]), int(team_scores[1]))
	var done := false
	if top >= score_limit:
		done = true
		winner_team = 0 if int(team_scores[0]) >= int(team_scores[1]) else 1
	elif match_time >= time_limit:
		done = true
		winner_team = -1 if int(team_scores[0]) == int(team_scores[1]) else (0 if int(team_scores[0]) > int(team_scores[1]) else 1)
	var alive := 0
	for a in actors:
		if a.alive:
			alive += 1
	if mode_id == "survival" or mode_id == "infection":
		if alive <= 1 and actors.size() > 1:
			done = true
			winner_team = 0
	if not done:
		return
	match_state = "over"
	var stats := {"kills": 0, "deaths": 0}
	for a in actors:
		if not a.is_bot:
			stats["kills"] = int(a.kills)
			stats["deaths"] = int(a.deaths)
	match_finished.emit({
		"winner_team": winner_team, "scores": team_scores.duplicate(),
		"time": match_time, "mode": mode_id, "map": Config.map_id,
		"player_kills": int(stats["kills"]), "player_deaths": int(stats["deaths"]),
	})


func _update_zone(dt: float) -> void:
	zone["timer"] = float(zone["timer"]) - dt
	if float(zone["timer"]) <= 0.0 and float(zone["radius"]) > 180.0:
		zone["radius"] = float(zone["radius"]) * 0.82
		zone["timer"] = 30.0
		queue_redraw()
	# ضرر خارج المنطقة
	for a in actors:
		if a.alive and float(zone["radius"]) < 100000.0:
			var d: float = a.global_position.distance_to(zone["center"])
			if d > float(zone["radius"]):
				a.take_damage(1.6 * dt * 10.0, null, {"zone": true})


# ---------------------------------------------------------------- خدمات للكيانات
func spawn_projectile(data: Dictionary) -> Node2D:
	var pr := preload("res://src/game/projectile.gd").new()
	pr.setup(self, data)
	projectiles.add_child(pr)
	return pr


func player_pos() -> Vector2:
	for a in actors:
		if not a.is_bot:
			return a.global_position
	return Vector2.ZERO


func pick_spawn_point(for_team: int) -> Vector2:
	var best := spawns[0]["x"] if spawns.size() > 0 else Vector2(100, 100)
	var best_score := -1.0
	for i in 6:
		if spawns.is_empty():
			break
		var sp: Dictionary = spawns[randi() % spawns.size()]
		if for_team == 1 and sp.get("team", 0) == 0:
			continue
		var score := 1e9
		for a in actors:
			if a.alive and a.team != for_team:
				score = minf(score, Vector2(sp["x"], sp["y"]).distance_to(a.global_position))
		if score > best_score:
			best_score = score
			best = Vector2(sp["x"], sp["y"])
	return best


func add_actor(is_bot: bool, data: Dictionary) -> Node2D:
	var scene: PackedScene = preload("res://scenes/Actor.tscn")
	var a: CharacterBody2D = scene.instantiate()
	a.is_bot = is_bot
	entities.add_child(a)
	a.setup(self, data)
	a.global_position = pick_spawn_point(int(data.get("team", 0)))
	a.damaged.connect(_on_actor_damaged)
	actors.append(a)
	return a


func nearest_hostile(a: Actor) -> Actor:
	# أقرب عدو بغضّ النظر عن خط النظر — يمنع مباريات بلا اشتباك (نفس منطق الويب)
	var best: Actor = null
	var bd := INF
	for e in actors:
		if e == a or not e.alive or e.hp <= 0.0:
			continue
		if e.team == a.team and not Config.friendly_fire:
			continue
		var d := a.global_position.distance_squared_to(e.global_position)
		if d < bd:
			bd = d
			best = e
	return best


func input_manager_get() -> InputManager:
	return get_node_or_null("/root/Main/InputManager")


# ---------------------------------------------------------------- الشبكة
func build_snapshot() -> PackedByteArray:
	# [count u8][لكل مقاتل: id, x i16، y i16، aim u8، state u8، hp u8، flags u8، vx i8، vy i8]
	var buf := PackedByteArray()
	buf.resize(1 + actors.size() * 11)
	buf[0] = actors.size() & 0xFF
	var o := 1
	for a in actors:
		buf[o + 0] = a.net_id & 0xFF
		buf.encode_s16(o + 1, int(clampf(a.global_position.x * 4.0, -32768.0, 32767.0)))
		buf.encode_s16(o + 3, int(clampf(a.global_position.y * 4.0, -32768.0, 32767.0)))
		var ang := fposmod(a.aim_angle, TAU) / TAU
		buf[o + 5] = int(ang * 255.0)
		buf[o + 6] = a.anim_state
		buf[o + 7] = int(clampf(a.hp, 0.0, 255.0))
		var flags := 0
		if a.facing_x > 0.0:
			flags |= 1
		if a.alive:
			flags |= 2
		if a.jetpack_on:
			flags |= 4
		if a.ads:
			flags |= 8
		if a.crouching:
			flags |= 16
		if a.prone:
			flags |= 32
		buf[o + 8] = flags
		buf.encode_s8(o + 9, int(clampf(a.velocity.x / 4.0, -127.0, 127.0)))
		buf.encode_s8(o + 10, int(clampf(a.velocity.y / 4.0, -127.0, 127.0)))
		o += 11
	return buf


# إعادة بثّ إصابة أي مقاتل إلى الواجهة (أسهم اتجاه الضرر + وميض الإصابة)
func register_kill(team: int) -> void:
	# يسجّله المقاتل عند كل قتل — منه تُحسب نقاط الفريق ونهاية المباراة
	if team >= 0 and team < team_scores.size():
		team_scores[team] = int(team_scores[team]) + 1


func _on_actor_damaged(actor, amount: float, info: Dictionary) -> void:
	actor_damaged.emit(actor, amount, info)


# ---------------------------------------------------------------- المنظر الخلفي
# يُرسم هنا لأن عقدة World تُرسم قبل أبنائها ⇒ اللوحة خلف التضاريس دائمًا.
func _draw() -> void:
	if backdrop_tex == null:
		return
	var cam := get_viewport().get_camera_2d()
	var cam_x := cam.global_position.x if cam else global_position.x
	# نرسم أعلى 78% من اللوحة فقط: الجزء السفلي (أرضية اللوحة) يُقصّ حتى لا
	# يتصادم بصريًا مع تضاريس اللعبة الفعلية — نفس حلّ نسخة الويب (تلاشٍ سفلي).
	var src := Rect2(Vector2.ZERO, Vector2(backdrop_tex.get_width(), backdrop_tex.get_height() * 0.78))
	var sc := 0.5                          # 1280×720 → 640×360 = نصف، تكبير صحيح
	var dw := src.size.x * sc
	var dh := src.size.y * sc
	backdrop_offset = fposmod(cam_x * 0.02, dw)
	var cam_y := cam.position.y if cam else 0.0
	var y := cam_y - dh * 0.5
	var x := cam_x - dw * 0.5 - backdrop_offset
	while x < cam_x + dw * 1.5:
		draw_texture_rect_region(backdrop_tex, Rect2(x, y, dw, dh), src)
		x += dw


func _process(_dt: float) -> void:
	# اللوحة مرتبطة بالكاميرا ⇒ نحدّثها كل إطار (تكلفة draw واحد لكل نسخة)
	if backdrop_tex != null:
		queue_redraw()
