#!/bin/sh

# CODEX_PASSWALL_PROXY_HEALTH_V1

DIR="$(cd "$(dirname "$0")" && pwd)"
. $DIR/utils.sh
LOCK_FILE=${LOCK_PATH}/${CONFIG}_monitor.lock

MAX_RESTART_COUNT=10
RESTART_STATS_DIR="${TMP_PATH}/script_rstats"
HEALTH_FAIL_FILE="${RESTART_STATS_DIR}/proxy_health.count"
HEALTH_FAIL_LIMIT=3
HEALTH_URL="https://chatgpt.com/cdn-cgi/trace"
mkdir -p "$RESTART_STATS_DIR"

network_ready() {
	ip -4 route show default 2>/dev/null | grep -q '^default ' ||
		ip -6 route show default 2>/dev/null | grep -q '^default '
}

proxy_health_check() {
	local socks_port http_code
	socks_port=$(config_t_get global tcp_node_socks_port 1070)
	case "$socks_port" in
		''|*[!0-9]*) return 0 ;;
	esac
	http_code=$(/usr/bin/curl -skI -o /dev/null \
		--connect-timeout 5 --max-time 10 \
		--proxy "socks5h://127.0.0.1:${socks_port}" \
		-w '%{http_code}' "$HEALTH_URL" 2>/dev/null) || return 1
	case "$http_code" in
		[1-5][0-9][0-9]) return 0 ;;
		*) return 1 ;;
	esac
}

restart_main_xray() {
	local file cmd cmd_check
	for file in "$TMP_SCRIPT_FUNC_PATH"/*; do
		[ -f "$file" ] || continue
		IFS= read -r cmd < "$file"
		case "$cmd" in
			*xray*TCP*.json*|*xray*TCP*) ;;
			*) continue ;;
		esac
		cmd_check=$(printf '%s' "$cmd" | sed 's/>.*$//;s/[[:space:]]*$//')
		[ -n "$cmd_check" ] || continue
		busybox pgrep -f "$cmd_check" | xargs -r kill >/dev/null 2>&1
		sleep 1
		sh -c "nohup $cmd 2>&1 &"
		return 0
	done
	return 1
}

save_fault_log() {
	local snapshot="/tmp/log/${CONFIG}-fault.log"
	{
		echo "===== $(date '+%Y-%m-%d %H:%M:%S') proxy health failure ====="
		tail -n 1000 "$LOG_FILE" 2>/dev/null
	} > "${snapshot}.tmp" && mv -f "${snapshot}.tmp" "$snapshot"
}

sleep 58s
last_cleanup_date=$(date +%Y%m%d)
while [ 1 -eq 1 ]; do
	[ -f "$LOCK_FILE" ] && {
		sleep 6s
		continue
	}
	touch $LOCK_FILE

	for file in "$TMP_SCRIPT_FUNC_PATH"/*; do
		[ -f "$file" ] || continue
		IFS= read -r cmd < "$file"
		[ -z "$cmd" ] && continue
		cmd_check=$(printf '%s' "$cmd" | sed 's/>.*$//;s/[[:space:]]*$//')
		
		case "$cmd_check" in
			*dns2socks*) cmd_check=${cmd_check//:/ } ;;
		esac

		filename=$(basename "$file")
		stats_file="${RESTART_STATS_DIR}/${filename}.count"
		if [ -s "$stats_file" ]; then
			read restart_count < "$stats_file"
			[ -z "$restart_count" ] && restart_count=0
		else
			restart_count=0
		fi
		# 检查是否超过最大重启次数
		[ "$restart_count" -ge "$MAX_RESTART_COUNT" ] && continue

		if ! busybox pgrep -f "$cmd_check" >/dev/null; then
			restart_count=$((restart_count + 1))
			echo "$restart_count" > "$stats_file"
			#echo "${cmd} 进程挂掉，重启" >> /tmp/log/passwall.log
			sh -c "nohup $cmd 2>&1 &"
			sleep 1
		fi
	done

	# A missing uplink is not a proxy failure. In particular, do not turn a
	# normal cable/DHCP wait into repeated Xray and PassWall restarts.
	if ! network_ready; then
		echo 0 > "$HEALTH_FAIL_FILE"
	elif proxy_health_check; then
		echo 0 > "$HEALTH_FAIL_FILE"
	else
		read health_fail_count < "$HEALTH_FAIL_FILE" 2>/dev/null || health_fail_count=0
		case "$health_fail_count" in ''|*[!0-9]*) health_fail_count=0 ;; esac
		health_fail_count=$((health_fail_count + 1))
		echo "$health_fail_count" > "$HEALTH_FAIL_FILE"
		if [ "$health_fail_count" -ge "$HEALTH_FAIL_LIMIT" ]; then
			save_fault_log
			echolog "代理健康检测连续失败 ${health_fail_count} 次，尝试重启主 Xray 节点。"
			if restart_main_xray; then
				sleep 8
			fi
			if proxy_health_check; then
				echo 0 > "$HEALTH_FAIL_FILE"
				echolog "主 Xray 节点重启后代理健康检测恢复。"
			else
				echolog "主 Xray 节点重启后仍异常，重启 PassWall。"
				rm -f "$LOCK_FILE"
				/etc/init.d/$CONFIG restart >/dev/null 2>&1 &
				exit 0
			fi
		fi
	fi

	# 每天清理一次统计文件（跨天后执行一次）
	current_date=$(date +%Y%m%d)
	if [ "$current_date" != "$last_cleanup_date" ]; then
		rm -f "${RESTART_STATS_DIR:?}"/* 2>/dev/null
		last_cleanup_date="$current_date"
	fi

	rm -f $LOCK_FILE
	sleep 58s
done
