import OpenAI from 'openai';
import { config } from '../config';
import { TestCase, TestPoint } from '../types';

/** LLM 上下文保护：单段内容最大字符数（约 15k tokens 留给 prompt 模板、结果和余量） */
const MAX_CONTENT_LENGTH = 30_000;

/**
 * 截断超长内容，保留头部和尾部关键信息。
 * 头部占 60%（需求开头通常最重要），尾部占 40%（避免遗漏结尾的关键约束）。
 */
function truncateContent(content: string, maxLen: number = MAX_CONTENT_LENGTH): string {
  if (content.length <= maxLen) return content;

  const headLen = Math.floor(maxLen * 0.6);
  const tailLen = maxLen - headLen;

  const head = content.slice(0, headLen);
  const tail = content.slice(-tailLen);

  const truncatedChars = content.length - maxLen;
  return [
    head,
    '',
    `⋯⋯ [中间省略 ${truncatedChars.toLocaleString()} 个字符] ⋯⋯`,
    '',
    tail,
  ].join('\n');
}

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!config.llm.apiKey) {
    throw new Error('未配置 LLM_API_KEY，无法调用真实大模型');
  }
  if (!client) {
    client = new OpenAI({ apiKey: config.llm.apiKey, baseURL: config.llm.baseUrl });
  }
  return client;
}

/**
 * 从 LLM 返回文本中提取 JSON。
 * 多策略容错：按优先级尝试多种提取和解析方式，任一成功即返回。
 */
function extractJson(text: string): any {
  // 去掉 markdown 代码块包裹
  const fencedJson = text.match(/```json\s*([\s\S]*?)```/);
  const fencedAny = text.match(/```\s*([\s\S]*?)```/);
  const raw = fencedJson ? fencedJson[1] : fencedAny ? fencedAny[1] : text;

  // 找到第一个 JSON 结构起始位置
  const startArr = raw.indexOf('[');
  const startObj = raw.indexOf('{');
  if (startArr === -1 && startObj === -1) {
    throw new Error('LLM 返回内容中未找到 JSON 结构');
  }
  const from = startObj === -1 ? startArr : startArr === -1 ? startObj : Math.min(startArr, startObj);
  const isArray = from === startArr;
  const openChar = isArray ? '[' : '{';
  const closeChar = isArray ? ']' : '}';

  // 策略1: 平衡括号匹配 → 精确截取
  const candidate1 = balancedSlice(raw, from, openChar, closeChar);
  if (candidate1) {
    const result = tryParse(candidate1);
    if (result !== undefined) return result;
  }

  // 策略2: 简单 lastIndexOf → 宽泛截取
  const lastClose = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'));
  if (lastClose > from) {
    const candidate2 = raw.slice(from, lastClose + 1).trim();
    const result = tryParse(candidate2);
    if (result !== undefined) return result;
  }

  // 策略3: 逐行提取数组元素（LLM 输出大型数组时常每行一个对象）
  const candidate3 = rebuildArrayFromLines(raw, from, openChar, closeChar);
  if (candidate3) {
    const result = tryParse(candidate3);
    if (result !== undefined) return result;
  }

  throw new Error('所有 JSON 提取策略均失败');
}

/** 平衡括号切片，返回 null 表示不匹配 */
function balancedSlice(
  raw: string,
  from: number,
  openChar: string,
  closeChar: string,
): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = from; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return raw.slice(from, i + 1).trim();
    }
  }
  return null;
}

/** 尝试解析：先修常见问题 → 标准 parse → lenient parse */
function tryParse(candidate: string): any | undefined {
  let fixed = fixCommonJsonIssues(candidate);
  try { return JSON.parse(fixed); } catch { /* continue */ }
  try { return lenientParse(fixed); } catch { /* continue */ }
  return undefined;
}

