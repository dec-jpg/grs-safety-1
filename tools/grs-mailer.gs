/**
 * GRS Safety mailer (Google Apps Script web app).
 * The portal POSTs JSON here and this sends the email from the
 * Safety Simplified Gmail account. Used for the end-of-day
 * attendance report (and per-sign-in emails if switched on).
 *
 * Set up once:
 *  1. script.google.com > New project > paste this file in.
 *  2. Change SECRET below to a long random string.
 *  3. Deploy > New deployment > Web app.
 *       Execute as: Me.   Who has access: Anyone.
 *  4. Copy the web app URL (ends in /exec).
 *  5. In Railway, on the web service, set:
 *       MAILER_URL    = that URL
 *       MAILER_SECRET = the same SECRET as below
 *     Railway redeploys; the portal's End-of-day report modal then
 *     shows "Connected" and the Send now button works.
 *
 * Payload: { secret, to: "a@x.com,b@y.com", subject, body, html }
 */
const SECRET = 'change-me-to-a-long-random-string';
const FROM_NAME = 'GRS Safety';

function doPost(e) {
  let d = {};
  try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  if (!d.secret || d.secret !== SECRET) return respond({ ok: false, error: 'bad secret' });
  const to = String(d.to || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!to.length) return respond({ ok: false, error: 'no recipients' });
  const opts = { to: to.join(','), subject: d.subject || 'GRS Safety', body: d.body || '', name: FROM_NAME };
  if (d.html) opts.htmlBody = d.html;
  try {
    MailApp.sendEmail(opts);
    return respond({ ok: true, sent_to: to.length });
  } catch (err) {
    return respond({ ok: false, error: String(err) });
  }
}

// Visiting the URL in a browser confirms the deployment is alive
function doGet() { return respond({ ok: true, service: 'GRS Safety mailer' }); }

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
