-- =============================================================================
-- 老屋改造工項追蹤：照片功能（Storage bucket＋照片資料表）
-- -----------------------------------------------------------------------------
-- 前提：已執行 renovation_items.sql。
-- 本次示範範圍：任何人可以替工項新增照片、看照片；不能修改或刪除照片。
-- 做法：
--   - 圖檔放在公開的 Storage bucket「renovation-photos」，只收 JPEG、單檔 ≤ 2 MB
--     （網頁會先把照片縮到長邊 1600px 並轉成 JPEG，順便去掉 GPS 等 EXIF 資訊）
--   - 檔名固定為「工項id/隨機id.jpg」，由 Storage 政策檢查格式
--   - renovation_photos 表記錄每張照片屬於哪個工項；同樣是 CHECK＋GRANT＋RLS 三層
-- 前端只使用公開金鑰。本檔只供審閱，請在 Supabase SQL Editor 確認後再執行。
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Storage bucket：公開讀取、限制大小與格式
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('renovation-photos', 'renovation-photos', true, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- anon 只能上傳（insert）到這個 bucket，且檔名必須是「uuid/uuid.jpg」，
-- 前面的 uuid 必須是已存在的工項。不建立 update、delete 政策：上傳後無法覆蓋或刪除。
-- 公開 bucket 的圖片用公開網址讀取，不需要 select 政策（也就無法列出全部檔案）。
create policy "anon 可以上傳工項照片"
  on storage.objects
  for insert
  to anon
  with check (
    bucket_id = 'renovation-photos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and exists (
      select 1 from public.renovation_items i
      where i.id::text = split_part(name, '/', 1)
    )
  );

-- -----------------------------------------------------------------------------
-- 照片資料表
-- -----------------------------------------------------------------------------
create table public.renovation_photos (
  id         uuid        primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- 所屬工項
  item_id    uuid        not null references public.renovation_items (id),

  -- Storage 中的檔名：必須是「工項id/uuid.jpg」，而且開頭要等於 item_id
  path       text        not null unique
    constraint renovation_photos_path_format
      check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
             and split_part(path, '/', 1) = item_id::text)
);

comment on table  public.renovation_photos            is '老屋改造工項照片（示範資料，全為虛構）';
comment on column public.renovation_photos.item_id    is '所屬工項';
comment on column public.renovation_photos.path       is 'Storage 檔名（renovation-photos bucket）';

create index renovation_photos_item_id_idx on public.renovation_photos (item_id, created_at);

-- GRANT：可讀全部欄位；新增只能填 item_id、path
revoke all on table public.renovation_photos from public, anon, authenticated;
grant select on table public.renovation_photos to anon;
grant insert (item_id, path) on table public.renovation_photos to anon;

-- RLS：可讀全部；可新增；不建立 update、delete 政策
alter table public.renovation_photos enable row level security;

create policy "anon 可以讀取工項照片"
  on public.renovation_photos
  for select
  to anon
  using (true);

-- 每個工項最多 6 張照片
create policy "anon 可以新增工項照片"
  on public.renovation_photos
  for insert
  to anon
  with check (
    (select count(*) from public.renovation_photos p where p.item_id = renovation_photos.item_id) < 6
  );

commit;

-- =============================================================================
-- 執行後的驗證（以公開金鑰從網頁測試）：
--   1. 新增工項時附一張照片 → 清單出現縮圖，點開是原圖
--   2. 在既有工項按「加照片」→ 縮圖增加
--   3. 同一工項第 7 張照片 → 應失敗
--   4. 上傳 PNG、超過 2 MB、或檔名不是「工項id/uuid.jpg」→ 應失敗
--   5. 修改或刪除 renovation_photos 任何一筆、覆蓋或刪除 Storage 檔案 → 應失敗
-- 注意：任何人都能上傳照片，正式使用前應加上登入或其他防濫用機制。
-- =============================================================================
