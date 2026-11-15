extends SceneTree

const Save = preload("res://save_store.gd")
func _initialize() -> void:
	var store = Save.new()
	store.value.attempt = {"level": 0, "rotations": [1, 0], "moves": 3, "hints": 1}
	store.value.muted = true
	store.value.motion = false
	store.persist()
	if not store.available:
		_fail("Temporary save could not be written")
		return
	var restored = Save.new()
	restored.load_progress()
	if restored.incompatible or not restored.value.muted or restored.value.motion or restored.value.attempt.moves != 3:
		_fail("Progress/preferences were not restored")
		return
	if restored.finish(0, 1, 0, 1) != 3 or not restored.unlocked(1) or restored.unlocked(2):
		_fail("Stars or sequential unlock incorrect")
		return
	restored.finish(0, 7, 1, 1)
	if restored.stars(0) != 3 or restored.value.completed["0"].moves != 1:
		_fail("A worse replay destroyed the best result")
		return
	var valid: Dictionary = restored.value.duplicate(true)
	var bad: Array = ["broken JSON", JSON.stringify({"schemaVersion": 2})]
	for field in ["current", "muted", "motion", "completed", "attempt"]:
		var value: Dictionary = valid.duplicate(true)
		value[field] = null
		bad.append(JSON.stringify(value))
	for field in ["stars", "moves"]:
		var value: Dictionary = valid.duplicate(true)
		value.completed["0"][field] = {"invalid": true}
		bad.append(JSON.stringify(value))
	var fractional: Dictionary = valid.duplicate(true)
	fractional.completed["0"].stars = 1.5
	bad.append(JSON.stringify(fractional))
	var locked: Dictionary = valid.duplicate(true)
	locked.current = 15
	bad.append(JSON.stringify(locked))
	for field in ["level", "moves", "hints", "rotations"]:
		var value: Dictionary = valid.duplicate(true)
		value.attempt = {"level": 1, "moves": 2, "hints": 0, "rotations": [0, 1]}
		value.attempt[field] = {"invalid": true}
		bad.append(JSON.stringify(value))
	for original in bad:
		var file := FileAccess.open(Save.PATH, FileAccess.WRITE)
		file.store_string(original)
		file.close()
		var rejected = Save.new()
		rejected.load_progress()
		if not rejected.incompatible:
			_fail("Invalid save accepted")
			return
		rejected.finish(0, 1, 0, 1)
		if FileAccess.get_file_as_string(Save.PATH) != original:
			_fail("Incompatible bytes overwritten")
			return
	print(JSON.stringify({"state": "passed", "corruptSavesPreserved": bad.size(), "roundTrip": true, "bestResult": true, "sequentialUnlock": true, "scope": "disposable Godot filesystem, not browser IDBFS acceptance"}))
	quit(0)

func _fail(message: String) -> void:
	printerr(message)
	quit(1)