/** 重建数组：当 LLM 输出的 JSON 有结构性损坏时，尝试逐行提取对象 */
function rebuildArrayFromLines(
  raw: string,
  from: number,
  openChar: string,
  closeChar: string,
): string | null {
  if (openChar !== '[') return null; // 只支持数组

  const objects: string[] = [];
  const re = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  // 在候选区间内匹配所有 {...} 对象
  const region = raw.slice(from);
  let m: RegExpExecArray | null;
  while ((m = re.exec(region)) !== null) {
    objects.push(m[0]);
  }

  if (objects.length === 0) return null;
  return `[${objects.join(',')}]`;
}

/** 修复 LLM 常犯的 JSON 格式错误 */
function fixCommonJsonIssues(json: string): string {
  json = json.replace(/,(\s*[}\]])/g, '$1');
  json = json.replace(/\/\/[^\n]*\n/g, '\n');
  json = json.replace(/\/\*[\s\S]*?\*\//g, '');
  return json;
}

/** Lenient 解析：处理无引号 key、单引号字符串、字面换行符等 */
function lenientParse(text: string): any {
  let fixed = text;

  // 1. 修复字符串内的字面控制字符（\n \t \r 等）
  //    找到所有 "..." 字符串，将里面的字面换行替换为 \n
  fixed = fixed.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (_m, inner) => {
    const escaped = inner
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  });

  // 2. 修复无引号的 object key
  fixed = fixed.replace(
    /([\{,]\s*)([a-zA-Z_一-鿿][a-zA-Z0-9_一-鿿]*)(\s*:)/g,
    '$1"$2"$3',
  );

  // 3. 修复单引号字符串作为值
  fixed = fixed.replace(/:(\s*)'([^']*)'/g, ':$1"$2"');

  // 4. 再次清理尾部逗号
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  return JSON.parse(fixed);
}

async function chat(system: string, user: string): Promise<string> {
  const resp = await getClient().chat.completions.create({
    model: config.llm.model,
    temperature: 0.3,
    max_tokens: 8192,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return resp.choices[0]?.message?.content || '';
}

/**
 * 带 JSON 解析重试的 LLM 调用。
 * 解析失败时，将错误信息反馈给模型重试。
 */
async function chatWithJsonRetry(
  systemPrompt: string,
  userPrompt: string,
  maxRetries: number = config.llm.maxRetries,
): Promise<any> {
  let lastText = '';
  let lastError = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const system =
      attempt === 0
        ? systemPrompt
        : [
            systemPrompt,
            '',
            `⚠️ 上次你返回的内容 JSON 解析失败，错误：${lastError}`,
            '请严格只输出合法 JSON，不要有任何额外文字、注释或 markdown 标记。',
            '确保所有字符串用双引号，数组/对象末尾不要有多余逗号。',
          ].join('\n');

    const user =
      attempt === 0
        ? userPrompt
        : [
            userPrompt,
            '',
            `你上次返回的内容是：\n\`\`\`\n${lastText.slice(0, 2000)}\n\`\`\``,
            `解析错误：${lastError}`,
            '请重新生成合法的 JSON。',
          ].join('\n');

    lastText = await chat(system, user);

    try {
      return extractJson(lastText);
    } catch (err: any) {
      lastError = err.message;
      console.warn(`[LLM] JSON 解析失败 (第 ${attempt + 1} 次)，${lastError}`);
      if (attempt === maxRetries) {
        throw new Error(
          `LLM 返回内容经 ${maxRetries + 1} 次尝试仍无法解析为合法 JSON：${lastError}`,
        );
      }
    }
  }
}

// ============ 1. 分析需求 → 测试点 ============
export async function analyzeTestPoints(input: {
  doc: string;
  requirement?: string;
  code?: string;
}): Promise<TestPoint[]> {
  const system =
    '你是一名资深测试工程师。请阅读给定的需求文档、补充需求与相关代码，提炼出全面的功能测试点。' +
    '要覆盖正向流程、异常场景、边界条件、权限、性能与安全等维度。' +
    '只输出 JSON 数组，不要输出多余文字。每个元素字段为：' +
    'module(所属模块), title(测试点描述), category(类型：正向/异常/边界/性能/安全), priority(P0/P1/P2/P3)。';

  const docContent = truncateContent(input.doc || '');
  const codeContent = truncateContent(input.code || '');

  const user = [
    `【需求文档】\n${docContent || '（无）'}`,
    `【补充需求】\n${input.requirement || '（无）'}`,
    `【相关代码】\n${codeContent || '（无）'}`,
  ].join('\n\n');

  const arr = (await chatWithJsonRetry(system, user)) as any[];
  return arr.map((p, i) => ({
    id: `TP-${String(i + 1).padStart(3, '0')}`,
    module: p.module || '未分类',
    title: p.title || '',
    category: p.category || '正向',
    priority: (['P0', 'P1', 'P2', 'P3'].includes(p.priority) ? p.priority : 'P1') as TestPoint['priority'],
  }));
}

// ============ 2. 测试点 → 标准测试用例 ============
/** 单批最大测试点数，超出则分批生成 */
const BATCH_SIZE = 15;

export async function generateTestCases(input: {
  doc: string;
  requirement?: string;
  points: TestPoint[];
}): Promise<TestCase[]> {
  const points = input.points;

  // 少量测试点直接生成
  if (points.length <= BATCH_SIZE) {
    return generateBatch(input.doc || '', input.requirement, points, 0);
  }

  // 分批并行生成
  const batches: TestPoint[][] = [];
  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    batches.push(points.slice(i, i + BATCH_SIZE));
  }

  console.log(`[LLM] 测试点 ${points.length} 个，分 ${batches.length} 批生成用例...`);

  const results = await Promise.all(
    batches.map((batch, idx) =>
      generateBatch(input.doc || '', input.requirement, batch, idx * BATCH_SIZE).catch((err) => {
        console.error(`[LLM] 第 ${idx + 1} 批生成失败:`, err.message);
        return [] as TestCase[];
      }),
    ),
  );

  return results.flat();
}

