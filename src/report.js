// ============================================================
//  End-of-day attendance report.
//  Builds the day's picture per site (who signed in, who signed
//  out and when, who is still signed in), renders it as an email
//  and sends it once per day at REPORT_TIME (Europe/London).
//  The send is logged in daily_reports so a restart never sends
//  it twice. Portal users can also preview it or send it on demand.
//
//  Env:
//    REPORT_TIME   HH:MM London time, default 18:30. "off" disables.
//    REPORT_TO     comma-separated recipients. Default: every portal user.
//    PORTAL_URL    link in the footer. Default: the Railway domain.
//    GEOFENCE_M    sign-out further than this is flagged "remote". Default 500.
// ============================================================
import { query, one } from './db/pool.js';
import { sendMail, mailConfigured, mailTransport } from './mailer.js';

const LDN = 'Europe/London';
const GEOFENCE = () => Number(process.env.GEOFENCE_M || 500);

export function londonDate(d = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: LDN, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function londonHM(d = new Date()) {
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: LDN, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return s.replace(/^24:/, '00:');
}
const fmtT = t => t ? new Date(t).toLocaleTimeString('en-GB', { timeZone: LDN, hour: '2-digit', minute: '2-digit' }) : '';
const fmtLongDate = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: LDN, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShortDate = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: LDN, weekday: 'short', day: 'numeric', month: 'short' });
const distLabel = m => m >= 1000 ? (m / 1000).toFixed(1) + 'km' : m + 'm';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function rowStatus(r) {
  if (!r.out_at) return { code: 'open', label: 'Still signed in' };
  if (r.auto_closed) return { code: 'auto', label: 'Auto-closed, hours unverified' };
  if (r.out_dist_m != null && r.out_dist_m > GEOFENCE()) return { code: 'remote', label: `Signed out ${distLabel(r.out_dist_m)} from site` };
  return { code: 'out', label: 'Signed out' };
}

// The day's attendance, grouped by site. date = YYYY-MM-DD (London day).
export async function buildDailyReport(date) {
  const { rows } = await query(`
    SELECT a.id, a.name, a.company, a.type, a.in_at, a.out_at, a.note, a.out_note, a.out_dist_m, a.auto_closed,
           (a.photo IS NOT NULL) AS has_photo, (a.out_photo IS NOT NULL) AS has_out_photo,
           s.id AS site_id, s.ref AS site_ref, s.name AS site_name
    FROM attendance a JOIN sites s ON s.id = a.site_id
    WHERE (a.in_at AT TIME ZONE 'Europe/London')::date = $1::date
    ORDER BY s.ref, a.name, a.in_at`, [date]);

  // Open sign-ins left over from earlier days: flagged separately
  const { rows: stale } = await query(`
    SELECT a.id, a.name, a.company, a.in_at, s.ref AS site_ref, s.name AS site_name
    FROM attendance a JOIN sites s ON s.id = a.site_id
    WHERE a.out_at IS NULL AND (a.in_at AT TIME ZONE 'Europe/London')::date < $1::date
    ORDER BY a.in_at`, [date]);

  const sites = new Map();
  const totals = { in: 0, out: 0, open: 0, remote: 0, auto: 0, notes: 0 };
  for (const r of rows) {
    if (!sites.has(r.site_id)) sites.set(r.site_id, { id: r.site_id, ref: r.site_ref, name: r.site_name, rows: [], counts: { in: 0, out: 0, open: 0, remote: 0, auto: 0 } });
    const st = sites.get(r.site_id);
    const status = rowStatus(r);
    const hours = r.out_at ? Math.round((new Date(r.out_at) - new Date(r.in_at)) / 36000) / 100 : null;
    st.rows.push({
      id: r.id, name: r.name, company: r.company, type: r.type,
      in_at: r.in_at, out_at: r.out_at, in: fmtT(r.in_at), out: fmtT(r.out_at), hours,
      status: status.code, status_label: status.label,
      note: r.note, out_note: r.out_note, out_dist_m: r.out_dist_m,
      has_photo: r.has_photo, has_out_photo: r.has_out_photo
    });
    st.counts.in++; totals.in++;
    if (status.code === 'open') { st.counts.open++; totals.open++; }
    else { st.counts.out++; totals.out++; }
    if (status.code === 'remote') { st.counts.remote++; totals.remote++; }
    if (status.code === 'auto') { st.counts.auto++; totals.auto++; }
    if (r.note || r.out_note) totals.notes++;
  }
  return {
    date, date_label: fmtLongDate(date), generated_at: new Date().toISOString(),
    sites: [...sites.values()], totals: { ...totals, sites: sites.size },
    stale_open: stale.map(r => ({ id: r.id, name: r.name, company: r.company, site_ref: r.site_ref, site_name: r.site_name, in_at: r.in_at, since: `${fmtShortDate(londonDate(new Date(r.in_at)))} ${fmtT(r.in_at)}` }))
  };
}

