extends Control

const River = preload("res://river.gd")
const Save = preload("res://save_store.gd")
const Sound = preload("res://sound.gd")
const PAPER := Color("F4E7CF")
const SEA := Color("102B3D")
const WATER := Color("21495B")
const COPPER := Color("ECA36D")
const AQUA := Color("9CD2C8")
var courses: Array = []
var progress = Save.new()
var boat: Dictionary = {}
var course_index := 0
var mode := "home"
var keys: Dictionary = {}
var fingers: Dictionary = {}
var mouse_side := -1
var mouse_direction := 0.0
var paddles := Vector2.ZERO
var wait_release := false
var unit := 1.0
var board_origin := Vector2.ZERO
var board_scale := 1.0
var portrait := false
var panels: Array[Rect2] = []
var buttons: Array[Button] = []
var font: Font
var music: AudioStreamPlayer
var effects: Array[AudioStreamPlayer] = []
var notes: Array[AudioStreamWAV] = []
var animation := 0.0
var save_clock := 0.0
var toast := ""
var toast_time := 0.0
var sparks: Array = []
var trail: Array = []

func _ready() -> void:
	courses = JSON.parse_string(FileAccess.get_file_as_string("res://data/courses.json")).courses
	progress.load_progress(courses)
	font = ThemeDB.fallback_font
	for i in range(4):
		var player := AudioStreamPlayer.new()
		player.volume_db = -16
		add_child(player)
		effects.append(player)
	for hz in [220.0, 330.0, 440.0, 660.0]:
		notes.append(Sound.tone(hz, 0.38))
	music = AudioStreamPlayer.new()
	music.stream = Sound.score()
	music.volume_db = -22
	add_child(music)
	AudioServer.set_bus_mute(0, progress.value.muted)
	get_viewport().size_changed.connect(_resize)
	_layout()

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		if mode == "play":
			_pause()
		_clear_controls()
	if what == NOTIFICATION_WM_CLOSE_REQUEST and mode == "play":
		_checkpoint()

func _process(delta: float) -> void:
	var dt := minf(delta, 1.0 / 30.0)
	if progress.value.motion and mode != "paused":
		animation += dt
	toast_time = maxf(0.0, toast_time - dt)
	if mode == "play":
		paddles = _controls()
		var events := River.step(boat, courses[course_index], paddles.x, paddles.y, delta)
		for event in events:
			if event.kind == "collision":
				_message("Foi só uma onda: vocês voltaram ao último porto.")
				_sound(0)
			elif event.kind == "paper":
				_message("Carta encontrada · +200 pontos")
				_sound(2)
			elif event.kind == "dock":
				_sound(3)
				_message("Entrega %d de 3 · juntos, mais longe" % int(event.index))
				_checkpoint()
			if event.kind in ["collision", "paper", "dock"] and progress.value.motion:
				sparks.append({"position": event.position, "age": 0.0, "color": COPPER if event.kind == "collision" else AQUA})
		if progress.value.motion and Vector2(boat.vx, boat.vy).length() > 18.0 and (trail.is_empty() or Vector2(boat.x, boat.y).distance_to(trail[-1].position) > 12.0):
			trail.append({"position": Vector2(boat.x, boat.y), "age": 0.0})
		save_clock += dt
		if save_clock >= 1.0:
			_checkpoint()
			save_clock = 0.0
		if boat.ended:
			progress.finish(course_index, boat, courses[course_index])
			mode = "won"
			_clear_controls()
			_layout()
	if mode != "paused":
		for spark in sparks:
			spark.age += dt
		for point in trail:
			point.age += dt
		sparks = sparks.filter(func(s): return s.age < 1.0)
		trail = trail.filter(func(s): return s.age < 1.4)
	queue_redraw()

func _clear_controls() -> void:
	keys.clear()
	fingers.clear()
	mouse_side = -1
	mouse_direction = 0.0
	paddles = Vector2.ZERO
	wait_release = true

