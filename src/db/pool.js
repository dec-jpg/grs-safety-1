import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

const url = process.env.DATABASE_URL || '';
const needsSSL = /[?&]sslmode=require/.test(url)
  || (/proxy\.rlwy\.net|\.railway\.app/.test(url) && !/railway\.internal/.test(url));

export const pool = new Pool({
  connectionString: url,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000
});

export const query = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}
