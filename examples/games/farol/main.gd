extends Control

const Board = preload("res://board.gd")
const Save = preload("res://save_store.gd")
const INK := Color("112E3B")
const PAPER := Color("F3E8D4")
const GOLD := Color("F7C866")
const SEA := Color("2C5361")
const MINT := Color("8CB6A2")
var campaign: Dictionary
var board = Board.new()
var progress = Save.new()
var mode := "home"
var level_index := 0
var selected := 0
var hint_index := -1
var hints := 0
var route: Dictionary = {}
var time := 0.0
var reveal := 1.0
var earned := 0
var message := ""
var buttons: Array[Button] = []
var sounds: Array[AudioStreamPlayer] = []
var music: AudioStreamPlayer
var font: Font
var board_origin := Vector2.ZERO
var cell := 64.0
var unit := 1.0
var portrait := false
var wide := false
var sparks: Array = []

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	campaign = JSON.parse_string(FileAccess.get_file_as_string("res://data/levels.json"))
	progress.load_progress()
	font = ThemeDB.fallback_font
	for i in range(3):
		var player := AudioStreamPlayer.new()
		player.volume_db = -12
		add_child(player)
		sounds.append(player)
	music = AudioStreamPlayer.new()
	music.volume_db = -24
	music.stream = _music()
	add_child(music)
	AudioServer.set_bus_mute(0, progress.value.muted)
	get_viewport().size_changed.connect(_layout)
	_layout()

func _process(delta: float) -> void:
	if progress.value.motion:
		time += minf(delta, 0.05)
		reveal = minf(1.0, reveal + delta * 3.5)
	else:
		reveal = 1.0
	for particle in sparks:
		particle.age += delta
	sparks = sparks.filter(func(p): return p.age < 1.2)
	queue_redraw()

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT and mode == "play":
		_pause()

func _layout() -> void:
	var size := get_viewport_rect().size
	portrait = size.x < size.y
	wide = size.x / maxf(size.y, 1.0) > 1.8
	unit = size.x / 360.0 if portrait else minf(size.x / 960.0, size.y / 640.0)
	if wide:
		unit = size.y / 400.0
	if mode in ["play", "paused", "won"]:
		var available := Rect2(28 * unit, 125 * unit, size.x - 56 * unit, size.y - 235 * unit)
		if portrait:
			available = Rect2(16 * unit, 151 * unit, size.x - 32 * unit, size.y - 290 * unit)
		elif wide:
			available = Rect2(28 * unit, 18 * unit, size.x * 0.59 - 45 * unit, size.y - 36 * unit)
		cell = minf(available.size.x / float(board.level.width), available.size.y / float(board.level.height))
		board_origin = available.position + (available.size - Vector2(board.level.width, board.level.height) * cell) / 2.0
	_rebuild_ui()
	queue_redraw()

func _button(text: String, rect: Rect2, action: Callable, primary: bool = false) -> Button:
	var button := Button.new()
	button.text = text
	button.position = rect.position
	button.size = rect.size
	button.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	button.add_theme_font_size_override("font_size", int(16 * unit))
	button.add_theme_color_override("font_color", INK if primary else PAPER)
	button.add_theme_color_override("font_hover_color", INK if primary else GOLD)
	button.add_theme_color_override("font_focus_color", INK if primary else GOLD)
	for state in ["normal", "hover", "pressed", "focus"]:
		var style := StyleBoxFlat.new()
		style.bg_color = GOLD if primary else Color(0.07, 0.18, 0.23, 0.88)
		if state == "hover":
			style.bg_color = Color("FFDC87") if primary else Color("254B59")
		style.set_corner_radius_all(int(9 * unit))
		style.border_color = PAPER if state == "focus" else Color(0.55, 0.72, 0.69, 0.3)
		style.set_border_width_all(int(maxf(1.0, 2 * unit if state == "focus" else unit)))
		button.add_theme_stylebox_override(state, style)
	button.pressed.connect(action)
	add_child(button)
	buttons.append(button)
	return button

