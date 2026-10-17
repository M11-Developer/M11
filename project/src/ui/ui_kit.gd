# ============================================================================
# أدوات الرسم المشتركة لكل الواجهات — خط عربي حقيقي + لوحات + نصوص متكيّفة.
#
# لماذا هذا الملف؟
#  • كانت القوائم وواجهة اللعب ترسم النص بـ ThemeDB.fallback_font (خط المحرّك
#    الاحتياطي) لا بخط Cairo المرفق. النتيجة: حروف عربية مشوّهة/مقطوعة
#    (ظهرت «الإكل ضد الكل» بدل «الكل ضد الكل») وأحجام غير متّسقة على الأجهزة.
#  • كل الرسم الآن يمر من هنا: خط واحد، مقاسات متكيّفة، لوحات موحّدة الهوية.
# ============================================================================
class_name M11UI
extends RefCounted

const FONT_REG: FontFile = preload("res://assets/fonts/cairo_400.ttf")
const FONT_BOLD: FontFile = preload("res://assets/fonts/cairo_700.ttf")
const FONT_FALLBACK: FontFile = preload("res://assets/fonts/noto_ar_500.ttf")
const FONT_PIXEL: FontFile = preload("res://assets/fonts/pixel_400.ttf")

const GOLD := Color(0.95, 0.76, 0.31)
const GOLD_DIM := Color(0.72, 0.56, 0.22)
const TEXT := Color(0.92, 0.95, 0.97)
const TEXT_DIM := Color(0.62, 0.72, 0.78)
const TEXT_MUTED := Color(0.44, 0.52, 0.58)
const BG := Color(0.043, 0.051, 0.063)
const PANEL := Color(0.035, 0.047, 0.063, 0.82)
const PANEL_DEEP := Color(0.02, 0.028, 0.04, 0.93)
const BORDER := Color(0.22, 0.27, 0.33, 0.9)
const GREEN := Color(0.37, 0.84, 0.48)
const TEAL := Color(0.31, 0.82, 0.77)
const ORANGE := Color(0.95, 0.63, 0.24)
const RED := Color(0.91, 0.32, 0.25)
const PINK := Color(0.91, 0.36, 0.61)
const BLUE := Color(0.5, 0.82, 0.96)


## يختار مقاس خط يضمن دخول النص داخل العرض المتاح بلا قصّ.
static func fit_size(font: Font, txt: String, max_w: float, size: int, min_size: int = 8) -> int:
	var s := size
	while s > min_size and font.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, s).x > max_w:
		s -= 1
	return s


static func width(font: Font, txt: String, size: int) -> float:
	return font.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x


## نص عربي بظل خفيف — أوضح بكثير على الخلفيات الفنية.
static func text(canvas: CanvasItem, font: Font, txt: String, pos: Vector2, size: int,
		color: Color = TEXT, align: int = HORIZONTAL_ALIGNMENT_RIGHT, max_w: float = -1.0,
		shadow: bool = true) -> void:
	var s := size
	if max_w > 0.0:
		s = fit_size(font, txt, max_w, size, 7)
	if shadow:
		canvas.draw_string(font, pos + Vector2(1, 1), txt, align, max_w, s, Color(0, 0, 0, 0.65))
	canvas.draw_string(font, pos, txt, align, max_w, s, color)


## نصّم النص في مستطيل (بدل حساب الإحداثيات يدويًا في كل موضع).
static func text_in(canvas: CanvasItem, font: Font, txt: String, rect: Rect2, size: int,
		color: Color = TEXT, align: int = HORIZONTAL_ALIGNMENT_RIGHT) -> void:
	var s := fit_size(font, txt, rect.size.x, size, 7)
	var x := rect.position.x
	if align == HORIZONTAL_ALIGNMENT_RIGHT:
		x = rect.end.x
	elif align == HORIZONTAL_ALIGNMENT_CENTER:
		x = rect.position.x + rect.size.x * 0.5
	var baseline := rect.position.y + rect.size.y * 0.5 + s * 0.36
	text(canvas, font, txt, Vector2(x, baseline), s, color, align)


static func panel(canvas: CanvasItem, rect: Rect2, fill: Color = PANEL,
		border: Color = Color(0, 0, 0, 0), accent: Color = Color(0, 0, 0, 0),
		accent_w: float = 3.0) -> void:
	canvas.draw_rect(rect, fill)
	if border.a > 0.01:
		canvas.draw_rect(rect, border, false, 1.0)
	if accent.a > 0.01:
		canvas.draw_rect(Rect2(rect.end.x - accent_w, rect.position.y, accent_w, rect.size.y), accent)


