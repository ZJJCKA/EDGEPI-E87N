package main

import (
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	netdev            = "eth1"
	greenLED          = "/sys/class/leds/LED-WAN-G"
	yellowLED         = "/sys/class/leds/LED-WAN-Y"
	samplePeriod      = 32 * time.Millisecond
	activityThreshold = uint64(4)
)

type ledState struct {
	green  bool
	yellow bool
}

func stateForSpeed(speed int) ledState {
	switch speed {
	case 10, 100:
		return ledState{yellow: true}
	case 1000:
		return ledState{green: true}
	case 2500:
		return ledState{green: true, yellow: true}
	default:
		return ledState{}
	}
}

func packetDelta(previous, current uint64) uint64 {
	if current < previous {
		return 0
	}
	return current - previous
}

func readInt(path string) (int, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(string(b)))
}

func readUint(path string) (uint64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	return strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
}

func write(path, value string) error {
	return os.WriteFile(path, []byte(value), 0)
}

func setLED(path string, on bool) error {
	value := "0"
	if on {
		value = "1"
	}
	return write(filepath.Join(path, "brightness"), value)
}

func setPair(state ledState) error {
	greenErr := setLED(greenLED, state.green)
	yellowErr := setLED(yellowLED, state.yellow)
	return errors.Join(greenErr, yellowErr)
}

func packetCount() uint64 {
	rx, rxErr := readUint("/sys/class/net/" + netdev + "/statistics/rx_packets")
	tx, txErr := readUint("/sys/class/net/" + netdev + "/statistics/tx_packets")
	if rxErr != nil || txErr != nil {
		return 0
	}
	return rx + tx
}

func wait(stop <-chan os.Signal, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-stop:
		return false
	case <-timer.C:
		return true
	}
}

func run(stop <-chan os.Signal) error {
	for _, led := range []string{greenLED, yellowLED} {
		if info, err := os.Stat(led); err != nil || !info.IsDir() {
			return fmt.Errorf("LED interface unavailable: %s", led)
		}
		if err := write(filepath.Join(led, "trigger"), "none"); err != nil {
			return fmt.Errorf("disable trigger for %s: %w", led, err)
		}
	}
	defer setPair(ledState{})

	lastPackets := packetCount()
	for {
		carrier, err := readInt("/sys/class/net/" + netdev + "/carrier")
		if err != nil || carrier != 1 {
			if err := setPair(ledState{}); err != nil {
				return err
			}
			lastPackets = packetCount()
			if !wait(stop, 100*time.Millisecond) {
				return nil
			}
			continue
		}

		speed, err := readInt("/sys/class/net/" + netdev + "/speed")
		if err != nil {
			speed = 0
		}
		steady := stateForSpeed(speed)
		packets := packetCount()
		if packetDelta(lastPackets, packets) >= activityThreshold {
			if err := setPair(ledState{}); err != nil {
				return err
			}
			if !wait(stop, samplePeriod) {
				return nil
			}
		}
		if err := setPair(steady); err != nil {
			return err
		}
		lastPackets = packets
		if !wait(stop, samplePeriod) {
			return nil
		}
	}
}

func main() {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	if err := run(stop); err != nil {
		fmt.Fprintln(os.Stderr, "m87k-net-led:", err)
		os.Exit(1)
	}
}