func _clear_buttons() -> void:
	for button in buttons:
		remove_child(button)
		button.queue_free()
	buttons.clear()

func _rebuild_ui() -> void:
	_clear_buttons()
	var size := get_viewport_rect().size
	if mode == "home":
		var x := 30.0 * unit if portrait else size.x * 0.1
		var y := size.y * 0.61
		_button("Continuar" if not progress.value.completed.is_empty() else "Acender a primeira luz", Rect2(x, y, (300 if not portrait else 300) * unit, 54 * unit), _continue_game, true)
		var secondary := Rect2(x + 314 * unit, y, 220 * unit, 54 * unit) if wide else Rect2(x, y + 68 * unit, 300 * unit, 48 * unit)
		_button("Escolher ilha", secondary, _show_map)
		var preferences_y := y + (68 if wide else 131) * unit
		_button("Som: desligado" if progress.value.muted else "Som: ligado", Rect2(x, preferences_y, 146 * unit, 44 * unit), _toggle_sound)
		_button("Ondas: sim" if progress.value.motion else "Ondas: não", Rect2(x + 154 * unit, preferences_y, 146 * unit, 44 * unit), _toggle_motion)
	elif mode == "map":
		var margin := 28 * unit
		var columns := 8 if wide else 4
		var spacing := (size.x - 2 * margin) / float(columns)
		var start := (135 if wide else 165 if portrait else 150) * unit
		var row_height := minf(105 * unit, (size.y - start - 100 * unit) / (2.0 if wide else 4.0))
		for i in range(16):
			var index := i
			var unlocked: bool = progress.unlocked(i)
			var label := "%02d" % (i + 1) if unlocked else "·"
			if progress.stars(i) > 0:
				label += "  %d/3" % progress.stars(i)
			var button := _button(label, Rect2(margin + (i % columns) * spacing + 3 * unit, start + floori(i / float(columns)) * row_height, spacing - 6 * unit, 62 * unit), func(): _load_level(index), false)
			button.disabled = not unlocked
			button.add_theme_font_size_override("font_size", int(12 * unit))
		_button("Voltar", Rect2(margin, size.y - 67 * unit, 130 * unit, 44 * unit), _home)
	elif mode == "play":
		var base := Vector2(30 * unit, size.y - 76 * unit)
		var width := (size.x - 78 * unit) / 4.0
		if portrait:
			base = Vector2(16 * unit, size.y - 90 * unit)
			width = (size.x - 50 * unit) / 4.0
		if wide:
			base = Vector2(size.x * 0.64, size.y * 0.44)
			width = size.x * 0.31
		for i in range(4):
			var pos := base + (Vector2(0, i * 54 * unit) if wide else Vector2(i * (width + 6 * unit), 0))
			var actions: Array[Callable] = [_undo, _hint, _restart, _pause]
			var button := _button(["Desfazer", "Dica", "Reiniciar", "Pausa"][i], Rect2(pos, Vector2(width, 44 * unit)), actions[i])
			button.add_theme_font_size_override("font_size", int((12 if portrait else 14) * unit))
			if i == 0:
				button.disabled = board.history.is_empty()
	elif mode == "paused":
		var center := size / 2.0
		_button("Retomar", Rect2(center.x - 130 * unit, center.y - 2 * unit, 260 * unit, 48 * unit), _resume, true)
		_button("Mapa das ilhas", Rect2(center.x - 130 * unit, center.y + 60 * unit, 260 * unit, 48 * unit), _show_map)
		_button("Som: desligado" if progress.value.muted else "Som: ligado", Rect2(center.x - 130 * unit, center.y + 122 * unit, 260 * unit, 44 * unit), _toggle_sound)
	elif mode == "won":
		var center := size / 2.0
		_button("Próxima ilha" if level_index < 15 else "Ver o arquipélago", Rect2(center.x - 145 * unit, center.y + 66 * unit, 290 * unit, 52 * unit), _next, true)
		_button("Jogar de novo", Rect2(center.x - 145 * unit, center.y + 132 * unit, 290 * unit, 44 * unit), func(): _load_level(level_index, false))

