/* DoTo — Task Manager, Simple. Vanilla JS Google-Tasks clone */
'use strict';

const LS_KEY = 'doto-v1';
const APP_VERSION = '1.0-1789112109'; // bump with ?v= stamps + version.json on every release
let lastUpdateCheck = 0, updateNotified = '';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => {
  try { if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 16); } catch {}
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
};

const COLORS = [
  { id: 'default', name: 'Gray', hex: '#9aa0a6' },
  { id: 'black', name: 'Black', hex: '#202124' },
  { id: 'red', name: 'Red', hex: '#d93025' },
  { id: 'orange', name: 'Orange', hex: '#e8710a' },
  { id: 'blue', name: 'Blue', hex: '#1a73e8' },
  { id: 'green', name: 'Green', hex: '#188038' },
  { id: 'purple', name: 'Purple', hex: '#9334e6' },
];
const BUILTIN_COLOR_IDS = new Set(COLORS.map((c) => c.id));
function allColors() {
  const del = new Set((typeof state !== 'undefined' && state.deletedColors) || []);
  return COLORS.filter((c) => !del.has(c.id)).concat((typeof state !== 'undefined' && state.customColors) || []);
}
function validCustomColor(c) {
  return !!c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.hex === 'string'
    && /^#[0-9a-fA-F]{6}$/.test(c.hex) && c.name.trim().length >= 1 && c.name.trim().length <= 24;
}
const colorHex = (id) => (allColors().find((c) => c.id === id) || COLORS[0]).hex;
const colorName = (id) => {
  const c = allColors().find((x) => x.id === id) || COLORS[0];
  return (state.colorNames && state.colorNames[c.id]) || c.name;
};

const WEIGHTS = { light: { label: 'Light', icon: 'arrow_downward' }, medium: { label: 'Medium', icon: 'remove' }, heavy: { label: 'Heavy', icon: 'arrow_upward' } };
const IMPORTANCE = { low: { label: 'Low', icon: 'arrow_downward' }, medium: { label: 'Medium', icon: 'remove' }, high: { label: 'High', icon: 'arrow_upward' } };
const WEIGHT_IDS = Object.keys(WEIGHTS), IMP_IDS = Object.keys(IMPORTANCE);
function clampWeight(v) { return WEIGHT_IDS.includes(v) ? v : 'medium'; }
function clampImp(v) { return IMP_IDS.includes(v) ? v : 'medium'; }
const REMIND_OFFSETS = [1, 5, 30, 60, 180, 1440]; // minutes before due; '' = off
const HOME = '__home__', ALL = '__all__', CAL = '__cal__', TIME = '__time__';

let state = migrate(load() || seed());
let ui = { completedOpen: false, boardDone: {}, sort: (typeof state !== 'undefined' && state.sort) || 'order', detailId: null, selectedId: null, dragId: null, dragListId: null, suppressClickUntil: 0, quick: {}, timeTaskId: null, timeQuery: '', searchFromHome: false };
// shared single-click timer: opening any popup cancels a pending details-open
// so the panel can never ambush a popup tap
let pendingDetailTimer = 0;

function seed() {
  const l1 = { id: uid(), name: 'General', createdAt: Date.now() };
  return {
    lists: [l1],
    activeView: HOME,
    showCompleted: true,
    filters: { color: '', weight: '', importance: '' },
    colorNames: {},
    customColors: [],
    deletedColors: [],
    prefs: { sideW: 280, detailW: 440 },
    times: [],
    timer: null,
    sort: 'order',
    lastListId: l1.id,
    tasks: [
      {
        id: uid(), listId: l1.id, title: 'Example Task',
        notes: 'This is a sample task showing every field. Open its details, then delete it when ready.',
        date: todayIso(), time: '09:00', extRef: 'https://example.com',
        color: 'blue', weight: 'heavy', importance: 'high',
        recur: { freq: 'weekly', interval: 1, days: [1] },
        done: false, completedAt: 0, order: 0, createdAt: Date.now(),
        subtasks: [
          { id: uid(), title: 'Completed subtask', done: true },
          { id: uid(), title: 'Open subtask', done: false },
        ],
      },
    ],
  };
}
function migrate(s) {
  if (!s) return s;
  if (!Array.isArray(s.lists)) s.lists = [];
  if (!Array.isArray(s.tasks)) s.tasks = [];
  if (!s.activeView) s.activeView = s.activeListId && s.lists.some((l) => l.id === s.activeListId) ? s.activeListId : HOME;
  delete s.activeListId;
  if (!s.prefs) s.prefs = { sideW: 280, detailW: 440 };
  // one-time fix: the old default (360px) was too narrow and clipped
  // Weight/Importance controls — widen it unless the user resized manually
  if (s.prefs.detailW === 360) s.prefs.detailW = 440;
  if (!s.filters || typeof s.filters !== 'object') s.filters = { color: '', weight: '', importance: '' };
  if (typeof s.filters.color !== 'string') s.filters.color = '';
  if (typeof s.filters.weight !== 'string') s.filters.weight = '';
  if (typeof s.filters.importance !== 'string') s.filters.importance = '';
  if (typeof s.showCompleted !== 'boolean') s.showCompleted = true;
  if (!['order', 'date', 'title', 'priority'].includes(s.sort)) s.sort = 'order';
  if (typeof s.lastListId !== 'string') s.lastListId = (s.lists[0] && s.lists[0].id) || '';
  s.tasks.forEach((t) => {
    t.weight = clampWeight(t.weight);
    t.importance = clampImp(t.importance);
    if (!t.color) t.color = 'default';
    if (typeof t.notes !== 'string') t.notes = '';
    if (typeof t.extRef !== 'string') t.extRef = '';
    if (typeof t.date !== 'string') t.date = '';
    if (typeof t.time !== 'string') t.time = '';
    // timezone-aware due: timed tasks carry the absolute instant (dueUtc) plus
    // the IANA zone it was entered in (tz). Legacy tasks predate these fields
    // and stay floating until their date/time is next edited on any device.
    if (typeof t.tz !== 'string') t.tz = '';
    if (typeof t.dueUtc !== 'number' || isNaN(t.dueUtc)) t.dueUtc = 0;
    if (!Array.isArray(t.subtasks)) t.subtasks = [];
    if (!('recId' in t)) t.recId = '';
    if (!('recur' in t)) t.recur = null;
    if (t.recur && !['daily', 'weekly', 'monthly', 'yearly'].includes(t.recur.freq)) t.recur = null;
    if (!('spawnedId' in t)) t.spawnedId = '';
  });
  // reminders: keep only well-formed values; unknown shapes reset to off
  // reminders are due-based offsets now; convert the short-lived explicit-time
  // model (remindAt) once, then drop its fields
  s.tasks.forEach((t) => {
    if (t.remindAt && typeof t.date === 'string' && t.date && typeof t.remindBefore !== 'number') {
      const diff = Math.round((dueTs({ date: t.date, time: t.time }) - Date.parse(t.remindAt)) / 60000);
      if (!isNaN(diff) && diff >= 0) {
        let best = REMIND_OFFSETS[0], bd = Math.abs(diff - best);
        REMIND_OFFSETS.forEach((o) => { const d = Math.abs(diff - o); if (d < bd) { bd = d; best = o; } });
        t.remindBefore = best;
        t.calRev = ''; // force re-sync: new event shape (popup offset at due time)
      }
    }
    delete t.remindAt; delete t.remindVia; delete t.lastRemindedAt;
    if (typeof t.remindBefore !== 'number' || !REMIND_OFFSETS.includes(t.remindBefore)) {
      if (typeof t.remindBefore === 'number') {
        let best = REMIND_OFFSETS[0], bd = Math.abs(t.remindBefore - best);
        REMIND_OFFSETS.forEach((o) => { const d = Math.abs(t.remindBefore - o); if (d < bd) { bd = d; best = o; } });
        t.remindBefore = best;
      } else t.remindBefore = '';
    }
    if ('calEventId' in t && typeof t.calEventId !== 'string') t.calEventId = '';
    if ('calRev' in t && typeof t.calRev !== 'string') t.calRev = '';
  });
  // retired colors (yellow/teal/pink) map to their closest surviving color
  const legacyColor = { yellow: 'orange', teal: 'blue', pink: 'purple' };
  if (!Array.isArray(s.customColors)) s.customColors = [];
  s.customColors = s.customColors
    .filter(validCustomColor)
    .filter((c) => !BUILTIN_COLOR_IDS.has(c.id))
    .map((c) => ({ id: c.id.slice(0, 24), name: c.name.trim().slice(0, 24), hex: c.hex.toLowerCase() }))
    .slice(0, 10);
  const validColors = new Set([...BUILTIN_COLOR_IDS, ...s.customColors.map((c) => c.id)]);
  if (!s.colorNames || typeof s.colorNames !== 'object') s.colorNames = {};
  if (!Array.isArray(s.deletedColors)) s.deletedColors = [];
  s.deletedColors = s.deletedColors.filter((id) => BUILTIN_COLOR_IDS.has(id));
  s.deletedColors.forEach((id) => validColors.delete(id));
  s.tasks.forEach((t) => { if (legacyColor[t.color]) t.color = legacyColor[t.color]; else if (!validColors.has(t.color)) t.color = 'default'; });
  if (s.filters && s.filters.color && !validColors.has(s.filters.color)) s.filters.color = '';
  Object.keys(s.colorNames).forEach((k) => { if (!validColors.has(k)) delete s.colorNames[k]; });
  if (!Array.isArray(s.times)) s.times = [];
  if (typeof s.dirtyAt !== 'number') s.dirtyAt = 0;
  if (typeof s.userName !== 'string') s.userName = '';
  if (s.timer && (typeof s.timer !== 'object' || !s.timer.taskId)) s.timer = null;
  if (s.timer && typeof s.timer.startedAt !== 'number') s.timer.startedAt = Date.now();
  if (s.timer && typeof s.timer.acc !== 'number') s.timer.acc = 0;
  return s;
}
function salvageState(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.lists) || !Array.isArray(s.tasks)) return null;
  s.lists = s.lists.filter((l) => l && typeof l.id === 'string' && typeof l.name === 'string');
  if (!s.lists.length) return null;
  s.tasks = s.tasks.filter((t) => t && typeof t.id === 'string' && typeof t.listId === 'string' && typeof t.title === 'string');
  if (Array.isArray(s.times)) s.times = s.times.filter((r) => r && typeof r.id === 'string' && typeof r.seconds === 'number');
  else s.times = [];
  return s;
}
function validState(s) {
  return !!salvageState(JSON.parse(JSON.stringify(s)));
}
function load() {
  let raw = null;
  try { raw = localStorage.getItem(LS_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    const before = Array.isArray(s.tasks) ? s.tasks.length : 0;
    const ok = salvageState(s);
    if (ok) {
      if (ok.tasks.length < before) {
        setTimeout(() => { try { toast('Some saved tasks were invalid and were skipped'); } catch {} }, 600);
      }
      return ok;
    }
  } catch { /* fall through to recovery */ }
  // Unrecoverable save: stash it for forensics, then start fresh instead of dying.
  try { localStorage.setItem(LS_KEY + '-corrupt-' + Date.now(), String(raw).slice(0, 500000)); } catch {}
  try { localStorage.removeItem(LS_KEY); } catch {}
  setTimeout(() => { try { toast('Saved data was corrupted — started fresh (a backup was kept in this browser)'); } catch {} }, 600);
  return null;
}
let quotaWarned = false;
function save() {
  try {
    state.dirtyAt = Date.now();
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (err) {
    if (err && err.name === 'QuotaExceededError' && !quotaWarned) {
      quotaWarned = true;
      try { toast('Browser storage is full — export a JSON backup to be safe'); } catch {}
    }
  }
  try { schedulePush(); } catch {}
  try { scheduleCalendarSync(); } catch {}
}

// Last-resort error surface: never die silently, never spam.
let lastErrToast = 0;
function reportCrash() {
  const n = Date.now();
  if (n - lastErrToast < 8000) return;
  lastErrToast = n;
  try { toast('Something went wrong — your lists are saved, try reloading'); } catch {}
}
window.addEventListener('error', reportCrash);
window.addEventListener('unhandledrejection', reportCrash);

function isHome() { return state.activeView === HOME; }
function isAll() { return state.activeView === ALL; }
function isCal() { return state.activeView === CAL; }
function isTime() { return state.activeView === TIME; }
function activeList() { return state.lists.find((l) => l.id === state.activeView) || null; }
function fallbackList() { return state.lists[0] || null; }
function listName(id) { const l = state.lists.find((x) => x.id === id); return l ? l.name : '(deleted)'; }
function listTasks(listId) { return state.tasks.filter((t) => t.listId === listId); }
function getTask(id) { return state.tasks.find((t) => t.id === id); }
function isUrl(s) { return /^https?:\/\/\S+/i.test((s || '').trim()); }
function todayIso() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function go(view) {
  ui.searchFromHome = false;
  state.activeView = view;
  if (state.lists.some((l) => l.id === view)) state.lastListId = view;
  save(); closeSidebar(); closeDetail();
  // Reset window scroll BEFORE render: body.view-board locks window scrolling,
  // so a reset attempted only after the switch may not take — leaving a stale
  // offset that shows up as a gap at the top of the sticky desktop sidebar.
  window.scrollTo(0, 0);
  renderAll();
  window.scrollTo({ top: 0 });
}
function setSort(v) {
  if (!['order', 'date', 'title', 'priority'].includes(v)) v = 'order';
  ui.sort = state.sort = v;
  save(); renderAll();
}

/* ---------- toast with undo ---------- */
let toastTimer = 0;
function toast(msg, undoFn, label) {
  $('#toastMsg').textContent = msg;
  const u = $('#toastUndo');
  u.classList.toggle('hidden', !undoFn);
  u.textContent = label || 'Undo';
  u.onclick = () => { hideToast(); undoFn && undoFn(); };
  $('#toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 4200);
}
function hideToast() { $('#toast').classList.add('hidden'); }

/* Update detector: version.json is never cached (SW bypass + no-store), so a
   stale WebView (iOS has no hard-refresh) still notices a new release.
   Taps are counted: if ?u= reloads keep serving the stale shell (offline SW
   fallback, WebView cache), the 3rd prompt escalates to a full refresh. */
function sessNum(k) { try { return parseInt(sessionStorage.getItem(k) || '0', 10) || 0; } catch { return 0; } }
function sessSet(k, v) { try { sessionStorage.setItem(k, v); } catch {} }
function sessDel(k) { try { sessionStorage.removeItem(k); } catch {} }
async function updateEnv() {
  let sw = 'sw: n/a', cachesN = 'caches: n/a';
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      sw = !reg ? 'sw: none'
        : 'sw: ' + [reg.installing && 'installing', reg.waiting && 'waiting', reg.active && 'active'].filter(Boolean).join('/')
        + (navigator.serviceWorker.controller ? '+controlled' : '+uncontrolled');
    }
    if ('caches' in window) cachesN = 'caches: ' + (await caches.keys()).length;
  } catch {}
  return `[${sw}, ${cachesN}]`;
}
async function checkForUpdate() {
  if (!navigator.onLine) return;
  try {
    const r = await fetch('version.json', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.version && j.version !== APP_VERSION && j.version !== updateNotified) {
      updateNotified = j.version;
      const tries = sessNum('doto-update-tries');
      slog('info', `Update available: ${j.version} (running ${APP_VERSION}, attempt ${tries + 1}) ${await updateEnv()}`);
      if (tries >= 2) {
        toast('Update is stuck — tap for a full refresh', () => { sessDel('doto-update-tries'); forceUpdate(); }, 'Full refresh');
      } else {
        toast('New version available — reload to update', forceReload, 'Update');
      }
    } else if (j && j.version && j.version === APP_VERSION) {
      let wasUpdating = false;
      try { wasUpdating = sessNum('doto-update-tries') > 0 || !!sessionStorage.getItem('doto-updating'); } catch {}
      if (wasUpdating) slog('ok', `Updated to ${APP_VERSION} ${await updateEnv()}`);
      sessDel('doto-update-tries'); sessDel('doto-updating');
    }
  } catch {}
}
function forceReload() {
  try {
    sessSet('doto-update-tries', String(sessNum('doto-update-tries') + 1));
    sessSet('doto-updating', APP_VERSION);
    const u = new URL(location.href);
    u.searchParams.set('u', Date.now().toString(36)); // bust the cached shell
    location.href = u.toString();
  } catch { location.reload(); }
}
/* Manual nuke: push pending work first (so nothing is lost), drop service
   workers + offline caches, then reload newest. Token/email live in
   localStorage and survive this — only the runnable code is replaced. */
async function forceUpdate() {
  toast('Saving + updating to newest version…');
  try { await pushNow('force'); } catch {}
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
    }
  } catch {}
  try { sessionStorage.setItem('doto-updated', '1'); } catch {}
  slog('info', 'Force update: work pushed, cache cleared, reloading');
  setTimeout(forceReload, 350);
}

/* ---------- keyboard shortcuts + command palette ---------- */
const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], desc: 'Command palette (works everywhere)' },
  { keys: ['/'], desc: 'Focus search' },
  { keys: ['n'], desc: 'New task' },
  { keys: ['j', 'k'], desc: 'Select next / previous task' },
  { keys: ['Up', 'Down'], desc: 'Select previous / next task (once a task is selected)' },
  { keys: ['Enter'], desc: 'Open selected task' },
  { keys: ['x'], desc: 'Complete / reopen selected task' },
  { keys: ['Del'], desc: 'Delete selected task (undoable; Mac: Delete key)' },
  { keys: ['g', 'then', 'h'], desc: 'Go to Home' },
  { keys: ['g', 'then', 'b'], desc: 'Go to Board' },
  { keys: ['g', 'then', 'c'], desc: 'Go to Calendar' },
  { keys: ['g', 'then', 't'], desc: 'Go to Time tracker' },
  { keys: ['g', 'then', '1-9'], desc: 'Jump to list by position' },
  { keys: ['u'], desc: 'Show / hide completed tasks' },
  { keys: ['d'], desc: 'Toggle dark mode' },
  { keys: ['?'], desc: 'This help' },
  { keys: ['Esc'], desc: 'Close panel / dialog' },
];

function typingNow() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
function visibleTaskRows() { return $$('#main .task[data-id]'); }
function paintSelection(scroll) {
  $$('#main .task.kb-selected').forEach((x) => x.classList.remove('kb-selected'));
  if (!ui.selectedId) return;
  const row = document.querySelector(`#main .task[data-id="${ui.selectedId}"]`);
  if (row) { row.classList.add('kb-selected'); if (scroll) row.scrollIntoView({ block: 'nearest' }); }
}
function selectStep(dir) {
  const rows = visibleTaskRows();
  if (!rows.length) return;
  let i = rows.findIndex((r) => r.dataset.id === ui.selectedId);
  i = i < 0 ? (dir > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, i + dir));
  ui.selectedId = rows[i].dataset.id;
  paintSelection(true);
}
function selectedTask() { return ui.selectedId ? getTask(ui.selectedId) : null; }
function toggleShowCompleted() {
  state.showCompleted = !state.showCompleted;
  const t = $('#showCompletedToggle');
  if (t) t.checked = state.showCompleted;
  save(); renderAll();
}

let paletteIdx = 0, paletteItems = [];
function paletteCommands() {
  return [
    { icon: 'home', label: 'Go to Home', run: () => go(HOME) },
    { icon: 'view_column', label: 'Go to Board', run: () => go(ALL) },
    { icon: 'calendar_month', label: 'Go to Calendar', run: () => go(CAL) },
    { icon: 'timer', label: 'Go to Time tracker', run: () => go(TIME) },
    { icon: 'add', label: 'New task', run: () => focusComposer() },
    { icon: 'playlist_add', label: 'New list', run: () => { if (window.innerWidth < 1024) openSidebar(); setTimeout(createList, 60); } },
    { icon: 'dark_mode', label: 'Toggle dark mode', run: () => toggleTheme() },
    { icon: 'visibility', label: 'Show / hide completed tasks', run: toggleShowCompleted },
    { icon: 'swap_vert', label: 'Sort by My order', run: () => setSort('order') },
    { icon: 'event', label: 'Sort by Date', run: () => setSort('date') },
    { icon: 'flag', label: 'Sort by Importance and weight', run: () => setSort('priority') },
    { icon: 'sort_by_alpha', label: 'Sort by Title', run: () => setSort('title') },
    { icon: 'upload', label: 'Import JSON', run: () => $('#importFile').click() },
    { icon: 'download', label: 'Export JSON', run: () => exportJSON() },
    { icon: 'keyboard', label: 'Keyboard shortcuts', run: () => openHelp() },
    { icon: 'menu_book', label: 'Open Manual', run: () => window.open('manual.html', '_blank', 'noopener') },
  ];
}
function fuzzy(hay, needle) {
  hay = (hay || '').toLowerCase(); needle = (needle || '').toLowerCase();
  let i = 0;
  for (const ch of needle) { i = hay.indexOf(ch, i); if (i < 0) return false; i++; }
  return true;
}
function paletteOpen() { return !$('#paletteScrim').classList.contains('hidden'); }
function openPalette() {
  $('#paletteScrim').classList.remove('hidden');
  const inp = $('#paletteInput');
  inp.value = '';
  renderPalette('');
  setTimeout(() => inp.focus(), 30);
}
function closePalette() { $('#paletteScrim').classList.add('hidden'); const i = $('#paletteInput'); if (i) i.blur(); }
function renderPalette(q) {
  q = (q || '').trim();
  const cmds = paletteCommands().filter((c) => !q || fuzzy(c.label, q));
  const lists = q
    ? state.lists.filter((l) => fuzzy(l.name, q)).map((l) => ({ icon: 'list', label: l.name, hint: 'List', run: () => go(l.id) }))
    : [];
  const tasks = q
    ? allFiltered().filter((t) => fuzzy(t.title || '(untitled)', q)).slice(0, 20)
      .map((t) => ({ icon: 'check_circle', label: t.title || '(untitled)', hint: listName(t.listId), run: () => { ui.selectedId = t.id; openDetail(t.id); } }))
    : [];
  paletteItems = [...cmds, ...lists, ...tasks];
  paletteIdx = 0;
  const ul = $('#paletteList');
  ul.innerHTML = '';
  if (!paletteItems.length) { ul.innerHTML = '<li class="palette-empty">No matches</li>'; return; }
  paletteItems.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'palette-item' + (i === paletteIdx ? ' selected' : '');
    li.setAttribute('role', 'option');
    const ic = document.createElement('span');
    ic.className = 'material-icons-outlined'; ic.textContent = it.icon;
    const lb = document.createElement('span');
    lb.textContent = it.label; lb.dir = 'auto';
    li.append(ic, lb);
    if (it.hint) { const h = document.createElement('span'); h.className = 'hint'; h.textContent = it.hint; li.appendChild(h); }
    li.onclick = () => { closePalette(); it.run(); };
    li.onmousemove = () => { if (paletteIdx !== i) { paletteIdx = i; paintPaletteSel(); } };
    ul.appendChild(li);
  });
  ul.scrollTop = 0;
}
function paintPaletteSel() {
  $$('#paletteList .palette-item').forEach((li, i) => {
    const on = i === paletteIdx;
    li.classList.toggle('selected', on);
    li.setAttribute('aria-selected', String(on));
  });
  const sel = $('#paletteList .palette-item.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}
function runPalette() {
  const it = paletteItems[paletteIdx];
  closePalette();
  if (it) it.run();
}
function helpOpen() { return !$('#helpScrim').classList.contains('hidden'); }
function openHelp() {
  const host = $('#helpTable');
  host.innerHTML = '';
  SHORTCUTS.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'help-row';
    const keys = document.createElement('span');
    keys.className = 'help-keys';
    s.keys.forEach((k) => { const c = document.createElement('kbd'); c.textContent = k; keys.appendChild(c); });
    const d = document.createElement('span');
    d.textContent = s.desc;
    row.append(keys, d);
    host.appendChild(row);
  });
  $('#helpScrim').classList.remove('hidden');
}
function closeHelp() { $('#helpScrim').classList.add('hidden'); }

