/*
  RAG schema for Supabase PostgreSQL + pgvector
  Run this in Supabase SQL editor. Ensure pgvector extension is available.

  Embedding model: nomic-embed-text-v1.5 (commonly 768 dimensions).
*/

-- Enable pgvector
create extension if not exists vector;

-- Documents metadata (owned by user)
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  page_count integer,
  status text not null default 'pending' check (status in ('pending','processing','ready','error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Document chunks with embeddings
-- Dimension matches nomic-embed-text-v1.5 (768). Adjust if using a different model.
create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index integer not null,
  page_number integer,
  content text not null,
  embedding vector(768),
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

-- Indexes
create index if not exists idx_documents_user_id_created_at on public.documents (user_id, created_at desc);
create index if not exists idx_document_chunks_document_id on public.document_chunks (document_id);
create index if not exists idx_document_chunks_user_id on public.document_chunks (user_id);
-- Vector index for similarity search (HNSW is efficient; adjust lists if using IVFFlat)
create index if not exists idx_document_chunks_embedding_hnsw on public.document_chunks using hnsw (embedding vector_cosine_ops);

-- updated_at trigger for documents
create or replace function public.set_documents_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
  before update on public.documents
  for each row execute function public.set_documents_updated_at();

-- RLS
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;

-- Documents policies
drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own" on public.documents
  for select using (auth.uid() = user_id);

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own" on public.documents
  for insert with check (auth.uid() = user_id);

drop policy if exists "documents_update_own" on public.documents;
create policy "documents_update_own" on public.documents
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_delete_own" on public.documents
  for delete using (auth.uid() = user_id);

-- Chunks policies (must be owned by user; also ensure parent doc ownership)
drop policy if exists "document_chunks_select_own" on public.document_chunks;
create policy "document_chunks_select_own" on public.document_chunks
  for select using (auth.uid() = user_id);

drop policy if exists "document_chunks_insert_own" on public.document_chunks;
create policy "document_chunks_insert_own" on public.document_chunks
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and d.user_id = auth.uid()
    )
  );

drop policy if exists "document_chunks_update_own" on public.document_chunks;
create policy "document_chunks_update_own" on public.document_chunks
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.documents d
      where d.id = document_chunks.document_id
        and d.user_id = auth.uid()
    )
  );

drop policy if exists "document_chunks_delete_own" on public.document_chunks;
create policy "document_chunks_delete_own" on public.document_chunks
  for delete using (auth.uid() = user_id);

-- Secure similarity search function
-- Only returns chunks from documents owned by the authenticated user
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
security definer
set search_path = public
as $$
begin
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
  limit greatest(1, least(match_count, 50));
end;
$$;

-- Grant execute to authenticated users only
revoke all on function public.match_document_chunks(vector, integer, uuid) from public;
grant execute on function public.match_document_chunks(vector, integer, uuid) to authenticated;
