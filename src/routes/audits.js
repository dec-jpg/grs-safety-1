import { Router } from 'express';
import { wrap } from '../util.js';
import { query, one } from '../db/pool.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

// Record an audit
router.post('/', wrap(async (req, res) => {
  const { site_id, audited_on, auditor, compliance, notes } = req.body || {};
  if (!site_id || !audited_on)
    return res.status(400).json({ error: 'site_id and audited_on required' });

  const audit = await one(`
    INSERT INTO audits (site_id, audited_on, auditor, compliance, notes, created_by)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [site_id, audited_on, auditor ?? null, compliance ?? null, notes ?? null, req.user.id]
  );
  res.status(201).json(audit);
}));

router.get('/', wrap(async (req, res) => {
  const { rows } = await query(`
    SELECT a.*, s.ref AS site_ref, s.name AS site_name
    FROM audits a JOIN sites s ON s.id = a.site_id
    ORDER BY a.audited_on DESC`);
  res.json(rows);
}));

// ---- Dashboard summary: matches the front-end DATA shape ----
router.get('/summary', wrap(async (req, res) => {
  const sites = (await query(`
    SELECT s.id, s.ref, s.name,
      (SELECT COUNT(*) FROM findings f WHERE f.site_id = s.id AND f.status='open') AS open,
      (SELECT to_char(a.audited_on,'DD Mon') FROM audits a WHERE a.site_id=s.id ORDER BY a.audited_on DESC LIMIT 1) AS audited,
      (SELECT a.compliance FROM audits a WHERE a.site_id=s.id ORDER BY a.audited_on DESC LIMIT 1) AS compliance
    FROM sites s WHERE s.active=true ORDER BY s.ref
  `)).rows.map(s => {
    const open = Number(s.open);
    const compliance = s.compliance == null ? null : Number(s.compliance);
    let status = 'ok';
    if (compliance != null && compliance < 90) status = 'bad';
    else if (open >= 3 || (compliance != null && compliance < 95)) status = 'warn';
    return { name: s.name, ref: s.ref, audited: s.audited || '—',
             compliance: compliance ?? 0, open, status };
  });

  const sev = (await query(`
    SELECT severity, COUNT(*) FROM findings WHERE status='open' GROUP BY severity
  `)).rows.reduce((a, r) => (a[r.severity] = Number(r.count), a), { critical:0, major:0, minor:0 });

  const openFindings = sev.critical + sev.major + sev.minor;
  const overdue = Number((await one(`
    SELECT COUNT(*) FROM findings
    WHERE status='open' AND due_date IS NOT NULL AND due_date < CURRENT_DATE`)).count);

  const audited = sites.filter(s => s.audited !== '—').length;
  const avgCompliance = sites.length
    ? Math.round(sites.reduce((a, s) => a + s.compliance, 0) / sites.length) : 0;

  res.json({
    headline: {
      compliance: avgCompliance, complianceTrend: 0,
      sitesAudited: audited, sitesTotal: sites.length,
      openFindings, overdueFindings: overdue, severity: sev
    },
    sites
  });
}));

export default router;
