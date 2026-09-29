import { Router } from 'express';
import { wrap } from '../util.js';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { one, query } from '../db/pool.js';
import { signToken, setAuthCookie, clearAuthCookie, requireAuth, normaliseRole } from '../auth.js';

const router = Router();

// Brute-force protection on login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' }
});

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await one('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  if (user.active === false) return res.status(401).json({ error: 'This login has been switched off. Speak to your admin.' });
  if (!user.password_hash) return res.status(401).json({ error: 'This login has not been set up yet. Use the invite link you were sent, or ask for a new one.' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  const role = normaliseRole(user.role);
  const token = signToken({ ...user, role });
  setAuthCookie(res, token);
  query('UPDATE users SET last_login = now() WHERE id = $1', [user.id]).catch(() => {});
  res.json({ user: { id: user.id, name: user.name, email: user.email, role } });
}));

// Logged-in user changes their own password
router.post('/change-password', requireAuth, wrap(async (req, res) => {
  const { current, password } = req.body || {};
  if (!current || !password) return res.status(400).json({ error: 'Current and new password required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'New password needs to be at least 8 characters' });
  const user = await one('SELECT id, password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Session expired' });
  const ok = await bcrypt.compare(current, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is wrong' });
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(password, 10), user.id]);
  res.json({ ok: true });
}));

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
