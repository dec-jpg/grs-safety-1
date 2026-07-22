import { Router } from 'express';
import { wrap } from '../util.js';
import { query, one } from '../db/pool.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

const TYPES = ['staff', 'subbie', 'visitor'];
const GEOFENCE_M = 500;   // sign-ins must happen at site — enforced on every route

// Haversine distance in metres between two lat/lng points
function distM(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v === null || v === undefined)) return null;
  const R = 6371000, toR = d => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

const num = v => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? null : Number(v);

function withDistance(rows) {
  return rows.map(r => {
    const { photo, ...rest } = r;   // keep heavy photo data out of list payloads
    return {
      ...rest,
      has_photo: !!photo,
      in_dist_m: distM(r.in_lat, r.in_lng, r.site_lat, r.site_lng)
    };
  });
}

// Who's on site now (optionally filter by ?site_id=)
router.get('/on-site', wrap(async (req, res) => {
  const { site_id } = req.query;
  const params = [];
  let clause = 'WHERE a.out_at IS NULL';
  if (site_id) { params.push(site_id); clause += ` AND a.site_id = $${params.length}`; }
  const { rows } = await query(`
    SELECT a.*, s.ref AS site_ref, s.name AS site_name, s.lat AS site_lat, s.lng AS site_lng
    FROM attendance a JOIN sites s ON s.id = a.site_id
    ${clause}
    ORDER BY a.in_at
  `, params);
  res.json(withDistance(rows));
}));

// Today's log for a site (or all): everyone in/out since midnight
router.get('/today', wrap(async (req, res) => {
  const { site_id } = req.query;
  const params = [];
  let clause = "WHERE a.in_at >= date_trunc('day', now())";
  if (site_id) { params.push(site_id); clause += ` AND a.site_id = $${params.length}`; }
  const { rows } = await query(`
    SELECT a.*, s.ref AS site_ref, s.lat AS site_lat, s.lng AS site_lng
    FROM attendance a JOIN sites s ON s.id = a.site_id
    ${clause}
    ORDER BY COALESCE(a.out_at, a.in_at) DESC
  `, params);
  res.json(withDistance(rows));
}));

// Portal sign-in removed by design: all sign-ins are self-service
// (personal link or kiosk) — geofenced, photographed, no vouching.

// Sign someone out (coords optional)
router.post('/:id/sign-out', wrap(async (req, res) => {
  const { lat, lng } = req.body || {};
  const row = await one(
    `UPDATE attendance SET out_at = now(), out_lat = $2, out_lng = $3
     WHERE id = $1 AND out_at IS NULL RETURNING *`,
    [req.params.id, num(lat), num(lng)]
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

// Weekly log — for billing. ?start=YYYY-MM-DD (any day; snapped to that date),
// 7 days from start. &site_id= optional. &format=csv downloads.
router.get('/week', wrap(async (req, res) => {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(req.query.start || '') ? req.query.start : null;
  if (!start) return res.status(400).json({ error: 'start=YYYY-MM-DD required' });
  const params = [start];
  let clause = `WHERE a.in_at >= $1::date AND a.in_at < ($1::date + INTERVAL '7 days')`;
  if (req.query.site_id) { params.push(req.query.site_id); clause += ` AND a.site_id = $${params.length}`; }
  const { rows } = await query(`
    SELECT a.name, a.company, a.type, a.in_at, a.out_at, s.ref AS site_ref
    FROM attendance a JOIN sites s ON s.id = a.site_id
    ${clause}
    ORDER BY a.name, a.in_at
  `, params);
  const data = rows.map(r => {
    const hours = r.out_at ? Math.round((new Date(r.out_at) - new Date(r.in_at)) / 36000) / 100 : null;
    return { ...r, hours };
  });
  if (req.query.format === 'csv') {
    const escCsv = v => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    const lines = ['Site,Name,Company,Type,Date,In,Out,Hours,Status'];
    for (const r of data) {
      const d = new Date(r.in_at);
      lines.push([r.site_ref, r.name, r.company || '', r.type,
        d.toLocaleDateString('en-GB'),
        d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        r.out_at ? new Date(r.out_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
        r.hours ?? '', r.out_at ? '' : 'NOT SIGNED OUT'
      ].map(escCsv).join(','));
    }
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename="attendance-week-${start}.csv"`);
    return res.send(lines.join('\n'));
  }
  res.json(data);
}));

// Refused attempts — last N days, optional site filter
router.get('/refusals', wrap(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 90);
  const params = [days];
  let clause = `WHERE r.created_at >= now() - ($1 || ' days')::interval`;
  if (req.query.site_id) { params.push(req.query.site_id); clause += ` AND r.site_id = $${params.length}`; }
  const { rows } = await query(`
    SELECT r.*, s.ref AS site_ref
    FROM refusals r LEFT JOIN sites s ON s.id = r.site_id
    ${clause}
    ORDER BY r.created_at DESC
    LIMIT 200
  `, params);
  res.json(rows);
}));

// Sign-in photo for a record (auth-gated; <img> tags send the session cookie)
router.get('/:id/photo', wrap(async (req, res) => {
  const row = await one(`SELECT photo FROM attendance WHERE id = $1`, [req.params.id]);
  if (!row || !row.photo) return res.status(404).json({ error: 'No photo' });
  const m = row.photo.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!m) return res.status(404).json({ error: 'No photo' });
  res.set('Content-Type', m[1]);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(m[2], 'base64'));
}));

// Set a site's coordinates (so distance checks work)
router.post('/site-location', wrap(async (req, res) => {
  const { site_id, lat, lng } = req.body || {};
  if (!site_id || num(lat) === null || num(lng) === null)
    return res.status(400).json({ error: 'site_id, lat and lng are required' });
  const row = await one(
    `UPDATE sites SET lat = $2, lng = $3 WHERE id = $1 RETURNING id, ref, lat, lng`,
    [site_id, num(lat), num(lng)]
  );
  if (!row) return res.status(404).json({ error: 'Site not found' });
  res.json(row);
}));

export default router;
