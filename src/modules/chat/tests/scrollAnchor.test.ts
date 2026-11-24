import { describe, expect, it } from 'vitest';

import { findTopVisibleRow } from '@/modules/chat/utils/scrollAnchor';

/**
 * Pane markup as ChatMessagesPane renders it: pane > content column > one
 * LazyMessageRow wrapper per row. Tool groups nest further timestamped
 * `.chat-message` elements inside their wrapper; those must never be picked.
 */
function buildPane(rowTops: number[], rowHeight: number) {
  const pane = document.createElement('div');
  pane.getBoundingClientRect = () => ({ top: 0, bottom: 600 } as DOMRect);
  const column = document.createElement('div');
  pane.appendChild(column);
  const wrappers = rowTops.map((top, i) => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-message-timestamp', `row-${i}`);
    wrapper.getBoundingClientRect = () => ({ top, bottom: top + rowHeight } as DOMRect);
    const group = document.createElement('div');
    group.className = 'chat-message tool';
    group.setAttribute('data-message-timestamp', `row-${i}`);
    const nested = document.createElement('div');
    nested.className = 'chat-message';
    nested.getBoundingClientRect = () => ({ top: top + 5, bottom: top + 10 } as DOMRect);
    group.appendChild(nested);
    wrapper.appendChild(group);
    column.appendChild(wrapper);
    return wrapper;
  });
  return { pane, wrappers };
}

describe('findTopVisibleRow', () => {
  it('returns the first row wrapper reaching into the view', () => {
    const { pane, wrappers } = buildPane([-500, -300, -100, 100, 300], 200);
    expect(findTopVisibleRow(pane)).toBe(wrappers[2]);
  });

  it('never returns a timestamped element nested inside a row', () => {
    const { pane } = buildPane([-500, -300, -100, 100, 300], 200);
    const found = findTopVisibleRow(pane);
    expect(found?.parentElement?.parentElement).toBe(pane);
  });

  it('is null for an empty transcript', () => {
    const pane = document.createElement('div');
    pane.appendChild(document.createElement('div'));
    expect(findTopVisibleRow(pane)).toBeNull();
  });
});
