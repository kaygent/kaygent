import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { STAGE_IDS } from '../src/board';
import {
  DEFAULT_CONFIG,
  loadConfig,
  parseConfig,
  splitCommandLine,
} from '../src/config';
import { applyStageOverrides, stageUi } from '../src/theme';

function tempDirectory(t: test.TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'qanban-config-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('splits command strings with quotes and escapes', () => {
  assert.deepEqual(splitCommandLine('claude --model sonnet'), [
    'claude',
    '--model',
    'sonnet',
  ]);
  assert.deepEqual(splitCommandLine(`claude "fix the login bug"`), [
    'claude',
    'fix the login bug',
  ]);
  assert.deepEqual(splitCommandLine(`sh -c 'echo "hi there"'`), [
    'sh',
    '-c',
    'echo "hi there"',
  ]);
});

test('returns defaults for missing files', (t) => {
  const directory = tempDirectory(t);
  const loaded = loadConfig(join(directory, 'config.json'));

  assert.equal(loaded.exists, false);
  assert.equal(loaded.warning, undefined);
  assert.deepEqual(loaded.config, DEFAULT_CONFIG);
});

test('parses column and terminal overrides', () => {
  const { config, warnings } = parseConfig({
    columns: {
      active: {
        label: 'DOING',
        shortLabel: 'DO',
        glyph: '▶',
        color: '#22c55e',
      },
      paused: { label: 'WAITING', color: 'not-a-color' },
    },
    terminal: {
      provider: 'wezterm',
      command: 'claude --model sonnet {title}',
      cwd: 'work',
      title: 'Task · {title}',
      newWindow: true,
      pauseBehavior: 'close',
      focusOnEnter: false,
      custom: { spawn: 'my-term {title}', focus: 'my-term focus {session}' },
    },
  });

  assert.deepEqual(warnings, ['columns.paused.color must be a #rgb or #rrggbb value.']);
  assert.equal(config.columns.active?.label, 'DOING');
  assert.equal(config.columns.active?.color, '#22c55e');
  assert.equal(config.columns.paused?.label, 'WAITING');
  assert.equal(config.columns.paused?.color, undefined);
  assert.equal(config.terminal.provider, 'wezterm');
  assert.deepEqual(config.terminal.command, [
    'claude',
    '--model',
    'sonnet',
    '{title}',
  ]);
  assert.equal(config.terminal.cwd, resolve(process.cwd(), 'work'));
  assert.equal(config.terminal.title, 'Task · {title}');
  assert.equal(config.terminal.newWindow, true);
  assert.equal(config.terminal.pauseBehavior, 'close');
  assert.equal(config.terminal.focusOnEnter, false);
  assert.equal(config.terminal.custom.spawn, 'my-term {title}');
  assert.equal(config.terminal.custom.focus, 'my-term focus {session}');
  assert.equal(config.terminal.custom.close, '');
});

test('falls back safely for invalid values', () => {
  const { config, warnings } = parseConfig({
    terminal: {
      provider: 'screen',
      command: ['claude', 42],
      pauseBehavior: 'sometimes',
    },
  });

  assert.equal(config.terminal.provider, 'auto');
  assert.deepEqual(config.terminal.command, ['claude']);
  assert.equal(config.terminal.pauseBehavior, 'keep');
  assert.match(warnings.join(' '), /terminal\.provider must be one of/);
  assert.match(warnings.join(' '), /non-string entries/);
  assert.match(warnings.join(' '), /pauseBehavior/);
});

test('applies column appearance overrides', () => {
  const before = Object.fromEntries(
    STAGE_IDS.map((stage) => [stage, { ...stageUi[stage] }]),
  ) as typeof stageUi;

  try {
    applyStageOverrides({
      active: { label: 'DOING', shortLabel: 'DO', glyph: '▶', color: '#22c55e' },
      paused: { label: '' },
    });

    assert.equal(stageUi.active.label, 'DOING');
    assert.equal(stageUi.active.shortLabel, 'DO');
    assert.equal(stageUi.active.glyph, '▶');
    assert.equal(stageUi.active.color, '#22c55e');
    assert.equal(stageUi.paused.label, 'PAUSED');
  } finally {
    for (const stage of STAGE_IDS) {
      Object.assign(stageUi[stage], before[stage]);
    }
  }
});

test('reports invalid JSON without losing defaults', (t) => {
  const directory = tempDirectory(t);
  const filePath = join(directory, 'config.json');
  writeFileSync(filePath, '{ nope', 'utf8');

  const loaded = loadConfig(filePath);

  assert.equal(loaded.exists, true);
  assert.match(loaded.warning ?? '', /not valid JSON/i);
  assert.deepEqual(loaded.config, DEFAULT_CONFIG);
});
