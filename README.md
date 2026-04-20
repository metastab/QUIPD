# Quipd

> **Quite Unique and Intelligent Personal Diary** — a calm, distraction-free personal journaling app with OAuth sign-in and secure per-user data isolation.

**Live demo:** [quipd.vercel.app](https://quipd.vercel.app)  
**Repository:** [github.com/metastab/QUIPD](https://github.com/metastab/QUIPD)

---

## Overview

Quipd is a minimal personal diary built as a full-stack web application. Users can sign in with Google or GitHub, write rich-text journal entries with optional tags, search through their history, and delete entries — all with their data privately isolated to their own account.

The core design goal was **simplicity without sacrificing security**: the UI is intentionally distraction-free, and the backend enforces user ownership at the server level rather than relying on anything the client sends.

---

## Live Links

| | |
|---|---|
| **App** | [https://quipd.vercel.app](https://quipd.vercel.app) |
| **API base** | `https://quipd.vercel.app/entries` |

---

## Approach & Design Decisions

### 1. No password auth — OAuth only

Rather than building a credential system, Quipd delegates authentication entirely to Supabase OAuth. Users sign in with Google or GitHub, which issues a short-lived JWT (`access_token`). This eliminates password storage, hashing, and reset flows entirely.

### 2. Token-based API security — never trust the client

The most important backend decision: **the server never accepts a `user_id` from the client.** A naive implementation would let the client POST `{ user_id: "someone-elses-id" }` and write to another user's data.

Instead, every API request must carry a `Bearer` token in the `Authorization` header. The server extracts and verifies the token via `supabase.auth.getUser(token)`, which calls Supabase to validate the JWT signature and expiry. The verified `user.id` is then used server-side for all database queries.

```
Client                       Server                        Supabase
  │                            │                              │
  │── GET /entries ────────────▶│                              │
  │   Authorization: Bearer <token>                           │
  │                            │── auth.getUser(token) ───────▶│
  │                            │◀── { user } ─────────────────│
  │                            │── SELECT WHERE user_id = user.id ─▶│
  │◀── [ entries ] ────────────│                              │
```

### 3. Auth logic is split from app logic

`auth.js` is a standalone module containing `initAuth`, `handleAuthClick`, `handleGithubClick`, and `updateAuthUI`. It receives dependencies (the Supabase client, DOM references, a callback) as parameters so it has no implicit globals. `script.js` owns all entry and UI state, and passes `handleAuthChange` as the session callback.

### 4. Token stored in memory, not localStorage

`currentToken` (the Supabase `access_token`) is held in a plain JavaScript variable. It is set when a session starts and cleared to `null` on sign-out. Supabase also persists the session internally via `localStorage` so users stay logged in across page reloads — but Quipd never manually writes the raw token to storage.

### 5. Vanilla stack — no framework

The frontend is plain HTML, CSS, and JavaScript. The rich text editor uses `contenteditable` with `document.execCommand` (bold, italic, underline). There is no bundler or build step — the files are served statically by Express.

### 6. Dark mode via CSS custom properties

The entire design system is defined in CSS custom properties on `:root`. Dark mode overrides those tokens under `[data-theme="dark"]`. Toggling theme is a single attribute swap on `<html>`, with the preference persisted in `localStorage` and initialized from `prefers-color-scheme` if no saved preference exists.

---

## How It Works

### Authentication flow

1. User clicks the Google or GitHub button in the header.
2. `handleAuthClick` / `handleGithubClick` in `auth.js` calls `supabase.auth.signInWithOAuth()`, redirecting to the provider.
3. After the OAuth callback, Supabase redirects back to the app origin. Supabase JS detects the session from the URL hash/code and fires `onAuthStateChange`.
4. `handleAuthChange` in `script.js` receives the session, stores `session.user` as `currentUser` and `session.access_token` as `currentToken`, sets `data-auth="true"` on `<body>` (which CSS uses to show authenticated UI), and triggers `fetchEntries()`.
5. On sign-out, both values are cleared to `null`, the `data-auth` attribute is removed, and the entries list is emptied.

### Entry lifecycle

```
Write → Submit → POST /entries (with Bearer token)
                     └── server verifies token → inserts with req.user.id
                                                       └── fetchEntries() re-renders list

Delete → Confirm → DELETE /entries/:id (with Bearer token)
                       └── server verifies token + checks user_id ownership
                                                         └── fetchEntries() re-renders list
```

### Search

Search is entirely client-side. `allEntries` holds the full list fetched from the server. The search input filters in real-time across both the plain text of the entry content (HTML is stripped before matching) and all tags. No additional network requests are made during a search session.

### Server middleware chain

```
Request
  └── express.static()         (serves public/ files)
  └── authenticate middleware  (verifies JWT, attaches req.user)
      └── route handler        (reads/writes Supabase using req.user.id)
```

---

## Project Structure

```
QUIPD/
├── public/
│   ├── index.html      # App shell, markup, and SVG assets
│   ├── style.css       # Full design system (tokens, dark mode, components)
│   ├── auth.js         # Auth module — OAuth login/logout, session listener
│   └── script.js       # App logic — entries, editor, search, rendering, toasts
├── server.js           # Express API — authenticate middleware + 3 routes
├── package.json
└── .gitignore
```

---

## API Reference

All endpoints require `Authorization: Bearer <supabase-access-token>`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/entries` | Returns all entries for the authenticated user, newest first |
| `POST` | `/entries` | Creates a new entry |
| `DELETE` | `/entries/:id` | Deletes an entry (ownership verified server-side) |

**POST `/entries` body:**
```json
{
  "content": "<p>Your journal entry <strong>text</strong>.</p>",
  "tags": ["personal", "ideas"]
}
```

---

## Database Schema

```sql
create table entries (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  content     text not null,
  tags        text[] default '{}',
  created_at  timestamptz not null
);

-- Row Level Security — belt-and-suspenders alongside server-side checks
alter table entries enable row level security;

create policy "Users can manage their own entries"
  on entries for all
  using (auth.uid() = user_id);
```

---

## Assumptions

- **One device at a time is fine.** There is no real-time sync between tabs or devices — the entry list is fetched on sign-in and after each create/delete. A page refresh will always show the latest data.
- **The anon key is safe to expose.** Supabase's anon key is a public, scoped credential — it is intentionally embedded in the client. Actual data access is gated by Row Level Security and the server-side JWT check, not by keeping the key secret.
- **Content is trusted as HTML.** Entry content is stored and rendered as raw HTML (via `contenteditable` + `innerHTML`). No server-side sanitization is applied beyond trimming whitespace. This is safe for a single-user personal diary but would require a sanitizer (e.g. DOMPurify) in a multi-user/public context.
- **Tags are plain strings.** Tags are stored as a PostgreSQL `text[]` array. There is no tag normalization (e.g. lowercasing) on the server — the client trims whitespace and splits on commas, but case is preserved.
- **Supabase handles token refresh.** The Supabase JS client automatically refreshes the `access_token` before it expires. `currentToken` in the app is kept in sync via `onAuthStateChange`, so all requests always use a valid token without any manual refresh logic.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript |
| Backend | Node.js + Express 5 |
| Auth & Database | Supabase (Auth + PostgreSQL) |
| Analytics | Vercel Analytics |
| Deployment | Vercel |
| Fonts | Inter · Merriweather · Playfair Display (Google Fonts) |

---

## License

[MIT](LICENSE)
