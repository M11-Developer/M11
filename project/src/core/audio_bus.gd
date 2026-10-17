# ============================================================================
# نظام الصوت — قنوات منفصلة، صوت موضعي، وحاجز ترددات عند وجود جدار.
# ملفات OGG/Vorbis المُولّدة في assets/audio/**.
# ============================================================================
extends Node

const SFX_POOL_SIZE := 24
const OCCLUSION_LOWPASS := 900.0     # هرتز عند وجود عائق
const NORMAL_LOWPASS := 20000.0
const WEAPON_DISTANCES := ["near", "mid", "far"]

var _pool: Array[AudioStreamPlayer] = []
var _pool2d: Array[AudioStreamPlayer2D] = []
var _music: AudioStreamPlayer
var _ambience: AudioStreamPlayer
var _cache: Dictionary = {}
var _next: int = 0
var _next2d: int = 0

var master_db: float = 0.0
var music_db: float = -4.0
var sfx_db: float = 0.0


func _ready() -> void:
	for i in SFX_POOL_SIZE:
		var p := AudioStreamPlayer.new()
		p.bus = "SFX"
		add_child(p)
		_pool.append(p)
		var p2 := AudioStreamPlayer2D.new()
		p2.bus = "SFX"
		p2.max_distance = 1400.0
		p2.attenuation = 0.9
		add_child(p2)
		_pool2d.append(p2)
	_music = AudioStreamPlayer.new()
	_music.bus = "Music"
	add_child(_music)
	_ambience = AudioStreamPlayer.new()
	_ambience.bus = "Ambience"
	_ambience.volume_db = -10.0
	add_child(_ambience)
	_apply_bus_volumes()


func _apply_bus_volumes() -> void:
	set_bus("Master", Config.master_volume)
	set_bus("Music", Config.music_volume)
	set_bus("SFX", Config.sfx_volume)
	set_bus("Voice", Config.voice_volume)


func set_bus(bus_name: String, linear: float) -> void:
	var idx := AudioServer.get_bus_index(bus_name)
	if idx >= 0:
		AudioServer.set_bus_volume_db(idx, linear_to_db(clampf(linear, 0.0001, 1.0)))
		AudioServer.set_bus_mute(idx, linear <= 0.001)


func load_stream(path: String) -> AudioStream:
	if _cache.has(path):
		return _cache[path]
	var stream: AudioStream = null
	if ResourceLoader.exists(path):
		stream = load(path)
	_cache[path] = stream
	return stream


func play_ui(kind: String = "click") -> void:
	play_sfx("res://assets/audio/ui/%s.ogg" % kind)


func play_sfx(path: String, pitch: float = 1.0) -> void:
	var stream := load_stream(path)
	if stream == null:
		return
	var p := _pool[_next]
	_next = (_next + 1) % SFX_POOL_SIZE
	p.stream = stream
	p.pitch_scale = pitch
	p.play()


func play_at(path: String, world_pos: Vector2, listener_pos: Vector2, occluded: bool = false) -> void:
	var stream := load_stream(path)
	if stream == null:
		return
	var p := _pool2d[_next2d]
	_next2d = (_next2d + 1) % SFX_POOL_SIZE
	p.stream = stream
	p.global_position = world_pos
	# كتم ترددات عند وجود حاجز (Low-pass) — القسم 12
	p.bus = "SFX_Occluded" if occluded else "SFX"
	p.play()


func play_weapon(cls: String, world_pos: Vector2, listener_pos: Vector2) -> void:
	# صوت ثلاثي الطبقات حسب المسافة (near/mid/far) — القسم 6
	var d := world_pos.distance_to(listener_pos)
	var band := "near" if d < 260.0 else ("mid" if d < 700.0 else "far")
	var path := "res://assets/audio/weapons/%s_%s.ogg" % [cls, band]
	play_at(path, world_pos, listener_pos)


func play_footstep(material: String, world_pos: Vector2, listener_pos: Vector2) -> void:
	var i := randi() % 3
	play_at("res://assets/audio/footsteps/%s_%d.ogg" % [material, i], world_pos, listener_pos)


func play_music(track: String, fade: float = 0.6) -> void:
	var path := "res://assets/audio/music/%s.ogg" % track
	var stream := load_stream(path)
	if stream == null or _music.stream == stream:
		return
	var tw := create_tween()
	tw.tween_property(_music, "volume_db", -30.0, fade)
	tw.tween_callback(func() -> void:
		_music.stream = stream
		_music.play())
	tw.tween_property(_music, "volume_db", music_db, fade)


func play_ambience(kind: String) -> void:
	var stream := load_stream("res://assets/audio/ambience/%s.ogg" % kind)
	if stream and _ambience.stream != stream:
		_ambience.stream = stream
		_ambience.play()


func play_voice(kind: String, gender: String) -> void:
	var voice := "male_mid"
	match gender:
		"f":
			voice = "female_mid"
		_:
			voice = "male_low" if kind == "death" else "male_mid"
	play_sfx("res://assets/audio/voices/%s_%s.ogg" % [voice, kind])
