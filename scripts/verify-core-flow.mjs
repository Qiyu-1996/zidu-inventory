import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const env = loadEnv('development', process.cwd(), 'VITE_');
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error('缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY');
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const findings = [];
const checks = [];

function money(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function addFinding(severity, code, message, rows = []) {
  findings.push({ severity, code, message, count: rows.length, rows: rows.slice(0, 10) });
}

async function select(label, table, columns) {
  const { data, error } = await supabase.from(table).select(columns);
  if (error) {
    addFinding('P0', `SCHEMA_${table.toUpperCase()}`, `${label}读取失败：${error.message}`);
    return [];
  }
  checks.push({ label, count: data?.length || 0 });
  return data || [];
}

const products = await select(
  '产品与规格',
  'products',
  'id,code,name,channel,inventory_mode,base_stock_kg,specs:product_specs(id,spec,stock,safe_stock,price)'
);
const orders = await select(
  '订单主链路',
  'orders',
  'id,order_no,created_at,source,status,payment_status,paid_amount,subtotal,discount_amount,total,channel_meta,unpaid_shipping_status,items:order_items(id,product_id,spec_id,quantity,unit_price,subtotal),payments:payment_records(id,amount),shipments(id,carrier,tracking_no,shipped_at)'
);
const afterSales = await select(
  '售后工单',
  'after_sales',
  'id,order_id,type,status,warehouse_at,finance_at,restock_returned,finance_amount'
);
const batches = await select(
  '库存批次',
  'product_batches',
  'id,product_id,spec_id,batch_no,initial_qty,remaining_qty,purchase_order_item_id,receipt_reversed_at'
);
const purchaseItems = await select(
  '采购明细',
  'purchase_order_items',
  'id,po_id,product_name,quantity,received_qty'
);

const negativeStock = [];
for (const product of products) {
  if (product.inventory_mode === 'MASS' && Number(product.base_stock_kg || 0) < 0) {
    negativeStock.push({ product: product.code, stock: product.base_stock_kg, unit: 'kg' });
  }
  for (const spec of product.specs || []) {
    if (Number(spec.stock || 0) < 0) {
      negativeStock.push({ product: product.code, spec: spec.spec, stock: spec.stock, unit: '规格' });
    }
  }
}
if (negativeStock.length) addFinding('P0', 'NEGATIVE_STOCK', '存在负库存，必须在上线前修正。', negativeStock);

const orderMoneyMismatch = [];
const paymentMismatch = [];
const invalidShipping = [];
const missingShipment = [];
for (const order of orders) {
  const itemSubtotal = money((order.items || []).reduce((sum, item) => sum + Number(item.subtotal || 0), 0));
  const expectedItemSubtotal = money((order.items || []).reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0),
    0
  ));
  const recordedSubtotal = money(order.subtotal);
  if (Math.abs(itemSubtotal - expectedItemSubtotal) > 0.01 || Math.abs(recordedSubtotal - itemSubtotal) > 0.01) {
    orderMoneyMismatch.push({
      orderNo: order.order_no,
      recordedSubtotal,
      itemSubtotal,
      expectedItemSubtotal
    });
  }

  const actualPaid = money((order.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  const recordedPaid = money(order.paid_amount);
  if (Math.abs(actualPaid - recordedPaid) > 0.01 || recordedPaid < -0.01) {
    paymentMismatch.push({ orderNo: order.order_no, recordedPaid, actualPaid, total: money(order.total) });
  }

  const shipped = ['SHIPPED', 'DELIVERED', 'COMPLETED'].includes(order.status);
  const approvedUnpaid = order.unpaid_shipping_status === 'APPROVED';
  if (shipped && order.payment_status !== 'PAID' && !approvedUnpaid && Number(order.total || 0) > 0) {
    invalidShipping.push({
      orderNo: order.order_no,
      createdAt: order.created_at,
      source: order.source,
      total: money(order.total),
      status: order.status,
      paymentStatus: order.payment_status,
      unpaidShippingStatus: order.unpaid_shipping_status
    });
  }
  if (shipped && !(order.shipments || []).length) {
    missingShipment.push({ orderNo: order.order_no, status: order.status });
  }
}

if (products.length || orders.length) {
  addFinding(
    'P0',
    'ANON_BUSINESS_DATA_ACCESS',
    '未登录的 anon key 可以读取产品和订单；当前本地角色可被伪造，公网发布前必须完成 Supabase Auth 与 RLS 权限改造。'
  );
}
if (orderMoneyMismatch.length) addFinding('P0', 'ORDER_AMOUNT_MISMATCH', '订单主表小计与商品行金额不一致。', orderMoneyMismatch);
if (paymentMismatch.length) addFinding('P0', 'PAYMENT_MISMATCH', '订单已收金额与收款流水合计不一致。', paymentMismatch);
if (invalidShipping.length) addFinding('P0', 'INVALID_SHIPPING', '存在未收款且未经批准却已发货的订单。', invalidShipping);
if (missingShipment.length) addFinding('P1', 'MISSING_SHIPMENT', '已发货/完成订单缺少物流记录。', missingShipment);

const openAfterSales = new Map();
for (const row of afterSales) {
  if (!['WAREHOUSE_PENDING', 'FINANCE_PENDING'].includes(row.status)) continue;
  const list = openAfterSales.get(row.order_id) || [];
  list.push(row.id);
  openAfterSales.set(row.order_id, list);
}
const duplicateOpenAfterSales = Array.from(openAfterSales.entries())
  .filter(([, ids]) => ids.length > 1)
  .map(([orderId, ids]) => ({ orderId, afterSaleIds: ids }));
if (duplicateOpenAfterSales.length) {
  addFinding('P0', 'DUPLICATE_OPEN_AFTER_SALES', '同一订单存在多张未结售后工单。', duplicateOpenAfterSales);
}

const batchByPurchaseItem = new Map();
for (const batch of batches) {
  if (!batch.purchase_order_item_id || batch.receipt_reversed_at) continue;
  batchByPurchaseItem.set(
    batch.purchase_order_item_id,
    Number(batchByPurchaseItem.get(batch.purchase_order_item_id) || 0) + Number(batch.initial_qty || 0)
  );
}
const purchaseReceiptMismatch = purchaseItems
  .filter(item => Math.abs(Number(item.received_qty || 0) - Number(batchByPurchaseItem.get(item.id) || 0)) > 0.000001)
  .map(item => ({
    itemId: item.id,
    product: item.product_name,
    recordedReceived: Number(item.received_qty || 0),
    activeBatchReceived: Number(batchByPurchaseItem.get(item.id) || 0)
  }));
if (purchaseReceiptMismatch.length) {
  addFinding('P0', 'PURCHASE_RECEIPT_MISMATCH', '采购已收数量与有效入库批次累计不一致。', purchaseReceiptMismatch);
}

const productMap = new Map(products.map(product => [Number(product.id), product]));
const specMap = new Map();
for (const product of products) {
  for (const spec of product.specs || []) specMap.set(Number(spec.id), { ...spec, product });
}
const batchTotals = new Map();
for (const batch of batches) {
  if (Number(batch.remaining_qty || 0) <= 0) continue;
  const key = batch.spec_id ? `S:${batch.spec_id}` : `P:${batch.product_id}`;
  batchTotals.set(key, Number(batchTotals.get(key) || 0) + Number(batch.remaining_qty || 0));
}
const batchExceedsStock = [];
for (const [key, batchQuantity] of batchTotals) {
  if (key.startsWith('S:')) {
    const spec = specMap.get(Number(key.slice(2)));
    if (spec && batchQuantity > Number(spec.stock || 0) + 0.000001) {
      batchExceedsStock.push({ product: spec.product.code, spec: spec.spec, systemStock: spec.stock, batchStock: batchQuantity });
    }
  } else {
    const product = productMap.get(Number(key.slice(2)));
    if (product && batchQuantity > Number(product.base_stock_kg || 0) + 0.000001) {
      batchExceedsStock.push({ product: product.code, unit: 'kg', systemStock: product.base_stock_kg, batchStock: batchQuantity });
    }
  }
}
if (batchExceedsStock.length) addFinding('P0', 'BATCH_EXCEEDS_STOCK', '有效批次余量超过系统总库存。', batchExceedsStock);

const noSellableStock = products.length > 0 && !products.some(product => (
  product.inventory_mode === 'MASS'
    ? Number(product.base_stock_kg || 0) > 0
    : (product.specs || []).some(spec => Number(spec.stock || 0) > 0)
));
if (noSellableStock) addFinding('P0', 'NO_SELLABLE_STOCK', '云端没有任何可售库存，销售无法完成下单。');

const inventoryReadiness = {
  rawProducts: products.filter(product => ['RAW', 'BOTH'].includes(product.channel)).length,
  finishedProducts: products.filter(product => ['FINISHED', 'BOTH'].includes(product.channel)).length,
  rawProductsWithStock: products.filter(product => (
    ['RAW', 'BOTH'].includes(product.channel)
    && Number(product.base_stock_kg || 0) > 0
    && (product.specs || []).some(spec => Number(spec.stock || 0) > 0)
  )).length,
  finishedProductsWithStock: products.filter(product => (
    ['FINISHED', 'BOTH'].includes(product.channel)
    && (product.specs || []).some(spec => Number(spec.stock || 0) > 0)
  )).length,
  sellableSpecs: products.reduce(
    (sum, product) => sum + (product.specs || []).filter(spec => Number(spec.stock || 0) > 0).length,
    0
  )
};
if (inventoryReadiness.finishedProducts > 0 && inventoryReadiness.finishedProductsWithStock === 0) {
  addFinding('P0', 'NO_FINISHED_STOCK', '全部成品规格库存为 0，网页成品目录无法加购。');
}
if (inventoryReadiness.rawProducts > 0 && inventoryReadiness.rawProductsWithStock === 0) {
  addFinding('P0', 'NO_RAW_STOCK', '全部原料重量库存或可售规格库存为 0，网页原料目录无法加购。');
}

const summary = {
  checkedAt: new Date().toISOString(),
  mode: 'READ_ONLY',
  counts: Object.fromEntries(checks.map(check => [check.label, check.count])),
  inventoryReadiness,
  findings,
  verdict: findings.some(item => item.severity === 'P0') ? 'BLOCKED' : findings.length ? 'REVIEW' : 'PASS'
};

console.log(JSON.stringify(summary, null, 2));
if (summary.verdict === 'BLOCKED') process.exitCode = 2;
