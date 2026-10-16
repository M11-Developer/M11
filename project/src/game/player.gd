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
	if not alive:
		respawn_timer += dt
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
	# ضرر السقوط
	if is_on_floor() and velocity.y == 0.0 and _fall_speed > 620.0:
		take_damage((_fall_speed - 620.0) * 0.12, null, {"fall": true})
	_fall_speed = velocity.y


var _fall_speed := 0.0


func _set_state(s: int) -> void:
	if anim_state != s:
		anim_state = s
		state_timer = 0.0
		queue_redraw()


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
	shoot_projectile(w)


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
	AudioBus.play_sfx("res://assets/audio/reload/%s.ogg" % String(w.get("cls", "ar")))


func _finish_reload() -> void:
	var w := weapon_def()
	weapons[slot]["ammo"] = int(w["mag"])
	reloading = false


func do_melee() -> void:
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
	global_position = pos
	hp = max_hp
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
