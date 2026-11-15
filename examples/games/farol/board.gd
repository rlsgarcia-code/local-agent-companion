extends RefCounted

const DIRS = [Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0), Vector2i(0, -1)]
var level: Dictionary
var rotations: Array = []
var history: Array = []
var cells: Dictionary = {}
var moves := 0

func setup(value: Dictionary) -> void:
	level = value.duplicate(true)
	rotations.clear()
	history.clear()
	moves = 0
	cells.clear()
	for i in range(level.tiles.size()):
		var tile: Dictionary = level.tiles[i]
		rotations.append(int(tile.get("rotation", 0)))
		cells[Vector2i(int(tile.x), int(tile.y))] = i

func count_states(tile: Dictionary) -> int:
	return 4 if tile.kind == "split" else 2

func can_rotate(index: int) -> bool:
	return index >= 0 and index < level.tiles.size() and not level.tiles[index].get("locked", false) and level.tiles[index].kind in ["mirror", "lens", "split"]

func rotate(index: int, direction: int = 1) -> bool:
	if not can_rotate(index):
		return false
	history.append(rotations.duplicate())
	if history.size() > 256:
		history.pop_front()
	moves += 1
	rotations[index] = posmod(int(rotations[index]) + direction, count_states(level.tiles[index]))
	return true

func undo() -> bool:
	if history.is_empty():
		return false
	rotations = history.pop_back()
	moves = maxi(0, moves - 1)
	return true

func restart() -> void:
	setup(level)

func trace(orientations: Array = []) -> Dictionary:
	var state: Array = rotations if orientations.is_empty() else orientations
	var segments: Array = []
	var lit: Dictionary = {}
	var touched: Dictionary = {}
	var visited: Dictionary = {}
	var source: Dictionary = level.source
	var queue: Array = [{"cell": Vector2i(int(source.x), int(source.y)), "direction": int(source.get("direction", 0))}]
	var cursor := 0
	var loops := 0
	while cursor < queue.size() and cursor < int(level.width) * int(level.height) * 8:
		var ray: Dictionary = queue[cursor]
		cursor += 1
		var point: Vector2i = ray.cell
		var direction: int = ray.direction
		var key := "%d:%d:%d" % [point.x, point.y, direction]
		if visited.has(key):
			loops += 1
			continue
		visited[key] = true
		var next: Vector2i = point + DIRS[direction]
		if next.x < 0 or next.y < 0 or next.x >= int(level.width) or next.y >= int(level.height):
			segments.append({"from": Vector2(point), "to": Vector2(point) + Vector2(DIRS[direction]) * 0.5})
			continue
		segments.append({"from": Vector2(point), "to": Vector2(next)})
		var beacon := false
		for target in level.targets:
			if next == Vector2i(int(target.x), int(target.y)):
				lit[str(target.id)] = true
				beacon = true
		if beacon:
			continue
		if next == Vector2i(int(source.x), int(source.y)):
			continue
		if not cells.has(next):
			queue.append({"cell": next, "direction": direction})
			continue
		var index: int = cells[next]
		var tile: Dictionary = level.tiles[index]
		var orientation: int = state[index]
		touched[index] = true
		match str(tile.kind):
			"mirror":
				var reflected: int = [3, 2, 1, 0][direction] if orientation % 2 == 0 else [1, 0, 3, 2][direction]
				queue.append({"cell": next, "direction": reflected})
			"lens":
				if direction % 2 == orientation % 2:
					queue.append({"cell": next, "direction": direction})
			"split":
				var ports: Array = [posmod(orientation, 4), posmod(orientation + 1, 4), posmod(orientation + 2, 4)]
				var incoming := posmod(direction + 2, 4)
				if incoming in ports:
					for port in ports:
						if port != incoming:
							queue.append({"cell": next, "direction": port})
	return {"segments": segments, "lit": lit, "touched": touched, "loops": loops, "solved": lit.size() == level.targets.size()}

func solve(limit: int = 20000) -> Array:
	# Deterministic gameplay hint search. No model, host tools or success telemetry.
	if trace().solved:
		return []
	var queue: Array = [{"state": rotations.duplicate(), "path": []}]
	var seen: Dictionary = {JSON.stringify(rotations): true}
	var cursor := 0
	while cursor < queue.size() and cursor < limit:
		var row: Dictionary = queue[cursor]
		cursor += 1
		for i in range(rotations.size()):
			if not can_rotate(i):
				continue
			for direction in ([1, -1] if count_states(level.tiles[i]) == 4 else [1]):
				var state: Array = row.state.duplicate()
				state[i] = posmod(int(state[i]) + direction, count_states(level.tiles[i]))
				var key := JSON.stringify(state)
				if seen.has(key):
					continue
				seen[key] = true
				var route: Array = row.path.duplicate()
				route.append({"tile": i, "direction": direction})
				if trace(state).solved:
					return route
				queue.append({"state": state, "path": route})
	return []
