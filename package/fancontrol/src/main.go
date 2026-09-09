package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	defaultCurve = "20:20,25:20,30:20,35:20,40:20,45:40,50:59,55:79,60:100,65:100,70:100,75:100,80:100,85:100,90:100,95:100,100:100,105:100,110:100"
	speedFile    = "/var/run/fancontrol.speed"
	statusFile   = "/var/run/fancontrol.status"
	pidFile      = "/var/run/fancontrol.pid"
	lockFile     = "/var/run/fancontrol.lock"
	tempMinMC    = -40000
	tempMaxMC    = 150000
)

type reading struct {
	temp  int
	state string
}

type sensorPath struct {
	device string
	input  string
}

type controller struct {
	board       string
	hwmonRoot   string
	cooling     string
	enabled     string
	curve       string
	selected    string
	selectedOK  bool
	cpuFiles    []string
	phyFiles    []string
	nvmeFiles   [2]string
	sources     map[string]reading
	lastError   string
	discoverIn  int
	nvmeBackoff int
	auxIn       int
}

func readTrim(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func readInt(path string) (int, error) {
	v, err := strconv.Atoi(readTrim(path))
	if err != nil {
		return 0, err
	}
	return v, nil
}

func validTemp(v int) bool { return v >= tempMinMC && v <= tempMaxMC }

func clamp(v, low, high int) int {
	if v < low {
		return low
	}
	if v > high {
		return high
	}
	return v
}

func logMessage(message string) {
	_ = exec.Command("logger", "-t", "fancontrol", "--", message).Run()
}

func uciGet(option, fallback string) string {
	out, err := exec.Command("uci", "-q", "get", "fancontrol.settings."+option).Output()
	if err != nil || strings.TrimSpace(string(out)) == "" {
		return fallback
	}
	return strings.TrimSpace(string(out))
}

func findCooling() string {
	paths, _ := filepath.Glob("/sys/class/thermal/cooling_device*")
	sort.Strings(paths)
	for _, path := range paths {
		if readTrim(filepath.Join(path, "type")) != "pwm-fan" {
			continue
		}
		if _, err := os.Stat(filepath.Join(path, "max_state")); err != nil {
			continue
		}
		f, err := os.OpenFile(filepath.Join(path, "cur_state"), os.O_WRONLY, 0)
		if err == nil {
			_ = f.Close()
			return path
		}
	}
	return ""
}

func setFanPercent(cooling string, percent int) error {
	percent = clamp(percent, 0, 100)
	_ = os.WriteFile(speedFile, []byte(fmt.Sprintf("%d\n", percent)), 0600)
	maxState, err := readInt(filepath.Join(cooling, "max_state"))
	if err != nil || maxState <= 0 {
		return errors.New("invalid max_state")
	}
	state := clamp((percent*maxState+50)/100, 0, maxState)
	statePath := filepath.Join(cooling, "cur_state")
	if readTrim(statePath) == strconv.Itoa(state) {
		return nil
	}
	if err := os.WriteFile(statePath, []byte(fmt.Sprintf("%d\n", state)), 0644); err != nil {
		if readTrim(statePath) != strconv.Itoa(state) {
			return err
		}
	}
	return nil
}

func setFailsafe() error {
	cooling := findCooling()
	_ = os.WriteFile(speedFile, []byte("100\n"), 0600)
	if cooling == "" {
		return errors.New("pwm-fan missing")
	}
	return setFanPercent(cooling, 100)
}

func setOff() error {
	cooling := findCooling()
	_ = os.WriteFile(speedFile, []byte("0\n"), 0600)
	if cooling == "" {
		return errors.New("pwm-fan missing")
	}
	return setFanPercent(cooling, 0)
}

func acquireLock() (*os.File, error) {
	f, err := os.OpenFile(lockFile, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, err
	}
	return f, nil
}

func checkRunning() bool {
	f, err := os.OpenFile(lockFile, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return false
	}
	defer f.Close()
	if syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return true
	}
	_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	return false
}

