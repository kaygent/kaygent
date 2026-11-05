import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerminalSettings } from '../src/config';
import { createTerminalController, detectProvider } from '../src/terminal';
import type { TerminalDeps } from '../src/terminal';
import {
  windowsQuote,
  type CommandRunner,
  type RunResult,
} from '../src/terminal/command';

function result(stdout = '', status = 0, stderr = ''): RunResult {
  return { status, stdout, stderr };
}

function makeDeps(overrides: Partial<TerminalDeps> = {}): TerminalDeps {
  return {
    run: () => result(),
    runShell: () => result(),
    spawnDetached: () => 4242,
    env: {},
    platform: 'linux',
    cwd: '/work',
    tmpDir: '/tmp',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    nextId: () => 'abc123',
    sleep: () => {},
    ...overrides,
  };
}

function settings(overrides: Partial<TerminalSettings> = {}): TerminalSettings {
  return {
    provider: 'wezterm',
    command: ['claude', '{title}'],
    title: 'Qanban · {title}',
    newWindow: false,
    pauseBehavior: 'keep',
    focusOnEnter: true,
    custom: { spawn: '', focus: '', close: '' },
    ...overrides,
  };
}

const task = { id: 'task-1', title: 'Fix login', tags: ['work'] };

test('detects the terminal that launched Qanban', () => {
  assert.equal(
    detectProvider({
      HERDR_ENV: '1',
      TMUX: '/tmp/tmux',
      WEZTERM_PANE: '1',
      WT_SESSION: 'wt',
    }),
    'herdr',
  );
  assert.equal(detectProvider({ TMUX: '/tmp/tmux', WEZTERM_PANE: '1' }), 'tmux');
  assert.equal(detectProvider({ WEZTERM_PANE: '1', WT_SESSION: 'wt' }), 'wezterm');
  assert.equal(detectProvider({ WT_SESSION: 'wt' }), 'wt');
  assert.equal(detectProvider({}), 'process');
});

test('spawns, focuses, and closes wezterm panes', () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const run: CommandRunner = (file, args) => {
    calls.push({ file, args });
    return args[0] === 'cli' && args[1] === 'spawn' ? result('17\n') : result();
  };
  const deps = makeDeps({ run, env: { WEZTERM_PANE: '9' } });
  const controller = createTerminalController(
    settings({ provider: 'wezterm' }),
    deps,
  );

  const spawned = controller.spawn(task);
  assert.equal(controller.provider, 'wezterm');
  assert.equal(spawned.ok, true);
  assert.equal(spawned.session?.id, '17');
  assert.deepEqual(calls[0], {
    file: 'wezterm',
    args: ['cli', 'spawn', '--cwd', '/work', '--', 'claude', 'Fix login'],
  });
  assert.deepEqual(calls[1]?.args, [
    'cli',
    'activate-pane',
    '--pane-id',
    '9',
  ]);

  assert.equal(controller.focus(spawned.session!).ok, true);
  assert.equal(controller.close(spawned.session!).ok, true);
  assert.deepEqual(calls.at(-2)?.args, [
    'cli',
    'activate-pane',
    '--pane-id',
    '17',
  ]);
  assert.deepEqual(calls.at(-1)?.args, ['cli', 'kill-pane', '--pane-id', '17']);
});

test('spawns tmux windows and selects them', () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const run: CommandRunner = (file, args) => {
    calls.push({ file, args });
    return args[0] === 'new-window' ? result('@4\n') : result();
  };
  const deps = makeDeps({ run, env: { TMUX: '/tmp/tmux' } });
  const controller = createTerminalController(
    settings({ provider: 'tmux' }),
    deps,
  );

  const spawned = controller.spawn(task);
  assert.equal(spawned.ok, true);
  assert.equal(spawned.session?.id, '@4');
  assert.deepEqual(calls[0]?.args, [
    'new-window',
    '-d',
    '-P',
    '-F',
    '#{window_id}',
    '-c',
    '/work',
    '-n',
    'Qanban · Fix login',
    "'claude' 'Fix login'",
  ]);

  assert.equal(controller.focus(spawned.session!).ok, true);
  assert.equal(controller.close(spawned.session!).ok, true);
  assert.deepEqual(calls.at(-2)?.args, ['select-window', '-t', '@4']);
  assert.deepEqual(calls.at(-1)?.args, ['kill-window', '-t', '@4']);
});

test('creates herdr tabs, runs the agent, and closes by tab id', () => {
  const calls: string[][] = [];
  const run: CommandRunner = (_file, args) => {
    calls.push(args);
    if (args[0] === 'tab' && args[1] === 'create') {
      return result(
        JSON.stringify({
          ok: true,
          result: {
            tab: { tab_id: 'w1:t2' },
            root_pane: { pane_id: 'w1:p3' },
          },
        }),
      );
    }
    return result();
  };
  const deps = makeDeps({ run, env: { HERDR_ENV: '1' } });
  const controller = createTerminalController(
    settings({ provider: 'herdr' }),
    deps,
  );

  const spawned = controller.spawn(task);
  assert.equal(spawned.ok, true);
  assert.equal(spawned.session?.id, 'w1:t2');
  assert.equal(spawned.session?.tabId, 'w1:t2');
  assert.equal(spawned.session?.paneId, 'w1:p3');
  assert.deepEqual(calls[0], [
    'tab',
    'create',
    '--cwd',
    '/work',
    '--label',
    'Qanban · Fix login',
    '--no-focus',
  ]);
  assert.deepEqual(calls[1], [
    'pane',
    'run',
    'w1:p3',
    "'claude' 'Fix login'",
  ]);

  assert.equal(controller.focus(spawned.session!).ok, true);
  assert.equal(controller.close(spawned.session!).ok, true);
  assert.deepEqual(calls.at(-2), ['tab', 'focus', 'w1:t2']);
  assert.deepEqual(calls.at(-1), ['tab', 'close', 'w1:t2']);
});

