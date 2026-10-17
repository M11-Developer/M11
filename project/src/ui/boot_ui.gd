# شاشة التحميل — شعار ونسبة تقدم عربية بالكامل
extends Control

var _t := 0.0
var progress := 0.0            # تقدّم حقيقي 0..1 يقوده main.gd (لا يدور بلا نهاية)
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


func set_progress(p: float) -> void:
	progress = clampf(p, 0.0, 1.0)
	queue_redraw()


func _process(dt: float) -> void:
	_t += dt
	queue_redraw()


func _draw() -> void:
	var vp := get_viewport().get_visible_rect().size
	var font := ThemeDB.fallback_font
	draw_rect(Rect2(Vector2.ZERO, vp), Color(0.043, 0.051, 0.063))
	if art != null:
		# «تغطية» كاملة للشاشة: نكبّر اللوحة حتى تغطي العرض والارتفاع معًا
		# ثم نقصّ الزائد — فلا حواف سوداء ولا صناديق صغيرة في منتصف الشاشة.
		var tex_size: Vector2 = art.get_size()
		if tex_size.x > 0.0 and tex_size.y > 0.0:
			var k: float = maxf(vp.x / tex_size.x, vp.y / tex_size.y)
			var dst_size := tex_size * k
			var dst := Rect2((vp - dst_size) * 0.5, dst_size)
			draw_texture_rect(art, dst, false, Color(1, 1, 1, 0.95))
		# ستارة داكنة أسفل النصف حتى يُقرأ الشعار والشريط
		draw_rect(Rect2(0, vp.y * 0.42, vp.x, vp.y * 0.58), Color(0.04, 0.05, 0.07, 0.55))
	var title := "ميكا ١١"
	var title_size := font.get_string_size(title, HORIZONTAL_ALIGNMENT_LEFT, -1, 40).x
	draw_string(font, Vector2(vp.x * 0.5 - title_size * 0.5, vp.y * 0.5), title,
		HORIZONTAL_ALIGNMENT_LEFT, -1, 40, Color(0.95, 0.76, 0.31))
	var sub := "ساحة النار المحلية — بلا إنترنت"
	var sub_size := font.get_string_size(sub, HORIZONTAL_ALIGNMENT_LEFT, -1, 14).x
	draw_string(font, Vector2(vp.x * 0.5 - sub_size * 0.5, vp.y * 0.5 + 26), sub,
		HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(0.62, 0.72, 0.78))
	# شريط تقدّم حقيقي — يتوقف عند 100% ولا يعيد نفسه
	var bar := Rect2(vp.x * 0.5 - 120, vp.y * 0.5 + 50, 240, 8)
	draw_rect(bar, Color(0.11, 0.13, 0.15))
	var pct := clampf(progress, 0.0, 1.0)
	if pct > 0.0:
		draw_rect(Rect2(bar.position, Vector2(bar.size.x * pct, bar.size.y)), Color(0.31, 0.82, 0.77))
	# لمعة خفيفة تتحرّك داخل الجزء المكتمل فقط (تجميل لا يبدو كتعليق)
	if pct > 0.02 and pct < 1.0:
		var glow_x := bar.position.x + fposmod(_t * 160.0, bar.size.x * pct)
		draw_rect(Rect2(glow_x, bar.position.y, 24, bar.size.y), Color(0.75, 1.0, 0.95, 0.35))
