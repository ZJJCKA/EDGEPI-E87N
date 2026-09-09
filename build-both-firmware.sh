#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RUN_DIR="$ROOT_DIR/build-both-firmware"
mkdir -p "$RUN_DIR"
exec 9>"$RUN_DIR/build.lock"
flock -n 9 || { echo "another build is already running" >&2; exit 1; }
export FORCE_UNSAFE_CONFIGURE=1
timestamp=$(date +%Y%m%d-%H%M%S)
original_config="$RUN_DIR/original-config-${timestamp}"
cp -f "$ROOT_DIR/.config" "$original_config"
outside_overlay_dir="$RUN_DIR/outside-overlay-${timestamp}"
mkdir -p "$outside_overlay_dir"
outside_overlay_disabled=0
m87k_config="$ROOT_DIR/m87k.config"
AUX_TREES=${AUX_TREES:-}
UPDATE_AUX=0
UPDATE_FEEDS=0
PRESERVE_FEEDS=0
BUILD_JOBS=2
START_DEVICE=e87n
ONLY_E87N=0
ONLY_OUTSIDE=0
ONLY_STANDARD=0
if [ "${1:-}" = "update-aux" ]; then
	UPDATE_AUX=1
	elif [ "${1:-}" = "j1" ]; then
	BUILD_JOBS=1
	PRESERVE_FEEDS=1
	elif [ "${1:-}" = "j2" ]; then
		BUILD_JOBS=2
		PRESERVE_FEEDS=1
	elif [ "${1:-}" = "j4" ]; then
		BUILD_JOBS=4
		PRESERVE_FEEDS=1
	elif [ "${1:-}" = "j4-standard" ]; then
		BUILD_JOBS=4
		PRESERVE_FEEDS=1
		ONLY_STANDARD=1
	elif [ "${1:-}" = "j4-outside" ]; then
		BUILD_JOBS=4
		PRESERVE_FEEDS=1
		ONLY_OUTSIDE=1
	elif [ "${1:-}" = "j4-m87k-outside" ]; then
		BUILD_JOBS=4
		PRESERVE_FEEDS=1
		START_DEVICE=m87k
		ONLY_OUTSIDE=1
	elif [ "${1:-}" = "j6" ]; then
		BUILD_JOBS=6
		PRESERVE_FEEDS=1
	elif [ "${1:-}" = "j8" ]; then
		BUILD_JOBS=8
		PRESERVE_FEEDS=1
	elif [ "${1:-}" = "j6-m87k" ]; then
		BUILD_JOBS=6
		PRESERVE_FEEDS=1
		START_DEVICE=m87k
	elif [ "${1:-}" = "j6-e87n" ]; then
		BUILD_JOBS=6
		PRESERVE_FEEDS=1
		ONLY_E87N=1
	elif [ "${1:-}" = "update-j1" ]; then
	BUILD_JOBS=1
	UPDATE_FEEDS=1
	elif [ "${1:-}" = "update-j2" ]; then
	BUILD_JOBS=2
	UPDATE_FEEDS=1
