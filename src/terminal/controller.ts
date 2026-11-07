import { spawn as spawnChild } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  TerminalProvider,
  TerminalSettings,
} from '../config';
import {
  buildShellCommand,
  defaultRun,
  defaultShellRun,
  expandTemplate,
  failureMessage,
  posixQuote,
  powershellQuote,
  resolveCommandTokens,
  sanitizeTitle,
  type CommandRunner,
  type RunResult,
  type ShellRunner,
} from './command';
import type {
  SpawnTask,
  TerminalControl,
  TerminalResult,
  TerminalSession,
} from './types';

export interface DetachedSpawner {
  (
    file: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): number | undefined;
}

export interface TerminalDeps {
  run: CommandRunner;
  runShell: ShellRunner;
  spawnDetached: DetachedSpawner;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  cwd: string;
  tmpDir: string;
  now: () => Date;
  nextId: () => string;
  sleep: (milliseconds: number) => void;
}

const defaultDeps: TerminalDeps = {
  run: defaultRun,
  runShell: defaultShellRun,
  spawnDetached: (file, args, options) => {
    const child = spawnChild(file, args, {
      detached: true,
      stdio: 'ignore',
      cwd: options?.cwd,
      env: options?.env,
      windowsHide: false,
    });
    child.unref();
    return child.pid;
  },
  env: process.env,
  platform: process.platform,
  cwd: process.cwd(),
  tmpDir: tmpdir(),
  now: () => new Date(),
  nextId: () => randomUUID().slice(0, 8),
  sleep: (milliseconds) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  },
};

export function detectProvider(
  env: NodeJS.ProcessEnv,
): Exclude<TerminalProvider, 'auto'> {
  // herdr-core (the Herdr desktop app's terminal layer) identifies itself with
  // HC_TERMINAL_ID. The older herdr multiplexer uses the HERDR_* variables.
  if (env.HC_TERMINAL_ID) {
    return 'herdr-core';
  }
  if (env.HERDR_ENV === '1' || env.HERDR_PANE_ID) {
    return 'herdr';
  }
  if (env.TMUX) {
    return 'tmux';
  }
  if (env.WEZTERM_PANE || env.TERM_PROGRAM === 'WezTerm') {
    return 'wezterm';
  }
  if (env.WT_SESSION) {
    return 'wt';
  }
  return 'process';
}

function failure(label: string, result: RunResult): TerminalResult {
  return { ok: false, error: failureMessage(label, result) };
}

function lastNonEmptyLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? '';
}

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function findString(value: unknown, key: string): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, key);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record[key] === 'string' && record[key].trim()) {
    return record[key].trim();
  }

  for (const child of Object.values(record)) {
    const found = findString(child, key);
    if (found) {
      return found;
    }
  }

  return undefined;
}

interface SpawnContext {
  task: SpawnTask;
  cwd: string;
  title: string;
  tokens: string[];
  settings: TerminalSettings;
  deps: TerminalDeps;
}

function makeSession(
  provider: string,
  id: string,
  title: string,
  deps: TerminalDeps,
  extra: Partial<TerminalSession> = {},
): TerminalSession {
  return {
    provider,
    id,
    title,
    createdAt: deps.now().toISOString(),
    ...extra,
  };
}

function providerMismatch(session: TerminalSession, provider: string): boolean {
  return session.provider !== provider;
}

function spawnWezterm(context: SpawnContext): TerminalResult {
  const { deps, settings, tokens, cwd } = context;
  const args = ['cli', 'spawn', '--cwd', cwd];
  if (settings.newWindow) {
    args.push('--new-window');
  }
  if (tokens.length > 0) {
    args.push('--', ...tokens);
  }

  const result = deps.run('wezterm', args);
  if (result.error || result.status !== 0) {
    return failure('wezterm spawn failed', result);
  }

  const paneId = result.stdout.trim().split(/\s+/)[0];
  if (!paneId) {
    return { ok: false, error: 'wezterm did not report a pane id.' };
  }

  // Keep the user in Kaygent; Enter on the task brings the new pane forward.
  if (deps.env.WEZTERM_PANE) {
    deps.run('wezterm', [
      'cli',
      'activate-pane',
      '--pane-id',
      deps.env.WEZTERM_PANE,
    ]);
  }

  return {
    ok: true,
    session: makeSession('wezterm', paneId, context.title, deps),
  };
}

