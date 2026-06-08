import {
  Button,
  Card,
  Input,
  message,
  Space,
  Spin,
  Typography,
  Upload,
} from 'antd';
import { CloudUploadOutlined, LinkOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload';
import { useState } from 'react';
import { ingestFile, ingestText, ingestUrl, type IngestResult } from '../api';

const { TextArea } = Input;
const { Text } = Typography;

interface Props {
  onDocAdded: (result: IngestResult) => void;
}

export default function DocInputPanel({ onDocAdded }: Props) {
  const [urlInput, setUrlInput] = useState('');
  const [manualText, setManualText] = useState('');
  const [ingesting, setIngesting] = useState(false);

  /** 文件上传 */
  async function handleUpload(file: UploadFile) {
    if (!file.originFileObj) return;
    setIngesting(true);
    try {
      const result = await ingestFile(file.originFileObj as File);
      onDocAdded(result);
      message.success(`已读取 ${result.charCount} 个字符`);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setIngesting(false);
    }
  }

  /** URL 读取 */
  async function handleUrlIngest() {
    const trimmed = urlInput.trim();
    if (!trimmed) return message.warning('请输入链接');
    setIngesting(true);
    try {
      const result = await ingestUrl(trimmed);
      onDocAdded(result);
      setUrlInput('');
      message.success(`已读取 ${result.charCount} 个字符`);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setIngesting(false);
    }
  }

  /** 粘贴文本录入 */
  async function handleManualSubmit() {
    const trimmed = manualText.trim();
    if (!trimmed) return message.warning('请输入需求内容');
    setIngesting(true);
    try {
      const result = await ingestText(trimmed);
      onDocAdded(result);
      setManualText('');
      message.success(`已录入 ${result.charCount} 个字符`);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setIngesting(false);
    }
  }

  return (
    <Card title="📥 录入需求文档" size="small" style={{ marginBottom: 16 }}>
      <Spin spinning={ingesting} tip="读取中...">
        {/* 方式1：直接粘贴 */}
        <TextArea
          placeholder="直接粘贴需求文档内容..."
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          rows={5}
          style={{ marginBottom: 8 }}
        />
        <div style={{ textAlign: 'right', marginBottom: 8 }}>
          <Text type="secondary" style={{ marginRight: 8 }}>
            {manualText.length} 字
          </Text>
          <Button type="primary" size="small" onClick={handleManualSubmit}>
            提交
          </Button>
        </div>

        <div className="divider-text">
          <Text type="secondary">— 或者 —</Text>
        </div>

        {/* 方式2：链接 */}
        <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
          <Input
            prefix={<LinkOutlined />}
            placeholder="粘贴飞书文档链接或网页链接..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onPressEnter={handleUrlIngest}
            disabled={ingesting}
          />
          <Button type="primary" onClick={handleUrlIngest} loading={ingesting}>
            读取
          </Button>
        </Space.Compact>

        <div className="divider-text">
          <Text type="secondary">— 或者 —</Text>
        </div>

        {/* 方式3：拖拽上传 */}
        <Upload.Dragger
          accept=".docx,.pdf,.md,.txt,.markdown"
          maxCount={1}
          showUploadList={false}
          customRequest={({ file }) => handleUpload(file as UploadFile)}
          disabled={ingesting}
          style={{ padding: '12px 0' }}
        >
          <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}>
            <CloudUploadOutlined style={{ fontSize: 22 }} />
          </p>
          <p className="ant-upload-text" style={{ fontSize: 13 }}>
            点击或拖拽文件上传
          </p>
          <p className="ant-upload-hint">支持 .docx .pdf .md .txt</p>
        </Upload.Dragger>
      </Spin>
    </Card>
  );
}
