extends RefCounted

static func tone(frequency: float, duration: float, soft: bool = false) -> AudioStreamWAV:
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = 22050
	var count := int(duration * 22050.0)
	var bytes := PackedByteArray()
	bytes.resize(count * 2)
	for i in range(count):
		var t := float(i) / 22050.0
		var envelope := minf(t * 90.0, 1.0) * pow(1.0 - t / duration, 2.2)
		var wave := sin(TAU * frequency * t) + (0.08 if soft else 0.22) * sin(TAU * frequency * 2.0 * t)
		bytes.encode_s16(i * 2, int(wave * envelope * 12000.0))
	stream.data = bytes
	return stream

static func score() -> AudioStreamWAV:
	# Original twelve-second 6/8 marimba-like phrase, rendered locally as PCM.
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = 22050
	stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
	stream.loop_begin = 0
	stream.loop_end = 264600
	var notes := [48, 55, 60, 64, 67, 64, 53, 60, 65, 69, 72, 69, 55, 62, 67, 71, 74, 71, 48, 55, 60, 67, 64, 55]
	var bytes := PackedByteArray()
	bytes.resize(529200)
	for i in range(264600):
		var t := float(i) / 22050.0
		var beat := int(t / 0.5)
		var local := fmod(t, 0.5)
		var hz := 440.0 * pow(2.0, (float(notes[beat]) - 69.0) / 12.0)
		var amplitude := minf(local * 90.0, 1.0) * exp(-local * 8.0)
		bytes.encode_s16(i * 2, int(sin(TAU * hz * local) * amplitude * 6500.0))
	stream.data = bytes
	return stream
