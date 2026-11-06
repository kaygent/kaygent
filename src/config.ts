import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseTags, STAGE_IDS, type Stage } from './board';
import { defaultDataDirectory } from './store';
import type { StageUiOverrides } from './theme';

export const TERMINAL_PROVIDERS = [
  'auto',
  'wezterm',
  'tmux',
  'herdr',
  'wt',
  'process',
  'custom',
] as const;

export type TerminalProvider = (typeof TERMINAL_PROVIDERS)[number];

export const SOURCE_FORMATS = ['auto', 'tasks', 'messages'] as const;

export type SourceFormat = (typeof SOURCE_FORMATS)[number];

export interface TaskSourceSettings {
  /** Unique name used to namespace imported task ids. */
  sourceName: string;
  /** Shell command that prints JSON to stdout. */
  command: string;
  format: SourceFormat;
  tags: string[];
  cwd?: string;
  timeoutMs: number;
  syncOnStart: boolean;
}

export interface CustomTerminalCommands {
  spawn: string;
  focus: string;
  close: string;
}

export interface TerminalSettings {
  provider: TerminalProvider;
  command: string[];
  cwd?: string;
  title: string;
  newWindow: boolean;
  pauseBehavior: 'keep' | 'close';
  focusOnEnter: boolean;
  custom: CustomTerminalCommands;
}

export interface QanbanConfig {
  columns: StageUiOverrides;
  terminal: TerminalSettings;
  taskSources: TaskSourceSettings[];
}

export interface LoadedConfig {
  config: QanbanConfig;
  filePath: string;
  exists: boolean;
  warning?: string;
}

export const DEFAULT_CONFIG: QanbanConfig = {
  columns: {},
  taskSources: [],
  terminal: {
    provider: 'auto',
    command: ['claude', '{title}'],
    title: 'Qanban · {title}',
    newWindow: false,
    pauseBehavior: 'keep',
    focusOnEnter: true,
    custom: {
      spawn: '',
      focus: '',
      close: '',
    },
  },
};

export function defaultConfigFile(): string {
  if (process.env.QANBAN_CONFIG_FILE) {
    return resolve(process.env.QANBAN_CONFIG_FILE);
  }

  return join(defaultDataDirectory(), 'config.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Small shell-like splitter used when `terminal.command` is written as a
 * string. Array form avoids all quoting ambiguity and is recommended.
 */
export function splitCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let hasContent = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      hasContent = true;
      continue;
    }

    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
        hasContent = true;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (hasContent) {
        tokens.push(current);
        current = '';
        hasContent = false;
      }
      continue;
    }

    current += char;
    hasContent = true;
  }

  if (escaped) {
    current += '\\';
    hasContent = true;
  }

  if (hasContent) {
    tokens.push(current);
  }

  return tokens;
}

function readCommand(value: unknown, warnings: string[]): string[] | undefined {
  if (Array.isArray(value)) {
    const tokens = value.filter((item): item is string => typeof item === 'string');
    if (tokens.length !== value.length) {
      warnings.push('terminal.command contains non-string entries; they were ignored.');
    }
    return tokens;
  }

  if (typeof value === 'string') {
    return splitCommandLine(value);
  }

  return undefined;
}

function parseTaskSources(
  value: unknown,
  warnings: string[],
): TaskSourceSettings[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    warnings.push('taskSources must be an array.');
    return [];
  }

  const sources: TaskSourceSettings[] = [];
  const names = new Set<string>();

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      warnings.push(`taskSources[${index}] must be an object.`);
      return;
    }

    if (!nonEmptyString(entry.sourceName)) {
      warnings.push(`taskSources[${index}].sourceName is required.`);
      return;
    }

    const sourceName = entry.sourceName.trim();
    if (names.has(sourceName)) {
      warnings.push(`taskSources has a duplicate sourceName "${sourceName}".`);
      return;
    }

    if (!nonEmptyString(entry.command)) {
      warnings.push(`taskSources[${index}].command must be a non-empty string.`);
      return;
    }

    let format: SourceFormat = 'auto';
    if (entry.format !== undefined) {
      if (
        typeof entry.format === 'string' &&
        (SOURCE_FORMATS as readonly string[]).includes(entry.format)
      ) {
        format = entry.format as SourceFormat;
      } else {
        warnings.push(
          `taskSources[${index}].format must be one of: ${SOURCE_FORMATS.join(', ')}.`,
        );
      }
    }

    const tagInput =
      typeof entry.tags === 'string' || Array.isArray(entry.tags)
        ? (entry.tags as string | string[])
        : undefined;
    const tags = parseTags(tagInput);

    let cwd: string | undefined;
    if (nonEmptyString(entry.cwd)) {
      cwd = resolve(process.cwd(), entry.cwd.trim());
    }

    let timeoutMs = 30_000;
    if (entry.timeoutMs !== undefined) {
      if (
        typeof entry.timeoutMs === 'number' &&
        Number.isFinite(entry.timeoutMs) &&
        entry.timeoutMs > 0 &&
        entry.timeoutMs <= 600_000
      ) {
        timeoutMs = Math.floor(entry.timeoutMs);
      } else {
        warnings.push(
          `taskSources[${index}].timeoutMs must be between 1 and 600000.`,
        );
      }
    }

    let syncOnStart = false;
    if (entry.syncOnStart !== undefined) {
      if (typeof entry.syncOnStart === 'boolean') {
        syncOnStart = entry.syncOnStart;
      } else {
        warnings.push(`taskSources[${index}].syncOnStart must be a boolean.`);
      }
    }

    names.add(sourceName);
    sources.push({
      sourceName,
      command: entry.command.trim(),
      format,
      tags,
      ...(cwd ? { cwd } : {}),
      timeoutMs,
      syncOnStart,
    });
  });

  return sources;
}

