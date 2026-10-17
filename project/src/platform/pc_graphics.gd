# ============================================================================
# تحسينات العرض الخاصة بنسخة الكمبيوتر.
#
# لماذا ملف مستقل؟ لأن نسخة الجوال يجب أن تبقى خفيفة على البطارية، بينما
# الكمبيوتر يملك كرت شاشة يسمح بطبقة معالجة لاحقة كاملة. هذا الملف:
#   • يضيف طبقة Post-FX (Bloom + تدريج ألوان + Vignette + حبيبات)
#   • يفعّل ملء الشاشة الحقيقي (Borderless Fullscreen) قابلًا للتبديل بـ F11
#   • يرفع سقف الإطارات ويشغّل V-Sync
#   • يوسّع مدى الإضاءة الديناميكية على أعلى مستويات الجودة
# لا يعمل على أندرويد إطلاقًا (الفحص في apply_to).
# ============================================================================
extends Node
class_name PCGraphics

var post_layer: CanvasLayer = null
var post_rect: ColorRect = null
var _shader: Shader = null


func is_desktop() -> bool:
	return OS.has_feature("pc") or OS.has_feature("windows") or OS.has_feature("linuxbsd") \
		or OS.has_feature("macos")


func apply_to(main_node: Node) -> void:
	if not is_desktop():
		return
	_apply_window()
	_apply_post_fx(main_node)
	_apply_frame_pacing()


# ------------------------------------------------------------------ النافذة
func _apply_window() -> void:
	var win := get_window()
	if win == null:
		return
	# ملء الشاشة بلا حواف: لا شريط عنوان ولا إطار — نفس شرط «بلا حواف سوداء»
	if Config.desktop_fullscreen:
		win.mode = Window.MODE_FULLSCREEN
	else:
		win.mode = Window.MODE_WINDOWED
		var screen_size := DisplayServer.screen_get_size()
		var target := Vector2i(
			int(min(1600, screen_size.x * 0.82)),
			int(min(900, screen_size.y * 0.82)))
		win.size = target
		win.position = (screen_size - target) / 2
	win.borderless = true


func toggle_fullscreen() -> void:
	var win := get_window()
	if win == null:
		return
	Config.desktop_fullscreen = not Config.desktop_fullscreen
	_apply_window()
	Config.save_settings()


func _apply_frame_pacing() -> void:
	# سقف الإطارات: يتبع إعداد المستخدم، ويُرفع إلى 144 على الجودة العالية
	if Config.fps_limit <= 0:
		Engine.max_fps = 0 if Config.quality >= 3 else 144
	else:
		Engine.max_fps = Config.fps_limit
	var vsync_on: bool = Config.quality >= 2
	DisplayServer.window_set_vsync_mode(
		DisplayServer.VSYNC_ENABLED if vsync_on else DisplayServer.VSYNC_DISABLED)


# --------------------------------------------------------------- المعالجة
func _apply_post_fx(main_node: Node) -> void:
	if not Config.pc_post_fx:
		return
	if ResourceLoader.exists("res://assets/shaders/pc_post.gdshader"):
		_shader = load("res://assets/shaders/pc_post.gdshader")
	if _shader == null:
		push_warning("شيدر تحسينات الكمبيوتر غير موجود — نكمل بدونه")
		return
	post_layer = CanvasLayer.new()
	post_layer.name = "PCPostFX"
	post_layer.layer = 90          # فوق اللعب والواجهة، ويقرأ الشاشة كما هي
	main_node.add_child(post_layer)
	post_rect = ColorRect.new()
	post_rect.name = "PostRect"
	post_rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	post_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mat := ShaderMaterial.new()
	mat.shader = _shader
	# نُخفّف الشدة على الجودة المتوسطة لتظل الألوان قريبة من الجوال
	if Config.quality <= 1:
		mat.set_shader_parameter("bloom_strength", 0.0)
		mat.set_shader_parameter("grain_amount", 0.0)
		mat.set_shader_parameter("vignette_strength", 0.35)
	post_rect.material = mat
	post_layer.add_child(post_rect)


func set_quality(q: int) -> void:
	if post_rect == null or post_rect.material == null:
		return
	var mat: ShaderMaterial = post_rect.material
	mat.set_shader_parameter("bloom_strength", 0.0 if q <= 1 else (0.42 if q >= 3 else 0.26))
	mat.set_shader_parameter("grain_amount", 0.0 if q <= 1 else 0.028)
	mat.set_shader_parameter("vignette_strength", 0.35 if q <= 1 else 0.55)
	post_rect.visible = q >= 1
	_apply_frame_pacing()
