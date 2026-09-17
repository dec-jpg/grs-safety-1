// ============================================================
//  Outbound email. Two transports, picked by environment:
//    MAILER_URL (+ MAILER_SECRET)  Apps Script web app that sends
//                                  from a Gmail account
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
// A browser-like agent: Google's front end is happier with it than with the bare Node default
const UA = 'Mozilla/5.0 (X11; Linux x86_64) GRS-Safety-Mailer/1.0';

async function fetchWithTimeout(url, opts) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

// Apps Script answers a POST with a 302 to script.googleusercontent.com, which
// then serves the script's output. Follow that hop by hand (GET, no body, no
// carried-over headers) rather than trusting the runtime's redirect handling,
// and keep the response text so a failure says what Google actually sent back.
async function postToAppsScript(url, payload) {
  const first = await fetchWithTimeout(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'text/plain;charset=utf-8', 'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*' },
    body: JSON.stringify(payload)
  });
  let res = first;
  if (first.status >= 300 && first.status < 400) {
    const loc = first.headers.get('location');
    if (!loc) return { status: first.status, text: '(redirect with no location)' };
    res = await fetchWithTimeout(new URL(loc, url).toString(), {
      method: 'GET', redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*' }
    });
  }
  const text = await res.text().catch(() => '');
  return { status: res.status, text, finalUrl: res.url };
}

function summarise(text) {
  const t = String(text || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.slice(0, 160);
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
      const r = await postToAppsScript(process.env.MAILER_URL, {
        secret: process.env.MAILER_SECRET || '',
        to: list.join(','), subject, body: text || '', html: html || ''
      });
      let parsed = null; try { parsed = JSON.parse(r.text); } catch {}
      if (parsed && parsed.ok === true) return { ok: true, via };
      if (parsed && parsed.ok === false) return { ok: false, via, error: `Mailer script said: ${parsed.error || 'unknown error'}` };
      // Not our JSON: Google served a login, authorisation or error page instead of running the script
      const hint = /accounts\.google\.com|ServiceLogin|Sign in/i.test(r.text + (r.finalUrl || ''))
        ? 'Google asked for a sign-in, so the web app is not deployed with access "Anyone"'
        : /Authorization is required|authorization/i.test(r.text)
          ? 'the script has not been authorised: run doGet once in the editor, approve, redeploy'
          : /unable to open the file|not found/i.test(r.text)
            ? 'the URL does not point at a live deployment'
            : `unexpected response`;
      return { ok: false, via, error: `Mailer responded ${r.status} (${hint}): ${summarise(r.text)}` };
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
