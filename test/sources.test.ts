import assert from 'node:assert/strict';
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
