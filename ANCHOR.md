# E87N 稳定版锚点（屏幕热拔插与管理地址修复）

- 锚点时间：2026-08-30 17:27:43 CST
- 状态：E87N 当前稳定恢复点，替代此前 E87N 锚点
- OpenWrt：25.12.5 r33051-f5dae5ece4
- Git 基线：899ae26ef073f6b00bf3382d1367579727653733
- 分支：release-v25.12.5-j1-20260825-130411
- 目标：mediatek/filogic
- 设备：edgepi,e87n
- 固件 metadata：1.1
- 固件大小：87972102 bytes
- 固件 SHA256：6aaededcb757fdd4ead416fd25d5e5d3663a4e8e3a7da954a46afe9d154cbd95
- 固件文件：openwrt-mediatek-filogic-edgepi_e87n-squashfs-sysupgrade.bin

## 本锚点包含的已验收功能

- E87N 屏幕布局、NVMe 双槽物理映射和温度显示。
- 屏幕只显示 `br-lan` 实际生效的 IPv4 地址，不读取尚未生效的 UCI 地址。
- 屏幕 framebuffer 消失、恢复以及 `display` 进程异常退出后的自动恢复。
- LuCI 刷机/重启恢复后跳转 `/cgi-bin/luci/` 登录入口。
- LAN 管理地址强制应用和普通应用均识别新地址并自动重新连接。
- 静态 IPv4 地址与掩码分栏输入，避免无前缀地址被解释成 `/32`。
- 通用 Samba4 NVMe 自动识别、挂载、共享、认证和数据保护逻辑。

## 关键文件 SHA256

- display-control：f8065e2060e3bc6309aa10b00a4e16f093f206e5a2c4fe7056345cc97d7942ef
- display：0f854658271ef0d8815de156e8f821ad68df4157ac3f976c727d4a1b6657250f
- ui.js：e5bf135536c3cc4b5acc1900d23ea3af83434201c7f78ad50e5a51c7ffa658e5
- static.js：0f5e0e55fb0ad36f0a21c1826859ef28a461a36f7378b7e21d76690b15a22b95
- base.po：762dce1d5bcaf8dd5565fa80021b4b40a6b95ab7bf214b89580262e6248c0b3b
- data_network.c：17db9c43986ddb363934dd0e1798d6978be34a24e986f5748977cf29002c3178
- e87n.config：db2919f32ab848f01ccfb0a256f8f659e4d74936e6c7276ab070244edc3687cc
- .config：1a128e5759a3720a98712f9fcdbcb1d4812f25ee9b30bfaf6a9dfeb2fd30c71b

## 恢复原则

先保存当前工作树，再从本锚点压缩包恢复对应源码与配置。固件可直接按 SHA256 核验后刷回。不要使用 `git reset --hard`，以免覆盖锚点之后的其他本地修改。
