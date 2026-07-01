import { Router } from 'express';
import { wrap } from '../util.js';
import { query, one } from '../db/pool.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

const TYPES = ['staff', 'subbie', 'visitor'];

// Who's on site now (optionally filter by ?site_id=)
router.get('/on-site', wrap(async (req, res) => {
  const { site_id } = req.query;
  const params = [];
  let clause = 'WHERE a.out_at IS NULL';
  if (site_id) { params.push(site_id); clause += ` AND a.site_id = $${params.length}`; }
  const { rows } = await query(`
    SELECT a.*, s.ref AS site_ref, s.name AS site_name
    FROM attendance a JOIN sites s ON s.id = a.site_id
    ${clause}
    ORDER BY a.in_at
  `, params);
  res.json(rows);
}));

// Today's log for a site (or all): everyone in/out since midnight
router.get('/today', wrap(async (req, res) => {
  const { site_id } = req.query;
  const params = [];
  let clause = "WHERE a.in_at >= date_trunc('day', now())";
  if (site_id) { params.push(site_id); clause += ` AND a.site_id = $${params.length}`; }
  const { rows } = await query(`
    SELECT a.*, s.ref AS site_ref
    FROM attendance a JOIN sites s ON s.id = a.site_id
    ${clause}
    ORDER BY COALESCE(a.out_at, a.in_at) DESC
  `, params);
  res.json(rows);
}));

// Sign someone in
router.post('/sign-in', wrap(async (req, res) => {
  const { name, company, role, site_id, type, inducted, operative_id } = req.body || {};
  if (!name || !site_id) return res.status(400).json({ error: 'name and site_id are required' });
  const t = TYPES.includes(type) ? type : 'staff';

  // guard: don't double sign-in the same person on the same site
  const already = await one(
    `SELECT id FROM attendance WHERE name = $1 AND site_id = $2 AND out_at IS NULL`,
    [name.trim(), site_id]
  );
  if (already) return res.status(409).json({ error: 'Already signed in on this site' });

  const row = await one(`
    INSERT INTO attendance (operative_id, name, company, role, site_id, type, inducted, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [operative_id ?? null, name.trim(), company ?? null, role ?? null, site_id, t,
     inducted === false ? false : true, req.user.id]
  );
  res.status(201).json(row);
}));

// Sign someone out
router.post('/:id/sign-out', wrap(async (req, res) => {
  const row = await one(
    `UPDATE attendance SET out_at = now() WHERE id = $1 AND out_at IS NULL RETURNING *`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found or already signed out' });
  res.json(row);
}));

// Small summary for headline tiles
router.get('/summary', wrap(async (req, res) => {
  const { site_id } = req.query;
  const params = [];
  let clause = 'WHERE out_at IS NULL';
  if (site_id) { params.push(site_id); clause += ` AND site_id = $${params.length}`; }
  const s = await one(`
    SELECT
      COUNT(*)                                   AS on_site,
      COUNT(*) FILTER (WHERE type = 'staff')     AS staff,
      COUNT(*) FILTER (WHERE type <> 'staff')    AS others,
      COUNT(*) FILTER (WHERE inducted = false)   AS not_inducted
    FROM attendance ${clause}`, params);
  res.json({
    on_site: Number(s.on_site), staff: Number(s.staff),
    others: Number(s.others), not_inducted: Number(s.not_inducted)
  });
}));

export default router;
