import { render } from 'ink';
import { basename } from 'node:path';
import { App } from './App';
import { defaultConfigFile, loadConfig } from './config';
import { createDemoBoard } from './demo';
import { createTaskSourceService } from './sources';
import { defaultDataFile, loadBoard, saveBoard } from './store';
import { runSelfTest } from './selftest';
import { createTerminalController } from './terminal';
import { applyStageOverrides } from './theme';
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
    '  e              edit the selected task (title and tags)',
    '  Enter          focus the terminal for an active task, otherwise edit',
    '  t              edit tags on the selected task',
    '  d / Delete     delete the selected task',
    '  < / > / Space  move a task between columns',
    '  [ / ]          reorder a task up or down',
    '  r              sync new tasks from configured sources',
    '  ?              open the keyboard guide',
    '  q              quit',
    '',
    'DATA',
    '  Tasks are saved automatically to:',
    `  ${defaultDataFile()}`,
    '',
    'CONFIG',
    '  Columns, terminal integration, and task sources are configured in:',
    `  ${defaultConfigFile()}`,
    '',
    '  Set QANBAN_DATA_FILE to use a specific board file, or',
    '  QANBAN_CONFIG_FILE for a specific config file. Set',
    '  QANBAN_NO_ALT=1 to disable the fullscreen terminal buffer.',
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

  const loadedConfig = loadConfig();
  applyStageOverrides(loadedConfig.config.columns);
  const terminal = options.demo
    ? undefined
    : createTerminalController(loadedConfig.config.terminal);
  const sourceService = options.demo
    ? undefined
    : createTaskSourceService(loadedConfig.config.taskSources, { terminal });

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
      let board = loaded.board;
      const warnings = [loadedConfig.warning, loaded.warning].filter(
        (value): value is string => Boolean(value),
      );
      let syncNote = '';

      if (sourceService?.enabled) {
        try {
          const outcome = sourceService.sync(board, { startupOnly: true });
          board = outcome.board;

          if (outcome.added.length > 0) {
            try {
              saveBoard(board, loaded.filePath);
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              warnings.push(`Could not save imported tasks: ${message}`);
            }
            syncNote = `Imported ${outcome.added.length} new task${outcome.added.length === 1 ? '' : 's'} from task sources.`;
          }

          if (outcome.errors.length > 0) {
            warnings.push(
              `Task sources: ${outcome.errors
                .map((error) => `${error.sourceName}: ${error.error}`)
                .join('; ')}`,
            );
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          warnings.push(`Could not sync task sources: ${message}`);
        }
      }

      initialBoard = board;
      saver = (saved) => saveBoard(saved, loaded.filePath);
      initialNotice =
        warnings.length > 0
          ? {
              text: [syncNote, ...warnings].filter(Boolean).join(' '),
              tone: 'warning' as const,
            }
          : syncNote
            ? { text: syncNote, tone: 'success' as const }
            : undefined;
    }

    const instance = render(
      <App
        initialBoard={initialBoard}
        saveBoard={saver}
        initialNotice={initialNotice}
        terminal={terminal}
        taskSources={sourceService?.enabled ? sourceService : undefined}
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
