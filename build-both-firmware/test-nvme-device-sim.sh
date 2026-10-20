#!/bin/sh
# Test actual kernel mounts using only newly-created /tmp images. Never install.
set -e
[ "$(cat /tmp/sysinfo/board_name)" = mangopi,m87k ] || exit 1
sim_dir=$(mktemp -d /tmp/samba4-nvme-sim.XXXXXX)
loop0=
loop1=
cleanup() {
	set +e
	for slot in nvme0 nvme1; do
		awk -v mp="$sim_dir/$slot" '$2 == mp { found=1 } END { exit !found }' /proc/self/mounts && umount "$sim_dir/$slot"
	done
	[ -z "$loop0" ] || /tmp/nvme-sim-loop detach "$loop0" "$sim_dir/disk0.img" || return 1
	[ -z "$loop1" ] || /tmp/nvme-sim-loop detach "$loop1" "$sim_dir/disk1.img" || return 1
	rm -f "$sim_dir/disk0.img" "$sim_dir/disk1.img" "$sim_dir/functions.sh" "$sim_dir/overview.json"
	rmdir "$sim_dir/nvme0" "$sim_dir/nvme1" "$sim_dir" 2>/dev/null
	echo 'Simulation mounts, loops and newly-created test images released.'
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
loop0=$(/tmp/nvme-sim-loop attach "$sim_dir/disk0.img")
loop1=$(/tmp/nvme-sim-loop attach "$sim_dir/disk1.img")
/tmp/nvme-sim-loop verify "$loop0" "$sim_dir/disk0.img"
/tmp/nvme-sim-loop verify "$loop1" "$sim_dir/disk1.img"
# Deliberately duplicate UUIDs to verify device/physical-slot ownership rather
# than the old fstab UUID resolver (two cloned disks must not select one disk).
mkfs.ext4 -q -F -U 1efb0a24-03ad-4e28-8a4d-252525252525 "$loop0"
mkfs.ext4 -q -F -U 1efb0a24-03ad-4e28-8a4d-252525252525 "$loop1"
# Load the production functions; redirect only test mount paths. Mock service
# publication, not the real mount/block/filesystem operations. No UCI edits.
sed '/^# Samba4 is the sole automount owner/,$d' /usr/libexec/samba4-nvme |
	sed "s|/mnt/|$sim_dir/|g" > "$sim_dir/functions.sh"
. "$sim_dir/functions.sh"
discover_disk() { case "$1" in nvme0) echo "$loop0";; nvme1) echo "$loop1";; esac; }
data_device() { echo "$1"; }
install_share() { echo "SIMULATED SHARE $1"; }
remove_share() { :; }
samba_restart() { echo 'SIMULATED SERVICE RESTART'; }
samba_stop() { :; }
samba_running() { return 1; }
remove_generic_mount_dirs() { :; }
reconcile
echo 'NVME-SIM-KEEP-DATA' > "$sim_dir/nvme0/preserved.txt"
echo 'NVME-SIM-SECOND-DISK' > "$sim_dir/nvme1/preserved.txt"
before=$(awk -v prefix="$sim_dir/" 'index($2,prefix)==1 { n++ } END { print n+0 }' /proc/self/mounts)
mount_slot nvme0
mount_slot nvme1
after=$(awk -v prefix="$sim_dir/" 'index($2,prefix)==1 { n++ } END { print n+0 }' /proc/self/mounts)
[ "$before" = 2 ] && [ "$after" = 2 ]
umount "$sim_dir/nvme0"
reconcile
[ "$(cat "$sim_dir/nvme0/preserved.txt")" = NVME-SIM-KEEP-DATA ]
[ "$(cat "$sim_dir/nvme1/preserved.txt")" = NVME-SIM-SECOND-DISK ]
[ "$(content_state "$loop0" ext4)" = yes ]
ubus call luci getMountPoints > "$sim_dir/overview.json"
grep -q "$sim_dir/nvme0" "$sim_dir/overview.json"
grep -q "$sim_dir/nvme1" "$sim_dir/overview.json"
echo 'PASS: simulated boot/reconcile, two real ext4 loop mounts with duplicate UUIDs, repeated events without duplication, remount data preserved, content detection, overview getMountPoints capacity.'
