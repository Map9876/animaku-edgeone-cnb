# Cloudflare Tunnel + EdgeOne 加速部署指南（实测完整版）

> 2026-11-20 全链路实测。解决两个核心问题：
> ① 没有公网 IP / 域名不想绑信用卡，如何稳定暴露本地/内网服务；
> ② 国内访问慢，如何用 EdgeOne 给 CF 域名加速。
>
> 破除两个误解：**绑定固定域名不需要信用卡**；**WebSocket 经 EO 不会加速（但能用）**。

---

## 一、Cloudflare Tunnel（cloudflared）：零信用卡、固定域名、内网穿透

### 1.1 这是什么

Cloudflare Tunnel（cloudflared）让**没有公网 IP 的内网/本机服务**主动外连到 Cloudflare，
对外暴露一个**固定域名**。不需要公网 IP、不开端口、不配防火墙、不绑信用卡。

### 1.2 关键操作入口

- Cloudflare Dashboard → Zero Trust → Networks → Tunnels：
  `https://dash.cloudflare.com/?to=/:account/tunnels`
- 在这个页面：
  1. 创建一个 Tunnel
  2. **Public Hostname** 里把域名绑定到本机服务（如 `http://localhost:8887`）
  3. 网页会给出一条**带个人 token 的 `cloudflared tunnel run --token ...` 命令**

### 1.3 复制命令到本机启动

网页给的命令形如：
```sh
# 1) 安装 cloudflared（Debian/Ubuntu）
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install cloudflared

# 2) 运行（token 复制自网页，属于个人凭据）
cloudflared tunnel run --token <你的个人token>
```

启动后看日志出现 `Registered tunnel connection connIndex=...` 即成功。
域名格式：`<子域>.<你的域>`，由 Public Hostname 配置决定。

### 1.4 关键坑（实测）

- **Public Hostname 的 Service 必须写 `http://localhost:PORT`**（服务是纯 HTTP 时）。
  写成 `https://` 会 502：cloudflared 发 TLS 握手，本地 HTTP 服务回的不是 TLS →
  `first record does not look like a TLS handshake`。
- token 模式 tunnel 是**远程管理**（ingress 配置在云端，本地改不了）。
  所以回源协议要在网页 Public Hostname 里改，不能靠本地 `--no-tls-verify` 解决。
- token 是长期凭据，**不要在聊天/代码/公开仓库里明文贴**；用环境变量管理。

### 1.5 本项目用法

`new-anime-webhook` 服务跑在 CNB 云开发环境（无公网 IP），通过 cloudflared tunnel 暴露到：
`new-anime-webhook.map987.dpdns.org` → `http://localhost:8887`。
token 从 CNB 环境变量 `CLOUDFLARE_TUNNEL_TOKEN` 读（`scripts/start.sh`）。

---

## 二、EdgeOne 加速：给 CF 域名套一层国内 CDN

### 2.1 解决什么

Cloudflare 在国内访问有时慢/不稳。EdgeOne（EO）国内节点多，可以：
- 国内用户走 EO 节点 → EO 回源到 CF 域名 → CF tunnel → 真服务
- 静态资源（图片/JS/CSS）就近缓存，速度快

### 2.2 操作步骤（EO 国际版）

入口：`https://console.tencentcloud.com/edgeone/zones/detail/<你的zone>/acceleration/global-setting`

1. EO 站点绑定你的根域（如 `map987.dpdns.org`），完成 TXT 归属验证
2. **新增加速域名**：`anime-push.map987.dpdns.org`（一个空子域名，作为 EO 入口，本身不部署服务）
3. EO 会要求加 CNAME 记录（加在**权威 DNS 所在处**，本项目是 Cloudflare）：
   ```
   类型 CNAME  名称 anime-push  值 anime-push.map987.dpdns.org.eo.dnse5.com
   代理状态：仅 DNS（灰云，proxied=false）← 必须！橙云会让 CF 拦截、EO 失效
   ```
   EO 还会给 TXT 验证记录，同样加到 CF DNS。
4. **源站配置**：
   - 源站类型：源站域名
   - 源站地址：`new-anime-webhook.map987.dpdns.org`（CF tunnel 域名，真正的服务）
   - 回源协议：**HTTPS**，端口 **443**
   - 回源 HOST：**使用源站域名**（即 `new-anime-webhook.map987.dpdns.org`，不能填加速域名——CF ingress 按 hostname 匹配）
5. 等待 EO 自动签发 `anime-push` 的 HTTPS 证书（约 10-15 分钟）
6. **开启 WebSocket**：站点加速 → 网络优化 → WebSocket 开关（免费版默认关闭）

### 2.3 DNS 关键认知

`map987.dpdns.org` 的权威 DNS 在 **Cloudflare**（NS: hal/daisy.ns.cloudflare.com），
所以 EO 要求的 CNAME/TXT 都要加到 **Cloudflare DNS**，不是 EO。
用 CF API 加记录时 `proxied=false`（灰云）——这是 fis.ink 那篇的核心警告。

### 2.4 WebSocket 的真相（重要）

- **EO 的 WebSocket 不会加速**：WS 是长连接实时推送，CDN 缓存对它无效。
  EO 的价值是"回源链路优化 + 国内可达"，不是缓存 WS 数据。
- EO 免费版 WebSocket 有 **5 分钟空闲超时**（无数据收发就断开）→ 服务端必须加心跳（本项目 60 秒 ping）。
- 那些缓存配置/TTL/查询字符串/图片缩放/离线缓存选项，对 WS 服务**基本无关**；
  真正相关的是 WebSocket 开关、（付费的）智能加速。

### 2.5 验证结果（实测）

| 项 | 结果 |
|---|---|
| CNAME 加进 CF DNS（灰云）| ✅ 解析到 EO IP |
| EO HTTP `/api/health` | ✅ 200，`EO-LOG-UUID`+`EO-Cache-Status:MISS`+`Server:cloudflare` |
| EO WS 握手（开 WebSocket 开关后）| ✅ 101 + `Sec-WebSocket-Accept`，浏览器收到 `snapshot` |
| WS 60秒心跳防 5分钟超时 | ✅ 70秒后连接仍 OPEN |
| HTTPS 证书 | ⏳ 等 EO 自动签发（10-15分钟）|

---

## 三、架构总览

```
用户浏览器
  ├─ HTTP API: https://anime-push.map987.dpdns.org  → EdgeOne（国内加速/缓存静态）→ 回源 CF 域名
  └─ WebSocket: wss://new-anime-webhook.map987.dpdns.org → CF 直连（WS 不走 EO，无缓存价值）

                            ↓ 回源
        new-anime-webhook.map987.dpdns.org (CF Tunnel 固定域名)
                            ↓ cloudflared
        CNB 开发环境内 new-anime-webhook 服务 (localhost:8887)
```

## 四、参考文章

- fis.ink `https://blog.fis.ink/posts/1/`：EO 加速 CF 内网穿透（灰云、不同子域名警告）
- catcat `https://catcat.blog/2026/08/edgeone-cloudflare-geo-split-cdn`：EO+CF 分地区 CDN（回源 HOST/SNI 坑）
- antwen：R2+EO vs ESA 下载实测
