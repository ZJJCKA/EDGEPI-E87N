#!/usr/bin/env python3
"""Native fan backend power-state and service contract."""
from pathlib import Path

UI = Path(__file__).resolve().parents[1]
BACKEND = UI.parent / "fancontrol"
go = (BACKEND / "src/main.go").read_text()
init = (UI / "root/etc/init.d/fancontrol").read_text()
for token in ("--check", "--off", "--stop", "setFailsafe", "setFanPercent"):
    assert token in go
assert "(percent*maxState+50)/100" in go
assert "defer func()" in go and "_ = setFailsafe()" in go
assert 'procd_set_param command "$PROG"' in init
assert "procd_send_signal fancontrol controller HUP" in init
assert not (UI / "root/usr/bin/fancontrol").exists()
print("PASS: native fan power-state and service contract")
