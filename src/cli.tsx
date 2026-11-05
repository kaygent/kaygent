import { render } from 'ink';
import { basename } from 'node:path';
import { App } from './App';
import { createDemoBoard } from './demo';
import { defaultDataFile, loadBoard, saveBoard } from './store';
import { runSelfTest } from './selftest';
import { APP_NAME, VERSION } from './version';

interface Options {
  demo: boolean;
  noAlt: boolean;
  selftest: boolean;
  help: boolean;
  version: boolean;
}

const ENTER_ALT_SCREEN = '\u001B[?1049h\u001B[?25l\u001B[2J\u001B[H';
const LEAVE_ALT_SCREEN = '\u001B[?25h\u001B[?1049l';

function parseOptions(argv: string[]): { options: Options; unknown?: string } {
  const options: Options = {
    demo: false,
    noAlt: false,
    selftest: false,
    help: false,
    version: false,
  };

  for (const argument of argv) {
    switch (argument) {
      case '--demo':
        options.demo = true;
        break;
      case '--no-alt':
        options.noAlt = true;
        break;
      case '--selftest':
        options.selftest = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--version':
      case '-v':
        options.version = true;
        break;
      default:
        return { options, unknown: argument };
    }
  }

  return { options };
}

function commandName(): string {
  const executable = basename(process.argv[1] || '');
  return executable.toLowerCase().endsWith('.exe') ? executable : APP_NAME;
}

function helpText(): string {
  return [
    `${APP_NAME} ${VERSION} — a React-powered terminal kanban todo board`,
    '',
    'USAGE',
    `  ${commandName()} [options]`,
    '',
    'OPTIONS',
    '  --demo        Open a sample board; nothing is saved',
    '  --no-alt      Draw inline instead of using the fullscreen buffer',
    '  --selftest    Verify the bundled UI and storage, then exit',
    '  -v, --version Show the version',
    '  -h, --help    Show this help',
    '',
    'CONTROLS',
    '  ←/→, Tab       switch columns (1–4 jump directly)',
    '  ↑/↓            select a task (Page Up/Down jumps five)',
    '  a              add a task to New',
    '  e / Enter      edit the selected task (title and tags)',
    '  t              edit tags on the selected task',
    '  d / Delete     delete the selected task',
    '  < / > / Space  move a task between columns',
    '  [ / ]          reorder a task up or down',
    '  ?              open the keyboard guide',
    '  q              quit',
    '',
    'DATA',
    '  Tasks are saved automatically to:',
    `  ${defaultDataFile()}`,
    '',
    '  Set QANBAN_DATA_FILE to use a specific file, or QANBAN_DATA_DIR',
    '  to use a specific directory. Set QANBAN_NO_ALT=1 to disable the',
    '  fullscreen terminal buffer.',
    '',
  ].join('\n');
}

function printError(message: string): void {
  process.stderr.write(`\n${message}\n\n${helpText()}`);
}

async function main(): Promise<void> {
  const { options, unknown } = parseOptions(process.argv.slice(2));

  if (unknown) {
    printError(`Unknown option: ${unknown}`);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  if (options.version) {
    process.stdout.write(`${APP_NAME} ${VERSION}\n`);
    return;
  }

  if (options.selftest) {
    const result = runSelfTest();
    process.stdout.write(`${result.lines.join('\n')}\n`);
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      '\nQanban needs an interactive terminal.\n' +
        'Open Windows Terminal (or PowerShell), run Qanban.exe there, and try again.\n' +
        'Use --help for options, or --selftest for a non-interactive check.\n\n',
    );
    process.exitCode = 1;
    return;
  }

  const useAltScreen =
    !options.noAlt &&
    process.env.QANBAN_NO_ALT !== '1' &&
    process.stdout.isTTY;

  let restored = false;

  const restoreTerminal = () => {
    if (!restored) {
      restored = true;
      if (useAltScreen) {
        process.stdout.write(LEAVE_ALT_SCREEN);
      }
    }
  };

  process.once('exit', restoreTerminal);

  if (useAltScreen) {
    process.stdout.write(ENTER_ALT_SCREEN);
  }

  try {
    let initialBoard;
    let initialNotice;
    let saver: ((board: import('./board').Board) => void) | undefined;

    if (options.demo) {
      initialBoard = createDemoBoard();
      initialNotice = {
        text: 'Demo mode — changes stay in this window and are not saved.',
        tone: 'info' as const,
      };
    } else {
      const loaded = loadBoard();
      initialBoard = loaded.board;
      saver = (board) => saveBoard(board, loaded.filePath);
      initialNotice = loaded.warning
        ? {
            text: loaded.warning,
            tone: 'warning' as const,
          }
        : undefined;
    }

    const instance = render(
      <App
        initialBoard={initialBoard}
        saveBoard={saver}
        initialNotice={initialNotice}
      />,
      {
        exitOnCtrlC: true,
        patchConsole: false,
      },
    );

    await instance.waitUntilExit();
  } catch (error) {
    restoreTerminal();
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`\nQanban stopped unexpectedly:\n${message}\n\n`);
    process.exitCode = 1;
    return;
  } finally {
    restoreTerminal();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`\nQanban failed to start:\n${message}\n\n`);
  process.exitCode = 1;
});
