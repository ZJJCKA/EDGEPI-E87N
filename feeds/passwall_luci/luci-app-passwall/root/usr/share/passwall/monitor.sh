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
	local file cmd pid start_time current_start_time
	for file in "$TMP_SCRIPT_FUNC_PATH"/*; do
		[ -f "$file" ] || continue
		{ IFS= read -r pid; IFS= read -r start_time; } < "$file"
		cmd=$(sed '1,2d' "$file")
		case "$cmd" in *xray*TCP*) ;; *) continue ;; esac
		current_start_time=$(get_process_start_time "$pid")
		if [ -n "$current_start_time" ] && [ "$current_start_time" = "$start_time" ]; then
			kill "$pid" 2>/dev/null
			sleep 1 9>&-
			[ "$(get_process_start_time "$pid")" = "$start_time" ] && kill -9 "$pid" 2>/dev/null
		fi
		pid=$(sh -c "nohup ${cmd} & echo \$!" 9>&-)
		{
			printf '%s\n' "$pid" "$(get_process_start_time "$pid")"
			printf '%s\n' "$cmd"
		} > "$file"
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

[ "$(get_cache_var "ENABLED_DEFAULT_ACL")" != 1 ] && [ "$(get_cache_var "ENABLED_ACLS")" != 1 ] && exit 1
ENABLED=$(config_n_get @global_delay[0] start_daemon 0)
[ "$ENABLED" != 1 ] && exit 1
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0
sleep 58s 9>&-
last_cleanup_date=$(date +%Y%m%d)
while [ "$ENABLED" -eq 1 ]; do
	for file in "$TMP_SCRIPT_FUNC_PATH"/*; do
		[ -f "$file" ] || continue
		{
			IFS= read -r pid
			IFS= read -r start_time
		} < "$file"
		cmd=$(sed '1,2d' "$file")
		[ -z "$cmd" ] && continue

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

		current_start_time=$(get_process_start_time "$pid")
		if [ -z "$current_start_time" ] || [ "$current_start_time" != "$start_time" ]; then
			restart_count=$((restart_count + 1))
			echo "$restart_count" > "$stats_file"
			#echo "${cmd} 进程挂掉，重启" >> /tmp/log/passwall.log
			pid=$(sh -c "nohup ${cmd} & echo \$!" 9>&-)
			{
				printf '%s\n' "$pid" "$(get_process_start_time "$pid")"
				printf '%s\n' "$cmd"
			} > "$file"
			sleep 1 9>&-
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
				sleep 8 9>&-
			fi
			if proxy_health_check; then
				echo 0 > "$HEALTH_FAIL_FILE"
				echolog "主 Xray 节点重启后代理健康检测恢复。"
			else
				echolog "主 Xray 节点重启后仍异常，重启 PassWall。"
				/etc/init.d/$CONFIG restart >/dev/null 2>&1 9>&- &
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

	sleep 58s 9>&-
done
