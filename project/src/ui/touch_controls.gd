# ============================================================================
# طبقة التحكم باللمس — ترسم العصوين وأزرار اللعب على الشاشة.
#
# لماذا هذا الملف؟ لأن InputManager يقرأ اللمس ويحسب الأوامر، لكن لا شيء كان
# يرسم الأزرار على الشاشة — أي أن اللاعب لم يكن يرى أين يضع إصبعه إطلاقًا.
# هذا الملف يرسم:
#   • عصا الحركة (يسار) والعصا اليمنى للتصويب
#   • كل الأزرار المعرّفة في InputManager.buttons (إطلاق، قفز، جيت باك …)
#   • مؤشر التصويب في اتجاه النظر
# ويُخفى تلقائيًا على الحاسوب (حيث الكيبورد والفأرة).
# ============================================================================
extends Control

var im: Node = null            # InputManager
var player: Node2D = null      # المقاتل (لرسم مؤشر التصويب)

const ICONS := {
	"fire": "إطلاق", "fire2": "إطلاق", "fire3": "إطلاق",
	"jump": "قفز", "jump2": "قفز",
	"jetpack": "جيت", "reload": "تعبئة", "crouch": "انخفاض",
	"prone": "انبطاح", "melee": "ضربة", "melee2": "ضربة",
	"heal": "علاج", "grenade": "قنبلة", "swap": "تبديل",
}


func setup(input_manager: Node, player_ref: Node2D) -> void:
	im = input_manager
	player = player_ref


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	# على الحاسوب لا نرسم أزرار لمس (الكيبورد والفأرة يكفيان)
	visible = DisplayServer.is_touchscreen_available() or OS.has_feature("mobile")
	set_process(visible)


func _process(_dt: float) -> void:
	queue_redraw()


func _draw() -> void:
	if im == null:
		return
	var vp := get_viewport().get_visible_rect().size
	var scale_factor: Vector2 = vp / im.view_size

	# ---- العصوان ----
	_draw_stick(im.move_stick, scale_factor, Color(0.36, 0.82, 0.77, 0.30), Color(0.42, 0.95, 0.88, 0.70))
	_draw_stick(im.aim_stick, scale_factor, Color(0.95, 0.72, 0.31, 0.26), Color(1.0, 0.82, 0.42, 0.70))

	# ---- الأزرار ----
	var font := ThemeDB.fallback_font
	for name in im.buttons.keys():
		var r: Rect2 = im.buttons[name]
		var center: Vector2 = (r.position + r.size * 0.5) * scale_factor
		var radius: float = min(r.size.x, r.size.y) * 0.5 * min(scale_factor.x, scale_factor.y)
		var pressed: bool = bool(im.button_state.get(name, false))
		# دائرة الزر
		draw_circle(center, radius, Color(0.08, 0.10, 0.12, 0.55) if not pressed else Color(0.31, 0.82, 0.77, 0.45))
		draw_arc(center, radius, 0.0, TAU, 24, Color(0.55, 0.66, 0.72, 0.55), 2.0, true)
		# النص
		var label: String = String(ICONS[name]) if ICONS.has(name) else ""
		if label != "":
			var fs := int(clampf(radius * 0.72, 9.0, 18.0))
			var w := font.get_string_size(label, HORIZONTAL_ALIGNMENT_CENTER, -1, fs).x
			draw_string(font, center + Vector2(-w * 0.5, fs * 0.34), label,
				HORIZONTAL_ALIGNMENT_CENTER, -1, fs, Color(0.92, 0.96, 0.98, 0.92))

	# ---- مؤشر التصويب ----
	if player != null and is_instance_valid(player):
		var aim: Vector2 = im.aim_stick["vec"]
		if aim.length() < 0.15:
			aim = Vector2.RIGHT if player.get("facing", 1) >= 0 else Vector2.LEFT
		var origin: Vector2 = get_viewport().get_canvas_transform() * player.global_position
		var tip: Vector2 = origin + aim.normalized() * 76.0 * scale_factor
		draw_circle(tip, 5.0, Color(1.0, 0.45, 0.35, 0.85))
		draw_arc(tip, 9.0, 0.0, TAU, 16, Color(1.0, 0.45, 0.35, 0.55), 2.0, true)


func _draw_stick(stick: Dictionary, scale_factor: Vector2, base_col: Color, knob_col: Color) -> void:
	if not stick["active"]:
		return
	var origin: Vector2 = stick["origin"] * scale_factor
	var pos: Vector2 = stick["pos"] * scale_factor
	var r: float = 52.0 * min(scale_factor.x, scale_factor.y)
	draw_circle(origin, r, base_col)
	draw_arc(origin, r, 0.0, TAU, 28, Color(1, 1, 1, 0.20), 2.0, true)
	draw_circle(pos, r * 0.42, knob_col)
