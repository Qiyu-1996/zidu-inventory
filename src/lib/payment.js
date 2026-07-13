export const PAYMENT_METHODS = ['微信', '支付宝', '对公账户转账', '对私银行账户转账'];

export function requirePaymentMethod(method) {
  if (!PAYMENT_METHODS.includes(method)) throw new Error('请选择有效的收付款方式');
  return method;
}
