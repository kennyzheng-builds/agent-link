/**
 * Agent Link 加密模块
 * 
 * 使用 X25519 密钥交换 + AES-256-GCM 加密实现端到端加密通信
 * - X25519: 基于 Curve25519 的椭圆曲线密钥交换算法
 * - AES-256-GCM: 提供机密性和完整性的对称加密
 */

import { x25519 } from '@noble/curves/ed25519';
import { randomBytes } from 'crypto';

/**
 * 会话密钥对 - 每次会话生成临时密钥对
 */
export interface SessionKeyPair {
  /** 公钥 (32 bytes) - 可公开分享 */
  publicKey: Uint8Array;
  /** 私钥 (32 bytes) - 必须保密 */
  privateKey: Uint8Array;
}

/**
 * 加密后的消息结构
 */
export interface EncryptedMessage {
  /** IV (初始化向量) - 12 bytes */
  iv: string; // base64
  /** 认证标签 - 16 bytes */
  authTag: string; // base64
  /** 密文 */
  ciphertext: string; // base64
}

/**
 * 生成临时会话密钥对
 * 
 * @returns 包含公钥和私钥的密钥对
 */
export function generateKeyPair(): SessionKeyPair {
  // 生成随机私钥 (32 bytes)
  const privateKey = x25519.utils.randomPrivateKey();
  // 从私钥派生公钥
  const publicKey = x25519.getPublicKey(privateKey);
  
  return {
    publicKey,
    privateKey
  };
}

/**
 * 执行 X25519 密钥交换，生成共享密钥
 * 
 * @param privateKey - 本地私钥
 * @param publicKey - 对方公钥
 * @returns 共享密钥 (32 bytes)
 */
export function deriveSharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Uint8Array {
  // X25519 密钥交换
  const sharedSecret = x25519.getSharedSecret(privateKey, publicKey);
  return sharedSecret;
}

/**
 * 使用 HKDF 从共享密钥派生 AES-256 密钥
 * 
 * @param sharedSecret - X25519 共享密钥
 * @returns 256-bit AES 密钥
 */
export async function deriveAESKey(sharedSecret: Uint8Array): Promise<CryptoKey> {
  // 使用 Web Crypto API 的 HKDF 派生密钥
  const encoder = new TextEncoder();
  
  // 创建新的 Uint8Array 确保 buffer 是 ArrayBuffer 类型
  const keyData = new Uint8Array(sharedSecret);
  
  // 导入共享密钥作为 HKDF 的输入密钥材料
  const baseKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );
  
  // 派生 AES-256-GCM 密钥
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('agent-link-v1'), // 协议盐值
      info: encoder.encode('encryption-key') // 上下文信息
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  
  return aesKey;
}

/**
 * 加密消息
 * 
 * @param plaintext - 明文消息
 * @param aesKey - AES-256-GCM 密钥
 * @returns 加密后的消息结构
 */
export async function encryptMessage(
  plaintext: string,
  aesKey: CryptoKey
): Promise<EncryptedMessage> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  
  // 生成随机 IV (12 bytes for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // AES-256-GCM 加密
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    aesKey,
    data
  );
  
  // 分离密文和认证标签 (最后 16 bytes 是 auth tag)
  const encryptedArray = new Uint8Array(encrypted);
  const ciphertext = encryptedArray.slice(0, -16);
  const authTag = encryptedArray.slice(-16);
  
  return {
    iv: Buffer.from(iv).toString('base64'),
    authTag: Buffer.from(authTag).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64')
  };
}

/**
 * 解密消息
 * 
 * @param encrypted - 加密消息结构
 * @param aesKey - AES-256-GCM 密钥
 * @returns 解密后的明文
 */
export async function decryptMessage(
  encrypted: EncryptedMessage,
  aesKey: CryptoKey
): Promise<string> {
  // 解码 base64
  const iv = Buffer.from(encrypted.iv, 'base64');
  const authTag = Buffer.from(encrypted.authTag, 'base64');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
  
  // 组合密文和认证标签
  const encryptedData = new Uint8Array(ciphertext.length + authTag.length);
  encryptedData.set(ciphertext);
  encryptedData.set(authTag, ciphertext.length);
  
  // AES-256-GCM 解密
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv
    },
    aesKey,
    encryptedData
  );
  
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * 将公钥编码为 base64 字符串（用于传输）
 * 
 * @param publicKey - 公钥字节数组
 * @returns base64 编码的字符串
 */
export function encodePublicKey(publicKey: Uint8Array): string {
  return Buffer.from(publicKey).toString('base64');
}

/**
 * 从 base64 字符串解码公钥
 * 
 * @param encoded - base64 编码的公钥
 * @returns 公钥字节数组
 */
export function decodePublicKey(encoded: string): Uint8Array {
  return Buffer.from(encoded, 'base64');
}

/**
 * 生成会话代码 (6位字母数字)
 * 用于邀请其他 Agent 加入会话
 * 
 * @returns 会话代码
 */
export function generateSessionCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除易混淆字符
  let code = '';
  const randomValues = crypto.getRandomValues(new Uint8Array(6));
  for (let i = 0; i < 6; i++) {
    code += chars[randomValues[i] % chars.length];
  }
  return code;
}

/**
 * 加密管理器类 - 管理会话的加密状态
 */
export class CryptoManager {
  private keyPair: SessionKeyPair | null = null;
  private aesKey: CryptoKey | null = null;
  private remotePublicKey: Uint8Array | null = null;
  private _isReady = false;

  /**
   * 初始化加密管理器，生成临时密钥对
   */
  async initialize(): Promise<void> {
    this.keyPair = generateKeyPair();
    this._isReady = false;
    this.aesKey = null;
    this.remotePublicKey = null;
  }

  /**
   * 完成密钥交换，建立加密通道
   * 
   * @param remotePublicKeyBase64 - 对方公钥 (base64)
   */
  async completeKeyExchange(remotePublicKeyBase64: string): Promise<void> {
    if (!this.keyPair) {
      throw new Error('CryptoManager not initialized. Call initialize() first.');
    }

    this.remotePublicKey = decodePublicKey(remotePublicKeyBase64);
    
    // 执行 X25519 密钥交换
    const sharedSecret = deriveSharedSecret(
      this.keyPair.privateKey,
      this.remotePublicKey
    );
    
    // 派生 AES 密钥
    this.aesKey = await deriveAESKey(sharedSecret);
    this._isReady = true;
  }

  /**
   * 获取本地公钥 (base64)
   */
  getPublicKey(): string {
    if (!this.keyPair) {
      throw new Error('CryptoManager not initialized');
    }
    return encodePublicKey(this.keyPair.publicKey);
  }

  /**
   * 检查加密通道是否已建立
   */
  get isReady(): boolean {
    return this._isReady && this.aesKey !== null;
  }

  /**
   * 加密消息
   */
  async encrypt(plaintext: string): Promise<EncryptedMessage> {
    if (!this.aesKey || !this._isReady) {
      throw new Error('Encryption not ready. Complete key exchange first.');
    }
    return encryptMessage(plaintext, this.aesKey);
  }

  /**
   * 解密消息
   */
  async decrypt(encrypted: EncryptedMessage): Promise<string> {
    if (!this.aesKey || !this._isReady) {
      throw new Error('Decryption not ready. Complete key exchange first.');
    }
    return decryptMessage(encrypted, this.aesKey);
  }

  /**
   * 清理密钥材料
   */
  destroy(): void {
    this.keyPair = null;
    this.aesKey = null;
    this.remotePublicKey = null;
    this._isReady = false;
  }
}
