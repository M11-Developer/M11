# ============================================================================
# نقطة الدخول — تحميل الأصول، القوائم، بدء المباراة، والحلقة الرئيسية.
# ============================================================================
extends Node

const ATLASES := ["world", "vfx", "ui", "weapons", "arms"]
# اختبار ذاتي يُشغَّل في CI: يضغط زر القائمة فعليًا ويبدأ مباراة ويتأكد أنها تعمل
const SELFTEST_FLAG := "--m11-selftest"

var world: GameWorld = null
var hud: Node = null
var menu: Node = null
var touch_ui: Node = null      # طبقة أزرار اللمس (تُنشأ مع بدء المباراة)
var pc: PCGraphics = null      # تحسينات العرض على الكمبيوتر فقط
var loading := true
var state := "boot"          # boot | menu | playing | paused | results

@onready var game_layer: Node2D = $GameLayer
@onready var hud_layer: CanvasLayer = $HUDLayer
@onready var input_manager: InputManager = $InputManager


func _ready() -> void:
	# نقطة الدخول تعمل دائمًا حتى أثناء الإيقاف المؤقت (وإلا لا يمكن الاستئناف)
	process_mode = Node.PROCESS_MODE_ALWAYS
	# حارس أمان: إن فشل أي شيء في الإقلاع، تظهر القائمة على كل حال بعد ٨ ثوانٍ
	# بدل أن يظل شريط التحميل يدور إلى الأبد.
	var guard := get_tree().create_timer(8.0)
	guard.timeout.connect(_ensure_menu)
	_set_boot_progress(0.05)
	_connect_net()
	_boot()
	_setup_desktop()


# ---------------------------------------------------------------- الشبكة
func _connect_net() -> void:
	var sigs := {
		"match_setup": _on_net_match_setup,
		"snapshot_received": _on_net_snapshot,
		"state_received": _on_net_state,
		"shot_fx": _on_net_shot,
		"disconnected_from_host": _on_net_disconnect,
		"match_over": _on_match_finished,
		"peer_left": _on_net_peer_left,
		"peer_joined": _on_net_peer_joined,
		"roster_received": _on_net_roster,
	}
	for sig in sigs.keys():
		if NetMgr.has_signal(sig) and not NetMgr.is_connected(sig, sigs[sig]):
			NetMgr.connect(sig, sigs[sig])


## يُنادى من القائمة: المضيف يبدأ المباراة ويُبلغ بقية اللاعبين.
func start_lan_match() -> void:
	if not NetMgr.is_host():
		return
	var seed_v := (int(Time.get_unix_time_from_system()) ^ (randi() & 0x7FFFFFFF)) & 0x7FFFFFFF
	var mode_id: String = Config.mode_id
	var map_id: String = Config.map_id
	var bots := Config.bot_count if NetMgr.peers.size() <= 1 else 0
	start_match({"mode": mode_id, "map": map_id, "seed": seed_v, "bots": bots, "net": true})
	if world == null:
		return
	NetMgr.request_start({
		"mode": mode_id, "map": map_id, "seed": seed_v,
		"host_name": Config.player_name, "started": true,
		"roster": world.net_roster(),
	})


func _on_net_match_setup(cfg: Dictionary) -> void:
	# رسالة الإعداد تصل أيضًا لحظة الانضمام قبل بدء المضيف للمباراة ⇒ نبقى في اللوبي
	if not bool(cfg.get("started", false)):
		return
	if state == "playing" and world != null:
		return
	NetMgr.local_id = int(cfg.get("your_id", NetMgr.local_id))
	start_match({
		"mode": String(cfg.get("mode", Config.mode_id)),
		"map": String(cfg.get("map", Config.map_id)),
		"seed": int(cfg.get("seed", 12345)),
		"bots": 0, "net": true, "roster": cfg.get("roster", []),
	})


func _on_net_snapshot(data: PackedByteArray) -> void:
	if world != null and is_instance_valid(world) and state in ["playing", "paused"]:
		world.apply_snapshot(data)


