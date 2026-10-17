# ============================================================================
# واجهة اللعب — عربية RTL بخط Cairo، وكل المعلومات التي يحتاجها اللاعب فعلًا:
# صحة/درع/وقود، سلاح وذخيرة وإعادة تعبئة، خريطة مصغّرة حقيقية من بلاطات
# الخريطة، سجل قتل، مؤشرات ضرر اتجاهية، منطقة آمنة، لوحة نتائج، وخريطة كبيرة.
#
# ما تغيّر:
#  • كانت الخريطة المصغّرة مستطيلًا رماديًا فارغًا (لا تضاريس ولا أعداء واضحين).
#  • لا سجل قتل، لا لوحة نتائج، لا مؤشر انتظار إحياء، لا عدّاد استعداد.
#  • النصوص كانت بخط المحرّك الاحتياطي فتظهر الحروف العربية مشوّهة.
# ============================================================================
extends Control

var world: GameWorld
var player: Actor
var font: Font = M11UI.FONT_REG
var toasts: Array = []
var damage_dirs: Array = []
var hit_flash := 0.0
var hit_marker := 0.0
var hit_marker_kill := false
var hud_time := 0.0
var show_scoreboard := false
var big_map := false
var show_net := false
var net_stats := {"ping": 0, "loss": 0}
var fps := 60.0

const COLOR_HP := Color(0.37, 0.84, 0.48)
const COLOR_ARMOR := Color(0.5, 0.82, 0.96)
const COLOR_FUEL := Color(0.95, 0.63, 0.24)
const COLOR_WARN := Color(0.91, 0.32, 0.25)
const COLOR_GOLD := Color(0.95, 0.76, 0.31)
const COLOR_TEAL := Color(0.31, 0.82, 0.77)
const COLOR_ORANGE := Color(0.95, 0.55, 0.28)


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func setup(w: GameWorld, p: Actor) -> void:
	world = w
	player = p
	if w != null:
		if w.has_signal("actor_damaged"):
			w.actor_damaged.connect(_on_damage)
		for a in w.actors:
			if a.has_signal("died"):
				a.died.connect(_on_actor_died)


func _on_actor_died(victim, killer, info: Dictionary) -> void:
	if killer == player and victim != player:
		hit_marker = 0.5
		hit_marker_kill = true
		toast("قتلت %s" % String(victim.display_name), COLOR_GOLD, 1.8)


func toast(text: String, color: Color = COLOR_GOLD, life: float = 2.5) -> void:
	toasts.append({"text": text, "color": color, "life": life, "max": life})
	if toasts.size() > 5:
		toasts.pop_front()


func _on_damage(actor, amount: float, info: Dictionary) -> void:
	var attacker = info.get("attacker", null)
	if actor == player:
		hit_flash = minf(1.0, hit_flash + amount / 55.0)
		if attacker != null and is_instance_valid(attacker):
			damage_dirs.append({"angle": (attacker.global_position - player.global_position).angle(), "life": 1.2})
	elif attacker == player:
		hit_marker = 0.35
		hit_marker_kill = false


func _process(dt: float) -> void:
	hud_time += dt
	hit_flash = maxf(0.0, hit_flash - dt * 1.4)
	hit_marker = maxf(0.0, hit_marker - dt * 1.6)
	for i in range(damage_dirs.size() - 1, -1, -1):
		damage_dirs[i]["life"] = float(damage_dirs[i]["life"]) - dt
		if float(damage_dirs[i]["life"]) <= 0.0:
			damage_dirs.remove_at(i)
	for i in range(toasts.size() - 1, -1, -1):
		toasts[i]["life"] = float(toasts[i]["life"]) - dt
		if float(toasts[i]["life"]) <= 0.0:
			toasts.remove_at(i)
	queue_redraw()


# ------------------------------------------------------------------ الرسم
func _draw() -> void:
	if world == null or player == null:
		return
	var vp := get_viewport().get_visible_rect().size
	_draw_top_bar(vp)
	_draw_minimap(vp)
	_draw_vitals(vp)
	_draw_weapon(vp)
	_draw_kill_feed(vp)
	_draw_toasts(vp)
	if Config.show_fps:
		_draw_fps(vp)
	if not player.alive:
		_draw_respawn(vp)
	elif world.match_state == "warmup":
		_draw_warmup(vp)
	_draw_crosshair(vp)
	_draw_damage_dirs(vp)
	if hit_flash > 0.01:
		draw_rect(Rect2(Vector2.ZERO, vp), Color(0.75, 0.1, 0.1, hit_flash * 0.22))
	if player.hp / maxf(1.0, player.max_hp) < 0.3 and player.alive:
		_draw_low_hp(vp)
	if show_scoreboard:
		_draw_scoreboard(vp)
	if big_map:
		_draw_big_map(vp)


