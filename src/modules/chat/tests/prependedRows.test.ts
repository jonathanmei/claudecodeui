import { describe, expect, it } from 'vitest';

import { countPrependedRows } from '@/modules/chat/utils/prependedRows';

const keys = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

describe('countPrependedRows', () => {
  it('is zero on the first render of a transcript', () => {
    expect(countPrependedRows(keys('m', 30), null, 60)).toBe(0);
  });

  it('is zero when nothing was added above', () => {
    const rows = keys('m', 30);
    expect(countPrependedRows([...rows, 'new-tail'], 'm0', 60)).toBe(0);
  });

  it('counts the rows a scroll-back page added above the previous first row', () => {
    const rows = [...keys('old', 20), ...keys('m', 30)];
    expect(countPrependedRows(rows, 'm0', 60)).toBe(20);
  });

  it('is zero for a bulk load larger than a page ("load all")', () => {
    const rows = [...keys('old', 500), ...keys('m', 30)];
    expect(countPrependedRows(rows, 'm0', 60)).toBe(0);
  });

  it('is zero when the previous first row is gone (another session)', () => {
    expect(countPrependedRows(keys('other', 30), 'm0', 60)).toBe(0);
  });
});
