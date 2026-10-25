/*
  Nyra AI - production RAG hardening (007).

  Additive only. It never deletes documents, chunks, messages or conversations.
  It adds:
    - processing stage/timing/idempotency metadata on documents
    - embedding model/version metadata on chunks
    - a structured document_questions index for question papers
    - owner-scoped hybrid keyword retrieval
    - cleanup of a stale legacy overload that filtered on status = 'ready'
*/

-- ---------------------------------------------------------------------------
-- 1) Document processing + embedding metadata
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists content_hash text;
alter table public.documents
  add column if not exists storage_path text;
alter table public.documents
  add column if not exists file_type text;
alter table public.documents
  add column if not exists processing_stage text;
alter table public.documents
  add column if not exists processing_started_at timestamptz;
alter table public.documents
  add column if not exists processing_completed_at timestamptz;
alter table public.documents
  add column if not exists chunk_count integer not null default 0;
alter table public.documents
  add column if not exists embedding_model text;
alter table public.documents
  add column if not exists embedding_dimensions integer;
alter table public.documents
  add column if not exists ocr_used boolean not null default false;
alter table public.documents
  add column if not exists stage_timings jsonb not null default '{}'::jsonb;
alter table public.documents
  add column if not exists attempt_count integer not null default 0;
alter table public.documents
  add column if not exists last_error_stage text;

create index if not exists idx_documents_user_content_hash
  on public.documents (user_id, content_hash)
  where content_hash is not null;

create index if not exists idx_documents_status_updated
  on public.documents (status, updated_at);

create index if not exists idx_documents_stage
  on public.documents (processing_stage)
  where processing_stage is not null;

alter table public.document_chunks
  add column if not exists embedding_model text;
alter table public.document_chunks
  add column if not exists embedding_dimensions integer;

create index if not exists idx_document_chunks_document_index
  on public.document_chunks (document_id, chunk_index);

-- ---------------------------------------------------------------------------
-- 2) Structured question index for question papers
-- ---------------------------------------------------------------------------

create table if not exists public.document_questions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  question_number text not null,
  question_key text not null,
  question_text text not null,
  options jsonb not null default '[]'::jsonb,
  marks text,
  page_number integer,
  section text,
  order_index integer not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, order_index)
);

create index if not exists idx_document_questions_document_order
  on public.document_questions (document_id, order_index);
create index if not exists idx_document_questions_user
  on public.document_questions (user_id);
create index if not exists idx_document_questions_key
  on public.document_questions (document_id, question_key);

alter table public.document_questions enable row level security;

drop policy if exists "document_questions_select_own" on public.document_questions;
create policy "document_questions_select_own" on public.document_questions
  for select using (
    auth.uid() = user_id
    and exists (
      select 1 from public.documents d
      where d.id = document_questions.document_id
        and d.user_id = auth.uid()
        and d.status = 'completed'
    )
  );

drop policy if exists "document_questions_insert_own" on public.document_questions;
create policy "document_questions_insert_own" on public.document_questions
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.documents d
      where d.id = document_questions.document_id
        and d.user_id = auth.uid()
    )
    and (
      conversation_id is null
      or exists (
        select 1 from public.conversations c
        where c.id = document_questions.conversation_id
          and c.user_id = auth.uid()
      )
    )
  );

drop policy if exists "document_questions_update_own" on public.document_questions;
create policy "document_questions_update_own" on public.document_questions
  for update using (
    auth.uid() = user_id
  ) with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.documents d
      where d.id = document_questions.document_id
        and d.user_id = auth.uid()
    )
  );

drop policy if exists "document_questions_delete_own" on public.document_questions;
create policy "document_questions_delete_own" on public.document_questions
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3) Hybrid retrieval: owner-scoped lexical/keyword search
-- ---------------------------------------------------------------------------

create or replace function public.search_document_chunks_keyword(
  query_text text,
  match_count integer default 20,
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
  similarity float,
  keyword_score float
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with input as (
    select
      nullif(btrim(coalesce(query_text, '')), '') as q,
      websearch_to_tsquery('simple', coalesce(query_text, '')) as tsq
  )
  select
    c.id as chunk_id,
    c.document_id,
    d.filename,
    c.page_number,
    c.chunk_index,
    c.content,
    coalesce(c.metadata, '{}'::jsonb) as metadata,
    0::float as similarity,
    ts_rank(to_tsvector('simple', c.content), input.tsq)::float as keyword_score
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  cross join input
  where auth.uid() is not null
    and c.user_id = auth.uid()
    and d.user_id = auth.uid()
    and d.status = 'completed'
    and c.embedding is not null
    and length(input.q) >= 2
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
    and (
      to_tsvector('simple', c.content) @@ input.tsq
      or c.content ilike '%' || input.q || '%'
    )
  order by keyword_score desc, c.chunk_index asc
  limit greatest(1, least(coalesce(match_count, 20), 100));
$$;

revoke all on function public.search_document_chunks_keyword(text, integer, uuid, uuid[], uuid) from public;
revoke all on function public.search_document_chunks_keyword(text, integer, uuid, uuid[], uuid) from anon;
grant execute on function public.search_document_chunks_keyword(text, integer, uuid, uuid[], uuid) to authenticated;

-- Remove the stale 4-argument overload left behind by an earlier iteration.
-- It filtered on documents.status = 'ready', so it could never serve chunks for
-- the current 'completed' status vocabulary.
drop function if exists public.match_document_chunks(vector, integer, uuid[], double precision);

-- Re-assert the canonical functions with the completed status vocabulary.
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
  limit greatest(1, least(coalesce(match_count, 5), 100));
$$;

revoke all on function public.match_document_chunks_scoped(vector, integer, uuid, uuid[], uuid) from public;
revoke all on function public.match_document_chunks_scoped(vector, integer, uuid, uuid[], uuid) from anon;
grant execute on function public.match_document_chunks_scoped(vector, integer, uuid, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Indexing readiness helper: atomically mark a document completed
-- ---------------------------------------------------------------------------

create or replace function public.mark_document_ready(
  p_document_id uuid,
  p_chunk_count integer,
  p_embedding_model text,
  p_embedding_dimensions integer,
  p_page_count integer,
  p_ocr_used boolean,
  p_stage_timings jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.documents
  set status = 'completed',
      processing_stage = 'ready',
      processing_completed_at = now(),
      chunk_count = greatest(0, coalesce(p_chunk_count, 0)),
      embedding_model = p_embedding_model,
      embedding_dimensions = p_embedding_dimensions,
      page_count = coalesce(p_page_count, page_count),
      ocr_used = coalesce(p_ocr_used, false),
      stage_timings = coalesce(p_stage_timings, '{}'::jsonb),
      error_message = null,
      last_error_stage = null
  where id = p_document_id
    and (auth.uid() is null or user_id = auth.uid());
$$;

revoke all on function public.mark_document_ready(uuid, integer, text, integer, integer, boolean, jsonb) from public;
revoke all on function public.mark_document_ready(uuid, integer, text, integer, integer, boolean, jsonb) from anon;
grant execute on function public.mark_document_ready(uuid, integer, text, integer, integer, boolean, jsonb) to authenticated, service_role;
