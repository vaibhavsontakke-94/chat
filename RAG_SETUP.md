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

## 3) Storage bucket and policies
Run `migrations/003_auth_hardening.sql`. It creates the private `documents` bucket and owner-only storage policies. The server can also create the bucket automatically when `SUPABASE_SERVICE_ROLE_KEY` is set.

## 4) Embeddings
The database expects **768-dimension** vectors. Choose one provider with `EMBEDDINGS_PROVIDER`:

- `local` (default) — built-in deterministic, offline embeddings. Works on Vercel and needs no extra service. Lexical rather than semantic, so quality is lower.
- `ollama` — set `OLLAMA_BASE_URL` and `OLLAMA_EMBED_MODEL` (for example `nomic-embed-text`). Best local semantic quality, but Ollama cannot run on Vercel.
- `openai` — set `EMBEDDINGS_API_URL`, `EMBEDDINGS_API_KEY`, and `EMBEDDINGS_MODEL`. Use a model configured for 768 dimensions (for example `text-embedding-3-small` with the `dimensions` parameter).
- `huggingface` — set `HF_TOKEN` and optionally `HF_EMBEDDING_MODEL` (default `sentence-transformers/all-MiniLM-L6-v2`). The token must be a fine-grained token with **"Make calls to Inference Providers"** permission. Optional `HF_EMBEDDINGS_URL` and `HF_EMBEDDING_BATCH_SIZE` (max 64).
  MiniLM returns 384-dimension vectors; the server normalizes them and pads with zeros to 768, which preserves cosine similarity and works with the existing `vector(768)` schema.
  If the token is rejected, create a new token with inference permission or use `EMBEDDINGS_PROVIDER=local`.

If you switch embedding providers, re-upload documents so all chunks use the same vector space. If you want native 384-dimension storage instead of padding, update `vector(768)`, the HNSW index, and `match_document_chunks` in `002_rag_pgvector.sql`.

## 5) Usage notes
- Always filter by `user_id`/RLS; the function also enforces ownership via `auth.uid()`.
- For large corpora consider IVFFlat instead of HNSW or tune parameters.
- This schema is compatible with a future ingestion pipeline (upload PDF → parse → chunk → embed → insert). No changes were made to the existing chat system.
