# ============================================================================
# مدير الشبكة المحلية (Autoload) — إيثرنت/Wi-Fi/هوت سبوت فقط، بلا إنترنت.
#
#  • الاستضافة: ENet على المنفذ 41980 (UDP) + بثّ اكتشاف على 41981.
#  • الاكتشاف: العميل يبثّ «M11?» كل ٠٫٢ ث، والمضيف يردّ عليه مباشرة.
#  • اللعب: المضيف هو المرجع (Authoritative) — يرسل لقطة ٣٠ هرتز،
#    والعميل يرسل أوامر التحكم ٣٠ هرتز. لا يوجد أي خادم خارجي.
# ============================================================================
extends Node

signal peer_joined(id: int, info: Dictionary)
signal peer_left(id: int)
signal host_found(host: Dictionary)
signal host_started()
signal match_setup(config: Dictionary)
signal roster_received(list: Array)
signal snapshot_received(data: PackedByteArray)
signal shot_fx(id: int, pos: Vector2, angle: float, weapon: String, speed: float)
signal disconnected_from_host()
signal state_received(state: Dictionary)
signal match_over(res: Dictionary)

enum Role { NONE, HOST, CLIENT }

const PROBE := "M11?"
const ANNOUNCE := "M11!"
const INPUT_HZ := 30.0
# لا يمكن استخدام ثوابت الأوتولود في const — تُقرأ عند إنشاء العقدة
var NET_PORT: int = 41980
var DISCOVERY_PORT: int = 41981

var role: int = Role.NONE
var local_id: int = 0
var peers: Dictionary = {}          # id -> {name, team, op_key}
var host_info: Dictionary = {}
var peer: ENetMultiplayerPeer
var world_ref: Node = null
var player_ref: Node = null
var input_manager: Node = null
var snapshots_in := 0
var snapshots_out := 0
var last_setup: Dictionary = {}

var _discovery: PacketPeerUDP
var _discover_time := 0.0
var _announce_timer := 0.0
var _snapshot_timer := 0.0
var _input_timer := 0.0
var _input_seq := 0
var _state_timer := 0.0
var _probe_timer := 0.0
var _bcasts: Array = ["255.255.255.255"]
var _found: Dictionary = {}


func _ready() -> void:
	NET_PORT = int(Config.NET_PORT)
	DISCOVERY_PORT = NET_PORT + 1
	set_process(false)
	# ربط إشارات MultiplayerAPI مرة واحدة فقط
	_connect_multiplayer_signals()


func _connect_multiplayer_signals() -> void:
	var mp := multiplayer
	if mp == null:
		return
	if not mp.peer_connected.is_connected(_on_peer_connected):
		mp.peer_connected.connect(_on_peer_connected)
	if not mp.peer_disconnected.is_connected(_on_peer_disconnected):
		mp.peer_disconnected.connect(_on_peer_disconnected)
	if not mp.connected_to_server.is_connected(_on_connected_to_server):
		mp.connected_to_server.connect(_on_connected_to_server)
	if not mp.connection_failed.is_connected(_on_connection_failed):
		mp.connection_failed.connect(_on_connection_failed)
	if not mp.server_disconnected.is_connected(_on_server_disconnected):
		mp.server_disconnected.connect(_on_server_disconnected)


func is_host() -> bool:
	return role == Role.HOST


func is_client() -> bool:
	return role == Role.CLIENT


func in_session() -> bool:
	return role != Role.NONE


# ---------------------------------------------------------------- الاستضافة
func start_host(player_name: String = "", _mode: String = "tdm") -> bool:
	leave()
	var server := ENetMultiplayerPeer.new()
	var err := server.create_server(NET_PORT, Config.MAX_PLAYERS)
	if err != OK:
		push_error("تعذّر إنشاء الغرفة على المنفذ %d (الخطأ %d)" % [NET_PORT, err])
		return false
	multiplayer.multiplayer_peer = server
	peer = server
	role = Role.HOST
	local_id = 1
	peers.clear()
	peers[1] = {"name": player_name if not player_name.is_empty() else Config.player_name,
		"team": 0, "op_key": Config.op_key}
	_start_discovery_socket(true)
	set_process(true)
	host_started.emit()
	return true