let pendingG = 0;
function bindShortcuts() {
  $('#shortcutsBtn').onclick = openHelp;
  $('#helpClose').onclick = closeHelp;
  $('#helpScrim').onclick = (e) => { if (e.target === $('#helpScrim')) closeHelp(); };
  $('#paletteScrim').onclick = (e) => { if (e.target === $('#paletteScrim')) closePalette(); };
  const inp = $('#paletteInput');
  inp.oninput = () => renderPalette(inp.value);
  inp.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); if (paletteItems.length) { paletteIdx = (paletteIdx + 1) % paletteItems.length; paintPaletteSel(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (paletteItems.length) { paletteIdx = (paletteIdx - 1 + paletteItems.length) % paletteItems.length; paintPaletteSel(); } }
    else if (e.key === 'Enter') { e.preventDefault(); runPalette(); }
    else if (e.key === 'Escape') closePalette();
  };
  // clicking a row arms it for keyboard actions (x / Enter / Del)
  document.addEventListener('click', (e) => {
    const row = e.target && e.target.closest ? e.target.closest('#main .task[data-id]') : null;
    if (row) { ui.selectedId = row.dataset.id; paintSelection(false); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePalette(); closeHelp(); closeAccount(); closeLog(); closeConflict(); clearTimeout(pendingG); pendingG = 0; return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen() ? closePalette() : openPalette(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (typingNow() || paletteOpen() || helpOpen() || isLogOpen() || isConflictOpen() || !$('#modalScrim').classList.contains('hidden') || !$('#accountScrim').classList.contains('hidden')) return;
    if (pendingG) {
      clearTimeout(pendingG); pendingG = 0;
      const gk = e.key.toLowerCase();
      if (gk === 'h') return go(HOME);
      if (gk === 'b') return go(ALL);
      if (gk === 'c') return go(CAL);
      if (gk === 't') return go(TIME);
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9 && state.lists[n - 1]) return go(state.lists[n - 1].id);
      return;
    }
    const k = e.key;
    if (k === 'g' || k === 'G') { pendingG = setTimeout(() => { pendingG = 0; }, 900); return; }
    if (k === '/') { e.preventDefault(); const s = $('#searchInput'); s.focus(); s.select(); return; }
    if (k === '?') { openHelp(); return; }
    if (k === 'n' || k === 'N') { focusComposer(); return; }
    if (k === 'j' || k === 'J') { e.preventDefault(); selectStep(1); return; }
    if (k === 'k' || k === 'K') { e.preventDefault(); selectStep(-1); return; }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      if (!ui.selectedId) return; // plain scrolling still works until a task is selected
      e.preventDefault();
      selectStep(k === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (k === 'Enter') { const t = selectedTask(); if (t) openDetail(t.id); return; }
    if (k === 'x' || k === 'X') { const t = selectedTask(); if (t) toggleDone(t.id); return; }
    if (k === 'Delete' || (k === 'Backspace' && /Mac|iPhone|iPad/.test(navigator.platform || ''))) {
      const t = selectedTask(); if (t) { e.preventDefault(); ui.selectedId = null; deleteTask(t.id); } return;
    }
    if (k === 'u' || k === 'U') { toggleShowCompleted(); return; }
    if (k === 'd' || k === 'D') { toggleTheme(); return; }
  });
}

/* ---------- filtering / sorting ---------- */
function sortFn() {
  const impRank = { high: 0, medium: 1, low: 2 }, wRank = { heavy: 0, medium: 1, light: 2 };
  return {
    order: (a, b) => a.order - b.order || a.createdAt - b.createdAt,
    date: (a, b) => (displayDate(a) || '9999').localeCompare(displayDate(b) || '9999') || (dueTs(a) || 0) - (dueTs(b) || 0) || a.order - b.order,
    title: (a, b) => a.title.localeCompare(b.title),
    priority: (a, b) => impRank[a.importance] - impRank[b.importance] || wRank[a.weight] - wRank[b.weight] || a.order - b.order,
  }[state.sort || ui.sort] || ((a, b) => a.order - b.order);
}
function matchesFilters(t) {
  const q = $('#searchInput').value.trim().toLowerCase();
  if (q && !(t.title + ' ' + t.notes + ' ' + t.extRef + ' ' + t.subtasks.map((s) => s.title).join(' ')).toLowerCase().includes(q)) return false;
  const f = state.filters;
  if (f.color && t.color !== f.color) return false;
  if (f.weight && t.weight !== f.weight) return false;
  if (f.importance && t.importance !== f.importance) return false;
  return true;
}
function tasksFor(listId) { return listTasks(listId).filter(matchesFilters).sort(sortFn()); }
function allFiltered() { return state.tasks.filter(matchesFilters).sort(sortFn()); }

/* ---------- sidebar / lists ---------- */
function renderNav() {
  $('#navHome').classList.toggle('active', isHome());
  $('#navAll').classList.toggle('active', isAll());
  $('#navCal').classList.toggle('active', isCal());
  $('#navTime').classList.toggle('active', isTime());
  const unread = unreadNotifCount();
  const nc = $('#notifCount');
  nc.textContent = unread || '';
  nc.classList.toggle('alert', unread > 0);
  nc.classList.toggle('hidden', !unread);
  syncAppBadge(unread);
  const openAll = state.tasks.filter((t) => !t.done).length;
  $('#allCount').textContent = openAll;
  $('#allCountPill').textContent = openAll ? `${openAll} open` : 'All done';
  const dueToday = state.tasks.filter((t) => !t.done && displayDate(t) === todayIso()).length;
  $('#calCount').textContent = dueToday || '';
  const todayS = state.times.filter((r) => recDay(r) === todayIso()).reduce((a, r) => a + (r.seconds || 0), 0)
    + (state.timer ? timerElapsed() : 0);
  $('#timeCount').textContent = todayS > 0 ? fmtDur(todayS) : '';
  paintSortMenu();
  renderQuickColors();

  const nav = $('#listNav'); nav.innerHTML = '';
  state.lists.forEach((l) => {
    const open = listTasks(l.id).filter((t) => !t.done).length;
    const b = document.createElement('button');
    b.className = 'list-item' + (state.activeView === l.id ? ' active' : '');
    b.dataset.listId = l.id;
    b.innerHTML = `<span class="material-icons-outlined">list</span><span class="n"></span><span class="c">${open}</span>`;
    b.querySelector('.n').textContent = l.name;
    b.querySelector('.n').dir = 'auto';
    b.title = 'Open list — drop tasks here to move them';
    b.onclick = () => { if (Date.now() < ui.suppressClickUntil) return; go(l.id); };
    b.ondblclick = () => renameList(l.id);
    // mouse: whole row is a drag handle for reordering lists
    b.draggable = true;
    b.addEventListener('dragstart', (e) => { ui.dragListId = l.id; ui.dragId = null; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'list:' + l.id); } catch {} });
    b.addEventListener('dragend', () => { ui.dragListId = null; b.classList.remove('dragging'); clearListDropMarks(); });
    b.addEventListener('dragover', (e) => {
      if (ui.dragId) { e.preventDefault(); b.classList.add('drop-target'); return; } // task → move into list
      if (!ui.dragListId || ui.dragListId === l.id) return; // list → reorder
      e.preventDefault();
      const r = b.getBoundingClientRect();
      const after = (e.clientY - r.top) > r.height / 2;
      b.classList.toggle('drop-before', !after); b.classList.toggle('drop-after', after);
      b.dataset.listDropPos = after ? 'after' : 'before';
    });
    b.addEventListener('dragleave', () => b.classList.remove('drop-target', 'drop-before', 'drop-after'));
    b.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      b.classList.remove('drop-target', 'drop-before', 'drop-after');
      if (ui.dragId) { moveTask(ui.dragId, l.id); return; }
      if (ui.dragListId) reorderLists(ui.dragListId, l.id, b.dataset.listDropPos === 'after');
    });
    // touch: long-press row to reorder (plain swipe still scrolls)
    attachListTouchDrag(b, l.id, b, true);
    nav.appendChild(b);
  });
  const fc = $('#filterColorBtns'); fc.innerHTML = '';
  allColors().forEach((c) => {
    const b = document.createElement('button');
    b.className = 'f-dot' + (state.filters.color === c.id ? ' selected' : '');
    b.style.background = c.hex; b.title = colorName(c.id); b.setAttribute('aria-label', 'Filter by ' + colorName(c.id));
    b.onclick = () => { state.filters.color = state.filters.color === c.id ? '' : c.id; save(); renderAll(); };
    fc.appendChild(b);
  });
  const mkBtns = (host, obj, key) => {
    const h = $(host); h.innerHTML = '';
    Object.entries(obj).forEach(([v, m]) => {
      const b = document.createElement('button');
      b.className = 'f-btn' + (state.filters[key] === v ? ' selected' : '');
      b.innerHTML = `<span class="material-icons-outlined">${m.icon}</span>`;
      b.title = m.label; b.setAttribute('aria-label', 'Filter by ' + m.label);
      b.onclick = () => { state.filters[key] = state.filters[key] === v ? '' : v; save(); renderAll(); };
      h.appendChild(b);
    });
  };
  mkBtns('#filterWeightBtns', WEIGHTS, 'weight');
  mkBtns('#filterImportanceBtns', IMPORTANCE, 'importance');
  $('#showCompletedToggle').checked = state.showCompleted;
  const anyFilter = state.filters.color || state.filters.weight || state.filters.importance || $('#searchInput').value.trim();
  $('#clearFilters').classList.toggle('hidden', !anyFilter);
  renderChips();
}
function paintSortMenu() {
  const cur = state.sort || ui.sort || 'order';
  ui.sort = cur;
  $$('#sortMenu button[data-sort]').forEach((b) => {
    const on = b.dataset.sort === cur;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-checked', String(on));
  });
}
function contrastText(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return '#fff';
  const n = parseInt(h, 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#202124' : '#fff';
}
function renderQuickColors() {
  const qaC = $('#qaColors'); if (!qaC) return;
  qaC.innerHTML = '';
  allColors().forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'f-dot' + (ui.quick.color === c.id ? ' selected' : '');
    b.style.background = c.hex;
    b.title = colorName(c.id); b.setAttribute('aria-label', 'Label ' + colorName(c.id));
    b.onclick = () => {
      ui.quick.color = ui.quick.color === c.id ? undefined : c.id;
      $$('#qaColors .f-dot').forEach((x) => x.classList.toggle('selected', x === b && !!ui.quick.color));
    };
    qaC.appendChild(b);
  });
}
function renderChips() {
  const hosts = $$('[data-chips]'); if (!hosts.length) return;
  const q = $('#searchInput').value.trim();
  const chips = [];
  if (q) chips.push({ label: `“${q}”`, clear: () => { $('#searchInput').value = ''; $('#clearSearch').classList.add('hidden'); } });
  if (state.filters.color) chips.push({ label: colorName(state.filters.color), dot: colorHex(state.filters.color), clear: () => state.filters.color = '' });
  if (state.filters.weight) chips.push({ label: 'Weight: ' + WEIGHTS[state.filters.weight].label, clear: () => state.filters.weight = '' });
  if (state.filters.importance) chips.push({ label: 'Importance: ' + IMPORTANCE[state.filters.importance].label, clear: () => state.filters.importance = '' });
  hosts.forEach((host) => {
    host.innerHTML = '';
    host.style.display = chips.length ? '' : 'none';
    chips.forEach((ch) => {
      const el = document.createElement('span'); el.className = 'chip';
      el.innerHTML = `${ch.dot ? `<span class="dot" style="background:${ch.dot}"></span>` : ''}<span></span>`;
      el.querySelector('span:last-child').textContent = ch.label;
      const x = document.createElement('button'); x.innerHTML = '<span class="material-icons-outlined" style="font-size:16px">close</span>'; x.setAttribute('aria-label', 'Clear filter');
      x.onclick = () => { ch.clear(); save(); renderAll(); };
      el.appendChild(x); host.appendChild(el);
    });
  });
}
function createList() { showListCreator(); }
// Inline creator: the input appears right above the "Create new list" button
function showListCreator() {
  const btn = $('#createListBtn');
  if (!btn || $('#listCreator')) { $('#listCreator input')?.focus(); return; }
  const form = document.createElement('form');
  form.id = 'listCreator'; form.className = 'list-creator'; form.autocomplete = 'off';
  form.innerHTML = `<input maxlength="60" placeholder="New list name" dir="auto" aria-label="New list name" /><button type="submit" class="icon-btn sm" aria-label="Create list"><span class="material-icons-outlined">check</span></button><button type="button" class="icon-btn sm" aria-label="Cancel"><span class="material-icons-outlined">close</span></button>`;
  btn.replaceWith(form);
  const inp = form.querySelector('input'); inp.focus();
  const close = () => form.replaceWith(btn);
  form.onsubmit = (e) => {
    e.preventDefault();
    const v = inp.value.trim(); close();
    if (!v) return;
    const l = { id: uid(), name: v.slice(0, 60), createdAt: Date.now() };
    state.lists.push(l); save(); go(l.id);
  };
  form.querySelector('button[type="button"]').onclick = close;
  inp.onkeydown = (e) => { if (e.key === 'Escape') close(); e.stopPropagation(); };
}
/* In-app modal replacing prompt()/confirm() */
function showModal({ title = '', message = '', input = null, okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    const scrim = $('#modalScrim'), box = $('#modalBox');
    $('#modalTitle').textContent = title;
    $('#modalMsg').textContent = message;
    const field = $('#modalInput');
    const hasInput = input !== null && input !== undefined;
    field.classList.toggle('hidden', !hasInput);
    if (hasInput) { field.value = input; }
    const ok = $('#modalOk');
    ok.textContent = okLabel;
    ok.classList.toggle('danger', !!danger);
    scrim.classList.remove('hidden');
    const done = (val) => {
      scrim.classList.add('hidden');
      box.onsubmit = null;
      $('#modalCancel').onclick = null;
      scrim.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', onKey, true);
    box.onsubmit = (e) => { e.preventDefault(); done(hasInput ? field.value : true); };
    $('#modalCancel').onclick = () => done(null);
    scrim.onclick = (e) => { if (e.target === scrim) done(null); };
    setTimeout(() => { if (hasInput) { field.focus(); field.select(); } else ok.focus(); }, 30);
  });
}
async function renameList(id) {
  const l = state.lists.find((x) => x.id === id); if (!l) return;
  const name = await showModal({ title: 'Rename list', input: l.name, okLabel: 'Rename' });
  if (name && name.trim()) { l.name = name.trim().slice(0, 60); save(); renderAll(); }
}
async function deleteList(id) {
  const l = state.lists.find((x) => x.id === id); if (!l) return;
  if (state.lists.length === 1) { toast('You need at least one list'); return; }
  const n = listTasks(id).length;
  const ok = await showModal({ title: 'Delete list?', message: `“${l.name}” and its ${n} task${n === 1 ? '' : 's'} will be deleted.`, okLabel: 'Delete', danger: true });
  if (!ok) return;
  const removedTasks = state.tasks.filter((t) => t.listId === id);
  const removedLists = state.lists.filter((x) => x.id === id);
  const savedTimer = state.timer && removedTasks.some((t) => t.id === state.timer.taskId) ? state.timer : null;
  removedTasks.forEach((t) => { if (t.calEventId) { queueCalDelete(t.calEventId); t.calEventId = ''; t.calRev = ''; } });
  if (savedTimer) state.timer = null;
  state.tasks = state.tasks.filter((t) => t.listId !== id);
  state.lists = state.lists.filter((x) => x.id !== id);
  if (state.activeView === id) state.activeView = HOME;
  if (ui.detailId && removedTasks.some((t) => t.id === ui.detailId)) closeDetail();
  save(); renderAll();
  toast('List deleted', () => {
    state.lists.push(...removedLists); state.tasks.push(...removedTasks);
    if (savedTimer) state.timer = savedTimer;
    save(); renderAll();
  });
}

/* ---------- dates ---------- */
function fmtDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr + 'T12:00:00');
  const t = todayIso();
  const diff = isoStr < t ? -1 : isoStr === t ? 0 : 1;
  // precise day diff
  const a = new Date(t + 'T12:00:00'), b = new Date(isoStr + 'T12:00:00');
  const dd = Math.round((b - a) / 864e5);
  const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' });
  return { label, diff: dd };
}

/* ---------- recurrence (Google-style repeat) ---------- */
const RECUR_UNITS = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function addMonthsClamped(d, n) {
  const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d;
}
function nextRecurDate(dateStr, recur) {
  if (!dateStr || !recur || !recur.freq || !RECUR_UNITS[recur.freq]) return '';
  const n = Math.max(1, Math.min(99, recur.interval || 1));
  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d)) return '';
  if (recur.freq === 'daily') d.setDate(d.getDate() + n);
  else if (recur.freq === 'weekly') {
    if (Array.isArray(recur.days) && recur.days.length) {
      const want = new Set(recur.days.filter((x) => x >= 0 && x <= 6));
      if (!want.size) d.setDate(d.getDate() + 7 * n);
      else {
        const weekStart = (dt) => {
          const x = new Date(dt);
          x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
          x.setHours(12, 0, 0, 0);
          return x;
        };
        const startW = weekStart(d).getTime();
        let found = '';
        for (let i = 1; i <= 7 * n + 7; i++) {
          const c = new Date(d); c.setDate(c.getDate() + i);
          if (!want.has(c.getDay())) continue;
          const weeksApart = Math.round((weekStart(c).getTime() - startW) / 6048e5);
          if (weeksApart === 0 || weeksApart >= n) { found = isoOf(c); break; }
        }
        if (found) return found;
        d.setDate(d.getDate() + 7 * n);
      }
    } else d.setDate(d.getDate() + 7 * n);
  }
  else if (recur.freq === 'monthly') addMonthsClamped(d, n);
  else if (recur.freq === 'yearly') { const day = d.getDate(); d.setDate(1); d.setFullYear(d.getFullYear() + n); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
  return isoOf(d);
}
function nextFutureRecurDate(dateStr, recur) {
  let nd = nextRecurDate(dateStr, recur);
  if (!nd) return '';
  const today = todayIso();
  let guard = 0, prev = dateStr;
  while (nd && nd < today && nd !== prev && guard++ < 400) {
    prev = nd;
    nd = nextRecurDate(nd, recur);
  }
  return nd && nd !== dateStr ? nd : nd;
}
function recurLabel(r) {
  if (!r || !r.freq || !RECUR_UNITS[r.freq]) return '';
  const n = Math.max(1, r.interval || 1);
  if (Array.isArray(r.days) && r.days.length && r.freq === 'weekly')
    return [...r.days].sort((a, b) => a - b).map((x) => WEEKDAYS[x]).join(', ');
  if (n === 1) return { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[r.freq];
  return `Every ${n} ${RECUR_UNITS[r.freq]}s`;
}

/* ---------- task rows ---------- */
const mqCompact = window.matchMedia('(max-width: 600px)');
if (mqCompact.addEventListener) mqCompact.addEventListener('change', () => renderAll());
function taskRow(t, opts = {}) {
  opts = { ...opts, compact: opts.compact || mqCompact.matches };
  const li = document.createElement('li');
  li.className = 'task' + (t.done ? ' done-task' : '');
  li.dataset.id = t.id; li.draggable = true;
  li.style.setProperty('--task-color', colorHex(t.color));

  const drag = document.createElement('span');
  drag.className = 'drag material-icons-outlined'; drag.textContent = 'drag_indicator'; drag.title = 'Drag to reorder / move between lists';

  const check = document.createElement('button');
  check.className = 'check'; check.setAttribute('aria-label', t.done ? 'Mark as not completed' : 'Mark complete');
  check.onclick = (e) => { e.stopPropagation(); toggleDone(t.id); };

  const main = document.createElement('div'); main.className = 'task-main';
  const title = document.createElement('span');
  title.className = 'task-title' + (t.title ? '' : ' empty');
  title.textContent = t.title || '(untitled)';
  title.dir = 'auto';
  title.title = 'Click for details · double-click to rename';
  title.ondblclick = (e) => { e.stopPropagation(); clearTimeout(pendingDetailTimer); inlineRename(); };
  const titleWrap = document.createElement('div');
  titleWrap.className = 'task-titlewrap';
  titleWrap.appendChild(title);
  if (t.subtasks.length) {
    const subs = document.createElement('ul');
    subs.className = 'task-subs';
    t.subtasks.slice(0, 3).forEach((s) => {
      const sli = document.createElement('li');
      if (s.done) sli.className = 'done';
      const st = document.createElement('span');
      st.textContent = s.title || '(untitled)'; st.dir = 'auto';
      sli.appendChild(st);
      sli.title = s.done ? 'Mark subtask open' : 'Mark subtask done';
      sli.onclick = (e) => { e.stopPropagation(); s.done = !s.done; save(); renderAll(); };
      subs.appendChild(sli);
    });
    if (t.subtasks.length > 3) {
      const more = document.createElement('li');
      more.className = 'more';
      more.textContent = `+${t.subtasks.length - 3} more`;
      more.onclick = (e) => { e.stopPropagation(); clearTimeout(pendingDetailTimer); openDetail(t.id); };
      subs.appendChild(more);
    }
    titleWrap.appendChild(subs);
  }
  main.appendChild(titleWrap);
  function inlineRename() {
    const inp = document.createElement('input');
    inp.className = 'task-title'; inp.value = t.title; inp.maxLength = 200;
    inp.dir = 'auto'; inp.setAttribute('aria-label', 'Task title'); inp.draggable = false;
    let settled = false;
    const commit = (ok) => { if (settled) return; settled = true; if (ok) { t.title = inp.value.trim() || t.title; save(); } renderAll(); };
    inp.addEventListener('blur', () => commit(true));
    inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') commit(false); });
    ['click', 'dblclick', 'dragstart'].forEach((ev) => inp.addEventListener(ev, (e2) => e2.stopPropagation()));
    titleWrap.replaceChild(inp, title);
    inp.focus(); inp.select();
  }

  const meta = document.createElement('div'); meta.className = 'task-meta';
  if (opts.showList) {
    const tag = document.createElement('button'); tag.className = 'listname-tag'; tag.textContent = listName(t.listId); tag.title = 'Go to list';
    tag.onclick = (e) => { e.stopPropagation(); go(t.listId); };
    meta.appendChild(tag);
  }
  if (t.date) {
    const dd = displayDate(t), dt = displayTime(t);
    const f = fmtDate(dd);
    const b = document.createElement('span');
    b.className = 'badge date' + (f.diff < 0 && !t.done ? ' overdue' : f.diff === 0 ? ' today' : '');
    b.innerHTML = '<span class="material-icons-outlined">event</span>';
    const s = document.createElement('span'); s.textContent = f.label + (t.time ? ' ' + dt : ''); b.appendChild(s);
    // when the stored wall belongs to another zone, show the origin on hover
    try {
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (t.time && t.tz && localTz && t.tz !== localTz && typeof t.dueUtc === 'number' && t.dueUtc > 0)
        b.title = `Entered as ${t.time} in ${t.tz} — showing local time`;
    } catch {}
    meta.appendChild(b);
  }
  const doneSubs = t.subtasks.filter((s) => s.done).length;
  if (t.subtasks.length) {
    const b = document.createElement('span'); b.className = 'badge';
    b.innerHTML = '<span class="material-icons-outlined">account_tree</span>';
    const s = document.createElement('span'); s.textContent = `${doneSubs}/${t.subtasks.length}`; s.className = 'sub-progress';
    b.appendChild(s); meta.appendChild(b);
  }
  if (t.extRef) {
    const b = document.createElement(isUrl(t.extRef) ? 'a' : 'span');
    b.className = 'badge ext'; b.title = t.extRef;
    if (isUrl(t.extRef)) { b.href = t.extRef; b.target = '_blank'; b.rel = 'noopener'; }
    b.innerHTML = '<span class="material-icons-outlined">link</span>';
    const s = document.createElement('span'); s.textContent = t.extRef.length > 26 ? t.extRef.slice(0, 26) + '…' : t.extRef;
    b.appendChild(s);
    b.onclick = (e) => e.stopPropagation();
    meta.appendChild(b);
  }
  t.weight = clampWeight(t.weight);
  t.importance = clampImp(t.importance);
  const w = document.createElement('button'); w.type = 'button'; w.className = 'badge w-' + t.weight + ' clickable';
  w.innerHTML = `<span class="material-icons-outlined">${WEIGHTS[t.weight].icon}</span>${opts.compact ? WEIGHTS[t.weight].label[0] : WEIGHTS[t.weight].label}`;
  w.title = 'Change weight (now: ' + WEIGHTS[t.weight].label + ')';
  w.onclick = (e) => { e.stopPropagation(); openWeightPop(w, t.id); };
  meta.appendChild(w);
  const im = document.createElement('button'); im.type = 'button'; im.className = 'badge imp-' + t.importance + ' clickable';
  im.innerHTML = `<span class="material-icons-outlined">${IMPORTANCE[t.importance].icon}</span>${opts.compact ? IMPORTANCE[t.importance].label[0] : IMPORTANCE[t.importance].label}`;
  im.title = 'Change importance (now: ' + IMPORTANCE[t.importance].label + ')';
  im.onclick = (e) => { e.stopPropagation(); openImportancePop(im, t.id); };
  meta.appendChild(im);
  if (t.recur && t.recur.freq) {
    const b = document.createElement('span'); b.className = 'badge recur'; b.title = 'Repeats: ' + recurLabel(t.recur);
    b.innerHTML = '<span class="material-icons-outlined">repeat</span>';
    if (!opts.compact) { const s = document.createElement('span'); s.textContent = recurLabel(t.recur); b.appendChild(s); }
    meta.appendChild(b);
  }
  const tsec = Math.floor(taskTime(t.id));
  if (tsec > 0) {
    const b = document.createElement('span'); b.className = 'badge tm'; b.title = 'Time tracked on this task';
    b.innerHTML = '<span class="material-icons-outlined">timer</span>';
    const s = document.createElement('span'); s.textContent = fmtDur(tsec); b.appendChild(s);
    b.onclick = (e) => { e.stopPropagation(); goTime(t.id); };
    meta.appendChild(b);
  }
  if (t.notes) { const b = document.createElement('span'); b.className = 'badge'; b.innerHTML = '<span class="material-icons-outlined">notes</span>Note'; meta.appendChild(b); }
  main.appendChild(meta);

  const actions = document.createElement('div'); actions.className = 'task-actions';
  const dot = document.createElement('button');
  dot.className = 'color-dot-btn'; dot.style.background = colorHex(t.color); dot.title = 'Change label';
  dot.setAttribute('aria-label', 'Change label');
  dot.onclick = (e) => { e.stopPropagation(); openColorPop(dot, t.id, opts.compact); };
  const move = document.createElement('button');
  move.className = 'icon-btn sm'; move.innerHTML = '<span class="material-icons-outlined">drive_file_move</span>'; move.title = 'Move to list';
  move.setAttribute('aria-label', 'Move to list');
  move.onclick = (e) => { e.stopPropagation(); openMovePop(move, t.id); };
  const clock = document.createElement('button');
  clock.className = 'icon-btn sm'; clock.innerHTML = '<span class="material-icons-outlined">timer</span>'; clock.title = 'Track time on this task';
  clock.setAttribute('aria-label', 'Track time');
  clock.onclick = (e) => { e.stopPropagation(); goTime(t.id); };
  const edit = document.createElement('button');
  edit.className = 'icon-btn sm'; edit.innerHTML = '<span class="material-icons-outlined">edit</span>'; edit.title = 'Details';
  edit.setAttribute('aria-label', 'Edit details');
  edit.onclick = (e) => { e.stopPropagation(); openDetail(t.id); };
  const del = document.createElement('button');
  del.className = 'icon-btn sm'; del.innerHTML = '<span class="material-icons-outlined">delete</span>'; del.title = 'Delete';
  del.setAttribute('aria-label', 'Delete task');
  del.onclick = (e) => { e.stopPropagation(); deleteTask(t.id); };
  actions.append(dot, move, clock, edit, del);

  li.append(drag, check, main, actions);
  // Buttons/links/inputs stop propagation themselves, and HTML5 drag on the
  // row is untouched — so moving between lists and sorting keep working.
  li.addEventListener('click', (e) => {
    if (Date.now() < ui.suppressClickUntil) return; // a touch-drag just ended
    if (e.target.closest('button,a,input,textarea,select')) return;
    clearTimeout(pendingDetailTimer);
    pendingDetailTimer = setTimeout(() => openDetail(t.id), 240);
  });

  li.addEventListener('dragstart', (e) => { ui.dragId = t.id; ui.dragListId = null; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', t.id); } catch {} });
  li.addEventListener('dragend', () => { li.classList.remove('dragging'); $$('.task').forEach((x) => x.classList.remove('drop-above', 'drop-below')); $$('.drop-target').forEach((x) => x.classList.remove('drop-target')); });
  li.addEventListener('dragover', (e) => {
    if (!ui.dragId || ui.dragId === t.id) return;
    e.preventDefault(); e.stopPropagation();
    const r = li.getBoundingClientRect();
    const above = (e.clientY - r.top) < r.height / 2;
    li.classList.toggle('drop-above', above); li.classList.toggle('drop-below', !above);
    li.dataset.dropPos = above ? 'above' : 'below';
  });
  li.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    dropOntoTask(ui.dragId, t.id, li.dataset.dropPos === 'below' ? 1 : 0);
  });
  attachTaskTouchDrag(li, t, drag);
  return li;
}

function dropOntoTask(fromId, toId, offset) {
  const from = getTask(fromId), to = getTask(toId);
  if (!from || !to || fromId === toId) return;
  if (isCal() && displayDate(to) && displayDate(from) !== displayDate(to)) {
    moveDueToDate(from, displayDate(to)); save(); renderAll();
    toast(`Moved to ${displayDate(to)}`);
    return;
  }
  if (from.done !== to.done) {
    if (!from.done && to.done) toggleDone(from.id);
    else if (from.done && !to.done) toggleDone(from.id);
    const now = getTask(fromId);
    if (!now || now.done !== to.done) { moveTask(fromId, to.listId); return; }
  }
  if (from.listId !== to.listId) { moveTask(fromId, to.listId, toId, offset); return; }
  // same list reorder — use the full unfiltered group so hidden tasks keep their slots
  const group = listTasks(to.listId).filter((x) => x.done === to.done).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  const without = group.filter((x) => x.id !== from.id);
  let idx = without.findIndex((x) => x.id === to.id) + offset;
  without.splice(Math.max(0, idx), 0, from);
  without.forEach((x, i) => x.order = i);
  ui.sort = state.sort = 'order'; save(); renderAll();
}

/* ---------- list (category) reorder: mouse + touch ---------- */
function clearListDropMarks() { $$('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); }
function reorderLists(fromId, toId, after) {
  const from = state.lists.findIndex((l) => l.id === fromId);
  if (from < 0 || fromId === toId) return;
  const [l] = state.lists.splice(from, 1);
  let to = state.lists.findIndex((x) => x.id === toId) + (after ? 1 : 0);
  state.lists.splice(Math.max(0, to), 0, l);
  save(); renderAll();
  toast(`Moved “${l.name}”`, null);
}
// Touch reorder for lists: long-press on sidebar rows (so scrolling still
// works), drag-on-move on board column handles. Shared drop logic.
let touchListTarget = null, touchListAfter = false;
function attachListTouchDrag(handleEl, listId, markEl, longPress) {
  handleEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const sx = e.touches[0].clientX, sy = e.touches[0].clientY;
    let active = false;
    const begin = () => {
      active = true; ui.dragListId = listId; ui.dragId = null;
      touchListTarget = null; touchListAfter = false;
      markEl.classList.add('dragging', 'dragging-col');
      if (navigator.vibrate) { try { navigator.vibrate(25); } catch {} }
    };
    const timer = longPress ? setTimeout(begin, 380) : 0;
    const cleanup = () => { clearTimeout(timer); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onEnd); document.removeEventListener('touchcancel', onEnd); };
    const onMove = (ev) => {
      const t = ev.touches[0]; if (!t) return;
      if (!active) {
        if (!longPress && Math.hypot(t.clientX - sx, t.clientY - sy) > 8) begin();
        else if (longPress && Math.hypot(t.clientX - sx, t.clientY - sy) > 10) { cleanup(); return; }
        else return;
      }
      ev.preventDefault();
      clearListDropMarks();
      touchListTarget = null;
      const under = document.elementFromPoint(t.clientX, t.clientY);
      const row = under && under.closest ? under.closest('.list-item[data-list-id],.board-col[data-list-id]') : null;
      if (row) {
        const rid = row.dataset.listId;
        if (rid && rid !== listId) {
          const r = row.getBoundingClientRect();
          const horiz = row.classList.contains('board-col');
          const after = horiz ? (t.clientX - r.left) > r.width / 2 : (t.clientY - r.top) > r.height / 2;
          row.classList.add(after ? 'drop-after' : 'drop-before');
          row.dataset.listDropPos = after ? 'after' : 'before';
          touchListTarget = rid; touchListAfter = after;
        }
      }
    };
    const onEnd = () => {
      const wasActive = active, target = touchListTarget, after = touchListAfter;
      cleanup();
      markEl.classList.remove('dragging', 'dragging-col');
      clearListDropMarks();
      ui.dragListId = null; touchListTarget = null;
      if (wasActive) {
        ui.suppressClickUntil = Date.now() + 450;
        if (target) reorderLists(listId, target, after);
      }
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }, { passive: true });
}

// Touch sort/move for tasks (mobile has no HTML5 drag-and-drop):
// drag the ⠿⠿ handle — the handle never scrolls (touch-action:none),
// everywhere else on the row still scrolls normally.
let touchTaskTarget = null; // {type:'task',id,offset} | {type:'list',listId}
function clearTaskTouchMarks() { $$('.drop-above,.drop-below,.drop-target').forEach((x) => x.classList.remove('drop-above', 'drop-below', 'drop-target')); }
function attachTaskTouchDrag(li, t, handle) {
  handle.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const sx = e.touches[0].clientX, sy = e.touches[0].clientY;
    let active = false;
    const cleanup = () => { document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onEnd); document.removeEventListener('touchcancel', onEnd); };
    const onMove = (ev) => {
      const th = ev.touches[0]; if (!th) return;
      if (!active) {
        if (Math.hypot(th.clientX - sx, th.clientY - sy) < 12) return;
        active = true; ui.dragId = t.id; ui.dragListId = null;
        touchTaskTarget = null;
        li.classList.add('touch-dragging');
        if (navigator.vibrate) { try { navigator.vibrate(20); } catch {} }
      }
      ev.preventDefault();
      clearTaskTouchMarks();
      touchTaskTarget = null;
      const under = document.elementFromPoint(th.clientX, th.clientY);
      const row = under && under.closest ? under.closest('.task[data-id]') : null;
      if (row && row.dataset.id !== t.id) {
        const r = row.getBoundingClientRect();
        const above = (th.clientY - r.top) < r.height / 2;
        row.classList.add(above ? 'drop-above' : 'drop-below');
        row.dataset.dropPos = above ? 'above' : 'below';
        touchTaskTarget = { type: 'task', id: row.dataset.id, offset: above ? 0 : 1 };
        return;
      }
      const cell = under && under.closest ? under.closest('.cal-cell[data-iso]') : null;
      if (cell && cell.dataset.iso) {
        cell.classList.add('drop-target');
        touchTaskTarget = { type: 'day', date: cell.dataset.iso };
        return;
      }
      const agenda = under && under.closest ? under.closest('#calDayList,.cal-side') : null;
      if (agenda && isCal()) {
        agenda.classList.add('drop-target');
        touchTaskTarget = { type: 'day', date: calDaySel() };
        return;
      }
      const zone = under && under.closest ? under.closest('.board-col-body,.board-col,.list-item[data-list-id],#openList') : null;
      if (zone) {
        const col = zone.closest('.board-col[data-list-id]');
        const side = zone.closest('.list-item[data-list-id]');
        const listId = col ? col.dataset.listId : side ? side.dataset.listId : (activeList() || fallbackList() || {}).id;
        if (listId) {
          (col || zone).classList.add('drop-target');
          touchTaskTarget = { type: 'list', listId };
        }
      }
    };
    const onEnd = () => {
      const target = active ? touchTaskTarget : null;
      cleanup();
      li.classList.remove('touch-dragging');
      clearTaskTouchMarks();
      ui.dragId = null; touchTaskTarget = null;
      if (active) {
        ui.suppressClickUntil = Date.now() + 450;
        if (target) {
          if (target.type === 'task') dropOntoTask(t.id, target.id, target.offset);
          else if (target.type === 'day') {
            const task = getTask(t.id);
            if (task && displayDate(task) !== target.date) {
              moveDueToDate(task, target.date); save(); renderAll();
              toast(`Moved to ${target.date}`);
            }
          }
          else moveTask(t.id, target.listId);
        }
      }
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
  }, { passive: true });
}

