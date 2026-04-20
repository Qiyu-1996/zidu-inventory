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

// ═══ PRODUCTS ═══
function mapProduct(p) {
  return {
    id: p.id, code: p.code, name: p.name, series: p.series, origin: p.origin,
    specs: (p.specs || []).map(s => ({
      id: s.id, spec: s.spec, price: Number(s.price), stock: s.stock, safeStock: s.safe_stock
    }))
  };
}

export async function fetchProducts() {
  const { data, error } = await supabase.from('products').select('*, specs:product_specs(*)').order('id');
  if (error) throw new Error(error.message);
  return data.map(mapProduct);
}

export async function createProduct(product) {
  const { data: p, error: pe } = await supabase
    .from('products')
    .insert({ code: product.code, name: product.name, series: product.series, origin: product.origin || '中国' })
    .select().single();
  if (pe) throw new Error(pe.message);

  const { data: specs, error: se } = await supabase.from('product_specs')
    .insert(product.specs.map(s => ({ product_id: p.id, spec: s.spec, price: s.price, stock: s.stock || 0, safe_stock: s.safeStock || 10 })))
    .select();
  if (se) throw new Error(se.message);

  return { id: p.id, code: p.code, name: p.name, series: p.series, origin: p.origin,
    specs: specs.map(s => ({ id: s.id, spec: s.spec, price: Number(s.price), stock: s.stock, safeStock: s.safe_stock }))
  };
}

export async function updateProduct(product) {
  const { error: pe } = await supabase.from('products')
    .update({ code: product.code, name: product.name, series: product.series, origin: product.origin })
    .eq('id', product.id);
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
      await supabase.from('product_specs').update({ spec: s.spec, price: s.price, stock: s.stock, safe_stock: s.safeStock }).eq('id', s.id);
    } else {
      await supabase.from('product_specs').insert({ product_id: product.id, spec: s.spec, price: s.price, stock: s.stock || 0, safe_stock: s.safeStock || 10 });
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
    notes: (c.notes || []).map(n => ({ id: n.id, text: n.text, by: n.by_user, time: n.created_at }))
  };
}

export async function fetchCustomers() {
  const { data, error } = await supabase.from('customers').select('*, notes:customer_notes(*)').order('id');
  if (error) throw new Error(error.message);
  return data.map(mapCustomer);
}

export async function createCustomer(customer) {
  const { data, error } = await supabase.from('customers')
    .insert({ name: customer.name, contact: customer.contact, phone: customer.phone, address: customer.address, type: customer.type, sales_id: customer.salesId || null })
    .select().single();
  if (error) throw new Error(error.message);
  return { ...mapCustomer({ ...data, notes: [] }), notes: [] };
}

export async function updateCustomer(id, fields) {
  const { data, error } = await supabase.from('customers')
    .update({ name: fields.name, contact: fields.contact, phone: fields.phone, address: fields.address, type: fields.type, sales_id: fields.salesId || null })
    .eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data;
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
    createdAt: o.created_at,
    paymentStatus: o.payment_status || 'UNPAID',
    paidAmount: Number(o.paid_amount || 0),
    items: (o.items || []).map(it => ({
      id: it.id, productId: it.product_id, specId: it.spec_id,
      productName: it.product_name, productCode: it.product_code, spec: it.spec,
      quantity: it.quantity, unitPrice: Number(it.unit_price), subtotal: Number(it.subtotal)
    })),
    logs: (o.logs || []).sort((a, b) => a.id - b.id).map(l => ({ id: l.id, time: l.time, user: l.user_name, action: l.action })),
    shipment: o.shipment?.[0] ? {
      carrier: o.shipment[0].carrier, trackingNo: o.shipment[0].tracking_no,
      shippedAt: o.shipment[0].shipped_at, operator: o.shipment[0].operator
    } : null,
    payments: (o.payments || []).map(p => ({
      id: p.id, amount: Number(p.amount), method: p.method, note: p.note,
      recordedBy: p.recorded_by, createdAt: p.created_at
    }))
  };
}