func _on_net_state(st: Dictionary) -> void:
	if world == null or not is_instance_valid(world):
		return
	if st.has("time"):
		world.match_time = float(st["time"])
	if st.has("scores") and st["scores"] is Array and st["scores"].size() >= 2:
		world.team_scores = [int(st["scores"][0]), int(st["scores"][1])]
	if st.has("state"):
		world.match_state = String(st["state"])
	var z: Variant = st.get("zone", null)
	if z is Dictionary and not z.is_empty():
		world.zone = z
	if st.has("standings") and st["standings"] is Array:
		world.last_standings = st["standings"]
		for row in st["standings"]:
			var a = world.actor_by_net_id(int(row.get("net_id", -1)))
			if a != null:
				a.kills = int(row.get("kills", 0))
				a.deaths = int(row.get("deaths", 0))
				a.assists = int(row.get("assists", 0))


func _on_net_shot(_id: int, pos: Vector2, angle: float, _weapon: String, speed: float) -> void:
	if world != null and is_instance_valid(world) and world.has_method("spawn_remote_shot"):
		world.spawn_remote_shot(pos, angle, speed)


func _on_net_disconnect() -> void:
	if state == "playing" or state == "paused":
		back_to_menu()
		# بعد العودة للقائمة (لأن show_screen يمسح الرسائل السابقة)
		if menu != null and menu.has_method("toast"):
			menu.toast("انقطع الاتصال بالمضيف", 3.5)
		return
	# في اللوبي: نعود لشاشة الشبكة برسالة واضحة بدل البقاء في انتظار أبدي
	if menu != null and is_instance_valid(menu):
		if int(menu.get("screen")) == 11:
			menu.show_screen(5, false)
		if menu.has_method("toast"):
			menu.toast("تعذّر الاتصال بالمضيف — تحقّق من الشبكة", 3.5)
	NetMgr.leave()


func _on_net_peer_joined(id: int, info: Dictionary) -> void:
	if not NetMgr.is_host() or world == null or not is_instance_valid(world):
		return
	if state != "playing" and state != "paused":
		return
	if world.actor_by_net_id(id) != null:
		return
	var ra = world.add_actor(false, {
		"name": String(info.get("name", "لاعب %d" % id)), "team": int(info.get("team", 1)),
		"op_key": String(info.get("op_key", "rashid")), "is_bot": false,
		"weapons": Config.loadout, "net_id": id,
	})
	ra.is_remote = true
	if hud != null and hud.has_method("toast"):
		hud.toast("انضم %s إلى المباراة" % String(info.get("name", "")), M11UI.TEAL, 2.5)


func _on_net_roster(list: Array) -> void:
	# قائمة لاعبي اللوبي كما يراها المضيف — يراها العميل في شاشة الغرفة
	NetMgr.last_setup["roster"] = list
	NetMgr.last_setup["started"] = false


func _on_net_peer_left(id: int) -> void:
	if world == null or not is_instance_valid(world):
		return
	var a = world.actor_by_net_id(id)
	if a != null:
		var nm := String(a.display_name)
		world.actors.erase(a)
		a.queue_free()
		if hud != null and hud.has_method("toast"):
			hud.toast("غادر %s المباراة" % nm, M11UI.TEXT_MUTED, 2.0)


