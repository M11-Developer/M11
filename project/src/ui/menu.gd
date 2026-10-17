# ============================================================================
# القوائم — عربية كاملة RTL، تعمل باللمس والكيبورد. تنسخ نفس بنية قوائم الويب.
# ============================================================================
extends Control

const S_MAIN := 0
const S_MODES := 1
const S_MAPS := 2
const S_OPERATORS := 3
const S_SETTINGS := 4
const S_LAN := 5
const S_STATS := 6
const S_CREDITS := 7
const S_RESULTS := 8

var screen := S_MAIN
var index := 0
var font: Font
var scroll := 0.0
var t := 0.0
var message := ""
var message_life := 0.0
var host_list: Array = []
var key_art: Texture2D = null
var poster: Texture2D = null
var hero_art: Texture2D = null          # الفن الرئيسي (فريق في الميناء)
var naval_art: Texture2D = null         # ملصق الهجوم البحري لشاشة الشبكة
var p_victory: Texture2D = null         # لوحة النصر
var p_defeat: Texture2D = null          # لوحة الهزيمة
var thumbs: Dictionary = {}             # map_id -> Texture2D (مصغّرة الخريطة الحقيقية)
var portraits: Dictionary = {}          # op_key -> Texture2D (بورتريه المشغّل)
var result: Dictionary = {}             # نتيجة المباراة لشاشة النتائج
var ip_edit: LineEdit = null            # إدخال عنوان IP يدويًا (PC ↔ جوال)
var main_ref: Node = null               # العقدة الرئيسية (Main) — تُضبط من main.gd
var _last_pointer_frame := -1           # لمنع تفعيل الزر مرتين من نفس اللمسة


func _ready() -> void:
	# نملأ الشاشة بالكامل (Control داخل طبقة CanvasLayer)
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)   # ملء الشاشة
	mouse_filter = Control.MOUSE_FILTER_STOP
	# القائمة تبقى حيّة أثناء إيقاف الشجرة المؤقت (شاشة النتائج تُوقف اللعب)
	process_mode = Node.PROCESS_MODE_ALWAYS
	font = ThemeDB.fallback_font
	NetMgr.host_found.connect(_on_host_found)
	# إدخال عنوان IP يدويًا — ضروري حين يمنع الراوتر البث (AP isolation)
	# أو حين يمنع جدار حماية ويندوز حزم الاكتشاف.
	ip_edit = LineEdit.new()
	ip_edit.name = "ManualIP"
	ip_edit.placeholder_text = "عنوان IP للمضيف (مثال 192.168.1.5) ثم Enter"
	ip_edit.virtual_keyboard_enabled = true
	ip_edit.size = Vector2(300, 34)
	ip_edit.visible = false
	ip_edit.text_submitted.connect(_on_manual_ip)
	add_child(ip_edit)
	# لوحتا المنظر المولّدتان (أصول التطبيق) — غيابهما لا يُفشل الإقلاع
	for pair in [["key_art", "res://assets/atlases/backdrops/key_art_menu.png"],
			["poster", "res://assets/atlases/backdrops/poster_loading.png"],
			["hero_art", "res://assets/atlases/backdrops/key_art_main.png"],
			["naval_art", "res://assets/atlases/backdrops/key_art_naval.png"],
			["p_victory", "res://assets/atlases/backdrops/poster_victory.png"],
			["p_defeat", "res://assets/atlases/backdrops/poster_defeat.png"]]:
		if ResourceLoader.exists(pair[1]):
			var tex: Texture2D = load(pair[1])
			match pair[0]:
				"key_art":
					key_art = tex
				"poster":
					poster = tex
				"hero_art":
					hero_art = tex
				"naval_art":
					naval_art = tex
				"p_victory":
					p_victory = tex
				"p_defeat":
					p_defeat = tex
	# مصغّرات الخرائط: صورة حقيقية لكل خريطة، مرسومة من أصول اللعبة نفسها
	# (tools/gen_map_previews.mjs) — فلا تعرض القائمة وعدًا لا يطابق ما سيلعبه اللاعب.
	for map_key in GameWorld.MAPS.keys():
		var mp := "res://assets/atlases/thumb_%s.png" % String(map_key)
		if ResourceLoader.exists(mp):
			thumbs[String(map_key)] = load(mp)
	# بورتريهات المشغّلين: العشرة الأولى من أطلس portraits_orig، والعشرة الجديدة من portraits_new
	_load_portraits()