function focusWezterm(session: TerminalSession, deps: TerminalDeps): TerminalResult {
  if (providerMismatch(session, 'wezterm')) {
    return { ok: false, error: 'Session was not created by wezterm.' };
  }
  const result = deps.run('wezterm', [
    'cli',
    'activate-pane',
    '--pane-id',
    session.id,
  ]);
  return result.error || result.status !== 0
    ? failure('wezterm focus failed', result)
    : { ok: true };
}

function closeWezterm(session: TerminalSession, deps: TerminalDeps): TerminalResult {
  if (providerMismatch(session, 'wezterm')) {
    return { ok: false, error: 'Session was not created by wezterm.' };
  }
  const result = deps.run('wezterm', ['cli', 'kill-pane', '--pane-id', session.id]);
  return result.error || result.status !== 0
    ? failure('wezterm close failed', result)
    : { ok: true };
}

function spawnTmux(context: SpawnContext): TerminalResult {
  const { deps, tokens, cwd, title } = context;
  const commandLine = tokens.length > 0 ? buildShellCommand(tokens, 'posix') : undefined;
  const args = [
    'new-window',
    '-d',
    '-P',
    '-F',
    '#{window_id}',
    '-c',
    cwd,
    '-n',
    title,
  ];
  if (commandLine) {
    args.push(commandLine);
  }

  const result = deps.run('tmux', args);
  if (result.error || result.status !== 0) {
    return failure('tmux spawn failed', result);
  }

  const windowId = result.stdout.trim().split(/\s+/)[0];
  if (!windowId) {
    return { ok: false, error: 'tmux did not report a window id.' };
  }

  return {
    ok: true,
    session: makeSession('tmux', windowId, title, deps),
  };
}

function focusTmux(session: TerminalSession, deps: TerminalDeps): TerminalResult {
  if (providerMismatch(session, 'tmux')) {
    return { ok: false, error: 'Session was not created by tmux.' };
  }
  const result = deps.run('tmux', ['select-window', '-t', session.id]);
  return result.error || result.status !== 0
    ? failure('tmux focus failed', result)
    : { ok: true };
}

function closeTmux(session: TerminalSession, deps: TerminalDeps): TerminalResult {
  if (providerMismatch(session, 'tmux')) {
    return { ok: false, error: 'Session was not created by tmux.' };
  }
  const result = deps.run('tmux', ['kill-window', '-t', session.id]);
  return result.error || result.status !== 0
    ? failure('tmux close failed', result)
    : { ok: true };
}

function spawnHerdr(context: SpawnContext): TerminalResult {
  const { deps, tokens, cwd, title } = context;
  const created = deps.run(
    'herdr',
    ['tab', 'create', '--cwd', cwd, '--label', title, '--no-focus'],
    { timeoutMs: 20_000 },
  );
  if (created.error || created.status !== 0) {
    return failure('herdr tab create failed', created);
  }

  const parsed = parseJsonLoose(created.stdout);
  const tabId =
    findString(parsed, 'tab_id') ??
    created.stdout.match(/"tab_id"\s*:\s*"([^"]+)"/)?.[1];
  const paneId =
    findString(parsed, 'pane_id') ??
    created.stdout.match(/"pane_id"\s*:\s*"([^"]+)"/)?.[1];

  if (!tabId) {
    return {
      ok: false,
      error: 'herdr did not report a tab id for the new tab.',
    };
  }

  if (tokens.length > 0) {
    if (!paneId) {
      deps.run('herdr', ['tab', 'close', tabId]);
      return {
        ok: false,
        error: 'herdr did not report a pane id, so the command could not be started.',
      };
    }

    const run = deps.run('herdr', [
      'pane',
      'run',
      paneId,
      buildShellCommand(tokens, 'posix'),
    ]);
    if (run.error || run.status !== 0) {
      deps.run('herdr', ['tab', 'close', tabId]);
      return failure('herdr pane run failed', run);
    }
  }

  return {
    ok: true,
    session: makeSession('herdr', tabId, title, deps, {
      tabId,
      ...(paneId ? { paneId } : {}),
    }),
  };
}