/** 生成单批用例 */
async function generateBatch(
  doc: string,
  requirement: string | undefined,
  points: TestPoint[],
  idOffset: number,
): Promise<TestCase[]> {
  const system =
    '你是一名资深测试工程师。请根据给定的需求与选中的测试点，为每一个测试点编写对应的标准测试用例。' +
    `本次共 ${points.length} 个测试点，请确保每个测试点都生成一条用例。` +
    '只输出 JSON 数组，不要输出多余文字。每个元素字段为：' +
    'module(所属模块), title(用例标题), priority(P0/P1/P2/P3), preconditions(前置条件), ' +
    'steps(操作步骤，多步用\\n换行), expected(预期结果), remark(备注)。' +
    '步骤要具体可执行，预期结果要明确可验证。';

  const pointsText = points
    .map((p, i) => `${i + 1}. [${p.priority}][${p.category}] ${p.module} / ${p.title}`)
    .join('\n');

  const docContent = truncateContent(doc || '');

  const user = [
    `【需求文档】\n${docContent || '（无）'}`,
    `【补充需求】\n${requirement || '（无）'}`,
    `【需要覆盖的测试点（共 ${points.length} 个，必须全部生成）】\n${pointsText}`,
  ].join('\n\n');

  const arr = (await chatWithJsonRetry(system, user)) as any[];
  return arr.map((c, i) => ({
    id: `TC-${String(idOffset + i + 1).padStart(3, '0')}`,
    module: c.module || '未分类',
    title: c.title || '',
    priority: (['P0', 'P1', 'P2', 'P3'].includes(c.priority) ? c.priority : 'P1') as TestCase['priority'],
    preconditions: c.preconditions || '',
    steps: c.steps || '',
    expected: c.expected || '',
    remark: c.remark || '',
    status: '未执行',
  }));
}
