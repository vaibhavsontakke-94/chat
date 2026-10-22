# Auth + Chat History Setup

## 1) Create tables and RLS
Run `migrations/001_auth_chat_history.sql` in your Supabase SQL editor. This creates:
- `public.conversations` (owned by `auth.users`, with `user_id`, title, timestamps)
- `public.messages` (belongs to a conversation, role/content/model)
- Indexes, `updated_at` trigger, and RLS policies so users can only access their own data.

## 2) Configure Supabase Auth
In Supabase Dashboard → Authentication → Providers:
- Enable Email/Password if desired (optional). 
- For Google login: enable Google provider and add OAuth Client ID/Secret from Google Cloud. Set redirect URLs to include your app origin (e.g. `http://localhost:5173` and your deployed URL). Only enable if correctly configured.

## 3) Environment variables
Add to `.env` (server) and ensure Vite env vars are present:
- `SUPABASE_URL` (server)
- `SUPABASE_SERVICE_ROLE_KEY` (server, **never** exposed to browser)
- `SUPABASE_JWT_SECRET` (server, used to verify Supabase JWTs)
- `VITE_SUPABASE_URL` (browser)
- `VITE_SUPABASE_ANON_KEY` (browser)

See `.env.example` for placeholders.

## 4) Run the app
```bash
npm install
npm run dev
```
- Guests can chat without signing in (no history saved).
- Signed-in users get their conversations loaded from Supabase; creating/sending messages persists to their account. RLS prevents cross-user access.
- AI chat still works via Groq as before.

## Notes
- User IDs are never trusted from the client — the server derives `user_id` from the verified Supabase JWT.
- Messages are stored per conversation; deleting a conversation cascades to messages.
- If you don’t configure Supabase, auth/history features are disabled and the app still behaves as before.