func _load_portraits() -> void:
	# بورتريه لكل مشغّل: ملف PNG مستقل مولّد من أطلس البورتريهات (أدوات Python)
	# — أبسط وأضمن من قصّ الأطلس وقت التشغيل، ويُقرأ مرة واحدة عند الإقلاع.
	for op in M11Data.OPERATORS:
		var key := String(op["key"])
		var path := "res://assets/atlases/portraits/%s.png" % key
		if ResourceLoader.exists(path):
			portraits[key] = load(path)


## يُستدعى من main عند انتهاء المباراة — يعرض شاشة النتائج بلوحة النصر أو الهزيمة
func show_results(data: Dictionary) -> void:
	result = data
	screen = S_RESULTS
	index = 0
	visible = true


func _on_manual_ip(text: String) -> void:
	var ip := text.strip_edges()
	if ip.is_empty():
		return
	if NetMgr.join_host(ip, Config.NET_PORT):
		toast("جارٍ الانضمام إلى %s …" % ip)
	else:
		toast("تعذّر الانضمام إلى %s — تحقّق من العنوان والشبكة" % ip)


func _on_host_found(info: Dictionary) -> void:
	host_list.append(info)
	toast("وُجد مضيف: %s (%d لاعبين)" % [info["host_name"], info["players"]])


func toast(text: String, life: float = 2.6) -> void:
	message = text
	message_life = life


func _rows() -> Array:
	match screen:
		S_MAIN:
			return ["لعب سريع — ضد بوتات", "اختيار الوضع", "اختيار الخريطة", "تخصيص المقاتل",
				"شبكة محلية (LAN): استضافة", "شبكة محلية: بحث وانضمام", "الإعدادات",
				"الإحصاءات والإنجازات", "الائتمانات"]
		S_MODES:
			var out := []
			for key in M11Data.MODES.keys():
				out.append("%s — %s" % [M11Data.MODES[key].get("name_ar", key), key])
			return out
		S_MAPS:
			var out2 := []
			for key in GameWorld.MAPS.keys():
				out2.append("%s (%d×%d)" % [GameWorld.MAPS[key]["name_ar"], GameWorld.MAPS[key]["w"], GameWorld.MAPS[key]["h"]])
			return out2
		S_OPERATORS:
			var out3 := []
			for op in M11Data.OPERATORS:
				out3.append("%s — %s%s" % [op["name_ar"], ("أنثى" if op["gender"] == "f" else "ذكر"), (" ✔" if op["key"] == Config.op_key else "")])
			return out3
		S_SETTINGS:
			return ["جودة الرسم: %d" % Config.quality, "حد الإطارات: %s" % ("غير محدود" if Config.fps_limit == 0 else Config.fps_limit),
				"اللغة: %s" % ("العربية" if Config.language == "ar" else "English"),
				"صعوبة البوتات: %s" % M11Data.DIFFICULTY[clampi(Config.difficulty, 0, 4)]["name_ar"],
				"عدد البوتات: %d" % Config.bot_count, "قتال الفريق: %s" % ("مفعّل" if Config.friendly_fire else "موقوف"),
				"الاهتزاز: %s" % ("مفعّل" if Config.vibration else "موقوف"), "الجيروسكوب: %s" % ("مفعّل" if Config.gyro_aim else "موقوف"),
				"حجم عصا الحركة: %d" % int(Config.stick_size), "تخطيط Claw: %d أصابع" % Config.claw_layout,
				"الاستخدام باليد اليسرى: %s" % ("نعم" if Config.left_handed else "لا"), "حفظ الإعدادات"]
		S_LAN:
			return ["إنشاء غرفة (استضافة)", "بحث عن مضيف (3 ثوانٍ)"] + host_list.map(func(h): return "انضمام إلى %s — %d لاعبين" % [h["host_name"], h["players"]])
		S_STATS:
			var s: Dictionary = Save.profile["stats"]
			return ["المستوى %d — %s" % [Save.profile["level"], Save.RANKS[Save.profile["rank"]]["name_ar"]],
				"قتلات: %d | موت: %d | مباريات: %d" % [s["kills"], s["deaths"], s["matches"]],
				"إحياءات: %d | مساعدات: %d" % [s["revives"], s["assists"]],
				"أطول قتلة: %d مترًا" % int(s["longest_kill"]), "إنجازات: %d" % Save.profile["achievements"].size(),
				"رجوع"]
		S_RESULTS:
			var r := result
			var win := int(r.get("winner_team", -1)) == 0
			return ["%s — %d : %d" % ["فوز" if win else ("تعادل" if int(r.get("winner_team", -1)) == -1 else "خسارة"),
					int(r.get("scores", [0, 0])[0]), int(r.get("scores", [0, 0])[1])],
				"قتلاتك: %d | موتك: %d" % [int(r.get("player_kills", 0)), int(r.get("player_deaths", 0))],
				"الوضع: %s | الخريطة: %s | المدة: %s" % [String(r.get("mode", "")), String(r.get("map", "")),
					"%d:%02d" % [int(float(r.get("time", 0.0)) / 60.0), int(float(r.get("time", 0.0))) % 60]],
				"مباراة أخرى", "الرجوع للقائمة"]
		S_CREDITS:
			return ["كل الرسوم مولّدة برمجيًا (Python + Pillow)", "كل الأصوات مولّدة برمجيًا (NumPy)",
				"الخطوط: Cairo / Noto Sans Arabic / Press Start 2P (SIL OFL 1.1)",
				"لا إنترنت ولا حسابات ولا إعلانات", "رجوع"]
	return []


