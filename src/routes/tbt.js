// ============================================================
//  Toolbox talks.
//  The talk library ships with the build (src/talks/library.json,
//  produced from Safety Simplified's talk content). The office
//  issues a talk from the portal; each issue gets its own
//  unguessable link and register. Operatives open the link on
//  WhatsApp with no login, read the talk on one page, answer the
//  questions where a talk has them, and sign. Every sign-off is
//  stored here in the portal, matched to the People register
//  where the name and mobile line up, and linkable by the office
//  where they do not.
//  Tables are created here (idempotent), policies.js-style, so
//  this module needs no change to the boot schema.
// ============================================================
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { wrap } from '../util.js';
import { query, one } from '../db/pool.js';
import { requireAuth, requireRole } from '../auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'talks', 'library.json'), 'utf8'));

const token = (n = 9) => crypto.randomBytes(n).toString('base64url');
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const normPhone = v => String(v || '').replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^44(?=7)/, '0');
const surname = n => String(n || '').trim().split(/\s+/).pop().toLowerCase();
const validImage = (s, max) => typeof s === 'string' && s.startsWith('data:image/') && s.length <= max;

// ---------- tables + library seed (idempotent, first use) ----------
let ready = null;
const ensure = () => ready || (ready = (async () => {
  await query(`CREATE TABLE IF NOT EXISTS talks (
    id SERIAL PRIMARY KEY,
    ref TEXT,
    title TEXT NOT NULL,
    intro TEXT,
    category TEXT,
    sections JSONB NOT NULL DEFAULT '[]',
    questions JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    token TEXT NOT NULL UNIQUE,
    source_id INTEGER,
    issued_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await query(`CREATE TABLE IF NOT EXISTS talk_signoffs (
    id SERIAL PRIMARY KEY,
    talk_id INTEGER NOT NULL REFERENCES talks(id) ON DELETE CASCADE,
    operative_id INTEGER REFERENCES operatives(id) ON DELETE SET NULL,
    name_given TEXT NOT NULL,
    phone_given TEXT,
    signature TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 1,
    signed_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await query(`CREATE INDEX IF NOT EXISTS talk_signoffs_talk_idx ON talk_signoffs (talk_id)`);
  // Mobile number on the People register: filled in as the office links
  // signatures, so matching gets better the more the system is used.
  await query(`ALTER TABLE operatives ADD COLUMN IF NOT EXISTS phone TEXT`);

  // Library talks in the build are added on boot if not already there
  // (matched on title), so new talks arrive with a redeploy.
  for (const t of LIBRARY.talks || []) {
    let lib = await one(`SELECT id FROM talks WHERE status = 'library' AND LOWER(title) = LOWER($1)`, [t.title]);
    if (!lib) {
      lib = await one(`INSERT INTO talks (ref, title, intro, category, sections, questions, status, token, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,'library',$7,'Safety Simplified') RETURNING id`,
        [t.ref || null, t.title, t.intro || null, t.category || null,
         JSON.stringify(t.sections || []), JSON.stringify(t.questions || []), token()]);
    }
    // A library entry can carry a fixed issue token: it is issued once,
    // automatically, so its link is live the moment the deploy lands.
    if (t.issue_token && !(await one(`SELECT id FROM talks WHERE token = $1`, [t.issue_token]))) {
      await query(`INSERT INTO talks (ref, title, intro, category, sections, questions, status, token, issued_at, created_by, source_id)
          VALUES ($1,$2,$3,$4,$5,$6,'issued',$7,now(),'Safety Simplified',$8)`,
        [t.ref || null, t.title, t.intro || null, t.category || null,
         JSON.stringify(t.sections || []), JSON.stringify(t.questions || []), t.issue_token, lib.id]);
    }
  }
  console.log('[tbt] toolbox talks ready: tables verified, library seeded');
})().catch(e => { ready = null; throw e; }));

// Match a signature to the People register: mobile number plus surname,
// never name alone (the register spells names too many ways to trust it).
async function findOperative(name, phone) {
  const p = normPhone(phone);
  if (p.length < 10 || !name) return null;
  const { rows } = await query(`SELECT * FROM operatives WHERE phone = $1 AND status = 'active'`, [p]);
  return rows.find(o => surname(o.name) === surname(name)) || null;
}

async function alreadySigned(talkId, op, name, phone) {
  if (op) return !!(await one(`SELECT 1 FROM talk_signoffs WHERE talk_id = $1 AND operative_id = $2`, [talkId, op.id]));
  if (!name) return false;
  return !!(await one(`SELECT 1 FROM talk_signoffs WHERE talk_id = $1 AND LOWER(name_given) = LOWER($2) AND COALESCE(phone_given,'') = $3`,
    [talkId, name, phone || '']));
}

// ============================================================
//  Public API, used by the talk page opened from a WhatsApp
//  link. No login. Mounted at /api/tbt/p.
// ============================================================
export const tbtPublicRouter = Router();
tbtPublicRouter.use(wrap(async (req, res, next) => { await ensure(); next(); }));

const talkByToken = t => one(`SELECT * FROM talks WHERE token = $1 AND status IN ('issued','closed')`, [t]);

tbtPublicRouter.get('/:token', wrap(async (req, res) => {
  const t = await talkByToken(req.params.token);
  if (!t) return res.status(404).json({ error: 'This toolbox talk link is not active. Check with your supervisor for the current link.' });
  res.json({ talk: {
    ref: t.ref, title: t.title, intro: t.intro, category: t.category,
    sections: t.sections,
    questions: (t.questions || []).map(x => ({ question: x.question, options: x.options })),
    closed: t.status === 'closed'
  } });
}));

// Answers are checked before signing, and again when signing.
tbtPublicRouter.post('/:token/check', wrap(async (req, res) => {
  const t = await talkByToken(req.params.token);
  if (!t) return res.status(404).json({ error: 'This toolbox talk link is not active.' });
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  res.json({ wrong: (t.questions || []).map((x, i) => (Number(answers[i]) === Number(x.answer) ? null : i)).filter(i => i !== null) });
}));

tbtPublicRouter.post('/:token/sign', wrap(async (req, res) => {
  const t = await talkByToken(req.params.token);
  if (!t) return res.status(404).json({ error: 'This toolbox talk link is not active.' });
  if (t.status === 'closed') return res.status(400).json({ error: 'This talk has been closed. Ask the office if you still need to sign it.' });
  const b = req.body || {};
  const name = clean(b.name, 120);
  const phone = normPhone(b.phone);
  if (!name || name.split(/\s+/).length < 2) return res.status(400).json({ error: 'Enter your first name and surname.' });
  if (phone.length < 10) return res.status(400).json({ error: 'Enter your mobile number.' });
  const answers = Array.isArray(b.answers) ? b.answers : [];
  const wrong = (t.questions || []).map((x, i) => (Number(answers[i]) === Number(x.answer) ? null : i)).filter(i => i !== null);
  if (wrong.length) return res.json({ ok: false, wrong });
  if (!validImage(b.signature, 400_000)) return res.status(400).json({ error: 'Sign in the box to confirm.' });
  const op = await findOperative(name, phone);
  if (await alreadySigned(t.id, op, name, phone)) return res.json({ ok: true, already: true });
  await query(`INSERT INTO talk_signoffs (talk_id, operative_id, name_given, phone_given, signature, attempts)
      VALUES ($1,$2,$3,$4,$5,$6)`,
    [t.id, op ? op.id : null, op ? op.name : name, phone || (op && op.phone) || null,
     b.signature, Math.max(1, parseInt(b.attempts, 10) || 1)]);
  res.json({ ok: true });
}));

// ============================================================
//  Portal API (login required). Mounted at /api/tbt.
// ============================================================
export const tbtRouter = Router();
tbtRouter.use(requireAuth);
tbtRouter.use(wrap(async (req, res, next) => { await ensure(); next(); }));

const edit = requireRole('admin', 'manager');

// Everything the view needs in one call: issued talks with counts, and the library.
tbtRouter.get('/', wrap(async (req, res) => {
  const { rows: talks } = await query(`SELECT t.id, t.ref, t.title, t.category, t.status, t.issued_at, t.token,
      (SELECT COUNT(*)::int FROM talk_signoffs s WHERE s.talk_id = t.id) AS signatures,
      (SELECT COUNT(*)::int FROM talk_signoffs s WHERE s.talk_id = t.id AND s.operative_id IS NOT NULL) AS matched
      FROM talks t WHERE t.status IN ('issued','closed')
      ORDER BY CASE t.status WHEN 'issued' THEN 0 ELSE 1 END, t.issued_at DESC NULLS LAST`);
  const { rows: library } = await query(`SELECT t.id, t.ref, t.title, t.category,
      jsonb_array_length(t.sections) AS parts, jsonb_array_length(t.questions) AS questions,
      (SELECT MAX(i.issued_at) FROM talks i WHERE i.source_id = t.id) AS last_issued,
      (SELECT COUNT(*)::int FROM talks i WHERE i.source_id = t.id) AS times_issued
      FROM talks t WHERE t.status = 'library' ORDER BY t.ref NULLS LAST, t.title`);
  res.json({ talks, library });
}));

// Issue a library talk: a fresh copy with its own link and register.
tbtRouter.post('/library/:id/issue', edit, wrap(async (req, res) => {
  const src = await one(`SELECT * FROM talks WHERE id = $1 AND status = 'library'`, [req.params.id]);
  if (!src) return res.status(404).json({ error: 'Not found' });
  if (!src.sections.length) return res.status(400).json({ error: 'This talk has no content yet.' });
  const row = await one(`INSERT INTO talks (ref, title, intro, category, sections, questions, status, token, issued_at, created_by, source_id)
      VALUES ($1,$2,$3,$4,$5,$6,'issued',$7,now(),$8,$9) RETURNING id, token`,
    [src.ref, src.title, src.intro, src.category, JSON.stringify(src.sections), JSON.stringify(src.questions),
     token(), req.user.name || 'Portal', src.id]);
  res.json({ id: row.id, token: row.token });
}));

// One talk with its register and who is still outstanding.
tbtRouter.get('/talks/:id', wrap(async (req, res) => {
  const talk = await one(`SELECT * FROM talks WHERE id = $1 AND status <> 'library'`, [req.params.id]);
  if (!talk) return res.status(404).json({ error: 'Not found' });
  talk.url = `${req.protocol}://${req.get('host')}/t/${talk.token}`;
  const { rows: signoffs } = await query(`SELECT s.id, s.operative_id, s.name_given, s.phone_given, s.attempts, s.signed_at,
      o.name AS op_name, o.company AS op_company
      FROM talk_signoffs s LEFT JOIN operatives o ON o.id = s.operative_id
      WHERE s.talk_id = $1 ORDER BY s.signed_at`, [talk.id]);
  const { rows: outstanding } = await query(`SELECT o.id, o.name, o.company FROM operatives o
      WHERE o.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM talk_signoffs s WHERE s.talk_id = $1 AND s.operative_id = o.id)
      ORDER BY o.name`, [talk.id]);
  res.json({ talk, signoffs, outstanding });
}));

// Close a talk (no more signatures) or reopen it.
tbtRouter.post('/talks/:id/close', edit, wrap(async (req, res) => {
  await query(`UPDATE talks SET status = CASE WHEN status = 'closed' THEN 'issued' ELSE 'closed' END
      WHERE id = $1 AND status IN ('issued','closed')`, [req.params.id]);
  res.json({ ok: true });
}));

// A signature image, served for the register.
tbtRouter.get('/signoffs/:id/signature', wrap(async (req, res) => {
  const row = await one(`SELECT signature FROM talk_signoffs WHERE id = $1`, [req.params.id]);
  const m = row && row.signature && row.signature.match(/^data:(image\/\w+);base64,(.*)$/);
  if (!m) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type(m[1]).send(Buffer.from(m[2], 'base64'));
}));

// Link an unmatched signature (and any others with the same name and
// number) to someone on the People register. Teaches the register
// their mobile number at the same time.
tbtRouter.post('/signoffs/:id/link', edit, wrap(async (req, res) => {
  const s = await one(`SELECT * FROM talk_signoffs WHERE id = $1`, [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const opId = parseInt((req.body || {}).operative_id, 10);
  if (!opId) return res.status(400).json({ error: 'Choose who this is.' });
  const n = await query(`UPDATE talk_signoffs SET operative_id = $1 WHERE operative_id IS NULL
      AND LOWER(name_given) = LOWER($2) AND COALESCE(phone_given,'') = COALESCE($3,'')`,
    [opId, s.name_given, s.phone_given]);
  if (s.phone_given) await query(`UPDATE operatives SET phone = COALESCE(phone, $1) WHERE id = $2`, [s.phone_given, opId]);
  res.json({ ok: true, linked: n.rowCount });
}));

// Remove a sign-off (test rows, duplicates).
tbtRouter.delete('/signoffs/:id', edit, wrap(async (req, res) => {
  await query(`DELETE FROM talk_signoffs WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));
