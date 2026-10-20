package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSelectedSensorOnlyAndImmediateSwitch(t *testing.T) {
	dir := t.TempDir()
	first, second := filepath.Join(dir, "first"), filepath.Join(dir, "second")
	if err := os.WriteFile(first, []byte("41000"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(second, []byte("52000"), 0600); err != nil {
		t.Fatal(err)
	}
	c := controller{selected: "nvme0", nvmeFiles: [2]string{first, second}, sources: make(map[string]reading), discoverIn: 15}
	c.sample()
	if c.sources["nvme0"].temp != 41000 || c.sources["nvme1"].state != "missing" {
		t.Fatal(c.sources)
	}
	if err := os.WriteFile(second, []byte("57000"), 0600); err != nil {
		t.Fatal(err)
	}
	c.selected = "nvme1"
	c.sample()
	if c.sources["nvme1"].temp != 57000 || c.sources["nvme0"].state != "missing" {
		t.Fatal(c.sources)
	}
	if err := os.Remove(second); err != nil {
		t.Fatal(err)
	}
	c.sample()
	if c.nvmeFiles[1] != "" || c.discoverIn != 15 {
		t.Fatal("failed read bypassed discovery backoff")
	}
}

func TestMissingNVMeDiscoveryBackoff(t *testing.T) {
	c := controller{hwmonRoot: t.TempDir(), selected: "nvme0", nvmeBackoff: 5}
	for _, want := range []int{5, 15, 30, 60, 60} {
		c.discover()
		if c.discoverIn != want {
			t.Fatalf("retry delay %d, want %d", c.discoverIn, want)
		}
	}
}

func TestNormalizeSource(t *testing.T) {
	for _, source := range []string{"cpu", "phy", "nvme0", "nvme1"} {
		got, ok := normalizeSource(source)
		if !ok || got != source {
			t.Fatalf("source %q became %q, %v", source, got, ok)
		}
	}
	for _, invalid := range []string{"", "cpu phy", "wifi", "nvme2"} {
		if got, ok := normalizeSource(invalid); ok || got != "" {
			t.Fatalf("invalid source %q accepted as %q", invalid, got)
		}
	}
}

func TestCurveSpeed(t *testing.T) {
	tests := []struct{ temp, want int }{{20, 20}, {40, 20}, {45, 40}, {48, 51}, {60, 100}, {120, 100}}
	for _, tc := range tests {
		if got := curveSpeed(defaultCurve, tc.temp); got != tc.want {
			t.Fatalf("temperature %d: got %d want %d", tc.temp, got, tc.want)
		}
	}
	if got := curveSpeed("invalid", 50); got != 100 {
		t.Fatalf("invalid curve got %d", got)
	}
}

func TestTemperatureValidation(t *testing.T) {
	for _, value := range []int{-40000, 0, 150000} {
		if !validTemp(value) {
			t.Fatalf("valid temperature rejected: %d", value)
		}
	}
	for _, value := range []int{-40001, 150001} {
		if validTemp(value) {
			t.Fatalf("invalid temperature accepted: %d", value)
		}
	}
}
