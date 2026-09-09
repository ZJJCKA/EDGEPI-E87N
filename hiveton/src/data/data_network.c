#include "data_network.h"
#include "data_manager.h"
#include "../utils/file_utils.h"
#include "../utils/str_utils.h"
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <net/if.h>
#include <arpa/inet.h>

#define DEFAULT_IFACE "eth1"
#define PROC_NET_DEV "/proc/net/dev"
#define MAX_LINE_LEN 256

// 网络接口统计信息
typedef struct {
    unsigned long long rx_bytes;
    unsigned long long tx_bytes;
} net_stats_t;

static char g_iface[32] = DEFAULT_IFACE;
static net_stats_t g_last_stats = {0};
static uint32_t g_last_update_ms = 0;
static bool g_first_read = true;
static char g_wan_ip[32] = "0.0.0.0";
static char g_wan6_ip[64] = "::";   // WAN IPv6 地址缓冲区
static char g_lan_ip[32] = "0.0.0.0";  // LAN IPv4 地址
static char g_lan6_ip[64] = "::";   // LAN IPv6 地址缓冲区
static uint64_t g_rx_speed = 0;
static uint64_t g_tx_speed = 0;
static bool g_wan_ip_valid = false;     // WAN IP 是否有效
static bool g_wan6_ip_valid = false;    // WAN IPv6 是否有效
static bool g_lan_ip_valid = false;     // LAN IP 是否有效
static bool g_lan6_ip_valid = false;    // LAN IPv6 是否有效

// 获取当前时间（毫秒）
static uint32_t get_tick_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint32_t)(ts.tv_sec * 1000 + ts.tv_nsec / 1000000);
}

// 从 /proc/net/dev 读取指定接口的统计信息
static int read_proc_net_dev(const char *iface, net_stats_t *stats)
{
    FILE *fp = fopen(PROC_NET_DEV, "r");
    if (!fp) {
        return -1;
    }

    char line[MAX_LINE_LEN];
    bool found = false;

    // 跳过前两行标题
    fgets(line, sizeof(line), fp);
    fgets(line, sizeof(line), fp);

    while (fgets(line, sizeof(line), fp)) {
        // 查找接口名（在行首，可能有前导空格，以冒号结尾）
        char *p = strchr(line, ':');
        if (!p) continue;

        *p = '\0';
        char *ifname = str_trim(line);

        if (strcmp(ifname, iface) == 0) {
            // 解析统计信息
            // 格式: rx_bytes packets errs drop fifo frame compressed multicast tx_bytes ...
            p++;
            unsigned long long rx_bytes, tx_bytes;
            if (sscanf(p, "%llu %*u %*u %*u %*u %*u %*u %*u %llu",
                       &rx_bytes, &tx_bytes) == 2) {
                stats->rx_bytes = rx_bytes;
                stats->tx_bytes = tx_bytes;
                found = true;
                break;
            }
        }
    }

    fclose(fp);
    return found ? 0 : -1;
}

// 获取 WAN IP 地址
static int get_wan_ip(char *ip_buf, size_t buf_size)
{
    // 方法1: 尝试通过 ioctl 获取接口 IP
    int sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock < 0) {
        return -1;
    }

    struct ifreq ifr;
    strncpy(ifr.ifr_name, g_iface, IFNAMSIZ - 1);
    ifr.ifr_name[IFNAMSIZ - 1] = '\0';

    if (ioctl(sock, SIOCGIFADDR, &ifr) == 0) {
        struct sockaddr_in *addr = (struct sockaddr_in *)&ifr.ifr_addr;
        strncpy(ip_buf, inet_ntoa(addr->sin_addr), buf_size - 1);
        ip_buf[buf_size - 1] = '\0';
        close(sock);
        return 0;
    }

    close(sock);

    // 方法2: 尝试从路由表或配置文件读取
    // 这里简化处理，尝试读取常见的 OpenWRT 网络状态
    FILE *fp = popen("uci get network.wan.ipaddr 2>/dev/null", "r");
    if (fp) {
        if (fgets(ip_buf, buf_size, fp) != NULL) {
            // 移除换行符
            size_t len = strlen(ip_buf);
            if (len > 0 && ip_buf[len - 1] == '\n') {
                ip_buf[len - 1] = '\0';
            }
            pclose(fp);
            return 0;
        }
        pclose(fp);
    }

    return -1;
}

