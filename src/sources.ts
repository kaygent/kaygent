import { createHash } from 'node:crypto';
import {
  normalizeTitle,
  parseTags,
  STAGE_IDS,
  type Board,
  type Task,
  type TaskSourceRef,
} from './board';
import type { SourceFormat, TaskSourceSettings } from './config';
import {
  defaultShellRun,
  failureMessage,
  type ShellRunner,
} from './terminal/command';

export interface SourceError {
  sourceName: string;
  error: string;
}

export interface SourceSyncResult {
  board: Board;
  added: Task[];
  skipped: number;
  errors: SourceError[];
  syncedSources: number;
}

export interface SourceSyncOptions {
  /** Only run sources with syncOnStart enabled. */
  startupOnly?: boolean;
}

export interface SourceDeps {
  runShell: ShellRunner;
  now: () => Date;
  cwd: string;
}

export interface TaskSourceService {
  readonly enabled: boolean;
  readonly sources: readonly TaskSourceSettings[];
  sync(board: Board, options?: SourceSyncOptions): SourceSyncResult;
}

type ItemKind = 'messages' | 'tasks';

const ID_KEYS = [
  'id',
  'uid',
  'guid',
  'messageId',
  'message_id',
  'message_id_str',
  'key',
  'issueKey',
  'issue_key',
  'number',
  'ts',
  'message_ts',
] as const;

const TITLE_KEYS = ['title', 'subject', 'summary', 'name'] as const;

const BODY_KEYS = [
  'body',
  'text',
  'content',
  'message',
  'description',
  'snippet',
] as const;

const URL_KEYS = [
  'url',
  'html_url',
  'web_url',
  'permalink',
  'link',
  'href',
] as const;

const DATE_KEYS = [
  'createdAt',
  'created_at',
  'created',
  'timestamp',
  'date',
] as const;

const TAG_KEYS = ['tags', 'labels', 'tag', 'label', 'topics'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function readTags(record: Record<string, unknown>): string[] {
  for (const key of TAG_KEYS) {
    const value = record[key];
    const pieces: string[] = [];

    if (typeof value === 'string') {
      pieces.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          pieces.push(item);
        } else if (isRecord(item)) {
          const label = readString(item, ['name', 'label', 'value', 'title']);
          if (label) {
            pieces.push(label);
          }
        }
      }
    }

    if (pieces.length > 0) {
      return parseTags(pieces);
    }
  }

  return [];
}

function readDate(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
      const date = new Date(milliseconds);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
      continue;
    }

    if (typeof value === 'string' && value.trim()) {
      const trimmed = value.trim();
      if (/^\d{10}$/.test(trimmed)) {
        return new Date(Number(trimmed) * 1000).toISOString();
      }
      if (/^\d{13}$/.test(trimmed)) {
        return new Date(Number(trimmed)).toISOString();
      }
      const timestamp = Date.parse(trimmed);
      if (!Number.isNaN(timestamp)) {
        return new Date(timestamp).toISOString();
      }
    }
  }

  return undefined;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

function truncateTitle(value: string): string {
  const characters = Array.from(value);
  return characters.length > 200
    ? `${characters.slice(0, 199).join('')}…`
    : value;
}

function deriveTitle(
  record: Record<string, unknown>,
  kind: ItemKind,
): string {
  const direct = readString(record, TITLE_KEYS);
  if (direct) {
    return truncateTitle(normalizeTitle(direct));
  }

  if (kind === 'messages') {
    const body = readString(record, BODY_KEYS);
    if (body) {
      const firstLine =
        body
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean) ?? '';
      if (firstLine) {
        return truncateTitle(normalizeTitle(firstLine));
      }
    }
  }

  return '';
}

interface ItemKey {
  /** Key used in the deterministic task id. */
  key: string;
  /** Value stored in task.source.itemId. */
  itemId: string;
}

function itemKey(
  sourceName: string,
  record: Record<string, unknown>,
  kind: ItemKind,
  title: string,
  body: string | undefined,
  url: string | undefined,
): ItemKey | undefined {
  const rawId = readString(record, ID_KEYS);
  if (rawId) {
    const itemId =
      rawId.length <= 120 ? rawId : `h:${hash(rawId)}`;
    return { key: itemId, itemId };
  }

  // A tasks feed is expected to provide stable ids and do its own
  // deduplication. A messages feed can fall back to a content hash.
  if (kind === 'tasks') {
    return undefined;
  }

  const contentHash = hash(
    `${sourceName}\u0000${title}\u0000${body ?? ''}\u0000${url ?? ''}`,
  );
  return { key: `h:${contentHash}`, itemId: `h:${contentHash}` };
}

