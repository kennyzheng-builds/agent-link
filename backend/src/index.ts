/**
 * Agent Link 信令服务
 * 
 * 基于 Cloudflare Workers + Durable Objects 实现
 * 负责：
 * 1. 生成/验证连接码
 * 2. 管理会话状态
 * 3. WebSocket 消息转发
 */

// ============================================
// 类型定义
// ============================================

/**
 * 会话状态
 */
type SessionStatus = 'pending' | 'connected' | 'closed';

/**
 * 会话数据结构
 */
interface Session {
  code: string;              // 6位连接码，如 A3F9K2
  status: SessionStatus;     // 会话状态
  createdAt: number;         // 创建时间戳
  expiresAt: number;         // 过期时间戳（10分钟后）
  participants: string[];    // 参与者ID列表
}

/**
 * WebSocket 消息类型
 */
type MessageType = 
  | 'peer-joined'      // 对端加入
  | 'peer-left'        // 对端离开
  | 'offer'            // SDP offer
  | 'answer'           // SDP answer
  | 'ice-candidate'    // ICE候选
  | 'ping'             // 心跳
  | 'pong'             // 心跳响应
  | 'error';           // 错误

/**
 * WebSocket 消息格式
 */
interface SignalingMessage {
  type: MessageType;
  payload?: any;
  from?: string;
  timestamp: number;
}

/**
 * 环境变量类型
 */
export interface Env {
  SESSION: DurableObjectNamespace<SessionDurableObject>;
  SESSION_EXPIRY_MINUTES: string;
  CODE_LENGTH: string;
}

// ============================================
// 工具函数
// ============================================

/**
 * 生成安全的随机连接码
 * - 6位字母数字混合
 * - 排除易混淆字符：0, O, I, l
 * - 示例：A3F9K2, B7M2P9
 */
function generateConnectionCode(): string {
  // 安全字符集（排除 0, O, I, l）
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
  const length = 6;
  let code = '';
  
  // 使用 crypto.getRandomValues 生成安全随机数
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  
  for (let i = 0; i < length; i++) {
    // 使用模运算将随机数映射到字符集
    code += chars[randomValues[i] % chars.length];
  }
  
  return code;
}

/**
 * 创建 JSON 响应
 */
function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

/**
 * 创建错误响应
 */
function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// ============================================
// Durable Object: 会话管理
// ============================================

/**
 * SessionDurableObject
 * 
 * 每个会话对应一个 Durable Object 实例
 * 负责管理会话状态和 WebSocket 连接
 */
