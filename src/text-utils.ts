import stringWidth from 'string-width';

export interface InputWindow {
  before: string;
  cursorChar: string;
  after: string;
  hasLeft: boolean;
  hasRight: boolean;
}

function charWidth(char: string): number {
  return Math.max(0, stringWidth(char));
}

export function getInputWindow(
  value: string,
  rawCursor: number,
  width: number,
): InputWindow {
  const chars = Array.from(value);
  const cursor = Math.min(Math.max(rawCursor, 0), chars.length);
  const safeWidth = Math.max(4, Math.floor(width));
  const cursorChar = chars[cursor] ?? ' ';
  const cursorWidth = Math.min(charWidth(cursorChar) || 1, safeWidth - 1);
  const available = Math.max(1, safeWidth - cursorWidth);

  let start = cursor;
  let end = Math.min(chars.length, cursor + 1);
  let usedLeft = 0;
  let usedRight = 0;

  const leftBudget = Math.floor(available * 0.6);
  while (start > 0) {
    const w = charWidth(chars[start - 1] ?? '');
    if (usedLeft + w > leftBudget) {
      break;
    }
    start -= 1;
    usedLeft += w;
  }

  while (end < chars.length) {
    const w = charWidth(chars[end] ?? '');
    if (usedLeft + usedRight + w > available) {
      break;
    }
    end += 1;
    usedRight += w;
  }

  if (end === chars.length) {
    while (start > 0) {
      const w = charWidth(chars[start - 1] ?? '');
      if (usedLeft + usedRight + w > available) {
        break;
      }
      start -= 1;
      usedLeft += w;
    }
  }

  while (
    usedLeft + usedRight + (start > 0 ? 1 : 0) + (end < chars.length ? 1 : 0) >
      available &&
    (end > cursor + 1 || start < cursor)
  ) {
    if (end > cursor + 1) {
      end -= 1;
      usedRight -= charWidth(chars[end] ?? '');
    } else if (start < cursor) {
      start += 1;
      usedLeft -= charWidth(chars[start - 1] ?? '');
    }
  }

  return {
    before: chars.slice(start, cursor).join(''),
    cursorChar,
    after: chars.slice(cursor + 1, end).join(''),
    hasLeft: start > 0,
    hasRight: end < chars.length,
  };
}

export function formatHeaderDate(date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'unknown date';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}
