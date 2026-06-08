import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

/**
 * 内存中的有效会话 token 集合。
 * 登录成功后 token 加入此集合，登出或过期后移除。
 */
const validTokens = new Set<string>();

/** token → 过期时间戳（ms） */
const tokenExpiry = new Map<string, number>();

/** 会话默认有效期：24 小时 */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 生成一个新的会话 token 并登记。
 * @returns 会话 token 字符串
 */
export function createSessionToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  validTokens.add(token);
  tokenExpiry.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

/**
 * 移除会话 token（登出）。
 */
export function revokeSessionToken(token: string): boolean {
  tokenExpiry.delete(token);
  return validTokens.delete(token);
}

/**
 * 鉴权中间件。
 * 优先级：会话 token > 配置的静态 AUTH_TOKEN
 * /api/health 和 /api/login 不受鉴权保护。
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 公开接口：健康检查 & 登录
  if (req.path === '/api/health' || req.path === '/api/login') {
    next();
    return;
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  // 1) 检查会话 token
  if (token && validTokens.has(token)) {
    // 检查是否过期
    const expiry = tokenExpiry.get(token);
    if (expiry && Date.now() > expiry) {
      validTokens.delete(token);
      tokenExpiry.delete(token);
      res.status(401).json({ error: '登录已过期，请重新登录' });
      return;
    }
    next();
    return;
  }

  // 2) 兼容静态 AUTH_TOKEN（如果配置了）
  if (config.authToken && token === config.authToken) {
    next();
    return;
  }

  // 3) 未配置任何鉴权时允许访问（向后兼容）
  if (!config.authToken) {
    next();
    return;
  }

  res.status(401).json({ error: '未授权：请先登录' });
}
