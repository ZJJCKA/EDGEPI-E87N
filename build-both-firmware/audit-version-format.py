from pathlib import Path
import hashlib, json, re, subprocess, sys, tempfile

base = Path(__file__).resolve().parents[1]
device = sys.argv[1]
date = sys.argv[2]
board = {'edgepi_e87n': 'edgepi,e87n', 'mangopi_m87k': 'mangopi,m87k'}[device]
image = base / f'bin/targets/mediatek/filogic/openwrt-mediatek-filogic-{device}-squashfs-sysupgrade.bin'
dest = Path(tempfile.mkdtemp(prefix=f'version-audit-{device}-', dir=base / 'build-both-firmware'))
meta = dest / 'metadata.json'
subprocess.run([str(base / 'staging_dir/host/bin/fwtool'), '-i', str(meta), str(image)], check=True)
metadata = json.loads(meta.read_text())
assert board in metadata['supported_devices']
root = dest / 'root.squashfs'
with root.open('wb') as output:
    subprocess.run(['tar', '-xOf', str(image), f'sysupgrade-{device}/root'], stdout=output, stderr=subprocess.DEVNULL, check=True)

def read(name):
    return subprocess.check_output(['unsquashfs', '-cat', str(root), name], text=True)

release = dict(re.findall(r"^(DISTRIB_\w+)='(.*)'$", read('etc/openwrt_release'), re.M))
expected = f"{release['DISTRIB_ID']} {release['DISTRIB_RELEASE']} {date} By ZJJCKA"
assert release['DISTRIB_DESCRIPTION'] == expected, release
assert release['DISTRIB_REVISION'] == metadata['version']['revision']
assert f'OPENWRT_RELEASE="{expected}"' in read('usr/lib/os-release')
luci = read('usr/share/ucode/luci/version.uc')
revision = re.search(r"revision = '([^']+)'", luci).group(1)
branch = re.search(r"branch = '([^']+)'", luci).group(1)
assert branch.startswith('LuCI ') and revision
assert re.search(r"luciversion\.branch\s*\+\s*' '\s*\+\s*luciversion\.revision", read('www/luci-static/resources/view/status/include/10_system.js'))
assert 'showSide' not in read('www/luci-static/resources/menu-argon.js')
assert 'admin/nas/samba4' in read('usr/share/luci/menu.d/luci-app-samba4.json')
assert 'CODEX_PASSWALL_PROXY_HEALTH_V1' in read('usr/share/passwall/monitor.sh')
for name in ('passwall', 'passwall_server', 'openclash'):
    assert read(f'etc/config/{name}'), name
installed = read('lib/apk/db/installed')
xray = re.search(r'^P:xray-core\nV:([^\n]+)', installed, re.M).group(1)
if len(sys.argv) > 3:
    assert xray == sys.argv[3], xray
result = {'image': str(image), 'size': image.stat().st_size, 'sha256': hashlib.file_digest(image.open('rb'), 'sha256').hexdigest(), 'description': f'{expected} / {branch} {revision}', 'commit': release['DISTRIB_REVISION'], 'board': board, 'audit': 'PASS'}
result['xray'] = xray
(dest / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps(result, ensure_ascii=False))
