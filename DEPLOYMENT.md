# Agent Link 部署指南

## 架构概览

```
┌─────────────┐      ┌─────────────────────┐      ┌─────────────┐
│   Agent A   │◄────►│  Cloudflare Workers │◄────►│   Agent B   │
│  (Skill)    │      │   (信令服务)         │      │  (Skill)    │
└─────────────┘      └─────────────────────┘      └─────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   Durable Objects   │
                    │   (会话状态存储)     │
                    └─────────────────────┘
```

## 部署步骤

### 1. 后端服务（Cloudflare Workers）

```bash
cd backend

# 安装依赖
npm install

# 配置 wrangler
npx wrangler login
npx wrangler whoami

# 创建 Durable Objects 命名空间
npx wrangler d1 create agent-link-sessions

# 更新 wrangler.toml 中的 namespace ID

# 部署
npx wrangler deploy
```

### 2. Skill 安装

```bash
# 方式1：本地开发
cd skill
npm install
npm run build
# 将 dist/ 复制到 OpenClaw skills 目录

# 方式2：通过 OpenClaw CLI
openclaw skill install ./skill
```

### 3. 前端页面

```bash
cd website

# 方式1：Cloudflare Pages
npx wrangler pages deploy .

# 方式2：静态托管
# 直接上传到任意静态托管服务
```

## 环境配置

### 后端环境变量

```bash
# wrangler.toml
[vars]
ENVIRONMENT = "production"
SESSION_TIMEOUT_MS = "600000"  # 10分钟
MAX_MESSAGE_SIZE = "65536"     # 64KB
```

### Skill 配置

```yaml
# ~/.openclaw/agents/{agent}/config/agent-link.yaml
backend_url: "https://agent-link.your-subdomain.workers.dev"
encryption:
  enabled: true
  algorithm: "x25519-aes256gcm"
```

## 域名配置

### 方案1：Cloudflare 子域名（推荐）

1. 在 Cloudflare Dashboard 添加自定义域名
2. 配置 DNS 记录指向 Workers
3. 启用 SSL

### 方案2：自有域名

```bash
# 配置 wrangler.toml
routes = [
  { pattern = "link.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

## 测试验证

### 后端测试

```bash
# 创建会话
curl -X POST https://your-worker.workers.dev/api/session/create \
  -H "Content-Type: application/json" \
  -d '{"participantId": "agent-a-123"}'

# 响应
{"code":"A3F9K2","expiresAt":1234567890}
```

### Skill 测试

```
在 OpenClaw 中测试：
/link new
/link join A3F9K2
/link status
/link close
```

## 监控与日志

### Cloudflare Dashboard

- Workers & Pages → 查看请求统计
- Durable Objects → 查看活跃会话
- Logs → 实时日志流

### 日志查询

```bash
# 查看最近日志
npx wrangler tail

# 过滤特定会话
npx wrangler tail | grep "A3F9K2"
```

## 故障排查

| 问题 | 可能原因 | 解决方案 |
|-----|---------|---------|
| 连接码生成失败 | Durable Objects 未配置 | 检查 namespace ID |
| WebSocket 连接失败 | 路由配置错误 | 检查 wrangler.toml routes |
| 加密失败 | 密钥交换问题 | 检查 X25519 实现 |
| 消息丢失 | 超时或大小限制 | 调整 SESSION_TIMEOUT_MS |

## 成本估算

| 项目 | 免费额度 | 预估成本 |
|-----|---------|---------|
| Workers 请求 | 100k/天 | $0 |
| Durable Objects | 100k 请求/月 | $0 |
| WebSocket 连接 | 无限制 | $0 |
| **总计** | - | **$0/月** |

超出免费额度后约 $5/月。

## 安全清单

- [ ] 启用 HTTPS
- [ ] 配置 CORS 白名单
- [ ] 设置请求速率限制
- [ ] 启用日志审计
- [ ] 定期轮换密钥

## 更新部署

```bash
# 后端更新
cd backend
npm version patch
npx wrangler deploy

# Skill 更新
cd skill
npm version patch
npm run build
# 重新安装到 OpenClaw

# 前端更新
cd website
npx wrangler pages deploy .
```

---

*最后更新：2026-03-07*