func newController() *controller {
	hwmon := os.Getenv("FANCONTROL_HWMON_ROOT")
	if hwmon == "" {
		hwmon = "/sys/class/hwmon"
	}
	return &controller{
		board: readTrim("/tmp/sysinfo/board_name"), hwmonRoot: hwmon,
		sources: make(map[string]reading), discoverIn: 0, nvmeBackoff: 5,
	}
}

func (c *controller) loadConfig() {
	c.enabled = uciGet("enable", "1")
	c.curve = uciGet("curve", defaultCurve)
	c.selected, c.selectedOK = normalizeSource(uciGet("temp_sources", "cpu"))
}

func normalizeSource(raw string) (string, bool) {
	fields := strings.Fields(raw)
	selected, valid := "", len(fields) == 1
	if len(fields) > 0 {
		switch fields[0] {
		case "cpu", "phy", "nvme1", "nvme2":
			selected = fields[0]
		default:
			valid = false
		}
	}
	if selected == "" {
		valid = false
	}
	if !valid {
		selected = ""
	}
	return selected, valid
}

func (c *controller) discover() {
	c.cpuFiles, c.phyFiles = nil, nil
	zones, _ := filepath.Glob("/sys/class/thermal/thermal_zone*")
	for _, zone := range zones {
		t := strings.ToLower(readTrim(filepath.Join(zone, "type")))
		if (strings.Contains(t, "cpu") || strings.Contains(t, "soc")) && readTrim(filepath.Join(zone, "temp")) != "" {
			c.cpuFiles = append(c.cpuFiles, filepath.Join(zone, "temp"))
		}
	}
	hwmons, _ := filepath.Glob(filepath.Join(c.hwmonRoot, "hwmon*"))
	sort.Slice(hwmons, func(i, j int) bool {
		a, _ := strconv.Atoi(strings.TrimPrefix(filepath.Base(hwmons[i]), "hwmon"))
		b, _ := strconv.Atoi(strings.TrimPrefix(filepath.Base(hwmons[j]), "hwmon"))
		return a < b
	})
	c.nvmeFiles = [2]string{}
	var generic []sensorPath
	for _, hwmon := range hwmons {
		name := readTrim(filepath.Join(hwmon, "name"))
		if strings.HasPrefix(name, "mdio_bus:") {
			inputs, _ := filepath.Glob(filepath.Join(hwmon, "temp*_input"))
			c.phyFiles = append(c.phyFiles, inputs...)
		}
		if name != "nvme" {
			continue
		}
		input := filepath.Join(hwmon, "temp1_input")
		if _, err := os.Stat(input); err != nil {
			continue
		}
		device, _ := filepath.EvalSymlinks(filepath.Join(hwmon, "device"))
		switch {
		case c.board == "edgepi,e87n" && strings.Contains(device, "11290000.pcie"):
			c.nvmeFiles[0] = input
		case c.board == "edgepi,e87n" && strings.Contains(device, "11280000.pcie"):
			c.nvmeFiles[1] = input
		case c.board == "mangopi,m87k" && strings.Contains(device, "11280000.pcie"):
			c.nvmeFiles[0] = input
		case c.board == "mangopi,m87k" && strings.Contains(device, "11290000.pcie"):
			c.nvmeFiles[1] = input
		default:
			generic = append(generic, sensorPath{device: device, input: input})
		}
	}
	sort.Slice(generic, func(i, j int) bool { return generic[i].device < generic[j].device })
	for i := range c.nvmeFiles {
		if c.nvmeFiles[i] == "" && len(generic) > 0 {
			c.nvmeFiles[i], generic = generic[0].input, generic[1:]
		}
	}
	if c.nvmeFiles[0] != "" && c.nvmeFiles[1] != "" {
		c.nvmeBackoff, c.discoverIn = 5, 30
	} else {
		c.discoverIn = c.nvmeBackoff
		if c.nvmeBackoff < 60 {
			if c.nvmeBackoff == 5 {
				c.nvmeBackoff = 15
			} else {
				c.nvmeBackoff *= 2
				if c.nvmeBackoff > 60 {
					c.nvmeBackoff = 60
				}
			}
		}
	}
}

