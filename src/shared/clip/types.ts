/**
 * Drag-to-import — shared ClipCapture type.
 *
 * A dropped CSV/TSV/TXT file is parsed client-side into this shape (see file.ts), then
 * converted to an attachment via attachments.ts. No network egress — parsing is local.
 */

export interface ClipCapture {
  /** Source page URL. */
  url: string
  /** Source page title. */
  title: string
  /** The user's text selection at capture time (empty if none). */
  selectedText: string
  /** Readable main content of the page (used when there's no selection). */
  content: string
  /** ms epoch when captured (stamped in the page world). */
  capturedAt: number
  /** True if `content` was truncated to the size cap. */
  truncated: boolean
}

/** Max characters of content we capture/send (avoid dumping a whole huge file). */
export const MAX_CLIP_CHARS = 50_000
