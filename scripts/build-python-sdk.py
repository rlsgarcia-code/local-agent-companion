"""Build the dependency-free SDK wheel without contacting a package registry."""
import base64
import csv
import hashlib
import io
from pathlib import Path
import zipfile

output = Path("release/sdk")
output.mkdir(parents=True, exist_ok=True)
dist = "companion_client-1.0.0rc1.dist-info"
files = {"companion_client/__init__.py": Path("packages/client-python/companion_client/__init__.py").read_bytes(),
         f"{dist}/METADATA": b"Metadata-Version: 2.3\nName: companion-client\nVersion: 1.0.0rc1\nRequires-Python: >=3.12\nLicense: MIT\nSummary: Thin local Companion Agent API client\n\n",
         f"{dist}/WHEEL": b"Wheel-Version: 1.0\nGenerator: companion-sdk\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
         f"{dist}/licenses/LICENSE": Path("LICENSE").read_bytes()}
record = io.StringIO(newline="")
writer = csv.writer(record, lineterminator="\n")
for name, data in files.items():
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("=")
    writer.writerow([name, "sha256=" + digest, str(len(data))])
writer.writerow([f"{dist}/RECORD", "", ""])
files[f"{dist}/RECORD"] = record.getvalue().encode()
with zipfile.ZipFile(output / "companion_client-1.0.0rc1-py3-none-any.whl", "w", compression=zipfile.ZIP_DEFLATED) as wheel:
    for name, data in files.items():
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.external_attr = 0o644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        wheel.writestr(info, data)
