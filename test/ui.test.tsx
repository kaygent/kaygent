import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { App } from '../src/App';
import { addTask, createEmptyBoard, type Board } from '../src/board';

const VIEWPORT = { columns: 120, rows: 32 };

const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

function stripAnsi(value: string): string {
  return value
    .replace(/\u001B\[[0-9;]*m/g, '')
    .replace(/\u001B\][^\u0007]*\u0007/g, '');
}

function frame(app: ReturnType<typeof render>): string {
  return stripAnsi(app.lastFrame() ?? '');
}

async function press(
  app: ReturnType<typeof render>,
  input: string,
  ms = 100,
): Promise<void> {
  app.stdin.write(input);
  await delay(ms);
}

function boardWithTasks(): Board {
  let board = createEmptyBoard();
  board = addTask(
    board,
    { title: 'Alpha task', tags: ['work'] },
    { id: 'alpha', now: new Date('2026-01-01T10:00:00.000Z') },
  ).board;
  board = addTask(
    board,
    { title: 'Beta task', tags: ['home'] },
    { id: 'beta', now: new Date('2026-01-01T11:00:00.000Z') },
  ).board;
  board = addTask(
    board,
    { title: 'Gamma task' },
    { id: 'gamma', now: new Date('2026-01-01T12:00:00.000Z') },
  ).board;
  return board;
}

function mount(
  t: TestContext,
  board: Board,
  saveBoard?: (next: Board) => void,
  viewport = VIEWPORT,
): ReturnType<typeof render> {
  const app = render(
    <App
      initialBoard={board}
      saveBoard={saveBoard}
      viewport={viewport}
      initialNotice={{ text: 'Test board', tone: 'info' }}
    />,
  );

  t.after(() => {
    app.unmount();
    app.cleanup();
  });

  return app;
}

test('renders the kanban board with tasks, tags, and key hints', async (t) => {
  const app = mount(t, boardWithTasks());
  await delay(80);
  const output = frame(app);

  assert.match(output, /QANBAN/);
  assert.match(output, /◇ NEW/);
  assert.match(output, /◐ ACTIVE/);
  assert.match(output, /◑ IN PROGRESS/);
  assert.match(output, /✓ COMPLETED/);
  assert.match(output, /Alpha task/);
  assert.match(output, /#work/);
  assert.match(output, /←→ cols/);
});

test('adds a tagged task and autosaves it', async (t) => {
  const saves: Board[] = [];
  const app = mount(t, createEmptyBoard(), (next) => saves.push(next));

  await press(app, 'a');
  assert.match(frame(app), /NEW TASK/);
  assert.match(frame(app), /Added to the New column/);

  await press(app, 'Ship the beta');
  await press(app, '\t');
  await press(app, 'work launch');
  assert.match(frame(app), /work launch/);

  await press(app, '\r');
  await delay(150);

  const output = frame(app);
  assert.match(output, /Added “Ship the beta” to New\./);
  assert.match(output, /#work/);
  assert.match(output, /#launch/);
  assert.ok(saves.length >= 1);
  assert.equal(saves.at(-1)?.columns.new[0]?.title, 'Ship the beta');
});

test('edits tags from the board and preserves the task', async (t) => {
  const app = mount(t, boardWithTasks());

  await press(app, 't');
  const editFrame = frame(app);
  assert.match(editFrame, /EDIT TASK/);
  assert.match(editFrame, /work/);

  await press(app, ' urgent');
  await press(app, '\r');
  await delay(150);

  const output = frame(app);
  assert.match(output, /Updated “Alpha task”\./);
  assert.match(output, /#urgent/);
});

test('moves and deletes the selected task with confirmations', async (t) => {
  const saves: Board[] = [];
  const app = mount(t, boardWithTasks(), (next) => saves.push(next));

  await press(app, '>');
  assert.match(frame(app), /Moved “Alpha task” to Active\./);

  await press(app, 'd');
  assert.match(frame(app), /DELETE TASK/);
  assert.match(frame(app), /This action cannot be undone/);

  await press(app, 'y');
  await delay(120);
  assert.match(frame(app), /Deleted “Alpha task”\./);

  const latest = saves.at(-1);
  assert.equal(latest?.columns.active.some((task) => task.id === 'alpha'), false);
  assert.equal(latest?.columns.new.some((task) => task.id === 'beta'), true);
});

test('cancels deletion with n and keeps the task', async (t) => {
  const app = mount(t, boardWithTasks());

  await press(app, 'd');
  await press(app, 'n');
  await delay(100);
  const output = frame(app);

  assert.doesNotMatch(output, /DELETE TASK/);
  assert.match(output, /Alpha task/);
});

test('opens and closes the shortcut guide', async (t) => {
  const app = mount(t, boardWithTasks());

  await press(app, '?');
  assert.match(frame(app), /KEYBOARD SHORTCUTS/);
  assert.match(frame(app), /Esc \/ \? {2}close help/);

  await press(app, '?');
  await delay(100);
  assert.doesNotMatch(frame(app), /KEYBOARD SHORTCUTS/);
  assert.match(frame(app), /Alpha task/);
});

test('reorders a task within its column', async (t) => {
  const app = mount(t, boardWithTasks());

  await press(app, ']');
  assert.match(frame(app), /Moved “Alpha task” down\./);

  const output = frame(app);
  const betaIndex = output.indexOf('Beta task');
  const alphaIndex = output.indexOf('Alpha task');
  assert.ok(betaIndex > -1 && alphaIndex > betaIndex);
});

test('navigates tasks and advances stages with Space', async (t) => {
  const app = mount(t, boardWithTasks());

  await press(app, '\u001B[B');
  await press(app, ' ');
  assert.match(frame(app), /Moved “Beta task” to Active\./);

  await press(app, ' ');
  assert.match(frame(app), /Moved “Beta task” to In Progress\./);
});

test('returns to the New column after adding a task from another column', async (t) => {
  const app = mount(t, boardWithTasks());

  await press(app, '3');
  await press(app, 'a');
  await press(app, 'From anywhere');
  await press(app, '\r');
  await delay(120);

  const output = frame(app);
  assert.match(output, /Added “From anywhere” to New\./);
  assert.match(output, /From anywhere/);
});

test('works at the minimum supported compact size and cancels with Escape', async (t) => {
  const app = mount(t, boardWithTasks(), undefined, {
    columns: 70,
    rows: 24,
  });

  await delay(80);
  const initial = frame(app);
  assert.match(initial, /PROGRESS/);
  assert.match(initial, /Alpha task/);

  await press(app, 'a');
  assert.match(frame(app), /NEW TASK/);
  assert.match(frame(app), /Tab \/ ↑↓/);

  await press(app, '\u001B', 250);
  await delay(50);
  const closed = frame(app);
  assert.doesNotMatch(closed, /NEW TASK/);
  assert.match(closed, /Alpha task/);
});
