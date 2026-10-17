# ============================================================================
# نقطة الدخول — تحميل الأصول، القوائم، بدء المباراة، والحلقة الرئيسية.
# ============================================================================
extends Node

const ATLASES := ["world", "vfx", "ui", "weapons", "arms"]

var world: GameWorld = null
var hud: Node = null
var menu: Node = null
var touch_ui: Node = null      # طبقة أزرار اللمس (تُنشأ مع بدء المباراة)
var pc: PCGraphics = null      # تحسينات العرض على الكمبيوتر فقط
var loading := true
var state := "boot"          # boot | menu | playing | paused | results

@onready var game_layer: Node2D = $GameLayer
@onready var hud_layer: CanvasLayer = $HUDLayer
@onready var input_manager: InputManager = $InputManager


func _ready() -> void:
	# حارس أمان: إن فشل أي شيء في الإقلاع، تظهر القائمة على كل حال بعد ٨ ثوانٍ
	# بدل أن يظل شريط التحميل يدور إلى الأبد.
	var guard := get_tree().create_timer(8.0)
	guard.timeout.connect(_ensure_menu)
	_set_boot_progress(0.05)
	_boot()
	_setup_desktop()


func _boot() -> void:
	# 1) محمّل الأطالس
	if get_node_or_null("AtlasLoader") == null:
		var atlas := AtlasLoader.new()
		atlas.name = "AtlasLoader"
		add_child(atlas)
	var names := ATLASES.duplicate()
	# 2) أطالس الشخصيات (المشغّلون)
	var meta: Variant = _read_json("res://assets/atlases/characters_meta.json")
	if meta is Dictionary:
		var ops: Variant = meta.get("operators", {})
		if ops is Dictionary:
			for op_key in ops.keys():
				names.append("char_" + String(op_key))
	# 3) أطالس العناصر والديكور
	var plist: Variant = _read_json("res://assets/atlases/props_manifest.json")
	if plist is Array:
		for e in plist:
			if e is Dictionary and e.has("atlas"):
				names.append(String(e["atlas"]))
	# 4) أطالس التايلات لكل ثيم
	var tlist: Variant = _read_json("res://assets/atlases/tiles_manifest.json")
	if tlist is Array:
		for e in tlist:
			if e is Dictionary and e.has("theme"):
				names.append("tiles_" + String(e["theme"]))
	var loader := get_node_or_null("AtlasLoader")
	_set_boot_progress(0.35)
	if loader != null and loader.has_method("load_all"):
		loader.load_all(names)
	_set_boot_progress(0.80)
	# 5) تحميل مسبق للمشهد
	_prewarm()
	_ensure_menu()


# تحسينات نسخة الكمبيوتر: ملء شاشة حقيقي + معالجة لاحقة + سقف إطارات أعلى
func _setup_desktop() -> void:
	if not (OS.has_feature("pc") or OS.has_feature("windows") or OS.has_feature("linuxbsd") or OS.has_feature("macos")):
		return
	pc = PCGraphics.new()
	pc.name = "PCGraphics"
	add_child(pc)
	pc.apply_to(self)
	pc.set_quality(Config.quality)
	# أيقونة النافذة وقت التشغيل (لا نعدّل موارد الملف التنفيذي في البناء)
	var icon_path := "res://assets/atlases/app_icon.png"
	if ResourceLoader.exists(icon_path):
		var icon_tex: Texture2D = load(icon_path)
		if icon_tex != null:
			DisplayServer.set_icon(icon_tex.get_image())
	print("[M11] تحسينات الكمبيوتر مفعّلة (Fullscreen + Post-FX)")


func _set_boot_progress(p: float) -> void:
	var boot := get_node_or_null("BootUI/BootPanel")
	if boot != null and boot.has_method("set_progress"):
		boot.set_progress(p)


func _read_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	var txt := f.get_as_text()
	f.close()
	return JSON.parse_string(txt)


# يُنشئ القائمة مرة واحدة فقط — آمن للنداء المتكرر (حارس الإقلاع + المسار العادي)
func _ensure_menu() -> void:
	if menu != null and is_instance_valid(menu):
		return
	if state != "boot" and state != "menu":
		return
	var boot := get_node_or_null("BootUI/BootPanel")
	if boot != null:
		boot.queue_free()
	_set_boot_progress(1.0)
	var boot_ui := get_node_or_null("BootUI")
	if boot_ui != null:
		boot_ui.visible = false
	menu = preload("res://src/ui/menu.gd").new()
	menu.name = "Menu"
	hud_layer.add_child(menu)
	state = "menu"
	loading = false
	AudioBus.play_music("menu_theme")
	print("[M11] الإقلاع اكتمل — القائمة جاهزة")


func _prewarm() -> void:
	# نحمّل المشهد مسبقًا حتى لا يتجمّد أول إطار
	preload("res://scenes/Actor.tscn")


