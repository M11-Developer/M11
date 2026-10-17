# ============================================================================
# واجهة اللعب — عربية RTL: صحة/درع/وقود، سلاح وذخيرة، خريطة مصغّرة، سجل قتل،
# مؤشر ضرر اتجاهي، عدّاد، أخبار، وشاشة نتائج. كل النص متجه (لا نص في الصور).
# ============================================================================
extends Control

var world: GameWorld
var player: Actor
var font: Font
var kill_feed: Array = []
var toasts: Array = []
var damage_dirs: Array = []
var hit_flash := 0.0
var hud_time := 0.0
var show_scoreboard := false
var show_net := false
var big_map := false

const COLOR_HP := Color(0.37, 0.84, 0.48)
const COLOR_ARMOR := Color(0.5, 0.82, 0.96)
const COLOR_FUEL := Color(0.95, 0.63, 0.24)
const COLOR_WARN := Color(0.91, 0.32, 0.25)
const COLOR_GOLD := Color(0.95, 0.76, 0.31)


func _ready() -> void:
	# نملأ الشاشة بالكامل (Control داخل طبقة CanvasLayer)
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)   # ملء الشاشة
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func setup(w: GameWorld, p: Actor) -> void:
	world = w
	player = p
	font = ThemeDB.fallback_font
	w.connect("actor_damaged", _on_damage) if w.has_signal("actor_damaged") else null


func toast(text: String, color: Color = COLOR_GOLD, life: float = 2.5) -> void:
	toasts.append({"text": text, "color": color, "life": life, "max": life})
	if toasts.size() > 5:
		toasts.pop_front()


func _on_damage(actor: Actor, amount: float, info: Dictionary) -> void:
	if actor != player:
		return
	hit_flash = minf(1.0, hit_flash + amount / 60.0)
	var src = info.get("attacker", null)
	if src:
		damage_dirs.append({"angle": (src.global_position - player.global_position).angle(), "life": 1.1})


func _process(dt: float) -> void:
	hud_time += dt
	hit_flash = maxf(0.0, hit_flash - dt * 1.4)
	for i in range(damage_dirs.size() - 1, -1, -1):
		damage_dirs[i]["life"] -= dt
		if damage_dirs[i]["life"] <= 0.0:
			damage_dirs.remove_at(i)
	for i in range(toasts.size() - 1, -1, -1):
		toasts[i]["life"] -= dt
		if toasts[i]["life"] <= 0.0:
			toasts.remove_at(i)
	queue_redraw()


func _draw() -> void:
	if world == null or player == null:
		return
	var vp := get_viewport().get_visible_rect().size
	_draw_crosshair(vp)
	_draw_vitals(vp)
	_draw_weapon(vp)
	_draw_top(vp)
	_draw_minimap(vp)
	_draw_toasts(vp)
	_draw_damage_dirs(vp)
	if hit_flash > 0.01:
		draw_rect(Rect2(Vector2.ZERO, vp), Color(0.75, 0.1, 0.1, hit_flash * 0.25))


func _draw_crosshair(vp: Vector2) -> void:
	if not player.alive:
		return
	var c := vp * 0.5
	var w := player.weapon_def()
	var spread := float(w.get("spread", 1.0)) * (0.5 if player.ads else 1.0)
	var gap := 4.0 + spread * 3.0
	var col := Color(0.49, 1.0, 0.7, 0.9)
	draw_rect(Rect2(c + Vector2(-1, -gap - 4), Vector2(2, 4)), col)
	draw_rect(Rect2(c + Vector2(-1, gap), Vector2(2, 4)), col)
	draw_rect(Rect2(c + Vector2(-gap - 4, -1), Vector2(4, 2)), col)
	draw_rect(Rect2(c + Vector2(gap, -1), Vector2(4, 2)), col)


func _draw_vitals(vp: Vector2) -> void:
	var x := 10.0
	var y := vp.y - 46.0
	draw_rect(Rect2(x - 2, y - 2, 180, 40), Color(0.04, 0.05, 0.06, 0.78))
	var hp_pct := clampf(player.hp / player.max_hp, 0.0, 1.0)
	var hp_col := COLOR_HP if hp_pct > 0.6 else (COLOR_GOLD if hp_pct > 0.3 else COLOR_WARN)
	draw_rect(Rect2(x + 4, y + 6, 130, 9), Color(0.11, 0.13, 0.15, 0.9))
	draw_rect(Rect2(x + 4, y + 6, 130 * hp_pct, 9), hp_col)
	draw_string(font, Vector2(x + 148, y + 16), "%d" % int(ceil(player.hp)), HORIZONTAL_ALIGNMENT_LEFT, -1, 12, hp_col)
	if player.armor > 0.0:
		draw_rect(Rect2(x + 4, y + 18, 90 * (player.armor / 100.0), 5), COLOR_ARMOR)
	var fuel_pct := player.jet_fuel / Config.JETPACK_FUEL
	draw_rect(Rect2(x + 4, y + 26, 130 * fuel_pct, 5), COLOR_FUEL if fuel_pct > 0.25 else COLOR_WARN)
	draw_string(font, Vector2(x + 140, y + 32), "وقود الجيت باك", HORIZONTAL_ALIGNMENT_LEFT, -1, 8, Color(0.62, 0.72, 0.78))


