# luci-app-fanctrol for MT7987 PWM fan devices

版本：`3.2.14-8`

该包保留最终版风扇控制中心的界面与交互功能，底层按 Linux `pwm-fan`
冷却设备工作。目前明确支持 EdgePi E87N 与 MangoPi M87K，不引入无线、
5G 模组或其他机型专用的 PWM 反转规则。

## 硬件规则

- E87N 和 M87K 都使用正向 `pwm-fan` 冷却档位：`state 0` 停转，
  `max_state` 全速。
- 温度来源为处理器、网口 PHY、NVMe 0、NVMe 1，与屏幕和 Samba4 的物理槽位编号一致。
- CPU 读取 `cpu-thermal` 或 SoC thermal zone。
- 网口 PHY 读取 `mdio_bus:*` hwmon，仅在已验证的 E87N/M87K 上启用。
- 两块 NVMe 均读取各自的 `temp1_input` 复合温度，并按 hwmon 数字编号排序。
- 未检测到的 PHY 或 NVMe 来源会隐藏，设备出现后自动显示。

## 功能

- 静音、均衡、性能和自定义模式。
- 手动百分比控制与可拖动温度转速曲线。
- 模式、开关、滑块、温度来源和曲线在操作完成后立即提交 UCI 并生效。
- 保存后的设置在重启或断电后保留。
- 当前温度来源失效时进入 100% 全速保护。
- 页面独占控制，避免多个浏览器同时覆盖曲线。
- 主包内置简体中文，不需要独立风扇中文包。
- 升级和 sysupgrade 均保留 `/etc/config/fancontrol`。

## 自测

```sh
python3 tools/test_release_3_2_14.py
python3 tools/test_fan_power_states.py
python3 tools/test_temperature_sources.py
python3 tools/test_upgrade_paths.py
```

## 生成一体 IPK

```sh
OpenWrt 固件及软件包统一由主构建树生成；不再提供会绕过 Go 后端依赖的独立单包构建器。
```