func _draw_top_bar(vp: Vector2) -> void:
	var w := 210.0
	var r := Rect2(vp.x * 0.5 - w * 0.5, 6, w, 34)
	M11UI.panel(self, r, Color(0.02, 0.03, 0.05, 0.82), Color(0.95, 0.76, 0.31, 0.35))
	var t := maxf(0.0, world.match_time)
	var mm := int(t / 60.0)
	var ss := int(fmod(t, 60.0))
	M11UI.text(self, M11UI.FONT_BOLD, "%02d:%02d" % [mm, ss],
		Vector2(vp.x * 0.5, r.position.y + 17), 15, M11UI.TEXT, HORIZONTAL_ALIGNMENT_CENTER, 90)
	var teams := int(world.mode_def().get("teams", 1))
	if teams > 1:
		var s0 := int(world.team_scores[0])
		var s1 := int(world.team_scores[1])
		M11UI.text(self, M11UI.FONT_BOLD, str(s0), Vector2(r.position.x + 8, r.end.y - 5), 11, COLOR_TEAL, HORIZONTAL_ALIGNMENT_LEFT, 60)
		M11UI.text(self, M11UI.FONT_BOLD, str(s1), Vector2(r.end.x - 8, r.end.y - 5), 11, COLOR_ORANGE, HORIZONTAL_ALIGNMENT_RIGHT, 60)
		M11UI.text(self, M11UI.FONT_REG, "فريقك", Vector2(r.position.x + 8, r.position.y + 13), 8, COLOR_TEAL, HORIZONTAL_ALIGNMENT_LEFT, 60)
		M11UI.text(self, M11UI.FONT_REG, "الخصم", Vector2(r.end.x - 8, r.position.y + 13), 8, COLOR_ORANGE, HORIZONTAL_ALIGNMENT_RIGHT, 60)
	else:
		var top := 0
		for a in world.actors:
			top = maxi(top, int(a.kills))
		M11UI.text(self, M11UI.FONT_REG, "الأول: %d قتلة" % top,
			Vector2(vp.x * 0.5, r.end.y - 5), 9, M11UI.TEXT_DIM, HORIZONTAL_ALIGNMENT_CENTER, 150)
	# اسم الوضع في سطر مستقل أسفل الشريط — بخط عربي سليم وبعرض كافٍ
	var mode_name := String(world.mode_def().get("name_ar", world.mode_id))
	var label_w: float = clampf(M11UI.width(M11UI.FONT_BOLD, mode_name, 9) + 20.0, 70.0, 220.0)
	var lr := Rect2(vp.x * 0.5 - label_w * 0.5, r.end.y + 2, label_w, 15)
	M11UI.panel(self, lr, Color(0.02, 0.03, 0.05, 0.88), Color(0.95, 0.76, 0.31, 0.22))
	M11UI.text(self, M11UI.FONT_BOLD, mode_name, Vector2(vp.x * 0.5, lr.end.y - 3), 9,
		COLOR_GOLD, HORIZONTAL_ALIGNMENT_CENTER, label_w - 8)
	if world.zone["active"]:
		var zt := int(float(world.zone["timer"]))
		M11UI.text(self, M11UI.FONT_REG, "المنطقة: %d ث" % zt,
			Vector2(vp.x * 0.5, lr.end.y + 12), 9, COLOR_GOLD, HORIZONTAL_ALIGNMENT_CENTER, 160)


