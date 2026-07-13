-- 销售提成折扣口径：明确记录折扣由公司还是销售承担。
-- 历史订单默认公司承担，避免上线后误扣历史销售提成。
alter table public.orders
  add column if not exists discount_responsibility text not null default 'COMPANY',
  add column if not exists discount_reason text not null default '',
  add column if not exists discount_responsibility_updated_by text not null default '',
  add column if not exists discount_responsibility_updated_at timestamptz;

update public.orders
set discount_responsibility = 'COMPANY'
where discount_responsibility is null
   or discount_responsibility not in ('COMPANY', 'SALES');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_discount_responsibility_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_discount_responsibility_check
      check (discount_responsibility in ('COMPANY', 'SALES'));
  end if;
end $$;

create index if not exists idx_orders_sales_commission
  on public.orders(sales_id, created_at, discount_responsibility);

comment on column public.orders.discount_responsibility is '折扣承担方：COMPANY 公司承担，SALES 销售承担';
comment on column public.orders.discount_reason is '折扣政策或原因说明';
comment on column public.orders.discount_responsibility_updated_by is '最近确认折扣承担方的人员';
comment on column public.orders.discount_responsibility_updated_at is '最近确认折扣承担方的时间';
