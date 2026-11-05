import React from 'react';
import { renderToString } from 'ink';
import { App } from '../src/App';
import { createEmptyBoard } from '../src/board';
import { createDemoBoard } from '../src/demo';

const columns = Number(process.argv[2] || 120);
const rows = Number(process.argv[3] || 32);
const empty = process.argv.includes('--empty');
const output = renderToString(
  <App
    initialBoard={
      empty
        ? createEmptyBoard()
        : createDemoBoard(new Date('2026-01-01T12:00:00.000Z'))
    }
    viewport={{ columns, rows }}
    saveBoard={() => {}}
  />,
  { columns },
);

process.stdout.write(
  `${output.replace(/\u001B\[[0-9;]*m/g, '').replace(/\u001B\][^\u0007]*\u0007/g, '')}\n`,
);
