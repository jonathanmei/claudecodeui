/**
 * Opt-in recorder for transcript scroll behavior, for diagnosing jumps in
 * browsers we cannot drive from tests. Off unless enabled in the console:
 *
 *   localStorage.setItem('cloudcli:scrollDebug', '1')   // then reload
 *   copy(__cloudcliScrollSummary())                     // after scrolling
 *   localStorage.removeItem('cloudcli:scrollDebug')     // to turn off
 *
 * Disabled, every call is a single cached boolean check.
 */

const STORAGE_KEY = 'cloudcli:scrollDebug';
const MAX_ENTRIES = 4000;

type Value = number | string | boolean | null;
type Entry = { t: number; type: string } & Record<string, Value>;
type DebugWindow = Window & {
  __cloudcliScrollLog?: Entry[];
  __cloudcliScrollSummary?: () => string;
};

let enabled: boolean | null = null;

/**
 * Whether recording is on for this page load.
 *
 * @returns True when the localStorage flag is set.
 */
export function isScrollDebugEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      enabled = false;
    }
    if (enabled) installSummary();
  }
  return enabled;
}

/**
 * Records one event, rounding numbers to whole pixels/milliseconds.
 *
 * @param type - Short event name.
 * @param data - Event fields.
 */
export function scrollDebug(type: string, data: Record<string, Value> = {}): void {
  if (!isScrollDebugEnabled()) return;
  const debugWindow = window as DebugWindow;
  const log = (debugWindow.__cloudcliScrollLog ??= []);
  if (log.length >= MAX_ENTRIES) log.shift();
  const entry: Entry = { t: Math.round(performance.now()), type };
  for (const [key, value] of Object.entries(data)) {
    entry[key] = typeof value === 'number' ? Math.round(value) : value;
  }
  log.push(entry);
}

/**
 * Samples the transcript every frame for a while: scroll position, content
 * height, how many rows are still placeholders, and where one fixed row sits
 * on screen. A one-frame leap in that row's position is a visible jump.
 *
 * @param container - The scrolling transcript element.
 * @param tracked - The row to follow, usually the one at the top of the view.
 * @param durationMs - How long to sample.
 */
export function sampleScrollFrames(container: HTMLElement, tracked: HTMLElement | null, durationMs = 2000): void {
  if (!isScrollDebugEnabled() || typeof requestAnimationFrame === 'undefined') return;
  const end = performance.now() + durationMs;
  const tick = () => {
    const containerTop = container.getBoundingClientRect().top;
    scrollDebug('frame', {
      st: container.scrollTop,
      sh: container.scrollHeight,
      ph: container.querySelectorAll('[data-message-timestamp][style*="height"]').length,
      off: tracked?.isConnected ? tracked.getBoundingClientRect().top - containerTop : null,
    });
    if (performance.now() < end) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function installSummary(): void {
  const debugWindow = window as DebugWindow;
  debugWindow.__cloudcliScrollSummary = () => {
    const lines = [navigator.userAgent];
    for (const entry of debugWindow.__cloudcliScrollLog ?? []) {
      const { t, type, ...rest } = entry;
      lines.push([t, type, ...Object.entries(rest).map(([key, value]) => `${key}=${value}`)].join(' '));
    }
    return lines.join('\n');
  };
}
