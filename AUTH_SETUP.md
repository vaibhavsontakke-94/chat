# Auth + Chat History Setup

Nyra AI uses Supabase anonymous authentication. On first load the app creates a private anonymous
session automatically, so there is no login page. Chat history and documents are scoped to that
session and its stable Supabase user id.

## 1) Run the database migrations

Run these in the Supabase SQL editor, in order:

1. `migrations/001_auth_chat_history.sql` — conversations, messages, RLS, updated-at trigger.
2. `migrations/002_rag_pgvector.sql` — documents, chunks, pgvector, RLS, similarity search.
3. `migrations/003_auth_hardening.sql` — hardened user-scoped vector search function, private
   `documents` storage bucket, and owner-only storage policies.
4. `migrations/004_history_pagination_and_scoped_rag.sql` — idempotent history saves, pagination
   indexes, citation metadata, and conversation-scoped documents.

Or apply all three through the Supabase Management API and enable anonymous sign-ins:

```bash
# Create a token at https://supabase.com/dashboard/account/tokens
# Add SUPABASE_ACCESS_TOKEN=... to .env, then:
npm run migrate:supabase
```

The script is idempotent and never ships the token to the browser. It also sets
`external_anonymous_users_enabled: true`; the token needs auth config write access.

Verify the project without creating any users:

```bash
npm run verify:supabase
```

This checks Auth reachability, anonymous sign-ins, required tables, the RAG function, and the
password sign-in endpoint. It reports missing migrations and provider configuration.

## 2) Configure Supabase Auth

In Supabase Dashboard → Authentication → Sign In / Providers:

- **Anonymous Sign-ins**: enable. This is required; without it the app cannot create a session and
  uploads/history stay disabled.
- Email/password, Google, OAuth redirect URLs, and password reset are not used by the UI.

The browser stores the anonymous session in `localStorage` and Supabase refreshes it automatically.
Clearing site data starts a new anonymous identity, so previous history is no longer associated
with the browser.

## 3) Environment variables

Server only (never exposed to the browser):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (or `VITE_SUPABASE_ANON_KEY`; used with the user's verified token)
- `SUPABASE_JWT_SECRET` (optional legacy fallback for local token verification)
- `SUPABASE_SERVICE_ROLE_KEY` (optional; never required by the request path)

Browser (safe to expose):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

See `.env.example` for placeholders. Existing values in `.env` are not modified by this project.

## 4) Authentication behaviour

- On first load, the app calls `signInAnonymously()` if there is no saved session.
- `/` and `/settings` are available without a login screen.
- The anonymous session persists in `localStorage`; Supabase refreshes the token automatically.
- If anonymous sign-ins are disabled, the app shows a setup banner and blocks uploads/history
  instead of creating a fake session.
- Clearing site data or deleting the browser profile creates a new anonymous user. Previous
  conversations and documents remain in the database but are no longer reachable from that browser.
- There is no email/password, Google, "Remember me", or password-reset UI.

## 5) Security model

- The server verifies every bearer token with Supabase Auth before trusting a user id. The user id
  is never taken from the request body.
- Conversation and document routes run as the signed-in user through a per-request Supabase client,
  so RLS applies in addition to explicit `user_id` filters.
- Messages can only be added to conversations owned by the caller.
- RAG retrieval runs as the user and calls the security-definer `match_document_chunks` function,
  which derives the owner from `auth.uid()`. Callers cannot select another user's chunks.
- Uploaded files go to the private `documents` storage bucket with owner-folder policies. No public
  URLs are created.
- RLS policies remain enabled as a second layer for any client-side Supabase access.
- Service-role keys and OAuth secrets stay on the server. Only the anon key is shipped to the
  browser.

## 6) Run and verify

```bash
npm install
npm run dev
```

The API end-to-end check still uses a real email/password Supabase user to test backend isolation:

```powershell
$env:E2E_EMAIL="test-user@example.com"; $env:E2E_PASSWORD="..."
npm run e2e:auth
```

It signs in with a Supabase user, confirms unauthenticated APIs return 401, creates/renames/deletes
a conversation, round-trips messages, checks documents, and removes its test conversation. Set
`E2E_OTHER_EMAIL`/`E2E_OTHER_PASSWORD` to also verify cross-user isolation.

Then verify the browser flow:

1. Enable Anonymous Sign-ins and reload the app. No login screen should appear.
2. Confirm a session id appears in Settings.
3. Refresh the page and confirm history/documents still load for the same session.
4. Upload a PDF and confirm it can be attached and used for retrieval.
5. Clear site data in a second profile/browser and confirm it gets a different anonymous user with
   no access to the first session's history/documents.

Without Supabase credentials the app displays a session configuration warning; it does not create
mock sessions or fake accounts.
