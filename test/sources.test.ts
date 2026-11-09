import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createEmptyBoard, type Board } from '../src/board';
import type { TaskSourceSettings } from '../src/config';
import {
  convertSourceItem,
  createTaskSourceService,
  extractSourceItems,
  syncTaskSources,
  type SourceDeps,
} from '../src/sources';
import type { TerminalControl, TerminalSession } from '../src/terminal';
import type { RunResult } from '../src/terminal/command';

const NOW = new Date('2026-03-04T05:06:07.000Z');

function result(stdout = '', status = 0, stderr = ''): RunResult {
  return { status, stdout, stderr };
}

function source(
  overrides: Partial<TaskSourceSettings> = {},
): TaskSourceSettings {
  return {
    sourceName: 'github',
    command: 'gh issue list --json number,title,url,labels',
    format: 'auto',
    tags: [],
    timeoutMs: 30_000,
    syncOnStart: false,
    refreshMinutes: 'never',
    runMode: 'background',
    ...overrides,
  };
}

function makeDeps(
  outputs: Record<string, RunResult> | ((command: string) => RunResult),
): {
  deps: SourceDeps;
  calls: Array<{ command: string; cwd?: string; timeoutMs?: number }>;
} {
  const calls: Array<{
    command: string;
    cwd?: string;
    timeoutMs?: number;
  }> = [];

  return {
    calls,
    deps: {
      now: () => NOW,
      cwd: '/work',
      runShell: (command, options) => {
        calls.push({
          command,
          cwd: options?.cwd,
          timeoutMs: options?.timeoutMs,
        });
        if (typeof outputs === 'function') {
          return outputs(command);
        }
        const match = Object.entries(outputs).find(([prefix]) =>
          command.startsWith(prefix),
        );
        return match?.[1] ?? result('', 1, 'not configured');
      },
    },
  };
}

test('recognizes message, task, and bare-array payloads', () => {
  assert.deepEqual(extractSourceItems({ messages: [1] }, 'auto'), {
    kind: 'messages',
    items: [1],
  });
  assert.deepEqual(extractSourceItems({ tasks: [1] }, 'auto'), {
    kind: 'tasks',
    items: [1],
  });
  assert.deepEqual(extractSourceItems([1], 'tasks'), {
    kind: 'tasks',
    items: [1],
  });
  assert.deepEqual(extractSourceItems([1], 'auto'), {
    kind: 'messages',
    items: [1],
  });
  assert.ok('error' in extractSourceItems({ nope: true }, 'auto'));
});

test('converts GitHub-style messages into namespaced tasks', () => {
  const payload = [
    {
      number: 42,
      title: 'Fix login',
      html_url: 'https://github.com/acme/app/issues/42',
      labels: [{ name: 'bug' }, { name: 'urgent' }],
      createdAt: '2026-03-01T00:00:00.000Z',
    },
  ];
  const { deps, calls } = makeDeps({
    'gh issue list': result(JSON.stringify(payload)),
  });

  const outcome = syncTaskSources(
    createEmptyBoard(),
    [source({ tags: ['github'] })],
    deps,
  );

  assert.equal(outcome.added.length, 1);
  assert.equal(outcome.skipped, 0);
  assert.deepEqual(outcome.errors, []);
  assert.equal(calls[0]?.cwd, '/work');
  assert.equal(calls[0]?.timeoutMs, 30_000);

  const task = outcome.added[0]!;
  assert.equal(task.id, 'source:github:42');
  assert.equal(task.title, 'Fix login');
  assert.deepEqual(task.tags, ['github', 'bug', 'urgent']);
  assert.equal(task.createdAt, '2026-03-01T00:00:00.000Z');
  assert.deepEqual(task.source, {
    sourceName: 'github',
    itemId: '42',
    url: 'https://github.com/acme/app/issues/42',
  });
  assert.equal(outcome.board.columns.new[0], task);
});

test('deduplicates within a batch and against every board column', () => {
  const board: Board = createEmptyBoard();
  board.columns.completed = [
    {
      id: 'source:github:1',
      title: 'Already done',
      tags: [],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    },
  ];
  const payload = [
    { id: '1', title: 'Already done' },
    { id: '2', title: 'Fresh' },
    { id: '2', title: 'Duplicate in batch' },
  ];
  const { deps } = makeDeps({
    'gh issue list': result(JSON.stringify(payload)),
  });

  const outcome = syncTaskSources(board, [source()], deps);

  assert.equal(outcome.added.length, 1);
  assert.equal(outcome.added[0]?.id, 'source:github:2');
  assert.equal(outcome.skipped, 2);
  assert.equal(outcome.board.columns.completed.length, 1);
  assert.equal(outcome.board.columns.new.length, 1);
});

