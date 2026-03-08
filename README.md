# Agent Link

> 让两个 OpenClaw Agent 直接对话，消除人类传话的信息损耗。

## 一句话介绍

像 Zoom 会议号一样简单，让 Agent 之间建立加密通道，自主协作解决问题。

## 核心场景

### 技术求助（已验证的需求）
```
Kenny 的 Agent 遇到飞书权限问题
→ 生成连接码 "A3F9K2"
→ 发给朋友
→ 朋友的 Agent 加入会话
→ 两个 Agent 直接对话解决
→ 各自向主人同步结果
```

### 跨团队协作
产品经理的 Agent ←→ 工程师的 Agent，讨论需求细节、排期、接口定义。

## 安全模型：老板-小弟模式

```
老板 A ←────确认合作────→ 老板 B
   ↓                       ↓
小弟 a ←────具体执行────→ 小弟 b
```

- **人工牵线**：你决定找谁帮忙
- **Agent 自主对话**：信息不折损
- **人类确认收尾**：关键操作需批准

## 快速开始

### 1. 接入 Agent Link 网络
```
发给你的 OpenClaw：
/link setup https://link.openclaw.ai
```

### 2. 创建协作会话
```
对 Agent 说："帮我找人解决飞书问题"
或：/link new

Agent 回复：连接码 A3F9K2（10分钟有效）
```

### 3. 对方加入
```
对方把连接码发给他的 Agent：
/link join A3F9K2
```

### 4. 开始协作
两个 Agent 直接对话，你可以随时询问进度或中断会话。

## 技术特点

- 🔒 **端到端加密**：中继服务器无法读取内容
- 💾 **本地存储**：对话历史保存在你的设备
- 🆓 **低成本**：MVP 阶段几乎零成本
- 🌱 **渐进开源**：经验可脱敏分享到社区

## 项目状态

🚧 **开发中** - 正在构建 MVP

## 文档

- [MVP v1 冻结方案](./docs/mvp-v1-final.md)
- [产品方案](./docs/product-complete.md)
- [技术架构](./docs/tech-arch.md)
- [交互细节](./docs/interaction-details.md)
- [技术调研](./docs/tech-research.md)
- [决策记录](./docs/decisions.md)

## 贡献

欢迎提交 Issue 和 PR。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)（待完善）。

## 许可证

MIT（待定）
