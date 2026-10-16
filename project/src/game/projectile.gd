# ============================================================================
# المقذوفات — رصاص، قنابل، شعلات، صواريخ. تُحاكى بخطوات فرعية (Substeps)
# حتى لا تتخطّى الأجسام الصغيرة عند السرعات العالية.
# ============================================================================
extends Node2D
class_name Projectile

# ملاحظة: النوع غير مُصرَّح به لتجنّب دورة تحليل مع GameWorld
var world: Node2D
var owner_actor: Node2D
var team := 0
var weapon_id := ""
var damage := 10.0
var damage_head := 15.0
var max_range := 900.0
var penetration := 0
var velocity := Vector2.ZERO
var kind := "bullet"          # bullet | grenade | flare | rocket
var gravity := false
var bounce := 0.0
var fuse := 0.0
var splash := 0.0
var travelled := 0.0
var life := 4.0
var active := true
const STEP := 6.0


func setup(w: Node2D, data: Dictionary) -> void:
	world = w
	owner_actor = data.get("owner", null)
	team = int(data.get("team", 0))
	weapon_id = String(data.get("weapon_id", ""))
	damage = float(data.get("damage", 10.0))
	damage_head = float(data.get("damage_head", damage * 1.5))
	max_range = float(data.get("range", 900.0))
	penetration = int(data.get("penetration", 0))
	velocity = data.get("velocity", Vector2.RIGHT * 900.0)
	kind = String(data.get("kind", "bullet"))
	gravity = kind in ["grenade", "rocket"]
	bounce = float(data.get("bounce", 0.0))
	fuse = float(data.get("fuse", 0.0))
	splash = float(data.get("splash", 0.0))
	global_position = data.get("pos", Vector2.ZERO)
	z_index = 5


func _physics_process(dt: float) -> void:
	if not active:
		queue_free()
		return
	life -= dt
	if gravity:
		velocity.y += Config.GRAVITY * 0.55 * dt
	var remaining := velocity.length() * dt
	var dir := velocity.normalized() if velocity.length() > 0.001 else Vector2.ZERO
	while remaining > 0.0:
		var step_len := minf(STEP, remaining)
		remaining -= step_len
		var next := global_position + dir * step_len
		travelled += step_len
		# اصطدام بالتضاريس
		if world.is_solid_at(next):
			if bounce > 0.0 or kind == "grenade":
				# ارتداد على المحور الأقل اختراقًا
				var test_x := Vector2(next.x, global_position.y)
				if world.is_solid_at(test_x):
					velocity.x *= -0.55
				else:
					velocity.y *= -0.55
				dir = velocity.normalized()
				break
			if kind in ["grenade", "rocket"]:
				_explode()
				return
			world.damage_tile(int(next.x / Config.TILE), int(next.y / Config.TILE), damage * 0.4)
			active = false
			queue_free()
			return
		global_position = next
		# إصابة المقاتلين
		for a in world.actors:
			if a == owner_actor or not a.alive:
				continue
			if a.team == team and not Config.friendly_fire:
				continue
			var body_rect := Rect2(a.global_position + Vector2(-8, -30), Vector2(16, 30))
			var head_rect := Rect2(a.global_position + Vector2(-6, -60), Vector2(12, 12))
			if body_rect.has_point(global_position) or head_rect.has_point(global_position):
				var head := head_rect.has_point(global_position)
				var dealt := damage_head if head else damage
				a.take_damage(dealt, owner_actor, {"weapon_id": weapon_id, "headshot": head})
				if owner_actor:
					owner_actor.shots_hit += 1
					owner_actor.damage_dealt += dealt
				if kind in ["grenade", "rocket"]:
					_explode()
					return
				penetration -= 1
				if penetration < 0:
					active = false
					queue_free()
					return
		if travelled >= max_range:
			active = false
			queue_free()
			return
	if fuse > 0.0:
		fuse -= dt
		if fuse <= 0.0:
			_explode()
			return
	if life <= 0.0:
		if kind in ["grenade", "rocket"]:
			_explode()
		else:
			active = false
			queue_free()


func _explode() -> void:
	active = false
	var radius := splash if splash > 0.0 else 60.0
	world.explode(global_position, radius, damage)
	for a in world.actors:
		if not a.alive:
			continue
		var d := a.global_position.distance_to(global_position)
		if d <= radius:
			if a.team == team and a != owner_actor and not Config.friendly_fire:
				continue
			var falloff := 1.0 - clampf(d / radius, 0.0, 1.0)
			a.take_damage(damage * pow(falloff, 0.85), owner_actor, {"weapon_id": weapon_id, "grenade": kind == "grenade"})
			a.velocity += (a.global_position - global_position).normalized() * 240.0 * falloff
	AudioBus.play_at("res://assets/audio/explosions/%s.ogg" % ("big" if radius > 100.0 else "grenade"),
		global_position, world.player_pos())
	queue_free()


func _draw() -> void:
	if kind == "bullet":
		draw_rect(Rect2(-1, -0.5, 3, 1), Color(1.0, 0.95, 0.7))
	elif kind == "grenade":
		draw_rect(Rect2(-2, -3, 4, 6), Color(0.29, 0.32, 0.25))
	else:
		draw_circle(Vector2.ZERO, 4.0, Color(1.0, 0.7, 0.28))
