package main

import "testing"

func TestStateForSpeed(t *testing.T) {
	tests := []struct {
		speed int
		want  ledState
	}{
		{10, ledState{yellow: true}},
		{100, ledState{yellow: true}},
		{1000, ledState{green: true}},
		{2500, ledState{green: true, yellow: true}},
		{0, ledState{}},
		{5000, ledState{}},
	}
	for _, test := range tests {
		if got := stateForSpeed(test.speed); got != test.want {
			t.Fatalf("speed %d: got %+v, want %+v", test.speed, got, test.want)
		}
	}
}

func TestPacketDelta(t *testing.T) {
	if got := packetDelta(10, 14); got != 4 {
		t.Fatalf("normal delta: got %d", got)
	}
	if got := packetDelta(14, 10); got != 0 {
		t.Fatalf("counter reset: got %d", got)
	}
}
