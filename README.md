<p align="center">
  <img src="assets/icon.svg" width="120" alt="Qanban icon">
</p>

# Qanban

A polished, React-powered terminal kanban board for managing a todo list without
leaving the terminal. Built with [Ink](https://github.com/vadimdemedes/ink) and
React 19, and packaged as a standalone Windows executable.

```text
  ◈ QANBAN  /  terminal kanban                                                          Sun, 1 Nov   7 open  ·  2 done
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  ╭──────────────────────────╮  ╭─────────────────────────╮  ╭──────────────────────────╮  ╭─────────────────────────╮
  │ ◇ NEW                 3  │  │ ◐ ACTIVE              2 │  │ ◑ PAUSED              2  │  │ ✓ COMPLETED           2 │
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
  ←→ cols · ↑↓ tasks · a add · e edit · t tags · d delete · <> stage · [] reorder · ↵ focus · ? help · q quit
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

- **Kanban columns** — New, Active, Paused, and Completed by default. Rename,
  recolor, and change the glyph of any column in the config file.
- **Terminal handoff** — moving a task to Active launches your agent in a new
  tab or window; Paused keeps or closes it; Completed always closes it.
- **Focus from the board** — press `Enter` on an Active task to jump to its
  terminal. Tasks with a live session show a `● live` marker.
- **Create tasks** with `a`; the new task appears in New and is selected.
- **Edit title and tags** with `e`, or jump straight to tags with `t`.
- **Tag tasks** with as many tags as you like; tags get deterministic colors.
  Separate tags with commas or spaces. A leading `#` is optional.
- **Reorder tasks** inside a column with `[` and `]`.
- **Move tasks** between stages with `<` / `>`, `Space`, or Shift + arrow keys.
- **Delete with confirmation** using `d` or the Delete key.
- **Autosave** after every change, with an atomic write to a local JSON file.
  Terminal session handles are saved with the board.
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
| `e` | Edit the selected task's title and tags |
| `Enter` | Focus the terminal for an Active task, otherwise edit it |
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

## Terminal handoff

Moving a task from New to Active opens a new tab or window in the terminal
Qanban was launched from and runs the configured command (by default
`claude "{title}"`). The terminal handle is saved with the board, so the link
survives a restart.

- **Active → Paused** keeps the terminal open by default. Set
  `terminal.pauseBehavior` to `"close"` to close it instead.
- **Any → Completed** closes the terminal.
- Moving a task back to **New** closes its terminal, and deleting a task closes
  it too.
- **Enter on an Active task with a session** focuses the terminal. Tasks without
  a session fall back to the normal edit dialog.

Qanban detects the terminal it is running inside, in this order:

| Provider | Detected by | Launch | Focus | Close |
| --- | --- | --- | --- | --- |
| `herdr` | `HERDR_ENV`, `HERDR_PANE_ID` | `herdr tab create` + `pane run` | `tab focus` | `tab close` |
| `tmux` | `$TMUX` | `tmux new-window` | `select-window` | `kill-window` |
| `wezterm` | `$WEZTERM_PANE`, `$TERM_PROGRAM` | `wezterm cli spawn` | `activate-pane` | `kill-pane` |
| `wt` | `$WT_SESSION` | `wt new-tab` | `focus-tab` / UI Automation | wrapper PID |
| `process` | fallback | new OS terminal window | best effort | kill PID |
| `custom` | configured | your command | your command | your command |

On Windows Terminal, opening a task in a **new window** (`newWindow: true`)
gives the most reliable focus. Tab focus uses UI Automation, and closing kills
the wrapper process that runs the agent. The `process` fallback on Unix uses
`$TERMINAL` or `x-terminal-emulator`; focusing it requires `wmctrl`.

## Configuration

Qanban reads `config.json` next to the board file:

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\Qanban\config.json` |
| macOS | `~/Library/Application Support/Qanban/config.json` |
| Linux | `$XDG_CONFIG_HOME/qanban/config.json` or `~/.config/qanban/config.json` |

Override the location with `QANBAN_CONFIG_FILE`. A missing file uses the
defaults. Invalid values are ignored with a warning shown in the footer.

```json
{
  "columns": {
    "active": {
      "label": "DOING",
      "shortLabel": "DOING",
      "glyph": "▶",
      "color": "#22c55e"
    }
  },
  "terminal": {
    "provider": "auto",
    "command": ["claude", "{title}"],
    "cwd": null,
    "title": "Qanban · {title}",
    "newWindow": false,
    "pauseBehavior": "keep",
    "focusOnEnter": true,
    "custom": {
      "spawn": "my-term new-tab --title {title} --cwd {cwd} {command}",
      "focus": "my-term focus {session}",
      "close": "my-term close {session}"
    }
  }
}
```

### Columns

The four stage ids — `new`, `active`, `paused`, `completed` — carry workflow
behavior, so they stay fixed. Their appearance is configurable through
`label`, `shortLabel`, `glyph`, and `color` (`#rgb` or `#rrggbb`).

### Terminal

| Key | Default | Meaning |
| --- | --- | --- |
| `provider` | `auto` | `auto`, `herdr`, `tmux`, `wezterm`, `wt`, `process`, or `custom` |
| `command` | `["claude", "{title}"]` | Program and arguments run in the new terminal; an empty array opens a shell |
| `cwd` | `null` | Working directory; defaults to the directory where Qanban was launched |
| `title` | `Qanban · {title}` | Terminal/tab title template |
| `newWindow` | `false` | Use a new window instead of a new tab where supported |
| `pauseBehavior` | `keep` | `keep` or `close` when a task moves to Paused |
| `focusOnEnter` | `true` | Let Enter focus the Active task's terminal |
| `custom` | empty | Shell commands for the `custom` provider |

Command templates support `{title}`, `{tags}`, `{id}`, and `{cwd}`. Custom
spawn commands also get `{command}` (the resolved command line), and custom
focus/close commands get `{session}` (the saved provider handle). Values are
shell-quoted before substitution.

The command runs with your user privileges. Treat the config file as trusted
local configuration.

## Where data is stored

Qanban saves automatically to:

```text
%APPDATA%\Qanban\board.json
```

The board is plain JSON, so it is easy to back up or inspect. Active tasks also
store a small `session` object with the provider handle used to focus or close
their terminal. If the file is corrupt, Qanban moves it aside as
`board.json.corrupt-<timestamp>` and starts a fresh board. Missing or invalid
task entries are skipped while valid entries are kept.

Boards written by older versions with an `inprogress` column are loaded into
`paused` automatically.

Optional overrides:

| Environment variable | Purpose |
| --- | --- |
| `QANBAN_DATA_FILE` | Use a specific board JSON file |
| `QANBAN_DATA_DIR` | Use a specific data directory |
| `QANBAN_CONFIG_FILE` | Use a specific configuration file |
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
npm test           # domain, storage, config, terminal, layout, and UI tests
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
  config.ts             column and terminal configuration
  layout.ts             responsive dimensions and card scrolling
  terminal/             provider adapters, command templates, sessions
  components/           header, board, cards, forms, help, footer
  hooks/                terminal-size tracking
test/                   Node test runner + ink-testing-library tests
scripts/                esbuild and pkg build scripts
release/Qanban.exe      standalone Windows build
```

Long titles are truncated in narrow columns; press `e` to view and edit the full
title. The app intentionally keeps one local board and does not require a network
connection or account.

## License

Apache License 2.0. See [LICENSE](LICENSE) for the full text.