elif [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
	echo "用法：$0 [j1|j2|j4|j4-standard|j4-outside|j4-m87k-outside|j6|j8|j6-m87k|j6-e87n|update-j1|update-j2|update-aux]"
	echo "  无参数       更新 OpenWrt feeds 后按 e87n、m87k 使用 j2 编译"
	echo "  j1           保留当前 feeds 与本地插件定制，按 e87n、m87k 使用 j1 编译"
	echo "  j2           保留当前 feeds 与本地插件定制，按 e87n、m87k 使用 j2 编译"
	echo "  j4           保留当前 feeds 与本地插件定制，按 e87n、m87k 使用 j4 编译"
	echo "  j4-standard  保留当前 feeds 与本地插件定制，仅按 e87n、m87k 使用 j4 编译标准版"
	echo "  j4-outside   保留现有默认版，仅按 e87n、m87k 使用 j4 重编 outside 版"
	echo "  j4-m87k-outside  E87N Outside 已完成后，仅使用 j4 续编 M87K Outside"
	echo "  j6           保留当前 feeds 与本地插件定制，按 e87n、m87k 使用 j6 编译"
	echo "  j8           保留当前 feeds 与本地插件定制，按 e87n、m87k 使用 j8 编译"
	echo "  j6-m87k      e87n 已完成后，仅从 m87k 使用 j6 续编"
	echo "  j6-e87n      仅使用 j6 增量编译 e87n"
	echo "  update-j1    更新 OpenWrt feeds 后按 e87n、m87k 使用 j1 编译"
	echo "  update-j2    更新 OpenWrt feeds 后按 e87n、m87k 使用 j2 编译"
	echo "  update-aux   更新 AUX_TREES 指定源码树中的 Passwall、OpenClash 与 Core"
	echo "  固件产物     每台生成默认版和 outside 版；outside 不注入 openclash/passwall/passwall_server 预置配置"
	exit 0
fi

log_error_cn() {
	printf '[%s] 错误：%s\n' "$(date -Is)" "$*" >&2
}

update_aux_tree() {
	local tree=$1
	local log="$RUN_DIR/$(basename "$tree")-插件更新-${timestamp}.log"
	local tmp="$RUN_DIR/.openclash-src-${timestamp}"
	echo "[$(date -Is)] 开始更新 $(basename "$tree") 的 Passwall V2、Passwall Packages、OpenClash 和 Core" | tee "$log"
	{
		if [ ! -d "$tree/package/openwrt-passwall/.git" ] || [ ! -d "$tree/package/openwrt-passwall-packages/.git" ]; then
			log_error_cn "$tree 的 Passwall 仓库目录不完整"
			return 1
		fi
		for repo in "$tree/package/openwrt-passwall" "$tree/package/openwrt-passwall-packages"; do
			if [ -n "$(git -C "$repo" status --porcelain)" ]; then
				log_error_cn "$(basename "$repo") 有本地改动，为避免覆盖未更新；详情见 $log"
				return 1
			fi
			git -C "$repo" pull --ff-only origin main
		done
		# OpenClash is not a standalone git checkout in xue; use a temporary clone.
		rm -rf "$tmp"
		git clone --depth 1 https://github.com/vernesong/OpenClash.git "$tmp"
		if [ -e "$tree/package/luci-app-openclash" ] && [ -n "$(git -C "$tree" status --porcelain -- package/luci-app-openclash 2>/dev/null)" ]; then
			log_error_cn "$tree 的 OpenClash 目录有本地改动，拒绝覆盖"
			return 1
		fi
		rm -rf "$tree/package/luci-app-openclash"
		cp -a "$tmp/luci-app-openclash" "$tree/package/luci-app-openclash"
		# OpenClash core is shipped/updated through its core download logic; keep it with the UI source.
		echo "$(basename "$tree") 插件与 OpenClash Core 源码更新完成"
	} 2>&1 | tee -a "$log"
	rm -rf "$tmp"
}

update_aux_trees() {
	[ -n "$AUX_TREES" ] || {
		log_error_cn "update-aux 需要通过 AUX_TREES 指定一个或多个源码树"
		return 1
	}
	local tree
	for tree in $AUX_TREES; do
		update_aux_tree "$tree"
	done
}

backup_file() {
	local file=$1
	cp -f "$file" "$RUN_DIR/$(basename "$file").${timestamp}.bak"
}

check_proxy_upstreams() {
	local log="$RUN_DIR/proxy-upstream-check-${timestamp}.log"
	local singbox_local openclash_local meta_local
	local singbox_latest openclash_latest meta_remote_hash meta_local_hash
	local api meta_tmp

	singbox_local=$(sed -n 's/^PKG_VERSION:=//p' \
		"$ROOT_DIR/feeds/passwall_packages/sing-box/Makefile" 2>/dev/null | head -n1)
	openclash_local=$(sed -n 's/^PKG_VERSION:=//p' \
		"$ROOT_DIR/package/luci-app-openclash/Makefile" 2>/dev/null | head -n1)
	meta_local=$(sed -n 's/^OPENCLASH_CORE_VERSION:=//p' \
		"$ROOT_DIR/package/openclash-core-meta/Makefile" 2>/dev/null | head -n1)
	meta_local_hash=$(sed -n 's/^[[:space:]]*HASH:=//p' \
		"$ROOT_DIR/package/openclash-core-meta/Makefile" 2>/dev/null | head -n1)

	# GitHub's release API is authoritative for the two released components.
	# A failed check never replaces a known-good local source or download.
	api=$(curl -fsSL --retry 2 --connect-timeout 8 --max-time 20 \
		https://api.github.com/repos/SagerNet/sing-box/releases/latest 2>/dev/null || true)
	singbox_latest=$(printf '%s\n' "$api" | sed -n 's/.*"tag_name":[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1)
	api=$(curl -fsSL --retry 2 --connect-timeout 8 --max-time 20 \
		https://api.github.com/repos/vernesong/OpenClash/releases/latest 2>/dev/null || true)
	openclash_latest=$(printf '%s\n' "$api" | sed -n 's/.*"tag_name":[[:space:]]*"v\{0,1\}\([^"]*\)".*/\1/p' | head -n1)
	meta_tmp=$(mktemp "$RUN_DIR/.meta-check-${timestamp}.XXXXXX")
	if curl -fsSL --retry 2 --connect-timeout 8 --max-time 60 \
		https://raw.githubusercontent.com/vernesong/OpenClash/core/master/meta/clash-linux-arm64.tar.gz \
		-o "$meta_tmp" 2>/dev/null; then
		meta_remote_hash=$(sha256sum "$meta_tmp" | awk '{print $1}')
	else
		meta_remote_hash=
	fi
	rm -f "$meta_tmp"

	{
		echo "[$(date -Is)] 代理组件上游检查"
		echo "sing-box: 本地 ${singbox_local:-未知}，正式版 ${singbox_latest:-检查失败}"
		echo "OpenClash: 本地 ${openclash_local:-未知}，正式版 ${openclash_latest:-检查失败}"
		echo "Mihomo Meta: 本地 ${meta_local:-未知}，本地归档 ${meta_local_hash:-未知}，上游归档 ${meta_remote_hash:-检查失败}"
	} | tee "$log"

	[ -z "$singbox_latest" ] || [ "$singbox_local" = "$singbox_latest" ] || \
		echo "[$(date -Is)] sing-box 有正式版更新；update-j1/update-j2 将通过 feeds 同步后再执行本地兼容性核验" | tee -a "$log"
	[ -z "$openclash_latest" ] || [ "$openclash_local" = "$openclash_latest" ] || \
		echo "[$(date -Is)] OpenClash 有正式版更新；update-j1/update-j2 将通过 feeds 同步后重新应用菜单源码约束" | tee -a "$log"
	[ -z "$meta_remote_hash" ] || [ "$meta_local_hash" = "$meta_remote_hash" ] || {
		log_error_cn "Mihomo Meta 上游归档已变化；为保证哈希供应链校验，不自动接受未知二进制。请先更新固定提交、版本与 HASH"
		return 1
	}
}

update_feeds() {
	local feeds="$ROOT_DIR/feeds.conf.default"
	local update_status=0 install_status=0
	backup_file "$feeds"
	if [ "$PRESERVE_FEEDS" -eq 1 ]; then
		echo "[$(date -Is)] 保留 feeds 模式：跳过可能覆盖本地插件定制的 feed 刷新，使用当前源码编译" | tee "$RUN_DIR/feeds-update-${timestamp}.log"
		return 0
	fi
	# Floating refs keep every configured plugin feed at its current upstream tip.
	sed -Ei '/^[[:space:]]*src-git(-full)?[[:space:]]/ s/\^[^[:space:]]+//' "$feeds"
	set +e
	"$ROOT_DIR/scripts/feeds" update -a 2>&1 | tee "$RUN_DIR/feeds-update-${timestamp}.log"
	update_status=${PIPESTATUS[0]}
	"$ROOT_DIR/scripts/feeds" install -a 2>&1 | tee "$RUN_DIR/feeds-install-${timestamp}.log"
	install_status=${PIPESTATUS[0]}
	set -e
	if [ "$update_status" -ne 0 ]; then
		log_error_cn "部分 feed 更新失败，已保留本地定制并继续编译；详见 feeds-update-${timestamp}.log"
	fi
	if [ "$install_status" -ne 0 ]; then
		log_error_cn "部分 feed 安装失败，继续使用当前已安装插件；详见 feeds-install-${timestamp}.log"
	fi
}

disable_orphan_luci_dcwapd() {
	local link="$ROOT_DIR/package/feeds/luci/luci-app-dcwapd"
	local makefile

	[ -e "$link" ] || [ -L "$link" ] || return 0

	while IFS= read -r makefile; do
		case "$makefile" in
			*/luci-app-dcwapd/Makefile) continue ;;
		esac
		if grep -Eq '^define Package/dcwapd([[:space:]]|$)' "$makefile"; then
			return 0
		fi
	done < <(find "$ROOT_DIR/package" "$ROOT_DIR/feeds" -type f -name Makefile -print)

	if [ -L "$link" ]; then
		rm -f "$link"
		rm -f "$ROOT_DIR/tmp/.packageinfo" "$ROOT_DIR/tmp/.packagedeps"
		echo "[$(date -Is)] dcwapd 后端不存在：已取消注册孤立的 luci-app-dcwapd，保留 feed 源码" \
			| tee -a "$RUN_DIR/feeds-update-${timestamp}.log"
	else
		log_error_cn "$link 不是 feeds 生成的符号链接，拒绝自动删除"
		return 1
	fi
}

disable_haproxy_example_service() {
	local makefile="$ROOT_DIR/package/haproxy/Makefile"
	[ -f "$makefile" ] || {
		log_error_cn 'HAProxy Makefile 不存在'
		return 1
	}

	# PassWall invokes /usr/sbin/haproxy directly with its generated config.
	# The feed's example init/config instead starts an unrelated S99 service
	# listening on 81/444/60000, so keep only the executable in the package.
	python3 - "$makefile" <<'PY'
from pathlib import Path
import re
import sys

p = Path(sys.argv[1])
s = p.read_text()
s = re.sub(
    r'\ndefine Package/haproxy/conffiles\n/etc/haproxy\.cfg\nendef\n\n'
    r'Package/haproxy-nossl/conffiles = \$\(Package/haproxy/conffiles\)\n',
    '\n', s, count=1)
s = s.replace('\t$(INSTALL_DIR) $(1)/etc\n'
              '\t$(INSTALL_CONF) ./files/haproxy.cfg $(1)/etc/\n'
              '\t$(INSTALL_DIR) $(1)/etc/init.d\n'
              '\t$(INSTALL_BIN) ./files/haproxy.init $(1)/etc/init.d/haproxy\n',
              '', 1)
p.write_text(s)
PY

	if grep -Eq 'INSTALL_(CONF|BIN).*haproxy\.(cfg|init)|Package/haproxy/conffiles' "$makefile"; then
		log_error_cn 'HAProxy 示例服务仍会进入固件'
		return 1
	fi
	grep -Fq '$(INSTALL_BIN) $(PKG_BUILD_DIR)/haproxy $(1)/usr/sbin/' "$makefile" || {
		log_error_cn 'HAProxy 主程序安装规则缺失'
		return 1
	}
	echo "[$(date -Is)] HAProxy 仅保留主程序，示例配置及开机服务已禁用"
	make -C "$ROOT_DIR" package/haproxy/clean >/dev/null
}

clean_finalized_luci_status_packages() {
	echo "[$(date -Is)] 清理已修改的 LuCI、升级与代理包缓存，确保定稿源码进入全部固件"
	make package/luci-mod-status/clean \
		package/luci-app-upnp/clean \
		package/luci-app-samba4/clean \
		package/samba4/clean \
		package/fancontrol/clean \
		package/luci-app-fanctrol/clean \
		package/luci-app-openclash/clean \
		package/base-files/clean \
		package/fitblk/clean V=s
}

verify_integrated_service_sources() {
	local samba_init="$ROOT_DIR/package/samba4/files/samba.init"
	local nvme_manager="$ROOT_DIR/package/luci-app-samba4/root/usr/libexec/samba4-nvme"
	local nvme_init="$ROOT_DIR/package/luci-app-samba4/root/etc/init.d/samba4-nvme"
	local gpt_check="$ROOT_DIR/target/linux/mediatek/filogic/base-files/etc/uci-defaults/98-e87n-m87k-emmc-gpt-repair"
	local fan_ui="$ROOT_DIR/package/luci-app-fanctrol"
	local fan_backend="$ROOT_DIR/package/fancontrol"
	local file count=0

	for file in "$samba_init" "$nvme_manager" "$nvme_init" "$gpt_check"; do
		[ -f "$file" ] || { log_error_cn "集成服务源码缺失：$file"; return 1; }
		sh -n "$file"
	done
	[ -x "$gpt_check" ] || { log_error_cn 'eMMC GPT 检查脚本缺少执行权限'; return 1; }

	grep -Fq 'init_factory_account' "$samba_init"
	! grep -Fq 'E87N_M87K_DELAYED_START' "$samba_init"
	! grep -Fq 'E87N_M87K_DELAYED_START' "$nvme_manager"
	grep -Fq 'START=97' "$nvme_init"
	grep -Fq 'SAMBA4_NVME_DEFER_RESTART=1' "$nvme_manager"
	grep -Fq 'edgepi,e87n|mangopi,m87k' "$gpt_check"

	for file in \
		"$ROOT_DIR/files/etc/init.d/e87n-m87k-samba" \
		"$ROOT_DIR/files/etc/init.d/e87n-m87k-avahi" \
		"$ROOT_DIR/files/etc/hotplug.d/iface/95-e87n-m87k-services" \
		"$ROOT_DIR/files/etc/uci-defaults/97-e87n-m87k-service-order" \
		"$ROOT_DIR/files/etc/uci-defaults/99-emmc-gpt-repair"; do
		[ ! -e "$file" ] || { log_error_cn "旧叠加服务仍存在：$file"; return 1; }
	done

	while IFS= read -r file; do
		case "$file" in
			etc/config/openclash|etc/config/passwall|etc/config/passwall_server) count=$((count + 1));;
			*) log_error_cn "files/ 中存在不允许的额外固件叠加：$file"; return 1;;
		esac
	done < <(find "$ROOT_DIR/files" -type f -printf '%P\n' | sort)
	[ "$count" -eq 3 ] || { log_error_cn 'files/ 中三份标准版代理配置不完整'; return 1; }

	# Fan control has exactly one LuCI owner and one Go runtime backend.
	[ ! -e "$ROOT_DIR/package/luci-app-fancontrol" ] || { log_error_cn '旧 luci-app-fancontrol 目录仍存在'; return 1; }
	[ ! -e "$fan_ui/root/usr/bin/fancontrol" ] || { log_error_cn '旧 Shell 风扇守护仍存在'; return 1; }
	[ ! -e "$fan_backend/src/fancontrol.c" ] || { log_error_cn '旧 C 风扇后端仍存在'; return 1; }
	[ ! -e "$fan_ui/tools/build_ipk.py" ] || { log_error_cn '失效的单体 IPK 构建器仍存在'; return 1; }
	grep -Fq 'golang-package.mk' "$fan_backend/Makefile"
	grep -Fq '+fancontrol' "$fan_ui/Makefile"
	grep -Fq 'procd_send_signal fancontrol controller HUP' "$fan_ui/root/etc/init.d/fancontrol"
	grep -Fq '+fdisk' "$ROOT_DIR/package/luci-app-samba4/Makefile" || {
		log_error_cn 'Samba4 NVMe 格式化所需 fdisk 依赖缺失'
		return 1
	}
	for file in "$ROOT_DIR/e87n.config" "$ROOT_DIR/m87k.config"; do
		for package_name in cfdisk sfdisk vim vim-full vim-fuller vim-runtime nano nano-full nano-plus; do
			! grep -q "^CONFIG_PACKAGE_${package_name}=y$" "$file" || {
				log_error_cn "$(basename "$file") 误选了重复或不用的工具：$package_name"
				return 1
			}
		done
	done
	python3 "$fan_ui/tools/test_release_3_2_14.py"
	python3 "$fan_ui/tools/test_fan_power_states.py"
	python3 "$fan_ui/tools/test_temperature_sources.py"
	python3 "$fan_ui/tools/test_upgrade_paths.py"

	echo "[$(date -Is)] 双机服务源码唯一性核验通过，files/ 仅保留三份标准版代理配置"
}

apply_openclash_menu() {
	local file="$ROOT_DIR/package/luci-app-openclash/luasrc/controller/openclash.lua"
	[ -f "$file" ] || return 0
	if ! grep -Eq 'entry\(\{"admin", "services", "openclash"\}.*-5\)' "$file"; then
		sed -Ei 's/(entry\(\{"admin", "services", "openclash"\}.*OpenClash[^,]*, )[0-9-]+\)/\1-5)/' "$file"
	fi
	grep -Eq 'entry\(\{"admin", "services", "openclash"\}.*-5\)' "$file" || \
		{ echo "OpenClash menu priority -5 was not found" >&2; return 1; }
}

apply_passwall_v2_compat() {
	local file="$ROOT_DIR/package/luci-app-passwall/root/usr/share/passwall/app.sh"
	[ -f "$file" ] || return 0
	python3 - "$file" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
pairs = (
('''\t\tlocal svr_t=$(build_time "$week" "$time")\n\t\tif [ "$week" = "8" ]; then\n\t\t\tupdate_loop=1\n\t\telse\n''', '''\t\tif [ "$week" = "8" ]; then\n\t\t\tupdate_loop=1\n\t\telse\n\t\t\tlocal svr_t=$(build_time "$week" "$time")\n'''),
('''\t\tlocal rule_t=$(build_time "$rules_update_week_mode" "$rules_update_time_mode")\n\t\tif [ "$rules_update_week_mode" = "8" ]; then\n\t\t\tupdate_loop=1\n\t\telse\n''', '''\t\tif [ "$rules_update_week_mode" = "8" ]; then\n\t\t\tupdate_loop=1\n\t\telse\n\t\t\tlocal rule_t=$(build_time "$rules_update_week_mode" "$rules_update_time_mode")\n'''),
('''\t\t\tlocal sub_t=$(build_time "$sub_update_week_mode" "$sub_update_time_mode")\n\t\t\tif [ "$sub_update_week_mode" = "8" ]; then\n\t\t\t\tupdate_loop=1\n\t\t\telse\n''', '''\t\t\tif [ "$sub_update_week_mode" = "8" ]; then\n\t\t\t\tupdate_loop=1\n\t\t\telse\n\t\t\t\tlocal sub_t=$(build_time "$sub_update_week_mode" "$sub_update_time_mode")\n'''))
changed = 0
for old, new in pairs:
    if old in s:
        s = s.replace(old, new, 1)
        changed += 1
if changed not in (0, 3):
    raise SystemExit(f"unsupported Passwall loop schedule structure: {changed}/3")
p.write_text(s)
PY
	sh -n "$file"
}

verify_passwall_runtime_health() {
	local monitor="$ROOT_DIR/package/luci-app-passwall/root/usr/share/passwall/monitor.sh"
	local utils="$ROOT_DIR/package/luci-app-passwall/root/usr/share/passwall/utils.sh"
	[ -f "$monitor" ] && [ -f "$utils" ] || {
		log_error_cn 'PassWall 运行监控源码缺失'
		return 1
	}
	if grep -Fq 'CODEX_PASSWALL_PROXY_HEALTH_V1' "$monitor"; then
		grep -Fq 'HEALTH_FAIL_LIMIT=3' "$monitor"
		grep -Fq 'socks5h://127.0.0.1:' "$monitor"
		grep -Fq 'restart_main_xray' "$monitor"
		grep -Fq 'CODEX_PASSWALL_LOG_ROTATION_V1' "$utils"
		grep -Fq 'tail -n 1000' "$utils"
	elif ! grep -Eq 'curl.*(socks5|--proxy)|socks5.*curl' "$monitor" || \
		! grep -Eq 'xray.*restart|restart.*xray|kill.*xray' "$monitor" || \
		! grep -Eq '/etc/init\.d/.*passwall.*restart|/etc/init\.d/\$CONFIG restart' "$monitor" || \
		grep -Eq 'echo[[:space:]]+""[[:space:]]*>[[:space:]]*\$LOG_FILE' "$utils" || \
		! grep -Eq 'tail[[:space:]].*(1000|LOG_FILE)' "$utils"; then
		log_error_cn 'PassWall 尚未包含完整的代理真实健康检测与日志轮转，请先运行更新脚本'
		return 1
	fi
	sh -n "$monitor"
	sh -n "$utils"
	echo "[$(date -Is)] PassWall 真实代理健康检测与日志轮转源码校验通过"
	# Force the incrementally rebuilt package to contain the modified sources.
	make -C "$ROOT_DIR" package/luci-app-passwall/clean >/dev/null
}

prepare_sources() {
	if [ "$UPDATE_AUX" -eq 1 ]; then
		update_aux_trees
		echo "插件更新命令执行完成"
		exit 0
	fi
	update_feeds
	check_proxy_upstreams
	disable_orphan_luci_dcwapd
	disable_haproxy_example_service
	clean_finalized_luci_status_packages
	verify_integrated_service_sources
	apply_openclash_menu
	apply_passwall_v2_compat
	verify_passwall_runtime_health
	for config in .config e87n.config; do
		grep -q '^CONFIG_PACKAGE_luci-app-samba4=y$' "$ROOT_DIR/$config" || echo 'CONFIG_PACKAGE_luci-app-samba4=y' >> "$ROOT_DIR/$config"
	done
}

run_one() {
	local name=$1
	local config=$2
	local variant=${3:-default}
	local log="$RUN_DIR/${name}-${timestamp}.log"
	local before="$RUN_DIR/${name}-${timestamp}.before" after="$RUN_DIR/${name}-${timestamp}.after"
	local retry_log="$RUN_DIR/${name}-${timestamp}.j1.log"
	local error_log="$RUN_DIR/${name}-${timestamp}.errors.log"
	local attempt=1 make_status=0 attempt_log
	echo "[$(date -Is)] building $name ($variant) with $config" | tee -a "$log"
	find "$ROOT_DIR/bin/targets" -type f -name '*sysupgrade*' -printf '%T@ %p\n' 2>/dev/null | sort > "$before" || true
	case "$config" in
		/*) cp -f "$config" "$ROOT_DIR/.config" ;;
		*) cp -f "$ROOT_DIR/$config" "$ROOT_DIR/.config" ;;
	esac
	echo "[$(date -Is)] $name 开始执行 defconfig" | tee -a "$log"
	make -C "$ROOT_DIR" defconfig >> "$log" 2>&1
	echo "[$(date -Is)] $name defconfig 完成，开始 make -j$BUILD_JOBS V=s" | tee -a "$log"
	while :; do
		attempt_log="$RUN_DIR/${name}-${timestamp}.attempt-${attempt}.log"
		echo "[$(date -Is)] $name 开始第 $attempt 次 make -j$BUILD_JOBS V=s" | tee -a "$log"
		if make -C "$ROOT_DIR" -j"$BUILD_JOBS" V=s 2>&1 | tee "$attempt_log"; then
			make_status=${PIPESTATUS[0]}
			cat "$attempt_log" >> "$retry_log"
			break
		fi
		make_status=${PIPESTATUS[0]}
		cat "$attempt_log" >> "$retry_log"
		if [ "$make_status" -eq 143 ] || [ "$make_status" -eq 137 ]; then
			echo "[$(date -Is)] $name 收到终止信号（退出码=$make_status），保留现场并在 10 秒后续编" | tee -a "$log"
			attempt=$((attempt + 1))
			sleep 10
			continue
		fi
		grep -Ein '(^|[[:space:]])(error|fatal error|错误|失败|warning|警告)(:|[[:space:]]|$)|undefined reference|No such file|cannot find|recipe for target.*failed' "$retry_log" > "$error_log" || true
		[ -s "$error_log" ] || cp -f "$retry_log" "$error_log"
		echo "[$(date -Is)] $name -j$BUILD_JOBS 编译失败，退出码=$make_status，中文诊断日志：$error_log" | tee -a "$log"
		return 1
	done
	echo "[$(date -Is)] $name make -j$BUILD_JOBS V=s 完成，退出码=$make_status" | tee -a "$log"
	find "$ROOT_DIR/bin/targets" -type f -name '*sysupgrade*' -printf '%T@ %p\n' 2>/dev/null | sort > "$after" || true
	awk 'FILENAME == ARGV[1] { old[$2]=$1; next } !($2 in old) || $1 > old[$2] { print $2 }' "$before" "$after" | tee "$RUN_DIR/${name}-${timestamp}.outputs"
	[ -s "$RUN_DIR/${name}-${timestamp}.outputs" ] || { echo "$name produced no new sysupgrade image" >&2; return 1; }
	echo "[$(date -Is)] completed $name ($variant)" | tee -a "$log"
}

disable_outside_overlays() {
	local name source stash
	[ "$outside_overlay_disabled" -eq 0 ] || return 0
	while IFS='|' read -r name source; do
		[ -n "$source" ] || continue
		stash="$outside_overlay_dir/$name"
		if [ -e "$source" ]; then
			mkdir -p "$(dirname "$stash")"
			mv "$source" "$stash"
		fi
	done <<EOF
overlay/openclash|$ROOT_DIR/files/etc/config/openclash
overlay/passwall|$ROOT_DIR/files/etc/config/passwall
overlay/passwall_server|$ROOT_DIR/files/etc/config/passwall_server
package/openclash|$ROOT_DIR/package/luci-app-openclash/root/etc/config/openclash
package/passwall_server|$ROOT_DIR/package/luci-app-passwall/root/etc/config/passwall_server
EOF
	outside_overlay_disabled=1
	# These two package roots ship their own defaults, so invalidate their cached
	# package images whenever the variant changes.
	make -C "$ROOT_DIR" package/luci-app-openclash/clean package/luci-app-passwall/clean >/dev/null
}

restore_outside_overlays() {
	local name target stash restored=0
	while IFS='|' read -r name target; do
		[ -n "$target" ] || continue
		stash="$outside_overlay_dir/$name"
		if [ -e "$stash" ]; then
			mkdir -p "$(dirname "$target")"
			mv "$stash" "$target"
			restored=1
		fi
	done <<EOF
overlay/openclash|$ROOT_DIR/files/etc/config/openclash
overlay/passwall|$ROOT_DIR/files/etc/config/passwall
overlay/passwall_server|$ROOT_DIR/files/etc/config/passwall_server
package/openclash|$ROOT_DIR/package/luci-app-openclash/root/etc/config/openclash
package/passwall_server|$ROOT_DIR/package/luci-app-passwall/root/etc/config/passwall_server
EOF
	outside_overlay_disabled=0
	if [ "$restored" -eq 1 ]; then
		make -C "$ROOT_DIR" package/luci-app-openclash/clean package/luci-app-passwall/clean >/dev/null
	fi
}

refresh_rootfs_overlay() {
	# Top-level files/ overlays are not individually tracked by every image stamp.
	# Rebuilding base-files forces the next incremental image to reflect removals.
	make -C "$ROOT_DIR" package/base-files/clean >/dev/null
}

image_path_for() {
	case "$1" in
		e87n) printf '%s\n' "$ROOT_DIR/bin/targets/mediatek/filogic/openwrt-mediatek-filogic-edgepi_e87n-squashfs-sysupgrade.bin" ;;
		m87k) printf '%s\n' "$ROOT_DIR/bin/targets/mediatek/filogic/openwrt-mediatek-filogic-mangopi_m87k-squashfs-sysupgrade.bin" ;;
		*) log_error_cn "未知设备：$1"; return 1 ;;
	esac
}

build_device_variants() {
	local name=$1 config=$2 image outside_image saved_default
	image=$(image_path_for "$name")
	outside_image=${image/-squashfs-sysupgrade.bin/-outside-squashfs-sysupgrade.bin}
	saved_default="$RUN_DIR/${name}-${timestamp}-default.bin"

	restore_outside_overlays
	if [ "$ONLY_OUTSIDE" -eq 0 ]; then
		refresh_rootfs_overlay
		run_one "$name-default" "$config" default
		[ -s "$image" ] || { log_error_cn "$name 默认版固件不存在：$image"; return 1; }
	else
		[ -s "$image" ] || { log_error_cn "$name 现有默认版固件不存在，不能仅重编 outside：$image"; return 1; }
	fi
	cp -f "$image" "$saved_default"
	if [ "$ONLY_STANDARD" -eq 1 ]; then
		make -C "$ROOT_DIR" checksum >/dev/null
		printf '%s\n' "$image" | tee "$RUN_DIR/${name}-${timestamp}.variants"
		return 0
	fi

	disable_outside_overlays
	refresh_rootfs_overlay
	run_one "$name-outside" "$config" outside
	[ -s "$image" ] || { log_error_cn "$name outside 固件不存在：$image"; return 1; }
	mv -f "$image" "$outside_image"
	cp -f "$saved_default" "$image"
	restore_outside_overlays
	make -C "$ROOT_DIR" checksum >/dev/null
	printf '%s\n%s\n' "$image" "$outside_image" | tee "$RUN_DIR/${name}-${timestamp}.variants"
}

cleanup() {
	restore_outside_overlays
	cp -f "$original_config" "$ROOT_DIR/.config" 2>/dev/null || true
}

trap cleanup EXIT
prepare_sources
if [ "$START_DEVICE" = e87n ]; then
	build_device_variants e87n e87n.config
fi
[ "$ONLY_E87N" -eq 1 ] && exit 0
build_device_variants m87k "$m87k_config"
make -C "$ROOT_DIR" checksum >/dev/null
echo "[$(date -Is)] all default/outside builds completed; images are listed in $RUN_DIR/*.variants"
