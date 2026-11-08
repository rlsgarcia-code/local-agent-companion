"""Publish signed artifacts to a draft only; release promotion requires review."""
import json
import os
from pathlib import Path
import subprocess

versions = json.loads(Path("packages/contracts/src/version.json").read_text())
version = versions["engine"]
root = Path(os.environ.get("COMPANION_ASSET_DIRECTORY", "release-assets"))
assets = sorted(root.rglob("*.vsix")) + sorted(root.rglob("*.tar.gz")) + sorted(root.rglob("*.sha256")) + sorted(root.rglob("*.zip")) + sorted(root.rglob("*.dmg")) + sorted(root.rglob("*.manifest.json")) + sorted(root.rglob("*.manifest.sig"))
mac_arches = {"arm64", "x64"}
for extension in ("zip", "dmg"):
    present = {path.name.removesuffix("." + extension).rsplit("-", 1)[-1] for path in assets if path.suffix == "." + extension}
    if present != mac_arches:
        raise SystemExit("Both Mac architectures are required, with the exact verified native engines.")
targets = {"darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"}
archives = {path.name.removeprefix(f"companion-engine-{version}-").removesuffix(".tar.gz") for path in assets if path.name.startswith(f"companion-engine-{version}-") and path.name.endswith(".tar.gz")}
if archives != targets:
    raise SystemExit("The five exact engine artifacts are required before creating a draft.")
vsix={path.name for path in assets if path.suffix=='.vsix'}
application=json.loads(Path('package.json').read_text())['version']
expected={f'local-agent-companion-{application}{suffix}-{target}.vsix' for target in targets for suffix in ('','-ollama','-openai')}
if vsix!=expected:raise SystemExit('The fifteen exact native VSIX variants are required.')
for arch in mac_arches:
    for extension in ("json", "sig"):
        if len(list(root.rglob(f"*-darwin-{arch}.manifest.{extension}"))) != 1:
            raise SystemExit("Both signed Mac artifact manifests are required.")
if not (root / "companion-release.manifest.json").is_file() or not (root / "companion-release.manifest.sig").is_file():
    raise SystemExit("A verified signed index of every candidate artifact is required.")
repository = os.environ["GITHUB_REPOSITORY"]
tag = f"companion-engine-v{version}"
existing = subprocess.run(["gh", "release", "view", tag, "--repo", repository, "--json", "isDraft"], capture_output=True, text=True)
if existing.returncode == 0:
    if not json.loads(existing.stdout).get("isDraft"):
        raise SystemExit("Refusing to replace a published release.")
    raise SystemExit("A draft with this version already exists. Choose a new reviewed version.")
notes = Path("engine-release-notes.txt")
notes.write_text(f"Companion engine candidate. Signed Ed25519 manifests and bundled Node {versions['node']}.\n\nMac packages contain the signed native engines; they use ad-hoc Apple sealing, without Developer ID distribution signing or notarization. This draft does not establish three-client acceptance, installed compatibility or release promotion. Review the exact commit and acceptance report before publication.\n")
subprocess.run(["gh", "release", "create", tag, "--repo", repository, "--target", os.environ["GITHUB_SHA"], "--draft", "--prerelease", "--title", f"Companion engine {version}", "--notes-file", str(notes), *map(str, assets)], check=True)