func _home() -> void:
	mode = "home"
	_rebuild_ui()

func _show_map() -> void:
	if mode == "play":
		_checkpoint()
	mode = "map"
	_rebuild_ui()

func _continue_game() -> void:
	_load_level(clampi(int(progress.value.current), 0, 15))

func _load_level(index: int, restore: bool = true) -> void:
	if not progress.unlocked(index):
		return
	level_index = index
	board.setup(campaign.levels[index])
	selected = 0
	for i in range(board.rotations.size()):
		if board.can_rotate(i):
			selected = i
			break
	hints = 0
	hint_index = -1
	message = str(board.level.tip)
	var attempt: Dictionary = progress.value.attempt
	if restore and not attempt.is_empty() and int(attempt.get("level", -1)) == index:
		var state: Variant = attempt.get("rotations")
		var valid: bool = state is Array and state.size() == board.rotations.size()
		if valid:
			for i in range(state.size()):
				if not (state[i] is float or state[i] is int) or float(state[i]) != floorf(float(state[i])) or state[i] < 0 or state[i] >= board.count_states(board.level.tiles[i]):
					valid = false
				elif not board.can_rotate(i) and int(state[i]) != int(board.rotations[i]):
					valid = false
		if valid:
			board.rotations = state.map(func(v): return int(v))
			board.moves = clampi(int(attempt.get("moves", 0)), 0, 100000)
			hints = clampi(int(attempt.get("hints", 0)), 0, 100000)
		else:
			progress.incompatible = true
	progress.value.current = index
	mode = "play"
	route = board.trace()
	reveal = 0.0
	if not progress.value.muted and not music.playing:
		music.play()
	music.stream_paused = false
	_layout()
	if route.solved:
		_win()

func _checkpoint() -> void:
	progress.value.current = level_index
	progress.value.attempt = {"level": level_index, "rotations": board.rotations.duplicate(), "moves": board.moves, "hints": hints}
	progress.persist()

func _rotate(index: int, direction: int = 1) -> void:
	if mode != "play" or not board.rotate(index, direction):
		return
	selected = index
	hint_index = -1
	var previous: Dictionary = route.get("lit", {})
	route = board.trace()
	reveal = 0.0
	_sound(74 + (index % 5), 0.11)
	for target in board.level.targets:
		if route.lit.has(str(target.id)) and not previous.has(str(target.id)):
			for i in range(7):
				sparks.append({"cell": Vector2(target.x, target.y), "angle": i * TAU / 7.0, "age": 0.0})
	_checkpoint()
	_rebuild_ui()
	if route.solved:
		_win()

func _undo() -> void:
	if mode == "play" and board.undo():
		route = board.trace()
		hint_index = -1
		message = str(board.level.tip)
		_checkpoint()
		_rebuild_ui()

func _restart() -> void:
	if mode == "play":
		board.restart()
		hints = 0
		hint_index = -1
		message = str(board.level.tip)
		route = board.trace()
		_checkpoint()
		_rebuild_ui()

func _hint() -> void:
	if mode != "play":
		return
	var answer: Array = board.solve()
	if not answer.is_empty():
		hint_index = int(answer[0].tile)
		selected = hint_index
		hints += 1
		message = "Gire a peça marcada " + ("para a esquerda." if int(answer[0].direction) < 0 else "para a direita.")
		_checkpoint()

func _pause() -> void:
	if mode != "play":
		return
	_checkpoint()
	mode = "paused"
	music.stream_paused = true
	for player in sounds:
		player.stop()
	_rebuild_ui()

func _resume() -> void:
	mode = "play"
	music.stream_paused = false
	_rebuild_ui()

func _win() -> void:
	earned = progress.finish(level_index, board.moves, hints, int(board.level.par))
	mode = "won"
	_sound(79, 0.75)
	_rebuild_ui()