func activate(i: int) -> void:
	# كانت القائمة تُضاف سابقًا كابن مباشر لـ Main، ثم نُقلت إلى CanvasLayer
	# فصار get_parent() يعيد الطبقة لا العقدة الرئيسية ⇒ كل ضغطة تفشل بصمت.
	# الآن نبحث صعودًا عن العقدة التي تملك start_match.
	var main: Node = null
	if main_ref != null and is_instance_valid(main_ref):
		main = main_ref
	else:
		var p := get_parent()
		while p != null and not p.has_method("start_match"):
			p = p.get_parent()
		main = p
	if main == null:
		push_error("تعذّر العثور على العقدة الرئيسية من القائمة")
		return
	match screen:
		S_MAIN:
			match i:
				0:
					main.start_match({"mode": "dm", "bots": Config.bot_count})
					visible = false
				1:
					screen = S_MODES
					index = 0
				2:
					screen = S_MAPS
					index = 0
				3:
					screen = S_OPERATORS
					index = 0
				4:
					if NetMgr.start_host(Config.player_name):
						toast("الغرفة جاهزة على المنفذ %d — دع أصدقاءك ينضمون" % Config.NET_PORT)
					else:
						toast("تعذّر إنشاء الغرفة — تحقق من الصلاحيات")
				5:
					screen = S_LAN
					index = 0
					host_list.clear()
					NetMgr.discover_hosts(3.0)
				6:
					screen = S_SETTINGS
					index = 0
				7:
					screen = S_STATS
					index = 0
				8:
					screen = S_CREDITS
					index = 0
		S_MODES:
			var keys: Array = M11Data.MODES.keys()
			Config.mode_id = String(keys[i])
			Config.save_settings()
			main.start_match({"mode": Config.mode_id})
			visible = false
		S_MAPS:
			var mkeys: Array = GameWorld.MAPS.keys()
			Config.map_id = String(mkeys[i])
			Config.save_settings()
			toast("الخريطة: %s" % GameWorld.MAPS[Config.map_id]["name_ar"])
			screen = S_MAIN
		S_OPERATORS:
			Config.op_key = String(M11Data.OPERATORS[i]["key"])
			Config.save_settings()
			toast("اخترت %s" % M11Data.OPERATORS[i]["name_ar"])
		S_SETTINGS:
			match i:
				0:
					Config.quality = (Config.quality + 1) % 4
				1:
					Config.fps_limit = 0 if Config.fps_limit == 0 else (30 if Config.fps_limit == 120 else Config.fps_limit + 30)
				2:
					Config.language = "en" if Config.language == "ar" else "ar"
				3:
					Config.difficulty = (Config.difficulty + 1) % 5
				4:
					Config.bot_count = 0 if Config.bot_count >= 11 else Config.bot_count + 1
				5:
					Config.friendly_fire = not Config.friendly_fire
				6:
					Config.vibration = not Config.vibration
				7:
					Config.gyro_aim = not Config.gyro_aim
				8:
					Config.stick_size = 40.0 if Config.stick_size >= 90.0 else Config.stick_size + 6.0
				9:
					Config.claw_layout = 2 if Config.claw_layout >= 4 else Config.claw_layout + 1
				10:
					Config.left_handed = not Config.left_handed
				11:
					Config.save_settings()
					Config.apply_runtime()
					AudioBus._apply_bus_volumes()
					toast("تم الحفظ")
		S_LAN:
			match i:
				0:
					if NetMgr.start_host(Config.player_name):
						main.start_match({"mode": Config.mode_id})
						visible = false
				1:
					host_list.clear()
					NetMgr.discover_hosts(3.0)
					toast("أبحث عن مضيف… (3 ثوانٍ)")
				_:
					var host: Dictionary = host_list[i - 2]
					if NetMgr.join_host(String(host["ip"]), int(host["port"])):
						toast("جارٍ الاتصال بـ %s…" % host["host_name"])
					else:
						toast("فشل الاتصال")
		S_RESULTS:
			if i == 3:
				# مباراة أخرى بنفس الوضع والخريطة
				if main and main.has_method("start_match"):
					main.start_match({"mode": String(result.get("mode", Config.mode_id))})
					visible = false
			elif i == 4:
				if main and main.has_method("back_to_menu"):
					main.back_to_menu()
				else:
					screen = S_MAIN
		S_CREDITS:
			if i == 4:
				screen = S_MAIN


