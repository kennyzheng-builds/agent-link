/**
 * Agent Link WebSocket 客户端
 * 
 * 负责与 Agent Link 服务器建立 WebSocket 连接，
 * 处理消息收发、状态管理和事件通知。
 */

import WebSocket from 'ws';
import { CryptoManager } from './crypto.js';
import {
  AgentLinkConfig,
  SessionState,
  MessageType,
  WSMessage,
  KeyExchangePayload,
  EncryptedPayload,
  SystemPayload,
  SessionInfo,
  AgentLinkEvent,
  EventHandler,
  StateChangeEvent,
  MessageReceivedEvent,
  PeerEvent,
  ErrorEvent,
  Participant
} from './types.js';

/**
 * Agent Link 客户端类
 */
export class AgentLinkClient {
  private ws: WebSocket | null = null;
  private config: AgentLinkConfig;
  private crypto: CryptoManager;
  private state: SessionState = SessionState.IDLE;
  private sessionInfo: SessionInfo | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private eventHandlers: Map<AgentLinkEvent, Set<EventHandler>> = new Map();
  private messageCount = 0;
  private connectedAt: number | null = null;
  private remoteParticipant: Participant | null = null;

  /**
   * 创建 Agent Link 客户端实例
   * 
   * @param config - 客户端配置
   */
  constructor(config: AgentLinkConfig) {
    this.config = {
      autoReconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 5,
      ...config
    };
    this.crypto = new CryptoManager();
  }

  /**
   * 获取当前会话状态
   */
  get currentState(): SessionState {
    return this.state;
  }

  /**
   * 获取会话信息
   */
  get session(): SessionInfo | null {
    return this.sessionInfo;
  }

  /**
   * 获取会话代码
   */
  get sessionCode(): string | null {
    return this.sessionInfo?.sessionCode ?? null;
  }

