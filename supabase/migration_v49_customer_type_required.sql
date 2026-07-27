-- ZIDU v49: 客户类型必填，且不设默认类型。
-- 不修改历史客户；如果存在旧的空类型，约束会先保持 NOT VALID，
-- 但新增或更新客户时仍必须填写类型。

ALTER TABLE public.customers
  ALTER COLUMN type DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.customers'::regclass
      AND conname = 'customers_type_required'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_type_required
      CHECK (type IS NOT NULL AND btrim(type) <> '') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers
    WHERE type IS NULL OR btrim(type) = ''
  ) THEN
    ALTER TABLE public.customers
      VALIDATE CONSTRAINT customers_type_required;
  END IF;
END
$$;

SELECT count(*) AS existing_customers_missing_type
FROM public.customers
WHERE type IS NULL OR btrim(type) = '';
