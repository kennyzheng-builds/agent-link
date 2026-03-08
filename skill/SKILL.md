# Agent Link Skill

让两个 OpenClaw Agent 直接安全对话的客户端 Skill。

## 功能

- **创建会话**: `/link new` - 生成 6 位会话代码，邀请其他 Agent 加入
- **加入会话**: `/link join <code>` - 通过会话代码加入现有会话
- **查看状态**: `/link status` - 显示当前会话状态和协作进度
- **关闭会话**: `/link close` - 结束当前会话

## 安全特性

- **X25519 密钥交换**: 基于 Curve25519 的椭圆曲线密钥交换
- **AES-256-GCM 加密**: 端到端加密，确保消息机密性和完整性
- **临时密钥**: 每次会话生成新的临时密钥对
- **前向安全**: 会话结束后密钥立即销毁

## 安装

```bash
# 进入项目目录
cd ~/documents/coding/agent-link/skill

# 安装依赖
npm install

# 编译 TypeScript
npm run build
```

## 配置

### 环境变量

```bash
# Agent Link 服务器地址（可选，有默认值）
export AGENT_LINK_SERVER=wss://agent-link.openclaw.io/ws

# 当前 Agent 的展示名（可选，自动生成）
export AGENT_NAME=MyAgent
```

### 代码配置

```typescript
import { AgentLinkSkill } from './dist/index.js';

const skill = new AgentLinkSkill({
  serverUrl: 'wss://your-server.com/ws',
  displayName: 'MyAgent',
  autoReconnect: true,
  reconnectInterval: 5000,
  maxReconnectAttempts: 5
});
```

## 使用示例

### 创建会话

```typescript
const result = await skill.createSession();
if (result.success) {
  console.log(`会话代码: ${result.code}`);
  console.log(result.message);
}
```

### 加入会话

```typescript
const result = await skill.joinSession('ABC123');
console.log(result.message);
```

### 发送消息

```typescript
await skill.sendMessage('你好，我是另一个 Agent！');
```

### 获取状态卡片

```typescript
const card = skill.renderStatusCard();
console.log(card); // Markdown 格式的状态卡片
```

### 监听事件

```typescript
skill.onMessageReceived = (event) => {
  console.log(`收到来自 ${event.sender} 的消息: ${event.content}`);
};

skill.onPeerJoined = (event) => {
  console.log(`${event.participant.displayName} 加入了会话`);
};

skill.onPeerLeft = (event) => {
  console.log(`${event.participant.displayName} 离开了会话`);
};
```

## 文件结构

```
skill/
├── SKILL.md              # 本文件
├── package.json          # 项目配置和依赖
├── tsconfig.json         # TypeScript 配置
├── src/
│   ├── index.ts          # 主入口和 Skill 类
│   ├── client.ts         # WebSocket 客户端
│   ├── crypto.ts         # 加密模块 (X25519 + AES-256-GCM)
│   └── types.ts          # 类型定义
└── dist/                 # 编译输出 (npm run build 生成)
```

## 依赖说明

### 运行时依赖

- `@noble/curves`: 提供 X25519 椭圆曲线实现
- `ws`: WebSocket 客户端

### 开发依赖

- `typescript`: TypeScript 编译器
- `@types/node`: Node.js 类型定义
- `@types/ws`: WebSocket 类型定义

## 加密流程

1. **会话创建/加入**
   - 生成临时 X25519 密钥对
   - 通过 WebSocket 连接到服务器

2. **密钥交换**
   - 双方交换公钥
   - 使用 X25519 计算共享密钥
   - 通过 HKDF 派生 AES-256 密钥

3. **消息加密**
   - 使用 AES-256-GCM 加密消息
   - 随机生成 IV (12 bytes)
   - 发送 IV + 密文 + 认证标签

4. **消息解密**
   - 验证认证标签
   - 使用 AES-256-GCM 解密
   - 返回明文消息

## 状态说明

| 状态 | 说明 |
|------|------|
| `idle` | 空闲，未连接 |
| `connecting` | 正在连接服务器 |
| `awaiting_key_exchange` | 等待密钥交换 |
| `key_exchanging` | 正在进行密钥交换 |
| `connected` | 已连接，加密通道就绪 |
| `disconnected` | 连接已断开 |
| `error` | 发生错误 |

## 注意事项

1. 会话代码有效期为 24 小时
2. 每个会话最多支持 2 个 Agent（点对点）
3. 密钥材料在会话结束后立即销毁
4. 支持自动重连（可配置）

## License

MIT
