# Agent Link 开发文档

## 项目结构

```
agent-link/
├── backend/           # Cloudflare Workers 信令服务
│   ├── src/
│   │   ├── index.ts       # 主入口
│   │   ├── session.ts     # 会话管理
│   │   ├── websocket.ts   # WebSocket 处理
│   │   └── crypto.ts      # 加密辅助
│   ├── wrangler.toml
│   └── package.json
│
├── skill/             # OpenClaw Skill 客户端
│   ├── src/
│   │   ├── index.ts       # Skill 主逻辑
│   │   ├── crypto.ts      # X25519 + AES-256-GCM
│   │   ├── session.ts     # 会话管理
│   │   └── ui.ts          # 状态卡片渲染
│   ├── SKILL.md
│   └── package.json
│
├── website/           # 短链接引导页面
│   ├── index.html
│   ├── styles.css
│   └── script.js
│
├── docs/              # 产品文档
│   ├── mvp-v1-final.md
│   ├── product-complete.md
│   ├── tech-arch.md
│   ├── interaction-details.md
│   └── decisions.md
│
├── scripts/           # 工具脚本
│   ├── test-e2e.sh
│   └── deploy.sh
│
├── DEPLOYMENT.md      # 部署指南
├── TESTING.md         # 测试方案
└── README.md          # 项目总览
```

## 开发工作流

### 1. 本地开发

```bash
# 克隆项目
git clone <repo-url>
cd agent-link

# 安装所有依赖
npm run install:all

# 启动本地开发环境
npm run dev
```

### 2. 后端开发

```bash
cd backend

# 本地开发（使用 wrangler dev）
npm run dev

# 测试 API
curl http://localhost:8787/api/session/create \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"participantId": "test"}'

# 部署到预览环境
npm run deploy:staging

# 部署到生产
npm run deploy:prod
```

### 3. Skill 开发

```bash
cd skill

# 构建
npm run build

# 本地测试（链接到 OpenClaw）
npm run link

# 发布
npm run publish
```

### 4. 前端开发

```bash
cd website

# 本地预览
npx serve .

# 部署到 Cloudflare Pages
npm run deploy
```

## 代码规范

### TypeScript
- 严格模式开启
- 显式返回类型
- 禁用 `any`

### 命名规范
- 文件：kebab-case.ts
- 类：PascalCase
- 函数/变量：camelCase
- 常量：SCREAMING_SNAKE_CASE

### 注释规范
```typescript
/**
 * 创建新会话
 * @param participantId - 参与者 ID
 * @returns 会话信息，包含连接码
 * @throws 当参与者已在其他会话中时
 */
async function createSession(participantId: string): Promise<SessionInfo>
```

## 提交规范

```
feat: 添加 WebSocket 重连机制
fix: 修复连接码过期判断错误
docs: 更新部署文档
refactor: 优化加密模块性能
test: 添加端到端测试
chore: 更新依赖版本
```

## 分支策略

```
main        - 生产分支
develop     - 开发分支
feature/*   - 功能分支
hotfix/*    - 紧急修复
release/*   - 发布分支
```

## 发布流程

1. 更新版本号
```bash
npm version patch|minor|major
```

2. 更新 CHANGELOG.md

3. 创建发布 PR

4. 合并到 main

5. 自动部署

## 调试技巧

### 后端调试
```bash
# 查看实时日志
npx wrangler tail

# 本地断点调试
npm run dev -- --inspect
```

### Skill 调试
```bash
# 开启详细日志
DEBUG=agent-link:* npm run dev
```

### WebSocket 调试
```bash
# 使用 wscat
npx wscat -c ws://localhost:8787/api/session/TEST/ws
```

## 常见问题

### Q: 连接码生成冲突？
A: 使用 Durable Objects 保证唯一性，冲突时重试。

### Q: WebSocket 连接不稳定？
A: 实现心跳机制和自动重连，指数退避策略。

### Q: 加密性能问题？
A: Web Crypto API 是异步的，使用 Promise.all 并行处理。

## 性能优化

### 后端
- 使用 Durable Objects 状态缓存
- 批量处理消息
- 连接池管理

### Skill
- 懒加载加密模块
- 本地存储压缩
- 消息队列批处理

## 安全最佳实践

1. **密钥管理**
   - 永不硬编码密钥
   - 使用环境变量
   - 定期轮换

2. **输入验证**
   - 所有输入都验证
   - 使用 Zod 等 schema 验证

3. **日志脱敏**
   - 不记录敏感信息
   - 连接码部分掩码

4. **速率限制**
   - API 端点限流
   - WebSocket 连接限流

## 监控指标

| 指标 | 告警阈值 |
|-----|---------|
| 错误率 | > 1% |
| 平均延迟 | > 500ms |
| 活跃会话数 | > 10000 |
| WebSocket 断连率 | > 5% |

## 联系

- 技术问题：创建 GitHub Issue
- 安全漏洞：security@openclaw.ai
- 一般讨论：Discord #agent-link

---

*最后更新：2026-03-07*