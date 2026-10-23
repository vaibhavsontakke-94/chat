/*
  Auth hardening for Nyra AI
  - Optional user-scoped vector search for administrative/service-role callers.
  - Private storage bucket + owner-only storage policies.

  Run after 001_auth_chat_history.sql and 002_rag_pgvector.sql.
*/

-- The normal request path uses match_document_chunks as the signed-in user. This
-- helper is only for trusted service-role tooling and requires an explicit user id.
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

-- Private document bucket. Files are served only through authorized server code.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = false;

drop policy if exists "documents_storage_select_own" on storage.objects;
create policy "documents_storage_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_storage_insert_own" on storage.objects;
create policy "documents_storage_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_storage_update_own" on storage.objects;
create policy "documents_storage_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_storage_delete_own" on storage.objects;
create policy "documents_storage_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