func _next() -> void:
	if level_index < 15:
		_load_level(level_index + 1, false)
	else:
		_show_map()

func _toggle_sound() -> void:
	progress.value.muted = not progress.value.muted
	AudioServer.set_bus_mute(0, progress.value.muted)
	if not progress.value.muted and not music.playing:
		music.play()
	progress.persist()
	_rebuild_ui()

func _toggle_motion() -> void:
	progress.value.motion = not progress.value.motion
	progress.persist()
	_rebuild_ui()

func _unhandled_input(event: InputEvent) -> void:
	if mode == "play" and event is InputEventMouseButton and event.pressed and event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT]:
		var point := Vector2i((event.position - board_origin) / cell)
		if event.position.x >= board_origin.x and event.position.y >= board_origin.y and board.cells.has(point):
			_rotate(int(board.cells[point]), -1 if event.button_index == MOUSE_BUTTON_RIGHT else 1)
			get_viewport().set_input_as_handled()

func _unhandled_key_input(event: InputEvent) -> void:
	if not event is InputEventKey or not event.pressed or event.echo:
		return
	if event.keycode == KEY_ESCAPE:
		if mode == "play": _pause()
		elif mode == "paused": _resume()
		elif mode == "map": _home()
	elif event.keycode == KEY_M:
		_toggle_sound()
	elif mode == "home" and event.keycode == KEY_ENTER:
		_continue_game()
	elif mode == "won" and event.keycode == KEY_ENTER:
		_next()
	elif mode == "play":
		if event.keycode == KEY_SPACE:
			_rotate(selected, -1 if event.shift_pressed else 1)
		elif event.keycode == KEY_Z:
			_undo()
		elif event.keycode == KEY_R:
			_restart()
		elif event.keycode == KEY_H:
			_hint()
		elif event.keycode in [KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN]:
			var delta := Vector2i(-1, 0) if event.keycode == KEY_LEFT else Vector2i(1, 0) if event.keycode == KEY_RIGHT else Vector2i(0, -1) if event.keycode == KEY_UP else Vector2i(0, 1)
			var origin: Dictionary = board.level.tiles[selected]
			var best := INF
			for i in range(board.level.tiles.size()):
				if not board.can_rotate(i) or i == selected:
					continue
				var tile: Dictionary = board.level.tiles[i]
				var offset := Vector2(tile.x - origin.x, tile.y - origin.y)
				if offset.dot(Vector2(delta)) > 0:
					var score := offset.length() + absf(offset.cross(Vector2(delta))) * 2.0
					if score < best:
						best = score
						selected = i
	get_viewport().set_input_as_handled()

func _text(text: String, pos: Vector2, size: float, color: Color = PAPER, centered: bool = false) -> void:
	var actual := int(maxf(10, size))
	var offset := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, actual).x / 2 if centered else 0.0
	draw_string(font, pos - Vector2(offset, 0), text, HORIZONTAL_ALIGNMENT_LEFT, -1, actual, color)

func _panel(rect: Rect2, color: Color, radius: float = 12.0) -> void:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.set_corner_radius_all(int(radius))
	draw_style_box(style, rect)

func _wrapped_text(text: String, pos: Vector2, width: float, font_size: float) -> void:
	var line := ""
	var baseline := pos
	for word in text.split(" "):
		var candidate: String = word if line.is_empty() else line + " " + word
		if not line.is_empty() and font.get_string_size(candidate, HORIZONTAL_ALIGNMENT_LEFT, -1, int(font_size)).x > width:
			_text(line, baseline, font_size)
			baseline.y += font_size * 1.4
			line = word
		else:
			line = candidate
	_text(line, baseline, font_size)