func _draw_minimap(vp: Vector2) -> void:
	var size := Vector2(112.0, 68.0)
	var pos := Vector2(10, 8)
	M11UI.panel(self, Rect2(pos - Vector2(3, 3), size + Vector2(6, 6)), Color(0.02, 0.03, 0.05, 0.9), Color(0.95, 0.76, 0.31, 0.45))
	var tex := world.minimap_texture()
	var area := Rect2(pos, size)
	if tex != null:
		var mw := float(world.map_w)
		var mh := float(world.map_h)
		var k: float = minf(size.x / mw, size.y / mh)
		var dw := mw * k
		var dh := mh * k
		var dst := Rect2(pos + (size - Vector2(dw, dh)) * 0.5, Vector2(dw, dh))
		draw_texture_rect(tex, dst, false)
		area = dst
	else:
		draw_rect(area, Color(0.12, 0.16, 0.2))
	# المنطقة الآمنة
	if world.zone["active"]:
		var zc: Vector2 = world.zone["center"]
		var zr := float(world.zone["radius"])
		var sx := area.size.x / (float(world.map_w) * Config.TILE)
		var c := area.position + zc * sx
		draw_arc(c, maxf(2.0, zr * sx), 0.0, TAU, 40, Color(0.5, 0.82, 0.96, 0.85), 1.5, true)
	# المقاتلون
	for a in world.actors:
		if not a.alive:
			continue
		var p := area.position + a.global_position * (area.size.x / (float(world.map_w) * Config.TILE))
		var col := COLOR_GOLD if a == player else (COLOR_TEAL if int(a.team) == int(player.team) else COLOR_ORANGE)
		draw_circle(p, 2.2 if a == player else 1.6, col)
	M11UI.text(self, M11UI.FONT_REG, String(world.mode_def().get("name_ar", world.mode_id)),
		Vector2(pos.x + size.x, pos.y + size.y + 12), 9, M11UI.GOLD, HORIZONTAL_ALIGNMENT_RIGHT, size.x)


func _draw_vitals(vp: Vector2) -> void:
	var x := 10.0
	# أسفل الخريطة المصغّرة واسم الوضع تحتها مباشرة (كان يتداخل معهما)
	var y := 96.0
	var w := 182.0
	var h := 56.0
	M11UI.panel(self, Rect2(x, y, w, h), Color(0.02, 0.03, 0.05, 0.82), Color(1, 1, 1, 0.08))
	var hp_pct := clampf(player.hp / maxf(1.0, player.max_hp), 0.0, 1.0)
	var hp_col := COLOR_HP if hp_pct > 0.6 else (COLOR_GOLD if hp_pct > 0.3 else COLOR_WARN)
	draw_rect(Rect2(x + 8, y + 8, 120, 9), Color(0.09, 0.11, 0.13, 0.95))
	draw_rect(Rect2(x + 8, y + 8, 120.0 * hp_pct, 9), hp_col)
	M11UI.text(self, M11UI.FONT_BOLD, "%d" % int(ceil(player.hp)),
		Vector2(x + 136, y + 17), 14, hp_col, HORIZONTAL_ALIGNMENT_LEFT, 40)
	# الدرع
	if player.armor > 0.0:
		draw_rect(Rect2(x + 8, y + 21, 100, 4), Color(0.09, 0.11, 0.13, 0.95))
		draw_rect(Rect2(x + 8, y + 21, 100.0 * clampf(player.armor / 100.0, 0.0, 1.0), 4), COLOR_ARMOR)
	# الوقود
	var fuel_pct := clampf(player.jet_fuel / Config.JETPACK_FUEL, 0.0, 1.0)
	draw_rect(Rect2(x + 8, y + 29, 120, 5), Color(0.09, 0.11, 0.13, 0.95))
	draw_rect(Rect2(x + 8, y + 29, 120.0 * fuel_pct, 5), COLOR_FUEL if fuel_pct > 0.2 else COLOR_WARN)
	M11UI.text(self, M11UI.FONT_REG, "وقود", Vector2(x + 136, y + 35), 8, M11UI.TEXT_DIM, HORIZONTAL_ALIGNMENT_LEFT, 40)
	# عُدّة
	M11UI.text(self, M11UI.FONT_REG, "علاج %d · قنبلة %d" % [int(player.heals["bandage"]) + int(player.heals["medkit"]), int(player.throwable["count"])],
		Vector2(x + w - 8, y + 50), 8, M11UI.TEXT_DIM, HORIZONTAL_ALIGNMENT_RIGHT, 130)
	if player.dbno:
		M11UI.text(self, M11UI.FONT_BOLD, "مُصاب! انتظر الإنعاش %d" % int(player.bleed_out),
			Vector2(vp.x * 0.5, vp.y * 0.42), 14, COLOR_WARN, HORIZONTAL_ALIGNMENT_CENTER, 300)


