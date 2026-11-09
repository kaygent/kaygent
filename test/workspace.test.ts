import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Task } from '../src/board';
import { createWorkspaceService } from '../src/workspace';
import type { TerminalControl, TerminalSession } from '../src/terminal';

const NOW = new Date('2026-11-09T10:00:00.000Z');

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Fix login',
    description: 'The login form times out.',
    tags: ['work'],
    parentId: 'parent-9',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function fakeTerminal(): {
  terminal: TerminalControl;
  calls: Array<{
    command: readonly string[];
    title?: string;
    cwd?: string;
  }>;
} {
  const calls: Array<{
    command: readonly string[];
    title?: string;
    cwd?: string;
  }> = [];
  const session: TerminalSession = {
    provider: 'fake',
    id: 'workspace-1',
    title: 'Kaygent workspace · Fix login',
    createdAt: NOW.toISOString(),
  };

  return {
    calls,
    terminal: {
      provider: 'fake',
      pauseBehavior: 'keep',
      focusOnEnter: true,
      spawn: () => ({ ok: false, error: 'not used' }),
      spawnCommand(command, options) {
        calls.push({
          command,
          title: options?.title,
          cwd: options?.cwd,
        });
        return { ok: true, session };
      },
      focus: () => ({ ok: true }),
      close: () => ({ ok: true }),
    },
  };
}

test('writes the task file and runs the workspace script in its root', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'kaygent-workspace-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'workspaces');
  const { terminal, calls } = fakeTerminal();
  const service = createWorkspaceService(
    { root, command: ['workspace-script'] },
    { terminal, tmpDir: directory, now: () => NOW },
  );

  const result = service.activate(task(), 'new', 'active');

  assert.equal(service.enabled, true);
  assert.equal(result.ok, true);
  assert.equal(result.session?.provider, 'fake');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.cwd, root);
  assert.deepEqual(calls[0]?.command.slice(0, -1), ['workspace-script']);

  const taskFile = calls[0]?.command.at(-1);
  assert.ok(taskFile);
  assert.equal(existsSync(taskFile), true);

  const payload = JSON.parse(readFileSync(taskFile, 'utf8'));
  assert.equal(payload.previousStage, 'new');
  assert.equal(payload.stage, 'active');
  assert.equal(payload.workspaceRoot, root);
  assert.equal(payload.taskFile, taskFile);
  assert.equal(payload.generatedAt, NOW.toISOString());
  assert.deepEqual(payload.task, {
    id: 'task-1',
    title: 'Fix login',
    description: 'The login form times out.',
    tags: ['work'],
    parentId: 'parent-9',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
});

test('supports an explicit {taskFile} placeholder', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'kaygent-workspace-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { terminal, calls } = fakeTerminal();
  const service = createWorkspaceService(
    {
      root: join(directory, 'workspaces'),
      command: ['node', 'script.js', '--input', '{taskFile}'],
    },
    { terminal, tmpDir: directory },
  );

  const result = service.activate(task(), 'new', 'active');

  assert.equal(result.ok, true);
  const command = calls[0]?.command ?? [];
  assert.equal(command.length, 4);
  assert.deepEqual(command.slice(0, 3), ['node', 'script.js', '--input']);
  assert.match(command[3] ?? '', /task\.json$/);
});

test('does not activate without a command or terminal', () => {
  const withoutCommand = createWorkspaceService(
    { root: '/work', command: [] },
    { terminal: fakeTerminal().terminal },
  );
  const withoutTerminal = createWorkspaceService(
    { root: '/work', command: ['script'] },
    {},
  );

  assert.equal(withoutCommand.enabled, false);
  assert.equal(withoutTerminal.enabled, false);
  assert.equal(
    withoutCommand.activate(task(), 'new', 'active').ok,
    false,
  );
  assert.equal(
    withoutTerminal.activate(task(), 'new', 'active').ok,
    false,
  );
});

test('activates only for New to Active transitions', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'kaygent-workspace-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { terminal, calls } = fakeTerminal();
  const service = createWorkspaceService(
    { root: join(directory, 'workspaces'), command: ['script'] },
    { terminal, tmpDir: directory },
  );

  const paused = service.activate(task(), 'paused', 'active');
  assert.equal(paused.ok, false);
  assert.match(paused.error ?? '', /New to Active/);
  assert.equal(calls.length, 0);
});
