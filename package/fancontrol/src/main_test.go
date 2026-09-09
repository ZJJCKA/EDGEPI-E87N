package main

import "testing"

func TestNormalizeSource(t *testing.T) {
	for _, source := range []string{"cpu", "phy", "nvme1", "nvme2"} {
		got, ok := normalizeSource(source)
		if !ok || got != source {
			t.Fatalf("source %q became %q, %v", source, got, ok)
		}
	}
	for _, invalid := range []string{"", "cpu phy", "wifi", "nvme0"} {
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
