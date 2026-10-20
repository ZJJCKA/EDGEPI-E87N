#!/bin/sh
set -eu

TOPDIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$TOPDIR"

# Package sources are validation-only here. Compatibility changes belong to
# their owning source and are never re-applied with sed, awk or copied patches.
librespeed_rust='feeds/packages/utils/librespeed-cli-rust/Makefile'
librespeed_common='feeds/packages/utils/librespeed-common/Makefile'
if [ -f "$librespeed_rust" ] && [ -f "$librespeed_common" ]; then
	! grep -Eq '^[[:space:]]*PROVIDES:=librespeed-cli[[:space:]]*$' "$librespeed_rust"
	grep -Fq 'DEPENDS:=+(!powerpc):librespeed-cli +(powerpc):librespeed-cli-rust +rpcd-mod-ucode' "$librespeed_common"
fi

sdl3_makefile='feeds/video/libs/sdl3/Makefile'
if [ -f "$sdl3_makefile" ]; then
	grep -Fq 'PKG_BUILD_DEPENDS:=wayland/host wayland wayland-protocols libxkbcommon' "$sdl3_makefile"
fi

ruby_makefile='feeds/packages/lang/ruby/Makefile'
ruby_source='local-src/ruby-4.0.2/gems/bundled_gems'
if [ -f "$ruby_makefile" ] &&
   grep -Fq 'USE_SOURCE_DIR:=$(TOPDIR)/local-src/ruby-$(PKG_VERSION)' "$ruby_makefile"; then
	test -s "$ruby_source"
	! grep -Eq '^[[:space:]]*win32ole[[:space:]]' "$ruby_source"
	! find feeds/packages/lang/ruby/patches -maxdepth 1 -type f -name '*win32ole*' | grep -q .
fi

openclash_init='feeds/openclash/luci-app-openclash/root/etc/init.d/openclash'
if [ -f "$openclash_init" ] &&
   grep -Fq '# CODEX_OFFLINE_ROOTFS_GUARD' "$openclash_init"; then
	grep -Fq '# CODEX_OFFLINE_ROOTFS_GUARD' "$openclash_init"
	grep -Fq 'if [ -z "${IPKG_INSTROOT:-}" ]; then' "$openclash_init"
	grep -Fq '. $IPKG_INSTROOT/usr/share/openclash/openclash_curl.sh' "$openclash_init"
	awk '
		/# CODEX_OFFLINE_ROOTFS_GUARD/ { guard = 1 }
		guard && /^if \[ -z "\$\{IPKG_INSTROOT:-\}" \]; then$/ { conditional = 1 }
		conditional && /^\. \$IPKG_INSTROOT\/usr\/share\/openclash\/openclash_curl\.sh$/ { helper = 1 }
		helper && /^fi$/ { closed = 1; exit }
		END { exit !(guard && conditional && helper && closed) }
	' "$openclash_init"
fi

# Only stale generated feed symlinks are removed; package source is untouched.
ORPHAN_LIST='scripts/e87n-unselected-feed-packages'
test -s "$ORPHAN_LIST"
ORPHAN_PACKAGES="$(sed -e 's/#.*$//' -e '/^[[:space:]]*$/d' "$ORPHAN_LIST")"
for package in $ORPHAN_PACKAGES; do
	for link in package/feeds/*/"$package"; do
		[ -L "$link" ] || continue
		rm -f "$link"
	done
done
for package in $ORPHAN_PACKAGES; do
	for link in package/feeds/*/"$package"; do
		[ ! -L "$link" ] || {
			echo "ERROR: failed to remove unselected feed package: $link" >&2
			exit 1
		}
	done
done
