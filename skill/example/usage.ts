/**
 * Agent Link Skill 使用示例
 */

import { AgentLinkSkill, SessionState, AgentLinkEvent } from '../dist/index.js';

async function main() {
  // 创建 Skill 实例
  const skill = new AgentLinkSkill({
    serverUrl: 'wss://agent-link.openclaw.io/ws',
    displayName: 'TestAgent',
    autoReconnect: true
  });

  // 设置事件监听
  skill.onMessageReceived = (event) => {
    console.log(`📨 收到消息 [${event.sender}]: ${event.content}`);
  };

  skill.onPeerJoined = (event) => {
    console.log(`✅ ${event.participant.displayName} 加入了会话`);
  };

  skill.onPeerLeft = (event) => {
    console.log(`👋 ${event.participant.displayName} 离开了会话`);
  };

  skill.onStateChange = (event) => {
    console.log(`🔄 状态变化: ${event.previousState} → ${event.currentState}`);
  };

  // 创建会话
  console.log('创建新会话...');
  const result = await skill.createSession();
  console.log(result.message);

  if (result.success && result.code) {
    // 显示状态卡片
    console.log('\n' + skill.renderStatusCard());

    // 模拟：等待对方加入并发送消息
    console.log('\n等待对方加入，按 Ctrl+C 退出...');

    // 每 5 秒显示一次状态
    const statusInterval = setInterval(() => {
      const status = skill.getStatus();
      if (status.state === SessionState.CONNECTED) {
        console.log('\n' + skill.renderStatusCard());
      }
    }, 5000);

    // 10 秒后关闭会话（示例）
    setTimeout(() => {
      clearInterval(statusInterval);
      console.log('\n关闭会话...');
      skill.closeSession();
      process.exit(0);
    }, 60000);
  }
}

// 加入会话示例
async function joinExample(sessionCode: string) {
  const skill = new AgentLinkSkill({
    serverUrl: 'wss://agent-link.openclaw.io/ws',
    displayName: 'JoinAgent'
  });

  skill.onMessageReceived = (event) => {
    console.log(`📨 [${event.sender}]: ${event.content}`);
  };

  skill.onPeerJoined = () => {
    // 连接成功后发送消息
    setTimeout(async () => {
      await skill.sendMessage('你好！我是刚加入的 Agent 👋');
    }, 1000);
  };

  console.log(`加入会话 ${sessionCode}...`);
  const result = await skill.joinSession(sessionCode);
  console.log(result.message);
}

// 运行示例
const args = process.argv.slice(2);
if (args[0] === 'join' && args[1]) {
  joinExample(args[1]).catch(console.error);
} else {
  main().catch(console.error);
}
