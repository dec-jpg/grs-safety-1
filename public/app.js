// ============================================================
//  GRS Safety Dashboard — front-end
//  Talks to the live API. Audits + Overview are functional;
//  other modules show a preview state until built.
// ============================================================

const el = id => document.getElementById(id);
const api = async (path, opts={}) => {
  const r = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (r.status === 401) { location.href = '/login.html'; throw new Error('auth'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
};

const sevCls = s => s==='critical'?'c':s==='major'?'major':'minor';
const sevLab = s => s==='critical'?'Critical':s==='major'?'Major':'Minor';
const barColor = s => s==='ok'?'var(--ok)':s==='warn'?'var(--warn)':'var(--bad)';
const statusLab = s => s==='ok'?'On track':s==='warn'?'Watch':'Action';
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) : '—';

let STATE = { sites: [], summary: null, findings: [], user: null };

function toast(msg){
  const t = el('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

// ---------- modal ----------
function openModal(html){ el('modal').innerHTML = html; el('modalBg').classList.add('show'); }
function closeModal(){ el('modalBg').classList.remove('show'); }
el('modalBg').addEventListener('click', e => { if(e.target===el('modalBg')) closeModal(); });

// ============================================================
//  VIEWS
// ============================================================
function siteTableRows(sites){
  return sites.map(s=>`
    <tr><td><div class="site-name">${s.name}</div><div class="site-meta">${s.ref}</div></td>
    <td class="num" style="color:var(--muted);font-size:12.5px">${s.audited}</td>
    <td><div style="display:flex;align-items:center;gap:9px"><div class="bar"><span style="width:${s.compliance}%;background:${barColor(s.status)}"></span></div><span style="font-family:var(--mono);font-size:12px;font-weight:700">${s.compliance}%</span></div></td>
    <td class="num" style="font-family:var(--mono);font-weight:700;color:${s.open?'var(--ink)':'var(--faint)'}">${s.open}</td>
    <td class="num"><span class="pill ${s.status}">${statusLab(s.status)}</span></td></tr>`).join('');
}

async function vOverview(){
  const sum = await api('/audits/summary');
  STATE.summary = sum;
  const h = sum.headline, sev = h.severity, tot = (sev.critical+sev.major+sev.minor)||1;
  const w = n => (n/tot*100)+'%';
  return `
  <div class="sec"><div class="grid g4">
    <div class="stat accent"><div class="k">Compliance</div><div class="v">${h.compliance}<span class="u">%</span></div>
      <div class="miniline"><span style="width:${h.compliance}%;background:var(--grs)"></span></div>
      <div class="foot">Average across audited sites</div></div>
    <div class="stat"><div class="k">Sites audited</div><div class="v">${h.sitesAudited}<span class="u">/${h.sitesTotal}</span></div>
      <div class="foot">${h.sitesAudited===h.sitesTotal?'Full coverage':(h.sitesTotal-h.sitesAudited)+' outstanding'}</div></div>
    <div class="stat"><div class="k">Open findings</div><div class="v">${h.openFindings}</div>
      <div class="miniline" style="display:flex;background:transparent;gap:2px">
        <span style="width:${w(sev.critical)};background:var(--bad)"></span>
        <span style="width:${w(sev.major)};background:var(--warn)"></span>
        <span style="width:${w(sev.minor)};background:var(--ok)"></span></div>
      <div class="foot">${sev.critical} critical · ${sev.major} major · ${sev.minor} minor</div></div>
    <div class="stat"><div class="k">Overdue actions</div>
      <div class="v" style="color:${h.overdueFindings?'var(--grs)':'var(--ink)'}">${h.overdueFindings}</div>
      <div class="foot">${h.overdueFindings?'Require escalation':'Nothing overdue'}</div></div>
  </div></div>
  <div class="sec"><div class="sec-head"><h2>Site compliance</h2><span class="rule"></span></div>
    <div class="card"><table>
      <thead><tr><th>Site</th><th class="num">Audited</th><th>Compliance</th><th class="num">Open</th><th class="num">Status</th></tr></thead>
      <tbody>${siteTableRows(sum.sites)}</tbody></table></div></div>`;
}

async function vAudits(){
  const [findings, sites] = await Promise.all([
    api('/findings?status=open'),
    api('/sites')
  ]);
  STATE.findings = findings; STATE.sites = sites;

  const findingHtml = findings.length ? findings.map(f=>`
    <div class="finding" data-id="${f.id}">
      <div class="sev-tag ${sevCls(f.severity)}">${sevLab(f.severity)}</div>
      <div style="flex:1">
        <div class="title">${esc(f.title)}</div>
        <div class="meta"><span>${f.site_ref}</span>${f.owner?`<span>Owner: ${esc(f.owner)}</span>`:''}
        <span class="due ${f.overdue?'over':''}">Due ${fmtDate(f.due_date)}${f.overdue?' · overdue':''}</span></div>
      </div>
      <div class="act"><button class="btn-sm" onclick="closeFinding(${f.id})">Mark closed</button></div>
    </div>`).join('') : `<div class="loading">No open findings. Nice and clean.</div>`;

  return `
  <div class="sec">
    <div class="sec-head"><h2>Open findings · most urgent first</h2><span class="rule"></span>
      <button class="btn-primary" onclick="newFindingModal()">+ Add finding</button></div>
    <div class="card" id="findingCard">${findingHtml}</div>
  </div>
  <div class="sec"><div class="sec-head"><h2>Compliance by site</h2><span class="rule"></span></div>
    <div class="card"><table>
      <thead><tr><th>Site</th><th class="num">Audited</th><th>Compliance</th><th class="num">Open</th><th class="num">Status</th></tr></thead>
      <tbody>${siteTableRows((STATE.summary||await api('/audits/summary')).sites)}</tbody></table></div></div>`;
}

function preview(name, desc){
  return `<div class="preview"><div class="pin">In development</div>
    <h3>${name}</h3><p>${desc} This module is mapped out in the demo and will be switched on once the audits area is bedded in with GRS.</p></div>`;
}

const VIEWS = {
  overview:{t:"Dashboard", c:"Safety overview · all active sites", r:vOverview},
  audits:{t:"Audits", c:"Findings, actions and compliance scores", r:vAudits},
  training:{t:"Training", c:"Competency matrix and certificate currency",
    r:()=>preview('Training &amp; Competency','Track tickets and certificate expiry across site crews.')},
  rams:{t:"RAMS", c:"Method statements and accreditation",
    r:()=>preview('RAMS &amp; Accreditation','Method statements mapped to live work fronts, with revision and review status.')},
  coshh:{t:"COSHH", c:"Substance register and assessments",
    r:()=>preview('COSHH','A substance register with hazard classification and assessment review dates.')},
  packs:{t:"Site packs", c:"Site-specific document bundles",
    r:()=>preview('Site packs','Per-site document bundles — CPP, RAMS, COSHH, permits and inspection records.')}
};

async function show(view){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view));
  const v = VIEWS[view];
  el('viewTitle').textContent = v.t; el('viewCrumb').textContent = v.c;
  el('view').innerHTML = `<div class="loading"><span class="spin"></span></div>`;
  el('rail').classList.remove('open'); el('scrim').classList.remove('show');
  window.scrollTo(0,0);
  try { el('view').innerHTML = await v.r(); }
  catch(e){ if(e.message!=='auth') el('view').innerHTML = `<div class="loading">Couldn't load: ${e.message}</div>`; }
}

// ============================================================
//  ACTIONS
// ============================================================
function newFindingModal(){
  const opts = STATE.sites.map(s=>`<option value="${s.id}">${s.ref} — ${esc(s.name)}</option>`).join('');
  openModal(`
    <h3>Add finding</h3>
    <label>Site</label><select id="m_site">${opts}</select>
    <label>Severity</label>
    <select id="m_sev"><option value="critical">Critical</option><option value="major" selected>Major</option><option value="minor">Minor</option></select>
    <label>Title</label><input id="m_title" placeholder="e.g. Edge protection missing to deep excavation">
    <label>Owner (optional)</label><input id="m_owner" placeholder="Person responsible on site">
    <label>Due date (optional)</label><input id="m_due" type="date">
    <div class="modal-act"><button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveFinding()">Save finding</button></div>`);
}

async function saveFinding(){
  const body = {
    site_id: Number(el('m_site').value),
    severity: el('m_sev').value,
    title: el('m_title').value.trim(),
    owner: el('m_owner').value.trim() || null,
    due_date: el('m_due').value || null
  };
  if(!body.title){ toast('Add a title first'); return; }
  try{
    await api('/findings', { method:'POST', body });
    closeModal(); toast('Finding added');
    await show('audits');
    refreshCounts();
  }catch(e){ toast(e.message); }
}

async function closeFinding(id){
  const f = STATE.findings.find(x=>x.id===id);
  openModal(`
    <h3>Close finding</h3>
    <p style="font-size:13px;color:var(--muted);margin:0 0 16px">${esc(f?.title||'')}</p>
    <label>Closing note (optional)</label>
    <textarea id="m_note" placeholder="What was done to resolve it?"></textarea>
    <div class="modal-act"><button class="btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="confirmClose(${id})">Confirm closed</button></div>`);
}

async function confirmClose(id){
  try{
    await api(`/findings/${id}/close`, { method:'POST', body:{ note: el('m_note').value.trim() || null }});
    closeModal(); toast('Finding closed');
    await show('audits');
    refreshCounts();
  }catch(e){ toast(e.message); }
}

async function refreshCounts(){
  try{
    const open = await api('/findings?status=open');
    el('ct-audits').textContent = open.length;
  }catch{}
}

// ============================================================
//  BOOT
// ============================================================
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

document.querySelectorAll('.nav-item').forEach(n=>n.addEventListener('click',()=>show(n.dataset.view)));
el('burger').addEventListener('click',()=>{el('rail').classList.add('open');el('scrim').classList.add('show');});
el('scrim').addEventListener('click',()=>{el('rail').classList.remove('open');el('scrim').classList.remove('show');});
el('logout').addEventListener('click', async ()=>{ await api('/auth/logout',{method:'POST'}); location.href='/login.html'; });

el('logo').src = window.__GRS_LOGO__ || '';

(async function boot(){
  try{
    const { user } = await api('/auth/me');
    STATE.user = user;
    el('who').textContent = user.name;
    await refreshCounts();
    await show('overview');
  }catch(e){ /* redirected to login */ }
})();
