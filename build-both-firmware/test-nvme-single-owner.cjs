const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const manager = fs.readFileSync(path.join(root, 'feeds/luci/applications/luci-app-samba4/root/usr/libexec/samba4-nvme'), 'utf8');
const marker = '# Samba4 is the sole automount owner';
const definitions = manager.split(marker)[0].replace('. /usr/share/libubox/jshn.sh', '');
const mocks = `
log() { printf 'LOG %s\\n' "$*"; }
discover_disk() { echo /dev/mocknvme; }
data_device() { echo /dev/mocknvmep1; }
block_value() { case "$2" in TYPE) echo ext4;; UUID) echo mock-uuid;; esac; }
mountpoint_for() { printf '%s\\n' "\${CURRENT-}"; }
mkdir() { :; }
awk() { case "$*" in *'print $1'*) printf '%s\\n' "\${OCCUPANT-}";; *'ok=1'*) [ "\${CURRENT-}" = /mnt/nvme0 ];; *) return 1;; esac; }
mount() { printf 'MOUNT %s\\n' "$*"; CURRENT=/mnt/nvme0; }
umount() { printf 'UMOUNT %s\\n' "$*"; CURRENT=; }
install_share() { printf 'SHARE %s\\n' "$1"; }
samba_restart() { echo RESTART; }
samba_stop() { echo STOP; }
samba_running() { return 1; }
remove_share() { printf 'REMOVE %s\\n' "$1"; }
remove_generic_mount_dirs() { :; }
quarantine_slot() { printf 'QUARANTINE %s\\n' "$1"; }
uci() { echo UNEXPECTED_UCI; return 1; }
`;
function run(body, success = true) {
  const result = cp.spawnSync('sh', [], { input: definitions + mocks + body, encoding: 'utf8' });
  assert.strictEqual(result.status === 0, success, result.stdout + result.stderr);
  assert(!result.stdout.includes('UNEXPECTED_UCI'), result.stdout);
  return result.stdout;
}
const fresh = run('mount_slot nvme0');
assert(fresh.includes('MOUNT -t ext4 -o rw,noatime /dev/mocknvmep1 /mnt/nvme0'));
assert.strictEqual((fresh.match(/^RESTART$/gm) || []).length, 1);
const repeat = run('CURRENT=/mnt/nvme0; OCCUPANT=/dev/mocknvmep1; mount_slot nvme0');
assert(!/^MOUNT |^UMOUNT /m.test(repeat));
assert(!/^MOUNT |^UMOUNT /m.test(run('OCCUPANT=/dev/otherdisk; mount_slot nvme0', false)));
assert(!/^MOUNT |^UMOUNT /m.test(run('CURRENT=/overlay; mount_slot nvme0', false)));
const legacy = run('CURRENT=/mnt/nvme0n1p1; mount_slot nvme0');
assert(legacy.indexOf('UMOUNT /dev/mocknvmep1') < legacy.indexOf('MOUNT -t ext4'));
const batch = run('mount_slot() { [ "$batch_mount" = 1 ] || return 1; echo SLOT "$1"; }; reconcile');
assert(batch.includes('SLOT nvme0') && batch.includes('SLOT nvme1'));
assert.strictEqual((batch.match(/^RESTART$/gm) || []).length, 1);
const nonext4 = run('block_value() { [ "$2" != TYPE ] || echo ntfs; }; reconcile');
assert(nonext4.includes('QUARANTINE nvme0') && !/^MOUNT |^RESTART$/m.test(nonext4));
run('format_slot nvme0 INVALID', false);
const removed = run('discover_disk() { return 1; }; OCCUPANT=/dev/nvme-missing; reconcile');
assert(removed.includes('UMOUNT /mnt/nvme0') && removed.includes('UMOUNT /mnt/nvme1'));
assert(!run('discover_disk() { return 1; }; OCCUPANT=/dev/otherdisk; reconcile').includes('UMOUNT'));
assert(!manager.includes('block mount'));
assert(manager.includes('mount -t ext4 -o rw,noatime'));

assert(!manager.includes('flock') && !manager.includes('/var/lock'));
// Run the real configuration migration entry point with mocked UCI. No real
// device files or system configuration are modified by these tests.
const migrationEntry = manager.slice(manager.indexOf(marker)).replace('/etc/init.d/fstab disable', 'true');
function migration(old) {
  const code = definitions + `
cat() { echo edgepi,e87n; }
uci() {
  case "$2:$3" in
    'get:fstab.@global[0]') echo global;;
    'get:fstab.@global[0].anon_mount'|'get:fstab.@global[0].auto_mount') echo ${old ? 1 : 0};;
    get:fstab.nvme_right|get:fstab.nvme_left|get:fstab.samba_nvme0|get:fstab.samba_nvme1) ${old ? 'echo mount' : 'return 1'};;
    set:*|delete:*|commit:*) echo "UCI $2 $3";;
    *) return 1;;
  esac
}
scan() { echo SCAN; }
` + migrationEntry;
  const result = cp.spawnSync('sh', ['-s', 'scan'], {input:code,encoding:'utf8'});
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout;
}
assert(migration(true).includes('UCI commit fstab'));
assert(!migration(false).includes('UCI commit'));