func _draw() -> void:
	if font == null:
		return
	var size := get_viewport_rect().size
	_scenery(size)
	if mode == "home":
		var x := 30 * unit if portrait else size.x * 0.1
		_text("F A R O L", Vector2(x, size.y * 0.29), (48 if portrait else 76) * unit)
		_text("caminhos de luz", Vector2(x + 3 * unit, size.y * 0.29 + 37 * unit), 21 * unit, GOLD)
		_text("16 ilhas à espera da luz.", Vector2(x, size.y * 0.47), 16 * unit)
		_text("Gire as peças. Acenda os faróis.", Vector2(x, size.y * 0.47 + 27 * unit), 13 * unit, MINT)
		_lighthouse(Vector2(size.x * (0.78 if not portrait else 0.77), size.y * 0.55), (1.8 if not portrait else 0.9) * unit, true)
	elif mode == "map":
		_text("O arquipélago", Vector2(size.x / 2, 65 * unit), 31 * unit, PAPER, true)
		var total := 0
		for i in range(16): total += progress.stars(i)
		_text("%d / 48 estrelas  ·  escolha uma ilha" % total, Vector2(size.x / 2, 96 * unit), 14 * unit, GOLD, true)
		var start := (135 if wide else 165 if portrait else 150) * unit
		var row_height := minf(105 * unit, (size.y - start - 100 * unit) / (2.0 if wide else 4.0))
		for i in range(4):
			var chapter_x := 28 * unit + (size.x - 56 * unit) * 0.5 * (i % 2) if wide else 28 * unit
			var chapter_y := start + (floori(i / 2.0) if wide else i) * row_height - 10 * unit
			_text(str(campaign.chapters[i]), Vector2(chapter_x, chapter_y), 12 * unit, MINT)
	else:
		_draw_board()
		var x := size.x * 0.64 if wide else 28 * unit
		var y := size.y * 0.12 if wide else 40 * unit
		_text("FAROL  /  %02d DE 16" % (level_index + 1), Vector2(x, y), 13 * unit, GOLD)
		_text(str(board.level.title), Vector2(x, y + 34 * unit), (22 if portrait else 28) * unit)
		_text("%d / %d faróis  ·  %d giros" % [route.lit.size(), board.level.targets.size(), board.moves], Vector2(x, y + 60 * unit), 13 * unit, MINT)
		if not wide:
			var tip := message
			if tip.length() > 49 and portrait:
				tip = tip.left(47) + "…"
			_text(tip, Vector2(size.x / 2, size.y - (116 if portrait else 99) * unit), (10 if portrait else 13) * unit, PAPER, true)
		else:
			_wrapped_text(message, Vector2(x, y + 82 * unit), size.x * 0.32, 10 * unit)
		if mode in ["paused", "won"]:
			draw_rect(Rect2(Vector2.ZERO, size), Color(0.025, 0.07, 0.1, 0.89))
			var title := "Pausa" if mode == "paused" else "A ilha acendeu" if level_index < 15 else "A noite ficou clara"
			_text(title, size / 2 + Vector2(0, -78 * unit), 30 * unit, PAPER, true)
			if mode == "won":
				for i in range(3):
					_star(size / 2 + Vector2((i - 1) * 48 * unit, -26 * unit), 18 * unit, GOLD if i < earned else SEA)
				_text("%d %s  ·  desafio %d" % [board.moves, "giro" if board.moves == 1 else "giros", board.level.par], size / 2 + Vector2(0, 15 * unit), 14 * unit, MINT, true)
	if progress.incompatible or not progress.available:
		_text("Save anterior preservado · progresso nesta sessão", Vector2(size.x / 2, size.y - 8 * unit), 10 * unit, GOLD, true)

func _scenery(size: Vector2) -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color("0A202C"))
	for i in range(24):
		var y := size.y * (0.33 + i * 0.035)
		var points := PackedVector2Array()
		for j in range(21):
			var x := j * size.x / 20.0
			points.append(Vector2(x, y + sin(j * 0.6 + time * 0.4 + i) * (3 + i * 0.08) * unit))
		draw_polyline(points, Color(0.17, 0.33, 0.39, 0.1 + i * 0.006), unit, true)
	for i in range(36):
		var p := Vector2(fmod(i * 173.3 + 43.0, size.x), fmod(i * 57.1 + 20.0, size.y * 0.31))
		draw_circle(p, unit * (1.1 if i % 5 == 0 else 0.55), Color(0.96, 0.87, 0.66, 0.25))

