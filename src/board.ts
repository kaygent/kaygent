import { randomUUID } from 'node:crypto';
import type { TerminalSession } from './terminal/types';

export const STAGE_IDS = ['new', 'active', 'paused', 'completed'] as const;
export type Stage = (typeof STAGE_IDS)[number];

export interface Task {
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** Terminal session spawned when this task entered Active. */
  session?: TerminalSession;
}

export type TaskColumns = Record<Stage, Task[]>;

export interface Board {
  version: 2;
  columns: TaskColumns;
}

export interface TaskDraft {
  title: string;
  tags?: string | readonly string[];
}

export interface AddResult {
  board: Board;
  task: Task;
  index: number;
}

export interface MoveResult {
  board: Board;
  toStage: Stage;
  toIndex: number;
  moved: boolean;
}

export interface ReorderResult {
  board: Board;
  index: number;
  moved: boolean;
}

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGE_IDS as readonly string[]).includes(value);
}

export function createEmptyColumns(): TaskColumns {
  return {
    new: [],
    active: [],
    paused: [],
    completed: [],
  };
}

export function createEmptyBoard(): Board {
  return {
    version: 2,
    columns: createEmptyColumns(),
  };
}

export function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Tags can be entered separated by commas and/or whitespace. Leading hashes are
 * optional, and comparison for duplicates is case-insensitive.
 */
