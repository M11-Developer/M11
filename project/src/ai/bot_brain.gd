# ============================================================================
# عقل البوت — يعمل بلا إنترنت (القسم 10).
# تنقّل: مشي + قفز + جيت باك عبر عقبات، تعلّق حافات، وصعود منصّات.
# قتال: وقت ردّ فعل، دقة مع خطأ، تصويب استباقي حسب سرعة الهدف، انسحاب،
#        قنابل، التقاط الغنائم، وإنعاش الأرفقاء.
# 5 مستويات صعوبة من M11Data.DIFFICULTY.
# ============================================================================
extends Node

var actor: Actor
var diff: Dictionary
var think_timer := 0.0
var reaction_timer := 0.0
var target: Actor = null
var last_seen_pos := Vector2.ZERO
var memory_timer := 0.0
var strafe_dir := 1
var strafe_timer := 1.0
var stuck_timer := 0.0
var climb_timer := 0.0
var stuck_dir := 1.0
var hunt_target: Actor = null
var last_pos := Vector2.ZERO
var jump_cooldown := 0.0
var grenade_cooldown := 8.0
var loot_target: Node2D = null
var patrol_target := Vector2.ZERO
var patrol_timer := 0.0
var wanders := 0
var aim_error := Vector2.ZERO


func _ready() -> void:
	actor = get_parent()
	diff = M11Data.DIFFICULTY[clampi(Config.difficulty, 0, 4)]
	patrol_target = actor.global_position
	# بذرة مستقلة لكل بوت حتى لا تتصرف كلها بنفس الشكل
	seed(hash(actor.net_id) + Time.get_ticks_msec())


func _physics_process(dt: float) -> void:
	if actor == null or not actor.alive:
		return
	think_timer -= dt
	jump_cooldown = maxf(0.0, jump_cooldown - dt)
	grenade_cooldown = maxf(0.0, grenade_cooldown - dt)
	reaction_timer = maxf(0.0, reaction_timer - dt)
	# كشف الأهداف (مع خط النظر)
	if think_timer <= 0.0:
		think_timer = 0.08 + randf() * 0.12
		_think()
	var cmd := _build_command(dt)
	actor.update_with_command(dt, cmd)


func _world() -> GameWorld:
	return actor.get_parent().get_parent() as GameWorld


func _think() -> void:
	var w := _world()
	if w == null:
		return
	var visible_enemy := _find_enemy(w)
	if visible_enemy:
		if target != visible_enemy:
			# أول مشاهدة: وقت ردّ فعل حسب الصعوبة
			reaction_timer = float(diff["reaction"])
		target = visible_enemy
		last_seen_pos = visible_enemy.global_position
		memory_timer = 3.0
	elif target and w.actors.has(target) and target.alive:
		memory_timer -= 0.1
		if memory_timer <= 0.0:
			target = null
	# انعطاف عشوائي للمناورة (كشف العلَق صار مسؤولية _apply_unstick وحدها)
	if randf() < 0.05:
		strafe_dir = -strafe_dir


func _find_enemy(w: GameWorld) -> Actor:
	var best: Actor = null
	var best_d := 1e9
	var max_d := 520.0 + float(diff["awareness"]) * 420.0
	for a in w.actors:
		if a == actor or not a.alive:
			continue
		if a.team == actor.team and not Config.friendly_fire:
			continue
		var d := actor.global_position.distance_to(a.global_position)
		if d > max_d:
			continue
		if d < best_d and _has_los(w, a.global_position):
			best_d = d
			best = a
	return best


func _has_los(w: GameWorld, to: Vector2) -> bool:
	var from := actor.global_position + Vector2(0, -20)
	var steps := int(from.distance_to(to) / 10.0)
	for i in steps:
		var p := from.lerp(to + Vector2(0, -20), float(i) / maxf(1.0, steps))
		if w.is_solid_at(p):
			return false
	return true


