"""Regenerate NOTICES.txt from the Go runtime and modules used in the Windows binary."""
import json
import os
from pathlib import Path
import subprocess

env = {**os.environ, "CGO_ENABLED": "0", "GOOS": "windows", "GOARCH": "amd64"}
root = Path(subprocess.check_output(["go", "env", "GOROOT"], env=env, text=True).strip())
packages = subprocess.check_output(["go", "list", "-mod=readonly", "-deps", "-json", "."], env=env, text=True)
decoder = json.JSONDecoder()
files = {}
while packages.strip():
    pkg, end = decoder.raw_decode(packages.lstrip())
    packages = packages.lstrip()[end:]
    mod = pkg.get("Module", {})
    if mod.get("Main"):
        continue
    base = Path(mod.get("Dir", root))
    label = mod["Path"] + " " + mod["Version"] if mod else "Go runtime and standard library"
    directory = Path(pkg["Dir"])
    while directory.is_relative_to(base):
        for pattern in ("LICENSE*", "LICENCE*", "COPYING*", "NOTICE*", "PATENTS", "LICENSES/*.txt"):
            for file in directory.glob(pattern):
                if file.is_file():
                    files[file] = label + " / " + file.relative_to(base).as_posix()
        if directory == base:
            break
        directory = directory.parent

groups = {}
for file, label in files.items():
    body = "\n".join(line.rstrip() for line in file.read_text(encoding="utf-8").splitlines()).strip()
    groups.setdefault(body, set()).add(label)
sections = ["Third-party notices for the FrankerzSpam Windows HLS relay helper"]
for body, labels in sorted(groups.items(), key=lambda group: min(group[1])):
    sections.append("\n".join(sorted(labels)) + "\n\n" + body)
Path("NOTICES.txt").write_text("\n\n========================================\n\n".join(sections) + "\n",
                              encoding="utf-8", newline="\n")