export class SessionDurableObject implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  
  // WebSocket 连接映射：participantId -> WebSocket
  private connections: Map<string, WebSocket> = new Map();
  
  // 会话数据
  private session: Session | null = null;
  
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    
    // 从存储中恢复会话数据
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Session>('session');
      if (stored) {
        this.session = stored;
      }
    });
  }
  
  /**
   * 处理 HTTP 请求
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }
    
    try {
      // 路由分发
      if (path === '/create' && request.method === 'POST') {
        return await this.handleCreate(request);
      }
      
      if (path === '/join' && request.method === 'POST') {
        return await this.handleJoin(request);
      }
      
      if (path === '/status' && request.method === 'GET') {
        return await this.handleStatus();
      }
      
      // WebSocket 升级请求
      if (path === '/ws') {
        return await this.handleWebSocket(request);
      }
      
      return errorResponse('Not found', 404);
    } catch (err) {
      console.error('Request handler error:', err);
      return errorResponse('Internal server error', 500);
    }
  }
  
  /**
   * 创建新会话
   */
  private async handleCreate(request: Request): Promise<Response> {
    // 检查是否已存在会话
    if (this.session && this.session.status !== 'closed') {
      // 检查是否过期
      if (Date.now() < this.session.expiresAt) {
        return errorResponse('Session already exists', 409);
      }
    }
    
    // 生成连接码
    const code = generateConnectionCode();
    const now = Date.now();
    const expiryMinutes = parseInt(this.env.SESSION_EXPIRY_MINUTES || '10');
    
    // 创建会话数据
    this.session = {
      code,
      status: 'pending',
      createdAt: now,
      expiresAt: now + expiryMinutes * 60 * 1000,
      participants: [],
    };
    
    // 持久化存储
    await this.state.storage.put('session', this.session);
    
    // 设置会话过期定时器
    await this.state.storage.setAlarm(this.session.expiresAt);
    
    console.log(`Session created: ${code}`);
    
    return jsonResponse({
      code,
      status: this.session.status,
      expiresAt: this.session.expiresAt,
    });
  }
  
  /**
   * 加入会话
   */
  private async handleJoin(request: Request): Promise<Response> {
    // 解析请求体
    let body: { participantId?: string };
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body');
    }
    
    const { participantId } = body;
    if (!participantId) {
      return errorResponse('participantId is required');
    }
    
    // 检查会话是否存在
    if (!this.session) {
      return errorResponse('Session not found', 404);
    }
    
    // 检查会话是否过期
    if (Date.now() > this.session.expiresAt) {
      this.session.status = 'closed';
      await this.state.storage.put('session', this.session);
      return errorResponse('Session expired', 410);
    }
    
    // 检查会话是否已关闭
    if (this.session.status === 'closed') {
      return errorResponse('Session closed', 410);
    }
    
    // 检查参与者数量限制（最多2人）
    if (this.session.participants.length >= 2) {
      return errorResponse('Session full', 403);
    }
    
    // 检查是否已加入
    if (this.session.participants.includes(participantId)) {
      return jsonResponse({
        code: this.session.code,
        status: this.session.status,
        participantId,
        participants: this.session.participants,
      });
    }
    
    // 添加参与者
    this.session.participants.push(participantId);
    
    // 更新会话状态
    if (this.session.participants.length === 2) {
      this.session.status = 'connected';
    }
    
    // 持久化更新
    await this.state.storage.put('session', this.session);
    
    // 通知其他参与者有新成员加入
    await this.broadcast({
      type: 'peer-joined',
      payload: { participantId },
      from: participantId,
      timestamp: Date.now(),
    }, participantId);
    
    console.log(`Participant ${participantId} joined session ${this.session.code}`);
    
    return jsonResponse({
      code: this.session.code,
      status: this.session.status,
      participantId,
      participants: this.session.participants,
    });
  }
  
  /**
   * 获取会话状态
   */
  private async handleStatus(): Promise<Response> {
    if (!this.session) {
      return errorResponse('Session not found', 404);
    }
    
    return jsonResponse({
      code: this.session.code,
      status: this.session.status,
      createdAt: this.session.createdAt,
      expiresAt: this.session.expiresAt,
      participants: this.session.participants,
      participantCount: this.session.participants.length,
    });
  }
  
  /**
   * 处理 WebSocket 连接
   */
  private async handleWebSocket(request: Request): Promise<Response> {
    // 从查询参数获取参与者ID
    const url = new URL(request.url);
    const participantId = url.searchParams.get('participantId');
    
    if (!participantId) {
      return errorResponse('participantId query parameter required');
    }
    
    // 检查会话状态
    if (!this.session) {
      return errorResponse('Session not found', 404);
    }
    
    if (this.session.status === 'closed') {
      return errorResponse('Session closed', 410);
    }
    
    if (!this.session.participants.includes(participantId)) {
      return errorResponse('Not a participant of this session', 403);
    }
    
    // 检查是否已有连接
    if (this.connections.has(participantId)) {
      return errorResponse('Already connected', 409);
    }
    
    // 升级 WebSocket
    const [client, server] = Object.values(new WebSocketPair());
    
    // 存储连接
    this.connections.set(participantId, server);
    
    // 设置 WebSocket 事件处理器
    server.accept();
    
    // 处理消息
    server.addEventListener('message', async (event) => {
      try {
        const message: SignalingMessage = JSON.parse(event.data as string);
        
        // 处理心跳
        if (message.type === 'ping') {
          server.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now(),
          }));
          return;
        }
        
        // 转发消息给其他参与者
        await this.broadcast({
          ...message,
          from: participantId,
          timestamp: Date.now(),
        }, participantId);
        
      } catch (err) {
        console.error('WebSocket message error:', err);
        server.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Invalid message format' },
          timestamp: Date.now(),
        }));
      }
    });
    
    // 处理连接关闭
    server.addEventListener('close', async () => {
      console.log(`Participant ${participantId} disconnected`);
      this.connections.delete(participantId);
      
      // 通知其他参与者
      await this.broadcast({
        type: 'peer-left',
        payload: { participantId },
        from: participantId,
        timestamp: Date.now(),
      }, participantId);
      
      // 如果没有参与者了，关闭会话
      if (this.connections.size === 0) {
        this.session!.status = 'closed';
        await this.state.storage.put('session', this.session);
      }
    });
    
    // 处理错误
    server.addEventListener('error', (err) => {
      console.error(`WebSocket error for ${participantId}:`, err);
    });
    
    console.log(`WebSocket connected for ${participantId}`);
    
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
  
  /**
   * 广播消息给所有其他参与者
   */
  private async broadcast(message: SignalingMessage, excludeParticipantId?: string): Promise<void> {
    const messageStr = JSON.stringify(message);
    
    for (const [id, ws] of this.connections) {
      if (id !== excludeParticipantId) {
        try {
          ws.send(messageStr);
        } catch (err) {
          console.error(`Failed to send to ${id}:`, err);
        }
      }
    }
  }
  
  /**
   * 定时器回调：会话过期处理
   */
  async alarm(): Promise<void> {
    if (this.session && this.session.status !== 'closed') {
      console.log(`Session ${this.session.code} expired`);
      
      // 通知所有连接
      await this.broadcast({
        type: 'error',
        payload: { message: 'Session expired' },
        timestamp: Date.now(),
      });
      
      // 关闭所有 WebSocket 连接
      for (const [id, ws] of this.connections) {
        ws.close(1000, 'Session expired');
      }
      this.connections.clear();
      
      // 更新会话状态
      this.session.status = 'closed';
      await this.state.storage.put('session', this.session);
    }
  }
}

