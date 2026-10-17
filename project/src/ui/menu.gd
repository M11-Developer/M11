# ============================================================================
# القوائم — إعادة بناء كاملة: عربية RTL بخط Cairo الحقيقي، زر رجوع مرئي في كل
# شاشة، تمرير سلس، شاشة إيقاف مؤقت حقيقية، وقاعدة تنقّل واحدة (سجل شاشات)
# تعمل باللمس والماوس والكيبورد ويد التحكم.
#
# لماذا أُعيدت كتابتها؟
#  • لم يكن هناك زر رجوع مرئي إطلاقًا — الخروج من أي شاشة يتطلب Esc فقط
#    (غير موجود على الهاتف). الآن: شريحة «رجوع» أعلى اليسار + صف رجوع في كل قائمة.
#  • الرسم كان يستخدم ThemeDB.fallback_font لا خط Cairo المرفق ⇒ حروف عربية
#    مشوّهة/مقطوعة على أندرويد. الآن كل النص عبر M11UI بخط Cairo.
#  • الصور كانت تُمَدّ لقيمة ثابتة فتُشوَّه على الشاشات 20:9 — الآن «تغطية» صحيحة.
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
const S_CONTROLS := 9
const S_PAUSE := 10
const S_LOBBY := 11

const MARGIN := 16.0
const HEADER_H := 58.0
const FOOTER_H := 30.0

var screen := S_MAIN
var index := 0
var scroll := 0.0
var t := 0.0
var message := ""
var message_life := 0.0
var host_list: Array = []
var result: Dictionary = {}
var ip_edit: LineEdit = null
var main_ref: Node = null
var history: Array = []
var hover_index := -1

# لوحات الفن
var key_art: Texture2D = null
var poster: Texture2D = null
var hero_art: Texture2D = null
var naval_art: Texture2D = null
var p_victory: Texture2D = null
var p_defeat: Texture2D = null
var thumbs: Dictionary = {}
var portraits: Dictionary = {}
var _art_loaded := false
var _last_pointer_frame := -1
var _drag := {"active": false, "y": 0.0, "scroll": 0.0, "moved": false}


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	process_mode = Node.PROCESS_MODE_ALWAYS
	# إدخال عنوان IP يدويًا (حين يعزل الراوتر الأجهزة أو يمنع البث)
	ip_edit = LineEdit.new()
	ip_edit.name = "ManualIP"
	ip_edit.placeholder_text = "عنوان IP للمضيف (مثال 192.168.1.5)"
	ip_edit.virtual_keyboard_enabled = true
	ip_edit.size = Vector2(300, 34)
	ip_edit.visible = false
	ip_edit.add_theme_font_override("font", M11UI.FONT_REG)
	ip_edit.add_theme_font_size_override("font_size", 14)
	ip_edit.text_submitted.connect(_on_manual_ip)
	add_child(ip_edit)
	# كانت الإشارة تُعرَّف ولا تُوصَل إطلاقًا ⇒ قائمة المضيفين تبقى فارغة دائمًا
	if not NetMgr.host_found.is_connected(_on_host_found):
		NetMgr.host_found.connect(_on_host_found)
	_load_art()


func _exit_tree() -> void:
	if is_instance_valid(NetMgr) and NetMgr.host_found.is_connected(_on_host_found):
		NetMgr.host_found.disconnect(_on_host_found)


func _load_art() -> void:
	if _art_loaded:
		return
	_art_loaded = true
	for pair in [["key_art", "res://assets/atlases/backdrops/key_art_menu.png"],
			["poster", "res://assets/atlases/backdrops/poster_loading.png"],
			["hero_art", "res://assets/atlases/backdrops/key_art_main.png"],
			["naval_art", "res://assets/atlases/backdrops/key_art_naval.png"],
			["p_victory", "res://assets/atlases/backdrops/poster_victory.png"],
			["p_defeat", "res://assets/atlases/backdrops/poster_defeat.png"]]:
		if ResourceLoader.exists(pair[1]):
			var tex: Texture2D = load(pair[1])
			match pair[0]:
				"key_art": key_art = tex
				"poster": poster = tex
				"hero_art": hero_art = tex
				"naval_art": naval_art = tex
				"p_victory": p_victory = tex
				"p_defeat": p_defeat = tex
	for map_key in GameWorld.MAPS.keys():
		var mp := "res://assets/atlases/thumb_%s.png" % String(map_key)
		if ResourceLoader.exists(mp):
			thumbs[String(map_key)] = load(mp)
	for op in M11Data.OPERATORS:
		var key := String(op["key"])
		var path := "res://assets/atlases/portraits/%s.png" % key
		if ResourceLoader.exists(path):
			portraits[key] = load(path)


# ---------------------------------------------------------------- التنقّل
func show_screen(s: int, push_history: bool = true) -> void:
	if push_history and s != screen:
		history.append(screen)
		if history.size() > 12:
			history.pop_front()
	screen = s
	index = 0
	scroll = 0.0
	hover_index = -1
	message = ""
	message_life = 0.0


func go_back() -> void:
	if screen == S_LOBBY:
		_act("lan_leave")
		return
	if screen == S_PAUSE:
		_act("resume")
		return
	if screen == S_RESULTS:
		_act("menu")
		return
	if history.is_empty():
		screen = S_MAIN
		index = 0
		scroll = 0.0
		return
	screen = int(history.pop_back())
	index = 0
	scroll = 0.0


func open(s: int) -> void:
	show_screen(s)


## تنشيط صفّ برقمه — تُستخدم من الاختبار الذاتي في CI ومن أي غلاف خارجي.
func activate(i: int) -> void:
	_activate_row(i)


func show_results(data: Dictionary) -> void:
	result = data
	screen = S_RESULTS
	index = 0
	scroll = 0.0
	visible = true


func show_pause() -> void:
	if screen != S_PAUSE:
		history.append(screen)
		if history.size() > 12:
			history.pop_front()
	screen = S_PAUSE
	index = 0
	scroll = 0.0
	visible = true


func toast(text: String, life: float = 2.6) -> void:
	message = text
	message_life = life


func _on_manual_ip(text: String) -> void:
	var ip := text.strip_edges()
	if ip.is_empty():
		return
	if NetMgr.join_host(ip, Config.NET_PORT):
		show_screen(S_LOBBY)
		toast("جارٍ الانضمام إلى %s …" % ip, 4.0)
	else:
		toast("تعذّر الانضمام إلى %s — تحقّق من العنوان والشبكة" % ip)


func _on_host_found(info: Dictionary) -> void:
	for h in host_list:
		if String(h.get("ip", "")) == String(info.get("ip", "")):
			return
	host_list.append(info)
	toast("وُجد مضيف: %s (%d لاعبين)" % [info["host_name"], info["players"]])


# ---------------------------------------------------------------- الصفوف
func _main_node() -> Node:
	if main_ref != null and is_instance_valid(main_ref):
		return main_ref
	var p := get_parent()
	while p != null and not p.has_method("start_match"):
		p = p.get_parent()
	return p