func _draw_weapon(vp: Vector2) -> void:
	var wdef := player.weapon_def()
	if wdef.is_empty():
		return
	var box := Rect2(vp.x * 0.5 - 100, vp.y - 48, 200, 38)
	M11UI.panel(self, box, Color(0.02, 0.03, 0.05, 0.86), Color(1, 1, 1, 0.08))
	M11UI.text(self, M11UI.FONT_BOLD, String(wdef.get("name_ar", "")),
		Vector2(box.end.x - 10, box.position.y + 16), 12, M11UI.GOLD, HORIZONTAL_ALIGNMENT_RIGHT, 120)
	var mag := player.weapon_ammo()
	var cls := String(wdef.get("cls", "ar"))
	var reserve := int(player.ammo.get(cls, 0))
	M11UI.text(self, M11UI.FONT_BOLD, str(mag), Vector2(box.position.x + 10, box.end.y - 8), 17,
		COLOR_WARN if mag == 0 else M11UI.TEXT, HORIZONTAL_ALIGNMENT_LEFT, 50)
	M11UI.text(self, M11UI.FONT_REG, "/ %d" % reserve, Vector2(box.position.x + 46, box.end.y - 10), 10,
		M11UI.TEXT_DIM, HORIZONTAL_ALIGNMENT_LEFT, 60)
	# أيقونة النوع
	var slot_txt := "١" if player.slot == 0 else "٢"
	M11UI.text(self, M11UI.FONT_REG, "سلاح %s — %s" % [slot_txt, String(M11Data.WEAPONS.get(String(player.weapons[player.slot]["id"] if player.weapons[player.slot] != null else "n9"), {}).get("name_ar", ""))],
		Vector2(box.end.x - 10, box.end.y - 8), 8, M11UI.TEXT_DIM, HORIZONTAL_ALIGNMENT_RIGHT, 110)
	if player.reloading:
		var total := maxf(0.1, float(wdef.get("reload", 2.0)))
		var pct := 1.0 - clampf(player.reload_timer / total, 0.0, 1.0)
		draw_rect(Rect2(box.position.x + 8, box.position.y + 3, box.size.x - 16, 3), Color(0.1, 0.12, 0.14, 0.9))
		draw_rect(Rect2(box.position.x + 8, box.position.y + 3, (box.size.x - 16) * pct, 3), COLOR_GOLD)
		M11UI.text(self, M11UI.FONT_REG, "إعادة تعبئة…", Vector2(box.position.x + 10, box.position.y + 18), 8, COLOR_GOLD, HORIZONTAL_ALIGNMENT_LEFT, 120)


func _draw_kill_feed(vp: Vector2) -> void:
	if world.kill_feed.is_empty():
		return
	var y := 46.0
	for i in world.kill_feed.size():
		if i >= 5:
			break
		var e: Dictionary = world.kill_feed[i]
		var a: float = clampf(float(e["life"]) / 1.2, 0.0, 1.0)
		var txt := "%s  ←  %s" % [String(e["victim"]), String(e["killer"]) if String(e["killer"]) != "" else "البيئة"]
		var w := minf(250.0, M11UI.width(M11UI.FONT_BOLD, txt, 9) + 16.0)
		var rect := Rect2(vp.x - w - 10, y, w, 15)
		M11UI.panel(self, rect, Color(0.02, 0.03, 0.05, 0.7 * a))
		var col := COLOR_TEAL if int(e["killer_team"]) == int(player.team) else COLOR_ORANGE
		M11UI.text(self, M11UI.FONT_BOLD, txt, Vector2(rect.end.x - 6, y + 11), 9,
			Color(col.r, col.g, col.b, a), HORIZONTAL_ALIGNMENT_RIGHT, w - 10)
		if bool(e["head"]):
			draw_circle(Vector2(rect.position.x + 5, y + 7), 2.0, Color(COLOR_GOLD.r, COLOR_GOLD.g, COLOR_GOLD.b, a))
		y += 17.0


