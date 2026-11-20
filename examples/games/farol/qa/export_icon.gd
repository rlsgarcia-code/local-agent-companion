extends SceneTree

func _initialize() -> void:
	# Trusted authoring utility, run only in the isolated editor; not game code.
	var image := Image.new()
	if image.load_svg_from_string(FileAccess.get_file_as_string("res://icon.svg"), 2.0) != OK:
		quit(1)
		return
	print("FAROL_ICON_PNG=" + Marshalls.raw_to_base64(image.save_png_to_buffer()))
	quit(0)