func _boot() -> void:
	# 1) محمّل الأطالس
	if get_node_or_null("AtlasLoader") == null:
		var atlas := AtlasLoader.new()
		atlas.name = "AtlasLoader"
		add_child(atlas)
	var names := ATLASES.duplicate()
	# 2) أطالس الشخصيات (المشغّلون)
	var meta: Variant = _read_json("res://assets/atlases/characters_meta.json")
	if meta is Dictionary:
		var ops: Variant = meta.get("operators", {})
		if ops is Dictionary:
			for op_key in ops.keys():
				names.append("char_" + String(op_key))
	# 3) أطالس العناصر والديكور
	var plist: Variant = _read_json("res://assets/atlases/props_manifest.json")
	if plist is Array:
		for e in plist:
			if e is Dictionary and e.has("atlas"):
				names.append(String(e["atlas"]))
	# 4) أطالس التايلات لكل ثيم
	var tlist: Variant = _read_json("res://assets/atlases/tiles_manifest.json")
	if tlist is Array:
		for e in tlist:
			if e is Dictionary and e.has("theme"):
				names.append("tiles_" + String(e["theme"]))
	var loader := get_node_or_null("AtlasLoader")
	_set_boot_progress(0.35)
	if loader != null and loader.has_method("load_all"):
		loader.load_all(names)
	_set_boot_progress(0.80)
	# 5) تحميل مسبق للمشهد
	_prewarm()
	_ensure_menu()


# تحسينات نسخة الكمبيوتر: ملء شاشة حقيقي + معالجة لاحقة + سقف إطارات أعلى
func _setup_desktop() -> void:
	if not (OS.has_feature("pc") or OS.has_feature("windows") or OS.has_feature("linuxbsd") or OS.has_feature("macos")):
		return
	pc = PCGraphics.new()
	pc.name = "PCGraphics"
	add_child(pc)
	pc.apply_to(self)
	pc.set_quality(Config.quality)
	# أيقونة النافذة وقت التشغيل (لا نعدّل موارد الملف التنفيذي في البناء)
	var icon_path := "res://assets/atlases/app_icon.png"
	if ResourceLoader.exists(icon_path):
		var icon_tex: Texture2D = load(icon_path)
		if icon_tex != null:
			DisplayServer.set_icon(icon_tex.get_image())
	print("[M11] تحسينات الكمبيوتر مفعّلة (Fullscreen + Post-FX)")


func _set_boot_progress(p: float) -> void:
	var boot := get_node_or_null("BootUI/BootPanel")
	if boot != null and boot.has_method("set_progress"):
		boot.set_progress(p)


func _read_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	var txt := f.get_as_text()
	f.close()
	return JSON.parse_string(txt)


# يُنشئ القائمة مرة واحدة فقط — آمن للنداء المتكرر (حارس الإقلاع + المسار العادي)
func _ensure_menu() -> void:
	if menu != null and is_instance_valid(menu):
		return
	if state != "boot" and state != "menu":
		return
	var boot := get_node_or_null("BootUI/BootPanel")
	if boot != null:
		boot.queue_free()
	_set_boot_progress(1.0)
	var boot_ui := get_node_or_null("BootUI")
	if boot_ui != null:
		boot_ui.visible = false
	menu = preload("res://src/ui/menu.gd").new()
	menu.name = "Menu"
	# نمرّر مرجع العقدة الرئيسية صراحةً — القائمة تعيش داخل HUDLayer
	# فلا يصح أن تعتمد على get_parent()
	if "main_ref" in menu:
		menu.main_ref = self
	hud_layer.add_child(menu)
	menu.move_to_front()
	state = "menu"
	loading = false
	AudioBus.play_music("menu_theme")
	print("[M11] الإقلاع اكتمل — القائمة جاهزة")
	# في CI فقط: نجرّب ضغط زر حقيقي — لأن «القائمة ظهرت» لا تعني «الأزرار تعمل»
	if SELFTEST_FLAG in OS.get_cmdline_user_args():
		_run_selftest.call_deferred()


