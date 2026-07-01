import { Router } from 'express';
import { wrap } from '../util.js';
import { query, one } from '../db/pool.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

const SEVERITIES = ['critical', 'major', 'minor'];

// List findings — filter by status (?status=open) and/or site (?site_id=)
router.get('/', wrap(async (req, res) => {
  const { status, site_id } = req.query;
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`f.status = $${params.length}`); }
  if (site_id) { params.push(site_id); where.push(`f.site_id = $${params.length}`); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const { rows } = await query(`
    SELECT f.*, s.ref AS site_ref, s.name AS site_name,
      (f.status = 'open' AND f.due_date IS NOT NULL AND f.due_date < CURRENT_DATE) AS overdue
    FROM findings f
    JOIN sites s ON s.id = f.site_id
    ${clause}
    ORDER BY
      CASE f.severity WHEN 'critical' THEN 0 WHEN 'major' THEN 1 ELSE 2 END,
      f.due_date NULLS LAST, f.created_at DESC
  `, params);
  res.json(rows);
}));

router.post('/', wrap(async (req, res) => {
  const { site_id, severity, title, detail, owner, due_date, audit_id } = req.body || {};
  if (!site_id || !severity || !title)
    return res.status(400).json({ error: 'site_id, severity and title are required' });
  if (!SEVERITIES.includes(severity))
    return res.status(400).json({ error: 'severity must be critical, major or minor' });

  const finding = await one(`
    INSERT INTO findings (site_id, severity, title, detail, owner, due_date, audit_id, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [site_id, severity, title.trim(), detail ?? null, owner ?? null, due_date || null, audit_id ?? null, req.user.id]
  );
  res.status(201).json(finding);
}));

router.patch('/:id', wrap(async (req, res) => {
  const { severity, title, detail, owner, due_date } = req.body || {};
  if (severity && !SEVERITIES.includes(severity))
    return res.status(400).json({ error: 'invalid severity' });

  const finding = await one(`
    UPDATE findings SET
      severity = COALESCE($2, severity),
      title    = COALESCE($3, title),
      detail   = COALESCE($4, detail),
      owner    = COALESCE($5, owner),
      due_date = COALESCE($6, due_date),
      updated_at = now()
    WHERE id = $1 RETURNING *`,
    [req.params.id, severity ?? null, title ?? null, detail ?? null, owner ?? null, due_date ?? null]
  );
  if (!finding) return res.status(404).json({ error: 'Finding not found' });
  res.json(finding);
}));

// Close a finding
router.post('/:id/close', wrap(async (req, res) => {
  const { note } = req.body || {};
  const finding = await one(`
    UPDATE findings SET status = 'closed', closed_on = CURRENT_DATE,
      closed_note = $2, updated_at = now()
    WHERE id = $1 RETURNING *`,
    [req.params.id, note ?? null]
  );
  if (!finding) return res.status(404).json({ error: 'Finding not found' });
  res.json(finding);
}));

// Reopen
router.post('/:id/reopen', wrap(async (req, res) => {
  const finding = await one(`
    UPDATE findings SET status = 'open', closed_on = NULL, closed_note = NULL, updated_at = now()
    WHERE id = $1 RETURNING *`, [req.params.id]);
  if (!finding) return res.status(404).json({ error: 'Finding not found' });
  res.json(finding);
}));

export default router;