function moveTask(taskId, targetListId, beforeTaskId = null, offset = 1) {
  const t = getTask(taskId); if (!t) return;
  if (!state.lists.some((l) => l.id === targetListId)) return;
  const fromName = listName(t.listId);
  t.listId = targetListId;
  // place: if beforeTaskId given, insert near it; else append
  const group = listTasks(targetListId).filter((x) => x.id !== t.id && x.done === t.done).sort((a, b) => a.order - b.order);
  if (beforeTaskId) {
    const idx = group.findIndex((x) => x.id === beforeTaskId) + offset;
    group.splice(Math.max(0, idx), 0, t);
  } else group.push(t);
  group.forEach((x, i) => x.order = i);
  ui.sort = state.sort = 'order'; save(); renderAll();
  toast(`Moved to “${listName(targetListId)}”`, null);
  void fromName;
}

/* ---------- views ---------- */
function renderCurrentView() {
  $('#viewHome').classList.toggle('hidden', !isHome());
  $('#viewList').classList.toggle('hidden', !activeList());
  $('#viewAll').classList.toggle('hidden', !isAll());
  $('#viewCal').classList.toggle('hidden', !isCal());
  $('#viewTime').classList.toggle('hidden', !isTime());
  document.body.classList.toggle('view-board', isAll());
  document.body.classList.toggle('view-cal', isCal());
  document.body.classList.toggle('view-time', isTime());
  if (isHome()) renderHome();
  else if (isAll()) renderBoard();
  else if (isCal()) renderCalendar();
  else if (isTime()) renderTime();
  else renderSingle();
}

/* ---------- notifications (fired calendar reminders) ----------
   A reminder "fires" when its trigger time (due minus offset) has passed —
   Google shows the popup/email, not us. Fired tasks are listed in a section
   on Home, and the Home sidebar row carries a red unread badge. Tapping Home
   marks everything seen and clears the app-icon badge (Badging API, where
   supported). */
const NOTIF_SEEN_KEY = 'doto-notif-seen';
function firedReminders() {
  const now = Date.now();
  return state.tasks
    .filter((t) => t && !t.done && typeof t.remindBefore === 'number' && dueTs(t) && triggerTs(t) <= now)
    .sort((a, b) => triggerTs(b) - triggerTs(a));
}
function notifSeenAt() { try { return parseInt(localStorage.getItem(NOTIF_SEEN_KEY) || '0', 10) || 0; } catch { return 0; } }
function unreadNotifCount() {
  const seen = notifSeenAt();
  return firedReminders().filter((t) => triggerTs(t) > seen).length;
}
let lastBadgeN = -1;
function syncAppBadge(n) {
  if (n === lastBadgeN) return;
  lastBadgeN = n;
  try {
    if ('setAppBadge' in navigator) {
      if (n > 0) navigator.setAppBadge(n).catch(() => {});
      else if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {});
    }
  } catch {}
}
function markNotifSeen() {
  try { localStorage.setItem(NOTIF_SEEN_KEY, String(Date.now())); } catch {}
  lastBadgeN = -1;
  try { if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {}); } catch {}
}
function renderNotif() {
  const list = firedReminders();
  const card = $('#notifCard');
  if (card) card.classList.toggle('hidden', !list.length);
  const pill = $('#notifCountPill');
  if (pill) pill.textContent = list.length ? `${list.length} fired` : '';
  const ul = $('#notifList');
  if (!ul) return;
  ul.innerHTML = '';
  list.forEach((t) => ul.appendChild(taskRow(t, { showList: true })));
}

/* ---------- daily quote + weather (Home) ---------- */
const QUOTES = [
  'Small steps every day lead to big results.',
  'Done is better than perfect.',
  'What gets written down gets done.',
  'Focus on the next single task, not the whole mountain.',
  'A clear list is a calm mind.',
  'Start with the hardest task — the rest feels easy.',
  'Little by little, a little becomes a lot.',
  'Plan the work, then work the plan.',
  'You do not have to be perfect, just consistent.',
  'Finish one thing before starting another.',
  'Energy flows where attention goes.',
  'Today is a good day to make progress.',
  'Break it down until the first step feels trivial.',
  'Order your day, or your day will order you.',
  'Progress, not perfection.',
  'The best time to start was yesterday. The next best time is now.',
  'Keep it simple, keep it moving.',
  'Tidy tasks, tidy mind.',
  'One list, one focus, one win at a time.',
  'Future you will thank present you.',
  'Capture everything, remember nothing.',
  'Heavy tasks first, light tasks fill the gaps.',
  'A task with a date is a promise to yourself.',
  'Less but better.',
];
let quoteIdx = null; // null = today's quote; refresh picks a random different one
function renderQuote() {
  const el = $('#quoteText'); if (!el) return;
  if (quoteIdx === null) quoteIdx = Math.floor(Date.now() / 864e5) % QUOTES.length;
  el.textContent = '“' + QUOTES[quoteIdx] + '”';
}
function refreshQuote() {
  let n = quoteIdx;
  while (n === quoteIdx) n = Math.floor(Math.random() * QUOTES.length);
  quoteIdx = n;
  renderQuote();
}
let weatherCache = null; // [args] | { fail: true, ts }
function wmoInfo(code, isDay) {
  if (code === 0) return { label: 'Clear sky', icon: isDay ? 'wb_sunny' : 'nights_stay' };
  if (code <= 2) return { label: code === 1 ? 'Mainly clear' : 'Partly cloudy', icon: isDay ? 'wb_cloudy' : 'nights_stay' };
  if (code === 3) return { label: 'Overcast', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: 'cloud' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: 'umbrella' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Rain', icon: 'umbrella' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Snow', icon: 'ac_unit' };
  if (code >= 95) return { label: 'Thunderstorm', icon: 'flash_on' };
  return { label: '', icon: 'wb_cloudy' };
}
function paintWeather(temp, label, icon, city, tom) {
  const card = $('#weatherCard'); if (!card) return;
  $('#weatherIcon').textContent = icon;
  $('#weatherTemp').textContent = Math.round(temp) + '°C';
  $('#weatherDesc').textContent = (city ? city + ' · ' : '') + label;
  if (tom) {
    const info = wmoInfo(tom.code, true);
    $('#wxTomIcon').textContent = info.icon;
    $('#wxTomTemp').textContent = `${Math.round(tom.max)}° / ${Math.round(tom.min)}°`;
  }
  card.classList.remove('hidden');
}
async function loadWeather() {
  if (weatherCache && Array.isArray(weatherCache)) { paintWeather(...weatherCache); return; }
  if (weatherCache && weatherCache.fail && Date.now() - weatherCache.ts < 600000) return;
  const LOC_KEY = 'doto-loc', LOC_TTL = 7 * 864e5; // re-resolve at most weekly
  const readStored = () => {
    try {
      const o = JSON.parse(localStorage.getItem(LOC_KEY));
      if (o && typeof o.lat === 'number' && typeof o.lon === 'number' && Date.now() - (o.ts || 0) < LOC_TTL) return o;
    } catch {}
    return null;
  };
  const store = (lat, lon) => { try { localStorage.setItem(LOC_KEY, JSON.stringify({ lat, lon, ts: Date.now() })); } catch {} };
  const fail = () => { weatherCache = { fail: true, ts: Date.now() }; };
  let lat, lon;
  const stored = readStored();
  if (stored) { lat = stored.lat; lon = stored.lon; }
  else {
    let pos = null;
    if (navigator.geolocation) {
      pos = await new Promise((res) => navigator.geolocation.getCurrentPosition(res, () => res(null), { timeout: 8000, maximumAge: 600000 }));
    }
    if (pos) { lat = pos.coords.latitude; lon = pos.coords.longitude; store(lat, lon); }
    else {
      try {
        const ip = await (await fetch('https://ipapi.co/json/')).json();
        if (!ip || ip.latitude === undefined) { fail(); return; }
        lat = ip.latitude; lon = ip.longitude; store(lat, lon);
      } catch { fail(); return; }
    }
  }
  try {
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,weathercode&forecast_days=2&timezone=auto`)).json();
    if (!w || !w.current) { fail(); return; }
    const info = wmoInfo(w.current.weather_code, w.current.is_day !== 0);
    const tom = w.daily && w.daily.time && w.daily.time[1]
      ? { max: w.daily.temperature_2m_max[1], min: w.daily.temperature_2m_min[1], code: w.daily.weathercode[1] }
      : null;
    let city = '';
    try {
      const g = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`)).json();
      city = g.city || g.locality || '';
    } catch {}
    weatherCache = [w.current.temperature_2m, info.label, info.icon, city, tom];
    paintWeather(...weatherCache);
  } catch { fail(); }
}

function statCard(label, n, icon, color, fn) {
  const d = document.createElement('button'); d.type = 'button'; d.className = 'stat clickable';
  d.innerHTML = `<div class="num" style="color:${color}"></div><div class="lbl"></div>`;
  d.querySelector('.num').textContent = n; d.querySelector('.lbl').textContent = label;
  d.onclick = fn; return d;
}

function renderHome() {
  renderQuote();
  loadWeather();
  const t = todayIso();
  const pool = state.tasks.filter(matchesFilters);
  const open = pool.filter((x) => !x.done);
  const overdue = open.filter((x) => displayDate(x) && displayDate(x) < t).sort(sortFn());
  const today = open.filter((x) => displayDate(x) === t).sort(sortFn());
  const impRank = { high: 0, medium: 1, low: 2 }, wRank = { heavy: 0, medium: 1, light: 2 };
  const important = [...open].sort((a, b) => impRank[a.importance] - impRank[b.importance] || wRank[a.weight] - wRank[b.weight] || (displayDate(a) || '9999').localeCompare(displayDate(b) || '9999')).slice(0, 8);
  const heavy = open.filter((x) => x.weight === 'heavy').sort(sortFn()).slice(0, 8);
  const doneCount = state.tasks.filter((x) => x.done).length;

  $('#homeDate').innerHTML = '';
  $('#homeDate').append(
    document.createTextNode('Today is ' + new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + ' · '),
    (() => { const st = document.createElement('strong'); st.id = 'dateClock'; st.innerHTML = '<span id="clockH">--</span><span id="clockColon">:</span><span id="clockM">--</span> <span id="clockAP"></span>'; return st; })()
  );
  paintHomeClock();
  const h = new Date().getHours();
  const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  const nm = (state.userName || '').trim();
  $('#homeGreet').textContent = nm ? `Good ${part}, ${nm}` : `Good ${part}`;
  $('#homeSub').textContent = open.length
    ? `You have ${open.length} open task${open.length === 1 ? '' : 's'}, ${overdue.length} overdue, ${today.length} due today.`
    : 'Everything is done. Enjoy your day!';
  const tIso = t;
  const trackedToday = state.times.filter((r) => recDay(r) === tIso).reduce((a, r) => a + r.seconds, 0)
    + (state.timer && state.timer.running ? timerElapsed() : 0);

  const stats = $('#homeStats'); stats.innerHTML = '';
  stats.append(
    statCard('Open', open.length, 0, 'var(--blue)', () => go(ALL)),
    statCard('Overdue', overdue.length, 0, 'var(--danger)', () => $('#homeOverdue').scrollIntoView({ behavior: 'smooth' })),
    statCard('Due today', today.length, 0, 'var(--blue)', () => $('#homeToday').scrollIntoView({ behavior: 'smooth' })),
    statCard('Completed', doneCount, 0, 'var(--ok)', () => go(ALL)),
    statCard('Tracked today', trackedToday > 0 ? fmtDur(trackedToday) : '–', 0, 'var(--blue)', () => go(TIME)),
  );

  const fill = (id, arr, empty) => {
    const ul = $(id); ul.innerHTML = '';
    if (!arr.length) { const p = document.createElement('p'); p.className = 'mini-empty'; p.textContent = empty; ul.appendChild(p); return; }
    arr.forEach((x) => ul.appendChild(taskRow(x, { showList: true })));
  };
  fill('#homeOverdue', overdue.slice(0, 10), 'Nothing overdue. Nice.');
  fill('#homeToday', today.slice(0, 10), 'Nothing due today.');
  fill('#homeImportant', important, 'No open tasks.');
  fill('#homeHeavy', heavy, 'No heavy tasks. Add weight in task details.');
  renderNotif(); // fired-reminder section (hidden when empty)
}

function renderSingle() {
  const list = activeList(); if (!list) return go(HOME);
  $('#listTitle').textContent = list.name;
  $('#addInput').placeholder = 'Add task to ' + list.name;
  const all = tasksFor(list.id);
  const open = all.filter((t) => !t.done), done = all.filter((t) => t.done);
  const openUl = $('#openList'); openUl.innerHTML = '';
  open.forEach((t) => openUl.appendChild(taskRow(t)));
  $('#openEmpty').classList.toggle('hidden', open.length > 0);
  // allow dropping foreign tasks onto empty/open list area
  openUl.ondragover = (e) => { if (ui.dragId) { const f = getTask(ui.dragId); if (f && f.listId !== list.id) e.preventDefault(); } };
  openUl.ondrop = (e) => { e.preventDefault(); if (ui.dragId) moveTask(ui.dragId, list.id); };
  const doneUl = $('#doneList'); doneUl.innerHTML = '';
  done.forEach((t) => doneUl.appendChild(taskRow(t)));
  const showDone = state.showCompleted && (ui.completedOpen || $('#searchInput').value.trim());
  doneUl.style.display = showDone ? '' : 'none';
  $('.completed-section').style.display = state.showCompleted ? '' : 'none';
  $('#completedToggle').setAttribute('aria-expanded', String(ui.completedOpen));
  $('#completedCount').textContent = done.length ? String(done.length) : '';
  $('#completedCount').classList.toggle('hidden', !done.length);
  $('#taskCount').textContent = open.length ? `${open.length} open` : 'All done';
  paintQuickMeta();
}

function renderBoard() {
  const board = $('#board'); board.innerHTML = '';
  state.lists.forEach((l) => {
    const col = document.createElement('div'); col.className = 'board-col'; col.dataset.listId = l.id;
    const all = tasksFor(l.id);
    const open = all.filter((t) => !t.done), done = all.filter((t) => t.done);
    const openN = open.length;
    col.innerHTML = `<div class="board-col-head"><span class="col-drag material-icons-outlined" title="Drag to reorder lists">drag_indicator</span><span class="material-icons-outlined" style="color:var(--muted)">list</span><h3></h3><span class="c">${openN} open</span><button class="icon-btn sm" title="Open list"><span class="material-icons-outlined">open_in_new</span></button></div><div class="board-col-body"></div>`;
    col.querySelector('h3').textContent = l.name;
    col.querySelector('h3').dir = 'auto';
    col.querySelector('.icon-btn').onclick = () => go(l.id);
    const add = document.createElement('form'); add.className = 'board-add'; add.autocomplete = 'off';
    add.innerHTML = `<input maxlength="200" aria-label="Add task" dir="auto" />`;
    add.querySelector('input').placeholder = 'Add task to ' + l.name;
    add.onsubmit = (e) => {
      e.preventDefault();
      const inp = add.querySelector('input'); if (!inp.value.trim()) return;
      addTaskTo(l.id, inp.value, {}, true); inp.value = '';
    };
    col.insertBefore(add, col.querySelector('.board-col-body'));
    const body = col.querySelector('.board-col-body');
    const ul = document.createElement('ul'); ul.className = 'task-list'; ul.style.margin = '0';
    open.forEach((t) => ul.appendChild(taskRow(t, { compact: true })));
    if (!open.length && !done.length) { const p = document.createElement('p'); p.className = 'mini-empty'; p.textContent = 'Drop tasks here'; body.appendChild(p); }
    body.appendChild(ul);
    // completed hidden by default, expandable per column — like list view
    if (state.showCompleted && done.length) {
      const expanded = !!ui.boardDone[l.id] || $('#searchInput').value.trim();
      const tog = document.createElement('button');
      tog.className = 'completed-toggle board-completed';
      tog.setAttribute('aria-expanded', String(expanded));
      tog.innerHTML = `<span class="material-icons-outlined chev">expand_more</span><span>Completed</span><span class="count-pill muted">${done.length}</span>`;
      tog.onclick = () => { ui.boardDone[l.id] = !ui.boardDone[l.id]; renderAll(); };
      body.appendChild(tog);
      if (expanded) {
        const dul = document.createElement('ul'); dul.className = 'task-list done'; dul.style.margin = '0';
        done.forEach((t) => dul.appendChild(taskRow(t, { compact: true })));
        body.appendChild(dul);
      }
    }
    body.addEventListener('dragover', (e) => { if (ui.dragId) { e.preventDefault(); col.classList.add('drop-target'); } });
    body.addEventListener('dragleave', () => col.classList.remove('drop-target'));
    body.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('drop-target'); if (ui.dragId) { const f = getTask(ui.dragId); if (f && f.listId !== l.id) moveTask(ui.dragId, l.id); } });
    // mouse: column reorder starts from the header grip only (tasks drag freely)
    const grip = col.querySelector('.col-drag');
    grip.addEventListener('mousedown', () => { col.draggable = true; });
    document.addEventListener('mouseup', () => { if (col.isConnected) col.draggable = false; }, { once: true });
    col.addEventListener('dragstart', (e) => {
      if (e.target !== col) return; // a task drag bubbling up — ignore
      ui.dragListId = l.id; ui.dragId = null;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', 'list:' + l.id); } catch {}
    });
    col.addEventListener('dragend', () => { col.draggable = false; ui.dragListId = null; col.classList.remove('dragging-col'); clearListDropMarks(); });
    col.addEventListener('dragover', (e) => {
      if (ui.dragId || !ui.dragListId || ui.dragListId === l.id) return;
      e.preventDefault();
      const r = col.getBoundingClientRect();
      const after = (e.clientX - r.left) > r.width / 2;
      col.classList.toggle('drop-before', !after); col.classList.toggle('drop-after', after);
      col.dataset.listDropPos = after ? 'after' : 'before';
    });
    col.addEventListener('dragleave', () => col.classList.remove('drop-before', 'drop-after'));
    col.addEventListener('drop', (e) => {
      if (!ui.dragListId) return;
      e.preventDefault(); e.stopPropagation();
      col.classList.remove('drop-before', 'drop-after');
      reorderLists(ui.dragListId, l.id, col.dataset.listDropPos === 'after');
    });
    // touch: drag the grip to reorder (column body still scrolls)
    attachListTouchDrag(grip, l.id, col, false);
    board.appendChild(col);
  });
  if (!state.lists.length) board.innerHTML = '<p class="mini-empty">No lists yet — create one from the sidebar.</p>';
}

/* ---------- calendar view ---------- */
function calMonth() {
  if (!/^\d{4}-\d{2}$/.test(ui.calCursor || '')) {
    const d = new Date();
    ui.calCursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return ui.calCursor;
}
function calDaySel() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ui.calDay || '')) ui.calDay = todayIso();
  return ui.calDay;
}
function renderCalendar() {
  $$('#calViewSeg button').forEach((b) => {
    const on = (ui.calView || 'month') === b.dataset.v;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-selected', String(on));
  });
  const gridAnim = ui.calAnim; ui.calAnim = null;
  const yw = $('#calYearGrid'), wrap = $('.cal-wrap');
  if ((ui.calView || 'month') === 'year') { yw.classList.remove('hidden'); wrap.classList.add('hidden'); renderYear(gridAnim); return; }
  yw.classList.add('hidden'); wrap.classList.remove('hidden');
  {
    const m = calMonth(), sel = calDaySel();
    if (!sel.startsWith(m + '-')) {
      const t = todayIso();
      ui.calDay = t.startsWith(m + '-') ? t : m + '-01';
    }
  }
  const [Y, M] = calMonth().split('-').map(Number);
  const first = new Date(Y, M - 1, 1);
  // Monday-first grid
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(Y, M, 0).getDate();
  const tIso = todayIso(), sel = calDaySel();
  $('#calTitle').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const dow = $('#calDow'); dow.innerHTML = '';
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d, idx) => {
    const s = document.createElement('span'); s.textContent = d;
    if (idx >= 5) s.classList.add('weekend');
    dow.appendChild(s);
  });
  const dated = allFiltered().filter((t) => displayDate(t) && (!t.done || state.showCompleted));
  const byDay = new Map();
  dated.forEach((t) => {
    const dd = displayDate(t);
    if (!byDay.has(dd)) byDay.set(dd, []);
    byDay.get(dd).push(t);
  });
  const grid = $('#calGrid'); grid.innerHTML = '';
  if (gridAnim) {
    grid.classList.remove('zoom-out', 'zoom-in', 'slide-l', 'slide-r');
    void grid.offsetWidth; // restart the animation on every change
    grid.classList.add({ in: 'zoom-in', out: 'zoom-out', next: 'slide-l', prev: 'slide-r' }[gridAnim] || 'zoom-out');
  }
  const total = Math.ceil((lead + days) / 7) * 7;
  for (let i = 0; i < total; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    const dn = i - lead + 1;
    if (dn < 1 || dn > days) { cell.classList.add('out'); grid.appendChild(cell); continue; }
    const iso = `${Y}-${String(M).padStart(2, '0')}-${String(dn).padStart(2, '0')}`;
    const list = (byDay.get(iso) || []).sort(sortFn());
    const openN = list.filter((t) => !t.done).length;
    if ((i % 7) >= 5) cell.classList.add('weekend');
    cell.dataset.iso = iso;
    if (iso === tIso) cell.classList.add('today');
    if (iso === sel) cell.classList.add('selected');
    if (openN && iso < tIso) cell.classList.add('has-overdue');
    const head = document.createElement('button');
    head.className = 'cal-num'; head.textContent = dn;
    head.setAttribute('aria-label', iso);
    head.onclick = (e) => { e.stopPropagation(); ui.calDay = iso; renderAll(); };
    cell.appendChild(head);
    // whole tile selects the day (chips/buttons stop propagation themselves)
    cell.addEventListener('click', () => { ui.calDay = iso; renderAll(); });
    list.slice(0, 3).forEach((t) => {
      const chip = document.createElement('button');
      chip.className = 'cal-chip' + (t.done ? ' done' : '');
      chip.style.setProperty('--task-color', colorHex(t.color));
      chip.dir = 'auto'; chip.title = t.title || '(untitled)';
      chip.textContent = t.title || '(untitled)';
      chip.onclick = (e) => { e.stopPropagation(); openDetail(t.id); };
      cell.appendChild(chip);
    });
    if (list.length > 3) {
      const more = document.createElement('button');
      more.className = 'cal-more'; more.textContent = `+${list.length - 3} more`;
      more.onclick = () => { ui.calDay = iso; renderAll(); $('#calDayTitle').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
      cell.appendChild(more);
    }
    // mouse drop to reschedule
    cell.addEventListener('dragover', (e) => { if (ui.dragId) { e.preventDefault(); cell.classList.add('drop-target'); } });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault(); cell.classList.remove('drop-target');
      const t = getTask(ui.dragId); if (!t || displayDate(t) === iso) return;
      moveDueToDate(t, iso); save(); renderAll();
      toast(`Moved to ${iso}`);
    });
    grid.appendChild(cell);
  }
  // agenda
  const dayTasks = (byDay.get(sel) || []).sort(sortFn());
  const dObj = new Date(sel + 'T12:00:00');
  $('#calDayTitle').textContent = dObj.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('#calDayCount').textContent = dayTasks.filter((t) => !t.done).length ? `${dayTasks.filter((t) => !t.done).length} open` : '';
  $('#calAddInput').placeholder = `Add task on ${dObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  const ul = $('#calDayList'); ul.innerHTML = '';
  if (!dayTasks.length) {
    const p = document.createElement('p'); p.className = 'mini-empty'; p.textContent = 'No tasks this day — add one above or drag a task here.';
    ul.appendChild(p);
  }
  dayTasks.forEach((t) => ul.appendChild(taskRow(t, { showList: true })));
  ul.ondragover = (e) => { if (ui.dragId) e.preventDefault(); };
  ul.ondrop = (e) => {
    e.preventDefault();
    const t = getTask(ui.dragId); if (!t || displayDate(t) === sel) return;
    moveDueToDate(t, sel); save(); renderAll();
    toast(`Moved to ${sel}`);
  };
}
function renderYear(gridAnim) {
  if (!ui.calYear) ui.calYear = new Date().getFullYear();
  const Y = ui.calYear, tIso = todayIso();
  $('#calTitle').textContent = Y;
  const busy = new Set(allFiltered().filter((t) => displayDate(t) && displayDate(t).startsWith(Y + '-') && (!t.done || state.showCompleted)).map((t) => displayDate(t)));
  const grid = $('#calYearGrid'); grid.innerHTML = '';
  if (gridAnim) {
    grid.classList.remove('zoom-out', 'zoom-in', 'slide-l', 'slide-r');
    void grid.offsetWidth;
    grid.classList.add({ in: 'zoom-in', out: 'zoom-out', next: 'slide-l', prev: 'slide-r' }[gridAnim] || 'zoom-out');
  }
  const now = new Date();
  for (let m = 1; m <= 12; m++) {
    const card = document.createElement('button');
    card.className = 'cal-ym' + (Y === now.getFullYear() && m === now.getMonth() + 1 ? ' current' : '');
    const name = new Date(Y, m - 1, 1).toLocaleDateString(undefined, { month: 'long' });
    const lead = (new Date(Y, m - 1, 1).getDay() + 6) % 7;
    const days = new Date(Y, m, 0).getDate();
    const cells = [];
    for (let b = 0; b < lead; b++) cells.push('<span></span>');
    for (let d = 1; d <= days; d++) {
      const iso = `${Y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cls = [busy.has(iso) ? 'has' : '', (lead + d - 1) % 7 >= 5 ? 'weekend' : '', iso === tIso ? 'today' : ''].filter(Boolean).join(' ');
      cells.push(`<span${cls ? ` class="${cls}"` : ''}>${d}</span>`);
    }
    card.innerHTML = `<h3></h3><div class="cal-ym-grid">${cells.join('')}</div>`;
    card.querySelector('h3').textContent = name;
    card.setAttribute('aria-label', name + ' ' + Y);
    card.onclick = () => {
      const mm = `${Y}-${String(m).padStart(2, '0')}`;
      ui.calCursor = mm;
      const t = todayIso();
      ui.calDay = t.startsWith(mm + '-') ? t : mm + '-01';
      ui.calView = 'month'; ui.calAnim = 'in'; renderAll();
    };
    grid.appendChild(card);
  }
}

