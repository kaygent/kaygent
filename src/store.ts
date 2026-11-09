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
  type TaskSourceRef,
} from './board';
import type { TerminalSession } from './terminal/types';

const BOARD_FILE_NAME = 'board.json';

export interface LoadedBoard {
  board: Board;
  filePath: string;
  warning?: string;
}

export function defaultDataDirectory(): string {
  if (process.env.KAYGENT_DATA_DIR) {
    return resolve(process.env.KAYGENT_DATA_DIR);
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'Kaygent');
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Kaygent');
  }

  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(configHome, 'kaygent');
}

export function defaultDataFile(): string {
  if (process.env.KAYGENT_DATA_FILE) {
    return resolve(process.env.KAYGENT_DATA_FILE);
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

function normalizeSession(value: unknown): TerminalSession | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (
    !nonEmptyString(candidate.provider) ||
    !nonEmptyString(candidate.id) ||
    !nonEmptyString(candidate.createdAt) ||
    Number.isNaN(Date.parse(candidate.createdAt))
  ) {
    return undefined;
  }

  const session: TerminalSession = {
    provider: candidate.provider.trim(),
    id: candidate.id.trim(),
    createdAt: new Date(candidate.createdAt).toISOString(),
  };

  for (const key of ['title', 'tabId', 'paneId', 'pidFile', 'windowName'] as const) {
    if (nonEmptyString(candidate[key])) {
      session[key] = (candidate[key] as string).trim();
    }
  }

  return session;
}

function normalizeSource(value: unknown): TaskSourceRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (!nonEmptyString(candidate.sourceName) || !nonEmptyString(candidate.itemId)) {
    return undefined;
  }

  const source: TaskSourceRef = {
    sourceName: candidate.sourceName.trim(),
    itemId: candidate.itemId.trim(),
  };

  if (nonEmptyString(candidate.url)) {
    source.url = candidate.url.trim();
  }

  return source;
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

  const task: Task = {
    id,
    title: candidate.title.replace(/\s+/g, ' ').trim(),
    tags: parseTags(rawTags),
    createdAt: validTimestamp(candidate.createdAt, now),
    updatedAt: validTimestamp(candidate.updatedAt, now),
  };

  if (nonEmptyString(candidate.description)) {
    task.description = candidate.description.trim();
  }

  if (nonEmptyString(candidate.parentId)) {
    task.parentId = candidate.parentId.trim();
  }

  const session = normalizeSession(candidate.session);
  if (session) {
    task.session = session;
  }

  const source = normalizeSource(candidate.source);
  if (source) {
    task.source = source;
  }

  return task;
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
    // Boards written before the "paused" rename used "inprogress".
    const source =
      stage === 'paused' && rawColumns.paused === undefined
        ? rawColumns.inprogress
        : rawColumns[stage];

    if (!Array.isArray(source)) {
      if (source !== undefined) {
        skipped += 1;
      }
      continue;
    }

    for (const item of source) {
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
    futureVersion: typeof raw.version === 'number' && raw.version > 2,
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
        'This board was written by a newer version of Kaygent. Unsupported fields were ignored.',
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
        ...(task.description ? { description: task.description } : {}),
        tags: task.tags,
        ...(task.parentId ? { parentId: task.parentId } : {}),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        ...(task.session
          ? {
              session: {
                provider: task.session.provider,
                id: task.session.id,
                ...(task.session.title ? { title: task.session.title } : {}),
                ...(task.session.tabId ? { tabId: task.session.tabId } : {}),
                ...(task.session.paneId ? { paneId: task.session.paneId } : {}),
                ...(task.session.pidFile ? { pidFile: task.session.pidFile } : {}),
                ...(task.session.windowName
                  ? { windowName: task.session.windowName }
                  : {}),
                createdAt: task.session.createdAt,
              },
            }
          : {}),
        ...(task.source
          ? {
              source: {
                sourceName: task.source.sourceName,
                itemId: task.source.itemId,
                ...(task.source.url ? { url: task.source.url } : {}),
              },
            }
          : {}),
      })),
    ]),
  );

  return `${JSON.stringify({ version: 2, columns }, null, 2)}\n`;
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
