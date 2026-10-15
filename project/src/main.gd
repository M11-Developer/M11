# ============================================================================
# نقطة الدخول — تحميل الأصول، القوائم، بدء المباراة، والحلقة الرئيسية.
# ============================================================================
extends Node

const ATLASES := ["world", "vfx", "ui", "weapons", "arms"]

var world: GameWorld = null
var hud: Node = null
var menu: Node = null
var loading := true
var state := "boot"          # boot | menu | playing | paused | results

@onready var game_layer: Node2D = $GameLayer
@onready var hud_layer: CanvasLayer = $HUDLayer
@onready var input_manager: InputManager = $InputManager


func _ready() -> void:
	var atlas := AtlasLoader.new()
	atlas.name = "AtlasLoader"
	add_child(atlas)
	var names := ATLASES.duplicate()
	var meta := {}
	if FileAccess.file_exists("res://assets/atlases/characters_meta.json"):
		var f := FileAccess.open("res://assets/atlases/characters_meta.json", FileAccess.READ)
		meta = JSON.parse_string(f.get_as_text())
		f.close()
		for op_key in meta.get("operators", {}).keys():
			names.append("char_" + String(op_key))
	atlas.load_all(names)
	# البوتات تستخدم نفس مشهد المقاتل
	_prewarm()
	# واجهة القوائم
	var boot := $BootUI
	boot.queue_free()
	menu = preload("res://src/ui/menu.gd").new()
	add_child(menu)
	state = "menu"
	loading = false
	AudioBus.play_music("menu_theme")


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
	state = "playing"
	AudioBus.play_music("dm_fast")
	# إعادة بناء أزرار اللمس حسب التخطيط والحجم المختارَين في الإعدادات
	var im := get_node_or_null("InputManager")
	if im and im.has_method("rebuild_buttons"):
		im.rebuild_buttons()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		if state == "playing":
			state = "paused"
			get_tree().paused = true
		elif state == "paused":
			state = "playing"
			get_tree().paused = false
