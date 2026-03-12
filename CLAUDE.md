# Language Learning — Web Backend & Admin Panel

## Critical Rules

### Security — MANDATORY for every route

1. **Every new route MUST have proper auth.** Use `authenticateToken` for protected endpoints, `optionalAuth` only when explicitly needed for public endpoints that benefit from knowing the user. Never leave a mutating endpoint (POST/PUT/DELETE) without auth.
2. **Every route MUST validate and sanitize all inputs.** Check types, lengths, formats, and allowed values. Never trust client data. Reject early with 400 status.
3. **Every route MUST use parameterized queries (`$1`, `$2`).** Never concatenate user input into SQL strings. This is non-negotiable.
4. **Every route MUST verify ownership/permission** before modifying resources. Check `user_id` or collaborator status — never assume the authenticated user owns the resource.
5. **Every route MUST have try/catch** with generic error responses. Never leak stack traces, SQL errors, or internal details to the client.
6. **File uploads MUST validate** MIME type, file extension, and file size before writing to disk. Use allowlists, not blocklists.
7. **Rate-sensitive operations** (login, register, pair-code) should be mindful of abuse potential.

### Credentials & Environment

- **ALL secrets, keys, and credentials MUST be in `.env` files** — never hardcoded in source.
- Required env vars: `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`
- `server/src/config.ts` reads env vars — add new ones there, nowhere else.
- `.env` files live in `docker/dev/.env` and `docker/prod/.env`. Never commit prod secrets.
- Dev defaults (like fallback DB URL) are acceptable in `config.ts` but `JWT_SECRET` must NOT have a usable default in production.

### Swagger Documentation

- **Every new or modified endpoint MUST be added to `server/src/swagger.ts`.**
- Include: method, path, tags, summary, request body schema, all response codes, auth requirement.
- Use `$ref` to shared schemas in `components.schemas` — don't inline repeated structures.
- Swagger UI served at `/api/docs`, raw spec at `/api/docs.json`.

## Project Structure

```
watchWeb/
├── src/                        # Vue 3 frontend
│   ├── views/                  # Page components (Home, Create, Edit, Packs, Privacy)
│   ├── components/             # Shared components (AudioRecorder)
│   ├── router.ts               # Vue Router config
│   ├── App.vue
│   └── main.ts
├── server/
│   └── src/
│       ├── index.ts            # Express app, route mounting, /api/words/:token
│       ├── config.ts           # All env var reads, constants, uploads dir
│       ├── db.ts               # PostgreSQL pool, schema init, migrations
│       ├── swagger.ts          # OpenAPI 3.0 spec (update when routes change!)
│       ├── middleware/
│       │   └── auth.ts         # JWT auth: authenticateToken, optionalAuth, createToken
│       ├── routes/
│       │   ├── auth.ts         # /api/auth/* — register, login, google, me
│       │   ├── packs.ts        # /api/packs/* — CRUD, browse
│       │   ├── ratings.ts      # /api/packs/:token/rate, /rating
│       │   ├── collaborators.ts# /api/packs/:token/collaborators, /api/users/lookup
│       │   ├── watch.ts        # /api/watch/* — pair-code, pair, sync-packs, sync
│       │   ├── audio.ts        # /api/audio — upload (base64), serve, delete
│       │   └── images.ts       # /api/images — upload (base64), serve, delete
│       └── uploads/            # Audio and image files (not in git)
├── docker/
│   ├── dev/                    # Dev docker-compose, Dockerfile, .env
│   └── prod/                   # Prod docker-compose (Traefik), Dockerfile, .env
├── package.json
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

## Tech Stack

- **Frontend:** Vue 3 + TypeScript + Vite + Tailwind CSS
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL 16
- **Auth:** JWT (30-day expiry) + Google Sign-In
- **Deployment:** Docker, Traefik reverse proxy at `watch.osrs.lv`

## Database

- Schema defined in `server/src/db.ts` — `initDb()` runs CREATE TABLE IF NOT EXISTS + ALTER TABLE migrations on startup.
- Tables: `users`, `packs`, `words`, `pack_collaborators`, `pack_downloads`, `pack_ratings`
- **When adding columns:** add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in the migration block at the bottom of `initDb()`. Never modify the CREATE TABLE statements for existing tables.
- Always use foreign keys with appropriate ON DELETE behavior (CASCADE for owned data).
- Use transactions (`pool.query('BEGIN')` / `COMMIT` / `ROLLBACK`) for multi-step mutations.

## Route Conventions

- Route files export a `Router()` mounted in `index.ts`.
- Auth middleware: `authenticateToken` (required) or `optionalAuth` (reads token if present).
- Request type: `AuthenticatedRequest` (extends Express Request with `user?: { userId, email }`).
- Response pattern: `res.json({ ... })` on success, `res.status(4xx).json({ error: '...' })` on failure.
- Ownership check pattern: query the resource, verify `user_id = req.user!.userId` or check `pack_collaborators`.

## Checklist for New Routes

1. [ ] Auth middleware applied (`authenticateToken` or `optionalAuth`)
2. [ ] All inputs validated (type, length, format, allowed values)
3. [ ] All SQL uses parameterized queries (`$1`, `$2`, ...)
4. [ ] Ownership/permission verified before mutations
5. [ ] try/catch with generic `{ error: 'Server error' }` — no leaked internals
6. [ ] File operations validate MIME, extension, and size
7. [ ] Swagger spec updated in `server/src/swagger.ts`
8. [ ] New env vars added to `config.ts` and both `.env` files
9. [ ] Both mobile apps (watch `app/` and phone `phone/` in `../watch/`) updated if they consume the endpoint

## Consumers

This API is consumed by:
- **Wear OS watch app** (`../watch/app/`) — syncs packs via `/api/watch/sync/:syncToken`, downloads via `/api/words/:token`
- **Android phone app** (`../watch/phone/`) — full API consumer (auth, packs, ratings, collaborators, watch sync, audio, images)
- **Vue admin panel** (this repo's frontend) — pack management via `/api/packs/*`

**Any API change must consider all three consumers.**