  /**
   * 获取连接状态
   */
  get isConnected(): boolean {
    return this.state === SessionState.CONNECTED && 
           this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * 获取加密状态
   */
  get isEncrypted(): boolean {
    return this.crypto.isReady;
  }

  /**
   * 获取消息数量
   */
  get messagesSent(): number {
    return this.messageCount;
  }

  /**
   * 获取连接时长（秒）
   */
  get connectedDuration(): number {
    if (!this.connectedAt) return 0;
    return Math.floor((Date.now() - this.connectedAt) / 1000);
  }

  /**
   * 获取对方信息
   */
  get remotePeer(): Participant | null {
    return this.remoteParticipant;
  }

  /**
   * 注册事件处理器
   * 
   * @param event - 事件类型
   * @param handler - 处理函数
   */
  on<T>(event: AgentLinkEvent, handler: EventHandler<T>): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as EventHandler);
  }

  /**
   * 移除事件处理器
   * 
   * @param event - 事件类型
   * @param handler - 处理函数
   */
  off<T>(event: AgentLinkEvent, handler: EventHandler<T>): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler);
    }
  }

  /**
   * 触发事件
   * 
   * @param event - 事件类型
   * @param data - 事件数据
   */
  private emit<T>(event: AgentLinkEvent, data: T): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (err) {
          console.error(`Error in event handler for ${event}:`, err);
        }
      });
    }
  }

  /**
   * 更新状态并触发事件
   * 
   * @param newState - 新状态
   */
  private setState(newState: SessionState): void {
    const previousState = this.state;
    this.state = newState;
    
    if (previousState !== newState) {
      this.emit<StateChangeEvent>(AgentLinkEvent.STATE_CHANGE, {
        previousState,
        currentState: newState
      });
    }
  }

  /**
   * 连接到 Agent Link 服务器
   * 
   * @param sessionCode - 可选的会话代码（加入现有会话）
   * @returns Promise 在连接成功时 resolve
   */
  async connect(sessionCode?: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      throw new Error('Already connected');
    }

    this.setState(SessionState.CONNECTING);
    
    // 初始化加密模块
    await this.crypto.initialize();

    return new Promise((resolve, reject) => {
      const url = sessionCode 
        ? `${this.config.serverUrl}?code=${sessionCode}`
        : this.config.serverUrl;

      try {
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
          console.log('[AgentLink] WebSocket connected');
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
        });

        this.ws.on('message', (data: WebSocket.RawData) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          console.log(`[AgentLink] WebSocket closed: ${code} - ${reason.toString()}`);
          this.handleDisconnect();
        });

        this.ws.on('error', (error: Error) => {
          console.error('[AgentLink] WebSocket error:', error);
          this.emit<ErrorEvent>(AgentLinkEvent.ERROR, {
            error,
            context: 'websocket'
          });
          reject(error);
        });

      } catch (error) {
        this.setState(SessionState.ERROR);
        reject(error);
      }
    });
  }

  /**
   * 处理收到的消息
   * 
   * @param data - 消息数据
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const message: WSMessage = JSON.parse(data);
      
      switch (message.type) {
        case MessageType.SESSION_INFO:
          // 收到会话信息
          this.sessionInfo = message.payload as SessionInfo;
          console.log(`[AgentLink] Session created: ${this.sessionInfo.sessionCode}`);
          break;

        case MessageType.KEY_EXCHANGE:
          // 收到密钥交换请求
          await this.handleKeyExchange(message.payload as KeyExchangePayload, message.sender!);
          break;

        case MessageType.KEY_EXCHANGE_ACK:
          // 密钥交换完成
          this.setState(SessionState.CONNECTED);
          this.connectedAt = Date.now();
          this.emit(AgentLinkEvent.KEY_EXCHANGE_COMPLETE, {});
          this.emit(AgentLinkEvent.CONNECTED, {});
          console.log('[AgentLink] Key exchange complete, secure channel established');
          break;

        case MessageType.ENCRYPTED:
          // 收到加密消息
          await this.handleEncryptedMessage(message.payload as EncryptedPayload);
          break;

        case MessageType.SYSTEM:
          // 系统消息
          const systemPayload = message.payload as SystemPayload;
          console.log(`[AgentLink] System: ${systemPayload.message}`);
          break;

        case MessageType.PONG:
          // 心跳响应
          break;

        case MessageType.USER_LEFT:
          // 对方离开
          this.remoteParticipant = null;
          this.setState(SessionState.DISCONNECTED);
          this.emit<PeerEvent>(AgentLinkEvent.PEER_LEFT, {
            participant: message.payload as Participant
          });
          break;

        default:
          console.warn('[AgentLink] Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[AgentLink] Error handling message:', error);
      this.emit<ErrorEvent>(AgentLinkEvent.ERROR, {
        error: error as Error,
        context: 'message_handling'
      });
    }
  }

  /**
   * 处理密钥交换
   * 
   * @param payload - 密钥交换载荷
   * @param senderId - 发送者 ID
   */
  private async handleKeyExchange(
    payload: KeyExchangePayload, 
    senderId: string
  ): Promise<void> {
    try {
      this.setState(SessionState.KEY_EXCHANGING);
      
      // 完成密钥交换
      await this.crypto.completeKeyExchange(payload.publicKey);
      
      // 发送密钥交换确认
      this.sendMessage(MessageType.KEY_EXCHANGE_ACK, {
        publicKey: this.crypto.getPublicKey(),
        displayName: this.config.displayName
      });

      // 记录对方信息
      this.remoteParticipant = {
        id: senderId,
        displayName: payload.displayName,
        joinedAt: Date.now(),
        keyExchanged: true
      };

      this.emit<PeerEvent>(AgentLinkEvent.PEER_JOINED, {
        participant: this.remoteParticipant
      });

    } catch (error) {
      console.error('[AgentLink] Key exchange failed:', error);
      this.setState(SessionState.ERROR);
      this.emit<ErrorEvent>(AgentLinkEvent.ERROR, {
        error: error as Error,
        context: 'key_exchange'
      });
    }
  }

  /**
   * 处理加密消息
   * 
   * @param payload - 加密消息载荷
   */
  private async handleEncryptedMessage(payload: EncryptedPayload): Promise<void> {
    try {
      if (!this.crypto.isReady) {
        throw new Error('Encryption not ready');
      }

      // 解密消息
      const decrypted = await this.crypto.decrypt(payload.encrypted);
      
      this.emit<MessageReceivedEvent>(AgentLinkEvent.MESSAGE_RECEIVED, {
        sender: payload.sender,
        content: decrypted,
        timestamp: Date.now(),
        encrypted: true
      });

    } catch (error) {
      console.error('[AgentLink] Failed to decrypt message:', error);
      this.emit<ErrorEvent>(AgentLinkEvent.ERROR, {
        error: error as Error,
        context: 'decryption'
      });
    }
  }

  /**
   * 发送消息
   * 
   * @param type - 消息类型
   * @param payload - 消息载荷
   */
  private sendMessage(type: MessageType, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const message: WSMessage = {
      type,
      payload,
      timestamp: Date.now()
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 发送加密消息
   * 
   * @param content - 消息内容
   */
  async send(content: string): Promise<void> {
    if (!this.crypto.isReady) {
      throw new Error('Encryption channel not established');
    }

    // 加密消息
    const encrypted = await this.crypto.encrypt(content);

    this.sendMessage(MessageType.ENCRYPTED, {
      encrypted,
      sender: this.config.displayName
    } as EncryptedPayload);

    this.messageCount++;
  }

  /**
   * 发起密钥交换（作为会话创建者）
   */
  initiateKeyExchange(): void {
    if (!this.sessionInfo) {
      throw new Error('No active session');
    }

    this.setState(SessionState.AWAITING_KEY_EXCHANGE);

    this.sendMessage(MessageType.KEY_EXCHANGE, {
      publicKey: this.crypto.getPublicKey(),
      displayName: this.config.displayName
    } as KeyExchangePayload);

    console.log('[AgentLink] Key exchange initiated');
  }

  /**
   * 处理连接断开
   */
  private handleDisconnect(): void {
    this.stopHeartbeat();
    
    if (this.state !== SessionState.ERROR) {
      this.setState(SessionState.DISCONNECTED);
    }

    this.emit(AgentLinkEvent.DISCONNECTED, {});

    // 尝试重连
    if (this.config.autoReconnect && 
        this.reconnectAttempts < (this.config.maxReconnectAttempts || 5)) {
      this.scheduleReconnect();
    }
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    console.log(`[AgentLink] Reconnecting in ${this.config.reconnectInterval}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect(this.sessionCode || undefined).catch(err => {
        console.error('[AgentLink] Reconnect failed:', err);
      });
    }, this.config.reconnectInterval);
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendMessage(MessageType.PING, {});
      }
    }, 30000); // 30秒心跳
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 关闭连接
   */
  close(): void {
    // 清除重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 停止心跳
    this.stopHeartbeat();

    // 关闭 WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // 清理加密状态
    this.crypto.destroy();

    // 重置状态
    this.sessionInfo = null;
    this.remoteParticipant = null;
    this.messageCount = 0;
    this.connectedAt = null;
    this.reconnectAttempts = 0;
    this.setState(SessionState.IDLE);

    console.log('[AgentLink] Connection closed');
  }
}
