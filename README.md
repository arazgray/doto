# DoTo — Task Manager, Simple.

A Google Tasks-style task manager with superpowers. 100% vanilla HTML/CSS/JS —
no dependencies, no build step, no framework. Mobile-first and fully responsive,
with full touch + mouse parity.

**Live app: <https://arazgray.github.io/doto/>** 
**Manual: [MANUAL.md](MANUAL.md)** (also readable in-app via sidebar → Manual,
or on the [GitHub wiki](https://github.com/arazgray/doto/wiki)).

## Run it

Open `index.html` directly in a browser, or serve the folder:

```
python3 -m http.server
```

## Account & Sync (Google Drive, no backend)

Local-first + Drive merge: sign in from the blue **Account & Sync** button
(sidebar bottom) or the navbar status pill. Synced file lives in Drive's
hidden `appDataFolder`. Per-item three-way merge against the last synced
snapshot (`doto-sync` in localStorage); both-sides-edited items resolve
newest-wins with a toast. Auto-push (8s debounce) + pull on load, focus and
reconnect. Details in [MANUAL.md](MANUAL.md#account-and-sync).

Requires a Google OAuth client ID (Drive API enabled, origin
`https://arazgray.github.io`): paste it once in the Account dialog, or set
`GOOGLE_CLIENT_ID` in `app.js`.

## Install as app (PWA)
Served over HTTPS (e.g. `https://arazgray.github.io/doto/`) the app is
installable and works offline:

- **Desktop Chrome / Edge** — open the site, then *Install DoTo…* from the
  address bar (or ⋮ menu → *Save and share → Install*).
- **Android Chrome** — ⋮ menu → *Add to Home screen* / *Install app*.
- **iPhone / iPad** — Share → *Add to Home Screen* (uses the touch icon +
  standalone display; requires hosting over `http(s)`, not `file://`).

Installability is provided by `assets/manifest.webmanifest` + `sw.js` (offline app
shell). Plain `file://` usage still works, minus install/offline.

## Features

**Views**

- **Home** — greeting, stat cards (open / overdue / due today / completed /
  tracked today), live weather + daily quote, and sections: Overdue, Today's
  tasks, Most important first, Heavy lifting.
- **List** — a single category with an add bar, quick-add presets (due date,
  weight, importance, color), and a collapsible Completed section.
- **Board** — one column per list (kanban style): add tasks per column, drag
  tasks between columns, collapse completed per column, reorder columns.
- **Calendar** — Monday-first month grid with task chips, a Year view of 12
  mini-months, a selected-day agenda with its own add box, and drag a task
  onto a day to reschedule.
- **Time tracker** — searchable task picker with per-task totals, a stopwatch
  (play / pause / stop) that survives page reloads, and logged time records
  grouped by Today / Previously.

**Tasks**

- Colors (7), Weight (light / medium / heavy), Importance (low / medium / high)
  — all inline-editable from the row via popups, and filterable.
- Due date + time with overdue / today badges; recurrence (daily, weekly with
  weekday picker, monthly, yearly, or custom "every N") — completing a dated
  recurring task schedules the next occurrence, subtasks reset.
- Subtasks with progress badge, notes, and external reference (URL opens in a
  new tab; anything else — ticket #, file path — just shows as a badge).
- Inline rename (double-click title), details panel for everything else.
- Drag & drop everywhere: reorder tasks, move between lists (list view, board
  columns, sidebar), reorder lists. Mouse uses HTML5 DnD, touch uses the drag
  handle (long-press for lists).

**Everything else**

- Search + color/weight/importance filters apply across all views, with clear
  chips shown on every view. Sort by My order / Date / Importance & weight / Title.
- Light & dark theme (persisted).
- Resizable sidebar and details panel on desktop (persisted).
- Undo toasts for destructive actions (delete task/list, clear completed,
  time-record delete, duplicate cleanup).
- RTL-friendly: all user text uses `dir="auto"`.

## Keyboard shortcuts

Full map in [MANUAL.md](MANUAL.md#keyboard-shortcuts) (or press `?` in the
app). The highlights:

| Keys | Action |
| ---- | ------ |
| `Ctrl+K` / `Cmd+K` | Command palette (commands, lists, tasks) |
| `/` | Focus search |
| `n` | New task |
| `j` / `k`, `Enter`, `x`, `Del` | Select, open, complete, delete |
| `g` then `h` / `b` / `c` / `t` | Go Home / Board / Calendar / Time |
| `g` then `1`–`9` | Jump to list by position |
| `u`, `d`, `?`, `Esc` | Completed visibility, dark mode, help, close |

## Import / Export

- **Export** — sidebar → *Export JSON*: `doto-export-YYYY-MM-DD.json` including
  lists, tasks, and time records.
- **Import** — multi-select `.json`, accepts:
  - DoTo native exports (appended as new lists)
  - Google Takeout Tasks — full backup (`tasks#taskLists`), per-list files
    (`tasks#tasks`), or bare task arrays
  - Google mapping: title/notes, status→done, `scheduled_time`/`due`→date+time
    (read as-written, no timezone shift), `starred`→high importance,
    `links[0]`→external ref, `parent`→subtasks, and recurring instances are
    collapsed to a single task carrying the repeat rule.

## Data & persistence

Everything lives in `localStorage` — no server, no accounts:

- `doto-v1` — app state: `{ lists, tasks, activeView, showCompleted, filters, prefs, times, timer }`
- `doto-theme` — `'dark' | 'light'`
- `doto-loc` — weather coordinates (7-day TTL)

Task fields: `{ id, listId, title, notes, date, time, extRef, color, weight,
importance, recur, done, completedAt, order, createdAt, subtasks }`.

Privacy note: the Home weather card fetches from Open-Meteo / BigDataCloud /
ipapi.co; nothing else ever leaves the browser.

Corrupted saves are detected on load: the raw data is stashed under a
`doto-v1-corrupt-<timestamp>` key and the app starts fresh instead of breaking.

## Manual & wiki

- The user manual lives in [MANUAL.md](MANUAL.md) and is rendered in-app at
  [`manual.html`](https://arazgray.github.io/doto/manual.html) (sidebar →
  **Manual**).
- It is also published on the **[GitHub wiki](https://github.com/arazgray/doto/wiki)**.
  After editing `MANUAL.md`, re-publish with:
  ```
  cp MANUAL.md /tmp/doto.wiki/Home.md
  cd /tmp/doto.wiki && git add Home.md && git commit -m "Update manual" && git push
  ```
  (First-time setup: enable **Wikis** under
  <https://github.com/arazgray/doto/settings>, then
  `git clone git@github.com:arazgray/doto.wiki.git /tmp/doto.wiki`.)
  The sidebar Manual button points at the in-app page, which never 404s.

## Project layout

```
index.html   — shell: topbar, sidebar, 5 views, detail panel, popups, modal, toast
styles.css   — native nested CSS, CSS variables theming, dark mode via body.dark
app.js       — all logic (~1900 lines), vanilla JS
assets/manifest.webmanifest + sw.js + assets/icon-*.png — PWA install (Chrome/desktop/mobile, iOS Add to Home) + offline shell
MANUAL.md + manual.html — user manual (Markdown source + offline reader, linked from sidebar)
```

Conventions: no emojis in code, no `prompt()`/`confirm()` (in-app modal
instead), mobile-first CSS (breakpoints 700px / 1024px), plain asset filenames.

## License

MIT — see [LICENSE](LICENSE).
