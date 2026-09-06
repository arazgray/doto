/* DoTo — Task Manager, Simple. Vanilla JS Google-Tasks clone */
'use strict';

const LS_KEY = 'doto-v1';
const APP_VERSION = '1.0-1788686110'; // bump with ?v= stamps + version.json on every release
let lastUpdateCheck = 0, updateNotified = '';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

const COLORS = [
  { id: 'default', name: 'Gray', hex: '#9aa0a6' },
  { id: 'black', name: 'Black', hex: '#202124' },
  { id: 'red', name: 'Red', hex: '#d93025' },
  { id: 'orange', name: 'Orange', hex: '#e8710a' },
  { id: 'blue', name: 'Blue', hex: '#1a73e8' },
  { id: 'green', name: 'Green', hex: '#188038' },
  { id: 'purple', name: 'Purple', hex: '#9334e6' },
];
const colorHex = (id) => (COLORS.find((c) => c.id === id) || COLORS[0]).hex;
const colorName = (id) => (COLORS.find((c) => c.id === id) || COLORS[0]).name;

const WEIGHTS = { light: { label: 'Light', icon: 'arrow_downward' }, medium: { label: 'Medium', icon: 'remove' }, heavy: { label: 'Heavy', icon: 'arrow_upward' } };
const IMPORTANCE = { low: { label: 'Low', icon: 'arrow_downward' }, medium: { label: 'Med', icon: 'remove' }, high: { label: 'High', icon: 'arrow_upward' } };
const HOME = '__home__', ALL = '__all__', CAL = '__cal__', TIME = '__time__';

let state = migrate(load() || seed());
let ui = { completedOpen: false, boardDone: {}, sort: 'order', detailId: null, selectedId: null, dragId: null, dragListId: null, suppressClickUntil: 0, quick: {}, timeTaskId: null, timeQuery: '' };
// shared single-click timer: opening any popup cancels a pending details-open
// so the panel can never ambush a popup tap
let pendingDetailTimer = 0;

