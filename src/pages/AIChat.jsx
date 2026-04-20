import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, RefreshCw, Copy, Trash2 } from 'lucide-react';
import { Card } from '../components/ui';
import { assistantChat } from '../lib/ai';

const PRESETS = [
  { icon: '💼', title: '销售话术', q: '客户问"你们的精油和其他品牌有什么区别？"，我该怎么回答？' },
  { icon: '🎯', title: '客户谈判', q: 'SPA客户想压价 15%，但我只能给 10%，怎么沟通？' },
  { icon: '📦', title: '产品推荐', q: '客户是中医推拿馆，推荐哪些产品？' },
  { icon: '💬', title: '朋友圈', q: '帮我写一段推销乳香精油的朋友圈文案' },
  { icon: '🤝', title: '回访话术', q: '老客户超过 3 个月没下单，回访电话怎么说？' },
  { icon: '📚', title: '产品知识', q: '真正薰衣草和假薰衣草有什么区别？' }
];

export default function AIChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const send = async (text) => {
    const q = (text || input).trim();
    if (!q || loading) return;
    setInput('');
    const newMessages = [...messages, { role: 'user', content: q }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const history = messages.slice(-8); // keep last 8 turns as context
      const answer = await assistantChat(q, history);
      setMessages(m => [...m, { role: 'assistant', content: answer }]);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: '❌ ' + e.message, error: true }]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    if (confirm('清空对话记录？')) setMessages([]);
  };

  const copyMessage = (text) => {
    navigator.clipboard.writeText(text).then(() => alert('已复制'));
  };

  return (
    <div className="max-w-3xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={20} className="text-purple-600" />
          <h2 className="font-semibold text-gray-800">AI 智能助手</h2>
          <span className="text-xs text-gray-500">— 问什么都能答</span>
        </div>
        {messages.length > 0 && (
          <button onClick={clearChat} className="text-xs text-gray-500 hover:text-red-500 flex items-center gap-1">
            <Trash2 size={12} />清空
          </button>
        )}
      </div>

      {/* Presets (only show when chat is empty) */}
      {messages.length === 0 && (
        <Card className="p-4 mb-4 bg-gradient-to-br from-purple-50 to-white">
          <div className="text-sm text-gray-600 mb-3">💡 快速提问（点击即可发送）：</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {PRESETS.map((p, i) => (
              <button
                key={i}
                onClick={() => send(p.q)}
                className="text-left p-3 rounded-lg border border-purple-100 hover:bg-purple-50 transition"
              >
                <div className="text-sm font-medium text-purple-700">{p.icon} {p.title}</div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">{p.q}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Chat area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 mb-4 min-h-0">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              m.role === 'user'
                ? 'bg-purple-600 text-white'
                : m.error
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : 'bg-white text-gray-800 border border-gray-200'
            }`}>
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.role === 'assistant' && !m.error && (
                <button onClick={() => copyMessage(m.content)} className="mt-2 text-xs text-purple-600 hover:underline flex items-center gap-1">
                  <Copy size={10} />复制
                </button>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin" />
              思考中...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2 bg-white rounded-2xl border p-2 shadow-sm">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="问问 AI... 比如：怎么给新客户介绍我们的产品？"
          className="flex-1 px-3 py-2 text-sm focus:outline-none"
          disabled={loading}
        />
        <button
          onClick={() => send()}
          disabled={!input.trim() || loading}
          className="px-4 py-2 text-white rounded-xl disabled:opacity-40 flex items-center gap-1"
          style={{ background: 'linear-gradient(135deg, #6c5ce7, #a29bfe)' }}
        >
          <Send size={14} />发送
        </button>
      </div>
    </div>
  );
}