export function portalUrl() {
  return process.env.PORTAL_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'https://web-production-bf9121.up.railway.app');
}

export function renderReport(rep) {
  const t = rep.totals;
  const short = fmtShortDate(rep.date);
  const subject = t.in
    ? `GRS end of day, ${short}: ${t.in} signed in, ${t.out} signed out${t.open ? `, ${t.open} still signed in` : ''}`
    : `GRS end of day, ${short}: no sign-ins recorded`;

  // ---- plain text
  const L = [];
  L.push(`GRS Contractors: end of day attendance, ${rep.date_label}`);
  L.push(`${t.in} signed in across ${t.sites} site${t.sites === 1 ? '' : 's'}. ${t.out} signed out. ${t.open} still signed in.${t.remote ? ` ${t.remote} signed out away from site.` : ''}`);
  L.push('');
  for (const s of rep.sites) {
    L.push(`${s.ref}: ${s.name}  (${s.counts.in} in, ${s.counts.out} out${s.counts.open ? `, ${s.counts.open} STILL SIGNED IN` : ''})`);
    for (const r of s.rows) {
      const flag = r.status === 'open' ? '  ** NOT SIGNED OUT **' : r.status === 'remote' ? `  (${r.status_label})` : r.status === 'auto' ? '  (auto-closed)' : '';
      L.push(`  ${r.name}${r.company ? ', ' + r.company : ''}: in ${r.in}${r.out ? ', out ' + r.out : ''}${r.hours != null ? ', ' + r.hours.toFixed(2) + ' hrs' : ''}${flag}`);
      if (r.note) L.push(`      Note on sign-in: ${r.note}`);
      if (r.out_note) L.push(`      Note on sign-out: ${r.out_note}`);
    }
    L.push('');
  }
  if (!rep.sites.length) L.push('No sign-ins were recorded today.', '');
  if (rep.stale_open.length) {
    L.push('Still signed in from earlier days:');
    rep.stale_open.forEach(r => L.push(`  ${r.name}${r.company ? ', ' + r.company : ''}: ${r.site_ref}, signed in ${r.since}`));
    L.push('');
  }
  L.push(`Portal: ${portalUrl()}`);
  L.push('Sent automatically by GRS Safety (Safety Simplified Ltd).');
  const text = L.join('\n');

  // ---- html
  const RED = '#EC4B32', INK = '#17150f', MUTED = '#6f685d', LINE = '#e7e2d9', BAD = '#c0392b', OK = '#2f7d4f', WARN = '#b6852a';
  const pill = (bg, fg, txt) => `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;background:${bg};color:${fg};white-space:nowrap">${txt}</span>`;
  const statusPill = r =>
    r.status === 'open' ? pill('#fbeae7', BAD, 'STILL SIGNED IN')
    : r.status === 'remote' ? pill('#fbf2dd', WARN, esc(r.status_label))
    : r.status === 'auto' ? pill('#fbf2dd', WARN, 'Auto-closed')
    : pill('#e9f4ee', OK, 'Signed out');
  const siteBlocks = rep.sites.map(s => `
    <h3 style="margin:26px 0 8px;font-size:15px;color:${INK}">
      <span style="font-family:Menlo,monospace;font-size:12px;color:${RED};letter-spacing:.05em">${esc(s.ref)}</span>
      &nbsp;${esc(s.name)}
      <span style="font-weight:500;color:${MUTED};font-size:13px"> · ${s.counts.in} in, ${s.counts.out} out${s.counts.open ? `, <b style="color:${BAD}">${s.counts.open} still signed in</b>` : ''}</span>
    </h3>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13.5px;border:1px solid ${LINE};border-radius:8px">
      <tr style="background:#f4f1ea;color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:.06em">
        <th align="left" style="padding:8px 10px">Name</th><th align="left" style="padding:8px 10px">Company</th>
        <th align="right" style="padding:8px 10px">In</th><th align="right" style="padding:8px 10px">Out</th>
        <th align="right" style="padding:8px 10px">Hrs</th><th align="left" style="padding:8px 10px">Status</th></tr>
      ${s.rows.map(r => `
      <tr style="border-top:1px solid ${LINE}${r.status === 'open' ? ';background:#fff7f5' : ''}">
        <td style="padding:8px 10px;vertical-align:top"><b>${esc(r.name)}</b>${r.type !== 'staff' ? ` <span style="font-size:10px;color:${MUTED}">${r.type === 'subbie' ? 'SUB' : 'VISITOR'}</span>` : ''}
          ${r.note ? `<div style="font-size:12px;color:${MUTED};margin-top:2px">&#128172; In: ${esc(r.note)}</div>` : ''}
          ${r.out_note ? `<div style="font-size:12px;color:${MUTED};margin-top:2px">&#128172; Out: ${esc(r.out_note)}</div>` : ''}</td>
        <td style="padding:8px 10px;vertical-align:top;color:${MUTED}">${esc(r.company || '')}</td>
        <td align="right" style="padding:8px 10px;vertical-align:top;font-family:Menlo,monospace">${r.in}</td>
        <td align="right" style="padding:8px 10px;vertical-align:top;font-family:Menlo,monospace;color:${r.out ? INK : BAD}">${r.out || ''}</td>
        <td align="right" style="padding:8px 10px;vertical-align:top;font-family:Menlo,monospace">${r.hours != null ? r.hours.toFixed(2) : ''}</td>
        <td style="padding:8px 10px;vertical-align:top">${statusPill(r)}</td>
      </tr>`).join('')}
    </table>`).join('');

  const stale = rep.stale_open.length ? `
    <h3 style="margin:26px 0 8px;font-size:15px;color:${BAD}">Still signed in from earlier days</h3>
    <ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.6">
      ${rep.stale_open.map(r => `<li><b>${esc(r.name)}</b>${r.company ? ', ' + esc(r.company) : ''}: ${esc(r.site_ref)}, signed in ${esc(r.since)}</li>`).join('')}
    </ul>` : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${INK}">
  <div style="max-width:720px;margin:0 auto;padding:20px 14px 40px">
    <div style="background:${RED};color:#fff;border-radius:12px 12px 0 0;padding:16px 20px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.9">GRS Contractors · site attendance</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px">End of day: ${esc(rep.date_label)}</div>
    </div>
    <div style="background:#fff;border:1px solid ${LINE};border-top:none;border-radius:0 0 12px 12px;padding:18px 20px 24px">
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;color:${MUTED}"><tr>
        <td style="padding:6px 0"><div style="font-size:26px;font-weight:800;color:${INK}">${t.in}</div>signed in</td>
        <td style="padding:6px 0"><div style="font-size:26px;font-weight:800;color:${OK}">${t.out}</div>signed out</td>
        <td style="padding:6px 0"><div style="font-size:26px;font-weight:800;color:${t.open ? BAD : INK}">${t.open}</div>still signed in</td>
        <td style="padding:6px 0"><div style="font-size:26px;font-weight:800;color:${t.remote ? WARN : INK}">${t.remote}</div>signed out away from site</td>
      </tr></table>
      ${siteBlocks || `<p style="margin:20px 0 0;color:${MUTED}">No sign-ins were recorded today.</p>`}
      ${stale}
      <p style="margin:28px 0 0;font-size:12px;color:${MUTED};line-height:1.6">
        Sign-in and sign-out photos are in the portal: <a href="${portalUrl()}" style="color:${RED}">${portalUrl().replace(/^https?:\/\//, '')}</a><br>
        Sent automatically by GRS Safety at ${londonHM()} (Safety Simplified Ltd).
      </p>
    </div>
  </div></body></html>`;

  return { subject, text, html };
}

export async function recipients() {
  const env = (process.env.REPORT_TO || '').split(',').map(s => s.trim()).filter(Boolean);
  if (env.length) return env;
  const { rows } = await query(`SELECT email FROM users ORDER BY id`);
  return rows.map(r => r.email);
}

export async function lastSent() {
  return one(`SELECT report_date, sent_at, recipients, rows_count, ok, detail FROM daily_reports ORDER BY sent_at DESC LIMIT 1`);
}

export function reportConfig() {
  return {
    time: (process.env.REPORT_TIME || '18:30').trim(),
    timezone: LDN,
    mail_configured: mailConfigured(),
    transport: mailTransport(),
    portal_url: portalUrl()
  };
}

// Build, render, send, log. force=true sends even with no attendance (manual send).
export async function sendDailyReport(date = londonDate(), { force = false, trigger = 'manual', to: toOverride = null } = {}) {
  const report = await buildDailyReport(date);
  if (!force && !report.totals.in && !report.stale_open.length)
    return { skipped: 'no attendance', date };
  const to = (toOverride && toOverride.length) ? toOverride : await recipients();
  if (!mailConfigured()) return { ok: false, skipped: 'mail not configured', date, recipients: to };
  const { subject, text, html } = renderReport(report);
  const res = await sendMail({ to, subject, text, html });
  await query(`INSERT INTO daily_reports (report_date, recipients, rows_count, ok, detail) VALUES ($1,$2,$3,$4,$5)`,
    [date, to.join(','), report.totals.in, res.ok, res.ok ? trigger : String(res.error || '').slice(0, 500)]).catch(e => console.error('[report] log failed:', e.message));
  if (res.ok) console.log(`[report] ${trigger} report for ${date} sent to ${to.join(', ')} via ${res.via}`);
  else console.error(`[report] send failed for ${date}: ${res.error}`);
  return { ok: res.ok, error: res.error, date, recipients: to, subject, via: res.via, rows: report.totals.in };
}

// Checks every few minutes; sends once the London clock passes REPORT_TIME,
// as long as today's report hasn't already gone. Survives restarts because
// the "already sent" check is the daily_reports table, not memory.
export function startDailyReportScheduler() {
  const time = (process.env.REPORT_TIME || '18:30').trim();
  if (/^(off|none|0|false)$/i.test(time)) { console.log('[report] scheduler is off (REPORT_TIME)'); return; }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { console.error(`[report] REPORT_TIME "${time}" is not HH:MM, scheduler not started`); return; }
  let busy = false, skippedFor = null, failuresFor = { date: null, n: 0 };
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const today = londonDate();
      if (londonHM() < time) return;
      if (skippedFor === today) return;
      if (failuresFor.date === today && failuresFor.n >= 3) return;
      const sent = await one(`SELECT id FROM daily_reports WHERE report_date = $1 AND ok = true LIMIT 1`, [today]);
      if (sent) return;
      const r = await sendDailyReport(today, { trigger: 'scheduled' });
      if (r.skipped) {
        skippedFor = today;
        console.log(`[report] ${today}: skipped (${r.skipped})`);
      } else if (!r.ok) {
        failuresFor = { date: today, n: (failuresFor.date === today ? failuresFor.n : 0) + 1 };
      }
    } catch (e) {
      console.error('[report] scheduler tick failed:', e.message);
    } finally { busy = false; }
  };
  setTimeout(tick, 20_000);
  setInterval(tick, 5 * 60_000);
  console.log(`[report] end-of-day report scheduled for ${time} ${LDN}; email ${mailConfigured() ? 'via ' + mailTransport() : 'NOT configured'}`);
}