func _star(center: Vector2, radius: float, color: Color) -> void:
	var points := PackedVector2Array()
	for i in range(10):
		points.append(center + Vector2.from_angle(-PI / 2.0 + i * PI / 5.0) * radius * (1.0 if i % 2 == 0 else 0.44))
	draw_colored_polygon(points, color)

func _center(point: Vector2) -> Vector2:
	return board_origin + (point + Vector2(0.5, 0.5)) * cell

func _draw_board() -> void:
	var board_size := Vector2(board.level.width, board.level.height) * cell
	_panel(Rect2(board_origin - Vector2.ONE * cell * 0.15, board_size + Vector2.ONE * cell * 0.3), Color(0.045, 0.13, 0.17, 0.84), cell * 0.2)
	for y in range(int(board.level.height)):
		for x in range(int(board.level.width)):
			draw_circle(_center(Vector2(x, y)), cell * 0.025, Color(0.45, 0.67, 0.67, 0.25))
	for i in range(board.level.tiles.size()):
		var tile: Dictionary = board.level.tiles[i]
		var p := _center(Vector2(tile.x, tile.y))
		var rect := Rect2(p - Vector2.ONE * cell * 0.39, Vector2.ONE * cell * 0.78)
		_panel(rect.grow(2 * unit), Color(0.0, 0.04, 0.07, 0.6), cell * 0.12)
		_panel(rect, PAPER if tile.kind != "wall" else SEA, cell * 0.12)
		if tile.kind == "mirror":
			var slope := -1 if int(board.rotations[i]) % 2 == 0 else 1
			draw_line(p + Vector2(-0.24, -0.24 * slope) * cell, p + Vector2(0.24, 0.24 * slope) * cell, INK, cell * 0.09, true)
			draw_line(p + Vector2(-0.24, -0.24 * slope - 0.04) * cell, p + Vector2(0.24, 0.24 * slope - 0.04) * cell, Color.WHITE, cell * 0.025, true)
		elif tile.kind == "lens":
			var axis := Vector2(1, 0) if int(board.rotations[i]) % 2 == 0 else Vector2(0, 1)
			draw_line(p - axis * cell * 0.34, p + axis * cell * 0.34, INK, cell * 0.12, true)
			draw_circle(p, cell * 0.19, MINT)
			draw_arc(p, cell * 0.19, 0, TAU, 24, INK, cell * 0.035, true)
		elif tile.kind == "split":
			for port in range(3):
				var direction: Vector2 = Vector2(Board.DIRS[posmod(int(board.rotations[i]) + port, 4)])
				draw_line(p, p + direction * cell * 0.35, INK, cell * 0.11, true)
			draw_circle(p, cell * 0.1, Color("B47650"))
		else:
			draw_line(p - Vector2.ONE * cell * 0.22, p + Vector2.ONE * cell * 0.22, MINT, cell * 0.04, true)
			draw_line(p + Vector2(-1, 1) * cell * 0.22, p + Vector2(1, -1) * cell * 0.22, MINT, cell * 0.04, true)
		if tile.get("locked", false):
			draw_circle(p + Vector2(0.26, 0.27) * cell, cell * 0.045, Color("B47650"))
		if i == selected and mode == "play":
			var color := GOLD if i == hint_index else Color(0.95, 0.91, 0.8, 0.8)
			draw_rect(rect.grow(cell * 0.07), color, false, cell * 0.035)
	var length: int = route.segments.size()
	for i in range(length):
		var segment: Dictionary = route.segments[i]
		var from := _center(segment.from)
		var to := _center(segment.to)
		var fraction := clampf(reveal * length - i, 0.0, 1.0)
		if fraction <= 0:
			continue
		to = from.lerp(to, fraction)
		draw_line(from, to, Color(0.97, 0.75, 0.32, 0.1), cell * 0.21, true)
		draw_line(from, to, Color(0.97, 0.75, 0.32, 0.22), cell * 0.105, true)
		draw_line(from, to, GOLD, cell * 0.045, true)
	var source: Dictionary = board.level.source
	var lamp := _center(Vector2(source.x, source.y))
	draw_circle(lamp, cell * 0.22, GOLD)
	draw_circle(lamp, cell * 0.11, PAPER)
	for target in board.level.targets:
		var lit: bool = route.lit.has(str(target.id))
		_lighthouse(_center(Vector2(target.x, target.y)) + Vector2(0, cell * 0.28), cell / 92.0, lit)
	for particle in sparks:
		if progress.value.motion:
			var age: float = particle.age
			var point := _center(particle.cell) + Vector2.from_angle(particle.angle) * age * cell * 0.6
			draw_circle(point, cell * 0.027 * (1.0 - age / 1.2), GOLD)

