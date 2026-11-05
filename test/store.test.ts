import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { addTask, countTasks, createEmptyBoard } from '../src/board';
import { defaultDataFile, loadBoard, saveBoard, serializeBoard } from '../src/store';

function tempDirectory(t: test.TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'qanban-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const NOW = new Date('2026-02-03T04:05:06.000Z');

test('returns an empty board when no file exists', (t) => {
  const directory = tempDirectory(t);
  const filePath = join(directory, 'board.json');
  const loaded = loadBoard(filePath);

  assert.equal(countTasks(loaded.board), 0);
  assert.equal(loaded.warning, undefined);
  assert.equal(loaded.filePath, filePath);
});

test('saves and loads a board losslessly', (t) => {
  const directory = tempDirectory(t);
  const filePath = join(directory, 'nested', 'board.json');
  const withTasks = addTask(
    createEmptyBoard(),
    { title: 'A tagged task', tags: ['work', 'urgent'] },
    { id: 'task-1', now: NOW },
  ).board;

  saveBoard(withTasks, filePath);
  const loaded = loadBoard(filePath);

  assert.equal(loaded.warning, undefined);
  assert.deepEqual(loaded.board, withTasks);
  assert.equal(loaded.board.columns.new[0]?.tags.join(','), 'work,urgent');

  const written = JSON.parse(readFileSync(filePath, 'utf8')) as {
    version: number;
    columns: { new: unknown[] };
  };
  assert.equal(written.version, 2);
  assert.equal(written.columns.new.length, 1);
  assert.deepEqual(
    readdirSync(join(directory, 'nested')).filter((file) => file.includes('.tmp-')),
    [],
  );
});

test('round-trips terminal sessions on tasks', (t) => {
  const directory = tempDirectory(t);
  const filePath = join(directory, 'board.json');
  const board = createEmptyBoard();
  board.columns.active = [
    {
      id: 'agent-task',
      title: 'Hand this to an agent',
      tags: ['work'],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      session: {
        provider: 'tmux',
        id: '@7',
        title: 'Qanban · Hand this to an agent',
        createdAt: NOW.toISOString(),
      },
    },
  ];

  saveBoard(board, filePath);
  const loaded = loadBoard(filePath);

  assert.deepEqual(loaded.board.columns.active[0]?.session, {
    provider: 'tmux',
    id: '@7',
    title: 'Qanban · Hand this to an agent',
    createdAt: NOW.toISOString(),
  });
});

test('migrates legacy inprogress columns to paused', (t) => {
  const directory = tempDirectory(t);
  const filePath = join(directory, 'board.json');
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      columns: {
        new: [],
        active: [],
        inprogress: [
          {
            id: 'legacy',
            title: 'Old work',
            tags: [],
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
          },
        ],
        completed: [],
      },
    }),
    'utf8',
  );

  const loaded = loadBoard(filePath);

  assert.equal(loaded.warning, undefined);
  assert.equal(loaded.board.columns.paused[0]?.title, 'Old work');
  assert.equal(loaded.board.columns.active.length, 0);
  assert.equal(countTasks(loaded.board), 1);
});

test('serializes only the supported task fields', () => {
  const board = createEmptyBoard();
  board.columns.completed = [
    {
      id: 'done',
      title: 'Complete me',
      tags: ['done'],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      extra: 'ignored',
    } as never,
  ];

  const parsed = JSON.parse(serializeBoard(board)) as {
    version: number;
    columns: { completed: Array<{ extra?: string }> };
  };

  assert.equal(parsed.version, 2);
  assert.equal(parsed.columns.completed[0]?.extra, undefined);
});

test('backs up a corrupt file and starts fresh with a warning', (t) => {
  const directory = tempDirectory(t);
  const filePath = join(directory, 'board.json');
  writeFileSync(filePath, '{ definitely not json', 'utf8');

  const loaded = loadBoard(filePath);

  assert.equal(countTasks(loaded.board), 0);
  assert.match(loaded.warning ?? '', /backup was saved/i);
  const files = readdirSync(directory);
  assert.ok(files.some((file) => file.includes('.corrupt-')));
});

test('skips invalid task entries while preserving valid ones', (t) => {
  const directory = tempDirectory(t);
  const filePath = join(directory, 'board.json');
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      columns: {
        new: [
          {
            id: 'valid',
            title: 'Keep me',
            tags: ['one'],
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
          },
          { id: 'missing-title', title: '   ' },
          null,
        ],
        active: [],
        paused: [],
        completed: [],
      },
    }),
    'utf8',
  );

  const loaded = loadBoard(filePath);

  assert.equal(loaded.board.columns.new.length, 1);
  assert.equal(loaded.board.columns.new[0]?.title, 'Keep me');
  assert.match(loaded.warning ?? '', /invalid task entries were skipped/i);
});

test('uses env overrides for the default data path', () => {
  const previousFile = process.env.QANBAN_DATA_FILE;
  const previousDir = process.env.QANBAN_DATA_DIR;

  try {
    process.env.QANBAN_DATA_FILE = 'C:\\temp\\custom-board.json';
    assert.match(defaultDataFile(), /custom-board\.json$/);

    delete process.env.QANBAN_DATA_FILE;
    process.env.QANBAN_DATA_DIR = 'C:\\temp\\qanban-data';
    assert.match(defaultDataFile(), /qanban-data[\\/]board\.json$/);
  } finally {
    if (previousFile === undefined) {
      delete process.env.QANBAN_DATA_FILE;
    } else {
      process.env.QANBAN_DATA_FILE = previousFile;
    }

    if (previousDir === undefined) {
      delete process.env.QANBAN_DATA_DIR;
    } else {
      process.env.QANBAN_DATA_DIR = previousDir;
    }
  }
});
