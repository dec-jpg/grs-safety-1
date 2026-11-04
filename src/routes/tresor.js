// Tresor feed: a read-only summary of this portal for Safety Simplified's Tresor dashboard.
// Locked with TRESOR_KEY (set on Railway). Every query is guarded so a table that is not
// on the live database yet simply leaves that number out rather than breaking the feed.
import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db/pool.js';

const r = Router();

r.use((req, res, next) => {
  const key = process.env.TRESOR_KEY || '', given = req.get('x-tresor-key') || '';
  if (!key || given.length !== key.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key))) return res.status(401).json({ error: 'Not authorised.' });
  next();
});

const val = async (sql, params = [], fallback = null) => {
  try { const { rows } = await query(sql, params); return rows; } catch { return fallback; }
};
const n = async (sql, params) => { const rows = await val(sql, params, [{ n: 0 }]); return rows[0] ? Number(rows[0].n) : 0; };

r.get('/summary', async (req, res) => {
  const counts = {
    operatives: await n('SELECT COUNT(*)::int AS n FROM operatives'),
    live_jobs: await n('SELECT COUNT(*)::int AS n FROM sites WHERE active'),
    on_site_now: await n('SELECT COUNT(*)::int AS n FROM attendance WHERE out_at IS NULL'),
    signins_today: await n("SELECT COUNT(*)::int AS n FROM attendance WHERE in_at >= date_trunc('day', now() AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London'"),
    expired: await n('SELECT COUNT(*)::int AS n FROM operatives WHERE card_expiry < CURRENT_DATE'),
    expiring: await n('SELECT COUNT(*)::int AS n FROM operatives WHERE card_expiry >= CURRENT_DATE AND card_expiry <= CURRENT_DATE + 30'),
    missing: 0,
    open_findings: await n("SELECT COUNT(*)::int AS n FROM findings WHERE status = 'open'"),
    open_talks: await n("SELECT COUNT(*)::int AS n FROM talks WHERE status = 'issued'"),
    unmatched: await n('SELECT COUNT(*)::int AS n FROM talk_signoffs WHERE operative_id IS NULL'),
    last_signoff: (await val('SELECT MAX(signed_at) AS t FROM talk_signoffs', [], [{ t: null }]))[0].t,
    signoffs_30d: await n("SELECT COUNT(*)::int AS n FROM talk_signoffs WHERE signed_at > now() - interval '30 days'"),
    refusals_7d: await n("SELECT COUNT(*)::int AS n FROM refusals WHERE created_at > now() - interval '7 days'"),
  };
  const talks = await val(`SELECT t.ref, t.title, t.issued_at,
      (SELECT COUNT(DISTINCT s.operative_id)::int FROM talk_signoffs s WHERE s.talk_id = t.id AND s.operative_id IS NOT NULL) AS signed,
      (SELECT COUNT(*)::int FROM operatives) AS expected
      FROM talks t WHERE t.status = 'issued' ORDER BY t.issued_at DESC LIMIT 10`, [], []);
  const tickets = (await val(`SELECT name AS full_name, COALESCE(card_type, 'Card') AS type_name, card_expiry::text AS expires_on FROM operatives
      WHERE card_expiry IS NOT NULL AND card_expiry <= CURRENT_DATE + 30 ORDER BY card_expiry LIMIT 25`, [], []));
  const recent = await val(`SELECT s.signed_at, COALESCE(o.name, s.name_given) AS name, t.title AS talk, NULL::text AS doc
      FROM talk_signoffs s LEFT JOIN operatives o ON o.id = s.operative_id LEFT JOIN talks t ON t.id = s.talk_id
      ORDER BY s.signed_at DESC LIMIT 8`, [], []);
  const sites = await val(`SELECT s.ref, s.name, (SELECT COUNT(*)::int FROM attendance a WHERE a.site_id = s.id AND a.out_at IS NULL) AS on_site
      FROM sites s WHERE s.active ORDER BY on_site DESC, s.name LIMIT 15`, [], []);
  res.json({ company: 'GRS Contractors Ltd', short: 'GRS', portal: 'GRS Safety Platform', colour: '#1f3a5f', kind: 'principal', counts, talks, tickets, recent, sites, at: new Date().toISOString() });
});

export default r;
