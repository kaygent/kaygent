import type { Stage } from './board';

export const palette = {
  background: '#08101f',
  surface: '#101b2e',
  surfaceRaised: '#17243a',
  surfaceSelected: '#1d2f4a',
  border: '#263650',
  borderSoft: '#1b2940',
  text: '#e6edf7',
  textSoft: '#b6c4d8',
  muted: '#8b9bb4',
  dim: '#64748b',
  brand: '#f472b6',
  accent: '#67e8f9',
  danger: '#fb7185',
  success: '#4ade80',
  warning: '#fbbf24',
  white: '#f8fafc',
  black: '#07101c',
} as const;

export interface StageUi {
  label: string;
  name: string;
  shortLabel: string;
  glyph: string;
  color: string;
  softColor: string;
  emptyTitle: string;
  emptyHint: string;
}

export const stageUi: Record<Stage, StageUi> = {
  new: {
    label: 'NEW',
    name: 'New',
    shortLabel: 'NEW',
    glyph: '◇',
    color: '#38bdf8',
    softColor: '#0c4a6e',
    emptyTitle: 'A fresh start.',
    emptyHint: 'Press a to add a task.',
  },
  active: {
    label: 'ACTIVE',
    name: 'Active',
    shortLabel: 'ACTIVE',
    glyph: '◐',
    color: '#fbbf24',
    softColor: '#78350f',
    emptyTitle: 'Nothing active.',
    emptyHint: 'Use < > to move cards.',
  },
  inprogress: {
    label: 'IN PROGRESS',
    name: 'In Progress',
    shortLabel: 'PROGRESS',
    glyph: '◑',
    color: '#c084fc',
    softColor: '#4c1d95',
    emptyTitle: 'Nothing in progress.',
    emptyHint: 'Use < > to move cards.',
  },
  completed: {
    label: 'COMPLETED',
    name: 'Completed',
    shortLabel: 'DONE',
    glyph: '✓',
    color: '#34d399',
    softColor: '#064e3b',
    emptyTitle: 'Nothing finished yet.',
    emptyHint: 'Press Space to complete.',
  },
};

export const tagColors = [
  '#f472b6',
  '#38bdf8',
  '#fbbf24',
  '#c084fc',
  '#34d399',
  '#fb923c',
  '#60a5fa',
  '#f87171',
  '#2dd4bf',
  '#e879f9',
] as const;

export function tagColor(tag: string): string {
  let hash = 0;
  const normalized = tag.toLocaleLowerCase();
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return tagColors[hash % tagColors.length] ?? palette.accent;
}