func highest(files []string) reading {
	best, ok := 0, false
	for _, file := range files {
		if v, err := readInt(file); err == nil && validTemp(v) && (!ok || v > best) {
			best, ok = v, true
		}
	}
	if !ok {
		return reading{state: "missing"}
	}
	return reading{temp: best, state: "ok"}
}

func one(path string) reading {
	v, err := readInt(path)
	if path == "" || err != nil || !validTemp(v) {
		return reading{state: "missing"}
	}
	return reading{temp: v, state: "ok"}
}

func (c *controller) sample() {
	full := c.auxIn <= 0
	if full || c.selected == "cpu" {
		c.sources["cpu"] = highest(c.cpuFiles)
	}
	if full || c.selected == "phy" {
		c.sources["phy"] = highest(c.phyFiles)
	}
	if full || c.selected == "nvme1" {
		c.sources["nvme1"] = one(c.nvmeFiles[0])
		if c.sources["nvme1"].state != "ok" {
			c.discoverIn = 0
		}
	}
	if full || c.selected == "nvme2" {
		c.sources["nvme2"] = one(c.nvmeFiles[1])
		if c.sources["nvme2"].state != "ok" {
			c.discoverIn = 0
		}
	}
	if full {
		c.auxIn = 5
	}
	c.auxIn--
}

type curvePoint struct{ temp, speed int }

func curveSpeed(curve string, target int) int {
	var points []curvePoint
	for _, raw := range strings.Split(curve, ",") {
		parts := strings.Split(raw, ":")
		if len(parts) != 2 {
			continue
		}
		t, e1 := strconv.Atoi(parts[0])
		s, e2 := strconv.Atoi(parts[1])
		if e1 == nil && e2 == nil {
			points = append(points, curvePoint{t, clamp(s, 0, 100)})
		}
	}
	if len(points) == 0 {
		return 100
	}
	if target <= points[0].temp {
		return points[0].speed
	}
	for i := 1; i < len(points); i++ {
		if target <= points[i].temp {
			a, b := points[i-1], points[i]
			if b.temp == a.temp {
				return b.speed
			}
			return clamp(a.speed+(target-a.temp)*(b.speed-a.speed)/(b.temp-a.temp), 0, 100)
		}
	}
	return points[len(points)-1].speed
}

func uptimeSeconds() string {
	fields := strings.Fields(readTrim("/proc/uptime"))
	if len(fields) == 0 {
		return ""
	}
	return strings.Split(fields[0], ".")[0]
}

func statusTemp(r reading) string {
	if r.state != "ok" {
		return "--"
	}
	return strconv.Itoa(r.temp)
}

func (c *controller) writeStatus(temp, speed, state int, message, source string) {
	if source == "" {
		source = "--"
	}
	lines := []string{
		fmt.Sprintf("temperature=%d", temp), fmt.Sprintf("speed=%d", speed), fmt.Sprintf("state=%d", state), "error=" + message,
		"sample_uptime=" + uptimeSeconds(), "control_source=" + source, "selected_sources=" + c.selected,
	}
	for _, key := range []string{"cpu", "phy", "nvme1", "nvme2"} {
		r := c.sources[key]
		if r.state == "" {
			r.state = "missing"
		}
		lines = append(lines, "source_"+key+"_temp="+statusTemp(r), "source_"+key+"_state="+r.state)
	}
	tmp := fmt.Sprintf("%s.%d", statusFile, os.Getpid())
	if os.WriteFile(tmp, []byte(strings.Join(lines, "\n")+"\n"), 0600) == nil {
		_ = os.Rename(tmp, statusFile)
	} else {
		_ = os.Remove(tmp)
	}
}