func _rows() -> Array:
	var g := _main_node()
	var rows: Array = []
	match screen:
		S_MAIN:
			rows = [
				{"label": "لعب سريع — ضد بوتات", "hint": "ابدأ فورًا", "icon": "play",
					"id": "quick", "color": M11UI.GOLD},
				{"label": "اختيار الوضع", "hint": "%d وضعًا" % M11Data.MODES.size(), "icon": "skull", "id": "modes"},
				{"label": "اختيار الخريطة", "hint": String(GameWorld.MAPS.get(Config.map_id, {}).get("name_ar", "")), "icon": "map", "id": "maps"},
				{"label": "تخصيص المقاتل", "hint": _op_name(Config.op_key), "icon": "team", "id": "operators"},
				{"label": "شبكة محلية (LAN)", "hint": "حتى %d لاعبين" % Config.MAX_PLAYERS, "icon": "lan", "id": "lan"},
				{"label": "الإعدادات", "hint": "شاشة، صوت، لعب", "icon": "gear", "id": "settings"},
				{"label": "تخصيص التحكم", "hint": "عصا، أزرار، تصويب", "icon": "gear", "id": "controls"},
				{"label": "الإحصاءات والإنجازات", "hint": "المستوى %d" % int(Save.profile.get("level", 1)), "icon": "trophy", "id": "stats"},
				{"label": "الائتمانات", "hint": "صُنعت كلها بالكود", "icon": "star", "id": "credits"},
				{"label": "خروج من اللعبة", "hint": "إغلاق التطبيق", "icon": "warn", "id": "quit", "color": M11UI.RED},
			]
		S_MODES:
			for key in M11Data.MODES.keys():
				var m: Dictionary = M11Data.MODES[key]
				rows.append({"label": String(m.get("name_ar", key)), "hint": _mode_hint(m, key),
					"id": "mode", "arg": String(key),
					"color": M11UI.GOLD if String(key) == Config.mode_id else M11UI.TEXT})
			rows.append({"label": "رجوع", "hint": "Esc", "icon": "back", "id": "back"})
		S_MAPS:
			for key in GameWorld.MAPS.keys():
				var md: Dictionary = GameWorld.MAPS[key]
				var bd: Texture2D = thumbs.get(String(key))
				rows.append({"label": String(md.get("name_ar", key)),
					"hint": "%d×%d — %s" % [int(md.get("w", 0)), int(md.get("h", 0)), String(md.get("theme", ""))],
					"id": "map", "arg": String(key), "thumb": bd,
					"color": M11UI.GOLD if String(key) == Config.map_id else M11UI.TEXT})
			rows.append({"label": "رجوع", "hint": "Esc", "icon": "back", "id": "back"})
		S_OPERATORS:
			for op in M11Data.OPERATORS:
				rows.append({"label": String(op.get("name_ar", op["key"])),
					"hint": ("أنثى" if String(op.get("gender", "m")) == "f" else "ذكر"),
					"id": "op", "arg": String(op["key"]), "portrait": portraits.get(String(op["key"])),
					"color": M11UI.GOLD if String(op["key"]) == Config.op_key else M11UI.TEXT})
			rows.append({"label": "شكل الزي: %d" % (int(Config.skin_index) + 1), "hint": "١–٤", "id": "skin"})
			rows.append({"label": "السلاح الأساسي: %s" % _weapon_name(Config.loadout[0]), "hint": "‹ ›", "id": "primary"})
			rows.append({"label": "السلاح الثانوي: %s" % _weapon_name(Config.loadout[1]), "hint": "‹ ›", "id": "secondary"})
			rows.append({"label": "القنبلة: %s" % ("قنبلة يدوية" if Config.throwable == "grenade" else "شمعة إشارة"), "hint": "‹ ›", "id": "throwable"})
			rows.append({"label": "رجوع", "hint": "Esc", "icon": "back", "id": "back"})
		S_SETTINGS:
			rows = [
				{"header": true, "label": "الشاشة والرسم"},
				{"label": "جودة الرسم: %s" % ["منخفضة", "متوسطة", "عالية", "قصوى"][clampi(Config.quality, 0, 3)], "id": "quality", "hint": "‹ ›"},
				{"label": "حد الإطارات: %s" % ("غير محدود" if Config.fps_limit == 0 else str(Config.fps_limit)), "id": "fps", "hint": "‹ ›"},
				{"label": "ملء الشاشة: %s" % ("مفعّل" if Config.desktop_fullscreen else "موقوف"), "id": "fullscreen", "hint": "كمبيوتر"},
				{"label": "مؤثرات الرسم: %s" % ("مفعّلة" if Config.pc_post_fx else "موقوفة"), "id": "postfx", "hint": "كمبيوتر"},
				{"header": true, "label": "اللعب"},
				{"label": "صعوبة البوتات: %s" % String(M11Data.DIFFICULTY[clampi(Config.difficulty, 0, 4)]["name_ar"]), "id": "difficulty", "hint": "‹ ›"},
				{"label": "عدد البوتات: %d" % Config.bot_count, "id": "bots", "hint": "‹ ›"},
				{"label": "قتال الفريق (Friendly Fire): %s" % ("مفعّل" if Config.friendly_fire else "موقوف"), "id": "ff", "hint": "‹ ›"},
				{"label": "إطلاق تلقائي عند التصويب: %s" % ("مفعّل" if Config.auto_fire else "موقوف"), "id": "autofire", "hint": "‹ ›"},
				{"label": "مساعد التصويب: %d%%" % int(Config.aim_assist * 100.0), "id": "aimassist", "hint": "‹ ›"},
				{"header": true, "label": "الصوت والاهتزاز"},
				{"label": "مستوى الصوت: %d%%" % int(Config.master_volume * 100.0), "id": "volume", "hint": "‹ ›"},
				{"label": "موسيقى: %d%%" % int(Config.music_volume * 100.0), "id": "music", "hint": "‹ ›"},
				{"label": "مؤثرات: %d%%" % int(Config.sfx_volume * 100.0), "id": "sfx", "hint": "‹ ›"},
				{"label": "الاهتزاز: %s" % ("مفعّل" if Config.vibration else "موقوف"), "id": "vibration", "hint": "‹ ›"},
				{"header": true, "label": "معلومات"},
				{"label": "إظهار الإطارات/ث: %s" % ("مفعّل" if Config.show_fps else "موقوف"), "id": "showfps", "hint": "‹ ›"},
				{"label": "حفظ الإعدادات الآن", "id": "save", "icon": "star", "color": M11UI.TEAL},
				{"label": "استعادة الإعدادات الافتراضية", "id": "reset_defaults", "color": M11UI.ORANGE},
				{"label": "رجوع", "hint": "Esc", "icon": "back", "id": "back"},
			]
		S_CONTROLS:
			rows = [
				{"header": true, "label": "العصا اللمسية"},
				{"label": "موضع العصا: %s" % ("عائم" if Config.joystick_mode == "floating" else "ثابت"), "id": "stickmode", "hint": "‹ ›"},
				{"label": "حجم العصا: %d" % int(Config.stick_size), "id": "sticksize", "hint": "‹ ›"},
				{"label": "شفافية الأزرار: %d%%" % int(Config.button_alpha * 100.0), "id": "btn_alpha", "hint": "‹ ›"},
				{"header": true, "label": "التصويب"},
				{"label": "مساعد التصويب: %d%%" % int(Config.aim_assist * 100.0), "id": "aimassist", "hint": "‹ ›"},
				{"label": "الجيروسكوب: %s" % ("مفعّل" if Config.gyro_aim else "موقوف"), "id": "gyro", "hint": "‹ ›"},
				{"header": true, "label": "التخطيط"},
				{"label": "تخطيط Claw: %d أصابع" % Config.claw_layout, "id": "claw", "hint": "‹ ›"},
				{"label": "الاستخدام باليد اليسرى: %s" % ("نعم" if Config.left_handed else "لا"), "id": "lefthanded", "hint": "‹ ›"},
				{"label": "إظهار الإطارات/ث: %s" % ("مفعّل" if Config.show_fps else "موقوف"), "id": "showfps", "hint": "‹ ›"},
				{"label": "استعادة التحكم الافتراضي", "id": "reset_controls", "color": M11UI.ORANGE},
				{"label": "رجوع", "hint": "Esc", "icon": "back", "id": "back"},
			]
		S_LAN:
			rows = [
				{"label": "إنشاء غرفة (استضافة)", "hint": "أنت المضيف", "icon": "play", "id": "host"},
				{"label": "بحث وانضمام تلقائي", "hint": "٣ ثوانٍ", "icon": "lan", "id": "discover"},
				{"label": "الانضمام بعنوان IP", "hint": "اكتب العنوان أسفل الشاشة", "icon": "map", "id": "manual"},
			]
			for i in host_list.size():
				var h: Dictionary = host_list[i]
				rows.append({"label": "انضمام إلى %s" % String(h.get("host_name", "؟")),
					"hint": "%d لاعبين — %s" % [int(h.get("players", 0)), String(h.get("ip", ""))],
					"id": "join", "arg": i, "color": M11UI.TEAL})
			rows.append({"label": "رجوع", "hint": "Esc", "icon": "back", "id": "back"})
		S_LOBBY:
			rows = [{"header": true, "label": "الغرفة — منفذ %d" % Config.NET_PORT}]
			var is_host := NetMgr.is_host()
			if is_host:
				var lobby: Array = NetMgr.lobby_roster()
				rows.append({"header": true, "label": "اللاعبون (%d)" % lobby.size()})
				for e in lobby:
					var nm := String(e.get("name", "لاعب"))
					if int(e.get("id", 0)) == NetMgr.local_id:
						nm += " (أنت)"
					rows.append({"label": nm, "hint": "فريق %d · %s" % [int(e.get("team", 0)) + 1, _op_name(String(e.get("op_key", "rashid")))],
						"icon": "team", "id": "noop", "color": M11UI.TEAL})
				var hint := "المباراة تبدأ فورًا" if lobby.size() > 1 else "ستلعب مع بوتات"
				rows.append({"label": "بدء المباراة", "hint": hint, "icon": "play", "id": "lan_start", "color": M11UI.GOLD})
				rows.append({"label": "معلومات الاتصال", "hint": "الجميع على نفس الشبكة", "id": "noop"})
			else:
				rows.append({"header": true, "label": "أنت: %s" % Config.player_name})
				var seen: Array = NetMgr.last_setup.get("roster", []) if NetMgr.last_setup is Dictionary else []
				for e in seen:
					var nm2 := String(e.get("name", "لاعب"))
					if int(e.get("id", 0)) == NetMgr.local_id:
						nm2 += " (أنت)"
					rows.append({"label": nm2, "hint": "فريق %d" % (int(e.get("team", 0)) + 1),
						"icon": "team", "id": "noop", "color": M11UI.TEXT_DIM})
				rows.append({"label": "بانتظار المضيف ليبدأ المباراة…", "hint": "اترك الشاشة مفتوحة", "icon": "play", "id": "noop", "color": M11UI.TEAL})
			rows.append({"label": "مغادرة الغرفة", "hint": "Esc", "icon": "back", "id": "lan_leave", "color": M11UI.RED})
		S_STATS:
			var s: Dictionary = Save.profile.get("stats", {})
			var ach: Array = Save.profile.get("achievements", [])
			rows = [
				{"header": true, "label": "ملخّص"},
				{"label": "المستوى %d — %s" % [int(Save.profile.get("level", 1)),
					String(Save.RANKS[clampi(int(Save.profile.get("rank", 0)), 0, Save.RANKS.size() - 1)]["name_ar"])], "icon": "trophy", "color": M11UI.GOLD},
				{"label": "الخبرة: %d نقطة" % int(Save.profile.get("xp", 0)), "id": "noop"},
				{"label": "قتلات: %d   موت: %d   مباريات: %d" % [int(s.get("kills", 0)), int(s.get("deaths", 0)), int(s.get("matches", 0))], "id": "noop"},
				{"label": "إحياءات: %d   مساعدات: %d" % [int(s.get("revives", 0)), int(s.get("assists", 0))], "id": "noop"},
				{"label": "أطول قتلة: %d مترًا" % int(s.get("longest_kill", 0)), "id": "noop"},
				{"label": "إنجازات مفتوحة: %d" % ach.size(), "id": "noop"},
				{"header": true, "label": "الإنجازات"},
			]
			for a in Save.ACHIEVEMENTS:
				var done: bool = ach.has(String(a["id"]))
				rows.append({"label": ("✔ " if done else "✖ ") + String(a["name_ar"]),
					"hint": String(a.get("desc_ar", "")), "id": "noop",
					"color": M11UI.GREEN if done else M11UI.TEXT_MUTED})
			rows.append({"label": "رجوع", "hint": "Esc", "icon": "back", "id": "back"})
		S_CREDITS:
			rows = [
				{"label": "كل الرسوم مولّدة برمجيًا (Python + Pillow)", "id": "noop", "icon": "star"},
				{"label": "كل الأصوات مولّدة برمجيًا (NumPy)", "id": "noop", "icon": "star"},
				{"label": "الخطوط: Cairo / Noto Sans Arabic / Press Start 2P", "id": "noop"},
				{"label": "رخصة الخطوط: SIL OFL 1.1", "id": "noop"},
				{"label": "لا إنترنت، لا حسابات، لا إعلانات، لا تتبّع", "id": "noop", "color": M11UI.TEAL},
				{"label": "رجوع", "hint": "Esc", "icon": "back", "id": "back"},
			]
		S_RESULTS:
			var win := int(result.get("winner_team", -1)) == 0
			var title := "فوز" if win else ("تعادل" if int(result.get("winner_team", -1)) == -1 else "خسارة")
			rows = [
				{"label": "%s — %d : %d" % [title, int(_scores()[0]), int(_scores()[1])],
					"hint": "النتيجة النهائية", "icon": "trophy", "color": M11UI.GOLD if win else M11UI.RED},
				{"label": "قتلاتك: %d   موتك: %d" % [int(result.get("player_kills", 0)), int(result.get("player_deaths", 0))], "id": "noop"},
				{"label": "الوضع: %s" % String(result.get("mode_name", Config.mode_id)), "id": "noop"},
				{"label": "الخريطة: %s" % String(result.get("map_name", Config.map_id)), "id": "noop"},
				{"label": "المدة: %s" % _fmt_time(float(result.get("time", 0.0))), "id": "noop"},
			]
			if result.has("xp"):
				var xp_gain := int(result.get("xp", 0))
				rows.append({"label": "الخبرة: +%d نقطة   ·   المستوى %d" % [xp_gain, int(result.get("level", 1))],
					"hint": Save.rank_name(), "icon": "star", "color": M11UI.TEAL})
			var unlocked: Array = result.get("unlocked", [])
			if not unlocked.is_empty():
				rows.append({"label": "إنجاز جديد!", "header": true})
				for ach in unlocked:
					var an := String(ach.get("name_ar", ach.get("id", "")))
					var ad := String(ach.get("desc_ar", ""))
					rows.append({"label": "%s — %s" % [an, ad], "id": "noop", "icon": "trophy", "color": M11UI.GOLD})
			var standings: Array = result.get("standings", [])
			if not standings.is_empty():
				rows.append({"label": "أفضل اللاعبين", "header": true})
				for i in mini(5, standings.size()):
					var st: Dictionary = standings[i]
					rows.append({"label": "%d. %s — %d قتلة / %d موت" % [i + 1, String(st.get("name", "?")),
						int(st.get("kills", 0)), int(st.get("deaths", 0))], "id": "noop",
						"color": M11UI.GOLD if bool(st.get("is_player", false)) else M11UI.TEXT})
			rows.append({"label": "رجوع", "hint": "Esc", "icon": "back", "id": "menu"})
			rows.append({"label": "مباراة أخرى", "icon": "play", "id": "rematch", "color": M11UI.TEAL})
		S_PAUSE:
			rows = [
				{"label": "استئناف اللعب", "hint": "أكمل المباراة", "icon": "play", "id": "resume", "color": M11UI.TEAL},
				{"label": "الإعدادات", "icon": "gear", "id": "settings"},
				{"label": "تخصيص التحكم", "icon": "gear", "id": "controls"},
				{"label": "إعادة المباراة", "icon": "map", "id": "rematch"},
				{"label": "الخروج للقائمة الرئيسية", "icon": "back", "id": "menu", "color": M11UI.RED},
			]
	return rows


