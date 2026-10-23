/*
  Nyra AI - additive hardening for chat history + scoped RAG.

  Safe to run after 001, 002, and 003. It only adds columns, indexes, policies
  and functions; existing rows are never deleted and existing columns are not
  recreated.

  Embedding dimension note: the running ingestion pipeline emits 768-dimension
  vectors (local provider = 768; Hugging Face MiniLM = 384 normalized then zero
  padded to 768). The existing vector(768) column is therefore kept. Use
  vector(384) only if the embedding provider is changed to emit native 384
  values and all stored chunks are re-indexed.
*/

-- ---------------------------------------------------------------------------
-- 1) Conversations: idempotent creation per browser session
-- ---------------------------------------------------------------------------

alter table public.conversations
  add column if not exists client_conversation_id text;

create unique index if not exists idx_conversations_user_client
  on public.conversations (user_id, client_conversation_id)
  where client_conversation_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Messages: owner column, idempotency key, citation metadata
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists user_id uuid;
alter table public.messages
  add column if not exists client_message_id text;
alter table public.messages
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Backfill the owner from the parent conversation.
update public.messages m
set user_id = c.user_id
from public.conversations c
where m.conversation_id = c.id
  and m.user_id is null;

do $$
begin
  if not exists (select 1 from public.messages where user_id is null) then
    alter table public.messages alter column user_id set not null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_user_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

-- Only user/assistant turns are persisted. If legacy system rows exist, keep
-- the older constraint so no data has to be rewritten.
do $$
begin
  if not exists (select 1 from public.messages where role = 'system') then
    alter table public.messages drop constraint if exists messages_role_check;
    alter table public.messages
      add constraint messages_role_check check (role in ('user', 'assistant'));
  end if;
end;
$$;

-- Retries reuse the same client id, so the API can return the already-saved row
-- instead of inserting a duplicate. NULL ids are allowed for legacy rows.
create unique index if not exists idx_messages_conversation_client_message
  on public.messages (conversation_id, client_message_id)
  where client_message_id is not null;

create index if not exists idx_messages_conversation_created_at
  on public.messages (conversation_id, created_at desc);

-- Enforce ownership through both the row owner and the parent conversation.
drop policy if exists "messages_select_own" on public.messages;
create policy "messages_select_own" on public.messages
  for select using (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own" on public.messages
  for update using (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  ) with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own" on public.messages
  for delete using (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3) Documents + chunks: optional conversation scope and chunk metadata
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists conversation_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'documents_conversation_id_fkey'
  ) then
    alter table public.documents
      add constraint documents_conversation_id_fkey
      foreign key (conversation_id) references public.conversations(id)
      on delete set null;
  end if;
end;
$$;

alter table public.document_chunks
  add column if not exists conversation_id uuid;
alter table public.document_chunks
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'document_chunks_conversation_id_fkey'
  ) then
    alter table public.document_chunks
      add constraint document_chunks_conversation_id_fkey
      foreign key (conversation_id) references public.conversations(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_documents_user_conversation
  on public.documents (user_id, conversation_id);
create index if not exists idx_document_chunks_user_conversation
  on public.document_chunks (user_id, conversation_id);

-- Re-create chunk policies so a non-null conversation_id must also be owned by
-- the caller. Existing owner-check on the parent document is preserved.
drop policy if exists "document_chunks_insert_own" on public.document_chunks;
create policy "document_chunks_insert_own" on public.document_chunks
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and d.user_id = auth.uid()
    )
    and (
      conversation_id is null
      or exists (
        select 1 from public.conversations c
        where c.id = document_chunks.conversation_id
          and c.user_id = auth.uid()
      )
    )
  );

drop policy if exists "document_chunks_update_own" on public.document_chunks;
create policy "document_chunks_update_own" on public.document_chunks
  for update using (
    auth.uid() = user_id
    and exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and d.user_id = auth.uid()
    )
  ) with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and d.user_id = auth.uid()
    )
    and (
      conversation_id is null
      or exists (
        select 1 from public.conversations c
        where c.id = document_chunks.conversation_id
          and c.user_id = auth.uid()
      )
    )
  );

-- Document metadata can also be scoped to a conversation owned by the caller.
drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own" on public.documents
  for insert with check (
    auth.uid() = user_id
    and (
      conversation_id is null
      or exists (
        select 1 from public.conversations c
        where c.id = documents.conversation_id
          and c.user_id = auth.uid()
      )
    )
  );

drop policy if exists "documents_update_own" on public.documents;
create policy "documents_update_own" on public.documents
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and (
      conversation_id is null
      or exists (
        select 1 from public.conversations c
        where c.id = documents.conversation_id
          and c.user_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4) Vector search: conversation-aware, document-scoped, owner enforced
-- ---------------------------------------------------------------------------

-- Harden the original function without changing its signature.
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
    and (filter_document_id is null or c.document_id = filter_document_id)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 5), 50));
end;
$$;

revoke all on function public.match_document_chunks(vector, integer, uuid) from public;
revoke all on function public.match_document_chunks(vector, integer, uuid) from anon;
grant execute on function public.match_document_chunks(vector, integer, uuid) to authenticated;

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
      -- Explicitly attached documents remain usable across conversations.
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

revoke all on function public.match_document_chunks_scoped(vector, integer, uuid, uuid[], uuid) from public;
revoke all on function public.match_document_chunks_scoped(vector, integer, uuid, uuid[], uuid) from anon;
grant execute on function public.match_document_chunks_scoped(vector, integer, uuid, uuid[], uuid) to authenticated;
