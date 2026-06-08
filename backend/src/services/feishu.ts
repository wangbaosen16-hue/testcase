import axios from 'axios';
import { config } from '../config';

// 从飞书文档链接中解析出文档 token 与类型
// 支持形如：
//   https://xxx.feishu.cn/docx/<token>
//   https://xxx.feishu.cn/docs/<token>
//   https://xxx.feishu.cn/wiki/<token>
function parseFeishuUrl(url: string): { type: 'docx' | 'doc' | 'wiki'; token: string } | null {
  const m = url.match(/feishu\.cn\/(docx|docs|wiki)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const rawType = m[1];
  const type = rawType === 'docs' ? 'doc' : (rawType as 'docx' | 'wiki');
  return { type, token: m[2] };
}

async function getTenantAccessToken(): Promise<string> {
  const { appId, appSecret } = config.feishu;
  if (!appId || !appSecret) {
    throw new Error('未配置飞书 FEISHU_APP_ID / FEISHU_APP_SECRET，无法读取飞书文档');
  }
  const resp = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: appId, app_secret: appSecret },
  );
  if (resp.data.code !== 0) {
    throw new Error(`获取飞书 token 失败：${resp.data.msg}`);
  }
  return resp.data.tenant_access_token;
}

export async function readFeishuDoc(url: string): Promise<string> {
  const parsed = parseFeishuUrl(url);
  if (!parsed) {
    throw new Error('无法识别的飞书文档链接');
  }
  const token = await getTenantAccessToken();

  // wiki 节点需要先换取真实 obj_token
  let docToken = parsed.token;
  if (parsed.type === 'wiki') {
    const wikiResp = await axios.get(
      `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${parsed.token}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (wikiResp.data.code === 0) {
      docToken = wikiResp.data.data?.node?.obj_token || docToken;
    }
  }

  // 读取 docx 纯文本内容
  const resp = await axios.get(
    `https://open.feishu.cn/open-apis/docx/v1/documents/${docToken}/raw_content`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (resp.data.code !== 0) {
    throw new Error(`读取飞书文档内容失败：${resp.data.msg}`);
  }
  return resp.data.data?.content || '';
}

export function isFeishuUrl(url: string): boolean {
  return /feishu\.cn\/(docx|docs|wiki)\//.test(url);
}
