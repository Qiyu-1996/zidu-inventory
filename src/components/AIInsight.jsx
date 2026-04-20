import { useState } from 'react';
import { Sparkles, X, RefreshCw, Copy } from 'lucide-react';
import { Card } from './ui';

/**
 * 通用 AI 洞察组件
 * Props:
 * - title: 卡片标题
 * - icon: 图标（默认 ✨）
 * - generate: async () => string - 生成内容的函数
 * - buttonText: 按钮文字
 * - autoLoad: 是否打开页面就自动加载
 */
export function AIInsight({ title = 'AI 智能洞察', icon = '✨', generate, buttonText = '生成 AI 分析', autoLoad = false }) {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [shown, setShown] = useState(autoLoad);

  const handleGenerate = async () => {
    setLoading(true); setError(''); setContent('');
    try {
      const result = await generate();
      setContent(result);
      setShown(true);
    } catch (e) {
      setError(e.message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => alert('已复制到剪贴板'));
  };

  if (!shown && !loading) {
    return (
      <Card className="p-4 border-2 border-dashed border-purple-200 bg-gradient-to-br from-purple-50 to-white">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-purple-600" />
            <span className="text-sm font-semibold text-gray-700">{icon} {title}</span>
          </div>
          <button
            onClick={handleGenerate}
            className="px-4 py-1.5 text-xs text-white rounded-lg"
            style={{ background: 'linear-gradient(135deg, #6c5ce7, #a29bfe)' }}
          >
            {buttonText}
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-white">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-purple-600" />
          <span className="text-sm font-semibold text-gray-700">{icon} {title}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={handleGenerate} disabled={loading} title="重新生成" className="p-1.5 rounded hover:bg-white text-gray-500"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
          {content && <button onClick={handleCopy} title="复制" className="p-1.5 rounded hover:bg-white text-gray-500"><Copy size={14} /></button>}
          <button onClick={() => { setShown(false); setContent(''); setError(''); }} title="收起" className="p-1.5 rounded hover:bg-white text-gray-500"><X size={14} /></button>
        </div>
      </div>

      {loading && (
        <div className="py-8 text-center">
          <div className="inline-block w-8 h-8 border-3 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
          <div className="text-xs text-gray-500 mt-2">AI 正在分析中...</div>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">
          {error}
        </div>
      )}

      {content && !loading && (
        <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
          {content}
        </div>
      )}
    </Card>
  );
}
