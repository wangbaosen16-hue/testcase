import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { config } from './config';
import { dbClearCases, dbCreateDoc, dbDeleteDoc, dbGetDoc, dbGetPointsByDoc, dbListCases, dbListDocs, dbSaveCases, dbSavePoints, dbUpdateCaseStatus, dbUpdateDoc, closeDb } from './db';
import { authMiddleware, revokeSessionToken, createSessionToken } from './middleware/auth';
import { readFromFile, readFromUrl } from './services/docReader';
import { analyzeTestPoints, generateTestCases } from './services/llm';

const app = express();
// CORS：允许前端开发服务器和同源访问
app.use(
  cors({
    origin: [
      /^http:\/\/localhost:\d+$/,
      /^http:\/\/127\.0\.0\.1:\d+$/,
    ],
    credentials: true,
  }),
);
app.use(express.json({ limit: '10mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ===== 鉴权（若配置了 AUTH_TOKEN）=====
app.use(authMiddleware);

// 统一的异步错误包装
const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err: Error) => {
      console.error(err);
      const status = err.message.startsWith('未授权') ? 401 : 500;
      res.status(status).json({ error: err.message || '服务器内部错误' });
    });
  };

// ===== 健康检查 =====
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    model: config.llm.model,
    llmConfigured: Boolean(config.llm.apiKey),
    warnings: config.llm.apiKey ? [] : ['未配置 LLM_API_KEY，分析和生成接口无法调用真实大模型'],
  });
});

// ===== 登录 / 登出 =====

app.post(
  '/api/login',
  wrap(async (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: '请输入用户名和密码' });
      return;
    }
    if (username !== config.authUser || password !== config.authPass) {
      res.status(401).json({ error: '用户名或密码错误' });
      return;
    }
    const token = createSessionToken();
    res.json({ token, user: { username } });
  }),
);

app.post(
  '/api/logout',
  wrap(async (req, res) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token) {
      revokeSessionToken(token);
    }
    res.json({ ok: true });
  }),
);

// ===== 文档 CRUD =====

// 获取所有文档列表
app.get(
  '/api/docs',
  wrap(async (_req, res) => {
    const docs = dbListDocs();
    res.json({ docs });
  }),
);

// 获取单个文档（含测试点）
app.get(
  '/api/docs/:id',
  wrap(async (req, res) => {
    const doc = dbGetDoc(req.params.id);
    if (!doc) {
      res.status(404).json({ error: '文档不存在' });
      return;
    }
    const points = dbGetPointsByDoc(req.params.id);
    res.json({ ...doc, points });
  }),
);

// 通过链接读取文档内容并存入数据库
app.post(
  '/api/ingest/url',
  wrap(async (req, res) => {
    const { url } = req.body as { url?: string };
    if (!url) {
      res.status(400).json({ error: '缺少 url 参数' });
      return;
    }
    const { source, content } = await readFromUrl(url);
    const title = content.trim().replace(/\s+/g, ' ').slice(0, 50).trim();
    const id = `DOC-${String(Date.now()).slice(-7)}`;
    const doc = dbCreateDoc({ id, title, source, content });
    res.json({ ...doc, points: [], charCount: content.length });
  }),
);

// 上传文件读取内容并存入数据库
app.post(
  '/api/ingest/file',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: '未接收到文件' });
      return;
    }
    const { source, content } = await readFromFile(req.file.buffer, req.file.originalname);
    const title = content.trim().replace(/\s+/g, ' ').slice(0, 50).trim();
    const id = `DOC-${String(Date.now()).slice(-7)}`;
    const doc = dbCreateDoc({ id, title, source, content });
    res.json({ ...doc, points: [], charCount: content.length });
  }),
);

// 手动录入文本并存入数据库
app.post(
  '/api/ingest/text',
  wrap(async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text) {
      res.status(400).json({ error: '缺少 text 参数' });
      return;
    }
    // 取内容前 50 字符（换行合并为空格）作为默认标题
    const title = text.trim().replace(/\s+/g, ' ').slice(0, 50).trim();
    const id = `DOC-${String(Date.now()).slice(-7)}`;
    const doc = dbCreateDoc({ id, title, source: '文本录入', content: text });
    res.json({ ...doc, points: [], charCount: text.length });
  }),
);

