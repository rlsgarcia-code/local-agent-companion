extends RefCounted

const WIDTH := 960.0
const HEIGHT := 600.0
const FIXED := 1.0 / 120.0
const BOAT_RADIUS := 16.0

static func fresh(index: int, course: Dictionary) -> Dictionary:
	return {"course": index, "x": float(course.start[0]), "y": float(course.start[1]), "vx": 0.0, "vy": 0.0, "angle": float(course.heading), "omega": 0.0, "time": 0.0, "carry": 0.0, "dock": 0, "bumps": 0, "paper": false, "ended": false}

static func direction(angle: float) -> Vector2:
	return Vector2(cos(angle), sin(angle))

static func point(value: Array) -> Vector2:
	return Vector2(float(value[0]), float(value[1]))

static func checkpoint(s: Dictionary, course: Dictionary) -> Vector2:
	return point(course.start) if int(s.dock) == 0 else point(course.docks[int(s.dock) - 1])

static func reset_boat(s: Dictionary, course: Dictionary) -> void:
	var pos := checkpoint(s, course)
	s.x = pos.x
	s.y = pos.y
	s.vx = 0.0
	s.vy = 0.0
	s.omega = 0.0
	var target := point(course.docks[mini(int(s.dock), course.docks.size() - 1)])
	s.angle = (target - pos).angle()
	s.carry = 0.0

static func step(s: Dictionary, course: Dictionary, left: float, right: float, seconds: float) -> Array:
	var events: Array = []
	if s.ended or not is_finite(seconds) or seconds <= 0.0 or not is_finite(left) or not is_finite(right):
		return events
	left = clampf(left, -1.0, 1.0)
	right = clampf(right, -1.0, 1.0)
	s.carry += minf(seconds, 1.0 / 30.0)
	while float(s.carry) + 0.000000000001 >= FIXED and not s.ended:
		s.carry = maxf(0.0, float(s.carry) - FIXED)
		s.time += FIXED
		var velocity := Vector2(float(s.vx), float(s.vy))
		s.omega += ((left - right) * 4.2 - float(s.omega) * 3.8) * FIXED
		s.angle = wrapf(float(s.angle) + float(s.omega) * FIXED, -PI, PI)
		var force := direction(float(s.angle)) * ((left + right) * 66.0)
		force += point(course.wind) * (0.85 + sin(float(s.time) * 0.65) * 0.15)
		for current in course.currents:
			if Vector2(float(s.x), float(s.y)).distance_to(point(current.position)) < float(current.radius):
				force += point(current.force)
		velocity += force * FIXED
		velocity *= exp(-0.85 * FIXED)
		velocity = velocity.limit_length(180.0)
		s.x += velocity.x * FIXED
		s.y += velocity.y * FIXED
		s.vx = velocity.x
		s.vy = velocity.y
		var pos := Vector2(float(s.x), float(s.y))
		var collision := pos.x < 30.0 or pos.x > WIDTH - 30.0 or pos.y < 30.0 or pos.y > HEIGHT - 30.0
		for island in course.islands:
			if pos.distance_to(point(island.position)) < float(island.radius) + BOAT_RADIUS:
				collision = true
				break
		if collision:
			s.bumps += 1
			events.append({"kind": "collision", "position": pos})
			reset_boat(s, course)
			break
		if not s.paper and pos.distance_to(point(course.paper)) < 30.0:
			s.paper = true
			events.append({"kind": "paper", "position": pos})
		var dock := point(course.docks[int(s.dock)])
		if pos.distance_to(dock) < 38.0 and velocity.length() < 100.0:
			s.dock += 1
			events.append({"kind": "dock", "index": int(s.dock), "position": dock})
			if int(s.dock) == course.docks.size():
				s.ended = true
				s.carry = 0.0
				events.append({"kind": "finished", "position": dock})
	return events

static func valid(s: Variant, course: Dictionary, index: int) -> bool:
	if not s is Dictionary or int(s.get("course", -1)) != index:
		return false
	for field in ["x", "y", "vx", "vy", "angle", "omega", "time", "carry", "dock", "bumps", "course"]:
		if not (s.get(field) is float or s.get(field) is int) or not is_finite(float(s[field])):
			return false
	if float(s.course) != floorf(float(s.course)) or float(s.dock) != floorf(float(s.dock)) or float(s.bumps) != floorf(float(s.bumps)):
		return false
	if s.x < 0.0 or s.x > WIDTH or s.y < 0.0 or s.y > HEIGHT or absf(float(s.angle)) > PI + 0.001 or absf(float(s.omega)) > 3.0:
		return false
	if s.time < 0.0 or s.time > 86400.0 or s.carry < 0.0 or s.carry > FIXED or Vector2(float(s.vx), float(s.vy)).length() > 181.0:
		return false
	if s.dock < 0 or s.dock > course.docks.size() or s.bumps < 0 or s.bumps > 100000:
		return false
	return s.get("paper") is bool and s.get("ended") is bool and s.ended == (int(s.dock) == course.docks.size())

static func score(s: Dictionary) -> int:
	return maxi(300, 900 + (200 if s.paper else 0) + maxi(0, 1800 - roundi(float(s.time) * 20.0)) - int(s.bumps) * 50)

static func stars(s: Dictionary, course: Dictionary) -> int:
	if not s.ended:
		return 0
	if int(s.bumps) == 0 and float(s.time) <= float(course.par):
		return 3
	return 2 if int(s.bumps) <= 2 and float(s.time) <= float(course.par) * 2.0 else 1
