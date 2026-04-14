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

// ═══ PRODUCTS ═══
export async function fetchProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*, specs:product_specs(*)')
    .order('id');
  if (error) throw new Error(error.message);
  return data.map(p => ({
    id: p.id,
    code: p.code,
    name: p.name,
    series: p.series,
    origin: p.origin,
    specs: (p.specs || []).map(s => ({
      id: s.id,
      spec: s.spec,
      price: Number(s.price),
      stock: s.stock,
      safeStock: s.safe_stock
    }))
  }));
}

export async function createProduct(product) {
  const { data: p, error: pe } = await supabase
    .from('products')
    .insert({ code: product.code, name: product.name, series: product.series, origin: product.origin || '中国' })
    .select()
    .single();
  if (pe) throw new Error(pe.message);

  const specsToInsert = product.specs.map(s => ({
    product_id: p.id,
    spec: s.spec,
    price: s.price,
    stock: s.stock || 0,
    safe_stock: s.safeStock || 10
  }));
  const { data: specs, error: se } = await supabase
    .from('product_specs')
    .insert(specsToInsert)
    .select();
  if (se) throw new Error(se.message);

  return {
    id: p.id,
    code: p.code,
    name: p.name,
    series: p.series,
    origin: p.origin,
    specs: specs.map(s => ({
      id: s.id, spec: s.spec, price: Number(s.price), stock: s.stock, safeStock: s.safe_stock
    }))
  };
}

export async function deleteProduct(productId) {
  const { error } = await supabase.from('products').delete().eq('id', productId);
  if (error) throw new Error(error.message);
}

export async function updateStock(specId, newStock) {
  const { error } = await supabase.from('product_specs').update({ stock: newStock }).eq('id', specId);
  if (error) throw new Error(error.message);
}

// ═══ CUSTOMERS ═══
export async function fetchCustomers() {
  const { data, error } = await supabase
    .from('customers')
    .select('*, notes:customer_notes(*)')
    .order('id');
  if (error) throw new Error(error.message);
  return data.map(c => ({
    id: c.id,
    name: c.name,
    contact: c.contact,
    phone: c.phone,
    address: c.address,
    type: c.type,
    salesId: c.sales_id,
    notes: (c.notes || []).map(n => ({
      id: n.id,
      text: n.text,
      by: n.by_user,
      time: n.created_at
    }))
  }));
}

export async function createCustomer(customer) {
  const { data, error } = await supabase
    .from('customers')
    .insert({
      name: customer.name,
      contact: customer.contact,
      phone: customer.phone,
      address: customer.address,
      type: customer.type,
      sales_id: customer.salesId || null
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, name: data.name, contact: data.contact, phone: data.phone, address: data.address, type: data.type, salesId: data.sales_id, notes: [] };
}

export async function addCustomerNote(customerId, text, byUser) {
  const { data, error } = await supabase
    .from('customer_notes')
    .insert({ customer_id: customerId, text, by_user: byUser })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, text: data.text, by: data.by_user, time: data.created_at };
}

// ═══ ORDERS ═══
export async function fetchOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('*, items:order_items(*), logs:order_logs(*), shipment:shipments(*)')
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return data.map(mapOrder);
}

function mapOrder(o) {
  return {
    id: o.id,
    orderNo: o.order_no,
    customerId: o.customer_id,
    salesId: o.sales_id,
    status: o.status,
    subtotal: Number(o.subtotal),
    discountPercent: Number(o.discount_percent),
    discountAmount: Number(o.discount_amount),
    total: Number(o.total),
    notes: o.notes || '',
    createdAt: o.created_at,
    items: (o.items || []).map(it => ({
      id: it.id,
      productId: it.product_id,
      specId: it.spec_id,
      productName: it.product_name,
      productCode: it.product_code,
      spec: it.spec,
      quantity: it.quantity,
      unitPrice: Number(it.unit_price),
      subtotal: Number(it.subtotal)
    })),
    logs: (o.logs || []).sort((a, b) => a.id - b.id).map(l => ({
      id: l.id,
      time: l.time,
      user: l.user_name,
      action: l.action
    })),
    shipment: o.shipment?.[0] ? {
      carrier: o.shipment[0].carrier,
      trackingNo: o.shipment[0].tracking_no,
      shippedAt: o.shipment[0].shipped_at,
      operator: o.shipment[0].operator
    } : null
  };
}

export async function createOrder(order) {
  const { data: o, error: oe } = await supabase
    .from('orders')
    .insert({
      order_no: order.orderNo,
      customer_id: order.customerId,
      sales_id: order.salesId,
      status: order.status || 'DRAFT',
      subtotal: order.subtotal,
      discount_percent: order.discountPercent || 0,
      discount_amount: order.discountAmount || 0,
      total: order.total,
      notes: order.notes || '',
      created_at: order.createdAt
    })
    .select()
    .single();
  if (oe) throw new Error(oe.message);

  if (order.items?.length) {
    const { error: ie } = await supabase.from('order_items').insert(
      order.items.map(it => ({
        order_id: o.id,
        product_id: it.productId,
        spec_id: it.specId,
        product_name: it.productName,
        product_code: it.productCode,
        spec: it.spec,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        subtotal: it.subtotal
      }))
    );
    if (ie) throw new Error(ie.message);
  }

  if (order.logs?.length) {
    const { error: le } = await supabase.from('order_logs').insert(
      order.logs.map(l => ({
        order_id: o.id,
        time: l.time,
        user_name: l.user,
        action: l.action
      }))
    );
    if (le) throw new Error(le.message);
  }

  // Deduct stock for each item
  for (const it of (order.items || [])) {
    if (it.specId) {
      const { data: spec } = await supabase.from('product_specs').select('stock').eq('id', it.specId).single();
      if (spec) {
        await supabase.from('product_specs').update({ stock: Math.max(0, spec.stock - it.quantity) }).eq('id', it.specId);
      }
    }
  }

  return o.id;
}

export async function updateOrderStatus(orderId, newStatus, logEntry, shipmentData) {
  const { error: oe } = await supabase.from('orders').update({ status: newStatus }).eq('id', orderId);
  if (oe) throw new Error(oe.message);

  if (logEntry) {
    const { error: le } = await supabase.from('order_logs').insert({
      order_id: orderId,
      time: logEntry.time,
      user_name: logEntry.user,
      action: logEntry.action
    });
    if (le) throw new Error(le.message);
  }

  if (shipmentData) {
    const { error: se } = await supabase.from('shipments').insert({
      order_id: orderId,
      carrier: shipmentData.carrier,
      tracking_no: shipmentData.trackingNo,
      shipped_at: shipmentData.shippedAt,
      operator: shipmentData.operator
    });
    if (se) throw new Error(se.message);
  }

  // If cancelled, restore stock
  if (newStatus === 'CANCELLED') {
    const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
    for (const it of (items || [])) {
      if (it.spec_id) {
        const { data: spec } = await supabase.from('product_specs').select('stock').eq('id', it.spec_id).single();
        if (spec) {
          await supabase.from('product_specs').update({ stock: spec.stock + it.quantity }).eq('id', it.spec_id);
        }
      }
    }
  }
}