func _scores() -> Array:
	var sc: Array = result.get("scores", [0, 0])
	if sc.size() < 2:
		return [0, 0]
	return sc


func _fmt_time(sec: float) -> String:
	var m := int(sec / 60.0)
	var s := int(fmod(sec, 60.0))
	return "%02d:%02d" % [m, s]


func _mode_hint(m: Dictionary, key: String) -> String:
	var bits: Array = []
	if int(m.get("teams", 1)) > 1:
		bits.append("فرق")
	else:
		bits.append("فردي")
	if not bool(m.get("respawn", true)):
		bits.append("بلا إعادة إحياء")
	if bool(m.get("zone", false)):
		bits.append("منطقة متقلّصة")
	if bool(m.get("loot", false)):
		bits.append("غنائم")
	bits.append(_fmt_time(float(m.get("time", 300))))
	return String(key) + " — " + " · ".join(bits)


func _op_name(key: String) -> String:
	for op in M11Data.OPERATORS:
		if String(op["key"]) == key:
			return String(op.get("name_ar", key))
	return key


func _weapon_name(id: String) -> String:
	var w: Dictionary = M11Data.WEAPONS.get(id, {})
	return String(w.get("name_ar", id))


func _screen_title() -> String:
	match screen:
		S_MAIN: return "ميكا ١١ — ساحة النار المحلية"
		S_MODES: return "أوضاع اللعب (%d)" % M11Data.MODES.size()
		S_MAPS: return "الخرائط (%d)" % GameWorld.MAPS.size()
		S_OPERATORS: return "المشغلون (%d)" % M11Data.OPERATORS.size()
		S_SETTINGS: return "الإعدادات"
		S_CONTROLS: return "تخصيص التحكم"
		S_LAN: return "الشبكة المحلية — منفذ %d" % Config.NET_PORT
		S_STATS: return "الإحصاءات والإنجازات"
		S_CREDITS: return "الائتمانات"
		S_RESULTS: return "نتيجة المباراة"
		S_PAUSE: return "إيقاف مؤقت"
		S_LOBBY: return "غرفة الشبكة المحلية"
	return "ميكا ١١"