# كل إدخال المؤشّر (ماوس على الكمبيوتر + لمس على الهاتف) يمرّ من هنا.
# كان الكود يعالج اللمس فقط، فكانت أزرار القائمة لا تستجيب للماوس إطلاقًا.
func _gui_input(event: InputEvent) -> void:
	if not visible:
		return
	if ip_edit != null and ip_edit.visible and ip_edit.has_focus():
		return
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_pointer_down(event.position)
		accept_event()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_WHEEL_DOWN and event.pressed:
		index = (index + 1) % maxi(1, _rows().size())
		accept_event()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_WHEEL_UP and event.pressed:
		index = (index - 1 + _rows().size()) % maxi(1, _rows().size())
		accept_event()
	elif event is InputEventScreenTouch and event.pressed:
		_pointer_down(event.position)
		accept_event()
	elif event is InputEventMouseMotion:
		var i := _row_at(event.position, _rows())
		if i >= 0:
			index = i


func _pointer_down(pos: Vector2) -> void:
	# أندرويد يحوّل اللمسة إلى حدث ماوس أيضًا (emulate_mouse_from_touch)
	# فتصل الضغطة مرتين: نسمح بواحدة فقط لكل إطار.
	var f := Engine.get_process_frames()
	if f == _last_pointer_frame:
		return
	_last_pointer_frame = f
	var rows := _rows()
	var i := _row_at(pos, rows)
	if i >= 0:
		index = i
		activate(i)


func _unhandled_input(event: InputEvent) -> void:
	if not visible:
		return
	# إذا كان اللاعب يكتب عنوان IP فلا نخطف منه المفاتيح
	if ip_edit != null and ip_edit.visible and ip_edit.has_focus():
		return
	var rows := _rows()
	if event.is_action_pressed("ui_down"):
		index = (index + 1) % maxi(1, rows.size())
	elif event.is_action_pressed("ui_up"):
		index = (index - 1 + rows.size()) % maxi(1, rows.size())
	elif event.is_action_pressed("ui_accept"):
		activate(index)
	elif event.is_action_pressed("ui_cancel"):
		if screen == S_MAIN:
			get_tree().quit()
		else:
			screen = S_MAIN
			index = 0



