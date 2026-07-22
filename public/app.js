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

// ============================================================
//  SITE ATTENDANCE — live, talks to /api/attendance
// ============================================================
let ATT_SITE = 0; // 0 = all sites
const fmtTime = t => t ? new Date(t).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '—';
const attTag = t => t==='staff' ? '<span class="pill ok" style="font-size:9px;padding:2px 7px">GRS</span>'
  : t==='subbie' ? '<span class="pill warn" style="font-size:9px;padding:2px 7px">Sub</span>'
  : '<span class="pill" style="font-size:9px;padding:2px 7px;background:var(--paper);color:var(--muted)">Visitor</span>';

// One-shot device position. Resolves null on denial/timeout — never blocks the action.
function getPos(timeoutMs=6000){
  return new Promise(resolve=>{
    if(!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p=>resolve({lat:p.coords.latitude, lng:p.coords.longitude, acc:Math.round(p.coords.accuracy)}),
      ()=>resolve(null),
      {enableHighAccuracy:true, timeout:timeoutMs, maximumAge:30000}
    );
  });
}

function locPill(a){
  if(a.in_lat==null) return '<span class="pill" style="background:var(--paper);color:var(--muted)">No location</span>';
  if(a.in_dist_m==null) return '<span class="pill ok">📍 Recorded</span>';
  const d = a.in_dist_m;
  const label = d>=1000 ? (d/1000).toFixed(1)+'km' : d+'m';
  return d<=400 ? `<span class="pill ok">📍 ${label} from site</span>`
                : `<span class="pill warn">📍 ${label} from site</span>`;
}


// Monday of the current week, YYYY-MM-DD
function weekStart(){
  const d = new Date();
  const day = (d.getDay()+6)%7;   // Mon=0
  d.setDate(d.getDate()-day);
  return d.toISOString().slice(0,10);
}

const REFUSAL_REASONS = {
  too_far:   { label: 'Too far from site', cls: 'bad' },
  no_gps:    { label: 'Location refused/off', cls: 'warn' },
  no_photo:  { label: 'No photo', cls: 'warn' },
  device_open:{ label: 'Phone already in use', cls: 'warn' },
  already_in:{ label: 'Already signed in', cls: 'na' },
  no_location:{ label: 'Site had no datum', cls: 'na' }
};
function refusalsTable(rows){
  if(!rows.length) return '<div class="loading">No refused attempts — everyone who tried was at site.</div>';
  return `<table>
    <thead><tr><th>When</th><th>Name given</th><th>Reason</th><th class="num">Distance</th></tr></thead>
    <tbody>${rows.map(r=>{
      const rr = REFUSAL_REASONS[r.reason] || { label: r.reason, cls: 'na' };
      const d = new Date(r.created_at);
      const dist = r.dist_m==null ? '—' : r.dist_m>=1000 ? (r.dist_m/1000).toFixed(1)+'km' : r.dist_m+'m';
      return `<tr>
        <td style="font-family:var(--mono);font-size:12px">${d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})} ${d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td>
        <td><div class="site-name" style="font-size:13.5px">${esc(r.name||'(no name)')}</div>
          <div class="site-meta">${esc(r.company||'')}${ATT_SITE?'':((r.company?' · ':'')+(r.site_ref||''))}</div></td>
        <td><span class="pill ${rr.cls==='na'?'':rr.cls}" style="${rr.cls==='na'?'background:var(--paper);color:var(--muted)':''}">${rr.label}</span></td>
        <td class="num" style="font-family:var(--mono);font-size:12.5px;color:${r.reason==='too_far'?'var(--bad)':'var(--muted)'}">${dist}</td>
      </tr>`;
    }).join('')}</tbody></table>
  <p class="cap" style="margin:12px 0 0">Every refused link/kiosk sign-in is recorded with reason and distance. Repeated "too far" attempts by the same name tell their own story.</p>`;
}

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
function weekTable(rows){
  if(!rows.length) return '<div class="loading">No attendance in this week.</div>';
  const start = new Date((el('wk_start')?el('wk_start').value:weekStart())+'T00:00:00');
  const people = {};
  let anyOpen = false;
  rows.forEach(r=>{
    const key = r.name + '||' + (r.company||'');
    people[key] = people[key] || { name:r.name, company:r.company, days:[0,0,0,0,0,0,0], open:false };
    const idx = Math.floor((new Date(r.in_at) - start) / 86400000);
    if(idx>=0 && idx<7){
      if(r.hours != null) people[key].days[idx] += r.hours;
      else { people[key].open = true; anyOpen = true; }
    }
  });
  const body = Object.values(people).sort((a,b)=>a.name.localeCompare(b.name)).map(p=>{
    const total = p.days.reduce((a,b)=>a+b,0);
    return `<tr><td><div class="site-name">${esc(p.name)}${p.open?' <span class="pill bad" style="font-size:9px;padding:2px 7px">Not signed out</span>':''}</div>
      <div class="site-meta">${esc(p.company||'')}</div></td>
      ${p.days.map(h=>`<td class="num" style="font-family:var(--mono);font-size:12.5px;color:${h?'var(--ink)':'var(--faint)'}">${h?h.toFixed(2):'·'}</td>`).join('')}
      <td class="num" style="font-family:var(--mono);font-weight:700">${total.toFixed(2)}</td></tr>`;
  }).join('');
  return `<div style="overflow-x:auto"><table>
    <thead><tr><th>Person</th>${DAYS.map(d=>`<th class="num">${d}</th>`).join('')}<th class="num">Total hrs</th></tr></thead>
    <tbody>${body}</tbody></table></div>
    ${anyOpen?'<p class="cap" style="margin:12px 0 0">Rows marked "Not signed out" have an open sign-in — those hours are missing until they\'re signed out.</p>':''}`;
}

