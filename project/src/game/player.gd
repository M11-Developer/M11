# ============================================================================
# اللاعب — نفس آلة الحالة في نسخة الويب (هيئة مشتركة مع البوتات):
# جيت باك بوقود، قفزة مزدوجة، التصاق حائط، انزلاق، تدحرج، انبطاح، سباحة،
# سلّم، تعلّق بالحافة، ضرر سقوط، إحياء، وطرح (DBNO).
#
# كل الأرقام من Config (نفس أرقام الويب) — الطرفان يتصرفان بنفس الشكل.
# ============================================================================
extends CharacterBody2D
class_name Actor

enum State { IDLE, WALK, RUN, SPRINT, JUMP, FALL, JETPACK, PRONE, CRAWL, SLIDE, ROLL,
	CLIMB, WALLJUMP, LEDGE, DBNO, DEAD, SWIM, DRIVE }

signal died(actor: Actor, killer: Actor, info: Dictionary)
signal damaged(actor: Actor, amount: float, info: Dictionary)

const JUMP_BUFFER := 0.12
const COYOTE_TIME := 0.1

@export var is_bot := false
@export var net_id := 0

var op_key := "rashid"
var display_name := "مقاتل"
var team := 0
var alive := true
var hp := 100.0
var max_hp := 100.0
var armor := 0.0
var armor_level := 0
var helmet_level := 0
var backpack_level := 1
var jet_fuel := Config.JETPACK_FUEL
var jetpack_on := false
var aim_angle := 0.0
var facing_x := 1.0
var crouching := false
var prone := false
var ads := false
var sliding := false
var rolling := false
var slide_timer := 0.0
var roll_timer := 0.0
var jump_buffer := 0.0
var coyote := 0.0
var air_jumps := 0
var on_wall := false
var on_ladder := false
var in_water := false
var dbno := false
var bleed_out := Config.DBNO_TIME
var revive_progress := 0.0
var respawn_timer := 0.0
var anim_state := State.IDLE
var state_timer := 0.0
var sprinting := false
var drive_target: Node = null
var damage_log: Array = []
var kills := 0
var deaths := 0
var assists := 0
var headshots := 0
var damage_dealt := 0.0
var shots_fired := 0
var shots_hit := 0
var longest_kill := 0.0
var revives := 0
var weapon_kills: Dictionary = {}
# أسلحة
var weapons: Array = [null, null]
var slot := 0
var ammo: Dictionary = {}
var heals := {"bandage": 2, "medkit": 1, "adrenaline": 0}
var throwable := {"id": "grenade", "count": 2}
var reloading := false
var reload_timer := 0.0
var fire_cooldown := 0.0
var burst_left := 0
var recoil_index := 0
var spread_state := 0.0
var spawn_protect := 1.6
var last_damage_time := -99.0
# --- عرض الشخصية (كانت الشخصيات غير مرئية إطلاقًا: لا يوجد _draw في هذا الملف)
var action_anim := ""
var action_time := 0.0
var action_total := 0.0
var hit_flash := 0.0
var muzzle_flash := 0.0
var death_timer := 0.0
var death_variant := 0

const ANIM_FOR_STATE := {
	State.IDLE: "idle", State.WALK: "walk", State.RUN: "run", State.SPRINT: "sprint",
	State.JUMP: "jump", State.FALL: "fall", State.JETPACK: "jetpack", State.PRONE: "prone",
	State.CRAWL: "crawl", State.SLIDE: "slide", State.ROLL: "roll", State.CLIMB: "climb",
	State.WALLJUMP: "walljump", State.LEDGE: "ledge", State.DBNO: "dbno", State.DEAD: "death0",
	State.SWIM: "swim", State.DRIVE: "drive",
}

# ملاحظة: النوع غير مُصرَّح به لتجنّب دورة تحليل مع GameWorld
var _world: Node2D
@onready var _shape := $CollisionShape2D


func setup(world: Node2D, data: Dictionary) -> void:
	_world = world
	display_name = data.get("name", display_name)
	team = int(data.get("team", 0))
	op_key = data.get("op_key", op_key)
	is_bot = bool(data.get("is_bot", false))
	net_id = int(data.get("net_id", randi() % 250))
	var start: Array = data.get("weapons", ["jabha", "n9"])
	for i in mini(start.size(), 2):
		give_weapon(String(start[i]), i)
	hp = max_hp
	armor = 0.0
	alive = true


