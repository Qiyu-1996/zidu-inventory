-- Keep legacy payment rows readable, but require every new payment/refund to use a standard method.
BEGIN;

ALTER TABLE IF EXISTS public.payment_records
  ALTER COLUMN method DROP DEFAULT;

ALTER TABLE IF EXISTS public.after_sales
  ALTER COLUMN finance_method DROP DEFAULT;

ALTER TABLE IF EXISTS public.payment_records
  DROP CONSTRAINT IF EXISTS payment_records_method_allowed;

ALTER TABLE IF EXISTS public.payment_records
  ADD CONSTRAINT payment_records_method_allowed
  CHECK (
    method IS NOT NULL
    AND method IN ('微信', '支付宝', '对公账户转账', '对私银行账户转账')
  ) NOT VALID;

COMMIT;