static func gradient_rect(canvas: CanvasItem, rect: Rect2, top: Color, bottom: Color) -> void:
	# تدرّج عمودي بخطوات ثابتة (Godot's draw_rect لا يدعم التدرّج مباشرة)
	var steps := maxi(2, int(rect.size.y / 6.0))
	for i in steps:
		var k := float(i) / float(steps - 1)
		var c := top.lerp(bottom, k)
		var y := rect.position.y + rect.size.y * (float(i) / float(steps))
		var h := rect.size.y / float(steps) + 1.0
		canvas.draw_rect(Rect2(rect.position.x, y, rect.size.x, h), c)


## يرسم صورة بتغطية كاملة (cover) مع الحفاظ على نسبة الأبعاد وقصّ الزائد.
## كان الكود يمدّ لوحة 16:9 إلى مستطيل الشاشة فيشوّه الصورة ويقصّ رأس الشخصية.
static func draw_cover(canvas: CanvasItem, tex: Texture2D, area: Rect2, alpha: float = 1.0) -> void:
	if tex == null:
		return
	var ts := Vector2(tex.get_width(), tex.get_height())
	if ts.x <= 0.0 or ts.y <= 0.0:
		return
	var k: float = maxf(area.size.x / ts.x, area.size.y / ts.y)
	var dst_size := ts * k
	var dst := Rect2(area.position + (area.size - dst_size) * 0.5, dst_size)
	canvas.draw_texture_rect(tex, dst, false, Color(1, 1, 1, alpha))


## يرسم صورة باحتوائها كاملة داخل المستطيل (contain) — لا قصّ.
static func draw_contain(canvas: CanvasItem, tex: Texture2D, area: Rect2, alpha: float = 1.0) -> void:
	if tex == null:
		return
	var ts := Vector2(tex.get_width(), tex.get_height())
	if ts.x <= 0.0 or ts.y <= 0.0:
		return
	var k: float = minf(area.size.x / ts.x, area.size.y / ts.y)
	var dst_size := ts * k
	var dst := Rect2(area.position + (area.size - dst_size) * 0.5, dst_size)
	canvas.draw_texture_rect(tex, dst, false, Color(1, 1, 1, alpha))


## زر دائري مع نص في الوسط — يُستخدم في القوائم وشاشة اللمس.
static func circle_button(canvas: CanvasItem, center: Vector2, radius: float, fill: Color,
		border: Color, label: String = "", size: int = 12, text_col: Color = TEXT) -> void:
	canvas.draw_circle(center, radius, fill)
	canvas.draw_arc(center, radius, 0.0, TAU, 32, border, 1.5, true)
	if label != "":
		var s := fit_size(FONT_BOLD, label, radius * 1.7, size, 7)
		text(canvas, FONT_BOLD, label, Vector2(center.x, center.y + s * 0.36), s, text_col,
			HORIZONTAL_ALIGNMENT_CENTER)


## أيقونة صغيرة مرسومة بالكود (لا تعتمد على أطلس) — واضحة على أي حجم.
static func icon(canvas: CanvasItem, kind: String, center: Vector2, s: float, col: Color) -> void:
	var r := s * 0.5
	match kind:
		"play":
			canvas.draw_colored_polygon(PackedVector2Array([
				center + Vector2(-r * 0.55, -r), center + Vector2(r * 0.85, 0),
				center + Vector2(-r * 0.55, r)]), col)
		"back":
			canvas.draw_colored_polygon(PackedVector2Array([
				center + Vector2(r * 0.6, -r), center + Vector2(-r * 0.5, 0),
				center + Vector2(r * 0.6, r)]), col)
		"map":
			canvas.draw_rect(Rect2(center - Vector2(r, r * 0.75), Vector2(s, s * 0.75)), col, false, 1.5)
			canvas.draw_line(center + Vector2(-r, -r * 0.25), center + Vector2(r, -r * 0.25), col, 1.0)
		"gear":
			canvas.draw_arc(center, r * 0.55, 0.0, TAU, 16, col, 2.0, true)
			canvas.draw_arc(center, r, 0.0, TAU, 16, col, 1.2, true)
		"trophy":
			canvas.draw_rect(Rect2(center + Vector2(-r * 0.6, -r * 0.7), Vector2(r * 1.2, r * 0.9)), col)
			canvas.draw_rect(Rect2(center + Vector2(-r * 0.2, r * 0.2), Vector2(r * 0.4, r * 0.7)), col)
		"warn":
			canvas.draw_colored_polygon(PackedVector2Array([
				center + Vector2(0, -r), center + Vector2(r, r * 0.8),
				center + Vector2(-r, r * 0.8)]), col)
			canvas.draw_rect(Rect2(center + Vector2(-1, -r * 0.35), Vector2(2, r * 0.75)), BG)
		_:
			canvas.draw_circle(center, r * 0.55, col)


## ينظّف النص من المسافات الزائدة ويقصّه بحرف الحذف لو زاد الطول.
static func clip_txt(txt: String, max_chars: int) -> String:
	var t := txt.strip_edges()
	if t.length() <= max_chars:
		return t
	return t.substr(0, max_chars - 1) + "…"
