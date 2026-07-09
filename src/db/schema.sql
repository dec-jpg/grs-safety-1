-- ============================================================
--  GRS Safety — schema (audits & findings slice)
--  Run by scripts/migrate.js
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'consultant',  -- consultant | admin
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
  id          SERIAL PRIMARY KEY,
  ref         TEXT UNIQUE NOT NULL,        -- e.g. GRS-118
  name        TEXT NOT NULL,               -- Standish — Phase 2 groundworks
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audits (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  audited_on    DATE NOT NULL,
  auditor       TEXT,                       -- who carried it out
  compliance    INTEGER,                    -- 0-100, computed or entered
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS findings (
  id            SERIAL PRIMARY KEY,
  audit_id      INTEGER REFERENCES audits(id) ON DELETE SET NULL,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  severity      TEXT NOT NULL,              -- critical | major | minor
  title         TEXT NOT NULL,
  detail        TEXT,
  owner         TEXT,                        -- person responsible on site
  due_date      DATE,
  status        TEXT NOT NULL DEFAULT 'open', -- open | closed
  closed_on     DATE,
  closed_note   TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_findings_site   ON findings(site_id);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS idx_audits_site     ON audits(site_id);

-- ============================================================
--  Operative spine + site attendance (sign in / out)
-- ============================================================

-- One record per person, reused across sites. Identity = name + dob.
CREATE TABLE IF NOT EXISTS operatives (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  dob           DATE,
  company       TEXT,                          -- own firm or subcontractor
  card_no       TEXT,                          -- recorded, not yet verified
  card_type     TEXT,
  card_expiry   DATE,
  company_inducted BOOLEAN NOT NULL DEFAULT false,
  inducted_on   DATE,
  status        TEXT NOT NULL DEFAULT 'active', -- active | inactive
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- name+dob is the practical unique key; guard against exact duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_operatives_identity
  ON operatives (lower(name), dob);

-- One row per sign-in. out_at NULL = currently on site.
CREATE TABLE IF NOT EXISTS attendance (
  id            SERIAL PRIMARY KEY,
  operative_id  INTEGER REFERENCES operatives(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,                 -- snapshot, so history survives
  company       TEXT,
  role          TEXT,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  type          TEXT NOT NULL DEFAULT 'staff', -- staff | subbie | visitor
  inducted      BOOLEAN NOT NULL DEFAULT true, -- induction valid at sign-in
  in_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  out_at        TIMESTAMPTZ,
  created_by    INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_site   ON attendance(site_id);
CREATE INDEX IF NOT EXISTS idx_attendance_onsite ON attendance(site_id) WHERE out_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_day    ON attendance(in_at);

-- ============================================================
--  GPS capture (added after first deploy — safe to re-run)
--  Sites carry their own coordinates; attendance stamps the
--  signing device's position at the in/out moment only.
-- ============================================================
ALTER TABLE sites      ADD COLUMN IF NOT EXISTS lat     DOUBLE PRECISION;
ALTER TABLE sites      ADD COLUMN IF NOT EXISTS lng     DOUBLE PRECISION;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS in_lat  DOUBLE PRECISION;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS in_lng  DOUBLE PRECISION;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS in_acc  REAL;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS out_lat DOUBLE PRECISION;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS out_lng DOUBLE PRECISION;

-- Per-site token for the public operative sign-in link (unguessable).
ALTER TABLE sites ADD COLUMN IF NOT EXISTS signin_token TEXT;
UPDATE sites SET signin_token = substr(md5(random()::text || id::text), 1, 10)
  WHERE signin_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_token ON sites(signin_token);

-- Separate kiosk token: shared site tablet. Device rule off, form resets
-- per person, photo still required. Keep this link off personal phones.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS kiosk_token TEXT;
UPDATE sites SET kiosk_token = substr(md5(random()::text || 'k' || id::text), 1, 10)
  WHERE kiosk_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_kiosk ON sites(kiosk_token);

-- Self sign-in identity layers: photo at the gate + one open sign-in per device.
-- Photo is a small compressed JPEG (server-capped). Fine at crew scale in
-- Postgres; migrates to object storage (R2) when rollout multiplies volume.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS photo     TEXT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS device_id TEXT;
CREATE INDEX IF NOT EXISTS idx_attendance_device ON attendance(device_id) WHERE out_at IS NULL;

