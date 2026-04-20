import { fetchAppSettings } from './api';

let _settings = null;

async function loadSettings(force = false) {
  if (_settings && !force) return _settings;
  try {
    _settings = await fetchAppSettings();
    return _settings;
  } catch (e) {
    console.error('Failed to load AI settings:', e);
    throw new Error('无法加载 AI 配置');
  }
}

export function reloadAISettings() { _settings = null; }

export async function chatAI(messages, options = {}) {
  const s = await loadSettings();
  if (!s.ai_api_key) {
    throw new Error('管理员尚未配置 AI API Key。请到【系统管理 → AI 配置】填入 API Key。');
  }
  const url = s.ai_api_url || 'https://api.deepseek.com/chat/completions';
  const model = s.ai_model || 'deepseek-chat';

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${s.ai_api_key}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 1500
    })
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `请求失败 ${resp.status}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 返回格式异常');
  return content;
}

// ═══ Prompts ═══

const CUSTOMER_INSIGHT_SYSTEM = `你是紫都精油的资深销售顾问。根据客户资料，生成一份精炼的客户洞察报告。
回答要求：
- 使用中文，Markdown 格式
- 分 4 段：
  1. **👤 客户画像**（2-3 句概括客户特征）
  2. **📊 消费分析**（基于订单数据分析消费习惯和趋势）
  3. **🎯 推荐行动**（3-5 条具体的下一步行动建议）
  4. **💬 沟通话术**（适合这个客户的 1-2 句销售话术）
- 严格基于提供的数据，不要瞎编
- 总字数控制在 500 字以内`;

const ORDER_INSIGHT_SYSTEM = `你是紫都精油的资深销售顾问。根据订单信息和客户历史，提供订单优化建议。
回答要求：
- 使用中文，Markdown 格式
- 分 3 段：
  1. **📦 订单分析**（这个订单的特点、客户购买逻辑）
  2. **💡 交叉销售机会**（根据当前订单商品，推荐可以追加的 2-3 件产品，说明理由）
  3. **🔄 复购预测与行动**（预测客户何时会再下单，以及应该做什么）
