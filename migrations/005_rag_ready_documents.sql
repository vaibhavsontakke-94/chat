/*
  Only retrieve chunks from documents whose indexing status is "ready".

  This keeps failed or in-progress reindex attempts from serving stale vectors
  while a document is being repaired.
*/

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
    and d.status = 'ready'
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
    and d.status = 'ready'
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

revoke all on function public.match_document_chunks(vector, integer, uuid) from public;
revoke all on function public.match_document_chunks(vector, integer, uuid) from anon;
grant execute on function public.match_document_chunks(vector, integer, uuid) to authenticated;

revoke all on function public.match_document_chunks_scoped(vector, integer, uuid, uuid[], uuid) from public;
revoke all on function public.match_document_chunks_scoped(vector, integer, uuid, uuid[], uuid) from anon;
grant execute on function public.match_document_chunks_scoped(vector, integer, uuid, uuid[], uuid) to authenticated;
