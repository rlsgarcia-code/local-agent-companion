extends RefCounted

const PATH := "user://farol-progress-v1.json"
var value: Dictionary = {"schemaVersion": 1, "completed": {}, "current": 0, "attempt": {}, "muted": false, "motion": true}
var available := true
var incompatible := false

func load_progress() -> void:
	if not FileAccess.file_exists(PATH):
		return
	var file := FileAccess.open(PATH, FileAccess.READ)
	if file == null:
		available = false
		return
	var json := JSON.new()
	var error := json.parse(file.get_as_text())
	file.close()
	if error != OK:
		incompatible = true
		return
	var parsed: Variant = json.data
	if not _valid(parsed):
		incompatible = true
		return
	value = parsed
	value.current = int(value.current)

func _integer(number: Variant, low: int, high: int) -> bool:
	return (number is int or number is float) and is_finite(float(number)) and float(number) == floorf(float(number)) and number >= low and number <= high

func _valid(parsed: Variant) -> bool:
	if not parsed is Dictionary or not _integer(parsed.get("schemaVersion"), 1, 1):
		return false
	if not parsed.get("completed") is Dictionary or not parsed.get("attempt") is Dictionary:
		return false
	if not _integer(parsed.get("current"), 0, 15) or not parsed.get("muted") is bool or not parsed.get("motion") is bool:
		return false
	# A campaign is opened in order. Invalid saves stay untouched, rather than
	# leaving Continue pointed at a locked island or coercing arbitrary JSON.
	if parsed.completed.size() > 16 or int(parsed.current) > parsed.completed.size():
		return false
	for i in range(parsed.completed.size()):
		var result: Variant = parsed.completed.get(str(i))
		if not result is Dictionary or not _integer(result.get("stars"), 1, 3) or not _integer(result.get("moves"), 0, 100000):
			return false
	var attempt: Dictionary = parsed.attempt
	if not attempt.is_empty():
		if not _integer(attempt.get("level"), 0, mini(15, parsed.completed.size())) or int(attempt.level) != int(parsed.current):
			return false
		if not _integer(attempt.get("moves"), 0, 100000) or not _integer(attempt.get("hints"), 0, 100000):
			return false
		if not attempt.get("rotations") is Array or attempt.rotations.is_empty() or attempt.rotations.size() > 128:
			return false
		for rotation in attempt.rotations:
			if not _integer(rotation, 0, 3):
				return false
	return true

func persist() -> void:
	# Preserve incompatible bytes. The entire game remains playable in memory.
	if incompatible:
		return
	var file := FileAccess.open(PATH + ".tmp", FileAccess.WRITE)
	if file == null:
		available = false
		return
	file.store_string(JSON.stringify(value))
	file.flush()
	file.close()
	available = DirAccess.rename_absolute(ProjectSettings.globalize_path(PATH + ".tmp"), ProjectSettings.globalize_path(PATH)) == OK

func stars(index: int) -> int:
	return int(value.completed.get(str(index), {}).get("stars", 0))

func unlocked(index: int) -> bool:
	return index == 0 or stars(index - 1) > 0

func finish(index: int, moves: int, hints: int, par: int) -> int:
	var earned := 3 if moves <= par and hints == 0 else 2 if moves <= par + 3 else 1
	var old: Dictionary = value.completed.get(str(index), {})
	if old.is_empty() or earned > int(old.stars) or (earned == int(old.stars) and moves < int(old.moves)):
		value.completed[str(index)] = {"stars": earned, "moves": moves}
	value.current = mini(index + 1, 15)
	value.attempt = {}
	persist()
	return earned
