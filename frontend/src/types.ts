export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export interface TestPoint {
  id: string;
  module: string;
  title: string;
  category: string;
  priority: Priority;
}

export type CaseStatus = '未执行' | '通过' | '失败';

export interface TestCase {
  id: string;
  module: string;
  title: string;
  priority: Priority;
  preconditions: string;
  steps: string;
  expected: string;
  remark: string;
  doc_id?: string;
  status: CaseStatus;
}