function focusHerdr(session: TerminalSession, deps: TerminalDeps): TerminalResult {
  if (providerMismatch(session, 'herdr')) {
    return { ok: false, error: 'Session was not created by herdr.' };
  }
  const result = deps.run('herdr', ['tab', 'focus', session.tabId ?? session.id]);
  return result.error || result.status !== 0
    ? failure('herdr focus failed', result)
    : { ok: true };
}

function closeHerdr(session: TerminalSession, deps: TerminalDeps): TerminalResult {
  if (providerMismatch(session, 'herdr')) {
    return { ok: false, error: 'Session was not created by herdr.' };
  }
  const result = deps.run('herdr', ['tab', 'close', session.tabId ?? session.id]);
  return result.error || result.status !== 0
    ? failure('herdr close failed', result)
    : { ok: true };
}

function herdrCoreName(title: string, id: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  const suffix =
    id
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 10) || 'task';
  return `${slug || 'kaygent'}-${suffix}`.slice(0, 32) || 'kaygent';
}

/**
 * hc terminals stay hidden from the Herdr window unless they carry a
 * `herdr.space` label. Find the space that owns the pane Kaygent runs in so
 * new task tabs appear beside it.
 */
function herdrCoreSpace(
  terminalId: string | undefined,
  deps: TerminalDeps,
): string | undefined {
  if (!terminalId) {
    return undefined;
  }

  const listed = deps.run('herdr-app', ['ls'], { timeoutMs: 5_000 });
  if (listed.error || listed.status !== 0) {
    return undefined;
  }

  const parsed = parseJsonLoose(listed.stdout) as
    | { spaces?: unknown }
    | undefined;
  if (!Array.isArray(parsed?.spaces)) {
    return undefined;
  }

  for (const space of parsed.spaces) {
    if (!space || typeof space !== 'object') {
      continue;
    }
    const record = space as { id?: unknown; tabs?: unknown };
    if (typeof record.id !== 'string' || !Array.isArray(record.tabs)) {
      continue;
    }
    for (const tab of record.tabs) {
      const terminals = (tab as { terminals?: unknown } | undefined)?.terminals;
      if (
        Array.isArray(terminals) &&
        terminals.some(
          (terminal) =>
            (terminal as { terminal?: unknown } | undefined)?.terminal ===
            terminalId,
        )
      ) {
        return record.id;
      }
    }
  }

  return undefined;
}

function spawnHerdrCore(context: SpawnContext): TerminalResult {
  const { deps, tokens, cwd, title, task } = context;
  // spawnCommand() has no task id, so give each foreground source run a
  // distinct hc name to avoid clashing with other live terminals.
  const nameId =
    task.id === 'terminal-command' ? deps.nextId() : task.id;
  const space = herdrCoreSpace(deps.env.HC_TERMINAL_ID, deps);

  const args = [
    'run',
    '--bg',
    '--json',
    '--name',
    herdrCoreName(title, nameId),
    '--cwd',
    cwd,
  ];

  if (space) {
    args.push('--label', `herdr.space=${space}`);
  }

  // Default hc children die with whoever started them and receive notes typed
  // into the parent terminal, which is Kaygent's Ink UI. Task terminals must
  // outlive the board and are reattached by address after a restart.
  args.push('--no-parent', '--no-notify');

  if (tokens.length > 0) {
    args.push('--', ...tokens);
  }

  const result = deps.run('hc', args, { timeoutMs: 20_000 });
  if (result.error || result.status !== 0) {
    return failure('herdr-core launch failed', result);
  }

  const parsed = parseJsonLoose(result.stdout);
  const address =
    findString(parsed, 'address') ?? lastNonEmptyLine(result.stdout);
  if (!address) {
    return {
      ok: false,
      error: 'herdr-core did not report a terminal address.',
    };
  }

  return {
    ok: true,
    session: makeSession('herdr-core', address, title, deps),
  };
}

