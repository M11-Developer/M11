# ============================================================================
# الإعدادات العامة (Autoload) — تُحفظ في user://settings.json
# كل القيم الافتراضية مطابقة لنسخة الويب تمامًا حتى لا تختلف الإحساس باللعبة.
# ============================================================================
extends Node

const PATH := "user://settings.json"

# --- فيزياء اللاعب (نفس CONFIG في web/src/core/assets.js) ---
const INTERNAL_W := 640
const INTERNAL_H := 360
const TILE := 32
const GRAVITY := 1500.0
const MAX_FALL := 620.0
const MOVE_SPEED := 132.0
const SPRINT_SPEED := 186.0
const AIR_CONTROL := 0.55
const JUMP_SPEED := 405.0
const DOUBLE_JUMP_SPEED := 350.0
const JETPACK_FORCE := 2050.0
const JETPACK_MAX_RISE := 250.0
const JETPACK_FUEL := 100.0
const JETPACK_DRAIN := 26.0
const JETPACK_REFILL := 34.0
const SLIDE_SPEED := 260.0
const SLIDE_TIME := 0.55
const ROLL_SPEED := 205.0
const ROLL_TIME := 0.42
const CLIMB_SPEED := 92.0
const PLAYER_W := 16.0
const PLAYER_H := 62.0
const CROUCH_H := 34.0
const PRONE_H := 18.0
const RESPAWN_TIME := 3.2
const DBNO_TIME := 20.0
const REVIVE_TIME := 4.0

# --- الشبكة ---
const TICK_RATE := 30
const INTERP_DELAY := 0.1
const MAX_LAG_COMP := 0.2
const RECONNECT_GRACE := 60.0
const NET_PORT := 41980
const MAX_PLAYERS := 8
const MAX_COMBATANTS := 12

# --- إعدادات اللعب ---
var quality := 2                  # 0 منخفضة .. 3 قصوى
var fps_limit := 0                # 0 = غير محدود
var language := "ar"
var master_volume := 0.9
var music_volume := 0.55
var sfx_volume := 0.9
var voice_volume := 0.8
var vibration := true
var colorblind := "none"
var gyro_aim := false
var aim_assist := 0.35
var bot_count := 7
var difficulty := 2
var friendly_fire := false
var map_id := "oasis"
var mode_id := "dm"
var op_key := "rashid"
var player_name := "مقاتل"
var loadout: Array = ["jabha", "n9"]
var throwable := "grenade"
var stick_size := 62.0
var stick_alpha := 0.55
var button_alpha := 0.6
var claw_layout := 2
var joystick_mode := "floating"
var left_handed := false


func _ready() -> void:
	load_settings()


func load_settings() -> void:
	if not FileAccess.file_exists(PATH):
		return
	var f := FileAccess.open(PATH, FileAccess.READ)
	if not f:
		return
	var txt := f.get_as_text()
	f.close()
	var data: Variant = JSON.parse_string(txt)
	if typeof(data) != TYPE_DICTIONARY:
		return
	for k in data.keys():
		if k in self:
			set(k, data[k])


func save_settings() -> void:
	var data := {}
	for k in ["quality", "fps_limit", "language", "master_volume", "music_volume", "sfx_volume",
			"voice_volume", "vibration", "colorblind", "gyro_aim", "aim_assist", "bot_count",
			"difficulty", "friendly_fire", "map_id", "mode_id", "op_key", "player_name", "loadout",
			"throwable", "stick_size", "stick_alpha", "button_alpha", "claw_layout",
			"joystick_mode", "left_handed"]:
		data[k] = get(k)
	var f := FileAccess.open(PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data, "  "))
		f.close()


func apply_runtime() -> void:
	Engine.max_fps = fps_limit
	if quality == 0:
		RenderingServer.viewport_set_msaa_2d(get_viewport().get_viewport_rid(), RenderingServer.VIEWPORT_MSAA_DISABLED)
	# في المستوى المنخفض نُعطّل الإضاءة الديناميكية لتوفير البطارية
	var world := get_tree().get_first_node_in_group("world")
	if world and world.has_method("set_quality"):
		world.set_quality(quality)
