# Quipd

> **Quite Unique and Intelligent Personal Diary** — a calm, distraction-free journaling app with secure cloud sync.

---

## Features

- **Rich text editor** — bold, italic, and underline formatting with a minimal toolbar
- **Tag support** — organize entries with comma-separated tags; search by content or tag
- **OAuth sign-in** — Google and GitHub login via Supabase Auth
- **Secure API** — every request is authenticated server-side from the JWT; `user_id` is never trusted from the client
- **Dark mode** — system-preference aware, persisted in `localStorage`
- **Warm, minimal UI** — glassmorphism, animated background blobs, smooth transitions

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript |
| Backend | Node.js, Express |
| Auth & Database | Supabase (Auth + PostgreSQL) |
| Deployment | Vercel |
| Fonts | Inter, Merriweather, Playfair Display |

---

## Project Structure

```
QUIPD/
├── public/
│   ├── index.html      # App shell and markup
│   ├── style.css       # Design system and component styles
│   ├── auth.js         # Supabase auth logic (initAuth, OAuth handlers)
│   └── script.js       # App logic (entries, editor, search, rendering)
├── server.js           # Express API with JWT middleware
├── package.json
├── .env.example        # Required environment variables (template)
└── .gitignore
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- A [Supabase](https://supabase.com) project with:
  - A `entries` table (see [Database Setup](#database-setup))
  - Google and/or GitHub OAuth enabled under **Authentication → Providers**

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/QUIPD.git
cd QUIPD

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Fill in your Supabase URL and anon key in .env

# 4. Start the development server
npm start
```

The app will be available at `http://localhost:3000`.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```env
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>
PORT=3000
```

> **Never commit `.env` to version control.** It is already listed in `.gitignore`.

---

## Database Setup

Run the following SQL in your Supabase SQL editor to create the `entries` table:

```sql
create table entries (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  content     text not null,
  tags        text[] default '{}',
  created_at  timestamptz not null
);

-- Only allow users to read/modify their own entries
alter table entries enable row level security;

create policy "Users can manage their own entries"
  on entries
  for all
  using (auth.uid() = user_id);
```

---

## API Reference

All endpoints require an `Authorization: Bearer <supabase-access-token>` header. The user identity is extracted server-side from the token — the client never sends a `user_id`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/entries` | Fetch all entries for the authenticated user |
| `POST` | `/entries` | Create a new entry |
| `DELETE` | `/entries/:id` | Delete an entry (ownership enforced) |

### POST `/entries` — Request Body

```json
{
  "content": "<p>Your journal entry...</p>",
  "tags": ["personal", "ideas"]
}
```

---

## License

[MIT](LICENSE)
