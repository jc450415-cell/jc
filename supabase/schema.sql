-- =============================================================================
-- 報修登記系統：Supabase 建表 SQL
-- -----------------------------------------------------------------------------
-- 依據：報修需求筆記.txt
-- 本次示範範圍：任何人可以新增報修、讀取清單；不能修改或刪除。
-- 安全分三層：
--   1. CHECK：限制欄位值與文字長度（資料表本身的規則，任何角色都要遵守）
--   2. GRANT：只給 anon 讀取全部欄位，以及新增必要欄位；不給修改和刪除
--   3. RLS：啟用資料列安全，可讀全部清單；新增時處理狀態只能是「待處理」
-- 前端只使用公開金鑰（anon key），絕不可放 service_role 金鑰。
-- 本檔只供審閱，請在 Supabase SQL Editor 確認後再執行。
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 資料表與第 3 層：CHECK 約束
-- -----------------------------------------------------------------------------
-- 每個欄位都設為 not null，文字欄位先去除前後空白再檢查長度，
-- 避免只填空白就送出。選項欄位只接受固定的中文值。
create table public.repair_requests (
  -- 主鍵：由資料庫自動產生 UUID，前端不能指定
  id            uuid        primary key default gen_random_uuid(),

  -- 建立時間：由資料庫自動產生，前端不能指定，避免偽造時間
  created_at    timestamptz not null default now(),

  -- 報修人姓名：1～50 字（示範只用虛構姓名）
  reporter_name text        not null
    constraint repair_requests_reporter_name_len
      check (char_length(btrim(reporter_name)) between 1 and 50),

  -- 地點或部門：1～100 字
  location      text        not null
    constraint repair_requests_location_len
      check (char_length(btrim(location)) between 1 and 100),

  -- 類別：只能是 設備／網路／環境／其他
  category      text        not null
    constraint repair_requests_category_values
      check (category in ('設備', '網路', '環境', '其他')),

  -- 問題說明：1～1000 字
  description   text        not null
    constraint repair_requests_description_len
      check (char_length(btrim(description)) between 1 and 1000),

  -- 緊急程度：只能是 低／中／高，預設「中」
  urgency       text        not null default '中'
    constraint repair_requests_urgency_values
      check (urgency in ('低', '中', '高')),

  -- 處理狀態：只能是 待處理／處理中／已完成，預設「待處理」
  status        text        not null default '待處理'
    constraint repair_requests_status_values
      check (status in ('待處理', '處理中', '已完成'))
);

comment on table  public.repair_requests               is '報修登記（示範資料，全為虛構）';
comment on column public.repair_requests.id            is '主鍵，自動產生';
comment on column public.repair_requests.created_at    is '登記時間，自動產生';
comment on column public.repair_requests.reporter_name is '報修人姓名';
comment on column public.repair_requests.location      is '地點或部門';
comment on column public.repair_requests.category      is '類別：設備／網路／環境／其他';
comment on column public.repair_requests.description   is '問題說明';
comment on column public.repair_requests.urgency       is '緊急程度：低／中／高';
comment on column public.repair_requests.status        is '處理狀態：待處理／處理中／已完成';

-- 清單依登記時間由新到舊排序時使用的索引
create index repair_requests_created_at_idx
  on public.repair_requests (created_at desc);

-- -----------------------------------------------------------------------------
-- 第 1 層：GRANT 權限
-- -----------------------------------------------------------------------------
-- 先收回所有公開角色的權限，確保起點是「什麼都不能做」。
-- authenticated（登入使用者）本次示範不開放；之後若加入登入功能再另行設計。
revoke all on table public.repair_requests from public, anon, authenticated;

-- anon 可以讀取清單（全部欄位）。
grant select on table public.repair_requests to anon;

-- anon 只能在新增時填寫下列 5 個欄位。
-- id、created_at、status 都不開放，一律由預設值產生：
--   新增的報修一定是「待處理」，也不能偽造編號或登記時間。
-- 前端送出時不可帶入 id、created_at、status，否則會被拒絕（permission denied）。
grant insert (reporter_name, location, category, description, urgency)
  on table public.repair_requests to anon;

-- 刻意不授予 update、delete、truncate、references、trigger：
-- 公開用戶無法修改或刪除任何資料。

-- -----------------------------------------------------------------------------
-- 第 2 層：RLS 資料列安全
-- -----------------------------------------------------------------------------
-- 啟用 RLS 後，沒有政策允許的操作一律拒絕。
alter table public.repair_requests enable row level security;

-- 讀取政策：任何人（anon）都能讀取所有報修，用來顯示清單。
create policy "anon 可以讀取報修清單"
  on public.repair_requests
  for select
  to anon
  using (true);

-- 新增政策：任何人（anon）都能新增，但處理狀態必須是「待處理」。
-- 這與 GRANT 不開放 status 欄位互相補強：即使日後誤把 status 的
-- 新增權限開放出去，RLS 仍會擋下非「待處理」的資料。
create policy "anon 可以新增待處理的報修"
  on public.repair_requests
  for insert
  to anon
  with check (status = '待處理');

-- 不建立 update、delete 政策：即使權限被誤開，RLS 仍會拒絕修改與刪除。

commit;

-- =============================================================================
-- 執行後的驗證建議（以 anon 公開金鑰從前端或 REST API 測試）：
--   1. 新增一筆虛構報修（不帶 status）→ 應成功，status 為「待處理」
--   2. 讀取清單 → 應看到剛才那筆
--   3. 新增時帶 status = '已完成' → 應失敗
--   4. 修改任何一筆 → 應失敗
--   5. 刪除任何一筆 → 應失敗
--   6. category 填清單以外的值，或姓名只填空白 → 應失敗（CHECK）
-- =============================================================================
