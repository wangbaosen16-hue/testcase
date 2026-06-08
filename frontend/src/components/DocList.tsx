import {
  Button,
  Card,
  Empty,
  Input,
  List,
  Space,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { DocItem } from '../api';

const { Text } = Typography;

interface Props {
  docs: DocItem[];
  activeDocId: string | null;
  totalSelectedCount: number;
  generating: boolean;
  onSelect: (doc: DocItem) => void;
  onDelete: (id: string) => void;
  onTitleChange: (id: string, title: string) => void;
  onGenerate: () => void;
}

export default function DocList({
  docs,
  activeDocId,
  totalSelectedCount,
  generating,
  onSelect,
  onDelete,
  onTitleChange,
  onGenerate,
}: Props) {
  return (
    <Card
      title={`📄 已导入需求 (${docs.length})`}
      size="small"
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      styles={{ body: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}
      extra={
        totalSelectedCount > 0 && (
          <Button type="primary" size="small" onClick={onGenerate} loading={generating}>
            生成用例 ({totalSelectedCount})
          </Button>
        )
      }
    >
      <div style={{ overflow: 'auto', flex: 1, minHeight: 0, margin: '-12px -12px 0', padding: '12px 12px 0' }}>
        {docs.length === 0 ? (
          <Empty description="暂无需求文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <List
            dataSource={docs}
            renderItem={(doc) => {
              const pointCount = doc.points.length;
              const selCount = doc.points.filter((p: any) => p.selected).length;
              const isActive = doc.id === activeDocId;

              return (
                <Card
                  key={doc.id}
                  size="small"
                  hoverable
                  style={{
                    marginBottom: 8,
                    borderColor: isActive ? '#2f54eb' : undefined,
                  }}
                  styles={{ body: { padding: 10 } }}
                  onClick={() => onSelect(doc)}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Input
                        size="small"
                        variant="borderless"
                        value={doc.title}
                        placeholder="输入标题"
                        onChange={(e) => onTitleChange(doc.id, e.target.value)}
                        onClick={(e: any) => e.stopPropagation()}
                        style={{ fontWeight: 600, fontSize: 13, padding: 0, marginBottom: 2 }}
                      />
                      <Space size={6} style={{ marginTop: 4 }}>
                        {pointCount > 0 ? (
                          <Tag color="blue">{pointCount} 个测试点</Tag>
                        ) : (
                          <Tag>未分析</Tag>
                        )}
                        {selCount > 0 && <Tag color="green">已选 {selCount}</Tag>}
                      </Space>
                    </div>
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(doc.id);
                      }}
                    />
                  </div>
                </Card>
              );
            }}
          />
        )}
      </div>
    </Card>
  );
}
