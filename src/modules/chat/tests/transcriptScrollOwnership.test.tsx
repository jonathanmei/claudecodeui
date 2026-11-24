import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedMessage, Project, ProjectSession } from '@/shared/types';

/**
 * The transcript's scroll position is written from five places coordinated by
 * refs and timers rather than by one owner. These are the two cases where that
 * coordination was observably wrong; both are timing bugs, so they are driven
 * on fake timers rather than by clicking.
 */

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionTokenUsage: () => Promise.resolve({ ok: false, json: async () => ({}) }),
    },
  },
}));

const SESSION_A = 'session-a';
const SESSION_B = 'session-b';

const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'Repo',
  isStarred: false,
};

const buildMessage = (index: number, timestamp: string): NormalizedMessage => ({
  id: `m-${index}`,
  kind: 'text',
  role: index % 2 === 0 ? 'user' : 'assistant',
  provider: 'claude',
  sessionId: SESSION_A,
  content: `message ${index}`,
  timestamp,
} as NormalizedMessage);

/**
 * jsdom has no layout, so scrollHeight/clientHeight are always 0 and assigning
 * scrollTop emits nothing. These are the exact reads the scroll code makes.
 */
function createContainer(scrollHeight: number, clientHeight: number) {
  const element = document.createElement('div');
  const writes: number[] = [];
  let scrollTop = scrollHeight - clientHeight;

  Object.defineProperty(element, 'scrollHeight', { get: () => scrollHeight });
  Object.defineProperty(element, 'clientHeight', { get: () => clientHeight });
  Object.defineProperty(element, 'scrollTop', {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
      writes.push(next);
    },
  });

  return { element: element as HTMLDivElement, writes, scrollHeight };
}

function createStore(
  messagesBySession: Map<string, NormalizedMessage[]>,
  options: { hasMore?: () => boolean } = {},
) {
  // A hydrated slot, so the session-loading effect takes its early return
  // instead of re-fetching on every render.
  const slotFor = (sessionId: string) => ({
    fetchedAt: 1,
    status: 'idle' as const,
    total: messagesBySession.get(sessionId)?.length ?? 0,
    hasMore: options.hasMore?.() ?? false,
    offset: messagesBySession.get(sessionId)?.length ?? 0,
  });

  return {
    fetchFromServer: vi.fn(async (sessionId: string) => slotFor(sessionId)),
    fetchMore: vi.fn(async (sessionId: string) => ({ slot: slotFor(sessionId), prependedCount: 0 })),
    appendRealtime: vi.fn(),
    refreshLatestFromServer: vi.fn(async (sessionId: string) => ({
      slot: slotFor(sessionId),
      applied: true,
      changed: false,
      deferred: false,
    })),
    setActiveSession: vi.fn(),
    isStale: vi.fn(() => false),
    updateStreaming: vi.fn(),
    finalizeStreaming: vi.fn(),
    getMessages: vi.fn((sessionId: string) => messagesBySession.get(sessionId) ?? []),
    getSessionSlot: vi.fn((sessionId: string) => slotFor(sessionId)),
  };
}

async function renderChatSessionState(options: {
  session: ProjectSession;
  store: ReturnType<typeof createStore>;
}) {
  const { useChatSessionState } = await import('@/modules/chat/hooks/useChatSessionState');

  return renderHook(
    ({ session }: { session: ProjectSession }) =>
      useChatSessionState({
        isActive: true,
        selectedProject: project,
        selectedSession: session,
        ws: null,
        sendMessage: vi.fn(),
        resetStreamingState: vi.fn(),
        statusCheckSentAtRef: { current: new Map() },
        lastSeqRef: { current: new Map() },
        sessionStore: options.store as never,
      }),
    { initialProps: { session: options.session } },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  // The initial-scroll effect is a separate writer that re-scrolls to the
  // bottom every animation frame until the height settles. It would satisfy an
  // assertion meant for the deferred timer, so it is silenced here — these
  // tests are about which writer wins, and it is not one of the two.
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe('deferred scroll-to-bottom', () => {
  it('does not yank the view back down when the user scrolls up inside the delay', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    // A new row lands while the user is at the bottom: a scroll is armed for +50ms.
    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession });
    });

    // ...and the user drags upward before it fires.
    act(() => {
      result.current.setIsUserScrolledUp(true);
    });
    container.writes.length = 0;

    act(() => {
      vi.advanceTimersByTime(200);
    });

    assert.deepEqual(
      container.writes,
      [],
      `a scroll armed before the user scrolled up must not fire afterwards; got ${JSON.stringify(container.writes)}`,
    );
  });

  it('still sticks to the bottom when the user has not scrolled away', async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
    ]);
    const store = createStore(messages);
    const { result, rerender } = await renderChatSessionState({
      session: { id: SESSION_A } as ProjectSession,
      store,
    });

    const container = createContainer(5000, 500);
    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;

    messages.set(SESSION_A, [
      ...messages.get(SESSION_A)!,
      buildMessage(1, '2026-01-01T00:00:01.000Z'),
    ]);
    act(() => {
      rerender({ session: { id: SESSION_A } as ProjectSession });
    });
    container.writes.length = 0;

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(container.writes).toContain(container.scrollHeight);
  });
});