function focusHerdrCore(
  session: TerminalSession,
  deps: TerminalDeps,
): TerminalResult {
  if (providerMismatch(session, 'herdr-core')) {
    return { ok: false, error: 'Session was not created by herdr-core.' };
  }
  const result = deps.run(
    'herdr-app',
    ['do', 'pane.focus', '--terminal', session.id],
    { timeoutMs: 10_000 },
  );
  return result.error || result.status !== 0
    ? failure('herdr-core focus failed', result)
    : { ok: true };
}

function closeHerdrCore(
  session: TerminalSession,
  deps: TerminalDeps,
): TerminalResult {
  if (providerMismatch(session, 'herdr-core')) {
    return { ok: false, error: 'Session was not created by herdr-core.' };
  }
  const killed = deps.run('hc', ['kill', session.id], { timeoutMs: 15_000 });
  // A program that already exited is only cleaned up by removing its terminal.
  const removed = deps.run('hc', ['rm', session.id], { timeoutMs: 15_000 });
  const closed =
    (!killed.error && killed.status === 0) ||
    (!removed.error && removed.status === 0);
  return closed ? { ok: true } : failure('herdr-core close failed', killed);
}

function powershellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function windowsTerminalFocusScript(title: string): string {
  const quotedTitle = powershellQuote(title);
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    'try {',
    '  Add-Type -AssemblyName UIAutomationClient',
    '  Add-Type -AssemblyName UIAutomationTypes',
    '  $root = [System.Windows.Automation.AutomationElement]::RootElement',
    `  $nameCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, ${quotedTitle})`,
    '  $typeCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)',
    '  $condition = New-Object System.Windows.Automation.AndCondition($nameCondition, $typeCondition)',
    '  $element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)',
    "  if ($null -eq $element) { throw 'tab not found' }",
    '  $selection = $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)',
    '  $selection.Select()',
    '  $element.SetFocus()',
    '  exit 0',
    '} catch {',
    '  [Console]::Error.WriteLine($_.Exception.Message)',
    '  exit 1',
    '}',
  ].join('; ');
}

function spawnWindowsTerminal(context: SpawnContext): TerminalResult {
  const { deps, settings, tokens, cwd, title } = context;
  const suffix = deps.nextId();
  const windowName = `kaygent-${suffix}`;
  const pidFile = join(deps.tmpDir, `kaygent-${suffix}.pid`);

  const call = tokens.map(powershellQuote).join(' ');
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    `$Host.UI.RawUI.WindowTitle = ${powershellQuote(title)}`,
    `$PID | Set-Content -LiteralPath ${powershellQuote(pidFile)}`,
    ...(tokens.length > 0 ? [`& ${call}`] : []),
  ].join('; ');

  const powershellArgs = ['-NoProfile', '-NonInteractive'];
  if (tokens.length === 0) {
    powershellArgs.push('-NoExit');
  }
  powershellArgs.push('-EncodedCommand', powershellCommand(script));

  const target = settings.newWindow ? windowName : '0';
  const args = [
    '-w',
    target,
    'new-tab',
    '--title',
    title,
    '-d',
    cwd,
    'powershell.exe',
    ...powershellArgs,
  ];

  const result = deps.run('wt.exe', args);
  if (result.error || result.status !== 0) {
    return failure('Windows Terminal spawn failed', result);
  }

  return {
    ok: true,
    session: makeSession('wt', windowName, title, deps, {
      pidFile,
      ...(settings.newWindow ? { windowName } : {}),
    }),
  };
}

