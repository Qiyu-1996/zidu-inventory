-- ============================================================
-- ZIDU v52: 销售最低 5 折 + 分笔收款配置
--
-- 收款表与 zidu_record_payment_atomic 已支持多笔记录和
-- UNPAID / PARTIAL / PAID 状态，本迁移只需统一销售优惠上限。
-- 50 表示最高优惠 50%，即最低成交价为原价的 5 折。
-- ============================================================

INSERT INTO public.app_settings (key, value, description, updated_at)
VALUES (
  'max_discount_percent',
  '50',
  '销售下单最高优惠比例；50 表示最低 5 折',
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();

SELECT key, value, description
FROM public.app_settings
WHERE key = 'max_discount_percent';
