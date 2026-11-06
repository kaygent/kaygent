import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { App } from '../src/App';
import { addTask, createEmptyBoard, type Board } from '../src/board';
import type { TaskSourceSettings } from '../src/config';
import type {
  SourceSyncOptions,
  SourceSyncResult,
  TaskSourceService,
} from '../src/sources';
import type {
  SpawnTask,
  TerminalControl,
  TerminalSession,
} from '../src/terminal';

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
  terminal?: TerminalControl,
  taskSources?: TaskSourceService,
): ReturnType<typeof render> {
  const app = render(
    <App
      initialBoard={board}
      saveBoard={saveBoard}
      viewport={viewport}
      terminal={terminal}
      taskSources={taskSources}
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

  assert.match(output, /KAYGENT/);
  assert.match(output, /◇ NEW/);
  assert.match(output, /◐ ACTIVE/);
  assert.match(output, /◑ PAUSED/);
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
  assert.match(frame(app), /Moved “Beta task” to Paused\./);
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
  assert.match(initial, /PAUSED/);
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

interface FakeTerminalOptions {
  pauseBehavior?: 'keep' | 'close';
  focusOnEnter?: boolean;
  spawnError?: string;
  focusError?: string;
  closeError?: string;
}

function fakeTerminal(options: FakeTerminalOptions = {}): {
  controller: TerminalControl;
  calls: string[];
} {
  const calls: string[] = [];
  const controller: TerminalControl = {
    provider: 'wezterm',
    pauseBehavior: options.pauseBehavior ?? 'keep',
    focusOnEnter: options.focusOnEnter ?? true,
    spawn(task: SpawnTask) {
      calls.push(`spawn:${task.id}`);
      if (options.spawnError) {
        return { ok: false, error: options.spawnError };
      }
      return {
        ok: true,
        session: {
          provider: 'wezterm',
          id: 'pane-1',
          title: `Kaygent · ${task.title}`,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      };
    },
    spawnCommand() {
      return { ok: false, error: 'not used in UI tests' };
    },
    focus(session: TerminalSession) {
      calls.push(`focus:${session.id}`);
      return options.focusError
        ? { ok: false, error: options.focusError }
        : { ok: true };
    },
    close(session: TerminalSession) {
      calls.push(`close:${session.id}`);
      return options.closeError
        ? { ok: false, error: options.closeError }
        : { ok: true };
    },
  };

  return { controller, calls };
}

function boardWithActiveTask(session = false): Board {
  const board = boardWithTasks();
  const task = board.columns.new[0]!;
  return {
    ...board,
    columns: {
      ...board.columns,
      new: board.columns.new.slice(1),
      active: [
        session
          ? {
              ...task,
              session: {
                provider: 'wezterm',
                id: 'pane-1',
                title: `Kaygent · ${task.title}`,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            }
          : task,
      ],
    },
  };
}

test('launches a terminal on Active and focuses it with Enter', async (t) => {
  const saves: Board[] = [];
  const fake = fakeTerminal();
  const app = mount(
    t,
    boardWithTasks(),
    (next) => saves.push(next),
    VIEWPORT,
    fake.controller,
  );

  await press(app, '>');
  await delay(100);

  const output = frame(app);
  assert.match(output, /Launched wezterm for “Alpha task”\./);
  assert.match(output, /● live/);
  assert.deepEqual(fake.calls, ['spawn:alpha']);

  const activeTask = saves
    .at(-1)
    ?.columns.active.find((task) => task.id === 'alpha');
  assert.equal(activeTask?.session?.id, 'pane-1');

  await press(app, '\r');
  assert.match(frame(app), /Focused wezterm for “Alpha task”\./);
  assert.deepEqual(fake.calls, ['spawn:alpha', 'focus:pane-1']);
  assert.doesNotMatch(frame(app), /EDIT TASK/);
});

test('keeps the terminal open when a task is paused', async (t) => {
  const fake = fakeTerminal({ pauseBehavior: 'keep' });
  const app = mount(
    t,
    boardWithActiveTask(true),
    undefined,
    VIEWPORT,
    fake.controller,
  );

  await press(app, '2');
  await press(app, '>');

  assert.match(
    frame(app),
    /Moved “Alpha task” to Paused\. Terminal kept open\./,
  );
  assert.deepEqual(fake.calls, []);
  assert.match(frame(app), /● live/);
});

test('closes the terminal on pause when configured to close', async (t) => {
  const saves: Board[] = [];
  const fake = fakeTerminal({ pauseBehavior: 'close' });
  const app = mount(
    t,
    boardWithActiveTask(true),
    (next) => saves.push(next),
    VIEWPORT,
    fake.controller,
  );

  await press(app, '2');
  await press(app, '>');
  await delay(100);

  assert.match(frame(app), /Moved “Alpha task” to Paused\. Terminal closed\./);
  assert.deepEqual(fake.calls, ['close:pane-1']);
  const pausedTask = saves
    .at(-1)
    ?.columns.paused.find((task) => task.id === 'alpha');
  assert.equal(pausedTask?.session, undefined);
});

test('closes the terminal when a task is completed', async (t) => {
  const saves: Board[] = [];
  const fake = fakeTerminal({ pauseBehavior: 'keep' });
  const app = mount(
    t,
    boardWithActiveTask(true),
    (next) => saves.push(next),
    VIEWPORT,
    fake.controller,
  );

  await press(app, '2');
  await press(app, '>');
  await press(app, '>');
  await delay(100);

  assert.match(
    frame(app),
    /Completed “Alpha task”\. Terminal closed\./,
  );
  assert.deepEqual(fake.calls, ['close:pane-1']);
  const completedTask = saves
    .at(-1)
    ?.columns.completed.find((task) => task.id === 'alpha');
  assert.equal(completedTask?.session, undefined);
});

test('shows a warning when the terminal cannot be launched', async (t) => {
  const fake = fakeTerminal({ spawnError: 'wezterm is not installed' });
  const app = mount(
    t,
    boardWithTasks(),
    undefined,
    VIEWPORT,
    fake.controller,
  );

  await press(app, '>');
  assert.match(
    frame(app),
    /Could not launch a terminal: wezterm is not installed\./,
  );
});

test('Enter edits an active task that has no session', async (t) => {
  const app = mount(t, boardWithActiveTask(false));
  await press(app, '2');
  await press(app, '\r');
  assert.match(frame(app), /EDIT TASK/);
});

function sourceConfig(
  overrides: Partial<TaskSourceSettings> = {},
): TaskSourceSettings {
  return {
    sourceName: 'test',
    command: 'test-command',
    format: 'auto',
    tags: [],
    timeoutMs: 30_000,
    syncOnStart: false,
    refreshMinutes: 'never',
    runMode: 'background',
    ...overrides,
  };
}

function fakeSourceService(
  sync: (board: Board, options?: SourceSyncOptions) => SourceSyncResult,
  sources: TaskSourceSettings[] = [sourceConfig()],
): TaskSourceService {
  return { enabled: true, sources, sync };
}

function importedTask() {
  return {
    id: 'source:test:1',
    title: 'Imported task',
    tags: ['github'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: { sourceName: 'test', itemId: '1' },
  };
}

test('syncs task sources with r and adds new tasks', async (t) => {
  const saves: Board[] = [];
  const imported = importedTask();
  const sync = (board: Board): SourceSyncResult => ({
    board: {
      ...board,
      columns: {
        ...board.columns,
        new: [...board.columns.new, imported],
      },
    },
    added: [imported],
    skipped: 0,
    errors: [],
    syncedSources: 1,
  });

  const app = mount(
    t,
    createEmptyBoard(),
    (next) => saves.push(next),
    VIEWPORT,
    undefined,
    fakeSourceService(sync),
  );

  await press(app, 'r');
  await delay(100);

  assert.match(frame(app), /Imported 1 new task into New\./);
  assert.match(frame(app), /Imported task/);
  assert.equal(saves.at(-1)?.columns.new[0]?.id, 'source:test:1');
});

test('reports duplicate and invalid source items', async (t) => {
  const sync = (board: Board): SourceSyncResult => ({
    board,
    added: [],
    skipped: 2,
    errors: [],
    syncedSources: 1,
  });
  const app = mount(
    t,
    createEmptyBoard(),
    undefined,
    VIEWPORT,
    undefined,
    fakeSourceService(sync),
  );

  await press(app, 'r');
  assert.match(frame(app), /No new tasks found\./);
  assert.match(frame(app), /2 duplicate or invalid items skipped\./);
});

test('reports source command errors', async (t) => {
  const sync = (board: Board): SourceSyncResult => ({
    board,
    added: [],
    skipped: 0,
    errors: [{ sourceName: 'github', error: 'command failed: boom' }],
    syncedSources: 1,
  });
  const app = mount(
    t,
    createEmptyBoard(),
    undefined,
    VIEWPORT,
    undefined,
    fakeSourceService(sync),
  );

  await press(app, 'r');
  assert.match(frame(app), /Source errors: github: command failed: boom/);
});

test('refreshes scheduled sources automatically', async (t) => {
  const imported = importedTask();
  let calls = 0;
  const sync = (
    board: Board,
    options?: SourceSyncOptions,
  ): SourceSyncResult => {
    calls += 1;
    assert.equal(options?.sourceName, 'scheduled');
    if (calls > 1) {
      return {
        board,
        added: [],
        skipped: 0,
        errors: [],
        syncedSources: 1,
      };
    }
    return {
      board: {
        ...board,
        columns: {
          ...board.columns,
          new: [...board.columns.new, imported],
        },
      },
      added: [imported],
      skipped: 0,
      errors: [],
      syncedSources: 1,
    };
  };

  const app = mount(
    t,
    createEmptyBoard(),
    undefined,
    VIEWPORT,
    undefined,
    fakeSourceService(sync, [
      sourceConfig({ sourceName: 'scheduled', refreshMinutes: 0.001 }),
    ]),
  );

  await delay(350);

  assert.ok(calls >= 1);
  assert.match(
    frame(app),
    /Imported 1 new task from “scheduled”\./,
  );
  assert.match(frame(app), /Imported task/);
});

test('explains when no task sources are configured', async (t) => {
  const app = mount(t, createEmptyBoard());
  await press(app, 'r');
  assert.match(frame(app), /No task sources are configured\./);
});
