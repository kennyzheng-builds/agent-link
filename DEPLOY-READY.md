# Agent Link 部署准备清单

> 生成时间：2026-03-07  
> 状态：代码已完成，准备部署

---

## ✅ 代码完成度

### Backend (Cloudflare Workers)
- [x] Durable Objects 会话管理
- [x] WebSocket 消息转发
- [x] 连接码生成/验证
- [x] 自动过期处理
- [x] 健康检查端点
- [x] TypeScript 类型完整
- [x] 依赖已安装

### Skill (OpenClaw Client)
- [x] Skill 主类
- [x] WebSocket 客户端
- [x] X25519 密钥交换
- [x] AES-256-GCM 加密
- [x] 状态管理
- [x] 事件系统
- [x] 状态卡片渲染
- [x] TypeScript 编译输出

### Website (引导页面)
- [x] HTML 结构
- [x] CSS 样式（温暖人文风）
- [x] 一键复制功能
- [x] URL 解析连接码
- [x] 二维码生成
- [x] 响应式设计
- [x] 暗色模式支持

---

## 🚀 快速部署步骤

### 1. 部署后端

```bash
cd ~/documents/coding/agent-link/backend

# 登录 Cloudflare
npx wrangler login

# 部署到开发环境
npx wrangler deploy --env dev

# 或部署到生产环境
npx wrangler deploy --env production
```

**部署后记录**：
- Worker URL: `https://agent-link-signaling.your-account.workers.dev`
- 更新 Skill 配置中的 `serverUrl`

### 2. 部署前端

**方案 A: Cloudflare Pages**
```bash
cd ~/documents/coding/agent-link/website

# 部署
npx wrangler pages deploy . --project-name=agent-link
```

**方案 B: Vercel**
```bash
cd ~/documents/coding/agent-link/website

# 安装 Vercel CLI
npm i -g vercel

# 部署
vercel --prod
```

**部署后记录**：
- 网站 URL: `https://link.yourdomain.com`
- 配置自定义域名

### 3. 安装 Skill

```bash
cd ~/documents/coding/agent-link/skill

# 构建
npm run build

# 复制到 OpenClaw skills 目录
cp -r dist ~/.openclaw/agents/{your-agent}/skills/agent-link/

# 或创建符号链接
ln -s ~/documents/coding/agent-link/skill/dist \
  ~/.openclaw/agents/{your-agent}/skills/agent-link
```

---

## 🧪 部署验证

### 测试后端
```bash
# 1. 健康检查
curl https://your-worker.workers.dev/health

# 2. 创建会话
curl -X POST https://your-worker.workers.dev/api/session/create

# 3. WebSocket 测试
wscat -c "wss://your-worker.workers.dev/api/session/TEST/ws?participantId=test"
```

### 测试前端
- 访问 `https://link.yourdomain.com/j/A3F9K2`
- 验证页面显示正常
- 测试一键复制功能
- 验证二维码生成

### 测试 Skill
```
在 OpenClaw 中：
/link new
/link join A3F9K2
/link status
/link close
```

---

## ⚙️ 配置更新

### Skill 配置
编辑 `skill/dist/config.js` 或环境变量：
```javascript
export const config = {
  serverUrl: 'wss://agent-link-signaling.your-account.workers.dev',
  displayName: 'MyAgent',
  autoReconnect: true,
  reconnectInterval: 5000,
  maxReconnectAttempts: 5
};
```

### 前端配置
编辑 `website/script.js`：
```javascript
const CONFIG = {
  apiBaseUrl: 'https://agent-link-signaling.your-account.workers.dev',
  defaultHost: 'Agent'
};
```

---

## 📋 部署检查清单

- [ ] Cloudflare 账户已登录
- [ ] Worker 部署成功
- [ ] Durable Objects 绑定正确
- [ ] Pages 站点部署成功
- [ ] 自定义域名配置完成
- [ ] Skill 构建成功
- [ ] Skill 安装到 OpenClaw
- [ ] 端到端测试通过
- [ ] 文档已更新

---

## 🐛 常见问题

### 后端部署失败
```
错误：Durable Objects 未找到
解决：确保 wrangler.toml 中 migrations 配置正确
```

### WebSocket 连接失败
```
错误：无法连接到 wss://...
解决：检查 Worker URL 是否正确，是否使用 wss:// 协议
```

### Skill 无法加载
```
错误：模块找不到
解决：确保 dist/ 目录存在且包含编译后的 .js 文件
```

---

## 📞 支持

- 技术问题：查看 `docs/` 目录
- 部署问题：查看 `DEPLOYMENT.md`
- 测试问题：查看 `TESTING.md`

---

**准备就绪，可以开始部署！** 🚀