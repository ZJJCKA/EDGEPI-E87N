#!/usr/bin/env python3
"""Static release and single-implementation contract."""
from pathlib import Path

UI = Path(__file__).resolve().parents[1]
PACKAGES = UI.parent
BACKEND = PACKAGES / "fancontrol"
ui_make = (UI / "Makefile").read_text()
backend_make = (BACKEND / "Makefile").read_text()
controller = (UI / "luasrc/controller/fancontrol.lua").read_text()
view = (UI / "luasrc/view/fancontrol/main.htm").read_text()
go = (BACKEND / "src/main.go").read_text()
assert "PKG_VERSION:=3.2.14" in ui_make and "PKG_RELEASE:=11" in ui_make
assert "LUCI_DEPENDS:=+luci-compat +fancontrol +kmod-hwmon-pwmfan" in ui_make
assert "golang-package.mk" in backend_make and "GoBinPackage,fancontrol" in backend_make
assert not (PACKAGES / "luci-app-fancontrol").exists()
assert not (UI / "root/usr/bin/fancontrol").exists()
assert not (BACKEND / "src/fancontrol.c").exists()
assert not (BACKEND / "files").exists()
for key in ("temperature", "speed", "state", "error", "sample_uptime", "control_source", "selected_sources"):
    assert f'"{key}=' in go or f'fmt.Sprintf("{key}=' in go
assert "local function notify_daemon()" in controller
assert 'cmdline:find("/usr/bin/fancontrol", 1, true)' in controller
assert 'require("nixio").kill(pid, 1)' in controller
assert "scheduleStatusPolling(1000);" in view
print("PASS: release 3.2.14 has one native backend and matching LuCI contract")
