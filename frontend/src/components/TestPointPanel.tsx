import {
  Button,
  Checkbox,
  Collapse,
  Empty,
  Input,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import type { DocItem } from '../api';
import type { Priority } from '../types';

const { TextArea } = Input;
const { Text } = Typography;

const priorityColor: Record<Priority, string> = {
  P0: '#e84749',
  P1: '#f5a623',
  P2: '#2f54eb',
  P3: '#8c8c8c',
};

const categoryColor: Record<string, string> = {
  正向: '#52c41a',
  异常: '#fa8c16',
  边界: '#2f54eb',
  性能: '#722ed1',
  安全: '#eb2f96',
};

interface Props {
  doc: DocItem | null;
  analyzing: boolean;
  requirement: string;
  onRequirementChange: (val: string) => void;
  onAnalyze: (doc: DocItem) => void;
  onTogglePoint: (docId: string, pointId: string, checked: boolean) => void;
  onToggleAll: (docId: string) => void;
  onClear: (docId: string) => void;
}

export default function TestPointPanel({
  doc,
  analyzing,
  requirement,
  onRequirementChange,
  onAnalyze,
  onTogglePoint,
  onToggleAll,
  onClear,
}: Props) {
  return (
    <Spin
      spinning={analyzing}
      tip="AI 分析中..."
      wrapperClassName="point-panel-spin"
    >
      <div className="point-panel-content">
      {!doc ? (
        <Empty description="点击左侧需求文档查看测试点" style={{ marginTop: 120 }} />
      ) : (
        <>
          {/* 操作栏 */}
          <div style={{ marginBottom: 16, flexShrink: 0 }}>
            <Space wrap>
              <TextArea
                placeholder="补充需求说明（可选）..."
                value={requirement}
                onChange={(e) => onRequirementChange(e.target.value)}
                rows={1}
                style={{ width: 220 }}
              />
              <Button type="primary" onClick={() => onAnalyze(doc)} loading={analyzing}>
                {doc.points.length > 0 ? '重新分析' : '分析测试点'}
              </Button>
            </Space>
          </div>

          {doc.points.length === 0 ? (
            <Empty description="点击「分析测试点」开始" />
          ) : (
            <>
              {/* 选择操作 */}
              <div style={{ marginBottom: 12, flexShrink: 0 }}>
                <Space>
                  <Button size="small" onClick={() => onToggleAll(doc.id)}>
                    全选
                  </Button>
                  <Button size="small" onClick={() => onClear(doc.id)}>
                    清空
                  </Button>
                  <Tag color="blue">
                    {doc.points.length} 个 / 已选 {doc.points.filter((p: any) => p.selected).length}
                  </Tag>
                </Space>
              </div>

              {/* 统计 */}
              <Collapse
                ghost
                items={[
                  {
                    key: 'stats',
                    label: '📊 统计',
                    children: (
                      <Space direction="vertical">
                        <div>
                          <Text strong>按类型：</Text>
                          {renderCategoryStats(doc.points)}
                        </div>
                        <div>
                          <Text strong>按优先级：</Text>
                          {renderPriorityStats(doc.points)}
                        </div>
                      </Space>
                    ),
                  },
                ]}
              />

              {/* 测试点列表 */}
              <div className="point-list-wrapper">
                <div className="point-list">
                  <div className="point-list-content">
                    {doc.points.map((p: any) => (
                      <div key={p.id} className="point-item">
                        <Checkbox
                          checked={!!p.selected}
                          onChange={(e) => onTogglePoint(doc.id, p.id, e.target.checked)}
                        >
                          <Space size={4}>
                            <Tag color={categoryColor[p.category] || '#8c8c8c'}>
                              {p.category}
                            </Tag>
                            <Tag color={priorityColor[p.priority as Priority]}>
                              {p.priority}
                            </Tag>
                            <span>
                              [{p.module}] {p.title}
                            </span>
                          </Space>
                        </Checkbox>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
      </div>
    </Spin>
  );
}

function renderCategoryStats(points: any[]) {
  const m: Record<string, number> = {};
  points.forEach((p) => (m[p.category] = (m[p.category] || 0) + 1));
  return Object.entries(m).map(([k, v]) => (
    <Tag key={k} color={categoryColor[k]}>
      {k}: {v}
    </Tag>
  ));
}

function renderPriorityStats(points: any[]) {
  const m: Record<string, number> = {};
  points.forEach((p) => (m[p.priority] = (m[p.priority] || 0) + 1));
  return Object.entries(m).map(([k, v]) => (
    <Tag key={k} color={priorityColor[k as Priority]}>
      {k}: {v}
    </Tag>
  ));
}
