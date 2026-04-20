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
      temperature: options.temperature ?? 0.6,
      max_tokens: options.maxTokens ?? 1800
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

// ═══ 客户类型场景库 ═══
const CUSTOMER_TYPE_GUIDE = {
  'SPA水疗馆': {
    scene: '典型需求：大瓶装按摩油（500ml/1L）、精油助眠方案、芳香氛围。客户人群：25-45岁女性，追求放松体验与仪式感',
    recommend: '专业水疗系列 SP-PRO（玫瑰檀香身体按摩油、薰衣草身体按摩油）、单方精油（薰衣草、玫瑰、檀香）、芳疗复配（睡美人安睡精油、薰衣草舒眠枕头喷雾）',
    scenarios: 'S1深度睡眠 / S3头皮护理 / S7放松减压。可主推"睡眠方案套装"（薰衣草+玫瑰+洋甘菊）',
    selling: '强调配方的专业性、原料来源可追溯、GC-MS 检测报告。不谈医疗，谈"感官体验升级"'
  },
  '中医推拿馆': {
    scene: '典型需求：中药精油（艾叶、川芎、当归、龙脑、人参）、发热姜油、肩颈按摩油。客户场景：经络疏通、艾灸配合、暖宫养护',
    recommend: '中药精油系列（艾叶、厚朴、龙脑、川芎、当归）、养生疗愈系列 HL-PRO（姜根舒缓油、肩颈舒张养护油）',
    scenarios: 'S5东方经络 / 暖宫养护 / 肩颈舒缓。搭配艾灸、刮痧、拔罐等中医手法',
    selling: '强调"药食同源"、道地药材产地、超临界萃取工艺。对比传统精油突出"中医调理"属性'
  },
  '足浴/温泉': {
    scene: '典型需求：足浴泡油（姜油、当归）、大容量按摩油（1L/5kg）、蒸气精油。客户消耗量极大、价格敏感、重视耐用性',
    recommend: '专业水疗系列 1L 装、养生疗愈系列 HL-PRO、姜根舒缓油',
    scenarios: '暖身足浴 / 驱寒祛湿 / 足底按摩',
    selling: '突出量大优惠、按年签协议、提供专业培训。用"单次使用成本"算账打消价格顾虑'
  },
  '美容院/头皮理疗': {
    scene: '典型需求：护肤类（小花茉莉、乳香面霜）、头皮按摩油（迷迭香、茶树）、玫瑰纯露。客户对品质功效要求高',
    recommend: '专业护肤系列 SC-PRO（小花茉莉洁面乳、女王面霜、抗老面霜）、单方精油（乳香、玫瑰、茶树、迷迭香）、纯露系列',
    scenarios: 'S3头皮护理 / 面部抗老 / 问题肌修复',
    selling: '强调成分纯净、通过 HEBBD 标准。可提供配方定制、联合活动'
  },
  '头疗馆': {
    scene: '典型需求：头皮养护油、舒缓姜油、芳疗复配喷雾。重视清洁、控油、舒缓的专业效果',
    recommend: '养生疗愈系列（头皮养护）、单方精油（迷迭香、薄荷、茶树）、芳疗复配（净呼吸舒畅精油、薰衣草舒眠喷雾）',
    scenarios: 'S3头皮护理 / 减压舒缓 / 助眠',
    selling: '强调头皮科学配方、可搭配店里的按摩/洗护动作'
  },
  '经销商': {
    scene: '需求：大批量、需毛利空间、看重品牌背书。沟通重点：年度返点、区域保护、培训支持',
    recommend: '全线产品，根据其下游客群推荐爆品',
    scenarios: '建议从明星单品切入，逐步引入全线',
    selling: '突出品牌 33 年 B2B 经验、可提供联合营销资源'
  }
};

function getCustomerTypeGuide(type) {
  return CUSTOMER_TYPE_GUIDE[type] || {
    scene: '需先了解该类型客户的具体场景',
    recommend: '待确认',
    scenarios: '待确认',
    selling: '先建立信任，了解其核心需求'
  };
}