func _process(dt: float) -> void:
	t += dt
	message_life = maxf(0.0, message_life - dt)
	# حقل عنوان IP يظهر في شاشة الشبكة فقط ويجلس أسفل الشاشة
	if ip_edit != null:
		var on_lan := visible and screen == S_LAN
		ip_edit.visible = on_lan
		if not on_lan and ip_edit.has_focus():
			ip_edit.release_focus()      # لا يحتجز لوحة المفاتيح بعد مغادرة شاشة الشبكة
		if on_lan:
			var vp := get_viewport().get_visible_rect().size
			# يسار الشاشة حتى لا يزاحم قائمة الصفوف على اليمين
			ip_edit.size = Vector2(minf(300.0, vp.x - 360.0), 34)
			ip_edit.position = Vector2(16, vp.y - 64)
	queue_redraw()



# مستطيل الصف — مصدر واحد للحقيقة: الرسم واللمس والماوس كلهم يستخدمونه
# (كان الرسم يزحزح الصف ١٨ بكسل عن مستطيل اللمس فتفشل الضغطات)
const ROW_W := 320.0
const ROW_TOP := 76.0
const ROW_STEP_MAX := 28.0
const ROW_STEP_MIN := 15.0


# ارتفاع الصف يتكيّف مع عدد العناصر وشاشة الجهاز حتى لا يختفي شيء
func _row_step() -> float:
	var vp := get_viewport().get_visible_rect().size
	var n := maxi(1, _rows().size())
	return clampf((vp.y - ROW_TOP - 26.0) / float(n), ROW_STEP_MIN, ROW_STEP_MAX)


func _row_rect(i: int, vp: Vector2) -> Rect2:
	var step := _row_step()
	var y := ROW_TOP + i * step - scroll
	return Rect2(vp.x - ROW_W - 20.0, y, ROW_W, step - 3.0)


func _row_at(pos: Vector2, rows: Array) -> int:
	var vp := get_viewport().get_visible_rect().size
	for i in rows.size():
		if _row_rect(i, vp).has_point(pos):
			return i
	return -1


# يُبقي الصف المختار داخل الشاشة ويحدّث مقدار التمرير
func _update_scroll() -> void:
	var vp := get_viewport().get_visible_rect().size
	var n := maxi(1, _rows().size())
	var step := _row_step()
	var view_h: float = maxf(1.0, vp.y - ROW_TOP - 26.0)
	var sel_y := index * step
	if sel_y < scroll:
		scroll = sel_y
	elif sel_y + step > scroll + view_h:
		scroll = sel_y + step - view_h
	scroll = clampf(scroll, 0.0, maxf(0.0, n * step - view_h))