export function convertSourceItem(
  source: TaskSourceSettings,
  item: unknown,
  kind: ItemKind,
  now: Date,
): Task | undefined {
  if (!isRecord(item)) {
    return undefined;
  }

  const title = deriveTitle(item, kind);
  if (!title) {
    return undefined;
  }

  const body = readString(item, BODY_KEYS);
  const url = readString(item, URL_KEYS);
  const key = itemKey(source.sourceName, item, kind, title, body, url);
  if (!key) {
    return undefined;
  }

  const createdAt = readDate(item, DATE_KEYS) ?? now.toISOString();
  const sourceRef: TaskSourceRef = {
    sourceName: source.sourceName,
    itemId: key.itemId,
    ...(url ? { url } : {}),
  };

  return {
    id: `source:${source.sourceName}:${key.key}`,
    title,
    tags: parseTags([...source.tags, ...readTags(item)]),
    createdAt,
    updatedAt: now.toISOString(),
    source: sourceRef,
  };
}

export function extractSourceItems(
  payload: unknown,
  format: SourceFormat,
):
  | { kind: ItemKind; items: unknown[] }
  | { error: string } {
  if (Array.isArray(payload)) {
    return {
      kind: format === 'tasks' ? 'tasks' : 'messages',
      items: payload,
    };
  }

  if (isRecord(payload)) {
    if (Array.isArray(payload.tasks)) {
      return { kind: 'tasks', items: payload.tasks };
    }
    if (Array.isArray(payload.messages)) {
      return { kind: 'messages', items: payload.messages };
    }
    if (Array.isArray(payload.items)) {
      return {
        kind: format === 'tasks' ? 'tasks' : 'messages',
        items: payload.items,
      };
    }
  }

  return {
    error:
      'expected a JSON array or an object with a "messages", "tasks", or "items" array.',
  };
}

function runSource(
  source: TaskSourceSettings,
  deps: SourceDeps,
): { kind: ItemKind; items: unknown[] } | { error: string } {
  const result = deps.runShell(source.command, {
    cwd: source.cwd ?? deps.cwd,
    timeoutMs: source.timeoutMs,
  });

  if (result.error || result.status !== 0) {
    return {
      error: failureMessage(`${source.sourceName} command failed`, result),
    };
  }

  const output = result.stdout.replace(/^﻿/, '').trim();
  if (!output) {
    return { error: `${source.sourceName} returned no output.` };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: `${source.sourceName} returned invalid JSON: ${message}`,
    };
  }

  const extracted = extractSourceItems(payload, source.format);
  if ('error' in extracted) {
    return { error: `${source.sourceName} ${extracted.error}` };
  }

  return extracted;
}

export function syncTaskSources(
  board: Board,
  sources: readonly TaskSourceSettings[],
  deps: SourceDeps,
  options: SourceSyncOptions = {},
): SourceSyncResult {
  const selected = options.startupOnly
    ? sources.filter((source) => source.syncOnStart)
    : sources;

  const existingIds = new Set<string>();
  for (const stage of STAGE_IDS) {
    for (const task of board.columns[stage]) {
      existingIds.add(task.id);
    }
  }

  const added: Task[] = [];
  const errors: SourceError[] = [];
  const now = deps.now();
  let skipped = 0;

  for (const source of selected) {
    const result = runSource(source, deps);
    if ('error' in result) {
      errors.push({ sourceName: source.sourceName, error: result.error });
      continue;
    }

    for (const item of result.items) {
      const task = convertSourceItem(source, item, result.kind, now);
      if (!task) {
        skipped += 1;
        continue;
      }

      if (existingIds.has(task.id)) {
        skipped += 1;
        continue;
      }

      existingIds.add(task.id);
      added.push(task);
    }
  }

  if (added.length === 0) {
    return {
      board,
      added,
      skipped,
      errors,
      syncedSources: selected.length,
    };
  }

  return {
    board: {
      ...board,
      columns: {
        ...board.columns,
        new: [...board.columns.new, ...added],
      },
    },
    added,
    skipped,
    errors,
    syncedSources: selected.length,
  };
}

export function createTaskSourceService(
  sources: readonly TaskSourceSettings[],
  overrides: Partial<SourceDeps> = {},
): TaskSourceService {
  const deps: SourceDeps = {
    runShell: defaultShellRun,
    now: () => new Date(),
    cwd: process.cwd(),
    ...overrides,
  };

  return {
    enabled: sources.length > 0,
    sources,
    sync: (board, options) => syncTaskSources(board, sources, deps, options),
  };
}
