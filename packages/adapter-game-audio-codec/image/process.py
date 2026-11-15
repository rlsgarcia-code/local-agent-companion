"""Fixed codec entrypoint. Never executes project code, filters, URLs or a shell."""
import array
import hashlib
import json
import math
import pathlib
import subprocess
import sys
import wave

FFMPEG = "/opt/game-audio/ffmpeg/bin/ffmpeg"
request = json.loads(pathlib.Path("/source/request.json").read_text())
if set(request) != {"schemaVersion", "sourceSha256", "operation"} or request["schemaVersion"] != 1:
    raise ValueError("Invalid audio codec request")
op = request["operation"]
if set(op) != {"type", "source", "outputBase", "codec", "variants"} or op["type"] != "audio.encode" or op["codec"] != "aac-lc":
    raise ValueError("Unsupported codec operation")
base = pathlib.PurePosixPath(op["outputBase"])
if not str(base).startswith("assets/") or base.is_absolute() or any(p in ("", ".", "..") for p in base.parts) or "\\" in str(base) or len(str(base)) > 500:
    raise ValueError("Invalid codec output path")
variants = op["variants"]
if not isinstance(variants, list) or not 1 <= len(variants) <= 3:
    raise ValueError("Choose one to three explicit quality variants")
seen = set()
for item in variants:
    if set(item) != {"id", "bitrateKbps"} or not isinstance(item["id"], str) or not 1 <= len(item["id"]) <= 24 or not item["id"][0].isalpha() or not item["id"].isascii() or any(not (c.isalnum() or c in "_-") for c in item["id"]) or item["id"] in seen or item["bitrateKbps"] not in (64, 96, 128, 192):
        raise ValueError("Invalid explicit codec variant")
    seen.add(item["id"])
source = pathlib.Path("/source/input.wav")
if not source.is_file() or source.stat().st_size > 64 * 1024**2:
    raise ValueError("Source WAV exceeds its byte budget")
raw = source.read_bytes()
if hashlib.sha256(raw).hexdigest() != request["sourceSha256"]:
    raise ValueError("Codec source hash mismatch")
with wave.open(str(source), "rb") as wav:
    channels, rate, frames = wav.getnchannels(), wav.getframerate(), wav.getnframes()
    if channels not in (1, 2) or rate not in (22050, 44100, 48000) or wav.getsampwidth() != 2 or wav.getcomptype() != "NONE" or not 1 <= frames <= rate * 180:
        raise ValueError("Use bounded mono/stereo canonical PCM16 WAV")
    pcm = wav.readframes(frames)
if len(raw) != 44 + frames * channels * 2 or len(pcm) != frames * channels * 2:
    raise ValueError("The encoder requires the exact canonical WAV layout")
original = array.array("h", pcm)
if sys.byteorder != "little":
    original.byteswap()
output = pathlib.Path("/work/output")
output.mkdir(parents=True)
def run(args):
    result = subprocess.run([FFMPEG, "-nostdin", "-hide_banner", "-v", "error", "-max_alloc", "67108864", *args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90, check=False)
    if result.returncode != 0:
        raise ValueError("Pinned audio codec failed: " + result.stderr[:2048].decode("utf-8", "replace"))
report = {"schemaVersion": 1, "codec": "aac-lc", "container": "mp4", "sourceSha256": request["sourceSha256"], "sampleRate": rate, "channels": channels, "sourceFrames": frames, "variants": []}
for item in variants:
    name = str(base) + "." + item["id"] + ".m4a"
    target = output / name
    target.parent.mkdir(parents=True, exist_ok=True)
    run(["-protocol_whitelist", "file", "-fflags", "+bitexact", "-f", "wav", "-i", str(source), "-map", "0:a:0", "-vn", "-map_metadata", "-1", "-c:a", "aac", "-profile:a", "aac_low", "-b:a", str(item["bitrateKbps"]) + "k", "-ar", str(rate), "-ac", str(channels), "-threads", "1", "-flags:a", "+bitexact", "-movflags", "+faststart", "-f", "mp4", "-y", str(target)])
    if not target.is_file() or target.stat().st_size > 8 * 1024**2:
        raise ValueError("Encoded variant exceeds its bound")
    decoded = pathlib.Path("/work/decoded.wav")
    run(["-protocol_whitelist", "file", "-f", "mov", "-i", str(target), "-map", "0:a:0", "-c:a", "pcm_s16le", "-threads", "1", "-f", "wav", "-y", str(decoded)])
    with wave.open(str(decoded), "rb") as wav:
        if wav.getnchannels() != channels or wav.getframerate() != rate or wav.getsampwidth() != 2 or abs(wav.getnframes() - frames) > 2048:
            raise ValueError("Decoded AAC dimensions differ from its source")
        decoded_frames = wav.getnframes()
        samples = array.array("h", wav.readframes(decoded_frames))
    if sys.byteorder != "little":
        samples.byteswap()
    count = min(len(samples), len(original))
    error = sum(((samples[i] - original[i]) / 32768) ** 2 for i in range(count)) / count
    signal = sum((original[i] / 32768) ** 2 for i in range(count)) / count
    data = target.read_bytes()
    report["variants"].append({**item, "path": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "decodedFrames": decoded_frames, "rmse": math.sqrt(error), "snrDb": 10 * math.log10(signal / error) if signal and error else None})
    decoded.unlink()
(output / (str(base) + ".encoded.json")).write_text(json.dumps(report, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