func _draw_crosshair(vp: Vector2) -> void:
	if not player.alive:
		return
	var aim := Vector2.RIGHT.rotated(player.aim_angle)
	var target := player.global_position + Vector2(0, 31) + aim * 210.0
	var screen: Vector2 = get_viewport().get_canvas_transform() * target
	var wdef := player.weapon_def()
	var spread := float(wdef.get("spread", 1.0)) * (0.55 if player.ads else 1.0)
	var gap := 4.0 + spread * 2.2 + player.spread_state * 6.0
	var col := Color(0.49, 1.0, 0.7, 0.92)
	draw_rect(Rect2(screen + Vector2(-1, -gap - 5), Vector2(2, 5)), col)
	draw_rect(Rect2(screen + Vector2(-1, gap), Vector2(2, 5)), col)
	draw_rect(Rect2(screen + Vector2(-gap - 5, -1), Vector2(5, 2)), col)
	draw_rect(Rect2(screen + Vector2(gap, -1), Vector2(5, 2)), col)
	draw_circle(screen, 1.0, col)
	if hit_marker > 0.0:
		var hc := COLOR_WARN if hit_marker_kill else Color(1, 1, 1, 0.9)
		var d := 6.0
		draw_line(screen + Vector2(-d, -d), screen + Vector2(-d - 4, -d - 4), hc, 1.5)
		draw_line(screen + Vector2(d, -d), screen + Vector2(d + 4, -d - 4), hc, 1.5)
		draw_line(screen + Vector2(-d, d), screen + Vector2(-d - 4, d + 4), hc, 1.5)
		draw_line(screen + Vector2(d, d), screen + Vector2(d + 4, d + 4), hc, 1.5)


func _draw_damage_dirs(vp: Vector2) -> void:
	var c := vp * 0.5
	for d in damage_dirs:
		var fade: float = clampf(float(d["life"]) / 1.2, 0.0, 1.0)
		var ang := float(d["angle"])
		var p1 := c + Vector2.from_angle(ang - 0.24) * 54.0
		var p2 := c + Vector2.from_angle(ang) * 68.0
		var p3 := c + Vector2.from_angle(ang + 0.24) * 54.0
		draw_colored_polygon(PackedVector2Array([p1, p2, p3]), Color(1.0, 0.35, 0.29, fade * 0.85))


func _draw_low_hp(vp: Vector2) -> void:
	var a := (1.0 - player.hp / maxf(1.0, player.max_hp)) * 0.5 + sin(hud_time * 6.0) * 0.06
	draw_rect(Rect2(0, 0, vp.x, 3), Color(0.75, 0.1, 0.1, a))
	draw_rect(Rect2(0, vp.y - 3, vp.x, 3), Color(0.75, 0.1, 0.1, a))
	draw_rect(Rect2(0, 0, 3, vp.y), Color(0.75, 0.1, 0.1, a))
	draw_rect(Rect2(vp.x - 3, 0, 3, vp.y), Color(0.75, 0.1, 0.1, a))


func _draw_toasts(vp: Vector2) -> void:
	var y := vp.y * 0.32
	for t in toasts:
		var col: Color = t["color"]
		var a: float = clampf(float(t["life"]) / minf(0.5, float(t["max"])), 0.0, 1.0)
		var txt := String(t["text"])
		var w := minf(vp.x - 40.0, M11UI.width(M11UI.FONT_BOLD, txt, 11) + 26.0)
		M11UI.panel(self, Rect2(vp.x * 0.5 - w * 0.5, y - 13, w, 20), Color(0.02, 0.03, 0.05, 0.78 * a))
		M11UI.text(self, M11UI.FONT_BOLD, txt, Vector2(vp.x * 0.5 + w * 0.5 - 10, y + 2), 11,
			Color(col.r, col.g, col.b, a), HORIZONTAL_ALIGNMENT_RIGHT, w - 16)
		y += 22.0


func _draw_fps(vp: Vector2) -> void:
	M11UI.text(self, M11UI.FONT_REG, "%d إطار/ث" % int(fps), Vector2(vp.x - 10, vp.y - 10), 8, M11UI.TEXT_MUTED, HORIZONTAL_ALIGNMENT_RIGHT, 70)


func _draw_warmup(vp: Vector2) -> void:
	var left := maxf(0.0, float(world.warmup))
	M11UI.text(self, M11UI.FONT_BOLD, "استعد… %d" % int(ceil(left)),
		Vector2(vp.x * 0.5, vp.y * 0.35), 20, M11UI.GOLD, HORIZONTAL_ALIGNMENT_CENTER, 300)