function focusWindowsTerminal(
  session: TerminalSession,
  deps: TerminalDeps,
): TerminalResult {
  if (providerMismatch(session, 'wt')) {
    return { ok: false, error: 'Session was not created by Windows Terminal.' };
  }

  if (session.windowName) {
    const result = deps.run('wt.exe', [
      '-w',
      session.windowName,
      'focus-tab',
      '-t',
      '0',
    ]);
    if (!result.error && result.status === 0) {
      return { ok: true };
    }
  }

  if (!session.title) {
    return {
      ok: false,
      unsupported: true,
      error:
        'Windows Terminal cannot focus this tab because the session has no title.',
    };
  }

  const encoded = powershellCommand(windowsTerminalFocusScript(session.title));
  const result = deps.run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encoded,
  ]);

  if (result.error || result.status !== 0) {
    const detail =
      result.error ||
      result.stderr.trim() ||
      result.stdout.trim() ||
      `exit code ${result.status}`;
    return {
      ok: false,
      unsupported: true,
      error:
        `Windows Terminal could not focus the tab (${detail}). Set terminal.newWindow=true or use wezterm, tmux, herdr, or a custom provider.`,
    };
  }

  return { ok: true };
}

function readPidFile(pidFile: string, deps: TerminalDeps): number | undefined {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (existsSync(pidFile)) {
      const value = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    deps.sleep(100);
  }
  return undefined;
}

function closeWindowsTerminal(
  session: TerminalSession,
  deps: TerminalDeps,
): TerminalResult {
  if (providerMismatch(session, 'wt')) {
    return { ok: false, error: 'Session was not created by Windows Terminal.' };
  }

  if (!session.pidFile) {
    return { ok: false, error: 'Windows Terminal session has no PID file.' };
  }

  const pid = readPidFile(session.pidFile, deps);
  if (!pid) {
    return {
      ok: false,
      error:
        'Could not read the PID of the Windows Terminal tab, so it was left open.',
    };
  }

  const result = deps.run('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
  if (result.error || result.status !== 0) {
    return failure('Windows Terminal close failed', result);
  }

  try {
    unlinkSync(session.pidFile);
  } catch {
    // The PID file is best-effort cleanup.
  }

  return { ok: true };
}

function buildProcessWrapperScript(title: string, tokens: string[]): string {
  const lines = [
    "$ProgressPreference = 'SilentlyContinue'",
    `$Host.UI.RawUI.WindowTitle = ${powershellQuote(title)}`,
  ];
  if (tokens.length > 0) {
    lines.push(`& ${tokens.map(powershellQuote).join(' ')}`);
  }
  return lines.join('; ');
}

function buildStartProcessScript(
  title: string,
  tokens: string[],
  cwd: string,
): string {
  const innerArgs = ['-NoProfile', '-NonInteractive'];
  if (tokens.length === 0) {
    innerArgs.push('-NoExit');
  }
  innerArgs.push(
    '-EncodedCommand',
    powershellCommand(buildProcessWrapperScript(title, tokens)),
  );

  const argumentList = innerArgs.map(powershellQuote).join(',');
  return `$p = Start-Process -FilePath 'powershell.exe' -ArgumentList @(${argumentList}) -WorkingDirectory ${powershellQuote(cwd)} -PassThru; $p.Id`;
}

function terminalLaunchArgs(
  terminal: string,
  tokens: string[],
): string[] {
  const base = terminal.split(/[\\/]/).pop()?.toLowerCase() ?? terminal;
  if (base.includes('gnome-terminal')) {
    return tokens.length > 0 ? ['--', ...tokens] : [];
  }
  return tokens.length > 0 ? ['-e', ...tokens] : [];
}

function spawnProcess(context: SpawnContext): TerminalResult {
  const { deps, tokens, cwd, title } = context;

  if (deps.platform === 'win32') {
    const script = buildStartProcessScript(title, tokens, cwd);
    const result = deps.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      powershellCommand(script),
    ]);

    if (result.error || result.status !== 0) {
      return failure('process spawn failed', result);
    }

    const pid = result.stdout.match(/(\d+)\s*$/)?.[1];
    if (!pid) {
      return { ok: false, error: 'Could not determine the process id of the new terminal.' };
    }

    return {
      ok: true,
      session: makeSession('process', pid, title, deps),
    };
  }

  const terminal = deps.env.TERMINAL || 'x-terminal-emulator';
  const args = terminalLaunchArgs(terminal, tokens);
  const pid = deps.spawnDetached(terminal, args, {
    cwd,
    env: deps.env,
  });

  if (!pid) {
    return {
      ok: false,
      error: `Could not start ${terminal}. Set terminal.provider to wezterm, tmux, herdr, or custom.`,
    };
  }

  return {
    ok: true,
    session: makeSession('process', String(pid), title, deps),
  };
}

