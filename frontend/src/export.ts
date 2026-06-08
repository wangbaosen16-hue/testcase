import * as XLSX from 'xlsx';
import type { TestCase } from './types';

const HEADERS = [
  '用例ID',
  '所属模块',
  '用例标题',
  '优先级',
  '执行状态',
  '前置条件',
  '操作步骤',
  '预期结果',
  '备注',
];

function toRows(cases: TestCase[]): (string | number)[][] {
  const body = cases.map((c) => [
    c.id,
    c.module,
    c.title,
    c.priority,
    c.status || '未执行',
    c.preconditions,
    c.steps,
    c.expected,
    c.remark,
  ]);
  return [HEADERS, ...body];
}

export function exportExcel(cases: TestCase[], filename = '测试用例'): void {
  const ws = XLSX.utils.aoa_to_sheet(toRows(cases));
  ws['!cols'] = [
    { wch: 10 },
    { wch: 14 },
    { wch: 30 },
    { wch: 8 },
    { wch: 24 },
    { wch: 40 },
    { wch: 40 },
    { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '测试用例');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function exportCsv(cases: TestCase[], filename = '测试用例'): void {
  const ws = XLSX.utils.aoa_to_sheet(toRows(cases));
  const csv = XLSX.utils.sheet_to_csv(ws);
  // 加 BOM 头，避免 Excel 打开中文乱码
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
