/* ============================================================
   AI Initiatives Portfolio — application logic
   - Password gate -> role (editor / viewer) via /api/auth
   - Data via /api/data (GET / PUT full save / POST comment)
   - All edits are staged in a local working copy; nothing
     persists until the editor clicks Save Changes.
   ============================================================ */
'use strict';

/* ---------------- constants ---------------- */
const STATUSES = [
  { key: 'in-progress',    label: 'In Progress',    c: 'var(--c-progress)',  bg: 'var(--bg-progress)' },
  { key: 'in-development', label: 'In Development', c: 'var(--c-dev)',       bg: 'var(--bg-dev)' },
  { key: 'testing',        label: 'Testing',        c: 'var(--c-testing)',   bg: 'var(--bg-testing)' },
  { key: 'on-hold',        label: 'On Hold',        c: 'var(--c-hold)',      bg: 'var(--bg-hold)' },
  { key: 'completed',      label: 'Completed',      c: 'var(--c-done)',      bg: 'var(--bg-done)' },
  { key: 'cancelled',      label: 'Cancelled',      c: 'var(--c-cancelled)', bg: 'var(--bg-cancelled)' },
  { key: 'backlog',        label: 'Backlog',        c: 'var(--c-backlog)',   bg: 'var(--bg-backlog)' }
];
const TIMELINE_STATUSES = STATUSES.filter(s => s.key !== 'backlog');
const KEY_STORE = 'portfolioKey';
const ROLE_STORE = 'portfolioRole';
const NAME_STORE = 'portfolioCommenterName';
const MONTH_W = 86;     /* px per monthly column */
const QUARTER_W = 112;  /* px per quarterly column */
const LABEL_W = 250;    /* px sticky label column */

