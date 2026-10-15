# ============================================================================
# محمّل الأطالس — يقرأ world.png/vfx.png/ui.png/weapons.png/arms.png/char_*.png
# مع ملفات JSON (frames + offsets + anchors) التي ولّدها tools/build_assets.py.
# نفس اتفاقية الويب حرفيًا: الإطار يُثبَّت عند نقطة ارتساء داخل الإطار الأصلي.
# ============================================================================
extends Node
class_name AtlasLoader

var atlases: Dictionary = {}       # name -> AtlasResource
var meta: Dictionary = {}
static var instance: AtlasLoader


class AtlasResource:
	var name: String
	var texture: AtlasTexture
	var frames: Dictionary
	var offsets: Dictionary
	var anchors: Dictionary
	var meta: Dictionary

	func has_key(key: String) -> bool:
		return frames.has(key)

	func frame(key: String) -> Dictionary:
		return frames.get(key, {})

	func offset(key: String) -> Vector2:
		var o: Array = offsets.get(key, [0, 0])
		return Vector2(o[0], o[1])

	func anchor(key: String) -> Dictionary:
		return anchors.get(key, {})

	# تُرسم الإطارات مباشرة بـ draw_texture_rect_region لتفادي AtlasTexture لكل إطار
	func draw(canvas: CanvasItem, key: String, pos: Vector2, flip: bool = false) -> void:
		var f: Dictionary = frames.get(key, {})
		if f.is_empty():
			return
		var region := Rect2(f["x"], f["y"], f["w"], f["h"])
		if flip:
			canvas.draw_texture_rect_region(texture.atlas, Rect2(pos, Vector2(f["ox"], f["oy"])), region)
		else:
			canvas.draw_texture_rect_region(texture.atlas, Rect2(pos, Vector2(f["ox"], f["oy"])), region)

	# يثبّت إطارًا على نقطة ارتساء (anchor في إحداثيات الإطار الأصلي)
	func draw_pivot(canvas: CanvasItem, key: String, pivot: Vector2, anchor_pt: Vector2, flip: bool = false) -> void:
		var f: Dictionary = frames.get(key, {})
		if f.is_empty():
			return
		var off := offset(key)
		var region := Rect2(f["x"], f["y"], f["w"], f["h"])
		var w := float(f["ox"])
		var h := float(f["oy"])
		var dest := Vector2(pivot.x - anchor_pt.x + off.x, pivot.y - anchor_pt.y + off.y)
		if flip:
			# قلب حول عمود نقطة الارتساء نفسها
			var rx := pivot.x * 2.0 - dest.x - w
			dest.x = rx
			canvas.draw_texture_rect_region(texture.atlas, Rect2(dest, Vector2(-w, h)), region)
		else:
			canvas.draw_texture_rect_region(texture.atlas, Rect2(dest, Vector2(w, h)), region)


func _ready() -> void:
	instance = self


func load_all(names: Array) -> void:
	for n in names:
		load_atlas(n)


func load_atlas(name: String) -> AtlasResource:
	if atlases.has(name):
		return atlases[name]
	var png := "res://assets/atlases/%s.png" % name
	var js := "res://assets/atlases/%s.json" % name
	if not ResourceLoader.exists(png) or not FileAccess.file_exists(js):
		push_warning("أطلس غير موجود: %s" % name)
		return null
	var res := AtlasResource.new()
	res.name = name
	var tex := load(png)
	res.texture = AtlasTexture.new()
	res.texture.atlas = tex
	res.texture.filter_clip = true
	var f := FileAccess.open(js, FileAccess.READ)
	var data: Variant = JSON.parse_string(f.get_as_text())
	f.close()
	res.frames = data.get("frames", {})
	res.offsets = data.get("offsets", {})
	res.anchors = data.get("anchors", {})
	res.meta = data
	atlases[name] = res
	meta[name] = data
	return res


func get_atlas(name: String) -> AtlasResource:
	return atlases.get(name, null)