- 总字数控制在 400 字以内`;

const DASHBOARD_INSIGHT_SYSTEM = `你是紫都精油的资深销售教练。根据销售数据给出今日行动建议。
回答要求：
- 使用中文，简洁要点式
- 给出 3-5 条最优先的行动项，每条一行
- 每条前加 emoji 表示类型（🔥紧急 / 📈机会 / ⚠️风险 / 💡建议）
- 基于实际数据，优先推荐高价值/紧急行动
- 总字数 200 字以内`;

const ASSISTANT_SYSTEM = `你是紫都精油公司（ZIDU）的 AI 助理，服务公司内部员工（销售、仓库、管理员）。
公司背景：
- 紫都是一家精油 B2B 供应商，面向约 542 家美容院、SPA、中医馆等
- 9 大产品系列：德国进口系列、中药精油系列、单方精油系列、基础油系列、纯露系列、专业护肤系列、专业水疗系列、养生疗愈系列、芳疗复配
- 主要客户类型：SPA水疗馆、中医推拿馆、足浴/温泉、美容院/头皮理疗、头疗馆、经销商
帮助员工：
- 回答产品、业务、销售相关问题
- 提供专业建议和话术
- 解决工作中遇到的各种问题
使用中文，专业但友好，简洁直接。`;

export async function analyzeCustomer(customer, orders, products) {
  const lines = [];
  lines.push(`客户名称：${customer.name}`);
  lines.push(`类型：${customer.type}`);
  lines.push(`联系人：${customer.contact || '—'}  电话：${customer.phone || '—'}`);
  lines.push(`地址：${customer.address || '—'}`);

  const custOrders = orders.filter(o => o.customerId === customer.id && o.status !== 'CANCELLED');
  const totalAmount = custOrders.reduce((s, o) => s + o.total, 0);
  const avgOrder = custOrders.length ? Math.round(totalAmount / custOrders.length) : 0;

  lines.push('');
  lines.push(`累计订单：${custOrders.length} 笔，总金额 ¥${totalAmount.toLocaleString()}`);
  lines.push(`平均客单价：¥${avgOrder}`);

  if (custOrders.length > 0) {
    const sorted = custOrders.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const lastOrder = sorted[0];
    const daysSince = Math.round((Date.now() - new Date(lastOrder.createdAt).getTime()) / 86400000);
    lines.push(`最近下单：${lastOrder.createdAt}（${daysSince} 天前）`);

    // Top products
    const productMap = {};
    custOrders.forEach(o => o.items.forEach(it => {
      productMap[it.productName] = (productMap[it.productName] || 0) + it.subtotal;
    }));
    const topProducts = Object.entries(productMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topProducts.length) {
      lines.push('常购产品：');
      topProducts.forEach(([name, amt]) => lines.push(`  - ${name}：¥${amt.toLocaleString()}`));
    }

    // Series preference
    const seriesMap = {};
    custOrders.forEach(o => o.items.forEach(it => {
      const p = products.find(p => p.id === it.productId);
      if (p) seriesMap[p.series] = (seriesMap[p.series] || 0) + it.subtotal;
    }));
    const topSeries = Object.entries(seriesMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topSeries.length) {
      lines.push('偏好系列：' + topSeries.map(([s, a]) => `${s}(¥${a.toLocaleString()})`).join('、'));
    }
  } else {
    lines.push('尚未下过任何订单（新客户）');
  }

  return chatAI([
    { role: 'system', content: CUSTOMER_INSIGHT_SYSTEM },
    { role: 'user', content: lines.join('\n') }
  ]);
}

export async function analyzeOrder(order, customer, allOrders, products) {
  const lines = [];
  lines.push(`订单号：${order.orderNo}`);
  lines.push(`客户：${customer?.name || '—'}（${customer?.type || '—'}）`);
  lines.push(`订单日期：${order.createdAt}`);
  lines.push(`订单金额：¥${order.total.toLocaleString()}${order.discountAmount > 0 ? `（折扣 ¥${order.discountAmount}）` : ''}`);
  lines.push('订单商品：');
  order.items.forEach(it => lines.push(`  - ${it.productName}（${it.spec}）x ${it.quantity} = ¥${it.subtotal}`));

  if (customer) {
    const custOrders = allOrders.filter(o => o.customerId === customer.id && o.status !== 'CANCELLED');
    lines.push('');
    lines.push(`该客户累计订单：${custOrders.length} 笔，总金额 ¥${custOrders.reduce((s, o) => s + o.total, 0).toLocaleString()}`);

    // History products (excluding current order)
    const historyProducts = new Set();
    custOrders.filter(o => o.id !== order.id).forEach(o => o.items.forEach(it => historyProducts.add(it.productName)));
    if (historyProducts.size > 0) {
      lines.push(`历史购买过：${Array.from(historyProducts).slice(0, 8).join('、')}`);
    }
  }

  // Available products to suggest
  const currentProdIds = new Set(order.items.map(it => it.productId));
  const suggestibleProds = products.filter(p => !currentProdIds.has(p.id)).slice(0, 20);
  lines.push('');
  lines.push('可推荐的产品（不含当前订单）：');
  suggestibleProds.forEach(p => lines.push(`  - ${p.name}（${p.series}）`));

  return chatAI([
    { role: 'system', content: ORDER_INSIGHT_SYSTEM },
    { role: 'user', content: lines.join('\n') }
  ]);
}

export async function dashboardSuggestions(user, stats) {
  const lines = [];
  lines.push(`员工：${user.name}（角色：${{ ADMIN: '管理员', SALES: '销售', WAREHOUSE: '仓库' }[user.role] || user.role}）`);
  lines.push('');
  lines.push('当前业务状况：');
  lines.push(`- 总销售额：¥${stats.totalRevenue.toLocaleString()}`);
  lines.push(`- 订单总数：${stats.orderCount}`);
  lines.push(`- 客户总数：${stats.customerCount}`);
  lines.push(`- 待处理订单：${stats.pendingCount}`);
  lines.push(`- 低库存商品数：${stats.lowStockCount}`);
  if (stats.dormantCustomers) lines.push(`- 超 60 天未下单的老客户：${stats.dormantCustomers} 家`);
  if (stats.thisWeekOrders !== undefined) lines.push(`- 本周订单数：${stats.thisWeekOrders}`);
  if (stats.overdueTasks) lines.push(`- 逾期跟进任务：${stats.overdueTasks} 条`);

  return chatAI([
    { role: 'system', content: DASHBOARD_INSIGHT_SYSTEM },
    { role: 'user', content: lines.join('\n') }
  ], { maxTokens: 600 });
}

export async function assistantChat(userMessage, history = []) {
  const messages = [{ role: 'system', content: ASSISTANT_SYSTEM }];
  history.forEach(h => messages.push({ role: h.role, content: h.content }));
  messages.push({ role: 'user', content: userMessage });
  return chatAI(messages);
}