// Run the actual discovery functions against a synthetic sysfs. Enumeration
// changes and namespace delays must never change the board's physical slots.
for (const board of ['edgepi,e87n', 'mangopi,m87k']) {
  for (const names of [['nvme7','nvme2'], ['nvme2','nvme7']]) {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nvme-sysfs-test-'));
    try {
      const boardFile = path.join(fixture, 'board_name');
      fs.writeFileSync(boardFile, board);
      const sys = path.join(fixture, 'sys/class');
      fs.mkdirSync(path.join(sys, 'block'), {recursive:true});
      const controllers = board === 'edgepi,e87n' ? ['11280000.pcie','11290000.pcie'] : ['11290000.pcie','11280000.pcie'];
      names.forEach((name, i) => {
        const physical = path.join(fixture, 'soc', controllers[i], 'pci0000:0' + i);
        fs.mkdirSync(physical, {recursive:true});
        fs.mkdirSync(path.join(sys, 'nvme', name), {recursive:true});
        fs.symlinkSync(physical, path.join(sys, 'nvme', name, 'device'));
        for (const suffix of ['n1','n1p1']) fs.writeFileSync(path.join(sys, 'block', name + suffix), 'fixture');
      });
      const funcs = definitions.replaceAll('/sys/class/', sys + '/').replaceAll('/tmp/sysinfo/board_name', boardFile);
      function discover(code) {
        const result = cp.spawnSync('sh', [], {input:funcs + code,encoding:'utf8'});
        assert.strictEqual(result.status, 0, result.stderr);
        return result.stdout.trim();
      }
      assert.strictEqual(discover('discover_disk nvme0'), '/dev/' + names[0] + 'n1');
      assert.strictEqual(discover('discover_disk nvme1'), '/dev/' + names[1] + 'n1');
      assert.strictEqual(discover('data_device /dev/' + names[0] + 'n1'), '/dev/' + names[0] + 'n1p1');
      fs.unlinkSync(path.join(sys, 'block', names[0] + 'n1p1'));
      assert.strictEqual(discover('data_device /dev/' + names[0] + 'n1'), '/dev/' + names[0] + 'n1');
    } finally {
      // fixture is this test's freshly allocated private temporary directory.
      fs.rmSync(fixture, {recursive:true,force:true});
    }
  }
}
console.log('PASS: both boards preserve physical slot identity across reversed NVMe enumeration; delayed partition and remove events are safe');

// Verify the storage card still reads real mount points and does not filter NVMe.
const storage = fs.readFileSync(path.join(root, 'feeds/luci/modules/luci-mod-status/htdocs/luci-static/resources/view/status/include/25_storage.js'), 'utf8');
const rpc = fs.readFileSync(path.join(root, 'feeds/luci/modules/luci-base/root/usr/share/rpcd/ucode/luci'), 'utf8');
assert(storage.includes("method: 'getMountPoints'"));
assert(!storage.match(/MountSkipList\s*=\s*\[[^\]]*nvme/));
assert(rpc.includes("open('/proc/mounts', 'r')") && rpc.includes('statvfs(mount)'));
const savedFormat = String.prototype.format;
String.prototype.format = function(...args) { return String(this) + ' ' + args.join(' '); };
String.format = (format, ...args) => format + ' ' + args.join(' ');
const E = (tag, attributes, children) => ({ tag, attributes, children, appendChild(child) { (this.rows ||= []).push(child); } });
const view = Function('baseclass', 'rpc', 'L', '_', 'E', storage)(
  { extend: value => value }, { declare: () => () => {} },
  { isObject: value => value != null && typeof value === 'object' }, value => value, E);
