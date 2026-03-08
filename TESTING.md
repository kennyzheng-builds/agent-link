# Agent Link 测试方案

## 测试策略

### 单元测试
- 加密模块测试
- 连接码生成测试
- 状态机测试

### 集成测试
- 端到端会话建立
- 消息收发
- 异常处理

### 端到端测试
- 两个真实 Agent 对话
- 网络异常恢复
- 长时间会话稳定性

## 测试用例

### 1. 基础功能测试

#### TC-001: 创建会话
```
前置条件：Agent A 已接入
步骤：
1. Agent A 发送 "/link new"
预期结果：
- 返回 6 位连接码
- 连接码 10 分钟内有效
- 状态为 "pending"
```

#### TC-002: 加入会话
```
前置条件：会话已创建，Agent B 已接入
步骤：
1. Agent B 发送 "/link join {code}"
预期结果：
- 双方 Agent 建立连接
- 状态变为 "connected"
- 双方收到确认消息
```

#### TC-003: 消息收发
```
前置条件：会话已建立
步骤：
1. Agent A 发送测试消息
2. Agent B 回复测试消息
预期结果：
- 消息在 1 秒内到达
- 内容完整无损
- 加密正确（中间人无法解密）
```

### 2. 边界条件测试

#### TC-004: 连接码过期
```
前置条件：会话已创建
步骤：
1. 等待 10 分钟
2. Agent B 尝试加入
预期结果：
- 加入失败
- 提示 "连接码已过期"
- 原创建者收到通知
```

#### TC-005: 重复加入
```
前置条件：会话已有 2 个参与者
步骤：
1. Agent C 尝试加入
预期结果：
- 加入失败
- 提示 "会话已满"
```

#### TC-006: 大消息处理
```
前置条件：会话已建立
步骤：
1. 发送 100KB 文本
预期结果：
- 消息被截断或拒绝
- 提示 "消息过大"
```

### 3. 异常处理测试

#### TC-007: 网络中断恢复
```
前置条件：会话已建立
步骤：
1. 断开 Agent A 网络 30 秒
2. 恢复网络
预期结果：
- 自动重连
- 未送达消息补发
```

#### TC-008: 强制关闭
```
前置条件：会话进行中
步骤：
1. Agent A 发送 "/link close"
预期结果：
- 会话立即关闭
- 双方收到关闭通知
- 生成会话总结
```

### 4. 安全测试

#### TC-009: 加密验证
```
前置条件：会话已建立
步骤：
1. 抓包 WebSocket 流量
2. 尝试解密消息内容
预期结果：
- 无法解密（无前向保密密钥）
- 仅能读取密文
```

#### TC-010: 身份伪造
```
前置条件：会话已建立
步骤：
1. 使用伪造身份尝试加入
预期结果：
- 身份验证失败
- 连接被拒绝
```

## 自动化测试脚本

```bash
#!/bin/bash
# test-e2e.sh

set -e

BACKEND_URL="https://agent-link.your-subdomain.workers.dev"

echo "=== Agent Link E2E 测试 ==="

# 测试 1: 创建会话
echo "[TEST] 创建会话..."
RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/session/create" \
  -H "Content-Type: application/json" \
  -d '{"participantId": "test-agent-a"}')
CODE=$(echo $RESPONSE | jq -r '.code')
echo "  连接码: $CODE"

# 测试 2: 加入会话
echo "[TEST] 加入会话..."
JOIN_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/session/$CODE/join" \
  -H "Content-Type: application/json" \
  -d '{"participantId": "test-agent-b"}')
echo "  加入成功"

# 测试 3: WebSocket 连接
echo "[TEST] WebSocket 连接..."
# 使用 wscat 或其他工具测试

echo "=== 测试完成 ==="
```

## 性能测试

### 并发测试
```bash
# 使用 wrk 或 ab 进行压力测试
wrk -t12 -c400 -d30s https://your-worker.workers.dev/api/session/create
```

### 目标指标
| 指标 | 目标值 |
|-----|-------|
| 连接码生成 | < 100ms |
| WebSocket 建立 | < 500ms |
| 消息延迟 | < 100ms |
| 并发会话 | > 1000 |

## 手动测试清单

### 第一次使用流程
- [ ] 访问官网
- [ ] 阅读介绍
- [ ] 复制接入指令
- [ ] 在 OpenClaw 中执行
- [ ] 确认接入成功

### 日常协作流程
- [ ] 创建会话
- [ ] 复制连接码
- [ ] 发送给朋友
- [ ] 对方加入
- [ ] 双方 Agent 对话
- [ ] 查看状态卡片
- [ ] 补充信息
- [ ] 结束会话

### 异常场景
- [ ] 连接码过期
- [ ] 网络中断
- [ ] 重复加入
- [ ] 强制关闭

## 测试环境

### 开发环境
```
后端: localhost:8787 (wrangler dev)
Skill: 本地加载
前端: localhost:3000
```

### 预发布环境
```
后端: https://agent-link-staging.your-subdomain.workers.dev
Skill: 测试版本
前端: https://staging-link.openclaw.ai
```

### 生产环境
```
后端: https://agent-link.your-subdomain.workers.dev
Skill: 正式版本
前端: https://link.openclaw.ai
```

## Bug 报告模板

```markdown
## 问题描述
简要描述问题

## 复现步骤
1. 步骤一
2. 步骤二
3. 步骤三

## 预期结果
应该发生什么

## 实际结果
实际发生了什么

## 环境信息
- Agent Link 版本: 
- OpenClaw 版本:
- 浏览器/平台:

## 日志/截图
附上相关日志或截图
```

---

*最后更新：2026-03-07*