func _controls() -> Vector2:
	var values := Vector2(float(keys.has(KEY_W)) - float(keys.has(KEY_S)), float(keys.has(KEY_UP)) - float(keys.has(KEY_DOWN)))
	for finger in fingers.values():
		values[int(finger.side)] += float(finger.direction)
	if mouse_side >= 0:
		values[mouse_side] += mouse_direction
	var pads := Input.get_connected_joypads()
	var sticks := Vector2.ZERO
	for side in range(mini(2, pads.size())):
		var axis := -Input.get_joy_axis(pads[side], JOY_AXIS_LEFT_Y)
		sticks[side] = (axis if absf(axis) > 0.2 else 0.0) + float(Input.is_joy_button_pressed(pads[side], JOY_BUTTON_A)) - float(Input.is_joy_button_pressed(pads[side], JOY_BUTTON_B))
	if wait_release:
		if sticks.length_squared() < 0.01:
			wait_release = false
		sticks = Vector2.ZERO
	values += sticks
	return Vector2(clampf(values.x, -1.0, 1.0), clampf(values.y, -1.0, 1.0))

func _input(event: InputEvent) -> void:
	if event is InputEventKey:
		var code: int = event.physical_keycode if event.physical_keycode != 0 else event.keycode
		if not event.pressed:
			keys.erase(code)
		elif not event.echo:
			if code in [KEY_ESCAPE, KEY_P] and mode in ["play", "paused"]:
				_pause() if mode == "play" else _resume()
				get_viewport().set_input_as_handled()
			elif mode == "play" and code in [KEY_W, KEY_S, KEY_UP, KEY_DOWN]:
				keys[code] = true
				get_viewport().set_input_as_handled()
	if mode != "play":
		return
	if event is InputEventScreenTouch:
		if not event.pressed:
			fingers.erase(event.index)
		else:
			for side in range(2):
				if panels[side].has_point(event.position):
					fingers[event.index] = {"side": side, "direction": _panel_direction(side, event.position)}
					get_viewport().set_input_as_handled()
	elif event is InputEventScreenDrag and fingers.has(event.index):
		var side: int = int(fingers[event.index].side)
		fingers[event.index].direction = _panel_direction(side, event.position)
		get_viewport().set_input_as_handled()
	elif event is InputEventMouseButton and event.device != InputEvent.DEVICE_ID_EMULATION and event.button_index == MOUSE_BUTTON_LEFT:
		if not event.pressed:
			mouse_side = -1
		else:
			for side in range(2):
				if panels[side].has_point(event.position):
					mouse_side = side
					mouse_direction = _panel_direction(side, event.position)
	elif event is InputEventMouseMotion and mouse_side >= 0 and event.device != InputEvent.DEVICE_ID_EMULATION:
		mouse_direction = _panel_direction(mouse_side, event.position)

func _panel_direction(side: int, pos: Vector2) -> float:
	if not panels[side].has_point(pos):
		return 0.0
	var relative := (pos.y - panels[side].position.y) / panels[side].size.y
	return 1.0 if relative < 0.46 else -1.0 if relative > 0.54 else 0.0

func _resize() -> void:
	_clear_controls()
	if mode == "play":
		_pause()
	else:
		_layout()

func _layout() -> void:
	var size := get_viewport_rect().size
	portrait = size.x < size.y
	unit = size.x / 390.0 if portrait else minf(size.x / 1060.0, size.y / 820.0)
	var margin := 22.0 * unit
	var panel_height := 143.0 * unit
	var panel_y := size.y - panel_height - 20.0 * unit
	var panel_width := (size.x - 3.0 * margin) / 2.0
	panels = [Rect2(margin, panel_y, panel_width, panel_height), Rect2(2.0 * margin + panel_width, panel_y, panel_width, panel_height)]
	var area := Rect2(margin, 122.0 * unit, size.x - margin * 2.0, panel_y - 144.0 * unit)
	board_scale = minf(area.size.x / River.WIDTH, area.size.y / River.HEIGHT)
	board_origin = area.position + (area.size - Vector2(River.WIDTH, River.HEIGHT) * board_scale) / 2.0
	_rebuild_ui()

