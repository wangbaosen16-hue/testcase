import {
  Button,
  Layout,
  Menu,
  message,
  Typography,
} from 'antd';
import { FileTextOutlined, LogoutOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import {
  analyze,
  deleteDoc,
  generate,
  getAuthToken,
  getDoc,
  listCases,
  listDocs,
  logout,
  updateDocTitle,
  type DocItem,
  type IngestResult,
} from './api';
import DocInputPanel from './components/DocInputPanel';
import DocList from './components/DocList';
import ErrorBoundary from './components/ErrorBoundary';
import LoginPage from './components/LoginPage';
import TestCaseView from './components/TestCaseView';
import TestPointPanel from './components/TestPointPanel';
import type { TestCase, TestPoint } from './types';

const { Sider, Content } = Layout;
const { Title } = Typography;

// 扩展类型：前端管理选中状态
interface DocItemWithSelection extends DocItem {
  points: (TestPoint & { selected?: boolean })[];
}

const menuItems = [
  { key: 'doc', icon: <FileTextOutlined />, label: '需求文档 & 测试点' },
  { key: 'cases', icon: <ThunderboltOutlined />, label: '测试用例' },
];

export default function App() {
  // ---- 鉴权状态 ----
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!getAuthToken());

  const handleLoginSuccess = useCallback(() => {
    setIsAuthenticated(true);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    setIsAuthenticated(false);
  }, []);

  const [menuKey, setMenuKey] = useState(() => localStorage.getItem('menuKey') || 'doc');

  // ---- 文档列表 ----
  const [docs, setDocs] = useState<DocItemWithSelection[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // ---- 用例 ----
  const [cases, setCases] = useState<TestCase[]>([]);
  const [generating, setGenerating] = useState(false);

  // ---- 分析状态 ----
  const [analyzingDocId, setAnalyzingDocId] = useState<string | null>(null);

  // ---- 补充需求 ----
  const [requirement, setRequirement] = useState('');

  // ---- 初始加载 ----
  useEffect(() => {
    loadDocsFromServer();
    loadCasesFromServer();
  }, []);

  async function loadDocsFromServer() {
    setLoadingDocs(true);
    try {
      const rawDocs = await listDocs();
      // 并行加载所有文档的测试点
      const docsWithPoints = await Promise.all(
        rawDocs.map(async (d) => {
          try {
            const full = await getDoc(d.id);
            return {
              ...full,
              points: (full.points || []).map((p: any) => ({ ...p, selected: false })),
            };
          } catch {
            return { ...d, points: [] };
          }
        }),
      );
      setDocs(docsWithPoints);
    } catch (e: any) {
      message.error('加载文档列表失败: ' + e.message);
    } finally {
      setLoadingDocs(false);
    }
  }

  async function loadCasesFromServer() {
    try {
      const serverCases = await listCases();
      setCases(serverCases);
    } catch {
      // 忽略加载错误
    }
  }

  // ==================== 文档录入 ====================

  const handleDocAdded = useCallback((result: IngestResult) => {
    const newDoc: DocItemWithSelection = {
      id: result.id,
      title: result.title,
      source: result.source,
      content: result.content,
      points: [],
    };
    setDocs((prev) => [newDoc, ...prev]);
    setActiveDocId(result.id);
  }, []);

  // ==================== 文档操作 ====================

  async function handleDeleteDoc(id: string) {
    try {
      await deleteDoc(id);
    } catch (e: any) {
      message.error('删除失败: ' + e.message);
    }
    setDocs((prev) => prev.filter((d) => d.id !== id));
    if (activeDocId === id) {
      setActiveDocId(null);
    }
  }

  async function handleUpdateTitle(id: string, title: string) {
    const prevDocs = docs;
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, title } : d)));
    try {
      await updateDocTitle(id, title);
    } catch (e: any) {
      // 失败时回滚本地状态
      setDocs(prevDocs);
      message.error('更新标题失败: ' + (e.message || '未知错误'));
    }
  }

  function handleSelectDoc(doc: DocItemWithSelection) {
    setActiveDocId(doc.id);
    // 如果未分析，自动触发分析
    if (doc.points.length === 0 && analyzingDocId !== doc.id) {
      handleAnalyze(doc);
    }
  }

  // ==================== 测试点分析 ====================

  async function handleAnalyze(doc: DocItemWithSelection) {
    setAnalyzingDocId(doc.id);
    try {
      const points = await analyze({ doc: doc.content, requirement, docId: doc.id });
      const pointsWithSelection = points.map((p) => ({ ...p, selected: false }));
      setDocs((prev) =>
        prev.map((d) =>
          d.id === doc.id
            ? { ...d, points: pointsWithSelection }
            : d,
        ),
      );
      message.success(`分析完成，共 ${points.length} 个测试点`);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setAnalyzingDocId(null);
    }
  }

  function toggleSelectPoint(docId: string, pointId: string, checked: boolean) {
    setDocs((prev) =>
      prev.map((d) =>
        d.id === docId
          ? {
              ...d,
              points: d.points.map((p) =>
                p.id === pointId ? { ...p, selected: checked } : p,
              ),
            }
          : d,
      ),
    );
  }

  function toggleAllPoints(docId: string) {
    setDocs((prev) =>
      prev.map((d) => {
        if (d.id !== docId) return d;
        const allSelected = d.points.length > 0 && d.points.every((p) => p.selected);
        return {
          ...d,
          points: d.points.map((p) => ({ ...p, selected: !allSelected })),
        };
      }),
    );
  }

  function clearPoints(docId: string) {
    setDocs((prev) =>
      prev.map((d) =>
        d.id === docId
          ? { ...d, points: d.points.map((p) => ({ ...p, selected: false })) }
          : d,
      ),
    );
  }

  // ==================== 用例生成 ====================

  async function handleGenerate() {
    const allSelected: TestPoint[] = [];
    docs.forEach((d) => {
      const chosen = d.points.filter((p) => p.selected).map(({ selected, ...rest }) => rest);
      allSelected.push(...chosen);
    });
    if (allSelected.length === 0) return message.warning('请至少选择一个测试点');

    // 确定用例关联的主文档：优先用当前选中的文档，否则用第一个有选中测试点的文档
    const primaryDocId =
      activeDocId ||
      docs.find((d) => d.points.some((p) => p.selected))?.id;

    const allContent = docs.map((d) => `### ${d.source}\n${d.content}`).join('\n\n');
    setGenerating(true);
    try {
      const result = await generate({
        doc: allContent,
        requirement,
        points: allSelected,
        docId: primaryDocId,
      });
      setCases(result);
      message.success(`生成完成，共 ${result.length} 条用例`);
      setMenuKey('cases');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setGenerating(false);
    }
  }

  // ==================== 计算 ====================

  const activeDoc = docs.find((d) => d.id === activeDocId) || null;
  const totalSelected = docs.reduce(
    (sum, d) => sum + d.points.filter((p) => p.selected).length,
    0,
  );

  // ==================== 渲染 ====================

  if (!isAuthenticated) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <ErrorBoundary>
    <Layout className="app-container">
      <Layout.Header className="app-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0, color: '#fff' }}>
          🧪 AI 测试用例生成平台
        </Title>
        <Button
          type="text"
          icon={<LogoutOutlined />}
          onClick={handleLogout}
          style={{ color: '#fff' }}
        >
          退出登录
        </Button>
      </Layout.Header>

      <Layout style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* ===== 左侧菜单 ===== */}
        <Sider width={200} style={{ background: '#fff', borderRight: '1px solid #f0f0f0' }}>
          <Menu
            mode="inline"
            selectedKeys={[menuKey]}
            onClick={({ key }) => { setMenuKey(key); localStorage.setItem('menuKey', key); }}
            items={menuItems}
            style={{ height: '100%', paddingTop: 12 }}
          />
        </Sider>

        {/* ===== 需求文档 & 测试点 视图 ===== */}
        {menuKey === 'doc' && (
          <>
            {/* 中间：文档录入 + 需求列表 */}
            <Content
              style={{ flex: '0 0 38%', padding: 24, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 360, maxWidth: 560 }}
              className="doc-panel"
            >
              <DocInputPanel onDocAdded={handleDocAdded} />
              <DocList
                docs={docs}
                activeDocId={activeDocId}
                totalSelectedCount={totalSelected}
                generating={generating}
                onSelect={handleSelectDoc}
                onDelete={handleDeleteDoc}
                onTitleChange={handleUpdateTitle}
                onGenerate={handleGenerate}
              />
            </Content>

            {/* 右侧：测试点面板 */}
            <Content
              style={{
                flex: 1,
                minHeight: 0,
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                borderLeft: '1px solid #f0f0f0',
                background: '#fafafa',
              }}
            >
              <TestPointPanel
                doc={activeDoc}
                analyzing={analyzingDocId === activeDoc?.id}
                requirement={requirement}
                onRequirementChange={setRequirement}
                onAnalyze={handleAnalyze}
                onTogglePoint={toggleSelectPoint}
                onToggleAll={toggleAllPoints}
                onClear={clearPoints}
              />
            </Content>
          </>
        )}

        {/* ===== 测试用例视图 ===== */}
        {menuKey === 'cases' && (
          <Content style={{ padding: 24, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            <TestCaseView
              cases={cases}
              docs={docs}
              onStatusChange={(id, status) => {
                setCases((prev) =>
                  prev.map((c) => (c.id === id ? { ...c, status } : c)),
                );
              }}
            />
          </Content>
        )}
      </Layout>
    </Layout>
    </ErrorBoundary>
  );
}
