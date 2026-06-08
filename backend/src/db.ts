import Database from 'better-sqlite3';
import path from 'path';
import type { TestCase, TestPoint } from './types';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

/** 兼容旧数据库：检测并添加 doc_id 列 */
function migrateDocIdColumn(): string {
  const database = db;
  if (!database) return '';
  try {
    const cols = database.pragma('table_info(test_cases)') as any[];
    if (cols.length === 0) return '';
    if (!cols.some((c: any) => c.name === 'doc_id')) {
      return 'ALTER TABLE test_cases ADD COLUMN doc_id TEXT REFERENCES docs(id) ON DELETE SET NULL;';
    }
  } catch {
    return '';
  }
  return '';
}

/** 兼容旧数据库：检测并添加 status 列 */
function migrateStatusColumn(): string {
  const database = db;
  if (!database) return '';
  try {
    const cols = database.pragma('table_info(test_cases)') as any[];
    if (cols.length === 0) return '';
    if (!cols.some((c: any) => c.name === 'status')) {
      return "ALTER TABLE test_cases ADD COLUMN status TEXT NOT NULL DEFAULT '未执行' CHECK(status IN ('未执行','通过','失败'));";
    }
  } catch {
    return '';
  }
  return '';
}

function initSchema(): void {
  const database = db;
  if (!database) {
    throw new Error('数据库尚未初始化');
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS test_points (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
      module TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '正向',
      priority TEXT NOT NULL CHECK(priority IN ('P0','P1','P2','P3')) DEFAULT 'P1'
    );

    CREATE TABLE IF NOT EXISTS test_cases (
      id TEXT PRIMARY KEY,
      module TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL CHECK(priority IN ('P0','P1','P2','P3')) DEFAULT 'P1',
      preconditions TEXT NOT NULL DEFAULT '',
      steps TEXT NOT NULL DEFAULT '',
      expected TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      doc_id TEXT,
      status TEXT NOT NULL DEFAULT '未执行' CHECK(status IN ('未执行','通过','失败')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 兼容旧数据库：先迁移再建索引
    ${migrateDocIdColumn()}
    ${migrateStatusColumn()}

    CREATE INDEX IF NOT EXISTS idx_test_points_doc_id ON test_points(doc_id);
    CREATE INDEX IF NOT EXISTS idx_test_cases_doc_id ON test_cases(doc_id);
  `);
}

// ==================== Doc CRUD ====================

export interface DocRow {
  id: string;
  title: string;
  source: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function dbListDocs(): DocRow[] {
  return getDb().prepare('SELECT * FROM docs ORDER BY created_at DESC').all() as DocRow[];
}

export function dbGetDoc(id: string): DocRow | undefined {
  return getDb().prepare('SELECT * FROM docs WHERE id = ?').get(id) as DocRow | undefined;
}

export function dbCreateDoc(doc: Pick<DocRow, 'id' | 'title' | 'source' | 'content'>): DocRow {
  getDb()
    .prepare('INSERT INTO docs (id, title, source, content) VALUES (?, ?, ?, ?)')
    .run(doc.id, doc.title, doc.source, doc.content);
  return dbGetDoc(doc.id)!;
}

export function dbUpdateDoc(id: string, updates: Partial<Pick<DocRow, 'title' | 'content'>>): DocRow | undefined {
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return dbGetDoc(id);
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  getDb()
    .prepare(`UPDATE docs SET ${sets.join(', ')} WHERE id = ?`)
    .run(...vals);
  return dbGetDoc(id);
}

export function dbDeleteDoc(id: string): boolean {
  const db = getDb();
  // 旧数据库中的 test_cases.doc_id 可能没有外键约束，这里显式清理关联数据。
  db.prepare('DELETE FROM test_points WHERE doc_id = ?').run(id);
  db.prepare('DELETE FROM test_cases WHERE doc_id = ?').run(id);
  const result = db.prepare('DELETE FROM docs WHERE id = ?').run(id);
  return result.changes > 0;
}

// ==================== TestPoint CRUD ====================

export function dbGetPointsByDoc(docId: string): TestPoint[] {
  return getDb()
    .prepare('SELECT * FROM test_points WHERE doc_id = ? ORDER BY id')
    .all(docId) as TestPoint[];
}

export function dbSavePoints(docId: string, points: TestPoint[]): TestPoint[] {
  const db = getDb();
  // 替换式写入：删除旧数据再批量插入
  db.prepare('DELETE FROM test_points WHERE doc_id = ?').run(docId);
  const insert = db.prepare(
    'INSERT INTO test_points (id, doc_id, module, title, category, priority) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertMany = db.transaction((pts: TestPoint[]) => {
    for (const p of pts) {
      insert.run(p.id, docId, p.module, p.title, p.category, p.priority);
    }
  });
  insertMany(points);
  return points;
}

// ==================== TestCase CRUD ====================

export function dbListCases(docId?: string): TestCase[] {
  if (docId) {
    return getDb()
      .prepare('SELECT * FROM test_cases WHERE doc_id = ? ORDER BY created_at DESC, id')
      .all(docId) as TestCase[];
  }
  return getDb()
    .prepare('SELECT * FROM test_cases ORDER BY created_at DESC, id')
    .all() as TestCase[];
}

export function dbSaveCases(cases: TestCase[], docId?: string): TestCase[] {
  const db = getDb();
  // 按文档替换用例：只清除指定文档的旧用例
  if (docId) {
    db.prepare('DELETE FROM test_cases WHERE doc_id = ?').run(docId);
  } else {
    db.prepare('DELETE FROM test_cases WHERE doc_id IS NULL').run();
  }
  const insert = db.prepare(
    'INSERT INTO test_cases (id, module, title, priority, preconditions, steps, expected, remark, doc_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertMany = db.transaction((cs: TestCase[]) => {
    for (const c of cs) {
      insert.run(c.id, c.module, c.title, c.priority, c.preconditions, c.steps, c.expected, c.remark, docId || null, c.status || '未执行');
    }
  });
  insertMany(cases);
  return cases;
}

export function dbClearCases(docId?: string): void {
  if (docId) {
    getDb().prepare('DELETE FROM test_cases WHERE doc_id = ?').run(docId);
  } else {
    getDb().prepare('DELETE FROM test_cases').run();
  }
}

/** 更新单个用例的执行状态 */
export function dbUpdateCaseStatus(id: string, status: '未执行' | '通过' | '失败'): boolean {
  const result = getDb()
    .prepare('UPDATE test_cases SET status = ? WHERE id = ?')
    .run(status, id);
  return result.changes > 0;
}

/** 关闭数据库连接（用于优雅退出） */
export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}
