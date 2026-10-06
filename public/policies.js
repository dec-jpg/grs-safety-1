// ============================================================
//  Company policies view: read the pack, sign once, download
//  the signed PDF. Loaded after app.js; adds itself to VIEWS.
// ============================================================
(function () {
  let PK = null;     // pack + status from /api/policies
  let pad = null;    // signature pad
  const fmtD = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtN = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const canSign = () => STATE.user && STATE.user.role !== 'viewer';
  const shortTitle = t => t.replace('Health and Safety Policy Statement of Intent', 'Health and Safety Statement of Intent');

  const blocksHtml = bl => bl.map(([t, v]) =>
    t === 'h' ? `<h4 style="margin:16px 0 6px;font-size:13.5px">${esc(v)}</h4>`
    : t === 'p' ? `<p style="margin:0 0 10px;font-size:13.5px;line-height:1.6">${esc(v)}</p>`
    : `<ul style="margin:0 0 10px;padding-left:20px;font-size:13.5px;line-height:1.6">${v.map(li => `<li style="margin-bottom:4px">${esc(li)}</li>`).join('')}</ul>`).join('');

  function statusCard() {
    const L = PK.latest, n = PK.policies.length;
    const signedLine = L ? `Signed by <b>${esc(L.signed_name)}</b>, ${esc(L.position)}, on ${fmtD(L.signed_at)}.` : '';
    const map = {
      signed: ['ok', 'Signed and in date', `${signedLine} Review due ${fmtD(L && L.review_due)}.`],
      unsigned: ['warn', 'Waiting to be signed', `The pack is ready. It needs reading and signing once by the most senior person at ${esc(PK.company)}.`],
      due: ['bad', 'Due for re-signing', `${signedLine} The annual review date (${fmtD(L && L.review_due)}) has passed, so the pack needs signing again.`],
      updated: ['warn', 'Updated, needs signing', `${signedLine} Safety Simplified have since issued an updated pack, so it needs signing again.`]
    };
    const [cls, head, text] = map[PK.status];
    return `<div class="card" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-bottom:22px">
      <div style="flex:1;min-width:240px"><span class="pill ${cls}">${head}</span>
        <p style="margin:10px 0 0;font-size:13.5px;color:var(--ink)">${text}</p>
        <p style="margin:6px 0 0;font-size:12px;color:var(--muted)">${n} policies · issued ${fmtD(PK.issued)} · prepared with Safety Simplified Ltd</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${L ? `<button class="btn-ghost" onclick="polPdf(${L.id})">Download signed PDF</button>` : ''}
        ${PK.status !== 'signed' && canSign() ? `<button class="btn-primary" onclick="polGoSign()">Read and sign</button>` : ''}</div></div>`;
  }

  function signPanel() {
    if (!canSign()) return '';
    const today = new Date(), review = new Date(today); review.setFullYear(review.getFullYear() + 1);
    const resign = PK.status === 'signed';
    return `<div class="sec" id="polSign"><div class="sec-head"><h2>${resign ? 'Sign again' : 'Sign the pack'}</h2><span class="rule"></span></div>
      <div class="card">
        ${resign ? `<p style="margin:0 0 14px;font-size:13px;color:var(--muted)">The pack is already signed and in date. Only sign again if something has changed, for example a new director.</p>` : ''}
        <p style="margin:0 0 16px;font-size:13.5px">To be signed by the most senior person at ${esc(PK.company)}. One signature covers all ${PK.policies.length} policies, and a signed PDF downloads straight away for your records and for accreditation (SMAS, Constructionline).</p>
        <div class="grid g2e" style="gap:14px">
          <div><label style="font-size:12px;font-weight:700;display:block;margin-bottom:6px">Full name</label>
            <input id="pol_name" autocomplete="name" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:9px;font:inherit;font-size:14px"></div>
          <div><label style="font-size:12px;font-weight:700;display:block;margin-bottom:6px">Position</label>
            <input id="pol_pos" value="Director" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:9px;font:inherit;font-size:14px"></div>
        </div>
        <p style="margin:12px 0 0;font-size:12px;color:var(--muted)">Date ${fmtN(today)} · review date ${fmtN(review)}</p>
        <label style="font-size:12px;font-weight:700;display:block;margin:16px 0 6px">Signature: draw with finger, stylus or mouse</label>
        <canvas id="pol_pad" style="width:100%;height:150px;border:1.5px dashed #c8c0b3;border-radius:10px;background:#fff;touch-action:none;display:block"></canvas>
        <label style="display:flex;gap:10px;align-items:flex-start;margin:16px 0 0;font-size:13.5px;cursor:pointer">
          <input type="checkbox" id="pol_ok" style="width:18px;height:18px;margin-top:2px;accent-color:var(--grs)">
          <span>I have read these policies and sign them on behalf of ${esc(PK.company)}.</span></label>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
          <button class="btn-ghost" onclick="polClear()">Clear signature</button>
          <button class="btn-primary" id="pol_go" onclick="polSign()">Sign all ${PK.policies.length} policies</button></div>
      </div></div>`;
  }

  function historyTable() {
    if (!PK.history.length) return '';
    return `<div class="sec"><div class="sec-head"><h2>Signing record</h2><span class="rule"></span></div>
      <div class="card" style="padding:8px 14px"><table><thead><tr><th>Signed by</th><th>Signed</th><th>Review due</th><th>Entered by</th><th></th></tr></thead><tbody>
      ${PK.history.map(h => `<tr><td><div class="site-name">${esc(h.signed_name)}</div><div class="site-meta">${esc(h.position)}</div></td>
        <td>${fmtD(h.signed_at)}</td><td>${fmtD(h.review_due)}</td><td style="color:var(--muted)">${esc(h.user_name || '')}</td>
        <td class="num"><button class="btn-sm" onclick="polPdf(${h.id})">PDF</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  async function vPolicies() {
    PK = await api('/policies');
    setTimeout(initPad, 0);
    return `${statusCard()}
      <div class="sec"><div class="sec-head"><h2>The policies</h2><span class="rule"></span></div>
      ${PK.policies.map((p, i) => `<div class="pack" id="pol-${p.key}">
        <div class="pack-head" onclick="this.parentNode.classList.toggle('open')">
          <span class="chev">&#9654;</span>
          <div class="pack-title"><div class="n">${i + 1}. ${esc(shortTitle(p.title))}</div><div class="r">${esc(PK.company)}</div></div></div>
        <div class="pack-body" style="padding-top:14px"><h3 style="margin:0 0 12px;font-size:16px">${esc(p.title)}</h3>${blocksHtml(p.blocks)}</div></div>`).join('')}
      </div>
      ${signPanel()}
      ${historyTable()}`;
  }

  function initPad() {
    const c = document.getElementById('pol_pad');
    if (!c) { pad = null; return; }
    const ctx = c.getContext('2d'); let drawing = false, dirty = false, last = null;
    const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr; c.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    const pos = e => { const b = c.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    c.addEventListener('pointerdown', e => { e.preventDefault(); c.setPointerCapture(e.pointerId); drawing = true; last = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(last.x + .1, last.y + .1); ctx.stroke(); dirty = true; });
    c.addEventListener('pointermove', e => { if (!drawing) return; e.preventDefault(); const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => c.addEventListener(ev, () => { drawing = false; }));
    pad = { clear() { ctx.clearRect(0, 0, c.width, c.height); dirty = false; }, empty: () => !dirty, data: () => c.toDataURL('image/png') };
  }

  window.polClear = () => pad && pad.clear();
  window.polGoSign = () => { const s = document.getElementById('polSign'); if (s) s.scrollIntoView({ behavior: 'smooth' }); };

  window.polSign = async () => {
    const name = el('pol_name').value.trim(), position = el('pol_pos').value.trim();
    if (name.length < 3) return toast('Enter the full name of the person signing');
    if (!position) return toast('Enter their position');
    if (!pad || pad.empty()) return toast('Sign in the box first');
    if (!el('pol_ok').checked) return toast('Tick the box to confirm the policies have been read');
    const btn = el('pol_go'); btn.disabled = true; btn.textContent = 'Signing';
    try {
      const row = await api('/policies/sign', { method: 'POST', body: { name, position, signature: pad.data() } });
      toast('Policies signed');
      await show('policies');
      polPdf(row.id);
      refreshPolicyCount();
    } catch (e) { btn.disabled = false; btn.textContent = 'Sign all policies'; toast(e.message); }
  };

  // ---------- signed PDF (built in the browser) ----------
  function loadJsPdf() {
    if (window.jspdf) return Promise.resolve();
    return new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = ok; s.onerror = () => fail(new Error('Could not load the PDF tool, check your connection'));
      document.head.appendChild(s);
    });
  }

  // The stored logo has a thin dark strip down its left edge (invisible on the dark sidebar); trim it for print.
  function cleanLogo() {
    const src = window.__GRS_LOGO__;
    if (!src) return Promise.resolve(null);
    return new Promise(ok => {
      const im = new Image();
      im.onload = () => {
        const trim = 4, c = document.createElement('canvas');
        c.width = im.width - trim; c.height = im.height;
        c.getContext('2d').drawImage(im, trim, 0, c.width, c.height, 0, 0, c.width, c.height);
        ok({ src: c.toDataURL('image/png'), w: c.width, h: c.height });
      };
      im.onerror = () => ok(null);
      im.src = src;
    });
  }

  window.polPdf = async id => {
    try {
      toast('Preparing PDF');
      const [rec] = await Promise.all([api('/policies/signoffs/' + id), loadJsPdf()]);
      const pack = PK || await api('/policies');
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const W = 210, M = 18, maxW = W - 2 * M; let y;
      const OR = [236, 75, 50], INK = [26, 26, 26];
      const lineH = pt => pt * 0.3528 * 1.35;
      const need = h => { if (y + h > 297 - M) { doc.addPage(); y = 28; } };
      const text = (s, pt, style = 'normal', gap = 1.5) => { doc.setFont('helvetica', style); doc.setFontSize(pt); doc.splitTextToSize(s, maxW).forEach(l => { need(lineH(pt)); doc.text(l, M, y); y += lineH(pt); }); y += gap; };
      const bullet = (s, pt) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(pt); doc.splitTextToSize(s, maxW - 8).forEach((l, i) => { need(lineH(pt)); if (i === 0) doc.text('•', M + 3, y); doc.text(l, M + 8, y); y += lineH(pt); }); y += 0.8; };
      const signed = fmtN(rec.signed_at), review = fmtN(rec.review_due);

      // cover
      const logo = await cleanLogo();
      if (logo) { try { const h = 26, w = Math.min(90, h * logo.w / logo.h); doc.addImage(logo.src, 'PNG', M, 40, w, h); } catch (e) { /* logo optional */ } }
      doc.setFillColor(...OR); doc.rect(M, 92, 40, 2.2, 'F');
      doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.text(pack.company, M, 110);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(16); doc.text('Company Policies', M, 121);
      doc.setFontSize(11); doc.text(`Signed ${signed} by ${rec.signed_name}, ${rec.position}. Review by ${review}.`, M, 134);
      doc.setFontSize(10); pack.policies.forEach((p, i) => doc.text(`${i + 1}.  ${p.title}`, M, 152 + i * 6.2));
      doc.setFontSize(9); doc.setTextColor(110); doc.text('Prepared with Safety Simplified Ltd, competent health and safety adviser to ' + pack.company, M, 282);

      pack.policies.forEach(p => {
        doc.addPage();
        doc.setFillColor(...OR); doc.rect(0, 0, W, 4, 'F');
        doc.setTextColor(110); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(pack.company.toUpperCase(), M, 14);
        doc.setTextColor(...INK); y = 26;
        text(p.title, 16, 'bold', 3);
        p.blocks.forEach(([t, v]) => { if (t === 'h') { y += 1.5; text(v, 11.5, 'bold', 1); } else if (t === 'p') text(v, 10, 'normal', 2); else { v.forEach(li => bullet(li, 10)); y += 1.5; } });
        need(50); y += 4; doc.setDrawColor(...OR); doc.setLineWidth(.6); doc.line(M, y, W - M, y); y += 7;
        text('Signed on behalf of ' + pack.company + ' (most senior person)', 11, 'bold', 2);
        const sy = y; doc.addImage(rec.signature, 'PNG', M, sy, 70, 22); doc.setDrawColor(150); doc.setLineWidth(.3); doc.line(M, sy + 23, M + 70, sy + 23);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
        doc.text('Name: ' + rec.signed_name, M + 85, sy + 6); doc.text('Position: ' + rec.position, M + 85, sy + 12);
        doc.text('Date: ' + signed, M + 85, sy + 18); doc.text('Review date: ' + review, M + 85, sy + 24);
      });
      const n = doc.getNumberOfPages();
      for (let i = 2; i <= n; i++) {
        doc.setPage(i); doc.setFontSize(8); doc.setTextColor(110);
        doc.text(`${pack.company}: Company Policies, page ${i} of ${n}`, W / 2, 292, { align: 'center' });
        doc.text(`Signed electronically in the GRS Safety Dashboard on ${new Date(rec.signed_at).toLocaleString('en-GB')}. Prepared with Safety Simplified Ltd.`, M, 288);
      }
      doc.save(`${pack.company} - Company Policies - signed ${signed.replace(/\//g, '-')}.pdf`);
    } catch (e) { toast(e.message); }
  };

  // Nav badge: shows when the pack needs signing
  async function refreshPolicyCount() {
    try {
      const p = await api('/policies'); const c = document.getElementById('ct-policies');
      if (c) { const need = p.status !== 'signed'; c.textContent = need ? 'sign' : ''; c.style.display = need ? '' : 'none'; }
    } catch { /* ignore */ }
  }
  window.refreshPolicyCount = refreshPolicyCount;

  VIEWS.policies = { t: 'Policies', c: 'Company policy pack · read and sign', r: vPolicies };
  setTimeout(refreshPolicyCount, 800);
})();