/* ---------- time tracker ---------- */
function fmtClock(sec) {
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(cs)}`;
}
function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return s ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}
function fmtDurShort(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return `${m}m`;
  return `${sec}s`;
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch { return false; }
  }
}
function timerElapsed() {
  const tm = state.timer; if (!tm) return 0;
  return (tm.acc || 0) + (tm.running ? (Date.now() - tm.startedAt) / 1000 : 0);
}
// local calendar day of a record (UTC slicing misplaces evening records)
function recDay(r) {
  const d = new Date(r.startedAt);
  return isNaN(d) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function taskTime(taskId) {
  let s = state.times.filter((r) => r.taskId === taskId).reduce((a, r) => a + (r.seconds || 0), 0);
  if (state.timer && state.timer.taskId === taskId) s += timerElapsed();
  return s;
}
function selectTimeTask(id) { ui.timeTaskId = id; renderAll(); }
function goTime(taskId) {
  if (taskId && getTask(taskId)) ui.timeTaskId = taskId;
  state.activeView = TIME; save(); closeSidebar(); renderAll();
  window.scrollTo({ top: 0 });
  setTimeout(() => $('#viewTime').scrollIntoView({ block: 'start' }), 60);
  // reveal the task inside the (self-scrolling) picker column
  setTimeout(() => {
    const sel = document.querySelector('#timeTaskList .time-pick.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }, 120);
}
function timePlay() {
  const id = ui.timeTaskId;
  if (!id || !getTask(id)) { toast('Pick a task first'); return; }
  const tm = state.timer;
  if (tm && tm.running) {
    if (tm.taskId === id) return;
    toast('Stop the running timer first'); return;
  }
  if (tm && !tm.running && tm.taskId !== id) {
    const secs = Math.round(timerElapsed());
    if (secs >= 1) {
      const rec = { id: uid(), taskId: tm.taskId, seconds: secs, startedAt: Date.now() - (tm.acc || 0) * 1000 };
      const prev = getTask(tm.taskId);
      rec.title = prev ? prev.title : '(deleted task)';
      rec.listName = prev ? listName(prev.listId) : '';
      state.times.unshift(rec);
      toast(`Saved ${fmtDur(secs)} on previous task`);
    } else toast('Paused time was too short — nothing saved');
    state.timer = null;
  }
  state.timer = { taskId: id, startedAt: Date.now(), acc: (state.timer && state.timer.acc) || 0, running: true };
  save(); renderAll();
  armTick();
}
function timePause() {
  const tm = state.timer; if (!tm || !tm.running) return;
  tm.acc = timerElapsed(); tm.running = false;
  save(); renderAll();
}
function timeStop() {
  const tm = state.timer; if (!tm) return;
  const secs = Math.round(timerElapsed());
  const rec = { id: uid(), taskId: tm.taskId, seconds: secs };
  const t = getTask(tm.taskId);
  rec.title = t ? t.title : '(deleted task)';
  rec.listName = t ? listName(t.listId) : '';
  rec.startedAt = tm.running ? tm.startedAt - (tm.acc || 0) * 1000 : Date.now() - (tm.acc || 0) * 1000;
  state.timer = null;
  if (secs < 1) { save(); renderAll(); toast('Too short — nothing saved'); return; }
  state.times.unshift(rec);
  save(); renderAll();
  toast(`Saved ${fmtDur(secs)}`, () => { state.times = state.times.filter((r) => r.id !== rec.id); save(); renderAll(); });
}
function paintHomeClock() {
  if (!isHome()) return;
  const hEl = $('#clockH'), mEl = $('#clockM'), apEl = $('#clockAP'), cEl = $('#clockColon');
  if (!hEl || !mEl) return;
  const d = new Date();
  let h = d.getHours();
  if (apEl) apEl.textContent = h >= 12 ? 'PM' : 'AM';
  hEl.textContent = String(h % 12 || 12).padStart(2, '0');
  mEl.textContent = String(d.getMinutes()).padStart(2, '0');
  if (cEl) cEl.style.opacity = Math.floor(Date.now() / 500) % 2 ? '1' : '0.2';
}
let tickHandle = 0;
function armTick() {
  if (tickHandle) return;
  tickHandle = setInterval(() => {
    if (!state.timer || !state.timer.running) { clearInterval(tickHandle); tickHandle = 0; return; }
    tickTime();
  }, 100);
}
function tickTime() {
  if (!state.timer || !state.timer.running) return;
  const el = $('#timeDisplay');
  if (el) el.textContent = fmtClock(timerElapsed());
  const tc = $('#timeCount');
  if (tc) {
    const today = todayIso();
    const s = state.times.filter((r) => recDay(r) === today).reduce((a, r) => a + r.seconds, 0) + timerElapsed();
    tc.textContent = s > 0 ? fmtDur(s) : '';
  }
  const pill = $('#timeTotalPill');
  if (pill && isTime()) {
    const s = state.times.reduce((a, r) => a + r.seconds, 0) + timerElapsed();
    pill.textContent = s ? `Tracked ${fmtDur(s)}` : 'Nothing tracked yet';
  }
}
function renderTime() {
  // sidebar badge: today's total
  const today = todayIso();
  const todayS = state.times.filter((r) => recDay(r) === today).reduce((a, r) => a + r.seconds, 0)
    + (state.timer && state.timer.running ? timerElapsed() : (state.timer ? state.timer.acc || 0 : 0));
  $('#timeCount').textContent = todayS > 0 ? fmtDur(todayS) : '';
  const allS = state.times.reduce((a, r) => a + r.seconds, 0) + (state.timer ? timerElapsed() : 0);
  $('#timeTotalPill').textContent = allS ? `Tracked ${fmtDur(allS)}` : 'Nothing tracked yet';
  // middle: records grouped by Today / Previously
  const ul = $('#timeRecords'); ul.innerHTML = '';
  if (!state.times.length) {
    const p = document.createElement('p'); p.className = 'mini-empty'; p.textContent = 'No time logged yet — start the tracker.';
    ul.appendChild(p);
  }
  const timeRecRow = (r) => {
    const li = document.createElement('li'); li.className = 'time-rec';
    const d = new Date(r.startedAt);
    const when = isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `<span class="dot"></span><div class="time-rec-main"><div class="time-rec-title" dir="auto"></div><div class="muted small"></div></div><span class="count-pill"></span>`;
    li.querySelector('.time-rec-title').textContent = r.title || '(untitled)';
    li.querySelector('.muted').textContent = [when, r.listName].filter(Boolean).join(' · ');
    li.querySelector('.count-pill').textContent = fmtDur(r.seconds);
    const t = getTask(r.taskId);
    li.querySelector('.dot').style.background = colorHex(t ? t.color : 'default');
    const open = document.createElement('button');
    open.className = 'icon-btn sm'; open.title = 'Open task';
    open.innerHTML = '<span class="material-icons-outlined">open_in_new</span>';
    open.onclick = (e) => { e.stopPropagation(); if (getTask(r.taskId)) openDetail(r.taskId); else toast('Task was deleted'); };
    const del = document.createElement('button');
    del.className = 'icon-btn sm'; del.title = 'Delete record';
    del.innerHTML = '<span class="material-icons-outlined">delete</span>';
    del.onclick = (e) => {
      e.stopPropagation();
      state.times = state.times.filter((x) => x.id !== r.id);
      save(); renderAll();
      toast('Record deleted', () => { state.times.unshift(r); save(); renderAll(); });
    };
    li.append(open, del);
    li.onclick = () => { if (getTask(r.taskId)) { ui.timeTaskId = r.taskId; renderAll(); } };
    return li;
  };
  const dayHead = (label, rows) => {
    const h = document.createElement('div'); h.className = 'rec-day-head';
    const s = document.createElement('span'); s.textContent = label;
    h.appendChild(s);
    if (rows && rows.length) {
      const cp = document.createElement('button');
      cp.className = 'btn-ghost'; cp.title = 'Copy day as text';
      cp.innerHTML = '<span class="material-icons-outlined">content_copy</span><span>Copy day</span>';
      cp.onclick = async (e) => {
        e.stopPropagation();
        const lines = rows.map((r) => `${fmtDurShort(r.seconds)} - ${r.title || '(untitled)'}`);
        toast(await copyText(lines.join('\n')) ? 'Day copied to clipboard' : 'Copy failed');
      };
      h.appendChild(cp);
    }
    ul.appendChild(h);
  };
  const todayRs = state.times.filter((r) => recDay(r) === todayIso());
  const prevRs = state.times.filter((r) => recDay(r) !== todayIso()).slice(0, 200);
  if (todayRs.length) { dayHead('Today', todayRs); todayRs.forEach((r) => ul.appendChild(timeRecRow(r))); }
  if (prevRs.length) { dayHead('Previously', null); prevRs.forEach((r) => ul.appendChild(timeRecRow(r))); }
  // middle: searchable tasks with totals
  const q = (ui.timeQuery || '').trim().toLowerCase();
  const tasks = state.tasks
    .filter((t) => !t.done || state.showCompleted)
    .filter(matchesFilters)
    .filter((t) => !q || (t.title + ' ' + t.notes).toLowerCase().includes(q))
    .sort((a, b) => {
      const bySort = sortFn()(a, b);
      if ((state.sort || ui.sort) && (state.sort || ui.sort) !== 'order' && bySort) return bySort;
      return taskTime(b.id) - taskTime(a.id) || b.createdAt - a.createdAt;
    })
    .slice(0, 80);
  const tu = $('#timeTaskList'); tu.innerHTML = '';
  if (!tasks.length) {
    const p = document.createElement('p'); p.className = 'mini-empty'; p.textContent = q ? 'No tasks match.' : 'No tasks yet.';
    tu.appendChild(p);
  }
  tasks.forEach((t) => {
    const li = document.createElement('li');
    li.className = 'time-pick' + (ui.timeTaskId === t.id ? ' selected' : '') + (t.done ? ' done-task' : '');
    li.innerHTML = `<span class="dot"></span><span class="n" dir="auto"></span><span class="listname-tag"></span><span class="count-pill muted"></span>`;
    li.querySelector('.dot').style.background = colorHex(t.color);
    li.querySelector('.n').textContent = t.title || '(untitled)';
    li.querySelector('.listname-tag').textContent = listName(t.listId);
    const tot = Math.floor(taskTime(t.id));
    li.querySelector('.count-pill').textContent = tot > 0 ? fmtDur(tot) : '';
    li.querySelector('.count-pill').classList.toggle('hidden', !tot);
    li.onclick = () => selectTimeTask(t.id);
    li.ondblclick = () => openDetail(t.id);
    tu.appendChild(li);
  });
  // right: tracker — whole task card, like other pages
  const sel = getTask(ui.timeTaskId);
  const tfc = $('#timeForTaskCard'); tfc.innerHTML = '';
  if (sel) tfc.appendChild(taskRow(sel, {}));
  else {
    const p = document.createElement('p');
    p.className = 'mini-empty time-empty';
    p.textContent = 'Pick a task from the list to start tracking.';
    tfc.appendChild(p);
  }
  $('#timeDisplay').textContent = fmtClock(state.timer ? timerElapsed() : 0);
  const running = !!(state.timer && state.timer.running);
  const paused = !!(state.timer && !state.timer.running);
  $('#timePlay').classList.toggle('active', running);
  $('#timePause').classList.toggle('active', paused);
  const sameTask = state.timer && state.timer.taskId === ui.timeTaskId;
  $('#timePlay').disabled = !sel || (running && sameTask) || (!!state.timer && !sameTask);
  $('#timePause').disabled = !running;
  $('#timeStop').disabled = !state.timer;
}

/* ---------- CRUD ---------- */
function nextOrder(listId, done) {
  const g = listTasks(listId).filter((t) => !!t.done === !!done);
  return g.length ? Math.max(...g.map((t) => t.order)) + 1 : 0;
}
function targetListForAdd() {
  if (activeList()) return activeList().id;
  return fallbackList() ? fallbackList().id : null;
}
function addTask(title, extra = {}, toTop = false) {
  const lid = targetListForAdd(); if (!lid) { toast('Create a list first'); return null; }
  return addTaskTo(lid, title, extra, toTop);
}
function paintQuickMeta() {
  const inp = $('#addInput'), qa = $('#quickAddMeta');
  if (inp && qa) qa.classList.toggle('hidden', !inp.value.trim());
}
function focusComposer() {
  if (isHome()) { const f = state.lists.find((l) => l.id === state.lastListId) || fallbackList(); if (f) go(f.id); }
  else if (isAll()) { const first = $('#board input'); if (first) first.focus(); }
  else if (isCal()) {
    if ((ui.calView || 'month') === 'year') { ui.calView = 'month'; renderAll(); }
    const ci = $('#calAddInput'); if (ci) { ci.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => ci.focus(), 250); } return;
  }
  else if (isTime()) {
    const f = state.lists.find((l) => l.id === state.lastListId) || fallbackList();
    if (f) go(f.id);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => $('#addInput') && $('#addInput').focus(), 250);
}
function addTaskTo(listId, title, extra = {}, toTop = false) {
  title = (title || '').trim(); if (!title) return null;
  state.lastListId = listId;
  const t = { id: uid(), listId, title: title.slice(0, 200), notes: '', date: '', time: '', extRef: '', color: 'default', weight: clampWeight(extra.weight) || 'medium', importance: clampImp(extra.importance) || 'medium', recur: null, done: false, completedAt: 0, order: nextOrder(listId, false), createdAt: Date.now(), subtasks: [], ...extra };
  t.weight = clampWeight(t.weight); t.importance = clampImp(t.importance);
  if (toTop) {
    const g = listTasks(listId).filter((x) => !x.done);
    t.order = g.length ? Math.min(...g.map((x) => x.order)) - 1 : 0;
  }
  state.tasks.push(t); save(); renderAll();
  return t;
}
function toggleDone(id) {
  const t = getTask(id); if (!t) return;
  const becomingDone = !t.done;
  t.done = becomingDone; t.completedAt = t.done ? Date.now() : 0;
  if (becomingDone) dropCalEvent(t); // completed tasks need no reminder event
  let spawned = null;
  if (!becomingDone && t.spawnedId) {
    const sp = getTask(t.spawnedId);
    if (sp && !sp.done) state.tasks = state.tasks.filter((x) => x.id !== t.spawnedId);
    t.spawnedId = '';
  }
  // Google-style repeat: completing an instance schedules the next future one
  if (becomingDone && t.recur && t.recur.freq && t.date) {
    if (t.spawnedId && getTask(t.spawnedId) && !getTask(t.spawnedId).done) {
      spawned = getTask(t.spawnedId);
    } else {
      const nd = nextFutureRecurDate(displayDate(t) || t.date, t.recur);
      if (nd && nd !== (displayDate(t) || t.date)) {
        if (!t.recId) t.recId = uid();
        spawned = {
          id: uid(), listId: t.listId, title: t.title, notes: t.notes, date: nd, time: t.time,
          extRef: t.extRef, color: t.color, weight: t.weight, importance: t.importance,
          recur: t.recur ? { freq: t.recur.freq, interval: t.recur.interval || 1, ...(Array.isArray(t.recur.days) ? { days: [...t.recur.days] } : {}) } : null,
          recId: t.recId || '', done: false, completedAt: 0, order: 1e9, createdAt: Date.now(),
          subtasks: t.subtasks.map((s) => ({ id: uid(), title: s.title, done: false })),
          tz: t.tz || '', dueUtc: 0,
        };
        if (typeof t.remindBefore === 'number') spawned.remindBefore = t.remindBefore;
        // keep the same local time-of-day pattern across the repeat: shift the
        // absolute instant by whole days instead of re-stamping in this zone
        if (hasClockTime(t) && typeof t.dueUtc === 'number' && t.dueUtc > 0) {
          const dayMs = (Date.parse(nd + 'T12:00:00Z') - Date.parse((displayDate(t) || t.date) + 'T12:00:00Z')) || 0;
          spawned.time = displayTime(t) || t.time;
          spawned.date = nd;
          spawned.dueUtc = t.dueUtc + dayMs;
          try { spawned.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || spawned.tz; } catch {}
        }
        t.spawnedId = spawned.id;
        state.tasks.push(spawned);
      }
    }
  }
  [true, false].forEach((d) => listTasks(t.listId).filter((x) => x.done === d).sort((a, b) => a.order - b.order).forEach((x, i) => x.order = i));
  save(); renderAll();
  if (spawned && becomingDone) { const f = fmtDate(displayDate(spawned) || spawned.date); toast(`Repeats — next: ${f ? f.label : (displayDate(spawned) || spawned.date)}`); }
  if (ui.detailId === id) renderDetail();
}
function deleteTask(id) {
  const i = state.tasks.findIndex((t) => t.id === id); if (i < 0) return;
  const [rm] = state.tasks.splice(i, 1);
  const savedTimer = state.timer && state.timer.taskId === id ? state.timer : null;
  if (savedTimer) state.timer = null;
  // clear the link before the undo snapshot: undo re-creates the event fresh
  if (rm.calEventId) { queueCalDelete(rm.calEventId); rm.calEventId = ''; rm.calRev = ''; }
  if (ui.detailId === id) closeDetail();
  save(); renderAll();
  toast('Task deleted', () => {
    state.tasks.push(rm);
    if (savedTimer) state.timer = savedTimer;
    save(); renderAll();
  });
}

/* ---------- detail panel ---------- */
function openDetail(id) {
  ui.detailId = id; renderDetail();
  $('#detail').classList.remove('hidden');
  if (window.innerWidth < 1024) $('#scrim').classList.remove('hidden');
  else if (isAll()) {
    const t = getTask(id);
    const col = t && document.querySelector(`.board-col[data-list-id="${t.listId}"]`);
    const board = $('#board');
    if (col && board) {
      setTimeout(() => {
        board.scrollTo({ left: Math.max(0, col.offsetLeft - 16), behavior: 'smooth' });
      }, 220);
    }
  }
  setTimeout(() => { const el = $('#dTitle'); if (el) el.focus({ preventScroll: true }); }, 220);
}
function closeDetail() { ui.detailId = null; $('#detail').classList.add('hidden'); $('#scrim').classList.add('hidden'); }
function renderDetail() {
  const t = getTask(ui.detailId); if (!t) return closeDetail();
  if (!Array.isArray(t.subtasks)) t.subtasks = [];
  // clear rebuilt regions first so a task never shows the previous task's rows
  $('#dList').innerHTML = ''; $('#dRecurDays').innerHTML = '';
  $('#dColors').innerHTML = ''; $('#dSubs').innerHTML = '';
  $('#dTitle').value = t.title;
  // show the due moment converted to this device's timezone; edits re-stamp
  // the absolute instant so other zones convert back correctly
  $('#dDate').value = displayDate(t) || ''; $('#dTime').value = displayTime(t) || '';
  try {
    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const shifted = !!(t.time && t.tz && localTz && t.tz !== localTz && typeof t.dueUtc === 'number' && t.dueUtc > 0);
    $('#dTime').title = shifted ? `Entered as ${t.time} in ${t.tz} — showing your local time` : '';
    $('#dDate').title = shifted ? `Entered in ${t.tz} — showing your local date` : '';
  } catch {}
  $('#dExt').value = t.extRef || '';
  $('#dListName').textContent = listName(t.listId);
  const dl = $('#dList'); dl.innerHTML = '';
  state.lists.forEach((l) => { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name; dl.appendChild(o); });
  dl.value = t.listId;
  const open = $('#dExtOpen');
  if (isUrl(t.extRef)) { open.href = t.extRef; open.classList.remove('hidden'); } else open.classList.add('hidden');
  $('#dNotes').value = t.notes || '';
  $('#dMeta').textContent = 'Created ' + new Date(t.createdAt).toLocaleDateString();
  $('#dDoneToggle').textContent = t.done ? 'Mark not complete' : 'Mark complete';
  paintReminderUI(t);

  // repeat controls
  const r = t.recur && t.recur.freq ? t.recur : null;
  const fq = $('#dRecurFreq');
  const isCustom = !!(r && r.interval > 1);
  fq.value = !r ? '' : (isCustom ? 'custom' : r.freq);
  $('#dRecurN').value = r ? Math.max(1, r.interval || 1) : 2;
  $('#dRecurUnit').value = r ? r.freq : 'daily';
  $('#dRecurCustom').classList.toggle('hidden', fq.value !== 'custom');
  const effWeekly = fq.value === 'weekly' || (fq.value === 'custom' && $('#dRecurUnit').value === 'weekly');
  const dc = $('#dRecurDays'); dc.innerHTML = '';
  dc.classList.toggle('hidden', !effWeekly);
  if (effWeekly) {
    const sel = new Set(r && r.freq === 'weekly' && Array.isArray(r.days) ? r.days : []);
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((ch, day) => {
      const b = document.createElement('button');
      b.textContent = ch; b.dataset.day = day; b.title = WEEKDAYS[day];
      b.setAttribute('aria-label', WEEKDAYS[day]);
      b.className = sel.has(day) ? 'selected' : '';
      b.onclick = () => { b.classList.toggle('selected'); commitRecurUI(); };
      dc.appendChild(b);
    });
  }
  const hint = $('#dRecurHint');
  if (!fq.value) hint.textContent = '';
  else if (!t.date) hint.textContent = 'Pick a due date — the repeat starts from it.';
  else {
    const nx = nextRecurDate(t.date, readRecurUI());
    hint.textContent = nx ? `Next after ${t.date}: ${nx}` : '';
  }
  fq.onchange = commitRecurUI;
  $('#dRecurN').onchange = commitRecurUI;
  $('#dRecurUnit').onchange = commitRecurUI;
  function readRecurUI() {
    const f = fq.value;
    if (!f) return null;
    const dayBtns = [...dc.querySelectorAll('button.selected')].map((b) => +b.dataset.day);
    if (f === 'custom') {
      const u = $('#dRecurUnit').value;
      const n = Math.max(1, Math.min(99, +$('#dRecurN').value || 1));
      return { freq: u, interval: n, ...(u === 'weekly' && dayBtns.length ? { days: dayBtns } : {}) };
    }
    return { freq: f, interval: 1, ...(f === 'weekly' && dayBtns.length ? { days: dayBtns } : {}) };
  }
  function commitRecurUI() {
    const task = getTask(ui.detailId); if (!task) return;
    task.recur = readRecurUI();
    if (task.recur && !task.date) {
      if (hasClockTime(task)) moveDueToDate(task, todayIso());
      else task.date = todayIso();
      $('#dDate').value = displayDate(task) || task.date;
    }
    save(); renderAll();
  }

  const pal = $('#dColors'); pal.innerHTML = '';
  allColors().forEach((c) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (t.color === c.id ? ' selected' : '');
    b.style.background = c.hex; b.title = colorName(c.id); b.setAttribute('aria-label', colorName(c.id));
    b.onclick = () => { t.color = c.id; save(); renderAll(); };
    pal.appendChild(b);
  });
  $$('#dWeight button').forEach((b) => {
    b.classList.toggle('selected', b.dataset.v === t.weight);
    b.setAttribute('aria-checked', String(b.dataset.v === t.weight));
    b.onclick = () => { t.weight = b.dataset.v; save(); renderAll(); };
  });
  $$('#dImportance button').forEach((b) => {
    b.classList.toggle('selected', b.dataset.v === t.importance);
    b.setAttribute('aria-checked', String(b.dataset.v === t.importance));
    b.onclick = () => { t.importance = b.dataset.v; save(); renderAll(); };
  });

  const ul = $('#dSubs'); ul.innerHTML = '';
  t.subtasks.forEach((s) => {
    const li = document.createElement('li'); if (s.done) li.classList.add('done');
    const c = document.createElement('button'); c.className = 'check'; c.setAttribute('aria-label', 'Toggle subtask');
    c.onclick = () => { s.done = !s.done; save(); renderAll(); };
    const inp = document.createElement('input'); inp.type = 'text'; inp.value = s.title; inp.maxLength = 150; inp.dir = 'auto';
    inp.onchange = () => { s.title = inp.value.trim() || s.title; save(); renderAll(); };
    const x = document.createElement('button'); x.className = 'icon-btn sm'; x.innerHTML = '<span class="material-icons-outlined">close</span>';
    x.setAttribute('aria-label', 'Delete subtask');
    x.onclick = () => { t.subtasks = t.subtasks.filter((k) => k.id !== s.id); save(); renderAll(); };
    li.append(c, inp, x); ul.appendChild(li);
  });
  const doneN = t.subtasks.filter((s) => s.done).length;
  const sc = $('#subCount');
  sc.textContent = t.subtasks.length ? `${doneN}/${t.subtasks.length}` : '';
  sc.classList.toggle('hidden', !t.subtasks.length);
}

/* ---------- popups ---------- */
function openColorPop(anchor, taskId, mini) {
  clearTimeout(pendingDetailTimer);
  closeMovePop(); closeWeightPop(); closeImportancePop();
  const pop = $('#colorPop'); pop.innerHTML = '';
  pop.classList.toggle('mini', !!mini);
  allColors().forEach((c) => {
    const b = document.createElement('button');
    b.className = 'swatch-wrap'; b.style.background = c.hex; b.title = colorName(c.id);
    b.setAttribute('aria-label', colorName(c.id));
    const lb = document.createElement('span');
    lb.className = 'swatch-label'; lb.textContent = colorName(c.id);
    lb.style.color = contrastText(c.hex);
    b.appendChild(lb);
    b.onclick = (e) => { e.stopPropagation(); const t = getTask(taskId); if (t) { t.color = c.id; save(); renderAll(); } closeColorPop(); };
    pop.appendChild(b);
  });
  pop.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  pop.style.top = Math.min(window.innerHeight - 90, r.bottom + 6) + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - 320, r.left - 240)) + 'px';
}
function closeColorPop() { $('#colorPop').classList.add('hidden'); }
function placePop(pop, anchor, maxW) {
  pop.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  pop.style.top = Math.min(window.innerHeight - 160, r.bottom + 6) + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - maxW, r.left - (maxW - 40))) + 'px';
}
function openWeightPop(anchor, taskId) {
  clearTimeout(pendingDetailTimer);
  closeColorPop(); closeMovePop(); closeImportancePop();
  const t = getTask(taskId); if (!t) return;
  const pop = $('#weightPop'); pop.innerHTML = '';
  Object.entries(WEIGHTS).forEach(([v, m]) => {
    const b = document.createElement('button');
    if (t.weight === v) b.className = 'selected';
    b.innerHTML = `<span class="material-icons-outlined">${m.icon}</span><span></span>`;
    b.querySelector('span:last-child').textContent = m.label;
    b.onclick = (e) => { e.stopPropagation(); t.weight = v; save(); renderAll(); closeWeightPop(); };
    pop.appendChild(b);
  });
  placePop(pop, anchor, 200);
}
function closeWeightPop() { $('#weightPop').classList.add('hidden'); }
function openImportancePop(anchor, taskId) {
  clearTimeout(pendingDetailTimer);
  closeColorPop(); closeMovePop(); closeWeightPop();
  const t = getTask(taskId); if (!t) return;
  const pop = $('#importancePop'); pop.innerHTML = '';
  Object.entries(IMPORTANCE).forEach(([v, m]) => {
    const b = document.createElement('button');
    if (t.importance === v) b.className = 'selected';
    b.innerHTML = `<span class="material-icons-outlined">${m.icon}</span><span></span>`;
    b.querySelector('span:last-child').textContent = m.label;
    b.onclick = (e) => { e.stopPropagation(); t.importance = v; save(); renderAll(); closeImportancePop(); };
    pop.appendChild(b);
  });
  placePop(pop, anchor, 200);
}
function closeImportancePop() { $('#importancePop').classList.add('hidden'); }
function openMovePop(anchor, taskId) {
  clearTimeout(pendingDetailTimer);
  closeColorPop(); closeWeightPop(); closeImportancePop();
  const t = getTask(taskId); if (!t) return;
  const pop = $('#movePop'); pop.innerHTML = '';
  const h = document.createElement('p'); h.className = 'sidebar-label'; h.textContent = 'Move to list'; pop.appendChild(h);
  state.lists.forEach((l) => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="material-icons-outlined">${l.id === t.listId ? 'check' : 'list'}</span><span></span>`;
    b.querySelector('span:last-child').textContent = l.name;
    b.onclick = (e) => { e.stopPropagation(); moveTask(taskId, l.id); closeMovePop(); };
    pop.appendChild(b);
  });
  pop.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  pop.style.top = Math.min(window.innerHeight - 40 - state.lists.length * 44, r.bottom + 6) + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - 240, r.left - 190)) + 'px';
}
function closeMovePop() { $('#movePop').classList.add('hidden'); }

/* ---------- sidebar drawer ---------- */
function openSidebar() {
  $('#sidebar').classList.add('open'); $('#scrim').classList.remove('hidden');
  const m = $('#menuBtn'); if (m) m.setAttribute('aria-expanded', 'true');
}
function closeSidebar() {
  if (window.innerWidth >= 1024) return;
  $('#sidebar').classList.remove('open');
  if (!ui.detailId) $('#scrim').classList.add('hidden');
  const m = $('#menuBtn'); if (m) m.setAttribute('aria-expanded', 'false');
}

