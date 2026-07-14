import { supabase } from './supabase';
import { requirePaymentMethod } from './payment';

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
  if (error) throw new Error(/gen_salt|crypt\(/i.test(error.message || '') ? '请先在 Supabase 运行 migration_v26_admin_user_management.sql' : error.message);
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
  if (error) throw new Error(/gen_salt|crypt\(|admin_reset_password|schema cache|could not find/i.test(error.message || '') ? '请先在 Supabase 运行 migration_v26_admin_user_management.sql' : error.message);
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
  if (error) throw new Error(/admin_update_user_role|schema cache|could not find/i.test(error.message || '') ? '请先在 Supabase 运行 migration_v26_admin_user_management.sql' : error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function archiveUser(adminId, targetUserId) {
  const { data, error } = await supabase.rpc('admin_archive_user', {
    p_admin_id: adminId, p_target_user_id: targetUserId
  });
  if (error) throw new Error(/gen_salt|crypt\(|admin_archive_user|schema cache|could not find/i.test(error.message || '') ? '请先在 Supabase 运行 migration_v26_admin_user_management.sql' : error.message);
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

function isMissingDiscountResponsibilityError(error) {
  return /discount_responsibility|discount_reason|discount_responsibility_updated/i.test(error?.message || '');
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

export async function updateProductDensity(productId, densityGml) {
  const density = Number(densityGml);
  if (!Number.isFinite(density) || density <= 0) throw new Error('密度必须大于 0');

  const { data, error } = await supabase.from('products')
    .update({
      density_g_ml: density,
      density_temperature_c: 20,
      density_source: '管理员在库存页设置',
      density_status: 'REFERENCE'
    })
    .eq('id', productId)
    .select('id, density_g_ml, density_temperature_c, density_source, density_status')
    .single();
  if (isMissingMassInventoryError(error)) throw new Error('请先在 Supabase 运行最新数据库迁移');
  if (error) throw new Error(error.message);

  return {
    id: data.id,
    densityGml: Number(data.density_g_ml),
    densityTemperatureC: Number(data.density_temperature_c || 20),
    densitySource: data.density_source || '',
    densityStatus: data.density_status || 'REFERENCE'
  };
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
function mapShipment(s) {
  if (!s) return null;
  return {
    id: s.id,
    carrier: s.carrier,
    trackingNo: s.tracking_no,
    shippedAt: s.shipped_at,
    operator: s.operator,
    trackingState: s.tracking_state || '',
    trackingStateCode: s.tracking_state_code || '',
    trackingMessage: s.tracking_message || '',
    trackingEvents: Array.isArray(s.tracking_events) ? s.tracking_events : [],
    trackingUpdatedAt: s.tracking_updated_at || null
  };
}

function latestShipment(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.reduce((latest, row) => Number(row.id || 0) > Number(latest.id || 0) ? row : latest, rows[0]);
}

function mapOrder(o) {
  return {
    id: o.id, orderNo: o.order_no, customerId: o.customer_id, salesId: o.sales_id,
    status: o.status, subtotal: Number(o.subtotal), discountPercent: Number(o.discount_percent),
    discountAmount: Number(o.discount_amount), total: Number(o.total), notes: o.notes || '',
    discountResponsibility: o.discount_responsibility === 'SALES' ? 'SALES' : 'COMPANY',
    discountReason: o.discount_reason || '',
    discountResponsibilityUpdatedBy: o.discount_responsibility_updated_by || '',
    discountResponsibilityUpdatedAt: o.discount_responsibility_updated_at || null,
    businessType: o.business_type || '院线',
    source: o.source || 'b2b',
    channelMeta: o.channel_meta || null,
    createdAt: o.created_at,
    paymentStatus: o.payment_status || 'UNPAID',
    paidAmount: Number(o.paid_amount || 0),
    unpaidShippingStatus: o.unpaid_shipping_status || 'NONE',
    unpaidShippingReason: o.unpaid_shipping_reason || '',
    unpaidShippingRequestedBy: o.unpaid_shipping_requested_by || null,
    unpaidShippingRequestedAt: o.unpaid_shipping_requested_at || null,
    unpaidShippingReviewedBy: o.unpaid_shipping_reviewed_by || null,
    unpaidShippingReviewedAt: o.unpaid_shipping_reviewed_at || null,
    unpaidShippingReviewNote: o.unpaid_shipping_review_note || '',
    items: (o.items || []).map(it => ({
      id: it.id, productId: it.product_id, specId: it.spec_id,
      productName: it.product_name, productCode: it.product_code, spec: it.spec,
      quantity: it.quantity, unitPrice: Number(it.unit_price), unitCost: Number(it.unit_cost || 0), subtotal: Number(it.subtotal)
    })),
    logs: (o.logs || []).sort((a, b) => a.id - b.id).map(l => ({ id: l.id, time: l.time, user: l.user_name, action: l.action })),
    shipment: mapShipment(latestShipment(o.shipment)),
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

function orderIntegrityError(error) {
  const message = error?.message || '';
  if (/zidu_(cancel_order|update_order_status_atomic|record_payment_atomic|update_order_items_atomic|create_after_sale_atomic|process_after_sale_warehouse_atomic|complete_after_sale_finance_atomic|cancel_after_sale|delete_order_atomic)|schema cache|could not find the function/i.test(message)) {
    return new Error('请先在 Supabase 运行 supabase/migration_v34_order_after_sales_integrity.sql');
  }
  return new Error(message || '订单操作失败');
}

async function writeStockAdjustment(specId, productId, type, reason, quantity, note, operatorName) {
  if (!specId || !quantity) return;
  const result = await adjustInventoryValue(specId, type, Number(quantity), 'SPEC');
  if (result?.error) throw new Error(result.error);
  const { error: logError } = await supabase.from('stock_adjustments').insert({
    spec_id: specId,
    product_id: productId,
    type,
    reason,
    quantity: Number(quantity),
    before_stock: result.before,
    after_stock: result.after,
    quantity_kg: result.quantityKg,
    before_stock_kg: result.beforeKg,
    after_stock_kg: result.afterKg,
    note,
    operator_name: operatorName || ''
  });
  if (logError) throw new Error(logError.message);
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
  const { data, error } = await supabase.rpc('zidu_create_after_sale_atomic', {
    p_order_id: Number(orderId),
    p_payload: payload || {}
  });
  if (error) throw orderIntegrityError(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function processAfterSaleWarehouse(afterSaleId, payload) {
  const { data, error } = await supabase.rpc('zidu_process_after_sale_warehouse_atomic', {
    p_after_sale_id: Number(afterSaleId),
    p_payload: payload || {}
  });
  if (error) throw orderIntegrityError(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function completeAfterSaleFinance(afterSaleId, payload) {
  if (Number(payload?.amount || 0) !== 0) requirePaymentMethod(payload.method);
  const { data, error } = await supabase.rpc('zidu_complete_after_sale_finance_atomic', {
    p_after_sale_id: Number(afterSaleId),
    p_payload: payload || {}
  });
  if (error) throw orderIntegrityError(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function cancelAfterSale(afterSaleId, operatorName, note = '') {
  const { data, error } = await supabase.rpc('zidu_cancel_after_sale', {
    p_after_sale_id: Number(afterSaleId),
    p_operator_name: operatorName || '',
    p_note: note || ''
  });
  if (error) throw orderIntegrityError(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function createOrder(order) {
  const { data, error } = await supabase.rpc('zidu_create_order_atomic', { p_order: order });
  if (error) {
    if (/zidu_create_order_atomic|schema cache|could not find the function/i.test(error.message || '')) {
      throw new Error('请先在 Supabase 运行 migration_v32_no_backorder_atomic_orders.sql');
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  return Number(data?.id || 0);
}

export async function updateOrderDiscountResponsibility(orderId, responsibility, reason, updatedBy = '') {
  const normalized = responsibility === 'SALES' ? 'SALES' : 'COMPANY';
  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from('orders').update({
    discount_responsibility: normalized,
    discount_reason: String(reason || '').trim(),
    discount_responsibility_updated_by: updatedBy,
    discount_responsibility_updated_at: updatedAt
  }).eq('id', orderId);
  if (error) {
    if (isMissingDiscountResponsibilityError(error)) {
      throw new Error('请先在 Supabase 运行 supabase/migration_v29_sales_commission.sql');
    }
    throw new Error(error.message);
  }
  await insertOrderLog(
    orderId,
    updatedAt.slice(0, 16),
    updatedBy,
    `确认折扣承担：${normalized === 'SALES' ? '销售承担' : '公司承担'}${reason ? `；${String(reason).trim()}` : ''}`
  );
  return {
    discountResponsibility: normalized,
    discountReason: String(reason || '').trim(),
    discountResponsibilityUpdatedBy: updatedBy,
    discountResponsibilityUpdatedAt: updatedAt
  };
}

export async function updateOrderItems(orderId, changes, totals, logEntry) {
  const { data, error } = await supabase.rpc('zidu_update_order_items_atomic', {
    p_order_id: Number(orderId),
    p_changes: changes || [],
    p_totals: totals || {},
    p_log: logEntry || {}
  });
  if (error) throw orderIntegrityError(error);
  if (data?.error) throw new Error(data.error);
  return data;
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
    discount_responsibility: old.discount_responsibility === 'SALES' ? 'SALES' : 'COMPANY',
    discount_reason: old.discount_reason || '',
    discount_responsibility_updated_by: old.discount_responsibility_updated_by || '',
    discount_responsibility_updated_at: old.discount_responsibility_updated_at || null,
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
      finance_method: a.finance_method || '',
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
      await writeStockAdjustment(
        it.spec_id,
        it.product_id,
        'OUT',
        'ORDER',
        Number(it.quantity || 0),
        `恢复删除订单 ${deleted.order_no}`,
        restoredBy
      );
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
  const { data, error } = await supabase.rpc('zidu_delete_order_atomic', {
    p_order_id: Number(orderId),
    p_restore_stock: Boolean(restoreStock),
    p_deleted_by: deletedBy || ''
  });
  if (error) throw orderIntegrityError(error);
  if (data?.error) throw new Error(data.error);
  return data;
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
  if (newStatus === 'CANCELLED') {
    const { data, error } = await supabase.rpc('zidu_cancel_order', {
      p_order_id: Number(orderId),
      p_operator_name: logEntry?.user || '',
      p_time: logEntry?.time || ''
    });
    if (error) throw orderIntegrityError(error);
    if (data?.error) throw new Error(data.error);
    return data;
  }
  const { data, error } = await supabase.rpc('zidu_update_order_status_atomic', {
    p_order_id: Number(orderId),
    p_new_status: newStatus,
    p_log: logEntry || {},
    p_shipment: shipmentData || null
  });
  if (error) throw orderIntegrityError(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

function unpaidShippingError(error, data) {
  const message = data?.error || error?.message || '';
  if (/request_unpaid_shipping|review_unpaid_shipping|unpaid_shipping_|schema cache|could not find the function/i.test(message)) {
    return new Error('请先在 Supabase 依次运行 migration_v31_unpaid_shipping_approval.sql 和 migration_v33_admin_unpaid_shipping_override.sql');
  }
  return new Error(message || '未收款发货申请处理失败');
}

export async function requestUnpaidShipping(orderId, salesId, reason) {
  const { data, error } = await supabase.rpc('request_unpaid_shipping', {
    p_order_id: Number(orderId),
    p_sales_id: Number(salesId),
    p_reason: String(reason || '').trim()
  });
  if (error) throw unpaidShippingError(error, data);
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function reviewUnpaidShipping(orderId, adminId, approved, note = '') {
  const { data, error } = await supabase.rpc('review_unpaid_shipping', {
    p_order_id: Number(orderId),
    p_admin_id: Number(adminId),
    p_approved: Boolean(approved),
    p_note: String(note || '').trim()
  });
  if (error) throw unpaidShippingError(error, data);
  if (data?.error) throw new Error(data.error);
  return data;
}

// ═══ PAYMENTS ═══
export async function recordPayment(orderId, amount, method, note, recordedBy, priceAdjustment = 0) {
  const paymentMethod = requirePaymentMethod(method);
  const { data, error } = await supabase.rpc('zidu_record_payment_atomic', {
    p_order_id: Number(orderId),
    p_amount: roundMoney(Number(amount || 0)),
    p_method: paymentMethod,
    p_note: note || '',
    p_recorded_by: recordedBy || '',
    p_price_adjustment: roundMoney(Number(priceAdjustment || 0))
  });
  if (error) throw orderIntegrityError(error);
  if (data?.error) throw new Error(data.error);
  return data;
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
    if (type === 'OUT' && Number(quantity || 0) > before) throw new Error('库存不足');
    const after = type === 'IN' ? before + quantity : type === 'OUT' ? before - quantity : quantity;
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

export async function adjustRawStock(productId, type, reason, quantityKg, note, operatorName, densityGml = null, densityTemperatureC = 20) {
  const { data, error } = await supabase.rpc('zidu_adjust_raw_inventory', {
    p_product_id: productId,
    p_type: type,
    p_quantity_kg: Number(quantityKg),
    p_reason: reason,
    p_note: note || '',
    p_operator_name: operatorName || '',
    p_density_g_ml: densityGml ? Number(densityGml) : null,
    p_density_temperature_c: Number(densityTemperatureC || 20)
  });
  if (error) {
    if (/zidu_adjust_raw_inventory|schema cache|could not find the function/i.test(error.message || '')) {
      throw new Error('请先在 Supabase 运行 migration_v23_raw_kg_inventory.sql');
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
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
  const { error: schemaError } = await supabase.from('product_batches')
    .select('purchase_order_item_id').limit(1);
  if (schemaError) {
    if (/purchase_order_item_id|column|schema cache|PGRST204/i.test(schemaError.message || '')) {
      throw new Error('请先运行 migration_v25_purchase_receiving_batches.sql，再执行采购收货');
    }
    throw new Error(schemaError.message);
  }
  const { data, error } = await supabase.rpc('zidu_receive_purchase_order', {
    p_po_id: poId, p_items: receivedItems, p_operator_name: operatorName || ''
  });
  if (error) throw new Error(/zidu_receive_purchase_order|schema cache|could not find/i.test(error.message || '') ? '请先运行 migration_v25_purchase_receiving_batches.sql' : error.message);
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
    unitCost: Number(b.unit_cost || 0), supplier: b.supplier || '', note: b.note || '',
    purchaseOrderId: b.purchase_order_id || null, purchaseOrderItemId: b.purchase_order_item_id || null
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
    if (p.channel === 'RAW') {
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
        suggestions.push({ productId: p.id, productName: p.name, productCode: p.code, specId: p.specs[0]?.id, spec: '重量库存', currentStock: Number(stock.toFixed(3)), safeStock: Number(safe.toFixed(3)), recent30: Number(recentKg.toFixed(3)), prior30: Number(priorKg.toFixed(3)), trend, forecast, suggestedQty: Number(suggestedQty.toFixed(3)), urgency, unit: 'kg' });
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