const rendered = JSON.stringify(view.render([{ root: {used:2,total:10}, tmp: {used:1,total:20} }, [
  { device: '/dev/nvme0n1p1', mount: '/mnt/nvme0', size: 10000, free: 9000 },
  { device: '/dev/nvme1n1p1', mount: '/mnt/nvme1', size: 20000, free: 18000 }
]]));
assert(rendered.includes('/dev/nvme0n1p1 (/mnt/nvme0)'));
assert(rendered.includes('/dev/nvme1n1p1 (/mnt/nvme1)'));
assert(rendered.includes('1000') && rendered.includes('2000'));
String.prototype.format = savedFormat;
// Evaluate the actual package-install recipe with echo-only install macros:
// no compilation, rootfs writes or device changes occur in this test.
const fstools = fs.readFileSync(path.join(root, 'package/system/fstools/Makefile'), 'utf8');
const installStart = fstools.indexOf('define Package/block-mount/install');
const installEnd = fstools.indexOf('\nendef', installStart) + '\nendef'.length;
const recipe = fstools.slice(fstools.indexOf('# These boards keep'), installEnd);
for (const profile of ['edgepi_e87n', 'mangopi_m87k', 'other']) {
  const code = 'INSTALL_DIR:=echo DIR\nINSTALL_BIN:=echo BIN\nINSTALL_CONF:=echo CONF\nINSTALL_DATA:=echo DATA\nLN:=echo LN\nPKG_INSTALL_DIR:=/build\n' + recipe + '\nverify:\n\t$(call Package/block-mount/install,/image)\n';
  const args = ['--no-print-directory','-f','-','verify'];
  if (profile !== 'other') args.push('CONFIG_TARGET_mediatek_filogic_DEVICE_' + profile + '=y');
  const result = cp.spawnSync('make', args, {input:code,encoding:'utf8'});
  assert.strictEqual(result.status, 0, result.stderr);
  for (const file of ['/etc/init.d/fstab','/etc/hotplug.d/block/10-mount','/etc/uci-defaults/10-fstab'])
    assert.strictEqual(result.stdout.includes(file), profile === 'other', result.stdout);
  assert(result.stdout.includes('/usr/sbin/block') && result.stdout.includes('libblkid-tiny.so'));
  assert(result.stdout.includes('/etc/config/fstab'));
}
assert(fs.existsSync(path.join(root, 'package/system/fstools/files/fstab.init')));
assert(fs.existsSync(path.join(root, 'package/system/fstools/files/mount.hotplug')));
console.log('PASS: overview renders both NVMe mount paths and usage; E87N/M87K package excludes automount entries and retains tools; other targets retain original services');
console.log('PASS: sole Samba4 mount ownership without locks, direct mount, idempotence, occupied path/root protection, legacy migration, batched restart, non-ext4 preservation, format confirmation');

// Execute the real early-return code with a fake device tree. A faulty disk
// probe beyond this boundary must never run on either eMMC-only board.
const extroot = fs.readFileSync(path.join(root, 'local-src/fstools-2026.05.23/libfstools/extroot.c'), 'utf8');
const bootPrefix = extroot.slice(extroot.indexOf('int mount_extroot('), extroot.indexOf('/* try finding the library directory */'));
const faultDir = fs.mkdtempSync('/tmp/nvme-boot-isolation-');
try {
  fs.writeFileSync(path.join(faultDir, 'boot.c'), '#include <stdio.h>\n#include <string.h>\n#include <sys/types.h>\n#include <sys/stat.h>\nstatic const char *test_board;\nstatic FILE *test_fopen(const char *p,const char *m) { FILE *f=tmpfile(); fwrite(test_board,1,strlen(test_board)+1,f); rewind(f); return f; }\n#define fopen test_fopen\n' + bootPrefix + 'return 42; }\nint main(int argc,char **argv) { test_board=argv[1]; return mount_extroot("")==-1 ? 0 : 42; }\n');
  cp.execFileSync('cc', [path.join(faultDir, 'boot.c'), '-o', path.join(faultDir, 'boot')]);
  for (const board of ['edgepi,e87n','mangopi,m87k'])
    assert.strictEqual(cp.spawnSync(path.join(faultDir, 'boot'), [board]).status, 0);
  assert.strictEqual(cp.spawnSync(path.join(faultDir, 'boot'), ['generic,nvme-root']).status, 42);
} finally { fs.rmSync(faultDir, {recursive:true,force:true}); }
const nvmeInit = fs.readFileSync(path.join(root, 'feeds/luci/applications/luci-app-samba4/root/etc/init.d/samba4-nvme'), 'utf8');
const initCalls = cp.execFileSync('sh', ['-c', 'procd_open_instance() { :; }; procd_set_param() { printf "%s\\n" "$*"; }; procd_close_instance() { :; }; ' + nvmeInit.slice(nvmeInit.indexOf('start_service()')) + '\nstart_service'], {encoding:'utf8'});
assert(initCalls.includes('command /usr/libexec/samba4-nvme reconcile'));
assert(!initCalls.includes('respawn'));
const blockSource = fs.readFileSync(path.join(root, 'local-src/fstools-2026.05.23/block.c'), 'utf8');
const infoSource = blockSource.slice(blockSource.indexOf('static int main_info('), blockSource.indexOf('static int swapon_usage('));
assert(infoSource.includes('if (argc == 2) {\n\t\tcache_load(1);'));
assert(infoSource.includes('pr = _probe_path(argv[i]);'));
console.log('PASS: real extroot code skips external probing for both eMMC boards; generic NVMe-root unchanged; procd owns non-respawning worker; explicit disk info avoids global scan');