/* ---------- resizable panels ---------- */
function applySizes() {
  const side = Math.min(420, Math.max(220, state.prefs.sideW || 280));
  const det = Math.min(640, Math.max(320, state.prefs.detailW || 440));
  document.documentElement.style.setProperty('--side-w', side + 'px');
  document.documentElement.style.setProperty('--detail-w', det + 'px');
}
function makeResizable(handle, onDrag) {
  if (!handle) return;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.classList.add('active');
    try { handle.setPointerCapture(e.pointerId); } catch {}
    const move = (ev) => onDrag(ev);
    const up = () => { handle.classList.remove('active'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); save(); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

/* ---------- export / import ---------- */
function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function exportJSON() {
  const payload = { app: 'DoTo', version: 2, exportedAt: new Date().toISOString(), lists: state.lists, tasks: state.tasks, times: state.times || [], customColors: state.customColors || [], colorNames: state.colorNames || {} };
  download(`doto-export-${todayIso()}.json`, JSON.stringify(payload, null, 2));
  toast(`Exported ${state.tasks.length} tasks`);
}
function parseGoogleDate(v) {
  if (!v) return { date: '', time: '' };
  // read the clock as-written (UTC in Takeout) so dates never shift timezones
  const m = String(v).match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return { date: '', time: '' };
  const hasTime = !!(m[4] && m[5] && !(m[4] === '00' && m[5] === '00' && (m[6] || '00') === '00'));
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: hasTime ? `${m[4]}:${m[5]}` : '' };
}
function googleTaskDue(g) {
  if (g.due) return parseGoogleDate(g.due); // legacy per-list Takeout files
  const st = Array.isArray(g.scheduled_time) ? (g.scheduled_time.find((s) => s.current) || g.scheduled_time[0]) : null;
  if (st && st.start) return parseGoogleDate(st.start);
  return { date: '', time: '' };
}
// Real Google Takeout shape (google-tasks.json):
// {kind:"tasks#taskLists", items:[ {kind:"tasks#tasks", title, create_time, items:[tasks]} ]}
// task: {id, title, notes, status:"needsAction"|"completed", scheduled_time:[{current,start}],
//        starred, completed, created, updated, parent?, links?}
function googleItemsToList(items, name, listCreatedAt, schedules) {
  const list = { id: uid(), name: (name || 'Imported').slice(0, 60) || 'Imported', createdAt: listCreatedAt || Date.now() };
  // list-level recurrence schedules → per-task repeat rules
  const recMap = new Map();
  (schedules || []).forEach((r) => {
    if (!r || !r.id || !r.schedule || !r.schedule.interval) return;
    const iv = r.schedule.interval;
    const freq = iv.daily ? 'daily' : iv.weekly ? 'weekly' : iv.monthly ? 'monthly' : iv.yearly ? 'yearly' : '';
    if (!freq) return;
    const rec = { freq, interval: Math.max(1, Math.min(99, iv.interval_multiplier || 1)) };
    if (freq === 'weekly' && iv.weekly && typeof iv.weekly === 'object') {
      const raw = iv.weekly.week_days || iv.weekly.days || iv.weekly.days_of_week || iv.weekly.weekDays || [];
      const names = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
      const days = (Array.isArray(raw) ? raw : []).map((x) => {
        if (typeof x === 'number' && x >= 0 && x <= 6) return x;
        const k = String(x).toLowerCase().replace(/[^a-z]/g, '');
        return k in names ? names[k] : -1;
      }).filter((n) => n >= 0);
      if (days.length) rec.days = [...new Set(days)];
    }
    recMap.set(r.id, rec);
  });
  let usable = (items || []).filter((x) => x && !x.deleted);
  // Google exports one item PER INSTANCE of a recurring task (e.g. a daily
  // task appears dozens of times). Keep a single task per recurrence: the
  // current instance, else the nearest upcoming one, else the latest.
  const recGroups = new Map();
  usable.forEach((x) => { if (x.task_recurrence_id) { if (!recGroups.has(x.task_recurrence_id)) recGroups.set(x.task_recurrence_id, []); recGroups.get(x.task_recurrence_id).push(x); } });
  if (recGroups.size) {
    const today = todayIso();
    const dropIds = new Set();
    recGroups.forEach((arr) => {
      if (arr.length < 2) return;
      const dated = arr.map((x) => ({ x, d: googleTaskDue(x).date || '9999' }));
      const current = arr.find((x) => Array.isArray(x.scheduled_time) && x.scheduled_time.some((s) => s.current));
      const keep = current
        || (dated.filter((e) => e.d >= today).sort((a, b) => a.d.localeCompare(b.d))[0] || {}).x
        || dated.sort((a, b) => a.d.localeCompare(b.d))[dated.length - 1].x;
      arr.forEach((x) => { if (x !== keep) dropIds.add(x.id); });
    });
    if (dropIds.size) usable = usable.filter((x) => !dropIds.has(x.id));
  }
  const byId = new Map(usable.map((x) => [x.id, x]));
  const rootOf = (x) => { let cur = x, guard = 0; while (cur && cur.parent && byId.has(cur.parent) && guard++ < 20) cur = byId.get(cur.parent); return cur; };
  const pos = (x) => String(x.position || '');
  const toTask = (g, i) => {
    const due = googleTaskDue(g);
    const done = g.status === 'completed';
    const link = Array.isArray(g.links) && g.links[0] ? (g.links[0].link || g.links[0].description || '') : '';
    const starred = g.starred === true || g.isStarred === true;
    return {
      id: uid(), listId: list.id, title: String(g.title || '').trim().slice(0, 200) || '(untitled)',
      notes: String(g.notes || g.description || '').slice(0, 4000), date: due.date, time: due.time,
      extRef: String(link || '').slice(0, 500), color: 'default', weight: 'medium',
      importance: starred ? 'high' : 'medium', done, recId: g.task_recurrence_id || '',
      recur: recMap.get(g.task_recurrence_id) || null,
      completedAt: done ? Date.parse(g.completed || g.updated || g.created || Date.now()) || Date.now() : 0,
      order: i, createdAt: Date.parse(g.created || g.updated || Date.now()) || Date.now(), subtasks: [],
    };
  };
  const tops = usable.filter((x) => !x.parent || !byId.has(x.parent)).sort((a, b) => pos(a).localeCompare(pos(b)));
  const kids = usable.filter((x) => x.parent && byId.has(x.parent)).sort((a, b) => pos(a).localeCompare(pos(b)));
  const tasks = tops.map(toTask);
  const hostById = new Map(); tops.forEach((g, i) => hostById.set(g.id, tasks[i]));
  kids.forEach((k) => {
    const root = rootOf(k);
    const host = root && hostById.get(root.id);
    const sub = { id: uid(), title: String(k.title || '').trim().slice(0, 150) || '(untitled)', done: k.status === 'completed' };
    if (host) host.subtasks.push(sub);
    else { const t = toTask(k, tasks.length); hostById.set(k.id, t); tasks.push(t); } // orphan → top level
  });
  return { list, tasks };
}
function importCustomColors(arr) {
  if (!Array.isArray(arr)) return 0;
  if (!Array.isArray(state.customColors)) state.customColors = [];
  const ids = new Set([...BUILTIN_COLOR_IDS, ...state.customColors.map((c) => c.id)]);
  let n = 0;
  arr.forEach((c) => {
    if (!validCustomColor(c) || ids.has(c.id)) return;
    ids.add(c.id);
    if (state.customColors.length >= 10) return;
    state.customColors.push({ id: c.id, name: c.name.trim().slice(0, 24), hex: c.hex.toLowerCase() });
    n++;
  });
  return n;
}
function importTimes(arr, taskIdMap) {
  if (!Array.isArray(arr)) return 0;
  let n = 0;
  arr.forEach((r) => {
    if (!r || typeof r.seconds !== 'number') return;
    state.times.push({
      id: uid(), taskId: (taskIdMap && taskIdMap.get(r.taskId)) || r.taskId || '',
      title: String(r.title || '(untitled)').slice(0, 200), listName: String(r.listName || ''),
      startedAt: r.startedAt || Date.now(), seconds: Math.max(0, Math.round(r.seconds)),
    });
    n++;
  });
  return n;
}
function detectAndImport(parsed, fileName, mode = 'auto') {
  // 1. DoTo native export
  if ((mode === 'auto' || mode === 'doto') && parsed && Array.isArray(parsed.lists) && Array.isArray(parsed.tasks)) {
    const idMap = new Map();
    parsed.lists.forEach((l) => { const nid = uid(); idMap.set(l.id, nid); state.lists.push({ id: nid, name: String(l.name || 'Imported').slice(0, 60), createdAt: l.createdAt || Date.now() }); });
    const taskIdMap = new Map();
    parsed.tasks.forEach((t, i) => {
      const nid = uid(); taskIdMap.set(t.id, nid);
      state.tasks.push({
        id: nid, listId: idMap.get(t.listId) || fallbackList()?.id || state.lists[0].id,
        title: String(t.title || '(untitled)').slice(0, 200), notes: String(t.notes || ''), date: t.date || '', time: t.time || '',
        tz: typeof t.tz === 'string' ? t.tz.slice(0, 64) : '',
        dueUtc: typeof t.dueUtc === 'number' && t.dueUtc > 0 ? t.dueUtc : 0,
        extRef: String(t.extRef || ''), color: t.color || 'default', weight: clampWeight(t.weight), importance: clampImp(t.importance),
        recur: (t.recur && ['daily', 'weekly', 'monthly', 'yearly'].includes(t.recur.freq)) ? { freq: t.recur.freq, interval: Math.max(1, Math.min(99, t.recur.interval || 1)), ...(Array.isArray(t.recur.days) ? { days: t.recur.days.filter((x) => x >= 0 && x <= 6) } : {}) } : null,
        recId: typeof t.recId === 'string' ? t.recId : '',
        remindBefore: (typeof t.remindBefore === 'number' && REMIND_OFFSETS.includes(t.remindBefore)) ? t.remindBefore : '',
        done: !!t.done, completedAt: t.completedAt || 0, order: typeof t.order === 'number' ? t.order : i,
        createdAt: t.createdAt || Date.now(), subtasks: Array.isArray(t.subtasks) ? t.subtasks.map((s) => ({ id: uid(), title: String(s.title || '').slice(0, 150), done: !!s.done })) : [],
      });
    });
    const addedColors = importCustomColors(parsed.customColors);
    if (parsed.colorNames && typeof parsed.colorNames === 'object') {
      const okIds = new Set(allColors().map((c) => c.id));
      if (!state.colorNames) state.colorNames = {};
      Object.entries(parsed.colorNames).forEach(([k, v]) => {
        if (okIds.has(k) && typeof v === 'string' && v.trim() && !state.colorNames[k]) state.colorNames[k] = v.trim().slice(0, 24);
      });
    }
    return { lists: parsed.lists.length, tasks: parsed.tasks.length, times: importTimes(parsed.times, taskIdMap), colors: addedColors };
  }
  if (mode === 'doto') throw new Error('Not a DoTo backup — switch the source to Google Tasks or Auto-detect');
  const base = (fileName || 'Imported').replace(/\.json$/i, '').split('/').pop() || 'Imported';
  const niceBase = base === 'Tasks' ? 'General' : base;
  // 2. Full Takeout backup: one file holding many lists
  if (parsed && parsed.kind === 'tasks#taskLists' && Array.isArray(parsed.items)) {
    let T = 0;
    parsed.items.filter((L) => L && (Array.isArray(L.items) || L.title)).forEach((L) => {
      const { list, tasks } = googleItemsToList(L.items || [], L.title || niceBase, Date.parse(L.create_time || L.updated || Date.now()) || Date.now(), L.recurrences);
      state.lists.push(list); state.tasks.push(...tasks); T += tasks.length;
    });
    return { lists: parsed.items.length, tasks: T };
  }
  // 3. Single Google list object (per-list Takeout file or API shape)
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.items)) {
    // nested lists (each entry has its own items array)?
    if (parsed.items.length && parsed.items[0] && Array.isArray(parsed.items[0].items)) {
      let T = 0;
      parsed.items.forEach((L) => {
        const { list, tasks } = googleItemsToList(L.items || [], L.title || niceBase, Date.parse(L.create_time || L.updated || Date.now()) || Date.now(), L.recurrences);
        state.lists.push(list); state.tasks.push(...tasks); T += tasks.length;
      });
      return { lists: parsed.items.length, tasks: T };
    }
    const { list, tasks } = googleItemsToList(parsed.items, parsed.title || niceBase, Date.parse(parsed.create_time || parsed.updated || Date.now()) || Date.now(), parsed.recurrences);
    state.lists.push(list); state.tasks.push(...tasks);
    return { lists: 1, tasks: tasks.length };
  }
  // 4. Bare array of task objects
  if (Array.isArray(parsed)) {
    const { list, tasks } = googleItemsToList(parsed, niceBase);
    state.lists.push(list); state.tasks.push(...tasks);
    return { lists: 1, tasks: tasks.length };
  }
  throw new Error(mode === 'google'
    ? 'Not a Google Tasks file — switch the source to DoTo backup or Auto-detect'
    : 'Unrecognized JSON — expected DoTo export or Google Takeout Tasks file');
}
async function importFiles(files, mode = 'auto') {
  let L = 0, T = 0, TM = 0, CM = 0; const errors = [];
  for (const f of files) {
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      const r = detectAndImport(parsed, f.name, mode);
      L += r.lists; T += r.tasks; TM += r.times || 0; CM += r.colors || 0;
    } catch (err) { errors.push(`${f.name}: ${err.message}`); }
  }
  if (!fallbackList()) state.lists.push({ id: uid(), name: 'General', createdAt: Date.now() });
  if (state.activeView !== HOME && state.activeView !== ALL && state.activeView !== CAL && state.activeView !== TIME && !state.lists.some((l) => l.id === state.activeView)) state.activeView = HOME;
  save(); renderAll();
  if (T || L) toast(`Imported ${T} tasks into ${L} list${L === 1 ? '' : 's'}` + (TM ? ` + ${TM} time records` : '') + (CM ? ` + ${CM} labels` : ''));
  if (errors.length) toast('Import issue: ' + errors[0]);
}

/* ---------- events ---------- */
const SCROLL_SEL = '.board-col-body,#board,.cal-side,#timeTaskList,.sidebar,.detail-body,#paletteList,.board-col';
function scrollKey(el) {
  if (el.id) return '#' + el.id;
  const col = el.closest ? el.closest('[data-list-id]') : null;
  return String(el.className || '').split(' ')[0] + (col ? '|' + col.dataset.listId : '');
}
function snapScroll() {
  const m = new Map();
  document.querySelectorAll(SCROLL_SEL).forEach((el) => {
    if (el.scrollTop || el.scrollLeft) m.set(scrollKey(el), [el.scrollLeft, el.scrollTop]);
  });
  if (window.scrollX || window.scrollY) m.set('__win', [window.scrollX, window.scrollY]);
  return m;
}
function restoreScroll(m) {
  if (!m || !m.size) return;
  document.querySelectorAll(SCROLL_SEL).forEach((el) => {
    const v = m.get(scrollKey(el));
    if (v) {
      if (v[0]) { try { el.scrollLeft = v[0]; } catch {} }
      if (v[1]) { try { el.scrollTop = v[1]; } catch {} }
    }
  });
  const w = m.get('__win');
  if (w) { try { window.scrollTo(w[0], w[1]); } catch {} }
}
function renderAll() {
  const sc = snapScroll();
  applySizes(); renderNav(); renderCurrentView(); if (ui.detailId) renderDetail();
  if (ui.selectedId && !getTask(ui.selectedId)) ui.selectedId = null;
  paintSelection(false);
  restoreScroll(sc);
}

/* ---------- Google Drive sync (Sync & Settings, no backend) ----------
   Local-first: this device always works offline. When signed in, changes
   push to Drive's hidden app folder (debounced) and pull on launch,
   focus and reconnect. Merge is per-item, three-way against the last
   synced snapshot; both-sides-edited items resolve newest-wins. */
const GOOGLE_CLIENT_ID = '1053076438888-73jt7847277sev0oq6eaesn4g63v91do.apps.googleusercontent.com'; // app-owned; per-browser override in the Account dialog
const DRIVE_FILE = 'doto-state.json';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.app.created'; // one sign-in covers Drive sync + Calendar reminders (events need calendar.events; finding the target calendar via calendarList.list needs calendar.calendarlist.readonly — events alone answers 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT; creating the dedicated "DoTo" calendar via calendars.insert needs calendar.app.created — without it everything falls back to the primary calendar)
const CAL_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.app.created'];
const CAL_SCOPE = CAL_SCOPES[0]; // legacy alias: calendar.events (kept for scope-string cleanup)
function tokenScopeHasCal(scope) { return typeof scope === 'string' && CAL_SCOPES.every((s) => scope.indexOf(s) >= 0); }
const SYNC_KEY = 'doto-sync';
const CLIENT_KEY = 'doto-google-client-id';

function googleClientId() {
  try { return localStorage.getItem(CLIENT_KEY) || GOOGLE_CLIENT_ID; } catch { return GOOGLE_CLIENT_ID; }
}
function loadSyncMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(SYNC_KEY));
    if (m && typeof m === 'object') {
      const out = { fileId: '', base: null, lastSyncedAt: 0, auto: true, email: '', token: null, calGranted: false, ...m };
      // Old installs predate explicit calendar-grant tracking: their stored
      // token claims the calendar scope even when Google never granted it
      // (GIS does not reliably return granted scopes). Force one verified
      // re-consent instead of trusting the stored string forever.
      if (typeof m.calGranted !== 'boolean') out.calGranted = false;
      // Tokens issued before calendar.calendarlist.readonly / calendar.app.created
      // were requested (events-only, or events+list) still 403 on calendarList.list
      // or fall back to the primary calendar even when calGranted is true.
      // Force one re-consent so the new scopes are actually granted.
      if (out.calGranted === true && out.token && !tokenScopeHasCal(out.token.scope)) out.calGranted = false;
      return out;
    }
  } catch {}
  return { fileId: '', base: null, lastSyncedAt: 0, auto: true, email: '', token: null, calGranted: false };
}
let syncMeta = loadSyncMeta();
let syncStatus = 'signedout'; // setup|signedout|checking|syncing|ok|error
let lastSyncError = '';
let silentFailCount = 0;
function saveSyncMeta() { try { localStorage.setItem(SYNC_KEY, JSON.stringify(syncMeta)); } catch {} }
function setSync(s) { syncStatus = s; if (s === 'ok') { lastSyncError = ''; silentFailCount = 0; } paintSync(); }
function friendlySyncError(e) {
  const m = (e && e.message) || '';
  if (m === 'forbidden') return 'Drive refused access (403). Enable the Drive API for your Cloud project and grant access when asked.' + (e.detail ? ' Google says: ' + e.detail : '');
  if (m === 'net') return 'Could not reach Google — check connection or ad-blocker.';
  if (m.indexOf('drive') === 0) return 'Drive request failed (' + m + ').';
  return 'Sync failed — retry.';
}
function handleSyncFailure(e, mode, prev, logIt) {
  const m = (e && e.message) || '';
  if (m === 'auth' || m === 'setup') {
    if (logIt) {
      const msg = 'Google session ended — sign in again';
      const last = syncLog[syncLog.length - 1];
      if (!last || last.msg !== msg) slog('info', msg);
    }
    setSync('signedout');
    return;
  }
  if (mode === 'silent') {
    slog('error', friendlySyncError(e));
    silentFailCount = (silentFailCount || 0) + 1;
    if (silentFailCount >= 3) { lastSyncError = friendlySyncError(e); setSync('error'); }
    else { syncStatus = prev; paintSync(); }
    return;
  } // background stays quiet after one log; 3 fails surface on the pill
  lastSyncError = friendlySyncError(e);
  slog('error', lastSyncError);
  setSync('error');
  try { toast(lastSyncError); } catch {}
}

/* ----- sync history log (persisted ring buffer) ----- */
const SYNC_LOG_KEY = 'doto-sync-log';
let syncLog = (() => {
  try {
    const a = JSON.parse(localStorage.getItem(SYNC_LOG_KEY));
    return Array.isArray(a) ? a.filter((e) => e && e.t && e.msg).slice(-50) : [];
  } catch { return []; }
})();
function saveSyncLog() { try { localStorage.setItem(SYNC_LOG_KEY, JSON.stringify(syncLog.slice(-50))); } catch {} }
function slog(kind, msg) {
  syncLog.push({ t: Date.now(), kind, msg: String(msg).slice(0, 200) });
  syncLog = syncLog.slice(-50);
  saveSyncLog();
  if (isLogOpen()) paintLog();
}
function isLogOpen() { const s = $('#logScrim'); return !!s && !s.classList.contains('hidden'); }
function isConflictOpen() { const s = $('#conflictScrim'); return !!s && !s.classList.contains('hidden'); }
function diagLines() {
  const t = syncMeta.token;
  let texp = 'none';
  if (t && t.expires_at) {
    const m = Math.round((t.expires_at - Date.now()) / 60000);
    texp = m >= 0 ? `expires in ${m} min` : `expired ${-m} min ago`;
  }
  return [
    'status: ' + syncStatus,
    'email: ' + (syncMeta.email || 'none'),
    'token: ' + (t && t.access_token ? 'present' : 'none') + ' (' + texp + ')',
    'calGrant: ' + (syncMeta.calGranted === true ? 'verified' : syncMeta.calGranted === false ? 'missing — Sync now re-asks' : 'unknown'),
    'calError: ' + (lastCalError || 'none'),
    'fileId: ' + (syncMeta.fileId ? 'set' : 'none'),
    'base: ' + (syncMeta.base ? 'set' : 'none'),
    'lastSynced: ' + (syncMeta.lastSyncedAt ? new Date(syncMeta.lastSyncedAt).toLocaleString() : 'never'),
    'auto: ' + (!!syncMeta.auto) + ' | online: ' + navigator.onLine,
    'app: ' + APP_VERSION,
  ].join('\n');
}
function paintLog() {
  const dt = $('#diagText');
  if (dt) dt.textContent = diagLines();
  const ul = $('#syncLogList');
  if (!ul) return;
  ul.innerHTML = '';
  if (!syncLog.length) { ul.innerHTML = '<li class="palette-empty">No sync events yet.</li>'; return; }
  [...syncLog].reverse().forEach((e) => {
    const li = document.createElement('li');
    li.className = 'log-row ' + (e.kind === 'ok' || e.kind === 'info' ? '' : e.kind);
    const t = document.createElement('span');
    t.className = 'log-t'; t.textContent = new Date(e.t).toLocaleString();
    const m = document.createElement('span');
    m.textContent = e.msg;
    li.append(t, m);
    ul.appendChild(li);
  });
}
function openLog() { paintLog(); $('#logScrim').classList.remove('hidden'); }
function closeLog() { $('#logScrim').classList.add('hidden'); }

function fmtAgo(ts) {
  const d = Date.now() - ts;
  if (d < 10000) return 'just now';
  if (d < 60000) return Math.floor(d / 1000) + 's ago';
  if (d < 3600e3) return Math.floor(d / 60000) + 'm ago';
  if (d < 864e5) return Math.floor(d / 3600e3) + 'h ago';
  return new Date(ts).toLocaleDateString();
}
function syncLabel() {
  if (!googleClientId()) return ['Setup needed', 'warn'];
  if (!navigator.onLine) return ['Offline', 'warn'];
  if (syncStatus === 'syncing' || syncStatus === 'checking') return [syncStatus === 'checking' ? 'Checking…' : 'Syncing…', 'busy'];
  if (syncStatus === 'error') return ['Sync failed — retry', 'err'];
  if (syncStatus === 'ok') return [syncMeta.lastSyncedAt ? 'Synced ' + fmtAgo(syncMeta.lastSyncedAt) : 'Synced', 'ok'];
  return [syncMeta.lastSyncedAt ? 'Sign in to sync' : 'Not synced yet', syncMeta.lastSyncedAt ? 'warn' : ''];
}
function paintSync() {
  const pair = syncLabel(), label = pair[0], cls = pair[1];
  const pill = $('#syncPill'), txt = $('#syncPillText');
  if (pill) pill.className = 'sync-pill' + (cls ? ' ' + cls : '');
  if (txt) txt.textContent = label;
  const st = $('#accountState');
  if (st) st.textContent = syncMeta.email ? (syncStatus === 'ok' && syncMeta.lastSyncedAt ? fmtAgo(syncMeta.lastSyncedAt) : label) : '';
  const em = $('#accountEmail');
  if (em) em.textContent = syncMeta.email ? 'Signed in as ' + syncMeta.email : 'Not signed in.';
  const last = $('#accountLast');
  if (last) last.textContent = syncMeta.lastSyncedAt ? 'Last synced: ' + new Date(syncMeta.lastSyncedAt).toLocaleString() : '';
  const ae = $('#accountError');
  if (ae) {
    const calMsg = syncMeta.email ? lastCalError : '';
    const show = (syncStatus === 'error' && !!lastSyncError) || !!calMsg;
    ae.classList.toggle('hidden', !show);
    if (show) ae.textContent = calMsg && (!lastSyncError || syncStatus !== 'error') ? calMsg : (lastSyncError + (calMsg && lastSyncError !== calMsg ? ' ' + calMsg : ''));
  }
  const si = $('#signInBtn'), so = $('#signOutBtn');
  if (si) si.classList.toggle('hidden', !!syncMeta.email);
  if (so) so.classList.toggle('hidden', !syncMeta.email);
  const at = $('#autoSyncToggle');
  if (at && document.activeElement !== at) at.checked = !!syncMeta.auto;
}

/* ----- Google auth (GIS token flow, client-side only) ----- */
let gisReady = null, tokenClient = null, tokenClientId = '', tokenClientScope = '';
let gisLoadError = '';
function gisLoad() {
  if (gisReady) return gisReady;
  gisReady = new Promise((res, rej) => {
    if (window.google && google.accounts && google.accounts.oauth2) return res();
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client';
    sc.async = true; sc.defer = true;
    sc.onload = () => res();
    sc.onerror = () => { gisLoadError = 'net'; rej(new Error('net')); };
    document.head.appendChild(sc);
  });
  gisReady.catch(() => {});
  return gisReady;
}
// Preload GIS immediately so the first user tap doesn't pay the network cost
// and — crucially — so `requestAccessToken` can stay inside the click's
// user-activation window (any `await` before it breaks popups in iOS Safari).
try { gisLoad(); } catch {}
function isIOSStandalone() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  return !!(ios && standalone);
}
function tokenValid() {
  const t = syncMeta.token;
  return !!(t && t.access_token && t.expires_at - Date.now() > 60000);
}
function gisAttempt(tc, prompt, ms) {
  return new Promise((resolve) => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; resolve({ error: 'timeout' }); } }, ms);
    tc.callback = (r) => { if (!done) { done = true; clearTimeout(to); resolve(r || { error: 'unknown' }); } };
    try { tc.requestAccessToken({ prompt }); }
    catch { if (!done) { done = true; clearTimeout(to); resolve({ error: 'popup_failed' }); } }
  });
}
/* Only one GIS token request may be in flight at a time. requestAccessToken
   delivers its result to tc.callback on the shared tokenClient, so a second
   overlapping call overwrites the first caller's callback — the orphaned
   caller then hangs until timeout even after a successful login. That is what
   struck expired sessions: the Sync-now popup raced background silent
   renewals (auto-push, token refresh, calendar sync). Chain acquisitions
   instead; later callers reuse whatever the first one obtained. */
let tokenChain = Promise.resolve();
function ensureToken(mode, needCal) {
  const prev = tokenChain;
  let release;
  const mine = new Promise((res) => { release = res; });
  tokenChain = mine; // claimed synchronously — no gap for a racer to slip through
  const work = (async () => {
    try { await prev; } catch {}
    return doEnsureToken(mode, needCal);
  })();
  return work.then(
    (v) => { release(); return v; },
    (e) => { release(); throw e; }
  );
}
async function doEnsureToken(mode, needCal) {
  // Drive callers reuse any valid token; only calendar callers force a
  // re-consent popup when the calendar grant is unverified. (Forcing it for
  // Drive too caused double popups and still never retried the calendar.)
  if (tokenValid() && (mode !== 'popup' || !needCal || tokenHasCal())) return syncMeta.token.access_token;
  if (mode === 'popup' && isIOSStandalone() && /iPhone|iPad|iPod/.test(navigator.userAgent || '')) {
    // Best-effort hint: iOS home-screen (standalone) WebViews often block the
    // OAuth popup outright — the tap looks dead. We still try, but log a hint
    // so the user's History explains what happened.
    try { slog('info', 'iOS home-screen app detected — if sign-in does nothing, open DoTo in Safari instead'); } catch {}
  }
  // For popup, avoid any `await` before `requestAccessToken` if GIS is already
  // ready — iOS Safari invalidates user activation after an async gap, so the
  // popup gets blocked and the tap looks dead until the 3-minute timeout.
  const gisAlreadyReady = !!(window.google && window.google.accounts && window.google.accounts.oauth2);
  if (!gisAlreadyReady) {
    // GIS is still loading (cold start or flaky network). Don't hang the UI
    // for 3 minutes behind a blocked popup — fail fast so the button can
    // explain and the user can retry once GIS is ready.
    try { await gisLoad(); } catch (e) {
      if (mode === 'popup') { gisLoadError = 'net'; throw new Error('net'); }
      throw e;
    }
    if (!(window.google && window.google.accounts && window.google.accounts.oauth2)) {
      if (mode === 'popup') throw new Error('net');
      throw new Error('net');
    }
    // We had to await before the popup, so the activation is already lost on
    // iOS. Surface a clear message instead of a silent 3-minute hang.
    if (mode === 'popup' && !gisAlreadyReady) {
      try { slog('info', 'Google sign-in was still loading — tap again'); } catch {}
    }
  }
  const cid = googleClientId();
  if (!cid) throw new Error('setup');
  if (!tokenClient || tokenClientId !== cid || tokenClientScope !== DRIVE_SCOPE) {
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: cid, scope: DRIVE_SCOPE, callback: () => {} });
    tokenClientId = cid; tokenClientScope = DRIVE_SCOPE;
  }
  // Explicit sign-in: prompt '' — Google decides: an invisible token when the
  // session is alive (no popup at all, nothing to block), the consent window
  // only when scopes actually need granting. Forcing 'consent' here made every
  // post-expiry sign-in show the full scope screen again ("keeps asking").
  // Background: 'none' never shows UI.
  const tok = mode === 'popup' ? await gisAttempt(tokenClient, '', 60000) : await gisAttempt(tokenClient, 'none', 10000);
  if (!tok || !tok.access_token) {
    const code = (tok && (tok.error || tok.error_subtype)) || 'no_token';
    const desc = tok && tok.error_description ? ' — ' + tok.error_description : '';
    if (mode !== 'silent') slog('error', 'Google sign-in failed: ' + code + desc);
    const err = new Error('auth');
    err.gis = String(code);
    throw err;
  }
  syncMeta.token = { access_token: tok.access_token, expires_at: Date.now() + (tok.expires_in || 3600) * 1000, scope: tok.scope || DRIVE_SCOPE };
  // GIS rarely echoes granted scopes: optimistically trust a fresh popup,
  // then verify on the first real Calendar call (failure clears it again).
  if (mode === 'popup') {
    syncMeta.calGranted = tok.scope ? tokenScopeHasCal(tok.scope) : true;
  }
  saveSyncMeta();
  fetchEmail().catch(() => {});
  return syncMeta.token.access_token;
}
/* Calendar grant is tracked explicitly (verified by a real API call), not by
   trusting the stored scope string — old Drive-only tokens claim it falsely. */
