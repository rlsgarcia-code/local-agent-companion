extends SceneTree

const Save = preload("res://save_store.gd")
var game: Control

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	game = load("res://main.tscn").instantiate()
	root.add_child(game)
	await process_frame
	if game.courses.size() != 12 or game.mode != "home":
		_fail("Native scene did not load the campaign/home")
		return
	var start: Button = game.buttons[0]
	start.pressed.emit()
	await process_frame
	if game.mode != "play":
		_fail("Ordinary start button did not enter play")
		return
	var origin := Vector2(game.boat.x, game.boat.y)
	_key(KEY_W, true)
	_key(KEY_UP, true)
	for i in range(90):
		await process_frame
	_key(KEY_W, false)
	_key(KEY_UP, false)
	if Vector2(game.boat.x, game.boat.y).distance_to(origin) < 20.0:
		_fail("Two independent ordinary keys did not move the boat")
		return
	_key(KEY_P, true)
	_key(KEY_P, false)
	await process_frame
	var paused := JSON.stringify(game.boat)
	for i in range(30):
		await process_frame
	if game.mode != "paused" or JSON.stringify(game.boat) != paused:
		_fail("Pause advanced the boat or lost its state")
		return
	var saved = Save.new()
	saved.load_progress(game.courses)
	if saved.incompatible or not _same_state(saved.value.attempt, game.progress.value.attempt):
		_fail("Checkpoint did not roundtrip: " + JSON.stringify({"incompatible": saved.incompatible, "available": saved.available, "writeAvailable": game.progress.available, "actual": saved.value.attempt, "expected": game.progress.value.attempt}, "", true, true))
		return
	game.buttons[0].pressed.emit()
	await process_frame
	if game.mode != "play":
		_fail("Resume button failed")
		return
	for side in range(2):
		_touch(side, true, game.panels[side].position + game.panels[side].size * Vector2(0.5, 0.25))
	for i in range(30):
		await process_frame
	if game.paddles.x < 0.99 or game.paddles.y < 0.99:
		_fail("Two simultaneous contacts did not retain independent oars: " + JSON.stringify({"mode": game.mode, "paddles": str(game.paddles), "fingers": game.fingers, "panels": str(game.panels), "mouse": game.mouse_side}))
		return
	_touch(0, false, Vector2.ZERO)
	await process_frame
	if game.paddles.x != 0.0 or game.paddles.y < 0.99:
		_fail("Releasing one contact changed the other oar")
		return
	_touch(1, false, Vector2.ZERO)
	await process_frame
	if game.paddles != Vector2.ZERO or not game.fingers.is_empty():
		_fail("Contact release left a stuck oar")
		return
	game.notification(MainLoop.NOTIFICATION_APPLICATION_FOCUS_OUT)
	await process_frame
	if game.mode != "paused":
		_fail("Focus loss did not pause")
		return
	var text := "{incompatible: preserve this original}"
	var file := FileAccess.open(Save.PATH, FileAccess.WRITE)
	file.store_string(text)
	file.close()
	var broken = Save.new()
	broken.load_progress(game.courses)
	broken.persist()
	if not broken.incompatible or FileAccess.get_file_as_string(Save.PATH) != text:
		_fail("Malformed save was overwritten")
		return
	var music = preload("res://sound.gd").score()
	if music.data.size() != 529200 or music.mix_rate != 22050:
		_fail("Original score did not render its declared PCM")
		return
	print(JSON.stringify({"state": "passed", "scope": "isolated native scene/synthetic input, not browser/physical/human acceptance", "homeAndStart": true, "keyboardTwoOars": true, "pauseFrozen": true, "checkpointRoundtrip": true, "simultaneousContacts": true, "partialContactReleaseIndependent": true, "releaseClearsOars": true, "focusPauses": true, "invalidSavePreserved": true, "originalPcmRendered": true}))
	quit(0)

func _key(code: int, down: bool) -> void:
	var event := InputEventKey.new()
	event.physical_keycode = code
	event.keycode = code
	event.pressed = down
	Input.parse_input_event(event)

func _touch(index: int, down: bool, position: Vector2) -> void:
	var event := InputEventScreenTouch.new()
	event.index = index
	event.pressed = down
	event.position = position
	# The scene coordinates are already local after viewport stretching.
	root.push_input(event, true)

func _fail(message: String) -> void:
	printerr(message)
	quit(1)


func _same_state(actual: Dictionary, expected: Dictionary) -> bool:
	if actual.size() != expected.size():
		return false
	for field in expected:
		if not actual.has(field):
			return false
		if expected[field] is float or expected[field] is int:
			if not (actual[field] is float or actual[field] is int) or absf(float(actual[field]) - float(expected[field])) > 0.000000001:
				return false
		elif actual[field] != expected[field]:
			return false
	return true
