import type { ChangeEvent } from 'react'
import type { AppSettings } from '../../../shared/types'

/**
 * Shared contract every settings tab consumes.
 *
 * `form` is the single source of truth held by the Settings orchestrator;
 * tabs mutate it via `patch` (typed partial) or `set` (onChange helper).
 * Tab-local UI state (test results, in-flight flags, file refs …) stays
 * inside each tab and never bubbles up — only form edits flow up, so the
 * footer Save button always collects the whole form.
 */
export interface SettingsTabProps {
  form: AppSettings
  /** Merge a partial update into the form (typed). */
  patch: (p: Partial<AppSettings>) => void
  /** Convenience onChange factory bound to a form key (input/select). */
  set: (k: keyof AppSettings) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void
}

/** The four top-level settings tabs. */
export type SettingsTabId = 'general' | 'ai' | 'feishu' | 'backup'