// ═══ System Prompts ═══

const CUSTOMER_INSIGHT_SYSTEM = `你是紫都精油的资深 B2B 销售顾问。紫都有 33 年精油供应链经验，产品分 9 大系列，面向 B2B 渠道。

【严格输出格式】使用 Markdown，必须严格按以下 4 个二级标题输出：

## 👤 客户画像
2-3 句话总结：客户类型 + 当前消费等级（新/沉睡/稳定/VIP）+ 核心特征。

## 📊 消费分析
- 至少 3 条具体数据观察（**必须引用具体数字**，如"年消费¥8000"、"最近 45 天未下单"）
- 每条包含"现状"+"判断"（如"订单频次下降，疑似服务场景变少"）

## 🎯 推荐行动（针对此客户类型定制）
- 3-5 条具体行动，每条格式：**【时间】→ 【具体 SKU 或方案】→ 【预期效果】**
- **禁止**空话，如"加强沟通"、"保持关注"、"提升体验"
- 必须结合客户类型的典型场景，推荐紫都具体产品或系列

## 💬 沟通话术
1-2 句可以直接发给客户的口语化话术（称呼+理由+邀请）。

【严格要求】
- 数据不够就写"数据不足"，不要瞎编
- 每条建议必须具体、可执行、结合客户类型
- 总字数 400-600 字`;

const ORDER_INSIGHT_SYSTEM = `你是紫都精油的资深 B2B 销售顾问。针对这笔订单，给出具体可执行的建议。

【严格输出格式】使用 Markdown，必须按以下 3 个二级标题输出：

## 📦 订单分析
2-3 句话解读：订单金额等级、客户类型、购买逻辑。

## 💡 交叉销售机会（3 条）
- 每条格式：**推荐产品 → 理由（基于当前订单和客户类型）→ 预期加购金额**
- 必须从候选产品里选，不要编造
- 和当前订单商品有自然搭配关系

## 🔄 复购预测与行动
- 基于该客户历史频次，预测下次下单时间
- 给出 2-3 条具体的跟进行动

总字数 300-500 字，禁止空话。`;

const DASHBOARD_INSIGHT_SYSTEM = `你是紫都精油的资深销售教练。基于今日数据给出行动建议。

【严格输出格式】：

## 🔥 今日重点
3-5 条行动，每条格式：**【类型】【动作】【目标】**
类型标签：🔥紧急 / 📈机会 / ⚠️风险 / 💡建议

每条 1-2 行，具体可执行。字数 150-300 字。`;

const ASSISTANT_SYSTEM = `你是紫都精油公司（ZIDU）的 AI 助理，服务公司内部员工。

【紫都背景】
- 33 年精油 B2B 供应链经验
- 9 大产品系列：德国进口 / 中药精油 / 单方精油 / 基础油 / 纯露 / 专业护肤 / 专业水疗 / 养生疗愈 / 芳疗复配
- 7 大场景方案（S1深度睡眠、S2释放紧张、S3头皮护理、S4身体排毒、S5东方经络、S6呼吸顺畅、S7暖宫养护）
- 主要客户：SPA馆、中医推拿馆、足浴、美容院、头疗馆、经销商
- 遵循 HEBBD 标准（拉丁学名/化学型/产地可溯/GC-MS 检测）

【任务】
- 回答产品、业务、销售相关问题
- 提供具体话术、方案、搭配建议
- 禁止医疗宣称

回答要求：使用 Markdown 格式，有小标题和列表，易扫读。中文。`;

// ═══ 分析函数 ═══

