// ============================================================
//  PUBLIC operative sign-in — no login. Secured by:
//  1) per-site unguessable token in the link
//  2) server-side geofence: sign-in REJECTED unless the device
//     is within GEOFENCE_M of the site's saved location
//  3) rate limiting
//  GPS here is a strong deterrent + evidence, not absolute proof.
// ============================================================
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { wrap } from '../util.js';
import { query, one } from '../db/pool.js';

const router = Router();
const GEOFENCE_M = 500;   // max distance from site to allow self sign-in

const limiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
router.use(limiter);

function distM(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v === null || v === undefined)) return null;
  const R = 6371000, toR = d => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
const num = v => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? null : Number(v);

// Record a refused attempt — never blocks the response, never throws
function logRefusal(site, body, reason, dist) {
  const num = v => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? null : Number(v);
  query(`INSERT INTO refusals (site_id, name, company, reason, dist_m, lat, lng, acc, device_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [site?.id ?? null, (body?.name||'').trim().slice(0,120) || null, (body?.company||'').trim().slice(0,120) || null,
     reason, dist ?? null, num(body?.lat), num(body?.lng), num(body?.acc),
     (body?.device_id||'').slice(0,64) || null]).catch(() => {});
}

async function siteByToken(t, k) {
  if (k && typeof k === 'string' && k.length <= 32) {
    const s = await one(`SELECT id, ref, name, lat, lng FROM sites WHERE kiosk_token = $1 AND active = true`, [k]);
    return s ? { ...s, kiosk: true } : null;
  }
  if (!t || typeof t !== 'string' || t.length > 32) return null;
  const s = await one(`SELECT id, ref, name, lat, lng FROM sites WHERE signin_token = $1 AND active = true`, [t]);
  return s ? { ...s, kiosk: false } : null;
}

// Site info for the sign-in page (name shown to the operative)
router.get('/site', wrap(async (req, res) => {
  const site = await siteByToken(req.query.t, req.query.k);
  if (!site) return res.status(404).json({ error: 'Link not recognised' });
  res.json({ ref: site.ref, name: site.name, hasLocation: site.lat != null, kiosk: site.kiosk });
}));

// Self sign-in — geofenced + photo + one open sign-in per device
router.post('/sign-in', wrap(async (req, res) => {
  const { t, k, name, company, role, type, lat, lng, acc, photo, device_id } = req.body || {};
  const site = await siteByToken(t, k);
  if (!site) return res.status(404).json({ error: 'Link not recognised' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Enter your name' });

  if (site.lat == null) {
    logRefusal(site, req.body, 'no_location', null);
    return res.status(409).json({ error: 'This site has no saved location yet — ask the site manager to set it, or sign in at the cabin.' });
  }

  const la = num(lat), ln = num(lng);
  if (la === null || ln === null) {
    logRefusal(site, req.body, 'no_gps', null);
    return res.status(403).json({ error: 'Location is required to sign in with this link. Allow location access and try again.' });
  }

  const d = distM(la, ln, site.lat, site.lng);
  if (d > GEOFENCE_M) {
    logRefusal(site, req.body, 'too_far', d);
    return res.status(403).json({ error: `You appear to be ${d >= 1000 ? (d/1000).toFixed(1)+'km' : d+'m'} from ${site.ref} — sign-in refused. Get to site and try again.` });
  }

  // Photo is required on this route — it's the identity layer
  if (!photo || typeof photo !== 'string' || !photo.startsWith('data:image/')) {
    logRefusal(site, req.body, 'no_photo', d);
    return res.status(400).json({ error: 'A photo is required to sign in' });
  }
  if (photo.length > 160_000)
    return res.status(400).json({ error: 'Photo too large — please retake' });

  // One open sign-in per device per site (stops one phone signing in the crew).
  // Skipped in kiosk mode — the shared tablet signs everyone in; the photo keeps it honest.
  if (!site.kiosk && device_id && typeof device_id === 'string' && device_id.length <= 64) {
    const dev = await one(
      `SELECT name FROM attendance WHERE device_id = $1 AND site_id = $2 AND out_at IS NULL`,
      [device_id, site.id]
    );
    if (dev) {
      logRefusal(site, req.body, 'device_open', d);
      return res.status(409).json({ error: `This phone already has ${dev.name} signed in — everyone signs in on their own phone.` });
    }
  }

  const already = await one(
    `SELECT id FROM attendance WHERE lower(name) = lower($1) AND site_id = $2 AND out_at IS NULL`,
    [name.trim(), site.id]
  );
  if (already) {
    logRefusal(site, req.body, 'already_in', d);
    return res.status(409).json({ error: 'You are already signed in on this site' });
  }

  const kind = ['staff','subbie','visitor'].includes(type) ? type : 'staff';
  const row = await one(`
    INSERT INTO attendance (name, company, role, site_id, type, inducted, in_lat, in_lng, in_acc, photo, device_id)
    VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10)
    RETURNING id, name, in_at`,
    [name.trim(), (company||'').trim() || null, (role||'').trim() || null, site.id, kind, la, ln, num(acc),
     photo, (device_id||'').slice(0,64) || null]
  );
  res.status(201).json({ id: row.id, name: row.name, in_at: row.in_at, site: site.ref, dist_m: d });
}));

// Self sign-out — must match an open record on this site
router.post('/sign-out', wrap(async (req, res) => {
  const { t, k, id, lat, lng } = req.body || {};
  const site = await siteByToken(t, k);
  if (!site) return res.status(404).json({ error: 'Link not recognised' });
  const row = await one(
    `UPDATE attendance SET out_at = now(), out_lat = $3, out_lng = $4
     WHERE id = $1 AND site_id = $2 AND out_at IS NULL
     RETURNING id, out_at`,
    [num(id), site.id, num(lat), num(lng)]
  );
  if (!row) return res.status(404).json({ error: 'No open sign-in found — you may already be signed out' });
  res.json({ ok: true, out_at: row.out_at });
}));

// Kiosk only: who's on site, for tap-to-sign-out at the tablet
router.get('/on-site', wrap(async (req, res) => {
  const site = await siteByToken(null, req.query.k);
  if (!site || !site.kiosk) return res.status(404).json({ error: 'Link not recognised' });
  const { rows } = await query(
    `SELECT id, name, in_at FROM attendance WHERE site_id = $1 AND out_at IS NULL ORDER BY name`,
    [site.id]);
  res.json(rows.map(r => ({ id: r.id, name: r.name, in_at: r.in_at })));
}));

export default router;
