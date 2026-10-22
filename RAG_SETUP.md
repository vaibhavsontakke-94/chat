# RAG Database Setup (pgvector)

## 1) Inspect existing schema
Review `migrations/001_auth_chat_history.sql` first. The RAG schema below extends it without modifying existing chat/auth tables.

## 2) Enable extension and create tables
Run `migrations/002_rag_pgvector.sql` in Supabase SQL editor.

What it creates:
- `public.documents` — metadata per uploaded PDF (owner `user_id`, filename, mime/size/pages, status). RLS: owner only.
- `public.document_chunks` — chunks with `chunk_index`, `page_number`, `content`, `embedding vector(768)`. Stores `user_id` for fast scoping. RLS: owner only (and enforces parent document ownership on insert/update).
- Indexes: btree on user/document, and HNSW on `embedding` using `vector_cosine_ops` for fast similarity search.
- `public.match_document_chunks(query_embedding vector(768), match_count int, filter_document_id uuid)` — SECURITY DEFINER function that:
  - only searches chunks where `user_id = auth.uid()` (and parent document owned)
  - optionally filters by a single document
  - returns similarity = `1 - (embedding <=> query_embedding)` ordered by cosine distance
  - restricted to authenticated role only
- No fake vectors or sample documents are inserted.

## 3) Embedding dimension
Default is **768** for `nomic-embed-text-v1.5` (matches `GROQ_EMBED_MODEL` in `.env.example`). If you use a different embedding model, change `vector(768)` in `document_chunks.embedding` and the function signature/index to match its dimension.

## 4) Usage notes
- Always filter by `user_id`/RLS; the function also enforces ownership via `auth.uid()`.
- For large corpora consider IVFFlat instead of HNSW or tune parameters.
- This schema is compatible with a future ingestion pipeline (upload PDF → parse → chunk → embed → insert). No changes were made to the existing chat system.