func give_weapon(id: String, target_slot: int = -1) -> bool:
	var data: Dictionary = M11Data.WEAPONS.get(id, {})
	if data.is_empty():
		return false
	var s := target_slot
	if s < 0:
		s = 1 if weapons[0] != null else 0
	weapons[s] = {"id": id, "ammo": int(data["mag"]), "attachments": []}
	ammo[data["cls"]] = int(ammo.get(data["cls"], 0)) + int(data["mag"]) * 3
	if s == slot:
		queue_redraw()
	return true


func weapon_def() -> Dictionary:
	if weapons[slot] == null:
		return M11Data.WEAPONS.get("n9", {})
	return M11Data.WEAPONS.get(weapons[slot]["id"], {})


func weapon_ammo() -> int:
	if weapons[slot] == null:
		return 0
	return int(weapons[slot]["ammo"])


# ---------------------------------------------------------------- التحديث
func _physics_process(dt: float) -> void:
	if _world == null:
		return
	# كل شخصية ترسم نفسها — الترتيب حسب العمق حتى لا تتراكب الأجسام خطأً
	z_index = clampi(int(global_position.y / 6.0) + 10, 0, 4096)
	hit_flash = maxf(0.0, hit_flash - dt * 3.2)
	muzzle_flash = maxf(0.0, muzzle_flash - dt)
	if action_time > 0.0:
		action_time = maxf(0.0, action_time - dt)
	if not alive:
		death_timer += dt
		respawn_timer += dt
		queue_redraw()
		return
	var im: InputManager = _world.input_manager_get() if _world.input_manager == null else _world.input_manager
	var cmd: Dictionary = _bot_cmd
	if not is_bot:
		cmd = im.build_command() if im != null else {}
	update_with_command(dt, cmd)


var _bot_cmd: Dictionary = {}


