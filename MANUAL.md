# DoTo Manual

> DoTo — Task Manager, Simple. A Google Tasks-style task manager that lives
> entirely in your browser. No account, no server, no build step.
>
> Live app: <https://arazgray.github.io/doto/>

## Contents

- [Getting started](#getting-started)
- [Sync and settings](#sync-and-settings)
- [Views](#views)
- [Tasks](#tasks)
- [Search, filters and sorting](#search-filters-and-sorting)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Command palette](#command-palette)
- [Time tracker](#time-tracker)
- [Import and export](#import-and-export)
- [Installing the app](#installing-the-app)
- [Data and privacy](#data-and-privacy)
- [FAQ](#faq)

## Getting started

1. Open <https://arazgray.github.io/doto/> in any modern browser.
2. You start with one list, **General**, holding a single **Example Task** with every field filled in — open it, then delete it when ready.
3. Click the menu button (top left) to open the sidebar, then **Create new list** for your own categories.
4. Type in the **Add a task** bar and press Enter. Done — that is 90% of the app.

Everything is saved automatically in your browser as you type.

## Sync and settings

By default your data lives only in this browser. **Sync & Settings** (blue
button at the bottom of the sidebar, or the status pill in the top bar)
connects your Google Drive for multi-device sync — still with no DoTo server:

1. Open Sync & Settings and press **Sign in with Google** (the app ships with
   its own client ID — no setup needed; only repo forks need their own),
   then **Sync now**.
2. From then on: changes upload automatically a few seconds after you make
   them, and the app pulls on launch, when the tab regains focus, and when
   you come back online.

How it works and what to expect:

- The synced copy is a single file in Drive's hidden app folder — only your
  Google account can see it.
- Merging is per item: edits made on one device at a time always merge
  cleanly. If the same task was edited on two devices between syncs, the
  newest version wins and the app tells you.
- Deletes sync too. The navbar pill shows `Not synced yet`, `Syncing…`,
  or `Synced Xs ago`.
- Signing out keeps a full copy on that device; signing back in merges it.
- Sync dialog → **History** shows a log of recent sync events (pushes, pulls, conflicts, errors).
- Import / Export live in the Sync dialog (same JSON backup as before).
- The dialog also holds **Display** settings (show completed, dark mode),
  **Color labels** (rename + custom colors), and your **name** (used in the
  Home greeting, synced across devices).

## Views

| View | What it is for |
| ---- | -------------- |
| **Home** | Greeting, stat cards (open / overdue / due today / completed / tracked today), today's weather, a daily quote, and sections: Overdue, Today's tasks, Most important first, Heavy lifting. |
| **List** | One category at a time: add bar with quick presets, open tasks, collapsible Completed section. |
| **Board** | Kanban columns — one per list. Drag tasks between columns, add per column, reorder columns by their grip. |
| **Calendar** | Month grid with task chips, a Year overview with busy dots, and a day agenda with its own add box. Drag a task onto a day to reschedule it. |
| **Time** | Stopwatch per task (play / pause / stop). The timer survives reloads. |

Switch views from the sidebar, or press `g` then `h` / `b` / `c` / `t`.

## Tasks

- **Create**: the add bar (or per-column / agenda boxes), the Home **New**
  button, the `n` key, or the command palette (`Ctrl+K`).
- **Complete**: the circle on the row, or select it and press `x`. Deleted or completed-by-mistake items can be undone from the toast popup.
- **Details**: click a row (or select + `Enter`) for notes, due date + time, repeat rules, color, weight, importance, external reference (URL or ticket number), list assignment and subtasks.
- **Rename inline**: double-click the title.
- **Color**: tap the color dot on the row. Colors carry your own labels, and
  you can add fully custom colors too (Sync & Settings → Color labels, e.g.
  red for Home, blue for Work, a new teal for Side projects). Custom colors
  and labels sync, export and import alongside everything else.
  **Weight / Importance**: tap the badges on the row.
- **Move**: drag onto another task, board column, sidebar list or the empty list area — or the move button on the row (desktop), or the List selector in details.
- **Repeat**: daily, weekly (optionally on chosen weekdays), monthly, yearly, or custom "every N days/weeks/months/years". Completing a dated repeating task schedules the next occurrence and resets its subtasks.
- **Subtasks**: in the details panel, with a `done/total` progress badge on the row.
  The first few subtasks also show under the task title everywhere — tap one to toggle it.

## Search, filters and sorting

- **Search** (`/`): matches titles, notes, references and subtasks across every view. Searching from Home jumps straight to Board results.
- **Filters**: color, weight and importance in the sidebar. Active filters show as removable chips on every view.
- **Sorting**: My order (manual drag order), Date, Importance & weight, Title — from the sort button in the top bar.

## Keyboard shortcuts

Shortcuts work when you are not typing in a field. Press `?` anywhere to see this list.

| Keys | Action |
| ---- | ------ |
| `Ctrl+K` (or `Cmd+K`) | Command palette |
| `/` | Focus search |
| `n` | New task |
| `j` / `k` | Select next / previous task |
| `Up` / `Down` | Move selection (once a task is selected) |
| `Enter` | Open selected task |
| `x` | Complete / reopen selected task |
| `Del` | Delete selected task (undoable) |
| `g` then `h` | Go to Home |
| `g` then `b` | Go to Board |
| `g` then `c` | Go to Calendar |
| `g` then `t` | Go to Time tracker |
| `g` then `1`–`9` | Jump to list by position |
| `u` | Show / hide completed tasks |
| `d` | Toggle dark mode |
| `?` | Shortcut help |
| `Esc` | Close panel / dialog |

## Command palette

Press `Ctrl+K` (or `Cmd+K` on Mac) — it works even while typing. Start typing to filter:

- **Commands**: jump to any view, new task / new list, sorting, theme, import / export, this manual.
- **Lists**: jump straight to a list.
- **Tasks**: jump straight to a task's details.

`Up`/`Down` + `Enter` to run, `Esc` to close.

## Time tracker

1. Pick a task from the searchable list (each shows its total tracked time).
   (On desktop, the timer button on a task row jumps here pre-selecting it.)
2. Press play. Pause holds the clock, stop saves a record.
3. Records group under Today / Previously and can be deleted (undoable).
   **Copy day** next to Today copies the whole day as text, e.g.
   `5h - Write report` per line.
4. The running timer keeps going across page reloads — the total on Home counts it live.

## Import and export

- **Export** (Sync dialog → Export): downloads `doto-export-YYYY-MM-DD.json` with lists, tasks and time records. Back these up — your data lives in this browser plus, if enabled, your Drive sync copy.
- **Import** (Sync dialog, multi-select): pick the source — **Auto-detect**,
  **DoTo backup**, or **Google Tasks** — then choose files. Accepts DoTo exports
  (appended as new lists) and Google Takeout Tasks exports (full backups, per-list files, or bare arrays). Starred Google tasks become high importance, links become external references, parents become subtasks, recurring series collapse to one repeating task.

## Installing the app

DoTo is installable (PWA) and works offline once installed:

- **Desktop Chrome / Edge**: install icon in the address bar, or menu → Save and share → Install.
- **Android Chrome**: menu → Install app / Add to Home screen.
- **iPhone / iPad**: Share → Add to Home Screen for a fullscreen icon on your home screen.

Installing requires the hosted `https://` address — it does not work from a downloaded `file://` copy.

## Data and privacy

- All data lives in your browser's `localStorage` (`doto-v1`): lists, tasks, time records, view, filters, color labels, your name and panel sizes. Sync metadata (`doto-sync`), sync history (`doto-sync-log`), theme (`doto-theme`) and weather location (`doto-loc`, 7-day cache) are stored separately. With Drive sync enabled, an additional copy lives in your Drive's hidden app folder.
- If a save ever fails validation (corrupted data), the app keeps a timestamped backup copy in your browser and starts fresh instead of breaking.
- The network requests the app itself makes: Google Fonts, Google Identity Services + Drive API (only when you use sync), and the Home weather card (Open-Meteo, BigDataCloud, ipapi.co for location fallback). Nothing else ever leaves your device.

## FAQ

**I lost my tasks after clearing browser data — can I get them back?**
Only from a JSON export or your Drive sync copy (re-sign-in re-pulls it). Export regularly.

**Does it sync between phone and desktop?**
Yes — via Sync & Settings (Google Drive). Sign in on each device and both stay merged.

**Can I share a list with someone?**
Not yet — export the JSON and send them the file; they can import it.

**Sync keeps asking me to sign in, or says "Sync failed".**
Most common cause: the Google Drive API is not enabled for your Cloud project
(Drive answers 403) — enable it under APIs & Services, then Sync now. Also
make sure you ticked the Drive checkbox on Google's consent screen and that
sign-in popups are not blocked. If the Google window opens and closes with
nothing happening, allow popups for this site and try again — the exact
reason is recorded under Sync → History.

**The weather card is empty.**
It needs location permission (or IP-based fallback) and internet. Everything else works offline.

**My phone shows an old version of the app.**
Open the app with internet — it checks for updates on launch and shows an
**Update** button when one is ready. To force it any time: sidebar bottom row
→ **Update** wipes the offline cache and reloads the newest version. If it
stays stuck (iOS has no hard-refresh), remove the home-screen icon and re-add it.

**Where do I report a bug or ask for a feature?**
Open an issue at <https://github.com/arazgray/doto/issues>.