// 更新文档标题
app.patch(
  '/api/docs/:id',
  wrap(async (req, res) => {
    const { title } = req.body as { title?: string };
    const doc = dbUpdateDoc(req.params.id, { title });
    if (!doc) {
      res.status(404).json({ error: '文档不存在' });
      return;
    }
    res.json(doc);
  }),
);

// 删除文档
app.delete(
  '/api/docs/:id',
  wrap(async (req, res) => {
    const ok = dbDeleteDoc(req.params.id);
    if (!ok) {
      res.status(404).json({ error: '文档不存在' });
      return;
    }
    res.json({ ok: true });
  }),
);

// ===== 分析 & 生成 =====

// 分析内容 -> 测试点（同时持久化到数据库）
app.post(
  '/api/analyze',
  wrap(async (req, res) => {
    const { doc, requirement, code, docId } = req.body as {
      doc?: string;
      requirement?: string;
      code?: string;
      docId?: string;
    };
    if (!doc && !requirement && !code) {
      res.status(400).json({ error: '请至少提供文档内容、需求或代码之一' });
      return;
    }
    const points = await analyzeTestPoints({ doc: doc || '', requirement, code });
    // 如果提供了 docId，重新分配唯一 ID 并持久化到数据库
    if (docId) {
      const shortId = docId.slice(-4);
      const persisted = points.map((p, i) => ({
        ...p,
        id: `TP-${shortId}-${String(i + 1).padStart(3, '0')}`,
      }));
      dbSavePoints(docId, persisted);
      res.json({ points: persisted });
      return;
    }
    res.json({ points });
  }),
);

// 选中的测试点 -> 测试用例（同时持久化到数据库）
app.post(
  '/api/generate',
  wrap(async (req, res) => {
    const { doc, requirement, points, docId } = req.body as {
      doc?: string;
      requirement?: string;
      points?: any[];
      docId?: string;
    };
    if (!points || points.length === 0) {
      res.status(400).json({ error: '请至少选择一个测试点' });
      return;
    }
    const cases = await generateTestCases({ doc: doc || '', requirement, points });
    // 按文档关联持久化，重新分配唯一 ID
    if (docId) {
      const shortId = docId.slice(-4);
      const persisted = cases.map((c, i) => ({
        ...c,
        id: `TC-${shortId}-${String(i + 1).padStart(3, '0')}`,
        doc_id: docId,
      }));
      dbSaveCases(persisted, docId);
      res.json({ cases: persisted });
      return;
    }
    // 无 docId 时全局替换
    dbSaveCases(cases);
    res.json({ cases });
  }),
);

// 获取已生成的用例（支持按文档筛选）
app.get(
  '/api/cases',
  wrap(async (req, res) => {
    const docId = req.query.docId as string | undefined;
    const cases = dbListCases(docId || undefined);
    res.json({ cases });
  }),
);

// 清空用例（支持按文档清空）
app.delete(
  '/api/cases',
  wrap(async (req, res) => {
    const docId = req.query.docId as string | undefined;
    dbClearCases(docId || undefined);
    res.json({ ok: true });
  }),
);

// 更新单个用例的执行状态
app.patch(
  '/api/cases/:id',
  wrap(async (req, res) => {
    const { status } = req.body as { status?: string };
    if (!status || !['未执行', '通过', '失败'].includes(status)) {
      res.status(400).json({ error: 'status 必须为 未执行、通过 或 失败' });
      return;
    }
    const ok = dbUpdateCaseStatus(req.params.id, status as '未执行' | '通过' | '失败');
    if (!ok) {
      res.status(404).json({ error: '用例不存在' });
      return;
    }
    res.json({ ok: true, status });
  }),
);

const server = app.listen(config.port, () => {
  console.log(`✅ 后端已启动: http://localhost:${config.port}`);
  if (!config.llm.apiKey) {
    console.warn('⚠️  未配置 LLM_API_KEY，分析和生成接口将不可用');
  }
});

// 优雅退出：关闭数据库连接
const graceful = () => {
  console.log('\n🛑 正在关闭...');
  closeDb();
  server.close(() => process.exit(0));
};
process.on('SIGINT', graceful);
process.on('SIGTERM', graceful);