func _screen_subtitle() -> String:
	match screen:
		S_MAIN: return "بلا إنترنت · بلا حسابات · بلا إعلانات"
		S_MODES: return "اختر وضعًا وابدأ فورًا"
		S_MAPS: return "كل خريطة تُولَّد إجرائيًا بنفس البذرة لكل اللاعبين"
		S_OPERATORS: return "١٠ مشغلين — كل مشغل بأسلوبه وزيّه"
		S_SETTINGS: return "تُحفظ كل القيم في جهازك تلقائيًا"
		S_CONTROLS: return "اضبط التحكم كما يناسب يدك"
		S_LAN: return "نقطة اتصال واحدة تكفي — لا يخرج أي شيء للإنترنت"
		S_STATS: return "تقدّمك محفوظ محليًا ومشفّر"
		S_CREDITS: return "كل شيء هنا صُنع من الصفر بالكود"
		S_RESULTS: return "أداءك في هذه المباراة"
		S_PAUSE: return "المباراة متوقفة — لا يستمر شيء خلفك"
		S_LOBBY: return "منفذ %d — على نفس الشبكة أو الهوت سبوت" % Config.NET_PORT
	return ""


func _title() -> String:
	return _screen_title()


# ---------------------------------------------------------------- الضغط
func _row_area(vp: Vector2) -> Rect2:
	var w: float = minf(vp.x * 0.52, 430.0)
	return Rect2(vp.x - w - MARGIN, HEADER_H + 6.0, w, vp.y - HEADER_H - FOOTER_H - 10.0)


func _row_step(vp: Vector2, n: int) -> float:
	var area := _row_area(vp)
	var want: float = clampf(area.size.y / maxf(1.0, float(n)), 20.0, 34.0)
	return want


func _content_height(vp: Vector2) -> float:
	var rows := _rows()
	var step := _row_step(vp, rows.size())
	var total := 0.0
	for r in rows:
		total += step if not bool(r.get("header", false)) else step * 0.82
	return total


func _max_scroll(vp: Vector2) -> float:
	return maxf(0.0, _content_height(vp) - _row_area(vp).size.y)


func _row_rects(vp: Vector2) -> Array:
	var rows := _rows()
	var area := _row_area(vp)
	var step := _row_step(vp, rows.size())
	var out: Array = []
	var y := area.position.y - scroll
	for i in rows.size():
		var h := step if not bool(rows[i].get("header", false)) else step * 0.82
		out.append({"rect": Rect2(area.position.x, y, area.size.x, h - 2.0), "row": rows[i], "index": i})
		y += h
	return out


func _hit(pos: Vector2) -> Dictionary:
	var vp := get_viewport().get_visible_rect().size
	# زر الرجوع أعلى اليسار
	if _back_visible() and _back_rect(vp).has_point(pos):
		return {"kind": "back"}
	if ip_edit != null and ip_edit.visible and ip_edit.get_global_rect().has_point(pos):
		return {"kind": "none"}
	for e in _row_rects(vp):
		if (e["rect"] as Rect2).has_point(pos):
			return {"kind": "row", "index": int(e["index"]), "row": e["row"]}
	return {"kind": "none"}