func _button(text: String, rect: Rect2, action: Callable, primary: bool = false) -> Button:
	var button := Button.new()
	button.text = text
	button.position = rect.position
	button.size = rect.size
	button.add_theme_font_size_override("font_size", maxi(12, int(15 * unit)))
	button.add_theme_color_override("font_color", SEA if primary else PAPER)
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	for state in ["normal", "hover", "pressed", "focus"]:
		var style := StyleBoxFlat.new()
		style.bg_color = COPPER if primary else Color("1C3F51")
		if state == "hover":
			style.bg_color = Color("F9BE8D") if primary else Color("2A5867")
		style.border_color = PAPER if state == "focus" else Color(0.61, 0.82, 0.78, 0.35)
		style.set_border_width_all(2 if state == "focus" else 1)
		style.set_corner_radius_all(int(7 * unit))
		button.add_theme_stylebox_override(state, style)
	button.pressed.connect(action)
	add_child(button)
	buttons.append(button)
	return button

func _rebuild_ui() -> void:
	for button in buttons:
		remove_child(button)
		button.queue_free()
	buttons.clear()
	var size := get_viewport_rect().size
	var margin := 25.0 * unit
	if mode == "home":
		var y := size.y * 0.64
		_button("Continuar viagem" if not progress.value.attempt.is_empty() or not progress.value.completed.is_empty() else "Remar juntos", Rect2(margin, y, 280 * unit, 52 * unit), _continue_game, true)
		_button("Carta das marés", Rect2(margin, y + 64 * unit, 280 * unit, 46 * unit), _map)
	elif mode == "map":
		var columns := 3 if portrait else 4
		var width := (size.x - 2.0 * margin) / float(columns)
		var rows := 4 if portrait else 3
		var height := (size.y - 240 * unit) / float(rows)
		for i in range(12):
			var index := i
			var unlocked: bool = progress.unlocked(i)
			var title: String = "%02d · %s\n%s" % [i + 1, courses[i].name if unlocked else "Maré por abrir", "%d/3 estrelas" % progress.stars(i) if progress.stars(i) > 0 else "Sem travessia" if unlocked else "Concluam a anterior"]
			var button := _button(title, Rect2(margin + (i % columns) * width, 130 * unit + floori(i / float(columns)) * height, width - 8 * unit, height - 12 * unit), func(): _load_course(index))
			button.disabled = not unlocked
		_button("Voltar", Rect2(margin, size.y - 80 * unit, 125 * unit, 44 * unit), _home)
	elif mode == "play":
		_button("Pausa", Rect2(size.x - 108 * unit, 25 * unit, 86 * unit, 42 * unit), _pause)
	elif mode in ["paused", "won"]:
		var y := size.y * 0.48
		var x := size.x / 2.0 - 140 * unit
		_button("Retomar" if mode == "paused" else "Mais uma travessia" if course_index < 11 else "Nossa carta completa", Rect2(x, y, 280 * unit, 52 * unit), _resume if mode == "paused" else _next, true)
		_button("Reiniciar travessia", Rect2(x, y + 64 * unit, 280 * unit, 44 * unit), func(): _load_course(course_index, false))
		_button("Carta das marés", Rect2(x, y + 119 * unit, 280 * unit, 44 * unit), _map)
	elif mode == "ending":
		_button("Revisitar as ilhas", Rect2(margin, size.y * 0.7, 280 * unit, 52 * unit), _map, true)
		_button("Voltar ao início", Rect2(margin, size.y * 0.7 + 64 * unit, 280 * unit, 44 * unit), _home)
	if mode in ["home", "paused", "ending"]:
		var x := size.x - 290 * unit if not portrait else margin
		var y := size.y - 66 * unit
		_button("Som: não" if progress.value.muted else "Som: sim", Rect2(x, y, 124 * unit, 42 * unit), _mute)
		_button("Ondas: sim" if progress.value.motion else "Ondas: não", Rect2(x + 134 * unit, y, 134 * unit, 42 * unit), _motion)

	for button in buttons:
		if not button.disabled:
			button.grab_focus()
			break

func _continue_game() -> void:
	_load_course(int(progress.value.current), true)

func _load_course(index: int, resume: bool = false) -> void:
	if not progress.unlocked(index):
		return
	course_index = index
	boat = progress.value.attempt.duplicate(true) if resume and not progress.value.attempt.is_empty() and int(progress.value.current) == index else River.fresh(index, courses[index])
	progress.value.current = index
	mode = "play"
	trail.clear()
	sparks.clear()
	_clear_controls()
	_checkpoint()
	music.stream_paused = false
	if not music.playing:
		music.play()
	_message(courses[index].hint)
	_layout()

