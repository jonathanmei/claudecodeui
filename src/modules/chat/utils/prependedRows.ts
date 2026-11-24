/**
 * Counts the rows a render added above the previous render's first row.
 *
 * Rows added by scrolling back one page mount their content immediately, so
 * their real height lands in the same commit as the insertion and the scroll
 * restore corrects for all of it before paint. Left as lazy placeholders, they
 * sit inside the lazy-row band (older pages are fetched while the user is
 * still within it), swap in a frame or two later, and shift the view by
 * thousands of pixels in one go.
 *
 * @param rowKeys - This render's row keys, in order.
 * @param previousFirstKey - The previous render's first row key, or null on
 *   the first render.
 * @param maxRows - The most rows to count as a page; a larger insertion (such
 *   as "load all") returns 0 so it stays lazy and does not mount everything.
 * @returns How many leading rows are new, or 0.
 */
export function countPrependedRows(
  rowKeys: readonly string[],
  previousFirstKey: string | null,
  maxRows: number,
): number {
  if (previousFirstKey === null) return 0;
  const index = rowKeys.indexOf(previousFirstKey);
  return index > 0 && index <= maxRows ? index : 0;
}