func update_with_command(dt: float, cmd: Dictionary) -> void:
	if spawn_protect > 0.0:
		spawn_protect -= dt
	fire_cooldown = maxf(0.0, fire_cooldown - dt)
	jump_buffer = maxf(0.0, jump_buffer - dt)

	# --- الحالات الخاصة ---
	if dbno:
		bleed_out -= dt
		if bleed_out <= 0.0:
			die(null, {})
		return

	# --- القفز والجيت باك ---
	if cmd.get("jump", false):
		jump_buffer = JUMP_BUFFER
	if is_on_floor():
		coyote = COYOTE_TIME
		air_jumps = 1
		jet_fuel = minf(Config.JETPACK_FUEL, jet_fuel + Config.JETPACK_REFILL * dt)
	else:
		coyote = maxf(0.0, coyote - dt)
	var want_jet: bool = cmd.get("jet", false) or cmd.get("jump_held", false)
	jetpack_on = want_jet and jet_fuel > 0.0 and not is_on_floor()
	if jetpack_on:
		jet_fuel = maxf(0.0, jet_fuel - Config.JETPACK_DRAIN * dt)
		velocity.y = maxf(velocity.y - Config.JETPACK_FORCE * dt, -Config.JETPACK_MAX_RISE)
		_set_state(State.JETPACK)
	elif jump_buffer > 0.0:
		if is_on_floor() or coyote > 0.0:
			velocity.y = -Config.JUMP_SPEED
			jump_buffer = 0.0
			coyote = 0.0
		elif air_jumps > 0:
			velocity.y = -Config.DOUBLE_JUMP_SPEED
			air_jumps -= 1
			jump_buffer = 0.0

	# --- الحركة الأفقية ---
	var move_x: float = clampf(float(cmd.get("move_x", 0.0)), -1.0, 1.0)
	crouching = bool(cmd.get("crouch", false))
	if cmd.get("prone", false):
		prone = not prone
		crouching = false
	_update_height()
	var speed := Config.MOVE_SPEED
	sprinting = bool(cmd.get("sprint", false)) or (absf(move_x) > 0.65 and is_on_floor() and not prone and not crouching)
	if sprinting and not prone and not crouching:
		speed = Config.SPRINT_SPEED
	if prone:
		speed *= 0.22
	elif crouching:
		speed *= 0.6
	if ads:
		speed *= 0.62
	# انزلاق وتدحرج
	if cmd.get("roll", false) and is_on_floor() and not rolling and not prone:
		rolling = true
		roll_timer = Config.ROLL_TIME
		var dir := facing_x
		velocity.x = dir * Config.ROLL_SPEED
	if rolling:
		roll_timer -= dt
		if roll_timer <= 0.0:
			rolling = false
	elif sliding:
		slide_timer -= dt
		if slide_timer <= 0.0:
			sliding = false
	if not rolling and not sliding:
		var accel := 1500.0 if is_on_floor() else Config.AIR_CONTROL * 1400.0
		velocity.x = move_toward(velocity.x, move_x * speed, accel * dt)
		if absf(move_x) > 0.05:
			facing_x = signf(move_x)
	# ماء
	in_water = _world.get_tile(int(global_position.x / Config.TILE), int((global_position.y + 20.0) / Config.TILE)) == M11Tiles.WATER
	if in_water:
		velocity.x *= 0.82
		velocity.y = minf(velocity.y, 90.0)
	# سلّم
	on_ladder = _world.get_tile(int(global_position.x / Config.TILE), int(global_position.y / Config.TILE)) == M11Tiles.LADDER
	if on_ladder:
		velocity.y = float(cmd.get("move_y", 0.0)) * Config.CLIMB_SPEED
		_set_state(State.CLIMB)
	# جاذبية
	if not jetpack_on and not on_ladder:
		velocity.y = minf(velocity.y + Config.GRAVITY * dt, Config.MAX_FALL)
	# سباحة جوية
	if in_water:
		velocity.y = minf(velocity.y, 60.0)
	move_and_slide()
	# تصادم الحائط (Wall jump)
	on_wall = is_on_wall_only()
	if on_wall and not is_on_floor() and jump_buffer > 0.0:
		velocity.y = -Config.JUMP_SPEED * 0.92
		velocity.x = -facing_x * Config.SPRINT_SPEED * 0.9
		facing_x = -facing_x
		jump_buffer = 0.0
		_set_state(State.WALLJUMP)
	# حالة الرسم
	if not jetpack_on and not on_ladder:
		if is_on_floor():
			var spd := absf(velocity.x)
			_set_state(State.IDLE if spd < 8.0 else (State.SPRINT if sprinting else (State.RUN if spd > 120.0 else State.WALK)))
			if prone:
				_set_state(State.CRAWL if spd > 8.0 else State.PRONE)
			elif crouching:
				_set_state(State.IDLE)
			elif rolling:
				_set_state(State.ROLL)
			elif sliding:
				_set_state(State.SLIDE)
		else:
			_set_state(State.JUMP if velocity.y < 0.0 else State.FALL)
	state_timer += dt
	# التصويب
	if cmd.get("aim_active", false):
		var v: Vector2 = cmd.get("aim", Vector2.ZERO)
		if v.length() > 0.05:
			aim_angle = atan2(v.y, v.x)
		ads = bool(cmd.get("ads", false))
	else:
		ads = false
	if cmd.get("fire", false):
		try_fire()
	if cmd.get("reload", false):
		start_reload()
	if cmd.get("melee", false):
		do_melee()
	if cmd.get("heal", false):
		use_heal()
	if cmd.get("grenade", false):
		throw_grenade()
	if int(cmd.get("swap", 0)) > 0:
		slot = 1 - slot
		_set_action("switch", 0.28)
	# ضرر السقوط
	if is_on_floor() and velocity.y == 0.0 and _fall_speed > 620.0:
		take_damage((_fall_speed - 620.0) * 0.12, null, {"fall": true})
	_fall_speed = velocity.y
	queue_redraw()


var _fall_speed := 0.0


func _set_state(s: int) -> void:
	if anim_state != s:
		anim_state = s
		state_timer = 0.0
		queue_redraw()


func _set_action(anim: String, duration: float) -> void:
	action_anim = anim
	action_time = duration
	action_total = duration
	queue_redraw()


## قدمّا الجسم في إحداثيات العالم (نقطة الأصل هي أعلى الجسم — لا القدمين)
func feet() -> Vector2:
	return global_position + Vector2(0.0, body_height())


func body_height() -> float:
	if prone:
		return Config.PRONE_H
	if crouching:
		return Config.CROUCH_H
	return Config.PLAYER_H