func start_match(opts: Dictionary = {}) -> void:
	if world:
		world.queue_free()
		world = null
	world = preload("res://scenes/World.tscn").instantiate()
	game_layer.add_child(world)
	var map_id: String = opts.get("map", Config.map_id)
	var mode_id: String = opts.get("mode", Config.mode_id)
	world.setup(mode_id, map_id, int(opts.get("seed", randi())))
	# كانت الجودة تُحفظ في الإعدادات ولا تُمرَّر للعالم — الآن تُطبَّق فورًا
	if world.has_method("set_quality"):
		world.set_quality(Config.quality)
	if pc != null:
		pc.set_quality(Config.quality)
	# نهاية المباراة (حدّ النقاط/الوقت) تفتح شاشة النتائج — لا تبقى المباراة معلّقة بلا خاتمة
	if not world.match_finished.is_connected(_on_match_finished):
		world.match_finished.connect(_on_match_finished)
	# اللاعب
	var data := {
		"name": Config.player_name, "team": 0, "op_key": Config.op_key, "is_bot": false,
		"weapons": Config.loadout, "net_id": NetMgr.local_id,
	}
	var player = world.add_actor(false, data)
	var cam := Camera2D.new()
	cam.position_smoothing_enabled = true
	cam.position_smoothing_speed = 8.0
	cam.zoom = Vector2(1, 1)
	cam.limit_left = 0
	cam.limit_top = -400
	cam.limit_right = world.map_w * Config.TILE
	cam.limit_bottom = world.map_h * Config.TILE
	player.add_child(cam)
	cam.make_current()
	# البوتات
	var bots := int(opts.get("bots", Config.bot_count))
	for i in bots:
		var team := 0 if i % 2 == 0 else 1 if M11Data.MODES.get(mode_id, {}).get("teams", 1) > 1 else 0
		var bot = world.add_actor(true, {
			"name": M11Data.BOT_NAMES[i % M11Data.BOT_NAMES.size()],
			"team": team, "op_key": M11Data.OPERATORS[(i + 3) % M11Data.OPERATORS.size()]["key"],
			"is_bot": true, "weapons": ["jabha", "n9"], "net_id": 10 + i,
		})
		bot.add_child(preload("res://src/ai/bot_brain.gd").new())
	# واجهة اللعب
	if hud:
		hud.queue_free()
	hud = preload("res://src/ui/hud.gd").new()
	hud_layer.add_child(hud)
	hud.setup(world, player)
	# طبقة أزرار اللمس — بدونها لا يستطيع اللاعب التحكم على الهاتف
	if touch_ui:
		touch_ui.queue_free()
	touch_ui = preload("res://src/ui/touch_controls.gd").new()
	touch_ui.name = "TouchControls"
	hud_layer.add_child(touch_ui)
	touch_ui.setup(get_node("InputManager"), player)
	# نُسلّم مرجع اللاعب لمُدير التحكم حتى يعمل تصويب الماوس على الكمبيوتر
	if input_manager != null:
		input_manager.player_ref = player
	state = "playing"
	AudioBus.play_music("dm_fast")
	# إعادة بناء أزرار اللمس حسب التخطيط والحجم المختارَين في الإعدادات
	var im := get_node_or_null("InputManager")
	if im and im.has_method("rebuild_buttons"):
		im.rebuild_buttons()


func _on_match_finished(res: Dictionary) -> void:
	# 1) تجميد اللعب فورًا حتى لا تستمر البوتات بالقتال خلف شاشة النتائج
	get_tree().paused = true
	state = "results"
	if hud:
		hud.visible = false
	# 2) حفظ الإحصاءات والخبرة محليًا (تشفير بسيط، بلا أي اتصال بالإنترنت)
	var won: bool = int(res.get("winner_team", -1)) == 0
	var saved := Save.record_match({
		"kills": int(res.get("player_kills", 0)), "deaths": int(res.get("player_deaths", 0)),
		"won": won,
	})
	# 3) شاشة النتائج — لوحة النصر أو الهزيمة المولّدة
	if menu:
		var payload := res.duplicate()
		payload["xp"] = saved["xp"]
		payload["level"] = saved["level"]
		menu.show_results(payload)
		menu.visible = true
	# 4) ننبّه المشاهد ليتوقف عن التحديث
	if world and world.has_method("set_process"):
		world.set_process(false)
	AudioBus.play_music("menu_theme")


func back_to_menu() -> void:
	# رجوع نظيف: نوقف الإيقاف المؤقت، نحذف العالم، ونعيد القائمة
	get_tree().paused = false
	if world:
		world.queue_free()
		world = null
	if hud:
		hud.queue_free()
		hud = null
	if touch_ui:
		touch_ui.queue_free()
		touch_ui = null
	if menu:
		menu.screen = 0
		menu.index = 0
		menu.visible = true
	state = "menu"
	AudioBus.play_music("menu_theme")


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F11:
		if pc != null:
			pc.toggle_fullscreen()
		return
	if state == "results" and menu and (event.is_action_pressed("ui_cancel") or event.is_action_pressed("pause")):
		back_to_menu()
		return
	if event.is_action_pressed("pause"):
		if state == "playing":
			state = "paused"
			get_tree().paused = true
		elif state == "paused":
			state = "playing"
			get_tree().paused = false
