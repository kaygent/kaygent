import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPACT_BREAKPOINT,
  computeLayout,
  getCardWindow,
  MIN_COLUMNS,
  MIN_ROWS,
} from '../src/layout';
import { getInputWindow } from '../src/text-utils';

test('computes the fullscreen wide layout', () => {
  const layout = computeLayout(120, 32);

  assert.equal(layout.compact, false);
  assert.equal(layout.tooSmall, false);
  assert.equal(layout.bodyHeight, 27);
  assert.equal(layout.columnContentHeight, 22);
  assert.equal(layout.cardAreaHeight, 22);
});

test('computes the compact layout with tabs', () => {
  const layout = computeLayout(80, 24);

  assert.equal(layout.compact, true);
  assert.equal(layout.tooSmall, false);
  assert.equal(layout.columnContentHeight, 13);
  assert.equal(layout.cardAreaHeight, 13);
});

test('detects terminals below the minimum size', () => {
  assert.equal(computeLayout(MIN_COLUMNS - 1, 30).tooSmall, true);
  assert.equal(computeLayout(90, MIN_ROWS - 1).tooSmall, true);
  assert.equal(computeLayout(MIN_COLUMNS, MIN_ROWS).tooSmall, false);
  assert.equal(computeLayout(COMPACT_BREAKPOINT, 30).compact, false);
  assert.equal(computeLayout(COMPACT_BREAKPOINT - 1, 30).compact, true);
});

test('windows cards around the selection', () => {
  assert.deepEqual(getCardWindow(3, 0, 13), {
    visibleCount: 3,
    showOverflow: false,
    start: 0,
  });

  const middle = getCardWindow(12, 6, 13);
  assert.equal(middle.showOverflow, true);
  assert.equal(middle.visibleCount, 4);
  assert.equal(middle.start, 4);

  const top = getCardWindow(12, 0, 13);
  assert.equal(top.start, 0);

  const bottom = getCardWindow(12, 11, 13);
  assert.equal(bottom.start, 12 - bottom.visibleCount);

  const empty = getCardWindow(0, 0, 12);
  assert.equal(empty.visibleCount, 0);
  assert.equal(empty.showOverflow, false);
});

test('keeps the text input cursor inside the visible area', () => {
  const short = getInputWindow('hello', 5, 20);
  assert.equal(short.before, 'hello');
  assert.equal(short.cursorChar, ' ');

  const long = getInputWindow('abcdefghijklmnopqrstuvwxyz', 20, 10);
  const width = Array.from(
    `${long.hasLeft ? '…' : ''}${long.before}${long.cursorChar}${long.after}${long.hasRight ? '…' : ''}`,
  ).length;
  assert.ok(width <= 10);

  const cjk = getInputWindow('タスク管理アプリ', 4, 8);
  assert.equal(cjk.cursorChar, '理');
});