func _build_command(dt: float) -> Dictionary:
	var cmd := {
		"move_x": 0.0, "move_y": 0.0, "jump": false, "jump_held": false, "jet": false,
		"fire": false, "ads": false, "aim": Vector2.ZERO, "aim_active": false,
		"reload": false, "crouch": false, "prone": false, "melee": false, "roll": false,
		"slide": false, "grenade": false, "heal": false, "interact": false, "ping": false,
		"swap": 0, "sprint": false,
	}
	# إنعاش زميل مُطرح أولوية
	var w := _world()
	var downed := _find_downed(w)
	if downed and downed.global_position.distance_to(actor.global_position) < 60.0:
		downed.revive_progress += dt / Config.REVIVE_TIME
		if downed.revive_progress >= 1.0:
			downed.dbno = false
			downed.revive_progress = 0.0
			downed.hp = 45.0
			downed.alive = true
			actor.revives += 1
		return _apply_unstick(cmd, dt)
	var target_pos := target.global_position if target else last_seen_pos
	var to_target := target_pos - actor.global_position
	var dist := to_target.length()
	# إعادة تعبئة عند الحاجة
	if actor.weapon_ammo() <= 0:
		cmd["reload"] = true
	if target and reaction_timer <= 0.0:
		# تصويب استباقي: نضيف سرعة الهدف × زمن الطلقة
		var bullet_time := dist / maxf(200.0, float(actor.weapon_def().get("velocity", 900.0)))
		var lead := target.velocity * bullet_time * float(diff["accuracy"])
		var aim_point := target_pos - Vector2(0, 22) + lead
		# خطأ دقة عشوائي يتغيّر ببطء
		if randf() < 0.15:
			aim_error = Vector2(randf_range(-1, 1), randf_range(-1, 1)) * (1.0 - float(diff["accuracy"])) * 46.0
		var aim_vec := (aim_point + aim_error - actor.global_position).normalized()
		cmd["aim"] = aim_vec
		cmd["aim_active"] = true
		cmd["fire"] = dist < float(actor.weapon_def().get("range", 800.0))
		if dist < 60.0:
			cmd["melee"] = true
		# انسحاب عند الصحة المنخفضة
		if actor.hp < 35.0 and randf() < 0.02:
			cmd["heal"] = true
		# مناورة جانبية
		strafe_timer -= dt
		if strafe_timer <= 0.0:
			strafe_timer = randf_range(0.6, 1.6)
			strafe_dir = -strafe_dir
		cmd["move_x"] = strafe_dir * (0.6 if dist < 300.0 else 0.2)
		# قنبلة على تجمّع (احتمال بسيط)
		if grenade_cooldown <= 0.0 and dist > 90.0 and dist < 260.0 and randf() < 0.01:
			cmd["grenade"] = true
			grenade_cooldown = 14.0
		return _apply_unstick(cmd, dt)
	# لا هدف مرئي: نطارد أقرب عدو (نفس إصلاح نسخة الويب — يمنع مباريات بلا اشتباك)
	hunt_target = w.nearest_hostile(actor) if w else null
	if hunt_target != null:
		var hx: float = hunt_target.global_position.x - actor.global_position.x
		var hy: float = hunt_target.global_position.y - actor.global_position.y
		cmd["move_x"] = clampf(hx / 60.0, -1.0, 1.0)
		cmd["sprint"] = true
		cmd["aim"] = Vector2(signf(hx) if absf(hx) > 4.0 else actor.facing_x, 0)
		cmd["aim_active"] = true
		if hy < -46.0 and actor.is_on_floor() and actor.jet_fuel > 12.0:
			cmd["jet"] = true          # العدو أعلى → جيت باك
		return _apply_unstick(cmd, dt)
	# لا عدو على الخريطة؟ دورية + جيت باك لعبور العقبات + التقاط الغنائم
	patrol_timer -= dt
	if patrol_timer <= 0.0 or actor.global_position.distance_to(patrol_target) < 30.0:
		patrol_timer = randf_range(2.0, 5.0)
		var w2 := _world()
		if w2:
			patrol_target = Vector2(randf_range(80, w2.map_w * Config.TILE - 80), actor.global_position.y)
	patrol_target.y = actor.global_position.y
	var dir := (patrol_target - actor.global_position)
	cmd["move_x"] = clampf(dir.x / 60.0, -1.0, 1.0)
	cmd["sprint"] = true
	cmd["aim"] = Vector2(actor.facing_x, 0)
	cmd["aim_active"] = true
	# عقبة أمامه؟ اقفز أو شغّل الجيت باك
	var ahead := actor.global_position + Vector2(actor.facing_x * 20.0, -6.0)
	var below_ahead := ahead + Vector2(0, 30)
	var w3 := _world()
	if w3:
		if w3.is_solid_at(ahead) and actor.is_on_floor() and jump_cooldown <= 0.0:
			cmd["jump"] = true
			jump_cooldown = 0.6
		elif not w3.is_solid_at(below_ahead) and not actor.is_on_floor():
			cmd["jet"] = true
	return _apply_unstick(cmd, dt)


func _apply_unstick(cmd: Dictionary, dt: float) -> Dictionary:
	# معالج العلَق المشترك: قفزة ← جيت باك (تجاوز الجدار) ← انعكاس الاتجاه.
	# يعمل في كل الحالات وحتى إن لم يكن البوت على الأرض — نفس إصلاح نسخة الويب.
	if climb_timer > 0.0:
		climb_timer -= dt
		cmd["jet"] = true
		cmd["move_x"] = 0.0
		if climb_timer <= 0.0:
			cmd["move_x"] = stuck_dir
		return cmd
	var moving_intent := absf(float(cmd["move_x"])) > 0.25
	var moved := actor.global_position.distance_to(last_pos)
	last_pos = actor.global_position
	if moving_intent and moved < 0.6:
		stuck_timer += dt
	else:
		stuck_timer = maxf(0.0, stuck_timer - dt * 2.0)
	if stuck_timer > 0.35:
		cmd["jump"] = true
	if stuck_timer > 0.95:
		climb_timer = 0.8
		stuck_dir = signf(hunt_target.global_position.x - actor.global_position.x) if hunt_target != null else -signf(float(cmd["move_x"]) if absf(float(cmd["move_x"])) > 0.1 else 1.0)
		if stuck_dir == 0.0:
			stuck_dir = 1.0
		stuck_timer = 0.0
	return cmd


func _find_downed(w: GameWorld) -> Actor:
	if w == null:
		return null
	for a in w.actors:
		if a != actor and a.dbno and a.team == actor.team:
			return a
	return null
