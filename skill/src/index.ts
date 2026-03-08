/**
 * Agent Link Skill - 主入口
 * 
 * 让两个 OpenClaw Agent 直接对话的客户端 Skill。
 * 
 * 功能：
 * - /link new - 创建会话
 * - /link join <code> - 加入会话
 * - /link status - 查看状态
 * - /link close - 关闭会话
 * 
 * 技术：
 * - WebSocket 实时通信
 * - X25519 密钥交换
 * - AES-256-GCM 端到端加密
 */

import { AgentLinkClient } from './client.js';
import {
  AgentLinkConfig,
  SessionState,
  AgentLinkEvent,
  SessionStatusCard,
  MessageReceivedEvent,
  PeerEvent
} from './types.js';
import { generateSessionCode } from './crypto.js';

// Skill 元数据
export const SKILL_NAME = 'agent-link';
export const SKILL_VERSION = '1.0.0';
export const SKILL_DESCRIPTION = '让两个 OpenClaw Agent 直接安全对话';

/**
 * Agent Link Skill 主类
 * 
 * 管理客户端实例，处理用户指令，渲染状态卡片
 */
export class AgentLinkSkill {
  private client: AgentLinkClient | null = null;
  private config: Partial<AgentLinkConfig>;
  private messageHistory: Array<{ sender: string; content: string; time: Date }> = [];
  private maxHistory = 100;

  /**
   * 创建 Skill 实例
   * 
   * @param config - 可选的配置覆盖
   */
  constructor(config: Partial<AgentLinkConfig> = {}) {
    this.config = config;
  }

  /**
   * 获取默认服务器地址
   * 从环境变量或配置中读取
   */
  private getServerUrl(): string {
    return process.env.AGENT_LINK_SERVER || 
           this.config.serverUrl || 
           'wss://agent-link.openclaw.io/ws';
  }

  /**
   * 获取当前 Agent 展示名
   */
  private getDisplayName(): string {
    return process.env.AGENT_NAME || 
           this.config.displayName || 
           `Agent-${generateSessionCode()}`;
  }

  /**
   * 创建完整配置
   */
  private createConfig(): AgentLinkConfig {
    return {
      serverUrl: this.getServerUrl(),
      displayName: this.getDisplayName(),
      autoReconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 5,
      ...this.config
    };
  }

  /**
   * 创建新会话
   * 
   * 指令: /link new 或 "帮我找人协作"
   * 
   * @returns 会话代码和状态信息
   */
  async createSession(): Promise<{ success: boolean; code?: string; message: string }> {
    try {
      // 如果已有连接，先关闭
      if (this.client) {
        this.client.close();
      }

      // 创建新客户端
      this.client = new AgentLinkClient(this.createConfig());
      this.setupEventHandlers();

      // 连接到服务器（创建新会话）
      await this.client.connect();

      // 等待会话信息
      await this.waitForSessionInfo();

      const code = this.client.sessionCode;
      
      return {
        success: true,
        code: code || undefined,
        message: `会话已创建！\n会话代码: **${code}**\n分享此代码给其他 Agent 即可加入协作。`
      };

    } catch (error) {
      return {
        success: false,
        message: `创建会话失败: ${(error as Error).message}`
      };
    }
  }

  /**
   * 加入现有会话
   * 
   * 指令: /link join <code> 或 "加入 XXX"
   * 
   * @param code - 会话代码
   * @returns 加入结果
   */
  async joinSession(code: string): Promise<{ success: boolean; message: string }> {
    try {
      // 验证会话代码格式
      if (!/^[A-Z0-9]{6}$/i.test(code)) {
        return {
          success: false,
          message: '无效的会话代码格式。应为 6 位字母数字组合，如: ABC123'
        };
      }

      // 如果已有连接，先关闭
      if (this.client) {
        this.client.close();
      }

      // 创建新客户端
      this.client = new AgentLinkClient(this.createConfig());
      this.setupEventHandlers();

      // 连接到指定会话
      await this.client.connect(code.toUpperCase());

      // 发起密钥交换
      this.client.initiateKeyExchange();

      return {
        success: true,
        message: `正在加入会话 **${code.toUpperCase()}**...\n等待建立安全连接...`
      };

    } catch (error) {
      return {
        success: false,
        message: `加入会话失败: ${(error as Error).message}`
      };
    }
  }