function focusProcess(session: TerminalSession, deps: TerminalDeps): TerminalResult {
  if (providerMismatch(session, 'process')) {
    return { ok: false, error: 'Session was not created by the process provider.' };
  }

  if (deps.platform === 'win32') {
    if (!/^\d+$/.test(session.id)) {
      return {
        ok: false,
        unsupported: true,
        error: 'The process provider session has no valid Windows process id.',
      };
    }

    if (session.title) {
      const byTitle = deps.run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        powershellCommand(windowsTerminalFocusScript(session.title)),
      ]);
      if (!byTitle.error && byTitle.status === 0) {
        return { ok: true };
      }
    }

    const script = [
      '$ProgressPreference = \'SilentlyContinue\'',
      '$ws = New-Object -ComObject WScript.Shell',
      `if (-not $ws.AppActivate(${Number(session.id)})) { exit 1 }`,
    ].join('; ');
    const result = deps.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      powershellCommand(script),
    ]);
    return result.error || result.status !== 0
      ? {
          ok: false,
          unsupported: true,
          error:
            'Could not focus the spawned terminal window. Use wezterm, tmux, herdr, or a custom provider for reliable focus.',
        }
      : { ok: true };
  }

  const result = deps.run('wmctrl', ['-a', session.title ?? '']);
  return result.error || result.status !== 0
    ? {
        ok: false,
        unsupported: true,
        error:
          'Could not focus the terminal window. Install wmctrl or configure a custom provider.',
      }
    : { ok: true };
}

function closeProcess(session: TerminalSession, deps: TerminalDeps): TerminalResult {
  if (providerMismatch(session, 'process')) {
    return { ok: false, error: 'Session was not created by the process provider.' };
  }

  if (deps.platform === 'win32') {
    const result = deps.run('taskkill.exe', [
      '/PID',
      session.id,
      '/T',
      '/F',
    ]);
    return result.error || result.status !== 0
      ? failure('process close failed', result)
      : { ok: true };
  }

  const result = deps.runShell(`kill ${posixQuote(session.id)}`);
  return result.error || result.status !== 0
    ? failure('process close failed', result)
    : { ok: true };
}

function spawnCustom(context: SpawnContext): TerminalResult {
  const { deps, settings, task, cwd, title, tokens } = context;
  if (!settings.custom.spawn) {
    return {
      ok: false,
      unsupported: true,
      error:
        'terminal.custom.spawn must be configured when terminal.provider is "custom".',
    };
  }

  const command = expandTemplate(settings.custom.spawn, {
    title: shellValue(title, deps.platform),
    tags: shellValue(task.tags.join(' '), deps.platform),
    id: shellValue(task.id, deps.platform),
    cwd: shellValue(cwd, deps.platform),
    command: buildShellCommand(tokens, deps.platform === 'win32' ? 'win32' : 'posix'),
  });

  const result = deps.runShell(command, { cwd });
  if (result.error || result.status !== 0) {
    return failure('custom terminal spawn failed', result);
  }

  const id = lastNonEmptyLine(result.stdout) || `custom-${deps.nextId()}`;
  return {
    ok: true,
    session: makeSession('custom', id, title, deps),
  };
}

function shellValue(value: string, platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? buildShellCommand([value], 'win32')
    : posixQuote(value);
}

