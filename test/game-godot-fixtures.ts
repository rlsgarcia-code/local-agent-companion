/** Toolchain fixtures, not the portfolio or evidence of finished game quality. */
export function godotFixture(dimension: "2d" | "3d"): Map<string, string> {
  return new Map([
    ["game.godot.json", JSON.stringify({ schemaVersion: 1, engineVersion: "4.7.2" })],
    ["project.godot", `config_version=5

[application]
config/name="Companion Godot ${dimension} fixture"
run/main_scene="res://main.tscn"

[display]
window/size/viewport_width=640
window/size/viewport_height=360
window/stretch/mode="canvas_items"

[rendering]
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
environment/defaults/default_clear_color=Color(0.09, 0.23, 0.19, 1)
`],
    ["main.tscn", `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1"]

[node name="Game" type="${dimension === "2d" ? "Node2D" : "Node3D"}"]
script = ExtResource("1")
`],
    ["main.gd", dimension === "2d" ? `extends Node2D
var position_x = 150.0
func _draw():
\tdraw_rect(Rect2(0, 0, 640, 360), Color("173b30"))
\tdraw_circle(Vector2(position_x, 180), 40, Color("f5c06a"))
func _unhandled_key_input(event):
\tif event is InputEventKey and event.pressed and event.keycode == KEY_SPACE:
\t\tposition_x += 120
\t\tqueue_redraw()
` : `extends Node3D
var actor: MeshInstance3D
func _ready():
\tactor = MeshInstance3D.new()
\tactor.mesh = SphereMesh.new()
\tvar material = StandardMaterial3D.new()
\tmaterial.albedo_color = Color("f5c06a")
\tactor.material_override = material
\tadd_child(actor)
\tvar floor_mesh = MeshInstance3D.new()
\tvar plane = PlaneMesh.new()
\tplane.size = Vector2(12, 12)
\tfloor_mesh.mesh = plane
\tfloor_mesh.position.y = -1
\tadd_child(floor_mesh)
\tvar camera = Camera3D.new()
\tcamera.position = Vector3(0, 3, 7)
\tadd_child(camera)
\tcamera.look_at(Vector3.ZERO)
\tvar light = DirectionalLight3D.new()
\tlight.rotation_degrees = Vector3(-50, -20, 0)
\tadd_child(light)
func _unhandled_key_input(event):
\tif event is InputEventKey and event.pressed and event.keycode == KEY_SPACE:
\t\tactor.position.x += 1.5
`],
    ["data/playtests.json", JSON.stringify({ schemaVersion: 1, viewport: { width: 640, height: 360 }, scenarios: [{ id: "godot-keyboard-motion", steps: [
      { action: "wait", ms: 2000 }, { action: "capture", selector: "canvas", name: "before" }, { action: "press", key: "Space" }, { action: "wait", ms: 200 },
      { action: "expect-image", selector: "canvas", baseline: "before", comparison: "changed", threshold: 0.001 },
    ] }] })],
  ]);
}