function seed() {
  const l1 = { id: uid(), name: 'General', createdAt: Date.now() };
  const today = new Date(); const iso = (d) => d.toISOString().slice(0, 10);
  return {
    lists: [l1],
    activeView: HOME,
    showCompleted: true,
    filters: { color: '', weight: '', importance: '' },
    prefs: { sideW: 280, detailW: 440 },
    times: [],
    timer: null,
    tasks: [
      {
        id: uid(), listId: l1.id, title: 'Example Task',
        notes: 'This is a sample task showing every field. Open its details, then delete it when ready.',
        date: iso(today), time: '09:00', extRef: 'https://example.com',
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
  if (!s.activeView) s.activeView = s.activeListId && s.lists.some((l) => l.id === s.activeListId) ? s.activeListId : HOME;
  delete s.activeListId;
  if (!s.prefs) s.prefs = { sideW: 280, detailW: 440 };
  // one-time fix: the old default (360px) was too narrow and clipped
  // Weight/Importance controls — widen it unless the user resized manually
  if (s.prefs.detailW === 360) s.prefs.detailW = 440;
  s.tasks.forEach((t) => { if (!t.weight) t.weight = 'medium'; if (!t.importance) t.importance = 'medium'; if (!t.color) t.color = 'default'; if (!Array.isArray(t.subtasks)) t.subtasks = []; if (!('recId' in t)) t.recId = ''; if (!('recur' in t)) t.recur = null; if (t.recur && !['daily', 'weekly', 'monthly', 'yearly'].includes(t.recur.freq)) t.recur = null; });
  // retired colors (yellow/teal/pink) map to their closest surviving color
  const legacyColor = { yellow: 'orange', teal: 'blue', pink: 'purple' };
  const validColors = new Set(COLORS.map((c) => c.id));
  s.tasks.forEach((t) => { if (legacyColor[t.color]) t.color = legacyColor[t.color]; else if (!validColors.has(t.color)) t.color = 'default'; });
  if (s.filters && s.filters.color && !validColors.has(s.filters.color)) s.filters.color = '';
  if (!Array.isArray(s.times)) s.times = [];
  if (typeof s.dirtyAt !== 'number') s.dirtyAt = 0;
  if (typeof s.userName !== 'string') s.userName = '';
  if (s.timer && (typeof s.timer !== 'object' || !s.timer.taskId)) s.timer = null;
  return s;
}
function validState(s) {
  return !!s && typeof s === 'object' && Array.isArray(s.lists) && Array.isArray(s.tasks)
    && s.lists.every((l) => l && typeof l.id === 'string' && typeof l.name === 'string')
    && s.tasks.every((t) => t && typeof t.id === 'string' && typeof t.listId === 'string' && typeof t.title === 'string');
}
function load() {
  let raw = null;
  try { raw = localStorage.getItem(LS_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (validState(s)) return s;
  } catch { /* fall through to recovery */ }
  // Corrupted save: stash it for forensics, then start fresh instead of dying.
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
function go(view) { state.activeView = view; save(); closeSidebar(); closeDetail(); renderAll(); window.scrollTo({ top: 0 }); }

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
   stale WebView (iOS has no hard-refresh) still notices a new release. */
async function checkForUpdate() {
  if (!navigator.onLine) return;
  try {
    const r = await fetch('version.json', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    if (j && j.version && j.version !== APP_VERSION && j.version !== updateNotified) {
      updateNotified = j.version;
      toast('New version available — reload to update', forceReload, 'Update');
    }
  } catch {}
}
function forceReload() {
  try {
    const u = new URL(location.href);
    u.searchParams.set('u', Date.now().toString(36)); // bust the cached shell
    location.href = u.toString();
  } catch { location.reload(); }
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
  { keys: ['Del'], desc: 'Delete selected task (undoable)' },
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
    { icon: 'add', label: 'New task', run: () => $('#fab').click() },
    { icon: 'playlist_add', label: 'New list', run: () => { if (window.innerWidth < 1024) openSidebar(); setTimeout(createList, 60); } },
    { icon: 'dark_mode', label: 'Toggle dark mode', run: () => $('#themeBtn').click() },
    { icon: 'visibility', label: 'Show / hide completed tasks', run: toggleShowCompleted },
    { icon: 'swap_vert', label: 'Sort by My order', run: () => { ui.sort = 'order'; renderAll(); } },
    { icon: 'event', label: 'Sort by Date', run: () => { ui.sort = 'date'; renderAll(); } },
    { icon: 'flag', label: 'Sort by Importance and weight', run: () => { ui.sort = 'priority'; renderAll(); } },
    { icon: 'sort_by_alpha', label: 'Sort by Title', run: () => { ui.sort = 'title'; renderAll(); } },
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
  $$('#paletteList .palette-item').forEach((li, i) => li.classList.toggle('selected', i === paletteIdx));
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
    if (e.key === 'Escape') { closePalette(); closeHelp(); closeAccount(); closeLog(); clearTimeout(pendingG); pendingG = 0; return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen() ? closePalette() : openPalette(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (typingNow() || paletteOpen() || helpOpen() || isLogOpen() || !$('#modalScrim').classList.contains('hidden') || !$('#accountScrim').classList.contains('hidden')) return;
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
    if (k === 'n' || k === 'N') { $('#fab').click(); return; }
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
    if (k === 'Delete' || k === 'Backspace') { const t = selectedTask(); if (t) { e.preventDefault(); ui.selectedId = null; deleteTask(t.id); } return; }
    if (k === 'u' || k === 'U') { toggleShowCompleted(); return; }
    if (k === 'd' || k === 'D') { $('#themeBtn').click(); return; }
  });
}

/* ---------- filtering / sorting ---------- */
function sortFn() {
  const impRank = { high: 0, medium: 1, low: 2 }, wRank = { heavy: 0, medium: 1, light: 2 };
  return {
    order: (a, b) => a.order - b.order || a.createdAt - b.createdAt,
    date: (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.order - b.order,
    title: (a, b) => a.title.localeCompare(b.title),
    priority: (a, b) => impRank[a.importance] - impRank[b.importance] || wRank[a.weight] - wRank[b.weight] || a.order - b.order,
  }[ui.sort] || ((a, b) => a.order - b.order);
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
  const openAll = state.tasks.filter((t) => !t.done).length;
  $('#allCount').textContent = openAll;
  $('#allCountPill').textContent = openAll ? `${openAll} open` : 'All done 🎉';
  const dueToday = state.tasks.filter((t) => !t.done && t.date === todayIso()).length;
  $('#calCount').textContent = dueToday || '';

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
  COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'f-dot' + (state.filters.color === c.id ? ' selected' : '');
    b.style.background = c.hex; b.title = c.name; b.setAttribute('aria-label', 'Filter by ' + c.name);
    b.onclick = () => { state.filters.color = state.filters.color === c.id ? '' : c.id; save(); renderAll(); };
    fc.appendChild(b);
  });
  const mkBtns = (host, obj, key) => {
    const h = $(host); h.innerHTML = '';
    Object.entries(obj).forEach(([v, m]) => {
      const b = document.createElement('button');
      b.className = 'f-btn' + (state.filters[key] === v ? ' selected' : '');
      b.innerHTML = `<span class="material-icons-outlined">${m.icon}</span><span></span>`;
      b.querySelector('span:last-child').textContent = m.label;
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
  state.tasks = state.tasks.filter((t) => t.listId !== id);
  state.lists = state.lists.filter((x) => x.id !== id);
  if (state.activeView === id) state.activeView = HOME;
  if (ui.detailId && removedTasks.some((t) => t.id === ui.detailId)) closeDetail();
  save(); renderAll();
  toast('List deleted', () => { state.lists.push(...removedLists); state.tasks.push(...removedTasks); save(); renderAll(); });
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
      const want = new Set(recur.days);
      for (let i = 1; i <= 7; i++) { const c = new Date(d); c.setDate(c.getDate() + i); if (want.has(c.getDay())) { d.setTime(c.getTime()); break; } }
    } else d.setDate(d.getDate() + 7 * n);
  }
  else if (recur.freq === 'monthly') addMonthsClamped(d, n);
  else if (recur.freq === 'yearly') { const day = d.getDate(); d.setDate(1); d.setFullYear(d.getFullYear() + n); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
  return isoOf(d);
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
function taskRow(t, opts = {}) {
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
  main.appendChild(title);
  function inlineRename() {
    const inp = document.createElement('input');
    inp.className = 'task-title'; inp.value = t.title; inp.maxLength = 200;
    inp.dir = 'auto'; inp.setAttribute('aria-label', 'Task title'); inp.draggable = false;
    let settled = false;
    const commit = (ok) => { if (settled) return; settled = true; if (ok) { t.title = inp.value.trim() || t.title; save(); } renderAll(); };
    inp.addEventListener('blur', () => commit(true));
    inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') commit(false); });
    ['click', 'dblclick', 'dragstart'].forEach((ev) => inp.addEventListener(ev, (e2) => e2.stopPropagation()));
    main.replaceChild(inp, title);
    inp.focus(); inp.select();
  }

  const meta = document.createElement('div'); meta.className = 'task-meta';
  if (opts.showList) {
    const tag = document.createElement('button'); tag.className = 'listname-tag'; tag.textContent = listName(t.listId); tag.title = 'Go to list';
    tag.onclick = (e) => { e.stopPropagation(); go(t.listId); };
    meta.appendChild(tag);
  }
  if (t.date) {
    const f = fmtDate(t.date);
    const b = document.createElement('span');
    b.className = 'badge date' + (f.diff < 0 && !t.done ? ' overdue' : f.diff === 0 ? ' today' : '');
    b.innerHTML = '<span class="material-icons-outlined">event</span>';
    const s = document.createElement('span'); s.textContent = f.label + (t.time ? ' ' + t.time : ''); b.appendChild(s);
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
  const w = document.createElement('span'); w.className = 'badge w-' + t.weight + ' clickable';
  w.innerHTML = `<span class="material-icons-outlined">${WEIGHTS[t.weight].icon}</span>${opts.compact ? WEIGHTS[t.weight].label[0] : WEIGHTS[t.weight].label}`;
  w.title = 'Change weight (now: ' + WEIGHTS[t.weight].label + ')';
  w.onclick = (e) => { e.stopPropagation(); openWeightPop(w, t.id); };
  meta.appendChild(w);
  const im = document.createElement('span'); im.className = 'badge imp-' + t.importance + ' clickable';
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
  dot.className = 'color-dot-btn'; dot.style.background = colorHex(t.color); dot.title = 'Change color';
  dot.setAttribute('aria-label', 'Change color');
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
  if (from.done !== to.done) { moveTask(fromId, to.listId); return; }
  if (from.listId !== to.listId) { moveTask(fromId, to.listId, toId, offset); return; }
  // same list reorder
  const group = tasksFor(to.listId).filter((x) => x.done === to.done);
  const without = group.filter((x) => x.id !== from.id);
  let idx = without.findIndex((x) => x.id === to.id) + offset;
  without.splice(Math.max(0, idx), 0, from);
  without.forEach((x, i) => x.order = i);
  ui.sort = 'order'; save(); renderAll();
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
  ui.sort = 'order'; save(); renderAll();
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
function renderQuote() {
  const el = $('#quoteText'); if (!el) return;
  el.textContent = '“' + QUOTES[Math.floor(Date.now() / 864e5) % QUOTES.length] + '”';
}
let weatherCache = null;
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
  if (weatherCache) { paintWeather(...weatherCache); return; }
  const LOC_KEY = 'doto-loc', LOC_TTL = 7 * 864e5; // re-resolve at most weekly
  const readStored = () => {
    try {
      const o = JSON.parse(localStorage.getItem(LOC_KEY));
      if (o && typeof o.lat === 'number' && typeof o.lon === 'number' && Date.now() - (o.ts || 0) < LOC_TTL) return o;
    } catch {}
    return null;
  };
  const store = (lat, lon) => { try { localStorage.setItem(LOC_KEY, JSON.stringify({ lat, lon, ts: Date.now() })); } catch {} };
  let lat, lon;
  const stored = readStored();
  if (stored) { lat = stored.lat; lon = stored.lon; }
  else {
    if (!navigator.geolocation) return;
    const pos = await new Promise((res) => navigator.geolocation.getCurrentPosition(res, () => res(null), { timeout: 8000, maximumAge: 600000 }));
    if (pos) { lat = pos.coords.latitude; lon = pos.coords.longitude; store(lat, lon); }
    else {
      try {
        const ip = await (await fetch('https://ipapi.co/json/')).json();
        if (!ip || ip.latitude === undefined) return;
        lat = ip.latitude; lon = ip.longitude; store(lat, lon);
      } catch { return; }
    }
  }
  try {
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,weathercode&forecast_days=2&timezone=auto`)).json();
    if (!w || !w.current) return;
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
  } catch {}
}

function statCard(label, n, icon, color, fn) {
  const d = document.createElement('div'); d.className = 'stat clickable';
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
  const overdue = open.filter((x) => x.date && x.date < t).sort(sortFn());
  const today = open.filter((x) => x.date === t).sort(sortFn());
  const impRank = { high: 0, medium: 1, low: 2 }, wRank = { heavy: 0, medium: 1, light: 2 };
  const important = [...open].sort((a, b) => impRank[a.importance] - impRank[b.importance] || wRank[a.weight] - wRank[b.weight] || (a.date || '9999').localeCompare(b.date || '9999')).slice(0, 8);
  const heavy = open.filter((x) => x.weight === 'heavy').sort(sortFn()).slice(0, 8);
  const doneCount = state.tasks.filter((x) => x.done).length;

  $('#homeDate').textContent = 'Today is ' + new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const h = new Date().getHours();
  const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  const nm = (state.userName || '').trim();
  $('#homeGreet').textContent = nm ? `Good ${part}, ${nm} 👋` : `Good ${part} 👋`;
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
  $('#taskCount').textContent = open.length ? `${open.length} open` : 'All done 🎉';
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
  $$('#calViewSeg button').forEach((b) => b.classList.toggle('selected', (ui.calView || 'month') === b.dataset.v));
  const gridAnim = ui.calAnim; ui.calAnim = null;
  const yw = $('#calYearGrid'), wrap = $('.cal-wrap');
  if ((ui.calView || 'month') === 'year') { yw.classList.remove('hidden'); wrap.classList.add('hidden'); renderYear(gridAnim); return; }
  yw.classList.add('hidden'); wrap.classList.remove('hidden');
  const [Y, M] = calMonth().split('-').map(Number);
  const first = new Date(Y, M - 1, 1);
  // Monday-first grid
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(Y, M, 0).getDate();
  const tIso = todayIso(), sel = calDaySel();
  $('#calTitle').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const dow = $('#calDow'); dow.innerHTML = '';
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d) => {
    const s = document.createElement('span'); s.textContent = d; dow.appendChild(s);
  });
  const dated = allFiltered().filter((t) => t.date && (!t.done || state.showCompleted));
  const byDay = new Map();
  dated.forEach((t) => {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
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
      const t = getTask(ui.dragId); if (!t || t.date === iso) return;
      t.date = iso; save(); renderAll();
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
    const t = getTask(ui.dragId); if (!t || t.date === sel) return;
    t.date = sel; save(); renderAll();
    toast(`Moved to ${sel}`);
  };
}
function renderYear(gridAnim) {
  if (!ui.calYear) ui.calYear = new Date().getFullYear();
  const Y = ui.calYear, tIso = todayIso();
  $('#calTitle').textContent = Y;
  const busy = new Set(allFiltered().filter((t) => t.date && t.date.startsWith(Y + '-') && (!t.done || state.showCompleted)).map((t) => t.date));
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
      cells.push(`<span class="${busy.has(iso) ? 'has' : ''}${iso === tIso ? ' today' : ''}">${d}</span>`);
    }
    card.innerHTML = `<h3></h3><div class="cal-ym-grid">${cells.join('')}</div>`;
    card.querySelector('h3').textContent = name;
    card.setAttribute('aria-label', name + ' ' + Y);
    card.onclick = () => {
      ui.calCursor = `${Y}-${String(m).padStart(2, '0')}`;
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
  if (tm && !tm.running && tm.taskId !== id) { state.timer = null; } // discard paused other-task timer
  state.timer = { taskId: id, startedAt: Date.now(), acc: (state.timer && state.timer.acc) || 0, running: true };
  save(); renderAll();
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
  const dayHead = (label) => {
    const h = document.createElement('p'); h.className = 'rec-day'; h.textContent = label;
    ul.appendChild(h);
  };
  const todayRs = state.times.filter((r) => recDay(r) === todayIso()).slice(0, 30);
  const prevRs = state.times.filter((r) => recDay(r) !== todayIso()).slice(0, 30);
  if (todayRs.length) { dayHead('Today'); todayRs.forEach((r) => ul.appendChild(timeRecRow(r))); }
  if (prevRs.length) { dayHead('Previously'); prevRs.forEach((r) => ul.appendChild(timeRecRow(r))); }
  // middle: searchable tasks with totals
  const q = (ui.timeQuery || '').trim().toLowerCase();
  const tasks = state.tasks
    .filter((t) => !t.done)
    .filter((t) => !q || (t.title + ' ' + t.notes).toLowerCase().includes(q))
    .sort((a, b) => taskTime(b.id) - taskTime(a.id) || b.createdAt - a.createdAt)
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
function addTaskTo(listId, title, extra = {}, toTop = false) {
  title = (title || '').trim(); if (!title) return null;
  const t = { id: uid(), listId, title: title.slice(0, 200), notes: '', date: '', time: '', extRef: '', color: 'default', weight: 'medium', importance: 'medium', recur: null, done: false, completedAt: 0, order: nextOrder(listId, false), createdAt: Date.now(), subtasks: [], ...extra };
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
  let spawned = null;
  // Google-style repeat: completing an instance schedules the next one
  if (becomingDone && t.recur && t.recur.freq && t.date) {
    const nd = nextRecurDate(t.date, t.recur);
    if (nd && nd !== t.date) {
      spawned = {
        id: uid(), listId: t.listId, title: t.title, notes: t.notes, date: nd, time: t.time,
        extRef: t.extRef, color: t.color, weight: t.weight, importance: t.importance,
        recur: t.recur ? { freq: t.recur.freq, interval: t.recur.interval || 1, ...(Array.isArray(t.recur.days) ? { days: [...t.recur.days] } : {}) } : null,
        recId: t.recId || '', done: false, completedAt: 0, order: 1e9, createdAt: Date.now(),
        subtasks: t.subtasks.map((s) => ({ id: uid(), title: s.title, done: false })),
      };
      state.tasks.push(spawned);
    }
  }
  [true, false].forEach((d) => listTasks(t.listId).filter((x) => x.done === d).sort((a, b) => a.order - b.order).forEach((x, i) => x.order = i));
  save(); renderAll();
  if (spawned) { const f = fmtDate(spawned.date); toast(`Repeats — next: ${f ? f.label : spawned.date}`); }
  if (ui.detailId === id) renderDetail();
}
function deleteTask(id) {
  const i = state.tasks.findIndex((t) => t.id === id); if (i < 0) return;
  const [rm] = state.tasks.splice(i, 1);
  if (ui.detailId === id) closeDetail();
  save(); renderAll();
  toast('Task deleted', () => { state.tasks.push(rm); save(); renderAll(); });
}

/* ---------- detail panel ---------- */
function openDetail(id) {
  ui.detailId = id; renderDetail();
  $('#detail').classList.remove('hidden');
  if (window.innerWidth < 1024) $('#scrim').classList.remove('hidden');
  else if (isAll()) {
    // board keeps its scroll when the panel pushes in (feels like an overlay),
    // so slide the task's column into view — same leftward motion as list view
    const t = getTask(id);
    const col = t && document.querySelector(`.board-col[data-list-id="${t.listId}"]`);
    if (col) setTimeout(() => col.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }), 30);
  }
  setTimeout(() => $('#dTitle').focus(), 50);
}
function closeDetail() { ui.detailId = null; $('#detail').classList.add('hidden'); $('#scrim').classList.add('hidden'); }
function renderDetail() {
  const t = getTask(ui.detailId); if (!t) return closeDetail();
  $('#dTitle').value = t.title;
  $('#dDate').value = t.date || ''; $('#dTime').value = t.time || '';
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
    if (task.recur && !task.date) { task.date = todayIso(); $('#dDate').value = task.date; }
    save(); renderTasks(); renderDetail();
  }

  const pal = $('#dColors'); pal.innerHTML = '';
  COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'swatch' + (t.color === c.id ? ' selected' : '');
    b.style.background = c.hex; b.title = c.name; b.setAttribute('aria-label', c.name);
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
  COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'swatch'; b.style.background = c.hex; b.title = c.name;
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
function openSidebar() { $('#sidebar').classList.add('open'); $('#scrim').classList.remove('hidden'); }
function closeSidebar() {
  if (window.innerWidth >= 1024) return;
  $('#sidebar').classList.remove('open');
  if (!ui.detailId) $('#scrim').classList.add('hidden');
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
  const payload = { app: 'DoTo', version: 2, exportedAt: new Date().toISOString(), lists: state.lists, tasks: state.tasks, times: state.times || [] };
  const d = new Date().toISOString().slice(0, 10);
  download(`doto-export-${d}.json`, JSON.stringify(payload, null, 2));
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
    recMap.set(r.id, { freq, interval: Math.max(1, Math.min(99, iv.interval_multiplier || 1)) });
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
        extRef: String(t.extRef || ''), color: t.color || 'default', weight: t.weight || 'medium', importance: t.importance || 'medium',
        recur: (t.recur && ['daily', 'weekly', 'monthly', 'yearly'].includes(t.recur.freq)) ? { freq: t.recur.freq, interval: Math.max(1, Math.min(99, t.recur.interval || 1)), ...(Array.isArray(t.recur.days) ? { days: t.recur.days.filter((x) => x >= 0 && x <= 6) } : {}) } : null,
        done: !!t.done, completedAt: t.completedAt || 0, order: typeof t.order === 'number' ? t.order : i,
        createdAt: t.createdAt || Date.now(), subtasks: Array.isArray(t.subtasks) ? t.subtasks.map((s) => ({ id: uid(), title: String(s.title || '').slice(0, 150), done: !!s.done })) : [],
      });
    });
    return { lists: parsed.lists.length, tasks: parsed.tasks.length, times: importTimes(parsed.times, taskIdMap) };
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
  let L = 0, T = 0, TM = 0; const errors = [];
  for (const f of files) {
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      const r = detectAndImport(parsed, f.name, mode);
      L += r.lists; T += r.tasks; TM += r.times || 0;
    } catch (err) { errors.push(`${f.name}: ${err.message}`); }
  }
  if (!fallbackList()) state.lists.push({ id: uid(), name: 'General', createdAt: Date.now() });
  if (state.activeView !== HOME && state.activeView !== ALL && !state.lists.some((l) => l.id === state.activeView)) state.activeView = HOME;
  save(); renderAll();
  if (T || L) toast(`Imported ${T} tasks into ${L} list${L === 1 ? '' : 's'}` + (TM ? ` + ${TM} time records` : ''));
  if (errors.length) toast('Import issue: ' + errors[0]);
}

/* ---------- events ---------- */
function renderAll() {
  applySizes(); renderNav(); renderCurrentView(); if (ui.detailId) renderDetail();
  if (ui.selectedId && !getTask(ui.selectedId)) ui.selectedId = null;
  paintSelection(false);
}

/* ---------- Google Drive sync (Account & Sync, no backend) ----------
   Local-first: this device always works offline. When signed in, changes
   push to Drive's hidden app folder (debounced) and pull on launch,
   focus and reconnect. Merge is per-item, three-way against the last
   synced snapshot; both-sides-edited items resolve newest-wins. */
const GOOGLE_CLIENT_ID = '555553216011-6bsgaeq6mp075agej6paup0bn3r1t2cl.apps.googleusercontent.com'; // app-owned; per-browser override in the Account dialog
const DRIVE_FILE = 'doto-state.json';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email';
const SYNC_KEY = 'doto-sync';
const CLIENT_KEY = 'doto-google-client-id';

function googleClientId() {
  try { return localStorage.getItem(CLIENT_KEY) || GOOGLE_CLIENT_ID; } catch { return GOOGLE_CLIENT_ID; }
}
function loadSyncMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(SYNC_KEY));
    if (m && typeof m === 'object') return { fileId: '', base: null, lastSyncedAt: 0, auto: true, email: '', token: null, ...m };
  } catch {}
  return { fileId: '', base: null, lastSyncedAt: 0, auto: true, email: '', token: null };
}
let syncMeta = loadSyncMeta();
let syncStatus = 'signedout'; // setup|signedout|syncing|ok|error
let lastSyncError = '';
function saveSyncMeta() { try { localStorage.setItem(SYNC_KEY, JSON.stringify(syncMeta)); } catch {} }
function setSync(s) { syncStatus = s; if (s === 'ok') lastSyncError = ''; paintSync(); }
function friendlySyncError(e) {
  const m = (e && e.message) || '';
  if (m === 'forbidden') return 'Drive refused access (403). Enable the Drive API for your Cloud project and grant access when asked.' + (e.detail ? ' Google says: ' + e.detail : '');
  if (m === 'net') return 'Could not reach Google — check connection or ad-blocker.';
  if (m.indexOf('drive') === 0) return 'Drive request failed (' + m + ').';
  return 'Sync failed — retry.';
}
function handleSyncFailure(e, mode, prev) {
  const m = (e && e.message) || '';
  if (m === 'auth' || m === 'setup') { setSync('signedout'); return; }
  if (mode === 'silent') { syncStatus = prev; paintSync(); return; } // background stays quiet
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
function paintLog() {
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
  if (syncStatus === 'syncing') return ['Syncing…', 'busy'];
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
    const show = syncStatus === 'error' && !!lastSyncError;
    ae.classList.toggle('hidden', !show);
    if (show) ae.textContent = lastSyncError;
  }
  const si = $('#signInBtn'), so = $('#signOutBtn');
  if (si) si.classList.toggle('hidden', !!syncMeta.email);
  if (so) so.classList.toggle('hidden', !syncMeta.email);
  const at = $('#autoSyncToggle');
  if (at && document.activeElement !== at) at.checked = !!syncMeta.auto;
}

/* ----- Google auth (GIS token flow, client-side only) ----- */
let gisReady = null, tokenClient = null, tokenClientId = '';
function gisLoad() {
  if (gisReady) return gisReady;
  gisReady = new Promise((res, rej) => {
    if (window.google && google.accounts && google.accounts.oauth2) return res();
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client';
    sc.async = true; sc.defer = true;
    sc.onload = () => res();
    sc.onerror = () => rej(new Error('net'));
    document.head.appendChild(sc);
  });
  return gisReady;
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
async function ensureToken(mode) {
  if (tokenValid()) return syncMeta.token.access_token;
  await gisLoad();
  const cid = googleClientId();
  if (!cid) throw new Error('setup');
  if (!tokenClient || tokenClientId !== cid) {
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: cid, scope: DRIVE_SCOPE, callback: () => {} });
    tokenClientId = cid;
  }
  // Explicit sign-in: ONE consent popup (a silent-first attempt would burn the
  // click's popup permission and flash a window that auto-closes).
  // Background: 'none' never shows UI.
  const tok = mode === 'popup' ? await gisAttempt(tokenClient, 'consent', 180000) : await gisAttempt(tokenClient, 'none', 10000);
  if (!tok || !tok.access_token) {
    const code = (tok && (tok.error || tok.error_subtype)) || 'no_token';
    const desc = tok && tok.error_description ? ' — ' + tok.error_description : '';
    if (mode !== 'silent') slog('error', 'Google sign-in failed: ' + code + desc);
    const err = new Error('auth');
    err.gis = String(code);
    throw err;
  }
  syncMeta.token = { access_token: tok.access_token, expires_at: Date.now() + (tok.expires_in || 3600) * 1000 };
  saveSyncMeta();
  fetchEmail().catch(() => {});
  return syncMeta.token.access_token;
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
  const at = await ensureToken(mode);
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + at } });
  // Only 401 means the token died. 403 (API disabled, scope denied, …) must
  // NOT wipe the token — otherwise every retry re-opens the sign-in popup.
  if (r.status === 401) { syncMeta.token = null; saveSyncMeta(); throw new Error('auth'); }
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
  const r = await driveOk(await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=appDataFolder&fields=files(id,modifiedTime)`, {}, mode));
  const j = await r.json();
  return (j.files && j.files[0]) || null;
}
async function driveDownload(id, mode) {
  const r = await driveOk(await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {}, mode));
  return r.json();
}
async function driveUpload(data, mode) {
  const body = JSON.stringify(data);
  if (syncMeta.fileId) {
    const r = await driveOk(await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${syncMeta.fileId}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    }, mode));
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
  return JSON.parse(JSON.stringify({ lists: s.lists || [], tasks: s.tasks || [], times: s.times || [], timer: s.timer || null }));
}
const recEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function mergeArrays(base, local, remote, takeRemote) {
  const bi = new Map(base.map((x) => [x.id, x]));
  const li = new Map(local.map((x) => [x.id, x]));
  const ri = new Map(remote.map((x) => [x.id, x]));
  const out = [];
  let conflicts = 0, fromRemote = 0;
  new Set([...bi.keys(), ...li.keys(), ...ri.keys()]).forEach((id) => {
    const b = bi.get(id), l = li.get(id), r = ri.get(id);
    if (!b) { // created on one side (ids are unique, both-sides-create is a no-op tie)
      if (l && r && !recEq(l, r)) conflicts++;
      out.push(l || r);
      if (r && !l) fromRemote++;
      return;
    }
    const dl = !l || !recEq(l, b); // deleted counts as changed
    const dr = !r || !recEq(r, b);
    if (!dl && !dr) { out.push(l); return; }
    if (dl && !dr) { if (l) out.push(l); return; } // kept local edit / local delete wins
    if (!dl && dr) { if (r) { out.push(r); fromRemote++; } return; } // remote edit / remote delete wins
    conflicts++; // edited on both sides: newest file wins
    if (l && r) { if (takeRemote) { out.push(r); fromRemote++; } else out.push(l); }
    else if (r) { out.push(r); fromRemote++; }
    else if (l) out.push(l);
  });
  return { arr: out, conflicts, fromRemote };
}
function applyRemote(remote, remoteTime) {
  if (!remote || !Array.isArray(remote.tasks) || !Array.isArray(remote.lists)) throw new Error('drive');
  const base = (syncMeta.base && Array.isArray(syncMeta.base.tasks)) ? syncMeta.base : { lists: [], tasks: [], times: [], timer: null };
  const takeRemote = remoteTime >= (state.dirtyAt || 0);
  const ml = mergeArrays(base.lists || [], state.lists, remote.lists || [], takeRemote);
  const mt = mergeArrays(base.tasks || [], state.tasks, remote.tasks || [], takeRemote);
  const mm = mergeArrays(base.times || [], state.times || [], remote.times || [], takeRemote);
  let timer = state.timer, tConflict = 0;
  const bt = base.timer || null, rt = remote.timer || null;
  if (!recEq(timer, bt) && !recEq(rt, bt) && takeRemote) { timer = rt; tConflict = 1; }
  else if (recEq(timer, bt)) timer = rt;
  state.lists = ml.arr; state.tasks = mt.arr; state.times = mm.arr; state.timer = timer;
  const conflicts = ml.conflicts + mt.conflicts + mm.conflicts + tConflict;
  const fresh = ml.fromRemote + mt.fromRemote + mm.fromRemote;
  save(); renderAll();
  syncMeta.base = snapState(state);
  syncMeta.lastSyncedAt = Date.now();
  saveSyncMeta();
  return { conflicts, fresh };
}

let syncing = false, lastPullAt = 0, pushTimer = 0;
function schedulePush() {
  if (!syncMeta.auto) return;
  if (!syncMeta.email && !syncMeta.token) return; // never signed in: stay quiet
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushNow('silent').catch(() => {}); }, 8000);
}
async function pushNow(mode) {
  if (syncing || !navigator.onLine || !googleClientId()) return;
  if (!syncMeta.auto && mode === 'silent') return;
  if (!syncMeta.email && !syncMeta.token) return;
  syncing = true; setSync('syncing');
  try {
    await driveUpload(state, mode);
    syncMeta.base = snapState(state);
    syncMeta.lastSyncedAt = Date.now();
    saveSyncMeta();
    if (mode !== 'silent') slog('ok', `Pushed to Drive (${state.tasks.length} tasks, ${state.lists.length} lists)`);
    setSync('ok');
  } catch (e) {
    handleSyncFailure(e, mode, syncMeta.lastSyncedAt ? 'ok' : 'signedout');
  } finally { syncing = false; paintSync(); }
}
async function pullNow(mode) {
  if (syncing || !navigator.onLine || !googleClientId()) return;
  if (!syncMeta.email && !syncMeta.token) return; // never signed in: stay quiet
  const prev = syncStatus;
  syncing = true; lastPullAt = Date.now(); setSync('syncing');
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
        // converge the other side immediately when local had its own changes
        const merged = snapState(state);
        const rsnap = { lists: remote.lists || [], tasks: remote.tasks || [], times: remote.times || [], timer: remote.timer || null };
        if (!recEq(merged, rsnap)) await driveUpload(state, mode);
        syncMeta.lastSyncedAt = Date.now();
        saveSyncMeta();
        if (res.conflicts) toast(`Sync: ${res.conflicts} conflict${res.conflicts === 1 ? '' : 's'} — kept newest`);
        else if (res.fresh) toast(`Sync: ${res.fresh} change${res.fresh === 1 ? '' : 's'} from Drive`);
        if (mode !== 'silent' || res.conflicts || res.fresh) {
          if (res.conflicts) slog('conflict', `Pulled with ${res.conflicts} conflict${res.conflicts === 1 ? '' : 's'} — kept newest`);
          else if (res.fresh) slog('ok', `Pulled ${res.fresh} change${res.fresh === 1 ? '' : 's'} from Drive`);
          else slog('ok', 'Pulled — already up to date');
        }
      } else {
        syncMeta.base = snapState(state);
        syncMeta.lastSyncedAt = Date.now();
        saveSyncMeta();
      }
    }
    setSync('ok');
  } catch (e) {
    handleSyncFailure(e, mode, prev);
  } finally { syncing = false; paintSync(); }
}
async function syncNowFlow() {
  if (!googleClientId()) { openAccount(); return; }
  if (!syncMeta.email && !tokenValid()) {
    try { await ensureToken('popup'); await fetchEmail(); }
    catch (e) {
      lastSyncError = e && e.gis
        ? 'Google sign-in failed (' + e.gis + '). Allow popups for this site and try again.'
        : 'Sign-in failed — try again.';
      slog('error', lastSyncError);
      setSync('error'); paintSync();
      return;
    }
  }
  await pullNow('popup');
}

function openAccount() { paintSync(); const ni = $('#userNameInput'); if (ni && document.activeElement !== ni) ni.value = state.userName || ''; $('#accountScrim').classList.remove('hidden'); }
function closeAccount() { $('#accountScrim').classList.add('hidden'); }
function bindSync() {
  $('#syncPill').onclick = openAccount;
  $('#accountBtn').onclick = openAccount;
  $('#accountClose').onclick = closeAccount;
  $('#accountScrim').onclick = (e) => { if (e.target === $('#accountScrim')) closeAccount(); };
  $('#signInBtn').onclick = async () => {
    if (!googleClientId()) { setSync('setup'); paintSync(); return; }
    try { await ensureToken('popup'); }
    catch (e) {
      lastSyncError = e && e.gis
        ? 'Google sign-in failed (' + e.gis + '). Allow popups for this site and try again.'
        : 'Sign-in failed — try again.';
      slog('error', lastSyncError);
      setSync('error'); paintSync();
      return;
    }
    try { await fetchEmail(); } catch {} // email is display-only; never fail sign-in on it
    slog('info', 'Signed in' + (syncMeta.email ? ' as ' + syncMeta.email : ''));
    await pullNow('popup');
  };
  $('#signOutBtn').onclick = () => {
    if (window.google && google.accounts && google.accounts.oauth2 && syncMeta.token) {
      try { google.accounts.oauth2.revoke(syncMeta.token.access_token, () => {}); } catch {}
    }
    syncMeta.token = null; syncMeta.email = '';
    saveSyncMeta(); setSync('signedout'); paintSync();
    slog('info', 'Signed out — this device keeps its own copy');
    toast('Signed out — this device keeps its own copy');
  };
  $('#syncNowBtn').onclick = () => { syncNowFlow().catch(() => {}); };
  $('#logOpenBtn').onclick = openLog;
  $('#logClose').onclick = closeLog;
  $('#logClear').onclick = () => { syncLog = []; saveSyncLog(); paintLog(); };
  $('#logScrim').onclick = (e) => { if (e.target === $('#logScrim')) closeLog(); };
  $('#autoSyncToggle').onchange = (e) => {
    syncMeta.auto = e.target.checked; saveSyncMeta(); paintSync();
    if (syncMeta.auto) schedulePush();
  };
  $('#userNameInput').oninput = (e) => {
    state.userName = e.target.value.slice(0, 40);
    save(); renderCurrentView();
  };
  window.addEventListener('online', () => { paintSync(); pullNow('silent').catch(() => {}); });
  window.addEventListener('offline', () => paintSync());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastPullAt > 60000) pullNow('silent').catch(() => {});
  });
  window.addEventListener('load', () => { pullNow('silent').catch(() => {}); });
  setInterval(paintSync, 5000);
  paintSync();
}