export function parseConfig(value: unknown): {
  config: QanbanConfig;
  warnings: string[];
} {
  const config = structuredClone(DEFAULT_CONFIG);
  const warnings: string[] = [];

  if (!isRecord(value)) {
    warnings.push('The config root must be a JSON object.');
    return { config, warnings };
  }

  if (isRecord(value.columns)) {
    for (const stage of STAGE_IDS) {
      const entry = value.columns[stage];
      if (!isRecord(entry)) {
        continue;
      }

      const override: StageUiOverrides[Stage] = {};

      for (const key of ['label', 'shortLabel', 'glyph'] as const) {
        if (nonEmptyString(entry[key])) {
          override[key] = entry[key].trim();
        }
      }

      if (nonEmptyString(entry.color)) {
        const color = entry.color.trim();
        if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
          override.color = color;
        } else {
          warnings.push(`columns.${stage}.color must be a #rgb or #rrggbb value.`);
        }
      }

      config.columns[stage] = override;
    }
  }

  config.taskSources = parseTaskSources(value.taskSources, warnings);

  if (!isRecord(value.terminal)) {
    return { config, warnings };
  }

  const terminal = value.terminal;

  if (typeof terminal.provider === 'string') {
    const provider = terminal.provider.trim().toLowerCase();
    if ((TERMINAL_PROVIDERS as readonly string[]).includes(provider)) {
      config.terminal.provider = provider as TerminalProvider;
    } else {
      warnings.push(
        `terminal.provider must be one of: ${TERMINAL_PROVIDERS.join(', ')}.`,
      );
    }
  }

  const command = readCommand(terminal.command, warnings);
  if (command !== undefined) {
    config.terminal.command = command;
  }

  if (nonEmptyString(terminal.cwd)) {
    config.terminal.cwd = resolve(process.cwd(), terminal.cwd.trim());
  }

  if (nonEmptyString(terminal.title)) {
    config.terminal.title = terminal.title.trim();
  }

  if (typeof terminal.newWindow === 'boolean') {
    config.terminal.newWindow = terminal.newWindow;
  }

  if (terminal.pauseBehavior === 'keep' || terminal.pauseBehavior === 'close') {
    config.terminal.pauseBehavior = terminal.pauseBehavior;
  } else if (terminal.pauseBehavior !== undefined) {
    warnings.push('terminal.pauseBehavior must be "keep" or "close".');
  }

  if (typeof terminal.focusOnEnter === 'boolean') {
    config.terminal.focusOnEnter = terminal.focusOnEnter;
  }

  if (isRecord(terminal.custom)) {
    for (const key of ['spawn', 'focus', 'close'] as const) {
      if (typeof terminal.custom[key] === 'string') {
        config.terminal.custom[key] = terminal.custom[key].trim();
      }
    }
  }

  return { config, warnings };
}

export function loadConfig(filePath = defaultConfigFile()): LoadedConfig {
  if (!existsSync(filePath)) {
    return {
      config: structuredClone(DEFAULT_CONFIG),
      filePath,
      exists: false,
    };
  }

  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: structuredClone(DEFAULT_CONFIG),
      filePath,
      exists: true,
      warning: `Could not read config ${filePath}: ${message}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: structuredClone(DEFAULT_CONFIG),
      filePath,
      exists: true,
      warning: `Config ${filePath} is not valid JSON: ${message}`,
    };
  }

  const { config, warnings } = parseConfig(parsed);
  return {
    config,
    filePath,
    exists: true,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined,
  };
}

