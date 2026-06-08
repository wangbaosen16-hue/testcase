import {
  Button,
  Card,
  Empty,
  message,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TestCase, Priority, CaseStatus } from '../types';
import { updateCaseStatus } from '../api';
import { exportCsv, exportExcel } from '../export';
import type { DocItem } from '../api';

const { Text } = Typography;

const priorityColor: Record<Priority, string> = {
  P0: '#e84749',
  P1: '#f5a623',
  P2: '#2f54eb',
  P3: '#8c8c8c',
};

const statusConfig: Record<CaseStatus, { color: string; label: string; icon: React.ReactNode }> = {
  '未执行': { color: '#faad14', label: '未执行', icon: <ExclamationCircleOutlined style={{ color: '#faad14' }} /> },
  '通过': { color: '#52c41a', label: '通过', icon: <CheckCircleOutlined style={{ color: '#52c41a' }} /> },
  '失败': { color: '#e84749', label: '失败', icon: <CloseCircleOutlined style={{ color: '#e84749' }} /> },
};

interface Props {
  cases: TestCase[];
  docs?: DocItem[];
  onStatusChange?: (id: string, status: CaseStatus) => void;
}

export default function TestCaseView({ cases, docs = [], onStatusChange }: Props) {
  const [filterDocId, setFilterDocId] = useState<string | undefined>();

  // 从数据中动态提取唯一模块名作为筛选选项
  const uniqueModules = useMemo(() => {
    const set = new Set(cases.map((c) => c.module).filter(Boolean));
    return [...set].sort();
  }, [cases]);

  // 构建文档 ID -> 标题 的映射
  const docMap = useMemo(() => {
    const map: Record<string, string> = {};
    docs.forEach((d) => {
      map[d.id] = d.title || d.source || d.id;
    });
    return map;
  }, [docs]);

  // 按文档筛选后的数据
  const filteredCases = useMemo(() => {
    if (!filterDocId) return cases;
    return cases.filter((c) => c.doc_id === filterDocId);
  }, [cases, filterDocId]);

  // 关联了文档的用例数
  const docIds = useMemo(() => {
    const set = new Set(cases.map((c) => c.doc_id).filter(Boolean) as string[]);
    return [...set];
  }, [cases]);

  // 动态测量表格容器高度，自适应页面分辨率
  const tableWrapperRef = useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState(400);
  useEffect(() => {
    const el = tableWrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // 扣掉分页栏高度（约 48px），避免分页被顶出可视区
        setTableScrollY(entry.contentRect.height - 48);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cases.length]);

  const columns: ColumnsType<TestCase> = [
    {
      title: '用例ID',
      dataIndex: 'id',
      width: 90,
      render: (v) => <Tag>{v}</Tag>,
    },
    {
      title: '所属模块',
      dataIndex: 'module',
      width: 120,
      filters: uniqueModules.map((m) => ({ text: m, value: m })),
      onFilter: (value, record) => record.module === value,
    },
    {
      title: '用例标题',
      dataIndex: 'title',
      width: 260,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      render: (v: Priority) => <Tag color={priorityColor[v]}>{v}</Tag>,
      filters: ['P0', 'P1', 'P2', 'P3'].map((p) => ({ text: p, value: p })),
      onFilter: (value, record) => record.priority === value,
    },
    {
      title: '执行状态',
      dataIndex: 'status',
      width: 110,
      render: (v: CaseStatus, record: TestCase) => (
        <Select
          size="small"
          value={v || '未执行'}
          style={{ width: 110 }}
          onChange={(val) => handleStatusChange(record.id, val)}
          options={[
            { value: '未执行', label: <span><ExclamationCircleOutlined style={{ color: '#faad14' }} /> 未执行</span> },
            { value: '通过', label: <span><CheckCircleOutlined style={{ color: '#52c41a' }} /> 通过</span> },
            { value: '失败', label: <span><CloseCircleOutlined style={{ color: '#e84749' }} /> 失败</span> },
          ]}
        />
      ),
      filters: [
        { text: '未执行', value: '未执行' },
        { text: '通过', value: '通过' },
        { text: '失败', value: '失败' },
      ],
      onFilter: (value, record) => (record.status || '未执行') === value,
    },
    {
      title: '来源文档',
      dataIndex: 'doc_id',
      width: 140,
      render: (v?: string) =>
        v && docMap[v] ? (
          <Tag color="blue">{docMap[v]}</Tag>
        ) : v ? (
          <Tag>{v}</Tag>
        ) : (
          <Text type="secondary">-</Text>
        ),
      filters: docIds.map((id) => ({ text: docMap[id] || id, value: id })),
      onFilter: (value, record) => record.doc_id === value,
    },
    {
      title: '前置条件',
      dataIndex: 'preconditions',
      width: 220,
      render: (v) => <div style={{ whiteSpace: 'pre-wrap' }}>{v}</div>,
    },
    {
      title: '操作步骤',
      dataIndex: 'steps',
      width: 280,
      render: (v) => <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{v}</pre>,
    },
    {
      title: '预期结果',
      dataIndex: 'expected',
      width: 280,
      render: (v) => <div style={{ whiteSpace: 'pre-wrap' }}>{v}</div>,
    },
    {
      title: '备注',
      dataIndex: 'remark',
      width: 180,
      render: (v) => <div style={{ whiteSpace: 'pre-wrap' }}>{v}</div>,
    },
  ];

  const handleStatusChange = useCallback(
    async (id: string, status: CaseStatus) => {
      // 乐观更新父组件状态
      onStatusChange?.(id, status);
      try {
        await updateCaseStatus(id, status);
      } catch (e: any) {
        message.error('更新状态失败: ' + (e.message || '未知错误'));
        // 回滚到之前的状态
        const prev = cases.find((c) => c.id === id);
        if (prev) onStatusChange?.(id, prev.status);
      }
    },
    [cases, onStatusChange],
  );

  const dataSource = filteredCases.map((c) => ({ ...c, key: c.id }));

  return (
    <Card
      title={
        <Space>
          <span>📋 测试用例</span>
          {cases.length > 0 && <Tag color="blue">{filteredCases.length} / {cases.length} 条</Tag>}
        </Space>
      }
      extra={
        <Space>
          {docIds.length > 0 && (
            <Select
              allowClear
              placeholder="按文档筛选"
              style={{ width: 180 }}
              value={filterDocId}
              onChange={(val) => setFilterDocId(val)}
              options={docIds.map((id) => ({
                value: id,
                label: docMap[id] || id,
              }))}
            />
          )}
          {cases.length > 0 && (
            <>
              <Button icon={<DownloadOutlined />} onClick={() => exportExcel(cases)}>
                导出 Excel
              </Button>
              <Button icon={<DownloadOutlined />} onClick={() => exportCsv(cases)}>
                导出 CSV
              </Button>
            </>
          )}
        </Space>
      }
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '12px 24px' } }}
    >
      {cases.length === 0 ? (
        <Empty description="请先在「需求文档 & 测试点」中生成用例" style={{ marginTop: 120 }} />
      ) : (
        <div ref={tableWrapperRef} style={{ flex: 1, minHeight: 0 }}>
          <Table
            columns={columns}
            dataSource={dataSource}
            scroll={{ x: 1600, y: tableScrollY }}
            size="small"
            pagination={{ pageSize: 20, showSizeChanger: true, showLessItems: true, showTotal: (t) => `共 ${t} 条` }}
            bordered
          />
        </div>
      )}
    </Card>
  );
}