func (c *controller) cycle() error {
	if c.discoverIn <= 0 {
		c.discover()
	}
	c.discoverIn--
	c.sample()
	temp, speed, source, message := 0, 100, "", ""
	if !c.selectedOK {
		message = "温度来源配置无效，已使用全速保护"
	} else if r := c.sources[c.selected]; r.state == "ok" {
		temp, source = r.temp, c.selected
		speed = curveSpeed(c.curve, (temp+500)/1000)
	} else {
		message = "所选温度来源全部不可用，已使用全速保护"
	}
	switch c.enabled {
	case "0":
		speed = 0
		if !c.selectedOK {
			message = "温度来源配置无效；风扇已按用户设置关闭"
		} else if source == "" {
			message = "所选温度来源全部不可用；风扇已按用户设置关闭"
		}
	case "1":
	default:
		speed, message = 100, "风扇控制开关配置无效，已使用全速保护"
	}
	speed = clamp(speed, 0, 100)
	if err := setFanPercent(c.cooling, speed); err != nil {
		speed = 100
		if setFailsafe() == nil {
			message = "pwm-fan目标状态写入失败，已切换全速保护"
		} else {
			message = "pwm-fan状态写入失败，全速保护写入也未确认"
		}
		state, _ := readInt(filepath.Join(c.cooling, "cur_state"))
		c.writeStatus(temp, speed, state, message, source)
		logMessage(message)
		return err
	}
	state, _ := readInt(filepath.Join(c.cooling, "cur_state"))
	c.writeStatus(temp, speed, state, message, source)
	if message != c.lastError {
		if message != "" {
			logMessage(message)
		}
		c.lastError = message
	}
	return nil
}

func usage() { fmt.Fprintf(os.Stderr, "Usage: %s [--check|--off|--stop]\n", os.Args[0]) }

func main() {
	if len(os.Args) > 2 {
		usage()
		os.Exit(2)
	}
	if len(os.Args) == 2 {
		switch os.Args[1] {
		case "--check":
			if checkRunning() {
				fmt.Println("fancontrol controller is running")
				return
			}
			fmt.Fprintln(os.Stderr, "fancontrol controller is not running")
			os.Exit(1)
		case "--off":
			if setOff() == nil {
				return
			}
			_ = setFailsafe()
			os.Exit(1)
		case "--stop":
			_ = setFailsafe()
			return
		default:
			usage()
			os.Exit(2)
		}
	}
	lock, err := acquireLock()
	if err != nil {
		logMessage("fancontrol controller lock acquisition failed")
		_ = setFailsafe()
		os.Exit(1)
	}
	defer lock.Close()
	if err := os.WriteFile(pidFile, []byte(fmt.Sprintf("%d\n", os.Getpid())), 0600); err != nil {
		_ = setFailsafe()
		os.Exit(1)
	}
	defer func() {
		_ = setFailsafe()
		if readTrim(pidFile) == strconv.Itoa(os.Getpid()) {
			_ = os.Remove(pidFile)
		}
	}()
	c := newController()
	for attempt := 0; attempt < 15; attempt++ {
		c.cooling = findCooling()
		if c.cooling != "" {
			break
		}
		time.Sleep(time.Second)
	}
	if c.cooling == "" {
		logMessage("未找到 pwm-fan 控制接口")
		os.Exit(1)
	}
	c.loadConfig()
	logMessage(fmt.Sprintf("风扇控制已启动：%s %s", c.board, c.cooling))
	signals := make(chan os.Signal, 4)
	signal.Notify(signals, syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM)
	for {
		if err := c.cycle(); err != nil {
			os.Exit(1)
		}
		timer := time.NewTimer(time.Second)
		select {
		case sig := <-signals:
			if !timer.Stop() {
				<-timer.C
			}
			if sig == syscall.SIGHUP {
				c.loadConfig()
				c.discoverIn = 0
				continue
			}
			return
		case <-timer.C:
		}
	}
}