describe('search jump ownership', () => {
  it('does not follow the user into the next session', { timeout: 20_000 }, async () => {
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, [buildMessage(0, '2026-01-01T00:00:00.000Z')]],
      [SESSION_B, [buildMessage(1, '2026-01-01T00:00:05.000Z')]],
    ]);
    const store = createStore(messages);
    const searchSession = {
      id: SESSION_A,
      __searchTargetSnippet: 'message 0',
      __searchTargetTimestamp: '2026-01-01T00:00:00.000Z',
    } as unknown as ProjectSession;

    const { result, rerender } = await renderChatSessionState({ session: searchSession, store });

    const container = createContainer(5000, 500);
    // The row session B renders. The jump requested against session A resolves
    // by timestamp, and on its last retry it accepts the nearest row it can
    // find — which, after the switch, is this one.
    const sessionBRow = document.createElement('div');
    sessionBRow.setAttribute('data-message-timestamp', '2026-01-01T00:00:05.000Z');
    container.element.appendChild(sessionBRow);

    (result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    // Let the jump arm and start retrying.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // The user gives up waiting and opens a different session.
    await act(async () => {
      rerender({ session: { id: SESSION_B } as ProjectSession });
    });

    // Let the whole retry budget elapse (20 retries, 150ms apart).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3400);
    });

    assert.equal(
      scrollIntoView.mock.calls.length,
      0,
      'a jump requested in the previous session must not scroll the new one',
    );
    assert.equal(
      container.element.querySelectorAll('.search-highlight-flash').length,
      0,
      'and must not flash the search highlight on one of its rows',
    );
  });
});

