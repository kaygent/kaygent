import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToString } from 'ink';
import { App } from './App';
import { countTasks, moveTask, STAGE_IDS } from './board';
import { createDemoBoard } from './demo';
import { loadBoard, saveBoard } from './store';

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, '');
}

export function runSelfTest(): { lines: string[] } {
  const directory = mkdtempSync(join(tmpdir(), 'qanban-selftest-'));
  const filePath = join(directory, 'board.json');
  const demo = createDemoBoard(new Date('2026-01-01T12:00:00.000Z'));

  try {
    saveBoard(demo, filePath);
    const loaded = loadBoard(filePath);

    if (loaded.warning) {
      throw new Error(`Storage round-trip warning: ${loaded.warning}`);
    }

    if (countTasks(loaded.board) !== countTasks(demo)) {
      throw new Error('Storage round-trip lost tasks.');
    }

    const moved = moveTask(
      loaded.board,
      'new',
      0,
      'paused',
      undefined,
      { now: new Date('2026-01-01T12:00:00.000Z') },
    );
    if (!moved.moved || moved.board.columns.paused.length === 0) {
      throw new Error('Task move check failed.');
    }

    const output = stripAnsi(
      renderToString(
        <App
          initialBoard={demo}
          viewport={{ columns: 120, rows: 32 }}
          initialNotice={{
            text: 'Self-test board',
            tone: 'info',
          }}
        />,
        { columns: 120 },
      ),
    );

    for (const expected of [
      'QANBAN',
      'NEW',
      'ACTIVE',
      'PAUSED',
      'COMPLETED',
      'Refine shortcuts',
      '#design',
    ]) {
      if (!output.includes(expected)) {
        throw new Error(`Rendered output is missing “${expected}”.`);
      }
    }

    for (const stage of STAGE_IDS) {
      if (!demo.columns[stage]) {
        throw new Error(`Missing board stage: ${stage}`);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  return {
    lines: [
      'Qanban self-test passed.',
      '  ✓ React terminal UI rendered',
      '  ✓ Board storage saved and reloaded',
      '  ✓ Task movement logic verified',
    ],
  };
}