# عناوين البثّ: العام + عنوان كل شبكة محلية (الهوت سبوت في أندرويد
# كثيرًا ما يتجاهل 255.255.255.255 لكنه يمرّر x.x.x.255)
func _compute_bcasts() -> void:
	_bcasts = ["255.255.255.255"]
	for ip in IP.get_local_addresses():
		if String(ip).contains(":") or String(ip).begins_with("127."):
			continue
		var parts := String(ip).split(".")
		if parts.size() != 4:
			continue
		var b := "%s.%s.%s.255" % [parts[0], parts[1], parts[2]]
		if not _bcasts.has(b):
			_bcasts.append(b)


func _start_discovery_socket(as_host: bool) -> void:
	_compute_bcasts()
	_discovery = PacketPeerUDP.new()
	_discovery.set_broadcast_enabled(true)
	var err := OK
	if as_host:
		err = _discovery.bind(DISCOVERY_PORT)
		if err != OK:
			# منفذ الاكتشاف مستخدم: نجرب منفذًا عشوائيًا ونكتفي بردود الطلبات
			_discovery.bind(0)
		_discovery.set_dest_address("255.255.255.255", DISCOVERY_PORT)
	else:
		_discovery.bind(0)
		_discovery.set_dest_address("255.255.255.255", DISCOVERY_PORT)


# ---------------------------------------------------------------- العميل
func discover_hosts(seconds: float = 3.0) -> void:
	leave()
	role = Role.CLIENT
	_discover_time = seconds
	_found.clear()
	_start_discovery_socket(false)
	set_process(true)


func join_host(ip: String, port: int = -1) -> bool:
	var clean := ip.strip_edges()
	if clean.is_empty():
		return false
	var use_port: int = port if port > 0 else NET_PORT
	# إن كان هناك اتصال أو بحث سابق نغلقه أولًا
	leave()
	var client := ENetMultiplayerPeer.new()
	var err := client.create_client(clean, use_port)
	if err != OK:
		return false
	multiplayer.multiplayer_peer = client
	peer = client
	role = Role.CLIENT
	local_id = 0
	peers.clear()
	_connect_multiplayer_signals()
	set_process(true)
	return true


func leave() -> void:
	if peer != null:
		peer.close()
		peer = null
	if multiplayer.multiplayer_peer != null:
		multiplayer.multiplayer_peer = null
	if _discovery != null:
		_discovery.close()
		_discovery = null
	role = Role.NONE
	peers.clear()
	local_id = 0
	world_ref = null
	player_ref = null
	snapshots_in = 0
	snapshots_out = 0
	set_process(false)


# ---------------------------------------------------------------- ربط العالم
func attach_world(world: Node, player: Node = null) -> void:
	world_ref = world
	player_ref = player
	input_manager = get_node_or_null("/root/Main/InputManager")
	set_process(role != Role.NONE)


func clear_world() -> void:
	world_ref = null
	player_ref = null


# ---------------------------------------------------------------- التحديث
func _process(dt: float) -> void:
	if role == Role.HOST:
		# نقرأ طلبات الاكتشاف كل إطار (خفيفة جدًا) ونردّ عليها فورًا
		_read_discovery()
		_announce_timer -= dt
		if _announce_timer <= 0.0:
			_announce_timer = 0.5
			_send_announce()
		_snapshot_timer += dt
		if _snapshot_timer >= 1.0 / float(Config.TICK_RATE):
			_snapshot_timer = 0.0
			_host_send_snapshot()
		_state_timer += dt
		if _state_timer >= 0.5:
			_state_timer = 0.0
			_host_send_state()
	elif role == Role.CLIENT:
		_read_discovery()
		if _discover_time > 0.0:
			_discover_time -= dt
			_probe_timer -= dt
			if _probe_timer <= 0.0:
				_probe_timer = 0.2
				_send_probe()
		if player_ref != null and is_instance_valid(player_ref) and world_ref != null:
			_input_timer += dt
			if _input_timer >= 1.0 / INPUT_HZ:
				_input_timer = 0.0
				_send_input()


