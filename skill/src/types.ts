/**
 * Agent Link 类型定义
 */

import { EncryptedMessage } from './crypto.js';

/**
 * 会话状态
 */
export enum SessionState {
  /** 空闲 - 未连接 */
  IDLE = 'idle',
  /** 正在连接 */
  CONNECTING = 'connecting',
  /** 等待密钥交换 */
  AWAITING_KEY_EXCHANGE = 'awaiting_key_exchange',
  /** 密钥交换中 */
  KEY_EXCHANGING = 'key_exchanging',
  /** 已连接并建立加密通道 */
  CONNECTED = 'connected',
  /** 连接断开 */
  DISCONNECTED = 'disconnected',
  /** 发生错误 */
  ERROR = 'error'
}

/**
 * 消息类型
 */
export enum MessageType {
  /** 密钥交换 */
  KEY_EXCHANGE = 'key_exchange',
  /** 密钥交换完成 */
  KEY_EXCHANGE_ACK = 'key_exchange_ack',
  /** 加密消息 */
  ENCRYPTED = 'encrypted',
  /** 系统消息 */
  SYSTEM = 'system',
  /** 心跳 */
  PING = 'ping',
  /** 心跳响应 */
  PONG = 'pong',
  /** 会话信息 */
  SESSION_INFO = 'session_info',
  /** 用户离开 */
  USER_LEFT = 'user_left'
}

/**
 * WebSocket 消息结构
 */
export interface WSMessage {
  type: MessageType;
  payload?: unknown;
  timestamp: number;
  sender?: string;
}

/**
 * 密钥交换消息载荷
 */
export interface KeyExchangePayload {
  /** 公钥 (base64) */
  publicKey: string;
  /** Agent 展示名 */
  displayName: string;
}

/**
 * 加密消息载荷
 */
export interface EncryptedPayload {
  /** 加密消息 */
  encrypted: EncryptedMessage;
  /** 发送者 */
  sender: string;
}

/**
 * 系统消息载荷
 */
export interface SystemPayload {
  /** 消息内容 */
  message: string;
  /** 消息级别 */
  level: 'info' | 'warning' | 'error';
}

/**
 * 会话信息
 */
export interface SessionInfo {
  /** 会话 ID */
  sessionId: string;
  /** 会话代码 */
  sessionCode: string;
  /** 创建者 ID */
  creatorId: string;
  /** 创建时间 */
  createdAt: number;
  /** 参与者列表 */
  participants: Participant[];
}

/**
 * 参与者信息
 */
export interface Participant {
  /** 参与者 ID */
  id: string;
  /** 展示名 */
  displayName: string;
  /** 加入时间 */
  joinedAt: number;
  /** 是否已交换密钥 */
  keyExchanged: boolean;
}

/**
 * Agent Link 配置
 */
export interface AgentLinkConfig {
  /** WebSocket 服务器地址 */
  serverUrl: string;
  /** Agent 展示名 */
  displayName: string;
  /** 自动重连 */
  autoReconnect?: boolean;
  /** 重连间隔 (ms) */
  reconnectInterval?: number;
  /** 最大重连次数 */
  maxReconnectAttempts?: number;
}

/**
 * 会话状态卡片数据
 */
export interface SessionStatusCard {
  /** 会话代码 */
  sessionCode: string | null;
  /** 当前状态 */
  state: SessionState;
  /** 对方展示名 */
  remoteDisplayName: string | null;
  /** 对方 ID */
  remoteId: string | null;
  /** 连接时长 (秒) */
  connectedDuration: number;
  /** 消息数量 */
  messageCount: number;
  /** 加密状态 */
  encrypted: boolean;
  /** 错误信息 */
  error: string | null;
}

/**
 * 协作进度信息
 */
export interface CollaborationProgress {
  /** 当前步骤 */
  currentStep: string;
  /** 总步骤数 */
  totalSteps: number;
  /** 当前步骤索引 */
  stepIndex: number;
  /** 关键信息 */
  keyInfo: string[];
}

/**
 * 事件处理器类型
 */
export type EventHandler<T = unknown> = (data: T) => void;

/**
 * Agent Link 事件
 */
export enum AgentLinkEvent {
  /** 状态变化 */
  STATE_CHANGE = 'state_change',
  /** 收到消息 */
  MESSAGE_RECEIVED = 'message_received',
  /** 连接成功 */
  CONNECTED = 'connected',
  /** 连接断开 */
  DISCONNECTED = 'disconnected',
  /** 发生错误 */
  ERROR = 'error',
  /** 密钥交换完成 */
  KEY_EXCHANGE_COMPLETE = 'key_exchange_complete',
  /** 对方加入 */
  PEER_JOINED = 'peer_joined',
  /** 对方离开 */
  PEER_LEFT = 'peer_left'
}

/**
 * 状态变化事件数据
 */
export interface StateChangeEvent {
  previousState: SessionState;
  currentState: SessionState;
}

/**
 * 消息接收事件数据
 */
export interface MessageReceivedEvent {
  sender: string;
  content: string;
  timestamp: number;
  encrypted: boolean;
}

/**
 * 对等方事件数据
 */
export interface PeerEvent {
  participant: Participant;
}

/**
 * 错误事件数据
 */
export interface ErrorEvent {
  error: Error;
  context?: string;
}
