# RAG Database Setup (pgvector)

## 1) Inspect existing schema
Review `migrations/001_auth_chat_history.sql` first. The RAG schema below extends it without modifying existing chat/auth tables.

## 2) Enable extension and create tables
Run `npm run migrate:supabase` to apply `migrations/001` through `006`, or run the SQL files in order in the Supabase SQL editor.

What the RAG migrations create:
- `public.documents` — metadata per uploaded document (owner `user_id`, filename, mime/size/pages, status, optional conversation scope). RLS: owner only.
- `public.document_chunks` — chunks with `chunk_index`, `page_number`, `content`, `embedding vector(768)`. Stores `user_id` for fast scoping. RLS: owner only (and enforces parent document ownership on insert/update).
- Indexes: btree on user/document, and HNSW on `embedding` using `vector_cosine_ops` for fast similarity search.
- `public.match_document_chunks(...)` and `public.match_document_chunks_scoped(...)` — SECURITY DEFINER functions that:
  - only search chunks where `user_id = auth.uid()` (and parent document owned)
  - only search documents with `status = 'completed'`
  - optionally filter by a document, an explicit document list, or conversation
  - return similarity = `1 - (embedding <=> query_embedding)` ordered by cosine distance
  - are restricted to the authenticated role
- No fake vectors or sample documents are inserted.

## 3) Storage bucket and policies
Run `migrations/003_auth_hardening.sql`. It creates the private `documents` bucket and owner-only storage policies. The server can also create the bucket automatically when `SUPABASE_SERVICE_ROLE_KEY` is set.

## 4) Supported uploads and OCR
The API extracts text from PDF, DOCX, TXT, MD/MARKDOWN, CSV, JSON, HTML/HTM, PNG, JPG, and JPEG files. Uploads are limited to 25 MB and PDFs to 50 pages.

- PDF: uses the text layer first. Pages with fewer than 8 characters are rendered and OCR'd; PDFs with no usable text layer are fully OCR'd.
- DOCX: parsed with `mammoth`; scanned PDFs and images use Tesseract; text-based formats are read as UTF-8 and HTML tags/scripts are stripped.
- OCR runs locally (no external OCR service). `TESSERACT_LANG` defaults to `eng`; the first OCR downloads language data into `TESSERACT_CACHE_PATH` (default: OS temp directory), so the host needs outbound access or a pre-populated cache.
- Images-only uploads are supported for PNG and JPEG.

## 5) Embeddings
The database expects **768-dimension** vectors. Choose one provider with `EMBEDDINGS_PROVIDER`:

- `local` (default) — built-in deterministic, offline embeddings. Works on Vercel and needs no extra service. Lexical rather than semantic, so quality is lower.
- `ollama` — set `OLLAMA_BASE_URL` and `OLLAMA_EMBED_MODEL` (for example `nomic-embed-text`). Best local semantic quality, but Ollama cannot run on Vercel.
- `openai` — set `EMBEDDINGS_API_URL`, `EMBEDDINGS_API_KEY`, and `EMBEDDINGS_MODEL`. Use a model configured for 768 dimensions (for example `text-embedding-3-small` with the `dimensions` parameter).
- `huggingface` — set `HF_TOKEN` and optionally `HF_EMBEDDING_MODEL` (default `sentence-transformers/all-MiniLM-L6-v2`). The token must be a fine-grained token with **"Make calls to Inference Providers"** permission. Optional `HF_EMBEDDINGS_URL` and `HF_EMBEDDING_BATCH_SIZE` (max 64).
  MiniLM returns 384-dimension vectors; the server normalizes them and pads with zeros to 768, which preserves cosine similarity and works with the existing `vector(768)` schema.
  If the token is rejected, create a new token with inference permission or use `EMBEDDINGS_PROVIDER=local`.
- `google` — set `GEMINI_API_KEY` (a Google AI Studio key) and optionally `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-001`). Optional `GEMINI_API_BASE_URL` and `GEMINI_EMBEDDING_BATCH_SIZE` (max 100). The server calls the native Gemini REST API, uses `RETRIEVAL_DOCUMENT` for ingestion and `RETRIEVAL_QUERY` for questions, and requests 768 output dimensions to match the schema. New `AQ.` keys work with the native endpoint; they do not work with OpenAI-compatible `/v1/embeddings` endpoints.

If you switch embedding providers, re-upload documents so all chunks use the same vector space. If you want native 384-dimension storage instead of padding, update `vector(768)`, the HNSW index, and `match_document_chunks` in `002_rag_pgvector.sql`.

## 6) Usage notes
- Always filter by `user_id`/RLS; the function also enforces ownership via `auth.uid()`.
- For large corpora consider IVFFlat instead of HNSW or tune parameters.
- Uploads return `202` with status `uploading`; poll `GET /api/documents` until `completed` or `failed`. Duplicate filename/size uploads reuse the existing document while it is `uploading`, `processing`, or `completed`.
- A `processing` document older than 15 minutes is treated as stale, so it can be re-uploaded. `POST /api/documents/process` recovers stale uploads/processing rows and requires `Authorization: Bearer ${CRON_SECRET}`.
- `POST /api/documents/:id/reindex` re-downloads the stored original file, regenerates chunks, and replaces its vectors.
- `POST /api/documents/:id/debug` returns metadata only: chunk count, embedding dimensions, retrieved chunk ids/pages/scores, threshold, context length, and whether context would reach the LLM. It never returns document text.
- `RAG_DEBUG=true` enables safe diagnostic logs for extraction, chunking, embeddings, retrieval, and prompt assembly. Do not enable verbose diagnostics in production with sensitive documents.
- `DELETE /api/documents/:id` removes the database rows, chunks, and stored file. `POST`/`DELETE /api/documents/:id/attach` manage conversation attachments; `GET /api/documents/:id/link` returns a short-lived signed URL.
- RAG chat preserves conversation history and only grounds the latest user turn. `POST /api/chat` with `rag:true` requires an authenticated `conversationId`.

## 7) Verification
Start the API (`npm run dev:api` or `npm run dev`), then run:

```bash
npm run verify:supabase
npm run verify:rag
npm run verify:ocr
```

`verify:rag` creates an anonymous session, uploads a generated PDF, waits for async processing, checks the debug endpoint, reindexes, asks grounded and vague (`about`) questions, verifies document/general routing, and cleans up. It needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and a running API; set `E2E_API_URL` if the API is not on `http://localhost:3001`.

`verify:ocr` renders text into an image-only PDF and a JPEG, then checks that both are extracted via OCR. The first run downloads Tesseract language data.