func _update_height() -> void:
	var target := Config.PLAYER_H
	if prone:
		target = Config.PRONE_H
	elif crouching:
		target = Config.CROUCH_H
	if _shape:
		var rect := _shape.shape as RectangleShape2D
		if rect and absf(rect.size.y - target) > 0.5:
			rect.size.y = target
			_shape.position.y = target * 0.5


# ---------------------------------------------------------------- السلاح
func try_fire() -> void:
	if reloading or weapons[slot] == null or fire_cooldown > 0.0:
		return
	var w := weapon_def()
	var mag := weapon_ammo()
	if mag <= 0:
		start_reload()
		return
	match String(w.get("fire_mode", "semi")):
		"burst":
			if burst_left <= 0:
				burst_left = 3
		_:
			pass
	fire_cooldown = 60.0 / maxf(30.0, float(w["rpm"]))
	weapons[slot]["ammo"] = mag - 1
	shots_fired += 1
	recoil_index += 1
	muzzle_flash = 0.06
	shoot_projectile(w)
	queue_redraw()


func shoot_projectile(w: Dictionary) -> void:
	var pellets := int(w.get("pellets", 1))
	for i in pellets:
		var spread := deg_to_rad(float(w["spread"]) * (1.0 + recoil_index * 0.12))
		var jitter := randf_range(-spread, spread)
		var ang := aim_angle + jitter
		var speed := float(w.get("velocity", 900.0))
		_world.spawn_projectile({
			"owner": self, "pos": global_position + Vector2(facing_x * 10.0, -6.0),
			"velocity": Vector2(cos(ang), sin(ang)) * speed,
			"damage": float(w["damage"]), "damage_head": float(w["damage_head"]),
			"range": float(w["range"]), "penetration": int(w["penetration"]),
			"weapon_id": weapons[slot]["id"], "team": team,
		})
	AudioBus.play_weapon(String(w.get("cls", "ar")), global_position, _world.player_pos())


func start_reload() -> void:
	if reloading or weapons[slot] == null:
		return
	var w := weapon_def()
	var mag := int(w["mag"])
	if weapon_ammo() >= mag:
		return
	reloading = true
	reload_timer = float(w["reload"])
	_set_action("reload", float(w["reload"]))
	AudioBus.play_sfx("res://assets/audio/reload/%s.ogg" % String(w.get("cls", "ar")))


func _finish_reload() -> void:
	var w := weapon_def()
	weapons[slot]["ammo"] = int(w["mag"])
	reloading = false


func do_melee() -> void:
	_set_action("melee", 0.42)
	var mid := "shafra"
	if weapons[slot] != null and String(weapon_def().get("cls", "")) == "melee":
		mid = weapons[slot]["id"]
	var w: Dictionary = M11Data.WEAPONS.get(mid, {})
	var reach := float(w.get("range", 34.0))
	var hit_pos := global_position + Vector2(cos(aim_angle), sin(aim_angle)) * reach * 0.5
	for a in _world.actors:
		if a == self or not a.alive:
			continue
		if a.global_position.distance_to(hit_pos) <= reach * 0.9 + 12.0:
			a.take_damage(float(w.get("damage", 40.0)), self, {"melee": true, "weapon_id": mid})


func use_heal() -> void:
	if hp >= max_hp * 0.99:
		return
	_set_action("heal", 0.7)
	if int(heals["bandage"]) > 0:
		heals["bandage"] = int(heals["bandage"]) - 1
		heal(18.0, 2.0)
	elif int(heals["medkit"]) > 0:
		heals["medkit"] = int(heals["medkit"]) - 1
		heal(60.0, 4.0)


func heal(amount: float, _time: float = 0.0) -> void:
	hp = minf(max_hp, hp + amount)


func throw_grenade() -> void:
	if int(throwable["count"]) <= 0:
		return
	_set_action("throw", 0.5)
	throwable["count"] = int(throwable["count"]) - 1
	_world.spawn_projectile({
		"owner": self, "pos": global_position, "velocity": Vector2(cos(aim_angle - 0.35), sin(aim_angle - 0.35)) * 420.0,
		"kind": "grenade", "fuse": 3.0, "splash": 86.0, "damage": 105.0, "team": team,
	})


