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

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function shipmentDocumentHtml(order, customer, seller) {
  const rows = (order.items || []).map(it => `<tr>
    <td>${escapeHtml(it.productCode || '—')}</td>
    <td>${escapeHtml(it.productName || '—')}</td>
    <td>${escapeHtml(it.spec || '—')}</td>
    <td class="qty">${escapeHtml(it.quantity)}</td>
  </tr>`).join('');
  const fullAddress = `${customer?.province ? `${customer.province} ` : ''}${customer?.address || ''}`.trim() || '—';
  const shipment = order.shipment || {};

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>发货单 ${escapeHtml(order.orderNo)}</title>
<style>
  @page{size:A4;margin:14mm}
  *{box-sizing:border-box}
  body{font-family:'Noto Sans SC','PingFang SC',-apple-system,sans-serif;color:#292531;font-size:12px;margin:0;background:#fff}
  .sheet{max-width:190mm;margin:0 auto}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-top:5px solid #5C4B73;border-bottom:2px solid #5C4B73;padding:16px 0 14px}
  h1{font-size:25px;margin:0;color:#3F3650;letter-spacing:0}
  .subtitle{color:#786F65;margin-top:5px}
  .doc-title{text-align:right}.doc-title strong{display:block;font-size:20px;color:#3F3650}.doc-title span{font-family:monospace;color:#6F6679}
  .section{margin-top:18px}.section-title{font-size:14px;font-weight:700;color:#5C4B73;border-left:4px solid #F3BD5B;padding-left:8px;margin-bottom:10px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 28px}.wide{grid-column:1/-1}.label{display:inline-block;color:#8A8178;min-width:66px}
  table{width:100%;border-collapse:collapse;margin-top:8px}th{background:#F5F2F7;color:#625970;text-align:left;padding:9px 10px;border:1px solid #DDD6E2}td{padding:10px;border:1px solid #E7E1E9}.qty{text-align:center;font-size:14px;font-weight:700;width:72px}
  .note{border:1px solid #E6DECF;background:#FBF8F2;padding:10px;min-height:38px;white-space:pre-wrap}
  .signatures{display:grid;grid-template-columns:minmax(0,2fr) minmax(140px,1fr);gap:48px;margin-top:54px}.signature{color:#777}.sig-line{height:34px;border-bottom:1px solid #777}
  .footer{text-align:center;color:#9A9078;font-size:11px;margin-top:30px;padding-top:10px;border-top:1px solid #EAE5EC}
  @media print{.sheet{max-width:none}}
</style></head><body><div class="sheet">
  <div class="header">
    <div><h1>紫都 ZIDU</h1><div class="subtitle">业务管理平台 · 仓库发货单</div></div>
    <div class="doc-title"><strong>发货单</strong><span>${escapeHtml(order.orderNo)}</span></div>
  </div>
  <div class="section"><div class="section-title">收件信息</div><div class="grid">
    <div><span class="label">客户名称</span>${escapeHtml(customer?.name || '—')}</div>
    <div><span class="label">收件人</span>${escapeHtml(customer?.contact || customer?.name || '—')}</div>
    <div><span class="label">联系电话</span>${escapeHtml(customer?.phone || '—')}</div>
    <div><span class="label">销售人员</span>${escapeHtml(seller?.name || '—')}</div>
    <div class="wide"><span class="label">收件地址</span>${escapeHtml(fullAddress)}</div>
  </div></div>
  <div class="section"><div class="section-title">发货明细</div><table><thead><tr><th>产品编号</th><th>产品名称</th><th>规格</th><th class="qty">数量</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${order.shipment ? `<div class="section"><div class="section-title">物流信息</div><div class="grid">
    <div><span class="label">快递公司</span>${escapeHtml(shipment.carrier || '—')}</div>
    <div><span class="label">快递单号</span>${escapeHtml(shipment.trackingNo || '—')}</div>
    <div><span class="label">发货日期</span>${escapeHtml(shipment.shippedAt || '—')}</div>
    <div><span class="label">操作人员</span>${escapeHtml(shipment.operator || '—')}</div>
  </div></div>` : ''}
  ${order.notes ? `<div class="section"><div class="section-title">发货备注</div><div class="note">${escapeHtml(order.notes)}</div></div>` : ''}
  <div class="signatures">
    <div class="signature">发货人员签字<div class="sig-line"></div></div>
    <div class="signature">日期<div class="sig-line"></div></div>
  </div>
  <div class="footer">紫都精油 · 发货核对留档</div>
</div></body></html>`;
}

export function printShipment(order, customer, seller) {
  const w = window.open('', '_blank');
  if (!w) { alert('请允许弹出窗口'); return; }
  w.document.write(shipmentDocumentHtml(order, customer, seller).replace('</body>', '<script>setTimeout(()=>window.print(),300)</script></body>'));
  w.document.close();
}