function tokenHasCal() {
  if (syncMeta.calGranted === true) return true;
  if (syncMeta.calGranted === false) return false;
  const t = syncMeta.token;
  return !!(t && t.access_token && tokenScopeHasCal(t.scope));
}
async function fetchEmail() {
  if (!syncMeta.token) return;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + syncMeta.token.access_token } });
  if (!r.ok) throw new Error('email');
  const j = await r.json();
  if (j.email && j.email !== syncMeta.email) { syncMeta.email = j.email; saveSyncMeta(); paintSync(); }
}

/* ----- Drive appDataFolder API ----- */
async function driveFetch(url, opts = {}, mode = 'silent') {
  const doFetch = (at) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + at } });
  let r = await doFetch(await ensureToken(mode));
  // Only 401 means the token died (expired/revoked): drop it and retry ONCE
  // with a fresh token so one tap on Sync now recovers instead of needing two.
  // 403 (API disabled, scope denied, …) must NOT wipe the token — otherwise
  // every retry re-opens the sign-in popup.
  if (r.status === 401) {
    syncMeta.token = null; saveSyncMeta();
    try { r = await doFetch(await ensureToken(mode)); }
    catch { throw new Error('auth'); }
    if (r.status === 401) { syncMeta.token = null; saveSyncMeta(); throw new Error('auth'); }
  }
  return r;
}
async function driveOk(r) {
  if (r.ok) return r;
  let detail = '';
  try { detail = (await r.clone().text()).slice(0, 200); } catch {}
  const err = new Error(r.status === 403 ? 'forbidden' : 'drive' + r.status);
  err.detail = detail; err.status = r.status;
  throw err;
}
async function driveFind(mode) {
  const q = encodeURIComponent(`'appDataFolder' in parents and name = '${DRIVE_FILE}' and trashed = false`);
  const r = await driveOk(await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=appDataFolder&orderBy=modifiedTime desc&fields=files(id,modifiedTime)`, {}, mode));
  const j = await r.json();
  const files = (j.files || []).filter((f) => f && f.id);
  return files[0] || null;
}
async function driveDownload(id, mode) {
  const r = await driveOk(await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {}, mode));
  return r.json();
}
function stateForDrive(s) {
  const copy = JSON.parse(JSON.stringify(s));
  copy.timer = null; // running timer is device-local
  return copy;
}
async function driveUpload(data, mode) {
  const body = JSON.stringify(stateForDrive(data));
  if (syncMeta.fileId) {
    const r = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${syncMeta.fileId}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    }, mode);
    if (r.status === 404) {
      syncMeta.fileId = '';
      saveSyncMeta();
      return driveUpload(data, mode);
    }
    await driveOk(r);
    return r.json();
  }
  const meta = { name: DRIVE_FILE, parents: ['appDataFolder'] };
  const boundary = 'doto' + Date.now();
  const multipart = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await driveOk(await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
  }, mode));
  const j = await r.json();
  syncMeta.fileId = j.id;
  return j;
}

/* ----- three-way merge (base = last synced snapshot) ----- */
function snapState(s) {
  return JSON.parse(JSON.stringify({
    lists: s.lists || [], tasks: s.tasks || [], times: s.times || [],
    colorNames: s.colorNames || {},
    customColors: s.customColors || [], userName: s.userName || '',
    deletedColors: s.deletedColors || [],
  }));
}
function mergeIdSet(baseArr, localArr, remoteArr) {
  const B = new Set(baseArr || []), L = new Set(localArr || []), R = new Set(remoteArr || []);
  const out = [];
  new Set([...B, ...L, ...R]).forEach((id) => {
    const b = B.has(id), l = L.has(id), r = R.has(id);
    if (l === r) { if (l) out.push(id); return; }
    if (l !== b && r === b) { if (l) out.push(id); return; }
    if (r !== b && l === b) { if (r) out.push(id); return; }
    if (l || r) out.push(id); // both changed: keep a deletion
  });
  return out;
}
const recEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/* Fields that must never trigger a conflict on their own: ordering,
   sync bookkeeping (calendar link + hash), and timestamps/ids derived from
   completing a task. Two devices marking the same task complete seconds
   apart (different completedAt) or reordering a list mean the same thing —
   flagging those as "device vs Drive" conflicts is noise. Content equality
   below ignores them; the dialog's diff skips them too. */
const VOLATILE_KEYS = new Set(['order', 'createdAt', 'completedAt', 'recId', 'spawnedId', 'calEventId', 'calRev']);
function normRec(r) {
  if (!r || typeof r !== 'object') return r;
  const o = {};
  Object.keys(r).forEach((k) => { if (!VOLATILE_KEYS.has(k)) o[k] = r[k]; });
  return o;
}
const normEq = (a, b) => JSON.stringify(normRec(a)) === JSON.stringify(normRec(b));
function mergeArrays(base, local, remote, takeRemote, collect, coll, labelOf) {
  const bi = new Map(base.map((x) => [x.id, x]));
  const li = new Map(local.map((x) => [x.id, x]));
  const ri = new Map(remote.map((x) => [x.id, x]));
  const out = [];
  const interim = takeRemote ? 'theirs' : 'mine';
  let conflicts = 0, fromRemote = 0;
  new Set([...bi.keys(), ...li.keys(), ...ri.keys()]).forEach((id) => {
    const b = bi.get(id), l = li.get(id), r = ri.get(id);
    if (!b) { // created while the other side couldn't see it (ids are unique,
      // so same-id both-created is near-impossible — still surfaced, not dropped)
      if (l && r && !normEq(l, r)) {
        conflicts++;
        if (collect) collect.push({ coll, id, label: labelOf(l, r), local: l, remote: r, interim, createdBoth: true });
      }
      out.push(l || r);
      if (r && !l) fromRemote++;
      return;
    }
    const dl = !l || !normEq(l, b); // deleted counts as changed
    const dr = !r || !normEq(r, b);
    if (!dl && !dr) { out.push(l); return; }
    if (dl && !dr) { if (l) out.push(l); return; } // kept local edit / local delete wins
    if (!dl && dr) { if (r) { out.push(r); fromRemote++; } return; } // remote edit / remote delete wins
    // changed on BOTH sides: newest file wins interim, user can override.
    // delete-vs-edit is a real conflict too (not just edit-vs-edit). But two
    // branches that converged (both deleted, or same content ignoring volatile
    // bookkeeping) are agreements, not conflicts.
    if (!l && !r) return; // deleted on both sides: stays deleted
    if (l && r && normEq(l, r)) { out.push(takeRemote ? r : l); if (takeRemote) fromRemote++; return; }
    conflicts++;
    if (l && r) {
      if (collect) collect.push({ coll, id, label: labelOf(l, r), local: l, remote: r, interim });
      if (takeRemote) { out.push(r); fromRemote++; } else out.push(l);
    } else {
      if (collect) collect.push({ coll, id, label: labelOf(l || r, l || r), local: l || null, remote: r || null, interim, deletedOn: l ? 'theirs' : 'mine' });
      if (r) { out.push(r); fromRemote++; }
      else if (l) out.push(l);
      // both deleted: stays deleted, still counts as resolved above
    }
  });
  return { arr: out, conflicts, fromRemote };
}
function mergeObj(base, local, remote, takeRemote) {
  // Plain key/value settings (label renames). Both-sides edits auto-resolve to
  // newest — renaming a label on two devices is not worth a dialog. The caller
  // logs these as auto-resolved instead of counting them as user conflicts.
  base = base || {}; local = local || {}; remote = remote || {};
  if (recEq(local, base) && recEq(remote, base)) return { obj: local, conflict: 0, fromRemote: 0 };
  if (!recEq(local, base) && recEq(remote, base)) return { obj: local, conflict: 0, fromRemote: 0 };
  if (recEq(local, base) && !recEq(remote, base)) return { obj: remote, conflict: 0, fromRemote: 1 };
  if (recEq(local, remote)) return { obj: local, conflict: 0, fromRemote: 0 };
  return takeRemote
    ? { obj: remote, conflict: 0, fromRemote: 1, auto: 1 }
    : { obj: local, conflict: 0, fromRemote: 0, auto: 1 };
}
function mergeScalar(base, local, remote, takeRemote) {
  // Same newest-wins auto policy as mergeObj (currently: your name).
  if (local === base && remote === base) return { obj: local, conflict: 0, fromRemote: 0 };
  if (local !== base && remote === base) return { obj: local, conflict: 0, fromRemote: 0 };
  if (local === base && remote !== base) return { obj: remote, conflict: 0, fromRemote: 1 };
  if (local === remote) return { obj: local, conflict: 0, fromRemote: 0 };
  return takeRemote
    ? { obj: remote, conflict: 0, fromRemote: 1, auto: 1 }
    : { obj: local, conflict: 0, fromRemote: 0, auto: 1 };
}
function applyRemote(remote, remoteTime) {
  if (!remote || !Array.isArray(remote.tasks) || !Array.isArray(remote.lists)) throw new Error('drive');
  salvageState(remote);
  if (!remote.lists.length) throw new Error('drive');
  remote.tasks.forEach((t) => { t.weight = clampWeight(t.weight); t.importance = clampImp(t.importance); if (typeof t.tz !== 'string') t.tz = ''; if (typeof t.dueUtc !== 'number' || isNaN(t.dueUtc)) t.dueUtc = 0; });
  const base = (syncMeta.base && Array.isArray(syncMeta.base.tasks)) ? syncMeta.base : { lists: [], tasks: [], times: [], colorNames: {}, customColors: [], userName: '', deletedColors: [] };
  const takeRemote = remoteTime >= (state.dirtyAt || 0);
  const freshConflicts = [];
  const timeLabel = (l) => (l && l.title) || (l && l.taskId && getTask(l.taskId) && getTask(l.taskId).title) || 'Time record';
  const colorLabel = (l) => (l && l.name) || 'Label';
  const ml = mergeArrays(base.lists || [], state.lists, remote.lists || [], takeRemote, freshConflicts, 'lists', (l) => l.name || '(untitled)');
  const mt = mergeArrays(base.tasks || [], state.tasks, remote.tasks || [], takeRemote, freshConflicts, 'tasks', (l) => l.title || '(untitled)');
  const mm = mergeArrays(base.times || [], state.times || [], remote.times || [], takeRemote, freshConflicts, 'times', timeLabel);
  const mc = mergeObj(base.colorNames, state.colorNames || {}, remote.colorNames, takeRemote);
  const mcc = mergeArrays(base.customColors || [], state.customColors || [], remote.customColors || [], takeRemote, freshConflicts, 'customColors', colorLabel);
  const mu = mergeScalar(typeof base.userName === 'string' ? base.userName : '', state.userName || '', typeof remote.userName === 'string' ? remote.userName : '', takeRemote);
  const mergedDeleted = mergeIdSet(base.deletedColors, state.deletedColors, remote.deletedColors);
  const mdl = { obj: mergedDeleted, conflict: 0, fromRemote: 0 };
  const timer = state.timer; // timer is device-local
  state.lists = ml.arr; state.tasks = mt.arr; state.times = mm.arr; state.timer = timer;
  state.colorNames = mc.obj;
  state.customColors = mcc.arr;
  state.userName = mu.obj;
  state.deletedColors = (mdl.obj || []).filter((id) => BUILTIN_COLOR_IDS.has(id));
  // a color deleted on another device must not leave tasks stranded
  const okC = new Set(allColors().map((c) => c.id));
  state.tasks.forEach((t) => { if (!okC.has(t.color)) t.color = 'default'; });
  if (!okC.has(state.filters.color)) state.filters.color = '';
  // Only queued items need the user's pick. Plain settings (label renames,
  // your name) auto-resolve to newest and are just logged so the count in the
  // dialog always matches what you can actually review.
  const autoSettings = (mc.auto || 0) + (mu.auto || 0);
  const fresh = ml.fromRemote + mt.fromRemote + mm.fromRemote + mc.fromRemote + mcc.fromRemote + mu.fromRemote + mdl.fromRemote;
  save(); renderAll();
  syncMeta.base = snapState(state);
  syncMeta.lastSyncedAt = Date.now();
  saveSyncMeta();
  // re-pull before resolving: refresh any already-queued entry for the same
  // item instead of stacking duplicates.
  freshConflicts.forEach((c) => {
    const i = pendingConflicts.findIndex((p) => p.coll === c.coll && p.id === c.id);
    if (i >= 0) pendingConflicts[i] = c; else pendingConflicts.push(c);
  });
  if (autoSettings) {
    try { slog('info', `Auto-resolved ${autoSettings} setting${autoSettings === 1 ? '' : 's'} with the newest version (no action needed)`); } catch {}
  }
  return { conflicts: freshConflicts.length, fresh };
}

/* ----- per-conflict resolution dialog -----
   Each entry is one item edited on BOTH sides between syncs (or edited on one
   side and deleted on the other). The merged list already shows an interim
   winner (the newest file) so nothing is lost; this dialog lets you override
   it per item. Picks are whole-item — field rows below only explain WHAT
   differs, they are not individually pickable. */
let pendingConflicts = [];
const CONFLICT_KIND = { tasks: 'Task', lists: 'List', times: 'Time record', customColors: 'Label' };
const CONFLICT_FIELDS = {
  title: 'Title', name: 'Name', notes: 'Notes', date: 'Due date', time: 'Time',
  tz: 'Time zone', dueUtc: 'Due moment', due: 'Due',
  done: 'Completed', color: 'Label', weight: 'Weight', importance: 'Importance',
  listId: 'List', extRef: 'Reference', subtasks: 'Subtasks', recur: 'Repeat',
  remindBefore: 'Reminder', seconds: 'Duration', startedAt: 'Logged at',
  taskId: 'Task', hex: 'Color',
};
function shortStr(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function conflictDue(t) {
  if (!t || typeof t !== 'object') return '—';
  if (typeof t.date !== 'string' || !t.date) return 'No date';
  let d = t.date, tm = t.time || '';
  try {
    if (typeof displayDate === 'function' && typeof displayTime === 'function' && hasClockTime(t)) {
      d = displayDate(t) || d; tm = displayTime(t) || tm;
    }
  } catch {}
  let s = d + (tm ? ' ' + tm : '');
  if (t.tz) s += ` (${t.tz})`;
  return s;
}
function conflictFull(kind, t, k) {
  if (!t || typeof t !== 'object') return '— (deleted)';
  const v = k === 'due' ? conflictDue(t) : t[k];
  if (v === undefined || v === null || v === '' || v === 0) return '—';
  if (k === 'done') return v ? 'Completed' : 'Open';
  if (k === 'due') return String(v);
  if (k === 'remindBefore') return typeof v === 'number' ? fmtOffset(v) : '—';
  if (k === 'dueUtc') { try { return fmtRemind(v); } catch { return String(v); } }
  if (k === 'listId') return listName(v);
  if (k === 'color') return colorName(v);
  if (k === 'weight') return (WEIGHTS[v] && WEIGHTS[v].label) || String(v);
  if (k === 'importance') return (IMPORTANCE[v] && IMPORTANCE[v].label) || String(v);
  if (k === 'recur') return (v && v.freq ? recurLabel(v) : 'Does not repeat');
  if (k === 'subtasks') {
    if (!Array.isArray(v)) return '—';
    const done = v.filter((s) => s.done).length;
    const names = v.map((s) => s.title || '(untitled)').join(', ');
    return `${done}/${v.length} done${names ? ' — ' + names : ''}`;
  }
  if (k === 'seconds') return fmtDur(v);
  if (k === 'startedAt') { const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString(); }
  if (k === 'taskId') { const t2 = getTask(v); return t2 ? t2.title || '(untitled)' : '(deleted task)'; }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function conflictVal(kind, t, k) {
  return shortStr(conflictFull(kind, t, k), k === 'notes' || k === 'subtasks' || k === 'extRef' ? 120 : 60);
}
function conflictDiff(c) {
  const baseSkip = new Set(['id', 'createdAt', 'order', 'completedAt', 'recId', 'calEventId', 'calRev', 'spawnedId']);
  const skip = (c.coll === 'tasks' || c.coll === 'lists') ? baseSkip : new Set(['id', 'createdAt']);
  // delete-vs-edit: spell out which side deleted, then show the surviving
  // version's fields against "— (deleted)" so the choice is concrete.
  if (!c.local || !c.remote) {
    const rows = [[
      'Status',
      !c.local ? 'Deleted on this device' : 'Kept on this device',
      !c.remote ? 'Deleted in Drive' : 'Kept in Drive',
      !c.local ? 'Deleted on this device' : 'Kept on this device',
      !c.remote ? 'Deleted in Drive' : 'Kept in Drive',
    ]];
    const survivor = c.local || c.remote;
    const goneSide = c.local ? 'theirs' : 'mine';
    Object.keys(survivor || {}).forEach((k) => {
      if (skip.has(k) || k === 'dueUtc' || k === 'tz') return;
      if (k === 'date' || k === 'time') return; // covered by the Due row
      if (rows.length >= 9) return;
      const full = conflictFull(c.coll, survivor, k);
      const base = survivor[k];
      if (base === undefined || base === null || base === '' || base === 0 || base === false) return;
      if (Array.isArray(base) && !base.length) return;
      rows.push([
        CONFLICT_FIELDS[k] || k,
        goneSide === 'mine' ? '— (deleted)' : shortStr(full, 60),
        goneSide === 'theirs' ? '— (deleted)' : shortStr(full, 60),
        goneSide === 'mine' ? '— (deleted)' : full,
        goneSide === 'theirs' ? '— (deleted)' : full,
      ]);
    });
    if (survivor && (survivor.date || survivor.time || survivor.tz || survivor.dueUtc)) {
      const full = conflictDue(survivor);
      rows.splice(1, 0, ['Due',
        goneSide === 'mine' ? '— (deleted)' : shortStr(full, 60),
        goneSide === 'theirs' ? '— (deleted)' : shortStr(full, 60),
        goneSide === 'mine' ? '— (deleted)' : full,
        goneSide === 'theirs' ? '— (deleted)' : full]);
    }
    return rows.slice(0, 9);
  }
  const rows = [];
  const keys = new Set([...Object.keys(c.local), ...Object.keys(c.remote)]);
  // due date/time/zone/moment are one decision ("when is it due"), not four
  if (['date', 'time', 'tz', 'dueUtc'].some((k) => keys.has(k))) {
    const a = conflictDue(c.local), b = conflictDue(c.remote);
    if (a !== b) rows.push(['Due', shortStr(a, 60), shortStr(b, 60), a, b]);
    keys.delete('date'); keys.delete('time'); keys.delete('tz'); keys.delete('dueUtc');
  }
  keys.forEach((k) => {
    if (skip.has(k)) return;
    if (JSON.stringify(c.local[k] ?? null) !== JSON.stringify(c.remote[k] ?? null)) {
      rows.push([CONFLICT_FIELDS[k] || k, conflictVal(c.coll, c.local, k), conflictVal(c.coll, c.remote, k), conflictFull(c.coll, c.local, k), conflictFull(c.coll, c.remote, k)]);
    }
  });
  return rows.slice(0, 12);
}
function conflictArr(c) {
  if (c.coll === 'lists') return state.lists;
  if (c.coll === 'tasks') return state.tasks;
  if (c.coll === 'times') return state.times;
  if (c.coll === 'customColors') return state.customColors || [];
  return null;
}
function liveConflicts() {
  // entries whose item vanished on both sides (deleted after queueing, or the
  // user deleted the surviving side) resolve themselves
  pendingConflicts = pendingConflicts.filter((c) => {
    const arr = conflictArr(c);
    if (!arr) return false;
    if (arr.some((x) => x.id === c.id)) return true;
    // delete-vs-edit where the survivor was since deleted: nothing left to pick
    return false;
  });
  return pendingConflicts;
}
function pumpConflicts() {
  if (!pendingConflicts.length || document.hidden) return;
  if (!$('#conflictScrim').classList.contains('hidden')) return;
  liveConflicts();
  if (!pendingConflicts.length) return;
  renderConflictList();
  $('#conflictScrim').classList.remove('hidden');
}
function paintConflictPick(pick, v) {
  [...pick.querySelectorAll('button')].forEach((b) => b.classList.toggle('selected', b.dataset.v === v));
}
function renderConflictList() {
  const list = $('#conflictList'); if (!list) return;
  list.innerHTML = '';
  $('#conflictTitle').textContent = `Sync conflicts (${pendingConflicts.length})`;
  $('#conflictCount').textContent = 'The same item was changed on this device and in Drive. The newest version is showing for now — pick which whole item to keep per row, then Apply. Later keeps the newest for now and asks again next sync.';
  pendingConflicts.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'conflict-item';
    const head = document.createElement('div');
    head.className = 'conflict-item-head';
    const t = document.createElement('span');
    t.className = 'conflict-item-title'; t.dir = 'auto';
    const kind = CONFLICT_KIND[c.coll] || 'Item';
    const survivor = c.local || c.remote;
    const headline = (c.coll === 'tasks' && survivor && survivor.title) || (c.coll === 'lists' && survivor && survivor.name)
      || c.label || '(untitled)';
    t.textContent = `${kind} “${headline}”`;
    if (c.deletedOn) t.textContent += c.deletedOn === 'mine' ? ' — deleted here' : ' — deleted in Drive';
    else if (c.createdBoth) t.textContent += ' — created on both sides';
    t.title = t.textContent;
    head.appendChild(t);
    item.appendChild(head);
    const sub = document.createElement('div');
    sub.className = 'muted small conflict-sub';
    sub.textContent = c.deletedOn
      ? (c.deletedOn === 'mine'
        ? 'Deleted on this device but edited in Drive. Keep Drive to restore it, or keep this device to delete it everywhere.'
        : 'Edited on this device but deleted in Drive. Keep this device to restore it, or keep Drive to delete it everywhere.')
      : `Currently showing ${c.interim === 'theirs' ? 'Drive’s' : 'this device’s'} version (it was newer).`;
    item.appendChild(sub);
    const rows = conflictDiff(c);
    const dl = document.createElement('div');
    dl.className = 'conflict-diff';
    ['Field', 'This device', 'Drive'].forEach((h) => {
      const s = document.createElement('span'); s.className = 'cd-h'; s.textContent = h; dl.appendChild(s);
    });
    if (!rows.length) {
      const m = document.createElement('span'); m.className = 'cd-f muted small';
      m.textContent = 'Only ordering or sync bookkeeping differs — either side keeps your content.';
      dl.append(m, document.createElement('span'), document.createElement('span'));
    }
    rows.forEach(([f, a, b, fa, fb]) => {
      const fEl = document.createElement('span'); fEl.className = 'cd-f'; fEl.textContent = f; fEl.title = f;
      const aEl = document.createElement('span'); aEl.textContent = a; aEl.dir = 'auto'; aEl.title = fa || a;
      const bEl = document.createElement('span'); bEl.textContent = b; bEl.dir = 'auto'; bEl.title = fb || b;
      dl.append(fEl, aEl, bEl);
    });
    item.appendChild(dl);
    const pick = document.createElement('div');
    pick.className = 'segmented conflict-pick';
    pick.dataset.cid = `${c.coll}:${c.id}`;
    const def = c.interim === 'theirs' ? 'theirs' : 'mine';
    [['mine', 'This device'], ['theirs', 'Drive']].forEach(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.v = v; b.textContent = label;
      if (v === def) b.classList.add('selected');
      b.title = v === def ? 'Currently showing this version' : 'Switch to this version';
      b.onclick = () => paintConflictPick(pick, v);
      pick.appendChild(b);
    });
    item.appendChild(pick);
    list.appendChild(item);
  });
}
function closeConflict() { $('#conflictScrim').classList.add('hidden'); } // defers; pending stay queued
function applyConflicts() {
  const picks = new Map();
  [...document.querySelectorAll('#conflictList .conflict-pick')].forEach((p) => {
    const sel = p.querySelector('button.selected');
    picks.set(p.dataset.cid, sel && sel.dataset.v === 'theirs');
  });
  let mine = 0, theirs = 0, skipped = 0;
  liveConflicts().forEach((c) => {
    const arr = conflictArr(c);
    if (!arr) return;
    const i = arr.findIndex((x) => x.id === c.id);
    const pickRemote = picks.get(`${c.coll}:${c.id}`) === true;
    const want = pickRemote ? c.remote : c.local;
    if (i < 0) {
      // item is gone now (user deleted the survivor while deciding): restoring
      // a pick would resurrect it behind their back — only restore an explicit
      // keep-the-other-side pick... simplest is to leave it deleted.
      if (!want) { if (pickRemote) theirs++; else mine++; }
      else skipped++;
      return;
    }
    // edited after the sync queued this conflict: overwriting with the stale
    // snapshot would silently drop those newer edits — keep current instead.
    const cur = arr[i];
    if (want && !normEq(cur, c.local) && !normEq(cur, c.remote)) { skipped++; return; }
    if (!want) { arr.splice(i, 1); }
    else arr[i] = want;
    if (pickRemote) theirs++; else mine++;
  });
  const n = mine + theirs;
  pendingConflicts = [];
  closeConflict();
  if (!n && !skipped) return;
  save(); renderAll();
  syncMeta.base = snapState(state);
  syncMeta.lastSyncedAt = Date.now();
  saveSyncMeta();
  if (n) {
    slog('info', `Resolved ${n} conflict${n === 1 ? '' : 's'} — kept ${mine} from this device, ${theirs} from Drive`);
    toast(`Resolved ${n} conflict${n === 1 ? '' : 's'}`);
    schedulePush();
  }
  if (skipped) {
    try { slog('info', `Skipped ${skipped} conflict${skipped === 1 ? '' : 's'} edited after sync — kept your latest edits`); } catch {}
    if (!n) { try { toast('Kept your latest edits (changed after sync)'); } catch {} }
  }
}

/* ---------- reminders (Google Calendar only) ----------
   Reminder = due date/time minus `remindBefore` minutes ('' = off).
   The calendar event sits AT the due time with a Google popup firing
   `remindBefore` earlier. Calendar is the only channel, so there is nothing
   that could double-notify — and nothing needs to run on the device at all. */
/* effective due timestamp; dateless-time tasks default to 9:00 AM.
   Timed tasks store their absolute instant in `dueUtc` (stamped from the
   device where the date/time was entered). Viewers in other timezones then
   see the same moment converted to local wall time instead of the raw wall
   repeating everywhere. Tasks without a valid stamp (legacy, or date-only)
   fall back to floating local interpretation. */
function parseWallMs(dateStr, timeStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return 0;
  const [Y, M, D] = dateStr.split('-').map(Number);
  const tm = (timeStr && /^\d{1,2}:\d{2}/.test(timeStr)) ? timeStr : '09:00';
  const [h, min] = tm.split(':').map(Number);
  const n = new Date(Y, M - 1, D, h || 0, min || 0, 0, 0).getTime();
  return isNaN(n) ? 0 : n;
}
function hasClockTime(t) { return !!(t.time && /^\d{1,2}:\d{2}/.test(t.time)); }
function dueTs(t) {
  if (!t.date || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return 0;
  if (hasClockTime(t) && typeof t.dueUtc === 'number' && t.dueUtc > 0) return t.dueUtc;
  return parseWallMs(t.date, t.time);
}
/* Record the absolute instant for the wall currently held in t.date/t.time,
   interpreted in THIS device's timezone. Call after every date/time edit so
   other timezones can convert. Date-only tasks stay floating (dueUtc = 0). */
function stampDue(t) {
  if (!t || typeof t !== 'object') return;
  if (t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && hasClockTime(t)) {
    t.dueUtc = parseWallMs(t.date, t.time);
    try { t.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || t.tz || ''; }
    catch { t.tz = t.tz || ''; }
  } else {
    t.dueUtc = 0;
  }
  // a changed moment invalidates the synced calendar event hash (only when
  // the task actually uses calendar reminders, to avoid churning plain tasks)
  if (typeof t.remindBefore === 'number' || t.calEventId || 'calRev' in t) t.calRev = '';
}
/* Move a timed task to a viewer-local calendar day, keeping the time-of-day
   the viewer currently sees (not the raw stored wall, which may belong to a
   different zone). Date-only tasks just change day. */
function moveDueToDate(t, isoDate) {
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate || '')) return;
  if (hasClockTime(t)) {
    t.time = displayTime(t) || t.time;
    t.date = isoDate;
    stampDue(t);
  } else {
    t.date = isoDate;
  }
}
function isoDateOfMs(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function timeOfMs(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/* Viewer-local calendar day for grouping/overdue checks. Timed stamped tasks
   convert; everything else uses the stored floating date. */
function displayDate(t) {
  if (t && hasClockTime(t) && typeof t.dueUtc === 'number' && t.dueUtc > 0) {
    const iso = isoDateOfMs(t.dueUtc);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  }
  return (t && t.date) || '';
}
/* Viewer-local wall time. Stamped timed tasks convert; otherwise raw. */
function displayTime(t) {
  if (t && hasClockTime(t) && typeof t.dueUtc === 'number' && t.dueUtc > 0) return timeOfMs(t.dueUtc);
  return (t && t.time) || '';
}
function triggerTs(t) {
  if (typeof t.remindBefore !== 'number' || !dueTs(t)) return 0;
  return dueTs(t) - t.remindBefore * 60000;
}
function p2(n) { return String(n).padStart(2, '0'); }
function isoLocal(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
function fmtRemind(v) {
  const n = typeof v === 'number' ? v : Date.parse(v || '');
  if (isNaN(n)) return '—';
  return new Date(n).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtOffset(min) {
  if (min === 1) return '1 min before';
  if (min < 60) return `${min} min before`;
  if (min < 1440) return `${min / 60} hour${min === 60 ? '' : 's'} before`;
  return '1 day before';
}

/* ----- Calendar reminders (closed-app notifications) -----
   Reminder = due date/time minus a chosen offset; the event sits AT the due
   time with a Google popup `remindBefore` minutes earlier. Calendar event
   ids live on the task (synced); the enable flag + calendar id are
   per-browser. Whole-task three-way merge carries remindBefore automatically. */
const CAL_STORE_KEY = 'doto-cal';
const CAL_QUEUE_KEY = 'doto-cal-queue';
function calStore() {
  try {
    const s = JSON.parse(localStorage.getItem(CAL_STORE_KEY));
    if (s && typeof s === 'object') return { enabled: false, calendarId: '', ...s };
  } catch {}
  return { enabled: false, calendarId: '' };
}
function saveCalStore(s) { try { localStorage.setItem(CAL_STORE_KEY, JSON.stringify(s)); } catch {} }
function calQueue() {
  try { const a = JSON.parse(localStorage.getItem(CAL_QUEUE_KEY)); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function calQueueSave(a) { try { localStorage.setItem(CAL_QUEUE_KEY, JSON.stringify(a.slice(-50))); } catch {} }
function queueCalDelete(eventId) {
  if (!eventId) return;
  const q = calQueue();
  if (!q.some((x) => x && x.eventId === eventId)) q.push({ eventId });
  calQueueSave(q);
}
function calConnected() { return !!syncMeta.email; }
let lastCalError = '';
async function calFetch(path, opts = {}, mode = 'silent') {
  const doFetch = (at) => fetch('https://www.googleapis.com/calendar/v3' + path, {
    ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
  });
  let r = await doFetch(await ensureToken(mode, true));
  // Same one-retry rule as Drive: a cached token can be valid locally but
  // dead at Google (expiry/revoke). Retry once with a fresh token so Sync now
  // heals in one tap. 403 (scope denied, API disabled) must NOT loop popups.
  if (r.status === 401) {
    syncMeta.token = null; saveSyncMeta();
    try { r = await doFetch(await ensureToken(mode, true)); }
    catch { throw new Error('auth'); }
    if (r.status === 401) { syncMeta.token = null; saveSyncMeta(); throw new Error('auth'); }
  }
  if (r.status === 204) return null;
  if (!r.ok) {
    const err = new Error('cal' + r.status);
    try { err.detail = (await r.clone().text()).slice(0, 200); } catch {}
    err.status = r.status;
    throw err;
  }
  return r.json();
}
function tzName() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } }
function eventDateTime(ms) {
  const d = new Date(ms);
  const wall = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:00`;
  const tz = tzName();
  if (tz) return { dateTime: wall, timeZone: tz };
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  return { dateTime: `${wall}${sign}${p2(Math.floor(a / 60))}:${p2(a % 60)}` };
}
function calEventBody(t) {
  const due = dueTs(t);
  const mins = typeof t.remindBefore === 'number' ? t.remindBefore : 0;
  return {
    summary: (t.title || '(untitled)').slice(0, 200),
    description: `${t.notes || ''}\n— ${listName(t.listId)} (DoTo reminder)`.slice(0, 2000),
    start: eventDateTime(due),
    end: eventDateTime(due + 30 * 60000),
    status: 'confirmed',
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: mins },
        { method: 'email', minutes: mins },
      ],
    },
  };
}
function calRev(t) { return JSON.stringify([t.title, t.notes, t.date, t.time, t.dueUtc || 0, t.tz || '', t.remindBefore, t.listId]); }
function needsCalEvent(t) {
  if (!calConnected() || t.done || typeof t.remindBefore !== 'number') return false;
  const due = dueTs(t);
  if (!due) return false;
  // Keep the Google event until an hour after due so a 1-minute popup can still fire.
  return due > Date.now() - 3600000;
}
async function ensureCalVisible(calId, mode) {
  const path = '/users/me/calendarList/' + encodeURIComponent(calId);
  const body = JSON.stringify({ selected: true, hidden: false, defaultReminders: [] });
  try {
    await calFetch(path, { method: 'PATCH', body }, mode);
  } catch (e) {
    // 403 here just means the token is read-only for the calendar list
    // (we only request calendarlist.readonly) — visibility is best-effort.
    if (!e || e.status === 403) return;
    if (!e || e.status !== 404) throw e;
    try {
      await calFetch('/users/me/calendarList', { method: 'POST', body: JSON.stringify({ id: calId, selected: true, hidden: false, defaultReminders: [] }) }, mode);
    } catch (e2) { if (!e2 || e2.status === 403) return; throw e2; }
  }
}
async function ensureCalCalendar(mode) {
  const s = calStore();
  // NOTE: no GET /calendars/{id} check here on purpose — that endpoint needs
  // the calendar.calendars.readonly scope, which we deliberately do not
  // request. The stored id is validated against calendarList.list instead
  // (covered by calendar.calendarlist.readonly), which is all we need.
  const list = await calFetch('/users/me/calendarList', {}, mode);
  const items = (list && list.items) || [];
  const oldId = s.calendarId || '';
  const oldKind = s.kind || '';
  if (oldId) {
    const stillThere = items.some((c) => c && c.id === oldId && !c.deleted);
    if (stillThere) {
      // Dedicated DoTo calendar sticks. A stored primary calendar is only the
      // old fallback from before calendar.app.created was requested — keep
      // going below so it upgrades to a real DoTo calendar instead of
      // staying on the user's main calendar forever.
      if (oldKind !== 'primary') return oldId;
    } else {
      s.calendarId = '';
    }
  }
  const hit = items.find((c) => c && (c.summary === 'DoTo' || c.summaryOverride === 'DoTo') && !c.deleted && !c.hidden);
  const anyDoTo = hit || items.find((c) => c && (c.summary === 'DoTo' || c.summaryOverride === 'DoTo') && !c.deleted);
  if (anyDoTo) {
    await adoptDoToCalendar(s, anyDoTo.id, oldId, mode);
    try { await ensureCalVisible(anyDoTo.id, mode); } catch {}
    return anyDoTo.id;
  }
  try {
    const body = { summary: 'DoTo', description: 'Reminders from the DoTo task manager' };
    const tz = tzName(); if (tz) body.timeZone = tz;
    const created = await calFetch('/calendars', { method: 'POST', body: JSON.stringify(body) }, mode);
    await adoptDoToCalendar(s, created.id, oldId, mode);
    try { await ensureCalVisible(created.id, mode); } catch {}
    return created.id;
  } catch (e) {
    // Creating a calendar needs calendar.app.created — without it (old token,
    // scope unticked) fall back to the user's primary calendar. If we got here
    // while holding a stale primary id, keep it to avoid churn.
    if (oldId && oldKind === 'primary') {
      const stillThere = items.some((c) => c && c.id === oldId && !c.deleted);
      if (stillThere) { s.calendarId = oldId; s.kind = 'primary'; saveCalStore(s); return oldId; }
    }
    const primary = items.find((c) => c && c.primary) || items[0];
    if (!primary) throw e;
    s.calendarId = primary.id; s.kind = 'primary'; saveCalStore(s);
    slog('info', 'Using your main Google Calendar (cannot create a DoTo calendar with current permission)');
    return primary.id;
  }
}
/* Switch the stored target to a dedicated DoTo calendar. Tasks whose events
   still live in the old primary-fallback calendar are deleted there and their
   ids cleared, so the next reconcile re-creates them in the DoTo calendar
   instead of leaving orphans behind. */
