import { Router } from 'express';
import { wrap } from '../util.js';
import { query, one } from '../db/pool.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

// The workforce record — one row per person, with induction state
router.get('/', wrap(async (req, res) => {
  const { rows } = await query(`
    SELECT o.*,
      (SELECT COUNT(*) FROM site_inductions si WHERE si.operative_id = o.id) AS sites_inducted,
      (SELECT MAX(a.in_at) FROM attendance a WHERE a.operative_id = o.id)    AS last_seen
    FROM operatives o
    ORDER BY o.name
  `);
  res.json(rows);
}));

router.post('/', wrap(async (req, res) => {
  const { name, company, role, card_type, card_no, card_expiry } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const row = await one(`
    INSERT INTO operatives (name, company, role, card_type, card_no, card_expiry)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name.trim(), company||null, role||null, card_type||null, card_no||null, card_expiry||null]);
  res.status(201).json(row);
}));

router.patch('/:id', wrap(async (req, res) => {
  const { name, company, role, card_type, card_no, card_expiry } = req.body || {};
  const row = await one(`
    UPDATE operatives SET
      name = COALESCE($2, name), company = COALESCE($3, company), role = COALESCE($4, role),
      card_type = COALESCE($5, card_type), card_no = COALESCE($6, card_no), card_expiry = COALESCE($7, card_expiry)
    WHERE id = $1 RETURNING *`,
    [req.params.id, name??null, company??null, role??null, card_type??null, card_no??null, card_expiry??null]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
}));

// Per-operative site induction list (for the record view)
router.get('/:id/inductions', wrap(async (req, res) => {
  const { rows } = await query(`
    SELECT si.signed_name, si.signed_at, s.ref AS site_ref, s.name AS site_name
    FROM site_inductions si JOIN sites s ON s.id = si.site_id
    WHERE si.operative_id = $1 ORDER BY si.signed_at DESC`, [req.params.id]);
  res.json(rows);
}));

// Company induction content (settings)
router.get('/settings/company-induction', wrap(async (req, res) => {
  const row = await one(`SELECT value FROM settings WHERE key='company_induction'`);
  res.json({ value: row ? row.value : '' });
}));
router.put('/settings/company-induction', wrap(async (req, res) => {
  const { value } = req.body || {};
  await query(`INSERT INTO settings (key, value) VALUES ('company_induction', $1)
               ON CONFLICT (key) DO UPDATE SET value = $1`, [value || '']);
  res.json({ ok: true });
}));

export default router;
