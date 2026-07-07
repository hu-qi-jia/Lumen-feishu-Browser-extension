import { describe, it, expect } from 'vitest'
import { computeTargetSize, selectionToAttachment, tryAddSelectionAttachment, MAX_SELECTION_CHIPS } from './attachments'
import type { DocSelectionPayload } from './types'

describe('computeTargetSize', () => {
  it('keeps size when under long edge', () => {
    expect(computeTargetSize(800, 600, 1024)).toEqual({ width: 800, height: 600 })
  })
  it('scales down by long edge, preserving aspect', () => {
    expect(computeTargetSize(2048, 1024, 1024)).toEqual({ width: 1024, height: 512 })
    expect(computeTargetSize(1000, 2000, 500)).toEqual({ width: 250, height: 500 })
  })
})

const payload = (over: Partial<DocSelectionPayload> = {}): DocSelectionPayload => ({
  kind: 'doc', docToken: 'DOC123', docTitle: '我的文档', url: 'https://x.feishu.cn/docx/DOC123',
  selectedText: '选中片段', ...over,
})

describe('selectionToAttachment', () => {
  it('builds a selection Attachment with the payload text', () => {
    const a = selectionToAttachment(payload())
    expect(a.type).toBe('selection')
    expect(a.selection?.selectedText).toBe('选中片段')
    expect(a.selection?.docToken).toBe('DOC123')
    expect(a.selection?.paragraphText).toBeUndefined()
  })
  it('merges resolved paragraph/heading context when given', () => {
    const a = selectionToAttachment(payload(), { paragraphText: '整段', headingText: '标题A' })
    expect(a.selection?.paragraphText).toBe('整段')
    expect(a.selection?.headingText).toBe('标题A')
  })
})

describe('tryAddSelectionAttachment', () => {
  it('appends when under the limit and not a duplicate', () => {
    const r = tryAddSelectionAttachment([], payload())
    expect(r.added).toBe(true)
    expect(r.attachments).toHaveLength(1)
    expect(r.attachments[0].type).toBe('selection')
  })
  it('rejects an exact duplicate (same docToken + selectedText)', () => {
    const base = tryAddSelectionAttachment([], payload()).attachments
    const r = tryAddSelectionAttachment(base, payload())
    expect(r.added).toBe(false)
    expect(r.reason).toBe('dup')
    expect(r.attachments).toHaveLength(1)
  })
  it('rejects when the selection-chip cap is reached', () => {
    let atts: import('./types').Attachment[] = []
    for (let i = 0; i < MAX_SELECTION_CHIPS; i++) {
      atts = tryAddSelectionAttachment(atts, payload({ selectedText: `片段${i}` })).attachments
    }
    expect(atts.filter((a) => a.type === 'selection')).toHaveLength(MAX_SELECTION_CHIPS)
    const r = tryAddSelectionAttachment(atts, payload({ selectedText: '多出来的' }))
    expect(r.added).toBe(false)
    expect(r.reason).toBe('limit')
  })
})