export async function analyzeCustomer(customer, orders, products) {
  const typeGuide = getCustomerTypeGuide(customer.type);
  const lines = [];
  lines.push(`【客户资料】`);
  lines.push(`名称：${customer.name}`);
  lines.push(`类型：${customer.type}`);
  lines.push(`联系人：${customer.contact || '—'}，电话：${customer.phone || '—'}`);
  lines.push(`地址：${customer.address || '—'}`);
  lines.push(`创建时间：${customer.createdAt ? customer.createdAt.slice(0, 10) : '—'}`);

  const custOrders = orders.filter(o => o.customerId === customer.id && o.status !== 'CANCELLED');
  const totalAmount = custOrders.reduce((s, o) => s + o.total, 0);
  const avgOrder = custOrders.length ? Math.round(totalAmount / custOrders.length) : 0;

  lines.push('');
  lines.push(`【消费数据】`);
  lines.push(`累计订单：${custOrders.length} 笔，总金额 ¥${totalAmount.toLocaleString()}`);
  lines.push(`平均客单价：¥${avgOrder}`);

  if (custOrders.length > 0) {
    const sorted = [...custOrders].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const lastOrder = sorted[0];
    const daysSince = Math.round((Date.now() - new Date(lastOrder.createdAt).getTime()) / 86400000);
    lines.push(`最近下单：${lastOrder.createdAt}（${daysSince} 天前）`);

    // 时间分布
    const now = Date.now();
    const d30 = 30 * 86400000;
    const d90 = 90 * 86400000;
    const d365 = 365 * 86400000;
    const yearOrders = custOrders.filter(o => now - new Date(o.createdAt).getTime() < d365);
    const quarterOrders = custOrders.filter(o => now - new Date(o.createdAt).getTime() < d90);
    const monthOrders = custOrders.filter(o => now - new Date(o.createdAt).getTime() < d30);
    lines.push(`近 30 天下单：${monthOrders.length} 笔 ¥${monthOrders.reduce((s, o) => s + o.total, 0).toLocaleString()}`);
    lines.push(`近 90 天下单：${quarterOrders.length} 笔 ¥${quarterOrders.reduce((s, o) => s + o.total, 0).toLocaleString()}`);
    lines.push(`近 365 天下单：${yearOrders.length} 笔 ¥${yearOrders.reduce((s, o) => s + o.total, 0).toLocaleString()}`);

    // 订单频次
    if (custOrders.length >= 2) {
      const dates = custOrders.map(o => new Date(o.createdAt).getTime()).sort((a, b) => a - b);
      let gaps = 0;
      for (let i = 1; i < dates.length; i++) gaps += dates[i] - dates[i - 1];
      const avgGap = Math.round(gaps / ((dates.length - 1) * 86400000));
      lines.push(`平均下单间隔：${avgGap} 天`);
      if (daysSince > avgGap * 1.5) lines.push(`⚠️ 异常：当前已 ${daysSince} 天未下单，超过平均间隔 ${Math.round(daysSince / avgGap * 100 - 100)}%`);
    }

    // Top products
    const productMap = {};
    custOrders.forEach(o => o.items.forEach(it => {
      productMap[it.productName] = (productMap[it.productName] || 0) + it.subtotal;
    }));
    const topProducts = Object.entries(productMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topProducts.length) {
      lines.push('\n常购产品：');
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
      lines.push('\n偏好系列：' + topSeries.map(([s, a]) => `${s}(¥${a.toLocaleString()})`).join('、'));
    }
  } else {
    lines.push('尚未下过任何订单（新客户）');
  }

  lines.push('');
  lines.push(`【${customer.type} 客户类型画像】`);
  lines.push(`典型场景：${typeGuide.scene}`);
  lines.push(`适合产品：${typeGuide.recommend}`);
  lines.push(`推荐方案：${typeGuide.scenarios}`);
  lines.push(`销售要点：${typeGuide.selling}`);

  return chatAI([
    { role: 'system', content: CUSTOMER_INSIGHT_SYSTEM },
    { role: 'user', content: lines.join('\n') }
  ]);
}

