// Trusted image entrypoint. Generated project/editor scripts run only inside this container.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

mkdirSync("/work/project", { recursive: true });
mkdirSync("/work/output", { recursive: true });
cpSync("/source", "/work/project", { recursive: true, dereference: false });
writeFileSync("/work/project/export_presets.cfg", `[preset.0]
name="Companion Web"
platform="Web"
runnable=true
advanced_options=true
export_filter="all_resources"
include_filter=""
exclude_filter="game.godot.json,data/playtests*.json"
export_path="/work/output/index.html"
script_export_mode=2

[preset.0.options]
custom_template/debug=""
custom_template/release="/opt/godot/web-release.zip"
variant/extensions_support=false
variant/thread_support=false
vram_texture_compression/for_desktop=true
vram_texture_compression/for_mobile=true
html/export_icon=false
html/custom_html_shell=""
html/head_include=""
html/canvas_resize_policy=2
html/focus_canvas_on_start=true
progressive_web_app/enabled=false
`);
const run = (args) => execFileSync("/opt/godot/godot", ["--headless", "--path", "/work/project", ...args], { stdio: "inherit", timeout: 180000 });
run(["--import"]);
run(["--export-release", "Companion Web", "/work/output/index.html"]);
mkdirSync("/work/output/engine", { recursive: true });
cpSync("/opt/godot/LICENSE.txt", "/work/output/engine/GODOT-LICENSE.txt");
cpSync("/opt/godot/COPYRIGHT.txt", "/work/output/engine/GODOT-COPYRIGHT.txt");
if (existsSync("/source/data")) cpSync("/source/data", "/work/output/data", { recursive: true, dereference: false });
