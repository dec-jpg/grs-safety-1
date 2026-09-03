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

async function findOperative(name){
  if(!name) return null;
  return one(`SELECT * FROM operatives WHERE lower(name) = lower($1) ORDER BY id LIMIT 1`, [name.trim()]);
}
async function findOrCreateOperative(name, company, role){
  let op = await findOperative(name);
  if(!op) op = await one(
    `INSERT INTO operatives (name, company, role) VALUES ($1,$2,$3) RETURNING *`,
    [name.trim(), (company||'').trim() || null, (role||'').trim() || null]);
  return op;
}
async function inductionState(site, name){
  const companyContent = (await one(`SELECT value FROM settings WHERE key='company_induction'`))?.value || null;
  const siteContent = site.site_induction || null;
  const op = await findOperative(name);
  const companyDone = !companyContent || !!(op && op.company_inducted_at);
  const siteDone = !siteContent || !!(op && await one(
    `SELECT id FROM site_inductions WHERE operative_id = $1 AND site_id = $2`, [op ? op.id : -1, site.id]));
  return { op, companyContent, siteContent, companyDone, siteDone };
}

// Induction content: JSON {sections:[{h,body}], questions:[{q,options,correct}]}
// or legacy plain text (one section, no questions).
function parseInduction(raw){
  if(!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (j && (Array.isArray(j.sections) || Array.isArray(j.questions)))
      return { sections: j.sections || [], questions: j.questions || [] };
  } catch {}
  return { sections: [{ h: '', body: raw }], questions: [] };
}

// Record an induction — sections read, questions answered (verified here), signed
router.post('/induct', wrap(async (req, res) => {
  const { t, k, name, company, role, which, signed_name, answers, nok_name, nok_phone } = req.body || {};
  const site = await siteByToken(t, k);
  if (!site) return res.status(404).json({ error: 'Link not recognised' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  if (!signed_name || signed_name.trim().length < 3)
    return res.status(400).json({ error: 'Type your full name to sign' });

  // Server-side comprehension check — the quiz can't be skipped by calling the API directly
  const raw = which === 'company'
    ? (await one(`SELECT value FROM settings WHERE key='company_induction'`))?.value
    : site.site_induction;
  const content = parseInduction(raw);
  if (content && content.questions.length) {
    const a = Array.isArray(answers) ? answers : [];
    const allRight = content.questions.every((q, i) => Number(a[i]) === Number(q.correct));
    if (!allRight) return res.status(400).json({ error: 'One or more answers are wrong — read the induction again' });
  }

  const op = await findOrCreateOperative(name, company, role);
  if (which === 'company') {
    await query(`UPDATE operatives SET company_inducted_at = now(), company_induction_sig = $2,
                 company = COALESCE(company, $3),
                 next_of_kin = COALESCE($4, next_of_kin), nok_phone = COALESCE($5, nok_phone)
                 WHERE id = $1`,
      [op.id, signed_name.trim(), (company||'').trim() || null,
       (nok_name||'').trim() || null, (nok_phone||'').trim() || null]);
  } else if (which === 'site') {
    await query(`INSERT INTO site_inductions (operative_id, site_id, signed_name)
                 VALUES ($1,$2,$3) ON CONFLICT (operative_id, site_id) DO NOTHING`,
      [op.id, site.id, signed_name.trim()]);
  } else return res.status(400).json({ error: 'Unknown induction type' });
  res.json({ ok: true });
}));

// Site info for the sign-in page (name shown to the operative)
router.get('/site', wrap(async (req, res) => {
  const site = await siteByToken(req.query.t, req.query.k);
  if (!site) return res.status(404).json({ error: 'Link not recognised' });
  res.json({ ref: site.ref, name: site.name, hasLocation: site.lat != null, kiosk: site.kiosk });
}));

// Self sign-in — geofenced + photo + one open sign-in per device

// -- Sign-in email notification (launch feature) ----------------
// Fires a POST to the GRS mailer Apps Script. Fire-and-forget:
// if MAILER_URL isn't set or the call fails, sign-in is unaffected.
function notifySignIn(site, row, dist) {
  const url = process.env.MAILER_URL;
  if (!url) return;
  const when = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      secret: process.env.MAILER_SECRET || '',
      subject: `GRS sign-in: ${row.name} at ${site.ref}`,
      body: `${row.name} has signed in.\n\n` +
            `  Site:     ${site.ref} — ${site.name}\n` +
            `  Company:  ${row.company || '-'}\n` +
            `  Time:     ${when}\n` +
            `  Distance: ${dist == null ? '-' : dist + 'm from datum'}\n\n` +
            `GRS Safety — sign-in system`
    })
  }).catch(() => {});
}

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

  // Induction gate: no valid induction, no sign-in. The page walks them
  // through read -> confirm -> sign, then retries automatically.
  const ind = await inductionState(site, name);
  if (!ind.companyDone || !ind.siteDone) {
    logRefusal(site, req.body, 'not_inducted', d);
    return res.status(409).json({
      error: 'Induction required before sign-in',
      induction_required: {
        company: !ind.companyDone, site: !ind.siteDone,
        company_content: !ind.companyDone ? parseInduction(ind.companyContent) : null,
        site_content: !ind.siteDone ? parseInduction(ind.siteContent) : null,
        site_name: site.name,
        ask_nok: !ind.companyDone
      }
    });
  }

  const kind = ['staff','subbie','visitor'].includes(type) ? type : 'staff';
  const op = await findOrCreateOperative(name, company, role);
  const row = await one(`
    INSERT INTO attendance (operative_id, name, company, role, site_id, type, inducted, in_lat, in_lng, in_acc, photo, device_id)
    VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11)
    RETURNING id, name, in_at`,
    [op.id, name.trim(), (company||'').trim() || null, (role||'').trim() || null, site.id, kind, la, ln, num(acc),
     photo, (device_id||'').slice(0,64) || null]
  );
  notifySignIn(site, { ...row, company: (company||'').trim() || null }, d);
  res.status(201).json({ id: row.id, name: row.name, in_at: row.in_at, site: site.ref, dist_m: d });
}));

