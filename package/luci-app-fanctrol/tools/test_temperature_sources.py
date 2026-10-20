#!/usr/bin/env python3
"""Native fan backend sensor and LuCI interface contract."""
from pathlib import Path
import subprocess

UI = Path(__file__).resolve().parents[1]
BACKEND = UI.parent / "fancontrol"
go = (BACKEND / "src/main.go").read_text()
controller = (UI / "luasrc/controller/fancontrol.lua").read_text()
view = (UI / "luasrc/view/fancontrol/main.htm").read_text()
assert 'TEMP_SOURCE_IDS = { "cpu", "phy", "nvme0", "nvme1" }' in controller
assert "var tempSourceKeys = ['cpu', 'phy', 'nvme0', 'nvme1'];" in view
for key in ("cpu", "phy", "nvme0", "nvme1"):
    assert '"source_"+key+"_temp="' in go
    assert '"source_"+key+"_state="' in go
for value in ("edgepi,e87n", "mangopi,m87k", "11280000.pcie", "11290000.pcie"):
    assert value in go
assert "sort.Slice(generic" in go and "generic[i].device < generic[j].device" in go
assert "filepath.EvalSymlinks" in go
assert not (UI / "root/usr/bin/fancontrol").exists()
subprocess.run(["go", "test", "./..."], cwd=BACKEND / "src", check=True)
print("PASS: native CPU/PHY/NVMe source contract")
