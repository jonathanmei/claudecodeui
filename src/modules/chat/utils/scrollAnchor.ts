/**
 * Keeps the transcript row the user is looking at still while layout above it
 * changes: older pages prepended, or rows changing height as their lazy
 * placeholders (LazyMessageRow) swap real content in. Rows never yet measured
 * start at an estimated height, so scrolling up through fresh history resizes
 * rows above the view.
 *
 * Browsers' own scroll anchoring covers some of this in some browsers, so the
 * transcript pane turns it off (`overflow-anchor: none`) and relies on this
 * instead; running both would correct every shift twice.
 */

import { isScrollDebugEnabled, scrollDebug } from '@/modules/chat/utils/scrollDebug';

/**
 * Transcript rows: the LazyMessageRow wrappers, direct children of the pane's
 * content column. Unlike `.chat-message` these are never nested (tool groups
 * nest messages), stay in the DOM while their content is unmounted, and are
 * strictly ordered top to bottom.
 */
const ROW_SELECTOR = ':scope > div > [data-message-timestamp]';

/** What triggered a correction; recorded by the opt-in scroll debug log. */
export type CorrectionSource = 'scroll' | 'resize' | 'restore';

type AnchorState = {
  anchor: HTMLElement;
  /** Anchor top relative to the container's top edge, in px. */
  offset: number;
  scrollTop: number;
  /** Debug only: heights of the rows above the anchor at capture. */
  heightsAbove?: number[];
};

function rowsOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR));
}

function topVisibleIndex(container: HTMLElement, rows: HTMLElement[]): number {
  const top = container.getBoundingClientRect().top;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].getBoundingClientRect().bottom >= top) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Finds the topmost transcript row still on screen: the first row whose bottom
 * edge is at or below the container's top edge.
 *
 * Rows are strictly ordered, so a binary search keeps this cheap enough to run
 * on every scroll event.
 *
 * @param container - The scrolling transcript element.
 * @returns The topmost visible row, or null when there are no rows.
 */
export function findTopVisibleRow(container: HTMLElement): HTMLElement | null {
  const rows = rowsOf(container);
  return rows.length === 0 ? null : rows[topVisibleIndex(container, rows)];
}

/**
 * Holds one row's on-screen position against layout shifts above it.
 *
 * Call {@link ScrollAnchor.correct} from scroll events and after renders that
 * may change layout. It works out where the anchor should be given only the
 * scrolling since the last capture, moves the view by any remaining difference
 * (which can only be layout shifting above the anchor), then re-anchors on the
 * row now at the top. Because the expected position accounts for scrolling,
 * user and programmatic scrolls are never pushed back.
 */
export class ScrollAnchor {
  private state: AnchorState | null = null;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly observed = new WeakSet<Element>();

  /**
   * @param container - The scrolling transcript element.
   */
  constructor(private readonly container: HTMLElement) {
    // Rows resizing after a render (placeholders swapping in, images, late
    // markdown) happen without a scroll or a React commit to hook into.
    this.resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => this.correct('resize'));
    this.observeContent();
  }

  /** The element this anchor is bound to. */
  get element(): HTMLElement {
    return this.container;
  }

  /**
   * Re-anchors on the row now at the top of the view, without moving anything.
   */
  capture(): void {
    const rows = rowsOf(this.container);
    if (rows.length === 0) {
      this.state = null;
    } else {
      const index = topVisibleIndex(this.container, rows);
      const anchor = rows[index];
      this.state = { anchor, offset: this.offsetOf(anchor), scrollTop: this.container.scrollTop };
      if (isScrollDebugEnabled()) {
        this.state.heightsAbove = rows.slice(0, index).map((row) => row.getBoundingClientRect().height);
      }
    }
    this.observeContent();
  }

  /**
   * Cancels any layout shift above the anchor since the last capture, then
   * re-anchors.
   *
   * @param source - What triggered this; only used by the debug log.
   * @returns True when there was an anchor to correct against; false when it
   *   had left the DOM, so the caller may need a coarser fallback.
   */
  correct(source: CorrectionSource = 'scroll'): boolean {
    const state = this.state;
    if (!state || !state.anchor.isConnected) {
      scrollDebug('anchor-lost', { src: source, st: this.container.scrollTop });
      this.capture();
      return false;
    }
    const scrolled = this.container.scrollTop - state.scrollTop;
    const shift = this.offsetOf(state.anchor) - (state.offset - scrolled);
    if (Math.abs(shift) >= 1) {
      const before = this.container.scrollTop;
      this.scrollBy(shift);
      scrollDebug('correct', {
        src: source,
        shift,
        before,
        after: this.container.scrollTop,
        row: state.anchor.dataset.messageTimestamp ?? null,
        changed: isScrollDebugEnabled() ? this.describeChangesAbove(state) : null,
      });
    }
    this.capture();
    return true;
  }

  /** Stops watching for resizes. */
  disconnect(): void {
    this.resizeObserver?.disconnect();
    this.state = null;
  }

  private offsetOf(element: HTMLElement): number {
    return element.getBoundingClientRect().top - this.container.getBoundingClientRect().top;
  }

  private scrollBy(top: number): void {
    // Relative, not `scrollTop +=`: Firefox scrolls asynchronously, and an
    // absolute write computed from the main thread's (stale) position throws
    // away the part of the user's scroll it has not seen yet.
    if (typeof this.container.scrollBy === 'function') {
      this.container.scrollBy({ top, behavior: 'instant' });
    } else {
      this.container.scrollTop += top;
    }
  }

  /**
   * Debug only: which rows above the anchor changed height since capture, as
   * "index:from>to" with m (content mounted) or p (placeholder), largest first.
   */
  private describeChangesAbove(state: AnchorState): string {
    const before = state.heightsAbove ?? [];
    const rows = rowsOf(this.container);
    const anchorIndex = rows.indexOf(state.anchor);
    const now = rows.slice(0, anchorIndex).map((row) => row.getBoundingClientRect().height);
    // Rows prepended since capture shift indexes; align from the anchor up.
    const changes: Array<[number, string]> = [];
    for (let back = 1; back <= Math.max(before.length, now.length); back += 1) {
      const was = before[before.length - back];
      const is = now[now.length - back];
      if (was !== undefined && is !== undefined && Math.abs(was - is) < 1) continue;
      const row = rows[anchorIndex - back];
      const kind = row ? (row.childElementCount > 0 ? 'm' : 'p') : '?';
      changes.push([Math.abs((is ?? 0) - (was ?? 0)), `-${back}:${Math.round(was ?? -1)}>${Math.round(is ?? -1)}${kind}`]);
    }
    changes.sort((a, b) => b[0] - a[0]);
    const shown = changes.slice(0, 4).map(([, text]) => text);
    return changes.length > 4 ? `${shown.join(',')},+${changes.length - 4}more` : shown.join(',') || 'none';
  }

  /** Watches the pane's direct children, whose heights change when rows do. */
  private observeContent(): void {
    if (!this.resizeObserver) return;
    for (const child of Array.from(this.container.children)) {
      if (this.observed.has(child)) continue;
      this.observed.add(child);
      this.resizeObserver.observe(child);
    }
  }
}