func _checkpoint() -> void:
	if not boat.is_empty() and not boat.ended:
		progress.value.current = course_index
		progress.value.attempt = boat.duplicate(true)
		progress.persist()

func _pause() -> void:
	_checkpoint()
	_clear_controls()
	mode = "paused"
	music.stream_paused = true
	_layout()

func _resume() -> void:
	_clear_controls()
	mode = "play"
	music.stream_paused = false
	_layout()

func _map() -> void:
	if mode == "play":
		_checkpoint()
	_clear_controls()
	mode = "map"
	music.stream_paused = true
	_layout()

func _home() -> void:
	_clear_controls()
	mode = "home"
	music.stream_paused = true
	_layout()

func _next() -> void:
	if course_index == 11:
		mode = "ending"
		_layout()
	else:
		_load_course(course_index + 1)

func _mute() -> void:
	progress.value.muted = not progress.value.muted
	AudioServer.set_bus_mute(0, progress.value.muted)
	progress.persist()
	_layout()

func _motion() -> void:
	progress.value.motion = not progress.value.motion
	progress.persist()
	_layout()

func _message(text: String) -> void:
	toast = text
	toast_time = 4.5

func _sound(index: int) -> void:
	var player: AudioStreamPlayer = effects[index]
	player.stream = notes[index]
	player.play()

func _text(text: String, pos: Vector2, size: float, color: Color = PAPER) -> void:
	draw_string(font, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1, maxi(10, int(size)), color)

func _draw() -> void:
	if font == null:
		return
	var size := get_viewport_rect().size
	draw_rect(Rect2(Vector2.ZERO, size), SEA)
	if mode in ["home", "ending"]:
		_draw_home(size)
	elif mode == "map":
		_text("CARTA DAS MARÉS", Vector2(26, 50) * unit, 14 * unit, AQUA)
		_text("Doze portos de volta para casa.", Vector2(26, 92) * unit, 23 * unit)
	else:
		_text("MARÉ A DOIS  /  %02d" % (course_index + 1), Vector2(24, 39) * unit, 13 * unit, AQUA)
		_text(courses[course_index].name, Vector2(24, 77) * unit, (23 if portrait else 29) * unit)
		_text("%d/3 entregas · %s · %d s" % [mini(3, int(boat.dock)), "carta a bordo" if boat.paper else "procurem a carta", int(boat.time)], Vector2(24, 105) * unit, 13 * unit)
		draw_set_transform(board_origin, 0.0, Vector2.ONE * board_scale)
		_draw_water(courses[course_index], boat)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		_draw_controls()
		if toast_time > 0.0 and mode == "play":
			_text(toast, Vector2(25 * unit, panels[0].position.y - 8 * unit), (10 if portrait else 13) * unit, AQUA)
		if mode in ["paused", "won"]:
			draw_rect(Rect2(Vector2.ZERO, size), Color(0.025, 0.08, 0.12, 0.91))
			var title := "A maré espera." if mode == "paused" else "Uma chegada, dois remos."
			var x := size.x * 0.5 - 140 * unit
			_text(title, Vector2(x, size.y * 0.3), (23 if portrait else 30) * unit)
			var detail := "Retomem quando os dois estiverem prontos." if mode == "paused" else "%d pontos · %d/3 estrelas · %d s" % [River.score(boat), River.stars(boat, courses[course_index]), int(boat.time)]
			_text(detail, Vector2(x, size.y * 0.3 + 36 * unit), 13 * unit, AQUA)
	if progress.incompatible or not progress.available:
		_text("Save preservado; esta viagem segue só em memória." if progress.incompatible else "Sem armazenamento; mantenham esta aba aberta.", Vector2(25 * unit, size.y - 7 * unit), 10 * unit, COPPER)