func _back_visible() -> bool:
	return screen != S_MAIN


func _back_rect(vp: Vector2) -> Rect2:
	return Rect2(MARGIN, 14.0, 96.0, 30.0)


func _activate_row(i: int) -> void:
	var rows := _rows()
	if i < 0 or i >= rows.size():
		return
	var row: Dictionary = rows[i]
	if bool(row.get("header", false)):
		return
	if row.has("id"):
		_act(String(row["id"]), row.get("arg", null))


func _act(id: String, arg: Variant = null) -> void:
	var main := _main_node()
	match id:
		"back":
			go_back()
		"quick":
			if main: main.start_match({"mode": Config.mode_id, "bots": Config.bot_count})
			visible = false
		"modes":
			show_screen(S_MODES)
		"maps":
			show_screen(S_MAPS)
		"operators":
			show_screen(S_OPERATORS)
		"lan":
			show_screen(S_LAN)
			host_list.clear()
			NetMgr.discover_hosts(3.0)
		"settings":
			show_screen(S_SETTINGS)
		"controls":
			show_screen(S_CONTROLS)
		"stats":
			show_screen(S_STATS)
		"credits":
			show_screen(S_CREDITS)
		"quit":
			if screen != S_MAIN:
				show_screen(S_MAIN)
			else:
				get_tree().quit()
		"mode":
			Config.mode_id = String(arg)
			Config.save_settings()
			toast("الوضع: %s" % String(M11Data.MODES.get(Config.mode_id, {}).get("name_ar", "")))
			go_back()
		"map":
			Config.map_id = String(arg)
			Config.save_settings()
			toast("الخريطة: %s" % String(GameWorld.MAPS.get(Config.map_id, {}).get("name_ar", "")))
			go_back()
		"op":
			Config.op_key = String(arg)
			Config.save_settings()
			toast("اخترت %s" % _op_name(Config.op_key))
		"skin":
			Config.skin_index = (int(Config.skin_index) + 1) % 4
			Config.save_settings()
		"primary":
			var po: Array = _primary_options()
			Config.loadout[0] = String(po[(po.find(Config.loadout[0]) + 1) % maxi(1, po.size())])
			Config.save_settings()
		"secondary":
			var so: Array = _secondary_options()
			Config.loadout[1] = String(so[(so.find(Config.loadout[1]) + 1) % maxi(1, so.size())])
			Config.save_settings()
		"throwable":
			Config.throwable = "shama" if Config.throwable == "grenade" else "grenade"
			Config.save_settings()
		"quality":
			Config.quality = (int(Config.quality) + 1) % 4
			Config.apply_runtime()
			Config.save_settings()
		"fps":
			Config.fps_limit = 0 if Config.fps_limit == 0 else (30 if Config.fps_limit == 120 else int(Config.fps_limit) + 30)
			Config.apply_runtime()
			Config.save_settings()
		"fullscreen":
			Config.desktop_fullscreen = not Config.desktop_fullscreen
			Config.save_settings()
		"postfx":
			Config.pc_post_fx = not Config.pc_post_fx
			Config.save_settings()
			if main and main.has_method("apply_graphics"): main.apply_graphics()
		"difficulty":
			Config.difficulty = (int(Config.difficulty) + 1) % 5
			Config.save_settings()
		"bots":
			Config.bot_count = 0 if int(Config.bot_count) >= 11 else int(Config.bot_count) + 1
			Config.save_settings()
		"ff":
			Config.friendly_fire = not Config.friendly_fire
			Config.save_settings()
		"autofire":
			Config.auto_fire = not Config.auto_fire
			Config.save_settings()
		"aimassist":
			Config.aim_assist = 0.0 if Config.aim_assist >= 0.99 else minf(1.0, float(Config.aim_assist) + 0.1)
			Config.save_settings()
		"volume":
			Config.master_volume = 0.0 if Config.master_volume >= 0.99 else minf(1.0, float(Config.master_volume) + 0.1)
			AudioBus._apply_bus_volumes()
			Config.save_settings()
		"music":
			Config.music_volume = 0.0 if Config.music_volume >= 0.99 else minf(1.0, float(Config.music_volume) + 0.1)
			AudioBus._apply_bus_volumes()
			Config.save_settings()
		"sfx":
			Config.sfx_volume = 0.0 if Config.sfx_volume >= 0.99 else minf(1.0, float(Config.sfx_volume) + 0.1)
			AudioBus._apply_bus_volumes()
			Config.save_settings()
		"vibration":
			Config.vibration = not Config.vibration
			Config.save_settings()
		"showfps":
			Config.show_fps = not Config.show_fps
			Config.save_settings()
		"save":
			Config.save_settings()
			toast("تم حفظ كل الإعدادات")
		"reset_defaults":
			Config.reset_defaults()
			toast("استُعيدت الإعدادات الافتراضية")
		"stickmode":
			Config.joystick_mode = "fixed" if Config.joystick_mode == "floating" else "floating"
			Config.save_settings()
		"sticksize":
			Config.stick_size = 46.0 if float(Config.stick_size) >= 84.0 else float(Config.stick_size) + 6.0
			Config.save_settings()
			_rebuild_touch()
		"btn_alpha":
			Config.button_alpha = 0.25 if Config.button_alpha >= 0.85 else minf(1.0, float(Config.button_alpha) + 0.1)
			Config.save_settings()
			_rebuild_touch()
		"gyro":
			Config.gyro_aim = not Config.gyro_aim
			Config.save_settings()
		"claw":
			Config.claw_layout = 2 if int(Config.claw_layout) >= 4 else int(Config.claw_layout) + 1
			Config.save_settings()
			_rebuild_touch()
		"lefthanded":
			Config.left_handed = not Config.left_handed
			Config.save_settings()
			_rebuild_touch()
		"reset_controls":
			Config.stick_size = 62.0
			Config.stick_alpha = 0.55
			Config.button_alpha = 0.6
			Config.claw_layout = 2
			Config.joystick_mode = "floating"
			Config.left_handed = false
			Config.aim_assist = 0.35
			Config.gyro_aim = false
			Config.save_settings()
			_rebuild_touch()
			toast("استُعيد التحكم الافتراضي")
		"host":
			if NetMgr.start_host(Config.player_name, Config.mode_id):
				show_screen(S_LOBBY)
				toast("الغرفة جاهزة — المنفذ %d" % Config.NET_PORT, 3.0)
			else:
				toast("تعذّر إنشاء الغرفة — تحقق من الشبكة والصلاحيات")
		"lan_start":
			if main and main.has_method("start_lan_match"):
				main.start_lan_match()
				visible = false
			else:
				toast("تعذّر بدء المباراة")
		"lan_leave":
			NetMgr.leave()
			if main and main.has_method("back_to_menu"):
				main.back_to_menu()
			show_screen(S_LAN, false)
			toast("غادرت الغرفة")
		"discover":
			host_list.clear()
			NetMgr.discover_hosts(3.0)
			toast("أبحث عن مضيف… (٣ ثوانٍ)")
		"manual":
			if ip_edit != null:
				ip_edit.grab_focus()
				toast("اكتب عنوان المضيف أسفل الشاشة ثم Enter")
		"join":
			var h: Dictionary = host_list[clampi(int(arg), 0, maxi(0, host_list.size() - 1))]
			if NetMgr.join_host(String(h.get("ip", "")), int(h.get("port", Config.NET_PORT))):
				show_screen(S_LOBBY)
				toast("جارٍ الاتصال بـ %s…" % String(h.get("host_name", "")), 4.0)
			else:
				toast("فشل الاتصال")
		"resume":
			if main and main.has_method("toggle_pause"):
				main.toggle_pause()
		"rematch":
			if NetMgr.is_host():
				if main and main.has_method("start_lan_match"):
					main.start_lan_match()
					visible = false
			elif NetMgr.is_client():
				toast("بانتظار المضيف لبدء مباراة جديدة")
			elif main and main.has_method("start_match"):
				main.start_match({"mode": String(result.get("mode", Config.mode_id))})
				visible = false
		"menu":
			if main and main.has_method("back_to_menu"):
				main.back_to_menu()
			else:
				show_screen(S_MAIN)
		"noop":
			pass


