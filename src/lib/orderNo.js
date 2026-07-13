const TYPE_CODE = {
  工厂: 'FAC',
  品牌: 'BRD',
  美容院: 'BEA',
  养生馆: 'HLT',
  医疗机构: 'MED',
  SPA馆: 'SPA',
  头疗馆: 'HAI',
  足浴店: 'FOO',
  瑜伽馆: 'YOG',
  个人: 'PER',
  零售店: 'RET',
  展会: 'EXH',
  线下: 'OFF',
  其他: 'OTH'
};

function pad(n, len) {
  let s = String(n ?? '');
  while (s.length < len) s = '0' + s;
  return s;
}

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

export function localMinuteKey(date = new Date()) {
  return `${localDateKey(date)}T${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}`;
}

function yymmdd(date = new Date()) {
  return `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}`;
}

function sourcePrefix(source) {
  if (source === 'RAW') return 'ZDR';
  if (source === 'FINISHED') return 'ZDF';
  if (source === 'MIXED') return 'ZDM';
  if (source === 'BRAND_CUSTOM') return 'ZDB';
  if (source === 'PRIVATE_CUSTOM') return 'ZDP';
  if (source === 'OEM') return 'ZDB';
  if (source === 'ODM') return 'ZDP';
  return 'ZDF';
}

function customerCode(customer = {}) {
  if (customer.distributorLevel === 1) return 'D1';
  if (customer.distributorLevel === 2) return 'D2';
  return TYPE_CODE[customer.type] || 'CUS';
}

function customerIdSuffix(customer = {}) {
  const id = Number(customer.id);
  if (!id || Number.isNaN(id)) return '000';
  return pad(id % 1000, 3);
}

function randomCode(len) {
  let s = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, len);
  while (s.length < len) s += '0';
  return s;
}

function uniqueSuffix(date = new Date()) {
  return `${date.getTime().toString(36).toUpperCase().slice(-6)}${randomCode(2)}`;
}

export function detectSourceFromCart(cart = [], fallback = 'FINISHED') {
  let hasRaw = false;
  let hasFinished = false;
  cart.forEach(item => {
    const channel = item.channel || fallback;
    if (channel === 'RAW') hasRaw = true;
    else if (channel === 'FINISHED') hasFinished = true;
    else { hasRaw = true; hasFinished = true; }
  });
  if (hasRaw && hasFinished) return 'MIXED';
  if (hasRaw) return 'RAW';
  if (hasFinished) return 'FINISHED';
  return fallback;
}

export function createOrderNo({ source, customer, now = new Date() } = {}) {
  return [
    sourcePrefix(source),
    yymmdd(now),
    `${customerCode(customer)}${customerIdSuffix(customer)}`,
    uniqueSuffix(now)
  ].join('-');
}