func _announce_payload() -> String:
	# لو كانت هناك مباراة جارية نُعلن وضعها وخريطتها الحقيقية لا إعدادات القائمة
	var mode_id: String = Config.mode_id
	var map_id: String = Config.map_id
	if world_ref != null and is_instance_valid(world_ref):
		var wm = world_ref.get("mode_id")
		var wmap = world_ref.get("map_id")
		if wm != null:
			mode_id = String(wm)
		if wmap != null:
			map_id = String(wmap)
	return "%s%d|%s|%d|%d|%s|%s" % [ANNOUNCE, 2, Config.player_name,
		peers.size(), Config.MAX_PLAYERS, mode_id, map_id]


func _send_announce() -> void:
	if _discovery == null:
		return
	var payload := _announce_payload().to_utf8_buffer()
	for b in _bcasts:
		_discovery.set_dest_address(String(b), DISCOVERY_PORT)
		_discovery.put_packet(payload)


func _send_probe() -> void:
	if _discovery == null:
		return
	var payload := PROBE.to_utf8_buffer()
	for b in _bcasts:
		_discovery.set_dest_address(String(b), DISCOVERY_PORT)
		_discovery.put_packet(payload)


func _read_discovery() -> void:
	if _discovery == null:
		return
	while _discovery.get_available_packet_count() > 0:
		var pkt := _discovery.get_packet().get_string_from_utf8()
		var from_ip := _discovery.get_packet_ip()
		var from_port := _discovery.get_packet_port()
		if role == Role.HOST and pkt.begins_with(PROBE):
			# ردّ مباشر على العميل الذي سأل (يعمل حتى لو منع الراوتر البثّ العام)
			_discovery.set_dest_address(from_ip, from_port)
			_discovery.put_packet(_announce_payload().to_utf8_buffer())
		elif role == Role.CLIENT and pkt.begins_with(ANNOUNCE):
			var body := pkt.substr(ANNOUNCE.length())
			if body.begins_with("2|"):
				body = body.substr(2)
			var parts := body.split("|")
			var info := {
				"host_name": parts[0] if parts.size() > 0 else "مضيف",
				"players": int(parts[1]) if parts.size() > 1 else 1,
				"max": int(parts[2]) if parts.size() > 2 else Config.MAX_PLAYERS,
				"mode": parts[3] if parts.size() > 3 else "tdm",
				"map": parts[4] if parts.size() > 4 else "oasis",
				"ip": from_ip,
				"port": NET_PORT,
			}
			host_info = info
			# نُبلغ عن كل مضيف جديد مرة واحدة فقط — ونكمل البحث حتى نهاية المدة
			if _discover_time > 0.0 and not _found.has(from_ip):
				_found[from_ip] = true
				host_found.emit(info)
				toast_host_found()


func toast_host_found() -> void:
	var main := get_tree().get_first_node_in_group("main")
	if main != null and main.has_method("toast_net"):
		main.toast_net("وُجد مضيف: %s" % String(host_info.get("host_name", "")), true)


