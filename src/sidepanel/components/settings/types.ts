import type { ChangeEvent } from 'react'
import type { AppSettings } from '@/shared/types'

/**
 * Shared contract every settings tab consumes.
 *
 * `form` is the single source of truth held by the Settings orchestrator;
 * tabs mutate it via `patch` (typed partial) or `set` (onChange helper).
 * Tab-local UI state (test results, in-flight flags, file refs …) stays
 * inside each tab and never bubbles up — only form edits flow up.
 */
export interface SettingsTabProps {
  form: AppSettings
  /** Merge a partial update into the form (typed). */
  patch: (p: Partial<AppSettings>) => void
  /** Convenience onChange factory bound to a form key (input/select). */
  set: (k: keyof AppSettings) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void
  /** Persist the current form immediately (optional, for explicit save buttons). */
  onSave?: (s: AppSettings) => void
}

/** The top-level settings tabs. */
export type SettingsTabId = 'general' | 'ai' | 'feishu' | 'knowledgeBase' | 'backup' | 'appearance'
