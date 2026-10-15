# ============================================================================
# مدير الشبكة المحلية (Autoload) — UDP/ENet، بلا إنترنت إطلاقًا.
#
#  • اكتشاف: بثّ UDP عام على المنفذ 41980 لمدة 3 ثوانٍ (القسم 4).
#  • مضيف واحد (Listen Server) هو المرجع؛ الباقي عملاء.
#  • 30 هرتز تحديث حالة، تنبؤ للعميل، إقحام 100 م.ث، تعويض تأخير 200 م.ث.
#  • حجز مقعد 60 ثانية عند الانقطاع المفاجئ + اقتراح ترحيل الاستضافة.
#
# ملاحظة أندرويد 13+: يجب طلب NEARBY_WIFI_DEVICES (مُعلن في export_presets).
# ============================================================================
extends Node

signal peer_joined(id: int, info: Dictionary)
signal peer_left(id: int)
signal host_found(host: Dictionary)
signal snapshot_received(snap: Dictionary)
signal match_started(config: Dictionary)

enum Role { NONE, HOST, CLIENT }

var role: int = Role.NONE
var local_id: int = 0
var peers: Dictionary = {}          # id -> {name, last_seen, ping, seat_hold}
var host_info: Dictionary = {}
var peer: ENetMultiplayerPeer
var _broadcast: PacketPeerUDP
var _listen: PacketPeerUDP
var _discover_time := 0.0
var _announce_timer := 0.0
var _snapshot_timer := 0.0
var _pending_snaps: Array = []
var net_stats := {"ping": 0.0, "jitter": 0.0, "loss": 0.0, "up": 0, "down": 0, "tick": Config.TICK_RATE}


func _ready() -> void:
	set_process(false)
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)


# ---------------------------------------------------------------- الاستضافة
func start_host(player_name: String = "", mode: String = "tdm") -> bool:
	var server := ENetMultiplayerPeer.new()
	var err := server.create_server(Config.NET_PORT, Config.MAX_PLAYERS)
	if err != OK:
		push_error("تعذّر إنشاء الغرفة على المنفذ %d (الخطأ %d)" % [Config.NET_PORT, err])
		return false
	multiplayer.multiplayer_peer = server
	peer = server
	role = Role.HOST
	local_id = 1
	peers[1] = {"name": player_name, "last_seen": 0.0, "ping": 0.0, "seat_hold": 0.0}
	_start_broadcast()
	_start_listener()
	set_process(true)
	return true


func _start_broadcast() -> void:
	_broadcast = PacketPeerUDP.new()
	_broadcast.set_broadcast_enabled(true)
	_broadcast.set_dest_address("255.255.255.255", Config.NET_PORT)
	var err := _broadcast.bind(Config.NET_PORT + 1)
	if err != OK:
		# بعض الشبكات تمنع الربط — البثّ يبقى ممكنًا بلا ربط محلي
		pass


func _start_listener() -> void:
	_listen = PacketPeerUDP.new()
	var err := _listen.bind(Config.NET_PORT + 2)
	if err != OK:
		_listen = null


# ---------------------------------------------------------------- العميل
func discover_hosts(seconds: float = 3.0) -> void:
	role = Role.CLIENT
	_discover_time = seconds
	_broadcast = PacketPeerUDP.new()
	_broadcast.set_broadcast_enabled(true)
	_broadcast.set_dest_address("255.255.255.255", Config.NET_PORT)
	_broadcast.bind(0)
	set_process(true)


func join_host(ip: String, port: int = Config.NET_PORT) -> bool:
	var client := ENetMultiplayerPeer.new()
	var err := client.create_client(ip, port)
	if err != OK:
		return false
	multiplayer.multiplayer_peer = client
	peer = client
	role = Role.CLIENT
	local_id = client.get_unique_id()
	set_process(true)
	return true


func leave() -> void:
	if peer:
		peer.close()
	peer = null
	role = Role.NONE
	peers.clear()
	set_process(false)


