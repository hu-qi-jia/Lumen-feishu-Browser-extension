import { describe, it, expect } from 'vitest'
import { computeTargetSize } from './attachments'

describe('computeTargetSize', () => {
  it('keeps size when under long edge', () => {
    expect(computeTargetSize(800, 600, 1024)).toEqual({ width: 800, height: 600 })
  })
  it('scales down by long edge, preserving aspect', () => {
    expect(computeTargetSize(2048, 1024, 1024)).toEqual({ width: 1024, height: 512 })
    expect(computeTargetSize(1000, 2000, 500)).toEqual({ width: 250, height: 500 })
  })
})