test('uses stable content hashes when messages have no ids', () => {
  const messageSource = source({
    sourceName: 'inbox',
    command: 'inbox-export',
  });
  const item = { title: 'Reply to Sam', text: 'Can you send the deck?' };

  const first = convertSourceItem(messageSource, item, 'messages', NOW);
  const second = convertSourceItem(messageSource, item, 'messages', NOW);

  assert.ok(first);
  assert.equal(first.id, second?.id);
  assert.match(first.id, /^source:inbox:h:[0-9a-f]{20}$/);
  assert.equal(first.source?.itemId.split(':')[0], 'h');
});

test('derives message titles from the first body line', () => {
  const converted = convertSourceItem(
    source({ sourceName: 'slack' }),
    { id: 'm-1', text: '  First line  \nSecond line' },
    'messages',
    NOW,
  );

  assert.equal(converted?.title, 'First line');
});

test('requires stable ids and titles for tasks feeds', () => {
  const missingId = convertSourceItem(
    source({ format: 'tasks' }),
    { title: 'No id here' },
    'tasks',
    NOW,
  );
  const missingTitle = convertSourceItem(
    source({ format: 'tasks' }),
    { id: 'T-1', body: 'Body is not a title for tasks' },
    'tasks',
    NOW,
  );
  const valid = convertSourceItem(
    source({ sourceName: 'jira', format: 'tasks' }),
    { id: 'PROJ-1', title: 'Jira issue', tags: ['backend'] },
    'tasks',
    NOW,
  );

  assert.equal(missingId, undefined);
  assert.equal(missingTitle, undefined);
  assert.equal(valid?.id, 'source:jira:PROJ-1');
  assert.deepEqual(valid?.tags, ['backend']);
});

test('continues after one source fails', () => {
  const { deps } = makeDeps((command) =>
    command === 'broken'
      ? result('', 1, 'boom')
      : result(JSON.stringify([{ id: '2', title: 'From good source' }])),
  );

  const outcome = syncTaskSources(
    createEmptyBoard(),
    [
      source({ sourceName: 'broken', command: 'broken' }),
      source({ sourceName: 'good', command: 'good' }),
    ],
    deps,
  );

  assert.equal(outcome.errors.length, 1);
  assert.match(outcome.errors[0]?.error ?? '', /boom/);
  assert.equal(outcome.added.length, 1);
  assert.equal(outcome.added[0]?.id, 'source:good:2');
});

test('reports invalid JSON and empty output', () => {
  const invalid = syncTaskSources(
    createEmptyBoard(),
    [source({ sourceName: 'bad' })],
    makeDeps({ 'gh issue list': result('not json') }).deps,
  );
  assert.equal(invalid.added.length, 0);
  assert.match(invalid.errors[0]?.error ?? '', /invalid JSON/i);

  const empty = syncTaskSources(
    createEmptyBoard(),
    [source({ sourceName: 'empty' })],
    makeDeps({ 'gh issue list': result('') }).deps,
  );
  assert.equal(empty.added.length, 0);
  assert.match(empty.errors[0]?.error ?? '', /no output/i);
});

test('startup sync only runs sources marked syncOnStart', () => {
  const { deps, calls } = makeDeps({
    startup: result(JSON.stringify([{ id: '1', title: 'At startup' }])),
    manual: result(JSON.stringify([{ id: '2', title: 'Manual only' }])),
  });
  const sources = [
    source({ sourceName: 'startup', command: 'startup', syncOnStart: true }),
    source({ sourceName: 'manual', command: 'manual', syncOnStart: false }),
  ];

  const startup = syncTaskSources(createEmptyBoard(), sources, deps, {
    startupOnly: true,
  });

  assert.deepEqual(
    calls.map((call) => call.command),
    ['startup'],
  );
  assert.equal(startup.syncedSources, 1);
  assert.equal(startup.added[0]?.id, 'source:startup:1');

  const manual = syncTaskSources(createEmptyBoard(), sources, deps);
  assert.equal(manual.syncedSources, 2);
  assert.equal(manual.added.length, 2);
});

test('uses per-source working directory and timeout', () => {
  const { deps, calls } = makeDeps({
    special: result(JSON.stringify([])),
  });

  syncTaskSources(
    createEmptyBoard(),
    [
      source({
        sourceName: 'special',
        command: 'special',
        cwd: '/repo/service',
        timeoutMs: 5_000,
      }),
    ],
    deps,
  );

  assert.equal(calls[0]?.cwd, '/repo/service');
  assert.equal(calls[0]?.timeoutMs, 5_000);
});

