import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory chrome mock mirroring dataCleanup.test.ts. `alarms.clear` invokes its
// callback synchronously so setupNewsAlarm's create() runs in-test.
function mockChrome() {
  const alarms = {
    create: vi.fn(),
    clear: vi.fn((_name: string, cb?: () => void) => cb?.()),
  }
  vi.stubGlobal('chrome', { alarms })
  return { alarms }
}

import { setupNewsAlarm, syncNewsAlarm, clearNewsAlarm, NEWS_ALARM_NAME } from './alarm'

describe('setupNewsAlarm', () => {
  beforeEach(() => mockChrome())
  it('creates an alarm with delayInMinutes: 0 (fire ASAP) so the first tick isn’t delayed by a full interval', () => {
    const { alarms } = mockChrome()
    setupNewsAlarm(30)
    expect(alarms.clear).toHaveBeenCalledWith(NEWS_ALARM_NAME, expect.any(Function))
    expect(alarms.create).toHaveBeenCalledWith(
      NEWS_ALARM_NAME,
      { delayInMinutes: 0, periodInMinutes: 30 },
    )
  })
  it('respects the chosen interval for the period (10/30/60)', () => {
    const { alarms } = mockChrome()
    setupNewsAlarm(10)
    expect(alarms.create).toHaveBeenCalledWith(NEWS_ALARM_NAME, { delayInMinutes: 0, periodInMinutes: 10 })
    alarms.create.mockClear()
    setupNewsAlarm(60)
    expect(alarms.create).toHaveBeenCalledWith(NEWS_ALARM_NAME, { delayInMinutes: 0, periodInMinutes: 60 })
  })
})

describe('syncNewsAlarm', () => {
  beforeEach(() => mockChrome())
  it('arms the alarm when at least one source is enabled', () => {
    const { alarms } = mockChrome()
    syncNewsAlarm({ github: true, weibo: false }, 30)
    expect(alarms.create).toHaveBeenCalledWith(NEWS_ALARM_NAME, { delayInMinutes: 0, periodInMinutes: 30 })
  })
  it('clears the alarm and creates nothing when both sources are disabled', () => {
    const { alarms } = mockChrome()
    syncNewsAlarm({ github: false, weibo: false }, 30)
    expect(alarms.clear).toHaveBeenCalledWith(NEWS_ALARM_NAME)
    expect(alarms.create).not.toHaveBeenCalled()
  })
})

describe('clearNewsAlarm', () => {
  beforeEach(() => mockChrome())
  it('clears the news alarm', () => {
    const { alarms } = mockChrome()
    clearNewsAlarm()
    expect(alarms.clear).toHaveBeenCalledWith(NEWS_ALARM_NAME)
  })
})

describe('no chrome.alarms (test/sandbox env)', () => {
  beforeEach(() => vi.stubGlobal('chrome', undefined))
  it('setupNewsAlarm is a no-op without throwing', () => {
    expect(() => setupNewsAlarm(30)).not.toThrow()
  })
  it('syncNewsAlarm is a no-op without throwing', () => {
    expect(() => syncNewsAlarm({ github: false, weibo: false }, 30)).not.toThrow()
  })
})
