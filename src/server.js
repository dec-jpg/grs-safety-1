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
import sitepackRoutes from './routes/sitepack.js';
import tbtRoutes from './routes/tbt.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '8mb' }));  // sign-in photos ride in JSON
app.use(cookieParser());

// API
app.use('/api/auth', authRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/findings', findingsRoutes);
app.use('/api/audits', auditsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/operatives', operativesRoutes);
app.use('/api/sitepack', sitepackRoutes);
app.use('/api/tbt', tbtRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Static front-end
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback — send index for any non-API route
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const PORT = process.env.PORT || 3000;

// -- Boot-time column check ----------------------------------
// The app repairs its own database on startup: adds the columns
// this build needs if they're missing. Idempotent — a no-op on
// every boot after the first. Ends the "code deployed, column
// didn't" failure class for these features.
import('./db/pool.js').then(async ({ query }) => {
  try {
    await query("ALTER TABLE attendance ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN NOT NULL DEFAULT false");
    await query("ALTER TABLE attendance ADD COLUMN IF NOT EXISTS out_photo TEXT");
    console.log('[boot] attendance columns verified: auto_closed, out_photo');
  } catch (e) {
    console.error('[boot] column check FAILED:', e.message);
  }
});

app.listen(PORT, () => console.log(`GRS Safety running on :${PORT}`));
