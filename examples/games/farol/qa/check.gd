extends SceneTree

const Board = preload("res://board.gd")
func _initialize() -> void:
	var campaign: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/levels.json"))
	var solutions: Array = JSON.parse_string(FileAccess.get_file_as_string("res://qa/solutions.json"))
	var checks: Array = []
	if campaign.levels.size() != 16 or solutions.size() != 16:
		_fail("Missing campaign content")
		return
	for i in range(campaign.levels.size()):
		var board = Board.new()
		board.setup(campaign.levels[i])
		if board.trace().solved:
			_fail("A level starts solved: %d" % i)
			return
		var original: Array = board.rotations.duplicate()
		for action in solutions[i].actions:
			if not board.rotate(int(action.tile), int(action.direction)):
				_fail("Invalid gameplay action")
				return
		if not board.trace().solved:
			_fail("The authored route does not light every beacon: %d" % i)
			return
		while board.undo():
			pass
		if board.rotations != original:
			_fail("Undo lost the original state")
			return
		var hint: Array = board.solve()
		if hint.size() != int(campaign.levels[i].par):
			_fail("Hint/par mismatch: %d" % i)
			return
		for action in hint:
			board.rotate(int(action.tile), int(action.direction))
		if not board.trace().solved:
			_fail("The gameplay hint route cannot finish")
			return
		checks.append({"level": i + 1, "par": hint.size(), "beacons": board.trace().lit.size()})
	print(JSON.stringify({"scope": "pure Godot gameplay actions, not visual/human acceptance", "state": "passed", "levels": checks}))
	quit(0)

func _fail(message: String) -> void:
	printerr(message)
	quit(1)