func _primary_options() -> Array:
	var out: Array = []
	for id in M11Data.WEAPONS.keys():
		if String(M11Data.WEAPONS[id].get("cls", "")) in ["ar", "smg", "sr", "shotgun", "lmg"]:
			out.append(String(id))
	return out


func _secondary_options() -> Array:
	var out: Array = []
	for id in M11Data.WEAPONS.keys():
		if String(M11Data.WEAPONS[id].get("cls", "")) in ["pistol", "melee"]:
			out.append(String(id))
	return out


func _rebuild_touch() -> void:
	var im := get_node_or_null("/root/Main/InputManager")
	if im != null and im.has_method("rebuild_buttons"):
		im.rebuild_buttons()


# ---------------------------------------------------------------- الإدخال
func _gui_input(event: InputEvent) -> void:
	if not visible:
		return
	if ip_edit != null and ip_edit.visible and ip_edit.has_focus():
		return
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_LEFT:
			_pointer_down(event.position)
			accept_event()
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			scroll = clampf(scroll + 20.0, 0.0, _max_scroll(get_viewport().get_visible_rect().size))
			accept_event()
		elif event.button_index == MOUSE_BUTTON_WHEEL_UP:
			scroll = clampf(scroll - 20.0, 0.0, _max_scroll(get_viewport().get_visible_rect().size))
			accept_event()
	elif event is InputEventMouseMotion:
		var hit := _hit(event.position)
		hover_index = int(hit.get("index", -1)) if String(hit.get("kind", "")) == "row" else -1
	elif event is InputEventScreenTouch:
		if event.pressed:
			_drag["active"] = true
			_drag["y"] = event.position.y
			_drag["scroll"] = scroll
			_drag["moved"] = false
		else:
			if not bool(_drag["moved"]):
				_pointer_down(event.position)
			_drag["active"] = false
	elif event is InputEventScreenDrag:
		if bool(_drag["active"]):
			var drag := event as InputEventScreenDrag
			var dy: float = drag.position.y - float(_drag["y"])
			if absf(dy) > 8.0:
				_drag["moved"] = true
			scroll = clampf(float(_drag["scroll"]) - dy, 0.0, _max_scroll(get_viewport().get_visible_rect().size))


func _pointer_down(pos: Vector2) -> void:
	var f := Engine.get_process_frames()
	if f == _last_pointer_frame:
		return
	_last_pointer_frame = f
	var hit := _hit(pos)
	match String(hit.get("kind", "")):
		"back":
			go_back()
		"row":
			index = int(hit["index"])
			_activate_row(index)


func _unhandled_input(event: InputEvent) -> void:
	if not visible:
		return
	if ip_edit != null and ip_edit.visible and ip_edit.has_focus():
		return
	var rows := _rows()
	var count := maxi(1, rows.size())
	if event.is_action_pressed("ui_down"):
		index = _next_selectable(index, 1, rows)
		_ensure_visible()
	elif event.is_action_pressed("ui_up"):
		index = _next_selectable(index, -1, rows)
		_ensure_visible()
	elif event.is_action_pressed("ui_accept"):
		_activate_row(index)
	elif event.is_action_pressed("ui_cancel") or event.is_action_pressed("pause"):
		# زر الرجوع في أندرويد و Esc: يتصرف حسب الشاشة الحالية
		if screen == S_PAUSE:
			if main_ref != null and main_ref.has_method("toggle_pause"):
				main_ref.toggle_pause()
		elif screen == S_RESULTS:
			if main_ref != null and main_ref.has_method("back_to_menu"):
				main_ref.back_to_menu()
		else:
			go_back()
		get_viewport().set_input_as_handled()
	elif event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F11:
		return


func _next_selectable(from: int, dir: int, rows: Array) -> int:
	var i := from
	for _k in rows.size():
		i = (i + dir + rows.size()) % rows.size()
		if not bool(rows[i].get("header", false)):
			return i
	return from


func _ensure_visible() -> void:
	var vp := get_viewport().get_visible_rect().size
	var rects := _row_rects(vp)
	var area := _row_area(vp)
	if index < 0 or index >= rects.size():
		return
	var r: Rect2 = rects[index]["rect"]
	if r.position.y < area.position.y:
		scroll = maxf(0.0, scroll - (area.position.y - r.position.y) - 6.0)
	elif r.end.y > area.end.y:
		scroll = minf(_max_scroll(vp), scroll + (r.end.y - area.end.y) + 6.0)


# ---------------------------------------------------------------- الحلقة والرسم
func _process(dt: float) -> void:
	t += dt
	message_life = maxf(0.0, message_life - dt)
	if ip_edit != null:
		var on_lan := visible and screen == S_LAN
		if ip_edit.visible != on_lan:
			ip_edit.visible = on_lan
		if not on_lan and ip_edit.has_focus():
			ip_edit.release_focus()
		if on_lan:
			var vp := get_viewport().get_visible_rect().size
			ip_edit.size = Vector2(minf(330.0, maxf(180.0, vp.x - 380.0)), 34)
			ip_edit.position = Vector2(MARGIN, vp.y - 46.0)
	queue_redraw()


