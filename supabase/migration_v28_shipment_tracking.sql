-- 物流轨迹持久化：由 Edge Function 查询快递100后写回，网页和小程序共用。
alter table public.shipments
  add column if not exists tracking_state text not null default '',
  add column if not exists tracking_state_code text not null default '',
  add column if not exists tracking_message text not null default '',
  add column if not exists tracking_events jsonb not null default '[]'::jsonb,
  add column if not exists tracking_updated_at timestamptz;

create index if not exists idx_shipments_order_tracking
  on public.shipments(order_id, tracking_updated_at desc);

comment on column public.shipments.tracking_state is '当前物流状态中文名称';
comment on column public.shipments.tracking_state_code is '快递100物流状态码';
comment on column public.shipments.tracking_message is '最新物流节点或查询提示';
comment on column public.shipments.tracking_events is '物流轨迹节点，按时间倒序';
comment on column public.shipments.tracking_updated_at is '最近一次主动查询时间';