  /**
   * 获取会话状态
   * 
   * 指令: /link status 或 "会话状态"
   * 
   * @returns 状态卡片数据
   */
  getStatus(): SessionStatusCard {
    if (!this.client) {
      return {
        sessionCode: null,
        state: SessionState.IDLE,
        remoteDisplayName: null,
        remoteId: null,
        connectedDuration: 0,
        messageCount: 0,
        encrypted: false,
        error: null
      };
    }

    return {
      sessionCode: this.client.sessionCode,
      state: this.client.currentState,
      remoteDisplayName: this.client.remotePeer?.displayName ?? null,
      remoteId: this.client.remotePeer?.id ?? null,
      connectedDuration: this.client.connectedDuration,
      messageCount: this.client.messagesSent + this.messageHistory.length,
      encrypted: this.client.isEncrypted,
      error: null
    };
  }

  /**
   * 关闭会话
   * 
   * 指令: /link close 或 "结束会话"
   * 
   * @returns 关闭结果
   */
  closeSession(): { success: boolean; message: string } {
    if (!this.client) {
      return {
        success: false,
        message: '当前没有活跃的会话'
      };
    }

    const code = this.client.sessionCode;
    this.client.close();
    this.client = null;
    this.messageHistory = [];

    return {
      success: true,
      message: code 
        ? `会话 **${code}** 已关闭`
        : '会话已关闭'
    };
  }

  /**
   * 发送消息到对方
   * 
   * @param content - 消息内容
   * @returns 发送结果
   */
  async sendMessage(content: string): Promise<{ success: boolean; message: string }> {
    if (!this.client) {
      return {
        success: false,
        message: '没有活跃的会话，请先创建或加入会话'
      };
    }

    if (!this.client.isConnected) {
      return {
        success: false,
        message: '连接未就绪，请等待加密通道建立'
      };
    }

    try {
      await this.client.send(content);
      return {
        success: true,
        message: '消息已发送'
      };
    } catch (error) {
      return {
        success: false,
        message: `发送失败: ${(error as Error).message}`
      };
    }
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    // 连接成功
    this.client.on(AgentLinkEvent.CONNECTED, () => {
      console.log('[AgentLinkSkill] Connected to peer');
    });

    // 收到消息
    this.client.on<MessageReceivedEvent>(AgentLinkEvent.MESSAGE_RECEIVED, (event) => {
      this.messageHistory.push({
        sender: event.sender,
        content: event.content,
        time: new Date(event.timestamp)
      });

      // 限制历史记录大小
      if (this.messageHistory.length > this.maxHistory) {
        this.messageHistory.shift();
      }

      // 触发消息通知（可以被外部监听）
      this.onMessageReceived?.(event);
    });

    // 对方加入
    this.client.on<PeerEvent>(AgentLinkEvent.PEER_JOINED, (event) => {
      console.log(`[AgentLinkSkill] Peer joined: ${event.participant.displayName}`);
      this.onPeerJoined?.(event);
    });

    // 对方离开
    this.client.on<PeerEvent>(AgentLinkEvent.PEER_LEFT, (event) => {
      console.log(`[AgentLinkSkill] Peer left: ${event.participant.displayName}`);
      this.onPeerLeft?.(event);
    });

    // 状态变化
    this.client.on(AgentLinkEvent.STATE_CHANGE, (event) => {
      const stateEvent = event as { previousState: SessionState; currentState: SessionState };
      console.log(`[AgentLinkSkill] State: ${stateEvent.previousState} -> ${stateEvent.currentState}`);
      this.onStateChange?.(stateEvent);
    });

    // 错误
    this.client.on(AgentLinkEvent.ERROR, (event) => {
      const errorEvent = event as { error: Error; context?: string };
      console.error('[AgentLinkSkill] Error:', errorEvent.error);
      this.onError?.(errorEvent);
    });
  }

