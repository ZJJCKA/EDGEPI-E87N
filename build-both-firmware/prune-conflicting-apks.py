"""Quarantine superseded APKs using versions actually built in this run."""
import json
from pathlib import Path
import re
import shutil
import sys

base = Path('/home/ht/openwrt')
log = Path(sys.argv[1])
keep = {}
for line in log.read_text(errors='replace').splitlines():
    if 'apk mkpkg' not in line:
        continue
    name = re.search(r'--info "name:([^"]+)"', line)
    output = re.search(r'--output "([^"]+\.apk)"', line)
    if name and output:
        p = Path(output.group(1))
        if p.is_file() and p.is_relative_to(base / 'bin/packages'):
            keep[name.group(1)] = p
dest = base / 'build-both-firmware' / (log.stem + '-superseded-apks')
moved = []
for name, current in keep.items():
    pattern = re.compile(re.escape(name) + r'-\d.*\.apk$')
    for path in current.parent.glob('*.apk'):
        if path == current or not pattern.fullmatch(path.name):
            continue
        target = dest / path.relative_to(base / 'bin/packages')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(target))
        moved.append(str(path.relative_to(base)))
print(json.dumps({'removed_from_index': moved, 'backup': str(dest)}, ensure_ascii=False))