# ---------------------------------------------------------------- الضرر
func take_damage(amount: float, attacker: Actor, info: Dictionary = {}) -> void:
	if not alive or spawn_protect > 0.0 or amount <= 0.0:
		return
	var dmg := amount
	if bool(info.get("headshot", false)) and helmet_level > 0:
		dmg *= 1.0 - [0.0, 0.15, 0.25, 0.35][helmet_level]
	if armor > 0.0 and armor_level > 0:
		var absorb: float = dmg * [0.0, 0.3, 0.42, 0.55][armor_level]
		var taken := minf(armor, absorb)
		armor -= taken
		dmg -= taken
	hp -= dmg
	hit_flash = 0.25
	last_damage_time = _world.match_time
	if attacker and attacker != self:
		if not damage_log.has(attacker):
			damage_log.append(attacker)
	var info2 := info.duplicate()
	info2["attacker"] = attacker
	damaged.emit(self, dmg, info2)
	AudioBus.play_voice("pain", "f")
	if hp <= 0.0:
		die(attacker, info)
	queue_redraw()


func enter_dbno() -> bool:
	if dbno or not alive:
		return false
	dbno = true
	bleed_out = Config.DBNO_TIME
	_set_state(State.DBNO)
	# إسقاط نصف الغنائم
	return true


func die(killer: Actor, info: Dictionary) -> void:
	if not alive:
		return
	alive = false
	dbno = false
	deaths += 1
	death_timer = 0.0
	action_time = 0.0
	velocity = Vector2.ZERO
	_set_state(State.DEAD)
	respawn_timer = 0.0
	AudioBus.play_voice("death", "f")
	died.emit(self, killer, info)
	if killer and killer != self:
		killer.kills += 1
		# نقاط الفريق — أساس شرط نهاية المباراة وعرض النتيجة
		if _world and _world.has_method("register_kill"):
			_world.register_kill(int(killer.team))
		killer.damage_dealt += 0.0
		if info.has("weapon_id"):
			var wid := String(info["weapon_id"])
			killer.weapon_kills[wid] = int(killer.weapon_kills.get(wid, 0)) + 1
		if bool(info.get("headshot", false)):
			killer.headshots += 1
	# مساعدات
	for helper in damage_log:
		if helper != killer and helper != self and helper.alive:
			helper.assists += 1
	damage_log.clear()


func respawn_at(pos: Vector2) -> void:
	global_position = Vector2(pos.x, pos.y - Config.PLAYER_H)
	hp = max_hp
	death_timer = 0.0
	hit_flash = 0.0
	action_time = 0.0
	modulate = Color(1, 1, 1, 1)
	armor = [0.0, 40.0, 70.0, 100.0][armor_level]
	alive = true
	dbno = false
	revive_progress = 0.0
	jet_fuel = Config.JETPACK_FUEL
	spawn_protect = 1.6
	reloading = false
	prone = false
	crouching = false
	velocity = Vector2.ZERO
	_set_state(State.IDLE)
	_update_height()


func maybe_respawn(dt: float) -> bool:
	if alive:
		return false
	respawn_timer += dt
	if respawn_timer >= Config.RESPAWN_TIME:
		respawn_at(_world.pick_spawn_point(team))
		return true
	return false


# ============================================================================
# رسم المقاتل — كان هذا كاملًا مفقودًا في نسخة Godot: الشخصية والذراعان
# والسلاح لم تُرسم أبدًا (Actor لا يملك _draw)، فكان اللاعب يرى شاشة فارغة
# ومؤشر تصويب فقط. الآن الرسم يطابق نسخة الويب: إطار من أطلس المشغّل، نقطة
# ارتساء (origin/baseline)، ذراعان بزوايا مرسومة، وسلاح مثبّت على الكف.
# ============================================================================
func _char_meta() -> Dictionary:
	if _world != null and _world.get("char_meta") is Dictionary:
		return _world.char_meta
	return {}


func _anim_name() -> String:
	if not alive:
		return "death%d" % death_variant
	if dbno:
		return "dbno"
	if action_time > 0.0 and action_anim != "":
		return action_anim
	if in_water and not is_on_floor():
		return "swim"
	return String(ANIM_FOR_STATE.get(anim_state, "idle"))


func _frame_index(anim: String, frames: int, fps: float) -> int:
	var t := state_timer
	if action_time > 0.0 and anim == action_anim:
		t = action_total - action_time
	elif not alive:
		t = death_timer
	var fi := 0
	if action_time > 0.0 and anim == action_anim:
		fi = clampi(int((t / maxf(0.08, action_total)) * float(frames)), 0, frames - 1)
	elif not alive:
		fi = clampi(int(t * fps), 0, frames - 1)
	else:
		fi = int(t * fps) % maxi(1, frames)
	return fi


