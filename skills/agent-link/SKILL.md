---
name: agent-link
description: >-
  Agent 间协作上下文包——让 Agent 打包问题上下文、识别并分析协作请求、生成协作回复、处理追问。
  消除人类在 Agent 之间传话造成的信息损耗。
  Use this skill whenever:
  (1) user wants to package a problem for someone else's agent ("帮我打包这个问题", "我要找人帮忙看看", "生成协作请求", "pack this problem"),
  (2) user pastes text containing <!-- AGENT-LINK-REQUEST or <!-- AGENT-LINK-RESPONSE or <!-- AGENT-LINK-FOLLOWUP markers,
  (3) user asks to analyze a collaboration request from another agent,
  (4) user wants to follow up on a previous collaboration ("还有问题", "方案试了不行", "继续追问"),
  (5) user mentions "agent-link", "协作请求", "协作回复", or "上下文包".
---

# Agent Link：协作上下文包

让 Agent（而非人类）来打包和解读问题上下文，人类只负责传递。

## 核心流程

```
你的 Agent 打包问题 → 你复制发给朋友 → 朋友粘贴给他的 Agent → Agent 分析回复 → 朋友发回给你 → 你的 Agent 解读并行动
```

## 展示名

首次使用时询问用户："你希望在协作中怎么称呼？（比如你的名字或昵称）"

读取优先级：
1. `~/.agent-link/config.json` 中的 `displayName` 字段
2. 环境变量 `AGENT_LINK_DISPLAY_NAME`
3. 系统用户名
4. "匿名"

首次获取后保存到 `~/.agent-link/config.json`：
```json
{"displayName": "Kenny"}
```

后续所有请求/回复中显示为"XX 的 Agent"。

---

## 能力 1：打包协作请求

**触发**：用户说"帮我打包这个问题"、"我要找人帮忙看看"、"生成协作请求"等。

**执行步骤**：

1. 从当前对话上下文中提取：
   - 问题描述（用清晰的技术语言重新组织）
   - 环境信息（语言版本、框架、OS 等）
   - 完整报错信息（保留原始格式）
   - 已尝试的方案及结果（✅ 已试 / ❌ 未试）
   - 期望的帮助

2. **敏感信息过滤**（打包前必须执行）：
   - API Key / Token（`sk-`、`ghp_`、`xoxb-` 等模式）→ `[API_KEY_REDACTED]`
   - 密码字段（`password=xxx`、`secret=xxx`）→ `[PASSWORD_REDACTED]`
   - 私钥内容 → 完全移除，注明"已移除私钥，如需请单独安全传递"
   - 本地绝对路径 → 替换为相对路径
   - 内部 IP / 内部域名 → `[INTERNAL_HOST]`
   - 用户名 / 邮箱（出现在日志中的）→ 脱敏处理

3. 输出格式：

```markdown
<!-- AGENT-LINK-REQUEST v1 -->

# 协作请求：[问题简述]

**来自**：[展示名] 的 Agent
**时间**：[YYYY-MM-DD HH:mm]
**类型**：[bug 排查 / 方案咨询 / 代码 review / 配置问题 / 其他]

## 问题描述
[清晰、完整的问题描述]

## 环境信息
- [关键环境信息，逐条列出]

## 报错信息
```
[完整的报错输出，保留原始格式]
```

## 已尝试方案
1. ✅ [已尝试的方案] → [结果]
2. ❌ [尚未尝试的方向]

## 期望
[希望对方帮忙做什么]

<!-- END AGENT-LINK-REQUEST -->
```

4. 提示用户："我帮你整理了以下协作请求，复制发给你的朋友即可。"

---

## 能力 2：识别并分析协作请求

**触发**：用户粘贴了包含 `<!-- AGENT-LINK-REQUEST v1 -->` 标记的文本，或说"帮我看看这个问题"。

**执行步骤**：

1. 识别 `<!-- AGENT-LINK-REQUEST v1 -->` 标记
2. 解析结构化内容：问题描述、环境、报错、已尝试方案
3. 基于自身知识分析问题，给出诊断和建议
4. 生成协作回复：

```markdown
<!-- AGENT-LINK-RESPONSE v1 -->

# 协作回复：[问题简述]

**来自**：[展示名] 的 Agent
**时间**：[YYYY-MM-DD HH:mm]
**针对**：[请求方展示名] 的 Agent 的协作请求

## 诊断结果
[对问题的分析和根因判断]

## 建议方案

### 方案 A（推荐）：[方案名]
[具体步骤，编号列出]

### 方案 B：[方案名]
[备选方案]

## 补充说明
[额外的背景知识、注意事项]

## 参考资料
- [相关文档或链接]

<!-- END AGENT-LINK-RESPONSE -->
```

5. 提示用户："复制这段回复发回给对方。"

---

## 能力 3：解读协作回复

**触发**：用户粘贴了包含 `<!-- AGENT-LINK-RESPONSE v1 -->` 标记的文本。

**执行步骤**：

1. 识别并解析回复内容
2. 结合之前的问题上下文（如果在同一对话中），整合对方的建议
3. 用通俗的语言告诉用户：
   - 对方的诊断结论是什么
   - 推荐的下一步操作（哪些需要用户手动做，哪些 Agent 可以直接执行）
   - 如果有多个方案，帮用户分析利弊
4. 如果 Agent 能直接执行某些建议（如修改代码、调整配置），主动提出

---

## 能力 4：追问

**触发**：用户说"还有问题"、"方案试了不行"、"继续追问"等。

**执行步骤**：

1. 结合之前的请求和回复，整理新的信息
2. 生成追问：

```markdown
<!-- AGENT-LINK-FOLLOWUP v1 -->

# 追问：[问题简述]

**来自**：[展示名] 的 Agent
**时间**：[YYYY-MM-DD HH:mm]
**上下文**：基于 [回复方展示名] Agent 的回复

## 追问内容
[说明尝试了什么、结果如何、还有什么新信息]

## 新增信息
```
[新的报错或日志]
```

<!-- END AGENT-LINK-FOLLOWUP -->
```

3. 提示用户传递给对方

---

## 安全边界

这是一个**只读咨询**工具：
- 允许：文本问答、只读分析、返回建议和操作步骤
- 不允许：写对方的文件、执行对方的命令、调用对方的外部工具、访问对方的本地资源

打包时如果解决问题需要凭证信息，只说明"需要 XX 类型的凭证"，不要求对方提供实际值。
