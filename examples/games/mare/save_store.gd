extends RefCounted

const River = preload("res://river.gd")
const PATH := "user://mare-progress-v1.json"
var value: Dictionary = {"schemaVersion": 1, "completed": {}, "current": 0, "attempt": {}, "muted": false, "motion": true}
var available := true
var incompatible := false

func load_progress(courses: Array) -> void:
	if not FileAccess.file_exists(PATH):
		return
	var file := FileAccess.open(PATH, FileAccess.READ)
	if file == null:
		available = false
		return
	if file.get_length() > 65536:
		file.close()
		incompatible = true
		return
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	if not valid(parsed, courses):
		incompatible = true
		return
	value = parsed
	value.current = int(value.current)

func integer(n: Variant, low: int, high: int) -> bool:
	return (n is float or n is int) and is_finite(float(n)) and float(n) == floorf(float(n)) and n >= low and n <= high

func valid(data: Variant, courses: Array) -> bool:
	if not data is Dictionary or not integer(data.get("schemaVersion"), 1, 1):
		return false
	if not data.get("completed") is Dictionary or not data.get("attempt") is Dictionary or not data.get("muted") is bool or not data.get("motion") is bool:
		return false
	if not integer(data.get("current"), 0, 11) or data.completed.size() > 12 or int(data.current) > data.completed.size():
		return false
	for i in range(data.completed.size()):
		var row: Variant = data.completed.get(str(i))
		if not row is Dictionary or not integer(row.get("stars"), 1, 3) or not integer(row.get("score"), 300, 3000) or not integer(row.get("bumps"), 0, 100000):
			return false
		var seconds: Variant = row.get("seconds")
		if not (seconds is float or seconds is int) or not is_finite(float(seconds)) or seconds < 0.0 or seconds > 86400.0 or not row.get("paper") is bool:
			return false
	if not data.attempt.is_empty():
		if not River.valid(data.attempt, courses[int(data.current)], int(data.current)) or data.attempt.ended:
			return false
	return true

func persist() -> void:
	# Invalid original bytes remain untouched; play continues in memory.
	if incompatible:
		return
	var file := FileAccess.open(PATH + ".tmp", FileAccess.WRITE)
	if file == null:
		available = false
		return
	file.store_string(JSON.stringify(value, "", true, true))
	file.flush()
	file.close()
	available = DirAccess.rename_absolute(ProjectSettings.globalize_path(PATH + ".tmp"), ProjectSettings.globalize_path(PATH)) == OK

func unlocked(index: int) -> bool:
	return index >= 0 and index < 12 and index <= value.completed.size()

func stars(index: int) -> int:
	return int(value.completed.get(str(index), {}).get("stars", 0))

func finish(index: int, boat: Dictionary, course: Dictionary) -> void:
	var result := {"stars": River.stars(boat, course), "score": River.score(boat), "seconds": float(boat.time), "bumps": int(boat.bumps), "paper": bool(boat.paper)}
	var old: Dictionary = value.completed.get(str(index), {})
	if old.is_empty() or int(result.stars) > int(old.stars) or (int(result.stars) == int(old.stars) and float(result.seconds) < float(old.seconds)):
		value.completed[str(index)] = result
	value.current = mini(11, index + 1)
	value.attempt = {}
	persist()