// Self sign-out — must match an open record on this site
router.post('/sign-out', wrap(async (req, res) => {
  const { t, k, id, lat, lng, photo } = req.body || {};
  const site = await siteByToken(t, k);
  if (!site) return res.status(404).json({ error: 'Link not recognised' });

  // Photo is required on sign-out too — proof of presence at the end of the day
  if (!photo || typeof photo !== 'string' || !photo.startsWith('data:image/'))
    return res.status(400).json({ error: 'A photo is required to sign out — it proves you were on site' });
  if (photo.length > 160_000)
    return res.status(400).json({ error: 'Photo too large — please retake' });

  const la = num(lat), ln = num(lng);
  const od = (site.lat != null && la !== null && ln !== null) ? distM(la, ln, site.lat, site.lng) : null;
  const row = await one(
    `UPDATE attendance SET out_at = now(), out_lat = $3, out_lng = $4, out_dist_m = $5, out_photo = $6
     WHERE id = $1 AND site_id = $2 AND out_at IS NULL
     RETURNING id, out_at, out_dist_m`,
    [num(id), site.id, la, ln, od, photo]
  );
  if (!row) return res.status(404).json({ error: 'No open sign-in found — you may already be signed out' });
  res.json({ ok: true, out_at: row.out_at, out_dist_m: row.out_dist_m });
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

// ---------- Toolbox talks by link (no login) ----------
router.get('/talk', wrap(async (req, res) => {
  const talk = await one(`SELECT id, title, content FROM tbt_talks WHERE token = $1 AND active = true`,
    [String(req.query.tt || '')]);
  if (!talk) return res.status(404).json({ error: 'Talk link not recognised' });
  res.json({ id: talk.id, title: talk.title, content: parseInduction(talk.content) });
}));

router.post('/talk-sign', wrap(async (req, res) => {
  const { tt, name, company, signed_name, answers } = req.body || {};
  const talk = await one(`SELECT id, title, content FROM tbt_talks WHERE token = $1 AND active = true`,
    [String(tt || '')]);
  if (!talk) return res.status(404).json({ error: 'Talk link not recognised' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  if (!signed_name || signed_name.trim().length < 3)
    return res.status(400).json({ error: 'Type your full name to sign' });
  const content = parseInduction(talk.content);
  if (content && content.questions.length) {
    const a = Array.isArray(answers) ? answers : [];
    const allRight = content.questions.every((q, i) => Number(a[i]) === Number(q.correct));
    if (!allRight) return res.status(400).json({ error: 'One or more answers are wrong — read the talk again' });
  }
  await query(`
    INSERT INTO tbt_signatures (talk_id, name, company, signed_name)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (talk_id, lower(name)) DO UPDATE SET signed_name = EXCLUDED.signed_name, signed_at = now()`,
    [talk.id, name.trim(), (company||'').trim() || null, signed_name.trim()]);
  res.json({ ok: true, title: talk.title });
}));

export default router;
