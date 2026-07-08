import { describe, it, expect } from 'vitest'
import { isFeishuOutboundAllowed, FEISHU_API_BASE, FEISHU_AUTHORIZE_URL, FEISHU_HOST_PATTERN } from './config'

// Default test env → base domain feishu.cn.
describe('isFeishuOutboundAllowed — code-layer outbound allowlist', () => {
  it('allows the base domain and any of its subdomains (open/accounts/tenant…)', () => {
    expect(isFeishuOutboundAllowed('https://open.feishu.cn/open-apis/x')).toBe(true)
    expect(isFeishuOutboundAllowed('https://accounts.feishu.cn/y')).toBe(true)
    expect(isFeishuOutboundAllowed('https://acme.feishu.cn/base/x')).toBe(true)
    expect(isFeishuOutboundAllowed('https://feishu.cn/z')).toBe(true)
  })

  it('rejects other hosts and look-alikes (suffix-spoofing)', () => {
    expect(isFeishuOutboundAllowed('https://evil.com/x')).toBe(false)
    expect(isFeishuOutboundAllowed('https://feishu.cn.evil.com/x')).toBe(false) // not a subdomain
    expect(isFeishuOutboundAllowed('https://notfeishu.cn/x')).toBe(false)       // no dot boundary
    expect(isFeishuOutboundAllowed('http://localhost/x')).toBe(false)
    expect(isFeishuOutboundAllowed('not a url')).toBe(false)
  })

  it('derives every endpoint from the one base domain', () => {
    expect(FEISHU_API_BASE).toBe('https://open.feishu.cn/open-apis')
    expect(FEISHU_AUTHORIZE_URL).toContain('accounts.feishu.cn')
    expect(FEISHU_HOST_PATTERN).toBe('*.feishu.cn')
  })
})

import { isObsidianOutboundAllowed, HAS_KNOWLEDGE_BASE } from './config'

describe('isObsidianOutboundAllowed — Obsidian loopback-only guard', () => {
  const base = 'http://127.0.0.1:27123'
  it('allows URLs under the configured loopback base', () => {
    expect(isObsidianOutboundAllowed('http://127.0.0.1:27123/', base)).toBe(true)
    expect(isObsidianOutboundAllowed('http://127.0.0.1:27123/vault/Note.md', base)).toBe(true)
  })
  it('accepts localhost as loopback', () => {
    expect(isObsidianOutboundAllowed('http://localhost:27123/', 'http://localhost:27123')).toBe(true)
  })
  it('rejects a different port on the same host (origin mismatch)', () => {
    expect(isObsidianOutboundAllowed('http://127.0.0.1:27124/', base)).toBe(false)
  })
  it('rejects non-loopback hosts even if baseUrl is misconfigured to them', () => {
    expect(isObsidianOutboundAllowed('http://evil.com:27123/', 'http://evil.com:27123')).toBe(false)
    expect(isObsidianOutboundAllowed('http://192.168.1.5:27123/', 'http://192.168.1.5:27123')).toBe(false)
  })
  it('rejects scheme mismatch (https vs http)', () => {
    expect(isObsidianOutboundAllowed('https://127.0.0.1:27124/', base)).toBe(false)
  })
  it('rejects malformed / empty input', () => {
    expect(isObsidianOutboundAllowed('not a url', base)).toBe(false)
    expect(isObsidianOutboundAllowed('http://127.0.0.1:27123/', '')).toBe(false)
  })
  it('HAS_KNOWLEDGE_BASE is a boolean (default on unless VITE_KNOWLEDGE_BASE=false)', () => {
    expect(typeof HAS_KNOWLEDGE_BASE).toBe('boolean')
  })
})