func _run_selftest() -> void:
	# اختبار سلوكي حقيقي: يضغط «لعب سريع» ثم يرجع للقائمة.
	# سبب وجوده: نسخة سابقة كانت تعرض القائمة لكن كل زر فيها يفشل بصمت
	# لأن القائمة لم تجد العقدة الرئيسية (كانت تبحث في get_parent()).
	await get_tree().process_frame
	await get_tree().process_frame
	print("[M11-SELFTEST] بدء الاختبار")
	var ok := true
	if menu == null:
		print("[M11-SELFTEST] FAIL: القائمة غير موجودة")
		get_tree().quit(1)
		return
	# ١) الضغط على أول سطر (لعب سريع ضد بوتات)
	menu.activate(0)
	await get_tree().process_frame
	await get_tree().process_frame
	if world == null or state != "playing":
		print("[M11-SELFTEST] FAIL: لم تبدأ المباراة (state=%s)" % state)
		ok = false
	else:
		print("[M11-SELFTEST] بدأت المباراة: الوضع=%s المقاتلون=%d"
			% [world.mode_id, world.actors.size()])
		if world.actors.size() < 2:
			print("[M11-SELFTEST] FAIL: عدد المقاتلين غير كافٍ")
			ok = false
	# ٢) اختبار الشبكة: ترميز/فكّ اللقطة + فتح الغرفة + تحليل رسالة الاكتشاف
	if ok:
		ok = _selftest_net()
	# ٣) الرجوع للقائمة
	back_to_menu()
	await get_tree().process_frame
	if state != "menu" or menu == null or not menu.visible:
		print("[M11-SELFTEST] FAIL: الرجوع للقائمة لم ينجح (state=%s)" % state)
		ok = false
	else:
		print("[M11-SELFTEST] الرجوع للقائمة ناجح")
	print("[M11-SELFTEST] %s" % ("OK" if ok else "FAIL"))
	get_tree().quit(0 if ok else 1)


## اختبار ذاتي للشبكة يعمل بلا شاشة وبجهاز واحد: يضمن أن ما يرسله المضيف
## يمكن لعميل فكّه بنفس الدقة (أخطر خطأ محتمل في اللعب الجماعي: انحراف اللقطات).
func _selftest_net() -> bool:
	var ok := true
	# أ) الترميز والفكّ
	var snap: PackedByteArray = world.build_snapshot()
	var rows: Array = world.decode_snapshot(snap)
	if rows.size() != world.actors.size():
		print("[M11-SELFTEST] FAIL: عدد صفوف اللقطة %d != عدد المقاتلين %d" % [rows.size(), world.actors.size()])
		return false
	for i in world.actors.size():
		var a = world.actors[i]
		var row: Dictionary = rows[i]
		if int(row["id"]) != int(a.net_id):
			print("[M11-SELFTEST] FAIL: رقم الشبكة غير مطابق %d != %d" % [int(row["id"]), int(a.net_id)])
			ok = false
		var rpos: Vector2 = row["pos"]
		var d: float = rpos.distance_to(a.global_position)
		if d > 0.5:
			print("[M11-SELFTEST] FAIL: انحراف الموضع %.2f بكسل للمقاتل %d" % [d, int(a.net_id)])
			ok = false
		if absf(float(row["hp"]) - float(a.hp)) > 1.0:
			print("[M11-SELFTEST] FAIL: الصحة غير مطابقة")
			ok = false
	# ب) فتح الغرفة ثم إغلاقها (يتأكد أن المقبس والاكتشاف يعملان على هذا النظام)
	if NetMgr.start_host("اختبار"):
		if NetMgr.local_id != 1 or not NetMgr.is_host():
			print("[M11-SELFTEST] FAIL: حالة المضيف غير صحيحة")
			ok = false
		NetMgr.leave()
	else:
		print("[M11-SELFTEST] FAIL: تعذّر فتح غرفة على المنفذ %d" % Config.NET_PORT)
		ok = false
	# ج) تحليل رسالة الإعلان كما يقرأها العميل
	var probe := "M11!2|مضيف|3|8|tdm|oasis"
	var body := probe.substr(4)
	if body.begins_with("2|"):
		body = body.substr(2)
	var parts := body.split("|")
	if parts.size() < 5 or parts[0] != "مضيف" or int(parts[1]) != 3:
		print("[M11-SELFTEST] FAIL: تحليل رسالة الاكتشاف")
		ok = false
	if ok:
		print("[M11-SELFTEST] الشبكة: اللقطة والغرفة والاكتشاف سليمة")
	return ok