func _draw_respawn(vp: Vector2) -> void:
	var respawns := bool(world.mode_def().get("respawn", true))
	var txt := ""
	if respawns:
		txt = "ستعود خلال %0.1f" % maxf(0.0, Config.RESPAWN_TIME - player.respawn_timer)
	else:
		txt = "انتهت مباراتك — انتظر النتيجة"
	M11UI.text(self, M11UI.FONT_BOLD, txt, Vector2(vp.x * 0.5, vp.y * 0.4), 16, M11UI.TEXT, HORIZONTAL_ALIGNMENT_CENTER, 400)
	if respawns:
		var total := maxf(0.1, Config.RESPAWN_TIME)
		var pct := clampf(player.respawn_timer / total, 0.0, 1.0)
		draw_rect(Rect2(vp.x * 0.5 - 70, vp.y * 0.4 + 12, 140, 4), Color(0.1, 0.12, 0.14))
		draw_rect(Rect2(vp.x * 0.5 - 70, vp.y * 0.4 + 12, 140 * pct, 4), M11UI.GOLD)


func _draw_scoreboard(vp: Vector2) -> void:
	var w := minf(420.0, vp.x - 40.0)
	var rows := world._compute_standings()
	var h := 44.0 + rows.size() * 20.0
	var box := Rect2(vp.x * 0.5 - w * 0.5, vp.y * 0.5 - h * 0.5, w, h)
	M11UI.panel(self, box, Color(0.02, 0.03, 0.05, 0.94), Color(0.95, 0.76, 0.31, 0.55))
	M11UI.text(self, M11UI.FONT_BOLD, "لوحة النتائج — %s" % String(world.mode_def().get("name_ar", "")),
		Vector2(box.end.x - 12, box.position.y + 20), 13, M11UI.GOLD, HORIZONTAL_ALIGNMENT_RIGHT, w - 24)
	var y := box.position.y + 34
	for i in rows.size():
		var r: Dictionary = rows[i]
		if i % 2 == 0:
			draw_rect(Rect2(box.position.x + 6, y - 12, w - 12, 19), Color(1, 1, 1, 0.04))
		var col := COLOR_TEAL if int(r.get("team", 0)) == int(player.team) else COLOR_ORANGE
		if bool(r.get("is_player", false)):
			col = M11UI.GOLD
		M11UI.text(self, M11UI.FONT_BOLD if bool(r.get("is_player", false)) else M11UI.FONT_REG,
			String(r.get("name", "")), Vector2(box.end.x - 14, y), 10, col, HORIZONTAL_ALIGNMENT_RIGHT, w * 0.5)
		M11UI.text(self, M11UI.FONT_REG, "%d / %d" % [int(r.get("kills", 0)), int(r.get("deaths", 0))],
			Vector2(box.position.x + 14, y), 10, M11UI.TEXT_DIM, HORIZONTAL_ALIGNMENT_LEFT, 90)
		y += 20.0


func _draw_big_map(vp: Vector2) -> void:
	var w := minf(vp.x - 60.0, (vp.y - 80.0) * 1.6)
	var h := w * float(world.map_h) / maxf(1.0, float(world.map_w))
	var box := Rect2(vp.x * 0.5 - w * 0.5, vp.y * 0.5 - h * 0.5, w, h)
	draw_rect(Rect2(Vector2.ZERO, vp), Color(0.02, 0.03, 0.05, 0.72))
	M11UI.panel(self, box.grow(4), Color(0.02, 0.03, 0.05, 0.95), Color(0.95, 0.76, 0.31, 0.55))
	var tex := world.minimap_texture()
	if tex != null:
		draw_texture_rect(tex, box, false)
	else:
		draw_rect(box, Color(0.12, 0.16, 0.2))
	for a in world.actors:
		if not a.alive:
			continue
		var p := box.position + Vector2(a.global_position.x / (float(world.map_w) * Config.TILE),
			a.global_position.y / (float(world.map_h) * Config.TILE)) * box.size
		var col := COLOR_GOLD if a == player else (COLOR_TEAL if int(a.team) == int(player.team) else COLOR_ORANGE)
		draw_circle(p, 3.0 if a == player else 2.0, col)