/* ---------------- state ---------------- */
let session = { key: null, role: null };
let serverData = null;   /* last loaded/saved server state */
let working = null;      /* staged working copy */
let changeCount = 0;
let storageOk = true;
let panelProjectId = null;
let openCats = new Set();   /* category ids expanded in the list */
let backlogOpen = false;
let statusFilter = new Set(TIMELINE_STATUSES.map(s => s.key));
let deptFilter = 'all';
let modalCb = null;
let firstPaint = true;
const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- helpers ---------------- */
const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
const clone = o => JSON.parse(JSON.stringify(o));
const gid = p => (p || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
const stat = k => STATUSES.find(s => s.key === k) || STATUSES[0];
function parseDate(s) {
  if (!s || !/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}
function fmtDate(s) {
  const d = parseDate(s);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtShort(s) {
  const d = parseDate(s);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}
function isScheduled(p) {
  const a = parseDate(p.startDate), b = parseDate(p.endDate);
  return a && b && b >= a;
}
function allProjects(data) {
  const out = [];
  (data.categories || []).forEach(c => (c.projects || []).forEach(p => out.push({ cat: c, p })));
  return out;
}
function findProject(data, id) {
  for (const c of (data.categories || []))
    for (const p of (c.projects || []))
      if (p.id === id) return { cat: c, p };
  return null;
}
function toast(msg, ok = true) {
  $('toastIcon').innerHTML = ok
    ? '<svg class="ok" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg class="err" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  $('toastMsg').textContent = msg;
  const t = $('toast');
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------------- modal (prompt / confirm) ---------------- */
function promptModal(title, placeholder, okLabel, cb, initial) {
  $('modalTitle').textContent = title;
  $('modalText').style.display = 'none';
  const inp = $('modalInput');
  inp.style.display = 'block';
  inp.placeholder = placeholder || '';
  inp.value = initial || '';
  $('modalOk').textContent = okLabel || 'OK';
  modalCb = () => { const v = inp.value.trim(); if (!v) return false; cb(v); return true; };
  $('modalOverlay').classList.add('show');
  setTimeout(() => inp.focus(), 30);
}
function confirmModal(title, text, okLabel, cb) {
  $('modalTitle').textContent = title;
  const t = $('modalText');
  t.style.display = 'block';
  t.textContent = text;
  $('modalInput').style.display = 'none';
  $('modalOk').textContent = okLabel || 'Confirm';
  modalCb = () => { cb(); return true; };
  $('modalOverlay').classList.add('show');
}
function closeModal() { $('modalOverlay').classList.remove('show'); modalCb = null; }

/* ---------------- API ---------------- */
async function api(method, body) {
  const res = await fetch('/api/data', {
    method,
    headers: { 'Content-Type': 'application/json', 'x-portfolio-key': session.key || '' },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) { signOut(); }
    throw new Error(json.error || ('Request failed (' + res.status + ')'));
  }
  return json;
}

/* ---------------- auth flow ---------------- */
async function tryEnter(password) {
  const btn = $('lockBtn'), err = $('lockError');
  btn.disabled = true; err.textContent = '';
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Sign-in failed.');
    session = { key: password, role: json.role };
    sessionStorage.setItem(KEY_STORE, password);
    sessionStorage.setItem(ROLE_STORE, json.role);
    await loadData();
    showApp();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}
function signOut() {
  sessionStorage.removeItem(KEY_STORE);
  sessionStorage.removeItem(ROLE_STORE);
  session = { key: null, role: null };
  serverData = working = null;
  changeCount = 0;
  closePanel(true);
  $('app').style.display = 'none';
  $('lockScreen').style.display = 'flex';
  $('lockInput').value = '';
}
function showApp() {
  $('lockScreen').style.display = 'none';
  $('app').style.display = 'block';
  const editor = session.role === 'editor';
  const badge = $('roleBadge');
  badge.className = 'role-badge ' + (editor ? 'role-editor' : 'role-viewer');
  $('roleText').textContent = editor ? 'Editor' : 'View only';
  renderAll();
  setTimeout(() => { firstPaint = false; }, 1200);
}

async function loadData() {
  const res = await api('GET');
  serverData = res.data;
  storageOk = res.storage !== false;
  session.role = res.role || session.role;
  working = clone(serverData);
  changeCount = 0;
  if (openCats.size === 0) (working.categories || []).forEach(c => {
    if ((c.projects || []).some(p => p.status !== 'backlog')) openCats.add(c.id);
  });
}

/* ---------------- change staging ---------------- */
function markDirty() {
  changeCount++;
  renderSaveBar();
}
function renderSaveBar() {
  const bar = $('savebar');
  $('changeCount').textContent = changeCount;
  bar.classList.toggle('show', changeCount > 0 && session.role === 'editor');
}
async function saveChanges() {
  const btn = $('saveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await api('PUT', working);
    serverData = res.data;
    working = clone(serverData);
    changeCount = 0;
    renderAll();
    toast('Changes saved');
  } catch (e) {
    toast(e.message, false);
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes';
    renderSaveBar();
  }
}
function discardChanges() {
  confirmModal('Discard changes', 'Revert ' + changeCount + ' staged change(s) to the last saved version?', 'Discard', () => {
    working = clone(serverData);
    changeCount = 0;
    closePanel(true);
    renderAll();
    toast('Changes discarded');
  });
}

/* ---------------- render: top level ---------------- */
function renderAll(keepPanel) {
  renderHeaderMeta();
  renderKpis();
  renderFilters();
  renderMilestoneRail();
  renderGantt();
  renderList();
  renderBacklog();
  renderSaveBar();
  $('storageBanner').style.display = storageOk ? 'none' : 'flex';
  if (!keepPanel && panelProjectId) renderPanel();
}
function renderHeaderMeta() {
  const ts = working && working.updatedAt;
  $('lastUpdated').textContent = ts
    ? 'Last saved ' + new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'No saved revisions yet';
}

/* ---------------- KPIs ---------------- */
function countUp(el, target) {
  if (reducedMotion || !firstPaint) { el.textContent = target; return; }
  const t0 = performance.now(), dur = 900;
  (function f(t) {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(f);
  })(t0);
}
function renderKpis() {
  const counts = {};
  STATUSES.forEach(s => counts[s.key] = 0);
  allProjects(working).forEach(({ p }) => { if (counts[p.status] != null) counts[p.status]++; });
  const total = allProjects(working).length;
  const inMotion = counts['in-progress'] + counts['in-development'] + counts['testing'];

  /* donut geometry */
  const R = 34, C = 2 * Math.PI * R;
  let acc = 0;
  const segs = STATUSES.filter(s => counts[s.key] > 0).map(s => {
    const frac = counts[s.key] / (total || 1);
    const seg = { c: s.c, frac, off: acc };
    acc += frac;
    return seg;
  });
  const donut =
    '<svg class="donut" width="86" height="86" viewBox="0 0 86 86">' +
    '<circle class="track" cx="43" cy="43" r="' + R + '" fill="none" stroke-width="9"></circle>' +
    segs.map(s =>
      '<circle class="seg" cx="43" cy="43" r="' + R + '" fill="none" stroke="' + s.c + '" stroke-width="9" stroke-linecap="butt"' +
      ' stroke-dasharray="0 ' + C + '" data-final="' + (Math.max(s.frac * C - 1.5, 0)) + ' ' + C + '"' +
      ' stroke-dashoffset="' + (-s.off * C) + '" transform="rotate(-90 43 43)"></circle>').join('') +
    '</svg>';

  const hero =
    '<div class="kpi kpi-hero">' + donut +
    '<div><div class="kpi-num" id="kpiTotal">0</div>' +
    '<div class="kpi-label">Initiatives</div>' +
    '<div class="hero-sub"><b>' + inMotion + '</b> in motion &middot; <button class="hero-backlog" id="heroBacklog"><b>' + counts['backlog'] + '</b> in pipeline</button></div>' +
    '</div></div>';

  $('kpis').innerHTML = hero + STATUSES.filter(s =>
    s.key !== 'backlog' && !(s.key === 'cancelled' && counts.cancelled === 0)
  ).map(s => {
    const on = statusFilter.size === 1 && statusFilter.has(s.key);
    return '<button class="kpi' + (on ? ' kpi-on' : '') + '" style="--kc:' + s.c + '" data-kpi="' + s.key + '">' +
      '<div class="kpi-num">' + counts[s.key] + '</div>' +
      '<div class="kpi-label"><span class="dot"></span>' + s.label + '</div></button>';
  }).join('');
  countUp($('kpiTotal'), total);
  const hb = $('heroBacklog');
  if (hb) hb.addEventListener('click', () => {
    backlogOpen = true;
    renderBacklog();
    $('backlogCard').scrollIntoView({ block: 'start' });
  });
  /* sweep the donut in (Web Animations API — deterministic) */
  $('kpis').querySelectorAll('.donut .seg').forEach((el, i) => {
    const C2 = 2 * Math.PI * 34;
    el.setAttribute('stroke-dasharray', el.dataset.final);
    if (!reducedMotion && firstPaint && el.animate) {
      el.animate(
        [{ strokeDasharray: '0 ' + C2 }, { strokeDasharray: el.dataset.final }],
        { duration: 900, delay: i * 60, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'backwards' }
      );
    }
  });
  $('kpis').querySelectorAll('[data-kpi]').forEach(el => el.addEventListener('click', () => {
    const k = el.dataset.kpi;
    if (k === 'backlog') {
      backlogOpen = true;
      renderBacklog();
      $('backlogCard').scrollIntoView({ block: 'start' });
      return;
    }
    /* toggle exclusive filter */
    if (statusFilter.size === 1 && statusFilter.has(k)) statusFilter = new Set(TIMELINE_STATUSES.map(s => s.key));
    else statusFilter = new Set([k]);
    renderAll(true);
  }));
}

/* ---------------- upcoming milestones rail ---------------- */
function renderMilestoneRail() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoffPast = new Date(today); cutoffPast.setDate(cutoffPast.getDate() - 21);
  const items = [];
  allProjects(working).forEach(({ cat, p }) => {
    if (p.status === 'backlog' || p.status === 'cancelled' || p.status === 'completed') return;
    if (deptFilter !== 'all' && cat.id !== deptFilter) return;
    (p.milestones || []).forEach(m => {
      const d = parseDate(m.date);
      if (!m.done && d && d >= cutoffPast) items.push({ cat, p, m, d });
    });
  });
  items.sort((a, b) => a.d - b.d);
  const top = items.slice(0, 6);
  const card = $('msRailCard');
  if (!top.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  $('msRail').innerHTML = top.map((it, i) => {
    const s = stat(it.p.status);
    const days = Math.round((it.d - today) / 86400000);
    let cls = 'msr-when', when;
    if (days < 0) { cls += ' overdue'; when = Math.abs(days) + 'd overdue'; }
    else if (days === 0) when = 'today';
    else if (days <= 30) when = 'in ' + days + 'd';
    else { cls += ' far'; when = 'in ' + days + 'd'; }
    return '<div class="msr-card' + (firstPaint && !reducedMotion ? ' anim' : '') + '" data-open="' + it.p.id + '" style="animation-delay:' + (i * 70) + 'ms">' +
      '<div class="msr-top"><span class="' + cls + '">' + when + '</span><span class="msr-date">' + fmtDate(it.m.date) + '</span></div>' +
      '<div class="msr-label">' + esc(it.m.label) + '</div>' +
      '<div class="msr-proj"><span class="dot" style="background:' + s.c + '"></span>' + esc(it.p.name) + ' &middot; ' + esc(it.cat.name) + '</div></div>';
  }).join('');
  $('msRail').querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openPanel(el.dataset.open)));
}

/* ---------------- filters ---------------- */
function renderFilters() {
  const deptOpts = ['<option value="all">All departments</option>']
    .concat((working.categories || []).map(c =>
      '<option value="' + esc(c.id) + '"' + (deptFilter === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'));
  $('filterbar').innerHTML =
    '<span class="filterbar-label">Status</span>' +
    TIMELINE_STATUSES.map(s => {
      const filtering = statusFilter.size < TIMELINE_STATUSES.length;
      const on = filtering && statusFilter.has(s.key);
      return '<button class="chip' + (on ? ' chip-on' : '') + '" style="--cc:' + s.c + ';--cbg:' + s.bg + '" data-chip="' + s.key + '"><span class="dot"></span>' + s.label + '</button>';
    }).join('') +
    '<select class="dept-select" id="deptSelect">' + deptOpts.join('') + '</select>' +
    '<button class="filter-reset" id="filterReset">Reset filters</button>';
  $('filterbar').querySelectorAll('[data-chip]').forEach(el => el.addEventListener('click', () => {
    const k = el.dataset.chip;
    const all = TIMELINE_STATUSES.map(s => s.key);
    if (statusFilter.size === all.length) statusFilter = new Set([k]);          /* unfiltered -> focus one */
    else if (statusFilter.has(k)) { statusFilter.delete(k); if (statusFilter.size === 0) statusFilter = new Set(all); }
    else statusFilter.add(k);
    renderAll(true);
  }));
  $('deptSelect').addEventListener('change', e => { deptFilter = e.target.value; renderAll(true); });
  $('filterReset').addEventListener('click', () => {
    statusFilter = new Set(TIMELINE_STATUSES.map(s => s.key));
    deptFilter = 'all';
    renderAll(true);
  });
}
function passesFilter(cat, p) {
  if (p.status === 'backlog') return false;
  if (!statusFilter.has(p.status)) return false;
  if (deptFilter !== 'all' && cat.id !== deptFilter) return false;
  return true;
}

/* ---------------- Gantt time scale ----------------
   Monthly columns: current month through the end of (current quarter + 2).
   Quarterly columns: the following 4 quarters.                     */
function buildScale() {
  const now = new Date();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const qEndMonth = (Math.floor(now.getMonth() / 3) + 3) * 3;       /* exclusive month index of monthly window end */
  const monthlyEnd = new Date(now.getFullYear(), qEndMonth, 1);
  const cols = [];
  let x = 0;
  for (let d = new Date(mStart); d < monthlyEnd; d.setMonth(d.getMonth() + 1)) {
    const t0 = new Date(d), t1 = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    cols.push({ kind: 'm', t0, t1, x, w: MONTH_W, label: t0.toLocaleDateString('en-US', { month: 'short' }) + (t0.getMonth() === 0 || cols.length === 0 ? ' ’' + String(t0.getFullYear()).slice(2) : '') });
    x += MONTH_W;
  }
  let q = new Date(monthlyEnd);
  for (let i = 0; i < 4; i++) {
    const t0 = new Date(q), t1 = new Date(q.getFullYear(), q.getMonth() + 3, 1);
    cols.push({ kind: 'q', t0, t1, x, w: QUARTER_W, label: 'Q' + (Math.floor(t0.getMonth() / 3) + 1) + ' ’' + String(t0.getFullYear()).slice(2) });
    x = x + QUARTER_W;
    q = t1;
  }
  const total = x;
  const tMin = cols[0].t0, tMax = cols[cols.length - 1].t1;
  function xOf(date) {
    if (date <= tMin) return 0;
    if (date >= tMax) return total;
    for (const c of cols) {
      if (date >= c.t0 && date < c.t1) {
        return c.x + c.w * ((date - c.t0) / (c.t1 - c.t0));
      }
    }
    return total;
  }
  /* quarter header groups */
  const qgroups = [];
  cols.forEach(c => {
    const qk = c.t0.getFullYear() + '-Q' + (Math.floor(c.t0.getMonth() / 3) + 1);
    const last = qgroups[qgroups.length - 1];
    if (last && last.key === qk) last.w += c.w;
    else qgroups.push({ key: qk, w: c.w, label: 'Q' + (Math.floor(c.t0.getMonth() / 3) + 1) + ' ' + c.t0.getFullYear() });
  });
  return { cols, total, tMin, tMax, xOf, qgroups, now };
}

/* ---------------- Gantt render ---------------- */
function renderGantt() {
  const scale = buildScale();
  const g = $('gantt');
  g.style.setProperty('--labelw', LABEL_W + 'px');

  const cats = (working.categories || []).filter(c => deptFilter === 'all' || c.id === deptFilter);
  let shown = 0;
  let html = '';

  /* quarter-condensed region geometry (for the tint) */
  const firstQCol = scale.cols.find(c => c.kind === 'q');
  const qRegionX = firstQCol ? firstQCol.x : null;
  const todayX = scale.xOf(scale.now);
  const todayVisible = todayX > 0 && todayX < scale.total;

  /* axis: quarter row + month row; quarter columns have no month label */
  html += '<div class="g-axis"><div class="g-axis-label"></div><div class="g-axis-cols" style="width:' + scale.total + 'px">' +
    '<div class="g-qrow">' + scale.qgroups.map(q => '<div class="g-q" style="width:' + q.w + 'px">' + q.label + '</div>').join('') + '</div>' +
    '<div class="g-mrow">' + scale.cols.map(c => '<div class="g-m" style="width:' + c.w + 'px">' + (c.kind === 'q' ? '' : c.label) + '</div>').join('') + '</div>' +
    '</div></div>';

  /* body: one shared overlay (grid + quarter tint + today line) spans every row,
     so columns and the today line stay continuous and perfectly aligned */
  html += '<div class="g-body">';
  html += '<div class="g-overlay" style="left:' + LABEL_W + 'px;width:' + scale.total + 'px">' +
    (qRegionX != null ? '<div class="g-qtint" style="left:' + qRegionX + 'px;width:' + (scale.total - qRegionX) + 'px"></div>' : '') +
    scale.cols.map(c => '<div class="g-gridline' + (c.t0.getMonth() % 3 === 0 ? ' qline' : '') + '" style="left:' + c.x + 'px"></div>').join('') +
    '<div class="g-gridline qline" style="left:' + (scale.total - 1) + 'px"></div>' +
    '</div>';
  /* today marker sits in its own overlay ABOVE rows and category bands,
     so the line is continuous top-to-bottom and the tag is never hidden */
  if (todayVisible) {
    html += '<div class="g-overlay g-overlay-top" style="left:' + LABEL_W + 'px;width:' + scale.total + 'px">' +
      '<div class="g-todayline" style="left:' + todayX + 'px"></div>' +
      '<div class="g-today-tag" style="left:' + (todayX + 4) + 'px">Today</div></div>';
  }

  let unschedCount = 0;
  let rowIdx = 0;
  const anim = firstPaint && !reducedMotion;
  cats.forEach(cat => {
    const scheduled = (cat.projects || []).filter(p => passesFilter(cat, p) && isScheduled(p));
    unschedCount += (cat.projects || []).filter(p => passesFilter(cat, p) && !isScheduled(p)).length;
    if (!scheduled.length) return;          /* the timeline shows committed work only */
    shown += scheduled.length;

    html += '<div class="g-catrow"><div class="g-catlabel">' + esc(cat.name) + '</div><div class="g-catlane"></div></div>';

    scheduled.forEach(p => {
      const s = stat(p.status);
      const a = parseDate(p.startDate), b = parseDate(p.endDate);
      const dim = (p.status === 'completed' || p.status === 'cancelled') ? ' dim' : '';
      let barHtml = '';
      const tip = esc(p.name) + ' — ' + s.label + ' (' + fmtShort(p.startDate) + ' to ' + fmtShort(p.endDate) + ')';
      if (b < scale.tMin) {
        barHtml = '<button class="g-outside left" data-open="' + p.id + '" style="border-color:' + s.c + ';color:' + s.c + '" title="' + tip + '">&#9666; ended ' + fmtShort(p.endDate) + '</button>';
      } else if (a > scale.tMax) {
        barHtml = '<button class="g-outside right" data-open="' + p.id + '" style="border-color:' + s.c + ';color:' + s.c + '" title="' + tip + '">starts ' + fmtShort(p.startDate) + ' &#9656;</button>';
      } else {
        const x0 = scale.xOf(a), x1 = Math.max(scale.xOf(b), x0 + 10);
        const w = x1 - x0;
        const fadeL = a < scale.tMin, fadeR = b > scale.tMax;
        const approxLabelW = p.name.length * 6.3 + 20;        /* rough text width */
        const msXs = (p.milestones || [])
          .map(m => parseDate(m.date)).filter(d => d && d >= scale.tMin && d <= scale.tMax)
          .map(d => scale.xOf(d));
        const msOnLabel = msXs.some(mx => mx >= x0 - 6 && mx <= x0 + approxLabelW + 8);
        const labelInside = w >= approxLabelW && !msOnLabel;
        let outLabel = '';
        if (!labelInside) {
          if (x1 + 8 + approxLabelW <= scale.total) {
            outLabel = '<span class="g-barlabel-out" style="left:' + (x1 + 8) + 'px">' + esc(p.name) + '</span>';
          } else {
            outLabel = '<span class="g-barlabel-out" style="right:' + (scale.total - x0 + 8) + 'px">' + esc(p.name) + '</span>';
          }
        }
        barHtml = '<div class="g-bar' + (fadeL ? ' fade-l' : '') + (fadeR ? ' fade-r' : '') + dim + (anim ? ' anim' : '') + '" data-open="' + p.id + '"' +
          ' style="left:' + x0 + 'px;width:' + w + 'px;background:' + s.c + ';animation-delay:' + (rowIdx * 55) + 'ms" title="' + tip + '">' +
          (labelInside ? '<span class="g-barlabel">' + esc(p.name) + '</span>' : '') + '</div>' + outLabel;
        (p.milestones || []).forEach(m => {
          const md = parseDate(m.date);
          if (!md || md < scale.tMin || md > scale.tMax) return;
          barHtml += '<div class="g-ms' + (m.done ? ' ms-done' : '') + (anim ? ' anim' : '') + '" data-open="' + p.id + '" style="left:' + scale.xOf(md) + 'px" title="' + esc(m.label) + ' — ' + fmtDate(m.date) + (m.done ? ' (complete)' : '') + '"></div>';
        });
      }
      rowIdx++;
      html += '<div class="g-row"><div class="g-rowlabel" data-open="' + p.id + '" title="' + esc(p.name) + '"><span class="g-rowdot" style="background:' + s.c + '"></span><span class="g-rowname">' + esc(p.name) + '</span></div>' +
        '<div class="g-rowlane" data-open="' + p.id + '" style="width:' + scale.total + 'px">' + barHtml + '</div></div>';
    });

  });
  html += '</div>';

  $('unschedNote').textContent = unschedCount
    ? unschedCount + ' active initiative(s) have no committed dates yet — find them under Projects.'
    : '';
  if (!shown) {
    g.innerHTML = '<div class="gantt-empty">Nothing scheduled under the current filters. Add start and end dates to a project to plot it here.</div>';
    $('ganttCount').textContent = '0';
    return;
  }
  g.innerHTML = html;
  $('ganttCount').textContent = shown;

  g.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation();
    openPanel(el.dataset.open);
  }));
}

/* ---------------- project list ---------------- */
function renderList() {
  const editor = session.role === 'editor';
  $('listActions').innerHTML = editor
    ? '<button class="btn btn-sm" id="addCatBtn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add Department</button>'
    : '';
  if (editor) $('addCatBtn').addEventListener('click', () =>
    promptModal('Add department', 'Department name', 'Add', name => {
      working.categories.push({ id: gid('cat'), name, projects: [] });
      openCats.add(working.categories[working.categories.length - 1].id);
      markDirty(); renderAll(true);
    }));

  const cats = (working.categories || []).filter(c => deptFilter === 'all' || c.id === deptFilter);
  let total = 0;
  const html = cats.map(cat => {
    const rows = (cat.projects || []).filter(p => passesFilter(cat, p));
    total += rows.length;
    const open = openCats.has(cat.id);
    const body = rows.length
      ? '<div class="p-cols-head"><span>Project</span><span>Status</span><span>Window</span><span>Stakeholders</span><span>Latest update</span></div>' +
        rows.map(p => {
          const s = stat(p.status);
          const dates = isScheduled(p)
            ? fmtShort(p.startDate) + ' → ' + fmtShort(p.endDate)
            : '<span class="unsch">Unscheduled</span>';
          return '<div class="p-row" data-open="' + p.id + '">' +
            '<div class="p-name">' + esc(p.name) + '</div>' +
            '<span class="status-badge" style="color:' + s.c + ';background:' + s.bg + '"><span class="dot"></span>' + s.label + '</span>' +
            '<div class="p-dates">' + dates + '</div>' +
            '<div class="p-meta">' + (p.stakeholders ? esc(p.stakeholders) : '<span style="color:var(--text-dim)">—</span>') + '</div>' +
            '<div class="p-summary">' + (p.updateSummary ? esc(p.updateSummary) : '<span style="font-style:italic">No update yet</span>') + '</div>' +
            '</div>';
        }).join('')
      : (() => {
          const bl = (cat.projects || []).filter(p => p.status === 'backlog').length;
          return '<div class="list-empty">No scheduled or active projects' + (bl ? ' — ' + bl + ' in the backlog' : '') + '.</div>';
        })();
    const addRow = editor
      ? '<div class="add-inline" data-addproj="' + cat.id + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add project</div>'
      : '';
    const catActions = editor
      ? '<div class="cat-actions" data-stop="1">' +
        '<button class="icon-btn" data-renamecat="' + cat.id + '" title="Rename department"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>' +
        '<button class="icon-btn danger" data-delcat="' + cat.id + '" title="Delete department"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button></div>'
      : '';
    return '<div class="cat-block' + (open ? ' open' : '') + '" data-cat="' + cat.id + '">' +
      '<div class="cat-head" data-togglecat="' + cat.id + '">' +
      '<span class="cat-chev"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></span>' +
      '<span class="cat-name">' + esc(cat.name) + '</span>' + catActions +
      '<span class="cat-count">' + rows.length + '</span></div>' +
      '<div class="cat-body">' + body + addRow + '</div></div>';
  }).join('');

  $('projectList').innerHTML = html || '<div class="list-empty" style="padding:24px 26px">No departments yet.</div>';
  $('listCount').textContent = total;

  $('projectList').querySelectorAll('[data-togglecat]').forEach(el => el.addEventListener('click', e => {
    if (e.target.closest('[data-stop]')) return;
    const id = el.dataset.togglecat;
    openCats.has(id) ? openCats.delete(id) : openCats.add(id);
    el.closest('.cat-block').classList.toggle('open');
  }));
  $('projectList').querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openPanel(el.dataset.open)));
  $('projectList').querySelectorAll('[data-addproj]').forEach(el => el.addEventListener('click', () =>
    promptModal('Add project', 'Project name', 'Add', name => {
      const cat = working.categories.find(c => c.id === el.dataset.addproj);
      cat.projects.push({ id: gid('proj'), name, status: 'in-progress', startDate: '', endDate: '', stakeholders: '', updateSummary: '', description: '', milestones: [], comments: [] });
      markDirty(); renderAll(true);
    })));
  $('projectList').querySelectorAll('[data-renamecat]').forEach(el => el.addEventListener('click', () => {
    const cat = working.categories.find(c => c.id === el.dataset.renamecat);
    promptModal('Rename department', 'Department name', 'Rename', name => { cat.name = name; markDirty(); renderAll(true); }, cat.name);
  }));
  $('projectList').querySelectorAll('[data-delcat]').forEach(el => el.addEventListener('click', () => {
    const cat = working.categories.find(c => c.id === el.dataset.delcat);
    confirmModal('Delete department', 'Delete "' + cat.name + '" and its ' + cat.projects.length + ' project(s)? This is staged until you save.', 'Delete', () => {
      working.categories = working.categories.filter(c => c.id !== cat.id);
      markDirty(); renderAll(true);
    });
  }));
}

