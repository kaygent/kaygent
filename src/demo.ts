import { createEmptyBoard, type Board, type Task } from './board';

function demoTasks(
  entries: ReadonlyArray<{
    id: string;
    title: string;
    tags: string[];
    minutesAgo: number;
  }>,
  now: Date,
): Task[] {
  return entries.map((entry) => {
    const timestamp = new Date(now.getTime() - entry.minutesAgo * 60_000).toISOString();
    return {
      id: entry.id,
      title: entry.title,
      tags: entry.tags,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
}

export function createDemoBoard(now = new Date()): Board {
  const board = createEmptyBoard();

  board.columns.new = demoTasks(
    [
      {
        id: 'demo-new-1',
        title: 'Refine shortcuts',
        tags: ['design', 'ux'],
        minutesAgo: 18,
      },
      {
        id: 'demo-new-2',
        title: 'Write release notes',
        tags: ['docs', 'release'],
        minutesAgo: 64,
      },
      {
        id: 'demo-new-3',
        title: 'Try a compact view',
        tags: ['idea', 'design'],
        minutesAgo: 140,
      },
    ],
    now,
  );

  board.columns.active = demoTasks(
    [
      {
        id: 'demo-active-1',
        title: 'Polish empty state',
        tags: ['ux', 'polish'],
        minutesAgo: 380,
      },
      {
        id: 'demo-active-2',
        title: 'Collect feedback',
        tags: ['research'],
        minutesAgo: 614,
      },
    ],
    now,
  );

  board.columns.paused = demoTasks(
    [
      {
        id: 'demo-progress-1',
        title: 'Build kanban keys',
        tags: ['engine', 'focus'],
        minutesAgo: 1_480,
      },
      {
        id: 'demo-progress-2',
        title: 'Add tag colors',
        tags: ['design', 'colors'],
        minutesAgo: 1_640,
      },
    ],
    now,
  );

  board.columns.completed = demoTasks(
    [
      {
        id: 'demo-done-1',
        title: 'Sketch board layout',
        tags: ['design'],
        minutesAgo: 2_600,
      },
      {
        id: 'demo-done-2',
        title: 'Set up Kaygent',
        tags: ['setup'],
        minutesAgo: 3_100,
      },
    ],
    now,
  );

  return board;
}
