# شاشة التحميل — شعار ونسبة تقدم عربية بالكامل
extends Control

var _t := 0.0
var art: Texture2D = null          # لوحة الإقلاع (خوذة على أكياس رمل عند الفجر)


func _ready() -> void:
	# نملأ الشاشة بالكامل (Control داخل طبقة CanvasLayer)
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)   # ملء الشاشة
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	# لوحة الإقلاع من رصيد الصور — غيابها لا يُفشل شيء (نبقى على الخلفية الداكنة)
	for path in ["res://assets/atlases/backdrops/splash_boot_helmet.png",
			"res://assets/atlases/backdrops/poster_loading.png"]:
		if ResourceLoader.exists(path):
			art = load(path)
			break


func _process(dt: float) -> void:
	_t += dt
	queue_redraw()


func _draw() -> void:
	var vp := get_viewport().get_visible_rect().size
	var font := ThemeDB.fallback_font
	draw_rect(Rect2(Vector2.ZERO, vp), Color(0.043, 0.051, 0.063))
	if art != null:
		# اللوحة بعرض الشاشة كاملة (16:9) بلا أي تنعيم — أصل بيكسل
		draw_texture_rect(art, Rect2(Vector2(0, 0), Vector2(vp.x, vp.x * 0.5625)), false, Color(1, 1, 1, 0.95))
		# ستارة داكنة خفيفة أسفل النصف حتى يُقرأ الشعار والشريط
		draw_rect(Rect2(0, vp.y * 0.42, vp.x, vp.y * 0.58), Color(0.04, 0.05, 0.07, 0.55))
	var title := "ميكا ١١"
	draw_string(font, Vector2(vp.x * 0.5 + 120, vp.y * 0.5), title, HORIZONTAL_ALIGNMENT_RIGHT, -1, 40, Color(0.95, 0.76, 0.31))
	draw_string(font, Vector2(vp.x * 0.5 + 120, vp.y * 0.5 + 26), "ساحة النار المحلية — بلا إنترنت", HORIZONTAL_ALIGNMENT_RIGHT, -1, 14, Color(0.62, 0.72, 0.78))
	# شريط تقدم
	var bar := Rect2(vp.x * 0.5 - 120, vp.y * 0.5 + 50, 240, 8)
	draw_rect(bar, Color(0.11, 0.13, 0.15))
	var pct := clampf(fmod(_t * 0.45, 1.2), 0.0, 1.0)
	draw_rect(Rect2(bar.position, Vector2(bar.size.x * pct, bar.size.y)), Color(0.31, 0.82, 0.77))