func _draw_weapon(vp: Vector2) -> void:
	var w := player.weapon_def()
	if w.is_empty():
		return
	var x := vp.x - 190.0
	var y := vp.y - 92.0
	draw_rect(Rect2(x, y, 180, 42), Color(0.04, 0.05, 0.06, 0.8))
	draw_string(font, Vector2(vp.x - 20, y + 18), String(w.get("name_ar", "")), HORIZONTAL_ALIGNMENT_RIGHT, -1, 13, COLOR_GOLD)
	var mag := player.weapon_ammo()
	draw_string(font, Vector2(x + 10, y + 32), "%d" % mag, HORIZONTAL_ALIGNMENT_LEFT, -1, 18,
		COLOR_WARN if mag == 0 else Color(0.92, 0.95, 0.97))
	var reserve := int(player.ammo.get(String(w.get("cls", "ar")), 0))
	draw_string(font, Vector2(x + 42, y + 32), "/ %d" % reserve, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(0.62, 0.72, 0.78))
	if player.reloading:
		var def_reload := float(w.get("reload", 2.0))
		draw_rect(Rect2(x + 4, y + 36, 80 * (1.0 - player.reload_timer / maxf(0.1, def_reload)), 4), COLOR_GOLD)
		draw_string(font, Vector2(x + 90, y + 40), "إعادة تعبئة", HORIZONTAL_ALIGNMENT_LEFT, -1, 8, COLOR_GOLD)


func _draw_top(vp: Vector2) -> void:
	var mins := int(maxf(0.0, world.match_time) / 60.0)
	var secs := int(fmod(maxf(0.0, world.match_time), 60.0))
	draw_rect(Rect2(vp.x * 0.5 - 44, 6, 88, 20), Color(0.04, 0.05, 0.06, 0.8))
	draw_string(font, Vector2(vp.x * 0.5 + 34, 21), "%02d:%02d" % [mins, secs], HORIZONTAL_ALIGNMENT_RIGHT, -1, 14, Color(0.92, 0.95, 0.97))
	draw_string(font, Vector2(vp.x * 0.5 - 50, 21), "ف١ %d" % world.team_scores[0], HORIZONTAL_ALIGNMENT_RIGHT, -1, 10, Color(0.31, 0.82, 0.77))
	draw_string(font, Vector2(vp.x * 0.5 - 10, 21), "ف٢ %d" % world.team_scores[1], HORIZONTAL_ALIGNMENT_RIGHT, -1, 10, Color(0.91, 0.45, 0.29))


func _draw_minimap(vp: Vector2) -> void:
	var x := 8.0
	var y := 8.0
	var w := 104.0
	var h := 64.0
	draw_rect(Rect2(x - 2, y - 2, w + 4, h + 4), Color(0.04, 0.05, 0.06, 0.85))
	draw_rect(Rect2(x, y, w, h), Color(0.16, 0.2, 0.24, 1.0))
	var sx := w / float(world.map_w * Config.TILE)
	var sy := h / float(world.map_h * Config.TILE)
	# المنطقة الآمنة
	if world.zone["active"]:
		draw_arc(Vector2(x + world.zone["center"].x * sx, y + world.zone["center"].y * sy),
			float(world.zone["radius"]) * sx, 0.0, TAU, 48, Color(0.5, 0.82, 0.96), 1.0)
	for a in world.actors:
		if not a.alive:
			continue
		var px: float = x + a.global_position.x * sx
		var py: float = y + a.global_position.y * sy
		var col := Color(1, 1, 1) if a == player else (Color(0.31, 0.82, 0.77) if a.team == player.team else Color(0.91, 0.45, 0.29))
		draw_rect(Rect2(px - 1, py - 1, 2, 2), col)
	draw_string(font, Vector2(x + w, y + h + 12), M11Data.MODES.get(world.mode_id, {}).get("name_ar", ""), HORIZONTAL_ALIGNMENT_RIGHT, -1, 10, COLOR_GOLD)


func _draw_toasts(vp: Vector2) -> void:
	var y := vp.y - 120.0
	for t in toasts:
		var col: Color = t["color"]
		col.a = clampf(t["life"] / minf(0.6, t["max"]), 0.0, 1.0)
		draw_string(font, Vector2(vp.x * 0.5 + 120, y), String(t["text"]), HORIZONTAL_ALIGNMENT_RIGHT, -1, 12, col)
		y -= 14.0


func _draw_damage_dirs(vp: Vector2) -> void:
	var c := vp * 0.5
	for d in damage_dirs:
		var fade: float = clampf(d["life"] / 1.1, 0.0, 1.0)
		var ang: float = d["angle"]
		var p1 := c + Vector2(cos(ang - 0.25), sin(ang - 0.25)) * 46.0
		var p2 := c + Vector2(cos(ang), sin(ang)) * 58.0
		var p3 := c + Vector2(cos(ang + 0.25), sin(ang + 0.25)) * 46.0
		draw_colored_polygon(PackedVector2Array([p1, p2, p3]), Color(1.0, 0.35, 0.29, fade * 0.85))
