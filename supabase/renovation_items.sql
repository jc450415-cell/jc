-- =============================================================================
-- 老屋改造工項追蹤：Supabase 建表 SQL
-- -----------------------------------------------------------------------------
-- 依據：老屋改造需求筆記.txt
-- 本次示範範圍：任何人可以新增工項、讀取清單；不能修改或刪除。
-- 安全分三層（與 schema.sql 的報修表相同做法）：
--   1. CHECK：限制欄位值、文字長度與預算範圍
--   2. GRANT：anon 只能讀取全部欄位，以及新增必要欄位；不給修改和刪除
--   3. RLS：啟用資料列安全，可讀全部清單；新增時狀態只能是「規劃中」
-- 前端只使用公開金鑰（anon / publishable key），絕不可放 service_role 金鑰。
-- 本檔只供審閱，請在 Supabase SQL Editor 確認後再執行。
-- 舊的 repair_requests 表不受影響。
-- =============================================================================

begin;

create table public.renovation_items (
  -- 主鍵與登記時間：由資料庫自動產生，前端不能指定
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  -- 登記人：1～50 字（示範只用虛構姓名）
  recorder_name text        not null
    constraint renovation_items_recorder_name_len
      check (char_length(btrim(recorder_name)) between 1 and 50),

  -- 空間
  space         text        not null
    constraint renovation_items_space_values
      check (space in ('客廳', '餐廳', '廚房', '浴室', '臥室', '陽台',
                       '樓梯', '屋頂', '外牆', '全室', '其他')),

  -- 工種
  trade         text        not null
    constraint renovation_items_trade_values
      check (trade in ('拆除', '水電', '泥作', '防水', '木作', '油漆',
                       '門窗', '鐵件', '系統櫃', '其他')),

  -- 工項名稱：1～100 字
  title         text        not null
    constraint renovation_items_title_len
      check (char_length(btrim(title)) between 1 and 100),

  -- 說明（選填）：0～1000 字
  note          text        not null default ''
    constraint renovation_items_note_len
      check (char_length(note) <= 1000),

  -- 預算（新台幣整數）：0～1 億
  budget        integer     not null default 0
    constraint renovation_items_budget_range
      check (budget between 0 and 100000000),

  -- 廠商（選填）：0～100 字
  contractor    text        not null default ''
    constraint renovation_items_contractor_len
      check (char_length(contractor) <= 100),

  -- 優先程度：低／中／高，預設「中」
  priority      text        not null default '中'
    constraint renovation_items_priority_values
      check (priority in ('低', '中', '高')),

  -- 施工狀態：規劃中／施工中／已完成，預設「規劃中」
  status        text        not null default '規劃中'
    constraint renovation_items_status_values
      check (status in ('規劃中', '施工中', '已完成'))
);

comment on table  public.renovation_items               is '老屋改造工項（示範資料，全為虛構）';
comment on column public.renovation_items.id            is '主鍵，自動產生';
comment on column public.renovation_items.created_at    is '登記時間，自動產生';
comment on column public.renovation_items.recorder_name is '登記人';
comment on column public.renovation_items.space         is '空間';
comment on column public.renovation_items.trade         is '工種';
comment on column public.renovation_items.title         is '工項名稱';
comment on column public.renovation_items.note          is '說明（選填）';
comment on column public.renovation_items.budget        is '預算（新台幣）';
comment on column public.renovation_items.contractor    is '廠商（選填）';
comment on column public.renovation_items.priority      is '優先程度：低／中／高';
comment on column public.renovation_items.status        is '施工狀態：規劃中／施工中／已完成';

create index renovation_items_created_at_idx
  on public.renovation_items (created_at desc);

-- -----------------------------------------------------------------------------
-- 第 1 層：GRANT 權限
-- -----------------------------------------------------------------------------
revoke all on table public.renovation_items from public, anon, authenticated;

-- anon 可以讀取全部欄位（清單與預算合計）
grant select on table public.renovation_items to anon;

-- anon 新增時只能填這 8 個欄位；id、created_at、status 一律用預設值
grant insert (recorder_name, space, trade, title, note, budget, contractor, priority)
  on table public.renovation_items to anon;

-- 刻意不授予 update、delete、truncate、references、trigger

-- -----------------------------------------------------------------------------
-- 第 2 層：RLS 資料列安全
-- -----------------------------------------------------------------------------
alter table public.renovation_items enable row level security;

create policy "anon 可以讀取工項清單"
  on public.renovation_items
  for select
  to anon
  using (true);

create policy "anon 可以新增規劃中的工項"
  on public.renovation_items
  for insert
  to anon
  with check (status = '規劃中');

-- 不建立 update、delete 政策

commit;

-- =============================================================================
-- 執行後的驗證（以公開金鑰從網頁或 REST API 測試）：
--   1. 新增一筆虛構工項（不帶 status）→ 應成功，status 為「規劃中」
--   2. 讀取清單 → 應看到剛才那筆
--   3. 新增時帶 status = '已完成' → 應失敗
--   4. 修改任何一筆 → 應失敗（或 0 筆受影響）
--   5. 刪除任何一筆 → 應失敗（或 0 筆受影響）
--   6. budget 填負數、space 填清單外的值、工項名稱只填空白 → 應失敗（CHECK）
-- =============================================================================
