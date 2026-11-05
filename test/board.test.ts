import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addTask,
  collectTags,
  countOpenTasks,
  countTasks,
  createEmptyBoard,
  moveTask,
  normalizeTitle,
  parseTags,
  previousStage,
  nextStage,
  removeTask,
  reorderTask,
  setTaskSession,
  updateTask,
  type Stage,
} from '../src/board';

const NOW = new Date('2026-01-02T03:04:05.000Z');

function taskTitle(
  board: ReturnType<typeof createEmptyBoard>,
  stage: Stage,
  index = 0,
): string {
  return board.columns[stage][index]?.title ?? '';
}

test('normalizes titles and parses tags', () => {
  assert.equal(normalizeTitle('  Buy   oat milk  '), 'Buy oat milk');
  assert.deepEqual(parseTags('#Work, urgent  home, WORK  #deep-work'), [
    'Work',
    'urgent',
    'home',
    'deep-work',
  ]);
  assert.deepEqual(parseTags(undefined), []);
});

test('adds tasks to New with tags and timestamps', () => {
  const a = addTask(
    createEmptyBoard(),
    { title: '  Plan   launch  ', tags: 'work, urgent' },
    { id: 'task-a', now: NOW },
  );
  const b = addTask(a.board, { title: 'Write notes' }, { id: 'task-b', now: NOW });

  assert.deepEqual(a.board.columns.new[0], {
    id: 'task-a',
    title: 'Plan launch',
    tags: ['work', 'urgent'],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  assert.equal(a.index, 0);
  assert.equal(b.index, 1);
  assert.equal(countTasks(b.board), 2);
  assert.equal(countOpenTasks(b.board), 2);
  assert.equal(a.board.columns.new.length, 1, 'source board is not mutated');
});

test('rejects empty titles', () => {
  assert.throws(() => addTask(createEmptyBoard(), { title: '   ' }), /needs a title/i);
});

test('uses the four default workflow stages', () => {
  const board = createEmptyBoard();
  assert.equal(board.version, 2);
  assert.deepEqual(Object.keys(board.columns), [
    'new',
    'active',
    'paused',
    'completed',
  ]);
});

test('attaches and clears terminal sessions without losing task data', () => {
  const added = addTask(
    createEmptyBoard(),
    { title: 'Agent task', tags: 'work' },
    { id: 'task-session', now: NOW },
  );
  const session = {
    provider: 'wezterm',
    id: '3',
    title: 'Qanban · Agent task',
    createdAt: NOW.toISOString(),
  };

  const withSession = setTaskSession(
    added.board,
    'new',
    'task-session',
    session,
  );
  assert.deepEqual(withSession.columns.new[0]?.session, session);
  assert.equal(withSession.columns.new[0]?.title, 'Agent task');

  const cleared = setTaskSession(
    withSession,
    'new',
    'task-session',
    undefined,
  );
  assert.equal('session' in (cleared.columns.new[0] ?? {}), false);
  assert.equal(
    setTaskSession(cleared, 'new', 'missing', session),
    cleared,
  );
});

test('updates title and tags without changing creation time', () => {
  const added = addTask(
    createEmptyBoard(),
    { title: 'Draft' },
    { id: 'task-a', now: NOW },
  );
  const later = new Date('2026-01-02T04:00:00.000Z');
  const updated = updateTask(
    added.board,
    'new',
    0,
    { title: 'Final draft', tags: '#docs, release' },
    { now: later },
  );

  assert.equal(updated.columns.new[0]?.title, 'Final draft');
  assert.deepEqual(updated.columns.new[0]?.tags, ['docs', 'release']);
  assert.equal(updated.columns.new[0]?.createdAt, NOW.toISOString());
  assert.equal(updated.columns.new[0]?.updatedAt, later.toISOString());
});

test('deletes tasks and leaves other columns untouched', () => {
  const added = addTask(createEmptyBoard(), { title: 'One' }, { id: 'one', now: NOW });
  const withTwo = addTask(added.board, { title: 'Two' }, { id: 'two', now: NOW });
  const moved = moveTask(withTwo.board, 'new', 1, 'active');

  const deleted = removeTask(moved.board, 'new', 0);
  assert.equal(deleted.columns.new.length, 0);
  assert.equal(deleted.columns.active.length, 1);
  assert.equal(taskTitle(deleted, 'active'), 'Two');
});

test('moves a task between columns without mutating the old board', () => {
  let board = createEmptyBoard();
  board = addTask(board, { title: 'A' }, { id: 'a', now: NOW }).board;
  board = addTask(board, { title: 'B' }, { id: 'b', now: NOW }).board;
  board = addTask(board, { title: 'C' }, { id: 'c', now: NOW }).board;

  const moved = moveTask(
    board,
    'new',
    1,
    'paused',
    undefined,
    { now: new Date('2026-01-02T05:00:00.000Z') },
  );

  assert.equal(moved.moved, true);
  assert.equal(moved.toIndex, 0);
  assert.deepEqual(moved.board.columns.new.map((task) => task.title), ['A', 'C']);
  assert.deepEqual(moved.board.columns.paused.map((task) => task.title), ['B']);
  assert.deepEqual(board.columns.new.map((task) => task.title), ['A', 'B', 'C']);
});

test('moves a task to a specific index in another column', () => {
  const empty = createEmptyBoard();
  const source = addTask(empty, { title: 'Move me' }, { id: 'm', now: NOW }).board;
  const active1 = addTask(source, { title: 'First' }, { id: '1', now: NOW }).board;
  const active2 = addTask(active1, { title: 'Second' }, { id: '2', now: NOW }).board;

  const board: typeof active2 = {
    ...active2,
    columns: {
      ...active2.columns,
      new: [source.columns.new[0]!],
      active: [active1.columns.new[1]!, active2.columns.new[2]!],
    },
  };

  const moved = moveTask(board, 'new', 0, 'active', 1);
  assert.deepEqual(moved.board.columns.active.map((task) => task.title), [
    'First',
    'Move me',
    'Second',
  ]);
  assert.equal(moved.toIndex, 1);
});

test('reorders within a column and respects boundaries', () => {
  let board = createEmptyBoard();
  for (const title of ['A', 'B', 'C']) {
    board = addTask(board, { title }, { now: NOW }).board;
  }

  const down = reorderTask(board, 'new', 0, 1);
  assert.equal(down.moved, true);
  assert.equal(down.index, 1);
  assert.deepEqual(down.board.columns.new.map((task) => task.title), ['B', 'A', 'C']);

  const up = reorderTask(down.board, 'new', 1, -1);
  assert.deepEqual(up.board.columns.new.map((task) => task.title), ['A', 'B', 'C']);

  const blocked = reorderTask(board, 'new', 0, -1);
  assert.equal(blocked.moved, false);
  assert.equal(blocked.board, board);
});

test('returns adjacent stages and collects unique tags', () => {
  assert.equal(nextStage('new'), 'active');
  assert.equal(nextStage('completed'), undefined);
  assert.equal(previousStage('new'), undefined);
  assert.equal(previousStage('completed'), 'paused');

  let board = createEmptyBoard();
  board = addTask(board, { title: 'One', tags: 'work, Home' }, { now: NOW }).board;
  board = addTask(board, { title: 'Two', tags: 'home, urgent' }, { now: NOW }).board;
  assert.deepEqual(collectTags(board), ['Home', 'urgent', 'work']);
});

test('handles missing task indices defensively', () => {
  const board = createEmptyBoard();
  assert.equal(updateTask(board, 'new', 99, { title: 'x' }), board);
  assert.equal(removeTask(board, 'new', 99), board);
  assert.equal(reorderTask(board, 'new', 99, 1).moved, false);
  assert.equal(moveTask(board, 'new', 99, 'active').moved, false);
});