/* ---------------- backlog ---------------- */
function renderBacklog() {
  const items = allProjects(working).filter(({ cat, p }) =>
    p.status === 'backlog' && (deptFilter === 'all' || cat.id === deptFilter));
  $('backlogCount').textContent = items.length;
  $('backlogCard').classList.toggle('open', backlogOpen);
  $('backlogBody').innerHTML = items.length
    ? items.map(({ cat, p }) =>
        '<div class="b-row" data-open="' + p.id + '">' +
        '<span class="b-dept">' + esc(cat.name) + '</span>' +
        '<span class="b-name">' + esc(p.name) + '</span>' +
        '<span class="b-summary">' + (p.description ? esc(p.description) : (p.updateSummary ? esc(p.updateSummary) : '<span style="font-style:italic">No description</span>')) + '</span></div>').join('')
    : '<div class="list-empty" style="padding:18px 26px">Nothing in the backlog. Set a project\u2019s status to Backlog to park it here.</div>';
  $('backlogBody').querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openPanel(el.dataset.open)));
}

/* ---------------- detail panel ---------------- */
function openPanel(id) {
  panelProjectId = id;
  renderPanel();
  $('panelOverlay').classList.add('show');
  $('panel').classList.add('show');
}
function closePanel(skipRender) {
  panelProjectId = null;
  $('panelOverlay').classList.remove('show');
  $('panel').classList.remove('show');
  if (!skipRender) renderAll(true);
}
function commitField(p, field, value) {
  if ((p[field] || '') === value) return;
  p[field] = value;
  markDirty();
  /* refresh background views without rebuilding the panel inputs */
  renderKpis(); renderGantt(); renderList(); renderBacklog(); renderHeaderMeta();
}
function renderPanel() {
  const found = findProject(working, panelProjectId);
  const panel = $('panel');
  if (!found) { panel.innerHTML = ''; return; }
  const { cat, p } = found;
  const s = stat(p.status);
  const editor = session.role === 'editor';
  const dateNote = (!isScheduled(p))
    ? '<div class="date-note">Unscheduled — add both a start and an end date to plot this project on the timeline.</div>' : '';

  const milestonesHtml = (p.milestones || []).length
    ? (p.milestones || []).slice().sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1).map(m =>
        '<div class="ms-row">' +
        (editor ? '<input type="checkbox" class="ms-check" data-msdone="' + m.id + '"' + (m.done ? ' checked' : '') + ' title="Mark complete">' : '<span class="ms-diamond' + (m.done ? ' done' : '') + '"></span>') +
        '<span class="ms-label' + (m.done ? ' done' : '') + '">' + esc(m.label) + '</span>' +
        '<span class="ms-date">' + (m.date ? fmtDate(m.date) : 'No date') + '</span>' +
        (editor ? '<button class="icon-btn danger" data-msdel="' + m.id + '" title="Remove milestone"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' : '') +
        '</div>').join('')
    : '<div class="ms-empty">No milestones defined.</div>';

  const commentsHtml = (p.comments || []).length
    ? (p.comments || []).map(c =>
        '<div class="comment"><div class="comment-meta"><span class="comment-author">' + esc(c.author) + '</span>' +
        '<span class="comment-ts">' + new Date(c.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '</span></div>' +
        '<div class="comment-text">' + esc(c.text) + '</div></div>').join('')
    : '<div class="ms-empty">No comments yet.</div>';

  const textOrInput = (field, placeholder, area) => editor
    ? (area
        ? '<textarea class="p-area" data-field="' + field + '" placeholder="' + placeholder + '">' + esc(p[field]) + '</textarea>'
        : '<input class="p-input" data-field="' + field + '" placeholder="' + placeholder + '" value="' + esc(p[field]) + '">')
    : '<div class="p-text' + (p[field] ? '' : ' empty') + '">' + (p[field] ? esc(p[field]) : 'Not provided') + '</div>';

  panel.innerHTML =
    '<div class="panel-head">' +
      '<div class="panel-top"><div style="flex:1;min-width:0">' +
        '<div class="panel-dept">' + esc(cat.name) + '</div>' +
        (editor
          ? '<input class="panel-title-input" data-field="name" value="' + esc(p.name) + '">'
          : '<div class="panel-title">' + esc(p.name) + '</div>') +
      '</div><button class="icon-btn panel-close" id="panelClose" title="Close"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>' +
      '<div class="panel-statusrow">' +
        (editor
          ? '<select class="p-select" id="statusSelect">' + STATUSES.map(x => '<option value="' + x.key + '"' + (x.key === p.status ? ' selected' : '') + '>' + x.label + '</option>').join('') + '</select>'
          : '<span class="status-badge" style="color:' + s.c + ';background:' + s.bg + '"><span class="dot"></span>' + s.label + '</span>') +
        '<span class="p-dates" style="font-family:var(--mono);font-size:12px;color:var(--text-muted)">' +
          (isScheduled(p) ? fmtDate(p.startDate) + ' → ' + fmtDate(p.endDate) : '<span class="unsch" style="color:var(--c-hold);font-style:italic">Unscheduled</span>') +
        '</span></div>' +
    '</div>' +
    '<div class="panel-body">' +
      (editor
        ? '<div class="p-section"><div class="p-section-title">Schedule</div>' + dateNote +
          '<div class="daterow">' +
          '<div class="df"><label>Start date</label><input type="date" data-datefield="startDate" value="' + esc(p.startDate) + '"></div>' +
          '<div class="df"><label>Target end</label><input type="date" data-datefield="endDate" value="' + esc(p.endDate) + '"></div>' +
          '</div></div>'
        : '') +
      '<div class="p-section"><div class="p-section-title">Stakeholders</div>' + textOrInput('stakeholders', 'e.g. CFO, VP Mortgage Servicing, Legal', false) + '</div>' +
      '<div class="p-section"><div class="p-section-title">Update summary</div>' + textOrInput('updateSummary', 'One-line status for executives — what changed since last review', true) + '</div>' +
      '<div class="p-section"><div class="p-section-title">Description</div>' + textOrInput('description', 'What this initiative does, scope, and expected outcome', true) + '</div>' +
      '<div class="p-section"><div class="p-section-title">Milestones</div>' + milestonesHtml +
        (editor
          ? '<div class="ms-add"><input type="text" class="p-input" id="msLabel" placeholder="Milestone name"><input type="date" id="msDate"><button class="btn btn-sm" id="msAddBtn">Add</button></div>'
          : '') + '</div>' +
      '<div class="p-section"><div class="p-section-title">Comments &amp; feedback</div>' + commentsHtml +
        '<div class="comment-compose">' +
        '<input class="p-input" id="commentName" placeholder="Your name" value="' + esc(localStorage.getItem(NAME_STORE) || '') + '">' +
        '<textarea class="p-area" id="commentText" placeholder="Leave feedback or a question for the project owner"></textarea>' +
        '<button class="btn btn-sm btn-gold" id="commentPost">Post comment</button>' +
        '<div class="comment-note">Comments post immediately for everyone — they are not staged with other edits.</div>' +
        '</div></div>' +
      (editor
        ? '<div class="panel-danger"><button class="btn btn-sm btn-danger" id="projDelete">Delete project</button></div>'
        : '') +
    '</div>' +
    '<div class="panel-foot-note">' + (editor ? 'Edits here are staged — use Save Changes to publish them.' : 'You have view-only access. You can post comments; other fields are read-only.') + '</div>';

  /* wire events */
  $('panelClose').addEventListener('click', () => closePanel());

  if (editor) {
    panel.querySelectorAll('[data-field]').forEach(el =>
      el.addEventListener('change', () => commitField(p, el.dataset.field, el.value.trim())));
    panel.querySelectorAll('[data-datefield]').forEach(el =>
      el.addEventListener('change', () => {
        commitField(p, el.dataset.datefield, el.value);
        renderPanel(); /* refresh schedule note + header dates */
      }));
    $('statusSelect').addEventListener('change', e => {
      commitField(p, 'status', e.target.value);
      renderPanel();
    });
    $('msAddBtn').addEventListener('click', () => {
      const label = $('msLabel').value.trim();
      if (!label) { toast('Milestone name is required', false); return; }
      (p.milestones = p.milestones || []).push({ id: gid('ms'), label, date: $('msDate').value || '', done: false });
      markDirty(); renderGantt(); renderPanel();
    });
    panel.querySelectorAll('[data-msdone]').forEach(el => el.addEventListener('change', () => {
      const m = (p.milestones || []).find(x => x.id === el.dataset.msdone);
      if (m) { m.done = el.checked; markDirty(); renderGantt(); renderPanel(); }
    }));
    panel.querySelectorAll('[data-msdel]').forEach(el => el.addEventListener('click', () => {
      p.milestones = (p.milestones || []).filter(x => x.id !== el.dataset.msdel);
      markDirty(); renderGantt(); renderPanel();
    }));
    $('projDelete').addEventListener('click', () =>
      confirmModal('Delete project', 'Delete "' + p.name + '"? This is staged until you save.', 'Delete', () => {
        cat.projects = cat.projects.filter(x => x.id !== p.id);
        markDirty(); closePanel();
      }));
  }

  $('commentPost').addEventListener('click', async () => {
    const name = $('commentName').value.trim();
    const text = $('commentText').value.trim();
    if (!text) { toast('Comment text is required', false); return; }
    if (name) localStorage.setItem(NAME_STORE, name);
    const btn = $('commentPost');
    btn.disabled = true; btn.textContent = 'Posting…';
    try {
      const res = await api('POST', { projectId: p.id, author: name, text });
      (p.comments = p.comments || []).push(res.comment);
      const sf = findProject(serverData, p.id);
      if (sf) (sf.p.comments = sf.p.comments || []).push(res.comment);
      renderPanel();
      toast('Comment posted');
    } catch (e) {
      toast(e.message, false);
      btn.disabled = false; btn.textContent = 'Post comment';
    }
  });
}