func _draw_home(size: Vector2) -> void:
	var margin := 25.0 * unit
	_text("UM BARCO · DOIS REMOS · UM DESTINO", Vector2(margin, size.y * 0.10), 12 * unit, AQUA)
	_text("De volta" if mode == "ending" else "Maré", Vector2(margin, size.y * 0.23), (44 if portrait else 72) * unit)
	_text("para casa." if mode == "ending" else "a Dois", Vector2(margin, size.y * 0.23 + 66 * unit), (44 if portrait else 72) * unit, COPPER)
	var y := size.y * 0.45
	_text("Doze travessias. Trinta e seis entregas." if mode == "ending" else "Vocês remam o mesmo barco.", Vector2(margin, y), 17 * unit)
	_text("O melhor caminho foi o que fizeram juntos." if mode == "ending" else "Um cuida do remo esquerdo, o outro do direito.", Vector2(margin, y + 29 * unit), (12 if portrait else 16) * unit, AQUA)
	_text("Revisitem as ilhas e encontrem todas as cartas." if mode == "ending" else "W / S + CIMA / BAIXO   ou dois dedos / controles", Vector2(margin, y + 58 * unit), (11 if portrait else 14) * unit, AQUA)
	if not portrait:
		var origin := Vector2(size.x * 0.60, size.y * 0.14)
		draw_set_transform(origin, 0.12, Vector2.ONE * unit * 0.78)
		for i in range(13):
			var p := Vector2(110 + cos(i * 0.71) * 150, 20 + i * 35)
			draw_arc(p, 15 + i * 2, 0.2, 2.9, 32, Color(0.61, 0.82, 0.78, 0.15), 1.0, true)
		_draw_boat(Vector2(100, 210), -0.7, Vector2(0.7, 0.55))
		_draw_island(Vector2(245, 370), 46.0)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _draw_controls() -> void:
	for side in range(2):
		var rect: Rect2 = panels[side]
		var color := COPPER if side == 0 else AQUA
		draw_rect(rect, Color(0.16, 0.30, 0.36, 0.75))
		draw_rect(rect, Color(color, 0.55 if absf(paddles[side]) > 0.01 else 0.22), false, 1.0)
		draw_line(rect.position + Vector2(10 * unit, rect.size.y * 0.5), rect.position + Vector2(rect.size.x - 10 * unit, rect.size.y * 0.5), Color(color, 0.22), 1.0)
		var x := rect.position.x + 13 * unit
		_text(("01  ESQUERDA  ·  W / S" if side == 0 else "02  DIREITA · CIMA/BAIXO"), Vector2(x, rect.position.y + 23 * unit), (10 if portrait else 13) * unit, color)
		_text("REMAR", Vector2(x, rect.position.y + 50 * unit), 16 * unit, color if paddles[side] > 0.0 else PAPER)
		_text("FREAR / RECUAR", Vector2(x, rect.position.y + 109 * unit), (11 if portrait else 14) * unit, color if paddles[side] < 0.0 else PAPER)

