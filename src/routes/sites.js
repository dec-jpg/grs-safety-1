import { Router } from 'express';
import { wrap } from '../util.js';
import { query, one } from '../db/pool.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

// List sites with live open-finding counts and latest audit
router.get('/', wrap(async (req, res) => {
  const { rows } = await query(`
    SELECT s.id, s.ref, s.name, s.active, s.lat, s.lng, s.signin_token, s.kiosk_token,
      (SELECT COUNT(*) FROM findings f WHERE f.site_id = s.id AND f.status = 'open') AS open_findings,
      (SELECT a.audited_on FROM audits a WHERE a.site_id = s.id ORDER BY a.audited_on DESC LIMIT 1) AS last_audited,
      (SELECT a.compliance FROM audits a WHERE a.site_id = s.id ORDER BY a.audited_on DESC LIMIT 1) AS compliance
    FROM sites s
    WHERE s.active = true
    ORDER BY s.ref
  `);
  res.json(rows);
}));

router.post('/', wrap(async (req, res) => {
  const { ref, name } = req.body || {};
  if (!ref || !name) return res.status(400).json({ error: 'ref and name required' });
  try {
    const site = await one(
      'INSERT INTO sites (ref, name) VALUES ($1, $2) RETURNING *',
      [ref.trim(), name.trim()]
    );
    res.status(201).json(site);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Site ref already exists' });
    throw e;
  }
}));

router.patch('/:id', wrap(async (req, res) => {
  const { name, active } = req.body || {};
  const site = await one(
    `UPDATE sites SET
       name = COALESCE($2, name),
       active = COALESCE($3, active)
     WHERE id = $1 RETURNING *`,
    [req.params.id, name ?? null, active ?? null]
  );
  if (!site) return res.status(404).json({ error: 'Site not found' });
  res.json(site);
}));

export default router;
