import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

import authRoutes from './routes/auth.js';
import sitesRoutes from './routes/sites.js';
import findingsRoutes from './routes/findings.js';
import auditsRoutes from './routes/audits.js';
import attendanceRoutes from './routes/attendance.js';
import publicRoutes from './routes/public.js';
import operativesRoutes from './routes/operatives.js';
import { ensureSchema } from './db/ensure.js';
import { startDailyReportScheduler } from './report.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '8mb' }));  // sign-in and sign-out photos ride in JSON
app.use(cookieParser());

// API
app.use('/api/auth', authRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/findings', findingsRoutes);
app.use('/api/audits', auditsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/operatives', operativesRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Static front-end
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback: send index for any non-API route
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handler. Aborted uploads (phone lost signal mid-photo) are noise, not errors.
app.use((err, req, res, next) => {
  if (err && (err.type === 'request.aborted' || err.code === 'ECONNABORTED')) {
    if (!res.headersSent) res.status(400).json({ error: 'Upload interrupted, please try again' });
    return;
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Photo too large, please retake' });
  }
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Server error' });
});

const PORT = process.env.PORT || 3000;

// Repair the schema first (idempotent), then listen, then start the
// end-of-day report clock. A schema failure is logged, never fatal:
// the app still comes up so the health check and rollback stay sane.
(async () => {
  try {
    await Promise.race([
      ensureSchema(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('schema check timed out after 25s')), 25_000))
    ]);
  } catch (e) {
    console.error('[boot] schema check did not complete:', e.message);
  }
  app.listen(PORT, () => {
    console.log(`GRS Safety running on :${PORT}`);
    try { startDailyReportScheduler(); } catch (e) { console.error('[boot] report scheduler failed to start:', e.message); }
  });
})();
