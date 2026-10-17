# ============================================================================
# التحكم — عصا مزدوجة لمس + كيبورد/فأرة + يد تحكم، مع كل خيارات القسم 11.
# يُنتج "أمر" (Dictionary) يُستهلك في Player.update(cmd, dt) — نفس واجهة البوتات.
# ============================================================================
extends Node
class_name InputManager

const DEADZONE := 0.18

var move_stick := {"active": false, "id": -1, "origin": Vector2.ZERO, "pos": Vector2.ZERO, "vec": Vector2.ZERO}
var aim_stick := {"active": false, "id": -1, "origin": Vector2.ZERO, "pos": Vector2.ZERO, "vec": Vector2.ZERO}
var buttons: Dictionary = {}          # name -> Rect2 (بإحداثيات 480×270)
var button_state: Dictionary = {}
var ads_toggled := false
var view_size := Vector2(480, 270)
var player_ref: Node2D = null     # يُضبط من main.gd — لتصويب الماوس على الكمبيوتر
var _wheel_swap := 0              # تبديل السلاح بعجلة الماوس (PC)


func _ready() -> void:
	# نقرأ الحجم الحقيقي المعروض (قد يكون أعرض من 16:9 على الهواتف الطويلة)
	# حتى تبقى الأزرار ملتصقة بزوايا الشاشة فعلًا بدل أن تتجمّع في المنتصف.
	_sync_view_size()
	rebuild_buttons()
	get_viewport().size_changed.connect(_on_viewport_resized)


func _sync_view_size() -> void:
	var vp := get_viewport()
	if vp == null:
		view_size = Vector2(Config.INTERNAL_W, Config.INTERNAL_H)
		return
	var r := vp.get_visible_rect().size
	if r.x > 1.0 and r.y > 1.0:
		view_size = r


func _on_viewport_resized() -> void:
	_sync_view_size()
	rebuild_buttons()


func rebuild_buttons() -> void:
	_sync_view_size()
	buttons.clear()
	var S := Config.stick_size
	var right_x := view_size.x - 86.0
	var r := 21.0
	if Config.left_handed:
		right_x = 86.0
	buttons["fire"] = _circle(Vector2(right_x, view_size.y - 58.0), r + 4.0)
	buttons["jump"] = _circle(Vector2(right_x - 44.0, view_size.y - 34.0), r - 2.0)
	buttons["jetpack"] = _circle(Vector2(right_x + 6.0, view_size.y - 104.0), r - 4.0)
	buttons["reload"] = _circle(Vector2(right_x - 50.0, view_size.y - 90.0), r - 5.0)
	buttons["crouch"] = _circle(Vector2(right_x + 42.0, view_size.y - 40.0), r - 6.0)
	buttons["prone"] = _circle(Vector2(right_x + 72.0, view_size.y - 66.0), r - 6.0)
	buttons["melee"] = _circle(Vector2(right_x + 54.0, view_size.y - 104.0), r - 6.0)
	buttons["heal"] = _circle(Vector2(right_x + 72.0, view_size.y - 18.0), r - 7.0)
	buttons["grenade"] = _circle(Vector2(right_x - 72.0, view_size.y - 18.0), r - 7.0)
	buttons["swap"] = _circle(Vector2(right_x - 86.0, view_size.y - 58.0), r - 8.0)
	if Config.claw_layout >= 3:
		buttons["fire2"] = _circle(Vector2(right_x - 10.0, 40.0), r - 3.0)
		buttons["jump2"] = _circle(Vector2(right_x - 60.0, 34.0), r - 5.0)
	if Config.claw_layout >= 4:
		buttons["fire3"] = _circle(Vector2(right_x + 42.0, 54.0), r - 5.0)
		buttons["melee2"] = _circle(Vector2(right_x - 104.0, 40.0), r - 6.0)


func _circle(center: Vector2, radius: float) -> Rect2:
	return Rect2(center - Vector2(radius, radius), Vector2(radius * 2.0, radius * 2.0))


func _desktop() -> bool:
	return DisplayServer.is_touchscreen_available() == false and (
		OS.has_feature("pc") or OS.has_feature("windows") or OS.has_feature("linuxbsd"))


func _input(event: InputEvent) -> void:
	# عجلة الماوس: تبديل سريع بين السلاحين (نسخة الكمبيوتر)
	if event is InputEventMouseButton and event.pressed and _desktop():
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_wheel_swap = 1
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_wheel_swap = -1
	if event is InputEventScreenTouch:
		var pos: Vector2 = event.position * (view_size / get_viewport().get_visible_rect().size)
		if event.pressed:
			_on_touch_down(event.index, pos)
		else:
			_on_touch_up(event.index)
	elif event is InputEventScreenDrag:
		var pos: Vector2 = event.position * (view_size / get_viewport().get_visible_rect().size)
		_on_touch_move(event.index, pos)


func _on_touch_down(id: int, pos: Vector2) -> void:
	for name in buttons.keys():
		if (buttons[name] as Rect2).has_point(pos):
			button_state[name] = true
			return
	if pos.x < view_size.x * 0.5 and not move_stick["active"]:
		move_stick["active"] = true
		move_stick["id"] = id
		move_stick["origin"] = pos if Config.joystick_mode == "floating" else Vector2(76, view_size.y - 76)
		move_stick["pos"] = pos
	elif not aim_stick["active"]:
		aim_stick["active"] = true
		aim_stick["id"] = id
		aim_stick["origin"] = pos if Config.joystick_mode == "floating" else Vector2(view_size.x - 76, view_size.y - 76)
		aim_stick["pos"] = pos


