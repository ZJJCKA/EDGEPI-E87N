#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
JOBS=${1:-${JOBS:-$(nproc)}}
CONFIG_FILE="$ROOT_DIR/e87n.config"
IMAGE="$ROOT_DIR/bin/targets/mediatek/filogic/openwrt-mediatek-filogic-edgepi_e87n-squashfs-sysupgrade.bin"

case "$JOBS" in
	''|*[!0-9]*|0) echo "错误：并发数必须是正整数" >&2; exit 2 ;;
esac

[ -t 0 ] && [ -t 1 ] || {
	echo "错误：make menuconfig 需要在交互式终端中运行" >&2
	exit 2
}

cd "$ROOT_DIR"
mkdir -p build-e87n
exec 9>build-e87n/build.lock
flock -n 9 || { echo "错误：已有 E87N 构建正在运行" >&2; exit 1; }

echo "[1/6] 更新 OpenWrt feeds"
./scripts/feeds update -a
./scripts/feeds install -a

echo "[2/6] 载入 E87N 配置"
if [ -s "$CONFIG_FILE" ]; then
	cp -f "$CONFIG_FILE" .config
elif [ -s .config.e87n ]; then
	cp -f .config.e87n .config
fi
make defconfig

echo "[3/6] 打开 menuconfig；请调整插件并选择 Save 后退出"
make menuconfig

echo "[4/6] 固化最终 E87N 配置"
make defconfig
grep -q '^CONFIG_TARGET_mediatek_filogic_DEVICE_edgepi_e87n=y$' .config || {
	echo "错误：目标设备不是 EdgePi E87N，已停止编译" >&2
	exit 1
}
cp -f .config "$CONFIG_FILE"
cp -f .config .config.e87n

echo "[5/6] 下载并校验源码"
make download -j"$JOBS"
find dl -type f -size -1024c -print -delete
make download -j"$JOBS"

echo "[6/6] 使用 j$JOBS 编译 E87N"
make -j"$JOBS"

test -s "$IMAGE" || { echo "错误：未生成 E87N sysupgrade 固件" >&2; exit 1; }
tail -c 4096 "$IMAGE" | strings | grep -Fq '"supported_devices":["edgepi,e87n"]' || {
	echo "错误：固件 metadata 与 E87N 不匹配" >&2
	exit 1
}

echo "编译完成：$IMAGE"
sha256sum "$IMAGE"