describe('scrolling back through older history', () => {
  const PAGE = 20;
  const ROW_HEIGHT = 50;

  /**
   * A container with just enough geometry for the scroll-anchor code: one
   * fixed transcript row whose on-screen top is its offset within the
   * content minus scrollTop. Rows added or resized above it move that offset.
   */
  function createHistoryContainer(initialRows: number, clientHeight: number) {
    const element = document.createElement('div');
    const writes: number[] = [];
    let rows = initialRows;
    let scrollTop = 0;
    let extraHeight = 0;
    // The row the user is looking at, a little below the top of the content.
    let anchorDocTop = 50;

    Object.defineProperty(element, 'scrollHeight', { get: () => rows * ROW_HEIGHT + extraHeight });
    Object.defineProperty(element, 'clientHeight', { get: () => clientHeight });
    Object.defineProperty(element, 'scrollTop', {
      get: () => scrollTop,
      set: (next: number) => {
        scrollTop = next;
        writes.push(next);
      },
    });
    element.scrollBy = ((options: ScrollToOptions) => {
      scrollTop += options.top ?? 0;
      writes.push(scrollTop);
    }) as typeof element.scrollBy;
    element.getBoundingClientRect = () => ({ top: 0, bottom: clientHeight } as DOMRect);

    const content = document.createElement('div');
    const anchor = document.createElement('div');
    // A LazyMessageRow wrapper: a direct child of the pane's content column.
    anchor.setAttribute('data-message-timestamp', '2026-01-02T00:00:00.000Z');
    anchor.getBoundingClientRect = () => {
      const top = anchorDocTop - scrollTop;
      return { top, bottom: top + ROW_HEIGHT } as DOMRect;
    };
    content.appendChild(anchor);
    element.appendChild(content);
    // Attached like the real pane, so rows report `isConnected`.
    document.body.appendChild(element);

    return {
      element: element as HTMLDivElement,
      writes,
      /** A user scroll: moves the viewport without going through `writes`. */
      userScrollTo(next: number) {
        scrollTop = next;
      },
      /** What the DOM looks like once a page of older rows has rendered above. */
      prependRows(count: number) {
        rows += count;
        anchorDocTop += count * ROW_HEIGHT;
      },
      /** A row above the viewport changing height after it rendered. */
      growAbove(px: number) {
        extraHeight += px;
        anchorDocTop += px;
      },
      get scrollTop() {
        return scrollTop;
      },
    };
  }

  async function setup(initialRows: number) {
    let hasMore = true;
    const messages = new Map<string, NormalizedMessage[]>([
      [SESSION_A, Array.from({ length: initialRows }, (_, i) => (
        buildMessage(1000 + i, `2026-01-02T00:00:${String(i % 60).padStart(2, '0')}.000Z`)
      ))],
    ]);
    const store = createStore(messages, { hasMore: () => hasMore });
    let resolveFetch: (() => void) | null = null;
    store.fetchMore.mockImplementation((sessionId: string) => new Promise((resolve) => {
      resolveFetch = () => {
        const older = Array.from({ length: PAGE }, (_, i) => (
          buildMessage(i, `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`)
        ));
        messages.set(sessionId, [...older, ...messages.get(sessionId)!]);
        hasMore = false;
        resolve({ slot: store.getSessionSlot(sessionId), prependedCount: PAGE } as never);
      };
    }) as never);

    const hook = await renderChatSessionState({ session: { id: SESSION_A } as ProjectSession, store });
    const container = createHistoryContainer(initialRows, 500);
    (hook.result.current.scrollContainerRef as { current: HTMLDivElement | null }).current = container.element;
    // Let the hydrated-slot effect publish `hasMore`.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    assert.equal(hook.result.current.hasMoreMessages, true, 'fixture should start with older history');

    return { ...hook, store, container, resolve: () => resolveFetch?.() };
  }

  it('starts fetching older rows before the user hits the top', async () => {
    const { result, store, container } = await setup(100);

    // Well clear of the old 100px trigger, but under one viewport from the top.
    container.userScrollTo(400);
    act(() => {
      // Not awaited: the request is left in flight, only its start matters.
      void result.current.handleScroll();
    });

    expect(store.fetchMore).toHaveBeenCalledTimes(1);
  });

  it('keeps the rows the user is looking at in place, even if they kept scrolling during the fetch', async () => {
    const { result, rerender, container, resolve } = await setup(100);

    container.userScrollTo(60);
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.handleScroll();
    });

    // Momentum carries the user further up while the request is in flight.
    container.userScrollTo(10);

    await act(async () => {
      resolve();
      await pending;
      container.prependRows(PAGE);
      rerender({ session: { id: SESSION_A } as ProjectSession });
    });

    // Where the user *is* (10), shifted down by exactly the prepended height —
    // not where they were when the fetch started (60).
    assert.equal(container.scrollTop, 10 + PAGE * ROW_HEIGHT);
  });

  it('holds the view still when a row above it resizes as the user scrolls', async () => {
    const { result, container } = await setup(100);

    container.userScrollTo(3000);
    await act(async () => {
      await result.current.handleScroll();
    });
    container.writes.length = 0;

    // The user scrolls up 10px, and in the same frame a row above the viewport
    // that had never rendered is laid out 300px taller than its placeholder.
    container.userScrollTo(2990);
    container.growAbove(300);
    await act(async () => {
      await result.current.handleScroll();
    });

    assert.equal(container.scrollTop, 2990 + 300);
  });

  it('compensates for rows resizing above the view between scrolls', async () => {
    const observers: Array<() => void> = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly callback: () => void) { observers.push(() => this.callback()); }
      observe() {}
      disconnect() {}
    });
    const { result, container } = await setup(100);

    container.userScrollTo(3000);
    await act(async () => {
      await result.current.handleScroll();
    });
    container.growAbove(250);
    act(() => {
      for (const notify of observers) notify();
    });

    assert.equal(container.scrollTop, 3000 + 250);
  });

  it('never pushes back against plain user scrolling', async () => {
    const { result, container } = await setup(100);

    container.userScrollTo(3000);
    await act(async () => {
      await result.current.handleScroll();
    });
    container.writes.length = 0;
    container.userScrollTo(2700);
    await act(async () => {
      await result.current.handleScroll();
    });

    assert.deepEqual(container.writes, []);
    assert.equal(container.scrollTop, 2700);
  });
});