# ---------------------------------------------------------------- الأوامر واللقطات
func _send_input() -> void:
	if input_manager == null or not is_instance_valid(input_manager):
		input_manager = get_node_or_null("/root/Main/InputManager")
	if input_manager == null or not input_manager.has_method("build_command"):
		return
	_input_seq += 1
	var cmd: Dictionary = input_manager.build_command()
	# نرسل فقط ما يلزم — الحقول الصغيرة أسرع وأوضح
	var small := {
		"mx": float(cmd.get("move_x", 0.0)), "my": float(cmd.get("move_y", 0.0)),
		"ax": float(cmd.get("aim", Vector2.ZERO).x), "ay": float(cmd.get("aim", Vector2.ZERO).y),
		"aim_active": bool(cmd.get("aim_active", false)),
		"jump": bool(cmd.get("jump", false)), "jet": bool(cmd.get("jet", false)),
		"fire": bool(cmd.get("fire", false)), "ads": bool(cmd.get("ads", false)),
		"sprint": bool(cmd.get("sprint", false)), "crouch": bool(cmd.get("crouch", false)),
		"prone": bool(cmd.get("prone", false)), "reload": bool(cmd.get("reload", false)),
		"melee": bool(cmd.get("melee", false)), "grenade": bool(cmd.get("grenade", false)),
		"heal": bool(cmd.get("heal", false)), "swap": int(cmd.get("swap", 0)),
	}
	rpc_id(1, "_submit_input", _input_seq, small)


func _host_send_snapshot() -> void:
	if world_ref == null or not is_instance_valid(world_ref):
		return
	if not world_ref.has_method("build_snapshot"):
		return
	var snap: PackedByteArray = world_ref.build_snapshot()
	snapshots_out += 1
	if peers.size() > 1:
		rpc("_recv_snapshot", snap)


func lobby_roster() -> Array:
	var list: Array = []
	for id in peers.keys():
		var p: Dictionary = peers[id]
		list.append({
			"id": int(id), "name": String(p.get("name", "لاعب")),
			"team": int(p.get("team", 0)), "op_key": String(p.get("op_key", "rashid")),
			"weapons": Config.loadout, "bot": false,
		})
	return list


func setup_config() -> Dictionary:
	var cfg := {
		"mode": Config.mode_id, "map": Config.map_id, "seed": 12345,
		"host_name": Config.player_name, "started": false, "roster": [],
	}
	if world_ref != null and is_instance_valid(world_ref):
		cfg["started"] = true
		if world_ref.get("seed_value") != null:
			cfg["seed"] = int(world_ref.seed_value)
		if world_ref.get("mode_id") != null:
			cfg["mode"] = String(world_ref.mode_id)
		if world_ref.get("map_id") != null:
			cfg["map"] = String(world_ref.map_id)
		if world_ref.has_method("net_roster"):
			cfg["roster"] = world_ref.net_roster()
	else:
		cfg["roster"] = lobby_roster()
	return cfg


func _host_send_state() -> void:
	if world_ref == null or not is_instance_valid(world_ref) or peers.size() <= 1:
		return
	var standings: Array = []
	if world_ref.has_method("_compute_standings"):
		var st = world_ref.call("_compute_standings")
		if st is Array:
			standings = st
	var scores: Variant = world_ref.get("team_scores")
	var zone: Variant = world_ref.get("zone")
	var scores_out: Array = [0, 0]
	if scores is Array:
		scores_out = scores.duplicate()
	var zone_out: Dictionary = {}
	if zone is Dictionary:
		zone_out = zone.duplicate()
	rpc("_recv_state", {
		"scores": scores_out,
		"time": float(world_ref.get("match_time")) if world_ref.get("match_time") != null else 0.0,
		"state": String(world_ref.get("match_state")) if world_ref.get("match_state") != null else "playing",
		"standings": standings,
		# المنطقة المتقلّصة تُرى عند العميل أيضًا وإلا مات بلا سبب مرئي
		"zone": zone_out,
	})


func send_result(res: Dictionary) -> void:
	if role == Role.HOST and peers.size() > 1:
		rpc("_match_over", res)


func publish_roster(roster: Array) -> void:
	if role != Role.HOST:
		return
	if peers.size() > 1:
		rpc("_recv_roster", roster)