# ---------------------------------------------------------------- التحديث
func _process(dt: float) -> void:
	if role == Role.HOST:
		_announce_timer -= dt
		if _announce_timer <= 0.0:
			_announce_timer = 0.5
			_send_announce()
		_snapshot_timer += dt
		if _snapshot_timer >= 1.0 / float(Config.TICK_RATE):
			_snapshot_timer = 0.0
			_host_send_snapshot()
		# حجز المقعد عند الانقطاع (60 ثانية)
		for id in peers.keys():
			var p: Dictionary = peers[id]
			p["seat_hold"] = maxf(0.0, float(p["seat_hold"]) - dt)
	elif role == Role.CLIENT:
		if _discover_time > 0.0:
			_discover_time -= dt
			_send_discover()
		_receive_packets()


func _send_discover() -> void:
	if _broadcast:
		_broadcast.put_packet(("M11?%d" % M11Data.PACKAGE_ID.length()).to_utf8_buffer())


func _send_announce() -> void:
	if _broadcast == null:
		return
	var map_id: String = Config.map_id
	var mode_id: String = Config.mode_id
	var payload := "M11!%s|%d|%d|%s|%s" % [Config.player_name, peers.size(), Config.MAX_PLAYERS, mode_id, map_id]
	_broadcast.put_packet(payload.to_utf8_buffer())


func _receive_packets() -> void:
	if _broadcast == null:
		return
	while _broadcast.get_available_packet_count() > 0:
		var pkt := _broadcast.get_packet().get_string_from_utf8()
		if pkt.begins_with("M11!"):
			var parts := pkt.substr(4).split("|")
			host_info = {
				"host_name": parts[0] if parts.size() > 0 else "مضيف",
				"players": int(parts[1]) if parts.size() > 1 else 1,
				"max": int(parts[2]) if parts.size() > 2 else Config.MAX_PLAYERS,
				"mode": parts[3] if parts.size() > 3 else "tdm",
				"map": parts[4] if parts.size() > 4 else "oasis",
				"ip": _broadcast.get_packet_ip(),
				"port": Config.NET_PORT,
			}
			host_found.emit(host_info)
			_discover_time = 0.0


# ---------------------------------------------------------------- اللقطات
func _host_send_snapshot() -> void:
	var world := get_tree().get_first_node_in_group("world")
	if world and world.has_method("build_snapshot"):
		var snap: PackedByteArray = world.build_snapshot()
		rpc("_recv_snapshot", snap)


@rpc("authority", "unreliable", 0)
func _recv_snapshot(data: PackedByteArray) -> void:
	net_stats["down"] = data.size()
	snapshot_received.emit({"data": data, "time": Time.get_ticks_msec() / 1000.0})


# ---------------------------------------------------------------- الأحداث
func _on_peer_connected(id: int) -> void:
	if role == Role.HOST:
		peers[id] = {"name": "لاعب %d" % id, "last_seen": 0.0, "ping": 0.0, "seat_hold": 0.0}
		peer_joined.emit(id, peers[id])


func _on_peer_disconnected(id: int) -> void:
	if role == Role.HOST and peers.has(id):
		# نُبقي المقعد محجوزًا 60 ثانية (القسم 4)
		peers[id]["seat_hold"] = Config.RECONNECT_GRACE
	peer_left.emit(id)


@rpc("any_peer", "reliable")
func request_join(display_name: String, op_key: String) -> void:
	if role != Role.HOST:
		return
	var id := multiplayer.get_remote_sender_id()
	if peers.has(id):
		peers[id]["name"] = display_name
		peers[id]["op_key"] = op_key


@rpc("authority", "reliable")
func start_match(config: Dictionary) -> void:
	match_started.emit(config)


func suggest_migration() -> void:
	# عند خروج المضيف: نرشّح صاحب أقل بِنج وأطول مدة اتصال (القسم 4)
	if role != Role.CLIENT:
		return
	var best_id := 0
	var best_ping := 9999
	for id in peers.keys():
		if float(peers[id]["ping"]) < best_ping:
			best_ping = float(peers[id]["ping"])
			best_id = id
	if best_id == local_id:
		rpc("request_migration")


@rpc("any_peer", "reliable")
func request_migration() -> void:
	pass
