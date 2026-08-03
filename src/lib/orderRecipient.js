function text(value) {
  return String(value == null ? '' : value).trim();
}

function addressFromMeta(order) {
  const raw = order?.channelMeta?.address;
  if (!raw) return {};
  if (typeof raw === 'string') return { detail: text(raw) };
  if (typeof raw !== 'object') return {};
  return {
    name: text(raw.name || raw.userName || raw.contact),
    phone: text(raw.phone || raw.telNumber || raw.mobile),
    region: text(raw.region || [raw.provinceName, raw.cityName, raw.countyName].filter(Boolean).join(' ')),
    detail: text(raw.detail || raw.detailInfo || raw.address)
  };
}

export function resolveOrderRecipient(order, customer) {
  const meta = addressFromMeta(order);
  const province = text(customer?.province) || meta.region;
  const address = text(customer?.address) || meta.detail;
  const fullAddress = [province, address].filter(Boolean).join(' ');
  const fallbackName = order?.source === 'wechat_2c' ? '微信商城客户' : '';

  return {
    name: text(customer?.name) || meta.name || fallbackName,
    contact: text(customer?.contact) || meta.name || text(customer?.name) || fallbackName,
    phone: text(customer?.phone) || meta.phone,
    province,
    address,
    fullAddress,
  };
}