export async function fetchOrders() {
  const { data, error } = await supabase.from('orders')
    .select('*, items:order_items(*), logs:order_logs(*), shipment:shipments(*), payments:payment_records(*)')
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return data.map(mapOrder);
}

export async function createOrder(order) {
  const { data: o, error: oe } = await supabase.from('orders')
    .insert({
      order_no: order.orderNo, customer_id: order.customerId, sales_id: order.salesId,
      status: order.status || 'DRAFT', subtotal: order.subtotal,
      discount_percent: order.discountPercent || 0, discount_amount: order.discountAmount || 0,
      total: order.total, notes: order.notes || '', created_at: order.createdAt
    }).select().single();
  if (oe) throw new Error(oe.message);

  if (order.items?.length) {
    await supabase.from('order_items').insert(order.items.map(it => ({
      order_id: o.id, product_id: it.productId, spec_id: it.specId,
      product_name: it.productName, product_code: it.productCode, spec: it.spec,
      quantity: it.quantity, unit_price: it.unitPrice, subtotal: it.subtotal
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

export async function deleteOrder(orderId, restoreStock = true) {
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
            note: `删除订单恢复库存`, operator_name: ''
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
export async function recordPayment(orderId, amount, method, note, recordedBy) {
  await supabase.from('payment_records').insert({ order_id: orderId, amount, method, note, recorded_by: recordedBy });
  // Recalculate payment status
  const { data: payments } = await supabase.from('payment_records').select('amount').eq('order_id', orderId);
  const totalPaid = (payments || []).reduce((s, p) => s + Number(p.amount), 0);
  const { data: order } = await supabase.from('orders').select('total').eq('id', orderId).single();
  const status = totalPaid >= Number(order.total) ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID';
  await supabase.from('orders').update({ payment_status: status, paid_amount: totalPaid }).eq('id', orderId);
  return { totalPaid, status };
}

// ═══ STOCK ADJUSTMENTS ═══
export async function adjustStock(specId, productId, type, reason, quantity, note, operatorName) {
  const { data: spec } = await supabase.from('product_specs').select('stock').eq('id', specId).single();
  if (!spec) throw new Error('规格不存在');
  const before = spec.stock;
  let after;
  if (type === 'IN') after = before + quantity;
  else if (type === 'OUT') after = Math.max(0, before - quantity);
  else after = quantity; // CORRECTION = set to exact value

  await supabase.from('product_specs').update({ stock: after }).eq('id', specId);
  await supabase.from('stock_adjustments').insert({
    spec_id: specId, product_id: productId, type, reason, quantity: type === 'CORRECTION' ? Math.abs(after - before) : quantity,
    before_stock: before, after_stock: after, note, operator_name: operatorName
  });
  return { before, after };
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
      quantity: it.quantity, receivedQty: it.received_qty,
      unitCost: Number(it.unit_cost), subtotal: Number(it.subtotal)
    }))
  }));
}

export async function createPurchaseOrder(po) {
  const { data: created, error } = await supabase.from('purchase_orders')
    .insert({ po_no: po.poNo, supplier: po.supplier, status: 'DRAFT', total: po.total, notes: po.notes || '', created_by_name: po.createdByName })
    .select().single();
  if (error) throw new Error(error.message);

  if (po.items?.length) {
    await supabase.from('purchase_order_items').insert(po.items.map(it => ({
      po_id: created.id, product_id: it.productId, spec_id: it.specId,
      product_name: it.productName, spec: it.spec,
      quantity: it.quantity, received_qty: 0, unit_cost: it.unitCost, subtotal: it.subtotal
    })));
  }
  return created.id;
}

export async function updatePurchaseOrderStatus(poId, status) {
  await supabase.from('purchase_orders').update({ status }).eq('id', poId);
}

export async function receivePurchaseItems(poId, receivedItems, operatorName) {
  for (const ri of receivedItems) {
    if (ri.receiveQty <= 0) continue;
    // Update PO item received_qty
    await supabase.from('purchase_order_items').update({ received_qty: ri.newReceivedQty }).eq('id', ri.itemId);
    // Increase stock
    const { data: spec } = await supabase.from('product_specs').select('stock').eq('id', ri.specId).single();
    if (spec) {
      const newStock = spec.stock + ri.receiveQty;
      await supabase.from('product_specs').update({ stock: newStock }).eq('id', ri.specId);
      await supabase.from('stock_adjustments').insert({
        spec_id: ri.specId, product_id: ri.productId, type: 'IN', reason: 'PURCHASE',
        quantity: ri.receiveQty, before_stock: spec.stock, after_stock: newStock,
        note: `采购单 ${ri.poNo || ''}`, operator_name: operatorName
      });
    }
  }
  // Check if all items fully received
  const { data: items } = await supabase.from('purchase_order_items').select('quantity, received_qty').eq('po_id', poId);
  const allReceived = items.every(it => it.received_qty >= it.quantity);
  const someReceived = items.some(it => it.received_qty > 0);
  const newStatus = allReceived ? 'RECEIVED' : someReceived ? 'PARTIAL_RECEIVED' : 'ORDERED';
  await supabase.from('purchase_orders').update({ status: newStatus }).eq('id', poId);
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
  const { data, error } = await supabase.from('product_batches').insert({
    batch_no: batch.batchNo, product_id: batch.productId, spec_id: batch.specId,
    gcms_no: batch.gcmsNo || null, received_date: batch.receivedDate,
    expiry_date: batch.expiryDate || null, initial_qty: batch.quantity,
    remaining_qty: batch.quantity, unit_cost: batch.unitCost || 0,
    supplier: batch.supplier || '', note: batch.note || ''
  }).select().single();
  if (error) throw new Error(error.message);

  // 同时增加 spec 库存
  const { data: spec } = await supabase.from('product_specs').select('stock').eq('id', batch.specId).single();
  const newStock = (spec?.stock || 0) + batch.quantity;
  await supabase.from('product_specs').update({ stock: newStock }).eq('id', batch.specId);

  // 记录库存调整
  await supabase.from('stock_adjustments').insert({
    spec_id: batch.specId, product_id: batch.productId, type: 'IN', reason: 'PURCHASE',
    quantity: batch.quantity, before_stock: spec?.stock || 0, after_stock: newStock,
    note: `批次 ${batch.batchNo}${batch.gcmsNo ? ` · GC-MS ${batch.gcmsNo}` : ''}`,
    operator_name: batch.operatorName || '', batch_id: data.id
  });

  return mapBatch(data);
}

export async function deleteBatch(batchId) {
  const { data: batch } = await supabase.from('product_batches').select('*').eq('id', batchId).single();
  if (batch) {
    // 扣减对应库存
    const { data: spec } = await supabase.from('product_specs').select('stock').eq('id', batch.spec_id).single();
    const newStock = Math.max(0, (spec?.stock || 0) - batch.remaining_qty);
    await supabase.from('product_specs').update({ stock: newStock }).eq('id', batch.spec_id);
    await supabase.from('stock_adjustments').insert({
      spec_id: batch.spec_id, product_id: batch.product_id, type: 'OUT', reason: 'OTHER',
      quantity: batch.remaining_qty, before_stock: spec?.stock || 0, after_stock: newStock,
      note: `删除批次 ${batch.batch_no}`, operator_name: ''
    });
  }
  const { error } = await supabase.from('product_batches').delete().eq('id', batchId);
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
    note: t.note || ''
  }));
}

export async function upsertSalesTarget(target) {
  const { data: existing } = await supabase.from('sales_targets')
    .select('id').eq('sales_id', target.salesId).eq('year', target.year).eq('month', target.month).maybeSingle();
  if (existing) {
    const { error } = await supabase.from('sales_targets').update({
      target_amount: target.targetAmount, commission_rate: target.commissionRate || 0, note: target.note || ''
    }).eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('sales_targets').insert({
      sales_id: target.salesId, year: target.year, month: target.month,
      target_amount: target.targetAmount, commission_rate: target.commissionRate || 0, note: target.note || ''
    });
    if (error) throw new Error(error.message);
  }
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
  products.forEach(p => p.specs.forEach(s => {
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
  }));
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
