# ============================================================================
# أزرار اللمس على الشاشة — تخطيط حقيقي مُقاس، لا تراكب.
#
# ما تغيّر:
#  • كانت ١٠ دوائر متكدسة في زاوية واحدة (كما في لقطة المستخدم) بلا مسافات.
#    الآن: زر إطلاق كبير + عنقود محيطي بمسافات محسوبة، وأزرار نظام في زاوية
#    مستقلة.
#  • لم يكن هناك زر إيقاف مؤقت إطلاقًا على الهاتف — أُضيف مع زر لوحة النتائج.
#  • كانت العصي لا تُرى قبل اللمس فيضيع اللاعب — الآن يظهر موضعا الإبهام
#    بخفوت شديد، ويُبرز كل زر بلونه وشكله حين يُضغط.
#  • رسم «مؤشر التصويب» صار حول اللاعب بزاوية التصويب الحقيقية.
# ============================================================================
extends Control

var im: Node = null
var player: Node2D = null

const ICON_LABEL := {
	"fire": "إطلاق", "jump": "قفز", "jetpack": "جيت", "reload": "تعبئة",
	"crouch": "انخفاض", "prone": "انبطاح", "melee": "ضربة", "heal": "علاج",
	"grenade": "قنبلة", "swap": "سلاح", "pause": "❚❚", "score": "☰",
	"fire2": "", "jump2": "قفز", "fire3": "", "melee2": "ضربة",
}
const ICON_GLYPH := {
	"fire": "◎", "jump": "↥", "jetpack": "↟", "reload": "⟳", "crouch": "⌄",
	"prone": "⌄", "melee": "✕", "heal": "＋", "grenade": "●", "swap": "⇄",
	"pause": "❚❚", "score": "☰", "fire2": "◎", "jump2": "↥", "fire3": "◎", "melee2": "✕",
}


func setup(input_manager: Node, player_ref: Node2D) -> void:
	im = input_manager
	player = player_ref


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	visible = DisplayServer.is_touchscreen_available() or OS.has_feature("mobile")
	set_process(visible)


func _process(_dt: float) -> void:
	queue_redraw()


