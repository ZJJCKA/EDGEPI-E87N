#!/usr/bin/env python3
"""Register checked-in, finalized feed sources without downloading replacements."""
from pathlib import Path
import argparse, hashlib, json, os, subprocess

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--verify-only', action='store_true')
args = parser.parse_args()
manifest = json.loads((root / 'finalized-source.json').read_text())
for rel, expected in manifest['source_sha256'].items():
    path = root / rel
    data = os.readlink(path).encode() if path.is_symlink() else path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit('Finalized source differs: ' + rel)
print('PASS: finalized feed and local source hashes', flush=True)
if args.verify_only:
    raise SystemExit(0)
for name in ('.config.e87n', '.config.m87k', 'e87n.config', 'm87k.config'):
    path = root / name
    lines = path.read_text().splitlines()
    lines = [f'CONFIG_EXTERNAL_KERNEL_TREE="{root}/local-src/linux-6.12.112"' if line.startswith('CONFIG_EXTERNAL_KERNEL_TREE=') else line for line in lines]
    path.write_text('\n'.join(lines) + '\n')
(root / 'files').mkdir(exist_ok=True)
if not (root / '.config').exists():
    (root / '.config').write_bytes((root / 'e87n.config').read_bytes())
# Index/install only. The actual package sources already live in feeds/.
subprocess.run(['./scripts/feeds', 'update', '-i', '-a'], cwd=root, check=True)
subprocess.run(['./scripts/feeds', 'install', '-a'], cwd=root, check=True)
print('PASS: finalized sources ready; no feed sources downloaded')