export function parseTags(input: string | readonly string[] | undefined): string[] {
  if (input === undefined) {
    return [];
  }

  const pieces = (Array.isArray(input) ? input : [input])
    .flatMap((value) => String(value).split(/[\s,]+/))
    .map((value) => value.trim().replace(/^#+/, ''))
    .filter(Boolean);

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const tag of pieces) {
    const key = tag.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }

  return tags;
}

export function collectTags(board: Board): string[] {
  const tags = new Map<string, string>();

  for (const stage of STAGE_IDS) {
    for (const task of board.columns[stage]) {
      for (const tag of task.tags) {
        const key = tag.toLocaleLowerCase();
        if (!tags.has(key)) {
          tags.set(key, tag);
        }
      }
    }
  }

  return [...tags.values()].sort((a, b) => a.localeCompare(b));
}

export function countTasks(board: Board): number {
  return STAGE_IDS.reduce((total, stage) => total + board.columns[stage].length, 0);
}

export function countOpenTasks(board: Board): number {
  return (
    board.columns.new.length +
    board.columns.active.length +
    board.columns.paused.length
  );
}

/**
 * Attach or clear the terminal session on a task without disturbing its
 * position or any other field. Passing `undefined` removes the property.
 */
export function setTaskSession(
  board: Board,
  stage: Stage,
  taskId: string,
  session: TerminalSession | undefined,
): Board {
  const index = board.columns[stage].findIndex((task) => task.id === taskId);
  if (index === -1) {
    return board;
  }

  const tasks = [...board.columns[stage]];
  const task = tasks[index]!;

  if (session) {
    tasks[index] = { ...task, session };
  } else {
    const rest = { ...task };
    delete rest.session;
    tasks[index] = rest;
  }

  return {
    ...board,
    columns: {
      ...board.columns,
      [stage]: tasks,
    },
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function cleanTask(columns: TaskColumns, stage: Stage, index: number): Task | undefined {
  return columns[stage][index];
}

export function addTask(
  board: Board,
  draft: TaskDraft,
  options: { id?: string; now?: Date } = {},
): AddResult {
  const title = normalizeTitle(draft.title);
  if (!title) {
    throw new Error('A task needs a title.');
  }

  const now = (options.now ?? new Date()).toISOString();
  const task: Task = {
    id: options.id ?? randomUUID(),
    title,
    tags: parseTags(draft.tags),
    createdAt: now,
    updatedAt: now,
  };

  const next: Board = {
    ...board,
    columns: {
      ...board.columns,
      new: [...board.columns.new, task],
    },
  };

  return {
    board: next,
    task,
    index: next.columns.new.length - 1,
  };
}

export function updateTask(
  board: Board,
  stage: Stage,
  index: number,
  draft: TaskDraft,
  options: { now?: Date } = {},
): Board {
  const current = cleanTask(board.columns, stage, index);
  if (!current) {
    return board;
  }

  const title = normalizeTitle(draft.title);
  if (!title) {
    throw new Error('A task needs a title.');
  }

  const updated: Task = {
    ...current,
    title,
    tags: parseTags(draft.tags),
    updatedAt: (options.now ?? new Date()).toISOString(),
  };

  const tasks = [...board.columns[stage]];
  tasks[index] = updated;

  return {
    ...board,
    columns: {
      ...board.columns,
      [stage]: tasks,
    },
  };
}

export function removeTask(board: Board, stage: Stage, index: number): Board {
  if (!cleanTask(board.columns, stage, index)) {
    return board;
  }

  return {
    ...board,
    columns: {
      ...board.columns,
      [stage]: board.columns[stage].filter((_, taskIndex) => taskIndex !== index),
    },
  };
}

/**
 * Move a task to another column, or to another position in the same column.
 * When no destination index is supplied, the task keeps its vertical position
 * where possible.
 */
export function moveTask(
  board: Board,
  fromStage: Stage,
  fromIndex: number,
  toStage: Stage,
  toIndex?: number,
  options: { now?: Date } = {},
): MoveResult {
  const task = cleanTask(board.columns, fromStage, fromIndex);
  if (!task) {
    return { board, toStage: fromStage, toIndex: fromIndex, moved: false };
  }

  if (fromStage === toStage) {
    if (toIndex === undefined) {
      return { board, toStage: fromStage, toIndex: fromIndex, moved: false };
    }

    const list = [...board.columns[fromStage]];
    const target = clamp(toIndex, 0, list.length - 1);
    if (target === fromIndex) {
      return { board, toStage: fromStage, toIndex: fromIndex, moved: false };
    }

    const [movedTask] = list.splice(fromIndex, 1);
    list.splice(target, 0, movedTask);

    return {
      board: {
        ...board,
        columns: {
          ...board.columns,
          [fromStage]: list,
        },
      },
      toStage,
      toIndex: target,
      moved: true,
    };
  }

  const destination = board.columns[toStage];
  const destIndex = clamp(
    toIndex ?? Math.min(fromIndex, destination.length),
    0,
    destination.length,
  );
  const timestamp = (options.now ?? new Date()).toISOString();
  const movedTask: Task = { ...task, updatedAt: timestamp };

  const nextDestination = [...destination];
  nextDestination.splice(destIndex, 0, movedTask);

  const nextSource = board.columns[fromStage].filter(
    (_, taskIndex) => taskIndex !== fromIndex,
  );

  return {
    board: {
      ...board,
      columns: {
        ...board.columns,
        [fromStage]: nextSource,
        [toStage]: nextDestination,
      },
    },
    toStage,
    toIndex: destIndex,
    moved: true,
  };
}

export function reorderTask(
  board: Board,
  stage: Stage,
  index: number,
  delta: -1 | 1,
): ReorderResult {
  const task = cleanTask(board.columns, stage, index);
  if (!task) {
    return { board, index, moved: false };
  }

  const target = index + delta;
  if (target < 0 || target >= board.columns[stage].length) {
    return { board, index, moved: false };
  }

  const list = [...board.columns[stage]];
  list.splice(index, 1);
  list.splice(target, 0, task);

  return {
    board: {
      ...board,
      columns: {
        ...board.columns,
        [stage]: list,
      },
    },
    index: target,
    moved: true,
  };
}

export function nextStage(stage: Stage): Stage | undefined {
  const index = STAGE_IDS.indexOf(stage);
  return STAGE_IDS[index + 1];
}

export function previousStage(stage: Stage): Stage | undefined {
  const index = STAGE_IDS.indexOf(stage);
  return STAGE_IDS[index - 1];
}
