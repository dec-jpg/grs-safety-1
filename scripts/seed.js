import bcrypt from 'bcryptjs';
import { pool, query, one } from '../src/db/pool.js';

// ── Edit these before first run, or set via env ──────────────
const USERS = [
  { email: process.env.SEED_USER1_EMAIL || 'dec@safety-simplified.com',
    name:  'Dec Boydell',
    pass:  process.env.SEED_USER1_PASS  || 'changeme-dec' },
  { email: process.env.SEED_USER2_EMAIL || 'frank@safety-simplified.com',
    name:  'Frank Boydell',
    pass:  process.env.SEED_USER2_PASS  || 'changeme-frank' }
];

const SITES = [
  ['GRS-118', 'Standish — Phase 2 groundworks'],
  ['GRS-122', 'Newton-le-Willows — drainage'],
  ['GRS-109', 'Wigan Gateway — earthworks'],
  ['GRS-131', 'Leigh — S278 highways'],
  ['GRS-127', 'Bolton — RC structures'],
  ['GRS-134', 'Salford Quays — remediation'],
  ['GRS-141', 'Chorley — plot infrastructure'],
  ['GRS-145', 'Atherton — utilities']
];

// site ref, audited_on, auditor, compliance
const AUDITS = [
  ['GRS-118', '2026-07-24', 'F. Boydell', 97],
  ['GRS-122', '2026-07-22', 'F. Boydell', 99],
  ['GRS-109', '2026-07-21', 'D. Boydell', 91],
  ['GRS-131', '2026-07-19', 'D. Boydell', 95],
  ['GRS-127', '2026-07-18', 'F. Boydell', 88],
  ['GRS-134', '2026-07-16', 'F. Boydell', 96],
  ['GRS-141', '2026-07-15', 'D. Boydell', 98],
  ['GRS-145', '2026-07-12', 'D. Boydell', 94]
];

// site ref, severity, title, owner, due_date
const FINDINGS = [
  ['GRS-127', 'critical', 'Unsupported excavation face >1.2m', 'S. Doyle', '2026-07-26'],
  ['GRS-109', 'major', 'Pedestrian route not re-routed around new plant arc', 'M. Friel', '2026-07-24'],
  ['GRS-109', 'major', 'Edge protection missing to deep drainage run', 'M. Friel', '2026-07-28'],
  ['GRS-127', 'major', 'FFP3 face-fit records not on site file', 'S. Doyle', '2026-07-30'],
  ['GRS-131', 'major', 'Dust suppression bowser empty during cutting', 'L. Greer', '2026-07-23'],
  ['GRS-118', 'minor', 'Daily excavation inspection sheet gaps (2 days)', 'P. Naylor', '2026-07-29'],
  ['GRS-134', 'minor', 'Welfare unit handwash low on supplies', 'A. Ross', '2026-07-27'],
  ['GRS-141', 'minor', 'Segregation barrier displaced near gate', 'J. Booth', '2026-07-31']
];

async function seed() {
  // Users
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.pass, 10);
    await query(`
      INSERT INTO users (email, name, password_hash)
      VALUES ($1,$2,$3)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name`,
      [u.email.toLowerCase(), u.name, hash]);
  }
  console.log(`✓ ${USERS.length} users`);

  // Sites
  for (const [ref, name] of SITES) {
    await query(`INSERT INTO sites (ref, name) VALUES ($1,$2)
      ON CONFLICT (ref) DO UPDATE SET name = EXCLUDED.name`, [ref, name]);
  }
  console.log(`✓ ${SITES.length} sites`);

  const siteId = async ref => (await one('SELECT id FROM sites WHERE ref=$1', [ref])).id;
  const dec = await one('SELECT id FROM users LIMIT 1');

  // Audits
  for (const [ref, on, auditor, comp] of AUDITS) {
    const sid = await siteId(ref);
    const exists = await one('SELECT id FROM audits WHERE site_id=$1 AND audited_on=$2', [sid, on]);
    if (!exists) {
      await query(`INSERT INTO audits (site_id, audited_on, auditor, compliance, created_by)
        VALUES ($1,$2,$3,$4,$5)`, [sid, on, auditor, comp, dec.id]);
    }
  }
  console.log(`✓ ${AUDITS.length} audits`);

  // Findings (only if table empty, to stay idempotent)
  const fcount = Number((await one('SELECT COUNT(*) FROM findings')).count);
  if (fcount === 0) {
    for (const [ref, sev, title, owner, due] of FINDINGS) {
      const sid = await siteId(ref);
      await query(`INSERT INTO findings (site_id, severity, title, owner, due_date, created_by)
        VALUES ($1,$2,$3,$4,$5,$6)`, [sid, sev, title, owner, due, dec.id]);
    }
    console.log(`✓ ${FINDINGS.length} findings`);
  } else {
    console.log(`· findings already present (${fcount}), skipped`);
  }

  // A couple of people currently on site, so the register isn't empty on first look
  const acount = Number((await one('SELECT COUNT(*) FROM attendance')).count);
  if (acount === 0) {
    const firstSite = await one('SELECT id FROM sites ORDER BY id LIMIT 1');
    const demo = [
      ['Paul Naylor', 'Own Contractor', 'Site Manager', 'staff', true],
      ['Danny Quinn', 'Own Contractor', 'Ganger', 'staff', true],
      ['Liam Greer', 'Greer Plant Hire', '360 Driver', 'subbie', true],
      ['Jordan Booth', 'Booth Drainage', 'Operative', 'subbie', false]
    ];
    for (const [name, company, role, type, inducted] of demo) {
      await query(`INSERT INTO attendance (name, company, role, site_id, type, inducted, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [name, company, role, firstSite.id, type, inducted, dec.id]);
    }
    console.log(`✓ ${demo.length} attendance rows (on site now)`);
  } else {
    console.log(`· attendance already present (${acount}), skipped`);
  }

  console.log('\nSeed complete. Log in with the seeded email + password,');
  console.log('then change the password (or re-seed with SEED_USER*_PASS set).');
  await pool.end();
}

seed().catch(e => { console.error(e); process.exit(1); });