// 获取 WAN IPv6 地址
static int get_wan6_ip(char *ip_buf, size_t buf_size)
{
    // 方法1: 通过读取 /proc/net/if_inet6 获取
    FILE *fp = fopen("/proc/net/if_inet6", "r");
    if (fp) {
        char line[256];
        while (fgets(line, sizeof(line), fp)) {
            // 格式: fe800000000000000202c9fffe5eea8d 02 40 20 80 eth0
            char addr[33], devname[16];
            unsigned int iface_idx, prefix_len, scope, dad_status;

            if (sscanf(line, "%32s %02x %02x %02x %02x %15s",
                       addr, &iface_idx, &prefix_len, &scope, &dad_status, devname) == 6) {
                // 检查是否是目标接口且有全局地址 (scope 00 = global)
                if (strcmp(devname, g_iface) == 0 && scope == 0) {
                    // 将 32 位十六进制字符串转换为标准 IPv6 格式
                    struct in6_addr in6;
                    char *ptr = addr;
                    for (int i = 0; i < 16; i++) {
                        unsigned int byte;
                        sscanf(ptr, "%2x", &byte);
                        in6.s6_addr[i] = (unsigned char)byte;
                        ptr += 2;
                    }
                    inet_ntop(AF_INET6, &in6, ip_buf, buf_size);
                    fclose(fp);
                    return 0;
                }
            }
        }
        fclose(fp);
    }

    // 方法2: 使用 ip 命令
    char cmd[128];
    snprintf(cmd, sizeof(cmd), "ip -6 addr show dev %s scope global 2>/dev/null | grep inet6 | head -1", g_iface);
    fp = popen(cmd, "r");
    if (fp) {
        char line[256];
        if (fgets(line, sizeof(line), fp)) {
            // 解析: inet6 2408:.../64 scope global dynamic
            char *inet6 = strstr(line, "inet6 ");
            if (inet6) {
                inet6 += 6;
                char *slash = strchr(inet6, '/');
                if (slash) *slash = '\0';
                strncpy(ip_buf, inet6, buf_size - 1);
                ip_buf[buf_size - 1] = '\0';
                pclose(fp);
                return 0;
            }
        }
        pclose(fp);
    }

    // 方法3: 尝试从 uci 获取
    fp = popen("uci get network.wan6.ip6addr 2>/dev/null || uci get network.wan.ip6addr 2>/dev/null", "r");
    if (fp) {
        if (fgets(ip_buf, buf_size, fp) != NULL) {
            size_t len = strlen(ip_buf);
            if (len > 0 && ip_buf[len - 1] == '\n') {
                ip_buf[len - 1] = '\0';
            }
            if (strlen(ip_buf) > 0) {
                pclose(fp);
                return 0;
            }
        }
        pclose(fp);
    }

    return -1;
}

// 获取 LAN IP 地址（br-lan 接口）
static int get_lan_ip(char *ip_buf, size_t buf_size)
{
    // 方法1: 尝试通过 ioctl 获取 br-lan 接口 IP
    int sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock < 0) {
        return -1;
    }

    struct ifreq ifr;
    strncpy(ifr.ifr_name, "br-lan", IFNAMSIZ - 1);
    ifr.ifr_name[IFNAMSIZ - 1] = '\0';

    if (ioctl(sock, SIOCGIFADDR, &ifr) == 0) {
        struct sockaddr_in *addr = (struct sockaddr_in *)&ifr.ifr_addr;
        strncpy(ip_buf, inet_ntoa(addr->sin_addr), buf_size - 1);
        ip_buf[buf_size - 1] = '\0';
        close(sock);
        return 0;
    }

    close(sock);
    return -1;
}

