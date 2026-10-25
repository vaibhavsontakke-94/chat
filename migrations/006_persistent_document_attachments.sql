/*
  Nyra AI - persistent conversation/document attachments.

  Adds a many-to-many attachment table so one document can be used by multiple
  conversations, migrates document statuses to the public API vocabulary, and
  keeps vector retrieval limited to completed documents.
*/

-- ---------------------------------------------------------------------------
-- 1) Document statuses + failure details
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists error_message text;

alter table public.documents
  drop constraint if exists documents_status_check;

update public.documents
set status = case status
  when 'ready' then 'completed'
  when 'error' then 'failed'
  when 'pending' then 'uploading'
  else status
end
where status in ('ready', 'error', 'pending');

alter table public.documents
  alter column status set default 'uploading';

alter table public.documents
  add constraint documents_status_check
  check (status in ('uploading', 'processing', 'completed', 'failed'));

-- ---------------------------------------------------------------------------
-- 2) Attachments: a document can belong to many conversations
-- ---------------------------------------------------------------------------

create table if not exists public.document_attachments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (document_id, conversation_id)
);

create index if not exists idx_document_attachments_conversation
  on public.document_attachments (conversation_id, created_at desc);
create index if not exists idx_document_attachments_document
  on public.document_attachments (document_id);
create index if not exists idx_document_attachments_user
  on public.document_attachments (user_id);

alter table public.document_attachments enable row level security;

drop policy if exists "document_attachments_select_own" on public.document_attachments;
create policy "document_attachments_select_own" on public.document_attachments
  for select using (
    auth.uid() = user_id
    and exists (
      select 1 from public.documents d
      where d.id = document_attachments.document_id
        and d.user_id = auth.uid()
    )
    and exists (
      select 1 from public.conversations c
      where c.id = document_attachments.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "document_attachments_insert_own" on public.document_attachments;
create policy "document_attachments_insert_own" on public.document_attachments
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.documents d
      where d.id = document_attachments.document_id
        and d.user_id = auth.uid()
    )
    and exists (
      select 1 from public.conversations c
      where c.id = document_attachments.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "document_attachments_delete_own" on public.document_attachments;
create policy "document_attachments_delete_own" on public.document_attachments
  for delete using (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = document_attachments.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- Backfill the legacy single conversation pointer into the join table.
insert into public.document_attachments (document_id, conversation_id, user_id, created_at)
select d.id, d.conversation_id, d.user_id, d.created_at
from public.documents d
where d.conversation_id is not null
on conflict (document_id, conversation_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Retrieval only from completed documents
-- ---------------------------------------------------------------------------

create or replace function public.match_document_chunks(
  query_embedding vector(768),
  match_count integer default 5,
  filter_document_id uuid default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  filename text,
  page_number integer,
  chunk_index integer,
  content text,
  similarity float
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  return query
  select
    c.id as chunk_id,
    c.document_id,
    d.filename,
    c.page_number,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.user_id = auth.uid()
    and d.user_id = auth.uid()
    and d.status = 'completed'
    and (filter_document_id is null or c.document_id = filter_document_id)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 5), 50));
end;
$$;

create or replace function public.match_document_chunks_scoped(
  query_embedding vector(768),
  match_count integer default 5,
  filter_document_id uuid default null,
  filter_document_ids uuid[] default null,
  filter_conversation_id uuid default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  filename text,
  page_number integer,
  chunk_index integer,
  content text,
  metadata jsonb,
  similarity float
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id as chunk_id,
    c.document_id,
    d.filename,
    c.page_number,
    c.chunk_index,
    c.content,
    coalesce(c.metadata, '{}'::jsonb) as metadata,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where auth.uid() is not null
    and c.user_id = auth.uid()
    and d.user_id = auth.uid()
    and d.status = 'completed'
    and c.embedding is not null
    and (filter_document_id is null or c.document_id = filter_document_id)
    and (
      filter_document_ids is null
      or cardinality(filter_document_ids) = 0
      or c.document_id = any(filter_document_ids)
    )
    and (
      filter_conversation_id is null
      or c.conversation_id is null
      or c.conversation_id = filter_conversation_id
      or (filter_document_id is not null and c.document_id = filter_document_id)
      or (
        filter_document_ids is not null
        and cardinality(filter_document_ids) > 0
        and c.document_id = any(filter_document_ids)
      )
    )
  order by c.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 5), 50));
$$;

-- Service-role helper used by maintenance tooling.
create or replace function public.match_document_chunks_for_user(
  query_embedding vector(768),
  p_user_id uuid,
  match_count integer default 5,
  filter_document_id uuid default null,
  filter_document_ids uuid[] default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  filename text,
  page_number integer,
  chunk_index integer,
  content text,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id as chunk_id,
    c.document_id,
    d.filename,
    c.page_number,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.user_id = p_user_id
    and d.user_id = p_user_id
    and d.status = 'completed'
    and (filter_document_id is null or c.document_id = filter_document_id)
    and (
      filter_document_ids is null
      or array_length(filter_document_ids, 1) is null
      or c.document_id = any(filter_document_ids)
    )
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

revoke all on function public.match_document_chunks_for_user(vector, uuid, integer, uuid, uuid[]) from public;
revoke all on function public.match_document_chunks_for_user(vector, uuid, integer, uuid, uuid[]) from anon, authenticated;
grant execute on function public.match_document_chunks_for_user(vector, uuid, integer, uuid, uuid[]) to service_role;

revoke all on function public.match_document_chunks(vector, integer, uuid) from public;
revoke all on function public.match_document_chunks(vector, integer, uuid) from anon;
grant execute on function public.match_document_chunks(vector, integer, uuid) to authenticated;

revoke all on function public.match_document_chunks_scoped(vector, integer, uuid, uuid[], uuid) from public;
revoke all on function public.match_document_chunks_scoped(vector, integer, uuid, uuid[], uuid) from anon;
grant execute on function public.match_document_chunks_scoped(vector, integer, uuid, uuid[], uuid) to authenticated;
