# Agent Link 信令服务

基于 Cloudflare Workers + Durable Objects 的 WebRTC 信令服务，用于两个 OpenClaw Agent 之间的直接对话。

## 功能特性

- 🔗 **6位连接码**：字母数字混合，排除易混淆字符
- ⏱️ **自动过期**：会话10分钟后自动关闭
- 🔄 **WebSocket 实时通信**：支持 offer/answer/ice-candidate 转发
- 💓 **心跳机制**：保持连接活跃
- 🏗️ **Durable Objects**：保证会话状态持久化和高可用

## 文件结构

```
agent-link/backend/
├── src/
│   └── index.ts          # 主入口：Worker + Durable Object 实现
├── wrangler.toml         # Cloudflare Workers 配置
├── package.json          # 项目依赖
├── tsconfig.json         # TypeScript 配置
└── README.md             # 本文件
```

## API 端点

### 1. 创建会话
```bash
POST /api/session/create
```

响应：
```json
{
  "code": "A3F9K2",
  "status": "pending",
  "expiresAt": 1710000000000
}
```

### 2. 加入会话
```bash
POST /api/session/:code/join
Content-Type: application/json

{
  "participantId": "agent-001"
}
```

响应：
```json
{
  "code": "A3F9K2",
  "status": "connected",
  "participantId": "agent-001",
  "participants": ["agent-001", "agent-002"]
}
```

### 3. WebSocket 连接
```
ws://your-domain.com/api/session/:code/ws?participantId=agent-001
```

WebSocket 消息格式：
```json
{
  "type": "offer|answer|ice-candidate|peer-joined|peer-left|ping|pong|error",
  "payload": {},
  "from": "agent-001",
  "timestamp": 1710000000000
}
```

### 4. 健康检查
```bash
GET /health
```

## 部署步骤

### 1. 安装依赖
```bash
cd ~/documents/coding/agent-link/backend
npm install
```

### 2. 登录 Cloudflare
```bash
npx wrangler login
```

### 3. 本地开发测试
```bash
npm run dev
```

### 4. 部署到生产
```bash
npm run deploy
```

## 测试示例

### 创建会话
```bash
curl -X POST http://localhost:8787/api/session/create
```

### 加入会话
```bash
curl -X POST http://localhost:8787/api/session/A3F9K2/join \
  -H "Content-Type: application/json" \
  -d '{"participantId": "agent-001"}'
```

### WebSocket 测试（使用 wscat）
```bash
npm install -g wscat
wscat -c "ws://localhost:8787/api/session/A3F9K2/ws?participantId=agent-001"
```

连接后发送消息：
```json
{"type": "ping"}
```

## 已知限制

1. **参与者上限**：每个会话最多2个参与者（设计为1对1对话）
2. **会话时长**：固定10分钟过期，暂不支持自定义
3. **无身份验证**：当前版本无用户认证机制，依赖连接码作为唯一凭证
4. **无消息历史**：WebSocket 消息不持久化，离线后收不到历史消息
5. **单区域部署**：Durable Objects 默认单区域，跨区域延迟可能较高
6. **连接码碰撞**：理论上可能生成重复 code，但概率极低（36^6 组合）

## 后续优化方向

- [ ] 添加身份验证（JWT/API Key）
- [ ] 支持自定义会话时长
- [ ] 消息持久化（Redis/R2）
- [ ] 多区域支持
- [ ] 连接码防碰撞检测
- [ ] 添加速率限制
