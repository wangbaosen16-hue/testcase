import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 3001,
  /** API 鉴权 Token，为空则不启用鉴权 */
  authToken: process.env.AUTH_TOKEN || '',
  /** 登录用户名（默认 admin） */
  authUser: process.env.AUTH_USER || 'admin',
  /** 登录密码（默认 admin） */
  authPass: process.env.AUTH_PASS || 'admin',
  llm: {
    apiKey: process.env.LLM_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
    model: process.env.LLM_MODEL || 'deepseek-chat',
    /** LLM 调用最大重试次数（JSON 解析失败时重试） */
    maxRetries: Number(process.env.LLM_MAX_RETRIES) || 2,
  },
  feishu: {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
  },
};