// 获取 LAN IPv6 地址
static int get_lan6_ip(char *ip_buf, size_t buf_size)
{
    // 方法1: 通过读取 /proc/net/if_inet6 获取 br-lan
    FILE *fp = fopen("/proc/net/if_inet6", "r");
    if (fp) {
        char line[256];
        while (fgets(line, sizeof(line), fp)) {
            char addr[33], devname[16];
            unsigned int iface_idx, prefix_len, scope, dad_status;

            if (sscanf(line, "%32s %02x %02x %02x %02x %15s",
                       addr, &iface_idx, &prefix_len, &scope, &dad_status, devname) == 6) {
                // 检查是否是 br-lan 且有全局地址 (scope 00 = global)
                if (strcmp(devname, "br-lan") == 0 && scope == 0) {
                    struct in6_addr in6;
                    char *ptr = addr;
                    for (int i = 0; i < 16; i++) {
                        unsigned int byte;
                        sscanf(ptr, "%2x", &byte);
                        in6.s6_addr[i] = (unsigned char)byte;
                        ptr += 2;
                    }
                    inet_ntop(AF_INET6, &in6, ip_buf, buf_size);
                    fclose(fp);
                    return 0;
                }
            }
        }
        fclose(fp);
    }

    // 方法2: 使用 ip 命令
    fp = popen("ip -6 addr show dev br-lan scope global 2>/dev/null | grep inet6 | head -1", "r");
    if (fp) {
        char line[256];
        if (fgets(line, sizeof(line), fp)) {
            char *inet6 = strstr(line, "inet6 ");
            if (inet6) {
                inet6 += 6;
                char *slash = strchr(inet6, '/');
                if (slash) *slash = '\0';
                strncpy(ip_buf, inet6, buf_size - 1);
                ip_buf[buf_size - 1] = '\0';
                pclose(fp);
                return 0;
            }
        }
        pclose(fp);
    }

    return -1;
}

int data_network_init(void)
{
    g_first_read = true;
    g_last_stats.rx_bytes = 0;
    g_last_stats.tx_bytes = 0;
    g_rx_speed = 0;
    g_tx_speed = 0;
    g_wan_ip_valid = false;
    g_wan6_ip_valid = false;
    g_lan_ip_valid = false;
    g_lan6_ip_valid = false;
    strncpy(g_wan_ip, "0.0.0.0", sizeof(g_wan_ip) - 1);
    strncpy(g_wan6_ip, "::", sizeof(g_wan6_ip) - 1);
    strncpy(g_lan_ip, "0.0.0.0", sizeof(g_lan_ip) - 1);
    strncpy(g_lan6_ip, "::", sizeof(g_lan6_ip) - 1);

    printf("[DataNetwork] Initialized, interface: %s\n", g_iface);

    // 立即获取一次网络数据，确保启动时显示正确
    data_network_update();

    return 0;
}

void data_network_deinit(void)
{
    printf("[DataNetwork] Deinitialized\n");
}

