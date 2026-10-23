# Nyra AI

Streaming AI chat with document-grounded RAG, built with React + Vite and a small Node API.

## Setup

1. Copy `.env.example` to `.env` and fill in `GROQ_API_KEY` and the Supabase values.
2. Run `migrations/001_auth_chat_history.sql`, `002_rag_pgvector.sql`,
   `003_auth_hardening.sql`, and `004_history_pagination_and_scoped_rag.sql` in the Supabase SQL
   editor.
3. Enable **Anonymous Sign-ins** in Supabase (Authentication → Sign In / Providers →
   Anonymous). See `AUTH_SETUP.md`.
4. Install and run:

```bash
npm install
npm run dev
```

The app is served at `http://localhost:5173`; the API runs on `http://localhost:3001`.

## Routes

- `/` chat with an automatic anonymous session
- `/settings` session, provider, and chat preferences

Each browser gets a private Supabase anonymous session. Chat history and documents are tied to
that session, so clearing browser storage starts a new one. Anonymous auth, per-user chat
history, per-user RAG retrieval, and private document storage are documented in `AUTH_SETUP.md`.
