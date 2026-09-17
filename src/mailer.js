// ============================================================
//  Outbound email. Two transports, picked by environment:
//    MAILER_URL (+ MAILER_SECRET)  Apps Script web app that sends
//                                  from the Safety Simplified Gmail
//                                  (tools/grs-mailer.gs)
//    RESEND_API_KEY (+ MAIL_FROM)  Resend HTTP API
//  With neither set, sendMail() reports not-configured and nothing
//  else in the app is affected.
// ============================================================

export function mailTransport() {
  if (process.env.MAILER_URL) return 'apps-script';
  if (process.env.RESEND_API_KEY) return 'resend';
  return null;
}
export const mailConfigured = () => mailTransport() !== null;

const TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url, opts) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

// to: array of addresses. Returns { ok, via, error? }
export async function sendMail({ to, subject, text, html }) {
  const via = mailTransport();
  const list = (Array.isArray(to) ? to : String(to || '').split(','))
    .map(s => s.trim()).filter(Boolean);
  if (!via) return { ok: false, via: null, error: 'Email is not configured (set MAILER_URL or RESEND_API_KEY)' };
  if (!list.length) return { ok: false, via, error: 'No recipients' };

  try {
    if (via === 'apps-script') {
      const r = await fetchWithTimeout(process.env.MAILER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },   // no preflight, and Apps Script reads postData.contents
        body: JSON.stringify({
          secret: process.env.MAILER_SECRET || '',
          to: list.join(','), subject, body: text || '', html: html || ''
        })
      });
      const bodyText = await r.text().catch(() => '');
      let parsed = null; try { parsed = JSON.parse(bodyText); } catch {}
      if (!r.ok || (parsed && parsed.ok === false))
        return { ok: false, via, error: (parsed && parsed.error) || `Mailer responded ${r.status}` };
      return { ok: true, via };
    }

    const r = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'GRS Safety <onboarding@resend.dev>',
        to: list, subject, text: text || '', html: html || undefined
      })
    });
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      return { ok: false, via, error: `Resend ${r.status}: ${err.slice(0, 200)}` };
    }
    return { ok: true, via };
  } catch (e) {
    return { ok: false, via, error: e.name === 'AbortError' ? 'Mailer timed out' : e.message };
  }
}