  /**
   * 等待会话信息
   */
  private async waitForSessionInfo(timeout = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (this.client?.sessionCode) {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          resolve();
        }
      }, 100);

      const timeoutId = setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Timeout waiting for session info'));
      }, timeout);
    });
  }

  // 可覆盖的回调函数
  onMessageReceived?: (event: MessageReceivedEvent) => void;
  onPeerJoined?: (event: PeerEvent) => void;
  onPeerLeft?: (event: PeerEvent) => void;
  onStateChange?: (event: { previousState: SessionState; currentState: SessionState }) => void;
  onError?: (event: { error: Error; context?: string }) => void;

  /**
   * 渲染状态卡片（用于主窗口显示）
   * 
   * @returns 状态卡片 HTML/Markdown
   */
  renderStatusCard(): string {
    const status = this.getStatus();
    
    const stateEmoji: Record<SessionState, string> = {
      [SessionState.IDLE]: '⚪',
      [SessionState.CONNECTING]: '🟡',
      [SessionState.AWAITING_KEY_EXCHANGE]: '🟠',
      [SessionState.KEY_EXCHANGING]: '🔵',
      [SessionState.CONNECTED]: '🟢',
      [SessionState.DISCONNECTED]: '⚫',
      [SessionState.ERROR]: '🔴'
    };

    const stateText: Record<SessionState, string> = {
      [SessionState.IDLE]: '空闲',
      [SessionState.CONNECTING]: '连接中...',
      [SessionState.AWAITING_KEY_EXCHANGE]: '等待密钥交换',
      [SessionState.KEY_EXCHANGING]: '密钥交换中...',
      [SessionState.CONNECTED]: '已连接',
      [SessionState.DISCONNECTED]: '已断开',
      [SessionState.ERROR]: '错误'
    };

    let card = `## ${stateEmoji[status.state]} Agent Link 协作状态\n\n`;
    
    if (status.sessionCode) {
      card += `**会话代码**: \`${status.sessionCode}\`\n\n`;
    }

    card += `**状态**: ${stateText[status.state]}\n`;

    if (status.remoteDisplayName) {
      card += `**协作对象**: ${status.remoteDisplayName}\n`;
    }

    if (status.connectedDuration > 0) {
      const minutes = Math.floor(status.connectedDuration / 60);
      const seconds = status.connectedDuration % 60;
      card += `**连接时长**: ${minutes}分${seconds}秒\n`;
    }

    if (status.messageCount > 0) {
      card += `**消息数量**: ${status.messageCount}\n`;
    }

    card += `**加密状态**: ${status.encrypted ? '🔒 已加密' : '🔓 未加密'}\n\n`;

    // 操作按钮
    card += '### 操作\n';
    
    if (status.state === SessionState.IDLE) {
      card += '- `/link new` - 创建新会话\n';
      card += '- `/link join <代码>` - 加入会话\n';
    } else if (status.state === SessionState.CONNECTED) {
      card += '- 直接输入消息即可发送\n';
      card += '- `/link close` - 结束会话\n';
    } else {
      card += '- `/link status` - 刷新状态\n';
      card += '- `/link close` - 取消/关闭\n';
    }

    // 最近消息
    if (this.messageHistory.length > 0) {
      card += '\n### 最近消息\n';
      const recent = this.messageHistory.slice(-5);
      for (const msg of recent) {
        const time = msg.time.toLocaleTimeString('zh-CN', { 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        card += `**${time}** ${msg.sender}: ${msg.content.substring(0, 50)}${msg.content.length > 50 ? '...' : ''}\n`;
      }
    }

    return card;
  }
}

// 导出主要组件
export { AgentLinkClient } from './client.js';
export * from './types.js';
export * from './crypto.js';

// 默认导出
export default AgentLinkSkill;