/* ---------------- global wiring ---------------- */
$('lockBtn').addEventListener('click', () => tryEnter($('lockInput').value));
$('lockInput').addEventListener('keydown', e => { if (e.key === 'Enter') tryEnter($('lockInput').value); });
$('signOutBtn').addEventListener('click', () => {
  if (changeCount > 0) confirmModal('Unsaved changes', 'You have ' + changeCount + ' unsaved change(s). Sign out and discard them?', 'Sign out', signOut);
  else signOut();
});
$('refreshBtn').addEventListener('click', async () => {
  const go = async () => {
    try { await loadData(); closePanel(true); renderAll(); toast('Reloaded latest saved data'); }
    catch (e) { toast(e.message, false); }
  };
  if (changeCount > 0) confirmModal('Unsaved changes', 'Reloading discards ' + changeCount + ' staged change(s). Continue?', 'Reload', go);
  else go();
});
$('saveBtn').addEventListener('click', saveChanges);
$('discardBtn').addEventListener('click', discardChanges);
$('backlogHead').addEventListener('click', () => { backlogOpen = !backlogOpen; $('backlogCard').classList.toggle('open', backlogOpen); });
$('panelOverlay').addEventListener('click', () => closePanel());
$('modalCancel').addEventListener('click', closeModal);
$('modalOk').addEventListener('click', () => { if (modalCb && modalCb() === false) return; closeModal(); });
$('modalInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('modalOk').click(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('modalOverlay').classList.contains('show')) closeModal();
    else if (panelProjectId) closePanel();
  }
});
window.addEventListener('beforeunload', e => {
  if (changeCount > 0) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------------- boot ---------------- */
(async function boot() {
  const saved = sessionStorage.getItem(KEY_STORE);
  if (saved) {
    session = { key: saved, role: sessionStorage.getItem(ROLE_STORE) };
    try {
      await loadData();
      showApp();
      return;
    } catch (e) {
      signOut();
      $('lockError').textContent = /invalid|expired/i.test(e.message) ? '' : e.message;
    }
  }
  $('lockScreen').style.display = 'flex';
})();