export async function analyzeOrder(order, customer, allOrders, products) {
  const typeGuide = customer ? getCustomerTypeGuide(customer.type) : null;
  const lines = [];
  lines.push(`【订单信息】`);
  lines.push(`订单号：${order.orderNo}`);
  lines.push(`客户：${customer?.name || '—'}（${customer?.type || '—'}）`);
  lines.push(`订单日期：${order.createdAt}`);
  lines.push(`订单金额：¥${order.total.toLocaleString()}${order.discountAmount > 0 ? `（折扣 ¥${order.discountAmount}）` : ''}`);
  lines.push('商品明细：');
  order.items.forEach(it => lines.push(`  - ${it.productName}（${it.spec}）x ${it.quantity} = ¥${it.subtotal}`));

  if (customer) {
    const custOrders = allOrders.filter(o => o.customerId === customer.id && o.status !== 'CANCELLED');
    lines.push('');
    lines.push(`【客户历史】`);
    lines.push(`累计 ${custOrders.length} 笔订单，总金额 ¥${custOrders.reduce((s, o) => s + o.total, 0).toLocaleString()}`);

    if (custOrders.length >= 2) {
      const dates = custOrders.map(o => new Date(o.createdAt).getTime()).sort((a, b) => a - b);
      let gaps = 0;
      for (let i = 1; i < dates.length; i++) gaps += dates[i] - dates[i - 1];
      const avgGap = Math.round(gaps / ((dates.length - 1) * 86400000));
      lines.push(`平均下单间隔：约 ${avgGap} 天`);
    }

    // History products
    const historyProducts = new Set();
    custOrders.filter(o => o.id !== order.id).forEach(o => o.items.forEach(it => historyProducts.add(it.productName)));
    if (historyProducts.size > 0) {
      lines.push(`历史购买过：${Array.from(historyProducts).slice(0, 10).join('、')}`);
    }
  }

  if (typeGuide) {
    lines.push('');
    lines.push(`【${customer.type} 客户类型指南】`);
    lines.push(`推荐产品：${typeGuide.recommend}`);
    lines.push(`场景：${typeGuide.scenarios}`);
  }

  // Candidate products to suggest
  const currentProdIds = new Set(order.items.map(it => it.productId));
  const candidates = products.filter(p => !currentProdIds.has(p.id));
  lines.push('');
  lines.push('【候选产品】（从中挑选 3 个最合适的推荐）');
  candidates.slice(0, 25).forEach(p => {
    const minPrice = Math.min(...p.specs.map(s => s.price));
    lines.push(`  - ${p.name}（${p.series}）起 ¥${minPrice}`);
  });

  return chatAI([
    { role: 'system', content: ORDER_INSIGHT_SYSTEM },
    { role: 'user', content: lines.join('\n') }
  ]);
}

export async function dashboardSuggestions(user, stats) {
  const now = new Date();
  const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  const lines = [];
  lines.push(`【当前时间】${now.getMonth() + 1}月${now.getDate()}日 周${dayOfWeek} ${now.getHours()}点`);
  lines.push(`【员工】${user.name}（${{ADMIN: '管理员', SALES: '销售', WAREHOUSE: '仓库'}[user.role]}）`);
  lines.push('');
  lines.push('【业务状况】');
  lines.push(`- 总销售额：¥${stats.totalRevenue.toLocaleString()}`);
  lines.push(`- 订单总数：${stats.orderCount}`);
  lines.push(`- 客户总数：${stats.customerCount}`);
  lines.push(`- 待处理订单：${stats.pendingCount}`);
  lines.push(`- 低库存商品数：${stats.lowStockCount}`);
  if (stats.dormantCustomers) lines.push(`- 超 60 天未下单的老客户：${stats.dormantCustomers} 家`);
  if (stats.thisWeekOrders !== undefined) lines.push(`- 本周订单数：${stats.thisWeekOrders}`);
  if (stats.overdueTasks) lines.push(`- 逾期跟进任务：${stats.overdueTasks} 条`);

  // Season hint
  const month = now.getMonth() + 1;
  let season = '';
  if (month >= 3 && month <= 5) season = '春季 - 敏感肌修护、排毒焕肤旺季';
  else if (month >= 6 && month <= 8) season = '夏季 - 清凉薄荷、驱蚊、控油旺季';
  else if (month >= 9 && month <= 11) season = '秋季 - 润燥保湿、调理肝脾旺季';
  else season = '冬季 - 暖宫祛寒、艾草姜油、助眠旺季';
  lines.push(`- 当前季节：${season}`);

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