// ============================================
// Worker 入口
// ============================================

/**
 * 主 Worker 入口
 * 负责路由请求到对应的 Durable Object
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    console.log(`${request.method} ${path}`);
    
    // CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }
    
    try {
      // API 路由
      
      // 1. 创建会话：POST /api/session/create
      if (path === '/api/session/create' && request.method === 'POST') {
        // 为每个新会话创建唯一的 Durable Object
        const id = env.SESSION.newUniqueId();
        const sessionDO = env.SESSION.get(id);
        
        // 转发到 DO 的 create 端点
        const doUrl = new URL(request.url);
        doUrl.pathname = '/create';
        
        const response = await sessionDO.fetch(doUrl.toString(), {
          method: 'POST',
          headers: request.headers,
        });
        
        // 在响应头中返回会话 ID，便于后续连接
        const newResponse = new Response(response.body, response);
        newResponse.headers.set('X-Session-Id', id.toString());
        return newResponse;
      }
      
      // 2. 加入会话：POST /api/session/:code/join
      const joinMatch = path.match(/^\/api\/session\/([A-Za-z0-9]{6})\/join$/);
      if (joinMatch && request.method === 'POST') {
        const code = joinMatch[1].toUpperCase();
        
        // 通过 code 获取对应的 DO 实例
        // 使用 code 作为 ID 名称，确保同一 code 总是路由到同一个 DO
        const id = env.SESSION.idFromName(code);
        const sessionDO = env.SESSION.get(id);
        
        // 转发到 DO 的 join 端点
        const doUrl = new URL(request.url);
        doUrl.pathname = '/join';
        
        return await sessionDO.fetch(doUrl.toString(), {
          method: 'POST',
          headers: request.headers,
          body: request.body,
        });
      }
      
      // 3. WebSocket 连接：/api/session/:code/ws
      const wsMatch = path.match(/^\/api\/session\/([A-Za-z0-9]{6})\/ws$/);
      if (wsMatch) {
        const code = wsMatch[1].toUpperCase();
        
        // 获取对应的 DO 实例
        const id = env.SESSION.idFromName(code);
        const sessionDO = env.SESSION.get(id);
        
        // 转发 WebSocket 请求
        const doUrl = new URL(request.url);
        doUrl.pathname = '/ws';
        
        return await sessionDO.fetch(doUrl.toString(), request);
      }
      
      // 健康检查
      if (path === '/health' && request.method === 'GET') {
        return jsonResponse({
          status: 'ok',
          timestamp: Date.now(),
          version: '1.0.0',
        });
      }
      
      // 404
      return errorResponse('Not found', 404);
      
    } catch (err) {
      console.error('Worker error:', err);
      return errorResponse('Internal server error', 500);
    }
  },
};
