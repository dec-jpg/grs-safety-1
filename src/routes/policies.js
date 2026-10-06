// ============================================================
//  Company policies: the GRS Business Policy Pack.
//  The policy text ships with the build (src/policies/policies.json,
//  produced from Safety Simplified's policy library). GRS's most
//  senior person reads the pack in the portal and signs it once;
//  every signing is kept, and the pack is due for re-signing a year
//  later or whenever Safety Simplified issues a new version.
// ============================================================
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { wrap } from '../util.js';
import { query, one } from '../db/pool.js';
import { requireAuth, requireRole } from '../auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'policies', 'policies.json'), 'utf8'));

// The table is created here (idempotent) so this module needs no change to the boot schema.
let ready = null;
const ensureTable = () => ready || (ready = query(`
  CREATE TABLE IF NOT EXISTS policy_signoffs (
    id SERIAL PRIMARY KEY,
    version INT NOT NULL,
    signed_name TEXT NOT NULL,
    position TEXT NOT NULL,
    signature TEXT NOT NULL,
    signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    review_due DATE NOT NULL,
    user_id INT,
    user_name TEXT)`).catch(e => { ready = null; throw e; }));

const router = Router();
router.use(requireAuth);
router.use(wrap(async (req, res, next) => { await ensureTable(); next(); }));

function statusOf(latest) {
  if (!latest) return 'unsigned';
  if (latest.version < PACK.version) return 'updated';
  if (new Date(latest.review_due) < new Date(new Date().toDateString())) return 'due';
  return 'signed';
}

// The pack and where it stands
router.get('/', wrap(async (req, res) => {
  const latest = await one(`SELECT id, version, signed_name, position, signature, signed_at, to_char(review_due, 'YYYY-MM-DD') AS review_due, user_name
                            FROM policy_signoffs ORDER BY signed_at DESC LIMIT 1`);
  const { rows: history } = await query(`SELECT id, version, signed_name, position, signed_at, to_char(review_due, 'YYYY-MM-DD') AS review_due, user_name
                                         FROM policy_signoffs ORDER BY signed_at DESC LIMIT 20`);
  res.json({ ...PACK, status: statusOf(latest), latest, history });
}));

// Sign every policy in the pack at once (admin or manager; viewers are blocked globally)
router.post('/sign', requireRole('admin', 'manager'), wrap(async (req, res) => {
  const { name, position, signature } = req.body || {};
  const n = String(name || '').trim(), p = String(position || '').trim();
  if (n.length < 3) return res.status(400).json({ error: 'Enter the full name of the person signing' });
  if (!p) return res.status(400).json({ error: 'Enter their position' });
  if (typeof signature !== 'string' || !/^data:image\/png;base64,/.test(signature) || signature.length > 600_000) {
    return res.status(400).json({ error: 'Sign in the box first' });
  }
  const row = await one(`
    INSERT INTO policy_signoffs (version, signed_name, position, signature, review_due, user_id, user_name)
    VALUES ($1, $2, $3, $4, (now() AT TIME ZONE 'Europe/London')::date + INTERVAL '1 year', $5, $6)
    RETURNING id, version, signed_name, position, signature, signed_at, to_char(review_due, 'YYYY-MM-DD') AS review_due, user_name`,
    [PACK.version, n.slice(0, 120), p.slice(0, 80), signature, req.user.id || null, req.user.name || null]);
  res.status(201).json(row);
}));

// An earlier signing, with its signature, so its PDF can be produced again
router.get('/signoffs/:id', wrap(async (req, res) => {
  const row = await one(`SELECT id, version, signed_name, position, signature, signed_at, to_char(review_due, 'YYYY-MM-DD') AS review_due, user_name
                         FROM policy_signoffs WHERE id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
}));

export default router;