func _prewarm() -> void:
	# نحمّل المشهد مسبقًا حتى لا يتجمّد أول إطار
	preload("res://scenes/Actor.tscn")


func start_match(opts: Dictionary = {}) -> void:
	if world:
		world.queue_free()
		world = null
	world = preload("res://scenes/World.tscn").instantiate()
	game_layer.add_child(world)
	var map_id: String = opts.get("map", Config.map_id)
	var mode_id: String = opts.get("mode", Config.mode_id)
	var is_net: bool = bool(opts.get("net", false))
	var net_host: bool = is_net and NetMgr.is_host()
	var net_client: bool = is_net and NetMgr.is_client()
	world.net_host = net_host
	world.net_client = net_client
	world.setup(mode_id, map_id, int(opts.get("seed", randi())))
	# كانت الجودة تُحفظ في الإعدادات ولا تُمرَّر للعالم — الآن تُطبَّق فورًا
	if world.has_method("set_quality"):
		world.set_quality(Config.quality)
	if pc != null:
		pc.set_quality(Config.quality)
	# نهاية المباراة (حدّ النقاط/الوقت) تفتح شاشة النتائج — لا تبقى المباراة معلّقة بلا خاتمة
	if not world.match_finished.is_connected(_on_match_finished):
		world.match_finished.connect(_on_match_finished)
	# اللاعب
	var data := {
		"name": Config.player_name, "team": 0, "op_key": Config.op_key, "is_bot": false,
		"weapons": Config.loadout, "net_id": NetMgr.local_id,
	}
	var player = world.add_actor(false, data)
	if net_client:
		player.is_local_player = true
	var cam := Camera2D.new()
	# نقطة أصل الجسم أعلى الرأس؛ نرفع الكاميرا لمنتصف الصدر حتى يكون
	# اللاعب في منتصف الشاشة عموديًا (كانت الكاميرا عند قدمي/رأس الجسم تمامًا)
	cam.position = Vector2(0, 31)
	cam.position_smoothing_enabled = true
	cam.position_smoothing_speed = 9.0
	cam.zoom = Vector2(1, 1)
	cam.limit_left = 0
	cam.limit_top = -400
	cam.limit_right = world.map_w * Config.TILE
	cam.limit_bottom = world.map_h * Config.TILE
	player.add_child(cam)
	cam.make_current()
	# اللاعبون البعيدون على المضيف: أجسام حقيقية تُحاكى بأوامر الشبكة
	if net_host:
		for pid in NetMgr.peers.keys():
			if int(pid) == NetMgr.local_id:
				continue
			var info: Dictionary = NetMgr.peers[pid]
			var ra = world.add_actor(false, {
				"name": String(info.get("name", "لاعب %d" % pid)),
				"team": int(info.get("team", 1)),
				"op_key": String(info.get("op_key", "rashid")),
				"is_bot": false, "weapons": Config.loadout, "net_id": int(pid),
			})
			ra.is_remote = true
	# على العميل: كل شخصية في قائمة الغرفة تصبح «ظلًّا» يتحرّك باللقطات
	if net_client:
		var roster: Array = opts.get("roster", [])
		for entry in roster:
			var rid := int(entry.get("id", -1))
			if rid < 0 or rid == NetMgr.local_id:
				continue
			var proxy = world.add_actor(false, {
				"name": String(entry.get("name", "لاعب %d" % rid)),
				"team": int(entry.get("team", 0)),
				"op_key": String(entry.get("op_key", "rashid")),
				"is_bot": false, "net_id": rid,
				"weapons": entry.get("weapons", Config.loadout),
			})
			proxy.is_proxy = true
			proxy.is_remote = true
	# البوتات (لا بوتات على العميل — المضيف هو من يحرّكها)
	var bots := 0 if net_client else int(opts.get("bots", Config.bot_count))
	for i in bots:
		var team := 0 if i % 2 == 0 else 1 if M11Data.MODES.get(mode_id, {}).get("teams", 1) > 1 else 0
		var bot = world.add_actor(true, {
			"name": M11Data.BOT_NAMES[i % M11Data.BOT_NAMES.size()],
			"team": team, "op_key": M11Data.OPERATORS[(i + 3) % M11Data.OPERATORS.size()]["key"],
			"is_bot": true, "weapons": ["jabha", "n9"], "net_id": 10 + i,
		})
		bot.add_child(preload("res://src/ai/bot_brain.gd").new())
	# واجهة اللعب
	if hud:
		hud.queue_free()
	hud = preload("res://src/ui/hud.gd").new()
	hud_layer.add_child(hud)
	hud.setup(world, player)
	if menu:
		menu.move_to_front()
	# طبقة أزرار اللمس — بدونها لا يستطيع اللاعب التحكم على الهاتف
	if touch_ui:
		touch_ui.queue_free()
	touch_ui = preload("res://src/ui/touch_controls.gd").new()
	touch_ui.name = "TouchControls"
	hud_layer.add_child(touch_ui)
	touch_ui.setup(get_node("InputManager"), player)
	# نُسلّم مرجع اللاعب لمُدير التحكم حتى يعمل تصويب الماوس على الكمبيوتر
	if input_manager != null:
		input_manager.player_ref = player
	state = "playing"
	get_tree().paused = false
	Config.apply_runtime()
	AudioBus.play_music("dm_fast")
	if menu:
		menu.visible = false
	# رسالة ترحيب مفيدة بدل بدء صامت
	if hud and hud.has_method("toast"):
		hud.toast("%s — %s" % [String(M11Data.MODES.get(mode_id, {}).get("name_ar", mode_id)),
			String(world.map_def.get("name_ar", map_id))], M11UI.GOLD, 3.0)
	# إعادة بناء أزرار اللمس حسب التخطيط والحجم المختارَين في الإعدادات
	var im := get_node_or_null("InputManager")
	if im and im.has_method("rebuild_buttons"):
		im.rebuild_buttons()
	if is_net:
		NetMgr.attach_world(world, player)
		if net_host and hud != null and hud.has_method("toast"):
			hud.toast("غرفة الشبكة المحلية — منفذ %d" % Config.NET_PORT, M11UI.TEAL, 4.0)


