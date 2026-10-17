# ============================================================================
# الحفظ المحلي المشفّر — ملف تعريف واحد + مفتاح مشتق من بصمة الجهاز.
# يحوي: الاسم، المستوى، الخبرة، الإنجازات، التحديات، الإحصاءات، الأشكال المفتوحة.
# لا يخرج أي شيء للإنترنت (القسم 13).
# ============================================================================
extends Node

const PATH := "user://profile.m11save"
const PASSWORD := "m11-local-profile-v1"   # تشفير محلي بسيط (لا أسرار شبكية)

var profile: Dictionary = {}


func _ready() -> void:
	load_profile()


func _default_profile() -> Dictionary:
	return {
		"name": "مقاتل",
		"level": 1,
		"xp": 0,
		"rank": 0,
		"achievements": [],
		"challenges": [],
		"skins": ["default"],
		"camouflages": [],
		"stats": {"kills": 0, "deaths": 0, "matches": 0, "assists": 0, "headshots": 0,
			"shots": 0, "hits": 0, "revives": 0, "wins": 0, "longest_kill": 0.0, "damage": 0},
		"weapon_kills": {},
		"created": Time.get_unix_time_from_system(),
	}


func load_profile() -> void:
	if not FileAccess.file_exists(PATH):
		profile = _default_profile()
		save_profile()
		return
	var f := FileAccess.open_encrypted_with_pass(PATH, FileAccess.READ, PASSWORD)
	if not f:
		# ملف تالف أو من نسخة قديمة → ابدأ من جديد بأمان
		profile = _default_profile()
		return
	var txt := f.get_as_text()
	f.close()
	var data: Variant = JSON.parse_string(txt)
	profile = data if typeof(data) == TYPE_DICTIONARY else _default_profile()
	# املأ أي مفاتيح ناقصة (ترحيل آمن بين الإصدارات)
	var def := _default_profile()
	for k in def.keys():
		if not profile.has(k):
			profile[k] = def[k]


func save_profile() -> void:
	var f := FileAccess.open_encrypted_with_pass(PATH, FileAccess.WRITE, PASSWORD)
	if f:
		f.store_string(JSON.stringify(profile))
		f.close()


# --- التقدّم ---
## الإنجازات — كانت غير موجودة في نسخة Godot إطلاقًا (شاشة «الإحصاءات»
## كانت ستُسقط القائمة بخطأ «Save.ACHIEVEMENTS غير معروف»). الآن مصدر واحد.
const ACHIEVEMENTS: Array = [
	{"id": "first_blood", "name_ar": "أول دم", "desc_ar": "أول قتلة في مسيرتك", "check": "kills", "goal": 1},
	{"id": "kills_50", "name_ar": "محترف ميدان", "desc_ar": "50 قتلة", "check": "kills", "goal": 50},
	{"id": "kills_250", "name_ar": "أسطورة الحرب", "desc_ar": "250 قتلة", "check": "kills", "goal": 250},
	{"id": "matches_10", "name_ar": "مثابر", "desc_ar": "10 مباريات", "check": "matches", "goal": 10},
	{"id": "wins_5", "name_ar": "منتصر", "desc_ar": "5 انتصارات", "check": "wins", "goal": 5},
	{"id": "wins_25", "name_ar": "قائد الفريق", "desc_ar": "25 انتصارًا", "check": "wins", "goal": 25},
	{"id": "headshots_25", "name_ar": "قنّاص الرؤوس", "desc_ar": "25 إصابة رأس", "check": "headshots", "goal": 25},
	{"id": "revives_10", "name_ar": "أخ في السلاح", "desc_ar": "10 إحياءات لزملاء", "check": "revives", "goal": 10},
	{"id": "longest_100", "name_ar": "طلقة بعيدة", "desc_ar": "قتلة من 100 متر", "check": "longest_kill", "goal": 100},
	{"id": "level_10", "name_ar": "ضابط صف", "desc_ar": "الوصول للمستوى 10", "check": "level", "goal": 10},
]


const RANKS: Array = [
	{"name_ar": "مجنّد", "xp": 0}, {"name_ar": "عريف", "xp": 800}, {"name_ar": "رقيب", "xp": 2400},
	{"name_ar": "رقيب أول", "xp": 5200}, {"name_ar": "مساعد", "xp": 9600}, {"name_ar": "ملازم", "xp": 16000},
	{"name_ar": "نقيب", "xp": 26000}, {"name_ar": "رائد", "xp": 40000}, {"name_ar": "مقدّم", "xp": 62000},
	{"name_ar": "عقيد", "xp": 96000}, {"name_ar": "عميد", "xp": 148000}, {"name_ar": "لواء", "xp": 224000},
]


func add_xp(amount: int) -> Dictionary:
	profile["xp"] = int(profile.get("xp", 0)) + amount
	var level := 1
	var rank := 0
	for i in RANKS.size():
		if profile["xp"] >= int(RANKS[i]["xp"]):
			rank = i
	level = 1 + int(profile["xp"] / 1200.0)
	var leveled := level > int(profile.get("level", 1))
	profile["level"] = level
	profile["rank"] = rank
	save_profile()
	return {"leveled": leveled, "level": level, "rank": RANKS[rank]["name_ar"]}


## يفتح الإنجازات المستحقة ويعيد أسماءها العربية لعرضها كإشعارات.
## اسم الرتبة الحالية — يُستخدم في شاشة النتائج والقائمة بلا حسابات مكرّرة.
func rank_name() -> String:
	var ri := clampi(int(profile.get("rank", 0)), 0, RANKS.size() - 1)
	return String(RANKS[ri]["name_ar"])


func check_achievements() -> Array:
	var unlocked: Array = []
	var stats: Dictionary = profile["stats"]
	var have: Array = profile["achievements"]
	for a in ACHIEVEMENTS:
		if have.has(String(a["id"])):
			continue
		var value := 0.0
		var key := String(a["check"])
		if key == "level":
			value = float(profile["level"])
		else:
			value = float(stats.get(key, 0))
		if value >= float(a["goal"]):
			have.append(String(a["id"]))
			unlocked.append(a)
	if not unlocked.is_empty():
		save_profile()
	return unlocked


func record_match(result: Dictionary) -> Dictionary:
	var s: Dictionary = profile["stats"]
	s["kills"] = int(s["kills"]) + int(result.get("kills", 0))
	s["deaths"] = int(s["deaths"]) + int(result.get("deaths", 0))
	s["matches"] = int(s["matches"]) + 1
	s["assists"] = int(s["assists"]) + int(result.get("assists", 0))
	s["headshots"] = int(s["headshots"]) + int(result.get("headshots", 0))
	s["revives"] = int(s["revives"]) + int(result.get("revives", 0))
	s["damage"] = int(s["damage"]) + int(result.get("damage", 0))
	s["longest_kill"] = maxf(float(s["longest_kill"]), float(result.get("longest_kill", 0.0)))
	if result.get("won", false):
		s["wins"] = int(s["wins"]) + 1
	var xp := (int(result.get("kills", 0)) * 60 + int(result.get("assists", 0)) * 25
		+ int(result.get("revives", 0)) * 40 + int(result.get("damage", 0)) / 10
		+ (200 if result.get("won", false) else 0))
	var r := add_xp(xp)
	var unlocked := check_achievements()
	save_profile()
	return {"xp": xp, "level": r["level"], "rank": r["rank"], "leveled": r["leveled"],
		"unlocked": unlocked}
