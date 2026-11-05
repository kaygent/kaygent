import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createEmptyBoard,
  parseTags,
  STAGE_IDS,
  type Board,
  type Stage,
  type Task,
} from './board';

const BOARD_FILE_NAME = 'board.json';

export interface LoadedBoard {
  board: Board;
  filePath: string;
  warning?: string;
}

function defaultDataDirectory(): string {
  if (process.env.QANBAN_DATA_DIR) {
    return resolve(process.env.QANBAN_DATA_DIR);
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Qanban');
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Qanban');
  }

  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(configHome, 'qanban');
}

export function defaultDataFile(): string {
  if (process.env.QANBAN_DATA_FILE) {
    return resolve(process.env.QANBAN_DATA_FILE);
  }

  return join(defaultDataDirectory(), BOARD_FILE_NAME);
}

function validTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    return fallback;
  }

  return new Date(value).toISOString();
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeTask(
  value: unknown,
  now: string,
  usedIds: Set<string>,
): Task | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (!nonEmptyString(candidate.title)) {
    return undefined;
  }

  let id = nonEmptyString(candidate.id) ? candidate.id : randomUUID();
  if (usedIds.has(id)) {
    id = randomUUID();
  }
  usedIds.add(id);

  const rawTags =
    typeof candidate.tags === 'string' || Array.isArray(candidate.tags)
      ? (candidate.tags as string | string[])
      : [];

  return {
    id,
    title: candidate.title.replace(/\s+/g, ' ').trim(),
    tags: parseTags(rawTags),
    createdAt: validTimestamp(candidate.createdAt, now),
    updatedAt: validTimestamp(candidate.updatedAt, now),
  };
}

interface NormalizedBoard {
  board: Board;
  skipped: number;
  futureVersion: boolean;
}

function normalizeBoard(value: unknown): NormalizedBoard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The board file does not contain a board object.');
  }

  const raw = value as Record<string, unknown>;
  const rawColumns =
    raw.columns && typeof raw.columns === 'object' && !Array.isArray(raw.columns)
      ? (raw.columns as Record<string, unknown>)
      : {};

  if (!raw.columns || typeof raw.columns !== 'object') {
    throw new Error('The board file is missing its columns.');
  }

  const board = createEmptyBoard();
  const now = new Date().toISOString();
  const usedIds = new Set<string>();
  let skipped = 0;

  for (const stage of STAGE_IDS) {
    const list = rawColumns[stage];
    if (!Array.isArray(list)) {
      if (list !== undefined) {
        skipped += 1;
      }
      continue;
    }

    for (const item of list) {
      const task = normalizeTask(item, now, usedIds);
      if (task) {
        board.columns[stage as Stage].push(task);
      } else {
        skipped += 1;
      }
    }
  }

  return {
    board,
    skipped,
    futureVersion:
      typeof raw.version === 'number' && raw.version > 1,
  };
}

function backupCorruptFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.corrupt-${stamp}`;

  try {
    renameSync(filePath, backupPath);
    return backupPath;
  } catch {
    return undefined;
  }
}

export function loadBoard(filePath = defaultDataFile()): LoadedBoard {
  let rawText: string;

  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { board: createEmptyBoard(), filePath };
    }

    return {
      board: createEmptyBoard(),
      filePath,
      warning: `Could not read ${filePath}. Starting with an empty board.`,
    };
  }

  try {
    const parsed: unknown = JSON.parse(rawText.replace(/^﻿/, ''));
    const normalized = normalizeBoard(parsed);
    const warnings: string[] = [];

    if (normalized.futureVersion) {
      warnings.push(
        'This board was written by a newer version of Qanban. Unsupported fields were ignored.',
      );
    }

    if (normalized.skipped > 0) {
      warnings.push(
        `${normalized.skipped} invalid task ${normalized.skipped === 1 ? 'entry was' : 'entries were'} skipped while loading.`,
      );
    }

    return {
      board: normalized.board,
      filePath,
      warning: warnings.length > 0 ? warnings.join(' ') : undefined,
    };
  } catch {
    const backupPath = backupCorruptFile(filePath);
    return {
      board: createEmptyBoard(),
      filePath,
      warning: backupPath
        ? `The board file was unreadable, so a backup was saved as ${backupPath}.`
        : 'The board file was unreadable. Starting with an empty board.',
    };
  }
}

export function serializeBoard(board: Board): string {
  const columns = Object.fromEntries(
    STAGE_IDS.map((stage) => [
      stage,
      board.columns[stage].map((task) => ({
        id: task.id,
        title: task.title,
        tags: task.tags,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })),
    ]),
  );

  return `${JSON.stringify({ version: 1, columns }, null, 2)}\n`;
}

export function saveBoard(board: Board, filePath = defaultDataFile()): void {
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true });

  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  try {
    writeFileSync(temporaryPath, serializeBoard(board), 'utf8');
    try {
      chmodSync(temporaryPath, 0o600);
    } catch {
      // Permissions are best-effort (not meaningful on every filesystem).
    }
    renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Nothing to clean up.
    }
    throw error;
  }
}