int data_network_update(void)
{
    net_stats_t current_stats;
    uint32_t now = get_tick_ms();

    // 读取接口统计
    if (read_proc_net_dev(g_iface, &current_stats) != 0) {
        // 尝试备用接口名
        if (strcmp(g_iface, "eth0") == 0) {
            if (read_proc_net_dev("wan", &current_stats) != 0) {
                return -1;
            }
        } else {
            return -1;
        }
    }

    // 计算速度
    if (!g_first_read) {
        uint32_t elapsed_ms = now - g_last_update_ms;
        if (elapsed_ms > 0) {
            // 转换为每秒字节数
            g_rx_speed = (uint64_t)((current_stats.rx_bytes - g_last_stats.rx_bytes) * 1000 / elapsed_ms);
            g_tx_speed = (uint64_t)((current_stats.tx_bytes - g_last_stats.tx_bytes) * 1000 / elapsed_ms);
        }
    } else {
        g_first_read = false;
        g_rx_speed = 0;
        g_tx_speed = 0;
    }

    g_last_stats = current_stats;
    g_last_update_ms = now;

    // 格式化速度并更新数据管理器
    char speed_str[32];

    // 下载速度
    format_speed(g_rx_speed, speed_str, sizeof(speed_str));
    char dl_str[64];
    snprintf(dl_str, sizeof(dl_str), "下载: %s", speed_str);
    data_manager_update(DATA_TYPE_DOWNLOAD_SPEED, dl_str, (uint32_t)g_rx_speed);

    // 上传速度
    format_speed(g_tx_speed, speed_str, sizeof(speed_str));
    char ul_str[64];
    snprintf(ul_str, sizeof(ul_str), "上传: %s", speed_str);
    data_manager_update(DATA_TYPE_UPLOAD_SPEED, ul_str, (uint32_t)g_tx_speed);

    // 更新 WAN IPv4（每次更新速度时也更新 IP，但 IP 变化不频繁）
    // 注意：获取失败时不清除已有 IP，避免显示闪烁
    char new_ip[32];
    if (get_wan_ip(new_ip, sizeof(new_ip)) == 0) {
        if (strcmp(new_ip, g_wan_ip) != 0 || !g_wan_ip_valid) {
            strncpy(g_wan_ip, new_ip, sizeof(g_wan_ip) - 1);
            g_wan_ip[sizeof(g_wan_ip) - 1] = '\0';
            g_wan_ip_valid = true;
        }
    }
    // 即使获取失败，如果之前有有效 IP，继续显示（不更新数据管理器）
    if (g_wan_ip_valid && strlen(g_wan_ip) > 0) {
        data_manager_update(DATA_TYPE_WAN_IP, g_wan_ip, 0);
    }

    // 更新 WAN IPv6
    char new_ip6[64];
    if (get_wan6_ip(new_ip6, sizeof(new_ip6)) == 0) {
        if (strcmp(new_ip6, g_wan6_ip) != 0 || !g_wan6_ip_valid) {
            strncpy(g_wan6_ip, new_ip6, sizeof(g_wan6_ip) - 1);
            g_wan6_ip[sizeof(g_wan6_ip) - 1] = '\0';
            g_wan6_ip_valid = true;
        }
    }
    // 即使获取失败，如果之前有有效 IPv6，继续显示
    if (g_wan6_ip_valid && strlen(g_wan6_ip) > 2) {
        data_manager_update(DATA_TYPE_WAN6_IP, g_wan6_ip, 0);
    }

    // 更新 LAN IPv4
    char new_lan_ip[32];
    if (get_lan_ip(new_lan_ip, sizeof(new_lan_ip)) == 0) {
        if (strcmp(new_lan_ip, g_lan_ip) != 0 || !g_lan_ip_valid) {
            strncpy(g_lan_ip, new_lan_ip, sizeof(g_lan_ip) - 1);
            g_lan_ip[sizeof(g_lan_ip) - 1] = '\0';
            g_lan_ip_valid = true;
        }
    }
    if (g_lan_ip_valid && strlen(g_lan_ip) > 0) {
        data_manager_update(DATA_TYPE_LAN_IP, g_lan_ip, 0);
    }

    // 更新 LAN IPv6
    char new_lan6_ip[64];
    if (get_lan6_ip(new_lan6_ip, sizeof(new_lan6_ip)) == 0) {
        if (strcmp(new_lan6_ip, g_lan6_ip) != 0 || !g_lan6_ip_valid) {
            strncpy(g_lan6_ip, new_lan6_ip, sizeof(g_lan6_ip) - 1);
            g_lan6_ip[sizeof(g_lan6_ip) - 1] = '\0';
            g_lan6_ip_valid = true;
        }
    }
    if (g_lan6_ip_valid && strlen(g_lan6_ip) > 2) {
        data_manager_update(DATA_TYPE_LAN6_IP, g_lan6_ip, 0);
    }

    return 0;
}

void data_network_set_interface(const char *iface)
{
    if (iface && *iface) {
        strncpy(g_iface, iface, sizeof(g_iface) - 1);
        g_iface[sizeof(g_iface) - 1] = '\0';
        g_first_read = true;  // 重置，下次重新计算速度
    }
}

const char *data_network_get_wan_ip(void)
{
    return g_wan_ip_valid ? g_wan_ip : NULL;
}

const char *data_network_get_wan6_ip(void)
{
    return g_wan6_ip_valid ? g_wan6_ip : NULL;
}

const char *data_network_get_lan_ip(void)
{
    return g_lan_ip_valid ? g_lan_ip : NULL;
}

const char *data_network_get_lan6_ip(void)
{
    return g_lan6_ip_valid ? g_lan6_ip : NULL;
}