func _draw() -> void:
	if _world == null:
		return
	var meta := _char_meta()
	var origin: Array = meta.get("origin", [40, 42])
	var baseline := float(meta.get("baseline", 64.0))
	var bh := body_height()
	var feet_local := Vector2(0.0, bh)
	var flip := facing_x < 0.0
	# ---- الظل ----
	_draw_ellipse(feet_local + Vector2(0, -1), 14.0, 3.6, Color(0.02, 0.03, 0.04, 0.38))
	# ---- flame الجيت باك ----
	if jetpack_on:
		var fl := 6.0 + sin(Time.get_ticks_msec() * 0.03) * 3.0
		draw_colored_polygon(PackedVector2Array([
			feet_local + Vector2(-9, -6), feet_local + Vector2(9, -6), feet_local + Vector2(0, -6 + fl)
		]), Color(0.95, 0.6, 0.2, 0.75))
	# ---- إطار الشخصية ----
	var atlas := AtlasLoader.instance.get_atlas("char_" + op_key) if AtlasLoader.instance != null else null
	var anim := _anim_name()
	var anims: Dictionary = meta.get("anims", {})
	var info: Dictionary = anims.get(anim, {})
	var frames := int(info.get("frames", 1))
	var fps := float(info.get("fps", 12.0))
	if atlas != null:
		var probe := "%s/%s/0" % [op_key, anim]
		if not atlas.has_key(probe):
			match anim:
				"crawl": anim = "prone"
				"death0", "death1", "death2": anim = "death0"
				"swim": anim = "walk"
				_: anim = "idle"
			info = anims.get(anim, {})
			frames = int(info.get("frames", 1))
			fps = float(info.get("fps", 12.0))
			if not atlas.has_key("%s/%s/0" % [op_key, anim]):
				return
		var fi := _frame_index(anim, frames, fps)
		var key := "%s/%s/%d" % [op_key, anim, clampi(fi, 0, maxi(0, frames - 1))]
		var mod_col := Color(1, 1, 1, 1)
		if hit_flash > 0.0:
			mod_col = Color(1.0 + hit_flash * 2.4, 1.0 + hit_flash * 2.4, 1.0 + hit_flash * 2.4, 1.0)
		if spawn_protect > 0.0 and int(Time.get_ticks_msec() / 90) % 2 == 0:
			mod_col.a = 0.55
		atlas.draw_pivot(self, key, feet_local, Vector2(float(origin[0]), baseline), flip, mod_col)
		# ---- الذراعان + السلاح ----
		if alive and not dbno:
			_draw_arms_weapon(meta, feet_local, flip)
	# ---- بطاقة الاسم والصحة ----
	_draw_nameplate(bh)


func _nearest_angle(list: Array, deg: float) -> float:
	var best := float(list[0]) if not list.is_empty() else 0.0
	var bd := 1e9
	for a in list:
		var ang := float(a)
		var d: float = absf(ang - deg)
		if d > 180.0:
			d = 360.0 - d
		if d < bd:
			bd = d
			best = ang
	return best