func _draw() -> void:
	if not visible:
		return
	var vp := get_viewport().get_visible_rect().size
	# ---------- الخلفية الفنية ----------
	M11UI.gradient_rect(self, Rect2(Vector2.ZERO, vp), Color(0.05, 0.08, 0.12), M11UI.BG)
	var art := _art_for_screen()
	if art != null:
		M11UI.draw_cover(self, art, Rect2(Vector2.ZERO, vp), 0.72 if screen == S_MAIN else 0.5)
	# ستارتان: سفلية + يمينية (القائمة على اليمين) لقراءة النص فوق أي صورة
	M11UI.gradient_rect(self, Rect2(0, vp.y * 0.45, vp.x, vp.y * 0.55),
		Color(0.02, 0.03, 0.05, 0.0), Color(0.02, 0.03, 0.05, 0.88))
	draw_rect(Rect2(vp.x * 0.46, 0, vp.x * 0.54, vp.y), Color(0.02, 0.03, 0.05, 0.42))
	# طبقات جبال متحركة خفيفة (هوية اللعبة)
	for l in 4:
		var off := fmod(t * (5.0 + l * 2.0), 220.0)
		var col := Color(0.07 + l * 0.018, 0.10 + l * 0.02, 0.14 + l * 0.024, 0.55)
		var pts := PackedVector2Array([Vector2(0, vp.y)])
		var x := -200.0
		while x < vp.x + 200.0:
			var y := vp.y - 46.0 - l * 9.0 + sin((x + off) * 0.012 + l * 1.7) * 16.0
			pts.append(Vector2(x, y))
			x += 18.0
		pts.append(Vector2(vp.x + 200.0, vp.y))
		draw_colored_polygon(pts, col)

	# ---------- الترويسة ----------
	if _back_visible():
		_draw_back_chip(vp)
	M11UI.text(self, M11UI.FONT_BOLD, _screen_title(), Vector2(vp.x - MARGIN, 30),
		18, M11UI.GOLD, HORIZONTAL_ALIGNMENT_RIGHT, vp.x - 150)
	M11UI.text(self, M11UI.FONT_REG, _screen_subtitle(), Vector2(vp.x - MARGIN, 46),
		11, M11UI.TEXT_DIM, HORIZONTAL_ALIGNMENT_RIGHT, vp.x - 150)

	# ---------- معاينات الشاشات ----------
	if screen == S_MAPS:
		_draw_map_preview(vp)
	elif screen == S_OPERATORS:
		_draw_operator_preview(vp)
	elif screen == S_RESULTS:
		_draw_results_banner(vp)
	elif screen == S_MAIN:
		_draw_main_brand(vp)
	elif screen == S_PAUSE:
		draw_rect(Rect2(Vector2.ZERO, vp), Color(0.02, 0.03, 0.05, 0.55))

	# ---------- الصفوف ----------
	var area := _row_area(vp)
	var rows := _rows()
	var rects := _row_rects(vp)
	M11UI.panel(self, Rect2(area.position - Vector2(6, 6), area.size + Vector2(12, 12)),
		Color(0.02, 0.03, 0.05, 0.55), Color(0.95, 0.76, 0.31, 0.16))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	for e in rects:
		var r: Rect2 = e["rect"]
		if r.position.y < area.position.y - 2.0 or r.end.y > area.end.y + 2.0:
			continue
		_draw_row(r, e["row"], int(e["index"]))

	if _max_scroll(vp) > 0.5:
		var track := Rect2(area.end.x + 2.0, area.position.y, 3.0, area.size.y)
		draw_rect(track, Color(0.3, 0.36, 0.4, 0.35))
		var frac: float = area.size.y / maxf(1.0, _content_height(vp))
		var knob_h: float = maxf(18.0, track.size.y * frac)
		var knob_y: float = track.position.y + (scroll / maxf(1.0, _max_scroll(vp))) * (track.size.y - knob_h)
		draw_rect(Rect2(track.position.x, knob_y, track.size.x, knob_h), Color(0.95, 0.76, 0.31, 0.8))

	# ---------- التذييل ----------
	M11UI.text(self, M11UI.FONT_REG, "الأسهم للتنقل · Enter للاختيار · Esc للرجوع",
		Vector2(MARGIN, vp.y - 14), 10, M11UI.TEXT_MUTED, HORIZONTAL_ALIGNMENT_LEFT, vp.x * 0.5)
	var prof: Dictionary = Save.profile
	var rank_name := "مقاتل"
	if typeof(prof) == TYPE_DICTIONARY and prof.has("rank"):
		var ri := clampi(int(prof.get("rank", 0)), 0, Save.RANKS.size() - 1)
		rank_name = String(Save.RANKS[ri]["name_ar"])
	M11UI.text(self, M11UI.FONT_REG, "%s — %s · المستوى %d" % [String(Config.player_name), rank_name, int(prof.get("level", 1)) if typeof(prof) == TYPE_DICTIONARY else 1],
		Vector2(vp.x - MARGIN, vp.y - 14), 10, M11UI.GOLD, HORIZONTAL_ALIGNMENT_RIGHT, vp.x * 0.55)

	# ---------- الرسائل ----------
	if message_life > 0.0:
		var a: float = clampf(message_life, 0.0, 1.0)
		var w2: float = minf(vp.x - 40.0, M11UI.width(M11UI.FONT_BOLD, message, 13) + 34.0)
		M11UI.panel(self, Rect2(vp.x * 0.5 - w2 * 0.5, vp.y - 74, w2, 26),
			Color(0.02, 0.03, 0.05, 0.92 * a), Color(0.95, 0.76, 0.31, 0.5 * a))
		M11UI.text(self, M11UI.FONT_BOLD, message, Vector2(vp.x * 0.5 + w2 * 0.5 - 14, vp.y - 56),
			12, Color(0.95, 0.76, 0.31, a), HORIZONTAL_ALIGNMENT_RIGHT, w2 - 24)


func _art_for_screen() -> Texture2D:
	var art: Texture2D = poster
	match screen:
		S_MAIN, S_MODES: art = hero_art if hero_art != null else key_art
		S_MAPS: art = key_art if key_art != null else hero_art
		S_LAN, S_OPERATORS, S_LOBBY: art = naval_art if naval_art != null else key_art
		S_RESULTS:
			var won := int(result.get("winner_team", -1)) == 0
			art = p_victory if won else p_defeat
	if art == null:
		art = key_art if key_art != null else poster
	return art


func _draw_back_chip(vp: Vector2) -> void:
	var r := _back_rect(vp)
	M11UI.panel(self, r, Color(0.03, 0.05, 0.07, 0.85), Color(0.95, 0.76, 0.31, 0.55),
		Color(0.95, 0.76, 0.31, 0.9), 3.0)
	M11UI.icon(self, "back", Vector2(r.end.x - 18, r.position.y + r.size.y * 0.5), 12.0, M11UI.GOLD)
	M11UI.text(self, M11UI.FONT_BOLD, "رجوع", Vector2(r.end.x - 30, r.position.y + r.size.y * 0.5 + 5),
		13, M11UI.TEXT, HORIZONTAL_ALIGNMENT_RIGHT, 60.0)


func _draw_main_brand(vp: Vector2) -> void:
	var x := vp.x * 0.5 - 40.0
	M11UI.text(self, M11UI.FONT_BOLD, "ميكا ١١", Vector2(x, 120), 34, M11UI.GOLD, HORIZONTAL_ALIGNMENT_CENTER, vp.x * 0.5)
	M11UI.text(self, M11UI.FONT_REG, "ساحة النار المحلية", Vector2(x, 146), 14, M11UI.TEXT, HORIZONTAL_ALIGNMENT_CENTER, vp.x * 0.5)
	draw_rect(Rect2(x - 70, 158, 140, 2), Color(0.31, 0.82, 0.77, 0.8))
	M11UI.text(self, M11UI.FONT_REG, "١٩ وضعًا · ١٩ خريطة · ٢٨ سلاحًا · ١٠ مشغلين",
		Vector2(x, 176), 11, M11UI.TEXT_DIM, HORIZONTAL_ALIGNMENT_CENTER, vp.x * 0.55)


