export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export interface Notice {
  text: string;
  tone: NoticeTone;
}

export type SaveState = 'saved' | 'error' | 'demo';