func _lighthouse(base: Vector2, scale_factor: float, lit: bool) -> void:
	var s := scale_factor
	if lit:
		draw_circle(base + Vector2(0, -56) * s, 24 * s, Color(0.97, 0.76, 0.34, 0.09))
	var tower := PackedVector2Array([base + Vector2(-12, 0) * s, base + Vector2(-8, -49) * s, base + Vector2(8, -49) * s, base + Vector2(12, 0) * s])
	draw_colored_polygon(tower, PAPER if lit else MINT)
	draw_rect(Rect2(base + Vector2(-12, -56) * s, Vector2(24, 10) * s), GOLD if lit else INK)
	draw_colored_polygon(PackedVector2Array([base + Vector2(-16, -58) * s, base + Vector2(0, -72) * s, base + Vector2(16, -58) * s]), Color("BB7956"))
	draw_rect(Rect2(base + Vector2(-3, -20) * s, Vector2(6, 12) * s), INK)
	draw_line(base + Vector2(-17, 0) * s, base + Vector2(17, 0) * s, SEA, 3 * s)

func _tone(note: int, duration: float) -> AudioStreamWAV:
	var wave := AudioStreamWAV.new()
	wave.format = AudioStreamWAV.FORMAT_16_BITS
	wave.mix_rate = 22050
	var count := int(duration * 22050)
	var bytes := PackedByteArray()
	bytes.resize(count * 2)
	var frequency := 440.0 * pow(2.0, (note - 69) / 12.0)
	for i in range(count):
		var t := i / 22050.0
		var envelope := minf(1.0, t / 0.015) * pow(1.0 - float(i) / count, 2)
		var sample := int(sin(t * frequency * TAU) * envelope * 14000)
		bytes.encode_s16(i * 2, sample)
	wave.data = bytes
	return wave

func _sound(note: int, duration: float) -> void:
	if progress.value.muted:
		return
	var player: AudioStreamPlayer = sounds[0]
	for candidate in sounds:
		if not candidate.playing:
			player = candidate
			break
	player.stream = _tone(note, duration)
	player.play()

func _music() -> AudioStreamWAV:
	var wave := AudioStreamWAV.new()
	wave.format = AudioStreamWAV.FORMAT_16_BITS
	wave.mix_rate = 22050
	var notes := [52, 55, 59, 62, 64, 62, 59, 55]
	var step := 0.55
	var count := int(notes.size() * step * 22050)
	var bytes := PackedByteArray()
	bytes.resize(count * 2)
	for i in range(count):
		var beat := i / 22050.0 / step
		var note: int = notes[int(beat) % notes.size()]
		var local := fmod(beat, 1.0)
		var frequency := 440.0 * pow(2.0, (note - 69) / 12.0)
		var value := sin(i / 22050.0 * frequency * TAU) * sin(local * PI) * sin(local * PI)
		bytes.encode_s16(i * 2, int(value * 11000))
	wave.data = bytes
	wave.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wave.loop_end = count
	return wave