test('service reports whether sources are configured', () => {
  assert.equal(createTaskSourceService([]).enabled, false);
  assert.equal(createTaskSourceService([source()]).enabled, true);
});

test('passes every board task to sync scripts', () => {
  let snapshot: {
    generatedAt: string;
    tasks: Array<{
      id: string;
      stage: string;
      title: string;
      description?: string;
      parentId?: string;
      source?: string;
    }>;
  } | undefined;

  const board = createEmptyBoard();
  board.columns.new.push({
    id: 'task-new',
    title: 'New task',
    tags: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  board.columns.active.push({
    id: 'task-active',
    title: 'Active task',
    description: 'Active details',
    parentId: 'task-new',
    tags: ['work'],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    source: { sourceName: 'jira', itemId: 'PROJ-1' },
  });
  board.columns.completed.push({
    id: 'task-done',
    title: 'Done task',
    tags: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });

  const deps: SourceDeps = {
    now: () => NOW,
    cwd: '/work',
    runShell: (_command, options) => {
      const taskFile = options?.env?.KAYGENT_TASKS_FILE;
      assert.ok(taskFile);
      snapshot = JSON.parse(readFileSync(taskFile, 'utf8'));
      return result(JSON.stringify([]));
    },
  };

  syncTaskSources(board, [source()], deps);

  assert.ok(snapshot);
  assert.equal(snapshot.generatedAt, NOW.toISOString());
  assert.deepEqual(
    snapshot.tasks.map((task) => task.stage),
    ['new', 'active', 'completed'],
  );
  const active = snapshot.tasks[1]!;
  assert.equal(active.description, 'Active details');
  assert.equal(active.parentId, 'task-new');
  assert.equal(active.source, 'jira');
});

test('maps descriptions, item sources, and parent task ids', () => {
  const payload = [
    {
      nativeId: 'T-1',
      title: 'Parent task',
      description: 'Parent details',
      source: 'jira',
    },
    {
      nativeId: 'T-2',
      title: 'Child task',
      parentId: 'T-1',
      source: 'jira',
    },
  ];
  const outcome = syncTaskSources(
    createEmptyBoard(),
    [source({ format: 'tasks' })],
    makeDeps({ 'gh issue list': result(JSON.stringify(payload)) }).deps,
  );

  assert.equal(outcome.added.length, 2);
  const [parent, child] = outcome.added;
  assert.equal(parent?.id, 'source:jira:T-1');
  assert.equal(parent?.description, 'Parent details');
  assert.equal(parent?.source?.sourceName, 'jira');
  assert.equal(child?.id, 'source:jira:T-2');
  assert.equal(child?.parentId, 'source:jira:T-1');
});

test('resolves parent ids against tasks already on the board', () => {
  const board = createEmptyBoard();
  board.columns.completed.push({
    id: 'source:jira:T-1',
    title: 'Existing parent',
    tags: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    source: { sourceName: 'jira', itemId: 'T-1' },
  });
  const payload = [
    { id: 'T-2', title: 'Child', parentId: 'T-1', source: 'jira' },
  ];
  const outcome = syncTaskSources(
    board,
    [source({ format: 'tasks' })],
    makeDeps({ 'gh issue list': result(JSON.stringify(payload)) }).deps,
  );

  assert.equal(outcome.added[0]?.parentId, 'source:jira:T-1');
});

function fakeForegroundTerminal(behavior: {
  spawnOk?: boolean;
  write?: (directory: string) => void;
} = {}): {
  terminal: TerminalControl;
  calls: string[];
} {
  const calls: string[] = [];
  const session: TerminalSession = {
    provider: 'fake',
    id: 'session-1',
    title: 'Kaygent sync · github',
    createdAt: NOW.toISOString(),
  };

  const terminal: TerminalControl = {
    provider: 'fake',
    pauseBehavior: 'keep',
    focusOnEnter: true,
    spawn: () => ({ ok: false, error: 'not used' }),
    spawnCommand(command, options) {
      calls.push(`spawn:${command.join(' ')}`);
      calls.push(`title:${options?.title ?? ''}`);
      if (behavior.spawnOk === false) {
        return { ok: false, error: 'no terminal' };
      }
      const scriptPath = command.at(-1);
      if (scriptPath && behavior.write) {
        behavior.write(dirname(scriptPath));
      }
      return { ok: true, session };
    },
    focus: (target) => {
      calls.push(`focus:${target.id}`);
      return { ok: true };
    },
    close: (target) => {
      calls.push(`close:${target.id}`);
      return { ok: true };
    },
  };

  return { terminal, calls };
}

test('runs foreground sources in a terminal and closes it', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'kaygent-fg-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fake = fakeForegroundTerminal({
    write: (dir) => {
      writeFileSync(
        join(dir, 'output.json'),
        JSON.stringify([{ id: 'fg-1', title: 'Foreground task' }]),
        'utf8',
      );
      writeFileSync(join(dir, 'exit.code'), '0', 'utf8');
    },
  });

  const outcome = syncTaskSources(
    createEmptyBoard(),
    [source({ runMode: 'foreground', timeoutMs: 1_000 })],
    {
      ...makeDeps({}).deps,
      terminal: fake.terminal,
      platform: process.platform,
      tmpDir: directory,
    },
  );

  assert.deepEqual(outcome.errors, []);
  assert.equal(outcome.added[0]?.id, 'source:github:fg-1');
  assert.ok(fake.calls.some((call) => call.startsWith('spawn:')));
  assert.ok(fake.calls.includes('focus:session-1'));
  assert.ok(fake.calls.includes('close:session-1'));
  assert.ok(
    fake.calls.some((call) => call === 'title:Kaygent sync · github'),
  );
});

