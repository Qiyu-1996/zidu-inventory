// 将 AI 的 Markdown 式输出转换为美观的卡片式 UI
// 识别：**标题**、## 标题、- 列表、emoji 开头的段落等

function parseBlocks(text) {
  const blocks = [];
  const lines = text.split('\n');
  let currentList = null;

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentList) { blocks.push(currentList); currentList = null; }
      blocks.push({ type: 'spacer' });
      return;
    }

    // 一级/二级标题
    const h2 = trimmed.match(/^#{1,2}\s+(.+)/);
    if (h2) {
      if (currentList) { blocks.push(currentList); currentList = null; }
      blocks.push({ type: 'heading', text: h2[1], level: 2 });
      return;
    }

    // 粗体小标题（**XXX** 单独一行）
    const boldTitle = trimmed.match(/^\*\*(.+?)\*\*[:：]?\s*(.*)$/);
    if (boldTitle && !boldTitle[2]) {
      if (currentList) { blocks.push(currentList); currentList = null; }
      blocks.push({ type: 'heading', text: boldTitle[1], level: 3 });
      return;
    }

    // 列表项
    const listMatch = trimmed.match(/^[-*•]\s+(.+)/) || trimmed.match(/^(\d+)\.\s+(.+)/);
    if (listMatch) {
      const itemText = listMatch[listMatch.length - 1];
      if (!currentList) currentList = { type: 'list', items: [] };
      currentList.items.push(itemText);
      return;
    }

    // 引用块
    if (trimmed.startsWith('>')) {
      if (currentList) { blocks.push(currentList); currentList = null; }
      blocks.push({ type: 'quote', text: trimmed.replace(/^>\s*/, '') });
      return;
    }

    // 普通段落
    if (currentList) { blocks.push(currentList); currentList = null; }
    blocks.push({ type: 'paragraph', text: trimmed });
  });

  if (currentList) blocks.push(currentList);
  return blocks;
}

// 处理行内粗体/斜体
function renderInline(text) {
  // 拆分 **bold** 和普通文本
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <span key={i} className="font-semibold text-purple-700">{p.slice(2, -2)}</span>;
    }
    return <span key={i}>{p}</span>;
  });
}

// 检测 emoji 前缀，用于主题色
function detectTheme(text) {
  if (/👤|🧑|👥/.test(text)) return { color: '#3b82f6', bg: '#eff6ff' }; // 客户画像蓝色
  if (/📊|📈|💰/.test(text)) return { color: '#059669', bg: '#ecfdf5' }; // 数据绿色
  if (/🎯|🔥|⚡/.test(text)) return { color: '#dc2626', bg: '#fef2f2' }; // 行动红色
  if (/💬|📝|✍️/.test(text)) return { color: '#7c3aed', bg: '#f5f3ff' }; // 话术紫色
  if (/📦|🚚|🏷️/.test(text)) return { color: '#ea580c', bg: '#fff7ed' }; // 产品橙色
  if (/💡|🤔|⚠️/.test(text)) return { color: '#ca8a04', bg: '#fefce8' }; // 建议黄色
  return { color: '#6b7280', bg: '#f9fafb' };
}

export function AIRenderer({ text }) {
  if (!text) return null;
  const blocks = parseBlocks(text);

  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        if (b.type === 'spacer') return null;

        if (b.type === 'heading' && b.level === 2) {
          return <h3 key={i} className="text-base font-bold text-gray-800 mt-4 mb-2">{renderInline(b.text)}</h3>;
        }

        if (b.type === 'heading' && b.level === 3) {
          const theme = detectTheme(b.text);
          return (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg font-semibold" style={{ background: theme.bg, color: theme.color }}>
              {b.text}
            </div>
          );
        }

        if (b.type === 'list') {
          return (
            <div key={i} className="space-y-1.5 pl-1">
              {b.items.map((item, j) => (
                <div key={j} className="flex gap-2 items-start">
                  <span className="inline-block w-5 h-5 rounded-full bg-purple-100 text-purple-600 text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">{j + 1}</span>
                  <div className="flex-1 text-sm text-gray-700 leading-relaxed">{renderInline(item)}</div>
                </div>
              ))}
            </div>
          );
        }

        if (b.type === 'quote') {
          return (
            <div key={i} className="border-l-4 border-purple-300 bg-purple-50 px-3 py-2 italic text-sm text-gray-700">
              {renderInline(b.text)}
            </div>
          );
        }

        // paragraph
        return <p key={i} className="text-sm text-gray-700 leading-relaxed">{renderInline(b.text)}</p>;
      })}
    </div>
  );
}