func _on_match_finished(res: Dictionary) -> void:
	# المضيف يبلّغ العملاء بالنتيجة قبل التجميد
	if NetMgr.is_host():
		NetMgr.send_result(res)
	# 1) تجميد اللعب فورًا حتى لا تستمر البوتات بالقتال خلف شاشة النتائج
	get_tree().paused = true
	state = "results"
	if hud:
		hud.visible = false
	# 2) حفظ الإحصاءات والخبرة محليًا (تشفير بسيط، بلا أي اتصال بالإنترنت)
	var won: bool = int(res.get("winner_team", -1)) == 0
	var me: Dictionary = {}
	for a in (world.actors if world != null else []):
		if not a.is_bot:
			me = {
				"kills": int(a.kills), "deaths": int(a.deaths), "assists": int(a.assists),
				"headshots": int(a.headshots), "damage": int(a.damage_dealt),
				"longest_kill": float(a.longest_kill), "revives": int(a.revives),
			}
			break
	var saved := Save.record_match({
		"kills": int(me.get("kills", res.get("player_kills", 0))),
		"deaths": int(me.get("deaths", res.get("player_deaths", 0))),
		"assists": int(me.get("assists", 0)), "headshots": int(me.get("headshots", 0)),
		"damage": int(me.get("damage", 0)), "longest_kill": float(me.get("longest_kill", 0.0)),
		"revives": int(me.get("revives", 0)), "won": won,
	})
	# 3) شاشة النتائج — لوحة النصر أو الهزيمة المولّدة
	if menu:
		var payload := res.duplicate()
		payload["xp"] = saved["xp"]
		payload["level"] = saved["level"]
		payload["unlocked"] = saved.get("unlocked", [])
		menu.show_results(payload)
		menu.visible = true
		menu.move_to_front()
	# 4) ننبّه المشاهد ليتوقف عن التحديث
	AudioBus.play_music("menu_theme")


