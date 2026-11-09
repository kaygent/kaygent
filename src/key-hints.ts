export type ModalKind = 'add' | 'edit' | 'delete' | 'move' | 'help';

const hints = {
  full: '←→ columns · ↑↓ tasks · a add · e edit · t tags · d delete · < > stage · NAPC jump · [ ] reorder · Space advance · ↵ focus · r sync · ? help · q quit',
  medium:
    '←→ cols · ↑↓ tasks · a add · e edit · t tags · d delete · <> stage · [] reorder · ↵ focus · r sync · ? help · q quit',
  compact:
    '←→↑↓ nav · a add · e edit · t tags · d delete · <> stage · [] reorder · ↵ focus · r sync · ? help',
  narrow:
    '←→↑↓ nav · a add · e edit · d del · <> stage · [] reorder · ↵ focus · r sync · ? help',
  tiny: '←→↑↓ nav · a add · e edit · d del · <> stage · ↵ focus · r sync · ? help',
  form: 'Tab / ↑↓  switch field  ·  Enter save  ·  Esc cancel',
  delete: 'y / Enter  delete  ·  n / Esc  cancel',
  move: 'y / Enter  move  ·  n / Esc  cancel',
  help: 'Esc / ?  close help',
} as const;

export function getKeyHints(modalKind: ModalKind | null, columns: number): string {
  if (modalKind === 'add' || modalKind === 'edit') {
    return hints.form;
  }

  if (modalKind === 'delete') {
    return hints.delete;
  }

  if (modalKind === 'move') {
    return hints.move;
  }

  if (modalKind === 'help') {
    return hints.help;
  }

  if (columns >= 124) {
    return hints.full;
  }

  if (columns >= 101) {
    return hints.medium;
  }

  if (columns >= 91) {
    return hints.compact;
  }

  if (columns >= 79) {
    return hints.narrow;
  }

  return hints.tiny;
}
