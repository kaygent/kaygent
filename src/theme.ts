import { STAGE_IDS, type Stage } from './board';

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

export const defaultStageUi: Record<Stage, StageUi> = {
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
    emptyHint: 'Move a task here to launch its terminal.',
  },
  paused: {
    label: 'PAUSED',
    name: 'Paused',
    shortLabel: 'PAUSED',
    glyph: '◑',
    color: '#c084fc',
    softColor: '#4c1d95',
    emptyTitle: 'Nothing paused.',
    emptyHint: 'Park active work here without losing it.',
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

/**
 * Mutable UI metadata so a config file can rename/recolor columns. Components
 * read this at render time; apply overrides before rendering the app.
 */
export const stageUi: Record<Stage, StageUi> = structuredClone(defaultStageUi);

export type StageUiOverrides = Partial<
  Record<Stage, Partial<Pick<StageUi, 'label' | 'shortLabel' | 'glyph' | 'color'>>>
>;

const overridableKeys = ['label', 'shortLabel', 'glyph', 'color'] as const;

export function applyStageOverrides(overrides: StageUiOverrides): void {
  for (const stage of STAGE_IDS) {
    const override = overrides[stage];
    if (!override) {
      continue;
    }

    for (const key of overridableKeys) {
      const value = override[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        stageUi[stage][key] = value.trim();
      }
    }
  }
}

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
