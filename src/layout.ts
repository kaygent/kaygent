export const MIN_COLUMNS = 70;
export const MIN_ROWS = 24;
export const COMPACT_BREAKPOINT = 96;

export const HEADER_HEIGHT = 2;
export const FOOTER_HEIGHT = 3;
export const TABS_HEIGHT = 1;
export const BOARD_PADDING_Y = 1;
export const COLUMN_BORDER_HEIGHT = 2;
export const COLUMN_HEADER_HEIGHT = 1;

export interface AppLayout {
  columns: number;
  rows: number;
  compact: boolean;
  tooSmall: boolean;
  /** Usable body height: everything between the header and footer. */
  bodyHeight: number;
  /** Height available inside each column, below its header. */
  columnContentHeight: number;
  /** Height available for cards inside a column. */
  cardAreaHeight: number;
}

export function computeLayout(columns: number, rows: number): AppLayout {
  const safeColumns = Math.max(1, Math.floor(columns));
  const safeRows = Math.max(1, Math.floor(rows));
  const compact = safeColumns < COMPACT_BREAKPOINT;
  const tooSmall = safeColumns < MIN_COLUMNS || safeRows < MIN_ROWS;
  const tabsHeight = compact ? TABS_HEIGHT : 0;

  const bodyHeight = safeRows - HEADER_HEIGHT - FOOTER_HEIGHT;
  const columnContentHeight =
    safeRows -
    HEADER_HEIGHT -
    FOOTER_HEIGHT -
    tabsHeight -
    BOARD_PADDING_Y * 2 -
    COLUMN_BORDER_HEIGHT -
    COLUMN_HEADER_HEIGHT;

  return {
    columns: safeColumns,
    rows: safeRows,
    compact,
    tooSmall,
    bodyHeight,
    columnContentHeight: Math.max(3, columnContentHeight),
    cardAreaHeight: Math.max(3, columnContentHeight),
  };
}

export interface CardWindow {
  visibleCount: number;
  showOverflow: boolean;
  start: number;
}

/**
 * Choose a window of cards that fits in a column and keeps the selected card
 * visible. One row is reserved for a "more" indicator when scrolling is needed.
 */
export function getCardWindow(
  count: number,
  selectedIndex: number,
  areaHeight: number,
): CardWindow {
  if (count <= 0) {
    return { visibleCount: 0, showOverflow: false, start: 0 };
  }

  const fullCapacity = Math.max(1, Math.floor((areaHeight + 1) / 3));
  if (count <= fullCapacity) {
    return { visibleCount: count, showOverflow: false, start: 0 };
  }

  const capacity = Math.max(1, Math.floor(areaHeight / 3));
  const visibleCount = Math.min(count, capacity);
  const safeSelected = Math.min(Math.max(selectedIndex, 0), count - 1);
  const centeredStart = safeSelected - Math.floor(visibleCount / 2);
  const start = Math.min(
    Math.max(centeredStart, 0),
    Math.max(0, count - visibleCount),
  );

  return { visibleCount, showOverflow: true, start };
}