func _draw_row(r: Rect2, row: Dictionary, i: int) -> void:
	var selected: bool = i == index or i == hover_index
	var header: bool = bool(row.get("header", false))
	if header:
		var label := "— %s —" % String(row.get("label", ""))
		M11UI.text(self, M11UI.FONT_BOLD, label, Vector2(r.end.x - 6, r.position.y + r.size.y * 0.72),
			10, M11UI.TEAL, HORIZONTAL_ALIGNMENT_RIGHT, r.size.x - 8)
		draw_rect(Rect2(r.position.x, r.end.y - 1, r.size.x, 1), Color(0.31, 0.82, 0.77, 0.18))
		return
	var col: Color = row.get("color", M11UI.TEXT)
	var fill := Color(0.05, 0.07, 0.09, 0.72)
	if selected:
		fill = Color(0.19, 0.15, 0.06, 0.88)
	elif i % 2 == 1:
		fill = Color(0.04, 0.055, 0.07, 0.62)
	draw_rect(r, fill)
	if selected:
		draw_rect(Rect2(r.end.x - 3, r.position.y, 3, r.size.y), M11UI.GOLD)
	# أيقونة/مصغّرة على اليمين
	var right := r.end.x - 8.0
	if row.has("thumb") and row["thumb"] is Texture2D:
		var th: Texture2D = row["thumb"]
		var tw := 34.0
		var thh := 20.0
		draw_rect(Rect2(r.end.x - tw - 6, r.position.y + (r.size.y - thh) * 0.5, tw, thh), Color(0, 0, 0, 0.6))
		draw_texture_rect(th, Rect2(r.end.x - tw - 6, r.position.y + (r.size.y - thh) * 0.5, tw, thh), false)
		right -= tw + 10.0
	elif row.has("portrait") and row["portrait"] is Texture2D:
		var pt: Texture2D = row["portrait"]
		var ph := minf(r.size.y - 4.0, 26.0)
		var pw := ph * 0.75
		draw_texture_rect(pt, Rect2(r.end.x - pw - 6, r.position.y + (r.size.y - ph) * 0.5, pw, ph), false)
		right -= pw + 10.0
	elif row.has("icon"):
		M11UI.icon(self, String(row["icon"]), Vector2(r.end.x - 18, r.position.y + r.size.y * 0.5), 13.0,
			M11UI.GOLD if selected else M11UI.TEXT_DIM)
		right -= 26.0
	# النص
	var fs: int = clampi(int(r.size.y * 0.5), 10, 15)
	var label := String(row.get("label", ""))
	var hint := String(row.get("hint", ""))
	var hint_w: float = 0.0
	if hint != "":
		hint_w = minf(r.size.x * 0.42, M11UI.width(M11UI.FONT_REG, hint, 9) + 8.0)
		M11UI.text(self, M11UI.FONT_REG, hint, Vector2(r.position.x + 10, r.position.y + r.size.y * 0.5 + 4),
			9, M11UI.TEXT_MUTED if not selected else M11UI.GOLD_DIM, HORIZONTAL_ALIGNMENT_LEFT, hint_w)
	var label_w: float = maxf(50.0, right - (r.position.x + hint_w + 14.0))
	M11UI.text(self, M11UI.FONT_BOLD if selected else M11UI.FONT_REG, label,
		Vector2(right, r.position.y + r.size.y * 0.5 + fs * 0.36), fs,
		col if selected else col.darkened(0.08), HORIZONTAL_ALIGNMENT_RIGHT, label_w)


func _draw_map_preview(vp: Vector2) -> void:
	var key := Config.map_id
	var rows := _rows()
	if index >= 0 and index < rows.size() and rows[index].has("arg") and String(rows[index].get("id", "")) == "map":
		key = String(rows[index]["arg"])
	var tex: Texture2D = thumbs.get(key)
	var area := Rect2(MARGIN, HEADER_H + 20.0, vp.x * 0.42, vp.x * 0.42 * 0.5625)
	if tex != null:
		M11UI.panel(self, area.grow(4.0), Color(0.02, 0.03, 0.05, 0.9), Color(0.95, 0.76, 0.31, 0.55))
		draw_texture_rect(tex, area, false)
	var md: Dictionary = GameWorld.MAPS.get(key, {})
	M11UI.text(self, M11UI.FONT_BOLD, String(md.get("name_ar", "")),
		Vector2(area.end.x, area.end.y + 24), 16, M11UI.GOLD, HORIZONTAL_ALIGNMENT_RIGHT, area.size.x)
	M11UI.text(self, M11UI.FONT_REG, "%d×%d بكسل · الثيم %s" % [int(md.get("w", 0)), int(md.get("h", 0)), String(md.get("theme", ""))],
		Vector2(area.end.x, area.end.y + 42), 10, M11UI.TEXT_DIM, HORIZONTAL_ALIGNMENT_RIGHT, area.size.x)
	M11UI.text(self, M11UI.FONT_REG, "تُولَّد إجرائيًا بنفس البذرة لكل اللاعبين",
		Vector2(area.end.x, area.end.y + 58), 9, M11UI.TEXT_MUTED, HORIZONTAL_ALIGNMENT_RIGHT, area.size.x)


func _draw_operator_preview(vp: Vector2) -> void:
	var key := Config.op_key
	var rows := _rows()
	if index >= 0 and index < rows.size() and String(rows[index].get("id", "")) == "op":
		key = String(rows[index].get("arg", key))
	var tex: Texture2D = portraits.get(key)
	var area := Rect2(MARGIN, HEADER_H + 24.0, 112.0, 150.0)
	M11UI.panel(self, area.grow(4.0), Color(0.02, 0.03, 0.05, 0.9), Color(0.95, 0.76, 0.31, 0.55))
	if tex != null:
		M11UI.draw_contain(self, tex, area, 1.0)
	var info: Dictionary = {}
	for op in M11Data.OPERATORS:
		if String(op["key"]) == key:
			info = op
			break
	M11UI.text(self, M11UI.FONT_BOLD, String(info.get("name_ar", key)),
		Vector2(area.end.x, area.end.y + 24), 16, M11UI.GOLD, HORIZONTAL_ALIGNMENT_RIGHT, area.size.x)
	var bio := String(info.get("bio", "")).split("\n")
	var y := area.end.y + 42.0
	for line in bio:
		if y > vp.y - 60.0:
			break
		M11UI.text(self, M11UI.FONT_REG, String(line), Vector2(area.end.x, y), 9, M11UI.TEXT_DIM,
			HORIZONTAL_ALIGNMENT_RIGHT, area.size.x)
		y += 13.0


func _draw_results_banner(vp: Vector2) -> void:
	var won := int(result.get("winner_team", -1)) == 0
	M11UI.text(self, M11UI.FONT_BOLD, "فوز" if won else ("تعادل" if int(result.get("winner_team", -1)) == -1 else "خسارة"),
		Vector2(vp.x * 0.5 - 40, 122), 30, M11UI.GREEN if won else M11UI.RED,
		HORIZONTAL_ALIGNMENT_CENTER, vp.x * 0.5)
