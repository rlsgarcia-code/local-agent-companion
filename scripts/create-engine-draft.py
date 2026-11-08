"""Publish signed artifacts to a draft only; release promotion requires review."""
import json
import os
from pathlib import Path
import subprocess

versions = json.loads(Path("packages/contracts/src/version.json").read_text())
version = versions["engine"]
root = Path("release-assets")
assets = sorted(root.rglob("*.tar.gz")) + sorted(root.rglob("*.sha256"))
targets = {"darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"}
archives = {path.name.removeprefix(f"companion-engine-{version}-").removesuffix(".tar.gz") for path in assets if path.name.startswith(f"companion-engine-{version}-") and path.name.endswith(".tar.gz")}
if archives != targets:
    raise SystemExit("The five exact engine artifacts are required before creating a draft.")
repository = os.environ["GITHUB_REPOSITORY"]
tag = f"companion-engine-v{version}"
existing = subprocess.run(["gh", "release", "view", tag, "--repo", repository, "--json", "isDraft"], capture_output=True, text=True)
if existing.returncode == 0:
    if not json.loads(existing.stdout).get("isDraft"):
        raise SystemExit("Refusing to replace a published release.")
    raise SystemExit("A draft with this version already exists. Choose a new reviewed version.")
notes = Path("engine-release-notes.txt")
notes.write_text(f"Companion engine candidate. Signed Ed25519 manifests and bundled Node {versions['node']}.\n\nThis draft does not establish three-client acceptance, installed compatibility or release promotion. Review the exact commit and acceptance report before publication.\n")
subprocess.run(["gh", "release", "create", tag, "--repo", repository, "--target", os.environ["GITHUB_SHA"], "--draft", "--prerelease", "--title", f"Companion engine {version}", "--notes-file", str(notes), *map(str, assets)], check=True)
