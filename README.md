# Qanban

A polished, React-powered terminal kanban board for managing a todo list without
leaving the terminal. Built with [Ink](https://github.com/vadimdemedes/ink) and
React 19, and packaged as a standalone Windows executable.

```text
  ◈ QANBAN  /  terminal kanban                                                          Sun, 1 Nov   7 open  ·  2 done
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  ╭──────────────────────────╮  ╭─────────────────────────╮  ╭──────────────────────────╮  ╭─────────────────────────╮
  │ ◇ NEW                 3  │  │ ◐ ACTIVE              2 │  │ ◑ IN PROGRESS         2  │  │ ✓ COMPLETED           2 │
  │ ▌ Refine shortcuts       │  │   Polish empty state    │  │   Build kanban keys      │  │   Sketch board layout   │
  │ ▌  #design #ux           │  │    #ux #polish          │  │    #engine #focus        │  │    #design              │
  │                          │  │                         │  │                          │  │                         │
  │   Write release notes    │  │   Collect feedback      │  │   Add tag colors         │  │   Set up Qanban         │
  │    #docs #release        │  │    #research            │  │    #design #colors       │  │    #setup               │
  │                          │  │                         │  │                          │  │                         │
  │   Try a compact view     │  │                         │  │                          │  │                         │
  │    #idea #design         │  │                         │  │                          │  │                         │
  ╰──────────────────────────╯  ╰─────────────────────────╯  ╰──────────────────────────╯  ╰─────────────────────────╯

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  · Ready. Press ? for shortcuts.                                                                          ● autosaved
  ←→ cols · ↑↓ tasks · a add · e edit · t tags · d delete · <> stage · [] reorder · ? help · q quit
```

## Run it

The standalone build is included at:

```text
release\Qanban.exe
```

Double-click it, or run it from Windows Terminal / PowerShell / cmd:

```powershell
.\release\Qanban.exe
```

The executable is self-contained — Node.js is **not** required. It targets
64-bit Windows and needs a terminal of at least **70 × 24**. Windows Terminal is
recommended. To explore a sample board without touching your data:

```powershell
.\release\Qanban.exe --demo
```

> The executable is not code-signed, so Windows SmartScreen may show a warning
> the first time it runs. Choose "More info → Run anyway" if you trust the binary.

## Features

- **Kanban columns** — New, Active, In Progress, and Completed.
- **Create tasks** with `a`; the new task appears in New and is selected.
- **Edit title and tags** with `e` / `Enter`, or jump straight to tags with `t`.
- **Tag tasks** with as many tags as you like; tags get deterministic colors.
  Separate tags with commas or spaces. A leading `#` is optional.
- **Reorder tasks** inside a column with `[` and `]`.
- **Move tasks** between stages with `<` / `>`, `Space`, or Shift + arrow keys.
- **Delete with confirmation** using `d` or the Delete key.
- **Autosave** after every change, with an atomic write to a local JSON file.
- **Responsive layout** — four columns on wide terminals, a tabbed single-column
  view on narrower ones.
- **Keyboard-first UI** with an in-app shortcut guide (`?`).

## Controls

| Key | Action |
| --- | --- |
| `←` / `→`, `Tab` | Switch columns |
| `1`–`4` | Jump directly to a column |
| `↑` / `↓` | Select a task |
| `Page Up` / `Page Down` | Jump five tasks |
| `a` | Add a task to New |
| `e` / `Enter` | Edit the selected task's title and tags |
| `t` | Edit the selected task's tags |
| `d` / `Delete` | Delete the selected task (asks for confirmation) |
| `<` / `>` | Move the task to the previous / next stage |
| `Space` | Advance the task to the next stage |
| `[` / `]` | Reorder the task up / down |
| `?` | Open or close the keyboard guide |
| `q` | Quit |
| `Esc` | Cancel an edit, close a dialog, or close the guide |

Inside an add/edit dialog: `Tab` or `↑↓` switches fields, `Enter` saves, and
`Esc` cancels. In the delete dialog: `y` / `Enter` confirms, `n` / `Esc` cancels.

## Where data is stored

Qanban saves automatically to:

```text
%APPDATA%\Qanban\board.json
```

The board is plain JSON, so it is easy to back up or inspect. If the file is
corrupt, Qanban moves it aside as `board.json.corrupt-<timestamp>` and starts a
fresh board. Missing or invalid task entries are skipped while valid entries are
kept.

Optional overrides:

| Environment variable | Purpose |
| --- | --- |
| `QANBAN_DATA_FILE` | Use a specific board JSON file |
| `QANBAN_DATA_DIR` | Use a specific data directory |
| `QANBAN_NO_ALT` | Set to `1` to draw inline instead of using the fullscreen buffer |

## Command-line options

```text
Qanban.exe [options]

  --demo        Open a sample board; nothing is saved
  --no-alt      Draw inline instead of using the fullscreen buffer
  --selftest    Verify the bundled UI and storage, then exit
  -v, --version Show the version
  -h, --help    Show help
```

`--selftest` is non-interactive and is useful for checking that the packaged
binary is healthy.

## Build from source

Requirements: Node.js 22+ and npm on Windows (the packaging tool targets a
Windows x64 Node runtime).

```powershell
npm install
npm run dev        # run the TypeScript source
npm test           # domain, storage, layout, and UI tests
npm run typecheck
npm run build      # typecheck + tests + bundle + Windows executable
```

The final binary is written to `release\Qanban.exe`. Other useful scripts:

```powershell
npm run bundle     # create dist/cli.mjs
npm run build:exe  # bundle and package the EXE
npm run preview    # print a static, uncolored demo board
```

### How it is built

- **React 19 + Ink 6** render the interactive terminal UI.
- **TypeScript** covers the board model, persistence, layout, and UI.
- **esbuild** bundles everything into a single ESM file.
- **@yao-pkg/pkg** embeds that bundle with a Node 24 runtime into a Windows x64
  executable.
- The fullscreen view uses the terminal's alternate screen buffer; `--no-alt`
  keeps the rendered UI in the normal scrollback instead.

## Project layout

```text
src/
  cli.tsx               entry point, options, terminal lifecycle
  App.tsx               board state, keyboard handling, dialogs
  board.ts              pure task/board operations
  store.ts              JSON persistence and validation
  layout.ts             responsive dimensions and card scrolling
  components/           header, board, cards, forms, help, footer
  hooks/                terminal-size tracking
test/                   Node test runner + ink-testing-library tests
scripts/                esbuild and pkg build scripts
release/Qanban.exe    standalone Windows build
```

Long titles are truncated in narrow columns; press `e` to view and edit the full
title. The app intentionally keeps one local board and does not require a network
connection or account.

## License

Apache License 2.0. See [LICENSE](LICENSE) for the full text.
