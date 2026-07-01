# Going live — sign-in/out on a basic level

This is the exact path to getting **site sign-in/out working for real** (persists,
shared, behind a login). Follow it in order. Steps marked **[YOU]** need your
accounts/card; steps marked **[RUN]** are commands to run; the code is already built.

Rough time: 60–90 minutes the first time, most of it account setup.

---

## What you need first — accounts **[YOU]**

You said you have some of these. Get all three before starting:

1. **GitHub** — free. github.com → sign up. This stores the code.
2. **Railway** — railway.app → sign up (with GitHub is easiest). This runs the
   app + database. Free trial, then ~$5/mo. Add a card when it asks.
3. *(Anthropic API key — NOT needed yet. Only for real card scanning later.)*

---

## Step 1 — Get the code onto GitHub **[YOU]**

The project folder is `grs-safety` (in the zip alongside this guide).

Easiest route if you're not comfortable with git commands:
1. On github.com, click **New repository**. Name it `grs-safety`, set **Private**, click Create.
2. On the new repo page, click **uploading an existing file**.
3. Drag in the *contents* of the `grs-safety` folder (not the folder itself) —
   but **skip the `node_modules` folder** (it's huge and rebuilds automatically).
4. Commit.

That's the code hosted. (If you know git, just push the folder to the repo as normal.)

---

## Step 2 — Create the project on Railway **[YOU]**

1. railway.app → **New Project** → **Deploy from GitHub repo** → pick `grs-safety`.
2. It'll start building. It may fail the first time because there's no database
   yet — that's expected, keep going.
3. In the project, click **New** → **Database** → **Add PostgreSQL**.
   Railway creates it and automatically sets `DATABASE_URL`. Nothing to copy.

---

## Step 3 — Set the secrets **[YOU]**

In the project → your app service → **Variables** → add these:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | a long random string (see below) |
| `SEED_USER1_EMAIL` | your email |
| `SEED_USER1_PASS` | a password you'll use to log in |
| `SEED_USER2_EMAIL` | Frank's email |
| `SEED_USER2_PASS` | a password for Frank |

For `JWT_SECRET`, you need a long random string. Easiest: search "random string
generator 64 characters" and paste one, or on a Mac/Linux terminal run:
`openssl rand -hex 32`

Railway will redeploy automatically after you add variables.

---

## Step 4 — Create the tables and starting data **[RUN]**

The database is empty until you run two setup commands. In Railway:

1. Project → your app service → the **⋯** menu (or Settings) → find a way to run a
   one-off command / open a shell. (Railway's UI moves this around; look for
   "Run command" or use the Railway CLI — see note below.)
2. Run: `npm run migrate`   → creates all the tables
3. Run: `npm run seed`      → creates your logins + sites + a few on-site people

**If Railway's UI won't let you run a command easily**, install the Railway CLI on
your computer (railway.app/cli), then from the project folder run:
`railway run npm run migrate` and `railway run npm run seed`.
Tell me if this step is fiddly and I'll walk you through the CLI.

---

## Step 5 — Open it and log in **[YOU]**

1. Project → your app service → **Settings** → **Networking** → **Generate Domain**.
   You'll get a URL like `grs-safety-production.up.railway.app`.
2. Visit `that-url/login.html`, log in with the email + password you set in Step 3.
3. Go to `that-url/attendance.html` — **this is the live sign-in/out page.**

---

## Step 6 — Test it's actually working **[YOU]**

The real proof:
1. On the attendance page, pick a site, click **+ Sign someone in**, add a name.
2. They appear in "On site now."
3. **Refresh the page.** They're still there — that's the database working.
4. Open the same URL on your phone. Same data. That's it being shared/live.
5. Sign them out. Gone from the list.

If all that works, you have a genuinely live attendance system.

---

## What's live vs not, so you're clear

**Live now:** sign-in/out, who's-on-site register, induction flag, per-site,
behind a login, data persists and is shared. Runs at `/attendance.html`.

**Not yet (still demo/next steps):**
- The full dashboard (`/index.html`) is the earlier demo front-end — audits/findings
  are wired, other modules are demo views.
- Operative records aren't linked to sign-in yet (you type the name each time).
  Linking them is the natural next step.
- Card scanning is not live (needs the Anthropic key + the scan routed through
  this backend).

---

## A nice touch for site use

For a cabin tablet, just leave `/attendance.html` open on the site's page. It
auto-refreshes every 20 seconds so the register stays current. Bookmark it.

---

## When something goes wrong

- **Build fails on Railway:** usually a missing variable. Check Step 3.
- **"Server error" on login:** the database tables aren't created — run Step 4.
- **Can't log in:** the seed didn't run, or the password env var wasn't set before
  seeding. Re-run `npm run seed` after setting `SEED_USER1_PASS`.
- Stuck on any step — tell me which number and what you see, and I'll get you past it.