async function adoptDoToCalendar(s, newId, oldId, mode) {
  const switching = !!oldId && oldId !== newId;
  s.calendarId = newId; s.kind = 'doto'; saveCalStore(s);
  if (!switching) return;
  let moved = false;
  try {
    for (const t of state.tasks) {
      if (!t || !t.calEventId) continue;
      try {
        await calFetch(`/calendars/${encodeURIComponent(oldId)}/events/${encodeURIComponent(t.calEventId)}`,
          { method: 'DELETE' }, mode);
      } catch (e) { if (!e || (e.status !== 404 && e.status !== 410)) throw e; }
      t.calEventId = ''; t.calRev = '';
      moved = true;
    }
  } catch {}
  if (moved) { try { save(); renderAll(); } catch {} }
  slog('info', 'Reminders moved to the “DoTo” Google calendar');
}
async function upsertCalEvent(t, mode) {
  const calId = await ensureCalCalendar(mode);
  const body = calEventBody(t);
  let ev = null;
  if (t.calEventId) {
    try {
      ev = await calFetch(`/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(t.calEventId)}`,
        { method: 'PATCH', body: JSON.stringify(body) }, mode);
    } catch (e) { if (!e || (e.status !== 404 && e.status !== 410)) throw e; t.calEventId = ''; }
  }
  if (!ev) {
    ev = await calFetch(`/calendars/${encodeURIComponent(calId)}/events`,
      { method: 'POST', body: JSON.stringify(body) }, mode);
  }
  t.calEventId = ev.id; t.calRev = calRev(t);
}
async function deleteCalEvent(calId, eventId, mode) {
  try {
    await calFetch(`/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }, mode);
  } catch (e) { if (!e || (e.status !== 404 && e.status !== 410)) throw e; }
}
/* debounced reconcile: drains the delete queue, creates/updates events for
   tasks with reminders, removes events that are no longer needed. Armed
   from save() so every mutation path is covered; idempotent and cheap
   (hash compare skips up-to-date tasks). */
let calSyncTimer = 0, calSyncing = false, calSyncAgain = false;
function scheduleCalendarSync() {
  if (!calConnected()) return;
  clearTimeout(calSyncTimer);
  calSyncTimer = setTimeout(() => { calendarReconcile('silent').catch(() => {}); }, 1200);
}
async function calendarReconcile(mode) {
  if (calSyncing) { calSyncAgain = true; return; }
  if (!calConnected() || !navigator.onLine) return;
  calSyncing = true; calSyncAgain = false;
  let changed = false;
  try {
    const calId = await ensureCalCalendar(mode);
    const q = calQueue();
    if (q.length) {
      const left = [];
      for (const op of q) {
        if (!op || !op.eventId) continue;
        try { await deleteCalEvent(calId, op.eventId, mode); }
        catch (e) {
          if (e && e.message === 'auth') { left.push(op); break; }
          // other failures (scope revoked, API disabled): handled below via error path
          if (e && e.status !== 404 && e.status !== 410) throw e;
        }
      }
      calQueueSave(left);
    }
    for (const t of state.tasks) {
      if (needsCalEvent(t) && (t.calRev !== calRev(t) || !t.calEventId)) {
        await upsertCalEvent(t, mode);
        changed = true;
      }
    }
    for (const t of state.tasks) {
      if (t.calEventId && !needsCalEvent(t)) {
        try { await deleteCalEvent(calId, t.calEventId, mode); }
        catch (e) { if (e && e.message === 'auth') break; if (e && e.status !== 404 && e.status !== 410) throw e; }
        t.calEventId = ''; t.calRev = '';
        changed = true;
      }
    }
    if (changed) { clearTimeout(calSyncTimer); save(); renderAll(); }
    lastCalError = '';
    // A real Calendar round-trip proves the grant — trust it from here on.
    if (syncMeta.calGranted !== true) { syncMeta.calGranted = true; saveSyncMeta(); }
    const n = state.tasks.filter(needsCalEvent).length;
    const placed = state.tasks.filter((t) => t.calEventId && needsCalEvent(t)).length;
    const s = calStore();
    const where = s.calendarId ? (s.kind === 'primary' ? 'your main Google Calendar' : 'the “DoTo” Google calendar') : 'Google Calendar';
    slog('ok', n ? `Reminders synced (${placed}/${n} in ${where})` : 'Reminders synced — no reminders set yet (pick Reminder per task)');
    if (mode !== 'silent') {
      try { toast(n ? (placed === n ? `Calendar synced — ${n} reminder${n === 1 ? '' : 's'} in ${where}` : `Calendar partly synced (${placed}/${n}) — see History`) : 'Calendar synced — set a Reminder on a task to see it in Google Calendar'); } catch {}
    }
  } catch (e) { handleCalError(e, mode); }
  finally {
    calSyncing = false; if (ui.detailId) { try { renderDetail(); } catch {} }
    if (calSyncAgain) { calSyncAgain = false; scheduleCalendarSync(); }
  }
}
function handleCalError(e, mode) {
  const m = (e && e.message) || '';
  const detail = (e && e.detail) || '';
  const scopeDenied = detail.indexOf('insufficient authentication scopes') >= 0 || detail.indexOf('insufficientPermissions') >= 0;
  let msg = 'Calendar sync failed — retry.';
  if (m === 'auth' || m === 'setup') msg = m === 'setup' ? 'Set a Google client ID first' : 'Google session ended — sign in again';
  else if (e && e.gis) msg = 'Calendar sign-in failed (' + e.gis + '). Allow popups and try again.';
  else if (scopeDenied)
    msg = 'Calendar needs its permission — tap Sync now to re-grant it.';
  else if (detail.indexOf('accessNotConfigured') >= 0)
    msg = 'Google Calendar API is off for your Cloud project — enable it, then retry.';
  if (scopeDenied) {
    // Stored token is Drive-only in reality: force one consent popup next time
    // instead of silently reusing it forever (the old "nothing happens" loop).
    syncMeta.calGranted = false;
    if (syncMeta.token) {
      let sc = String(syncMeta.token.scope || '');
      for (const s of CAL_SCOPES) sc = sc.split(s).join(' ');
      syncMeta.token.scope = sc.replace(/\s+/g, ' ').trim();
    }
    saveSyncMeta();
  }
  lastCalError = msg + (detail && msg.indexOf('failed') >= 0 ? ' ' + detail.slice(0, 80) : '');
  slog('error', lastCalError);
  if (mode !== 'silent') { try { toast(msg); } catch {} }
  try { paintSync(); } catch {}
}
/* drop the linked event when a reminder no longer needs one (reminder cleared,
   done, delete). Async delete is queued; ids cleared immediately so a
   later undo re-creates instead of pointing at a deleted event. */
function dropCalEvent(t) {
  if (t && t.calEventId) {
    queueCalDelete(t.calEventId);
    t.calEventId = ''; t.calRev = '';
    scheduleCalendarSync();
  }
}
function paintReminderUI(t) {
  const sel = $('#dRemindBefore'); if (!sel) return;
  sel.value = typeof t.remindBefore === 'number' ? String(t.remindBefore) : '';
  const hint = $('#dRemindHint'); if (!hint) return;
  if (typeof t.remindBefore !== 'number') { hint.textContent = 'No reminder.'; return; }
  if (!t.date) { hint.textContent = 'Add a due date first — the reminder counts back from it.'; return; }
  const when = fmtRemind(triggerTs(t));
  const timeNote = t.time ? '' : ' (due time defaults to 9:00 AM)';
  let tzNote = '';
  try {
    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (t.time && t.tz && localTz && t.tz !== localTz && typeof t.dueUtc === 'number' && t.dueUtc > 0)
      tzNote = ` (entered as ${t.time} in ${t.tz})`;
  } catch {}
  if (!syncMeta.email) hint.textContent = `Notify ${when}${timeNote}${tzNote} — sign in to turn reminders on.`;
  else if (lastCalError) hint.textContent = `Notify ${when}${timeNote}${tzNote} — ${lastCalError}`;
  else hint.textContent = t.calEventId
    ? `Notify ${when}${timeNote}${tzNote} — in Google Calendar.`
    : `Notify ${when}${timeNote}${tzNote} — saving…`;
}

/* Google access tokens live ~1h and pure SPAs get no refresh token, so renew
   proactively in the last 10 minutes (while the session is still warm) instead
   of waiting for expiry. iOS WebViews often refuse silent renewal entirely —
   then nudge once per expiry instead of dying quietly. */
let lastRefreshTry = 0, nudgeForExpiry = 0, syncStartAt = 0;
async function maybeRefreshToken() {
  if (!syncMeta.email || !syncMeta.token || !navigator.onLine) return;
  const left = syncMeta.token.expires_at - Date.now();
  if (left > 10 * 60000 || left < -12 * 3600000) return;
  if (Date.now() - lastRefreshTry < 5 * 60000) return;
  lastRefreshTry = Date.now();
  const epoch = syncMeta.token.expires_at;
  try {
    await ensureToken('silent');
    if (syncMeta.token.expires_at > epoch) slog('info', 'Token renewed silently');
  } catch {
    if (document.visibilityState === 'visible' && nudgeForExpiry !== epoch) {
      nudgeForExpiry = epoch;
      try { toast('Sync paused — open Sync & Settings and tap Sync now'); } catch {}
      slog('info', 'Token expired and silent renewal failed — tap Sync now');
    }
  }
}
let syncing = false, lastPullAt = 0, pushTimer = 0;
function syncWatchdog() {
  if (syncing && syncStartAt && Date.now() - syncStartAt > 90000) {
    syncing = false; syncStartAt = 0;
    lastSyncError = 'Sync timed out — retry';
    slog('error', lastSyncError);
    setSync('error');
  }
}
let pendingPush = false;
function schedulePush() {
  if (!syncMeta.auto) return;
  if (!syncMeta.email && !syncMeta.token) return; // never signed in: stay quiet
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushNow('silent').catch(() => {}); }, 2500);
}
async function mergeRemoteIfNewer(mode) {
  const found = await driveFind(mode);
  if (!found) return null;
  syncMeta.fileId = found.id;
  const remoteTime = Date.parse(found.modifiedTime) || 0;
  if (remoteTime > (syncMeta.lastSyncedAt || 0) || !syncMeta.base) {
    const remote = await driveDownload(found.id, mode);
    return { found, remoteTime, res: applyRemote(remote, remoteTime), remote };
  }
  return { found, remoteTime, res: null, remote: null };
}
async function pushNow(mode) {
  if (!navigator.onLine || !googleClientId()) return;
  if (!syncMeta.auto && mode === 'silent') return;
  if (!syncMeta.email && !syncMeta.token) return;
  if (syncing) { pendingPush = true; return; }
  syncing = true; syncStartAt = Date.now(); setSync('syncing');
  try {
    const hit = await mergeRemoteIfNewer(mode);
    if (hit && hit.res) {
      if (hit.res.conflicts) {
        toast('Sync conflict — the newest version is showing; pick which to keep', () => pumpConflicts(), 'Review');
        slog('conflict', `${hit.res.conflicts} conflict${hit.res.conflicts === 1 ? '' : 's'} — newest applied for now, need${hit.res.conflicts === 1 ? 's' : ''} your pick`);
        pumpConflicts();
      }
    }
    await driveUpload(state, mode);
    syncMeta.base = snapState(state);
    syncMeta.lastSyncedAt = Date.now();
    saveSyncMeta();
    if (mode !== 'silent') slog('ok', `Pushed to Drive (${state.tasks.length} tasks, ${state.lists.length} lists)`);
    setSync('ok');
  } catch (e) {
    handleSyncFailure(e, mode, syncMeta.lastSyncedAt ? 'ok' : 'signedout', false);
  } finally {
    syncing = false; syncStartAt = 0; paintSync();
    if (pendingPush) {
      pendingPush = false;
      if (syncMeta.auto) schedulePush();
    }
  }
}
async function pullNow(mode) {
  if (syncing || !navigator.onLine || !googleClientId()) return;
  if (!syncMeta.email && !syncMeta.token) return; // never signed in: stay quiet
  const prev = syncStatus;
  syncing = true; syncStartAt = Date.now(); lastPullAt = Date.now(); setSync('syncing');
  try {
    const found = await driveFind(mode);
    if (!found) {
      const uploaded = state.lists.length || state.tasks.length || syncMeta.fileId;
      if (uploaded) await driveUpload(state, mode);
      syncMeta.base = snapState(state);
      syncMeta.lastSyncedAt = Date.now();
      saveSyncMeta();
      if (mode !== 'silent') slog('ok', uploaded ? 'Uploaded first copy to Drive' : 'Connected — nothing to sync yet');
    } else {
      syncMeta.fileId = found.id;
      const remoteTime = Date.parse(found.modifiedTime) || 0;
      if (remoteTime > (syncMeta.lastSyncedAt || 0) || !syncMeta.base) {
        const remote = await driveDownload(found.id, mode);
        const res = applyRemote(remote, remoteTime);
        const merged = snapState(state);
        const rsnap = { lists: remote.lists || [], tasks: remote.tasks || [], times: remote.times || [], colorNames: remote.colorNames || {}, customColors: remote.customColors || [], userName: remote.userName || '', deletedColors: remote.deletedColors || [] };
        if (!recEq(merged, rsnap)) await driveUpload(state, mode);
        syncMeta.lastSyncedAt = Date.now();
        saveSyncMeta();
        if (res.conflicts) {
          toast('Sync conflict — the newest version is showing; pick which to keep', () => pumpConflicts(), 'Review');
          slog('conflict', `${res.conflicts} conflict${res.conflicts === 1 ? '' : 's'} — newest applied for now, need${res.conflicts === 1 ? 's' : ''} your pick`);
        }
        else if (res.fresh) toast(`Sync: ${res.fresh} change${res.fresh === 1 ? '' : 's'} from Drive`);
        pumpConflicts();
        if (mode !== 'silent' || res.conflicts || res.fresh) {
          if (res.conflicts) slog('conflict', `Pulled with ${res.conflicts} conflict${res.conflicts === 1 ? '' : 's'} — newest applied for now, review to override`);
          else if (res.fresh) slog('ok', `Pulled ${res.fresh} change${res.fresh === 1 ? '' : 's'} from Drive`);
          else slog('ok', 'Pulled — already up to date');
        }
      } else if ((state.dirtyAt || 0) > (syncMeta.lastSyncedAt || 0)) {
        await driveUpload(state, mode);
        syncMeta.base = snapState(state);
        syncMeta.lastSyncedAt = Date.now();
        saveSyncMeta();
        if (mode !== 'silent') slog('ok', 'Pushed local changes to Drive');
      } else {
        syncMeta.base = snapState(state);
        saveSyncMeta();
      }
    }
    setSync('ok');
    scheduleCalendarSync(); // remote edits may change reminded tasks
  } catch (e) {
    handleSyncFailure(e, mode, prev, true);
  } finally {
    syncing = false; syncStartAt = 0; paintSync();
    if (pendingPush) { pendingPush = false; if (syncMeta.auto) schedulePush(); }
  }
}
function signInErrorMsg(e) {
  if (e && e.message === 'net') return 'Could not load Google sign-in — check connection or ad-blocker, then try again.';
  const code = e && e.gis ? String(e.gis) : '';
  // timeout = the Google window never answered (closed too early, popup
  // blocked, or third-party cookies refused for accounts.google.com — the
  // login then cannot report back to the app).
  if (code === 'timeout') {
    if (isIOSStandalone()) return 'Google sign-in timed out — iOS home-screen apps often block the popup. Open DoTo in Safari to sign in, then return.';
    return 'Google sign-in timed out — finish the Google window, allow popups for this site and third-party cookies for accounts.google.com, then try again.';
  }
  if (code === 'popup_failed' || code === 'popup_closed') {
    if (isIOSStandalone()) return 'Popup blocked — open DoTo in Safari to sign in (iOS home-screen apps block Google popups).';
    return 'Popup blocked — allow popups for this site and try again.';
  }
  return code
    ? 'Google sign-in failed (' + code + '). Allow popups for this site and try again.'
    : 'Sign-in failed — try again.';
}
async function syncNowFlow() {
  if (!googleClientId()) { openAccount(); return; }
  // Drive sign-in first (no forced calendar popup here — that caused double
  // popups). The calendar step below re-consents on its own when needed.
  if (!syncMeta.email || !tokenValid()) {
    try { await ensureToken('popup'); await fetchEmail(); }
    catch (e) {
      lastSyncError = signInErrorMsg(e);
      slog('error', lastSyncError);
      setSync('error'); paintSync();
      return;
    }
  }
  await pullNow('popup');
  await pushNow('popup');
  // ...then Calendar in popup mode so a missing scope actually shows the
  // consent window instead of failing silently in the background.
  try { await calendarReconcile('popup'); }
  catch {}
  paintSync();
}

function openAccount() {
  paintSync();
  const ni = $('#userNameInput');
  if (ni && document.activeElement !== ni) ni.value = state.userName || '';
  paintColorEditor();
  $('#accountScrim').classList.remove('hidden');
}
function colorLabelRow(c) {
  const row = document.createElement('div');
  row.className = 'color-row';
  const dot = document.createElement('span');
  dot.className = 'dot'; dot.style.background = c.hex;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.maxLength = 24; inp.dataset.color = c.id;
  inp.placeholder = c.name; inp.dir = 'auto';
  inp.value = (state.colorNames && state.colorNames[c.id]) || '';
  inp.setAttribute('aria-label', 'Name for ' + c.name + ' label');
  inp.oninput = () => {
    const v = inp.value.trim().slice(0, 24);
    if (v && v !== c.name) state.colorNames[c.id] = v;
    else delete state.colorNames[c.id];
    save(); renderNav(); renderCurrentView();
  };
  row.append(dot, inp);
  const del = document.createElement('button');
  del.className = 'icon-btn sm'; del.title = 'Delete label';
  del.setAttribute('aria-label', 'Delete label ' + c.name);
  del.innerHTML = '<span class="material-icons-outlined">close</span>';
  del.onclick = () => deleteColor(c.id);
  row.appendChild(del);
  return row;
}
function paintColorEditor() {
  const host = $('#colorNames');
  if (!host) return;
  host.innerHTML = '';
  COLORS.filter((c) => !(state.deletedColors || []).includes(c.id)).forEach((c) => host.appendChild(colorLabelRow(c)));
  (state.customColors || []).forEach((c) => host.appendChild(colorLabelRow(c)));
  const rs = $('#resetColorsBtn');
  if (rs) rs.classList.toggle('hidden', !(state.deletedColors || []).length);
}
function deleteColor(id) {
  const n = state.tasks.filter((t) => t.color === id).length;
  if (n) { toast(`Cannot delete — ${n} task${n === 1 ? '' : 's'} still use${n === 1 ? 's' : ''} this label. Change them first.`); return; }
  if (BUILTIN_COLOR_IDS.has(id)) {
    if (!state.deletedColors.includes(id)) state.deletedColors.push(id);
  } else {
    state.customColors = (state.customColors || []).filter((c) => c.id !== id);
  }
  if (state.colorNames) delete state.colorNames[id];
  if (state.filters.color === id) state.filters.color = '';
  if (ui.quick.color === id) ui.quick.color = undefined;
  save(); renderAll(); paintColorEditor();
  toast('Label deleted');
}
function resetColors() {
  state.deletedColors = [];
  save(); renderAll(); paintColorEditor();
  toast('Built-in labels restored');
}
function closeAccount() { $('#accountScrim').classList.add('hidden'); }
function bindSync() {
  if (location.protocol === 'file:') {
    const si = $('#signInBtn');
    if (si) { si.disabled = true; si.title = 'Google sign-in needs http(s), not a local file'; }
  }
  $('#syncPill').onclick = openAccount;
  $('#accountBtn').onclick = openAccount;
  $('#updateBtn').onclick = () => { forceUpdate().catch(() => forceReload()); };
  $('#accountClose').onclick = closeAccount;
  $('#accountScrim').onclick = (e) => { if (e.target === $('#accountScrim')) closeAccount(); };
  $('#signInBtn').onclick = async () => {
    const btn = $('#signInBtn');
    if (btn) { btn.disabled = true; btn.classList.add('busy'); }
    try {
      if (!googleClientId()) { setSync('setup'); paintSync(); try { toast('Set a Google client ID first'); } catch {} return; }
      if (isIOSStandalone()) {
        try { toast('Opening Google — if nothing happens, open DoTo in Safari to sign in'); } catch {}
      } else {
        try { toast('Opening Google…'); } catch {}
      }
      // needCal=true: a still-valid token without the calendar grant must
      // re-consent here (Sync now heals this via its calendar step; without it
      // sign-in silently reused the scoped-down token and calendar only failed
      // later in the background).
      try { await ensureToken('popup', true); }
      catch (e) {
        lastSyncError = signInErrorMsg(e);
        slog('error', lastSyncError);
        setSync('error'); paintSync();
        try { toast(lastSyncError); } catch {}
        return;
      }
      try { await fetchEmail(); } catch {} // email is display-only; never fail sign-in on it
      slog('info', 'Signed in' + (syncMeta.email ? ' as ' + syncMeta.email : ''));
      try { toast('Signed in — syncing…'); } catch {}
      await pullNow('popup');
      // Same calendar verification as Sync now, so reminders work immediately
      // instead of failing silently until the next Sync now.
      try { await calendarReconcile('popup'); }
      catch {}
      paintSync();
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('busy'); }
    }
  };
  $('#signOutBtn').onclick = () => {
    if (window.google && google.accounts && google.accounts.oauth2 && syncMeta.token) {
      try { google.accounts.oauth2.revoke(syncMeta.token.access_token, () => {}); } catch {}
    }
    syncMeta.token = null; syncMeta.email = '';
    syncMeta.fileId = ''; syncMeta.base = null;
    syncMeta.calGranted = false; lastCalError = '';
    saveSyncMeta(); setSync('signedout'); paintSync();
    slog('info', 'Signed out — this device keeps its own copy');
    toast('Signed out — this device keeps its own copy');
  };
  $('#syncNowBtn').onclick = () => {
    const b = $('#syncNowBtn'); if (b) { b.disabled = true; b.classList.add('busy'); }
    try { toast('Syncing…'); } catch {}
    syncNowFlow().catch((e) => {
      try { toast(signInErrorMsg(e) || 'Sync failed'); } catch {}
    }).finally(() => { if (b) { b.disabled = false; b.classList.remove('busy'); } });
  };
  $('#logOpenBtn').onclick = openLog;
  $('#logClose').onclick = closeLog;
  $('#logClear').onclick = () => { syncLog = []; saveSyncLog(); paintLog(); };
  $('#conflictAllMine').onclick = () => {
    [...document.querySelectorAll('#conflictList .conflict-pick')].forEach((p) => paintConflictPick(p, 'mine'));
  };
  $('#conflictAllTheirs').onclick = () => {
    [...document.querySelectorAll('#conflictList .conflict-pick')].forEach((p) => paintConflictPick(p, 'theirs'));
  };
  $('#conflictApply').onclick = () => applyConflicts();
  const cl = $('#conflictLater'); if (cl) cl.onclick = () => closeConflict();
  $('#conflictScrim').onclick = (e) => { if (e.target === $('#conflictScrim')) closeConflict(); };
  $('#diagCopy').onclick = async () => {
    toast(await copyText(diagLines() + '\n\n' + syncLog.slice(-20).map((e) => new Date(e.t).toLocaleString() + ' [' + e.kind + '] ' + e.msg).join('\n')) ? 'Diagnostics copied' : 'Copy failed');
  };
  $('#logScrim').onclick = (e) => { if (e.target === $('#logScrim')) closeLog(); };
  $('#autoSyncToggle').onchange = (e) => {
    syncMeta.auto = e.target.checked; saveSyncMeta(); paintSync();
    if (syncMeta.auto) schedulePush();
  };
  $('#userNameInput').oninput = (e) => {
    state.userName = e.target.value.slice(0, 40);
    save(); renderCurrentView();
  };
  $('#customColorAdd').onclick = () => {
    const hex = ($('#customColorPick').value || '').toLowerCase();
    const name = $('#customColorName').value.trim().slice(0, 24);
    if (!/^#[0-9a-f]{6}$/.test(hex) || !name) { toast('Pick a label color and name first'); return; }
    if ((state.customColors || []).length >= 10) { toast('Label limit reached (10)'); return; }
    state.customColors.push({ id: 'c-' + uid(), name, hex });
    $('#customColorName').value = '';
    save(); renderAll(); paintColorEditor();
  };
  $('#resetColorsBtn').onclick = resetColors;
  window.addEventListener('online', () => { paintSync(); maybeRefreshToken().catch(() => {}); pullNow('silent').catch(() => {}); });
  window.addEventListener('offline', () => paintSync());
  window.addEventListener('focus', () => { maybeRefreshToken().catch(() => {}); pumpConflicts(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      maybeRefreshToken().catch(() => {});
      pumpConflicts();
      if (Date.now() - lastPullAt > 60000) pullNow('silent').catch(() => {});
    }
  });
  window.addEventListener('load', () => {
    if (syncMeta.email) setSync('checking');
    pullNow('silent').catch(() => {}).finally(() => {
      // one retry for flaky mobile networks (quiet if never signed in)
      setTimeout(() => {
        if (syncStatus === 'checking' || syncStatus === 'signedout') pullNow('silent').catch(() => {});
      }, 30000);
    });
    try {
      if (sessionStorage.getItem('doto-updated')) {
        sessionStorage.removeItem('doto-updated');
        slog('info', 'Updated — re-checking Drive sync');
        setTimeout(() => {
          if (syncMeta.email && !tokenValid()) setSync('signedout');
          paintSync();
        }, 1500);
      }
    } catch {}
  });
  bindPullToRefresh();
  bindEdgeSwipe();
  bindDetailSwipe();
  setInterval(() => { paintSync(); syncWatchdog(); }, 5000);
  setInterval(() => { maybeRefreshToken().catch(() => {}); }, 60000);
  paintSync();
}

/* Pull-to-refresh (touch): drag down from the very top of any page to force
   a Drive sync. Desktop unaffected (no touch drag). */
/* Sidebar drag (touch): drag right starting in the left half to slide it in
   WITH the finger; drag left anywhere while open to slide it out. Release
   past ~35% to settle. Starts right of the system back-gesture strip (x>20)
   and outside task drag handles and text fields, so nothing fights. Board
   view is included when its scroller sits at the left edge (nothing left to
   reveal) — otherwise the board keeps the gesture. Mobile drawer only. */
function bindEdgeSwipe() {
  let sx = null, sy = null, active = false, mode = null, sbW = 0, lastDx = 0, fadeT = 0, boardEl = null;
  const sb = () => $('#sidebar');
  const sc = () => $('#scrim');
  const overlays = () => ['paletteScrim', 'helpScrim', 'accountScrim', 'logScrim', 'modalScrim', 'conflictScrim']
    .some((id) => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); });
  const blocked = () => window.innerWidth >= 1024 || ui.detailId || overlays();
  const reset = () => { sx = sy = null; active = false; mode = null; lastDx = 0; boardEl = null; };
  const field = (t) => t && t.closest && t.closest('input,textarea,select,[contenteditable]');
  document.addEventListener('touchstart', (e) => {
    reset();
    clearTimeout(fadeT); // a new gesture wins over a pending scrim fade
    if (e.touches.length !== 1 || blocked() || field(e.target)) return;
    const t = e.touches[0], open = sb().classList.contains('open');
    if (!open) {
      if (t.clientX < 20) return; // system back-gesture strip
      if (t.target && t.target.closest && t.target.closest('.drag')) return;
      // Board view: a right-swipe on the board normally scrolls its columns.
      // But when the board is already at its left edge there is nothing left
      // to reveal — treat it like everywhere else and open the sidebar.
      const b = t.target && t.target.closest ? t.target.closest('#board') : null;
      if (b) {
        if (b.scrollLeft > 8) return; // scrolled right: let the board consume it
        boardEl = b;
      }
      mode = 'open';
    } else {
      mode = 'close';
    }
    sx = t.clientX; sy = t.clientY; sbW = sb().offsetWidth || 300;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (sx === null) return;
    // board drifted right mid-gesture (e.g. momentum): hand it back to the board
    if (boardEl && boardEl.scrollLeft > 8) { reset(); return; }
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (!active) {
      if (mode === 'open' && (dx < -12 || Math.abs(dy) > Math.abs(dx) * 1.4)) { reset(); return; }
      if (mode === 'close' && (dx > 12 || Math.abs(dy) > Math.abs(dx) * 1.4)) { reset(); return; }
      if (Math.abs(dx) < 24) return;
      active = true;
      sb().style.transition = 'none';
      sc().style.transition = 'none';
      sc().classList.remove('hidden');
    }
    // swallow the board's overscroll stretch while the drawer follows the finger
    if (boardEl && mode === 'open') { try { e.preventDefault(); } catch {} }
    if (mode === 'open') {
      lastDx = Math.min(Math.max(dx, 0), sbW);
      sb().style.transform = `translateX(${-sbW + lastDx}px)`;
      // 0 → 1 so the finger position matches the settled scrim (its bg already carries the .35 alpha)
      sc().style.opacity = String(lastDx / sbW);
    } else {
      lastDx = Math.max(Math.min(dx, 0), -sbW);
      sb().style.transform = `translateX(${lastDx}px)`;
      sc().style.opacity = String(1 + lastDx / sbW);
    }
  }, { passive: false }); // non-passive: board-edge opens call preventDefault to stop overscroll stretch
  const settle = () => {
    if (sx === null && !active) return;
    const wb = sb(), wc = sc();
    wb.style.transition = ''; wc.style.transition = '';
    if (!active) { // plain tap — restore defaults, no animation
      wb.style.transform = ''; wc.style.opacity = '';
      if (mode === 'open' && !wb.classList.contains('open') && !ui.detailId) wc.classList.add('hidden');
      reset();
      return;
    }
    clearTimeout(fadeT);
    if (mode === 'open' && lastDx > sbW * 0.35) {
      // finish opening: drawer glides home while the scrim fades the rest of the way in
      wc.classList.remove('hidden');
      wc.style.opacity = String(lastDx / sbW);
      void wc.offsetWidth; // pin the fade start to the finger position
      wb.style.transform = '';
      openSidebar();
      wc.style.opacity = '1';
      fadeT = setTimeout(() => { if (wb.classList.contains('open')) wc.style.opacity = ''; }, 250);
    } else if (mode === 'close' && lastDx <= -sbW * 0.35) {
      // finish closing: drawer slides shut while the scrim fades out with it
      wb.style.transform = '';
      wb.classList.remove('open');
      wc.style.opacity = String(1 + lastDx / sbW);
      void wc.offsetWidth;
      wc.style.opacity = '0';
      fadeT = setTimeout(() => {
        if (!wb.classList.contains('open') && !ui.detailId) wc.classList.add('hidden');
        wc.style.opacity = '';
      }, 250);
    } else if (mode === 'close') {
      // snap back open
      wb.style.transform = '';
      wc.style.opacity = String(1 + lastDx / sbW);
      void wc.offsetWidth;
      wc.style.opacity = '1';
      fadeT = setTimeout(() => { if (wb.classList.contains('open')) wc.style.opacity = ''; }, 250);
    } else {
      // open cancelled below threshold: slide back shut, fade the scrim out
      wb.style.transform = '';
      wc.style.opacity = String(lastDx / sbW);
      void wc.offsetWidth;
      wc.style.opacity = '0';
      fadeT = setTimeout(() => {
        if (!wb.classList.contains('open') && !ui.detailId) wc.classList.add('hidden');
        wc.style.opacity = '';
      }, 250);
    }
    reset();
  };
  document.addEventListener('touchend', settle);
  document.addEventListener('touchcancel', () => {
    clearTimeout(fadeT);
    sb().style.transition = ''; sb().style.transform = '';
    sc().style.transition = ''; sc().style.opacity = '';
    if (!sb().classList.contains('open')) sc().classList.add('hidden');
    reset();
  });
}
/* Detail sheet drag (touch): slide down to close the bottom sheet. Only the
   downward direction is claimed, and only while the sheet's own scroller sits
   at the very top — otherwise the gesture belongs to content scrolling.
   Starts in text fields are ignored so typing never dismisses. Mobile only. */
function bindDetailSwipe() {
  let sx = null, sy = null, active = false, lastDy = 0;
  const panel = () => $('#detail');
  const body = () => panel().querySelector('.detail-body');
  const reset = () => { sx = sy = null; active = false; lastDy = 0; };
  const field = (t) => t && t.closest && t.closest('input,textarea,select,[contenteditable]');
  const eligible = (t) => window.innerWidth < 1024 && ui.detailId && !panel().classList.contains('hidden')
    && t && !field(t) && t.closest && t.closest('#detail');
  document.addEventListener('touchstart', (e) => {
    reset();
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (!eligible(e.target)) return;
    sx = t.clientX; sy = t.clientY;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (sx === null) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (!active) {
      if (dy < -10 || Math.abs(dx) > Math.abs(dy) * 1.4) { reset(); return; } // content scroll / horizontal
      if (dy < 24) return;
      const b = body();
      if (b && b.scrollTop > 0) { reset(); return; } // scrolled content owns the gesture
      active = true;
      panel().style.transition = 'none';
    }
    if (active) {
      lastDy = Math.max(dy, 0);
      panel().style.transform = `translateY(${lastDy}px)`;
      try { e.preventDefault(); } catch {} // don't rubber-band the content mid-drag
    }
  }, { passive: false });
  const settle = () => {
    if (sx === null && !active) return;
    const d = panel();
    if (!active) { reset(); return; }
    if (lastDy > 120) {
      // fling shut: glide off the bottom edge, then unmount
      d.style.transition = 'transform .18s ease';
      d.style.transform = 'translateY(100%)';
      const done = ui.detailId;
      setTimeout(() => {
        if (ui.detailId === done) closeDetail();
        d.style.transition = ''; d.style.transform = '';
      }, 190);
    } else {
      // snap back open
      d.style.transition = 'transform .18s ease';
      d.style.transform = '';
      setTimeout(() => { d.style.transition = ''; }, 200);
    }
    reset();
  };
  document.addEventListener('touchend', settle);
  document.addEventListener('touchcancel', () => {
    panel().style.transition = ''; panel().style.transform = '';
    reset();
  });
}
function bindPullToRefresh() {  const ptr = document.createElement('div');
  ptr.id = 'ptrSync'; ptr.className = 'ptr-sync hidden';
  ptr.innerHTML = '<span class="material-icons-outlined">sync</span><span>Pull to sync</span>';
  document.body.appendChild(ptr);
  const label = () => ptr.querySelector('span:last-child');
  let start = null, ready = false;
  const reset = () => { start = null; ready = false; ptr.classList.add('hidden'); };
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || window.scrollY > 0) return;
    const t = e.target;
    if (t && t.closest && t.closest('#sidebar,#detail,.modal-scrim,.menu,#sortMenu,#listMenu,.toast,#board,.board-col-body,.cal-side,#timeTaskList,.board-col')) return;
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!start) return;
    if (window.scrollY > 0) { reset(); return; }
    const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
    if (dy < 24 || Math.abs(dx) > dy) { if (dy < 0) reset(); return; }
    ptr.classList.remove('hidden');
    ready = dy > 84;
    ptr.classList.toggle('ready', ready);
    label().textContent = ready ? 'Release to sync' : 'Pull to sync';
  }, { passive: true });
  const end = () => {
    if (!start) return;
    const go = ready;
    reset();
    if (go) {
      label().textContent = 'Syncing…';
      ptr.classList.remove('hidden');
      ptr.classList.add('ready');
      setTimeout(() => ptr.classList.add('hidden'), 30000); // backstop if auth hangs
      syncNowFlow().catch(() => {}).finally(() => ptr.classList.add('hidden'));
    }
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', reset);
}

const THEME_KEY = 'doto-theme';
function prefersDark() { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
function explicitTheme() { // 'dark' | 'light' | null (null = follow the OS)
  try {
    const v = localStorage.getItem(THEME_KEY);
    return (v === 'dark' || v === 'light') ? v : null;
  } catch { return null; }
}
function setTheme(dark, persist) {
  document.body.classList.toggle('dark', !!dark);
  const t = $('#darkModeToggle');
  if (t && document.activeElement !== t) t.checked = !!dark;
  // 'auto' = follow the OS. Only an explicit toggle stores dark/light;
  // every other path (startup, OS change, other tabs) keeps auto.
  try { localStorage.setItem(THEME_KEY, persist ? (dark ? 'dark' : 'light') : 'auto'); } catch {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#131314' : '#ffffff');
  const apple = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (apple) apple.setAttribute('content', dark ? 'black' : 'default');
}
function applySystemTheme() {
  // explicit pick wins; otherwise track the OS live
  if (explicitTheme()) setTheme(explicitTheme() === 'dark');
  else setTheme(prefersDark(), false);
}
let systemThemeWatch = null;
function watchSystemTheme() {
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (!explicitTheme()) setTheme(prefersDark(), false);
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
  systemThemeWatch = mq;
}
function toggleTheme() { setTheme(!document.body.classList.contains('dark'), true); }

function bind() {
  $('#menuBtn').onclick = () => {
    if (window.innerWidth >= 1024) document.body.classList.toggle('side-collapsed');
    else ($('#sidebar').classList.contains('open') ? closeSidebar() : openSidebar());
  };
  $('#scrim').onclick = () => { closeSidebar(); if (window.innerWidth < 1024) closeDetail(); };
  // click outside the detail panel dismisses it (desktop has no scrim to catch it)
  document.addEventListener('click', (e) => {
    if (!ui.detailId) return;
    const t = e.target;
    if (t && t.closest && t.closest('#detail,.task,.cal-chip,.cal-more,.cal-num,.menu,.modal-scrim,.toast')) return;
    closeDetail();
  });
  const goHomeBrand = () => { $('#searchInput').value = ''; save(); go(HOME); };
  $('#brandHome').onclick = goHomeBrand;
  $('#brandHome').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHomeBrand(); } };
  $('#navHome').onclick = () => { markNotifSeen(); go(HOME); };
  $('#navAll').onclick = () => go(ALL);
  $('#navCal').onclick = () => go(CAL);
  $('#navTime').onclick = () => go(TIME);
  $('#timeSearch').oninput = (e) => { ui.timeQuery = e.target.value; renderTime(); };
  $('#timePlay').onclick = timePlay;
  $('#timePause').onclick = timePause;
  $('#timeStop').onclick = timeStop;
  if (state.timer && state.timer.running) armTick();
  setInterval(paintHomeClock, 500); paintHomeClock();
  const shiftCalMonth = (n) => {
    if ((ui.calView || 'month') === 'year') { ui.calYear = (ui.calYear || new Date().getFullYear()) + n; ui.calAnim = n < 0 ? 'prev' : 'next'; renderAll(); return; }
    const [Y, M] = calMonth().split('-').map(Number);
    const d = new Date(Y, M - 1 + n, 1);
    ui.calCursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    ui.calAnim = n < 0 ? 'prev' : 'next';
    renderAll();
  };
  $('#calPrev').onclick = () => shiftCalMonth(-1);
  $('#calNext').onclick = () => shiftCalMonth(1);
  $('#calTodayBtn').onclick = () => {
    const d = new Date();
    if ((ui.calView || 'month') === 'year') { ui.calYear = d.getFullYear(); ui.calDay = todayIso(); }
    else {
      const cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (cur !== calMonth()) ui.calAnim = 'out';
      ui.calCursor = cur; ui.calDay = todayIso();
    }
    renderAll();
  };
  $$('#calViewSeg button').forEach((b) => b.onclick = () => {
    const to = b.dataset.v;
    if (to !== (ui.calView || 'month')) ui.calAnim = to === 'year' ? 'out' : 'in';
    ui.calView = to; renderAll();
  });
  $('#calAddForm').onsubmit = (e) => {
    e.preventDefault();
    const inp = $('#calAddInput'); if (!inp.value.trim()) return;
    const lid = (state.lists.some((l) => l.id === state.lastListId) && state.lastListId) || (fallbackList() || {}).id;
    if (!lid) { toast('Create a list first'); return; }
    addTaskTo(lid, inp.value, { date: calDaySel() }, true); inp.value = '';
  };
  $('#homeAddBtn').onclick = () => {
    const f = state.lists.find((l) => l.id === state.lastListId) || fallbackList();
    if (f) go(f.id); setTimeout(() => $('#addInput') && $('#addInput').focus(), 80);
  };
  $('#homeBoardBtn').onclick = () => go(ALL);
  $('#homeCalBtn').onclick = () => go(CAL);
  $('#homeTimeBtn').onclick = () => go(TIME);
  $('#quoteRefresh').onclick = refreshQuote;

  $('#createListBtn').onclick = createList;
  $('#renameListBtn').onclick = () => { $('#listMenu').classList.add('hidden'); renameList(state.activeView); };
  $('#deleteListBtn').onclick = () => { $('#listMenu').classList.add('hidden'); deleteList(state.activeView); };
  $('#deleteCompletedBtn').onclick = () => {
    $('#listMenu').classList.add('hidden');
    const id = state.activeView;
    const rm = state.tasks.filter((t) => t.listId === id && t.done);
    if (!rm.length) return toast('No completed tasks');
    state.tasks = state.tasks.filter((t) => !(t.listId === id && t.done));
    save(); renderAll();
    toast(`${rm.length} completed deleted`, () => { state.tasks.push(...rm); save(); renderAll(); });
  };
  $('#listMenuBtn').onclick = (e) => { e.stopPropagation(); $('#listMenu').classList.toggle('hidden'); $('#sortMenu').classList.add('hidden'); };
  $('#sortBtn').onclick = (e) => {
    e.stopPropagation(); paintSortMenu();
    const menu = $('#sortMenu');
    menu.classList.toggle('hidden');
    $('#listMenu').classList.add('hidden');
    $('#sortBtn').setAttribute('aria-expanded', String(!menu.classList.contains('hidden')));
  };
  $$('#sortMenu button').forEach((b) => b.onclick = () => { setSort(b.dataset.sort); $('#sortMenu').classList.add('hidden'); toast('Sorted: ' + b.textContent.trim()); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#sortMenu') && !e.target.closest('#sortBtn')) {
      $('#sortMenu').classList.add('hidden');
      const sb = $('#sortBtn'); if (sb) sb.setAttribute('aria-expanded', 'false');
    }
    if (!e.target.closest('#listMenu') && !e.target.closest('#listMenuBtn')) $('#listMenu').classList.add('hidden');
    if (!e.target.closest('#colorPop')) closeColorPop();
    if (!e.target.closest('#weightPop')) closeWeightPop();
    if (!e.target.closest('#importancePop')) closeImportancePop();
    if (!e.target.closest('#movePop')) closeMovePop();
  });

  try {
    applySystemTheme(); // follows the OS unless an explicit pick is stored
  } catch { setTheme(false); }
  watchSystemTheme();
  $('#darkModeToggle').onchange = (e) => setTheme(e.target.checked, true);

  // import / export (now inside the Sync & Settings dialog)
  $('#exportBtn2').onclick = exportJSON;
  const pick = () => $('#importFile').click();
  $('#importBtn2').onclick = pick;
  $('#importFile').onchange = (e) => { if (e.target.files.length) importFiles([...e.target.files], ($('#importMode') || {}).value || 'auto'); e.target.value = ''; };

  // search (onsearch covers the native × clear button of type=search)
  const s = $('#searchInput');
  const onSearchInput = () => {
    $('#clearSearch').classList.toggle('hidden', !s.value);
    // searching from Home jumps straight to Board results
    if (s.value.trim() && isHome()) { ui.searchFromHome = true; state.activeView = ALL; save(); }
    renderAll();
  };
  s.oninput = onSearchInput;
  s.onsearch = onSearchInput;
  $('#clearSearch').onclick = () => {
    s.value = ''; $('#clearSearch').classList.add('hidden');
    if (ui.searchFromHome) { ui.searchFromHome = false; go(HOME); return; }
    renderAll();
  };

  // filters (buttons are rendered in renderNav; clear lives here)
  $('#clearFilters').onclick = () => { state.filters = { color: '', weight: '', importance: '' }; s.value = ''; save(); renderAll(); };
  $('#showCompletedToggle').onchange = (e) => { state.showCompleted = e.target.checked; save(); renderAll(); };

  // add task (single list view) — options + save always visible
  const form = $('#addForm'), inp = $('#addInput');
  // quick composer: due date + weight + importance presets, persistent
  // across adds for rapid entry (toggle again to clear)
  const qaDate = $('#qaDate');
  const tomIso = () => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const markQaSeg = (id, val) => $$(`#${id} button`).forEach((x) => x.classList.toggle('active', x.dataset.v === val));
  qaDate.onchange = () => {
    ui.quick.date = qaDate.value || undefined;
    $$('#quickAddMeta [data-qa]').forEach((x) => x.classList.remove('active'));
  };
  $$('#quickAddMeta [data-qa]').forEach((b) => b.onclick = () => {
    const iso = b.dataset.qa === 'today' ? todayIso() : tomIso();
    if (ui.quick.date === iso) { ui.quick.date = undefined; qaDate.value = ''; b.classList.remove('active'); }
    else { ui.quick.date = iso; qaDate.value = iso; $$('#quickAddMeta [data-qa]').forEach((x) => x.classList.toggle('active', x === b)); }
  });
  const segInit = (id, key) => {
    markQaSeg(id, ui.quick[key]);
    $$(`#${id} button`).forEach((b) => b.onclick = () => {
      ui.quick[key] = ui.quick[key] === b.dataset.v ? undefined : b.dataset.v;
      markQaSeg(id, ui.quick[key]);
    });
  };
  segInit('qaWeight', 'weight');
  segInit('qaImportance', 'importance');
  renderQuickColors();
  form.onsubmit = (e) => {
    e.preventDefault();
    const t = addTask(inp.value, {
      date: ui.quick.date || '',
      importance: ui.quick.importance || 'medium',
      weight: ui.quick.weight || 'medium',
      color: ui.quick.color || 'default',
    }, true);
    if (t) { inp.value = ''; paintQuickMeta(); inp.focus(); } // presets persist
  };
  inp.addEventListener('input', paintQuickMeta);
  // completed collapse
  $('#completedToggle').onclick = () => { ui.completedOpen = !ui.completedOpen; renderAll(); };

  // detail bindings
  $('#detailBack').onclick = closeDetail; $('#detailClose').onclick = closeDetail;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const dialogOpen = ['paletteScrim', 'helpScrim', 'accountScrim', 'logScrim', 'modalScrim', 'conflictScrim']
      .some((id) => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); });
    closePalette(); closeHelp(); closeAccount(); closeLog(); closeConflict();
    closeColorPop(); closeMovePop(); closeWeightPop(); closeImportancePop();
    if (!dialogOpen) { closeDetail(); closeSidebar(); }
  });
  $('#dTitle').oninput = (e) => { const t = getTask(ui.detailId); if (t) { t.title = e.target.value.slice(0, 200); save(); renderAll(); } };
  $('#dList').onchange = (e) => { if (ui.detailId) moveTask(ui.detailId, e.target.value); };
  $('#dDate').onchange = (e) => { const t = getTask(ui.detailId); if (t) { t.date = e.target.value; if (!t.date) t.time = ''; stampDue(t); save(); renderAll(); if (calConnected() && typeof t.remindBefore === 'number') { clearTimeout(calSyncTimer); calendarReconcile('silent').catch(() => {}); } } };
  $('#dTime').onchange = (e) => { const t = getTask(ui.detailId); if (t) { t.time = e.target.value; if (t.time && !t.date) t.date = todayIso(); stampDue(t); save(); renderAll(); if (calConnected() && typeof t.remindBefore === 'number') { clearTimeout(calSyncTimer); calendarReconcile('silent').catch(() => {}); } } };
  $('#dRemindBefore').onchange = (e) => {
    const t = getTask(ui.detailId); if (!t) return;
    t.remindBefore = e.target.value === '' ? '' : +e.target.value;
    if (typeof t.remindBefore === 'number' && !REMIND_OFFSETS.includes(t.remindBefore)) t.remindBefore = '';
    if (t.remindBefore === '') dropCalEvent(t); // reconcile creates/updates otherwise
    save(); renderAll();
    if (calConnected() && typeof t.remindBefore === 'number') {
      clearTimeout(calSyncTimer);
      calendarReconcile('silent').catch(() => {});
    }
  };
  $('#dClearDate').onclick = () => { const t = getTask(ui.detailId); if (t) { t.date = ''; t.time = ''; t.dueUtc = 0; save(); renderAll(); } };
  $('#dExt').oninput = (e) => {
    const t = getTask(ui.detailId); if (!t) return;
    t.extRef = e.target.value.slice(0, 500); save();
    const open = $('#dExtOpen');
    if (isUrl(t.extRef)) { open.href = t.extRef; open.classList.remove('hidden'); } else open.classList.add('hidden');
    renderAll();
  };
  $('#dNotes').oninput = (e) => { const t = getTask(ui.detailId); if (t) { t.notes = e.target.value; save(); renderAll(); } };
  $('#subForm').onsubmit = (e) => {
    e.preventDefault();
    const t = getTask(ui.detailId); const v = $('#subInput').value.trim(); if (!t || !v) return;
    t.subtasks.push({ id: uid(), title: v.slice(0, 150), done: false });
    $('#subInput').value = ''; save(); renderAll();
  };
  $('#detailDelete').onclick = () => { if (ui.detailId) deleteTask(ui.detailId); };
  $('#dDoneToggle').onclick = () => { if (ui.detailId) toggleDone(ui.detailId); };
  // Everything already autosaves on input; Save just closes and forces a push.
  $('#dSaveBtn').onclick = () => {
    closeDetail();
    try { pushNow('popup').catch(() => {}); } catch {}
    try { scheduleCalendarSync(); } catch {}
  };

  // keyboard shortcuts + command palette
  bindShortcuts();

  // Google Drive sync
  bindSync();

  // resizers (desktop)
  makeResizable($('#sideResizer'), (ev) => {    state.prefs.sideW = Math.min(420, Math.max(220, ev.clientX));
    applySizes();
  });
  makeResizable($('#detailResizer'), (ev) => {
    state.prefs.detailW = Math.min(640, Math.max(320, window.innerWidth - ev.clientX));
    applySizes();
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 1024) { $('#scrim').classList.add('hidden'); $('#sidebar').classList.remove('open'); }
    else if (!ui.detailId && !$('#sidebar').classList.contains('open')) $('#scrim').classList.add('hidden');
  });
}