test('foreground sync scripts receive the board tasks file', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'kaygent-fg-input-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let taskFileText = '';
  let wrapperText = '';

  const fake = fakeForegroundTerminal({
    write: (dir) => {
      taskFileText = readFileSync(join(dir, 'tasks.json'), 'utf8');
      const wrapper =
        process.platform === 'win32' ? 'sync.cmd' : 'sync.sh';
      wrapperText = readFileSync(join(dir, wrapper), 'utf8');
      writeFileSync(join(dir, 'output.json'), JSON.stringify([]), 'utf8');
      writeFileSync(join(dir, 'exit.code'), '0', 'utf8');
    },
  });

  const board = createEmptyBoard();
  board.columns.paused.push({
    id: 'paused-1',
    title: 'Paused task',
    tags: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });

  syncTaskSources(
    board,
    [source({ runMode: 'foreground', timeoutMs: 1_000 })],
    {
      ...makeDeps({}).deps,
      terminal: fake.terminal,
      platform: process.platform,
      tmpDir: directory,
    },
  );

  assert.match(wrapperText, /KAYGENT_TASKS_FILE/);
  const snapshot = JSON.parse(taskFileText);
  assert.equal(snapshot.tasks[0]?.id, 'paused-1');
  assert.equal(snapshot.tasks[0]?.stage, 'paused');
});

test('closes the foreground terminal when the source times out', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'kaygent-fg-timeout-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fake = fakeForegroundTerminal();

  const outcome = syncTaskSources(
    createEmptyBoard(),
    [source({ runMode: 'foreground', timeoutMs: 20 })],
    {
      ...makeDeps({}).deps,
      terminal: fake.terminal,
      platform: process.platform,
      tmpDir: directory,
    },
  );

  assert.equal(outcome.added.length, 0);
  assert.match(outcome.errors[0]?.error ?? '', /timed out/i);
  assert.ok(fake.calls.includes('close:session-1'));
});

test('reports foreground terminal launch failures', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'kaygent-fg-fail-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fake = fakeForegroundTerminal({ spawnOk: false });

  const outcome = syncTaskSources(
    createEmptyBoard(),
    [source({ runMode: 'foreground' })],
    {
      ...makeDeps({}).deps,
      terminal: fake.terminal,
      platform: process.platform,
      tmpDir: directory,
    },
  );

  assert.equal(outcome.added.length, 0);
  assert.match(outcome.errors[0]?.error ?? '', /Could not open a terminal/i);
});

test('runs only the requested source for scheduled syncs', () => {
  const { deps, calls } = makeDeps({
    alpha: result(JSON.stringify([{ id: 'a1', title: 'From alpha' }])),
    beta: result(JSON.stringify([{ id: 'b1', title: 'From beta' }])),
  });

  const outcome = syncTaskSources(
    createEmptyBoard(),
    [
      source({ sourceName: 'alpha', command: 'alpha' }),
      source({ sourceName: 'beta', command: 'beta' }),
    ],
    deps,
    { sourceName: 'beta' },
  );

  assert.deepEqual(calls.map((call) => call.command), ['beta']);
  assert.equal(outcome.syncedSources, 1);
  assert.equal(outcome.added[0]?.id, 'source:beta:b1');
});