func _on_touch_move(id: int, pos: Vector2) -> void:
	if move_stick["active"] and move_stick["id"] == id:
		move_stick["pos"] = pos
	elif aim_stick["active"] and aim_stick["id"] == id:
		aim_stick["pos"] = pos


func _on_touch_up(id: int) -> void:
	if move_stick["id"] == id:
		move_stick["active"] = false
		move_stick["id"] = -1
		move_stick["vec"] = Vector2.ZERO
	if aim_stick["id"] == id:
		aim_stick["active"] = false
		aim_stick["id"] = -1
		aim_stick["vec"] = Vector2.ZERO
	# أزرار مرفوعة
	for name in button_state.keys():
		if button_state[name]:
			button_state[name] = false


func _process(_dt: float) -> void:
	# حساب متجهات العصي
	for stick in [move_stick, aim_stick]:
		if stick["active"]:
			var d: Vector2 = stick["pos"] - stick["origin"]
			var r := Config.stick_size * 0.5
			if d.length() > r:
				d = d.normalized() * r
			stick["vec"] = d / r
			if stick["vec"].length() < DEADZONE:
				stick["vec"] = Vector2.ZERO
		else:
			stick["vec"] = Vector2.ZERO
	# جيروسكوب
	if Config.gyro_aim and Input.has_method("get_gyroscope"):
		var g := Input.get_gyroscope()
		aim_stick["vec"] += Vector2(-g.y, g.x) * 0.02


# --------------------------------------------------------------------------
# يبني أمر اللعب لهذا الإطار (نفس صيغة البوتات)
# --------------------------------------------------------------------------
func build_command() -> Dictionary:
	var cmd := {
		"move_x": 0.0, "move_y": 0.0, "jump": false, "jump_held": false, "jet": false,
		"fire": false, "ads": false, "aim": Vector2.ZERO, "aim_active": false,
		"reload": false, "crouch": false, "prone": false, "melee": false, "roll": false,
		"slide": false, "grenade": false, "heal": false, "interact": false, "ping": false,
		"swap": 0, "sprint": false, "sprint_active": false,
	}
	# لوحة المفاتيح
	cmd["move_x"] = Input.get_axis("move_left", "move_right")
	if Input.is_action_pressed("jet"):
		cmd["jet"] = true
	if Input.is_action_just_pressed("jump"):
		cmd["jump"] = true
	if Input.is_action_pressed("jump"):
		cmd["jump_held"] = true
	if Input.is_action_pressed("fire"):
		cmd["fire"] = true
	if Input.is_action_pressed("ads"):
		cmd["ads"] = true
		cmd["aim_active"] = true
	if Input.is_action_just_pressed("reload"):
		cmd["reload"] = true
	if Input.is_action_just_pressed("melee"):
		cmd["melee"] = true
	if Input.is_action_just_pressed("grenade"):
		cmd["grenade"] = true
	if Input.is_action_just_pressed("heal"):
		cmd["heal"] = true
	if Input.is_action_just_pressed("crouch"):
		cmd["crouch"] = true
	if Input.is_action_just_pressed("prone"):
		cmd["prone"] = true
	if Input.is_action_just_pressed("roll"):
		cmd["roll"] = true
	if Input.is_action_pressed("sprint"):
		cmd["sprint"] = true
	if Input.is_action_just_pressed("swap"):
		cmd["swap"] = 1
	# --- الكمبيوتر: التصويب بالماوس (مباشرة نحو المؤشر) ---
	if _desktop() and player_ref != null and is_instance_valid(player_ref):
		var target: Vector2 = player_ref.get_global_mouse_position()
		var d: Vector2 = target - player_ref.global_position
		if d.length() > 6.0:
			cmd["aim"] = d.normalized()
			cmd["aim_active"] = true
	if _wheel_swap != 0:
		cmd["swap"] = 1 if _wheel_swap > 0 else -1
		_wheel_swap = 0
	# اللمس
	cmd["move_x"] += move_stick["vec"].x
	cmd["move_y"] = move_stick["vec"].y
	if aim_stick["active"] and aim_stick["vec"].length() > 0.22:
		cmd["aim"] = aim_stick["vec"].normalized()
		cmd["aim_active"] = true
		if Config.aim_assist > 0.0 or true:
			cmd["fire"] = true
	for name in button_state.keys():
		if not button_state[name]:
			continue
		match name:
			"fire", "fire2", "fire3":
				cmd["fire"] = true
			"jump", "jump2":
				cmd["jump"] = true
				cmd["jump_held"] = true
			"jetpack":
				cmd["jet"] = true
			"reload":
				cmd["reload"] = true
			"crouch":
				cmd["crouch"] = true
			"prone":
				cmd["prone"] = true
			"melee", "melee2":
				cmd["melee"] = true
			"grenade":
				cmd["grenade"] = true
			"heal":
				cmd["heal"] = true
			"swap":
				cmd["swap"] = 1
	return cmd


func vibrate(ms: int = 14) -> void:
	if Config.vibration:
		Input.vibrate_handheld(ms)
