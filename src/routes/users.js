// ============================================================
//  Portal users and invites.
//
//  /api/users      admin only: list, add (issues an invite), re-invite,
//                  change role, deactivate / reactivate
//  /api/invite     public: read an invite, accept it by setting a password
//
//  An invite is a one-shot token on the users row. Adding a user creates
//  the row with no password and a token; the admin gets the link back on
//  screen (and it is emailed too when the mailer is configured). Opening
//  the link and setting a password clears the token and logs them in.
// ============================================================
import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { wrap } from '../util.js';
import { query, one } from '../db/pool.js';
import { requireAuth, requireRole, signToken, setAuthCookie } from '../auth.js';
import { sendMail, mailConfigured } from '../mailer.js';

export const ROLES = ['admin', 'manager', 'viewer'];
const INVITE_HOURS = 72;
const MIN_PASSWORD = 8;

const PUBLIC_COLS = 'id, email, name, role, active, last_login, created_at, invite_expires, (password_hash IS NOT NULL) AS has_password';

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  return `${proto}://${req.get('host')}`;
}

async function issueInvite(req, user) {
  const token = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + INVITE_HOURS * 3600 * 1000);
  await query('UPDATE users SET invite_token = $1, invite_expires = $2 WHERE id = $3', [token, expires, user.id]);
  const link = `${baseUrl(req)}/invite.html?t=${token}`;

  let emailed = false;
  if (mailConfigured()) {
    const r = await sendMail({
      to: user.email,
      subject: 'Your GRS Safety portal login',
      text: `Hi ${user.name},\n\nYou have been given access to the GRS Safety portal. Set your password here:\n\n${link}\n\nThe link works for ${INVITE_HOURS} hours. If it has run out, ask ${req.user.name} to send a new one.\n\nGRS Safety, run by Safety Simplified Ltd`
    }).catch(e => ({ ok: false, error: e.message }));
    emailed = !!r.ok;
  }
  return { link, expires, emailed };
}

// ------------------------------------------------------------ admin API
const users = Router();
users.use(requireAuth, requireRole('admin'));

users.get('/', wrap(async (req, res) => {
  const { rows } = await query(`SELECT ${PUBLIC_COLS} FROM users ORDER BY active DESC, name`);
  res.json(rows);
}));

users.post('/', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = String(req.body?.role || 'manager').trim();
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'That email does not look right' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Role must be admin, manager or viewer' });

  const existing = await one('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) return res.status(409).json({ error: 'There is already a user with that email. Use Re-invite instead.' });

  const user = await one(
    `INSERT INTO users (email, name, role, active, created_by) VALUES ($1, $2, $3, true, $4) RETURNING ${PUBLIC_COLS}`,
    [email, name, role, req.user.id]
  );
  const invite = await issueInvite(req, user);
  res.status(201).json({ user, ...invite });
}));

users.post('/:id/invite', wrap(async (req, res) => {
  const user = await one(`SELECT ${PUBLIC_COLS} FROM users WHERE id = $1`, [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.active) return res.status(400).json({ error: 'Reactivate the user before re-inviting' });
  const invite = await issueInvite(req, user);
  res.json({ user, ...invite });
}));

users.patch('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const user = await one('SELECT id, role, active FROM users WHERE id = $1', [id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const patch = {};
  if (req.body?.role !== undefined) {
    if (!ROLES.includes(req.body.role)) return res.status(400).json({ error: 'Role must be admin, manager or viewer' });
    patch.role = req.body.role;
  }
  if (req.body?.active !== undefined) patch.active = !!req.body.active;
  if (req.body?.name !== undefined) {
    const n = String(req.body.name).trim();
    if (!n) return res.status(400).json({ error: 'Name cannot be blank' });
    patch.name = n;
  }

  // Never let the last active admin lock everyone out
  if (id === req.user.id && (patch.role && patch.role !== 'admin' || patch.active === false)) {
    return res.status(400).json({ error: 'You cannot remove your own admin access. Ask another admin to do it.' });
  }
  if ((patch.role && patch.role !== 'admin') || patch.active === false) {
    const { rows } = await query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> $1`, [id]);
    if (user.role === 'admin' && rows[0].n === 0) return res.status(400).json({ error: 'That is the only active admin. Make someone else admin first.' });
  }

  const keys = Object.keys(patch);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to change' });
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const updated = await one(`UPDATE users SET ${sets} WHERE id = $1 RETURNING ${PUBLIC_COLS}`, [id, ...keys.map(k => patch[k])]);
  res.json(updated);
}));

// ------------------------------------------------------------ public invite API
const invite = Router();
const inviteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' } });

async function findByToken(token) {
  if (!token || token.length < 20) return null;
  const u = await one('SELECT id, email, name, role, active, invite_expires FROM users WHERE invite_token = $1', [token]);
  if (!u || !u.active) return null;
  if (!u.invite_expires || new Date(u.invite_expires) < new Date()) return { expired: true, ...u };
  return u;
}

invite.get('/:token', inviteLimiter, wrap(async (req, res) => {
  const u = await findByToken(req.params.token);
  if (!u) return res.status(404).json({ error: 'This invite link is not valid. Ask for a new one.' });
  if (u.expired) return res.status(410).json({ error: 'This invite link has run out. Ask for a new one.' });
  res.json({ name: u.name, email: u.email });
}));

invite.post('/:token', inviteLimiter, wrap(async (req, res) => {
  const u = await findByToken(req.params.token);
  if (!u) return res.status(404).json({ error: 'This invite link is not valid. Ask for a new one.' });
  if (u.expired) return res.status(410).json({ error: 'This invite link has run out. Ask for a new one.' });

  const password = String(req.body?.password || '');
  if (password.length < MIN_PASSWORD) return res.status(400).json({ error: `Password needs to be at least ${MIN_PASSWORD} characters` });

  const hash = await bcrypt.hash(password, 10);
  const user = await one(
    `UPDATE users SET password_hash = $1, invite_token = NULL, invite_expires = NULL, last_login = now()
       WHERE id = $2 RETURNING id, email, name, role`,
    [hash, u.id]
  );
  setAuthCookie(res, signToken(user));
  res.json({ user });
}));

export { users as usersRouter, invite as inviteRouter };