async function vAttendance(){
  if(!STATE.sites.length) STATE.sites = await api('/sites');
  const q = ATT_SITE ? ('?site_id='+ATT_SITE) : '';
  const wkS = el('wk_start') ? el('wk_start').value : weekStart();
  const [sum, on, today, week, refusals] = await Promise.all([
    api('/attendance/summary'+q),
    api('/attendance/on-site'+q),
    api('/attendance/today'+q),
    api('/attendance/week?start='+wkS+(ATT_SITE?('&site_id='+ATT_SITE):'')),
    api('/attendance/refusals?days=7'+(ATT_SITE?('&site_id='+ATT_SITE):''))
  ]);
  const siteOpts = `<option value="0">All sites</option>` + STATE.sites.map(s=>
    `<option value="${s.id}" ${s.id===ATT_SITE?'selected':''}>${s.ref} — ${esc(s.name)}</option>`).join('');

  const onHtml = on.length ? `<table>
    <thead><tr><th></th><th>Name</th><th>Company / role</th><th class="num">Signed in</th><th>Location</th><th>Induction</th><th class="num">Action</th></tr></thead>
    <tbody>${on.map(a=>`<tr>
      <td style="width:52px">${a.has_photo
        ? `<img src="/api/attendance/${a.id}/photo" alt="" style="width:42px;height:42px;object-fit:cover;border-radius:9px;cursor:pointer;border:1px solid var(--line)" onclick="photoModal(${a.id},'${esc(a.name)}')">`
        : `<div style="width:42px;height:42px;border-radius:9px;background:var(--paper);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--faint)">—</div>`}</td>
      <td><div class="site-name">${esc(a.name)} ${attTag(a.type)}</div>
        <div class="site-meta">${ATT_SITE?'':(a.site_ref+' · ')}in ${fmtTime(a.in_at)}</div></td>
      <td style="font-size:12.5px;color:var(--muted)">${esc(a.company||'—')}<br>${esc(a.role||'')}</td>
      <td class="num" style="font-family:var(--mono);font-size:12.5px">${fmtTime(a.in_at)}</td>
      <td>${locPill(a)}</td>
      <td>${a.inducted?'<span class="pill ok">Valid</span>':'<span class="pill bad">Not inducted</span>'}</td>
      <td class="num"><button class="btn-sm" onclick="attSignOut(${a.id},'${esc(a.name)}')">Sign out</button></td>
    </tr>`).join('')}</tbody></table>`
    : `<div class="loading">Nobody currently signed in${ATT_SITE?' on this site':''}.</div>`;

  const todayHtml = today.length ? `<table>
    <thead><tr><th>Name</th><th>Company</th><th class="num">In</th><th class="num">Out</th></tr></thead>
    <tbody>${today.map(a=>`<tr>
      <td class="site-name">${esc(a.name)} ${attTag(a.type)}</td>
      <td style="font-size:12.5px;color:var(--muted)">${esc(a.company||'—')}</td>
      <td class="num" style="font-family:var(--mono);font-size:12.5px">${fmtTime(a.in_at)}</td>
      <td class="num" style="font-family:var(--mono);font-size:12.5px;color:${a.out_at?'var(--ink)':'var(--ok)'}">${a.out_at?fmtTime(a.out_at):'on site'}</td>
    </tr>`).join('')}</tbody></table>`
    : `<div class="loading">No attendance today${ATT_SITE?' on this site':''} yet.</div>`;

  return `
  <div class="sec"><div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
    <select id="att_site" style="font-family:inherit;font-size:14px;border:1px solid var(--line);background:#fff;border-radius:9px;padding:10px 13px;color:var(--ink);font-weight:600;min-width:240px"
      onchange="ATT_SITE=Number(this.value);show('attendance')">${siteOpts}</select>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${ATT_SITE?`<button class="btn-ghost" onclick="copySigninLink()">🔗 Copy sign-in link</button>
      <button class="btn-ghost" onclick="copyKioskLink()">📱 Copy tablet (kiosk) link</button>
      <button class="btn-ghost" onclick="setSiteLocation()">📍 Set site location here</button>`:''}
    </div>
  </div>
  ${ATT_SITE && !STATE.sites.find(s=>s.id===ATT_SITE)?.lat ? `<p style="font-size:12px;color:var(--muted);margin:10px 0 0">No saved location for this site yet — sign-ins record GPS but can't show distance. Stand on site and tap "Set site location here" once.</p>`:''}
  </div>
  <div class="sec"><div class="grid g4">
    <div class="stat accent"><div class="k">On site now</div><div class="v">${sum.on_site}</div>
      <div class="foot">${ATT_SITE?'On this site':'Across all sites'}</div></div>
    <div class="stat"><div class="k">GRS staff</div><div class="v">${sum.staff}</div>
      <div class="foot">Directly employed</div></div>
    <div class="stat"><div class="k">Subbies &amp; visitors</div><div class="v">${sum.others}</div>
      <div class="foot">Signed on today</div></div>
    <div class="stat"><div class="k">Induction flags</div>
      <div class="v" style="color:${sum.not_inducted?'var(--grs)':'var(--ink)'}">${sum.not_inducted}</div>
      <div class="foot">${sum.not_inducted?'On site without induction':'All inducted'}</div></div>
  </div></div>
  <div class="sec"><div class="sec-head"><h2>On site now</h2><span class="rule"></span></div>
    <div class="card">${onHtml}</div></div>
  <div class="sec"><div class="sec-head"><h2>Today's log</h2><span class="rule"></span></div>
    <div class="card">${todayHtml}</div></div>
  <div class="sec"><div class="sec-head"><h2>Weekly log · for billing</h2><span class="rule"></span></div>
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        <label style="font-size:12px;font-weight:700">Week starting
          <input type="date" id="wk_start" value="${wkS}" onchange="show('attendance')"
            style="font-family:inherit;font-size:13px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin-left:8px">
        </label>
        <a class="btn-ghost" style="text-decoration:none" href="/api/attendance/week?start=${wkS}&${ATT_SITE?('site_id='+ATT_SITE+'&'):''}format=csv">⬇ Download CSV</a>
      </div>
      <div id="wk_table">${weekTable(week)}</div>
    </div>
  </div>
  <div class="sec"><div class="sec-head"><h2>Refused attempts · last 7 days</h2><span class="rule"></span></div>
    <div class="card">${refusalsTable(refusals)}</div>
  </div>`;
}

// Portal sign-in removed by design — all sign-ins are self-service
// via the personal or kiosk link: geofenced + photographed, no vouching.

async function attSignOut(id, name){
  const pos = await getPos(3000);
  try{
    await api('/attendance/'+id+'/sign-out', { method:'POST', body:{ lat: pos?.lat, lng: pos?.lng } });
    toast(`${name} signed out`);
    await show('attendance'); refreshCounts();
  }catch(e){ toast(e.message); }
}



function photoModal(id, name){
  openModal(`
    <h3>${name} — sign-in photo</h3>
    <img src="/api/attendance/${id}/photo" style="width:100%;border-radius:12px;margin:6px 0 4px" alt="Sign-in photo">
    <p style="font-size:12px;color:var(--muted);margin:8px 0 0">Taken at the moment of sign-in, with location and time.</p>
    <div class="modal-act"><button class="btn-ghost" onclick="closeModal()">Close</button></div>`);
}

function copyKioskLink(){
  const site = STATE.sites.find(s=>s.id===ATT_SITE);
  if(!site) return;
  if(!site.kiosk_token){ toast('Run the database update first — no kiosk token yet'); return; }
  if(!site.lat){ toast('Set the site location first'); return; }
  const url = location.origin + '/signin.html?k=' + site.kiosk_token;
  navigator.clipboard.writeText(url).then(
    ()=>toast(site.ref + ' kiosk link copied — put this on the site tablet ONLY'),
    ()=>prompt('Copy this link:', url)
  );
}

function copySigninLink(){
  const site = STATE.sites.find(s=>s.id===ATT_SITE);
  if(!site) return;
  if(!site.signin_token){ toast('Run the database update first — no link token yet'); return; }
  if(!site.lat){ toast('Set the site location first — the link refuses sign-ins without it'); return; }
  const url = location.origin + '/signin.html?t=' + site.signin_token;
  navigator.clipboard.writeText(url).then(
    ()=>toast(site.ref + ' sign-in link copied — send it to the crew'),
    ()=>prompt('Copy this link:', url)
  );
}

async function setSiteLocation(){
  const site = STATE.sites.find(s=>s.id===ATT_SITE);
  if(!site) return;
  toast('Getting position…');
  const pos = await getPos(10000);
  if(!pos){ toast('Could not get a location — allow location access and try again'); return; }
  try{
    await api('/attendance/site-location', { method:'POST', body:{ site_id: ATT_SITE, lat: pos.lat, lng: pos.lng } });
    site.lat = pos.lat; site.lng = pos.lng;
    toast(`${site.ref} location saved (±${pos.acc}m)`);
    await show('attendance');
  }catch(e){ toast(e.message); }
}

const VIEWS = {
  overview:{t:"Dashboard", c:"Safety overview · all active sites", r:vOverview},
  audits:{t:"Audits", c:"Findings, actions and compliance scores", r:vAudits},
  attendance:{t:"Site attendance", c:"Who's on site · sign in & out", r:vAttendance},
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
  try{
    const s = await api('/attendance/summary');
    const c = document.getElementById('ct-attendance');
    if(c) c.textContent = s.on_site;
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
