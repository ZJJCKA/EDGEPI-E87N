include $(TOPDIR)/rules.mk

PKG_NAME:=m87k-net-led
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=ZJJCKA

PKG_BUILD_DEPENDS:=golang/host
PKG_BUILD_PARALLEL:=1
PKG_BUILD_FLAGS:=no-mips16

GO_PKG:=github.com/zjjcka/m87k-net-led
GO_PKG_BUILD_PKG:=$(GO_PKG)

include $(INCLUDE_DIR)/package.mk
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

define Package/m87k-net-led
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=MangoPi M87K speed and activity LED controller
  DEPENDS:=$(GO_ARCH_DEPENDS)
endef

define Package/m87k-net-led/description
  Native controller for the M87K active-low WAN GPIO LEDs. It maps negotiated
  Ethernet speed to colour and gates activity blinking without shell polling.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Package/m87k-net-led/install
	$(call GoPackage/Package/Install/Bin,$(1))
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/m87k-net-led.init $(1)/etc/init.d/m87k-net-led
endef

$(eval $(call GoBinPackage,m87k-net-led))
$(eval $(call BuildPackage,m87k-net-led))