func _draw_water(course: Dictionary, s: Dictionary) -> void:
	draw_rect(Rect2(0, 0, River.WIDTH, River.HEIGHT), WATER)
	for i in range(36):
		var point := Vector2(30 + (i % 9) * 113, 40 + floori(i / 9.0) * 163)
		point.x += sin(animation * 0.6 + i) * 4.0
		draw_arc(point, 18.0 + (i % 4) * 5, 0.2, 2.9, 20, Color(0.61, 0.82, 0.78, 0.12), 1.1, true)
	for current in course.currents:
		var point := River.point(current.position)
		draw_circle(point, float(current.radius), Color(0.35, 0.69, 0.71, 0.08))
		var direction := River.point(current.force).normalized()
		for i in range(3):
			var pos := point + Vector2(-25, (i - 1) * 22)
			draw_line(pos, pos + direction * 48, Color(0.61, 0.82, 0.78, 0.45), 2.0, true)
			draw_line(pos + direction * 48, pos + direction * 39 + direction.orthogonal() * 6, AQUA, 2.0, true)
	var previous := River.point(course.start)
	for i in range(course.docks.size()):
		var pos := River.point(course.docks[i])
		draw_dashed_line(previous, pos, Color(0.96, 0.90, 0.81, 0.14), 1.2, 7.0, true)
		var active: bool = i == int(s.dock)
		var completed: bool = i < int(s.dock)
		draw_circle(pos, 38.0, Color(0.61, 0.82, 0.78, 0.17 if active else 0.06))
		draw_arc(pos, 36.0 + (sin(animation * 2.0) * 2.0 if active else 0.0), 0.0, TAU, 48, AQUA if active or completed else Color(0.61, 0.82, 0.78, 0.28), 2.0, true)
		draw_rect(Rect2(pos - Vector2(12, 7), Vector2(24, 14)), COPPER if completed else PAPER)
		draw_line(pos - Vector2(10, 6), pos + Vector2(0, 3), SEA, 1.6, true)
		draw_line(pos + Vector2(10, -6), pos + Vector2(0, 3), SEA, 1.6, true)
		_text(str(i + 1), pos + Vector2(-6, 59), maxf(16.0, 11.0 / board_scale), AQUA if completed else PAPER)
		if completed:
			draw_line(pos + Vector2(13, 50), pos + Vector2(18, 55), AQUA, 2.0, true)
			draw_line(pos + Vector2(18, 55), pos + Vector2(28, 43), AQUA, 2.0, true)
		previous = pos
	for island in course.islands:
		_draw_island(River.point(island.position), float(island.radius))
	if not s.paper:
		var point := River.point(course.paper)
		draw_circle(point, 20, Color(0.93, 0.64, 0.43, 0.16))
		draw_colored_polygon(PackedVector2Array([point + Vector2(0, -13), point + Vector2(11, 0), point + Vector2(0, 13), point + Vector2(-11, 0)]), COPPER)
	for wake in trail:
		draw_arc(wake.position, 12 + float(wake.age) * 15, 0.0, TAU, 24, Color(0.61, 0.82, 0.78, (1.0 - float(wake.age) / 1.4) * 0.18), 1.2, true)
	_draw_boat(Vector2(float(s.x), float(s.y)), float(s.angle), paddles)
	for spark in sparks:
		draw_arc(spark.position, 8 + float(spark.age) * 60, 0.0, TAU, 40, Color(spark.color, 1.0 - float(spark.age)), 2.0, true)
	var wind := River.point(course.wind)
	if wind.length() > 0.1:
		_text("VENTO", Vector2(770, 45), 13, AQUA)
		draw_line(Vector2(858, 40), Vector2(858, 40) + wind.normalized() * 48, COPPER, 3.0, true)
	draw_rect(Rect2(0, 0, River.WIDTH, River.HEIGHT), Color(0.61, 0.82, 0.78, 0.35), false, 2.0)

func _draw_island(pos: Vector2, radius: float) -> void:
	draw_circle(pos + Vector2(3, 5), radius + 8.0, Color(0.04, 0.13, 0.18, 0.3))
	draw_circle(pos, radius + 2.0, COPPER)
	draw_circle(pos, radius - 2.0, PAPER)
	for i in range(3):
		var p := pos + Vector2(-radius * 0.48 + i * radius * 0.45, sin(i * 2.0) * radius * 0.22)
		draw_line(p + Vector2(0, 8), p - Vector2(0, radius * 0.4), WATER, 2.0, true)
		draw_colored_polygon(PackedVector2Array([p + Vector2(-8, 0), p + Vector2(0, -radius * 0.55), p + Vector2(8, 0)]), WATER)

func _draw_boat(pos: Vector2, angle: float, values: Vector2) -> void:
	var direction := River.direction(angle)
	var side := direction.orthogonal()
	var hull := PackedVector2Array([pos + direction * 26, pos + direction * 13 + side * 14, pos - direction * 19 + side * 12, pos - direction * 24, pos - direction * 19 - side * 12, pos + direction * 13 - side * 14])
	var shadow := hull.duplicate()
	for i in range(shadow.size()):
		shadow[i] += Vector2(3, 5)
	draw_colored_polygon(shadow, Color(0.02, 0.09, 0.13, 0.5))
	draw_colored_polygon(hull, PAPER)
	for i in range(hull.size()):
		draw_line(hull[i], hull[(i + 1) % hull.size()], COPPER, 2.0, true)
	for index in range(2):
		var sign_value := -1.0 if index == 0 else 1.0
		var seat := pos + direction * (7 if index == 0 else -8)
		var swing := sin(animation * 8.0) * 8.0 * values[index]
		var tip := seat + side * 35 * sign_value - direction * (8 + swing)
		draw_line(seat, tip, COPPER if index == 0 else AQUA, 3.5, true)
		draw_line(tip - direction * 6, tip + direction * 6, COPPER if index == 0 else AQUA, 7.0, true)
		draw_circle(seat, 6.0, COPPER if index == 0 else AQUA)
		draw_circle(seat - direction * 2, 3.7, SEA)
