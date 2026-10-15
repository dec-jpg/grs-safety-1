// ============================================================
//  Toolbox talks view: the talk library, issued talks with
//  their WhatsApp links, and the sign-off register for each.
//  Loaded after app.js; adds itself to VIEWS.
// ============================================================
(function () {
  let D = null; // { talks, library } from /api/tbt
  const fmtD = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';
  const fmtDT = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ', ' +
    new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
  const talkUrl = t => location.origin + '/t/' + t;
  const canEdit = () => STATE.user && STATE.user.role !== 'viewer';

  async function vTbt() {
    D = await api('/tbt');
    setBadge(D);
    const issued = D.talks.map(t => `
      <div class="card" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:12px;${t.status === 'closed' ? 'opacity:.6' : ''}">
        <div style="flex:1;min-width:230px">
          <div class="site-name">${esc(t.title)}</div>
          <div class="site-meta">${esc([t.ref, t.category, 'issued ' + fmtD(t.issued_at)].filter(Boolean).join(' · '))}</div>
        </div>
        <div style="font-family:var(--mono);font-size:13px;font-weight:700">${t.signatures} signed${t.matched < t.signatures ? ` <span style="color:var(--muted);font-weight:500">(${t.signatures - t.matched} unmatched)</span>` : ''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${t.status === 'issued' ? `<button class="btn-ghost" onclick="tbtCopy('${t.token}')">Copy link</button>` : '<span class="pill bad">Closed</span>'}
          <button class="btn-primary" onclick="tbtRegister(${t.id})">Register</button>
        </div>
      </div>`).join('') ||
      `<div class="card" style="text-align:center;color:var(--muted);padding:28px">No talks issued yet. Issue one from the library below and the link is ready for WhatsApp.</div>`;

    const lib = D.library.map(t => `
      <tr><td><div class="site-name">${esc(t.title)}</div>
        <div class="site-meta">${esc([t.ref, t.category, t.questions > 0 ? t.questions + ' questions' : 'sign-off only'].filter(Boolean).join(' · '))}</div></td>
      <td class="num" style="color:var(--muted);font-size:12.5px">${t.times_issued ? `issued ${t.times_issued}× · last ${fmtD(t.last_issued)}` : 'not issued yet'}</td>
      <td class="num">${canEdit() ? `<button class="btn-ghost" onclick="tbtIssue(${t.id})">Issue</button>` : ''}</td></tr>`).join('');

    return `
      <h3 style="margin:0 0 12px;font-size:14px">Issued talks</h3>
      ${issued}
      <h3 style="margin:26px 0 10px;font-size:14px">Talk library</h3>
      <p style="margin:0 0 12px;font-size:12.5px;color:var(--muted)">Ready-made talks from Safety Simplified. Issuing a talk creates a fresh copy with its own link and its own register, so the same talk can be issued as often as needed.</p>
      <div class="card" style="padding:0;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <tbody>${lib || '<tr><td style="padding:20px;text-align:center;color:var(--muted)">The library is empty. Safety Simplified add talks with each update.</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  window.tbtCopy = async token => {
    const url = talkUrl(token);
    try { await navigator.clipboard.writeText(url); toast('Link copied, ready to paste into WhatsApp'); }
    catch { prompt('Copy the link:', url); }
  };

  window.tbtIssue = async id => {
    try {
      const r = await api('/tbt/library/' + id + '/issue', { method: 'POST', body: {} });
      try { await navigator.clipboard.writeText(talkUrl(r.token)); toast('Talk issued, link copied for WhatsApp'); }
      catch { toast('Talk issued'); }
      show('tbt');
    } catch (e) { toast(e.message); }
  };

  window.tbtRegister = async id => {
    try {
      const d = await api('/tbt/talks/' + id);
      const t = d.talk;
      const rows = d.signoffs.map(s => `
        <tr><td><div class="site-name" style="font-size:13px">${esc(s.op_name || s.name_given)}</div>
          <div class="site-meta">${s.operative_id
            ? esc(s.op_company || 'On the People register')
            : `not on the register${canEdit() ? ` · <a href="javascript:void 0" onclick="tbtLink(${s.id},${t.id})" style="color:var(--grs)">link</a>` : ''}`}</div></td>
        <td style="font-size:12px;color:var(--muted)">${esc(s.phone_given || '')}</td>
        <td style="font-size:12px;color:var(--muted);white-space:nowrap">${fmtDT(s.signed_at)}${s.attempts > 1 ? ` · ${s.attempts} tries` : ''}</td>
        <td><img src="/api/tbt/signoffs/${s.id}/signature" alt="signature" style="height:26px"></td>
        <td class="num">${canEdit() ? `<a href="javascript:void 0" onclick="tbtRemoveSig(${s.id},${t.id})" style="color:var(--muted);font-size:11.5px">remove</a>` : ''}</td></tr>`).join('');

      openModal(`
        <h3 style="margin-bottom:2px">${esc(t.title)}</h3>
        <p style="margin:0 0 12px;font-size:12px;color:var(--muted)">${esc([t.ref, 'issued ' + fmtD(t.issued_at), t.status === 'closed' ? 'closed' : 'open'].filter(Boolean).join(' · '))}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <button class="btn-ghost" onclick="tbtCopy('${t.token}')">Copy WhatsApp link</button>
          ${canEdit() ? `<button class="btn-ghost" onclick="tbtClose(${t.id})">${t.status === 'closed' ? 'Reopen talk' : 'Close talk'}</button>` : ''}
          <button class="btn-ghost" onclick="window.open('${talkUrl(t.token)}','_blank')">Open the talk</button>
        </div>
        <p style="margin:0 0 8px;font-size:13px"><b>${d.signoffs.length}</b> signed · <b>${d.outstanding.length}</b> on the People register still to sign</p>
        <div style="max-height:46vh;overflow:auto;border:1px solid var(--line);border-radius:9px">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <tbody>${rows || '<tr><td style="padding:18px;text-align:center;color:var(--muted)">Nobody has signed yet.</td></tr>'}</tbody>
          </table>
        </div>
        <div class="modal-act"><button class="btn-ghost" onclick="closeModal()">Close</button></div>`);
    } catch (e) { toast(e.message); }
  };

  window.tbtClose = async id => {
    try { await api('/tbt/talks/' + id + '/close', { method: 'POST' }); closeModal(); show('tbt'); }
    catch (e) { toast(e.message); }
  };

  window.tbtRemoveSig = async (id, talkId) => {
    if (!confirm('Remove this sign-off from the register?')) return;
    try { await api('/tbt/signoffs/' + id, { method: 'DELETE' }); tbtRegister(talkId); }
    catch (e) { toast(e.message); }
  };

  window.tbtLink = async (sigId, talkId) => {
    try {
      const d = await api('/tbt/talks/' + talkId);
      const opts = d.outstanding.map(o => `<option value="${o.id}">${esc(o.name)}${o.company ? ' · ' + esc(o.company) : ''}</option>`).join('');
      openModal(`
        <h3>Who is this?</h3>
        <p style="margin:0 0 12px;font-size:12.5px;color:var(--muted)">Pick the person from the People register. Their mobile number is remembered, so next time they sign anything it matches by itself.</p>
        <label>Person</label><select id="tbt_link_op">${opts || '<option value="">Nobody left to choose</option>'}</select>
        <div class="modal-act"><button class="btn-ghost" onclick="tbtRegister(${talkId})">Back</button>
          <button class="btn-primary" onclick="tbtLinkSave(${sigId},${talkId})">Link</button></div>`);
    } catch (e) { toast(e.message); }
  };

  window.tbtLinkSave = async (sigId, talkId) => {
    const opId = Number(el('tbt_link_op').value);
    if (!opId) return toast('Choose who this is');
    try { await api('/tbt/signoffs/' + sigId + '/link', { method: 'POST', body: { operative_id: opId } }); toast('Linked'); tbtRegister(talkId); }
    catch (e) { toast(e.message); }
  };

  function setBadge(d) {
    const c = el('ct-tbt');
    if (c) { const n = d.talks.filter(t => t.status === 'issued').length; c.textContent = n || ''; }
  }

  VIEWS.tbt = { t: 'Toolbox talks', c: 'Issued talks, WhatsApp links and sign-off registers', r: vTbt };
  setTimeout(async () => { try { setBadge(await api('/tbt')); } catch { /* not logged in yet */ } }, 900);
})();