func _draw() -> void:
	if im == null:
		return
	var vp := get_viewport().get_visible_rect().size
	var scale_factor := vp / Vector2(im.view_size)
	# ---- موضعا الإبهام (خفيفان جدًا قبل اللمس) ----
	var homes := im._home_positions()
	_draw_stick_home(Vector2(homes["move"]) * scale_factor, 52.0 * minf(scale_factor.x, scale_factor.y), "حركة")
	_draw_stick_home(Vector2(homes["aim"]) * scale_factor, 46.0 * minf(scale_factor.x, scale_factor.y), "تصويب")
	# ---- العصي النشطة ----
	_draw_stick(im.move_stick, scale_factor, Color(0.36, 0.82, 0.77, 0.26), Color(0.42, 0.95, 0.88, 0.75))
	_draw_stick(im.aim_stick, scale_factor, Color(0.95, 0.72, 0.31, 0.22), Color(1.0, 0.82, 0.42, 0.8))
	# ---- الأزرار ----
	var alpha: float = clampf(float(Config.button_alpha), 0.15, 1.0)
	for name in im.buttons.keys():
		var r: Rect2 = im.buttons[name]
		var center: Vector2 = r.get_center() * scale_factor
		var radius: float = float(im.button_radius.get(name, 16.0)) * minf(scale_factor.x, scale_factor.y)
		var pressed: bool = bool(im.button_state.get(name, false))
		var big: bool = name == "fire" or name == "fire2" or name == "fire3"
		var fill := Color(0.05, 0.08, 0.1, 0.42 * alpha)
		var border := Color(0.85, 0.92, 0.96, 0.35 * alpha)
		if big:
			fill = Color(0.85, 0.42, 0.25, 0.30 * alpha)
			border = Color(1.0, 0.65, 0.45, 0.55 * alpha)
		if name == "pause" or name == "score":
			fill = Color(0.03, 0.05, 0.07, 0.7 * alpha)
			border = Color(0.95, 0.76, 0.31, 0.6 * alpha)
		if pressed:
			fill = Color(0.95, 0.76, 0.31, 0.40)
			border = Color(1.0, 0.88, 0.55, 0.95)
		draw_circle(center, radius, fill)
		draw_arc(center, radius, 0.0, TAU, 36, border, 1.6, true)
		var glyph: String = String(ICON_GLYPH.get(name, ""))
		var label: String = String(ICON_LABEL.get(name, ""))
		if glyph != "":
			M11UI.text(self, M11UI.FONT_BOLD, glyph, center + Vector2(0, radius * 0.34),
				int(clampf(radius * 0.95, 9.0, 26.0 if big else 18.0)),
				Color(1, 1, 1, 0.92) if pressed else Color(0.92, 0.96, 0.98, 0.86),
				HORIZONTAL_ALIGNMENT_CENTER)
		if label != "" and radius >= 15.0:
			M11UI.text(self, M11UI.FONT_BOLD, label, center + Vector2(0, radius * 0.95),
				int(clampf(radius * 0.34, 7.0, 10.0)), Color(0.85, 0.9, 0.94, 0.8 * alpha),
				HORIZONTAL_ALIGNMENT_CENTER)
	# ---- دوائر الوقود والذخيرة حول زر الجيت والإطلاق ----
	if im.buttons.has("jetpack"):
		var fr: Rect2 = im.buttons["jetpack"]
		var fuel: float = 0.0
		var p = player
		if p != null and is_instance_valid(p):
			fuel = float(p.jet_fuel) / Config.JETPACK_FUEL
		draw_arc(fr.get_center() * scale_factor, float(im.button_radius["jetpack"]) * minf(scale_factor.x, scale_factor.y) + 3.0,
			-PI * 0.5, -PI * 0.5 + TAU * clampf(fuel, 0.0, 1.0), 28,
			Color(0.95, 0.63, 0.24, 0.85), 2.0, true)
	# ---- مؤشر التصويب حول اللاعب ----
	if player != null and is_instance_valid(player) and player.alive:
		var aim: Vector2 = im.aim_stick["vec"]
		if aim.length() < 0.15:
			aim = Vector2.RIGHT.rotated(player.aim_angle)
		else:
			aim = aim.normalized()
		var world_pos: Vector2 = player.global_position + Vector2(0, 31)
		var origin: Vector2 = get_viewport().get_canvas_transform() * world_pos
		var tip: Vector2 = origin + aim * 88.0 * minf(scale_factor.x, scale_factor.y)
		draw_circle(tip, 5.0, Color(1.0, 0.45, 0.35, 0.85))
		draw_arc(tip, 9.0, 0.0, TAU, 18, Color(1.0, 0.45, 0.35, 0.45), 1.6, true)


func _draw_stick_home(center: Vector2, r: float, label: String) -> void:
	draw_circle(center, r, Color(0.04, 0.06, 0.08, 0.16))
	draw_arc(center, r, 0.0, TAU, 32, Color(0.8, 0.9, 0.95, 0.13), 1.4, true)
	draw_circle(center, r * 0.42, Color(0.8, 0.9, 0.95, 0.07))
	M11UI.text(self, M11UI.FONT_REG, label, center + Vector2(0, r * 0.34), 10,
		Color(0.8, 0.9, 0.95, 0.22), HORIZONTAL_ALIGNMENT_CENTER)


func _draw_stick(stick: Dictionary, scale_factor: Vector2, base_col: Color, knob_col: Color) -> void:
	if not bool(stick["active"]):
		return
	var origin: Vector2 = stick["origin"] * scale_factor
	var pos: Vector2 = stick["pos"] * scale_factor
	var r: float = 52.0 * minf(scale_factor.x, scale_factor.y)
	draw_circle(origin, r, base_col)
	draw_arc(origin, r, 0.0, TAU, 32, Color(1, 1, 1, 0.22), 1.6, true)
	draw_circle(pos, r * 0.42, knob_col)
	draw_arc(pos, r * 0.42, 0.0, TAU, 24, Color(0.04, 0.06, 0.08, 0.8), 1.4, true)
