import { supabase } from './supabase';

// ═══ AUTH ═══
export async function login(phone, password) {
  const { data, error } = await supabase.rpc('login', { p_phone: phone, p_password: password });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function createUser(name, phone, password, role) {
  const { data, error } = await supabase.rpc('create_user', {
    p_name: name, p_phone: phone, p_password: password, p_role: role
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function fetchUsers() {
  const { data, error } = await supabase.from('users_safe').select('*').order('id');
  if (error) throw new Error(error.message);
  return data;
}

export async function adminResetPassword(adminId, targetUserId, newPassword) {
  const { data, error } = await supabase.rpc('admin_reset_password', {
    p_admin_id: adminId, p_target_user_id: targetUserId, p_new_password: newPassword
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function toggleUserStatus(adminId, targetUserId, newStatus) {
  const { data, error } = await supabase.rpc('toggle_user_status', {
    p_admin_id: adminId, p_target_user_id: targetUserId, p_new_status: newStatus
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function updateUserRole(adminId, targetUserId, newRole) {
  const { data, error } = await supabase.rpc('admin_update_user_role', {
    p_admin_id: adminId, p_target_user_id: targetUserId, p_new_role: newRole
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function archiveUser(adminId, targetUserId) {
  const { data, error } = await supabase.rpc('admin_archive_user', {
    p_admin_id: adminId, p_target_user_id: targetUserId
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

// ═══ PRODUCTS ═══
function specSortInfo(spec) {
  const raw = String(spec || '').trim().toLowerCase().replace(/\s+/g, '');
  const match = raw.match(/^(\d+(?:\.\d+)?)(kg|公斤|千克|ml|毫升|l|升|g|克)/);
  if (!match) return { group: 9, value: Number.MAX_SAFE_INTEGER, raw };

  const value = Number(match[1]);
  const unit = match[2];
  if (unit === 'ml' || unit === '毫升') return { group: 1, value, raw };
  if (unit === 'l' || unit === '升') return { group: 1, value: value * 1000, raw };
  if (unit === 'g' || unit === '克') return { group: 2, value, raw };
  return { group: 2, value: value * 1000, raw };
}

function compareSpecs(a, b) {
  const aa = specSortInfo(a?.spec ?? a);
  const bb = specSortInfo(b?.spec ?? b);
  if (aa.group !== bb.group) return aa.group - bb.group;
  if (aa.value !== bb.value) return aa.value - bb.value;
  return aa.raw.localeCompare(bb.raw);
}

function isMissingChannelError(error) {
  return error?.code === 'PGRST204' || /channel.*products|schema cache/i.test(error?.message || '');
}

function productRow(product, includeChannel = true, includeMassInventory = true) {
  const row = {
    code: product.code,
    name: product.name,
    series: product.series,
    origin: product.origin || '中国'
  };
  if (includeMassInventory) Object.assign(row, {
    inventory_mode: product.inventoryMode || 'SKU',
    base_stock_kg: Number(product.baseStockKg || 0),
    safe_stock_kg: Number(product.safeStockKg || 0),
    density_g_ml: product.densityGml ? Number(product.densityGml) : null,
    density_temperature_c: Number(product.densityTemperatureC || 20),
    density_source: product.densitySource || '',
    density_status: product.densityStatus || 'UNSET'
  });
  if (includeChannel) row.channel = product.channel || 'BOTH';
  return row;
}

function isMissingOrderSourceError(error) {
  return error?.code === 'PGRST204' || /source.*orders|channel_meta.*orders|schema cache/i.test(error?.message || '');
}

function isMissingMassInventoryError(error) {
  return error?.code === 'PGRST204' && /inventory_mode|base_stock_kg|density_/i.test(error?.message || '');
}

function isMissingMassInventoryRpc(error) {
  return /zidu_adjust_inventory|schema cache|could not find the function/i.test(error?.message || '');
}

async function adjustInventoryValue(specId, type, quantity, quantityUnit = 'SPEC') {
  const { data, error } = await supabase.rpc('zidu_adjust_inventory', {
    p_spec_id: specId,
    p_type: type,
    p_quantity: Number(quantity || 0),
    p_quantity_unit: quantityUnit
  });
  if (error) throw new Error(error.message);
  return data;
}

function isMissingAfterSalesError(error) {
  return error?.code === 'PGRST200' || error?.code === 'PGRST204' || /after_sales|schema cache/i.test(error?.message || '');
}

function isMissingDeletedOrdersError(error) {
  return error?.code === 'PGRST200' || error?.code === 'PGRST204' || /deleted_orders|schema cache/i.test(error?.message || '');
}

function isMissingCustomerMetaError(error) {
  return error?.code === 'PGRST204' || /province.*customers|distributor_level.*customers|schema cache/i.test(error?.message || '');
}

function customerRow(customer, includeMeta = true) {
  const row = {
    name: customer.name,
    contact: customer.contact,
    phone: customer.phone,
    address: customer.address,
    type: customer.type,
    sales_id: customer.salesId || null
  };
  if (includeMeta) {
    row.province = customer.province || null;
    row.distributor_level = customer.distributorLevel || null;
  }
  return row;
}

function orderRow(order, includeSource = true) {
  const row = {
    order_no: order.orderNo,
    customer_id: order.customerId,
    sales_id: order.salesId,
    status: order.status || 'DRAFT',
    subtotal: order.subtotal,
    discount_percent: order.discountPercent || 0,
    discount_amount: order.discountAmount || 0,
    total: order.total,
    notes: order.notes || '',
    business_type: order.businessType || '院线',
    created_at: order.createdAt
  };
  if (includeSource) {
    row.source = order.source || 'web_admin';
    row.channel_meta = order.channelMeta || {};
  }
  return row;
}

function mapProduct(p) {
  return {
    id: p.id, code: p.code, name: p.name, series: p.series, origin: p.origin, channel: p.channel || 'BOTH',
    inventoryMode: p.inventory_mode || 'SKU',
    baseStockKg: Number(p.base_stock_kg || 0),
    safeStockKg: Number(p.safe_stock_kg || 0),
    densityGml: p.density_g_ml == null ? null : Number(p.density_g_ml),
    densityTemperatureC: Number(p.density_temperature_c || 20),
    densitySource: p.density_source || '',
    densityStatus: p.density_status || 'UNSET',
    specs: (p.specs || []).map(s => ({
      id: s.id, spec: s.spec, price: Number(s.price), cost: Number(s.cost || 0), stock: s.stock, safeStock: s.safe_stock
    })).sort(compareSpecs)
  };
}

export async function fetchProducts() {
  const { data, error } = await supabase.from('products').select('*, specs:product_specs(*)').order('id');
  if (error) throw new Error(error.message);
  return data.map(mapProduct);
}

export async function createProduct(product) {
  let { data: p, error: pe } = await supabase
    .from('products')
    .insert(productRow(product))
    .select().single();
  if (isMissingMassInventoryError(pe)) {
    if ((product.inventoryMode || 'SKU') === 'MASS') throw new Error('请先在 Supabase 运行 migration_v19_mass_inventory.sql');
    const retry = await supabase.from('products').insert(productRow(product, true, false)).select().single();
    p = retry.data;
    pe = retry.error;
  }
  if (isMissingChannelError(pe)) {
    const retry = await supabase.from('products').insert(productRow(product, false, false)).select().single();
    p = retry.data;
    pe = retry.error;
  }
  if (pe) throw new Error(pe.message);

  const { data: specs, error: se } = await supabase.from('product_specs')
    .insert(product.specs.map(s => ({ product_id: p.id, spec: s.spec, price: s.price, cost: s.cost || 0, stock: s.stock || 0, safe_stock: s.safeStock || 10 })))
    .select();
  if (se) throw new Error(se.message);

  return mapProduct({ ...p, specs });
}

export async function updateProduct(product) {
  let { error: pe } = await supabase.from('products')
    .update(productRow(product))
    .eq('id', product.id);
  if (isMissingMassInventoryError(pe)) {
    if ((product.inventoryMode || 'SKU') === 'MASS') throw new Error('请先在 Supabase 运行 migration_v19_mass_inventory.sql');
    const retry = await supabase.from('products').update(productRow(product, true, false)).eq('id', product.id);
    pe = retry.error;
  }
  if (isMissingChannelError(pe)) {
    const retry = await supabase.from('products').update(productRow(product, false, false)).eq('id', product.id);
    pe = retry.error;
  }
  if (pe) throw new Error(pe.message);

  // Get existing specs
  const { data: existing } = await supabase.from('product_specs').select('id').eq('product_id', product.id);
  const existingIds = new Set((existing || []).map(s => s.id));
  const incomingIds = new Set(product.specs.filter(s => s.id).map(s => s.id));

  // Delete removed specs
  for (const eid of existingIds) {
    if (!incomingIds.has(eid)) {
      await supabase.from('product_specs').delete().eq('id', eid);
    }
  }

  // Update existing / insert new specs
  for (const s of product.specs) {
    if (s.id && existingIds.has(s.id)) {
      const specUpdate = { spec: s.spec, price: s.price, cost: s.cost || 0, safe_stock: s.safeStock };
      if ((product.inventoryMode || 'SKU') !== 'MASS') specUpdate.stock = s.stock;
      await supabase.from('product_specs').update(specUpdate).eq('id', s.id);
    } else {
      await supabase.from('product_specs').insert({ product_id: product.id, spec: s.spec, price: s.price, cost: s.cost || 0, stock: s.stock || 0, safe_stock: s.safeStock || 10 });
    }
  }

  // Return fresh product
  const { data } = await supabase.from('products').select('*, specs:product_specs(*)').eq('id', product.id).single();
  return mapProduct(data);
}

export async function deleteProduct(productId) {
  const { error } = await supabase.from('products').delete().eq('id', productId);
  if (error) throw new Error(error.message);
}

// ═══ CUSTOMERS ═══
function mapCustomer(c) {
  return {
    id: c.id, name: c.name, contact: c.contact, phone: c.phone, address: c.address,
    type: c.type, salesId: c.sales_id,
    province: c.province || '', distributorLevel: c.distributor_level || null,
    createdAt: c.created_at,
    notes: (c.notes || []).map(n => ({ id: n.id, text: n.text, by: n.by_user, time: n.created_at }))
  };
}

export async function fetchCustomers() {
  const { data, error } = await supabase.from('customers').select('*, notes:customer_notes(*)').order('id');
  if (error) throw new Error(error.message);
  return data.map(mapCustomer);
}

export async function createCustomer(customer) {
  let { data, error } = await supabase.from('customers')
    .insert(customerRow(customer))
    .select().single();
  if (isMissingCustomerMetaError(error)) {
    const retry = await supabase.from('customers').insert(customerRow(customer, false)).select().single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw new Error(error.message);
  return { ...mapCustomer({ ...data, notes: [] }), notes: [] };
}

export async function updateCustomer(id, fields) {
  let { data, error } = await supabase.from('customers')
    .update(customerRow(fields))
    .eq('id', id).select().single();
  if (isMissingCustomerMetaError(error)) {
    const retry = await supabase.from('customers').update(customerRow(fields, false)).eq('id', id).select().single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteCustomer(customerId) {
  const { error } = await supabase.from('customers').delete().eq('id', customerId);
  if (error) throw new Error(error.message);
}

export async function addCustomerNote(customerId, text, byUser) {
  const { data, error } = await supabase.from('customer_notes')
    .insert({ customer_id: customerId, text, by_user: byUser }).select().single();
  if (error) throw new Error(error.message);
  return { id: data.id, text: data.text, by: data.by_user, time: data.created_at };
}

// ═══ ORDERS ═══
function mapOrder(o) {
  return {
    id: o.id, orderNo: o.order_no, customerId: o.customer_id, salesId: o.sales_id,
    status: o.status, subtotal: Number(o.subtotal), discountPercent: Number(o.discount_percent),
    discountAmount: Number(o.discount_amount), total: Number(o.total), notes: o.notes || '',
    businessType: o.business_type || '院线',
    source: o.source || 'b2b',
    channelMeta: o.channel_meta || null,
    createdAt: o.created_at,
    paymentStatus: o.payment_status || 'UNPAID',
    paidAmount: Number(o.paid_amount || 0),
    items: (o.items || []).map(it => ({
      id: it.id, productId: it.product_id, specId: it.spec_id,
      productName: it.product_name, productCode: it.product_code, spec: it.spec,
      quantity: it.quantity, unitPrice: Number(it.unit_price), unitCost: Number(it.unit_cost || 0), subtotal: Number(it.subtotal)
    })),
    logs: (o.logs || []).sort((a, b) => a.id - b.id).map(l => ({ id: l.id, time: l.time, user: l.user_name, action: l.action })),
    shipment: o.shipment?.[0] ? {
      carrier: o.shipment[0].carrier, trackingNo: o.shipment[0].tracking_no,
      shippedAt: o.shipment[0].shipped_at, operator: o.shipment[0].operator
    } : null,
    payments: (o.payments || []).map(p => ({
      id: p.id, amount: Number(p.amount), method: p.method, note: p.note,
      recordedBy: p.recorded_by, createdAt: p.created_at
    })),
    afterSales: (o.afterSales || []).sort((a, b) => b.id - a.id).map(mapAfterSale)
  };
}

function mapAfterSale(r) {
  const requestNote = r.request_note || '';
  const isFullReturn = /^整单退/.test(requestNote);
  const isRefundOnly = /^仅退款/.test(requestNote);
  return {
    id: r.id,
    orderId: r.order_id,
    type: r.type,
    isFullReturn,
    isRefundOnly,
    status: r.status,
    items: r.items || [],
    requestedAmount: Number(r.requested_amount || 0),
    requestNote,
    createdBy: r.created_by || '',
    createdAt: r.created_at,
    restockReturned: r.restock_returned !== false,
    deductReplacement: r.deduct_replacement !== false,
    warehouseNote: r.warehouse_note || '',
    warehouseBy: r.warehouse_by || '',
    warehouseAt: r.warehouse_at,
    financeAmount: Number(r.finance_amount || 0),
    financeMethod: r.finance_method || '',
    financeNote: r.finance_note || '',
    financeBy: r.finance_by || '',
    financeAt: r.finance_at,
    completedAt: r.completed_at
  };
}

export async function fetchOrders() {
  let { data, error } = await supabase.from('orders')
    .select('*, items:order_items(*), logs:order_logs(*), shipment:shipments(*), payments:payment_records(*), afterSales:after_sales(*)')
    .order('id', { ascending: false });
  if (isMissingAfterSalesError(error)) {
    const retry = await supabase.from('orders')
      .select('*, items:order_items(*), logs:order_logs(*), shipment:shipments(*), payments:payment_records(*)')
      .order('id', { ascending: false });
    data = retry.data;
    error = retry.error;
  }
  if (error) throw new Error(error.message);
  return data.map(mapOrder);
}

function roundMoney(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

async function writeStockAdjustment(specId, productId, type, reason, quantity, note, operatorName) {
  if (!specId || !quantity) return;
  const { data: spec, error: specError } = await supabase.from('product_specs').select('stock').eq('id', specId).single();
  if (specError) throw new Error(specError.message);
  if (!spec) throw new Error('规格不存在');
  const before = Number(spec.stock || 0);
  const after = type === 'IN' ? before + quantity : Math.max(0, before - quantity);
  const { error: updateError } = await supabase.from('product_specs').update({ stock: after }).eq('id', specId);
  if (updateError) throw new Error(updateError.message);
  const { error: logError } = await supabase.from('stock_adjustments').insert({
    spec_id: specId,
    product_id: productId,
    type,
    reason,
    quantity,
    before_stock: before,
    after_stock: after,
    note,
    operator_name: operatorName || ''
  });
  if (logError) throw new Error(logError.message);
}

async function recalculatePaymentState(orderId, total) {
  const { data: payments, error } = await supabase.from('payment_records').select('amount').eq('order_id', orderId);
  if (error) throw new Error(error.message);
  const totalPaid = roundMoney((payments || []).reduce((s, p) => s + Number(p.amount || 0), 0));
  const orderTotal = Number(total || 0);
  const status = orderTotal <= 0 ? (totalPaid > 0 ? 'PAID' : 'UNPAID') : totalPaid >= orderTotal ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID';
  const { error: updateError } = await supabase.from('orders').update({ payment_status: status, paid_amount: totalPaid }).eq('id', orderId);
  if (updateError) throw new Error(updateError.message);
  return { totalPaid, status };
}

function normalizeAfterSaleItems(order, requested) {
  const selected = (requested || [])
    .map(it => ({ itemId: Number(it.itemId), quantity: Math.floor(Number(it.quantity) || 0) }))
    .filter(it => it.itemId && it.quantity > 0)
    .map(req => {
      const item = (order.items || []).find(it => it.id === req.itemId);
      if (!item) throw new Error('售后商品不存在');
      if (req.quantity > Number(item.quantity || 0)) throw new Error(`${item.product_name || '商品'} 数量超出订单数量`);
      return {
        itemId: item.id,
        productId: item.product_id,
        specId: item.spec_id,
        productName: item.product_name,
        productCode: item.product_code,
        spec: item.spec,
        quantity: req.quantity,
        unitPrice: Number(item.unit_price || 0),
        subtotal: roundMoney(req.quantity * Number(item.unit_price || 0))
      };
    });
  if (selected.length === 0) throw new Error('请选择要处理的商品数量');
  return selected;
}

function afterSaleSummary(items) {
  const summary = (items || []).map(it => `${it.productName || ''}(${it.spec || ''})x${it.quantity}`).join('，');
  return summary || '仅退款';
}

function getShippingFeeFromOrderRow(order) {
  const meta = order?.channel_meta || {};
  const fee = Number(meta.shippingFee ?? meta.freightFee ?? meta.shipping_fee ?? 0);
  return Number.isFinite(fee) ? fee : 0;
}

async function insertOrderLog(orderId, time, userName, action) {
  const { error } = await supabase.from('order_logs').insert({
    order_id: orderId,
    time,
    user_name: userName || '',
    action
  });
  if (error) throw new Error(error.message);
}

export async function createAfterSale(orderId, payload) {
  const { data: order, error } = await supabase.from('orders')
    .select('id, order_no, status, paid_amount, total, items:order_items(*)')
    .eq('id', orderId)
    .single();
  if (error) throw new Error(error.message);
  if (!order) throw new Error('订单不存在');
  if (order.status === 'CANCELLED') throw new Error('已取消订单不能发起售后');

  const refundOnly = payload.refundOnly === true;
  const items = refundOnly ? [] : normalizeAfterSaleItems(order, payload.items);
  const type = 'RETURN_REFUND';
  const isFullReturn = payload.fullReturn === true;
  const createdBy = payload.createdBy || '';
  const time = payload.time || new Date().toISOString().slice(0, 16);
  const requestedAmount = refundOnly
    ? roundMoney(Number(payload.requestedAmount || 0))
    : isFullReturn
      ? roundMoney(Number(payload.requestedAmount || 0) || items.reduce((s, it) => s + Number(it.subtotal || 0), 0))
      : roundMoney(items.reduce((s, it) => s + Number(it.subtotal || 0), 0));
  if (requestedAmount < 0 || (refundOnly && requestedAmount <= 0)) throw new Error('退款金额不能小于等于0');
  if (requestedAmount > Number(order.paid_amount || 0) + 0.01) throw new Error('退款金额不能大于当前已收金额');
  const note = (payload.note || '').trim();
  const requestNote = refundOnly
    ? `仅退款${note ? `：${note}` : ''}`
    : isFullReturn
      ? `整单退${note ? `：${note}` : ''}`
      : note;
  const row = {
    order_id: orderId,
    type,
    status: refundOnly ? 'FINANCE_PENDING' : 'WAREHOUSE_PENDING',
    items,
    requested_amount: requestedAmount,
    request_note: requestNote,
    created_by: createdBy
  };
  const { data, error: insertError } = await supabase.from('after_sales').insert(row).select().single();
  if (insertError) throw new Error(insertError.message);
  const action = `发起售后：${refundOnly ? '仅退款' : isFullReturn ? '整单退' : '退货退款'}；${afterSaleSummary(items)}；退款 ¥${requestedAmount}${note ? `；${note}` : ''}`;
  await insertOrderLog(orderId, time, createdBy, action);
  return mapAfterSale(data);
}

async function fetchAfterSaleRow(afterSaleId) {
  const { data, error } = await supabase.from('after_sales')
    .select('*, order:orders(id, order_no, status, subtotal, discount_percent, total, paid_amount, channel_meta, items:order_items(*))')
    .eq('id', afterSaleId)
    .single();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('售后单不存在');
  return data;
}

export async function processAfterSaleWarehouse(afterSaleId, payload) {
  const row = await fetchAfterSaleRow(afterSaleId);
  if (row.status !== 'WAREHOUSE_PENDING') throw new Error('该售后单不在待仓库处理状态');
  const items = row.items || [];
  const restockReturned = payload.restockReturned !== false;
  const deductReplacement = row.type === 'EXCHANGE' && payload.deductReplacement !== false;
  const operatorName = payload.operatorName || '';
  const time = payload.time || new Date().toISOString().slice(0, 16);
  const note = (payload.note || '').trim();

  for (const item of items) {
    if (item.specId && restockReturned) {
      await writeStockAdjustment(
        item.specId,
        item.productId,
        'IN',
        'RETURN',
        item.quantity,
        `${row.type === 'RETURN_REFUND' ? '售后退回' : '换货退回'} ${row.order?.order_no || ''} ${item.productName || ''}`,
        operatorName
      );
    }
    if (item.specId && deductReplacement) {
      await writeStockAdjustment(
        item.specId,
        item.productId,
        'OUT',
        'ORDER',
        item.quantity,
        `换货补发 ${row.order?.order_no || ''} ${item.productName || ''}`,
        operatorName
      );
    }
  }

  const financePending = row.type === 'RETURN_REFUND' || Number(row.requested_amount || 0) !== 0;
  const nextStatus = financePending ? 'FINANCE_PENDING' : 'COMPLETED';
  const { error } = await supabase.from('after_sales').update({
    status: nextStatus,
    restock_returned: restockReturned,
    deduct_replacement: deductReplacement,
    warehouse_note: note,
    warehouse_by: operatorName,
    warehouse_at: new Date().toISOString(),
    completed_at: nextStatus === 'COMPLETED' ? new Date().toISOString() : null
  }).eq('id', afterSaleId);
  if (error) throw new Error(error.message);

  const action = `仓库处理售后：${afterSaleSummary(items)}；${restockReturned ? '退回已入库' : '退回不入库'}${row.type === 'EXCHANGE' ? `；${deductReplacement ? '补发已扣库存' : '补发不扣库存'}` : ''}${note ? `；${note}` : ''}`;
  await insertOrderLog(row.order_id, time, operatorName, action);
  return { status: nextStatus };
}

async function reduceReturnedOrderItems(order, items, refundAmount = 0) {
  const remainingItems = (order.items || []).map(it => ({ ...it }));
  for (const item of items) {
    const current = remainingItems.find(it => it.id === item.itemId);
    if (!current) throw new Error(`${item.productName || '商品'} 已不在订单明细中`);
    const newQty = Number(current.quantity || 0) - Number(item.quantity || 0);
    if (newQty < 0) throw new Error(`${item.productName || '商品'} 数量超出订单数量`);
    current.quantity = newQty;
    current.subtotal = roundMoney(newQty * Number(current.unit_price || 0));
    if (newQty <= 0) {
      const { error } = await supabase.from('order_items').delete().eq('id', current.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from('order_items')
        .update({ quantity: newQty, subtotal: current.subtotal })
        .eq('id', current.id);
      if (error) throw new Error(error.message);
    }
  }

  const keptItems = remainingItems.filter(it => Number(it.quantity || 0) > 0);
  const subtotal = roundMoney(keptItems.reduce((s, it) => s + Number(it.subtotal || 0), 0));
  const shippingFee = keptItems.length > 0 ? getShippingFeeFromOrderRow(order) : 0;
  const total = refundAmount > 0
    ? Math.max(0, roundMoney(Number(order.total || 0) - refundAmount))
    : roundMoney(subtotal - roundMoney(subtotal * Number(order.discount_percent || 0) / 100) + shippingFee);
  const discountAmount = Math.max(0, roundMoney(subtotal + shippingFee - total));
  const orderPatch = { subtotal, discount_amount: discountAmount, total };
  if (keptItems.length === 0) orderPatch.status = 'COMPLETED';
  const { error } = await supabase.from('orders')
    .update(orderPatch)
    .eq('id', order.id);
  if (error) throw new Error(error.message);
  return { subtotal, discountAmount, total, fullReturn: keptItems.length === 0 };
}

export async function completeAfterSaleFinance(afterSaleId, payload) {
  const row = await fetchAfterSaleRow(afterSaleId);
  if (row.status !== 'FINANCE_PENDING') throw new Error('该售后单不在待财务处理状态');
  const operatorName = payload.operatorName || '';
  const time = payload.time || new Date().toISOString().slice(0, 16);
  const note = (payload.note || '').trim();
  const financeAmount = roundMoney(Number(payload.amount || 0));
  const refundOnly = /^仅退款/.test(row.request_note || '');
  const expectedRefund = roundMoney(Number(row.requested_amount || 0));
  if (row.type === 'RETURN_REFUND') {
    if (financeAmount >= 0) throw new Error('请记录退款金额');
    if (expectedRefund > 0 && Math.abs(Math.abs(financeAmount) - expectedRefund) > 0.01) {
      throw new Error('退款金额必须等于售后申请金额');
    }
  }
  if (financeAmount < 0 && Math.abs(financeAmount) > Number(row.order?.paid_amount || 0) + 0.01) {
    throw new Error('退款金额不能大于当前已收金额');
  }

  let total = Number(row.order?.total || 0);
  if (row.type === 'RETURN_REFUND' && !refundOnly) {
    const totals = await reduceReturnedOrderItems(row.order, row.items || [], expectedRefund);
    total = totals.total;
  } else if (financeAmount !== 0) {
    const subtotal = Math.max(0, roundMoney(Number(row.order?.subtotal || 0) + financeAmount));
    total = Math.max(0, roundMoney(Number(row.order?.total || 0) + financeAmount));
    const { error } = await supabase.from('orders')
      .update({ subtotal, total })
      .eq('id', row.order_id);
    if (error) throw new Error(error.message);
  }

  if (financeAmount !== 0) {
    const { error } = await supabase.from('payment_records').insert({
      order_id: row.order_id,
      amount: financeAmount,
      method: payload.method || '转账',
      note: `${financeAmount < 0 ? '退款' : '补款'}：${note || afterSaleSummary(row.items || [])}`,
      recorded_by: operatorName
    });
    if (error) throw new Error(error.message);
  }
  const payment = await recalculatePaymentState(row.order_id, total);
  const { error } = await supabase.from('after_sales').update({
    status: 'COMPLETED',
    finance_amount: financeAmount,
    finance_method: payload.method || '转账',
    finance_note: note,
    finance_by: operatorName,
    finance_at: new Date().toISOString(),
    completed_at: new Date().toISOString()
  }).eq('id', afterSaleId);
  if (error) throw new Error(error.message);

  const action = `财务处理售后：${financeAmount < 0 ? '退款' : financeAmount > 0 ? '补款' : '无退款/补款'} ¥${Math.abs(financeAmount)}；${afterSaleSummary(row.items || [])}${note ? `；${note}` : ''}`;
  await insertOrderLog(row.order_id, time, operatorName, action);
  return { total, paidAmount: payment.totalPaid, paymentStatus: payment.status };
}

export async function processOrderAfterSale(orderId, payload) {
  const { data: order, error } = await supabase.from('orders')
    .select('id, order_no, status, subtotal, discount_percent, total, paid_amount, items:order_items(*)')
    .eq('id', orderId)
    .single();
  if (error) throw new Error(error.message);
  if (!order) throw new Error('订单不存在');
  if (order.status === 'CANCELLED') throw new Error('已取消订单不能处理售后');

  const requested = (payload.items || [])
    .map(it => ({ itemId: Number(it.itemId), quantity: Math.floor(Number(it.quantity) || 0) }))
    .filter(it => it.itemId && it.quantity > 0);
  if (requested.length === 0) throw new Error('请选择要处理的商品数量');

  const selected = requested.map(req => {
    const item = (order.items || []).find(it => it.id === req.itemId);
    if (!item) throw new Error('售后商品不存在');
    if (req.quantity > Number(item.quantity || 0)) throw new Error(`${item.product_name || '商品'} 数量超出订单数量`);
    return { item, quantity: req.quantity };
  });

  const type = payload.type || 'RETURN_REFUND';
  const restockReturned = payload.restockReturned !== false;
  const operatorName = payload.operatorName || '';
  const time = payload.time || new Date().toISOString().slice(0, 16);
  const note = (payload.note || '').trim();
  const summary = selected.map(({ item, quantity }) => `${item.product_name}(${item.spec})x${quantity}`).join('，');

  if (type === 'RETURN_REFUND') {
    const refundAmount = roundMoney(Number(payload.refundAmount || 0));
    if (refundAmount < 0) throw new Error('退款金额不能为负数');
    if (refundAmount > Number(order.paid_amount || 0) + 0.01) throw new Error('退款金额不能大于当前已收金额');

    const remainingItems = (order.items || []).map(it => ({ ...it }));
    for (const { item, quantity } of selected) {
      const newQty = Number(item.quantity || 0) - quantity;
      const row = remainingItems.find(it => it.id === item.id);
      if (row) {
        row.quantity = newQty;
        row.subtotal = roundMoney(newQty * Number(item.unit_price || 0));
      }
      if (item.spec_id && restockReturned) {
        await writeStockAdjustment(
          item.spec_id,
          item.product_id,
          'IN',
          'RETURN',
          quantity,
          `退货入库 ${order.order_no} ${item.product_name || ''}`,
          operatorName
        );
      }
      if (newQty <= 0) {
        const { error: deleteError } = await supabase.from('order_items').delete().eq('id', item.id);
        if (deleteError) throw new Error(deleteError.message);
      } else {
        const { error: updateError } = await supabase.from('order_items')
          .update({ quantity: newQty, subtotal: row.subtotal })
          .eq('id', item.id);
        if (updateError) throw new Error(updateError.message);
      }
    }

    const keptItems = remainingItems.filter(it => Number(it.quantity || 0) > 0);
    const subtotal = roundMoney(keptItems.reduce((s, it) => s + Number(it.subtotal || 0), 0));
    const discountAmount = roundMoney(subtotal * Number(order.discount_percent || 0) / 100);
    const total = roundMoney(subtotal - discountAmount);
    const { error: orderError } = await supabase.from('orders')
      .update({ subtotal, discount_amount: discountAmount, total })
      .eq('id', orderId);
    if (orderError) throw new Error(orderError.message);

    if (refundAmount > 0) {
      const { error: refundError } = await supabase.from('payment_records').insert({
        order_id: orderId,
        amount: -refundAmount,
        method: payload.refundMethod || '转账',
        note: `退款：${note || summary}`,
        recorded_by: operatorName
      });
      if (refundError) throw new Error(refundError.message);
    }

    const payment = await recalculatePaymentState(orderId, total);
    const action = `退货退款：${summary}；退款 ¥${refundAmount}；${restockReturned ? '退货已入库' : '退货不入库'}${note ? `；${note}` : ''}`;
    const { error: logError } = await supabase.from('order_logs').insert({ order_id: orderId, time, user_name: operatorName, action });
    if (logError) throw new Error(logError.message);
    return { total, subtotal, discountAmount, paidAmount: payment.totalPaid, paymentStatus: payment.status };
  }

  const deductReplacement = payload.deductReplacement !== false;
  for (const { item, quantity } of selected) {
    if (item.spec_id && restockReturned) {
      await writeStockAdjustment(
        item.spec_id,
        item.product_id,
        'IN',
        'RETURN',
        quantity,
        `换货退回 ${order.order_no} ${item.product_name || ''}`,
        operatorName
      );
    }
    if (item.spec_id && deductReplacement) {
      await writeStockAdjustment(
        item.spec_id,
        item.product_id,
        'OUT',
        'ORDER',
        quantity,
        `换货补发 ${order.order_no} ${item.product_name || ''}`,
        operatorName
      );
    }
  }
  const action = `换货补发：${summary}；${restockReturned ? '退回已入库' : '退回不入库'}；${deductReplacement ? '补发已扣库存' : '补发不扣库存'}${note ? `；${note}` : ''}`;
  const { error: logError } = await supabase.from('order_logs').insert({ order_id: orderId, time, user_name: operatorName, action });
  if (logError) throw new Error(logError.message);
  return { total: Number(order.total || 0), paidAmount: Number(order.paid_amount || 0) };
}

export async function createOrder(order) {
  const stockItems = (order.items || []).filter(it => it.specId);
  if (stockItems.length) {
    const ids = [...new Set(stockItems.map(it => it.specId))];
    const { data: available, error: stockError } = await supabase.from('product_specs').select('id,stock,spec').in('id', ids);
    if (stockError) throw new Error(stockError.message);
    for (const specId of ids) {
      const lines = stockItems.filter(it => it.specId === specId);
      const required = lines.reduce((sum, it) => sum + Number(it.quantity || 0), 0);
      const spec = (available || []).find(s => s.id === specId);
      if (!spec || Number(spec.stock || 0) < required) {
        throw new Error(`${lines[0]?.productName || '商品'} ${lines[0]?.spec || spec?.spec || ''} 库存不足`);
      }
    }
  }
  let { data: o, error: oe } = await supabase.from('orders')
    .insert(orderRow(order))
    .select().single();
  if (isMissingOrderSourceError(oe)) {
    const retry = await supabase.from('orders')
      .insert(orderRow(order, false))
      .select().single();
    o = retry.data;
    oe = retry.error;
  }
  if (oe) throw new Error(oe.message);

  if (order.items?.length) {
    await supabase.from('order_items').insert(order.items.map(it => ({
      order_id: o.id, product_id: it.productId, spec_id: it.specId,
      product_name: it.productName, product_code: it.productCode, spec: it.spec,
      quantity: it.quantity, unit_price: it.unitPrice, unit_cost: it.unitCost || 0, subtotal: it.subtotal
    })));
  }

  if (order.logs?.length) {
    await supabase.from('order_logs').insert(order.logs.map(l => ({
      order_id: o.id, time: l.time, user_name: l.user, action: l.action
    })));
  }

  // Deduct stock + record adjustments
  for (const it of (order.items || [])) {
    if (it.specId) {
      const { data: spec } = await supabase.from('product_specs').select('stock').eq('id', it.specId).single();
      if (spec) {
        const newStock = Math.max(0, spec.stock - it.quantity);
        await supabase.from('product_specs').update({ stock: newStock }).eq('id', it.specId);
        await supabase.from('stock_adjustments').insert({
          spec_id: it.specId, product_id: it.productId, type: 'OUT', reason: 'ORDER',
          quantity: it.quantity, before_stock: spec.stock, after_stock: newStock,
          note: `订单 ${order.orderNo}`, operator_name: order.logs?.[0]?.user || ''
        });
      }
    }
  }
  return o.id;
}

export async function updateOrderItems(orderId, changes, totals, logEntry) {
  for (const ch of (changes || [])) {
    const delta = Number(ch.newQty || 0) - Number(ch.oldQty || 0);
    if (ch.specId && delta !== 0) {
      const { data: spec, error: specError } = await supabase.from('product_specs').select('stock').eq('id', ch.specId).single();
      if (specError) throw new Error(specError.message);
      if (spec) {
        const nextStock = Math.max(0, Number(spec.stock || 0) - delta);
        const { error: stockError } = await supabase.from('product_specs').update({ stock: nextStock }).eq('id', ch.specId);
        if (stockError) throw new Error(stockError.message);
        const { error: logStockError } = await supabase.from('stock_adjustments').insert({
          spec_id: ch.specId,
          product_id: ch.productId || null,
          type: delta > 0 ? 'OUT' : 'IN',
          reason: 'ORDER',
          quantity: Math.abs(delta),
          before_stock: spec.stock,
          after_stock: nextStock,
          note: '管理员修改订单明细',
          operator_name: logEntry?.user || ''
        });
        if (logStockError) throw new Error(logStockError.message);
      }
    }
    if (Number(ch.newQty || 0) <= 0) {
      const { error } = await supabase.from('order_items').delete().eq('id', ch.itemId);
      if (error) throw new Error(error.message);
    } else if (delta !== 0) {
      const { error } = await supabase.from('order_items')
        .update({ quantity: ch.newQty, subtotal: roundMoney(Number(ch.newQty || 0) * Number(ch.unitPrice || 0)) })
        .eq('id', ch.itemId);
      if (error) throw new Error(error.message);
    }
  }

  const { error: orderError } = await supabase.from('orders').update({
    subtotal: totals.subtotal,
    discount_amount: totals.discountAmount,
    total: totals.total
  }).eq('id', orderId);
  if (orderError) throw new Error(orderError.message);
  await recalculatePaymentState(orderId, totals.total);
  if (logEntry) await insertOrderLog(orderId, logEntry.time, logEntry.user, logEntry.action);
}

async function fetchOrderDeletionSnapshot(orderId) {
  let { data, error } = await supabase.from('orders')
    .select('*, customer:customers(name), items:order_items(*), logs:order_logs(*), shipment:shipments(*), payments:payment_records(*), afterSales:after_sales(*)')
    .eq('id', orderId)
    .single();
  if (isMissingAfterSalesError(error)) {
    const retry = await supabase.from('orders')
      .select('*, customer:customers(name), items:order_items(*), logs:order_logs(*), shipment:shipments(*), payments:payment_records(*)')
      .eq('id', orderId)
      .single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw new Error(error.message);
  if (!data) throw new Error('订单不存在');
  return {
    order: data,
    items: data.items || [],
    logs: data.logs || [],
    shipment: data.shipment || [],
    payments: data.payments || [],
    afterSales: data.afterSales || []
  };
}

function mapDeletedOrder(row) {
  const snapshot = row.snapshot || {};
  return {
    id: row.id,
    originalOrderId: row.original_order_id,
    restoredOrderId: row.restored_order_id,
    orderNo: row.order_no,
    customerId: row.customer_id,
    customerName: row.customer_name || '',
    salesId: row.sales_id,
    status: row.status || '',
    paymentStatus: row.payment_status || '',
    total: Number(row.total || 0),
    paidAmount: Number(row.paid_amount || 0),
    stockRestored: row.stock_restored !== false,
    deletedBy: row.deleted_by || '',
    deletedAt: row.deleted_at,
    expiresAt: row.expires_at,
    restoredBy: row.restored_by || '',
    restoredAt: row.restored_at,
    snapshot,
    items: snapshot.items || [],
    logs: snapshot.logs || []
  };
}

export async function fetchDeletedOrders() {
  const { data, error } = await supabase.from('deleted_orders')
    .select('*')
    .is('restored_at', null)
    .gte('expires_at', new Date().toISOString())
    .order('deleted_at', { ascending: false });
  if (isMissingDeletedOrdersError(error)) {
    throw new Error('请先在 Supabase 运行 supabase/migration_v15.sql，启用删除订单库');
  }
  if (error) throw new Error(error.message);
  return (data || []).map(mapDeletedOrder);
}

export async function permanentlyDeleteDeletedOrder(deletedOrderId) {
  const { error } = await supabase.from('deleted_orders').delete().eq('id', deletedOrderId);
  if (isMissingDeletedOrdersError(error)) throw new Error('请先运行 migration_v15.sql');
  if (error) throw new Error(error.message);
}

export async function restoreDeletedOrder(deletedOrderId, restoredBy = '') {
  const { data: deleted, error } = await supabase.from('deleted_orders')
    .select('*')
    .eq('id', deletedOrderId)
    .single();
  if (isMissingDeletedOrdersError(error)) throw new Error('请先运行 migration_v15.sql');
  if (error) throw new Error(error.message);
  if (!deleted) throw new Error('删除订单不存在');
  if (deleted.restored_at) throw new Error('该订单已经恢复');
  if (new Date(deleted.expires_at).getTime() < Date.now()) throw new Error('该删除订单已超过 30 天保留期');

  const snap = deleted.snapshot || {};
  const old = snap.order || {};
  const { data: restored, error: insertError } = await supabase.from('orders').insert({
    order_no: old.order_no || deleted.order_no,
    customer_id: old.customer_id || deleted.customer_id,
    sales_id: old.sales_id || deleted.sales_id,
    status: old.status || deleted.status || 'SUBMITTED',
    subtotal: Number(old.subtotal || 0),
    discount_percent: Number(old.discount_percent || 0),
    discount_amount: Number(old.discount_amount || 0),
    total: Number(old.total || deleted.total || 0),
    notes: old.notes || '',
    business_type: old.business_type || '院线',
    created_at: old.created_at,
    source: old.source || 'web_admin',
    channel_meta: old.channel_meta || {},
    payment_status: old.payment_status || deleted.payment_status || 'UNPAID',
    paid_amount: Number(old.paid_amount || deleted.paid_amount || 0)
  }).select().single();
  if (insertError) throw new Error(insertError.message);

  const newOrderId = restored.id;
  const oldItems = snap.items || [];
  const itemIdMap = {};
  if (oldItems.length) {
    const { data: newItems, error: itemError } = await supabase.from('order_items').insert(oldItems.map(it => ({
      order_id: newOrderId,
      product_id: it.product_id,
      spec_id: it.spec_id,
      product_name: it.product_name,
      product_code: it.product_code,
      spec: it.spec,
      quantity: it.quantity,
      unit_price: it.unit_price,
      unit_cost: it.unit_cost || 0,
      subtotal: it.subtotal
    }))).select();
    if (itemError) throw new Error(itemError.message);
    (newItems || []).forEach((it, idx) => { itemIdMap[oldItems[idx]?.id] = it.id; });
  }

  const logs = (snap.logs || []).map(l => ({
    order_id: newOrderId,
    time: l.time,
    user_name: l.user_name,
    action: l.action
  }));
  logs.push({
    order_id: newOrderId,
    time: new Date().toISOString().slice(0, 16),
    user_name: restoredBy,
    action: `从删除订单库恢复（原订单ID ${deleted.original_order_id || '—'}）`
  });
  if (logs.length) {
    const { error: logError } = await supabase.from('order_logs').insert(logs);
    if (logError) throw new Error(logError.message);
  }

  const shipments = snap.shipment || [];
  if (shipments.length) {
    const { error: shipError } = await supabase.from('shipments').insert(shipments.map(s => ({
      order_id: newOrderId,
      carrier: s.carrier,
      tracking_no: s.tracking_no,
      shipped_at: s.shipped_at,
      operator: s.operator
    })));
    if (shipError) throw new Error(shipError.message);
  }

  const payments = snap.payments || [];
  if (payments.length) {
    const { error: payError } = await supabase.from('payment_records').insert(payments.map(p => ({
      order_id: newOrderId,
      amount: p.amount,
      method: p.method,
      note: p.note,
      recorded_by: p.recorded_by,
      created_at: p.created_at
    })));
    if (payError) throw new Error(payError.message);
  }

  const afterSales = snap.afterSales || [];
  if (afterSales.length) {
    const { error: afterError } = await supabase.from('after_sales').insert(afterSales.map(a => ({
      order_id: newOrderId,
      type: a.type,
      status: a.status,
      items: (a.items || []).map(it => ({ ...it, itemId: itemIdMap[it.itemId] || it.itemId })),
      requested_amount: a.requested_amount || 0,
      request_note: a.request_note || '',
      created_by: a.created_by || '',
      created_at: a.created_at,
      restock_returned: a.restock_returned !== false,
      deduct_replacement: a.deduct_replacement !== false,
      warehouse_note: a.warehouse_note || '',
      warehouse_by: a.warehouse_by || null,
      warehouse_at: a.warehouse_at || null,
      finance_amount: a.finance_amount || 0,
      finance_method: a.finance_method || '转账',
      finance_note: a.finance_note || '',
      finance_by: a.finance_by || null,
      finance_at: a.finance_at || null,
      completed_at: a.completed_at || null
    })));
    if (afterError) throw new Error(afterError.message);
  }

  if (deleted.stock_restored) {
    for (const it of oldItems) {
      if (!it.spec_id) continue;
      const { data: spec } = await supabase.from('product_specs').select('stock').eq('id', it.spec_id).single();
      if (!spec) continue;
      const newStock = Math.max(0, Number(spec.stock || 0) - Number(it.quantity || 0));
      await supabase.from('product_specs').update({ stock: newStock }).eq('id', it.spec_id);
      await supabase.from('stock_adjustments').insert({
        spec_id: it.spec_id,
        product_id: it.product_id,
        type: 'OUT',
        reason: 'ORDER',
        quantity: it.quantity,
        before_stock: spec.stock,
        after_stock: newStock,
        note: `恢复删除订单 ${deleted.order_no}`,
        operator_name: restoredBy
      });
    }
  }

  const { error: updateError } = await supabase.from('deleted_orders').update({
    restored_order_id: newOrderId,
    restored_by: restoredBy,
    restored_at: new Date().toISOString()
  }).eq('id', deletedOrderId);
  if (updateError) throw new Error(updateError.message);
  return newOrderId;
}

export async function deleteOrder(orderId, restoreStock = true, deletedBy = '') {
  const snapshot = await fetchOrderDeletionSnapshot(orderId);
  const order = snapshot.order;
  const { error: archiveError } = await supabase.from('deleted_orders').insert({
    original_order_id: orderId,
    order_no: order.order_no,
    customer_id: order.customer_id,
    customer_name: order.customer?.name || '',
    sales_id: order.sales_id,
    status: order.status,
    payment_status: order.payment_status || 'UNPAID',
    total: Number(order.total || 0),
    paid_amount: Number(order.paid_amount || 0),
    stock_restored: restoreStock,
    snapshot,
    deleted_by: deletedBy || '',
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  });
  if (isMissingDeletedOrdersError(archiveError)) {
    throw new Error('请先在 Supabase 运行 supabase/migration_v15.sql，启用删除订单库；为避免数据丢失，本次没有删除订单');
  }
  if (archiveError) throw new Error(archiveError.message);

  // 如果订单未取消且需要恢复库存
  if (restoreStock) {
    const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
    for (const it of (items || [])) {
      if (it.spec_id) {
        const { data: spec } = await supabase.from('product_specs').select('stock').eq('id', it.spec_id).single();
        if (spec) {
          const newStock = spec.stock + it.quantity;
          await supabase.from('product_specs').update({ stock: newStock }).eq('id', it.spec_id);
          await supabase.from('stock_adjustments').insert({
            spec_id: it.spec_id, product_id: it.product_id, type: 'IN', reason: 'CANCEL_RESTORE',
            quantity: it.quantity, before_stock: spec.stock, after_stock: newStock,
            note: `删除订单恢复库存`, operator_name: deletedBy || ''
          });
        }
      }
    }
  }
  // 订单有 ON DELETE CASCADE，会自动删除 items/logs/shipments/payments
  const { error } = await supabase.from('orders').delete().eq('id', orderId);
  if (error) throw new Error(error.message);
}

// 获取快递公司按使用频率排序
export async function fetchCarriersByUsage() {
  const { data, error } = await supabase.from('shipments').select('carrier');
  if (error) return [];
  const counts = {};
  (data || []).forEach(s => { if (s.carrier) counts[s.carrier] = (counts[s.carrier] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

export async function updateOrderStatus(orderId, newStatus, logEntry, shipmentData) {
  await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
  if (logEntry) await supabase.from('order_logs').insert({ order_id: orderId, time: logEntry.time, user_name: logEntry.user, action: logEntry.action });
  if (shipmentData) await supabase.from('shipments').insert({ order_id: orderId, carrier: shipmentData.carrier, tracking_no: shipmentData.trackingNo, shipped_at: shipmentData.shippedAt, operator: shipmentData.operator });

  // If cancelled, restore stock + record adjustments
  if (newStatus === 'CANCELLED') {
    const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
    const { data: orderData } = await supabase.from('orders').select('order_no').eq('id', orderId).single();
    for (const it of (items || [])) {
      if (it.spec_id) {
        const { data: spec } = await supabase.from('product_specs').select('stock').eq('id', it.spec_id).single();
        if (spec) {
          const newStock = spec.stock + it.quantity;
          await supabase.from('product_specs').update({ stock: newStock }).eq('id', it.spec_id);
          await supabase.from('stock_adjustments').insert({
            spec_id: it.spec_id, product_id: it.product_id, type: 'IN', reason: 'CANCEL_RESTORE',
            quantity: it.quantity, before_stock: spec.stock, after_stock: newStock,
            note: `取消订单 ${orderData?.order_no || ''}`, operator_name: logEntry?.user || ''
          });
        }
      }
    }
  }
}

// ═══ PAYMENTS ═══
export async function recordPayment(orderId, amount, method, note, recordedBy, priceAdjustment = 0) {
  const adjustment = roundMoney(Number(priceAdjustment || 0));
  if (adjustment !== 0) {
    const { data: current, error: orderError } = await supabase.from('orders').select('subtotal,total').eq('id', orderId).single();
    if (orderError) throw new Error(orderError.message);
    if (!current) throw new Error('订单不存在');
    const subtotal = roundMoney(Number(current.subtotal || 0) + adjustment);
    const total = roundMoney(Number(current.total || 0) + adjustment);
    if (total < 0) throw new Error('价格调整后订单金额不能为负数');
    const { error: updateTotalError } = await supabase.from('orders').update({ subtotal, total }).eq('id', orderId);
    if (updateTotalError) throw new Error(updateTotalError.message);
  }
  await supabase.from('payment_records').insert({ order_id: orderId, amount, method, note, recorded_by: recordedBy });
  // Recalculate payment status
  const { data: payments } = await supabase.from('payment_records').select('amount').eq('order_id', orderId);
  const totalPaid = (payments || []).reduce((s, p) => s + Number(p.amount), 0);
  const { data: order } = await supabase.from('orders').select('subtotal,total').eq('id', orderId).single();
  const total = Number(order.total || 0);
  const status = total <= 0 ? (totalPaid > 0 ? 'PAID' : 'UNPAID') : totalPaid >= total ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID';
  await supabase.from('orders').update({ payment_status: status, paid_amount: totalPaid }).eq('id', orderId);
  return { totalPaid, status, total, subtotal: Number(order.subtotal || 0), priceAdjustment: adjustment };
}

// 财务收款流水：全部收款记录 + 关联订单信息（按时间倒序）
export async function fetchPaymentRecords() {
  const { data, error } = await supabase.from('payment_records')
    .select('*, order:orders(order_no, customer_id, total, sales_id, business_type)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(p => ({
    id: p.id,
    amount: Number(p.amount),
    method: p.method || '',
    note: p.note || '',
    recordedBy: p.recorded_by || '',
    createdAt: p.created_at,
    orderNo: p.order ? p.order.order_no : '',
    customerId: p.order ? p.order.customer_id : null,
    orderTotal: p.order ? Number(p.order.total) : 0,
    salesId: p.order ? p.order.sales_id : null,
    businessType: p.order ? (p.order.business_type || '院线') : ''
  }));
}

// ═══ STOCK ADJUSTMENTS ═══
export async function adjustStock(specId, productId, type, reason, quantity, note, operatorName) {
  const { data: spec } = await supabase.from('product_specs').select('stock,product:products(inventory_mode)').eq('id', specId).single();
  if (!spec) throw new Error('规格不存在');
  const massMode = spec.product?.inventory_mode === 'MASS';
  let result;
  try {
    result = await adjustInventoryValue(specId, type, quantity, massMode ? 'KG' : 'SPEC');
  } catch (error) {
    if (!isMissingMassInventoryRpc(error) || massMode) throw error;
    const before = Number(spec.stock || 0);
    const after = type === 'IN' ? before + quantity : type === 'OUT' ? Math.max(0, before - quantity) : quantity;
    await supabase.from('product_specs').update({ stock: after }).eq('id', specId);
    result = { before, after };
  }
  await supabase.from('stock_adjustments').insert({
    spec_id: specId, product_id: productId, type, reason, quantity: type === 'CORRECTION' ? Math.abs(Number(result.after || 0) - Number(result.before || 0)) : quantity,
    before_stock: result.before, after_stock: result.after, note, operator_name: operatorName,
    quantity_kg: result.quantityKg, before_stock_kg: result.beforeKg, after_stock_kg: result.afterKg
  });
  return result;
}

export async function fetchStockLog(limit = 100) {
  const { data, error } = await supabase.from('stock_adjustments')
    .select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data;
}

// ═══ PURCHASE ORDERS ═══
export async function fetchPurchaseOrders() {
  const { data, error } = await supabase.from('purchase_orders')
    .select('*, items:purchase_order_items(*)').order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return data.map(po => ({
    id: po.id, poNo: po.po_no, supplier: po.supplier, status: po.status,
    total: Number(po.total), notes: po.notes, createdByName: po.created_by_name,
    createdAt: po.created_at,
    items: (po.items || []).map(it => ({
      id: it.id, productId: it.product_id, specId: it.spec_id,
      productName: it.product_name, spec: it.spec,
      quantity: Number(it.quantity), receivedQty: Number(it.received_qty || 0),
      unitCost: Number(it.unit_cost), subtotal: Number(it.subtotal)
    }))
  }));
}

export async function createPurchaseOrder(po) {
  const { data, error } = await supabase.rpc('zidu_create_purchase_order', {
    p_po_no: po.poNo, p_supplier: po.supplier, p_notes: po.notes || '',
    p_created_by_name: po.createdByName, p_items: po.items || []
  });
  if (error) throw new Error(/zidu_create_purchase_order|schema cache|could not find/i.test(error.message || '') ? '请先运行 migration_v22_purchase_order_crud.sql' : error.message);
  if (data?.error) throw new Error(data.error);
  return data.id;
}

export async function updatePurchaseOrder(poId, po) {
  const { data, error } = await supabase.rpc('zidu_update_purchase_order', {
    p_po_id: poId, p_supplier: po.supplier, p_notes: po.notes || '', p_items: po.items || []
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
}

export async function deletePurchaseOrder(poId) {
  const { data, error } = await supabase.rpc('zidu_delete_purchase_order', { p_po_id: poId });
  if (error) throw new Error(/zidu_delete_purchase_order|schema cache|could not find/i.test(error.message || '') ? '请先运行 migration_v22_purchase_order_crud.sql' : error.message);
  if (data?.error) throw new Error(data.error);
}

export async function updatePurchaseOrderStatus(poId, status) {
  const { error } = await supabase.from('purchase_orders').update({ status }).eq('id', poId);
  if (error) throw new Error(error.message);
}

export async function receivePurchaseItems(poId, receivedItems, operatorName) {
  const { data, error } = await supabase.rpc('zidu_receive_purchase_order', {
    p_po_id: poId, p_items: receivedItems, p_operator_name: operatorName || ''
  });
  if (error) throw new Error(/zidu_receive_purchase_order|schema cache|could not find/i.test(error.message || '') ? '请先运行 migration_v22_purchase_order_crud.sql' : error.message);
  if (data?.error) throw new Error(data.error);
}

// ═══ PRICING TIERS ═══
export async function fetchPricingTiers() {
  const { data, error } = await supabase.from('pricing_tiers').select('*').order('min_annual_spend');
  if (error) throw new Error(error.message);
  return data.map(t => ({ id: t.id, minSpend: Number(t.min_annual_spend), discount: Number(t.discount_percent), label: t.label }));
}

export async function updatePricingTiers(tiers) {
  // Delete all and re-insert
  await supabase.from('pricing_tiers').delete().neq('id', 0);
  if (tiers.length) {
    await supabase.from('pricing_tiers').insert(tiers.map(t => ({
      min_annual_spend: t.minSpend, discount_percent: t.discount, label: t.label
    })));
  }
  return fetchPricingTiers();
}

export function calculateCustomerTier(customerId, orders, tiers) {
  const year = new Date().getFullYear();
  const yearStr = String(year);
  const yearOrders = orders.filter(o => o.customerId === customerId && o.status !== 'CANCELLED' && o.createdAt?.startsWith(yearStr));
  const annualSpend = yearOrders.reduce((s, o) => s + o.total, 0);
  let tier = { discount: 0, label: '普通客户' };
  for (const t of tiers) {
    if (annualSpend >= t.minSpend) tier = t;
  }
  return { annualSpend, discount: tier.discount, label: tier.label };
}

// ═══ CONFIG OPTIONS (可编辑的基础设置) ═══
export async function fetchConfigOptions() {
  const { data, error } = await supabase.from('config_options')
    .select('*').eq('is_active', true).order('category').order('sort_order');
  if (error) throw new Error(error.message);
  return data.map(c => ({ id: c.id, category: c.category, value: c.value, sortOrder: c.sort_order }));
}

export async function addConfigOption(category, value) {
  const { data, error } = await supabase.from('config_options')
    .insert({ category, value, sort_order: 999 }).select().single();
  if (error) throw new Error(error.message);
  return { id: data.id, category: data.category, value: data.value, sortOrder: data.sort_order };
}

export async function deleteConfigOption(id) {
  const { error } = await supabase.from('config_options').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ═══ PRODUCT BATCHES (批次/GC-MS 追溯) ═══
function mapBatch(b) {
  return {
    id: b.id, batchNo: b.batch_no, productId: b.product_id, specId: b.spec_id,
    gcmsNo: b.gcms_no || '', receivedDate: b.received_date, expiryDate: b.expiry_date,
    initialQty: b.initial_qty, remainingQty: b.remaining_qty,
    unitCost: Number(b.unit_cost || 0), supplier: b.supplier || '', note: b.note || ''
  };
}

export async function fetchBatches(specId) {
  let query = supabase.from('product_batches').select('*').order('received_date', { ascending: false });
  if (specId) query = query.eq('spec_id', specId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data.map(mapBatch);
}

export async function fetchBatchesWithStock(specId) {
  // 只返回仍有库存的批次（按入库时间排序，先进先出）
  const { data, error } = await supabase.from('product_batches')
    .select('*').eq('spec_id', specId).gt('remaining_qty', 0)
    .order('received_date', { ascending: true });
  if (error) throw new Error(error.message);
  return data.map(mapBatch);
}

export async function createBatch(batch) {
  const { data, error } = await supabase.rpc('zidu_create_inventory_batch', {
    p_batch_no: batch.batchNo,
    p_product_id: batch.productId,
    p_spec_id: batch.specId,
    p_quantity: Number(batch.quantity || 0),
    p_gcms_no: batch.gcmsNo || null,
    p_received_date: batch.receivedDate,
    p_expiry_date: batch.expiryDate || null,
    p_unit_cost: Number(batch.unitCost || 0),
    p_supplier: batch.supplier || '',
    p_note: batch.note || '',
    p_operator_name: batch.operatorName || '',
    p_density_g_ml: batch.densityGml ? Number(batch.densityGml) : null,
    p_density_temperature_c: Number(batch.densityTemperatureC || 20)
  });
  if (error) {
    if (/zidu_create_inventory_batch|schema cache|could not find the function/i.test(error.message || '')) {
      throw new Error('请先在 Supabase 运行 migration_v21_batch_delete_and_kg_receiving.sql');
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  return mapBatch(data);
}

export async function deleteBatch(batchId) {
  const { data, error } = await supabase.rpc('zidu_delete_inventory_batch', {
    p_batch_id: batchId,
    p_operator_name: ''
  });
  if (error) {
    if (/zidu_delete_inventory_batch|schema cache|could not find the function/i.test(error.message || '')) {
      throw new Error('请先在 Supabase 运行 migration_v21_batch_delete_and_kg_receiving.sql');
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
}

export async function enableMassInventory(productId, densityGml, densityTemperatureC = 20) {
  const { data: product, error: fetchError } = await supabase.from('products')
    .select('id,name,specs:product_specs(spec)').eq('id', productId).single();
  if (fetchError) throw new Error(fetchError.message);
  const hasVolumeSpec = (product?.specs || []).some(s => /(?:ml|毫升|l|升)/i.test(s.spec || ''));
  if (hasVolumeSpec && !(Number(densityGml) > 0)) throw new Error('该原料有 ml/L 规格，请先填写密度');
  const { error } = await supabase.from('products').update({
    inventory_mode: 'MASS',
    base_stock_kg: 0,
    density_g_ml: densityGml ? Number(densityGml) : null,
    density_temperature_c: Number(densityTemperatureC || 20),
    density_status: densityGml ? 'REFERENCE' : 'UNSET',
    density_source: densityGml ? '首次按kg入库时录入，待供应商/批次确认' : ''
  }).eq('id', productId);
  if (error) throw new Error(error.message);
}

// ═══ SCENARIO PACKAGES ═══
export async function fetchScenarioPackages() {
  const { data, error } = await supabase.from('scenario_packages')
    .select('*, items:scenario_package_items(*)').order('sort_order');
  if (error) throw new Error(error.message);
  return data.map(pkg => ({
    id: pkg.id, code: pkg.code, name: pkg.name, description: pkg.description,
    isActive: pkg.is_active, sortOrder: pkg.sort_order,
    items: (pkg.items || []).map(it => ({ id: it.id, productId: it.product_id, specId: it.spec_id, quantity: it.quantity }))
  }));
}

// ═══ SUPPLIERS ═══
function mapSupplier(s) {
  return {
    id: s.id, name: s.name, contact: s.contact || '', phone: s.phone || '',
    email: s.email || '', address: s.address || '', category: s.category || '',
    paymentTerms: s.payment_terms || '', note: s.note || '',
    isActive: s.is_active, createdAt: s.created_at
  };
}

export async function fetchSuppliers() {
  const { data, error } = await supabase.from('suppliers').select('*').order('id');
  if (error) throw new Error(error.message);
  return data.map(mapSupplier);
}

export async function createSupplier(s) {
  const { data, error } = await supabase.from('suppliers').insert({
    name: s.name, contact: s.contact, phone: s.phone, email: s.email,
    address: s.address, category: s.category, payment_terms: s.paymentTerms, note: s.note
  }).select().single();
  if (error) throw new Error(error.message);
  return mapSupplier(data);
}

export async function updateSupplier(id, s) {
  const { data, error } = await supabase.from('suppliers').update({
    name: s.name, contact: s.contact, phone: s.phone, email: s.email,
    address: s.address, category: s.category, payment_terms: s.paymentTerms, note: s.note,
    is_active: s.isActive
  }).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return mapSupplier(data);
}

export async function deleteSupplier(id) {
  const { error } = await supabase.from('suppliers').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ═══ SALES TASKS ═══
function mapTask(t) {
  return {
    id: t.id, customerId: t.customer_id, salesId: t.sales_id,
    title: t.title, description: t.description || '', dueDate: t.due_date,
    priority: t.priority, status: t.status, completedAt: t.completed_at,
    completedNote: t.completed_note || '', createdBy: t.created_by, createdAt: t.created_at
  };
}

export async function fetchSalesTasks(salesId) {
  let q = supabase.from('sales_tasks').select('*').order('due_date', { ascending: true });
  if (salesId) q = q.eq('sales_id', salesId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data.map(mapTask);
}

export async function createSalesTask(task) {
  const { data, error } = await supabase.from('sales_tasks').insert({
    customer_id: task.customerId, sales_id: task.salesId,
    title: task.title, description: task.description,
    due_date: task.dueDate, priority: task.priority || 'NORMAL',
    status: 'PENDING', created_by: task.createdBy
  }).select().single();
  if (error) throw new Error(error.message);
  return mapTask(data);
}

export async function completeSalesTask(taskId, note) {
  const { data, error } = await supabase.from('sales_tasks').update({
    status: 'DONE', completed_at: new Date().toISOString(), completed_note: note || ''
  }).eq('id', taskId).select().single();
  if (error) throw new Error(error.message);
  return mapTask(data);
}

export async function deleteSalesTask(id) {
  const { error } = await supabase.from('sales_tasks').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ═══ SALES TARGETS ═══
export async function fetchSalesTargets(year) {
  let q = supabase.from('sales_targets').select('*');
  if (year) q = q.eq('year', year);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data.map(t => ({
    id: t.id, salesId: t.sales_id, year: t.year, month: t.month,
    targetAmount: Number(t.target_amount), commissionRate: Number(t.commission_rate),
    targetNewCustomers: t.target_new_customers || 0,
    targetOrderCount: t.target_order_count || 0,
    note: t.note || ''
  }));
}

export async function upsertSalesTarget(target) {
  const payload = {
    target_amount: target.targetAmount,
    commission_rate: target.commissionRate || 0,
    target_new_customers: target.targetNewCustomers || 0,
    target_order_count: target.targetOrderCount || 0,
    note: target.note || ''
  };
  const { data: existing } = await supabase.from('sales_targets')
    .select('id').eq('sales_id', target.salesId).eq('year', target.year).eq('month', target.month).maybeSingle();
  if (existing) {
    const { error } = await supabase.from('sales_targets').update(payload).eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('sales_targets').insert({
      sales_id: target.salesId, year: target.year, month: target.month, ...payload
    });
    if (error) throw new Error(error.message);
  }
}

// ═══ APP SETTINGS (API Key 配置) ═══
export async function fetchAppSettings() {
  const { data, error } = await supabase.from('app_settings').select('*');
  if (error) throw new Error(error.message);
  const map = {};
  (data || []).forEach(s => { map[s.key] = s.value; });
  return map;
}

export async function updateAppSetting(key, value) {
  const { data: existing } = await supabase.from('app_settings').select('id').eq('key', key).maybeSingle();
  if (existing) {
    const { error } = await supabase.from('app_settings').update({ value, updated_at: new Date().toISOString() }).eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('app_settings').insert({ key, value });
    if (error) throw new Error(error.message);
  }
}

// ═══ 成本与利润 ═══
// 用最新批次成本一键回填 product_specs.cost
export async function backfillSpecCost() {
  const { data, error } = await supabase.rpc('backfill_spec_cost_from_batches');
  if (error) throw new Error(error.message);
  return data; // 回填条数
}
// 库存估值（按系列）
export async function fetchInventoryValuation() {
  const { data, error } = await supabase.from('inventory_valuation').select('*');
  if (error) throw new Error(error.message);
  return (data || []).map(r => ({
    series: r.series, skuCount: r.sku_count, totalUnits: Number(r.total_units || 0),
    stockCostValue: Number(r.stock_cost_value || 0),
    stockRetailValue: Number(r.stock_retail_value || 0),
    potentialMargin: Number(r.potential_margin || 0)
  }));
}

// ═══ AUDIT LOGS ═══
export async function logAudit(userId, userName, action, entityType, entityId, details) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: userId, user_name: userName, action, entity_type: entityType,
      entity_id: entityId || null, details: details || ''
    });
  } catch (e) { console.error('Audit log failed:', e); }
}

export async function fetchAuditLogs(limit = 200) {
  const { data, error } = await supabase.from('audit_logs')
    .select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data;
}

// ═══ SHIPMENT NOTIFICATIONS ═══
export async function recordShipmentNotification(orderId, customerId, method, status, note) {
  const { error } = await supabase.from('shipment_notifications').insert({
    order_id: orderId, customer_id: customerId, method, status, note: note || ''
  });
  if (error) throw new Error(error.message);
}

export async function fetchShipmentNotifications(orderId) {
  const { data, error } = await supabase.from('shipment_notifications')
    .select('*').eq('order_id', orderId).order('sent_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

// ═══ RESTOCK SUGGESTIONS (纯前端计算) ═══
export function calculateRestockSuggestions(products, orders) {
  const now = Date.now();
  const d30 = 30 * 86400000;
  const d60 = 60 * 86400000;
  const recent = orders.filter(o => o.status !== 'CANCELLED' && now - new Date(o.createdAt).getTime() < d30);
  const prior = orders.filter(o => { const age = now - new Date(o.createdAt).getTime(); return o.status !== 'CANCELLED' && age >= d30 && age < d60; });

  const suggestions = [];
  products.forEach(p => {
    if (p.inventoryMode === 'MASS') {
      const toKg = item => {
        const spec = String(item.spec || '').trim().toLowerCase().replace(/\s+/g, '');
        const match = spec.match(/^(\d+(?:\.\d+)?)(kg|公斤|千克|g|克|ml|毫升|l|升)/);
        if (!match) return 0;
        let value = Number(match[1]);
        const unit = match[2];
        if (['kg', '公斤', '千克'].includes(unit)) return value * Number(item.quantity || 0);
        if (['g', '克'].includes(unit)) return value / 1000 * Number(item.quantity || 0);
        if (!p.densityGml) return 0;
        if (['l', '升'].includes(unit)) value *= 1000;
        return value * p.densityGml / 1000 * Number(item.quantity || 0);
      };
      const sumKg = list => list.reduce((sum, o) => sum + (o.items || []).filter(it => it.productId === p.id).reduce((s, it) => s + toKg(it), 0), 0);
      const recentKg = sumKg(recent);
      const priorKg = sumKg(prior);
      if (recentKg === 0 && priorKg === 0) return;
      const forecast = (recentKg + priorKg) / 2;
      const stock = Number(p.baseStockKg || 0);
      const safe = Number(p.safeStockKg || 0);
      const suggestedQty = Math.max(0, forecast + safe - stock);
      if (suggestedQty > 0) {
        const trend = priorKg > 0 ? Math.round((recentKg / priorKg - 1) * 100) : 100;
        const urgency = stock <= safe ? 'HIGH' : stock < safe * 2 ? 'MEDIUM' : 'LOW';
        suggestions.push({ productId: p.id, productName: p.name, productCode: p.code, specId: p.specs[0]?.id, spec: '共享重量库存', currentStock: Number(stock.toFixed(3)), safeStock: Number(safe.toFixed(3)), recent30: Number(recentKg.toFixed(3)), prior30: Number(priorKg.toFixed(3)), trend, forecast, suggestedQty: Number(suggestedQty.toFixed(3)), urgency, unit: 'kg' });
      }
      return;
    }
    p.specs.forEach(s => {
    let recentQty = 0, priorQty = 0;
    recent.forEach(o => o.items.forEach(it => { if (it.productId === p.id && it.spec === s.spec) recentQty += it.quantity; }));
    prior.forEach(o => o.items.forEach(it => { if (it.productId === p.id && it.spec === s.spec) priorQty += it.quantity; }));
    if (recentQty === 0 && priorQty === 0) return;
    const forecast = Math.round((recentQty + priorQty) / 2);
    const suggestedQty = Math.max(0, forecast + s.safeStock - s.stock);
    if (suggestedQty > 0) {
      const trend = priorQty > 0 ? Math.round((recentQty / priorQty - 1) * 100) : 100;
      const urgency = s.stock <= s.safeStock ? 'HIGH' : s.stock < s.safeStock * 2 ? 'MEDIUM' : 'LOW';
      suggestions.push({
        productId: p.id, productName: p.name, productCode: p.code,
        specId: s.id, spec: s.spec, currentStock: s.stock, safeStock: s.safeStock,
        recent30: recentQty, prior30: priorQty, trend, forecast, suggestedQty, urgency
      });
    }
    });
  });
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return suggestions.sort((a, b) => order[a.urgency] - order[b.urgency] || b.suggestedQty - a.suggestedQty);
}

export async function updateScenarioPackageItems(packageId, items) {
  await supabase.from('scenario_package_items').delete().eq('package_id', packageId);
  if (items.length) {
    await supabase.from('scenario_package_items').insert(items.map(it => ({
      package_id: packageId, product_id: it.productId, spec_id: it.specId, quantity: it.quantity
    })));
  }
}