func broadcast_shot(id: int, pos: Vector2, angle: float, weapon: String, speed: float) -> void:
	if role != Role.HOST or peers.size() <= 1:
		return
	rpc("_shot_fx", id, pos, angle, weapon, speed)


func request_start(config: Dictionary) -> void:
	if role != Role.HOST:
		return
	if peers.size() > 1:
		rpc("_force_start", config)


# ---------------------------------------------------------------- RPC
@rpc("any_peer", "call_remote", "reliable", 0)
func _hello(display_name: String, op_key: String) -> void:
	if role != Role.HOST:
		return
	var id := multiplayer.get_remote_sender_id()
	if id <= 0:
		return
	var team := (id - 1) % 2
	var info := {"name": display_name if not display_name.is_empty() else "لاعب %d" % id,
		"team": team, "op_key": op_key}
	peers[id] = info
	peer_joined.emit(id, info)
	var cfg := setup_config()
	# تحديث لوبي بقية اللاعبين بقائمة الأسماء الجديدة (قبل بدء المباراة)
	if world_ref == null:
		publish_roster(lobby_roster())
	cfg["your_id"] = id
	_send_setup(id, cfg)


func _send_setup(id: int, cfg: Dictionary) -> void:
	rpc_id(id, "_client_setup", cfg)


@rpc("authority", "call_remote", "reliable", 0)
func _client_setup(cfg: Dictionary) -> void:
	last_setup = cfg
	local_id = int(cfg.get("your_id", multiplayer.get_unique_id()))
	role = Role.CLIENT
	match_setup.emit(cfg)


@rpc("authority", "call_remote", "unreliable", 2)
func _recv_state(st: Dictionary) -> void:
	state_received.emit(st)


@rpc("authority", "call_remote", "reliable", 0)
func _match_over(res: Dictionary) -> void:
	match_over.emit(res)


@rpc("authority", "call_remote", "reliable", 0)
func _recv_roster(list: Array) -> void:
	roster_received.emit(list)


@rpc("authority", "call_remote", "unreliable", 1)
func _recv_snapshot(data: PackedByteArray) -> void:
	snapshots_in += 1
	snapshot_received.emit(data)


@rpc("any_peer", "call_remote", "unreliable", 1)
func _submit_input(_seq: int, cmd: Dictionary) -> void:
	if role != Role.HOST:
		return
	var id := multiplayer.get_remote_sender_id()
	if id <= 0 or world_ref == null or not is_instance_valid(world_ref):
		return
	world_ref.apply_net_command(id, cmd)


@rpc("authority", "call_remote", "unreliable", 2)
func _shot_fx(id: int, pos: Vector2, angle: float, weapon: String, speed: float) -> void:
	shot_fx.emit(id, pos, angle, weapon, speed)


@rpc("authority", "call_remote", "reliable", 0)
func _force_start(config: Dictionary) -> void:
	match_setup.emit(config)


# ---------------------------------------------------------------- إشارات ENet
func _on_peer_connected(_id: int) -> void:
	# ننتظر رسالة _hello كي نعرف الاسم والمشغّل — لا نضيف لاعبًا وهميًا هنا
	pass


func _on_peer_disconnected(id: int) -> void:
	if role == Role.HOST:
		peers.erase(id)
		peer_left.emit(id)
		if world_ref == null:
			publish_roster(lobby_roster())
	elif role == Role.CLIENT:
		leave()
		disconnected_from_host.emit()


func _on_connected_to_server() -> void:
	role = Role.CLIENT
	local_id = multiplayer.get_unique_id()
	rpc_id(1, "_hello", Config.player_name, Config.op_key)


func _on_connection_failed() -> void:
	role = Role.NONE
	leave()
	disconnected_from_host.emit()


func _on_server_disconnected() -> void:
	leave()
	disconnected_from_host.emit()


func _exit_tree() -> void:
	if _discovery != null:
		_discovery.close()
