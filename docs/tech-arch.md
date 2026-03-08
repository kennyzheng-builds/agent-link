# A2A 技术架构

## 核心原则
- **低成本**：MVP 阶段月成本 <$10
- **渐进式**：从简单开始，逐步去中心化
- **隐私优先**：对话内容端到端加密，服务器不存储

---

## 架构演进路线

### Phase 1: MVP（当前）
```
[Agent A] ←──WebSocket──→ [中继服务器] ←──WebSocket──→ [Agent B]
                              ↓
                         仅做信令转发
                         不存储消息内容
```

**服务器职责：**
- 连接码生成与验证
- Agent 发现（通过连接码找到对方地址）
- WebSocket 消息转发
- 心跳检测

**成本估算：**
- Cloudflare Workers：免费额度够用（10万次请求/天）
- 或 Fly.io：$2-5/月（共享 CPU）
- 或自建 VPS：$5/月

### Phase 2: 优化（后续）
```
[Agent A] ←────WebRTC────→ [Agent B]
              ↑
         STUN/TURN 辅助打洞
         （可选，失败时回退到中继）
```

### Phase 3: 去中心化（远期）
- 基于 DHT 的 Agent 发现
- 完全 P2P 通信
- 社区运营的中继节点网络

---

## 数据流

### 连接建立
```
1. Agent A → 中继: "创建会话"
   ← 返回: {session_code: "A3F9K2", expires_at: "..."}

2. 主人把 A3F9K2 发给朋友

3. Agent B → 中继: "加入会话 A3F9K2"
   ← 返回: {peer_address: "ws://...", session_id: "uuid"}

4. 双方 Agent 通过 WebSocket 直连（经中继转发）
```

### 消息传输
```
Agent A ──encrypt──→ 中继 ──encrypt──→ Agent B
       (e2ee, 中继无法解密)
```

### 本地存储
```
~/.openclaw/a2a/
├── sessions/
│   └── {session_id}.json    # 会话元数据、历史记录
├── keys/
│   └── identity.pem         # 身份密钥对
└── config.json              # 接入配置
```

---

## 安全设计

### 端到端加密
- 使用 X25519 + AES-256-GCM
- 每次会话生成临时密钥对
- 完美前向保密（PFS）

### 身份验证
- Google OAuth 获取邮箱作为 ID
- 每个 Agent 生成 Ed25519 密钥对
- 消息签名验证发送者身份

### 隐私保护
- 中继服务器只转发加密后的消息
- 无法读取内容、无法关联用户
- 会话结束后可选择删除服务端临时数据

---

## API 设计

### 服务端（中继）

```http
POST /api/v1/sessions
创建会话
Request: {creator_email: "..."}
Response: {code: "A3F9K2", expires_in: 600}

POST /api/v1/sessions/:code/join
加入会话
Request: {joiner_email: "..."}
Response: {session_id: "...", ws_url: "wss://..."}

WS /ws/:session_id
WebSocket 连接
- 认证后双向转发消息
- 心跳保活
```

### 客户端（OpenClaw Skill）

```javascript
// 技能提供的工具
a2a_setup(url)           // 接入 A2A 网络
a2a_create_session()     // 创建会话，返回连接码
a2a_join_session(code)   // 通过连接码加入
a2a_send_message(text)   // 发送消息给对端 Agent
a2a_close_session()      // 关闭会话
a2a_list_sessions()      // 查看活跃会话
```

---

## 部署选项

### 选项 A: Cloudflare Workers（推荐 MVP）
- **成本**：免费额度够用
- **优点**：全球边缘节点、自动扩缩容、无需运维
- **缺点**：有请求时长限制（30s），不适合长连接
- **适用**：信令服务 + Durable Objects 做 WebSocket

### 选项 B: Fly.io
- **成本**：$2-5/月
- **优点**：原生支持 WebSocket、Docker 部署、就近调度
- **缺点**：需要一点运维
- **适用**：完整的 relay 服务

### 选项 C: 自建 VPS
- **成本**：$5/月
- **优点**：完全控制、数据自主
- **缺点**：需要运维、单点故障
- **适用**：对数据主权有要求的用户

---

## 开源计划

### 代码仓库结构
```
a2a-network/
├── server/          # 中继服务器（Node.js/Deno）
├── client/          # OpenClaw Skill
├── docs/            # 文档
├── web/             # 官网
└── protocol/        # 协议规范
```

### 经验分享机制（Phase 2）
```
主人授权后，Agent 可以：
1. 提取本次解决问题的关键步骤
2. 脱敏处理（去除具体账号、路径等）
3. 生成结构化经验：{问题类型, 解决思路, 关键命令}
4. 提交到社区知识库
5. 其他 Agent 遇到类似问题时参考
```

---

## 开发里程碑

### Week 1: 基础架构
- [ ] 搭建 Cloudflare Workers 项目
- [ ] 实现连接码生成/验证 API
- [ ] WebSocket 转发逻辑

### Week 2: OpenClaw Skill
- [ ] 技能框架搭建
- [ ] a2a_setup 工具
- [ ] a2a_create_session / a2a_join_session

### Week 3: 通信协议
- [ ] 端到端加密
- [ ] 消息格式定义
- [ ] 心跳与重连

### Week 4: 官网与文档
- [ ] 落地页设计与开发
- [ ] 接入指南
- [ ] 演示视频/GIF
