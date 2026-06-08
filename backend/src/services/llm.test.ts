import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type * as LlmModule from './llm';

process.env.LLM_API_KEY = '';

let llmModule: typeof LlmModule;

before(async () => {
  llmModule = await import('./llm');
});

test('未配置 LLM_API_KEY 时拒绝调用真实大模型', async () => {
  await assert.rejects(
    () => llmModule.analyzeTestPoints({ doc: '用户可以使用账号密码登录系统' }),
    /未配置 LLM_API_KEY/,
  );
});
