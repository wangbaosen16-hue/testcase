import axios from 'axios';
import type { TestCase, TestPoint } from './types';

const AUTH_TOKEN_KEY = 'tc_auth_token';

export function getAuthToken(): string {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

const http = axios.create({ baseURL: '/api', timeout: 120000 });

// 自动附加鉴权头
http.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (resp) => resp,
  (err) => {
    const msg = err.response?.data?.error || err.message || '请求失败';
    return Promise.reject(new Error(msg));
  },
);

// ==================== 类型 ====================

export interface DocItem {
  id: string;
  title: string;
  source: string;
  content: string;
  points: TestPoint[];
  created_at?: string;
  updated_at?: string;
}

export interface IngestResult {
  id: string;
  title: string;
  source: string;
  content: string;
  charCount: number;
  points: TestPoint[];
}

// ==================== 认证 ====================

export async function login(username: string, password: string): Promise<{ token: string; user: { username: string } }> {
  const { data } = await http.post('/login', { username, password });
  setAuthToken(data.token);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await http.post('/logout');
  } catch {
    // 忽略网络错误
  }
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

// ==================== 健康检查 ====================

export interface HealthResult {
  ok: boolean;
  model: string;
  llmConfigured: boolean;
  warnings: string[];
}

export async function healthCheck(): Promise<HealthResult> {
  const { data } = await http.get('/health');
  return data;
}

// ==================== 文档 CRUD ====================

export async function listDocs(): Promise<DocItem[]> {
  const { data } = await http.get('/docs');
  // 为每个文档补充测试点
  return data.docs;
}

export async function getDoc(id: string): Promise<DocItem> {
  const { data } = await http.get(`/docs/${id}`);
  return data;
}

export async function ingestUrl(url: string): Promise<IngestResult> {
  const { data } = await http.post('/ingest/url', { url });
  return data;
}

export async function ingestFile(file: File): Promise<IngestResult> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await http.post('/ingest/file', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function ingestText(text: string): Promise<IngestResult> {
  const { data } = await http.post('/ingest/text', { text });
  return data;
}

export async function updateDocTitle(id: string, title: string): Promise<void> {
  await http.patch(`/docs/${id}`, { title });
}

export async function deleteDoc(id: string): Promise<void> {
  await http.delete(`/docs/${id}`);
}

// ==================== 分析 & 生成 ====================

export async function analyze(input: {
  doc: string;
  requirement?: string;
  code?: string;
  docId?: string;
}): Promise<TestPoint[]> {
  const { data } = await http.post('/analyze', input);
  return data.points;
}

export async function generate(input: {
  doc: string;
  requirement?: string;
  points: TestPoint[];
  docId?: string;
}): Promise<TestCase[]> {
  const { data } = await http.post('/generate', input);
  return data.cases;
}

// ==================== 用例 CRUD ====================

export async function listCases(docId?: string): Promise<TestCase[]> {
  const params: Record<string, string> = {};
  if (docId) params.docId = docId;
  const { data } = await http.get('/cases', { params });
  return data.cases;
}

export async function clearCases(docId?: string): Promise<void> {
  const params: Record<string, string> = {};
  if (docId) params.docId = docId;
  await http.delete('/cases', { params });
}

export async function updateCaseStatus(id: string, status: string): Promise<void> {
  await http.patch(`/cases/${id}`, { status });
}
