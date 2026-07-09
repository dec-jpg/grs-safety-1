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

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set('trust proxy', 1);   // Railway sits behind a proxy
app.use(express.json({ limit: '1mb' }));  // sign-in photos ride in JSON
app.use(cookieParser());

// API
app.use('/api/auth', authRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/findings', findingsRoutes);
app.use('/api/audits', auditsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/public', publicRoutes);

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
app.listen(PORT, () => console.log(`GRS Safety running on :${PORT}`));