func _draw() -> void:
	if not visible:
		return
	var vp := get_viewport().get_visible_rect().size
	# خلفية متدرجة بطبقات
	draw_rect(Rect2(Vector2.ZERO, vp), Color(0.05, 0.08, 0.11))
	# لوحة المنظر المولّدة خلف كل شيء (اختزال بالعدد 2 → 640×360 بلا أي تنعيم)
	var art: Texture2D = poster
	if screen == S_MAIN or screen == S_MODES:
		art = hero_art if hero_art != null else key_art
	elif screen == S_MAPS:
		art = key_art if key_art != null else hero_art
	elif screen == S_LAN or screen == S_OPERATORS:
		art = naval_art if naval_art != null else key_art
	if art == null:
		art = key_art if key_art != null else poster
	if art != null:
		draw_texture_rect(art, Rect2(Vector2(0, -8), Vector2(vp.x, vp.x * 0.5625)), false,
			Color(1, 1, 1, 0.85 if screen == S_MAIN else 0.45))
		# تعتيم سفلي حتى تُقرأ القوائم فوق اللوحة
		draw_rect(Rect2(0, vp.y * 0.35, vp.x, vp.y * 0.65), Color(0.04, 0.05, 0.07, 0.55))
	for l in 5:
		var off := fmod(t * (6.0 + l * 3.0), 200.0)
		var col := Color(0.07 + l * 0.02, 0.11 + l * 0.022, 0.16 + l * 0.026)
		var pts := PackedVector2Array()
		pts.append(Vector2(0, vp.y))
		var x := -200.0
		while x < vp.x + 200.0:
			var y := vp.y - 60.0 - l * 10.0 + sin((x + off) * 0.02 + l) * 12.0
			pts.append(Vector2(x, y))
			x += 16.0
		pts.append(Vector2(vp.x + 200.0, vp.y))
		draw_colored_polygon(pts, col)
	# --- معاينة الخريطة المختارة: مصغّرة حقيقية مرسومة من أصول اللعبة + معلوماتها ---
	if screen == S_MAPS and not thumbs.is_empty():
		var mkeys: Array = GameWorld.MAPS.keys()
		var key := String(mkeys[clampi(index, 0, mkeys.size() - 1)])
		var tex: Texture2D = thumbs.get(key)
		if tex:
			var pw := minf(vp.x * 0.46, 480.0)
			var ph := pw * 0.5625
			var px := vp.x * 0.04
			var py := vp.y * 0.5 - ph * 0.5
			draw_rect(Rect2(px - 4, py - 4, pw + 8, ph + 8), Color(0.03, 0.04, 0.06, 0.85))
			draw_rect(Rect2(px - 4, py - 4, pw + 8, ph + 8), Color(0.95, 0.76, 0.31, 0.55), false, 2.0)
			draw_texture_rect(tex, Rect2(px, py, pw, ph), false)
			var info: Dictionary = GameWorld.MAPS[key]
			var line_y := py + ph + 22
			draw_string(font, Vector2(px, line_y), String(info["name_ar"]), HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color(0.98, 0.86, 0.5))
			draw_string(font, Vector2(px, line_y + 20),
				"الحجم %d×%d — الثيم: %s" % [int(info["w"]), int(info["h"]), String(info["theme"])],
				HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.80, 0.86, 0.90))
	# --- بورتريه المشغّل المختار (صورة كبيرة) + سيرته ---
	if screen == S_OPERATORS and not portraits.is_empty():
		var ops: Array = M11Data.OPERATORS
		var oi := clampi(index, 0, ops.size() - 1)
		var op: Dictionary = ops[oi]
		var ptex: Texture2D = portraits.get(String(op["key"]))
		if ptex:
			var scale_f := 2.6
			var pw2 := ptex.get_width() * scale_f
			var ph2 := ptex.get_height() * scale_f
			var px2 := vp.x * 0.06
			var py2 := vp.y * 0.5 - ph2 * 0.5
			draw_rect(Rect2(px2 - 6, py2 - 6, pw2 + 12, ph2 + 12), Color(0.03, 0.04, 0.06, 0.85))
			draw_rect(Rect2(px2 - 6, py2 - 6, pw2 + 12, ph2 + 12), Color(0.95, 0.76, 0.31, 0.55), false, 2.0)
			draw_texture_rect(ptex, Rect2(px2, py2, pw2, ph2), false)
			draw_string(font, Vector2(px2, py2 + ph2 + 24), String(op["name_ar"]),
				HORIZONTAL_ALIGNMENT_LEFT, -1, 22, Color(0.98, 0.86, 0.5))
			draw_string(font, Vector2(px2, py2 + ph2 + 46),
				"%s — %s" % [("أنثى" if op["gender"] == "f" else "ذكر"), String(op.get("style", ""))],
				HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.80, 0.86, 0.90))
	# --- شاشة النتائج: لوحة النصر أو الهزيمة تعبر الشاشة كاملة ---
	if screen == S_RESULTS:
		var won := int(result.get("winner_team", -1)) == 0
		var pt: Texture2D = p_victory if won else p_defeat
		if pt == null:
			pt = poster if poster != null else key_art
		if pt:
			draw_texture_rect(pt, Rect2(Vector2(0, 0), Vector2(vp.x, vp.x * 0.5625)), false,
				Color(1, 1, 1, 0.95))
		draw_rect(Rect2(0, vp.y * 0.42, vp.x, vp.y * 0.58), Color(0.04, 0.05, 0.07, 0.72))
	# العنوان (يمين) — حجم متكيّف حتى لا يُقصّ أبدًا
	var title := _title()
	var ts := 22
	while ts > 12 and font.get_string_size(title, HORIZONTAL_ALIGNMENT_LEFT, -1, ts).x > vp.x - 60:
		ts -= 1
	draw_string(font, Vector2(16, 34), title, HORIZONTAL_ALIGNMENT_RIGHT, vp.x - 32, ts,
		Color(0.95, 0.76, 0.31))
	var rows := _rows()
	_update_scroll()
	var step := _row_step()
	# لوحة خلفية واحدة للقائمة كلها حتى تُقرأ فوق أي صورة
	var view_h: float = maxf(1.0, vp.y - ROW_TOP - 26.0)
	var list_h: float = minf(rows.size() * step, view_h) + 6.0
	draw_rect(Rect2(vp.x - ROW_W - 28.0, ROW_TOP - 8.0, ROW_W + 16.0, list_h),
		Color(0.03, 0.04, 0.06, 0.45))
	for i in rows.size():
		var r := _row_rect(i, vp)
		if r.end.y < 46.0 or r.position.y > vp.y - 22.0:
			continue
		var sel := i == index
		draw_rect(r, Color(0.95, 0.76, 0.31, 0.22) if sel else Color(0.05, 0.06, 0.08, 0.62))
		if sel:
			draw_rect(Rect2(r.position + Vector2(r.size.x - 3, 0), Vector2(3, r.size.y)), Color(0.95, 0.76, 0.31))
		# نص الصف داخل صندوقه، مع تصغير الخط إن طال النص (لا نص مقطوع أبدًا)
		var label := String(rows[i])
		var fs := int(clampf(step * 0.55, 9.0, 14.0))
		while fs > 8 and font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x > r.size.x - 24:
			fs -= 1
		draw_string(font, Vector2(r.position.x + 10, r.position.y + r.size.y * 0.72), label,
			HORIZONTAL_ALIGNMENT_RIGHT, r.size.x - 20, fs,
			Color(0.92, 0.95, 0.97) if not sel else Color(1.0, 0.90, 0.58))
	# مؤشّر تمرير + عدّاد (يظهران فقط حين تكون القائمة أطول من الشاشة)
	if rows.size() * step > vp.y - ROW_TOP - 26.0 + 1.0:
		var track := Rect2(vp.x - 14, ROW_TOP, 4, vp.y - ROW_TOP - 26.0)
		draw_rect(track, Color(0.3, 0.36, 0.4, 0.35))
		var total := rows.size() * step
		var frac := track.size.y / total
		var knob_h: float = maxf(18.0, track.size.y * frac)
		var knob_y := track.position.y + (scroll / maxf(1.0, total - track.size.y)) * (track.size.y - knob_h)
		draw_rect(Rect2(track.position.x, knob_y, track.size.x, knob_h), Color(0.95, 0.76, 0.31, 0.75))
		# عدّاد أعلى القائمة (لا يزاحم التلميحات أسفل الشاشة)
		draw_string(font, Vector2(vp.x - ROW_W - 20.0, ROW_TOP - 8.0), "%d / %d" % [index + 1, rows.size()],
			HORIZONTAL_ALIGNMENT_RIGHT, ROW_W, 11, Color(0.75, 0.82, 0.86))
	# رسالة
	if message_life > 0.0:
		var a := clampf(message_life, 0.0, 1.0)
		draw_string(font, Vector2(16, vp.y - 30), message, HORIZONTAL_ALIGNMENT_CENTER, vp.x - 32, 13,
			Color(0.95, 0.76, 0.31, a))
	# تلميحات
	var hint := "الأسهم للتنقل • Enter للاختيار • Esc للرجوع • بالماوس: اضغط على السطر"
	var hs := 11
	while hs > 8 and font.get_string_size(hint, HORIZONTAL_ALIGNMENT_LEFT, -1, hs).x > vp.x - 28:
		hs -= 1
	draw_string(font, Vector2(14, vp.y - 10), hint, HORIZONTAL_ALIGNMENT_LEFT, vp.x - 28, hs,
		Color(0.5, 0.58, 0.64))


func _title() -> String:
	match screen:
		S_MAIN:
			return "ميكا ١١ — ساحة النار المحلية"
		S_MODES:
			return "أوضاع اللعب (%d)" % M11Data.MODES.size()
		S_MAPS:
			return "الخرائط (%d)" % GameWorld.MAPS.size()
		S_OPERATORS:
			return "المشغلون (%d)" % M11Data.OPERATORS.size()
		S_SETTINGS:
			return "الإعدادات"
		S_LAN:
			return "الشبكة المحلية — منفذ %d" % Config.NET_PORT
		S_STATS:
			return "الإحصاءات"
		S_RESULTS:
			return "نتيجة المباراة"
		S_CREDITS:
			return "الائتمانات"
	return ""
