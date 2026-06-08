// 测试点
export interface TestPoint {
  id: string;
  module: string; // 所属模块/功能
  title: string; // 测试点描述
  category: string; // 类型：正向 / 异常 / 边界 / 性能 / 安全 等
  priority: 'P0' | 'P1' | 'P2' | 'P3';
}

// 标准测试用例
export interface TestCase {
  id: string; // 用例ID
  module: string; // 所属模块
  title: string; // 用例标题
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  preconditions: string; // 前置条件
  steps: string; // 操作步骤（多步用换行分隔）
  expected: string; // 预期结果
  remark: string; // 备注
  doc_id?: string; // 关联的文档ID
  status: '未执行' | '通过' | '失败'; // 执行状态
}

// 文档读取结果
export interface IngestResult {
  source: string; // 来源描述
  content: string; // 提取出的纯文本内容
  charCount: number;
}
