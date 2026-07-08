/** High-level Obsidian vault operations. Thin wrappers over the REST API used by the Hub
 *  panel (Plan 2) and the agent KB tools (Plan 3). Plan 1 ships just the ping probe. */
import type { AppSettings } from '../types'
import { obsidianFetch } from './http'

export interface ObsidianPing {
  ok: boolean
  /** HTTP status from GET / (200 = server reachable; 401 = reachable, token wrong). */
  status: number
  /** True when the server confirms the token is valid. */
  authenticated?: boolean
  /** Vault name advertised by the server, if present. */
  vault?: string
}

/** Reachability + auth probe: GET / . No token required to confirm the server is up, but a
 *  token (stored or via opts) is sent when available so we can also confirm it's valid.
 *  This is the PNA/CSP gate primitive — never throws; network/CSP/PNA blocks return ok:false. */
export async function pingObsidian(settings: AppSettings, token?: string): Promise<ObsidianPing> {
  try {
    const res = await obsidianFetch('GET', '', settings, token ? { token } : {})
    let body: { authenticated?: boolean; vault?: string } = {}
    try { body = await res.json() as typeof body } catch { /* non-JSON (older plugin) */ }
    return {
      ok: res.ok || res.status === 401,                  // 401 = server reachable, token wrong
      status: res.status,
      authenticated: body.authenticated ?? (res.ok && !!token),
      vault: body.vault,
    }
  } catch {
    return { ok: false, status: 0, authenticated: false } // CSP / PNA / Obsidian not running
  }
}