func _draw_arms_weapon(meta: Dictionary, feet_local: Vector2, flip: bool) -> void:
	var arms := AtlasLoader.instance.get_atlas("arms") if AtlasLoader.instance != null else null
	if arms == null:
		return
	var origin: Array = meta.get("origin", [40, 42])
	var baseline := float(meta.get("baseline", 64.0))
	var posture := "jet" if jetpack_on else ("prone" if prone else ("crouch" if crouching else "stand"))
	var deg := rad_to_deg(aim_angle)
	var arm_deg := deg
	if flip:
		arm_deg = 180.0 - deg
		if arm_deg > 180.0:
			arm_deg -= 360.0
		if arm_deg < -180.0:
			arm_deg += 360.0
	var angles: Array = arms.meta.get("angles", [0, 15, 30, 45, 60, 90, 120, 135, 150, 165, 180, -15, -30, -45, -60, -90, -120, -135, -150, -165])
	var key_deg := _nearest_angle(angles, arm_deg)
	var arm_key := "%s/armframe/%s/%d" % [op_key, posture, int(key_deg)]
	if not arms.has_key(arm_key):
		arm_key = "%s/armframe/stand/%d" % [op_key, int(key_deg)]
	if not arms.has_key(arm_key):
		arm_key = "%s/armframe/stand/0" % op_key
	if arms.has_key(arm_key):
		arms.draw_pivot(self, arm_key, feet_local, Vector2(float(origin[0]), baseline), flip)
	# ---- موضع الكف ----
	var canvas_ox: float = float(origin[0]) if flip else -float(origin[0])
	var canvas_oy: float = feet_local.y - baseline
	var hand_anchor: Dictionary = meta.get("hand_anchor", {})
	var ha: Array = hand_anchor.get("%s/%d" % [posture, int(key_deg)], [])
	var hand := Vector2.ZERO
	if ha.size() >= 2:
		hand = Vector2(canvas_ox - float(ha[0]) if flip else canvas_ox + float(ha[0]), canvas_oy + float(ha[1]))
	else:
		var aa: Dictionary = meta.get("arm_anchor", {}).get(posture, {"x": 27.2, "y": 29.4, "reach": 11.4})
		hand = Vector2(canvas_ox + (-float(aa["x"]) if flip else float(aa["x"])), canvas_oy + float(aa["y"]))
	if weapons[slot] == null:
		return
	var wid := String(weapons[slot]["id"])
	var wdef: Dictionary = M11Data.WEAPONS.get(wid, {})
	if wdef.is_empty():
		return
	var wpn := AtlasLoader.instance.get_atlas("weapons") if AtlasLoader.instance != null else null
	if wpn == null:
		return
	var w_deg := deg
	var mirror := false
	if deg > 90.0 or deg < -90.0:
		w_deg = 180.0 - deg if deg > 90.0 else -180.0 - deg
		mirror = true
	var w_angles: Array = [0, 15, 30, 45, 60, 90, 135, 180, -15, -30, -45, -60, -90]
	var best := _nearest_angle(w_angles, w_deg)
	var wkey := "%s/%d" % [wid, int(best)]
	if not wpn.has_key(wkey):
		wkey = "%s/0" % wid
	var anc: Dictionary = wpn.anchors.get(wkey, {"grip": [8, 12], "muzzle": [30, 12], "len": 16})
	var grip: Array = anc.get("grip", [8, 12])
	var muzzle: Array = anc.get("muzzle", [30, 12])
	var wlen := float(anc.get("len", Vector2(float(muzzle[0]) - float(grip[0]), float(muzzle[1]) - float(grip[1])).length()))
	wpn.draw_pivot(self, wkey, hand, Vector2(float(grip[0]), float(grip[1])), mirror)
	# ---- وميض الفوهة ----
	if muzzle_flash > 0.0:
		var mdir := Vector2.RIGHT.rotated(aim_angle)
		var mpos := hand + mdir * maxf(6.0, wlen)
		draw_circle(mpos, 4.0, Color(1.0, 0.92, 0.55, 0.9))
		draw_circle(mpos, 2.0, Color(1, 1, 1, 0.95))


func _draw_nameplate(bh: float) -> void:
	var top := bh - float(_char_meta().get("baseline", 64.0)) - 8.0
	var team_col := M11UI.TEAL if team == 0 else M11UI.ORANGE
	if not alive:
		return
	var nm := display_name
	var fs := 8
	var w := maxf(26.0, M11UI.width(M11UI.FONT_BOLD, nm, fs) + 6.0)
	draw_rect(Rect2(-w * 0.5, top - 8, w, 10), Color(0.02, 0.03, 0.05, 0.55))
	M11UI.text(self, M11UI.FONT_BOLD, nm, Vector2(w * 0.5 - 3, top), fs, team_col,
		HORIZONTAL_ALIGNMENT_CENTER, w)
	# شريط صحة صغير فوق الرأس
	var pct := clampf(hp / maxf(1.0, max_hp), 0.0, 1.0)
	draw_rect(Rect2(-15, top + 3, 30, 3), Color(0.05, 0.06, 0.08, 0.8))
	draw_rect(Rect2(-15, top + 3, 30.0 * pct, 3), team_col if pct > 0.4 else M11UI.RED)


func _draw_ellipse(center: Vector2, rx: float, ry: float, col: Color) -> void:
	var pts := PackedVector2Array()
	for i in 18:
		var a := TAU * float(i) / 18.0
		pts.append(center + Vector2(cos(a) * rx, sin(a) * ry))
	draw_colored_polygon(pts, col)
