import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const COOKIE = 'grs_token';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    SECRET,
    { expiresIn: '12h' }
  );
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE);
}

// Roles: admin (Safety Simplified and GRS admins, can manage users),
// manager (can do everything else), viewer (read only).
// 'consultant' is the original seed role and counts as admin.
export function normaliseRole(role) {
  return role === 'consultant' ? 'admin' : (role || 'viewer');
}

// Gate for API routes — reads the cookie, attaches req.user
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, SECRET);
    req.user.role = normaliseRole(req.user.role);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}

// Gate for a specific role or set of roles. Use after requireAuth.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(normaliseRole(req.user.role))) return res.status(403).json({ error: 'You do not have access to that' });
    next();
  };
}

// Viewers can look but not touch: block every non-GET under /api for them.
// Mounted in server.js before the routers; skips auth, public and invite paths.
export function readOnlyForViewers(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (/^\/api\/(auth|public|invite|health)\b/.test(req.path)) return next();
  const token = req.cookies?.[COOKIE];
  if (!token) return next(); // let the route's own requireAuth answer
  try {
    const u = jwt.verify(token, SECRET);
    if (normaliseRole(u.role) === 'viewer') return res.status(403).json({ error: 'Your login is view only' });
  } catch { /* route's own requireAuth will handle it */ }
  next();
}
