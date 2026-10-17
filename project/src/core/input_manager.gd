# ============================================================================
# التحكم — عصا مزدوجة لمس + كيبورد/فأرة + يد تحكم.
#
# إصلاحات جوهرية في هذه النسخة:
#  • كان كل «رفع إصبع» يمسح حالة **كل** الأزرار ⇒ لو رفعت إصبع التصويب يتوقف
#    الإطلاق. الآن كل لمسة تعرف الزر الذي تتحكم به وتحرره وحده.
#  • كانت عصا التصويب تُطلق الرصاص تلقائيًا (وبلا توقف) ⇒ صار الإطلاق بيد
#    زر الإطلاق أو الزر الأيسر للفأرة، مع خيار «إطلاق تلقائي» في الإعدادات.
#  • أزرار القفز/التعبئة/القنبلة/العلاج صارت «حدَثية» (مرة لكل ضغطة)، فلم يعد
#    الإمساك بزر القفز يمنح قفزات لا نهائية.
#  • التخطيط أُعيد ترتيبه حول زر إطلاق كبير مع مسافات محسوبة بين كل زرين
#    (كانت ١٠ دوائر متداخلة فوق بعضها في زاوية واحدة).
# ============================================================================
extends Node
class_name InputManager

const DEADZONE := 0.18

var move_stick := {"active": false, "id": -1, "origin": Vector2.ZERO, "pos": Vector2.ZERO, "vec": Vector2.ZERO}
var aim_stick := {"active": false, "id": -1, "origin": Vector2.ZERO, "pos": Vector2.ZERO, "vec": Vector2.ZERO}
var buttons: Dictionary = {}          # name -> Rect2 (إحداثيات القماش)
var button_radius: Dictionary = {}    # name -> نصف القطر (للرسم واللمس الدائري)
var button_state: Dictionary = {}     # name -> مضغوط حاليًا
var just_pressed: Dictionary = {}     # name -> ضغطة جديدة (تُستهلك)
var view_size := Vector2(640, 360)
var player_ref: Node2D = null
var _wheel_swap := 0
var _touch_button: Dictionary = {}    # فهرس اللمسة -> اسم الزر
var _aim_zone_rect := Rect2()

const LABELS := {
	"fire": "إطلاق", "jump": "قفز", "jetpack": "جيت", "reload": "تعبئة",
	"crouch": "انخفاض", "prone": "انبطاح", "melee": "ضربة", "heal": "علاج",
	"grenade": "قنبلة", "swap": "سلاح", "pause": "❚❚", "score": "☰",
	"fire2": "إطلاق", "jump2": "قفز", "fire3": "إطلاق", "melee2": "ضربة",
}


func _ready() -> void:
	_sync_view_size()
	rebuild_buttons()
	var vp := get_viewport()
	if vp != null and not vp.size_changed.is_connected(_on_viewport_resized):
		vp.size_changed.connect(_on_viewport_resized)


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


func _c(center: Vector2, r: float) -> Rect2:
	return Rect2(center - Vector2(r, r), Vector2(r * 2.0, r * 2.0))


func _add(name: String, center: Vector2, r: float) -> void:
	var c := center
	if Config.left_handed:
		c.x = view_size.x - center.x
	buttons[name] = _c(c, r)
	button_radius[name] = r


