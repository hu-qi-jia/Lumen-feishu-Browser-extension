// chrome.alarms lifecycle for the news feature. The alarm wakes the service worker
// periodically; the alarm listener (in background/index.ts) fetches both sources and
// writes the results into chrome.storage.local. Mirrors the typeof-chrome guard pattern
// so the module is importable in tests and the sandbox.
import type { NewsInterval } from './types'

export const NEWS_ALARM_NAME = 'news-refresh-v1'

function hasAlarms(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.alarms
}

/** Clear any existing news alarm then create a fresh one with the given interval.
 *  chrome.alarms.create enforces a 0.5-min minimum; all our intervals (10/30/60) clear
 *  that bar comfortably. `delayInMinutes: 0` fires the first tick ASAP (within ~1 min) so
 *  the cache is populated right after install / settings change — otherwise the user would
 *  see a stale "updated N hours ago" tooltip for a full interval before the first tick. */
export function setupNewsAlarm(intervalMin: NewsInterval): void {
  if (!hasAlarms()) return
  chrome.alarms.clear(NEWS_ALARM_NAME, () => {
    chrome.alarms.create(NEWS_ALARM_NAME, { delayInMinutes: 0, periodInMinutes: intervalMin })
  })
}

/** Clear the news alarm (called when the user disables both sources). */
export function clearNewsAlarm(): void {
  if (!hasAlarms()) return
  chrome.alarms.clear(NEWS_ALARM_NAME)
}

/** Re-arm based on stored settings — used on SW startup and on settings change.
 *  Pass the loaded settings in so we don't double-read storage. */
export function syncNewsAlarm(enabled: { github: boolean; weibo: boolean }, intervalMin: NewsInterval): void {
  if (!enabled.github && !enabled.weibo) {
    clearNewsAlarm()
    return
  }
  setupNewsAlarm(intervalMin)
}