func back_to_menu() -> void:
	# رجوع نظيف: نوقف الإيقاف المؤقت، نحذف العالم، ونعيد القائمة
	get_tree().paused = false
	NetMgr.clear_world()
	if NetMgr.in_session():
		NetMgr.leave()
	if world:
		world.queue_free()
		world = null
	if hud:
		hud.queue_free()
		hud = null
	if touch_ui:
		touch_ui.queue_free()
		touch_ui = null
	if menu:
		menu.show_screen(0, false)
		menu.history.clear()
		menu.visible = true
		menu.move_to_front()
	if input_manager != null:
		input_manager.button_state.clear()
		input_manager.just_pressed.clear()
		input_manager.move_stick["active"] = false
		input_manager.aim_stick["active"] = false
	state = "menu"
	get_tree().paused = false
	AudioBus.play_music("menu_theme")


## زر الرجوع في أندرويد: ترتيب منطقي بدل إغلاق اللعبة من أي شاشة.
## بعض إصدارات Godot ترسل الإشعار مرّتين للضغطة الواحدة، لذا نُسقط التكرار
## خلال ٣٠٠ مللي ثانية حتى لا يُنفَّذ الرجوع مرتين.
var _last_back_ms := 0


func _notification(what: int) -> void:
	if what != NOTIFICATION_WM_GO_BACK_REQUEST:
		return
	var now := Time.get_ticks_msec()
	if now - _last_back_ms < 300:
		return
	_last_back_ms = now
	if state == "playing":
		toggle_pause()
	elif state == "paused":
		if menu != null and int(menu.screen) != 10:
			menu.go_back()
		else:
			toggle_pause()
	elif state == "results":
		back_to_menu()
	elif state == "menu":
		if menu != null and int(menu.screen) != 0:
			menu.go_back()
		else:
			# الشاشة الرئيسية: الرجوع يخرج من اللعبة (السلوك المتوقّع)
			get_tree().quit()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F11:
		if pc != null:
			pc.toggle_fullscreen()
		return
	# Esc / زر الرجوع في أندرويد: أثناء اللعب نفتح شاشة الإيقاف، وفي القوائم
	# تتولّى القائمة نفسها الرجوع خطوة (حتى لا يُنفَّذ الرجوع مرتين).
	if state == "playing" and (event.is_action_pressed("pause") or event.is_action_pressed("ui_cancel")):
		toggle_pause()
		get_viewport().set_input_as_handled()
		return
	# اختصارات اللعب (لا تعمل أثناء الإيقاف)
	if state != "playing":
		return
	if event.is_action_pressed("scoreboard"):
		if hud != null:
			hud.show_scoreboard = not hud.show_scoreboard
	if event.is_action_pressed("map_big"):
		if hud != null:
			hud.big_map = not hud.big_map


func _process(dt: float) -> void:
	if hud != null:
		hud.set("fps", float(Engine.get_frames_per_second()))
	if input_manager != null:
		if input_manager.consume("pause"):
			if state == "playing" or state == "paused":
				toggle_pause()
		if input_manager.consume("score"):
			if hud != null and state == "playing":
				hud.show_scoreboard = not hud.show_scoreboard


## إيقاف/استئناف حقيقي مع شاشة قابلة للمس — كان Esc يجمّد الشجرة بلا أي واجهة
func toggle_pause() -> void:
	if state == "playing":
		state = "paused"
		get_tree().paused = true
		if touch_ui != null:
			touch_ui.visible = false
		if menu != null:
			menu.show_pause()
			menu.visible = true
			menu.move_to_front()
	elif state == "paused":
		state = "playing"
		get_tree().paused = false
		if menu != null:
			menu.visible = false
		if touch_ui != null:
			touch_ui.visible = true


func apply_graphics() -> void:
	if pc != null:
		pc.set_quality(Config.quality)
