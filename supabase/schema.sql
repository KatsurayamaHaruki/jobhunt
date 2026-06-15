-- Supabase SQL Editor で実行する。
-- 自分のデータだけ見える行レベルセキュリティ（RLS）付き。

create extension if not exists "pgcrypto";

-- 企業（tasks と es_drafts は JSONB 配列で保持し、既存JSONからの移行を容易に）
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  category    text,
  vote        text default 'B',
  status      text default '検討中',
  mypage_url  text,
  es_doc_url  text,
  memo        text,
  tasks       jsonb not null default '[]'::jsonb,
  es_drafts   jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

alter table public.companies enable row level security;

drop policy if exists "own companies" on public.companies;
create policy "own companies" on public.companies
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists companies_user_idx on public.companies(user_id);

-- 資料（自己分析マスター資料・プロフィール）をユーザーごとに1行
create table if not exists public.user_docs (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  master_doc  text default '',
  profile     text default '',
  updated_at  timestamptz not null default now()
);

alter table public.user_docs enable row level security;

drop policy if exists "own docs" on public.user_docs;
create policy "own docs" on public.user_docs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 選考ステータスの変更履歴（誰が＝Gmail同期/手動 を記録し、AIの出力チェックに使う）
-- source: 'gmail' | 'manual' | 'es' などワーカーが入れる識別子
create table if not exists public.status_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete cascade,
  company_name text,
  field       text not null,            -- 例: 'status' / 'task' / 'es_draft'
  old_value   text,
  new_value   text,
  source      text not null default 'manual',
  evidence    text,                     -- 根拠（Gmailの件名・スレッドID等）。確認用
  created_at  timestamptz not null default now()
);

alter table public.status_log enable row level security;

drop policy if exists "own status_log" on public.status_log;
create policy "own status_log" on public.status_log
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists status_log_user_idx on public.status_log(user_id, created_at desc);
