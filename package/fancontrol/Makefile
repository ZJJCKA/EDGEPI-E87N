include $(TOPDIR)/rules.mk

PKG_NAME:=fancontrol
PKG_VERSION:=3.2.14
PKG_RELEASE:=10
PKG_LICENSE:=MIT
PKG_MAINTAINER:=ZJJCKA

PKG_BUILD_DEPENDS:=golang/host
PKG_BUILD_PARALLEL:=1
PKG_BUILD_FLAGS:=no-mips16

GO_PKG:=github.com/zjjcka/fancontrol
GO_PKG_BUILD_PKG:=$(GO_PKG)

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

define Package/fancontrol
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Fail-safe fan and temperature controller
  DEPENDS:=$(GO_ARCH_DEPENDS) +kmod-hwmon-pwmfan
endef

define Package/fancontrol/description
  Native fan controller with CPU, Ethernet PHY and stable physical-slot NVMe
  temperature discovery for E87N and M87K.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Package/fancontrol/install
	$(call GoPackage/Package/Install/Bin,$(1))
endef

$(eval $(call GoBinPackage,fancontrol))
$(eval $(call BuildPackage,fancontrol))
