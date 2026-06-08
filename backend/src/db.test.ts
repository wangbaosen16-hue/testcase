import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type * as DbModule from './db';

const tmp = mkdtempSync(path.join(tmpdir(), 'testcase-db-'));
process.env.DB_PATH = path.join(tmp, 'test.db');

let dbModule: typeof DbModule;

before(async () => {
  dbModule = await import('./db');
  dbModule.dbCreateDoc({
    id: 'DOC-TEST',
    title: '测试文档',
    source: '单元测试',
    content: '测试内容',
  });
});

after(() => {
  dbModule.closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('删除文档时同步清理关联测试点和测试用例', () => {
  dbModule.dbSavePoints('DOC-TEST', [
    {
      id: 'TP-TEST-001',
      module: '登录',
      title: '登录成功',
      category: '正向',
      priority: 'P0',
    },
  ]);

  dbModule.dbSaveCases(
    [
      {
        id: 'TC-TEST-001',
        module: '登录',
        title: '登录成功用例',
        priority: 'P0',
        preconditions: '用户已注册',
        steps: '1. 打开登录页\n2. 输入正确账号密码',
        expected: '登录成功',
        remark: '',
        status: '未执行',
      },
    ],
    'DOC-TEST',
  );

  assert.equal(dbModule.dbGetPointsByDoc('DOC-TEST').length, 1);
  assert.equal(dbModule.dbListCases('DOC-TEST').length, 1);

  assert.equal(dbModule.dbDeleteDoc('DOC-TEST'), true);
  assert.equal(dbModule.dbGetPointsByDoc('DOC-TEST').length, 0);
  assert.equal(dbModule.dbListCases('DOC-TEST').length, 0);
});