function customCommand(
  session: TerminalSession,
  template: string,
  label: string,
  deps: TerminalDeps,
): TerminalResult {
  if (!template) {
    return {
      ok: false,
      unsupported: true,
      error: `terminal.custom.${label} must be configured when terminal.provider is "custom".`,
    };
  }

  const command = expandTemplate(template, {
    title: shellValue(session.title ?? '', deps.platform),
    tags: '',
    id: '',
    cwd: '',
    session: shellValue(session.id, deps.platform),
  });

  const result = deps.runShell(command);
  return result.error || result.status !== 0
    ? failure(`custom terminal ${label} failed`, result)
    : { ok: true };
}

export function createTerminalController(
  settings: TerminalSettings,
  overrides: Partial<TerminalDeps> = {},
): TerminalControl {
  const deps: TerminalDeps = { ...defaultDeps, ...overrides };
  const provider =
    settings.provider === 'auto' ? detectProvider(deps.env) : settings.provider;

  const launch = (
    tokens: string[],
    options: { title: string; cwd?: string; task?: SpawnTask },
  ): TerminalResult => {
    const cwd = options.cwd ?? settings.cwd ?? deps.cwd;
    const title = sanitizeTitle(options.title) || 'Kaygent';

    const context: SpawnContext = {
      task: options.task ?? {
        id: 'terminal-command',
        title,
        tags: [],
      },
      cwd,
      title,
      tokens,
      settings,
      deps,
    };

    switch (provider) {
      case 'wezterm':
        return spawnWezterm(context);
      case 'tmux':
        return spawnTmux(context);
      case 'herdr':
        return spawnHerdr(context);
      case 'herdr-core':
        return spawnHerdrCore(context);
      case 'wt':
        return spawnWindowsTerminal(context);
      case 'custom':
        return spawnCustom(context);
      case 'process':
      default:
        return spawnProcess(context);
    }
  };

  const spawn = (task: SpawnTask): TerminalResult => {
    const cwd = settings.cwd ?? deps.cwd;
    const rawTitle = expandTemplate(settings.title, {
      title: task.title,
      tags: task.tags.join(' '),
      id: task.id,
      cwd,
    });
    const title = sanitizeTitle(rawTitle) || `Kaygent · ${task.title}`;
    const tokens = resolveCommandTokens(settings.command, {
      title: task.title,
      tags: task.tags.join(' '),
      id: task.id,
      cwd,
    });

    return launch(tokens, { title, cwd, task });
  };

  const spawnCommand = (
    command: readonly string[],
    options: { title?: string; cwd?: string } = {},
  ): TerminalResult =>
    launch([...command], {
      title: options.title ?? 'Kaygent',
      cwd: options.cwd,
    });

  const focus = (session: TerminalSession): TerminalResult => {
    switch (session.provider) {
      case 'wezterm':
        return focusWezterm(session, deps);
      case 'tmux':
        return focusTmux(session, deps);
      case 'herdr':
        return focusHerdr(session, deps);
      case 'herdr-core':
        return focusHerdrCore(session, deps);
      case 'wt':
        return focusWindowsTerminal(session, deps);
      case 'custom':
        return customCommand(session, settings.custom.focus, 'focus', deps);
      case 'process':
        return focusProcess(session, deps);
      default:
        return {
          ok: false,
          error: `Unknown terminal provider “${session.provider}”.`,
        };
    }
  };

  const close = (session: TerminalSession): TerminalResult => {
    switch (session.provider) {
      case 'wezterm':
        return closeWezterm(session, deps);
      case 'tmux':
        return closeTmux(session, deps);
      case 'herdr':
        return closeHerdr(session, deps);
      case 'herdr-core':
        return closeHerdrCore(session, deps);
      case 'wt':
        return closeWindowsTerminal(session, deps);
      case 'custom':
        return customCommand(session, settings.custom.close, 'close', deps);
      case 'process':
        return closeProcess(session, deps);
      default:
        return {
          ok: false,
          error: `Unknown terminal provider “${session.provider}”.`,
        };
    }
  };

  return {
    provider,
    pauseBehavior: settings.pauseBehavior,
    focusOnEnter: settings.focusOnEnter,
    spawn,
    spawnCommand,
    focus,
    close,
  };
}
