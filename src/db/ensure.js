// ============================================================
//  Boot-time schema repair.
//  Railway deploys never run scripts/migrate.js, so every column
//  or table this build relies on is added here, over the app's own
//  connection, before the server starts listening. Every statement
//  is idempotent (IF NOT EXISTS), so this is a no-op after the first
//  boot. Each statement runs on its own: one failure is logged and
//  the rest still run, and the server still starts.
// ============================================================
import { query } from './pool.js';

const STATEMENTS = [
  // -- attendance: photo + device (self sign-in), sign-out evidence, notes
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS photo TEXT",
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS device_id TEXT",
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS out_photo TEXT",
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS out_dist_m INTEGER",
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS note TEXT",
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS out_note TEXT",
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN NOT NULL DEFAULT false",
  "ALTER TABLE attendance ADD COLUMN IF NOT EXISTS closed_by TEXT",   // portal user who signed the person out

  // -- operatives: fields the induction path writes
  "ALTER TABLE operatives ADD COLUMN IF NOT EXISTS role TEXT",
  "ALTER TABLE operatives ADD COLUMN IF NOT EXISTS company_inducted_at TIMESTAMPTZ",
  "ALTER TABLE operatives ADD COLUMN IF NOT EXISTS company_induction_sig TEXT",
  "ALTER TABLE operatives ADD COLUMN IF NOT EXISTS next_of_kin TEXT",
  "ALTER TABLE operatives ADD COLUMN IF NOT EXISTS nok_phone TEXT",

  // -- sites: induction text and link tokens
  "ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_induction TEXT",
  "ALTER TABLE sites ADD COLUMN IF NOT EXISTS signin_token TEXT",
  "ALTER TABLE sites ADD COLUMN IF NOT EXISTS kiosk_token TEXT",

  // -- tables the sign-in path reads
  "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)",
  `CREATE TABLE IF NOT EXISTS site_inductions (
     id SERIAL PRIMARY KEY,
     operative_id INT NOT NULL REFERENCES operatives(id),
     site_id INT NOT NULL REFERENCES sites(id),
     signed_name TEXT NOT NULL,
     signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE(operative_id, site_id))`,
  `CREATE TABLE IF NOT EXISTS refusals (
     id SERIAL PRIMARY KEY, site_id INT REFERENCES sites(id), name TEXT, company TEXT,
     reason TEXT NOT NULL, dist_m INT, lat DOUBLE PRECISION, lng DOUBLE PRECISION, acc REAL,
     device_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,

  // -- end-of-day report log: one row per send, stops double sends after a restart
  `CREATE TABLE IF NOT EXISTS daily_reports (
     id SERIAL PRIMARY KEY,
     report_date DATE NOT NULL,
     sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     recipients TEXT,
     rows_count INT,
     ok BOOLEAN NOT NULL DEFAULT true,
     detail TEXT)`,
  "CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(report_date)",

  // -- one-time data repair, 17 Sep 2026: records closed from the portal after this
  //    build went live (19:58 UTC) carried the manager's GPS and no closed_by, so they
  //    showed as "signed out 55km from site". Every public sign-out since then has a
  //    photo, so no-photo sign-outs after that moment can only be portal closes.
  //    Safe to leave in: it only touches rows with closed_by still NULL.
  `UPDATE attendance SET closed_by = 'a manager (portal)', out_lat = NULL, out_lng = NULL, out_dist_m = NULL
     WHERE out_at IS NOT NULL AND out_photo IS NULL AND closed_by IS NULL
       AND out_at >= '2026-09-17T19:58:00Z'`
];

export async function ensureSchema() {
  const failed = [];
  for (const sql of STATEMENTS) {
    try { await query(sql); }
    catch (e) { failed.push({ sql: sql.slice(0, 70).replace(/\s+/g, ' '), error: e.message }); }
  }
  if (failed.length) {
    console.error(`[schema] ${failed.length} of ${STATEMENTS.length} statements failed:`);
    failed.forEach(f => console.error(`  ${f.sql} -> ${f.error}`));
  } else {
    console.log(`[schema] verified (${STATEMENTS.length} statements)`);
  }
  return { ok: failed.length === 0, failed };
}