bind();
renderAll();

window.addEventListener('storage', (e) => {
  if (e.key === LS_KEY && e.newValue) {
    try {
      const incoming = JSON.parse(e.newValue);
      const ok = salvageState(incoming);
      if (!ok) return;
      state = migrate(ok);
      ui.sort = state.sort || 'order';
      if (state.timer && state.timer.running) armTick();
      renderAll();
    } catch {}
  }
  if (e.key === THEME_KEY) {
    // another tab changed the theme: explicit picks apply directly, otherwise
    // fall back to whatever this device's OS currently says
    if (e.newValue === 'dark' || e.newValue === 'light') setTheme(e.newValue === 'dark');
    else setTheme(prefersDark(), false);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const scrim = ['modalScrim', 'paletteScrim', 'accountScrim', 'conflictScrim', 'logScrim', 'helpScrim']
    .map((id) => document.getElementById(id)).find((el) => el && !el.classList.contains('hidden'));
  if (!scrim) return;
  const nodes = [...scrim.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// PWA: offline + installable (Chrome/Edge desktop & Android, iOS Add to Home)
if ('serviceWorker' in navigator) {
  const pokeSw = () => {
    navigator.serviceWorker.getRegistration()
      .then((reg) => { try { reg && reg.update(); } catch {} })
      .catch(() => {});
  };
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    pokeSw();
    checkForUpdate();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastUpdateCheck > 60000) {
      lastUpdateCheck = Date.now();
      pokeSw();
      checkForUpdate();
    }
  });
  window.addEventListener('online', () => checkForUpdate());
} else {
  window.addEventListener('load', () => checkForUpdate());
}
