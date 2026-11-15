extends SceneTree

const River = preload("res://river.gd")
var problems: Array = []

func _initialize() -> void:
	var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/courses.json"))
	var checks: Array = []
	if data.courses.size() != 12:
		_fail("Expected twelve complete courses")
		return
	for index in range(data.courses.size()):
		var course: Dictionary = data.courses[index]
		var state := River.fresh(index, course)
		var frames := 0
		while not state.ended and frames < 18000:
			var controls := steer(state, course)
			River.step(state, course, controls.x, controls.y, 1.0 / 60.0)
			if not River.valid(state, course, index):
				_fail("Invalid state in course " + str(index + 1))
				return
			frames += 1
		if not state.ended:
			_fail("Ordinary paddle controller cannot complete course " + str(index + 1) + ": " + JSON.stringify(state))
			return
		checks.append({"id": course.id, "seconds": state.time, "collisions": state.bumps, "paper": state.paper, "stars": River.stars(state, course), "score": River.score(state)})
	# The controller and search are outside player source/build. Test the real
	# movement API, never writing a position, delivery, score or completion bit.
	var first: Dictionary = data.courses[0]
	var a := River.fresh(0, first)
	var b := River.fresh(0, first)
	for i in range(300):
		River.step(a, first, 1.0, 1.0, 1.0 / 60.0)
		River.step(b, first, 1.0, 1.0, 1.0 / 120.0)
		River.step(b, first, 1.0, 1.0, 1.0 / 120.0)
	if a != b:
		_fail("Different frame cadence changed the same paddle trajectory")
		return
	var turning := River.fresh(0, first)
	for i in range(60):
		River.step(turning, first, 1.0, -1.0, 1.0 / 60.0)
	if absf(float(turning.angle) - float(first.heading)) < 0.5 or Vector2(float(turning.x), float(turning.y)).distance_to(River.point(first.start)) > 1.0:
		_fail("Opposite paddles do not turn without translating")
		return
	var snapshot := JSON.stringify(a)
	River.step(a, first, 1.0, 1.0, 0.0)
	River.step(a, first, NAN, 1.0, 1.0)
	if JSON.stringify(a) != snapshot:
		_fail("Invalid/paused input advanced the boat")
		return
	print(JSON.stringify({"state": "passed", "scope": "isolated Godot pure paddle controls, not visual/human/physical acceptance", "courses": checks, "fixedStepCadence": true, "oppositePaddlesTurn": true}))
	quit(0)

func steer(s: Dictionary, course: Dictionary) -> Vector2:
	var pos := Vector2(float(s.x), float(s.y))
	var target := River.point(course.docks[int(s.dock)])
	var difference := wrapf((target - pos).angle() - float(s.angle), -PI, PI)
	if absf(difference) > 0.11:
		var turn := clampf(difference * 2.8 - float(s.omega) * 1.1, -1.0, 1.0)
		return Vector2(turn, -turn)
	var distance := pos.distance_to(target)
	var speed := Vector2(float(s.vx), float(s.vy)).length()
	var throttle := 1.0
	if distance < 130.0 and speed > 75.0:
		throttle = -0.65
	elif distance < 70.0:
		throttle = 0.3
	var correction := clampf(difference * 2.2 - float(s.omega) * 0.7, -0.65, 0.65)
	return Vector2(clampf(throttle + correction, -1.0, 1.0), clampf(throttle - correction, -1.0, 1.0))

func _fail(message: String) -> void:
	printerr(message)
	quit(1)
