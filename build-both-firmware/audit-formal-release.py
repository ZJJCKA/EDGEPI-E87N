"""Inspect the built image, not the source tree, before release handoff."""
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

base = Path(__file__).resolve().parents[1]
image = Path(sys.argv[1])
device = sys.argv[2]
board = {'edgepi_e87n': 'edgepi,e87n', 'mangopi_m87k': 'mangopi,m87k'}[device]
release_tag = 'v' + dict(line.split('=', 1) for line in (base / 'e87n-upstream-state.txt').read_text().splitlines() if '=' in line)['openwrt_release']
release_base = dict(line.split('=', 1) for line in (base / 'e87n-upstream-state.txt').read_text().splitlines() if '=' in line)['openwrt_commit']
subprocess.run(['git', 'merge-base', '--is-ancestor', release_base, 'HEAD'], cwd=base, check=True)
assert re.fullmatch(r'v\d+\.\d+\.\d+', release_tag), release_tag
kernel = '6.12' + re.search(r'^LINUX_VERSION-6.12 = (.*)$', (base / 'target/linux/generic/kernel-6.12').read_text(), re.M).group(1)
with tempfile.TemporaryDirectory(prefix='formal-audit-', dir=base / 'build-both-firmware') as temp:
    temp = Path(temp)
    metadata_file = temp / 'metadata.json'
    subprocess.run([str(base / 'staging_dir/host/bin/fwtool'), '-i', str(metadata_file), str(image)], check=True)
    metadata = json.loads(metadata_file.read_text())
    assert metadata['version']['version'] == release_tag[1:], metadata
    assert board in metadata['supported_devices'], metadata
    root = temp / 'root.squashfs'
    with root.open('wb') as output:
        subprocess.run(['tar', '-xOf', str(image), f'sysupgrade-{device}/root'], stdout=output, check=True)
    def read(path):
        return subprocess.check_output(['unsquashfs', '-cat', str(root), path], text=True)
    assert f"DISTRIB_RELEASE='{release_tag[1:]}'" in read('etc/openwrt_release')
    modules = subprocess.check_output(['unsquashfs', '-ll', str(root), 'lib/modules'], text=True)
    assert f'lib/modules/{kernel}' in modules, modules
    menus = json.loads(read('usr/share/luci/menu.d/luci-mod-system.json'))
    assert 'admin/system/mounts' not in menus
    absent = subprocess.run(['unsquashfs', '-cat', str(root), 'www/luci-static/resources/view/system/mounts.js'], capture_output=True)
    assert absent.returncode != 0
    assert 'luci-mod-system-mounts' not in read('usr/share/rpcd/acl.d/luci-mod-system.json')
    for path in ('usr/libexec/samba4-nvme', 'etc/init.d/samba4-nvme', 'etc/hotplug.d/block/95-samba4-nvme'):
        assert read(path), path
    for path in ('etc/init.d/fstab', 'etc/hotplug.d/block/10-mount', 'etc/hotplug.d/block/00-media-change', 'etc/modules-boot.d/30-nvme', 'etc/modules.d/30-nvme', 'etc/uci-defaults/10-fstab', 'etc/init.d/blockd', 'etc/rc.d/S11fstab'):
        result = subprocess.run(['unsquashfs', '-cat', str(root), path], capture_output=True)
        assert result.returncode != 0, f'Competing automount entry remains: {path}'
    for path in ('sbin/block', 'sbin/mount_root', 'lib/libfstools.so', 'lib/libblkid-tiny.so'):
        result = subprocess.run(['unsquashfs', '-cat', str(root), path], capture_output=True)
        assert result.returncode == 0 and result.stdout, f'Required storage tool missing: {path}'
    library = subprocess.check_output(['unsquashfs', '-cat', str(root), 'lib/libfstools.so'])
    assert b'edgepi,e87n' in library and b'mangopi,m87k' in library, 'eMMC boot isolation missing from compiled fstools'
    manager = read('usr/libexec/samba4-nvme')
    assert 'modprobe nvme' in manager
    assert 'procd_set_param command /usr/libexec/samba4-nvme reconcile' in read('etc/init.d/samba4-nvme')
    assert '/etc/init.d/samba4-nvme start' in read('etc/hotplug.d/block/95-samba4-nvme')
    assert 'mount -t ext4 -o rw,noatime' in manager
    assert not re.search(r'^\s*block mount', manager, re.M)
    assert 'flock' not in manager
    assert 'getMountPoints' in read('www/luci-static/resources/view/status/include/25_storage.js')
    assert 'admin/nas/samba4' in read('usr/share/luci/menu.d/luci-app-samba4.json')
    ui = read('www/luci-static/resources/ui.js')
    assert 'cgi-bin/luci/' in ui and 'reconnectHost' in ui and 'requireOffline' in ui
    assert 'window.setTimeout(check,1000)' in re.sub(r'\s+', '', ui)
    assert 'getCPUStatus' in read('usr/share/rpcd/ucode/luci')
    assert 'getCPUStatus' in read('usr/share/rpcd/acl.d/luci-mod-status-index.json')
    system = read('www/luci-static/resources/view/status/include/10_system.js')
    assert 'getCPUStatus' in system and 'MHz' in system and 'CPU:' in system
    assert '192.168.8.1' in read('www/luci-static/resources/view/system/flash.js')
    assert 'showSide' not in read('www/luci-static/resources/menu-argon.js')
print(json.dumps({'image': str(image), 'release': release_tag, 'kernel': kernel, 'board': board, 'audit': 'PASS'}, ensure_ascii=False))