function bind() {
  $('#menuBtn').onclick = () => {
    if (window.innerWidth >= 1024) document.body.classList.toggle('side-collapsed');
    else ($('#sidebar').classList.contains('open') ? closeSidebar() : openSidebar());
  };
  $('#scrim').onclick = () => { closeSidebar(); if (window.innerWidth < 1024) closeDetail(); };
  $('#brandHome').onclick = () => { $('#searchInput').value = ''; save(); go(HOME); };
  $('#navHome').onclick = () => go(HOME);
  $('#navAll').onclick = () => go(ALL);
  $('#navCal').onclick = () => go(CAL);
  $('#navTime').onclick = () => go(TIME);
  $('#timeSearch').oninput = (e) => { ui.timeQuery = e.target.value; renderTime(); };
  $('#timePlay').onclick = timePlay;
  $('#timePause').onclick = timePause;
  $('#timeStop').onclick = timeStop;
  setInterval(tickTime, 100);
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
    if ((ui.calView || 'month') === 'year') ui.calYear = d.getFullYear();
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
    const lid = (fallbackList() || {}).id; if (!lid) { toast('Create a list first'); return; }
    addTaskTo(lid, inp.value, { date: calDaySel() }, true); inp.value = '';
  };
  $('#homeAddBtn').onclick = () => { const f = fallbackList(); if (f) go(f.id); setTimeout(() => $('#addInput') && $('#addInput').focus(), 80); };
  $('#homeBoardBtn').onclick = () => go(ALL);
  $('#homeCalBtn').onclick = () => go(CAL);
  $('#homeTimeBtn').onclick = () => go(TIME);

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
  $('#sortBtn').onclick = (e) => { e.stopPropagation(); $('#sortMenu').classList.toggle('hidden'); $('#listMenu').classList.add('hidden'); };
  $$('#sortMenu button').forEach((b) => b.onclick = () => { ui.sort = b.dataset.sort; $('#sortMenu').classList.add('hidden'); renderAll(); toast('Sorted: ' + b.textContent.trim()); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#sortMenu') && !e.target.closest('#sortBtn')) $('#sortMenu').classList.add('hidden');
    if (!e.target.closest('#listMenu') && !e.target.closest('#listMenuBtn')) $('#listMenu').classList.add('hidden');
    if (!e.target.closest('#colorPop')) closeColorPop();
    if (!e.target.closest('#weightPop')) closeWeightPop();
    if (!e.target.closest('#importancePop')) closeImportancePop();
    if (!e.target.closest('#movePop')) closeMovePop();
  });

  function setTheme(dark) {
    document.body.classList.toggle('dark', !!dark);
    const btn = $('#themeBtn');
    btn.classList.toggle('active', !!dark);
    btn.querySelector('.material-icons-outlined').textContent = dark ? 'light_mode' : 'dark_mode';
    btn.title = dark ? 'Light mode' : 'Dark mode';
    btn.setAttribute('aria-pressed', String(!!dark));
    try { localStorage.setItem('doto-theme', dark ? 'dark' : 'light'); } catch {}
  }
  $('#themeBtn').onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); setTheme(!document.body.classList.contains('dark')); };
  try { setTheme(localStorage.getItem('doto-theme') === 'dark'); } catch { setTheme(false); }

  // import / export (sidebar buttons; navbar keeps sort + theme only)
  $('#exportBtn2').onclick = exportJSON;
  const pick = () => $('#importFile').click();
  $('#importBtn2').onclick = pick;
  $('#importFile').onchange = (e) => { if (e.target.files.length) importFiles([...e.target.files], ($('#importMode') || {}).value || 'auto'); e.target.value = ''; };

  // search (onsearch covers the native × clear button of type=search)
  const s = $('#searchInput');
  const onSearchInput = () => {
    $('#clearSearch').classList.toggle('hidden', !s.value);
    // searching from Home jumps straight to Board results
    if (s.value.trim() && isHome()) { state.activeView = ALL; save(); }
    renderAll();
  };
  s.oninput = onSearchInput;
  s.onsearch = onSearchInput;
  $('#clearSearch').onclick = () => { s.value = ''; $('#clearSearch').classList.add('hidden'); renderAll(); };

  // filters (buttons are rendered in renderNav; clear lives here)
  $('#clearFilters').onclick = () => { state.filters = { color: '', weight: '', importance: '' }; s.value = ''; save(); renderAll(); };
  $('#showCompletedToggle').onchange = (e) => { state.showCompleted = e.target.checked; save(); renderAll(); };

  // add task (single list view) — options + save always visible
  const form = $('#addForm'), inp = $('#addInput');
  // quick composer: due date + weight + importance presets, persistent
  // across adds for rapid entry (toggle again to clear)
  const qaDate = $('#qaDate');
  const tomIso = () => { const d = new Date(Date.now() + 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
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
  const qaC = $('#qaColors');
  COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'f-dot'; b.style.background = c.hex;
    b.title = c.name; b.setAttribute('aria-label', 'Color ' + c.name);
    b.onclick = () => {
      ui.quick.color = ui.quick.color === c.id ? undefined : c.id;
      $$('#qaColors .f-dot').forEach((x) => x.classList.toggle('selected', x === b && !!ui.quick.color));
    };
    qaC.appendChild(b);
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    const t = addTask(inp.value, {
      date: ui.quick.date || '',
      importance: ui.quick.importance || 'medium',
      weight: ui.quick.weight || 'medium',
      color: ui.quick.color || 'default',
    }, true);
    if (t) { inp.value = ''; inp.focus(); } // presets persist
  };
  $('#fab').onclick = () => {
    if (isHome()) { const f = fallbackList(); if (f) go(f.id); }
    else if (isAll()) { const first = $('#board input'); if (first) first.focus(); }
    else if (isCal()) { const ci = $('#calAddInput'); if (ci) { ci.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => ci.focus(), 250); } return; }
    else if (isTime()) { const ts = $('#timeSearch'); if (ts) { ts.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => ts.focus(), 250); } return; }
    window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => $('#addInput') && $('#addInput').focus(), 250);
  };

  // completed collapse
  $('#completedToggle').onclick = () => { ui.completedOpen = !ui.completedOpen; renderAll(); };

  // detail bindings
  $('#detailBack').onclick = closeDetail; $('#detailClose').onclick = closeDetail;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDetail(); closeSidebar(); closeAccount(); closeLog(); closeColorPop(); closeMovePop(); closeWeightPop(); closeImportancePop(); } });
  $('#dTitle').oninput = (e) => { const t = getTask(ui.detailId); if (t) { t.title = e.target.value.slice(0, 200); save(); renderNav(); renderCurrentView(); } };
  $('#dList').onchange = (e) => { if (ui.detailId) moveTask(ui.detailId, e.target.value); };
  $('#dDate').onchange = (e) => { const t = getTask(ui.detailId); if (t) { t.date = e.target.value; save(); renderAll(); } };
  $('#dTime').onchange = (e) => { const t = getTask(ui.detailId); if (t) { t.time = e.target.value; save(); renderAll(); } };
  $('#dClearDate').onclick = () => { const t = getTask(ui.detailId); if (t) { t.date = ''; t.time = ''; save(); renderAll(); } };
  $('#dExt').oninput = (e) => {
    const t = getTask(ui.detailId); if (!t) return;
    t.extRef = e.target.value.slice(0, 500); save();
    const open = $('#dExtOpen');
    if (isUrl(t.extRef)) { open.href = t.extRef; open.classList.remove('hidden'); } else open.classList.add('hidden');
    renderNav(); renderCurrentView();
  };
  $('#dNotes').oninput = (e) => { const t = getTask(ui.detailId); if (t) { t.notes = e.target.value; save(); renderNav(); renderCurrentView(); } };
  $('#subForm').onsubmit = (e) => {
    e.preventDefault();
    const t = getTask(ui.detailId); const v = $('#subInput').value.trim(); if (!t || !v) return;
    t.subtasks.push({ id: uid(), title: v.slice(0, 150), done: false });
    $('#subInput').value = ''; save(); renderAll();
  };
  $('#detailDelete').onclick = () => { if (ui.detailId) deleteTask(ui.detailId); };
  $('#dDoneToggle').onclick = () => { if (ui.detailId) toggleDone(ui.detailId); };

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

