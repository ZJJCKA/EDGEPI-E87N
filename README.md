# E87N / M87K 定稿源码

基于 OpenWrt **25.12.6** 正式版，内核 **6.12.112**。本仓库直接保存维护后的内核、设备、LuCI、代理和 Samba 源码，构建时不复制运行时覆盖文件，也不套用外挂修复补丁。

当前代理组件：PassWall 26.10.16-r2（源码提交 ab7ff4c）、Xray 26.10.17、OpenClash 0.48.002、core alpha-gbc76c13。其他 feeds 保持本次本机构建使用的定稿版本。完整来源提交和源码校验值见 `finalized-source.json`。

## 构建

Linux 环境安装 OpenWrt 编译依赖、Node.js、Go、Python 3、CMake、Ninja、zstd 和 squashfs-tools 后运行：

```sh
./build-finalized.sh j4-standard
```

脚本校验仓库内的定稿源码，只生成 feed 索引和包链接，再依次编译 E87N、M87K。请勿运行 `scripts/feeds update -a` 覆盖已维护的源码。内核路径会自动调整为当前克隆目录。GitHub Actions 只支持手动触发，不会因推送自动编译。

公开构建不包含三份个人预置代理配置。个人标准版请在本机提供 `files/etc/config/openclash`、`files/etc/config/passwall`、`files/etc/config/passwall_server`，先运行准备脚本，再使用 `bash build-both-firmware.sh j4-standard`。三份配置均被 Git 忽略，禁止提交。

本机 2026-10-20 双机标准版构建成功，镜像 metadata、正式版本、NVMe 单一挂载管理及关键功能文件离线核验通过；尚未做本次版本的真机冷启动验收。含个人配置的本机镜像不随源码上传。

## 定稿功能

- 按 PCIe 物理路径识别两台设备的 NVMe0 / NVMe1；Samba4 统一管理数据盘挂载、共享和格式化确认。
- 保留屏幕、风扇、M87K Go 灯控及 E87N 既有 LED 规则。
- NAS 独立菜单、OpenClash 位于 PassWall 上方、终端自动登录及管理地址变更后自动重连。
- 仅两台设备跳过 extroot 外盘扫描并延迟加载 NVMe；公共存储工具和其他设备的默认行为保留。

## OpenWrt

![OpenWrt logo](include/logo.png)

OpenWrt Project is a Linux operating system targeting embedded devices. Instead
of trying to create a single, static firmware, OpenWrt provides a fully
writable filesystem with package management. This frees you from the
application selection and configuration provided by the vendor and allows you
to customize the device through the use of packages to suit any application.
For developers, OpenWrt is the framework to build an application without having
to build a complete firmware around it; for users this means the ability for
full customization, to use the device in ways never envisioned.

Sunshine!

## Download

Built firmware images are available for many architectures and come with a
package selection to be used as WiFi home router. To quickly find a factory
image usable to migrate from a vendor stock firmware to OpenWrt, try the
*Firmware Selector*.

* [OpenWrt Firmware Selector](https://firmware-selector.openwrt.org/)

If your device is supported, please follow the **Info** link to see install
instructions or consult the support resources listed below.

## 

An advanced user may require additional or specific package. (Toolchain, SDK, ...) For everything else than simple firmware download, try the wiki download page:

* [OpenWrt Wiki Download](https://openwrt.org/downloads)

## Development

To build your own firmware you need a GNU/Linux, BSD or macOS system (case
sensitive filesystem required). Cygwin is unsupported because of the lack of a
case sensitive file system.

### Requirements

You need the following tools to compile OpenWrt, the package names vary between
distributions. A complete list with distribution specific packages is found in
the [Build System Setup](https://openwrt.org/docs/guide-developer/build-system/install-buildsystem)
documentation.

```
binutils bzip2 diff find flex gawk gcc-6+ getopt grep install libc-dev libz-dev
make4.1+ perl python3.7+ rsync subversion unzip which
```

### Quickstart

1. Run `./scripts/feeds update -a` to obtain all the latest package definitions
   defined in feeds.conf / feeds.conf.default

2. Run `./scripts/feeds install -a` to install symlinks for all obtained
   packages into package/feeds/

3. Run `make menuconfig` to select your preferred configuration for the
   toolchain, target system & firmware packages.

4. Run `make` to build your firmware. This will download all sources, build the
   cross-compile toolchain and then cross-compile the GNU/Linux kernel & all chosen
   applications for your target system.

### Related Repositories

The main repository uses multiple sub-repositories to manage packages of
different categories. All packages are installed via the OpenWrt package
manager called `opkg`. If you're looking to develop the web interface or port
packages to OpenWrt, please find the fitting repository below.

* [LuCI Web Interface](https://github.com/openwrt/luci): Modern and modular
  interface to control the device via a web browser.

* [OpenWrt Packages](https://github.com/openwrt/packages): Community repository
  of ported packages.

* [OpenWrt Routing](https://github.com/openwrt/routing): Packages specifically
  focused on (mesh) routing.

* [OpenWrt Video](https://github.com/openwrt/video): Packages specifically
  focused on display servers and clients (Xorg and Wayland).

## Support Information

For a list of supported devices see the [OpenWrt Hardware Database](https://openwrt.org/supported_devices)

### Documentation

* [Quick Start Guide](https://openwrt.org/docs/guide-quick-start/start)
* [User Guide](https://openwrt.org/docs/guide-user/start)
* [Developer Documentation](https://openwrt.org/docs/guide-developer/start)
* [Technical Reference](https://openwrt.org/docs/techref/start)

### Support Community

* [Forum](https://forum.openwrt.org): For usage, projects, discussions and hardware advise.
* [Support Chat](https://webchat.oftc.net/#openwrt): Channel `#openwrt` on **oftc.net**.

### Developer Community

* [Bug Reports](https://bugs.openwrt.org): Report bugs in OpenWrt
* [Dev Mailing List](https://lists.openwrt.org/mailman/listinfo/openwrt-devel): Send patches
* [Dev Chat](https://webchat.oftc.net/#openwrt-devel): Channel `#openwrt-devel` on **oftc.net**.

## License

OpenWrt is licensed under GPL-2.0
