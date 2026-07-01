# GRS Safety Dashboard

A self-hosted safety dashboard for GRS Contractors Ltd, built and operated by
Safety Simplified Ltd. This first release ships the **Audits & Findings** module
fully functional, behind a login for two consultant accounts. Training, RAMS,
COSHH and Site packs appear as previews and are switched on later.

Stack: Node + Express + PostgreSQL. Single deployable app — the API and the
front-end are served together.

---

## What works today

- **Login** — two consultant accounts (you and Frank), session held in a secure cookie.
- **Dashboard** — live compliance %, sites audited, open findings by severity, overdue count.
- **Audits** — list open findings (most urgent first), **add a finding**, **close a finding**
  with a note. Per-site compliance table driven by recorded audits.
- Other modules show an honest "in development" state.

---

## Deploy to Railway (recommended)

1. **Create the repo.** Push this folder to a private GitHub repo.
2. **New Railway project** → *Deploy from GitHub repo* → pick the repo.
3. **Add a database.** In the project, *New* → *Database* → *Add PostgreSQL*.
   Railway sets `DATABASE_URL` automatically.
4. **Set variables** (project → Variables):
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = a long random string
     (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
   - `SEED_USER1_PASS` and `SEED_USER2_PASS` = the initial passwords you want
5. **First deploy** runs automatically. Then run the one-off setup from the
   Railway shell (project → the service → *Settings* → *Run command*), or locally
   against the same `DATABASE_URL`:
   ```
   npm run migrate   # creates the tables
   npm run seed      # creates users, sites, demo audits & findings
   ```
6. **Add your domain.** Project → service → *Settings* → *Networking* →
   *Custom Domain* (e.g. `grs.safety-simplified.com`). Point a CNAME at the
   Railway target.

Done. Visit the domain, sign in with a seeded email + password.

> The seed data mirrors the demo (8 sites, 8 findings) so the dashboard looks
> populated on day one. Replace it with real sites/audits as you go — nothing
> is hard-coded in the app.

---

## Run locally

```
cp .env.example .env          # then fill DATABASE_URL + JWT_SECRET
npm install
npm run migrate
npm run seed
npm run dev                   # http://localhost:3000
```

You need a local Postgres, or point `DATABASE_URL` at the Railway database.

---

## Day-to-day use

- **Add a finding:** Audits → *+ Add finding* → pick site, severity, title, owner, due date.
- **Close a finding:** Audits → *Mark closed* on the row → optional note.
- Closing a finding immediately updates the dashboard counts and the site's open total.
- **Record an audit / add a site:** API endpoints exist (`POST /api/audits`,
  `POST /api/sites`); a simple form for these is the obvious next addition.

---

## API reference (all under `/api`, all require the auth cookie except `/auth/login`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | email + password → sets cookie |
| POST | `/auth/logout` | clears cookie |
| GET | `/auth/me` | current user |
| GET | `/sites` | active sites + open counts + latest audit |
| POST | `/sites` | add site `{ref, name}` |
| PATCH | `/sites/:id` | rename / activate / deactivate |
| GET | `/findings?status=open&site_id=` | list findings |
| POST | `/findings` | add `{site_id, severity, title, owner?, due_date?}` |
| PATCH | `/findings/:id` | edit |
| POST | `/findings/:id/close` | close `{note?}` |
| POST | `/findings/:id/reopen` | reopen |
| GET | `/audits` | all audits |
| POST | `/audits` | record `{site_id, audited_on, auditor?, compliance?, notes?}` |
| GET | `/audits/summary` | dashboard payload |

---

## Notes on security

- Passwords are bcrypt-hashed; only the hash is stored.
- Login is rate-limited (10 attempts / 15 min).
- The session cookie is httpOnly and, in production, secure + sameSite.
- Change seeded passwords after first login (re-seed with new `SEED_USER*_PASS`,
  or add a change-password endpoint — a sensible next task).

## Roadmap (next modules, in order)

1. Audit capture form (record audit + add multiple findings in one go).
2. Training & competency register (tickets, expiry tracking).
3. RAMS register mapped to work fronts.
4. COSHH substance register.
5. Site packs (per-site document bundles) — ties the above together.