## تخطيط واحد مرسوم ومُلموس (مصدر حقيقة واحد) — بلا أي تداخل بين زرين.
func rebuild_buttons() -> void:
	_sync_view_size()
	buttons.clear()
	button_radius.clear()
	var w := view_size.x
	var h := view_size.y
	# عنقود الإطلاق في الزاوية اليمنى/اليسرى حسب اليد
	_add("fire", Vector2(w - 62.0, h - 62.0), 32.0)
	_add("jump", Vector2(w - 62.0, h - 132.0), 22.0)
	_add("jetpack", Vector2(w - 124.0, h - 104.0), 20.0)
	_add("reload", Vector2(w - 128.0, h - 38.0), 17.0)
	_add("melee", Vector2(w - 166.0, h - 134.0), 17.0)
	_add("crouch", Vector2(w - 180.0, h - 80.0), 17.0)
	_add("prone", Vector2(w - 176.0, h - 28.0), 15.0)
	_add("swap", Vector2(w - 226.0, h - 116.0), 15.0)
	_add("heal", Vector2(w - 232.0, h - 66.0), 15.0)
	_add("grenade", Vector2(w - 226.0, h - 22.0), 15.0)
	# أزرار النظام أعلى اليمين دائمًا (لا تتبع اليد) حتى لا تغطي الخريطة المصغّرة
	buttons["pause"] = _c(Vector2(w - 24.0, 22.0), 15.0)
	button_radius["pause"] = 15.0
	buttons["score"] = _c(Vector2(w - 62.0, 22.0), 15.0)
	button_radius["score"] = 15.0
	# تخطيط Claw: أزرار إضافية في الأعلى — لا تلمس أي زر آخر
	if int(Config.claw_layout) >= 3:
		_add("fire2", Vector2(w * 0.5 + 40.0, 26.0), 18.0)
		_add("jump2", Vector2(w * 0.5 - 10.0, 26.0), 15.0)
	if int(Config.claw_layout) >= 4:
		_add("fire3", Vector2(w * 0.5 + 96.0, 26.0), 15.0)
		_add("melee2", Vector2(w * 0.5 - 62.0, 26.0), 14.0)
	# منطقة التصويب: النصف المقابل لعصا الحركة، عدا الأزرار
	if Config.left_handed:
		_aim_zone_rect = Rect2(0.0, 0.0, w * 0.5, h)
	else:
		_aim_zone_rect = Rect2(w * 0.5, 0.0, w * 0.5, h)


func _desktop() -> bool:
	return DisplayServer.is_touchscreen_available() == false and (
		OS.has_feature("pc") or OS.has_feature("windows") or OS.has_feature("linuxbsd"))


func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and _desktop():
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_wheel_swap = 1
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_wheel_swap = -1
	if event is InputEventScreenTouch:
		if event.pressed:
			_on_touch_down(event.index, event.position)
		else:
			_on_touch_up(event.index)
	elif event is InputEventScreenDrag:
		_on_touch_move(event.index, event.position)


func _button_at(pos: Vector2) -> String:
	for name in buttons.keys():
		var c: Vector2 = (buttons[name] as Rect2).get_center()
		var r: float = float(button_radius.get(name, 16.0)) + 6.0   # هامش لمس سخي
		if pos.distance_to(c) <= r:
			return String(name)
	return ""


func _home_positions() -> Dictionary:
	if Config.left_handed:
		return {"move": Vector2(view_size.x - 72.0, view_size.y - 74.0),
			"aim": Vector2(290.0, view_size.y - 82.0)}
	return {"move": Vector2(72.0, view_size.y - 74.0),
		"aim": Vector2(view_size.x - 290.0, view_size.y - 82.0)}


func _on_touch_down(id: int, pos: Vector2) -> void:
	var name := _button_at(pos)
	if name != "":
		if not bool(button_state.get(name, false)):
			just_pressed[name] = true
		button_state[name] = true
		_touch_button[id] = name
		return
	var homes := _home_positions()
	# نصف الحركة يتبع اليد المختارة (كان ثابتًا يسارًا فتتعطّل اليد اليسرى)
	var move_side := pos.x > view_size.x * 0.5 if Config.left_handed else pos.x < view_size.x * 0.5
	if move_side and not bool(move_stick["active"]):
		move_stick["active"] = true
		move_stick["id"] = id
		move_stick["origin"] = pos if Config.joystick_mode == "floating" else Vector2(homes["move"])
		move_stick["pos"] = pos
	elif not bool(aim_stick["active"]):
		aim_stick["active"] = true
		aim_stick["id"] = id
		aim_stick["origin"] = pos if Config.joystick_mode == "floating" else Vector2(homes["aim"])
		aim_stick["pos"] = pos


func _on_touch_move(id: int, pos: Vector2) -> void:
	if int(move_stick["id"]) == id:
		move_stick["pos"] = pos
	elif int(aim_stick["id"]) == id:
		aim_stick["pos"] = pos


func _on_touch_up(id: int) -> void:
	if int(move_stick["id"]) == id:
		move_stick["active"] = false
		move_stick["id"] = -1
		move_stick["vec"] = Vector2.ZERO
	if int(aim_stick["id"]) == id:
		aim_stick["active"] = false
		aim_stick["id"] = -1
		aim_stick["vec"] = Vector2.ZERO
	# نحرّر الزر الذي تملكه هذه اللمسة فقط — بقية الأزرار تبقى كما هي
	if _touch_button.has(id):
		var name := String(_touch_button[id])
		button_state[name] = false
		_touch_button.erase(id)


