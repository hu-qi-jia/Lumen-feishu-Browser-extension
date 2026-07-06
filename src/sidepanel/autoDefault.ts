import type { AppTab } from './hooks/useDocBinding'

/** Inputs to the one-shot "default the view by page type" decision. Pure data. */
export interface AutoDefaultInput {
  /** Has the focused tab's URL resolved at least once? */
  ctxResolved: boolean
  /** Is the focused tab a supported Feishu resource (or is a doc pinned)? */
  pageSupported: boolean
  /** Does the active session already have messages? */
  hasConversation: boolean
  /** Current main view. */
  currentTab: AppTab
  /** A clip capture/error is showing (the clip view takes over). */
  clip: boolean
  /** An answer is streaming — don't touch the view mid-flight. */
  chatStreaming: boolean
  /** A scenario is creating — don't touch the view mid-flight. */
  scenarioBusy: boolean
  /** One-tick suppress flag set after a new-session / follow-switch. */
  newSessionPin: boolean
  /** Has the initial auto-default already been settled? (the latch) */
  alreadyDefaulted: boolean
}

export interface AutoDefaultResult {
  /** Tab to switch to, or null to leave the view untouched. */
  tab: AppTab | null
  /** True once the auto-default has settled — App latches this so it never re-yanks. */
  settled: boolean
  /** Whether to consume (clear) the newSessionPin flag. */
  consumePin: boolean
}

const WAIT: AutoDefaultResult = { tab: null, settled: false, consumePin: false }

/**
 * Decide the INITIAL view from the page type — a supported Feishu resource opens to 对话, an
 * unsupported page to 首页 (scenes / 应用 hub). ONE-SHOT: once it settles it never overrides the
 * user's view again, so switching documents (which briefly churns the page context and can flip
 * `pageSupported`) can't yank the user off chat. Never yanks the user out of an active
 * conversation. Extracted pure so the latch logic is unit-testable without the React/chrome harness.
 */
export function decideAutoDefault(i: AutoDefaultInput): AutoDefaultResult {
  if (!i.ctxResolved) return WAIT
  if (i.alreadyDefaulted) return { tab: null, settled: true, consumePin: false }
  // Transient states — wait and re-evaluate next change, don't settle yet.
  if (i.clip || i.chatStreaming || i.scenarioBusy) return WAIT
  // Terminal: whatever we decide now, settle so later context churn can't re-yank.
  if (i.currentTab === 'scenes' || i.currentTab === 'news') return { tab: null, settled: true, consumePin: false }
  if (i.hasConversation) return { tab: null, settled: true, consumePin: false }
  if (i.newSessionPin) return { tab: null, settled: true, consumePin: true }
  return { tab: i.pageSupported ? 'chat' : 'scenes', settled: true, consumePin: false }
}