// One-time cleanup for recurring tasks imported before the recurrence
// dedupe existed: groups of 3+ same-titled, all-dated tasks in one list
// collapse to the nearest upcoming (else latest) instance, with undo.
(function dedupeLegacyRecurring() {
  if (state._recDeduped) return;
  state._recDeduped = true;
  const groups = new Map();
  state.tasks.forEach((t) => {
    const k = t.listId + '|' + (t.title || '').trim().toLowerCase() + '|' + (t.notes || '').trim().toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  });
  const today = todayIso();
  const removed = [];
  groups.forEach((g) => {
    if (g.length < 3 || !g.every((t) => t.date)) return;
    const sorted = [...g].sort((a, b) => a.date.localeCompare(b.date));
    const keep = sorted.find((t) => t.date >= today) || sorted[sorted.length - 1];
    g.forEach((t) => { if (t.id !== keep.id) removed.push(t); });
  });
  save();
  if (removed.length) {
    const ids = new Set(removed.map((t) => t.id));
    state.tasks = state.tasks.filter((t) => !ids.has(t.id));
    if (ui.detailId && ids.has(ui.detailId)) closeDetail();
    save(); renderAll();
    toast(`Removed ${removed.length} duplicate recurring tasks`, () => { state.tasks.push(...removed); save(); renderAll(); });
  }
})();

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