func _process(_dt: float) -> void:
	_update_stick(move_stick)
	_update_stick(aim_stick)
	# الجيروسكوب (اختياري)
	if Config.gyro_aim and Input.has_method("get_gyroscope"):
		var g := Input.get_gyroscope()
		aim_stick["vec"] = Vector2(aim_stick["vec"]) + Vector2(-g.y, g.x) * 0.02


func _update_stick(stick: Dictionary) -> void:
	if not bool(stick["active"]):
		stick["vec"] = Vector2.ZERO
		return
	var d: Vector2 = stick["pos"] - stick["origin"]
	var r: float = maxf(18.0, float(Config.stick_size) * 0.5)
	if d.length() > r:
		d = d.normalized() * r
	var vec: Vector2 = d / r
	if vec.length() < DEADZONE:
		vec = Vector2.ZERO
	stick["vec"] = vec


## يستهلك ضغطة حدثية (زر لمس أو مفتاح) — تُستدعى مرة واحدة لكل ضغطة.
func consume(name: String) -> bool:
	if just_pressed.has(name):
		just_pressed.erase(name)
		return true
	return false


## أمر اللعب لهذا الإطار — نفس صيغة البوتات بالحرف.
func build_command() -> Dictionary:
	var cmd := {
		"move_x": 0.0, "move_y": 0.0, "jump": false, "jump_held": false, "jet": false,
		"fire": false, "ads": false, "aim": Vector2.ZERO, "aim_active": false,
		"reload": false, "crouch": false, "prone": false, "melee": false, "roll": false,
		"slide": false, "grenade": false, "heal": false, "interact": false, "ping": false,
		"swap": 0, "sprint": false, "sprint_active": false,
	}
	# ---------------- لوحة المفاتيح ----------------
	cmd["move_x"] = Input.get_axis("move_left", "move_right")
	cmd["move_y"] = Input.get_axis("move_up", "move_down")
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
	# ---------------- الماوس (كمبيوتر) ----------------
	if _desktop() and player_ref != null and is_instance_valid(player_ref):
		var target: Vector2 = player_ref.get_global_mouse_position()
		var d: Vector2 = target - player_ref.global_position
		if d.length() > 6.0:
			cmd["aim"] = d.normalized()
			cmd["aim_active"] = true
	if _wheel_swap != 0:
		cmd["swap"] = 1 if _wheel_swap > 0 else -1
		_wheel_swap = 0
	# ---------------- اللمس ----------------
	var mv: Vector2 = move_stick["vec"]
	cmd["move_x"] = float(cmd["move_x"]) + mv.x
	cmd["move_y"] = mv.y
	var aim: Vector2 = aim_stick["vec"]
	if bool(aim_stick["active"]) and aim.length() > 0.22:
		cmd["aim"] = aim.normalized()
		cmd["aim_active"] = true
		# الإطلاق التلقائي خيار صريح — لا يُفرض على اللاعب
		if Config.auto_fire:
			cmd["fire"] = true
	if bool(button_state.get("fire", false)) or bool(button_state.get("fire2", false)) or bool(button_state.get("fire3", false)):
		cmd["fire"] = true
	if bool(button_state.get("jetpack", false)):
		cmd["jet"] = true
	if bool(button_state.get("crouch", false)):
		cmd["crouch"] = true
	if bool(button_state.get("jump", false)) or bool(button_state.get("jump2", false)):
		cmd["jump_held"] = true
	var jump_edge := consume("jump")
	var jump2_edge := consume("jump2")
	if jump_edge or jump2_edge:
		cmd["jump"] = true
	if consume("reload"):
		cmd["reload"] = true
	var melee_edge := consume("melee")
	var melee2_edge := consume("melee2")
	if melee_edge or melee2_edge:
		cmd["melee"] = true
	if consume("grenade"):
		cmd["grenade"] = true
	if consume("heal"):
		cmd["heal"] = true
	if consume("prone"):
		cmd["prone"] = true
	if consume("swap"):
		cmd["swap"] = 1
	if consume("roll"):
		cmd["roll"] = true
	# نمسح الأزرار الحدثية اللعبية فقط — pause/score يستهلكهما main بعد ذلك
	for key in just_pressed.keys():
		if key != "pause" and key != "score":
			just_pressed.erase(key)
	return cmd


func vibrate(ms: int = 14) -> void:
	if Config.vibration:
		Input.vibrate_handheld(ms)