test('runs custom terminal command templates', () => {
  const shellCalls: string[] = [];
  const deps = makeDeps({
    runShell: (command) => {
      shellCalls.push(command);
      return command.startsWith('myterm open') ? result('session-9\n') : result();
    },
  });
  const controller = createTerminalController(
    settings({
      provider: 'custom',
      custom: {
        spawn: 'myterm open --title {title} --cwd {cwd} {command}',
        focus: 'myterm focus {session}',
        close: 'myterm close {session}',
      },
    }),
    deps,
  );

  const spawned = controller.spawn(task);
  assert.equal(spawned.ok, true);
  assert.equal(spawned.session?.id, 'session-9');
  assert.equal(
    shellCalls[0],
    "myterm open --title 'Qanban · Fix login' --cwd '/work' 'claude' 'Fix login'",
  );

  assert.equal(controller.focus(spawned.session!).ok, true);
  assert.equal(controller.close(spawned.session!).ok, true);
  assert.equal(shellCalls[1], "myterm focus 'session-9'");
  assert.equal(shellCalls[2], "myterm close 'session-9'");
});

test('quotes Windows shell values without mangling paths', () => {
  assert.equal(
    windowsQuote('C:\\Program Files\\Qanban'),
    '"C:\\Program Files\\Qanban"',
  );
  assert.equal(windowsQuote('say "hi"'), '"say ""hi"""');
});

test('spawns and focuses named Windows Terminal windows', () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const run: CommandRunner = (file, args) => {
    calls.push({ file, args });
    return result();
  };
  const deps = makeDeps({
    run,
    platform: 'win32',
    env: { WT_SESSION: 'session' },
  });
  const controller = createTerminalController(
    settings({ provider: 'wt', newWindow: true }),
    deps,
  );

  const spawned = controller.spawn(task);
  assert.equal(spawned.ok, true);
  assert.equal(spawned.session?.windowName, 'qanban-abc123');
  assert.ok(spawned.session?.pidFile?.endsWith('qanban-abc123.pid'));
  assert.deepEqual(calls[0]?.args.slice(0, 6), [
    '-w',
    'qanban-abc123',
    'new-tab',
    '--title',
    'Qanban · Fix login',
    '-d',
  ]);

  assert.equal(controller.focus(spawned.session!).ok, true);
  assert.deepEqual(calls.at(-1)?.args, [
    '-w',
    'qanban-abc123',
    'focus-tab',
    '-t',
    '0',
  ]);
});

test('uses a tracked process window on Windows', () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const run: CommandRunner = (file, args) => {
    calls.push({ file, args });
    if (args[0] === '-NoProfile' && args.includes('-EncodedCommand')) {
      return result('4321\n');
    }
    return result();
  };
  const deps = makeDeps({ run, platform: 'win32', env: {} });
  const controller = createTerminalController(
    settings({ provider: 'process' }),
    deps,
  );

  const spawned = controller.spawn(task);
  assert.equal(spawned.ok, true);
  assert.equal(spawned.session?.id, '4321');
  assert.equal(calls[0]?.file, 'powershell.exe');

  assert.equal(controller.focus(spawned.session!).ok, true);
  assert.equal(controller.close(spawned.session!).ok, true);
  assert.deepEqual(calls.at(-1)?.args, [
    '/PID',
    '4321',
    '/T',
    '/F',
  ]);
});

test('reports spawn and focus failures', () => {
  const deps = makeDeps({
    run: (_file, args) =>
      args[0] === 'cli' && args[1] === 'spawn'
        ? result('', 1, 'wezterm: not found')
        : result(),
  });
  const controller = createTerminalController(
    settings({ provider: 'wezterm' }),
    deps,
  );

  const spawned = controller.spawn(task);
  assert.equal(spawned.ok, false);
  assert.match(spawned.error ?? '', /wezterm: not found/);
});

test('auto chooses wezterm from the environment', () => {
  const run: CommandRunner = (_file, args) =>
    args[0] === 'cli' && args[1] === 'spawn' ? result('5\n') : result();
  const controller = createTerminalController(
    settings({ provider: 'auto' }),
    makeDeps({ run, env: { WEZTERM_PANE: '2' } }),
  );

  assert.equal(controller.provider, 'wezterm');
  assert.equal(controller.spawn(task).session?.id, '5');
});

test('exposes pause and focus preferences', () => {
  const controller = createTerminalController(
    settings({ pauseBehavior: 'close', focusOnEnter: false }),
    makeDeps(),
  );

  assert.equal(controller.pauseBehavior, 'close');
  assert.equal(controller.focusOnEnter, false);
});
