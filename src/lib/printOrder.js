import { unitPriceHint } from '../components/ui';

function getShippingFee(order) {
  const meta = order?.channelMeta || {};
  const fee = Number(meta.shippingFee ?? meta.freightFee ?? meta.shipping_fee ?? 0);
  return Number.isFinite(fee) ? fee : 0;
}

function money(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function sameMoney(a, b) {
  return Math.abs(money(a) - money(b)) < 0.01;
}

function yuan(n) {
  return `¥${money(n).toLocaleString()}`;
}

export function printOrder(order, customer, seller) {
  const w = window.open('', '_blank');
  if (!w) { alert('请允许弹出窗口'); return; }
  const shippingFee = getShippingFee(order);
  const subtotal = money(order.subtotal);
  const total = money(order.total);
  const discountAmount = money(order.discountAmount);
  const paidAmount = money(order.paidAmount);
  const remaining = Math.max(0, money(total - paidAmount));
  const hasAmountBreakdown = discountAmount > 0 || shippingFee > 0 || !sameMoney(subtotal, total);
  const isFullyPaid = paidAmount > 0 && sameMoney(paidAmount, total);
  const totalSection = !hasAmountBreakdown && isFullyPaid
    ? `<div class="line final"><span>订单金额：</span><span>${yuan(total)}</span></div>`
    : `
      ${hasAmountBreakdown ? `<div class="line"><span>小计：</span><span>${yuan(subtotal)}</span></div>` : ''}
      ${discountAmount > 0 ? `<div class="line" style="color:#e17055"><span>折扣 (${order.discountPercent}%)：</span><span>-${yuan(discountAmount)}</span></div>` : ''}
      ${shippingFee > 0 ? `<div class="line" style="color:#5E7048"><span>运费：</span><span>+${yuan(shippingFee)}</span></div>` : ''}
      <div class="line final"><span>应付金额：</span><span>${yuan(total)}</span></div>
      ${paidAmount > 0 && !isFullyPaid ? `<div class="line" style="color:#7B8F67"><span>已收款：</span><span>${yuan(paidAmount)}</span></div>` : ''}
      ${paidAmount > 0 && remaining > 0 ? `<div class="line" style="color:#8D5F5B"><span>待收款：</span><span>${yuan(remaining)}</span></div>` : ''}
    `;

  const itemRows = order.items.map(it => {
    const hint = it.unitPriceHint || unitPriceHint(it.spec, it.unitPrice);
    return `<tr><td>${it.productName}</td><td>${it.productCode}</td><td>${it.spec}${hint ? `<div style="font-size:11px;color:#9A7320;margin-top:2px">${hint}</div>` : ''}</td><td style="text-align:right">${yuan(it.unitPrice)}</td><td style="text-align:right">${it.quantity}</td><td style="text-align:right">${yuan(it.subtotal)}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>订单 ${order.orderNo}</title>
<style>
  body{font-family:'Noto Sans SC',-apple-system,sans-serif;padding:40px;color:#333;font-size:13px;max-width:800px;margin:0 auto}
  h1{font-size:22px;margin:0;color:#1e1a2e}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1e1a2e;padding-bottom:16px;margin-bottom:20px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 32px;margin-bottom:20px}
  .info-grid .label{color:#888;font-size:12px}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  th{background:#f5f4f7;padding:8px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #ddd}
  td{padding:8px 12px;border-bottom:1px solid #eee}
  .total-section{text-align:right;margin-top:16px}
  .total-section .line{display:flex;justify-content:flex-end;gap:32px;margin:4px 0}
  .total-section .final{font-size:18px;font-weight:700;color:#1e1a2e;border-top:2px solid #1e1a2e;padding-top:8px;margin-top:8px}
  .footer{margin-top:48px;display:flex;justify-content:space-between;padding-top:16px;border-top:1px solid #eee}
  .sig-line{width:200px;border-bottom:1px solid #999;margin-top:40px}
  @media print{body{padding:20px}}
</style></head><body>
<div class="header">
  <div><h1>紫都 ZIDU</h1><div style="color:#888;font-size:12px;margin-top:4px">业务管理平台 · 订单确认单</div></div>
  <div style="text-align:right"><div style="font-size:16px;font-weight:600">${order.orderNo}</div><div style="color:#888;font-size:12px">${order.createdAt}</div></div>
</div>
<div class="info-grid">
  <div><span class="label">客户名称：</span>${customer?.name || '—'}</div>
  <div><span class="label">联系人：</span>${customer?.contact || '—'} ${customer?.phone || ''}</div>
  <div><span class="label">地址：</span>${customer?.address || '—'}</div>
  <div><span class="label">销售：</span>${seller?.name || '—'}</div>
</div>
	<table><thead><tr><th>产品</th><th>编码</th><th>规格</th><th style="text-align:right">单价</th><th style="text-align:right">数量</th><th style="text-align:right">小计</th></tr></thead><tbody>${itemRows}</tbody></table>
	<div class="total-section">
	  ${totalSection}
	</div>
${order.notes ? `<div style="margin-top:16px;padding:12px;background:#f9f9f9;border-radius:4px"><span class="label">备注：</span>${order.notes}</div>` : ''}
<div class="footer">
  <div><div style="font-size:12px;color:#888">客户签字</div><div class="sig-line"></div></div>
  <div><div style="font-size:12px;color:#888">公司盖章</div><div class="sig-line"></div></div>
</div>
<script>setTimeout(()=>window.print(),300)</script>
</body></html>`;

  w.document.write(html);
  w.document.close();
}
